"""Attendance & leave management endpoints (closed loops):
- clock-in idempotency; leave approval deducts quota;
- trip approval exempts punches; remedy approval corrects records."""

import uuid
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import BUSINESS_TZ
from app.core.deps import Principal, apply_data_scope, require_auth, require_perms
from app.core.errors import ApiError
from app.core.resp import ok, page
from app.database import get_db
from app.models.attendance import AttClockRecord, AttLeaveApplication, AttPunchRemedy, AttTripApplication
from app.models.extras import AttLeaveQuota
from app.models.system import SysUser

router = APIRouter(prefix="/api/attendance", tags=["考勤管理"])

WORK_START = time(9, 0)
WORK_END = time(18, 0)
QUOTA_TYPES = {"ANNUAL": 5, "SICK": 15, "CASUAL": 10, "COMP": 3}


async def get_quota(db: AsyncSession, user_id, leave_type: str) -> AttLeaveQuota:
    year = datetime.now(BUSINESS_TZ).year
    q = (await db.execute(
        select(AttLeaveQuota).where(
            AttLeaveQuota.user_id == user_id,
            AttLeaveQuota.year == year,
            AttLeaveQuota.leave_type == leave_type,
        )
    )).scalar_one_or_none()
    if q is None:
        q = AttLeaveQuota(
            user_id=user_id, year=year, leave_type=leave_type,
            total_days=QUOTA_TYPES.get(leave_type, 10), used_days=0,
        )
        db.add(q)
        await db.flush()
    return q


# ---------------- clock ----------------

