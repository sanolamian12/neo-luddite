r"""
법령 표 복원 (F1, 2026-10-12) — 법제처 PDF 의 표는 **이미지**라 텍스트 추출(law_pdf_parse.py)에서 통째로 빠졌다.
국가법령정보센터 Open API(lawService, target=law) 본문에는 같은 표가 상자 문자(┌─┬…┘)로 **원문 텍스트**로 들어 있다
(트랙 규칙: 법령 원문 그대로 — 가공은 행·칸 정리뿐). 그 표를 articles.jsonl 의 해당 항·호 줄 바로 뒤에 넣는다.

발견 경위: R2-a(소득세법 §47·§55·§59 표가 laws.articles 에 없음) → 세무사 Q1(10/10 밤, "종합소득세율 알려주세요")에
세율 숫자 없이 답하고 X05 재현(10/12)에서는 "현행 조문에는 구체적인 세율표가 포함되어 있지 않으므로"라고 틀린 말까지 했다.

규칙:
  · 공포번호가 같은 판만 반영한다(API 본문 = 우리 PDF 와 같은 법령). 다르면 보고만 하고 건너뛴다.
  · 위치: 표 앞 문장(항·호 내용)의 첫 15자(공백 제거)가 든 줄 바로 뒤. 못 찾으면 조문 끝.
  · 표 형식: "[표]" 줄 + 행마다 "칸 | 칸". 칸 안 줄바꿈(긴 칸)은 한 칸으로 이어 붙인다.
  · 쟁점 한 줄(gists.json, 키 = 본문 sha1)은 옛 본문 키에서 새 본문 키로 옮긴다 — 표가 붙어도 조문의 쟁점은 같다
    (Solar 재생성 없음). 임베딩은 본문이 바뀌었으니 `law_ingest.py embed` 로 바뀐 조문만 다시 만든다.

사용 (backend/ 에서):
    .\.venv\Scripts\python.exe scripts\law_tables_api.py fetch            # API 본문 캐시(data/laws/api_cache/)
    .\.venv\Scripts\python.exe scripts\law_tables_api.py apply --dry-run  # 보고만
    .\.venv\Scripts\python.exe scripts\law_tables_api.py apply            # articles.jsonl·gists.json 갱신
그 뒤: law_ingest.py embed → law_ingest.py ingest(운영 DB — 사용자 터미널) → 서버 재시작(메모리 벡터).
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
import time
import types
from pathlib import Path

_BACKEND = Path(__file__).resolve().parents[1]
if str(_BACKEND) not in sys.path:
    sys.path.insert(0, str(_BACKEND))

DATA = _BACKEND / "data" / "laws"
ARTICLES = DATA / "articles.jsonl"
GISTS = DATA / "gists.json"
CACHE = DATA / "api_cache"
API = "https://www.law.go.kr/DRF/lawService.do"

BOX = "┌┐└┘├┤┬┴┼─━│┃"
BORDER = re.compile(r"[┌┐└┘├┤┬┴┼─━]+")
TABLE = re.compile(r"┌.*?┘", re.S)
TAG = re.compile(r"<[^>]+>")
AMEND = re.compile(r"<(?:개정|신설|삭제|전문개정|타법개정|본조신설)[^<>]*>")


def _paragraphs_fn():
    """law_pdf_parse._paragraphs 를 그대로 쓴다(그 모듈은 fitz 를 import 하므로 가짜 모듈을 끼운다)."""
    sys.modules.setdefault("fitz", types.ModuleType("fitz"))
    spec = importlib.util.spec_from_file_location("law_pdf_parse", _BACKEND / "scripts" / "law_pdf_parse.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod._paragraphs


def _sha1(t: str) -> str:
    return hashlib.sha1(t.encode("utf-8")).hexdigest()


def _cache_path(name: str) -> Path:
    return CACHE / f"{name.replace(' ', '_')}.json"


def cmd_fetch(a) -> None:
    import httpx
    import config

    CACHE.mkdir(parents=True, exist_ok=True)
    names = sorted({json.loads(l)["law_name"] for l in ARTICLES.open(encoding="utf-8")})
    for n in names:
        p = _cache_path(n)
        if p.exists() and not a.force:
            continue
        r = httpx.get(API, params={"OC": config.LAW_OC_KEY, "target": "law", "type": "JSON", "LM": n}, timeout=90)
        r.raise_for_status()
        p.write_text(r.text, encoding="utf-8")
        print(f"  {n}: {len(r.text):,}B", flush=True)
        time.sleep(1.0)
    print(f"캐시 {len(list(CACHE.glob('*.json')))}개 → {CACHE}")


def box_to_rows(box: str) -> list[list[str]]:
    """상자 문자 표 → 행 목록. 테두리 줄로 행을 가르고, 한 행 안의 여러 시각 줄은 칸별로 이어 붙인다."""
    rows: list[list[str]] = []
    group: list[list[str]] = []

    def flush():
        if not group:
            return
        width = max(len(g) for g in group)
        cells = [" ".join(g[i].strip() for g in group if i < len(g) and g[i].strip()) for i in range(width)]
        cells = [re.sub(r"\s+", " ", c).strip() for c in cells]
        if any(cells):
            rows.append(cells)
        group.clear()

    # 문자열에 줄바꿈이 없다. 테두리(┌─┬ …)가 행 경계, 한 행 안의 시각 줄은 '│…│' 가 이어 붙어 '││' 로 만난다.
    for part in re.split(r"[┌┐└┘├┤┬┴┼─━]{2,}", box):
        part = part.strip()
        if not part:
            flush()
            continue
        for line in part.replace("││", "│\n│").split("\n"):
            line = line.strip()
            if not line.startswith("│"):
                continue
            cells = line.strip("│").split("│")
            if any(c.strip() for c in cells):
                group.append(cells)
        flush()
    flush()
    return rows


def table_text(box: str) -> str:
    rows = box_to_rows(box)
    return "[표]\n" + "\n".join(" | ".join(c for c in r) for r in rows) if rows else ""


def _norm(t: str) -> str:
    return re.sub(r"\s+", "", AMEND.sub("", TAG.sub("", t)))


def _walk(node, out: list[tuple[str, str]]) -> None:
    """(표 앞 문장, 표 상자 원문) 수집 — 조문내용·항내용·호내용·목내용 어디든."""
    if isinstance(node, dict):
        for k, v in node.items():
            if isinstance(v, str) and "┌" in v and k.endswith("내용"):
                lead = v.split("<img", 1)[0] if "<img" in v else v.split("┌", 1)[0]
                for m in TABLE.finditer(v):
                    out.append((lead, m.group(0)))
            else:
                _walk(v, out)
    elif isinstance(node, list):
        for x in node:
            _walk(x, out)


def _plain(node) -> str:
    """조문 단위의 모든 '…내용' 문자열(표·태그·개정 표시 제거)을 이어 붙인 본문 — 판이 달라도 조문이 같은지 대조용."""
    parts: list[str] = []

    def go(n):
        if isinstance(n, dict):
            for k, v in n.items():
                if isinstance(v, str) and k.endswith("내용"):
                    parts.append(TABLE.sub("", v))
                elif isinstance(v, (dict, list)):
                    go(v)
        elif isinstance(n, list):
            for x in n:
                go(x)
    go(node)
    return _norm(" ".join(parts))


def api_tables(name: str) -> tuple[str | None, dict[str, list[tuple[str, str]]]]:
    p = _cache_path(name)
    if not p.exists():
        return None, {}
    d = json.loads(p.read_text(encoding="utf-8")).get("법령", {})
    promul = str(d.get("기본정보", {}).get("공포번호") or "")
    units = d.get("조문", {}).get("조문단위", [])
    units = units if isinstance(units, list) else [units]
    by_no: dict[str, list[tuple[str, str]]] = {}
    for u in units:
        if u.get("조문여부") != "조문":
            continue
        no = str(u.get("조문번호")) + (f"의{u['조문가지번호']}" if u.get("조문가지번호") else "")
        found: list[tuple[str, str]] = []
        _walk(u, found)
        if found:
            by_no.setdefault(no, []).extend(found)
            PLAIN[(name, no)] = _plain(u)
    return promul, by_no


PLAIN: dict[tuple[str, str], str] = {}
SAME_RATIO = 0.98


def same_article(name: str, no: str, our_text: str) -> bool:
    """판(공포번호)이 달라도 이 조문 본문이 같으면 표도 같다고 본다 — 개정이 다른 조문만 건드린 경우."""
    import difflib

    api = PLAIN.get((name, no))
    if not api:
        return False
    ours = _norm(re.sub(r"^제\d+조(?:의\d+)?(?:\([^)]*\))?", "", our_text))
    api = re.sub(r"^제\d+조(?:의\d+)?(?:\([^)]*\))?", "", api)
    return difflib.SequenceMatcher(None, ours, api, autojunk=False).ratio() >= SAME_RATIO


def insert_tables(text: str, tables: list[tuple[str, str]]) -> tuple[str, int, int]:
    """(새 본문, 넣은 표 수, 위치를 못 찾아 끝에 붙인 수)."""
    lines = text.split("\n")
    placed, tail = 0, 0
    extra_end: list[str] = []
    inserts: dict[int, list[str]] = {}
    for lead, box in tables:
        tt = table_text(box)
        if not tt:
            continue
        key = _norm(lead)[:15]
        at = next((i for i, ln in enumerate(lines) if key and key in _norm(ln)), None)
        if at is None:
            extra_end.append(tt)
            tail += 1
        else:
            inserts.setdefault(at, []).append(tt)
        placed += 1
    out: list[str] = []
    for i, ln in enumerate(lines):
        out.append(ln)
        out.extend(inserts.get(i, []))
    out.extend(extra_end)
    return "\n".join(out), placed, tail


def cmd_apply(a) -> None:
    paragraphs = _paragraphs_fn()
    rows = [json.loads(l) for l in ARTICLES.open(encoding="utf-8")]
    gists = json.loads(GISTS.read_text(encoding="utf-8")) if GISTS.exists() else {}
    cache: dict[str, tuple] = {}
    report: dict[str, dict] = {}
    changed = 0
    for r in rows:
        name = r["law_name"]
        if name not in cache:
            cache[name] = api_tables(name)
        promul, by_no = cache[name]
        rep = report.setdefault(name, {"api": promul, "ours": r["law_no"], "tables": 0, "articles": 0, "tail": 0,
                                       "skipped_version": 0, "already": 0})
        if r["version"] != "current" or r["deleted"] or r["article_no"] not in by_no:
            continue
        if "[표]" in r["text"]:
            rep["already"] += 1
            continue
        ours = re.sub(r"\D", "", r["law_no"] or "")
        if not promul or (promul != ours and not same_article(name, r["article_no"], r["text"])):
            rep["skipped_version"] += 1
            continue
        if promul != ours:
            rep["same_text"] = rep.get("same_text", 0) + 1
        old = r["text"]
        new, n, tail = insert_tables(old, by_no[r["article_no"]])
        if not n:
            continue
        head, _, body = new.partition(" ")
        r["text"] = new
        r["paragraphs"] = paragraphs(body)
        if _sha1(old) in gists and _sha1(new) not in gists:
            gists[_sha1(new)] = gists[_sha1(old)]
        rep["tables"] += n
        rep["articles"] += 1
        rep["tail"] += tail
        changed += 1
    print(f"{'법령':<30}{'API':>8}{'우리':>9}{'조':>5}{'표':>5}{'끝붙임':>6}{'판다름':>6}")
    for k, v in sorted(report.items()):
        if v["tables"] or v["skipped_version"]:
            print(f"{k[:28]:<30}{v['api'] or '-':>8}{v['ours'] or '-':>9}{v['articles']:>5}{v['tables']:>5}{v['tail']:>6}{v['skipped_version']:>6}")
    print(f"\n바뀐 조문 {changed} · 표 {sum(v['tables'] for v in report.values())} · 끝붙임 {sum(v['tail'] for v in report.values())}"
          f" · 판 달라 건너뜀 {sum(v['skipped_version'] for v in report.values())}"
          f" · 판 달라도 본문 같아 반영 {sum(v.get('same_text', 0) for v in report.values())}")
    if a.dry_run:
        return
    with ARTICLES.open("w", encoding="utf-8") as f:
        for r in rows:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    GISTS.write_text(json.dumps(gists, ensure_ascii=False), encoding="utf-8")
    print(f"→ {ARTICLES} · {GISTS}")


def main() -> None:
    sys.stdout.reconfigure(encoding="utf-8")
    ap = argparse.ArgumentParser()
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("fetch")
    p.add_argument("--force", action="store_true")
    p = sub.add_parser("apply")
    p.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    {"fetch": cmd_fetch, "apply": cmd_apply}[a.cmd](a)


if __name__ == "__main__":
    main()
