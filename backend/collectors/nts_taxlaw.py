"""
Collector: 국세법령정보시스템 판례 '요지' (KB3)

설계 마스터: design/KB3_요지수집_설계.md  (§3 경로 · §3-1 지킬 것 · §6 수령 기준)

  ① law.go.kr Open API 본문검색   GET /DRF/lawSearch.do  search=2
       → 데이터출처명 == "국세법령정보시스템" 만 남긴다
  ② law.go.kr 웹 판례 페이지      GET /LSW/precInfoP.do?precSeq=…   (302 Location 에서 ntstDcmId)
  ③ taxlaw 상세                   POST /action.do  actionId=ASIQTB002PR01
       → dcmDVO.ntstDcmGistCntn = 요지

taxlaw 통합검색(/is/USEISA001M.do·/is/USEISA003M.do)은 robots Disallow — 검색은 ① 로만 한다.
요청은 HttpClient 한 개로 순차(간격 config.REQUEST_DELAY 이상), 동시 요청 없음. 수집에 AI 호출 없음.

두 단계로 나뉜다.
  collect : ①②③ → raw jsonl (원문 보존, 이미 받은 precSeq 는 건너뜀 = 재개)
  build   : raw → processed/kb3_gist.jsonl + 계측 (재수집 없이 몇 번이고 다시 만든다)

사용:
  python -m collectors.nts_taxlaw collect --keywords 병의원 연말정산 "1세대 1주택 비과세" 증여세 --per-keyword 5
  python -m collectors.nts_taxlaw build --sample-md data/processed/kb3_pilot_sample.md
"""

import argparse
import glob
import json
import logging
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
import config
from collectors.http_client import HttpClient
from collectors.schema import TaxCase

logger = logging.getLogger(__name__)

SEARCH_URL = "https://www.law.go.kr/DRF/lawSearch.do"
LINK_URL = "https://www.law.go.kr/LSW/precInfoP.do"
ACTION_URL = "https://taxlaw.nts.go.kr/action.do"
ACTION_ID = "ASIQTB002PR01"
SOURCE_NAME = "국세법령정보시스템"
PERMALINK = "https://taxlaw.nts.go.kr/pd/USEPDA002P.do?ntstDcmId={}"

RAW_GLOB = "nts_taxlaw_2*.jsonl"          # 문서 원문 (search 로그와 구분)
SEARCH_GLOB = "nts_taxlaw_search_*.jsonl"  # ① 검색에서 본 출처통과 항목

GIST_MIN_LEN = 20  # §6: 요지 20자 이상

# ntstTlawClCd(세목 코드) → 세법. 수집본(9/25, 489건)의 제목·관련 법령으로 읽어낸 것만 넣는다.
# 모르는 코드·999(기타)는 관련 법령 이름으로 보조 판정(_LAW_TO_TAX).
_CODE_TO_TAX = {
    "210": "조세범처벌",   # 현금영수증 과태료·포탈
    "301": "국세기본",     # 송달·가산세 감면·국가배상 등
    "302": "국세징수",     # 사해행위취소·배당이의 등 국가 원고 민사
    "303": "법인세",
    "305": "소득세",       # 종합소득(근로·사업), 연말정산 포함
    "306": "부가가치세",
    "307": "소득세",       # 양도소득 — 1세대 1주택·농지 감면(조특법) 포함
    "308": "상속세및증여세",
    "311": "종합부동산세",
    "312": "소득세",       # 근로·퇴직소득(원천) — 복지포인트 등
}

# 관련 법령 이름 → 세법. 앞에서부터 처음 맞는 것.
_LAW_TO_TAX = [
    ("부가가치세법", "부가가치세"),
    ("상속세", "상속세및증여세"),        # 상속세 및 증여세법(시행령)
    ("소득세법", "소득세"),
    ("법인세법", "법인세"),
    ("조세특례제한법", "조세특례"),
    ("국세기본법", "국세기본"),
    ("국세징수법", "국세징수"),
    ("지방세", "지방세"),
    ("종합부동산세법", "종합부동산세"),
    ("국제조세", "국제조세"),
]

