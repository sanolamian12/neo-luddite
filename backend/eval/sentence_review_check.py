r"""운영 답변 문장 대조 집계(A10, 10/16) — 일감 → 문장별 코멘트 → 검수 결정 → RAG 환류를 한 장으로.

운영 DB 를 읽기만 한다(read only 트랜잭션). 관리자 화면 /admin/inspection/summary 와 같은 정의:
  문장 = 답변 Message.segments[] 하나(segment_id = {message_id}_s{i})
  코멘트 = public.line_feedback 한 행 · 분류 = tags(legal_error 법적 · grammar_error 문법 · suggestion 제안, 0012)
  결정 = public.reviews.decisions[] 의 {feedbackId, accepted} — 없으면 '미결정'
  환류 = 인정된 코멘트가 rag.passages(source_kind 'feedback', dedupe_key 'feedback:<id>')로 들어간 수
  범위 = audits.progress {feedbackCount, totalSegments} — 코멘트가 달린 문장 ÷ 대화 문장 수

주의(메모리 '감사 데이터 출처'): 7~8월 평가자1~3 코멘트는 감사모드 클로드 산출물이다 — 보고서에 '세무사 대조'로 쓰지 말 것.
평가자 표시는 auditor_id 그대로 둔다.

사용:
  cd backend
  .\.venv\Scripts\python.exe -X utf8 -m eval.sentence_review_check [--since 2026-10-01] [--out ../design/demo_eval_1010/sentence_review_check.md]
"""

from __future__ import annotations

import argparse
import datetime as dt
from pathlib import Path

from eval.run_demo_eval import load_env

TAGS = [("legal_error", "법적"), ("grammar_error", "문법"), ("suggestion", "제안")]

SQL_BASE = """
with lf as (
  select * from public.line_feedback where created_at >= %(since)s
), dec as (
  select (d->>'feedbackId') as fid, (d->>'accepted')::boolean as accepted, r.status as review_status
    from public.reviews r, jsonb_array_elements(r.decisions) d
), j as (
  select lf.*, dec.accepted, dec.review_status,
         exists (select 1 from rag.passages p where p.dedupe_key = 'feedback:' || lf.id::text) as in_rag
    from lf left join dec on dec.fid = lf.id::text
)
"""


def _pct(a: int, b: int) -> str:
    return f"{a / b * 100:.1f}%" if b else "—"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--since", default="2000-01-01", help="코멘트 작성일 하한(YYYY-MM-DD, UTC)")
    ap.add_argument("--out", default=None, help="md 저장 경로(없으면 화면만)")
    a = ap.parse_args()
    load_env()
    from api.rag import kb3_store

    since_ms = int(dt.datetime.fromisoformat(a.since).replace(tzinfo=dt.timezone.utc).timestamp() * 1000)
    conn = kb3_store._get_conn()
    out: list[str] = []
    with conn.transaction(), conn.cursor() as cur:
        cur.execute("set transaction read only")
        q = lambda sql: (cur.execute(SQL_BASE + sql, {"since": since_ms}), cur.fetchall())[1]  # noqa: E731

        (n, convs, segs, auditors, first, last), = q(
            "select count(*), count(distinct conversation_id), count(distinct (conversation_id, segment_id)), "
            "count(distinct auditor_id), min(created_at), max(created_at) from j")
        (acc, rej, und, rag), = q(
            "select count(*) filter (where accepted), count(*) filter (where accepted = false), "
            "count(*) filter (where accepted is null), count(*) filter (where in_rag) from j")
        fmt = lambda ms: dt.datetime.fromtimestamp(ms / 1000, dt.timezone.utc).strftime("%Y-%m-%d") if ms else "—"  # noqa: E731
        out += [f"# 운영 답변 문장 대조 집계 ({dt.date.today().isoformat()}, 코멘트 {a.since} 이후)", "",
                f"- 코멘트 **{n}건** · 대화 {convs} · 코멘트 달린 문장 {segs} · 평가자 {auditors} · 기간 {fmt(first)}~{fmt(last)}",
                f"- 결정: 인정 {acc} ({_pct(acc, n)}) · 거절 {rej} ({_pct(rej, n)}) · 미결정 {und} ({_pct(und, n)})",
                f"- 환류: 인정 코멘트 중 RAG 적재 {rag} / {acc} ({_pct(rag, acc)})", ""]

        out += ["## 분류별", "", "| 분류 | 코멘트 | 인정 | 거절 | 미결정 | 인정률(결정분) |", "|---|---|---|---|---|---|"]
        rows = {t: r for t, *r in q(
            "select t, count(*), count(*) filter (where accepted), count(*) filter (where accepted = false), "
            "count(*) filter (where accepted is null) from j, unnest(tags) t group by t")}
        for tag, label in TAGS:
            c, ac, rj, ud = rows.get(tag, (0, 0, 0, 0))
            out.append(f"| {label} | {c} | {ac} | {rj} | {ud} | {_pct(ac, ac + rj)} |")
        out += ["", "(코멘트 하나에 분류가 여럿이면 각 분류에 센다)", ""]

        out += ["## 평가자별", "", "| 평가자 | 코멘트 | 대화 | 인정 | 거절 | 미결정 |", "|---|---|---|---|---|---|"]
        for aud, c, cv, ac, rj, ud in q(
                "select coalesce(auditor_id, '(없음)'), count(*), count(distinct conversation_id), "
                "count(*) filter (where accepted), count(*) filter (where accepted = false), "
                "count(*) filter (where accepted is null) from j group by 1 order by 2 desc"):
            out.append(f"| {aud} | {c} | {cv} | {ac} | {rj} | {ud} |")
        out.append("")

        # progress.feedbackCount 는 0012 정리(무태그·중복 삭제) 뒤 갱신되지 않아 실제보다 크다 → 문장 수만 쓰고
        # 코멘트 달린 문장은 line_feedback 에서 직접 센다. 대화 문장 수 = 그 대화 검수들의 totalSegments 최댓값.
        (au_n, au_conv, au_seg, au_hit), = q(
            ", sub as (select conversation_id, max((progress->>'totalSegments')::int) as segs, count(*) as n "
            "  from public.audits where status in ('submitted', 'reviewed', 'finalized') "
            "  and coalesce(submitted_at, picked_at, 0) >= %(since)s group by conversation_id) "
            "select coalesce(sum(n), 0), count(*), coalesce(sum(segs), 0), "
            "  (select count(distinct (j.conversation_id, j.segment_id)) from j "
            "    where j.conversation_id in (select conversation_id from sub)) from sub")
        out += ["## 범위", "", f"- 제출된 검수 {au_n}건 · 대화 {au_conv} · 대화 문장 {au_seg} · 코멘트 달린 문장 {au_hit} "
                f"({_pct(au_hit, au_seg)})", ""]

        out += ["## 월별", "", "| 월 | 코멘트 | 대화 | 인정 |", "|---|---|---|---|"]
        for m, c, cv, ac in q(
                "select to_char(to_timestamp(created_at / 1000) at time zone 'UTC', 'YYYY-MM'), count(*), "
                "count(distinct conversation_id), count(*) filter (where accepted) from j group by 1 order by 1"):
            out.append(f"| {m} | {c} | {cv} | {ac} |")
    text = "\n".join(out) + "\n"
    print(text)
    if a.out:
        Path(a.out).write_text(text, encoding="utf-8")
        print("→", a.out)


if __name__ == "__main__":
    main()
