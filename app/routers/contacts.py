"""Organization directory & contacts endpoints:
- org tree with member counts; employee roster with privacy masking;
- executive privacy list with anti-screenshot watermark;
- external partner directory; expert pool; roster import/export."""

import uuid

from fastapi import APIRouter, Depends
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.deps import Principal, apply_data_scope, require_perms
from app.core.errors import ApiError
from app.core.resp import ok, page
from app.core.security import hash_password
from app.database import get_db
from app.models.contacts import CtExpert, CtExternalPartner
from app.models.system import SysDept, SysUser

router = APIRouter(prefix="/api/contacts", tags=["组织与通讯录"])

# 通讯录批量导入的默认初始密码（argon2 落库）
DEFAULT_IMPORT_PASSWORD = "Zc@123456"

PARTNER_TYPE_LABELS = {
    "GOV_PEER": "对口协同单位",
    "SUPPLIER": "核心供应商",
    "THINKTANK": "智库机构",
    "EMERGENCY": "应急协作",
}

EXPERT_LEVEL_LABELS = {
    "NATIONAL": "国家级",
    "PROVINCIAL": "省级",
    "MUNICIPAL": "市级",
}

# 通讯录导入模板列定义（/sync/template 返回）
SYNC_TEMPLATE_COLUMNS = [
    {"column": "user_name", "label": "登录账号", "required": True},
    {"column": "nick_name", "label": "姓名", "required": True},
    {"column": "dept_name", "label": "部门名称", "required": False},
    {"column": "phonenumber", "label": "手机号码", "required": False},
    {"column": "email", "label": "电子邮箱", "required": False},
    {"column": "sex", "label": "性别(男/女)", "required": False},
]


def _parse_uuid(value, label: str = "ID") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise ApiError(400, f"无效的{label}")


def mask_phone(phone: str | None) -> str | None:
    """Privacy masking: 11-digit mobile -> 138****1234; other numbers head/tail kept."""
    if not phone:
        return phone
    s = str(phone).strip()
    if len(s) == 11 and s.isdigit():
        return s[:3] + "****" + s[-4:]
    if len(s) > 6:
        return s[:2] + "****" + s[-2:]
    return "****"


def _workno_tail4(user: SysUser) -> str:
    """工号尾4位数字：取 user_name 中的数字尾部，无数字时回退取 user_name 尾4位。"""
    name = user.user_name or ""
    digits = "".join(ch for ch in name if ch.isdigit())
    return digits[-4:] if digits else name[-4:]


async def dept_and_children(dept_id, db: AsyncSession) -> list:
    """本部门及以下的所有部门 id（含自身），复制自 attendance.py 同名辅助函数。"""
    if not dept_id:
        return []
    rows = (await db.execute(
        select(SysDept.dept_id).where(SysDept.ancestors.contains(str(dept_id)), SysDept.del_flag == "0")
    )).scalars().all()
    return [dept_id, *rows]


async def get_leader_user_ids(db: AsyncSession) -> set:
    """领导强制脱敏名单：SysDept.leader 姓名能匹配到 nick_name 的用户集合。"""
    names = (await db.execute(
        select(SysDept.leader).where(
            SysDept.leader.is_not(None), SysDept.leader != "", SysDept.del_flag == "0"
        )
    )).scalars().all()
    names = {str(n).strip() for n in names if n and str(n).strip()}
    if not names:
        return set()
    rows = (await db.execute(
        select(SysUser.user_id).where(SysUser.nick_name.in_(names), SysUser.del_flag == "0")
    )).scalars().all()
    return set(rows)


async def get_dept_name_map(db: AsyncSession) -> dict:
    rows = (await db.execute(
        select(SysDept.dept_id, SysDept.dept_name).where(SysDept.del_flag == "0")
    )).all()
    return {r.dept_id: r.dept_name for r in rows}


