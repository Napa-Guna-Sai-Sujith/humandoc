from __future__ import annotations

import contextlib
from collections.abc import AsyncIterator

from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    pass


connect_args = {}
if "pooler" in settings.database_url or "neon.tech" in settings.database_url:
    connect_args["statement_cache_size"] = 0

engine = create_async_engine(
    settings.database_url,
    connect_args=connect_args,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=20,
)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


async def get_db() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        try:
            yield session
        except Exception:
            await session.rollback()
            raise


@contextlib.asynccontextmanager
async def session_scope() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        async with session.begin():
            yield session


@contextlib.asynccontextmanager
async def worker_session_scope() -> AsyncIterator[AsyncSession]:
    """Celery tasks run in their own event loop, so they get a fresh NullPool engine."""
    from sqlalchemy.pool import NullPool

    engine = create_async_engine(settings.database_url, poolclass=NullPool, connect_args=connect_args)
    try:
        async with engine.begin() as conn:
            async with AsyncSession(bind=conn, expire_on_commit=False) as session:
                yield session
    finally:
        await engine.dispose()
