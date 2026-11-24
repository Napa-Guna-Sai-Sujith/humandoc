import asyncio
import sys
sys.path.insert(0, "apps/api")

from app.core.config import settings
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    engine = create_async_engine(settings.database_url)
    async with engine.begin() as conn:
        await conn.execute(text("""
            CREATE TABLE IF NOT EXISTS stored_files (
                key VARCHAR(512) PRIMARY KEY,
                content BYTEA NOT NULL,
                content_type VARCHAR(128) NOT NULL DEFAULT 'application/octet-stream',
                size BIGINT NOT NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        """))
        await conn.execute(text("""
            CREATE INDEX IF NOT EXISTS ix_stored_files_created ON stored_files (created_at)
        """))
        print("Table stored_files created successfully!")
    await engine.dispose()

asyncio.run(main())