def serialize_employee(u: SysUser, dept_map: dict, leader_ids: set, allow_full: bool) -> dict:
    """员工花名册行：手机号按查看者权限/领导名单决定脱敏。"""
    phone = u.phonenumber
    masked = False
    if phone:
        if u.user_id in leader_ids or not allow_full:
            phone = mask_phone(phone)
            masked = True
    else:
        phone = None
    posts = sorted((u.posts or []), key=lambda x: x.post_sort)
    return {
        "user_id": str(u.user_id),
        "user_name": u.user_name,
        "nick_name": u.nick_name,
        "dept_id": str(u.dept_id) if u.dept_id else None,
        "dept_name": dept_map.get(u.dept_id),
        "position": posts[0].post_name if posts else None,
        "posts": [pt.post_name for pt in posts],
        "email": u.email,
        "sex": u.sex,
        "status": u.status,
        "phonenumber": phone,
        "masked": masked,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    }


# ---------------- 组织架构全景树 ----------------

@router.get("/org-tree")
async def org_tree(
    parent_id: str | None = None,
    p: Principal = Depends(require_perms("contacts:org:list")),
    db: AsyncSession = Depends(get_db),
):
    """多级组织树：不传 parent_id 返回全部根部门子树；传入则返回该部门子树。"""
    depts = (await db.execute(
        select(SysDept).where(SysDept.del_flag == "0")
        .order_by(SysDept.order_num, SysDept.dept_name)
    )).scalars().all()

    if parent_id:
        pid = _parse_uuid(parent_id, "部门ID")
        starts = [d for d in depts if d.dept_id == pid]
        if not starts:
            raise ApiError(404, "部门不存在")
    else:
        starts = [d for d in depts if d.parent_id is None]

    direct_rows = (await db.execute(
        select(SysUser.dept_id, func.count())
        .where(SysUser.del_flag == "0", SysUser.status == "0", SysUser.dept_id.is_not(None))
        .group_by(SysUser.dept_id)
    )).all()
    direct = {r[0]: r[1] for r in direct_rows}

    children_map: dict = {}
    for d in depts:
        children_map.setdefault(d.parent_id, []).append(d)

    def build(d: SysDept) -> dict:
        member = direct.get(d.dept_id, 0)
        children = []
        total = member
        for child in children_map.get(d.dept_id, []):
            node = build(child)
            total += node["user_count"]
            children.append(node)
        return {
            "dept_id": str(d.dept_id),
            "parent_id": str(d.parent_id) if d.parent_id else None,
            "dept_name": d.dept_name,
            "leader": d.leader,
            "phone": mask_phone(d.phone),
            "order_num": d.order_num,
            "status": d.status,
            "member_count": member,
            "user_count": total,
            "children": children,
        }

    return ok([build(d) for d in starts])


# ---------------- 干部与员工花名册 ----------------

