"""Access control & visitor management endpoints (closed loops):
- visitor self-booking with two-level audit (host confirm -> security approve);
- employee invitation skips audit and issues the access code directly;
- QR/FACE check-in, gate check-out; overdue-stay alarm notifies the host;
- blacklist interception and floor/elevator permission rules.

State machine:
PENDING_HOST -> PENDING_SECURITY -> APPROVED -> CHECKED_IN -> CHECKED_OUT
REJECTED (rejected at either audit stage); OVERDUE_STAY (overdue stay alarm)."""

import json as _json
import uuid
from datetime import datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import BUSINESS_TZ
from app.core.deps import Principal, require_auth, require_perms
from app.core.errors import ApiError
from app.core.resp import deleted, ok, page
from app.database import get_db
from app.models.extras import SysNotice
from app.models.system import SysConfig, SysUser
from app.models.visitor import VisAppointment, VisBlacklist

router = APIRouter(prefix="/api/visitor", tags=["门禁访客管理"])

INVITE_PREFIX = "【邀约】"
DEFAULT_ACCESS_RULES = {
    "valid_hours": 4,
    "allowed_floors": ["1F", "3F"],
    "secret_floor_blocked": ["8F", "9F"],
    "overdue_minutes": 30,
}

STATUS_LABELS = {
    "PENDING_HOST": "待受访人确认",
    "PENDING_SECURITY": "保卫处待审核",
    "APPROVED": "已发放通行码",
    "CHECKED_IN": "在院",
    "CHECKED_OUT": "已离场",
    "REJECTED": "已驳回",
    "OVERDUE_STAY": "滞留告警",
}


def parse_dt(s: str) -> datetime:
    """Parse ISO datetime; naive values are interpreted in the business timezone."""
    dt = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BUSINESS_TZ)
    return dt.astimezone(timezone.utc)


async def dept_and_children(dept_id, db: AsyncSession) -> list:
    from app.models.system import SysDept
    if not dept_id:
        return []
    rows = (await db.execute(
        select(SysDept.dept_id).where(SysDept.ancestors.contains(str(dept_id)), SysDept.del_flag == "0")
    )).scalars().all()
    return [dept_id, *rows]


async def host_name_map(db: AsyncSession, host_ids) -> dict:
    """Batch build host_user_id -> nick_name mapping (avoid lazy-load in async)."""
    ids = list({h for h in host_ids if h is not None})
    if not ids:
        return {}
    rows = (await db.execute(
        select(SysUser.user_id, SysUser.nick_name).where(SysUser.user_id.in_(ids))
    )).all()
    return {uid: name for uid, name in rows}