# 세법 → 우리 17개 세목(api/rag/taxonomy.py). 17개는 병의원 지출 관점이라
# 시민 질문 세법(양도·연말정산 등)은 소득세 버킷, 나머지는 '기타'.
_TAX_TO_CATEGORY = {
    "부가가치세": "부가가치세",
    "상속세및증여세": "상속·증여",
    "소득세": "소득세·법인전환·개원폐업",
}


def _clean(s: str) -> str:
    """요지·제목에 섞인 <br /> 등 태그와 줄바꿈을 한 칸 공백으로."""
    s = re.sub(r"<[^>]+>", " ", s or "")
    return re.sub(r"\s+", " ", s).strip()


def _norm(s: str) -> str:
    return re.sub(r"\s+", "", s or "")


def keyword_hit(keyword: str, text: str) -> bool:
    """키워드의 모든 어절이 (공백 무시) 텍스트에 들어 있나."""
    t = _norm(text)
    return all(_norm(tok) in t for tok in keyword.split())


def _as_list(x) -> list:
    if x is None:
        return []
    return x if isinstance(x, list) else [x]


# ── collect ──────────────────────────────────────────────────────────────────

class NtsTaxlawCollector:
    def __init__(self, raw_dir: str = config.RAW_DIR, delay: float = 1.5):
        # §3-1: 요청 간 1~2초
        self.client = HttpClient(delay=max(delay, config.REQUEST_DELAY), ssl_verify=config.SSL_VERIFY)
        self.oc = config.LAW_OC_KEY
        self.raw_dir = raw_dir
        stamp = datetime.now().strftime("%Y%m%d")
        self.raw_path = os.path.join(raw_dir, f"nts_taxlaw_{stamp}.jsonl")
        self.search_path = os.path.join(raw_dir, f"nts_taxlaw_search_{stamp}.jsonl")

    def _done(self) -> dict[str, str]:
        """이미 받은 precSeq → 받을 때의 키워드 (raw 전체)."""
        done = {}
        for p in glob.glob(os.path.join(self.raw_dir, RAW_GLOB)):
            with open(p, encoding="utf-8") as f:
                for line in f:
                    if line.strip():
                        r = json.loads(line)
                        done[r["precSeq"]] = r["keyword"]
        return done

    # ①
    def search(self, keyword: str, max_pages: int) -> tuple[int, int, list[dict]]:
        """(검색 총건수, 스캔 건수, 출처 통과 항목) — 결과는 선고일자 내림차순."""
        total, scanned, items = 0, 0, []
        for page in range(1, max_pages + 1):
            data = self.client.get_json(SEARCH_URL, params={
                "OC": self.oc, "target": "prec", "type": "JSON", "search": 2,
                "query": keyword, "display": 100, "page": page,
            }, encoding="utf-8")
            ps = data.get("PrecSearch", {})
            total = int(ps.get("totalCnt") or 0)
            rows = _as_list(ps.get("prec"))
            scanned += len(rows)
            for r in rows:
                if r.get("데이터출처명") == SOURCE_NAME:
                    items.append({
                        "precSeq": r.get("판례일련번호", ""),
                        "사건번호": r.get("사건번호", ""),
                        "사건명": r.get("사건명", ""),
                        "선고일자": r.get("선고일자", ""),
                    })
            if not rows or page * 100 >= total:
                break
        return total, scanned, items

    # ②
    def resolve_dcm_id(self, prec_seq: str) -> tuple[str, str]:
        loc = self.client.get_location(LINK_URL, params={"precSeq": prec_seq})
        m = re.search(r"ntstDcmId=(\d+)", loc)
        return (m.group(1) if m else ""), loc

    # ③
    def fetch_doc(self, dcm_id: str) -> dict:
        text = self.client.post(ACTION_URL, data={
            "actionId": ACTION_ID,
            "paramData": json.dumps({"dcmDVO": {"ntstDcmId": dcm_id}}),
        }, encoding="utf-8")
        return json.loads(text)

    def collect(self, keywords: list[str], per_keyword: int, total_cap: int, max_pages: int) -> list[dict]:
        os.makedirs(self.raw_dir, exist_ok=True)
        # 상한은 raw 누적 기준 — 실행 인자(--max-pages 등)가 바뀌어 순위가 달라져도 더 받지 않는다
        done = self._done()
        per_kw_done = Counter(done.values())
        owned: dict[str, str] = {}  # precSeq → 이번 실행에서 먼저 잡은 키워드
        fetched_total = len(done)
        stats = []

        for kw in keywords:
            st = Counter()
            st_row = {"keyword": kw}
            try:
                total, scanned, items = self.search(kw, max_pages)
            except Exception as exc:
                logger.error("[nts_taxlaw] search failed kw=%s: %s", kw, exc)
                stats.append({**st_row, "search_error": str(exc)})
                continue

            for it in items:
                it["title_hit"] = keyword_hit(kw, it["사건명"])
            with open(self.search_path, "a", encoding="utf-8") as f:
                for it in items:
                    f.write(json.dumps({"keyword": kw, **it}, ensure_ascii=False) + "\n")

            # 제목에 키워드가 든 건 먼저(검색이 날짜순이라 관련성 순위가 없다), 그다음 최신순
            ranked = sorted(items, key=lambda it: not it["title_hit"])
            st.update(total=total, scanned=scanned, nts=len(items),
                      title_hit=sum(it["title_hit"] for it in items))

            taken = per_kw_done[kw]
            for it in ranked:
                if taken >= per_keyword or fetched_total >= total_cap:
                    break
                seq = it["precSeq"]
                if seq in owned:
                    st["dup_other_kw"] += 1
                    continue
                owned[seq] = kw
                if seq in done:  # 이미 받음 — 상한에는 per_kw_done 으로 이미 들어가 있다
                    st["resumed_skip"] += 1
                    continue
                taken += 1
                try:
                    dcm_id, loc = self.resolve_dcm_id(seq)
                except Exception as exc:
                    logger.warning("[nts_taxlaw] ② failed precSeq=%s: %s", seq, exc)
                    st["link_fail"] += 1
                    continue
                if not dcm_id:
                    logger.warning("[nts_taxlaw] ② no ntstDcmId precSeq=%s loc=%r", seq, loc)
                    st["link_fail"] += 1
                    continue
                try:
                    resp = self.fetch_doc(dcm_id)
                except Exception as exc:
                    logger.warning("[nts_taxlaw] ③ failed id=%s: %s", dcm_id, exc)
                    st["doc_fail"] += 1
                    continue
                body = (resp.get("data") or {}).get(ACTION_ID) or {}
                dvo = body.get("dcmDVO")
                if resp.get("status") != "SUCCESS" or not dvo:
                    logger.warning("[nts_taxlaw] ③ status=%s id=%s", resp.get("status"), dcm_id)
                    st["doc_fail"] += 1
                    continue
                rec = {
                    "keyword": kw, "precSeq": seq, "ntstDcmId": dcm_id, "location": loc,
                    "search_item": it, "fetched_at": datetime.now().isoformat(timespec="seconds"),
                    "dcmDVO": dvo, "dcmRltnStttList": body.get("dcmRltnStttList"),
                }
                with open(self.raw_path, "a", encoding="utf-8") as f:
                    f.write(json.dumps(rec, ensure_ascii=False) + "\n")
                done[seq] = kw
                fetched_total += 1
                st["ok"] += 1
                gist = (dvo.get("ntstDcmGistCntn") or "").strip()
                if len(gist) < GIST_MIN_LEN:
                    st["gist_short"] += 1
                logger.info("[nts_taxlaw] %s | %s | %s", kw, dvo.get("ntstDcmDscmCntn"), gist[:40])

            stats.append({**st_row, **st})
        return stats


