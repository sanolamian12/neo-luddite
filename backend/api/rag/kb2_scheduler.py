"""
kb2 재구조화 야간 배치 폴러 (2026-09-10).

동기(사용자 지적): "세무사가 버튼 한 번으로 큰 작업에 들어가면 안 된다." 재구조화는
활성 passage 전량을 LLM에 태우는 작업이라 근무 시간 중 즉시 실행이 부적절하다. 그래서
kb2.synthesis_jobs 에 status='scheduled' + scheduled_at 으로 예약을 남기고, 이 모듈이
백엔드 안에서 1분마다 만기 예약을 집어 실행한다.

왜 pg_cron 이 아닌가: 이 레포의 pg_cron 선례(0006 하차장 스냅샷)는 순수 SQL 함수라 DB
안에서 완결된다. 재구조화는 Upstage API 호출(Python)이 본체라 DB 가 스스로 못 한다 —
pg_cron 이 할 수 있는 건 pg_net 으로 백엔드를 깨우는 것뿐이고, 그건 폴러 하나보다
부품이 늘어난다. 예약의 진실은 DB 테이블이라 백엔드가 재시작·크래시해도 예약은 남고,
지난 예약은 다음 기동 때 곧바로 집어간다(만기 조건이 scheduled_at <= now 라서).

배포 전제: uvicorn --workers 1 (backend/deploy/neo-luddite-api.service). 워커가 늘어도
claim 이 단일 UPDATE…where status='scheduled' 라 중복 실행은 안 되지만, 그때는 폴러가
워커 수만큼 도는 게 맞는지 재검토할 것.
"""

from __future__ import annotations

import asyncio
import time

POLL_INTERVAL_SEC = 60


async def _loop() -> None:
    from api.rag import kb2_store, kb2_taxonomy

    # 기동 직후 1회 — 이전 생에서 running 인 채로 남은 job 을 정리한다. 방금 뜬
    # 프로세스 안에서 도는 작업은 있을 수 없으므로 그 시점의 running 은 전부 잔해다
    # (배포는 systemctl restart 라 재구조화 도중 배포하면 반드시 이 상태가 된다).
    first_pass = True

    while True:
        try:
            if kb2_store.is_configured():
                reaped = kb2_store.reap_stale_running_jobs(all_running=first_pass)
                if reaped:
                    why = "재시작으로 중단" if first_pass else "진행 신호 끊김"
                    print(f"[kb2_scheduler] {why} — job {len(reaped)}건 정리: {reaped}", flush=True)
                first_pass = False
                job_id = kb2_store.claim_due_scheduled_job(int(time.time() * 1000))
                if job_id:
                    # 파이프라인은 동기 함수(수 분 소요) — 이벤트 루프를 막지 않도록
                    # 스레드로 넘긴다. run_dynamic_restructure 자체가 예외를 삼켜
                    # job.status='error' 로 기록하므로 여기서 죽을 일은 없다.
                    await asyncio.to_thread(kb2_taxonomy.run_dynamic_restructure, job_id)
                    continue  # 밀린 예약이 더 있으면 대기 없이 이어서
        except Exception as e:  # noqa: BLE001 — 폴러는 무슨 일이 있어도 살아있어야 한다
            print(f"[kb2_scheduler] poll failed: {e}", flush=True)
        await asyncio.sleep(POLL_INTERVAL_SEC)


def start(loop_task_holder: list) -> None:
    """FastAPI lifespan 에서 호출 — 태스크 핸들을 리스트에 담아 종료 시 취소할 수 있게."""
    loop_task_holder.append(asyncio.create_task(_loop()))
