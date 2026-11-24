import asyncio
import sys
sys.path.insert(0, "apps/api")

from app.core.config import settings
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    engine = create_async_engine(settings.database_url)
    async with engine.begin() as conn:
        res = (await conn.execute(text("SELECT id, email, role FROM users WHERE email='goondasai@gmail.com'"))).mappings().all()
        print("Users:", res)
        if res:
            uid = res[0]["id"]
            subs = (await conn.execute(text(f"SELECT * FROM subscriptions WHERE user_id='{uid}'"))).mappings().all()
            print("Current Subscriptions:", [dict(s) for s in subs])
            
            # Reset subscription to free tier:
            await conn.execute(text(f"""
                UPDATE subscriptions
                SET tier = 'free',
                    pages_per_month = 20,
                    cancel_at_period_end = false
                WHERE user_id = '{uid}'
            """))
            print("Updated subscription to free tier!")
            
            subs_after = (await conn.execute(text(f"SELECT * FROM subscriptions WHERE user_id='{uid}'"))).mappings().all()
            print("After update:", [dict(s) for s in subs_after])
    await engine.dispose()

asyncio.run(main())
