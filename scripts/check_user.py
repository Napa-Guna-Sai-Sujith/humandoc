import asyncio
import sys
sys.path.insert(0, "apps/api")

from app.core.config import settings
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    engine = create_async_engine(settings.database_url)
    async with engine.connect() as conn:
        res = (await conn.execute(text("SELECT id, email, tier FROM users WHERE email='goondasai@gmail.com'"))).mappings().all()
        print("Users:", res)
        if res:
            uid = res[0]["id"]
            subs = (await conn.execute(text(f"SELECT * FROM subscriptions WHERE user_id='{uid}'"))).mappings().all()
            print("Subscriptions:", [dict(s) for s in subs])
    await engine.dispose()

asyncio.run(main())
