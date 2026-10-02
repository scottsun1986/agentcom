"""Unified API error types and FastAPI exception handlers."""

import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

logger = logging.getLogger("agentcom.errors")


class ApiError(Exception):
    """Business error rendered as the unified `{code, msg}` envelope."""

    def __init__(self, code: int = 500, msg: str = "操作失败", data: object = None):
        self.code = code
        self.msg = msg
        self.data = data
        super().__init__(msg)


def envelope(code: int, msg: str, data: object = None) -> dict:
    return {"code": code, "msg": msg, "data": data}


def register_exception_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def api_error_handler(_: Request, exc: ApiError):
        return JSONResponse(status_code=exc.code, content=envelope(exc.code, exc.msg, exc.data))

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        loc = ".".join(str(p) for p in first.get("loc", []) if p not in ("body",))
        msg = f"参数校验失败: {loc} {first.get('msg', '')}".strip()
        return JSONResponse(status_code=400, content=envelope(400, msg))

    @app.exception_handler(Exception)
    async def unhandled_error_handler(request: Request, exc: Exception):
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        return JSONResponse(status_code=500, content=envelope(500, "服务器内部错误"))
