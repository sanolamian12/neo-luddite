"""
Seam A 인증 — Supabase JWT 검증 → public.profiles 로 신원·역할을 **서버가** 결정한다
(KB통합 3층검색 로드맵 P6 ①, 2026-09-17).

왜: 지금까지 쓰기 API 는 신원을 요청 본문(editorId·confirmerId·adminId…)으로 받았다.
그러면 규범 "세무사 3명 승인"도 본문만 바꿔 위조할 수 있다 → 거버넌스 전에 인증이 1순위.

방식:
- 프론트는 이미 Supabase Auth 로 로그인한다 → 서비스 호출에 `Authorization: Bearer <access_token>`.
- 이 프로젝트 Supabase 는 비대칭 서명(ES256)이라 공유 시크릿 없이 JWKS 공개키로 로컬 검증한다
  (`<SUPABASE_URL>/auth/v1/.well-known/jwks.json`, PyJWKClient 가 캐시).
- `sub`(auth.users.id) → public.profiles(id) → domain_id·role.

범위(사용자 결정 2026-09-17): **쓰기 API 전체, 챗 제외.** GET/HEAD/OPTIONS 와 /api/chat·/health 는 통과.

AUTH_MODE(서버 .env):
- `optional`(과도기) — 토큰이 있으면 검증(틀리면 401)하고 신원을 토큰으로 덮는다. 없으면 기존 동작.
- `required` — 쓰기 요청에 유효한 토큰 + auditor/admin 역할이 없으면 401/403.
구 프론트가 깨지지 않게 optional 로 먼저 배포 → 새 프론트 배포 → required 로 전환하는 2단계 배포용.
로컬 우회 플래그는 두지 않는다 — 스크립트는 `python -m scripts.dev_token <username>` 으로 토큰을 받는다.
"""

from __future__ import annotations

import logging
import os
import threading
import time
from dataclasses import dataclass
from typing import Optional

from fastapi import Request
from fastapi.responses import JSONResponse

log = logging.getLogger("api.auth")

# 인증 없이 통과하는 쓰기 경로 — 챗은 손님(viewer) 경로라 이번 범위 밖(사용자 결정).
PUBLIC_WRITE_PATHS = ("/api/chat",)
# admin 전용 쓰기 — 화면이 /admin 에만 있는 것들. 나머지 쓰기는 auditor·admin.
ADMIN_ONLY_PREFIXES = ("/admin/",)
ADMIN_ONLY_PATHS = ("/api/rag/toggle", "/api/rag/reclassify-tax-categories", "/api/rag/retract")
ADMIN_ONLY_SUFFIXES = ("/approve", "/reject")  # /api/rag/edits/{id}/approve|reject

WRITE_ROLES = ("auditor", "admin")
_PROFILE_TTL_SEC = 60


@dataclass(frozen=True)
class AuthUser:
    user_id: str  # auth.users.id (JWT sub)
    domain_id: str  # 도메인 신원 — auditor_id·editorId 등과 같은 키
    role: str  # viewer | auditor | admin


class AuthError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


def auth_mode() -> str:
    mode = os.environ.get("AUTH_MODE", "optional").strip().lower()
    return mode if mode in ("optional", "required") else "optional"


def _supabase_url() -> str:
    url = os.environ.get("SUPABASE_URL", "").strip().rstrip("/")
    if not url:
        raise AuthError(503, "SUPABASE_URL 미설정 — 토큰을 검증할 수 없습니다")
    return url


_jwks_client = None
_jwks_lock = threading.Lock()


def _jwks():
    global _jwks_client
    with _jwks_lock:
        if _jwks_client is None:
            from jwt import PyJWKClient

            _jwks_client = PyJWKClient(f"{_supabase_url()}/auth/v1/.well-known/jwks.json", cache_keys=True,
                                       lifespan=3600, timeout=5)
        return _jwks_client


