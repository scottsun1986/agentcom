"""Unified response envelope helpers (RuoYi style)."""

from typing import Any


def ok(data: Any = None, msg: str = "操作成功") -> dict:
    return {"code": 200, "msg": msg, "data": data}


def created(data: Any = None, msg: str = "新增成功") -> dict:
    return {"code": 200, "msg": msg, "data": data}


def updated(data: Any = None, msg: str = "更新成功") -> dict:
    return {"code": 200, "msg": msg, "data": data}


def deleted(msg: str = "删除成功") -> dict:
    return {"code": 200, "msg": msg, "data": None}


def page(rows: list, total: int, msg: str = "查询成功") -> dict:
    return {"code": 200, "msg": msg, "rows": rows, "total": total}


def fail(code: int, msg: str) -> dict:
    return {"code": code, "msg": msg, "data": None}
