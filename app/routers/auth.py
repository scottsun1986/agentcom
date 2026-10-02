"""Authentication & session endpoints (RuoYi compatible contract)."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal, get_principal, load_user_principal
from app.core.errors import ApiError
from app.core.resp import ok
from app.core.security import create_access_token, verify_password
from app.database import get_db
from app.models.system import SysDept, SysRole, SysUser, sys_user_role

router = APIRouter(prefix="/api/auth", tags=["认证"])


@router.post("/login")
async def login(body: dict, request: Request, db: AsyncSession = Depends(get_db)):
    username = (body.get("username") or "").strip()
    password = body.get("password") or ""
    if not username or not password:
        raise ApiError(400, "用户名/密码不能为空")
    user = (await db.execute(
        select(SysUser).where(SysUser.user_name == username, SysUser.del_flag == "0")
    )).scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        raise ApiError(400, "用户名或密码错误")
    if user.status != "0":
        raise ApiError(403, "账号已停用，请联系管理员")
    principal = await load_user_principal(db, user)
    token, expires_in = create_access_token(str(user.user_id))
    user.login_ip = request.client.host if request.client else None
    user.login_date = datetime.now(timezone.utc)
    data = {
        "token": token,
        "token_type": "Bearer",
        "expires_in": expires_in,
        "user": {
            "user_id": str(user.user_id),
            "user_name": user.user_name,
            "nick_name": user.nick_name,
            "avatar": user.avatar,
            "dept_id": str(user.dept_id) if user.dept_id else None,
        },
        "roles": principal.roles,
    }
    return ok(data, "登录成功")


@router.post("/logout")
async def logout(_: Principal = Depends(get_principal)):
    return ok(None, "退出成功")


@router.get("/info")
async def get_info(p: Principal = Depends(get_principal), db: AsyncSession = Depends(get_db)):
    user = p.user
    if not user:
        raise ApiError(401, "该接口仅支持用户身份访问")
    user = await db.get(SysUser, user.user_id)
    dept = await db.get(SysDept, user.dept_id) if user.dept_id else None
    permissions = ["*:*:*"] if p.is_admin else sorted(p.permissions)
    data = {
        "user": {
            "user_id": str(user.user_id),
            "user_name": user.user_name,
            "nick_name": user.nick_name,
            "email": user.email,
            "phonenumber": user.phonenumber,
            "sex": user.sex,
            "avatar": user.avatar,
            "status": user.status,
            "dept": {
                "dept_id": str(dept.dept_id) if dept else None,
                "dept_name": dept.dept_name if dept else None,
                "leader": dept.leader if dept else None,
            } if dept else None,
        },
        "roles": p.roles,
        "permissions": permissions,
        "data_scope": p.data_scope,
    }
    return ok(data)


@router.get("/routers")
async def get_routers(p: Principal = Depends(get_principal), db: AsyncSession = Depends(get_db)):
    from app.models.system import SysMenu

    if p.is_admin:
        menus = (await db.execute(
            select(SysMenu).where(SysMenu.status == "0", SysMenu.menu_type.in_(("M", "C")))
            .order_by(SysMenu.top_category, SysMenu.order_num)
        )).scalars().all()
    else:
        role_ids = select(sys_user_role.c.role_id).where(sys_user_role.c.user_id == p.user_id)
        from app.models.system import sys_role_menu
        menus = (await db.execute(
            select(SysMenu).distinct()
            .join(sys_role_menu, sys_role_menu.c.menu_id == SysMenu.menu_id)
            .join(sys_user_role, sys_user_role.c.role_id == sys_role_menu.c.role_id)
            .where(
                sys_user_role.c.role_id.in_(role_ids),
                SysMenu.status == "0",
                SysMenu.menu_type.in_(("M", "C")),
            )
            .order_by(SysMenu.top_category, SysMenu.order_num)
        )).scalars().all()

    # group by top_category: top categories then children
    def serialize(m: SysMenu) -> dict:
        return {
            "menu_id": str(m.menu_id),
            "menu_name": m.menu_name,
            "parent_id": str(m.parent_id) if m.parent_id else None,
            "top_category": m.top_category,
            "path": m.path,
            "component": m.component,
            "menu_type": m.menu_type,
            "perms": m.perms,
            "icon": m.icon,
            "order_num": m.order_num,
            "visible": m.visible,
        }

    items = [serialize(m) for m in menus]
    return ok({"topCategories": build_top_categories(items), "menus": items})


def build_top_categories(items: list[dict]) -> list[dict]:
    order = ["PORTAL", "ATTENDANCE", "ASSETS", "SUPERVISION", "CONFERENCE",
             "CONTACTS", "VISITOR", "FLEET", "RESEARCH", "KNOWLEDGE", "SYSTEM"]
    names = {
        "PORTAL": "综合门户", "ATTENDANCE": "考勤管理", "ASSETS": "资产耗材",
        "SUPERVISION": "重点督办", "CONFERENCE": "会务管理", "CONTACTS": "组织通讯",
        "VISITOR": "门禁访客", "FLEET": "公务用车", "RESEARCH": "调研管理",
        "KNOWLEDGE": "智慧知识", "SYSTEM": "系统管理",
    }
    seen: dict[str, dict] = {}
    for it in items:
        tc = it.get("top_category")
        if tc and tc not in seen:
            seen[tc] = {"key": tc, "name": names.get(tc, tc)}
    return sorted(seen.values(), key=lambda c: order.index(c["key"]) if c["key"] in order else 99)
