import asyncio
import sys
sys.path.insert(0, "apps/api")

from app.core.config import settings
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    engine = create_async_engine(settings.database_url)
    async with engine.connect() as conn:
        users = (await conn.execute(text("SELECT id, email, name, role FROM users"))).mappings().all()
        print("All Users:", [dict(u) for u in users])
        subs = (await conn.execute(text("SELECT s.*, u.email FROM subscriptions s JOIN users u ON s.user_id=u.id"))).mappings().all()
        print("All Subscriptions with email:", [dict(s) for s in subs])
    await engine.dispose()

asyncio.run(main())
