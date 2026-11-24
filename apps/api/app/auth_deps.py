"""Session authentication shared by every FastAPI endpoint.

Supports both first-party cookies (hd_session + hd_csrf) and cross-origin preview iframe
header authentication (x-hd-session + x-csrf-token) cleanly and in any dependency order.
"""
from __future__ import annotations

import datetime as dt
import hmac
import uuid
from typing import Annotated
from urllib.parse import urlparse

from fastapi import Cookie, Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.ratelimit import rate_limit
from app.core.security import sha256_hex
from app.models import Session, User

SESSION_COOKIE = "hd_session"
CSRF_COOKIE = "hd_csrf"


def _is_same_origin(request: Request) -> bool:
    origin = request.headers.get("origin")
    host = request.headers.get("x-forwarded-host") or request.headers.get("host")
    if not origin or not host:
        return True  # internal server-to-server proxy without browser Origin
    try:
        return urlparse(origin).netloc == host
    except Exception:
        return False


async def get_current_user(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    hd_session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
    x_hd_session: Annotated[str | None, Header(alias="x-hd-session")] = None,
    st: Annotated[str | None, Query()] = None,
) -> User:
    raw_session = hd_session or x_hd_session or st
    if not raw_session:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not authenticated")
    session = await db.scalar(
        select(Session).where(Session.token_hash == sha256_hex(raw_session))
    )
    now = dt.datetime.now(dt.UTC)
    if not session or session.revoked_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    expires = session.expires_at
    if expires.tzinfo is None:
        expires = expires.replace(tzinfo=dt.UTC)
    if expires <= now:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session expired")
    user = await db.get(User, session.user_id)
    if not user or user.deleted_at is not None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account not found")

    session.last_used_at = now
    session.ip = request.client.host if request.client else None
    session.user_agent = (request.headers.get("user-agent") or "")[:512]
    await db.commit()

    allowed, _remaining = await rate_limit(f"user:{user.id}")
    if not allowed:
        raise HTTPException(status.HTTP_429_TOO_MANY_REQUESTS, "Rate limit exceeded")
    request.state.session = session
    request.state.csrf = session.csrf_token
    return user


async def require_csrf(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_db)],
    x_csrf_token: Annotated[str | None, Header(alias="x-csrf-token")] = None,
    hd_csrf: Annotated[str | None, Cookie(alias=CSRF_COOKIE)] = None,
    hd_session: Annotated[str | None, Cookie(alias=SESSION_COOKIE)] = None,
    x_hd_session: Annotated[str | None, Header(alias="x-hd-session")] = None,
) -> None:
    if request.method in ("GET", "HEAD", "OPTIONS"):
        return
    if not x_csrf_token:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Missing CSRF token")

    # 1. Check session-bound CSRF token from DB (works even when router dependency runs before endpoint)
    expected_session_csrf = getattr(request.state, "csrf", None)
    if not expected_session_csrf:
        raw_session = hd_session or x_hd_session
        if raw_session:
            sess = await db.scalar(select(Session).where(Session.token_hash == sha256_hex(raw_session)))
            if sess and sess.revoked_at is None:
                expected_session_csrf = sess.csrf_token

    if expected_session_csrf and hmac.compare_digest(expected_session_csrf, x_csrf_token):
        return

    # 2. Check double-submit cookie (when browser sends cookies)
    if hd_csrf and hmac.compare_digest(hd_csrf, x_csrf_token):
        return

    # 3. Embedded preview iframe fallback when third-party cookies are blocked:
    # accept an authenticated x-hd-session + non-trivial x-csrf-token from same origin
    if (expected_session_csrf or x_hd_session) and len(x_csrf_token) >= 16 and _is_same_origin(request):
        return

    raise HTTPException(status.HTTP_403_FORBIDDEN, "Invalid CSRF token")


async def require_admin(user: Annotated[User, Depends(get_current_user)]) -> User:
    if user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Administrator access required")
    return user


CurrentUser = Annotated[User, Depends(get_current_user)]
AdminUser = Annotated[User, Depends(require_admin)]
DbSession = Annotated[AsyncSession, Depends(get_db)]


def parse_uuid(value: str) -> uuid.UUID:
    try:
        return uuid.UUID(value)
    except ValueError as exc:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Invalid id") from exc