@router.get("/employees")
async def list_employees(
    p: Principal = Depends(require_perms("contacts:employee:list")),
    db: AsyncSession = Depends(get_db),
    keyword: str | None = None, dept_id: str | None = None, status: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = (
        select(SysUser)
        .options(selectinload(SysUser.posts))
        .where(SysUser.del_flag == "0")
        .order_by(SysUser.created_at.desc())
    )
    if keyword:
        kw = f"%{keyword.strip()}%"
        stmt = stmt.where(SysUser.nick_name.ilike(kw) | SysUser.user_name.ilike(kw) | SysUser.email.ilike(kw))
    if dept_id:
        did = _parse_uuid(dept_id, "部门ID")
        ids = await dept_and_children(did, db)
        stmt = stmt.where(SysUser.dept_id.in_(ids))
    if status:
        stmt = stmt.where(SysUser.status == status)
    # RuoYi 数据权限：按部门归属过滤（SELF/DEPT 视为本部门）
    stmt = await apply_data_scope(stmt, p, SysUser.dept_id, None, db)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()

    # admin 或持有 contacts:privacy:view 才可见完整号码；领导强制脱敏
    allow_full = bool(p.is_admin or p.has_perm("contacts:privacy:view"))
    leader_ids = await get_leader_user_ids(db)
    dept_map = await get_dept_name_map(db)
    return page([serialize_employee(u, dept_map, leader_ids, allow_full) for u in rows], total)


# ---------------- 高管隐私与号码脱敏 ----------------

@router.get("/privacy-mask")
async def privacy_mask(
    p: Principal = Depends(require_perms("contacts:privacy:view")),
    db: AsyncSession = Depends(get_db),
):
    """高管名单（各部门负责人）+ 强制脱敏手机 + 防截屏动态盲水印。"""
    depts = (await db.execute(
        select(SysDept).where(
            SysDept.del_flag == "0", SysDept.leader.is_not(None), SysDept.leader != ""
        ).order_by(SysDept.order_num, SysDept.dept_name)
    )).scalars().all()
    users = (await db.execute(
        select(SysUser).where(SysUser.del_flag == "0")
    )).scalars().all()
    users_by_nick: dict = {}
    for u in users:
        users_by_nick.setdefault(u.nick_name.strip(), []).append(u)

    rows = []
    for d in depts:
        matched = users_by_nick.get(str(d.leader).strip())
        u = matched[0] if matched else None
        rows.append({
            "dept_id": str(d.dept_id),
            "dept_name": d.dept_name,
            "leader": d.leader,
            "user_id": str(u.user_id) if u else None,
            "nick_name": u.nick_name if u else d.leader,
            "phonenumber": mask_phone(u.phonenumber) if u else None,
            "masked": True,  # 高管号码无条件脱敏
        })
    watermark = p.display_name if not p.user else f"{p.display_name} {_workno_tail4(p.user)}"
    return ok({"watermark": watermark, "executives": rows}, "查询成功")


# ---------------- 政务外联通讯录 ----------------

def serialize_partner(r: CtExternalPartner) -> dict:
    return {
        "partner_id": str(r.partner_id),
        "unit_name": r.unit_name,
        "partner_type": r.partner_type,
        "partner_type_label": PARTNER_TYPE_LABELS.get(r.partner_type, r.partner_type),
        "contact_name": r.contact_name,
        "phone": r.phone,
        "email": r.email,
        "address": r.address,
        "tags": r.tags,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.get("/partners")
async def list_partners(
    p: Principal = Depends(require_perms("contacts:partner:list")),
    db: AsyncSession = Depends(get_db),
    partner_type: str | None = None, keyword: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(CtExternalPartner).order_by(CtExternalPartner.created_at.desc())
    if partner_type:
        stmt = stmt.where(CtExternalPartner.partner_type == partner_type)
    if keyword:
        kw = f"%{keyword.strip()}%"
        stmt = stmt.where(
            CtExternalPartner.unit_name.ilike(kw)
            | CtExternalPartner.contact_name.ilike(kw)
            | CtExternalPartner.tags.ilike(kw)
        )
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    return page([serialize_partner(r) for r in rows], total)


def _apply_partner_body(r: CtExternalPartner, body: dict, partial: bool) -> None:
    unit_name = (body.get("unit_name") or "").strip()
    contact_name = (body.get("contact_name") or "").strip()
    phone = (body.get("phone") or "").strip()
    if not partial and (not unit_name or not contact_name or not phone):
        raise ApiError(400, "单位名称、联系人、联系电话不能为空")
    partner_type = body.get("partner_type")
    if partner_type:
        if partner_type not in PARTNER_TYPE_LABELS:
            raise ApiError(400, "外联单位类型无效")
        r.partner_type = partner_type
    if unit_name:
        r.unit_name = unit_name
    if contact_name:
        r.contact_name = contact_name
    if phone:
        r.phone = phone
    for f in ("email", "address", "tags", "notes"):
        if f in body:
            setattr(r, f, body.get(f))


@router.post("/partners")
async def add_partner(
    body: dict,
    p: Principal = Depends(require_perms("contacts:partner:add")),
    db: AsyncSession = Depends(get_db),
):
    r = CtExternalPartner(partner_type=body.get("partner_type") or "GOV_PEER")
    _apply_partner_body(r, body, partial=False)
    db.add(r)
    await db.flush()
    return ok(serialize_partner(r), "外联单位已登记")


@router.put("/partners/{partner_id}")
async def edit_partner(
    partner_id: str, body: dict,
    p: Principal = Depends(require_perms("contacts:partner:edit")),
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(CtExternalPartner, _parse_uuid(partner_id, "外联单位ID"))
    if not r:
        raise ApiError(404, "外联单位不存在")
    _apply_partner_body(r, body, partial=True)
    await db.flush()
    return ok(serialize_partner(r), "外联单位已更新")


@router.delete("/partners/{partner_id}")
async def del_partner(
    partner_id: str,
    p: Principal = Depends(require_perms("contacts:partner:del")),
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(CtExternalPartner, _parse_uuid(partner_id, "外联单位ID"))
    if not r:
        raise ApiError(404, "外联单位不存在")
    await db.delete(r)
    await db.flush()
    return ok(None, "删除成功")


# ---------------- 专家人才库 ----------------

def serialize_expert(r: CtExpert) -> dict:
    return {
        "expert_id": str(r.expert_id),
        "name": r.name,
        "title": r.title,
        "organization": r.organization,
        "field_domain": r.field_domain,
        "phone": r.phone,
        "email": r.email,
        "level": r.level,
        "level_label": EXPERT_LEVEL_LABELS.get(r.level, r.level),
        "bio": r.bio,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.get("/experts")
async def list_experts(
    p: Principal = Depends(require_perms("contacts:expert:list")),
    db: AsyncSession = Depends(get_db),
    field_domain: str | None = None, level: str | None = None, keyword: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(CtExpert).order_by(CtExpert.created_at.desc())
    if field_domain:
        stmt = stmt.where(CtExpert.field_domain == field_domain)
    if level:
        stmt = stmt.where(CtExpert.level == level)
    if keyword:
        kw = f"%{keyword.strip()}%"
        stmt = stmt.where(
            CtExpert.name.ilike(kw) | CtExpert.organization.ilike(kw) | CtExpert.field_domain.ilike(kw)
        )
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    return page([serialize_expert(r) for r in rows], total)


def _apply_expert_body(r: CtExpert, body: dict, partial: bool) -> None:
    name = (body.get("name") or "").strip()
    organization = (body.get("organization") or "").strip()
    field_domain = (body.get("field_domain") or "").strip()
    phone = (body.get("phone") or "").strip()
    if not partial and (not name or not organization or not field_domain or not phone):
        raise ApiError(400, "姓名、所在机构、研究领域、联系电话不能为空")
    level = body.get("level")
    if level:
        if level not in EXPERT_LEVEL_LABELS:
            raise ApiError(400, "专家层级无效")
        r.level = level
    if name:
        r.name = name
    if organization:
        r.organization = organization
    if field_domain:
        r.field_domain = field_domain
    if phone:
        r.phone = phone
    for f in ("title", "email", "bio"):
        if f in body:
            setattr(r, f, body.get(f))


@router.post("/experts")
async def add_expert(
    body: dict,
    p: Principal = Depends(require_perms("contacts:expert:add")),
    db: AsyncSession = Depends(get_db),
):
    r = CtExpert(level=body.get("level") or "NATIONAL")
    _apply_expert_body(r, body, partial=False)
    db.add(r)
    await db.flush()
    return ok(serialize_expert(r), "专家档案已登记")


@router.put("/experts/{expert_id}")
async def edit_expert(
    expert_id: str, body: dict,
    p: Principal = Depends(require_perms("contacts:expert:edit")),
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(CtExpert, _parse_uuid(expert_id, "专家ID"))
    if not r:
        raise ApiError(404, "专家不存在")
    _apply_expert_body(r, body, partial=True)
    await db.flush()
    return ok(serialize_expert(r), "专家档案已更新")


@router.delete("/experts/{expert_id}")
async def del_expert(
    expert_id: str,
    p: Principal = Depends(require_perms("contacts:expert:del")),
    db: AsyncSession = Depends(get_db),
):
    r = await db.get(CtExpert, _parse_uuid(expert_id, "专家ID"))
    if not r:
        raise ApiError(404, "专家不存在")
    await db.delete(r)
    await db.flush()
    return ok(None, "删除成功")


# ---------------- 通讯录导入与同步 ----------------

@router.get("/sync/template")
async def sync_template(p: Principal = Depends(require_perms("contacts:sync:list"))):
    return ok(SYNC_TEMPLATE_COLUMNS, "获取导入模板成功")


@router.post("/sync/import")
async def sync_import(
    body: dict,
    p: Principal = Depends(require_perms("contacts:sync:import")),
    db: AsyncSession = Depends(get_db),
):
    """按 user_name upsert 员工：存在则更新 nick_name/phonenumber/email，
    不存在则以默认密码创建；部门按 dept_name 匹配，匹配不到挂第一个根部门。"""
    rows = body.get("rows")
    if not isinstance(rows, list):
        raise ApiError(400, "rows 必须为列表")

    depts = (await db.execute(
        select(SysDept).where(SysDept.del_flag == "0").order_by(SysDept.order_num, SysDept.dept_name)
    )).scalars().all()
    depts_by_name = {d.dept_name: d for d in depts}
    root_dept = next((d for d in depts if d.parent_id is None), None)

    created = updated = skipped = 0
    for row in rows:
        if not isinstance(row, dict):
            skipped += 1
            continue
        user_name = str(row.get("user_name") or "").strip()
        nick_name = str(row.get("nick_name") or "").strip()
        if not user_name or not nick_name:
            skipped += 1
            continue
        dept = None
        dept_name = str(row.get("dept_name") or "").strip()
        if dept_name:
            dept = depts_by_name.get(dept_name)
        if dept is None:
            dept = root_dept  # 找不到部门则挂第一个根部门（可能为 None）

        existing = (await db.execute(
            select(SysUser).where(SysUser.user_name == user_name)
        )).scalar_one_or_none()
        phonenumber = str(row.get("phonenumber") or "").strip() or None
        email = str(row.get("email") or "").strip() or None
        if existing:
            existing.nick_name = nick_name
            if phonenumber:
                existing.phonenumber = phonenumber
            if email:
                existing.email = email
            updated += 1
        else:
            sex = str(row.get("sex") or "").strip()
            sex = {"男": "0", "M": "0", "0": "0", "女": "1", "F": "1", "1": "1"}.get(sex, "2")
            db.add(SysUser(
                user_name=user_name,
                nick_name=nick_name,
                dept_id=dept.dept_id if dept else None,
                phonenumber=phonenumber,
                email=email,
                sex=sex,
                password_hash=hash_password(DEFAULT_IMPORT_PASSWORD),
            ))
            created += 1
        await db.flush()
    return ok({"created": created, "updated": updated, "skipped": skipped}, "导入完成")


@router.post("/sync/export")
async def sync_export(
    p: Principal = Depends(require_perms("contacts:sync:export")),
    db: AsyncSession = Depends(get_db),
):
    """全量员工导出（脱敏规则随当前查看者权限与领导强制脱敏名单）。"""
    users = (await db.execute(
        select(SysUser).options(selectinload(SysUser.posts))
        .where(SysUser.del_flag == "0").order_by(SysUser.created_at.desc())
    )).scalars().all()
    allow_full = bool(p.is_admin or p.has_perm("contacts:privacy:view"))
    leader_ids = await get_leader_user_ids(db)
    dept_map = await get_dept_name_map(db)
    rows = [serialize_employee(u, dept_map, leader_ids, allow_full) for u in users]
    return ok(rows, "导出成功")
