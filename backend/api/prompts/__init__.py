"""
L0 규범층 로더 — load_norms() 경계 (KB통합 3층검색 로드맵 P1, 2026-09-16).

프롬프트 빌더(llm.py)는 **이 함수 하나만 안다.** md 파일을 직접 읽지 않는다.
retriever.py 가 저장소 교체를 흡수하는 것과 같은 관용구다 — P3 이후 규범을 DB 로
승격할 때 _read_sources() 만 갈아끼우면 llm.py 는 한 줄도 안 바뀐다.

    P1:  load_norms() → api/prompts/*.md
    P3+: load_norms() → DB (+ 파일 폴백)

L0 는 검색을 타지 않는다. 규범은 선례와 경쟁해 top-k 에서 떨어질 성질이 아니라 매 턴
상수로 들어간다. 그래서 질문과 무관하게 프로세스당 1회 읽고 캐시한다(재배포 = 반영).

**Graceful**: 파일 누락·빈 파일·예산 초과면 None 을 돌려주고, 호출측은 현행 하드코딩
문안만으로 프롬프트를 만든다. 예산 초과를 **잘라내지 않는** 이유 — 규범의 뒷부분이
조용히 사라지면 어느 규칙이 빠졌는지 아무도 모른다. 통째로 빠지는 쪽이 로그로 드러난다.
"""

from __future__ import annotations

import logging
import re
from functools import lru_cache
from pathlib import Path

log = logging.getLogger("api.prompts")

_DIR = Path(__file__).resolve().parent

# 조립 순서 = 로드맵 §2.0 그림 (답변 절차·거절 → 해석 원칙 → 오류 패턴).
NORM_FILES = ("master.md", "frameworks.md", "pitfalls.md")

# 예산(문자 수, 주석 제거 후 합계). 기준: 규범 도입 전 작문 시스템 프롬프트가 1,028자.
# 시드 전문(해석론+오류패턴 17.4k자)은 매 턴 비용·지연과 지시 희석 때문에 못 넣는다 —
# 규범 블록은 그 1/6 이하로 묶는다. 늘리려면 이 숫자를 고치는 게 아니라 규범을 줄일 것.
NORMS_MAX_CHARS = 2800

_COMMENT = re.compile(r"<!--.*?-->", re.S)


class NormsError(Exception):
    """규범을 쓸 수 없는 상태(누락·빈 파일·예산 초과)."""


def _read_sources() -> list[tuple[str, str]]:
    """(이름, 원문) 목록. P3 에서 DB 로 승격하면 이 함수만 교체한다."""
    out = []
    for name in NORM_FILES:
        path = _DIR / name
        if not path.is_file():
            raise NormsError(f"규범 파일 없음: {name}")
        out.append((name, path.read_text(encoding="utf-8")))
    return out


def build_norms(sources: list[tuple[str, str]] | None = None) -> str:
    """원문 → 주입용 규범 블록. 쓸 수 없으면 NormsError (예산 초과 포함, 절단 없음)."""
    parts = []
    for name, raw in (sources if sources is not None else _read_sources()):
        body = _COMMENT.sub("", raw).strip()
        if not body:
            raise NormsError(f"규범 파일이 비어 있음: {name}")
        parts.append(body)
    block = "\n\n".join(parts)
    if len(block) > NORMS_MAX_CHARS:
        raise NormsError(f"규범 예산 초과: {len(block)}자 > {NORMS_MAX_CHARS}자")
    return block


@lru_cache(maxsize=1)
def load_norms() -> str | None:
    """주입할 규범 블록, 또는 None(폴백 신호). 예외를 올리지 않는다."""
    try:
        return build_norms()
    except Exception as exc:  # noqa: BLE001 — 규범 실패로 챗이 멈추면 안 된다
        log.error("L0 규범 로드 실패 — 하드코딩 문안으로 폴백: %s", exc)
        return None


def main() -> int:
    """배포 전 점검: `python -m api.prompts` — 규범을 못 쓰면 종료코드 1."""
    try:
        block = build_norms()
    except NormsError as exc:
        print(f"[norms] 실패: {exc}")
        return 1
    print(f"[norms] OK {len(block)}/{NORMS_MAX_CHARS}자 ({', '.join(NORM_FILES)})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