def verify_token(token: str) -> str:
    """서명·만료·발급자·audience 를 검증하고 sub 를 돌려준다."""
    import jwt

    try:
        key = _jwks().get_signing_key_from_jwt(token).key
        claims = jwt.decode(
            token, key, algorithms=["ES256", "RS256"], audience="authenticated",
            issuer=f"{_supabase_url()}/auth/v1",
        )
    except jwt.ExpiredSignatureError as exc:
        raise AuthError(401, "토큰 만료 — 다시 로그인하세요") from exc
    except jwt.PyJWKClientError as exc:
        log.warning("JWKS 조회 실패: %s", exc)
        raise AuthError(401, "토큰 서명 키를 확인할 수 없습니다") from exc
    except jwt.InvalidTokenError as exc:
        raise AuthError(401, f"유효하지 않은 토큰: {exc}") from exc
    sub = claims.get("sub")
    if not sub:
        raise AuthError(401, "토큰에 sub 가 없습니다")
    return sub


_profile_cache: dict[str, tuple[float, Optional[tuple[str, str]]]] = {}


def _lookup_profile(user_id: str) -> Optional[tuple[str, str]]:
    hit = _profile_cache.get(user_id)
    if hit and time.monotonic() - hit[0] < _PROFILE_TTL_SEC:
        return hit[1]
    import psycopg

    from api.rag.kb2_store import _db_url

    with psycopg.connect(_db_url(), autocommit=True, connect_timeout=5) as conn, conn.cursor() as cur:
        cur.execute("select domain_id, role::text from public.profiles where id = %s", (user_id,))
        row = cur.fetchone()
    value = (row[0], row[1]) if row else None
    _profile_cache[user_id] = (time.monotonic(), value)
    return value


def authenticate(authorization: Optional[str]) -> Optional[AuthUser]:
    """Authorization 헤더 → AuthUser. 헤더가 없으면 None, 있는데 틀리면 AuthError."""
    if not authorization:
        return None
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise AuthError(401, "Authorization 헤더는 'Bearer <token>' 형식이어야 합니다")
    user_id = verify_token(token.strip())
    profile = _lookup_profile(user_id)
    if profile is None:
        raise AuthError(403, "프로필이 없는 계정입니다")
    return AuthUser(user_id=user_id, domain_id=profile[0], role=profile[1])


def _needs_auth(method: str, path: str) -> bool:
    if method in ("GET", "HEAD", "OPTIONS"):
        return False
    return path not in PUBLIC_WRITE_PATHS


def _admin_only(path: str) -> bool:
    if path.startswith(ADMIN_ONLY_PREFIXES) or path in ADMIN_ONLY_PATHS:
        return True
    return path.startswith("/api/rag/edits/") and path.endswith(ADMIN_ONLY_SUFFIXES)


def required_roles(path: str) -> tuple[str, ...]:
    return ("admin",) if _admin_only(path) else WRITE_ROLES


async def auth_middleware(request: Request, call_next):
    """쓰기 요청의 신원을 request.state.user 에 싣는다(없으면 None)."""
    request.state.user = None
    if not _needs_auth(request.method, request.url.path):
        return await call_next(request)
    try:
        user = authenticate(request.headers.get("authorization"))
        if user is None and auth_mode() == "required":
            raise AuthError(401, "로그인이 필요합니다(Authorization: Bearer <token>)")
        if user is not None:
            roles = required_roles(request.url.path)
            if user.role not in roles:
                raise AuthError(403, f"권한 없음 — {'/'.join(roles)} 만 가능합니다(현재 {user.role})")
    except AuthError as exc:
        return _error(request, exc.status, exc.detail)
    request.state.user = user
    return await call_next(request)


def _error(request: Request, status: int, detail: str) -> JSONResponse:
    # 미들웨어 응답도 CORS 헤더가 있어야 프론트가 401/403 을 실제로 본다(main.py 500 핸들러와 같은 이유).
    from api.main import _CORS_ORIGINS

    headers: dict[str, str] = {}
    origin = request.headers.get("origin")
    if origin and origin in _CORS_ORIGINS:
        headers["Access-Control-Allow-Origin"] = origin
        headers["Vary"] = "Origin"
    return JSONResponse(status_code=status, content={"detail": detail}, headers=headers)


def actor(request: Request, claimed: Optional[str]) -> str:
    """이 요청의 행위자 domain_id. 인증됐으면 토큰 신원이 이긴다(본문 값은 무시), 과도기에
    토큰이 없으면 본문 값을 그대로 쓴다. 기여 귀속(ingest 의 auditorId 등)에는 쓰지 말 것 —
    그건 '누가 눌렀나'가 아니라 '누가 썼나'다."""
    user: Optional[AuthUser] = getattr(request.state, "user", None)
    if user is not None:
        return user.domain_id
    return claimed or ""
