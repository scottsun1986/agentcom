"""Pytest fixtures: seeded database, authenticated API clients, MCP helper."""

import asyncio
import uuid

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient

from app.database import async_session_factory
from app.mcp.server import MCP
from app.services.seed import DEMO_AGENT_SECRET, _seed, conn_run_drop

BASE = "http://testserver"


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def seeded_db():
    """Reset schema and seed demo data once for the whole session."""
    async with async_session_factory() as db:
        await conn_run_drop(db)
    async with async_session_factory() as db:
        async with db.begin():
            await _seed(db)
    yield True


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def client(seeded_db):
    """HTTPX async client wired to the ASGI app (REST only)."""
    transport = ASGITransport(app=app_factory())
    async with AsyncClient(transport=transport, base_url=BASE, timeout=30) as c:
        yield c


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def mcp_ready():
    """Start the MCP streamable-HTTP session manager once for the whole session.
    The SDK forbids re-running a manager after exit, and anyio scopes are
    task-affine, so we enter once and intentionally never exit (process exit
    reclaims it). All MCP transport tests can then share the live manager."""
    import anyio

    cm = MCP.session_manager.run()
    await cm.__aenter__()
    await anyio.sleep(0)  # let the internal task group fully start
    yield
    # intentionally never __aexit__: the SDK forbids manager reuse after exit,
    # and cross-task exit would raise; process teardown reclaims it.


from contextlib import asynccontextmanager


@asynccontextmanager
async def mcp_session(client):
    """No-op passthrough kept for API compatibility: the manager is started
    once per session by the `mcp_ready` fixture."""
    yield client


async def user_id_of(client: AsyncClient, headers: dict, keyword: str) -> str:
    r = await client.get("/api/contacts/employees", headers=headers, params={"keyword": keyword})
    return r.json()["rows"][0]["user_id"]


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def uid(client, admin_headers):
    """Map of display name -> user_id."""
    async def _uid(name: str) -> str:
        return await user_id_of(client, admin_headers, name)
    return _uid


def app_factory():
    from app.main import app
    return app


async def login(client: AsyncClient, username: str, password: str = "admin123") -> dict:
    r = await client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    return {"Authorization": f"Bearer {data['token']}"}


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def admin_headers(client):
    return await login(client, "admin")


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def zhang_headers(client):
    """张明 - 综合办公室主任 / dept_leader role, data scope 4."""
    return await login(client, "zhangming")


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def staff_headers(client):
    """李华 - 普通员工, data scope 5 (仅本人)."""
    return await login(client, "lihua")


# 标准单 Secret 模式：Authorization: Bearer <Agent Secret>
AGENT_CRED = {"Authorization": f"Bearer {DEMO_AGENT_SECRET}"}


@pytest_asyncio.fixture(scope="session", loop_scope="session")
async def agent_headers():
    return dict(AGENT_CRED)


async def jsonrpc(client: AsyncClient, method: str, params: dict | None = None, id_: int = 1, headers: dict | None = None) -> dict:
    """Single-shot JSON-RPC call over streamable HTTP (stateless mode)."""
    payload = {"jsonrpc": "2.0", "id": id_, "method": method}
    if params is not None:
        payload["params"] = params
    h = dict(AGENT_CRED)
    if headers:
        h.update(headers)
    r = await client.post("/mcp", json=payload, headers={
        **h, "Accept": "application/json, text/event-stream",
    })
    text = r.text
    if "data:" in text:
        for line in text.splitlines():
            if line.startswith("data:"):
                import json as _json
                return _json.loads(line[5:].strip())
    import json as _json
    return _json.loads(text)


async def get_first(client: AsyncClient, headers: dict, path: str, **params) -> dict:
    r = await client.get(path, headers=headers, params=params)
    assert r.status_code == 200, r.text
    return r.json()["rows"][0]
