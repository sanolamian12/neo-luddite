r"""
법령 DB(LLM3 용) 1단계 — 국가법령정보센터 PDF → 조 단위 JSONL (2026-10-07)

원천: 저장소 루트 `네오러다이트 법령/<법>/<법령명>(<종류>)(<번호>)(<시행일>).pdf` (git 제외)
      법제처 PDF 는 텍스트 PDF 라 OCR 불필요. 본문 = 원문 그대로(가공·요약 없음 — 트랙 규칙상
      요약이 필요하면 Solar 로 따로 만든다).

산출: backend/data/laws/articles.jsonl — 한 줄 = 한 조(같은 조의 시행 예정본은 별도 줄)
      키 = (law_name, article_no) 예: ("국세기본법", "81의7"). 항(①…) 은 paragraphs 로 따로 둬서
      "법령명+조+항" 정확 조회가 된다.

파싱 규칙 (법제처 PDF 실측):
  · 매 쪽 머리 2줄 = "법제처 N 국가법령정보센터" + 법령명 → 버림
  · 조 머리 = 줄 첫머리 `제N조(의M)(제목)` 또는 `제N조(의M) 삭제` — 본문 속 "제45조의2에 따른"은
    괄호 제목이 없어 걸리지 않는다. 그래도 번호가 뒤로 가면 본문으로 본다(단조 증가 검사).
  · 시행 예정본 = 조 끝에 `[시행일: YYYY. M. D.] 제N조` 표시. 같은 조가 두 번 나오면 표시 있는 쪽이
    예정본(effective_from), 없는 쪽이 현행본. 한 번만 나오고 표시가 있으면 일부 항만 예정(note).
  · 부칙(`부칙 <…>`)부터는 버린다 — 별표·서식도 그 뒤라 함께 빠진다(파일럿 범위 밖).
  · 줄 이어붙이기: 법제처 PDF 는 글자 단위로 줄을 바꾸므로 기본 붙임, 문장부호 뒤만 한 칸.

사용 (PyMuPDF 필요 — backend/.venv 에는 없으므로 시스템 파이썬):
    python backend/scripts/law_pdf_parse.py                       # 전체 37개
    python backend/scripts/law_pdf_parse.py --laws 국세기본법 소득세법
    python backend/scripts/law_pdf_parse.py --report             # 파싱 품질 표만
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import fitz  # PyMuPDF

_BACKEND = Path(__file__).resolve().parents[1]
SRC_DIR = _BACKEND.parent / "네오러다이트 법령"
OUT_PATH = _BACKEND / "data" / "laws" / "articles.jsonl"

FNAME_RE = re.compile(r"^(?P<name>.+?)\((?P<kind>[^()]+)\)\((?P<no>제[^()]+호)\)\((?P<date>\d{8})\)\.pdf$")
PAGE_HEAD_RE = re.compile(r"^\s*법제처\s+\d+\s+국가법령정보센터\s*$")
META_RE = re.compile(r"\[시행\s*(?P<eff>[\d.\s]+?)\.?\]\s*\[(?P<prom>[^\]]+)\]")
ADDENDA_RE = re.compile(r"^\s*부\s*칙\s*<")
HEADING_RE = re.compile(r"^\s*제(\d+)(편|장|절|관)(의\d+)?\s+(.+)$")
ARTICLE_HEAD_RE = re.compile(r"^제(?P<num>\d+)조(?:의(?P<sub>\d+))?(?P<rest>.*)$")
FUTURE_RE = re.compile(r"^\[시행일\s*:\s*(?P<date>\d{4}\.\s*\d{1,2}\.\s*\d{1,2}\.?)\]\s*(?P<target>.*)$")
# ①~⑳ ㉑~㉟ ㊱~㊿
CIRCLED = "".join(chr(c) for c in list(range(0x2460, 0x2474)) + list(range(0x3251, 0x3260)) + list(range(0x32B1, 0x32C0)))
PARA_RE = re.compile(f"(?=[{CIRCLED}])")
AMEND_ANGLE_RE = re.compile(r"<(?:개정|신설|삭제|전문개정|타법개정|본조신설)[^<>]*>")
AMEND_BRACKET_RE = re.compile(
    r"\[(?:전문개정|본조신설|제목개정|제목신설|종전[^\]]*|[^\]]*(?:이동|본조신설)[^\]]*|법률\s*제\d+호[^\]]*|시행일[^\]]*)\]"
)
# 줄을 새 줄로 시작할 신호(이어붙이지 않음)
NEWLINE_LEAD_RE = re.compile(f"^(?:[{CIRCLED}]|\\d+(?:의\\d+)?\\.\\s|[가-하]\\.\\s|\\[|<|※)")
KIND_ORDER = {"법률": 0, "대통령령": 1}


def _split_title(rest: str) -> tuple[str | None, str] | None:
    """`(제목) 본문` → (제목, 본문). 괄호 균형을 본다(제목 안 괄호 허용). 머리가 아니면 None."""
    s = rest
    if s.startswith(" 삭제") or s.startswith("삭제"):
        return None, s.strip()
    if s.startswith("["):  # 제목에 괄호가 든 조는 [제목] 으로 쓰고 뒤에 공백이 없다(민법 §50)
        j = s.find("]")
        return (s[1:j].strip(), s[j + 1 :].strip()) if j > 0 else None
    if not s.startswith("("):
        return None
    depth = 0
    for i, ch in enumerate(s):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                title, body = s[1:i], s[i + 1 :]
                # "제12조(…)에 따른" 같은 본문 인용 배제: 제목 뒤는 공백·끝·문장 시작이어야
                if body and not body.startswith(" "):
                    return None
                return title.strip(), body.strip()
    return None


def _art_key(num: int, sub: int | None) -> tuple[int, int]:
    return (num, sub or 0)


def _art_no(num: int, sub: int | None) -> str:
    return f"{num}의{sub}" if sub else str(num)


def _join_lines(lines: list[str]) -> str:
    out = ""
    for ln in lines:
        ln = ln.strip()
        if not ln:
            continue
        if not out:
            out = ln
        elif NEWLINE_LEAD_RE.match(ln):
            out += "\n" + ln
        elif out[-1] in ",.)」』>]:;":
            out += " " + ln
        else:
            out += ln
    return out


def _clean(text: str) -> str:
    """개정 이력 표시를 걷어낸 검색·임베딩용 본문(원문 raw 는 따로 보관)."""
    t = AMEND_ANGLE_RE.sub("", text)
    t = AMEND_BRACKET_RE.sub("", t)
    t = re.sub(r"[ \t]+", " ", t)
    t = re.sub(r" *\n *", "\n", t)
    t = re.sub(r"\n{2,}", "\n", t)
    return t.strip()


def _paragraphs(clean_body: str) -> list[dict]:
    parts = [p.strip() for p in PARA_RE.split(clean_body) if p.strip()]
    if len(parts) <= 1 and not (parts and parts[0][0] in CIRCLED):
        return []
    paras = []
    for p in parts:
        if p[0] in CIRCLED:
            paras.append({"no": CIRCLED.index(p[0]) + 1, "text": p})
        elif paras:
            paras[-1]["text"] += "\n" + p
    return paras


def parse_pdf(path: Path) -> tuple[dict, list[dict], dict]:
    m = FNAME_RE.match(path.name)
    if not m:
        raise ValueError(f"파일명 규칙 밖: {path.name}")
    doc_name, kind = m["name"].strip(), m["kind"]
    pdf = fitz.open(path)
    lines: list[str] = []
    for page in pdf:
        pl = page.get_text().split("\n")
        # 쪽 머리: 법제처 줄 + 법령명 줄
        if pl and PAGE_HEAD_RE.match(pl[0]):
            pl = pl[1:]
            if pl and pl[0].strip() == doc_name:
                pl = pl[1:]
        lines.extend(pl)

    head_text = "\n".join(lines[:12])
    mm = META_RE.search(head_text)
    meta = {
        "law_name": doc_name,
        "kind": kind,  # 법률 / 대통령령 / 재정경제부령 / 행정안전부령
        "law_no": m["no"],
        "effective": mm["eff"].strip().rstrip(".") if mm else None,
        "promulgation": mm["prom"].strip() if mm else None,
        "source_file": f"{path.parent.name}/{path.name}",
        "parent_law": re.sub(r"\s*시행(령|규칙)$", "", doc_name),
    }

    # 제목이 줄을 넘어간 조 머리는 다음 줄과 합친다(조특령 §57 제목이 "…과세특" / "례) ①" 로 갈림)
    merged: list[str] = []
    for raw in lines:
        prev = merged[-1].strip() if merged else ""
        if ARTICLE_HEAD_RE.match(prev) and prev.count("(") > prev.count(")") and re.match(r"^제\d+조(의\d+)?\(", prev):
            merged[-1] = prev + raw.strip()
        else:
            merged.append(raw)
    lines = merged

    blocks: list[dict] = []
    heading = {"편": None, "장": None, "절": None, "관": None}
    cur: dict | None = None
    last_key = (0, 0)
    stats = {"rejected_heads": 0}
    for raw in lines:
        if ADDENDA_RE.match(raw):
            break
        s = raw.strip()
        hm = HEADING_RE.match(s)
        if hm and len(s) < 60 and "조" not in s.split()[0]:
            level = hm[2]
            heading[level] = re.sub(AMEND_ANGLE_RE, "", s).strip()
            for lv in {"편": ["장", "절", "관"], "장": ["절", "관"], "절": ["관"], "관": []}[level]:
                heading[lv] = None
            continue
        am = ARTICLE_HEAD_RE.match(s)
        if am:
            split = _split_title(am["rest"])
            num, sub = int(am["num"]), int(am["sub"]) if am["sub"] else None
            key = _art_key(num, sub)
            if split is not None and key >= last_key:
                title, first = split
                cur = {
                    "num": num,
                    "sub": sub,
                    "title": title,
                    "deleted": title is None and first.startswith("삭제"),
                    "heading": " > ".join(v for v in heading.values() if v),
                    "lines": [first] if first else [],
                }
                blocks.append(cur)
                last_key = key
                continue
            if split is not None:
                stats["rejected_heads"] += 1
        if cur is not None:
            cur["lines"].append(raw)

    # 블록 → 레코드, 시행 예정본 가르기
    seen: dict[str, int] = {}
    for b in blocks:
        no = _art_no(b["num"], b["sub"])
        seen[no] = seen.get(no, 0) + 1
    records = []
    for b in blocks:
        no = _art_no(b["num"], b["sub"])
        raw_body = _join_lines(b["lines"])
        future = None
        for ln in raw_body.split("\n"):
            fm = FUTURE_RE.match(ln.strip())
            if fm:
                future = {"date": re.sub(r"\s+", "", fm["date"]).rstrip("."), "target": fm["target"].strip()}
        version, note = "current", None
        if future and seen[no] > 1:
            version = "future"
        elif future:
            note = f"일부 시행일 미도래 {future['date']}: {future['target']}"
        body = _clean(raw_body)
        label = f"제{b['num']}조" + (f"의{b['sub']}" if b["sub"] else "")
        head = label + (f"({b['title']})" if b["title"] else "")
        records.append(
            {
                "id": f"{meta['law_name']}|{no}|{version}",
                "law_name": meta["law_name"],
                "parent_law": meta["parent_law"],
                "kind": meta["kind"],
                "law_no": meta["law_no"],
                "law_effective": meta["effective"],
                "article_no": no,
                "article_num": b["num"],
                "article_sub": b["sub"] or 0,
                "title": b["title"],
                "heading": b["heading"],
                "deleted": b["deleted"],
                "version": version,
                "effective_from": future["date"] if version == "future" else None,
                "note": note,
                "text": f"{head} {body}".strip(),
                "paragraphs": _paragraphs(body),
                "raw": raw_body,
                "source_file": meta["source_file"],
            }
        )
    ids = [r["id"] for r in records]
    stats.update(
        articles=len(records),
        deleted=sum(r["deleted"] for r in records),
        future=sum(r["version"] == "future" for r in records),
        partial_future=sum(bool(r["note"]) for r in records),
        dup_ids=len(ids) - len(set(ids)),
        gaps=_gaps(blocks),
        empty=sum(1 for r in records if not r["deleted"] and len(r["text"]) < 20),
    )
    return meta, records, stats


def _gaps(blocks: list[dict]) -> list[str]:
    """본조 번호(의N 제외)가 건너뛴 자리 — 파싱 누락 의심 위치."""
    nums = sorted({b["num"] for b in blocks})
    if not nums:
        return []
    return [str(n) for n in range(nums[0], nums[-1] + 1) if n not in set(nums)]


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    ap.add_argument("--laws", nargs="*", help="법 폴더명(예: 국세기본법). 생략 = 전체")
    ap.add_argument("--report", action="store_true", help="파일 쓰지 않고 품질 표만")
    a = ap.parse_args()
    folders = sorted(p for p in SRC_DIR.iterdir() if p.is_dir())
    if a.laws:
        folders = [p for p in folders if p.name in set(a.laws)]
    all_recs = []
    print(f"{'파일':<44} {'조':>5} {'삭제':>4} {'예정':>4} {'부분':>4} {'빈':>3} {'거부':>4}  번호빈칸")
    for folder in folders:
        pdfs = sorted(folder.glob("*.pdf"), key=lambda p: KIND_ORDER.get(FNAME_RE.match(p.name)["kind"], 2) if FNAME_RE.match(p.name) else 9)
        for pdf in pdfs:
            meta, recs, st = parse_pdf(pdf)
            all_recs.extend(recs)
            gaps = ",".join(st["gaps"][:8]) + ("…" if len(st["gaps"]) > 8 else "")
            print(
                f"{meta['law_name'][:22]:<24}{meta['kind'][:8]:<10}{meta['effective'] or '?':<12}"
                f"{st['articles']:>5} {st['deleted']:>4} {st['future']:>4} {st['partial_future']:>4} {st['empty']:>3} {st['rejected_heads']:>4}  {gaps}"
            )
    print(f"\n합계 {len(all_recs)}조 (현행 {sum(r['version']=='current' for r in all_recs)})")
    if not a.report:
        OUT_PATH.parent.mkdir(parents=True, exist_ok=True)
        with OUT_PATH.open("w", encoding="utf-8") as f:
            for r in all_recs:
                f.write(json.dumps(r, ensure_ascii=False) + "\n")
        print(f"→ {OUT_PATH}")


if __name__ == "__main__":
    main()
