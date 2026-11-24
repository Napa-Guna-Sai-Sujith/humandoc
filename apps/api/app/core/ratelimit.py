"""Fixed-window per-key rate limiting backed by Redis."""
from __future__ import annotations

import time

from app.core.config import settings
from app.core.redis import redis_client


async def rate_limit(key: str, limit: int | None = None, window_seconds: int = 60) -> tuple[bool, int]:
    limit = limit if limit is not None else settings.rate_limit_per_minute
    try:
        rkey = f"rl:{key}:{int(time.time()) // window_seconds}"
        pipe = redis_client.pipeline()
        pipe.incr(rkey)
        pipe.expire(rkey, window_seconds)
        count, _ = await pipe.execute()
        return int(count) <= limit, max(0, limit - int(count))
    except Exception:
        return True, limit
