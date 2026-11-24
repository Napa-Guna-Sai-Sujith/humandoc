"""Job progress events over Redis pub/sub. SSE endpoints subscribe, workers publish."""
from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Any

from app.core.redis import redis_client

CHANNEL_PREFIX = "job-events:"


def channel(job_id: str) -> str:
    return f"{CHANNEL_PREFIX}{job_id}"


async def publish(job_id: str, event: dict[str, Any]) -> None:
    payload = {"job_id": job_id, **event}
    try:
        await redis_client.publish(channel(job_id), json.dumps(payload, default=str))
        await redis_client.set(f"job-last-event:{job_id}", json.dumps(payload, default=str), ex=86400)
    except Exception:
        pass


async def subscribe(job_id: str) -> AsyncIterator[dict[str, Any]]:
    pubsub = redis_client.pubsub()
    await pubsub.subscribe(channel(job_id))
    try:
        # Redis sends a subscribe confirmation first; skip non-message replies.
        while True:
            msg = await pubsub.get_message(ignore_subscribe_messages=True, timeout=1.0)
            if msg and msg["type"] == "message":
                try:
                    yield json.loads(msg["data"])
                except json.JSONDecodeError:
                    continue
            else:
                await asyncio.sleep(0.05)
    finally:
        await pubsub.unsubscribe(channel(job_id))
        await pubsub.aclose()
