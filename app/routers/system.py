"""System management endpoints (RuoYi RBAC): user/role/menu/dept/post/dict/config/log/apps."""

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import Principal, require_perms
from app.core.errors import ApiError
from app.core.resp import ok, page
from app.core.security import hash_password
from app.database import get_db
from app.models.system import (
    SysAppCredential,
    SysConfig,
    SysDept,
    SysDictData,
    SysDictType,
    SysMenu,
    SysOperLog,
    SysPost,
    SysRole,
    SysUser,
    sys_role_dept,
    sys_role_menu,
    sys_user_post,
    sys_user_role,
)

router = APIRouter(prefix="/api/system", tags=["系统管理"])


async def _user_maps(db: AsyncSession):
    depts = (await db.execute(select(SysDept))).scalars().all()
    dmap = {d.dept_id: d.dept_name for d in depts}
    posts = (await db.execute(select(SysPost))).scalars().all()
    pmap = {p.post_id: p.post_name for p in posts}
    roles = (await db.execute(select(SysRole))).scalars().all()
    rmap = {r.role_id: r.role_name for r in roles}
    return dmap, pmap, rmap


# ---------------- users ----------------

@router.get("/users")
async def list_users(
    keyword: str | None = None, dept_id: str | None = None, status: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
    p: Principal = Depends(require_perms("system:user:list")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SysUser).where(SysUser.del_flag == "0").order_by(SysUser.created_at)
    if keyword:
        stmt = stmt.where(or_(SysUser.user_name.ilike(f"%{keyword}%"), SysUser.nick_name.ilike(f"%{keyword}%")))
    if dept_id:
        did = uuid.UUID(dept_id)
        dept = await db.get(SysDept, did)
        child_ids = []
        if dept:
            child_ids = (await db.execute(
                select(SysDept.dept_id).where(SysDept.ancestors.contains(str(did)), SysDept.del_flag == "0")
            )).scalars().all()
        stmt = stmt.where(SysUser.dept_id.in_([did, *child_ids]))
    if status:
        stmt = stmt.where(SysUser.status == status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    users = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    dmap, pmap, rmap = await _user_maps(db)
    rows = []
    for u in users:
        rows.append({
            "user_id": str(u.user_id), "user_name": u.user_name, "nick_name": u.nick_name,
            "dept_id": str(u.dept_id) if u.dept_id else None, "dept_name": dmap.get(u.dept_id),
            "phonenumber": u.phonenumber, "email": u.email, "status": u.status,
            "post_names": [pmap.get(up.post_id) for up in u.posts] if u.posts else [],
            "roles": [{"role_id": str(r.role_id), "role_name": rmap.get(r.role_id), "role_key": r.role_key} for r in u.roles] if u.roles else [],
            "created_at": u.created_at.isoformat() if u.created_at else None,
        })
    return page(rows, total)


@router.post("/users")
async def create_user(body: dict, p: Principal = Depends(require_perms("system:user:add")), db: AsyncSession = Depends(get_db)):
    if not body.get("user_name") or not body.get("nick_name"):
        raise ApiError(400, "账号与姓名不能为空")
    dup = (await db.execute(select(SysUser).where(SysUser.user_name == body["user_name"]))).scalar_one_or_none()
    if dup:
        raise ApiError(400, "账号已存在")
    u = SysUser(
        user_name=body["user_name"], nick_name=body["nick_name"],
        dept_id=uuid.UUID(body["dept_id"]) if body.get("dept_id") else None,
        phonenumber=body.get("phonenumber"), email=body.get("email"), sex=body.get("sex", "0"),
        password_hash=hash_password(body.get("password") or "Zc@123456"),
    )
    db.add(u)
    await db.flush()
    for rid in body.get("role_ids", []):
        await db.execute(sys_user_role.insert().values(user_id=u.user_id, role_id=uuid.UUID(rid)))
    for pid in body.get("post_ids", []):
        await db.execute(sys_user_post.insert().values(user_id=u.user_id, post_id=uuid.UUID(pid)))
    await db.flush()
    return ok({"user_id": str(u.user_id)}, "新增成功")


@router.put("/users/{user_id}")
async def update_user(user_id: str, body: dict, p: Principal = Depends(require_perms("system:user:edit")), db: AsyncSession = Depends(get_db)):
    u = await db.get(SysUser, uuid.UUID(user_id))
    if not u:
        raise ApiError(404, "用户不存在")
    for f in ("nick_name", "phonenumber", "email", "sex", "status"):
        if f in body:
            setattr(u, f, body[f])
    if body.get("dept_id"):
        u.dept_id = uuid.UUID(body["dept_id"])
    if body.get("password"):
        u.password_hash = hash_password(body["password"])
    if "role_ids" in body:
        await db.execute(sys_user_role.delete().where(sys_user_role.c.user_id == u.user_id))
        for rid in body["role_ids"]:
            await db.execute(sys_user_role.insert().values(user_id=u.user_id, role_id=uuid.UUID(rid)))
    await db.flush()
    return ok(None, "修改成功")


@router.delete("/users/{user_id}")
async def delete_user(user_id: str, p: Principal = Depends(require_perms("system:user:del")), db: AsyncSession = Depends(get_db)):
    u = await db.get(SysUser, uuid.UUID(user_id))
    if not u:
        raise ApiError(404, "用户不存在")
    if u.user_name == "admin":
        raise ApiError(400, "内置管理员不允许删除")
    u.del_flag = "2"
    return ok(None, "删除成功")


# ---------------- roles ----------------

@router.get("/roles")
async def list_roles(
    keyword: str | None = None, pageNum: int = 1, pageSize: int = 20,
    p: Principal = Depends(require_perms("system:role:list")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SysRole).where(SysRole.del_flag == "0").order_by(SysRole.role_sort)
    if keyword:
        stmt = stmt.where(or_(SysRole.role_name.ilike(f"%{keyword}%"), SysRole.role_key.ilike(f"%{keyword}%")))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    roles = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    return page([{
        "role_id": str(r.role_id), "role_name": r.role_name, "role_key": r.role_key,
        "role_sort": r.role_sort, "data_scope": r.data_scope, "status": r.status,
        "remark": "", "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in roles], total)


@router.post("/roles")
async def create_role(body: dict, p: Principal = Depends(require_perms("system:role:add")), db: AsyncSession = Depends(get_db)):
    if not body.get("role_name") or not body.get("role_key"):
        raise ApiError(400, "角色名与角色标识不能为空")
    r = SysRole(
        role_name=body["role_name"], role_key=body["role_key"],
        role_sort=body.get("role_sort", 0), data_scope=body.get("data_scope", "5"),
        status=body.get("status", "0"),
    )
    db.add(r)
    await db.flush()
    for mid in body.get("menu_ids", []):
        await db.execute(sys_role_menu.insert().values(role_id=r.role_id, menu_id=uuid.UUID(mid)))
    for did in body.get("dept_ids", []):
        await db.execute(sys_role_dept.insert().values(role_id=r.role_id, dept_id=uuid.UUID(did)))
    await db.flush()
    return ok({"role_id": str(r.role_id)}, "新增成功")


@router.put("/roles/{role_id}")
async def update_role(role_id: str, body: dict, p: Principal = Depends(require_perms("system:role:edit")), db: AsyncSession = Depends(get_db)):
    r = await db.get(SysRole, uuid.UUID(role_id))
    if not r:
        raise ApiError(404, "角色不存在")
    for f in ("role_name", "role_key", "role_sort", "data_scope", "status"):
        if f in body:
            setattr(r, f, body[f])
    if "menu_ids" in body:
        await db.execute(sys_role_menu.delete().where(sys_role_menu.c.role_id == r.role_id))
        for mid in body["menu_ids"]:
            await db.execute(sys_role_menu.insert().values(role_id=r.role_id, menu_id=uuid.UUID(mid)))
    if "dept_ids" in body:
        await db.execute(sys_role_dept.delete().where(sys_role_dept.c.role_id == r.role_id))
        for did in body["dept_ids"]:
            await db.execute(sys_role_dept.insert().values(role_id=r.role_id, dept_id=uuid.UUID(did)))
    await db.flush()
    return ok(None, "修改成功")


@router.delete("/roles/{role_id}")
async def delete_role(role_id: str, p: Principal = Depends(require_perms("system:role:del")), db: AsyncSession = Depends(get_db)):
    r = await db.get(SysRole, uuid.UUID(role_id))
    if not r:
        raise ApiError(404, "角色不存在")
    if r.role_key == "admin":
        raise ApiError(400, "内置管理员角色不允许删除")
    r.del_flag = "2"
    return ok(None, "删除成功")


# ---------------- menus ----------------

@router.get("/menus")
async def list_menus(
    keyword: str | None = None, top_category: str | None = None,
    p: Principal = Depends(require_perms("system:menu:list")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SysMenu).order_by(SysMenu.order_num)
    if keyword:
        stmt = stmt.where(SysMenu.menu_name.ilike(f"%{keyword}%"))
    if top_category:
        stmt = stmt.where(SysMenu.top_category == top_category)
    menus = (await db.execute(stmt)).scalars().all()
    id_set = {m.menu_id for m in menus}
    roots = [m for m in menus if m.parent_id is None or m.parent_id not in id_set]

    def node(m: SysMenu) -> dict:
        return {
            "menu_id": str(m.menu_id), "menu_name": m.menu_name,
            "parent_id": str(m.parent_id) if m.parent_id else None,
            "top_category": m.top_category, "order_num": m.order_num,
            "path": m.path, "component": m.component, "menu_type": m.menu_type,
            "perms": m.perms, "icon": m.icon, "visible": m.visible, "status": m.status,
            "children": [node(c) for c in menus if c.parent_id == m.menu_id],
        }

    return ok([node(m) for m in roots])


@router.post("/menus")
async def create_menu(body: dict, p: Principal = Depends(require_perms("system:menu:add")), db: AsyncSession = Depends(get_db)):
    m = SysMenu(
        menu_name=body["menu_name"],
        parent_id=uuid.UUID(body["parent_id"]) if body.get("parent_id") else None,
        top_category=body.get("top_category"), order_num=body.get("order_num", 0),
        path=body.get("path"), component=body.get("component"),
        menu_type=body.get("menu_type", "C"), perms=body.get("perms"),
        icon=body.get("icon"), visible=body.get("visible", "0"),
    )
    db.add(m)
    await db.flush()
    return ok({"menu_id": str(m.menu_id)}, "新增成功")


@router.put("/menus/{menu_id}")
async def update_menu(menu_id: str, body: dict, p: Principal = Depends(require_perms("system:menu:edit")), db: AsyncSession = Depends(get_db)):
    m = await db.get(SysMenu, uuid.UUID(menu_id))
    if not m:
        raise ApiError(404, "菜单不存在")
    for f in ("menu_name", "top_category", "order_num", "path", "component", "menu_type", "perms", "icon", "visible", "status"):
        if f in body:
            setattr(m, f, body[f])
    if "parent_id" in body:
        m.parent_id = uuid.UUID(body["parent_id"]) if body["parent_id"] else None
    return ok(None, "修改成功")


@router.delete("/menus/{menu_id}")
async def delete_menu(menu_id: str, p: Principal = Depends(require_perms("system:menu:del")), db: AsyncSession = Depends(get_db)):
    m = await db.get(SysMenu, uuid.UUID(menu_id))
    if not m:
        raise ApiError(404, "菜单不存在")
    child = (await db.execute(select(SysMenu).where(SysMenu.parent_id == m.menu_id).limit(1))).scalar_one_or_none()
    if child:
        raise ApiError(400, "存在子菜单，不允许删除")
    await db.delete(m)
    return ok(None, "删除成功")


# ---------------- depts ----------------

@router.get("/depts")
async def list_depts(
    keyword: str | None = None,
    p: Principal = Depends(require_perms("system:dept:list")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SysDept).where(SysDept.del_flag == "0").order_by(SysDept.order_num)
    if keyword:
        stmt = stmt.where(SysDept.dept_name.ilike(f"%{keyword}%"))
    depts = (await db.execute(stmt)).scalars().all()
    id_set = {d.dept_id for d in depts}
    roots = [d for d in depts if d.parent_id is None or d.parent_id not in id_set]

    def node(d: SysDept) -> dict:
        return {
            "dept_id": str(d.dept_id), "dept_name": d.dept_name,
            "parent_id": str(d.parent_id) if d.parent_id else None,
            "ancestors": d.ancestors, "order_num": d.order_num,
            "leader": d.leader, "phone": d.phone, "email": d.email, "status": d.status,
            "children": [node(c) for c in depts if c.parent_id == d.dept_id],
        }

    return ok([node(d) for d in roots])


@router.post("/depts")
async def create_dept(body: dict, p: Principal = Depends(require_perms("system:dept:add")), db: AsyncSession = Depends(get_db)):
    parent_id = uuid.UUID(body["parent_id"]) if body.get("parent_id") else None
    ancestors = "0"
    if parent_id:
        parent = await db.get(SysDept, parent_id)
        if not parent:
            raise ApiError(404, "上级部门不存在")
        ancestors = f"{parent.ancestors},{parent.dept_id}"
    d = SysDept(
        dept_name=body["dept_name"], parent_id=parent_id, ancestors=ancestors,
        order_num=body.get("order_num", 0), leader=body.get("leader"),
        phone=body.get("phone"), email=body.get("email"),
    )
    db.add(d)
    await db.flush()
    return ok({"dept_id": str(d.dept_id)}, "新增成功")


@router.put("/depts/{dept_id}")
async def update_dept(dept_id: str, body: dict, p: Principal = Depends(require_perms("system:dept:edit")), db: AsyncSession = Depends(get_db)):
    d = await db.get(SysDept, uuid.UUID(dept_id))
    if not d:
        raise ApiError(404, "部门不存在")
    for f in ("dept_name", "order_num", "leader", "phone", "email", "status"):
        if f in body:
            setattr(d, f, body[f])
    return ok(None, "修改成功")


@router.delete("/depts/{dept_id}")
async def delete_dept(dept_id: str, p: Principal = Depends(require_perms("system:dept:del")), db: AsyncSession = Depends(get_db)):
    d = await db.get(SysDept, uuid.UUID(dept_id))
    if not d:
        raise ApiError(404, "部门不存在")
    child = (await db.execute(select(SysDept).where(SysDept.parent_id == d.dept_id, SysDept.del_flag == "0").limit(1))).scalar_one_or_none()
    if child:
        raise ApiError(400, "存在下级部门，不允许删除")
    d.del_flag = "2"
    return ok(None, "删除成功")


# ---------------- posts / dicts / configs ----------------

@router.get("/posts")
async def list_posts(p: Principal = Depends(require_perms("system:post:list")), db: AsyncSession = Depends(get_db)):
    posts = (await db.execute(select(SysPost).order_by(SysPost.post_sort))).scalars().all()
    return ok([{
        "post_id": str(po.post_id), "post_code": po.post_code, "post_name": po.post_name,
        "post_sort": po.post_sort, "status": po.status,
        "user_count": len(po.users) if po.users else 0,
    } for po in posts])


@router.post("/posts")
async def create_post(body: dict, p: Principal = Depends(require_perms("system:post:add")), db: AsyncSession = Depends(get_db)):
    po = SysPost(post_code=body["post_code"], post_name=body["post_name"], post_sort=body.get("post_sort", 0))
    db.add(po)
    await db.flush()
    return ok({"post_id": str(po.post_id)}, "新增成功")


@router.put("/posts/{post_id}")
async def update_post(post_id: str, body: dict, p: Principal = Depends(require_perms("system:post:edit")), db: AsyncSession = Depends(get_db)):
    po = await db.get(SysPost, uuid.UUID(post_id))
    if not po:
        raise ApiError(404, "岗位不存在")
    for f in ("post_code", "post_name", "post_sort", "status"):
        if f in body:
            setattr(po, f, body[f])
    return ok(None, "修改成功")


@router.delete("/posts/{post_id}")
async def delete_post(post_id: str, p: Principal = Depends(require_perms("system:post:del")), db: AsyncSession = Depends(get_db)):
    po = await db.get(SysPost, uuid.UUID(post_id))
    if not po:
        raise ApiError(404, "岗位不存在")
    await db.delete(po)
    return ok(None, "删除成功")


@router.get("/dict/types")
async def list_dict_types(p: Principal = Depends(require_perms("system:dict:list")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SysDictType))).scalars().all()
    return ok([{
        "dict_id": str(t.dict_id), "dict_name": t.dict_name, "dict_type": t.dict_type, "status": t.status, "remark": t.remark,
    } for t in rows])


@router.get("/dict/data")
async def list_dict_data(dict_type: str, p: Principal = Depends(require_perms("system:dict:list")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SysDictData).where(SysDictData.dict_type == dict_type).order_by(SysDictData.dict_sort))).scalars().all()
    return ok([{
        "dict_code": str(d.dict_code), "dict_label": d.dict_label, "dict_value": d.dict_value,
        "dict_type": d.dict_type, "dict_sort": d.dict_sort, "list_class": d.list_class,
    } for d in rows])


@router.post("/dict/data")
async def create_dict_data(body: dict, p: Principal = Depends(require_perms("system:dict:add")), db: AsyncSession = Depends(get_db)):
    d = SysDictData(
        dict_label=body["dict_label"], dict_value=body["dict_value"], dict_type=body["dict_type"],
        dict_sort=body.get("dict_sort", 0), list_class=body.get("list_class"),
    )
    db.add(d)
    await db.flush()
    return ok({"dict_code": str(d.dict_code)}, "新增成功")


@router.put("/dict/data/{dict_code}")
async def update_dict_data(dict_code: str, body: dict, p: Principal = Depends(require_perms("system:dict:edit")), db: AsyncSession = Depends(get_db)):
    d = await db.get(SysDictData, uuid.UUID(dict_code))
    if not d:
        raise ApiError(404, "字典项不存在")
    for f in ("dict_label", "dict_value", "dict_sort", "list_class"):
        if f in body:
            setattr(d, f, body[f])
    return ok(None, "修改成功")


@router.delete("/dict/data/{dict_code}")
async def delete_dict_data(dict_code: str, p: Principal = Depends(require_perms("system:dict:del")), db: AsyncSession = Depends(get_db)):
    d = await db.get(SysDictData, uuid.UUID(dict_code))
    if not d:
        raise ApiError(404, "字典项不存在")
    await db.delete(d)
    return ok(None, "删除成功")


@router.get("/configs")
async def list_configs(p: Principal = Depends(require_perms("system:config:list")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SysConfig))).scalars().all()
    return ok([{
        "config_id": str(c.config_id), "config_name": c.config_name, "config_key": c.config_key,
        "config_value": c.config_value, "config_type": c.config_type,
    } for c in rows])


@router.put("/configs/{config_id}")
async def update_config(config_id: str, body: dict, p: Principal = Depends(require_perms("system:config:edit")), db: AsyncSession = Depends(get_db)):
    c = await db.get(SysConfig, uuid.UUID(config_id))
    if not c:
        raise ApiError(404, "参数不存在")
    if "config_value" in body:
        c.config_value = body["config_value"]
    if "config_name" in body:
        c.config_name = body["config_name"]
    return ok(None, "修改成功")


# ---------------- logs ----------------

@router.get("/logs")
async def list_logs(
    keyword: str | None = None, business_type: str | None = None,
    pageNum: int = 1, pageSize: int = 15,
    p: Principal = Depends(require_perms("system:log:list")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SysOperLog).order_by(SysOperLog.oper_time.desc())
    if keyword:
        stmt = stmt.where(or_(SysOperLog.title.ilike(f"%{keyword}%"), SysOperLog.oper_name.ilike(f"%{keyword}%")))
    if business_type:
        stmt = stmt.where(SysOperLog.business_type == business_type)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    return page([{
        "oper_id": str(r.oper_id), "title": r.title, "business_type": r.business_type,
        "method": r.method, "request_method": r.request_method, "oper_name": r.oper_name,
        "oper_url": r.oper_url, "oper_ip": r.oper_ip, "status": r.status,
        "cost_time": r.cost_time, "oper_time": r.oper_time.isoformat() if r.oper_time else None,
        "oper_param": (r.oper_param or "")[:200],
    } for r in rows], total)


# ---------------- agent credentials ----------------

@router.get("/apps")
async def list_apps(p: Principal = Depends(require_perms("system:app:list")), db: AsyncSession = Depends(get_db)):
    rows = (await db.execute(select(SysAppCredential).order_by(SysAppCredential.created_at.desc()))).scalars().all()
    return ok([{
        "id": str(r.id), "app_id": r.app_id, "app_name": r.app_name, "description": r.description,
        "scopes": [s for s in (r.scopes or "").split(",") if s],
        "rate_limit_per_minute": r.rate_limit_per_minute, "is_active": r.is_active,
        "created_by": r.created_by, "created_at": r.created_at.isoformat() if r.created_at else None,
    } for r in rows])


@router.post("/apps")
async def create_app(body: dict, p: Principal = Depends(require_perms("system:app:add")), db: AsyncSession = Depends(get_db)):
    import secrets

    if not body.get("app_name"):
        raise ApiError(400, "应用名称不能为空")
    app_id = f"agentcom-{secrets.token_hex(4)}"
    app_secret = f"sk-{secrets.token_hex(20)}"
    cred = SysAppCredential(
        app_id=app_id, app_secret_hash=hash_password(app_secret),
        app_name=body["app_name"], description=body.get("description"),
        scopes=body.get("scopes") or "*",
        rate_limit_per_minute=body.get("rate_limit_per_minute", 120),
        created_by=p.display_name,
    )
    db.add(cred)
    await db.flush()
    return ok({
        "id": str(cred.id), "app_id": app_id, "app_secret": app_secret,
        "app_name": cred.app_name, "scopes": cred.scopes,
        "mcp_config": {
            "mcpServers": {
                "agentcom": {
                    "type": "streamable-http",
                    "url": "http://localhost:8009/mcp",
                    "headers": {"X-App-ID": app_id, "X-App-Secret": app_secret},
                }
            }
        },
    }, "凭据已生成（Secret 仅此一次展示）")


@router.put("/apps/{id}/toggle")
async def toggle_app(id: str, p: Principal = Depends(require_perms("system:app:edit")), db: AsyncSession = Depends(get_db)):
    cred = await db.get(SysAppCredential, uuid.UUID(id))
    if not cred:
        raise ApiError(404, "凭据不存在")
    cred.is_active = not cred.is_active
    return ok({"is_active": cred.is_active}, "状态已切换")


@router.put("/apps/{id}/rotate")
async def rotate_app_secret(id: str, p: Principal = Depends(require_perms("system:app:edit")), db: AsyncSession = Depends(get_db)):
    """重置 App Secret（旧密钥立即失效），新密钥仅本次响应展示一次。"""
    import secrets

    cred = await db.get(SysAppCredential, uuid.UUID(id))
    if not cred:
        raise ApiError(404, "凭据不存在")
    app_secret = f"sk-{secrets.token_hex(20)}"
    cred.app_secret_hash = hash_password(app_secret)
    cred.is_active = True
    await db.flush()
    return ok({
        "id": str(cred.id), "app_id": cred.app_id, "app_secret": app_secret,
        "app_name": cred.app_name, "scopes": cred.scopes,
        "mcp_config": {
            "mcpServers": {
                "agentcom": {
                    "type": "streamable-http",
                    "url": "http://localhost:8009/mcp",
                    "headers": {"X-App-ID": cred.app_id, "X-App-Secret": app_secret},
                }
            }
        },
    }, "密钥已重置（旧密钥立即失效，新密钥仅此一次展示）")


@router.delete("/apps/{id}")
async def delete_app(id: str, p: Principal = Depends(require_perms("system:app:del")), db: AsyncSession = Depends(get_db)):
    cred = await db.get(SysAppCredential, uuid.UUID(id))
    if not cred:
        raise ApiError(404, "凭据不存在")
    await db.delete(cred)
    return ok(None, "删除成功")
