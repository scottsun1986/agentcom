"""Authentication and RuoYi User Session Schemas."""

from uuid import UUID
from pydantic import BaseModel, ConfigDict


class LoginRequest(BaseModel):
    username: str
    password: str


class LoginResponse(BaseModel):
    token: str
    token_type: str = "Bearer"
    expires_in: int = 86400


class UserInfoDept(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    dept_id: UUID
    dept_name: str
    leader: str | None = None


class UserInfo(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    user_id: UUID
    dept_id: UUID | None = None
    user_name: str
    nick_name: str
    email: str | None = None
    phonenumber: str | None = None
    sex: str | None = "0"
    avatar: str | None = None
    status: str = "0"
    department: UserInfoDept | None = None


class GetInfoResponse(BaseModel):
    user: UserInfo
    roles: list[str]
    permissions: list[str]
    data_scope: str = "1"


class RouterItem(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    menu_id: UUID
    menu_name: str
    parent_id: UUID | None = None
    top_category: str | None = None
    path: str | None = None
    component: str | None = None
    menu_type: str
    perms: str | None = None
    icon: str | None = None
    order_num: int = 0
    visible: str = "0"
    status: str = "0"
    children: list["RouterItem"] = []
