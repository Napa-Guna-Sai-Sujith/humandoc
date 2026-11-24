import asyncio
import sys
import mimetypes
from pathlib import Path
sys.path.insert(0, "apps/api")

from app.core.config import settings
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    engine = create_async_engine(settings.database_url)
    storage_dir = Path("E:/tmp/humandoc/storage")
    
    async with engine.begin() as conn:
        for p in storage_dir.rglob("*"):
            if p.is_file():
                rel_key = p.relative_to(storage_dir).as_posix()
                content = p.read_bytes()
                mime, _ = mimetypes.guess_type(p.name)
                mime = mime or "application/octet-stream"
                size = len(content)
                
                await conn.execute(
                    text("""
                        INSERT INTO stored_files (key, content, content_type, size)
                        VALUES (:key, :content, :content_type, :size)
                        ON CONFLICT (key) DO UPDATE
                        SET content = EXCLUDED.content,
                            content_type = EXCLUDED.content_type,
                            size = EXCLUDED.size
                    """),
                    {"key": rel_key, "content": content, "content_type": mime, "size": size}
                )
                print(f"Synced {rel_key} ({size} bytes, {mime})")
                
    await engine.dispose()

asyncio.run(main())
