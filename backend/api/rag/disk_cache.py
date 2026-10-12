"""
기동 적재 디스크 캐시 (Supabase egress 대응, 10/12 — docs/doing/261012_Supabase_egress초과_진단_및_대응.md §4)

서버가 기동할 때마다 운영 DB 에서 4096차원 벡터 전량(법령 7,613 + KB3 5,101행)을 텍스트로 받아 재시작 1회에 674MB 가
나갔다(10/10 하루 약 10GB, 주기 한도 5GB 의 293%). 이제 DB 에서는 **지문 한 줄**(행 수·최대 updated_at·해시)만 받고,
지문이 같으면 서버 디스크에서 읽는다. 다르거나 캐시가 없으면 DB 에서 받아(벡터는 바이너리 커서) 원자적으로 기록한다.

캐시 위치: VEC_CACHE_DIR (기본 backend/.cache/vec/, git 제외). 파일: {name}.npy(행렬, 없을 수 있음) · {name}.pkl(행 메타)
· {name}.fp(지문 — 맨 마지막에 써서 쓰다 만 캐시는 지문 불일치로 버려진다).
"""

from __future__ import annotations

import logging
import os
import pickle
import time
from pathlib import Path
from typing import Any, Callable, Optional

log = logging.getLogger("disk_cache")

_DEFAULT_DIR = Path(__file__).resolve().parents[2] / ".cache" / "vec"


def cache_dir() -> Path:
    d = Path(os.environ.get("VEC_CACHE_DIR") or _DEFAULT_DIR)
    d.mkdir(parents=True, exist_ok=True)
    return d


def fingerprint(cur, sql: str, params: tuple = ()) -> str:
    cur.execute(sql, params)
    return "|".join("" if v is None else str(v) for v in cur.fetchone())


def _paths(name: str) -> tuple[Path, Path, Path]:
    d = cache_dir()
    return d / f"{name}.npy", d / f"{name}.pkl", d / f"{name}.fp"


def _drop(name: str) -> None:
    for p in _paths(name):
        try:
            p.unlink()
        except FileNotFoundError:
            pass


def load(name: str, fp: str) -> Optional[tuple[Any, Any]]:
    """(meta, matrix|None) — 지문이 같을 때만. 깨진 캐시는 지우고 None."""
    npy, pkl, fpp = _paths(name)
    try:
        if not fpp.exists() or fpp.read_text(encoding="utf-8") != fp:
            return None
        with pkl.open("rb") as f:
            meta = pickle.load(f)
        mat = None
        if npy.exists():
            import numpy as np

            mat = np.load(npy)
        return meta, mat
    except Exception as exc:  # noqa: BLE001
        log.warning("디스크 캐시 %s 깨짐 — 지우고 DB 에서 받음: %s", name, exc)
        _drop(name)
        return None


def save(name: str, fp: str, meta: Any, mat=None) -> None:
    """원자적 기록 — 각 파일을 임시 이름에 쓰고 os.replace, 지문 파일은 맨 마지막."""
    npy, pkl, fpp = _paths(name)
    try:
        fpp.unlink(missing_ok=True)           # 쓰는 도중 죽으면 지문이 없어 다음 기동에 다시 받는다
        if mat is not None:
            import numpy as np

            tmp = npy.with_name(npy.name + ".tmp")
            with tmp.open("wb") as f:
                np.save(f, mat)
            os.replace(tmp, npy)
        elif npy.exists():
            npy.unlink()
        tmp = pkl.with_name(pkl.name + ".tmp")
        with tmp.open("wb") as f:
            pickle.dump(meta, f, protocol=pickle.HIGHEST_PROTOCOL)
        os.replace(tmp, pkl)
        tmp = fpp.with_name(fpp.name + ".tmp")
        tmp.write_text(fp, encoding="utf-8")
        os.replace(tmp, fpp)
    except Exception as exc:  # noqa: BLE001 — 캐시 기록 실패는 다음 기동에 다시 받을 뿐
        log.warning("디스크 캐시 %s 기록 실패: %s", name, exc)


def cached(name: str, fp: str, fetch: Callable[[], tuple[Any, Any]]) -> tuple[Any, Any, str]:
    """(meta, matrix, 출처 'cache'|'db'). fetch() 는 DB 에서 (meta, matrix) 를 받아 온다."""
    t = time.time()
    hit = load(name, fp)
    if hit is not None:
        log.warning("기동 적재 %s: cache %.1f초", name, time.time() - t)
        return hit[0], hit[1], "cache"
    meta, mat = fetch()
    save(name, fp, meta, mat)
    log.warning("기동 적재 %s: db %.1f초", name, time.time() - t)
    return meta, mat, "db"
