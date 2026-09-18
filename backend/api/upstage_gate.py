"""
Upstage 호출 게이트 — 프로세스 전체의 동시 호출 수를 k 로 묶는 FIFO 큐 (P8 B, 2026-09-18).

왜: 같은 API 키로 동시 호출이 몰리면 일부 요청이 응답 없이 멈췄다가 SDK 타임아웃(작문 120초)에
걸리고, 재시도는 몇 초 만에 성공한다(P7 C: 4워커 동시 ≈6%, 순차 64회 0). 전시회에서 비로그인
방문자가 몰리면 그 조건이 된다. 그래서 서버가 호출을 줄 세워 들고 있다가 처리가 끝나는 대로
Upstage 로 보낸다.

· 단위는 요청이 아니라 **Upstage 호출**이다 — 챗 한 턴은 추출·검증·임베딩·작문 3~4회다.
  llm.py / embeddings.py 의 호출 지점마다 `with slot():` 한 겹.
· FIFO — 챗과 백그라운드(KB2 재구조화·분류·적재 임베딩)가 같은 줄에 선다(사용자 결정 2026-09-18).
  threading.Semaphore 는 새로 온 스레드가 새치기할 수 있어 번호표로 순서를 지킨다.
· 대기 상한은 **챗 턴당 합계**(turn_budget) — 한 턴이 줄에서 기다린 시간의 합이 상한을 넘으면
  UpstageCongested. 호출마다 상한을 두면 한 턴이 3~4배를 기다린다. 이 대기는 SDK timeout 밖이다.
  예산이 없는 스레드(백그라운드)는 무기한 기다린다 — 느려질 뿐 실패하지 않는다.
· 슬롯은 SDK 호출 전체(재시도 포함)를 감싼다. 멈춘 호출이 재시도까지 슬롯을 쥐는 건 실제로 그
  호출이 Upstage 쪽 자리를 쓰고 있다는 뜻이라 계산이 맞다.
· `uvicorn --workers 1` + sync def(스레드풀) 전제의 프로세스 내 게이트다. 워커를 늘리면 k 가
  워커 수만큼 곱해진다 — 그때 재검토.
"""

from __future__ import annotations

import os
import threading
import time
from collections import deque
from contextlib import contextmanager

# 동시 상한 k — 프로덕션 부하 측정(N=1~4)으로 정했다. env 로 덮어쓸 수 있다(재배포 없이 조정).
DEFAULT_MAX_CONCURRENCY = 3
# 챗 한 턴이 줄에서 기다릴 수 있는 합계(초). 사용자 결정 2026-09-18.
CHAT_QUEUE_WAIT_SEC = 30.0


class UpstageCongested(Exception):
    """챗 턴의 대기 예산을 다 썼다 — 호출하지 않고 포기한다. main.chat 이 혼잡 안내로 바꾼다.

    llm/retriever 의 `except Exception` 폴백이 이것을 삼키면 안 된다(삼키면 '근거 없이 진행'이나
    기본 문안이 나가 혼잡이 가려진다) — 그런 자리는 `except UpstageCongested: raise` 를 먼저 둔다."""


class _FifoGate:
    def __init__(self, capacity: int) -> None:
        self.capacity = max(1, capacity)
        self._cond = threading.Condition()
        self._active = 0
        self._queue: deque[int] = deque()
        self._next_ticket = 0
        # 관측용 — 로그 한 줄에 싣는다.
        self.peak_waiting = 0

    def acquire(self, timeout: float | None) -> float:
        """슬롯을 얻고 기다린 초를 돌려준다. timeout 초과 시 UpstageCongested."""
        t0 = time.monotonic()
        deadline = None if timeout is None else t0 + max(0.0, timeout)
        with self._cond:
            ticket = self._next_ticket
            self._next_ticket += 1
            self._queue.append(ticket)
            self.peak_waiting = max(self.peak_waiting, len(self._queue))
            try:
                while not (self._queue[0] == ticket and self._active < self.capacity):
                    remaining = None if deadline is None else deadline - time.monotonic()
                    if remaining is not None and remaining <= 0:
                        raise UpstageCongested(f"queue wait > {timeout:.0f}s (k={self.capacity})")
                    self._cond.wait(remaining)
                self._queue.popleft()
                self._active += 1
            except BaseException:
                if ticket in self._queue:
                    self._queue.remove(ticket)
                self._cond.notify_all()   # 내가 맨 앞이었다면 다음 번호가 진행해야 한다
                raise
            self._cond.notify_all()       # 슬롯이 더 남았으면 다음 번호도 바로 들어간다
        return time.monotonic() - t0

    def release(self) -> None:
        with self._cond:
            self._active -= 1
            self._cond.notify_all()

    def stats(self) -> dict:
        with self._cond:
            return {"capacity": self.capacity, "active": self._active, "waiting": len(self._queue),
                    "peakWaiting": self.peak_waiting}


def _capacity_from_env() -> int:
    try:
        return int(os.environ.get("UPSTAGE_MAX_CONCURRENCY", DEFAULT_MAX_CONCURRENCY))
    except ValueError:
        return DEFAULT_MAX_CONCURRENCY


_gate: _FifoGate | None = None
_gate_lock = threading.Lock()
_local = threading.local()


def _get_gate() -> _FifoGate:
    # 첫 호출 때 만든다 — main 의 load_dotenv 뒤에 env 를 읽어야 한다.
    global _gate
    if _gate is None:
        with _gate_lock:
            if _gate is None:
                _gate = _FifoGate(_capacity_from_env())
                print(f"[upstage_gate] k={_gate.capacity} · 챗 턴 대기 상한 {CHAT_QUEUE_WAIT_SEC:.0f}s", flush=True)
    return _gate


@contextmanager
def turn_budget(seconds: float | None = None):
    """이 스레드(챗 한 턴)의 대기 예산을 건다. 안에서 부르는 slot() 들이 기다린 시간을 합산해 깎는다."""
    prev = getattr(_local, "budget", None)
    _local.budget = CHAT_QUEUE_WAIT_SEC if seconds is None else seconds
    try:
        yield
    finally:
        _local.budget = prev


@contextmanager
def slot(label: str = ""):
    """Upstage 호출 한 번을 감싼다. 챗 턴 안이면 남은 예산만큼만 기다린다."""
    gate = _get_gate()
    budget = getattr(_local, "budget", None)
    try:
        waited = gate.acquire(budget)
    except UpstageCongested:
        print(f"[upstage_gate] 혼잡 포기 {label} · {gate.stats()}", flush=True)
        raise
    if budget is not None:
        _local.budget = max(0.0, budget - waited)
    if waited >= 1.0:
        print(f"[upstage_gate] {label} 대기 {waited:.1f}s · {gate.stats()}", flush=True)
    try:
        yield
    finally:
        gate.release()


def stats() -> dict:
    return _get_gate().stats()
