import asyncio
import sys
sys.path.insert(0, "apps/api")

from app.core.config import settings
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy import text

async def main():
    engine = create_async_engine(settings.database_url)
    async with engine.begin() as conn:
        for email in ["napagunasaisujith@gmail.com", "goondasai@gmail.com"]:
            u = (await conn.execute(text(f"SELECT id FROM users WHERE email='{email}'"))).scalar()
            if u:
                await conn.execute(text(f"""
                    UPDATE subscriptions
                    SET tier = 'free',
                        pages_per_month = 20,
                        current_period_end = NULL,
                        cancel_at_period_end = false
                    WHERE user_id = '{u}'
                """))
                print(f"Reset {email} to free plan successfully.")
    await engine.dispose()

asyncio.run(main())
