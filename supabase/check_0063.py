"""
0063(사용 현황 M2 — chat_turns 보강 · 질문 원문 가림) 확인.

사용:
    backend/.venv/Scripts/python.exe supabase/check_0063.py              # 마이그레이션 직후(읽기 전용 + 가림 시험 1행)
    backend/.venv/Scripts/python.exe supabase/check_0063.py --after-deploy   # 백엔드 배포 뒤: 운영 /api/chat 1턴

--after-deploy: conversationId `local-check0063-…`(고객 챗 채널)로 "전화번호가 든 질문" 한 턴을 운영에 보내고
chat_turns 새 칸(channel·tax_topic·question_type·latency_ms)과 analytics.questions(가림)를 확인한 뒤 그 두 행을 지운다.
"""

from __future__ import annotations

import json
import sys
import time
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from apply_migration import db_url  # noqa: E402

BASE = "https://158-179-177-51.sslip.io"
NEW_COLS = {"channel", "tax_topic", "question_type", "handoff_reason", "latency_ms"}


def main() -> None:
    import psycopg

    sys.stdout.reconfigure(encoding="utf-8")
    after = "--after-deploy" in sys.argv
    fails = 0

    def check(label: str, ok: bool, detail: object = "") -> None:
        nonlocal fails
        fails += 0 if ok else 1
        print(f"[{'OK' if ok else 'FAIL'}] {label}" + (f" : {detail}" if detail != "" else ""))

    with psycopg.connect(db_url()) as conn:
        cur = conn.cursor()
        cur.execute("select version from supabase_migrations.schema_migrations where version = '0063'")
        check("schema_migrations 0063 기록", cur.fetchone() is not None)
        cur.execute("select column_name from information_schema.columns where table_schema = 'rag' and table_name = 'chat_turns'")
        cols = {r[0] for r in cur.fetchall()}
        check("chat_turns 새 칸 5개", NEW_COLS <= cols, sorted(NEW_COLS - cols))
        cur.execute("select channel, count(*) from rag.chat_turns group by channel order by 2 desc")
        dist = dict(cur.fetchall())
        check("channel 소급(null 없음)", None not in dist, dist)
        cur.execute("select has_table_privilege('anon', 'analytics.questions', 'select'), has_table_privilege('authenticated', 'analytics.questions', 'select')")
        check("questions 표 직접 권한 없음(anon·authenticated)", not any(cur.fetchone()))
        cur.execute("select exists (select 1 from pg_extension where extname = 'pg_cron')")
        if cur.fetchone()[0]:
            cur.execute("select schedule from cron.job where jobname = 'purge-old-analytics-questions'")
            row = cur.fetchone()
            check("cron purge-old-analytics-questions", row is not None, row[0] if row else "")
        # 백엔드와 같은 DB 사용자로 넣어 보고(트리거 가림) 지운다.
        cur.execute("insert into analytics.questions (conversation_id, message_id, text_masked) values "
                    "('check0063', 'check0063', '번호 010-1234-5678 사업자 123-45-67890 연봉 5,000만원') returning id, text_masked")
        qid, masked = cur.fetchone()
        check("트리거 가림", masked == "번호 [가림] 사업자 [가림] 연봉 5,000만원", masked)
        cur.execute("delete from analytics.questions where id = %s", (qid,))
        conn.commit()

        if after:
            cid = f"local-check0063-{uuid.uuid4().hex[:8]}"
            body = {"conversationId": cid, "occupation": "clinic", "history": [],
                    "userInput": {"text": "제 번호는 010-2222-3333 이에요. 부가세 신고 기한이 언제인가요?"}}
            req = urllib.request.Request(f"{BASE}/api/chat", data=json.dumps(body).encode(), method="POST",
                                         headers={"Content-Type": "application/json"})
            t0 = time.time()
            with urllib.request.urlopen(req, timeout=180) as r:
                status = r.status
                meta = json.loads(r.read().decode()).get("meta", {})
            check("운영 /api/chat 1턴", status == 200, f"{time.time() - t0:.1f}s · extracted={ (meta.get('extracted') or {}).get('tax_topic') }")
            time.sleep(1.0)
            cur.execute("select channel, tax_topic, question_type, latency_ms, outcome from rag.chat_turns where conversation_id = %s", (cid,))
            turn = cur.fetchone()
            check("chat_turns 새 칸 기록", bool(turn and turn[0] == "chat" and turn[3]), turn)
            cur.execute("select text_masked from analytics.questions where conversation_id = %s", (cid,))
            q = cur.fetchone()
            check("질문 원문(가림) 기록", bool(q and "[가림]" in q[0] and "010-2222" not in q[0]), q)
            cur.execute("delete from analytics.questions where conversation_id = %s", (cid,))
            cur.execute("delete from rag.chat_turns where conversation_id = %s", (cid,))
            conn.commit()
            print("   시험 행 삭제(questions·chat_turns)")

    print("\n모두 OK" if fails == 0 else f"\nFAIL {fails}건")
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
