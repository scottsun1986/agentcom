"""FastAPI dependencies: dual-mode auth (human JWT / Agent App credential),
RuoYi permission checks and 5-level data-scope filtering."""

import uuid
from dataclasses import dataclass, field
from typing import Any

import jwt as pyjwt
from fastapi import Depends, Request
from sqlalchemy import Select, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import ApiError
from app.core.security import decode_token
from app.database import get_db
from app.models.system import (
    DataScope,
    SysAppCredential,
    SysDept,
    SysMenu,
    SysRole,
    SysUser,
    sys_user_role,
)
from app.core.security import verify_password

_READ_ACTIONS = {"list", "get", "query", "search", "export", "stats", "dashboard", "tree", "view", "calendar"}
_WRITE_ACTIONS = {
    "add", "create", "apply", "edit", "update", "del", "remove", "submit", "clock",
    "book", "dispatch", "return", "scan", "push", "cancel", "convert", "register",
    "invite", "checkin", "checkout", "transfer", "scrap", "report", "issue", "urging",
}
_AUDIT_ACTIONS = {"audit", "approve", "reject", "closeout", "verify"}

ACTION_CLASS = {}
for _a in _READ_ACTIONS:
    ACTION_CLASS[_a] = "read"
for _a in _WRITE_ACTIONS:
    ACTION_CLASS[_a] = "write"
for _a in _AUDIT_ACTIONS:
    ACTION_CLASS[_a] = "audit"


@dataclass
class Principal:
    """Authenticated caller: either a human user (JWT) or an Agent (app credential)."""

    auth_kind: str  # "user" | "agent"
    user: SysUser | None = None
    agent: SysAppCredential | None = None
    roles: list[str] = field(default_factory=list)          # role keys
    permissions: set[str] = field(default_factory=set)     # perm strings
    data_scope: str = "1"
    scopes: set[str] = field(default_factory=set)           # agent scopes

    @property
    def user_id(self) -> uuid.UUID | None:
        return self.user.user_id if self.user else None

    @property
    def dept_id(self) -> uuid.UUID | None:
        return self.user.dept_id if self.user else None

    @property
    def display_name(self) -> str:
        if self.user:
            return self.user.nick_name
        return self.agent.app_name if self.agent else "unknown"

    @property
    def is_admin(self) -> bool:
        return "admin" in self.roles

    def has_perm(self, perm: str) -> bool:
        if self.auth_kind == "user":
            if self.is_admin or "*:*:*" in self.permissions:
                return True
            if perm in self.permissions:
                return True
            # wildcard support: "attendance:*:*"
            parts = perm.split(":")
            if len(parts) == 3:
                m, e, a = parts
                for p in self.permissions:
                    pp = p.split(":")
                    if len(pp) == 3 and pp[0] == m and (pp[1] == e or pp[1] == "*") and (pp[2] == a or pp[2] == "*"):
                        return True
            return False
        # agent scope check
        if not self.agent or not self.agent.is_active:
            return False
        if "*" in self.scopes:
            return True
        parts = perm.split(":")
        module, action = parts[0], (parts[2] if len(parts) == 3 else parts[-1])
        for scope in self.scopes:
            if scope == perm:
                return True
            if ":" not in scope:
                continue
            sm, sa = scope.split(":", 1)
            if sm != module:
                continue
            if sa in ("admin", "*", "all"):
                return True
            klass = ACTION_CLASS.get(action, "read")
            if sa == klass:
                return True
            if sa == action:
                return True
        return False


async def load_user_principal(db: AsyncSession, user: SysUser) -> Principal:
    roles_rows = (await db.execute(
        select(SysRole.role_key, SysRole.data_scope).join(
            sys_user_role, sys_user_role.c.role_id == SysRole.role_id
        ).where(sys_user_role.c.user_id == user.user_id, SysRole.status == "0", SysRole.del_flag == "0")
    )).all()
    role_keys = [r.role_key for r in roles_rows]
    scopes = [r.data_scope for r in roles_rows]

    perms: set[str] = set()
    if role_keys:
        from app.models.system import sys_role_menu
        perm_rows = (await db.execute(
            select(SysMenu.perms).distinct()
            .join(sys_role_menu, sys_role_menu.c.menu_id == SysMenu.menu_id)
            .join(sys_user_role, sys_user_role.c.role_id == sys_role_menu.c.role_id)
            .where(
                sys_user_role.c.user_id == user.user_id,
                SysMenu.perms.is_not(None),
                SysMenu.perms != "",
                SysMenu.status == "0",
            )
        )).scalars().all()
        perms = {p for p in perm_rows if p}

    # widest data scope wins (1 is widest)
    order = ["1", "2", "3", "4", "5"]
    best = "5"
    for s in scopes:
        if order.index(s) < order.index(best):
            best = s
    return Principal(auth_kind="user", user=user, roles=role_keys, permissions=perms, data_scope=best)