@router.post("/clock")
async def clock_in(
    body: dict,
    p: Principal = Depends(require_perms("attendance:clock:add")),
    db: AsyncSession = Depends(get_db),
):
    punch_type = body.get("punch_type", "IN")
    if punch_type not in ("IN", "OUT", "FIELD"):
        raise ApiError(400, "打卡类型无效")
    now = datetime.now(BUSINESS_TZ).astimezone(timezone.utc)
    today = now.astimezone(BUSINESS_TZ).date()
    day_start = datetime.combine(today, time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    day_end = day_start + timedelta(days=1)
    dup = (await db.execute(
        select(AttClockRecord).where(
            AttClockRecord.user_id == p.user_id,
            AttClockRecord.punch_type == punch_type,
            AttClockRecord.punch_time >= day_start,
            AttClockRecord.punch_time < day_end,
        ).limit(1)
    )).scalars().first()
    if dup:
        raise ApiError(400, "今日该类型已打卡，请勿重复操作")

    status = "NORMAL"
    if punch_type == "IN" and now.astimezone(BUSINESS_TZ).time() > WORK_START:
        status = "LATE"
    if punch_type == "OUT" and now.astimezone(BUSINESS_TZ).time() < WORK_END:
        status = "EARLY"
    rec = AttClockRecord(
        user_id=p.user_id, punch_time=now, punch_type=punch_type, status=status,
        location_gps=body.get("location_gps"), address=body.get("address"),
        wifi_bssid=body.get("wifi_bssid"), notes=body.get("notes"),
    )
    db.add(rec)
    await db.flush()
    return ok({"record_id": str(rec.record_id), "status": status, "punch_time": now.isoformat()}, "打卡成功")


@router.get("/records")
async def list_records(
    p: Principal = Depends(require_perms("attendance:record:list")),
    db: AsyncSession = Depends(get_db),
    start: str | None = None, end: str | None = None,
    user_id: str | None = None, status: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(AttClockRecord).order_by(AttClockRecord.punch_time.desc())
    if start:
        stmt = stmt.where(AttClockRecord.punch_time >= datetime.fromisoformat(start))
    if end:
        stmt = stmt.where(AttClockRecord.punch_time <= datetime.fromisoformat(end))
    if status:
        stmt = stmt.where(AttClockRecord.status == status)
    # data scope on the record owner
    from app.core.deps import DataScope as DS
    if p.auth_kind == "user" and not p.is_admin:
        if p.data_scope == DS.SELF.value:
            stmt = stmt.where(AttClockRecord.user_id == p.user_id)
        elif p.data_scope == DS.DEPT.value:
            stmt = stmt.where(AttClockRecord.user_id.in_(select(SysUser.user_id).where(SysUser.dept_id == p.dept_id)))
        elif p.data_scope == DS.DEPT_AND_CHILD.value:
            ids = await dept_and_children(p.dept_id, db)
            stmt = stmt.where(AttClockRecord.user_id.in_(select(SysUser.user_id).where(SysUser.dept_id.in_(ids))))
    if user_id:
        stmt = stmt.where(AttClockRecord.user_id == uuid.UUID(user_id))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(
        stmt.limit(pageSize).offset((pageNum - 1) * pageSize)
    )).scalars().all()
    return page([serialize_record(r, db) for r in rows], total)


async def dept_and_children(dept_id, db: AsyncSession) -> list:
    from app.models.system import SysDept
    if not dept_id:
        return []
    rows = (await db.execute(
        select(SysDept.dept_id).where(SysDept.ancestors.contains(str(dept_id)), SysDept.del_flag == "0")
    )).scalars().all()
    return [dept_id, *rows]


def serialize_record(r: AttClockRecord, db: AsyncSession) -> dict:
    return {
        "record_id": str(r.record_id),
        "user_id": str(r.user_id),
        "user_name": r.user.nick_name if r.user else None,
        "punch_time": r.punch_time.isoformat() if r.punch_time else None,
        "punch_type": r.punch_type,
        "status": r.status,
        "location_gps": r.location_gps,
        "address": r.address,
        "wifi_bssid": r.wifi_bssid,
        "notes": r.notes,
    }


# ---------------- leave ----------------

LEAVE_TYPE_LABELS = {
    "ANNUAL": "年假", "SICK": "病假", "CASUAL": "事假", "COMP": "调休假",
    "MARITAL": "婚假", "MATERNITY": "产假", "PATERNITY": "陪产假", "HOME_VISIT": "探亲假",
}


@router.get("/leaves")
async def list_leaves(
    p: Principal = Depends(require_perms("attendance:leave:list")),
    db: AsyncSession = Depends(get_db),
    audit_status: str | None = None, pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(AttLeaveApplication).order_by(AttLeaveApplication.created_at.desc())
    from app.core.deps import DataScope as DS
    if p.auth_kind == "user" and not p.is_admin:
        if p.data_scope == DS.SELF.value:
            stmt = stmt.where(AttLeaveApplication.user_id == p.user_id)
        elif p.data_scope == DS.DEPT.value:
            stmt = stmt.where(AttLeaveApplication.user_id.in_(select(SysUser.user_id).where(SysUser.dept_id == p.dept_id)))
        elif p.data_scope == DS.DEPT_AND_CHILD.value:
            ids = await dept_and_children(p.dept_id, db)
            stmt = stmt.where(AttLeaveApplication.user_id.in_(select(SysUser.user_id).where(SysUser.dept_id.in_(ids))))
    if audit_status:
        stmt = stmt.where(AttLeaveApplication.audit_status == audit_status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    return page([serialize_leave(r) for r in rows], total)


def serialize_leave(r: AttLeaveApplication) -> dict:
    return {
        "apply_id": str(r.apply_id),
        "user_id": str(r.user_id),
        "user_name": r.user.nick_name if r.user else None,
        "leave_type": r.leave_type,
        "leave_type_label": LEAVE_TYPE_LABELS.get(r.leave_type, r.leave_type),
        "start_time": r.start_time.isoformat(),
        "end_time": r.end_time.isoformat(),
        "duration_days": r.duration_days,
        "reason": r.reason,
        "audit_status": r.audit_status,
        "audit_comment": r.audit_comment,
        "approver_name": r.approver.nick_name if r.approver else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.post("/leaves")
async def apply_leave(body: dict, p: Principal = Depends(require_perms("attendance:leave:add")), db: AsyncSession = Depends(get_db)):
    leave_type = body.get("leave_type")
    if leave_type not in LEAVE_TYPE_LABELS:
        raise ApiError(400, "请假类型无效")
    start_time = datetime.fromisoformat(body["start_time"])
    end_time = datetime.fromisoformat(body["end_time"])
    if end_time <= start_time:
        raise ApiError(400, "结束时间必须晚于开始时间")
    days = round((end_time - start_time).total_seconds() / 86400, 1)
    if leave_type in QUOTA_TYPES:
        quota = await get_quota(db, p.user_id, leave_type)
        if quota.used_days + days > quota.total_days:
            raise ApiError(400, f"{LEAVE_TYPE_LABELS[leave_type]}余额不足：剩余 {quota.total_days - quota.used_days:.1f} 天")
    la = AttLeaveApplication(
        user_id=p.user_id, leave_type=leave_type, start_time=start_time, end_time=end_time,
        duration_days=days, reason=body.get("reason", ""),
        attachment_url=body.get("attachment_url"),
    )
    db.add(la)
    await db.flush()
    return ok(serialize_leave(la), "请假申请已提交")


@router.post("/leaves/{apply_id}/audit")
async def audit_leave(apply_id: str, body: dict, p: Principal = Depends(require_perms("attendance:leave:audit")), db: AsyncSession = Depends(get_db)):
    la = await db.get(AttLeaveApplication, uuid.UUID(apply_id))
    if not la:
        raise ApiError(404, "请假申请不存在")
    if la.audit_status != "PENDING":
        raise ApiError(400, "该申请已审批完成")
    action = body.get("action", "")
    if action not in ("APPROVE", "REJECT"):
        raise ApiError(400, "审批动作无效")
    la.audit_status = "APPROVED" if action == "APPROVE" else "REJECTED"
    la.approver_id = p.user_id
    la.audit_comment = body.get("comment")
    la.audit_time = datetime.now(timezone.utc)
    if action == "APPROVE" and la.leave_type in QUOTA_TYPES:
        quota = await get_quota(db, la.user_id, la.leave_type)
        quota.used_days += la.duration_days
    return ok(serialize_leave(la), "审批完成")


@router.get("/quotas")
async def list_quotas(p: Principal = Depends(require_auth), db: AsyncSession = Depends(get_db)):
    from app.core.deps import DataScope as DS
    stmt = select(AttLeaveQuota).where(AttLeaveQuota.year == datetime.now(BUSINESS_TZ).year)
    if p.auth_kind == "user" and not p.is_admin and p.data_scope == DS.SELF.value:
        stmt = stmt.where(AttLeaveQuota.user_id == p.user_id)
    rows = (await db.execute(stmt)).scalars().all()
    return ok([{
        "quota_id": str(q.quota_id), "user_id": str(q.user_id),
        "user_name": q.user.nick_name if q.user else None,
        "leave_type": q.leave_type, "leave_type_label": LEAVE_TYPE_LABELS.get(q.leave_type, q.leave_type),
        "total_days": q.total_days, "used_days": q.used_days,
        "remain_days": round(q.total_days - q.used_days, 1),
    } for q in rows])


# ---------------- trip (outing / business trip) ----------------

@router.get("/trips")
async def list_trips(
    p: Principal = Depends(require_perms("attendance:trip:list")),
    db: AsyncSession = Depends(get_db),
    audit_status: str | None = None, pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(AttTripApplication).order_by(AttTripApplication.created_at.desc())
    if audit_status:
        stmt = stmt.where(AttTripApplication.audit_status == audit_status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    names = await user_name_map(db, *[r.user_id for r in rows], *[r.approver_id for r in rows])
    return page([serialize_trip(r, names) for r in rows], total)


async def user_name_map(db: AsyncSession, *ids) -> dict:
    """Batch id->nick_name lookup (models have no approver relationship; avoid lazy loads)."""
    idset = {i for i in ids if i}
    if not idset:
        return {}
    rows = (await db.execute(
        select(SysUser.user_id, SysUser.nick_name).where(SysUser.user_id.in_(idset))
    )).all()
    return {str(uid): nick for uid, nick in rows}


def serialize_trip(r: AttTripApplication, names: dict | None = None) -> dict:
    names = names or {}
    return {
        "trip_id": str(r.trip_id),
        "user_id": str(r.user_id),
        "user_name": names.get(str(r.user_id)) or (r.user.nick_name if r.user else None),
        "trip_type": r.trip_type,
        "origin": r.origin,
        "destination": r.destination,
        "start_time": r.start_time.isoformat(),
        "end_time": r.end_time.isoformat(),
        "purpose": r.purpose,
        "audit_status": r.audit_status,
        "approver_name": names.get(str(r.approver_id)) if r.approver_id else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.post("/trips")
async def apply_trip(body: dict, p: Principal = Depends(require_perms("attendance:trip:add")), db: AsyncSession = Depends(get_db)):
    trip = AttTripApplication(
        user_id=p.user_id,
        trip_type=body.get("trip_type", "OUTING"),
        origin=body.get("origin", "单位总部"),
        destination=body.get("destination", ""),
        start_time=datetime.fromisoformat(body["start_time"]),
        end_time=datetime.fromisoformat(body["end_time"]),
        purpose=body.get("purpose", ""),
    )
    if trip.end_time <= trip.start_time:
        raise ApiError(400, "结束时间必须晚于开始时间")
    db.add(trip)
    await db.flush()
    names = await user_name_map(db, trip.user_id)
    return ok(serialize_trip(trip, names), "外出/出差申请已提交")


@router.post("/trips/{trip_id}/audit")
async def audit_trip(trip_id: str, body: dict, p: Principal = Depends(require_perms("attendance:trip:audit")), db: AsyncSession = Depends(get_db)):
    trip = await db.get(AttTripApplication, uuid.UUID(trip_id))
    if not trip:
        raise ApiError(404, "申请不存在")
    if trip.audit_status != "PENDING":
        raise ApiError(400, "该申请已审批完成")
    action = body.get("action", "")
    if action not in ("APPROVE", "REJECT"):
        raise ApiError(400, "审批动作无效")
    trip.audit_status = "APPROVED" if action == "APPROVE" else "REJECTED"
    trip.approver_id = p.user_id
    names = await user_name_map(db, trip.user_id, trip.approver_id)
    return ok(serialize_trip(trip, names), "审批完成")


# ---------------- remedy ----------------

@router.get("/remedies")
async def list_remedies(
    p: Principal = Depends(require_perms("attendance:remedy:list")),
    db: AsyncSession = Depends(get_db),
    audit_status: str | None = None, pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(AttPunchRemedy).order_by(AttPunchRemedy.created_at.desc())
    if audit_status:
        stmt = stmt.where(AttPunchRemedy.audit_status == audit_status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    names = await user_name_map(db, *[r.user_id for r in rows], *[r.approver_id for r in rows])
    return page([serialize_remedy(r, names) for r in rows], total)


def serialize_remedy(r: AttPunchRemedy, names: dict | None = None) -> dict:
    names = names or {}
    return {
        "remedy_id": str(r.remedy_id),
        "user_id": str(r.user_id),
        "user_name": names.get(str(r.user_id)) or (r.user.nick_name if r.user else None),
        "remedy_time": r.remedy_time.isoformat(),
        "punch_type": r.punch_type,
        "reason": r.reason,
        "audit_status": r.audit_status,
        "approver_name": names.get(str(r.approver_id)) if r.approver_id else None,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


@router.post("/remedies")
async def apply_remedy(body: dict, p: Principal = Depends(require_perms("attendance:remedy:add")), db: AsyncSession = Depends(get_db)):
    r = AttPunchRemedy(
        user_id=p.user_id,
        remedy_time=datetime.fromisoformat(body["remedy_time"]),
        punch_type=body.get("punch_type", "IN"),
        reason=body.get("reason", ""),
    )
    db.add(r)
    await db.flush()
    names = await user_name_map(db, r.user_id)
    return ok(serialize_remedy(r, names), "补卡申请已提交")


@router.post("/remedies/{remedy_id}/audit")
async def audit_remedy(remedy_id: str, body: dict, p: Principal = Depends(require_perms("attendance:remedy:audit")), db: AsyncSession = Depends(get_db)):
    r = await db.get(AttPunchRemedy, uuid.UUID(remedy_id))
    if not r:
        raise ApiError(404, "补卡申请不存在")
    if r.audit_status != "PENDING":
        raise ApiError(400, "该申请已审批完成")
    action = body.get("action", "")
    if action not in ("APPROVE", "REJECT"):
        raise ApiError(400, "审批动作无效")
    r.audit_status = "APPROVED" if action == "APPROVE" else "REJECTED"
    r.approver_id = p.user_id
    if action == "APPROVE":
        # closed loop: write the corrected punch record
        day_local = r.remedy_time.astimezone(BUSINESS_TZ).date()
        day_start = datetime.combine(day_local, time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
        day_end = day_start + timedelta(days=1)
        dup = (await db.execute(
            select(AttClockRecord).where(
                AttClockRecord.user_id == r.user_id,
                AttClockRecord.punch_type == r.punch_type,
                AttClockRecord.punch_time >= day_start,
                AttClockRecord.punch_time < day_end,
            ).limit(1)
        )).scalars().first()
        if not dup:
            db.add(AttClockRecord(
                user_id=r.user_id, punch_time=r.remedy_time, punch_type=r.punch_type,
                status="NORMAL", notes=f"补卡修正（{p.display_name} 审批）",
            ))
    names = await user_name_map(db, r.user_id, r.approver_id)
    return ok(serialize_remedy(r, names), "审批完成")


# ---------------- dashboard & settlement ----------------

@router.get("/dashboard")
async def attendance_dashboard(p: Principal = Depends(require_auth), db: AsyncSession = Depends(get_db)):
    tznow = datetime.now(BUSINESS_TZ)
    today = tznow.date()
    day_start = datetime.combine(today, time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    month_start = today.replace(day=1)
    m_start_utc = datetime.combine(month_start, time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)

    today_records = (await db.execute(
        select(AttClockRecord).where(
            AttClockRecord.user_id == p.user_id,
            AttClockRecord.punch_time >= day_start,
        ).order_by(AttClockRecord.punch_time)
    )).scalars().all()
    month_records = (await db.execute(
        select(AttClockRecord).where(
            AttClockRecord.user_id == p.user_id,
            AttClockRecord.punch_time >= m_start_utc,
        )
    )).scalars().all()
    late = sum(1 for r in month_records if r.status == "LATE")
    early = sum(1 for r in month_records if r.status == "EARLY")
    workdays = today.day
    absent_days = max(0, workdays - len({r.punch_time.astimezone(BUSINESS_TZ).date() for r in month_records}))
    on_trip = (await db.execute(
        select(AttTripApplication).where(
            AttTripApplication.user_id == p.user_id,
            AttTripApplication.audit_status == "APPROVED",
            AttTripApplication.start_time <= datetime.now(timezone.utc),
            AttTripApplication.end_time >= datetime.now(timezone.utc),
        )
    )).scalars().first()
    quotas = (await db.execute(
        select(AttLeaveQuota).where(AttLeaveQuota.user_id == p.user_id, AttLeaveQuota.year == today.year)
    )).scalars().all()
    return ok({
        "today": {
            "date": today.isoformat(),
            "clocked_in": any(r.punch_type in ("IN", "FIELD") for r in today_records),
            "clocked_out": any(r.punch_type == "OUT" for r in today_records),
            "records": [serialize_record(r, db) for r in today_records],
            "on_approved_trip": on_trip is not None,
        },
        "month": {"late": late, "early": early, "absent_days": absent_days, "workdays": workdays,
                  "attendance_rate": round(max(0, (workdays - absent_days)) / max(1, workdays) * 100, 1)},
        "quotas": [{
            "leave_type": q.leave_type, "leave_type_label": LEAVE_TYPE_LABELS.get(q.leave_type, q.leave_type),
            "total_days": q.total_days, "used_days": q.used_days, "remain_days": round(q.total_days - q.used_days, 1),
        } for q in quotas],
    })


OVERTIME_AFTER_MIN = 60  # 工作日下班后加班满 60 分钟才计入加班池


async def _work_end_time(db: AsyncSession) -> time:
    """Work end time from attendance rule config (default 18:00)."""
    from app.models.system import SysConfig
    import json as _json
    cfg = (await db.execute(select(SysConfig).where(SysConfig.config_key == "attendance.rule.json"))).scalar_one_or_none()
    try:
        return time.fromisoformat(_json.loads(cfg.config_value).get("work_end", "18:00"))
    except Exception:
        return time(18, 0)


def _overtime_minutes(out_local_times: list[datetime], work_end_t: time) -> int:
    """Sum overtime minutes across workdays: latest OUT punch per workday,
    counting minutes after work_end only when the day clears the threshold."""
    per_day: dict[date, datetime] = {}
    for lt in out_local_times:
        if lt.weekday() >= 5:
            continue
        d = lt.date()
        if d not in per_day or lt > per_day[d]:
            per_day[d] = lt
    end_min = work_end_t.hour * 60 + work_end_t.minute
    total = 0
    for lt in per_day.values():
        minutes = lt.hour * 60 + lt.minute - end_min
        if minutes >= OVERTIME_AFTER_MIN:
            total += minutes
    return total


@router.get("/monthly-settlement")
async def monthly_settlement(
    month: str = Query(default=None, description="YYYY-MM"),
    p: Principal = Depends(require_perms("attendance:report:list")),
    db: AsyncSession = Depends(get_db),
):
    tznow = datetime.now(BUSINESS_TZ)
    if month:
        y, m = (int(x) for x in month.split("-"))
    else:
        y, m = tznow.year, tznow.month
    m_start = datetime.combine(date(y, m, 1), time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    m_end = datetime.combine(date(y + (m == 12), (m % 12) + 1, 1), time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)

    users = (await db.execute(select(SysUser).where(SysUser.del_flag == "0", SysUser.status == "0"))).scalars().all()
    records = (await db.execute(
        select(AttClockRecord).where(AttClockRecord.punch_time >= m_start, AttClockRecord.punch_time < m_end)
    )).scalars().all()
    leaves = (await db.execute(
        select(AttLeaveApplication).where(
            AttLeaveApplication.audit_status == "APPROVED",
            AttLeaveApplication.start_time < m_end, AttLeaveApplication.end_time >= m_start,
        )
    )).scalars().all()
    trips = (await db.execute(
        select(AttTripApplication).where(
            AttTripApplication.audit_status == "APPROVED",
            AttTripApplication.start_time < m_end, AttTripApplication.end_time >= m_start,
        )
    )).scalars().all()

    rows = []
    work_end_t = await _work_end_time(db)
    for u in users:
        recs = [r for r in records if r.user_id == u.user_id]
        days = {r.punch_time.astimezone(BUSINESS_TZ).date() for r in recs}
        my_leaves = sum(l.duration_days for l in leaves if l.user_id == u.user_id)
        my_trips = len({t.start_time.astimezone(BUSINESS_TZ).date() for t in trips if t.user_id == u.user_id})
        rows.append({
            "user_id": str(u.user_id), "user_name": u.nick_name,
            "dept": u.department.dept_name if u.department else None,
            "should_days": 22, "actual_days": len(days),
            "late": sum(1 for r in recs if r.status == "LATE"),
            "early": sum(1 for r in recs if r.status == "EARLY"),
            "leave_days": my_leaves, "trip_days": my_trips,
            "overtime_hours": round(_overtime_minutes(
                [r.punch_time.astimezone(BUSINESS_TZ) for r in recs if r.punch_type in ("OUT", "FIELD")],
                work_end_t,
            ) / 60.0, 1),
        })
    return ok({"month": f"{y}-{m:02d}", "locked": False, "rows": rows})


@router.get("/rules")
async def get_rules(p: Principal = Depends(require_auth), db: AsyncSession = Depends(get_db)):
    from app.models.system import SysConfig
    cfg = (await db.execute(select(SysConfig).where(SysConfig.config_key == "attendance.rule.json"))).scalar_one_or_none()
    import json as _json
    default = {
        "shift_name": "标准工时制", "work_days": "周一至周五",
        "work_start": "09:00", "work_end": "18:00",
        "late_threshold_min": 10, "clock_radius_m": 500,
        "wifi_bssid": "AA:BB:CC:DD:EE:FF", "flex_minutes": 30,
        "groups": [
            {"group_name": "机关本部考勤组", "members": 86, "mode": "固定班次"},
            {"group_name": "窗口服务班考勤组", "members": 24, "mode": "排班制"},
            {"group_name": "外勤巡查考勤组", "members": 17, "mode": "自由工时"},
        ],
    }
    return ok(_json.loads(cfg.config_value) if cfg else default)


@router.put("/rules")
async def put_rules(body: dict, p: Principal = Depends(require_perms("attendance:rule:edit")), db: AsyncSession = Depends(get_db)):
    from app.models.system import SysConfig
    import json as _json
    cfg = (await db.execute(select(SysConfig).where(SysConfig.config_key == "attendance.rule.json"))).scalar_one_or_none()
    if cfg is None:
        cfg = SysConfig(config_name="考勤规则", config_key="attendance.rule.json", config_value=_json.dumps(body, ensure_ascii=False))
        db.add(cfg)
    else:
        cfg.config_value = _json.dumps(body, ensure_ascii=False)
    return ok(body, "规则已保存")


# ---------------- overtime → comp exchange ----------------

@router.get("/overtime/summary")
async def overtime_summary(p: Principal = Depends(require_auth), db: AsyncSession = Depends(get_db)):
    """Personal overtime pool + exchange ledger.

    Pool = workday clock-out minutes beyond work_end (>= 60min threshold),
    minus hours already exchanged into COMP quota."""
    from app.models.attendance import AttOvertimeExchange

    recs = (await db.execute(
        select(AttClockRecord).where(
            AttClockRecord.user_id == p.user_id,
            AttClockRecord.punch_type.in_(("OUT", "FIELD")),
        )
    )).scalars().all()
    work_end_t = await _work_end_time(db)
    accrued_hours = round(_overtime_minutes(
        [r.punch_time.astimezone(BUSINESS_TZ) for r in recs], work_end_t) / 60.0, 1)

    exchanges = (await db.execute(
        select(AttOvertimeExchange).where(AttOvertimeExchange.user_id == p.user_id)
        .order_by(AttOvertimeExchange.created_at.desc())
    )).scalars().all()
    exchanged_hours = round(sum(e.hours for e in exchanges), 1)
    return ok({
        "accrued_hours": accrued_hours,
        "exchanged_hours": exchanged_hours,
        "available_hours": round(accrued_hours - exchanged_hours, 1),
        "exchanged_days": round(sum(e.days for e in exchanges), 1),
        "rule": f"工作日 {work_end_t.strftime('%H:%M')} 后下班满 {OVERTIME_AFTER_MIN} 分钟计入加班池，8 小时 = 1 天调休（0.5 天起兑）",
        "records": [{
            "exchange_id": str(e.exchange_id), "month": e.month,
            "hours": e.hours, "days": e.days, "note": e.note,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        } for e in exchanges],
    })


@router.post("/overtime/exchange")
async def overtime_exchange(
    body: dict,
    p: Principal = Depends(require_perms("attendance:leave:add")),
    db: AsyncSession = Depends(get_db),
):
    """Exchange accrued overtime hours for COMP leave quota (8h = 1 day)."""
    from app.models.attendance import AttOvertimeExchange
    import math

    try:
        hours = round(float(body.get("hours") or 0), 1)
    except (TypeError, ValueError):
        raise ApiError(400, "兑换时数无效")
    if hours < 1:
        raise ApiError(400, "单次兑换至少 1 小时")

    recs = (await db.execute(
        select(AttClockRecord).where(
            AttClockRecord.user_id == p.user_id,
            AttClockRecord.punch_type.in_(("OUT", "FIELD")),
        )
    )).scalars().all()
    work_end_t = await _work_end_time(db)
    accrued = _overtime_minutes([r.punch_time.astimezone(BUSINESS_TZ) for r in recs], work_end_t) / 60.0
    exchanged = sum(e.hours for e in (await db.execute(
        select(AttOvertimeExchange).where(AttOvertimeExchange.user_id == p.user_id)
    )).scalars().all())
    available = round(accrued - exchanged, 1)
    if hours > available:
        raise ApiError(400, f"可兑换加班仅剩 {available} 小时")

    days = math.floor(hours / 8 * 2) / 2  # 0.5 天粒度
    if days < 0.5:
        raise ApiError(400, "加班时数不足以折算 0.5 天调休（8 小时 = 1 天）")

    tznow = datetime.now(BUSINESS_TZ)
    rec = AttOvertimeExchange(
        user_id=p.user_id, month=tznow.strftime("%Y-%m"),
        hours=hours, days=days,
        note=(str(body.get("note") or "").strip() or None),
    )
    db.add(rec)
    q = await get_quota(db, p.user_id, "COMP")
    q.total_days = (q.total_days or 0) + days
    await db.flush()
    return ok({
        "exchange_id": str(rec.exchange_id), "hours": hours, "days": days,
        "comp_total_days": q.total_days,
        "available_hours": round(available - hours, 1),
    }, "兑换成功，调休额度已入账")
