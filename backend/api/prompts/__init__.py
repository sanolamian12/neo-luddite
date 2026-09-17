"""
L0 규범층 로더 — load_norms() 경계 (KB통합 3층검색 로드맵 P1, 2026-09-16 · P5 DB 승격 2026-09-17).

프롬프트 빌더(llm.py)는 **이 함수 하나만 안다.** 저장소가 파일인지 DB 인지 모른다.
retriever.py 가 저장소 교체를 흡수하는 것과 같은 관용구다.

    P1:  load_norms() → api/prompts/*.md
    P5:  load_norms() → DB norms.*(원본, 확정본) → 실패 시 api/prompts/*.md(폐기 안 한 폴백)

L0 는 검색을 타지 않는다. 규범은 선례와 경쟁해 top-k 에서 떨어질 성질이 아니라 매 턴
상수로 들어간다. 그래서 매 턴 DB 를 읽지 않는다 — 블록은 메모리에 두고, **NORMS_CHECK_SEC
(기본 60초)마다 한 번** 확정본 지문(documents.active_version_id 조합)만 확인해 바뀌었을 때만
다시 읽는다. 확정 API 는 invalidate_norms() 로 이 대기를 건너뛴다(같은 프로세스 즉시 반영).

**Graceful**: DB 미설정·장애·확정본 누락이면 md 로, md 도 못 쓰면 None 을 돌려주고 호출측은
현행 하드코딩 문안만으로 프롬프트를 만든다. 이미 DB 에서 읽은 블록이 있는데 지문 확인만
실패하면 그 블록을 계속 쓴다(DB 순단에 md 로 출렁이지 않게). 예산 초과를 **잘라내지 않는**
이유 — 규범의 뒷부분이 조용히 사라지면 어느 규칙이 빠졌는지 아무도 모른다.
"""

from __future__ import annotations

import logging
import os
import re
import threading
import time
from pathlib import Path

log = logging.getLogger("api.prompts")

_DIR = Path(__file__).resolve().parent

# 조립 순서 = 로드맵 §2.0 그림 (답변 절차·거절 → 해석 원칙 → 오류 패턴). DB order_index 와 같다.
NORM_FILES = ("master.md", "frameworks.md", "pitfalls.md")

# 예산(문자 수, 주석 제거 후 합계). 기준: 규범 도입 전 작문 시스템 프롬프트가 1,028자.
# 시드 전문(해석론+오류패턴 17.4k자)은 매 턴 비용·지연과 지시 희석 때문에 못 넣는다 —
# 규범 블록은 그 1/6 이하로 묶는다. 늘리려면 이 숫자를 고치는 게 아니라 규범을 줄일 것.
# 편집 화면의 초안 저장·확정도 이 값으로 막는다(api/prompts/store.py).
NORMS_MAX_CHARS = 2800

NORMS_CHECK_SEC = float(os.environ.get("NORMS_CHECK_SEC", "60"))

_COMMENT = re.compile(r"<!--.*?-->", re.S)


class NormsError(Exception):
    """규범을 쓸 수 없는 상태(누락·빈 파일·예산 초과)."""


def _read_file_sources() -> list[tuple[str, str]]:
    """(이름, 원문) 목록 — md 폴백."""
    out = []
    for name in NORM_FILES:
        path = _DIR / name
        if not path.is_file():
            raise NormsError(f"규범 파일 없음: {name}")
        out.append((name, path.read_text(encoding="utf-8")))
    return out


def _read_sources() -> tuple[list[tuple[str, str]], str]:
    """(원문 목록, 출처 'db'|'md'). DB 원본을 먼저, 못 읽으면 md."""
    from api.prompts import store

    if store.is_configured():
        try:
            return store.active_sources(), "db"
        except Exception as exc:  # noqa: BLE001 — DB 장애는 폴백 사유지 챗 중단 사유가 아니다
            log.warning("L0 규범 DB 읽기 실패 — md 폴백: %s", exc)
    return _read_file_sources(), "md"


def build_norms(sources: list[tuple[str, str]] | None = None) -> str:
    """원문 → 주입용 규범 블록. 쓸 수 없으면 NormsError (예산 초과 포함, 절단 없음)."""
    parts = []
    for name, raw in (sources if sources is not None else _read_sources()[0]):
        body = _COMMENT.sub("", raw).strip()
        if not body:
            raise NormsError(f"규범이 비어 있음: {name}")
        parts.append(body)
    block = "\n\n".join(parts)
    if len(block) > NORMS_MAX_CHARS:
        raise NormsError(f"규범 예산 초과: {len(block)}자 > {NORMS_MAX_CHARS}자")
    return block


def _load() -> tuple[str | None, str]:
    """(블록 또는 None, 출처 'db'|'md'|'none'). DB 블록이 못 쓰는 상태면 md 로 한 번 더."""
    sources, source = _read_sources()
    try:
        return build_norms(sources), source
    except NormsError as exc:
        if source != "db":
            raise
        log.error("L0 규범 DB 확정본을 쓸 수 없음 — md 폴백: %s", exc)
        return build_norms(_read_file_sources()), "md"


class _State:
    lock = threading.Lock()
    loaded = False
    block: str | None = None
    source = "none"
    token: str | None = None
    checked_at = 0.0


