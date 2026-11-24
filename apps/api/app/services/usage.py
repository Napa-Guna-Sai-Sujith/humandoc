"""Quota + metering. Period is a calendar month (UTC)."""
from __future__ import annotations

import datetime as dt

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models import Subscription, UsageRecord


def current_period(now: dt.datetime | None = None) -> str:
    return (now or dt.datetime.now(dt.UTC)).strftime("%Y-%m")


async def get_entitlement(db: AsyncSession, user_id) -> dict:
    sub = await db.scalar(select(Subscription).where(Subscription.user_id == user_id))
    if not sub or sub.status != "active":
        return {"tier": "free", "pages_per_month": settings.tier_free_pages}
    return {
        "tier": sub.tier,
        "pages_per_month": sub.pages_per_month,
        "current_period_end": sub.current_period_end.isoformat() if sub.current_period_end else None,
        "cancel_at_period_end": sub.cancel_at_period_end,
    }


async def pages_used(db: AsyncSession, user_id, period: str | None = None) -> int:
    period = period or current_period()
    total = await db.scalar(
        select(func.coalesce(func.sum(UsageRecord.pages), 0)).where(
            UsageRecord.user_id == user_id, UsageRecord.period == period
        )
    )
    return int(total or 0)


async def words_used(db: AsyncSession, user_id, period: str | None = None) -> int:
    period = period or current_period()
    total = await db.scalar(
        select(func.coalesce(func.sum(UsageRecord.words), 0)).where(
            UsageRecord.user_id == user_id, UsageRecord.period == period
        )
    )
    return int(total or 0)


async def check_quota(db: AsyncSession, user_id, requested_pages: int) -> tuple[bool, dict]:
    entitlement = await get_entitlement(db, user_id)
    used = await pages_used(db, user_id)
    remaining = max(0, entitlement["pages_per_month"] - used)
    return remaining >= requested_pages, {**entitlement, "pages_used": used, "pages_remaining": remaining}


async def record_usage(db: AsyncSession, user_id, pages: int, words: int, tokens: int = 0) -> None:
    period = current_period()
    existing = await db.scalar(
        select(UsageRecord).where(UsageRecord.user_id == user_id, UsageRecord.period == period)
    )
    if existing:
        existing.pages += pages
        existing.words += words
        existing.tokens += tokens
    else:
        db.add(UsageRecord(user_id=user_id, period=period, pages=pages, words=words, tokens=tokens))
    await db.commit()