def serialize_appointment(r: VisAppointment, names: dict) -> dict:
    return {
        "appointment_id": str(r.appointment_id),
        "visitor_name": r.visitor_name,
        "visitor_phone": r.visitor_phone,
        "id_card_number": r.id_card_number,
        "company": r.company,
        "car_plate": r.car_plate,
        "visit_reason": r.visit_reason,
        "is_invitation": bool(r.visit_reason and r.visit_reason.startswith(INVITE_PREFIX)),
        "host_user_id": str(r.host_user_id),
        "host_name": names.get(r.host_user_id),
        "scheduled_start": r.scheduled_start.isoformat() if r.scheduled_start else None,
        "scheduled_end": r.scheduled_end.isoformat() if r.scheduled_end else None,
        "access_code": r.access_code,
        "status": r.status,
        "status_label": STATUS_LABELS.get(r.status, r.status),
        "check_in_time": r.check_in_time.isoformat() if r.check_in_time else None,
        "check_out_time": r.check_out_time.isoformat() if r.check_out_time else None,
        "pass_floor_permit": r.pass_floor_permit,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def serialize_blacklist(b: VisBlacklist) -> dict:
    return {
        "blacklist_id": str(b.blacklist_id),
        "name": b.name,
        "phone": b.phone,
        "id_card_number": b.id_card_number,
        "reason": b.reason,
        "created_by": b.created_by,
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }


async def gen_access_code(db: AsyncSession) -> str:
    """Access code: 'AC' + 10 upper hex chars, guaranteed unique."""
    while True:
        code = "AC" + uuid.uuid4().hex[:10].upper()
        dup = (await db.execute(
            select(VisAppointment.appointment_id).where(VisAppointment.access_code == code)
        )).scalar_one_or_none()
        if dup is None:
            return code


async def blacklist_hit(
    db: AsyncSession, name: str | None, phone: str | None, id_card: str | None
) -> VisBlacklist | None:
    conds = []
    if name:
        conds.append(VisBlacklist.name == name)
    if phone:
        conds.append(VisBlacklist.phone == phone)
    if id_card:
        conds.append(VisBlacklist.id_card_number == id_card)
    if not conds:
        return None
    return (await db.execute(select(VisBlacklist).where(or_(*conds)).limit(1))).scalars().first()


async def get_access_rules(db: AsyncSession) -> dict:
    cfg = (await db.execute(
        select(SysConfig).where(SysConfig.config_key == "visitor.access.rules.json")
    )).scalar_one_or_none()
    if cfg:
        try:
            return _json.loads(cfg.config_value)
        except (TypeError, ValueError):
            pass
    return dict(DEFAULT_ACCESS_RULES)


def add_notice(db: AsyncSession, user_id, title: str, content: str,
               notice_type: str = "INFO", link: str | None = None) -> None:
    db.add(SysNotice(
        user_id=user_id, title=title, content=content,
        notice_type=notice_type, source_module="visitor", link=link,
    ))


async def get_appointment_or_404(db: AsyncSession, appointment_id: str) -> VisAppointment:
    try:
        aid = uuid.UUID(appointment_id)
    except (ValueError, AttributeError):
        raise ApiError(404, "预约记录不存在")
    appt = await db.get(VisAppointment, aid)
    if not appt:
        raise ApiError(404, "预约记录不存在")
    return appt


def _parse_appointment_body(body: dict) -> dict:
    """Shared validation for POST /appointments and POST /invitations."""
    visitor_name = (body.get("visitor_name") or "").strip()
    visitor_phone = (body.get("visitor_phone") or "").strip()
    visit_reason = (body.get("visit_reason") or "").strip()
    if not visitor_name:
        raise ApiError(400, "访客姓名不能为空")
    if not visitor_phone:
        raise ApiError(400, "访客联系电话不能为空")
    if not visit_reason:
        raise ApiError(400, "来访事由不能为空")
    if not body.get("scheduled_start") or not body.get("scheduled_end"):
        raise ApiError(400, "请填写预约到达与离开时间")
    start = parse_dt(body["scheduled_start"])
    end = parse_dt(body["scheduled_end"])
    if end <= start:
        raise ApiError(400, "离开时间必须晚于到达时间")
    return {
        "visitor_name": visitor_name,
        "visitor_phone": visitor_phone,
        "id_card_number": (body.get("id_card_number") or "").strip() or None,
        "company": (body.get("company") or "").strip() or None,
        "car_plate": (body.get("car_plate") or "").strip() or None,
        "visit_reason": visit_reason,
        "scheduled_start": start,
        "scheduled_end": end,
        "pass_floor_permit": (body.get("pass_floor_permit") or "").strip() or "1F,3F",
    }


def _parse_host_id(body: dict, p: Principal) -> uuid.UUID:
    raw = body.get("host_user_id") or (str(p.user_id) if p.user_id else None)
    if not raw:
        raise ApiError(400, "请指定受访人")
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError):
        raise ApiError(400, "受访人ID格式无效")


# ---------------- dashboard (指挥屏) ----------------