# ── build ────────────────────────────────────────────────────────────────────

def _court(case_no: str) -> str:
    return case_no.split("-", 1)[0] if "-" in case_no else ""


def _date(raw: str) -> str:
    raw = (raw or "").strip()
    m = re.fullmatch(r"(\d{4})\.(\d{2})\.(\d{2})", raw) or re.fullmatch(r"(\d{4})(\d{2})(\d{2})", raw)
    return "-".join(m.groups()) if m else raw


NEAR_DUP_JACCARD = 0.6  # 요지 글자 2-gram 자카드 — 같은 쟁점의 1심·2심·심리불속행 사슬


def _bigrams(s: str) -> set[str]:
    s = _norm(s)
    return {s[i:i + 2] for i in range(len(s) - 1)}


def _jaccard(a: set, b: set) -> float:
    return len(a & b) / len(a | b) if a and b else 0.0


def tax_law_of(code: str, statutes: list[str]) -> str:
    if code in _CODE_TO_TAX:
        return _CODE_TO_TAX[code]
    for s in statutes:
        for needle, tax in _LAW_TO_TAX:
            if needle in s:
                return tax
    return ""


def build(raw_dir: str = config.RAW_DIR, out_path: str | None = None,
          existing_path: str | None = None) -> tuple[list[dict], dict]:
    out_path = out_path or os.path.join(config.PROCESSED_DIR, "kb3_gist.jsonl")

    kw_of: dict[str, list[str]] = defaultdict(list)
    for p in sorted(glob.glob(os.path.join(raw_dir, SEARCH_GLOB))):
        with open(p, encoding="utf-8") as f:
            for line in f:
                if line.strip():
                    r = json.loads(line)
                    if r["keyword"] not in kw_of[r["precSeq"]]:
                        kw_of[r["precSeq"]].append(r["keyword"])

    records, seen_case = [], set()
    dup_case = 0
    for p in sorted(glob.glob(os.path.join(raw_dir, RAW_GLOB))):
        with open(p, encoding="utf-8") as f:
            for line in f:
                if not line.strip():
                    continue
                raw = json.loads(line)
                dvo = raw["dcmDVO"]
                case_no = (dvo.get("ntstDcmDscmCntn") or "").strip()
                if case_no in seen_case:
                    dup_case += 1
                    continue
                seen_case.add(case_no)
                statutes = [s["ntstTextNm"].strip() for s in _as_list(raw.get("dcmRltnStttList"))
                            if (s.get("ntstTextNm") or "").strip()]
                tax_law = tax_law_of((dvo.get("ntstTlawClCd") or "").strip(), statutes)
                gist = _clean(dvo.get("ntstDcmGistCntn"))
                case = TaxCase(
                    case_id=f"nts_taxlaw_{case_no}",
                    source="nts_taxlaw",
                    # ② 가 준 실제 주소(파일럿 20/20 이 /qt/) — 없을 때만 /pd/ 고정 링크
                    source_url=(raw["location"] if "taxlaw.nts.go.kr" in raw.get("location", "")
                                else PERMALINK.format(raw["ntstDcmId"])),
                    case_number=case_no,
                    title=_clean(dvo.get("ntstDcmTtl")),
                    tax_category=_TAX_TO_CATEGORY.get(tax_law, "기타" if tax_law else "미분류"),
                    law_articles=statutes,
                    decision_date=_date(raw["search_item"].get("선고일자", "")),
                    decision_type=None,
                    agency=_court(case_no),
                    summary=gist,
                    full_text="",  # 전문은 받지 않는다(§2)
                    inquiry_agency=None,
                    tags=(dvo.get("ntstDcmMatrCntn") or "").split(";") if dvo.get("ntstDcmMatrCntn") else [],
                    collected_at=raw["fetched_at"],
                )
                kws = kw_of.get(raw["precSeq"]) or [raw["keyword"]]
                records.append({
                    **case.to_dict(),
                    "ntst_dcm_id": raw["ntstDcmId"],
                    "prec_seq": raw["precSeq"],
                    "tax_law": tax_law,
                    "tax_law_code": (dvo.get("ntstTlawClCd") or "").strip(),
                    "attr_year": (dvo.get("attrYr") or "").strip(),
                    "lower_case_number": (dvo.get("ntstPrdgHpnnNoCntn") or "").strip() or None,
                    "keywords": kws,
                    "keyword": raw["keyword"],
                    "gist_keyword_hit": keyword_hit(raw["keyword"], case.title + " " + gist),
                })

    # 근사 중복은 표시만(파일럿) — 제거 여부는 세무사 확인 뒤 정한다
    grams = [_bigrams(r["summary"]) for r in records]
    for i, r in enumerate(records):
        r["near_dup_of"] = next(
            (records[j]["case_number"] for j in range(i) if _jaccard(grams[i], grams[j]) >= NEAR_DUP_JACCARD),
            None)

    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        for r in records:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")

    n = len(records) or 1
    existing = set()
    if existing_path and os.path.exists(existing_path):
        with open(existing_path, encoding="utf-8") as f:
            existing = {_norm(json.loads(l).get("case_number", "")) for l in f if l.strip()}
    metrics = {
        "records": len(records),
        "dup_case_number": dup_case,
        "gist_ge_20": sum(len(r["summary"]) >= GIST_MIN_LEN for r in records) / n,
        "case_no_and_link": sum(bool(r["case_number"]) and bool(r["source_url"]) for r in records) / n,
        "category_mapped": sum(r["tax_category"] != "미분류" for r in records) / n,
        "category_not_other": sum(r["tax_category"] not in ("미분류", "기타") for r in records) / n,
        "statute_filled": sum(bool(r["law_articles"]) for r in records) / n,
        "gist_keyword_hit": sum(r["gist_keyword_hit"] for r in records) / n,
        "near_dup": sum(r["near_dup_of"] is not None for r in records),
        "overlap_existing": sum(_norm(r["case_number"]) in existing for r in records),
        "tax_law": dict(Counter(r["tax_law"] or "(없음)" for r in records)),
        "tax_law_code": dict(Counter(f'{r["tax_law_code"]}:{r["tax_law"] or "?"}' for r in records)),
        "category": dict(Counter(r["tax_category"] for r in records)),
    }
    return records, metrics


