"""Write-operation audit middleware: records POST/PUT/DELETE on /api into sys_oper_log.
Fulfils PRD §8.4 全方位操作审计 (等保三级) — every user/agent write is traceable."""

import logging
import time

from starlette.types import ASGIApp, Receive, Scope, Send

logger = logging.getLogger("agentcom.audit")

_AUDIT_PREFIX = "/api/"
_WRITE_METHODS = {"POST", "PUT", "DELETE", "PATCH"}
# endpoints excluded to avoid noise/secrets
_SKIP_PATHS = ("/api/auth/login", "/api/auth/logout")


class AuditMiddleware:
    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send):
        if scope["type"] != "http" or scope.get("method") not in _WRITE_METHODS:
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        if not path.startswith(_AUDIT_PREFIX) or any(path.startswith(p) for p in _SKIP_PATHS):
            await self.app(scope, receive, send)
            return

        start = time.perf_counter()
        status_holder = {"code": 500}

        async def send_wrapper(message):
            if message["type"] == "http.response.start":
                status_holder["code"] = message["status"]
            await send(message)

        # capture identity headers BEFORE app runs (scope headers are mutable)
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        auth = headers.get("authorization", "")
        app_id = headers.get("x-app-id", "")

        try:
            await self.app(scope, receive, send_wrapper)
        finally:
            cost_ms = int((time.perf_counter() - start) * 1000)
            try:
                import asyncio
                asyncio.get_running_loop().create_task(
                    _write_log(scope, path, headers, auth, app_id, status_holder["code"], cost_ms)
                )
            except Exception:
                logger.exception("audit log dispatch failed")

async def _write_log(scope, path, headers, auth, app_id, status, cost_ms):
    """Best-effort audit insert in its own task/session; never raises."""
    from datetime import datetime, timezone

    from sqlalchemy import insert
    from app.database import async_session_factory
    from app.models.system import SysOperLog

    oper_name = "agent:" + app_id if app_id else ("jwt:" + auth[7:15] + "…" if auth.startswith("Bearer ") else "anonymous")
    segments = [s for s in path.split("/") if s]  # ['api', module, ...]
    title = "/".join(segments[1:3]) if len(segments) >= 3 else path
    try:
        async with async_session_factory() as db:
            async with db.begin():
                await db.execute(insert(SysOperLog).values(
                    title=title,
                    business_type="3" if scope.get("method") == "DELETE" else "2",
                    method=scope.get("method", "") + " " + path,
                    request_method=scope.get("method", ""),
                    oper_name=oper_name,
                    oper_url=path,
                    oper_ip=(scope.get("client")[0] if scope.get("client") else "") or "",
                    oper_param="",
                    json_result="",
                    status=0 if status < 400 else 1,
                    cost_time=cost_ms,
                    oper_time=datetime.now(timezone.utc),
                ))
    except Exception:
        logger.exception("audit log write failed for %s", path)
