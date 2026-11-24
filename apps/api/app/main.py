from __future__ import annotations

import datetime as dt
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.db import Base, engine
from app.core.redis import close_redis
from app.routers import account, admin, health, jobs, uploads


@asynccontextmanager
async def lifespan(app: FastAPI):
    if settings.environment == "development":
        try:
            async with engine.begin() as conn:
                await conn.run_sync(Base.metadata.create_all)
        except Exception as exc:
            import logging
            logging.getLogger(__name__).warning("Schema creation warning on startup: %s", exc)
    yield
    await engine.dispose()
    try:
        await close_redis()
    except Exception:
        pass


app = FastAPI(title=settings.app_name, version="1.0.0", lifespan=lifespan, docs_url="/docs")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*", "x-csrf-token"],
)


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
    return response


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    from app.core.config import settings as s

    detail = str(exc) if s.environment == "development" else "Internal server error"
    return JSONResponse(status_code=500, content={"detail": detail})


app.include_router(health.router)
app.include_router(uploads.part_router)
app.include_router(uploads.router)
app.include_router(jobs.router)
app.include_router(account.router)
app.include_router(admin.router)


@app.get("/config")
async def public_config() -> dict:
    return {
        "max_upload_mb": settings.max_upload_mb,
        "max_pages": settings.job_max_pages,
        "retention_days": settings.retention_days,
        "tiers": settings.tiers,
        "price_per_1m_tokens": settings.price_per_1m_tokens,
        "year": dt.datetime.now().year,
    }