def sample_markdown(records: list[dict]) -> str:
    lines = [
        "| # | 키워드 | 사건번호 | 제목 | 요지 | 세목 | 관련 법령 | 근사중복 | 링크 |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    esc = lambda s: (s or "").replace("|", "\\|").replace("\n", " ")
    for i, r in enumerate(records, 1):
        lines.append(
            f"| {i} | {esc(r['keyword'])} | {esc(r['case_number'])} | {esc(r['title'])} | {esc(r['summary'])} "
            f"| {esc(r['tax_category'])} ({esc(r['tax_law'] or '-')}) | {esc(', '.join(r['law_articles'][:3]))} "
            f"| {esc(r['near_dup_of'] or '')} | [원문]({r['source_url']}) |"
        )
    return "\n".join(lines) + "\n"


def _print_collect_stats(stats: list[dict]):
    cols = ["keyword", "total", "scanned", "nts", "title_hit", "ok", "resumed_skip",
            "link_fail", "doc_fail", "gist_short", "dup_other_kw"]
    print("| " + " | ".join(cols) + " |")
    print("|" + "---|" * len(cols))
    for s in stats:
        print("| " + " | ".join(str(s.get(c, 0)) for c in cols) + " |")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    ap = argparse.ArgumentParser(description="KB3 요지 수집 (국세법령정보시스템)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    c = sub.add_parser("collect")
    c.add_argument("--keywords", nargs="+", required=True)
    c.add_argument("--per-keyword", type=int, default=30)
    c.add_argument("--total-cap", type=int, default=500)
    c.add_argument("--max-pages", type=int, default=5, help="키워드당 ① 검색 페이지(100건/쪽) 상한")
    c.add_argument("--delay", type=float, default=1.5)
    b = sub.add_parser("build")
    b.add_argument("--sample-md", default=None)
    args = ap.parse_args()

    if args.cmd == "collect":
        stats = NtsTaxlawCollector(delay=args.delay).collect(
            args.keywords, args.per_keyword, args.total_cap, args.max_pages)
        _print_collect_stats(stats)
    else:
        records, metrics = build(existing_path=os.path.join(config.PROCESSED_DIR, "all_cases.jsonl"))
        print(json.dumps(metrics, ensure_ascii=False, indent=2))
        if args.sample_md:
            with open(args.sample_md, "w", encoding="utf-8") as f:
                f.write(sample_markdown(records))
            print("sample →", args.sample_md)


if __name__ == "__main__":
    main()