def _db_token() -> str | None:
    from api.prompts import store

    if not store.is_configured():
        return None
    try:
        return store.active_token()
    except Exception as exc:  # noqa: BLE001
        log.warning("L0 규범 지문 확인 실패 — 현재 블록 유지: %s", exc)
        return None


def load_norms() -> str | None:
    """주입할 규범 블록, 또는 None(폴백 신호). 예외를 올리지 않는다."""
    s = _State
    now = time.monotonic()
    if s.loaded and now - s.checked_at < NORMS_CHECK_SEC:
        return s.block
    with s.lock:
        if s.loaded and now - s.checked_at < NORMS_CHECK_SEC:
            return s.block
        s.checked_at = now  # 실패해도 다음 확인은 주기 뒤 — 장애 중 매 턴 재시도하지 않는다
        token = _db_token()
        if s.loaded and (token is None or token == s.token):
            return s.block
        try:
            block, source = _load()
        except Exception as exc:  # noqa: BLE001 — 규범 실패로 챗이 멈추면 안 된다
            log.error("L0 규범 로드 실패 — 하드코딩 문안으로 폴백: %s", exc)
            block, source = None, "none"
        if s.loaded and block != s.block:
            log.info("L0 규범 교체 — 출처 %s, %s자", source, len(block) if block else 0)
        s.block, s.source, s.token, s.loaded = block, source, token, True
        return s.block


def invalidate_norms() -> None:
    """다음 load_norms() 가 확인 주기를 기다리지 않고 지문을 다시 보게 한다(확정 직후)."""
    _State.checked_at = float("-inf")


def norms_status() -> dict:
    """헬스·편집 화면용 — 지금 이 프로세스가 주입 중인 규범의 출처와 길이."""
    load_norms()
    s = _State
    return {"source": s.source, "chars": len(s.block) if s.block else 0, "maxChars": NORMS_MAX_CHARS}


def main() -> int:
    """배포 전 점검: `python -m api.prompts` — 주입할 규범을 못 쓰면 종료코드 1.
    DB 확정본과 md 폴백을 둘 다 점검한다(폴백이 망가져 있으면 DB 장애 때 규범이 통째로 빠진다)."""
    from dotenv import load_dotenv

    # 앱(api/main.py)과 같은 .env — 안 읽으면 SUPABASE_DB_URL 이 없어 늘 md 만 점검한다
    load_dotenv(_DIR.parent.parent / ".env")
    code = 0
    try:
        block, source = _load()
        print(f"[norms] OK {len(block)}/{NORMS_MAX_CHARS}자 (출처 {source})")
    except Exception as exc:  # noqa: BLE001
        print(f"[norms] 실패: {exc}")
        code = 1
    try:
        fallback = build_norms(_read_file_sources())
        print(f"[norms] md 폴백 OK {len(fallback)}/{NORMS_MAX_CHARS}자 ({', '.join(NORM_FILES)})")
    except NormsError as exc:
        print(f"[norms] md 폴백 실패(DB 장애 시 규범 없이 동작): {exc}")
    return code


def export_to_md(dry_run: bool = False) -> int:
    """`python -m api.prompts export [--dry-run]` — DB 확정본을 md 폴백에 덮어쓴다.

    md 는 DB 장애 시 폴백이라 확정이 쌓일수록 옛 규범이 된다. 이 명령으로 폴백을 최신 확정본에
    맞춘 뒤 커밋·배포한다. 파일 머리의 `<!-- -->` 관리 주석은 보존하고 본문만 바꾼다.
    DB 확정본을 못 읽거나 예산을 넘으면 아무 파일도 쓰지 않는다(종료코드 1)."""
    from dotenv import load_dotenv

    from api.prompts import store

    load_dotenv(_DIR.parent.parent / ".env")
    if not store.is_configured():
        print("[norms export] 실패: SUPABASE_DB_URL 미설정")
        return 1
    try:
        sources = dict(store.active_sources())
        build_norms(list(sources.items()))
    except Exception as exc:  # noqa: BLE001
        print(f"[norms export] 실패(파일 안 씀): {exc}")
        return 1
    missing = [f for f in NORM_FILES if f.removesuffix(".md") not in sources]
    if missing:
        print(f"[norms export] 실패(파일 안 씀): DB 에 없는 문서 {missing}")
        return 1
    changed = 0
    for fname in NORM_FILES:
        path = _DIR / fname
        old = path.read_text(encoding="utf-8") if path.is_file() else ""
        head = re.match(r"\s*(<!--.*?-->)", old, re.S)
        body = sources[fname.removesuffix(".md")].strip()
        new = (head.group(1) + "\n" if head else "") + body + "\n"
        if new == old:
            print(f"[norms export] {fname}: 변경 없음")
            continue
        changed += 1
        print(f"[norms export] {fname}: {'바뀔 예정' if dry_run else '갱신'} "
              f"(본문 {len(_COMMENT.sub('', old).strip())}→{len(body)}자)")
        if not dry_run:
            path.write_text(new, encoding="utf-8", newline="\n")
    print(f"[norms export] {changed}개 파일 {'변경 예정' if dry_run else '갱신'} — 갱신했다면 커밋·배포하세요")
    return 0


# 진입점은 __main__.py (python -m api.prompts [export [--dry-run]])