async def get_principal(
    request: Request,
    db: AsyncSession = Depends(get_db),
) -> Principal:
    """Resolve caller identity from Bearer JWT or X-App-ID/X-App-Secret headers."""
    app_id = request.headers.get("X-App-ID")
    app_secret = request.headers.get("X-App-Secret")
    if app_id and app_secret:
        cred = (await db.execute(
            select(SysAppCredential).where(SysAppCredential.app_id == app_id, SysAppCredential.is_active.is_(True))
        )).scalar_one_or_none()
        if not cred or not verify_password(app_secret, cred.app_secret_hash):
            raise ApiError(401, "Agent 凭据无效或已停用")
        p = Principal(auth_kind="agent", agent=cred, data_scope="1")
        p.scopes = {s.strip() for s in (cred.scopes or "*").split(",") if s.strip()}
        return p

    auth = request.headers.get("Authorization", "")
    if not auth.startswith("Bearer "):
        raise ApiError(401, "未登录或身份凭据缺失")
    try:
        payload = decode_token(auth[7:])
    except pyjwt.PyJWTError:
        raise ApiError(401, "登录状态已过期，请重新登录")
    if payload.get("typ") != "user":
        raise ApiError(401, "无效的令牌类型")
    user = (await db.execute(
        select(SysUser).where(
            SysUser.user_id == uuid.UUID(payload["sub"]),
            SysUser.status == "0",
            SysUser.del_flag == "0",
        )
    )).scalar_one_or_none()
    if not user:
        raise ApiError(401, "用户不存在或已停用")
    return await load_user_principal(db, user)


PrincipalDep = Depends(get_principal)


def require_auth(p: Principal = PrincipalDep) -> Principal:
    if not p.user and not p.agent:
        raise ApiError(401, "未认证")
    return p


def require_perms(*perms: str):
    """Dependency factory: caller must hold ANY of the given permission strings."""

    async def checker(p: Principal = Depends(require_auth)) -> Principal:
        if p.is_admin and p.auth_kind == "user":
            return p
        for perm in perms:
            if p.has_perm(perm):
                return p
        raise ApiError(403, f"无操作权限，需要 {' 或 '.join(perms)}")

    return checker


async def _dept_and_children_ids(db: AsyncSession, dept_id: uuid.UUID) -> list[uuid.UUID]:
    rows = (await db.execute(
        select(SysDept.dept_id).where(
            SysDept.ancestors.contains(str(dept_id)), SysDept.del_flag == "0"
        )
    )).scalars().all()
    return [dept_id, *rows]


async def apply_data_scope(
    stmt: Select,
    p: Principal,
    dept_col: Any,
    owner_col: Any | None = None,
    db: AsyncSession | None = None,
) -> Select:
    """Inject RuoYi data-scope WHERE clause onto a statement."""
    if p.auth_kind == "agent" or p.data_scope == DataScope.ALL or p.is_admin:
        return stmt
    if p.data_scope == DataScope.SELF:
        if owner_col is not None:
            return stmt.where(owner_col == p.user_id)
        return stmt.where(dept_col == p.dept_id)
    if p.data_scope == DataScope.DEPT:
        return stmt.where(dept_col == p.dept_id)
    if p.data_scope == DataScope.DEPT_AND_CHILD:
        ids = await _dept_and_children_ids(db, p.dept_id)  # type: ignore[arg-type]
        return stmt.where(dept_col.in_(ids))
    if p.data_scope == DataScope.CUSTOM:
        from app.models.system import sys_role_dept
        role_ids = select(sys_user_role.c.role_id).where(sys_user_role.c.user_id == p.user_id)
        custom_depts = select(sys_role_dept.c.dept_id).where(sys_role_dept.c.role_id.in_(role_ids))
        return stmt.where(dept_col.in_(custom_depts))
    return stmt


async def get_current_user(p: Principal = Depends(require_auth)) -> SysUser:
    if p.user is None:
        raise ApiError(401, "该接口仅支持用户身份访问")
    return p.user
