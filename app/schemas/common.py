"""Common schemas for API responses and pagination."""

from typing import Generic, TypeVar
from pydantic import BaseModel, ConfigDict

T = TypeVar("T")


class ApiResponse(BaseModel, Generic[T]):
    code: int = 200
    msg: str = "操作成功"
    data: T | None = None


class PageResult(BaseModel, Generic[T]):
    total: int
    rows: list[T]
    code: int = 200
    msg: str = "查询成功"
