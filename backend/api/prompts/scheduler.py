"""
L0 규범 디폴트 승인 폴러 (P6 ②, 2026-09-17).

공개 제안의 이의 기간(기본 1일)이 지나고 유효 이의가 없으면 반영한다 — 침묵 = 동의.
pg_cron 이 아니라 여기서 하는 이유: 반영 직전 예산 검사(build_norms)가 Python 이다(kb2_scheduler 와 같은 판단).
진실은 norms.versions.deadline_at 이라 서버가 내려가 있던 동안 만기된 제안은 기동 직후 첫 폴에서 반영된다.
반영하면 이 프로세스의 규범 캐시를 즉시 무효화한다(다른 프로세스는 60초 지문 확인으로 따라온다).
"""

from __future__ import annotations

import asyncio

POLL_INTERVAL_SEC = 60


async def _loop() -> None:
    from api.prompts import invalidate_norms
    from api.prompts import store

    while True:
        try:
            if store.is_configured():
                applied = await asyncio.to_thread(store.apply_due)
                if applied:
                    invalidate_norms()
                    print(f"[norms_scheduler] 디폴트 승인 반영 {len(applied)}건: {applied}", flush=True)
        except Exception as e:  # noqa: BLE001 — 폴러는 무슨 일이 있어도 살아있어야 한다
            print(f"[norms_scheduler] poll failed: {e}", flush=True)
        await asyncio.sleep(POLL_INTERVAL_SEC)


def start(loop_task_holder: list) -> None:
    loop_task_holder.append(asyncio.create_task(_loop()))