@router.get("/dashboard")
async def visitor_dashboard(
    p: Principal = Depends(require_perms("visitor:dashboard:list")),
    db: AsyncSession = Depends(get_db),
):
    now = datetime.now(timezone.utc)
    tznow = now.astimezone(BUSINESS_TZ)
    day_start = datetime.combine(tznow.date(), time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    day_end = day_start + timedelta(days=1)

    rules = await get_access_rules(db)
    try:
        overdue_minutes = int(rules.get("overdue_minutes", DEFAULT_ACCESS_RULES["overdue_minutes"]))
    except (TypeError, ValueError):
        overdue_minutes = DEFAULT_ACCESS_RULES["overdue_minutes"]
    threshold = now - timedelta(minutes=overdue_minutes)

    # refresh overdue stays first: CHECKED_IN beyond authorized period -> OVERDUE_STAY + host notice
    overdue_rows = (await db.execute(
        select(VisAppointment).where(
            VisAppointment.status == "CHECKED_IN",
            VisAppointment.scheduled_end < threshold,
        ).order_by(VisAppointment.scheduled_end)
    )).scalars().all()
    for r in overdue_rows:
        r.status = "OVERDUE_STAY"
        add_notice(
            db, r.host_user_id, "访客滞留告警",
            f"访客 {r.visitor_name} 已超过授权停留时段 {overdue_minutes} 分钟未离场"
            f"（预约离开时间 {r.scheduled_end.astimezone(BUSINESS_TZ).strftime('%Y-%m-%d %H:%M')}），"
            f"请协同保卫处核查干预。",
            notice_type="URGENT",
            link=f"/visitor/checkout?appointment_id={r.appointment_id}",
        )

    today_total = (await db.execute(
        select(func.count()).select_from(VisAppointment).where(
            VisAppointment.scheduled_start >= day_start,
            VisAppointment.scheduled_start < day_end,
        )
    )).scalar()
    current_in = (await db.execute(
        select(func.count()).select_from(VisAppointment).where(VisAppointment.status == "CHECKED_IN")
    )).scalar()
    checked_out_today = (await db.execute(
        select(func.count()).select_from(VisAppointment).where(
            VisAppointment.status == "CHECKED_OUT",
            VisAppointment.check_out_time >= day_start,
            VisAppointment.check_out_time < day_end,
        )
    )).scalar()
    pending_audit = (await db.execute(
        select(func.count()).select_from(VisAppointment).where(
            VisAppointment.status.in_(["PENDING_HOST", "PENDING_SECURITY"])
        )
    )).scalar()

    names = await host_name_map(db, [r.host_user_id for r in overdue_rows])
    return ok({
        "stats": {
            "today_appointments": today_total,
            "current_in": current_in,
            "checked_out_today": checked_out_today,
            "pending_audit": pending_audit,
            "overdue_alerts": len(overdue_rows),
            "overdue_minutes": overdue_minutes,
        },
        "overdue_alerts": [serialize_appointment(r, names) for r in overdue_rows],
    }, "查询成功")


# ---------------- appointments ----------------

@router.get("/appointments")
async def list_appointments(
    p: Principal = Depends(require_perms("visitor:appointment:list")),
    db: AsyncSession = Depends(get_db),
    status: str | None = None,
    keyword: str | None = None,
    date: str | None = None,
    pageNum: int = 1,
    pageSize: int = 10,
):
    stmt = select(VisAppointment).order_by(VisAppointment.created_at.desc())
    if status:
        stmt = stmt.where(VisAppointment.status == status)
    if keyword:
        kw = f"%{keyword}%"
        stmt = stmt.where(or_(
            VisAppointment.visitor_name.ilike(kw),
            VisAppointment.visitor_phone.ilike(kw),
            VisAppointment.company.ilike(kw),
            VisAppointment.visit_reason.ilike(kw),
        ))
    if date:
        d = datetime.fromisoformat(date).date()
        stmt = stmt.where(
            VisAppointment.scheduled_start >= datetime.combine(d, time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc),
            VisAppointment.scheduled_start < datetime.combine(d + timedelta(days=1), time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc),
        )
    # data scope on the host (record owner)
    from app.core.deps import DataScope as DS
    if p.auth_kind == "user" and not p.is_admin:
        if p.data_scope == DS.SELF.value:
            stmt = stmt.where(VisAppointment.host_user_id == p.user_id)
        elif p.data_scope == DS.DEPT.value:
            stmt = stmt.where(VisAppointment.host_user_id.in_(select(SysUser.user_id).where(SysUser.dept_id == p.dept_id)))
        elif p.data_scope == DS.DEPT_AND_CHILD.value:
            ids = await dept_and_children(p.dept_id, db)
            stmt = stmt.where(VisAppointment.host_user_id.in_(select(SysUser.user_id).where(SysUser.dept_id.in_(ids))))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    names = await host_name_map(db, [r.host_user_id for r in rows])
    return page([serialize_appointment(r, names) for r in rows], total)


@router.post("/appointments")
async def create_appointment(
    body: dict,
    p: Principal = Depends(require_perms("visitor:appointment:add")),
    db: AsyncSession = Depends(get_db),
):
    fields = _parse_appointment_body(body)
    # blacklist interception comes first
    hit = await blacklist_hit(db, fields["visitor_name"], fields["visitor_phone"], fields["id_card_number"])
    if hit:
        raise ApiError(403, "该访客在黑名单中，预约已拦截")
    host_id = _parse_host_id(body, p)
    host = await db.get(SysUser, host_id)
    if not host:
        raise ApiError(404, "受访人不存在")
    appt = VisAppointment(
        visitor_name=fields["visitor_name"],
        visitor_phone=fields["visitor_phone"],
        id_card_number=fields["id_card_number"],
        company=fields["company"],
        car_plate=fields["car_plate"],
        visit_reason=fields["visit_reason"],
        host_user_id=host_id,
        scheduled_start=fields["scheduled_start"],
        scheduled_end=fields["scheduled_end"],
        pass_floor_permit=fields["pass_floor_permit"],
        access_code=await gen_access_code(db),
        status="PENDING_HOST",
    )
    db.add(appt)
    await db.flush()
    start_str = fields["scheduled_start"].astimezone(BUSINESS_TZ).strftime("%Y-%m-%d %H:%M")
    add_notice(
        db, host_id, "访客预约待确认",
        f"访客 {appt.visitor_name}（{appt.company or '外部访客'}）预约于 {start_str} 拜访您，"
        f"事由：{appt.visit_reason}。请及时确认。",
        notice_type="INFO",
        link=f"/visitor/reservations?appointment_id={appt.appointment_id}",
    )
    names = await host_name_map(db, [host_id])
    return ok(serialize_appointment(appt, names), "预约已提交，等待受访人确认")


@router.post("/appointments/{appointment_id}/audit")
async def audit_appointment(
    appointment_id: str,
    body: dict,
    p: Principal = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    appt = await get_appointment_or_404(db, appointment_id)
    action = body.get("action", "")
    if action not in ("APPROVE", "REJECT"):
        raise ApiError(400, "审批动作无效")
    reason = (body.get("reason") or "").strip()

    audit_reason = reason or None
    is_host = p.auth_kind == "user" and p.user_id == appt.host_user_id
    if appt.status == "PENDING_HOST":
        # level-1 audit: only the host himself or an admin may confirm
        if not (is_host or p.is_admin):
            raise ApiError(403, "仅受访人或管理员可确认来访预约")
        if action == "APPROVE":
            appt.status = "PENDING_SECURITY"
            add_notice(
                db, appt.host_user_id, "访客预约已确认",
                f"您已确认访客 {appt.visitor_name} 的来访预约，等待保卫处安全审核。",
                link=f"/visitor/reservations?appointment_id={appt.appointment_id}",
            )
        else:
            appt.status = "REJECTED"
            add_notice(
                db, appt.host_user_id, "访客预约已驳回",
                f"访客 {appt.visitor_name} 的来访预约已被受访人驳回" + (f"，原因：{reason}" if reason else "。"),
                notice_type="WARNING",
            )
    elif appt.status == "PENDING_SECURITY":
        # level-2 audit: security office permission required
        if not p.has_perm("visitor:appointment:audit"):
            raise ApiError(403, "无操作权限，需要 visitor:appointment:audit")
        if action == "APPROVE":
            # re-run blacklist check before issuing the access code
            hit = await blacklist_hit(db, appt.visitor_name, appt.visitor_phone, appt.id_card_number)
            if hit:
                appt.status = "REJECTED"
                audit_reason = "黑名单"
                add_notice(
                    db, appt.host_user_id, "访客预约被驳回",
                    f"访客 {appt.visitor_name} 命中黑名单（{hit.reason}），保卫处已驳回其来访申请。",
                    notice_type="WARNING",
                )
            else:
                appt.status = "APPROVED"
                add_notice(
                    db, appt.host_user_id, "访客通行码已发放",
                    f"访客 {appt.visitor_name} 已通过保卫处审核，通行码 {appt.access_code}，"
                    f"请告知访客凭码或人脸核验入场。",
                    notice_type="SUCCESS",
                    link=f"/visitor/reservations?appointment_id={appt.appointment_id}",
                )
        else:
            appt.status = "REJECTED"
            add_notice(
                db, appt.host_user_id, "访客预约被驳回",
                f"访客 {appt.visitor_name} 的来访预约未通过保卫处安全审核" + (f"，原因：{reason}" if reason else "。"),
                notice_type="WARNING",
            )
    else:
        raise ApiError(400, f"当前状态（{STATUS_LABELS.get(appt.status, appt.status)}）不允许审批")

    names = await host_name_map(db, [appt.host_user_id])
    data = serialize_appointment(appt, names)
    # VisAppointment has no audit-reason column (DEV_SPEC: keep models untouched);
    # the reason is persisted via SysNotice content and echoed back here.
    data["audit_reason"] = audit_reason
    return ok(data, "审批完成")


# ---------------- invitations (employee-initiated, audit-free) ----------------

@router.get("/invitations")
async def list_invitations(
    p: Principal = Depends(require_perms("visitor:invitation:list")),
    db: AsyncSession = Depends(get_db),
    pageNum: int = 1,
    pageSize: int = 10,
):
    stmt = select(VisAppointment).where(
        VisAppointment.visit_reason.startswith(INVITE_PREFIX),
        VisAppointment.status == "APPROVED",
    ).order_by(VisAppointment.created_at.desc())
    # invitations belong to the inviting employee (host); agents see all
    if p.auth_kind == "user":
        stmt = stmt.where(VisAppointment.host_user_id == p.user_id)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    names = await host_name_map(db, [r.host_user_id for r in rows])
    return page([serialize_appointment(r, names) for r in rows], total)


@router.post("/invitations")
async def create_invitation(
    body: dict,
    p: Principal = Depends(require_perms("visitor:invitation:add")),
    db: AsyncSession = Depends(get_db),
):
    fields = _parse_appointment_body(body)
    visit_reason = fields["visit_reason"]
    if not visit_reason.startswith(INVITE_PREFIX):
        visit_reason = INVITE_PREFIX + visit_reason
    hit = await blacklist_hit(db, fields["visitor_name"], fields["visitor_phone"], fields["id_card_number"])
    if hit:
        raise ApiError(403, "该访客在黑名单中，邀约已拦截")
    host_id = _parse_host_id(body, p)
    host = await db.get(SysUser, host_id)
    if not host:
        raise ApiError(404, "受访人不存在")
    appt = VisAppointment(
        visitor_name=fields["visitor_name"],
        visitor_phone=fields["visitor_phone"],
        id_card_number=fields["id_card_number"],
        company=fields["company"],
        car_plate=fields["car_plate"],
        visit_reason=visit_reason,
        host_user_id=host_id,
        scheduled_start=fields["scheduled_start"],
        scheduled_end=fields["scheduled_end"],
        pass_floor_permit=fields["pass_floor_permit"],
        access_code=await gen_access_code(db),
        status="APPROVED",  # employee invitation skips the two-level audit
    )
    db.add(appt)
    await db.flush()
    end_str = fields["scheduled_end"].astimezone(BUSINESS_TZ).strftime("%Y-%m-%d %H:%M")
    add_notice(
        db, host_id, "电子邀约函已生成",
        f"您邀约的访客 {appt.visitor_name} 已自动通过，通行码 {appt.access_code}，"
        f"有效期至 {end_str}，请将二维码告知访客。",
        notice_type="SUCCESS",
        link=f"/visitor/invitations?appointment_id={appt.appointment_id}",
    )
    names = await host_name_map(db, [host_id])
    return ok(serialize_appointment(appt, names), "邀约成功，访客通行码已生成")


# ---------------- gate check-in / check-out ----------------

@router.post("/appointments/{appointment_id}/checkin")
async def checkin(
    appointment_id: str,
    body: dict | None = None,
    p: Principal = Depends(require_perms("visitor:appointment:checkin")),
    db: AsyncSession = Depends(get_db),
):
    appt = await get_appointment_or_404(db, appointment_id)
    body = body or {}
    method = body.get("method", "DIRECT")
    if method not in ("QRCODE", "FACE", "DIRECT"):
        raise ApiError(400, "核验方式无效")
    if appt.status == "CHECKED_IN":
        raise ApiError(400, "该访客已在院，请勿重复入场")
    if appt.status in ("CHECKED_OUT", "OVERDUE_STAY"):
        raise ApiError(400, "该访客已离场销号，不可再次入场")
    if appt.status != "APPROVED":
        # pre-approval states are hard-blocked even with a code, protecting the two-level audit loop
        raise ApiError(400, "预约尚未通过审核，不可入场")
    code = (body.get("code") or "").strip()
    if code and code != appt.access_code:
        raise ApiError(400, "通行码无效或不匹配")
    appt.status = "CHECKED_IN"
    appt.check_in_time = datetime.now(timezone.utc)
    in_str = appt.check_in_time.astimezone(BUSINESS_TZ).strftime("%Y-%m-%d %H:%M")
    add_notice(
        db, appt.host_user_id, "访客已入场",
        f"您的访客 {appt.visitor_name} 已于 {in_str} 通过{'二维码' if method == 'QRCODE' else '人脸'}核验入场。",
        link=f"/visitor/checkout?appointment_id={appt.appointment_id}",
    )
    names = await host_name_map(db, [appt.host_user_id])
    return ok(serialize_appointment(appt, names), "核验通过，访客已入场")


@router.post("/appointments/{appointment_id}/checkout")
async def checkout(
    appointment_id: str,
    p: Principal = Depends(require_perms("visitor:appointment:checkout")),
    db: AsyncSession = Depends(get_db),
):
    appt = await get_appointment_or_404(db, appointment_id)
    # OVERDUE_STAY records were on-site and must be closed out by security intervention
    if appt.status not in ("CHECKED_IN", "OVERDUE_STAY"):
        raise ApiError(400, "该访客当前不在院，无法离场签退")
    appt.status = "CHECKED_OUT"
    appt.check_out_time = datetime.now(timezone.utc)
    out_str = appt.check_out_time.astimezone(BUSINESS_TZ).strftime("%Y-%m-%d %H:%M")
    add_notice(
        db, appt.host_user_id, "访客已离场",
        f"您的访客 {appt.visitor_name} 已于 {out_str} 离场签退，通行记录自动销号。",
    )
    names = await host_name_map(db, [appt.host_user_id])
    return ok(serialize_appointment(appt, names), "离场签退完成")


# ---------------- blacklist ----------------

@router.get("/blacklist")
async def list_blacklist(
    p: Principal = Depends(require_perms("visitor:blacklist:list")),
    db: AsyncSession = Depends(get_db),
    keyword: str | None = None,
    pageNum: int = 1,
    pageSize: int = 10,
):
    stmt = select(VisBlacklist).order_by(VisBlacklist.created_at.desc())
    if keyword:
        kw = f"%{keyword}%"
        stmt = stmt.where(or_(
            VisBlacklist.name.ilike(kw),
            VisBlacklist.phone.ilike(kw),
            VisBlacklist.id_card_number.ilike(kw),
        ))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    return page([serialize_blacklist(b) for b in rows], total)


@router.post("/blacklist")
async def add_blacklist(
    body: dict,
    p: Principal = Depends(require_perms("visitor:blacklist:add")),
    db: AsyncSession = Depends(get_db),
):
    name = (body.get("name") or "").strip()
    reason = (body.get("reason") or "").strip()
    if not name:
        raise ApiError(400, "黑名单姓名不能为空")
    if not reason:
        raise ApiError(400, "拉黑原因不能为空")
    b = VisBlacklist(
        name=name,
        phone=(body.get("phone") or "").strip() or None,
        id_card_number=(body.get("id_card_number") or "").strip() or None,
        reason=reason,
        created_by=p.display_name,
    )
    db.add(b)
    await db.flush()
    return ok(serialize_blacklist(b), "已加入黑名单")


@router.delete("/blacklist/{blacklist_id}")
async def remove_blacklist(
    blacklist_id: str,
    p: Principal = Depends(require_perms("visitor:blacklist:del")),
    db: AsyncSession = Depends(get_db),
):
    try:
        bid = uuid.UUID(blacklist_id)
    except (ValueError, AttributeError):
        raise ApiError(404, "黑名单记录不存在")
    b = await db.get(VisBlacklist, bid)
    if not b:
        raise ApiError(404, "黑名单记录不存在")
    await db.delete(b)
    return deleted("已移出黑名单")


# ---------------- access rules (floors / overdue window) ----------------

@router.get("/access-rules")
async def get_rules(
    p: Principal = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    return ok(await get_access_rules(db))


@router.put("/access-rules")
async def put_rules(
    body: dict,
    p: Principal = Depends(require_perms("visitor:rule:edit")),
    db: AsyncSession = Depends(get_db),
):
    cfg = (await db.execute(
        select(SysConfig).where(SysConfig.config_key == "visitor.access.rules.json")
    )).scalar_one_or_none()
    if cfg is None:
        cfg = SysConfig(
            config_name="门禁通行规则",
            config_key="visitor.access.rules.json",
            config_value=_json.dumps(body, ensure_ascii=False),
        )
        db.add(cfg)
    else:
        cfg.config_value = _json.dumps(body, ensure_ascii=False)
    return ok(body, "通行规则已保存")
