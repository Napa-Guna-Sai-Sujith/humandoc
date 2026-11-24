import asyncio
import sys
sys.path.insert(0, "apps/api")

from app.core.config import settings
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    engine = create_async_engine(settings.database_url)
    async with engine.connect() as conn:
        job = (await conn.execute(text("SELECT * FROM jobs WHERE id='00c51983-31ba-4bdf-99ef-3ff5edfadbb8'"))).mappings().all()
        print("Job:", [dict(j) for j in job])
    await engine.dispose()

asyncio.run(main())
