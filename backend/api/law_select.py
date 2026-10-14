"""
LLM3 — 관련 법령 선택 (2026-10-07, 사용자 결정: LLM1 → KB3 검색 → **LLM3** → LLM2)

세무사 검토에서 "AI 가 단 관련 법령이 부정확·부적절" 지적. 10/7 오프라인 감사(시민 48문항 KB3 단독 회차):
법령을 인용한 자문 26턴 중 10턴 안팎이 무관한 조문이거나 조문 내용을 틀리게 설명했다(C48 연기 → 국기법 §48
가산세 감면, C27 상증법 §45 를 '과세표준'으로 등). **그 인용 대부분이 근거 카드에 실제로 있던 조문**이다 —
남의 사건 카드의 조문(그것도 당시 법 기준)을 질문에 맞는지 따지지 않고 옮긴 것. 그래서:

  ① 후보 = 근거 카드 law_articles(정규화 → 현행 조문 조회) + 질문으로 조문 임베딩 검색
  ② Solar 는 후보 목록(현행 제목 + 쟁점 한 줄)에서 **고르기만** 한다. 번호를 생성하지 않는다.
     옛 번호가 현행에선 다른 조문이 된 경우(시점 차이)는 현행 제목·쟁점이 질문과 안 맞아 자연히 안 뽑힌다.
  ③ 고른 조문의 **현행 원문**을 [관련 법령] 블록으로 작문(LLM2)에 준다.
  ④ 작문 뒤 코드 대조(check_answer): 고른 조문·엔진 근거·사용자 발화에 없는 법령 인용을 찾는다.

법령 원문: 운영 = laws.articles(0046, DB) · 오프라인 하네스 = backend/data/laws/ 파일(LAW_STORE=file).
켜고 끄기: LAW_SELECT=on|off (기본 off) · LAW_CITE_CHECK=off|drop (기본 drop, LAW_SELECT=on 일 때만)
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from api import law_cite

log = logging.getLogger("law_select")

LAW_DIR = Path(os.environ.get("LAW_DB_DIR") or Path(__file__).resolve().parents[1] / "data" / "laws")
MAX_CANDIDATES = 16
VECTOR_K = 6
MAX_PICKS = 4
ARTICLE_CHARS_TABLE = 1800  # 표가 든 조문(F1, 10/12 — 세율표 등)은 잘리면 숫자가 빠진다. 표 없는 조문은 종전 상한
ARTICLE_CHARS = 900      # 블록에 싣는 조문 원문 상한(고른 항이 있으면 그 항만) — 10/8 C31: 1,600×5 + 카드 4장에서 작문 120초 초과
# 정의·요건 질문(세무사 Q4 10/14 "익금 진입로까지만") — 법인세법 시행령 §11(1,532자)이 900자에서 잘려 수익 범위 절반이 빠졌다.
# 이 유형은 사례 카드를 거의 안 싣는다(pipeline._law_answerable) — 입력이 늘어난 만큼 카드 몫이 준다.
ARTICLE_CHARS_DEEP = 1800
TIMEOUT_LAW_SELECT = 30


def enabled() -> bool:
    return os.environ.get("LAW_SELECT", "off") == "on"


def law_only_enabled() -> bool:
    """사례 근거가 0건(off_issue·no_precedent)일 때 고른 현행 조문만으로 일반 안내를 할지. LAW_SELECT 도 켜져야 한다."""
    return enabled() and os.environ.get("LAW_ONLY", "off") == "on"


def check_mode() -> str:
    return os.environ.get("LAW_CITE_CHECK", "drop")


# ── 법령 저장소 ─────────────────────────────────────────────────────────

@dataclass
class Article:
    law: str
    no: str
    title: Optional[str]
    text: str
    paragraphs: list[dict]
    heading: str
    issue: str = ""
    keywords: list[str] = field(default_factory=list)

    @property
    def key(self) -> tuple[str, str]:
        return (self.law, self.no)

    def label(self) -> str:
        num, _, sub = self.no.partition("의")
        return f"{self.law} 제{num}조" + (f"의{sub}" if sub else "")


class FileLawStore:
    """오프라인 하네스용 — backend/data/laws/ 파일(articles.jsonl · gists.json · embeddings.npz)."""

    def __init__(self, root: Path = LAW_DIR):
        gists = json.loads((root / "gists.json").read_text("utf-8")) if (root / "gists.json").exists() else {}
        self.by_key: dict[tuple[str, str], Article] = {}
        self._texts: list[tuple[str, Article]] = []
        for line in (root / "articles.jsonl").open(encoding="utf-8"):
            r = json.loads(line)
            if r["version"] != "current" or r["deleted"]:
                continue
            g = gists.get(hashlib.sha1(r["text"].encode("utf-8")).hexdigest()) or {}
            a = Article(r["law_name"], r["article_no"], r["title"], r["text"], r["paragraphs"], r["heading"],
                        g.get("issue", ""), g.get("keywords", []))
            self.by_key[a.key] = a
            self._texts.append((_embed_key(r, g), a))
        self._vec = None
        self._vec_arts: list[Article] = []
        emb = root / "embeddings.npz"
        if emb.exists():
            import numpy as np

            z = np.load(emb)
            idx = {k: i for i, k in enumerate(z["keys"].tolist())}
            rows, arts = [], []
            for k, a in self._texts:
                if k in idx:
                    rows.append(idx[k])
                    arts.append(a)
            if rows:
                m = z["vecs"][rows]
                self._vec = m / np.linalg.norm(m, axis=1, keepdims=True)
                self._vec_arts = arts

    def get(self, key: tuple[str, str]) -> Optional[Article]:
        return self.by_key.get(key)

    def search(self, qvec: list[float], k: int = VECTOR_K, exclude: set[str] = frozenset()) -> list[tuple[float, Article]]:
        if self._vec is None:
            return []
        import numpy as np

        q = np.asarray(qvec, dtype=np.float32)
        sims = self._vec @ (q / np.linalg.norm(q))
        out = []
        for i in np.argsort(-sims):
            a = self._vec_arts[i]
            if _parent(a.law) in exclude:
                continue
            out.append((float(sims[i]), a))
            if len(out) >= k:
                break
        return out


class DbLawStore:
    """운영 — laws.articles(0046). 현행 조문 메타·원문은 프로세스당 한 번 메모리로(약 8천 행, 임베딩 제외),
    벡터 검색만 DB 함수(laws.match_articles)로. 검색이 실패하면 빈 목록(근거 카드 갈래만으로 진행)."""

    def __init__(self):
        from api.rag import laws_store

        self._db = laws_store
        self.by_key = {}
        for r in laws_store.load_current():
            a = Article(r["law_name"], r["article_no"], r["title"], r["text"], r["paragraphs"], r["heading"],
                        r["issue"], list(r["keywords"]))
            self.by_key[a.key] = a
        if not self.by_key:
            raise RuntimeError("laws.articles 비어 있음")

    def get(self, key: tuple[str, str]) -> Optional[Article]:
        return self.by_key.get(key)

    def search(self, qvec: list[float], k: int = VECTOR_K, exclude: set[str] = frozenset()) -> list[tuple[float, Article]]:
        from api.rag import vec_memory

        idx = vec_memory.get("laws")   # 메모리 인덱스(10/8) — DB 전수 비교 8.6초 → 수십 ms
        if idx is not None:
            hits = idx.top(qvec, k, lambda r: r[2] not in exclude)
            return [(sc, self.by_key[(law, no)]) for sc, (law, no, _p) in hits if (law, no) in self.by_key]
        try:
            rows = self._db.match_articles(qvec, k, sorted(exclude))
        except Exception as exc:  # noqa: BLE001
            log.warning("laws.match_articles 실패 — 검색 갈래 없이: %s", exc)
            return []
        return [(sc, self.by_key[(law, no)]) for law, no, sc in rows if (law, no) in self.by_key]


LawStore = FileLawStore | DbLawStore


def _embed_key(r: dict, g: dict) -> str:
    """scripts/law_ingest.py embed_text 와 같은 텍스트의 sha1 — 임베딩 캐시 키."""
    head = f"{r['law_name']} 제{r['article_num']}조" + (f"의{r['article_sub']}" if r["article_sub"] else "")
    head += f"({r['title']})" if r["title"] else ""
    parts = [head]
    if g:
        parts += [f"쟁점: {g['issue']}", "표현: " + ", ".join(g["keywords"])]
    t = "\n".join(parts) + "\n\n" + r["text"][:2500]
    return hashlib.sha1(t.encode("utf-8")).hexdigest()


_STORE = None
_STORE_FAILED = False


def store():
    """LAW_STORE=db(기본, 운영) | file(오프라인 하네스). 실패하면 None — LLM3 를 건너뛰고 지금 동작으로."""
    global _STORE, _STORE_FAILED
    if _STORE is None and not _STORE_FAILED:
        kind = os.environ.get("LAW_STORE", "db")
        try:
            _STORE = FileLawStore() if kind == "file" else DbLawStore()
            log.info("법령 저장소(%s): 현행 조문 %d", kind, len(_STORE.by_key))
        except Exception as exc:  # noqa: BLE001
            log.warning("법령 저장소(%s) 열기 실패 — LLM3 건너뜀: %s", kind, exc)
            _STORE_FAILED = True
    return _STORE


def warm() -> None:
    """서버 기동 직후 백그라운드에서 — 조문 메타·원문 로드(벡터는 vec_memory.load_all 이 올린다)."""
    store()


# ── ① 후보 ───────────────────────────────────────────────────────────────────

@dataclass
class Candidate:
    article: Article
    source: str            # "근거" | "검색"
    from_refs: list[str]   # 이 조문을 인용한 근거 문서번호(근거 갈래)


# 납세 주체·세목 필터(10/8) — 프롬프트로 "개인사업자는 소득세법" 을 부탁해도 C42(가게 배우자 인건비)에 법인세법을 3회 연속
# 골랐다. 질문에 법인 단어가 없으면 법인세법 후보를, 지방세 세목 단어가 없으면 지방세 법령 후보를 아예 뺀다.
_CORP_WORDS = ("법인", "주식회사", "대표이사", "주주", "손금", "익금")
_LOCAL_WORDS = ("지방세", "취득세", "재산세", "자동차세", "등록면허세", "주민세", "지방소득세", "지방소비세",
                "레저세", "담배소비세", "지역자원시설세", "지방교육세")
_LOCAL_LAWS = ("지방세기본법", "지방세법", "지방세특례제한법")


def _excluded_laws(user_text: str) -> set[str]:
    ex = set()
    if not any(w in user_text for w in _CORP_WORDS):
        ex.add("법인세법")
    if not any(w in user_text for w in _LOCAL_WORDS):
        ex.update(_LOCAL_LAWS)
    return ex


def _parent(law: str) -> str:
    return re.sub(r"\s*시행(령|규칙)$", "", law)


def candidates(user_text: str, passages: list, qvec: Optional[list[float]] = None,
               st=None) -> list[Candidate]:
    st = st or store()
    if st is None:
        return []
    excluded = _excluded_laws(user_text)
    out: dict[tuple[str, str], Candidate] = {}
    for p in passages or []:
        raws = list(p.law_articles or []) + _card_law_line(p.content or "")
        for key in law_cite.keys(raws):
            a = st.get(key)
            if a is None:
                continue
            c = out.setdefault(key, Candidate(a, "근거", []))
            ref = (p.case_refs or [None])[0]
            if ref and ref not in c.from_refs:
                c.from_refs.append(ref)
    for key in law_cite.keys([user_text]):   # 사용자가 직접 말한 조문
        a = st.get(key)
        if a and key not in out:
            out[key] = Candidate(a, "질문", [])
    if qvec is None:
        try:
            from api.rag import embeddings

            qvec = embeddings.embed_query(user_text)
        except Exception as exc:  # noqa: BLE001
            log.warning("법령 검색 임베딩 실패 — 근거 갈래만: %s", exc)
    out = {k: c for k, c in out.items() if c.source == "질문" or _parent(k[0]) not in excluded}
    if qvec is not None:
        added = 0
        for _, a in st.search(qvec, VECTOR_K + len(out), excluded):
            if added >= VECTOR_K:
                break
            if a.key in out:
                continue
            out[a.key] = Candidate(a, "검색", [])
            added += 1
    return list(out.values())[:MAX_CANDIDATES]


_CARD_LAW_LINE = re.compile(r"^조문:\s*(.+)$", re.M)


def _card_law_line(content: str) -> list[str]:
    m = _CARD_LAW_LINE.search(content)
    return [m.group(1)] if m else []


# ── ② 선택(Solar) ────────────────────────────────────────────────────────────

_SELECT_SYSTEM = (
    "당신은 한국 세법 조문 선별기입니다. 사용자 질문에 답할 때 **근거로 직접 인용해야 할 현행 조문**을 "
    "후보 목록에서 고릅니다.\n"
    "- 후보는 현행 법령의 조문 제목과 그 조문이 정하는 내용(한 줄)입니다. 질문이 묻는 제도·요건·절차·계산을 "
    "**정하는** 조문만 고르세요. 단어만 겹치거나, 다른 제도(예: 가산세 감면 vs 세무조사 연기)를 정하는 조문은 고르지 마세요.\n"
    "- '근거' 출처 후보는 남의 사건 자료에 적힌 조문을 현행 법령에서 찾아 온 것입니다. 그 자료가 오래되어 지금은 "
    "번호가 다른 조문일 수 있으니 반드시 제목·내용이 질문과 맞는지로 판단하세요.\n"
    "- 질문자에게 맞는 법을 고르세요: 근로자·프리랜서·가게·개인사업자는 소득세법(법인세법 아님), 법인이면 법인세법. "
    "국세(소득세·부가세·상속증여세 등·세무조사) 질문에 지방세 법령을, 지방세(취득세·재산세 등) 질문에 국세 법령을 고르지 마세요.\n"
    "- 질문에 쟁점이 여럿이면(예: '공제 대상인가' + '지금이라도 받을 수 있나') **쟁점마다** 근거 조문을 고르세요.\n"
    "- 고른 조문마다 fit 을 다세요: direct(질문의 제도·요건을 정함) · supporting(계산·절차·서식 등 보조) · "
    "unrelated(관련 없음). 관련 없는 조문은 아예 고르지 마세요.\n"
    "- 맞는 조문이 없으면 빈 목록을 내세요. 억지로 채우지 마세요. 많아야 4개.\n"
    "- 조문이 길면 질문과 관련된 항 번호를 paras 에 적으세요(모르면 비우세요).\n"
    "반드시 emit_law_picks 도구로만 응답하세요."
)


# 'why'(고른 이유 한 구절)는 어디서도 읽지 않는데 출력 토큰이었다 — LLM3 는 자문 임계 경로(2.0~2.2s, 출력 ~140토큰)라
# 10/14 결론 문단으로 p50 이 10.1s 가 되자 뺐다(지침 §6-4 10/13 후보 1). 되돌리기 LAW_SELECT_WHY=on.
def _select_tool(n: int) -> dict:
    return {
        "type": "function",
        "function": {
            "name": "emit_law_picks",
            "description": "질문에 근거가 되는 후보 조문 번호(최대 4개).",
            "parameters": {
                "type": "object",
                "properties": {
                    "picks": {
                        "type": "array",
                        "maxItems": MAX_PICKS,
                        "items": {
                            "type": "object",
                            "properties": {
                                "n": {"type": "integer", "description": f"후보 번호 1~{n}"},
                                "fit": {"type": "string", "enum": ["direct", "supporting", "unrelated"]},
                                "paras": {"type": "array", "items": {"type": "integer"}},
                                **({"why": {"type": "string", "description": "이 조문이 질문의 무엇을 정하는지 한 구절"}}
                                   if os.environ.get("LAW_SELECT_WHY", "off") == "on" else {}),
                            },
                            "required": ["n", "fit"],
                        },
                    }
                },
                "required": ["picks"],
            },
        },
    }


@dataclass
class Pick:
    article: Article
    paras: list[int]
    why: str
    source: str
    excerpt: Optional[str] = None   # 항·호 발췌(쟁점별 조문 — 긴 세율 조문은 필요한 호만, 10/15)


def _cand_line(i: int, c: Candidate) -> str:
    a = c.article
    t = f"[후보 {i}] {a.label()}" + (f"({a.title})" if a.title else "")
    t += f" — {a.issue}" if a.issue else f" — {a.text[:120]}"
    if a.paragraphs:
        t += f" (항 {len(a.paragraphs)}개)"
    return t + f" · 출처: {c.source}"


def select(user_text: str, cands: list[Candidate], history_text: str = "") -> Optional[list[Pick]]:
    """고른 조문 목록. 실패면 None(호출자는 LLM3 없이 지금 동작으로). 혼잡은 올려 보낸다."""
    if not cands:
        return []
    from api import llm, upstage_gate

    listing = "\n".join(_cand_line(i, c) for i, c in enumerate(cands, 1))
    ctx = f"[앞선 대화 요약]\n{history_text}\n\n" if history_text else ""
    try:
        resp = llm.bounded_client(TIMEOUT_LAW_SELECT, retries=0).chat.completions.create(
            model=llm._chat_model(),
            messages=[{"role": "system", "content": _SELECT_SYSTEM},
                      {"role": "user", "content": f"{ctx}[사용자 질문]\n{user_text}\n\n[후보 조문]\n{listing}"}],
            tools=[_select_tool(len(cands))],
            tool_choice={"type": "function", "function": {"name": "emit_law_picks"}},
            temperature=0,
        )
        calls = getattr(resp.choices[0].message, "tool_calls", None)
        if not calls:
            return None
        args = json.loads(calls[0].function.arguments)
        args = args.get("properties", args) if isinstance(args, dict) else {}
        picks, seen = [], set()
        for it in args.get("picks") or []:
            i = it.get("n") if isinstance(it, dict) else None
            if not isinstance(i, int) or not 1 <= i <= len(cands) or i in seen:
                continue
            if it.get("fit") not in ("direct", "supporting"):   # C43(10/7): 이유에 '무관'이라 쓰고도 골랐다
                continue
            seen.add(i)
            c = cands[i - 1]
            nps = len(c.article.paragraphs)
            paras = [p for p in (it.get("paras") or []) if isinstance(p, int) and 1 <= p <= nps]
            picks.append(Pick(c.article, paras, str(it.get("why") or "").strip(), c.source))
        return picks[:MAX_PICKS]
    except upstage_gate.UpstageCongested:
        raise
    except Exception as exc:  # noqa: BLE001 — 부가 단계. 실패하면 LLM3 없이
        log.warning("LLM3 법령 선택 실패 — 건너뜀: %s", exc)
        return None


# ── ③ 작문 블록 ──────────────────────────────────────────────────────────────

def _article_text(p: Pick, cap: int = ARTICLE_CHARS) -> str:
    a = p.article
    if p.excerpt:
        whole = p.excerpt == a.text
        body = _HEAD_RE.sub("", a.text, count=1) if whole else p.excerpt
        t = f"{a.label()}" + (f"({a.title})" if a.title else "") + ("" if whole else " [발췌]") + f"\n{body}"
    elif p.paras and a.paragraphs:
        head = f"{a.label()}" + (f"({a.title})" if a.title else "")
        body = "\n".join(x["text"] for x in a.paragraphs if x["no"] in set(p.paras))
        t = f"{head} [발췌: 제{', '.join(map(str, p.paras))}항]\n{body}"
    else:
        t = a.text
    cap = max(cap, ARTICLE_CHARS_TABLE) if "[표]" in t else cap
    return t if len(t) <= cap else t[:cap] + " …(이하 생략)"


# ── 위임 시행령 따라가기(세무사 Q3·Q4 10/14) ──────────────────────────────────────
# Q3 "제조업 창업 — 간이과세 요건": 부가세법 §61①2호 "대통령령으로 정하는 사업자"의 답(제조업 = 배제, 시행령 §109②2호)이
# 시행령에 있는데, LLM3 가 §109 를 고른 날과 안 고른 날이 갈렸다(10/13 a3b 는 골랐고, 세무사가 본 회차는 못 골랐다).
# Q4 "익금이 뭔가요": 법인세법 §15③ → 시행령 §11(수익의 범위). 고른 **법률** 조문을 첫머리에서 "법 제N조"로 받는
# 시행령 조문을 결정론으로 보탠다 — 정의·요건 질문에만(사례 판단·계산엔 블록만 길어진다).
DELEGATE_MAX = 2


def _refers(text: str, no: str) -> bool:
    """'법 제61조제1항…' 처럼 시행령 조문이 모법 조문 no 를 받는가 — 제61조의2 는 제61조가 아니다."""
    num, _, sub = no.partition("의")
    pat = rf"(?<![가-힣])법\s?제{num}조" + (rf"의{sub}" if sub else r"(?!의\d)")
    return re.search(pat, text) is not None


def delegated(picks: list[Pick], st=None) -> list[Pick]:
    """고른 법률 조문을 받는 시행령 조문(아직 안 고른 것) — 조문 머리(첫 항 또는 첫 200자)가 '법 제N조'를 부르는 것만.
    항이 있으면 그 조문을 부르는 항만 싣는다(§109 ①②④ — ③은 금액 계산 보조)."""
    st = st or store()
    if st is None:
        return []
    have = {p.article.key for p in picks}
    out: list[Pick] = []
    for p in picks:
        a = p.article
        if a.law.endswith(("시행령", "시행규칙")):
            continue
        dec = f"{a.law} 시행령"
        hits = []
        for (lw, _), d in st.by_key.items():
            if lw != dec or d.key in have:
                continue
            head = d.paragraphs[0]["text"] if d.paragraphs else d.text[:200]
            if _refers(head, a.no):
                hits.append(d)
        for d in sorted(hits, key=lambda d: _article_order(d.no))[:1]:
            paras = [x["no"] for x in d.paragraphs if _refers(x["text"], a.no)] if d.paragraphs else []
            out.append(Pick(d, paras if len(paras) < len(d.paragraphs) else [], f"{a.label()} 위임", "위임"))
            have.add(d.key)
        if len(out) >= DELEGATE_MAX:
            break
    return out


# 복합 사안(E단계 골격, 10/15) — 고른 조문이 원문에서 '제A조부터 제B조까지'로 묶어 부르는 조문군의 첫 조문(상증법 시행령 §26
# '시가(법 제60조부터 제66조까지의 규정에 따라 평가한 가액)' → 시가 조문 §60). 블록에 없으면 작문이 '시가는 제60조에 따라'를 쓰다
# 인용 대조에 문장째 빠졌다(로컬 5문항 중 3~4). 범위로 부르는 조문군은 평가·정의 규정인 경우가 많다. 설계 §2-3(쟁점별 조문
# 결정론)의 작은 판 — 복합 사안에만, 1개까지.
_RANGE_REF = re.compile(r"(?:「([^」]{2,30})」\s?|(?<![가-힣])(법)\s?)?제(\d+)조(?:의(\d+))?\s?부터\s?제\d+조(?:의\d+)?\s?까지")


def referenced(picks: list[Pick], st=None, max_n: int = 1) -> list[Pick]:
    st = st or store()
    if st is None:
        return []
    have = {p.article.key for p in picks}
    counts: dict[tuple[str, str], int] = {}
    for p in picks:
        a = p.article
        base = a.law.removesuffix(" 시행규칙").removesuffix(" 시행령")
        for m in _RANGE_REF.finditer(a.text):
            # 「법령명」 = 그 법령 · 시행령 속 '법 제N조' = 모법 · 맨 '제N조' = 같은 법령
            law = m.group(1) or (base if m.group(2) else a.law)
            key = (law, m.group(3) + (f"의{m.group(4)}" if m.group(4) else ""))
            if key not in have and key in st.by_key:
                counts[key] = counts.get(key, 0) + 1
    keys = sorted(counts, key=lambda k: -counts[k])[:max_n]
    return [Pick(st.by_key[k], [], "고른 조문이 범위로 부르는 조문군의 첫 조문", "참조") for k in keys]


# ── 쟁점별 조문(E단계 설계 §2-3, 10/15) ──────────────────────────────────────────
# 복합 사안은 쟁점이 4~5개인데 LLM3 는 4개를 고르고, 고르는 건 쟁점 조문(§101·§35)뿐 — 세율·공제·신고 기한 조문(소득세법 §104·
# §103·§105, 상증법 §53·§56·§26·§68·§69)은 한 번도 안 들어왔다(10/15 로컬 C1~C4·T03). 판별된 쟁점마다 조문 키를 **코드로** 싣는다.
# 긴 조문은 필요한 항·호만 발췌(§104 4천 자 → 주식 11·12호). 복합 사안 갈래에만(입력 토큰↑). 끄기 ADVISORY_ISSUE_LAWS=off.
# 키는 현행 laws.articles 원문으로 확인했다(10/15). 증권거래세법은 적재 후 store 에 있을 때만 실린다.
_STOCK_W = re.compile(r"주식|지분|비상장|상장|주권|증권")
_REAL_W = re.compile(r"아파트|주택|부동산|토지|건물|상가|오피스텔|분양권|입주권|빌라")
_SELL_W = re.compile(r"양도|팔[아았고면려겠]|팔기|파는|판다|매도|매각|넘기|넘겨")
_RELATIVE_W = re.compile(r"아들|딸|자녀|자식|아버지|어머니|부모|배우자|아내|남편|형제|자매|누나|언니|오빠|동생|가족|친척|"
                         r"손자|손녀|며느리|사위|특수관계")
_LOW_W = re.compile(r"저가|싸게|낮은\s*가|낮게|시가|헐값|싼\s*값")
_GIFT_W = re.compile(r"증여")
# (쟁점, [(법령, 조, [(항 | None, 호 목록 | None)] | None = 조문 전체)])
ISSUE_LAWS: dict[str, list] = {
    "양도세-주식": [("소득세법", "104", [(1, (11, 12))]), ("소득세법", "103", [(1, None)]), ("소득세법", "105", [(1, (2,))])],
    # 10/15 로컬 C1: 65% 보유자를 '대주주가 아닌 자 — 중소기업 10%'로 읽었다(대주주 범위가 블록에 없었다). 상장 대주주(§157)는
    # 3,500자라 싣지 않는다 — 계산기(설계 §2-1)가 판정한다.
    "대주주-비상장": [("소득세법 시행령", "167의8", [(1, None)])],
    "양도세-부동산": [("소득세법", "104", [(1, (1, 2, 3))]), ("소득세법", "55", [(1, None)]), ("소득세법", "103", [(1, None)]),
                  ("소득세법", "105", [(1, (1,))])],
    "부당행위-양도": [("소득세법", "101", [(1, None)]), ("소득세법 시행령", "167", [(3, None), (4, None)])],
    "증여-저가양수": [("상속세 및 증여세법", "35", [(1, None)])],          # 기준금액(시행령 §26)은 delegated 가 싣는다
    "증여": [("상속세 및 증여세법", "53", None), ("상속세 및 증여세법", "56", None), ("상속세 및 증여세법", "26", None),
           ("상속세 및 증여세법", "68", [(1, "lead")]), ("상속세 및 증여세법", "69", [(2, None)])],
    "증권거래세": [],                                                  # 증권거래세법 적재 후 키를 채운다(설계 부록 A)
}
ISSUE_MAX = 12
_HEAD_RE = re.compile(r"^제\d+조(?:의\d+)?(?:\([^)]*\))?\s*")


def issues(user_text: str) -> list[str]:
    """질문 글에서 판별한 쟁점(ISSUE_LAWS 키) — 순서 = 블록에 싣는 순서."""
    t = user_text
    sell, rel_low = bool(_SELL_W.search(t) or re.search(r"양도(?:소득)?세", t)), bool(_RELATIVE_W.search(t) and _LOW_W.search(t))
    out = []
    if sell and _STOCK_W.search(t):
        out.append("양도세-주식")
        if "비상장" in t:
            out.append("대주주-비상장")
    if sell and _REAL_W.search(t):
        out.append("양도세-부동산")
    if out and rel_low:
        out += ["부당행위-양도", "증여-저가양수"]
    if _GIFT_W.search(t) or (out and rel_low):
        out.append("증여")
    if sell and _STOCK_W.search(t):
        out.append("증권거래세")
    return out


_ITEM_START = re.compile(r"^(\d{1,2})\.\s", re.M)


def _excerpt(a: Article, spec: list) -> Optional[str]:
    """항(·호) 발췌 원문. 호를 고르면 항 머리(첫 호 앞) + 그 호들(호 뒤 [표]·목 줄 포함). "lead" = 항의 첫 문장(긴 단서 생략)."""
    paras = {p["no"]: p["text"] for p in a.paragraphs} if a.paragraphs else {None: a.text}
    parts = []
    for no, items in spec:
        text = paras.get(no) if no in paras else (a.text if not a.paragraphs else None)
        if not text:
            continue
        if items == "lead":
            parts.append(re.split(r"(?<=다\.)\s", text.strip(), maxsplit=1)[0])
            continue
        if not items:
            parts.append(text.strip())
            continue
        starts = list(_ITEM_START.finditer(text))
        if not starts:
            parts.append(text.strip())
            continue
        keep = [text[: starts[0].start()].strip()]
        for i, m in enumerate(starts):
            if int(m.group(1)) in items:
                end = starts[i + 1].start() if i + 1 < len(starts) else len(text)
                keep.append(text[m.start(): end].strip())
        parts.append("\n".join(keep))
    return "\n".join(parts) if parts else None


def issue_picks(user_text: str, picks: list[Pick], st=None) -> list[Pick]:
    """쟁점별 조문(아직 블록에 없는 것) — LLM3 가 이미 고른 조문은 그 판(항 발췌 포함) 그대로 둔다."""
    if os.environ.get("ADVISORY_ISSUE_LAWS", "on") == "off":
        return []
    st = st or store()
    if st is None:
        return []
    have = {p.article.key for p in picks}
    out: list[Pick] = []
    for issue in issues(user_text):
        for law, no, spec in ISSUE_LAWS.get(issue, []):
            a = st.by_key.get((law, no))
            if a is None or a.key in have:
                continue
            ex = _excerpt(a, spec) if spec else a.text      # 전체도 excerpt 로 — 블록 머리에 법령 이름이 붙는다
            out.append(Pick(a, [], f"쟁점 {issue}", "쟁점", excerpt=ex))
            have.add(a.key)
    if out:
        log.info("쟁점별 조문 %s: %s", issues(user_text), [p.article.label() for p in out[:ISSUE_MAX]])
    return out[:ISSUE_MAX]


def _article_order(no: str) -> tuple[int, int]:
    num, _, sub = no.partition("의")
    return (int(num) if num.isdigit() else 9999, int(sub) if sub.isdigit() else 0)


LAW_BLOCK_HEADER = "[관련 법령 — 현행 조문 원문(2026년 시행 기준), 법령을 말할 때는 이 블록만]"
LAW_RULES = (
    "[법령 인용 규칙]\n"
    "- 법령(조문 번호)을 언급할 때는 **[관련 법령] 블록에 있는 조문만** 쓰고, 그 조문이 정하는 내용은 블록 원문대로 "
    "설명하세요. 원문에 없는 요건·금액·효과를 덧붙이지 마세요.\n"
    "- 조문은 매번 법령 이름과 함께 쓰세요(예: '상속세 및 증여세법 제41조의4', '소득세법 시행령 제118조의6'). "
    "'제41조의4는', '시행령 제5조' 처럼 이름을 빼지 마세요.\n"
    "- 심판례·국세청 해석 같은 사례 자료에 적힌 조문 번호는 **그 사건 당시 법** 기준이라 지금과 다를 수 있습니다. "
    "블록에 없는 조문 번호는 쓰지 말고, 사례는 근거 자료에 실제로 적힌 문서번호로만 언급하세요(근거 자료에 없는 문서번호를 만들거나 이 규칙의 예시를 옮기지 마세요).\n"
    "- 블록이 비어 있으면 조문 번호를 쓰지 마세요.\n"
    "- 사례 자료에 나온 금액·한도·세율은 그 사건 당시 기준입니다. [관련 법령] 원문과 다르면 **현행 원문 값을 쓰고**, "
    "필요하면 '당시에는 ~였다'고 구분해 밝히세요(예: 종부세 공제액).\n"
    "- 조문을 항마다 옮겨 적지 마세요. 질문에 답하는 데 필요한 요건·금액·절차만 골라 쉬운 말로 요약하고, "
    "같은 내용을 되풀이하지 마세요. 답 전체는 7문장 안팎으로.\n"
    "- 조문에 [표]가 있으면 표의 숫자가 답의 핵심입니다. 질문이 표의 값(세율·공제액·구간)을 묻는 경우 **표는 시스템이 원문 "
    "그대로 따로 붙이므로** 행을 다시 옮겨 적지 말고, 표를 어떻게 읽는지(누진 구조·초과분 적용 등)와 질문에 맞는 구간만 "
    "설명하세요. '세율은 구간별로 다르다', '표를 참고하라', '조문에 세율이 없다'처럼 숫자를 피하거나 표가 없다고 말하지 "
    "마세요(세무사 피드백 10/10: 세법은 숫자에 치중된 법)."
)


def law_block(picks: list[Pick], cap: int = ARTICLE_CHARS) -> str:
    if not picks:
        return LAW_BLOCK_HEADER + "\n(질문에 직접 맞는 조문을 찾지 못했습니다)\n\n" + LAW_RULES
    return LAW_BLOCK_HEADER + "\n" + "\n\n".join(f"- {_article_text(p, cap)}" for p in picks) + "\n\n" + LAW_RULES


@dataclass
class TableBlock:
    label: str              # "소득세법 제55조"
    title: str              # "세율"
    caption: str            # 표 바로 앞 줄(호 단위 표면 "1. 내국법인의 경우…")
    header: list[str]
    rows: list[list[str]]


def is_rate_title(title: Optional[str]) -> bool:
    """세율 조문 제목인가 — '영세율 첨부서류의 제출'(부가세 시행령 §101)은 아니다(10/13 로컬 X06 '법인세율'에 그 표가 붙었다)."""
    t = title or ""
    return "세율" in t and "영세율" not in t


def question_laws(user_text: str) -> list[str]:
    """질문에 이름이 나온 세법('법인세율' → 법인세법). 세율 보강이 질문과 다른 법의 표를 집지 않게 앞에 둔다."""
    st = store()
    if st is None:
        return []
    names = {lw for (lw, _) in st.by_key if "시행" not in lw}
    return sorted((n for n in names if n.endswith("법") and len(n) > 2 and n[:-1] in user_text), key=len, reverse=True)


def rate_article(laws: list[str]) -> Optional[Article]:
    """세율 질문 보강(F1, 10/12) — 주어진 법령들(순서대로)에서 제목에 '세율'이 든, 표가 있는 현행 조문 하나.
    LLM3 후보 검색은 근거 카드가 이미 다룬 법령을 빼고 찾아서(다양성) 카드가 법인세법 §13 을 들고 오면 같은 법의
    §55(세율)가 후보에도 못 든다(로컬 X06). 그래서 후보와 따로 저장소에서 직접 찾는다."""
    st = store()
    if st is None:
        return None
    for law in dict.fromkeys(laws):
        hits = [a for (lw, _), a in st.by_key.items() if lw == law and is_rate_title(a.title) and "[표]" in a.text]
        if hits:
            return sorted(hits, key=lambda a: (len(a.title or ""), a.no))[0]
    return None


def table_blocks(a: Article) -> list[TableBlock]:
    """조문 본문의 [표](scripts/law_tables_api.py 가 법령 API 원문에서 복원, F1 10/12) → 블록. 첫 행은 머리."""
    out: list[TableBlock] = []
    lines = a.text.split("\n")
    i = 0
    while i < len(lines):
        if lines[i].strip() == "[표]":
            caption = lines[i - 1].strip() if i > 0 else ""
            j, rows = i + 1, []
            while j < len(lines) and " | " in lines[j]:
                rows.append([c.strip() for c in lines[j].split(" | ")])
                j += 1
            if len(rows) >= 2:
                out.append(TableBlock(a.label(), a.title or "", caption, rows[0], rows[1:]))
            i = j
            continue
        i += 1
    return out


def strip_card_law_lines(passages: list) -> list:
    """LLM3 가 켜지면 심판례 카드의 '조문:' 줄은 프롬프트에서 뺀다 — 당시 법 번호를 옮겨 쓰는 통로였다.
    (질의회신 회신 본문 속 조문은 원문이라 남긴다. 사후 대조가 막는다.)"""
    out = []
    for p in passages or []:
        if p.content and _CARD_LAW_LINE.search(p.content):
            from dataclasses import replace

            out.append(replace(p, content=_CARD_LAW_LINE.sub("", p.content).rstrip()))
        else:
            out.append(p)
    return out


# ── ④ 사후 대조 ──────────────────────────────────────────────────────────────

@dataclass
class CheckReport:
    allowed: list[str]
    flagged: list[dict]     # {i, text, cites}
    dropped: int


def allowed_keys(picks: list[Pick], extra_texts: list[str]) -> set[tuple[str, str]]:
    keys = {p.article.key for p in picks}
    keys |= set(law_cite.keys(extra_texts))   # 엔진 근거·사용자 발화에 나온 조문
    return keys


def check_answer(raw: list[dict], allowed: set[tuple[str, str]], mode: Optional[str] = None,
                 keep_types: tuple[str, ...] = ("caveat",)) -> tuple[list[dict], CheckReport]:
    """세그먼트 dict 목록에서 허용 밖 법령을 인용한 문장을 찾는다. mode=drop 이면 그 문장을 뺀다
    (단 남는 문장이 없어지면 빼지 않는다 — 빈 답보다 낫다). 반환: (세그먼트, 보고)."""
    mode = mode or check_mode()
    # 모델이 도구의 citations 칸에 직접 적은 법령도 대조한다 — C48(10/8) '국세기본법 제63조의7'(실제는 시행령) 배지.
    # 법령으로 읽히는데 허용 밖인 항목만 뺀다(문서번호·사건번호는 그대로).
    cleaned = []
    for s in raw:
        cits = s.get("citations") or []
        keep = [c for c in cits if not (cs := law_cite.parse_cites(str(c))) or all(x.key in allowed for x in cs)]
        cleaned.append({**s, "citations": keep} if len(keep) != len(cits) else s)
    raw = cleaned
    per = law_cite.parse_answer([s.get("text") or "" for s in raw])
    flagged = []
    for i, (s, cs) in enumerate(zip(raw, per)):
        bad = [c.label() for c in cs if c.key not in allowed]
        if bad and s.get("type") not in keep_types:
            flagged.append({"i": i, "text": s.get("text"), "cites": bad})
    out = raw
    if mode == "drop" and flagged:
        drop = {f["i"] for f in flagged}
        kept = [s for i, s in enumerate(raw) if i not in drop]
        if kept:
            out = kept
        else:
            drop = set()
        if drop:
            log.info("법령 인용 대조: %d문장 제외 %s", len(drop), [f["cites"] for f in flagged])
    labels = sorted(f"{k[0]} 제{k[1].split('의')[0]}조" + (f"의{k[1].split('의')[1]}" if "의" in k[1] else "")
                    for k in allowed)
    return out, CheckReport(labels, flagged, len(raw) - len(out))


MAX_SEGMENTS = 8
NEAR_DUP = 0.38   # 10/8 실측: 반복 쌍 0.39~0.79 · 정상 답 문장 쌍 p97 0.35


_PAREN_CITE = re.compile(r"\([^()]*제\s?\d+\s?조[^()]*\)")


def _bigrams(t: str) -> set[str]:
    t = re.sub(r"\s+", "", t)
    return {t[i:i + 2] for i in range(len(t) - 1)}


def trim_answer(raw: list[dict], max_n: int = MAX_SEGMENTS) -> list[dict]:
    """거의 같은 문장 반복 제거 + 문장 수 상한(10/8) — 조문을 받으면 solar 가 같은 내용을 되풀이했다(C47 23문장,
    C42 같은 결론 5번). 프롬프트의 '7문장 안팎·반복 금지'는 안 따랐다. 글자 2-gram 겹침 ≥ NEAR_DUP 이면 앞 문장만 남기고,
    넘치면 앞에서 max_n 개 — 단 마지막 follow_up(되묻기)은 살린다."""
    kept, grams = [], []
    for s in raw:
        # 괄호 속 근거 조문은 겹침 계산에서 뺀다(A3 요건 목록 — 항목마다 같은 '(「○○법」 제N조제1항제K호)'가 붙어 짧은 항목끼리 반복으로 잡힌다)
        g = _bigrams(_PAREN_CITE.sub("", s.get("text") or ""))
        if g and any(len(g & h) / len(g | h) >= NEAR_DUP for h in grams):
            continue
        kept.append(s)
        grams.append(g)
    if len(kept) <= max_n:
        return kept
    tail = next((s for s in reversed(kept) if s.get("type") == "follow_up"), None)
    head = kept[:max_n]
    if tail is not None and tail not in head:
        head = head[: max_n - 1] + [tail]
    return head


_RATIO = re.compile(r"(\d+)\s*분의\s*(\d+(?:\.\d+)?)")


def numeric_view(text: str) -> str:
    """조문 비율 표기를 % 로 — '100분의 20' → '20%', '1천분의 5' → '0.5%'. numeric_guard 는 '20%' 만 출처로 알아본다
    (C37 10/7: 조문에 가산세율이 있는데 답의 '20%' 가 출처 없는 수치로 빠졌다)."""
    t = text.replace("1천분의", "1000분의").replace("1만분의", "10000분의")

    def conv(m: re.Match) -> str:
        den, num = float(m.group(1)), float(m.group(2))
        return f"{num * 100 / den:g}%" if den else m.group(0)
    return _RATIO.sub(conv, t)


_HO_LINE = re.compile(r"^(\d{1,2})\.\s*(.+)$", re.M)
ITEM_CHARS = 120


@dataclass
class ItemList:
    para: Optional[int]          # 항 번호(항이 없는 조문이면 None)
    lead: str                    # 항 본문 중 '각 호'를 부르는 문장(원문)
    items: list[tuple[int, str]]  # (호 번호, 호 원문 — 길면 첫 문장·ITEM_CHARS 에서 자름)


def item_list(a: Article, para: Optional[int] = None) -> Optional[ItemList]:
    """조문의 호 목록(A3 요건 형식의 결정론 폴백, 10/13) — para 를 주면 그 항, 아니면 호가 있는 첫 항. 호가 없으면 None."""
    blocks = [(p["no"], p["text"]) for p in a.paragraphs] if a.paragraphs else [(None, a.text)]
    if para is not None:
        blocks = [b for b in blocks if b[0] == para] or blocks
    for no, text in blocks:
        items = [(int(n), t.strip()) for n, t in _HO_LINE.findall(text) if not t.strip().startswith("삭제")]
        if len(items) < 2:
            continue
        head = text[:_HO_LINE.search(text).start()]
        sents = [s.strip() for s in re.split(r"(?<=다\.)\s+", head) if s.strip()]
        lead = next((s for s in sents if "각 호" in s), sents[-1] if sents else "")
        lead = re.sub(r"^(?:[①-⑳]\s*)?(?:다만,\s*)?", "", lead)

        def short(t: str) -> str:
            t = re.split(r"(?<=\.)\s*다만,", t)[0].strip()      # 호 안 단서(다만, …)는 뺀다 — 목록은 요건 본문만
            return t if len(t) <= ITEM_CHARS else t[:ITEM_CHARS].rstrip() + "…"
        return ItemList(no, lead, [(n, short(t)) for n, t in items])
    return None


def pick_labels(picks: list[Pick]) -> list[str]:
    """출처 배지용 — 고른 조문의 표시 이름(근거 카드 law_articles 대신)."""
    return [p.article.label() for p in picks]
