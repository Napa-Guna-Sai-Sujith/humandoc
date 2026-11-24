from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.db import get_db
from app.core.redis import redis_client

router = APIRouter(tags=["health"])


@router.get("/health")
async def health() -> dict:
    return {"status": "ok", "service": "humandoc-api"}


@router.get("/ready")
async def ready(db: AsyncSession = Depends(get_db)) -> dict:
    checks: dict[str, str] = {}
    try:
        await db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception as exc:
        checks["database"] = f"error: {exc.__class__.__name__}"
    try:
        await redis_client.ping()
        checks["redis"] = "ok"
    except Exception as exc:
        checks["redis"] = f"error: {exc.__class__.__name__}"
    return {"status": "ok" if all(v == "ok" for v in checks.values()) else "degraded", "checks": checks}
