import asyncio
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

async def main(keep: bool):
    from app.database import async_session_factory, init_db
    from app.services.seed import _seed, conn_run_drop

    if not keep:
        print("Dropping & recreating schema ...")
        async with async_session_factory() as db:
            await conn_run_drop(db)
    await init_db()
    print("Seeding demo data ...")
    async with async_session_factory() as db:
        async with db.begin():
            await _seed(db)
    print("Seed complete: admin/admin123, zhangming/admin123, agent MCP 凭据 agentcom-demo / agentcom-demo-secret-2026")


if __name__ == "__main__":
    asyncio.run(main("--keep" in sys.argv))
