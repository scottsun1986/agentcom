"""AgentCom FastAPI application assembly."""

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.config import get_settings
from app.core.errors import register_exception_handlers

settings = get_settings()
logging.basicConfig(level=settings.log_level.upper(), format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("agentcom")


@asynccontextmanager
async def lifespan(app: FastAPI):
    from app.database import init_db
    from app.mcp.server import MCP
    await init_db()
    # Streamable HTTP session manager must run for the lifetime of the server
    async with MCP.session_manager.run():
        logger.info("AgentCom started (MCP: /mcp, SSE: /sse), listening %s:%s", settings.host, settings.port)
        yield
    logger.info("AgentCom shutdown")


def create_app() -> FastAPI:
    from app.routers import (
        assets, attendance, auth, conference, contacts, fleet, knowledge,
        portal, research, supervision, system, visitor,
    )
    from app.mcp.server import build_mcp_apps

    app = FastAPI(
        title="AgentCom 企业与政务协同办公管理平台",
        version="1.0.0",
        description="OpenAPI + MCP 双协议政企协同办公平台（若依 RBAC · 十大业务域闭环）",
        lifespan=lifespan,
    )
    register_exception_handlers(app)

    from app.core.audit import AuditMiddleware
    app.add_middleware(AuditMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"], allow_credentials=True,
        allow_methods=["*"], allow_headers=["*", "X-App-ID", "X-App-Secret", "Authorization"],
        expose_headers=["*"],
    )

    for router in (auth.router, portal.router, attendance.router, assets.router, supervision.router,
                   conference.router, contacts.router, visitor.router, fleet.router, research.router,
                   knowledge.router, system.router):
        app.include_router(router)

    # static SPA
    app.mount("/static", StaticFiles(directory="static"), name="static")

    @app.get("/", include_in_schema=False)
    async def index():
        return FileResponse("static/index.html")

    @app.get("/favicon.ico", include_in_schema=False)
    async def favicon():
        return FileResponse("static/favicon.svg", media_type="image/svg+xml")

    @app.get("/healthz", tags=["运维"])
    async def healthz():
        return {"status": "ok", "service": "agentcom", "port": settings.port}

    # MCP transports (streamable HTTP + legacy SSE), guarded by agent credentials.
    # Registered as root-level ASGI routes: the sub-apps define /mcp, /sse and
    # /messages/ internally (Mount would strip prefixes and break exact matches).
    from starlette.routing import Route
    http_mcp_app, sse_mcp_app = build_mcp_apps()
    app.state.http_mcp_app = http_mcp_app
    app.router.routes.append(Route("/mcp", http_mcp_app, methods=["GET", "POST", "DELETE"]))
    app.router.routes.append(Route("/sse", sse_mcp_app, methods=["GET"]))
    app.router.routes.append(Route("/messages/", sse_mcp_app, methods=["POST"]))
    app.router.routes.append(Route("/messages/{rest:path}", sse_mcp_app, methods=["POST"]))

    return app


app = create_app()
