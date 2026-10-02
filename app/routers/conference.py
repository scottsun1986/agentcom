"""Conference & meeting-room management endpoints (closed loop):
room CRUD -> tsrange conflict-checked booking (GiST exclusion constraint as DB-level
last guard) -> schedule board -> affairs & attendee roster -> government seating
engine -> logistics service dispatch -> e-checkin stats -> versioned minutes ->
action items -> one-key supervision conversion (supervision.build_task) ->
visitor invitations (bridging to access-control VisAppointment closed loop)."""

import uuid
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql import TSRANGE
from sqlalchemy.dialects.postgresql.ranges import Range
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import BUSINESS_TZ
from app.core.deps import DataScope, Principal, require_auth, require_perms
from app.core.errors import ApiError
from app.core.resp import ok, page
from app.database import get_db
from app.models.conference import (
    ConfActionItem,
    ConfAffair,
    ConfAttendee,
    ConfBooking,
    ConfMinutes,
    ConfRoom,
    ConfServiceTicket,
)
from app.models.extras import SysNotice
from app.models.system import SysDept, SysUser
from app.models.visitor import VisAppointment
from app.routers.supervision import build_task

router = APIRouter(prefix="/api/conference", tags=["会务与会议室管理"])

ROOM_STATUSES = {"AVAILABLE": "可用", "MAINTENANCE": "维护中", "DISABLED": "已停用"}
MEETING_TYPES = {"PARTY_COMMITTEE": "党组会", "EXECUTIVE": "常务会", "WORK": "工作例会", "EXTERNAL": "外部研讨会"}
SECURITY_LEVELS = {"TOP_SECRET": "涉密", "CONFIDENTIAL": "秘密", "NORMAL": "非密"}
SEATING_RULES = {"CENTER_FIRST": "以中为尊", "FRONT_FIRST": "前排为尊", "LEFT_FIRST": "左为上", "RIGHT_FIRST": "右为上"}
ATTENDANCE_STATUSES = {"CONFIRMED": "确认参会", "LEAVE": "请假", "DEPUTY": "代会"}
SERVICE_TYPE_LABELS = {"TEA": "茶歇备水", "AV_PROJECTOR": "音响投影", "LED_BANNER": "横幅屏显", "AC": "空调调试"}
TICKET_STATUS_LABELS = {"PENDING": "待派工", "PROCESSING": "进行中", "COMPLETED": "已完成"}
BOOKING_STATUS_LABELS = {"CONFIRMED": "已确认", "CANCELLED": "已取消", "PENDING_APPROVAL": "待审批"}
ACTION_STATUS_LABELS = {"PENDING": "待处理", "IN_PROGRESS": "进行中", "DONE": "已完成"}
PRIORITIES = {"TOP", "URGENT", "NORMAL"}


# ---------------- shared helpers ----------------

def parse_uuid(value, msg: str = "标识格式无效") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise ApiError(400, msg)


def parse_dt(value, msg: str = "时间格式无效，应为 ISO8601") -> datetime:
    """解析 ISO 时间；无时区时按业务时区（Asia/Shanghai）解释，统一转 UTC 存储。"""
    try:
        dt = datetime.fromisoformat(str(value))
    except (ValueError, TypeError):
        raise ApiError(400, msg)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BUSINESS_TZ)
    return dt.astimezone(timezone.utc)


def parse_day(value, msg: str = "日期格式无效，应为 YYYY-MM-DD") -> date:
    try:
        return datetime.strptime(str(value)[:10], "%Y-%m-%d").date()
    except (ValueError, TypeError):
        raise ApiError(400, msg)


def parse_int(value, msg: str = "数值无效", default=None) -> int:
    if value is None and default is not None:
        return default
    try:
        return int(value)
    except (TypeError, ValueError):
        raise ApiError(400, msg)


def _aware(dt: datetime | None) -> datetime | None:
    """during 列为 TSRANGE（无时区），读出 naive 时按 UTC 解释，避免 astimezone 报错。"""
    if dt is not None and dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _fmt_dt(dt: datetime | None) -> str | None:
    dt = _aware(dt)
    return dt.astimezone(BUSINESS_TZ).isoformat() if dt else None


def day_bounds(day: date) -> tuple[datetime, datetime]:
    start = datetime.combine(day, time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    return start, start + timedelta(days=1)


async def dept_and_children(dept_id, db: AsyncSession) -> list:
    """复制 attendance.py 同名辅助函数（规范禁止修改 core/deps 之外的公共依赖）。"""
    from app.models.system import SysDept
    if not dept_id:
        return []
    rows = (await db.execute(
        select(SysDept.dept_id).where(SysDept.ancestors.contains(str(dept_id)), SysDept.del_flag == "0")
    )).scalars().all()
    return [dept_id, *rows]


async def apply_owner_scope(stmt, p: Principal, owner_col, db: AsyncSession):
    """RuoYi 数据权限（按记录归属人过滤，同 attendance.py）：SELF 仅本人；DEPT/DEPT_AND_CHILD 按部门用户集合。"""
    if p.auth_kind != "user" or p.is_admin:
        return stmt
    if p.data_scope == DataScope.SELF.value:
        return stmt.where(owner_col == p.user_id)
    if p.data_scope == DataScope.DEPT.value:
        return stmt.where(owner_col.in_(select(SysUser.user_id).where(SysUser.dept_id == p.dept_id)))
    if p.data_scope == DataScope.DEPT_AND_CHILD.value:
        ids = await dept_and_children(p.dept_id, db)
        return stmt.where(owner_col.in_(select(SysUser.user_id).where(SysUser.dept_id.in_(ids))))
    return stmt


async def user_name_map(db: AsyncSession, user_ids) -> dict:
    """批量 id->nick_name 映射，避免异步会话懒加载（MissingGreenlet）。"""
    ids = {u for u in user_ids if u is not None}
    if not ids:
        return {}
    rows = (await db.execute(
        select(SysUser.user_id, SysUser.nick_name).where(SysUser.user_id.in_(ids))
    )).all()
    return {r.user_id: r.nick_name for r in rows}


async def dept_name_map(db: AsyncSession, dept_ids) -> dict:
    ids = {d for d in dept_ids if d is not None}
    if not ids:
        return {}
    rows = (await db.execute(
        select(SysDept.dept_id, SysDept.dept_name).where(SysDept.dept_id.in_(ids))
    )).all()
    return {r.dept_id: r.dept_name for r in rows}


async def room_name_map(db: AsyncSession, room_ids) -> dict:
    ids = {r for r in room_ids if r is not None}
    if not ids:
        return {}
    rows = (await db.execute(
        select(ConfRoom.id, ConfRoom.name).where(ConfRoom.id.in_(ids))
    )).all()
    return {r.id: r.name for r in rows}


async def booking_map(db: AsyncSession, booking_ids) -> dict:
    """booking_id -> ConfBooking 实体（仅列属性，触发懒加载的 relationship 不可访问）。"""
    ids = {b for b in booking_ids if b is not None}
    if not ids:
        return {}
    rows = (await db.execute(select(ConfBooking).where(ConfBooking.id.in_(ids)))).scalars().all()
    return {b.id: b for b in rows}


async def find_conflict(db: AsyncSession, room_id, start: datetime, end: datetime,
                        status_filter: str | None = None) -> ConfBooking | None:
    """同会议室时间重叠查询：start < 已有end AND end > 已有start 且未取消。"""
    stmt = select(ConfBooking).where(
        ConfBooking.room_id == room_id,
        ConfBooking.during.overlaps(Range(start, end)),
        ConfBooking.status != "CANCELLED",
    )
    if status_filter:
        stmt = stmt.where(ConfBooking.status == status_filter)
    stmt = stmt.order_by(ConfBooking.during)
    return (await db.execute(stmt)).scalars().first()


async def get_room_or_404(db: AsyncSession, value) -> ConfRoom:
    room = await db.get(ConfRoom, parse_uuid(value, "会议室标识格式无效"))
    if not room:
        raise ApiError(404, "会议室不存在")
    return room


async def get_booking_or_404(db: AsyncSession, value) -> ConfBooking:
    booking = await db.get(ConfBooking, parse_uuid(value, "预订标识格式无效"))
    if not booking:
        raise ApiError(404, "会议室预订不存在")
    return booking


async def get_affair_or_404(db: AsyncSession, value) -> ConfAffair:
    affair = await db.get(ConfAffair, parse_uuid(value, "会议标识格式无效"))
    if not affair:
        raise ApiError(404, "会务统筹单不存在")
    return affair


# ---------------- serializers ----------------

def serialize_room(r: ConfRoom, dept_names: dict | None = None) -> dict:
    return {
        "id": str(r.id),
        "room_id": str(r.id),
        "name": r.name,
        "location": r.location,
        "capacity": r.capacity,
        "min_capacity": r.min_capacity,
        "max_capacity": r.max_capacity,
        "amenities": list(r.amenities or []),
        "status": r.status,
        "status_label": ROOM_STATUSES.get(r.status, r.status),
        "department_id": str(r.department_id) if r.department_id else None,
        "department_name": (dept_names or {}).get(r.department_id),
        "max_duration_hours": r.max_duration_hours,
        "advance_booking_days": r.advance_booking_days,
        "buffer_time_minutes": r.buffer_time_minutes,
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def serialize_booking(b: ConfBooking, room_names: dict, user_names: dict) -> dict:
    return {
        "id": str(b.id),
        "booking_id": str(b.id),
        "room_id": str(b.room_id),
        "room_name": room_names.get(b.room_id),
        "title": b.title,
        "start_time": _fmt_dt(b.during.lower),
        "end_time": _fmt_dt(b.during.upper),
        "attendee_count": b.attendee_count,
        "status": b.status,
        "status_label": BOOKING_STATUS_LABELS.get(b.status, b.status),
        "host_name": b.host_name,
        "service_status": b.service_status,
        "user_id": str(b.user_id),
        "user_name": user_names.get(b.user_id),
        "created_at": b.created_at.isoformat() if b.created_at else None,
    }


def serialize_affair(a: ConfAffair, bookings: dict, room_names: dict) -> dict:
    b = bookings.get(a.booking_id)
    return {
        "affair_id": str(a.affair_id),
        "booking_id": str(a.booking_id),
        "booking_title": b.title if b else None,
        "room_name": room_names.get(b.room_id) if b else None,
        "start_time": _fmt_dt(b.during.lower) if b else None,
        "end_time": _fmt_dt(b.during.upper) if b else None,
        "title": a.title,
        "meeting_type": a.meeting_type,
        "meeting_type_label": MEETING_TYPES.get(a.meeting_type, a.meeting_type),
        "security_level": a.security_level,
        "security_level_label": SECURITY_LEVELS.get(a.security_level, a.security_level),
        "agenda_text": a.agenda_text,
        "created_at": a.created_at.isoformat() if a.created_at else None,
    }


def serialize_attendee(a: ConfAttendee) -> dict:
    return {
        "attendee_id": str(a.attendee_id),
        "affair_id": str(a.affair_id),
        "name": a.name,
        "dept_name": a.dept_name,
        "post_name": a.post_name,
        "attendance_status": a.attendance_status,
        "attendance_status_label": ATTENDANCE_STATUSES.get(a.attendance_status, a.attendance_status),
        "deputy_name": a.deputy_name,
        "seat_label": a.seat_label,
        "sign_in_time": _fmt_dt(a.sign_in_time),
    }


def serialize_ticket(t: ConfServiceTicket, bookings: dict) -> dict:
    b = bookings.get(t.booking_id)
    return {
        "ticket_id": str(t.ticket_id),
        "booking_id": str(t.booking_id),
        "booking_title": b.title if b else None,
        "service_type": t.service_type,
        "service_type_label": SERVICE_TYPE_LABELS.get(t.service_type, t.service_type),
        "assignee_name": t.assignee_name,
        "status": t.status,
        "status_label": TICKET_STATUS_LABELS.get(t.status, t.status),
        "notes": t.notes,
    }


def serialize_minutes(m: ConfMinutes, bookings: dict, user_names: dict) -> dict:
    return {
        "id": str(m.id),
        "booking_id": str(m.booking_id),
        "booking_title": bookings.get(m.booking_id).title if bookings.get(m.booking_id) else None,
        "author_id": str(m.author_id),
        "author_name": user_names.get(m.author_id),
        "content": m.content,
        "version": m.version,
        "created_at": m.created_at.isoformat() if m.created_at else None,
        "updated_at": m.updated_at.isoformat() if m.updated_at else None,
    }


def serialize_action_item(i: ConfActionItem) -> dict:
    return {
        "id": str(i.id),
        "minutes_id": str(i.minutes_id),
        "booking_id": str(i.booking_id),
        "task_description": i.task_description,
        "assignee_name": i.assignee_name,
        "due_date": _fmt_dt(i.due_date),
        "status": i.status,
        "status_label": ACTION_STATUS_LABELS.get(i.status, i.status),
        "converted_supervision_id": str(i.converted_supervision_id) if i.converted_supervision_id else None,
    }


# ---------------- rooms ----------------

@router.get("/rooms")
async def list_rooms(
    p: Principal = Depends(require_perms("conference:room:list")),
    db: AsyncSession = Depends(get_db),
    keyword: str | None = None, status: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(ConfRoom).order_by(ConfRoom.created_at.desc())
    if keyword:
        stmt = stmt.where(or_(ConfRoom.name.contains(keyword), ConfRoom.location.contains(keyword)))
    if status:
        stmt = stmt.where(ConfRoom.status == status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    names = await dept_name_map(db, {r.department_id for r in rows})
    return page([serialize_room(r, names) for r in rows], total)


@router.post("/rooms")
async def create_room(
    body: dict,
    p: Principal = Depends(require_perms("conference:room:add")),
    db: AsyncSession = Depends(get_db),
):
    name = (body.get("name") or "").strip()
    location = (body.get("location") or "").strip()
    if not name or not location:
        raise ApiError(400, "会议室名称与位置不能为空")
    capacity = parse_int(body.get("capacity"), "容纳人数无效")
    if capacity <= 0:
        raise ApiError(400, "容纳人数必须大于 0")
    status = body.get("status", "AVAILABLE")
    if status not in ROOM_STATUSES:
        raise ApiError(400, "会议室状态无效")
    amenities = body.get("amenities") or []
    if not isinstance(amenities, list):
        raise ApiError(400, "设备标签格式无效，应为字符串数组")
    department_id = parse_uuid(body["department_id"], "部门标识格式无效") if body.get("department_id") else None
    room = ConfRoom(
        name=name, location=location, capacity=capacity,
        min_capacity=parse_int(body.get("min_capacity"), "最小容量无效", default=1),
        max_capacity=parse_int(body.get("max_capacity"), "最大容量无效", default=capacity),
        department_id=department_id,
        amenities=[str(a) for a in amenities], status=status,
        max_duration_hours=parse_int(body.get("max_duration_hours"), "时长上限无效", default=8),
        advance_booking_days=parse_int(body.get("advance_booking_days"), "提前预订天数无效", default=30),
        buffer_time_minutes=parse_int(body.get("buffer_time_minutes"), "间隔时长无效", default=15),
    )
    db.add(room)
    try:
        await db.flush()
    except IntegrityError:
        raise ApiError(400, "会议室名称已存在")
    return ok(serialize_room(room, {}), "会议室已创建")


@router.put("/rooms/{room_id}")
async def update_room(
    room_id: str, body: dict,
    p: Principal = Depends(require_perms("conference:room:edit")),
    db: AsyncSession = Depends(get_db),
):
    room = await get_room_or_404(db, room_id)
    if "name" in body:
        name = (body.get("name") or "").strip()
        if not name:
            raise ApiError(400, "会议室名称不能为空")
        room.name = name
    if "location" in body:
        if not (body.get("location") or "").strip():
            raise ApiError(400, "会议室位置不能为空")
        room.location = body["location"].strip()
    if "capacity" in body:
        capacity = parse_int(body.get("capacity"), "容纳人数无效")
        if capacity <= 0:
            raise ApiError(400, "容纳人数必须大于 0")
        room.capacity = capacity
    for field in ("min_capacity", "max_capacity", "max_duration_hours", "advance_booking_days", "buffer_time_minutes"):
        if field in body:
            setattr(room, field, parse_int(body.get(field), f"{field} 数值无效"))
    if "amenities" in body:
        if not isinstance(body.get("amenities"), list):
            raise ApiError(400, "设备标签格式无效，应为字符串数组")
        room.amenities = [str(a) for a in body["amenities"]]
    if "status" in body:
        if body["status"] not in ROOM_STATUSES:
            raise ApiError(400, "会议室状态无效")
        room.status = body["status"]
    if "department_id" in body:
        room.department_id = parse_uuid(body["department_id"], "部门标识格式无效") if body.get("department_id") else None
    try:
        await db.flush()
    except IntegrityError:
        raise ApiError(400, "会议室名称已存在")
    return ok(serialize_room(room), "会议室已更新")


@router.delete("/rooms/{room_id}")
async def delete_room(
    room_id: str,
    p: Principal = Depends(require_perms("conference:room:del")),
    db: AsyncSession = Depends(get_db),
):
    room = await get_room_or_404(db, room_id)
    now = datetime.now(timezone.utc)
    active = (await db.execute(
        select(ConfBooking.id).where(
            ConfBooking.room_id == room.id,
            ConfBooking.status != "CANCELLED",
            ConfBooking.during.overlaps(Range(now, None)),  # 未结束的预订
        ).limit(1)
    )).first()
    if active:
        raise ApiError(400, "该会议室存在未结束的预订，无法删除")
    await db.delete(room)  # 历史预订由 CASCADE 级联删除
    return ok(None, "删除成功")


# ---------------- schedule board ----------------

@router.get("/schedule")
async def schedule_board(
    date: str | None = None,
    p: Principal = Depends(require_perms("conference:booking:list", "conference:room:list")),
    db: AsyncSession = Depends(get_db),
):
    """当日各会议室预订时间线（甘特视图数据源）：room + bookings 列表。"""
    day = parse_day(date) if date else datetime.now(BUSINESS_TZ).date()
    day_start, day_end = day_bounds(day)
    rooms = (await db.execute(select(ConfRoom).order_by(ConfRoom.name))).scalars().all()
    bookings = (await db.execute(
        select(ConfBooking)
        .where(
            ConfBooking.during.overlaps(Range(day_start, day_end)),
            ConfBooking.status != "CANCELLED",
        )
        .order_by(ConfBooking.during)
    )).scalars().all()
    user_names = await user_name_map(db, {b.user_id for b in bookings})
    by_room: dict = {}
    for b in bookings:
        start = _aware(b.during.lower)
        end = _aware(b.during.upper)
        by_room.setdefault(b.room_id, []).append({
            "booking_id": str(b.id),
            "title": b.title,
            "start_time": _fmt_dt(b.during.lower),
            "end_time": _fmt_dt(b.during.upper),
            "time_range": f"{start.astimezone(BUSINESS_TZ):%H:%M}-{end.astimezone(BUSINESS_TZ):%H:%M}",
            "status": b.status,
            "status_label": BOOKING_STATUS_LABELS.get(b.status, b.status),
            "attendee_count": b.attendee_count,
            "user_id": str(b.user_id),
            "user_name": user_names.get(b.user_id),
        })
    data = [{
        "room_id": str(r.id), "name": r.name, "location": r.location,
        "capacity": r.capacity, "status": r.status,
        "status_label": ROOM_STATUSES.get(r.status, r.status),
        "bookings": by_room.get(r.id, []),
    } for r in rooms]
    return ok({"date": day.isoformat(), "weekday": day.strftime("%A"), "rooms": data})


# ---------------- bookings ----------------

@router.get("/bookings")
async def list_bookings(
    p: Principal = Depends(require_perms("conference:booking:list")),
    db: AsyncSession = Depends(get_db),
    room_id: str | None = None, date: str | None = None, status: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(ConfBooking).order_by(ConfBooking.created_at.desc())
    stmt = await apply_owner_scope(stmt, p, ConfBooking.user_id, db)
    if room_id:
        stmt = stmt.where(ConfBooking.room_id == parse_uuid(room_id, "会议室标识格式无效"))
    if date:
        day_start, day_end = day_bounds(parse_day(date))
        stmt = stmt.where(ConfBooking.during.overlaps(Range(day_start, day_end)))
    if status:
        stmt = stmt.where(ConfBooking.status == status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    room_names = await room_name_map(db, {r.room_id for r in rows})
    user_names = await user_name_map(db, {r.user_id for r in rows})
    return page([serialize_booking(r, room_names, user_names) for r in rows], total)


@router.post("/bookings/check")
async def check_booking_conflict(
    body: dict,
    p: Principal = Depends(require_perms("conference:booking:list", "conference:booking:add")),
    db: AsyncSession = Depends(get_db),
):
    """Dry-run 冲突预检：不落库，返回 {conflict, conflict_title}。"""
    room_id = parse_uuid(body.get("room_id"), "会议室标识格式无效")
    start = parse_dt(body.get("start_time"), "开始时间格式无效")
    end = parse_dt(body.get("end_time"), "结束时间格式无效")
    if end <= start:
        raise ApiError(400, "结束时间必须晚于开始时间")
    conflict = await find_conflict(db, room_id, start, end)
    return ok({
        "conflict": conflict is not None,
        "conflict_title": conflict.title if conflict else None,
    })


@router.post("/bookings")
async def create_booking(
    body: dict,
    p: Principal = Depends(require_perms("conference:booking:add")),
    db: AsyncSession = Depends(get_db),
):
    if p.user_id is None:
        raise ApiError(400, "会议室预订需以用户身份操作")
    room = await get_room_or_404(db, body.get("room_id"))
    if room.status != "AVAILABLE":
        raise ApiError(400, f"会议室当前不可预订（{ROOM_STATUSES.get(room.status, room.status)}）")
    title = (body.get("title") or "").strip()
    if not title:
        raise ApiError(400, "会议标题不能为空")
    start = parse_dt(body.get("start_time"), "开始时间格式无效")
    end = parse_dt(body.get("end_time"), "结束时间格式无效")
    if end <= start:
        raise ApiError(400, "结束时间必须晚于开始时间")
    attendee_count = parse_int(body.get("attendee_count"), "参会人数无效", default=1)
    if attendee_count < 1:
        raise ApiError(400, "参会人数必须大于 0")
    if attendee_count > room.capacity:
        raise ApiError(400, f"参会人数超出会议室容量（{room.capacity} 人）")
    conflict = await find_conflict(db, room.id, start, end)
    if conflict:
        raise ApiError(400, f"该时段已被预订：{conflict.title}")
    booking = ConfBooking(
        room_id=room.id, user_id=p.user_id, title=title,
        during=Range(start, end), attendee_count=attendee_count,
        status="CONFIRMED", host_name=body.get("host_name", p.display_name),
    )
    db.add(booking)
    try:
        await db.flush()
    except IntegrityError:
        # GiST 排除约束兜底：并发预订窗口下由数据库层面拒绝双重预订
        raise ApiError(400, "该时段已被预订（并发写入冲突），请调整时间后重试")
    return ok(
        serialize_booking(booking, {room.id: room.name}, {booking.user_id: p.display_name}),
        "会议室预订成功",
    )


@router.post("/bookings/{booking_id}/cancel")
async def cancel_booking(
    booking_id: str,
    p: Principal = Depends(require_perms("conference:booking:cancel")),
    db: AsyncSession = Depends(get_db),
):
    booking = await get_booking_or_404(db, booking_id)
    if booking.status == "CANCELLED":
        raise ApiError(400, "该预订已取消，请勿重复操作")
    booking.status = "CANCELLED"
    return ok(serialize_booking(booking, {}, {}), "预订已取消")


@router.post("/bookings/{booking_id}/approve")
async def approve_booking(
    booking_id: str,
    p: Principal = Depends(require_perms("conference:booking:audit")),
    db: AsyncSession = Depends(get_db),
):
    booking = await get_booking_or_404(db, booking_id)
    if booking.status != "PENDING_APPROVAL":
        raise ApiError(400, "该预订不在待审批状态")
    # 审批前复查：时段可能已被其他 CONFIRMED 预订占用
    conflict = await find_conflict(db, booking.room_id, booking.during.lower, booking.during.upper, "CONFIRMED")
    if conflict and conflict.id != booking.id:
        raise ApiError(400, f"该时段已被其他会议确认占用：{conflict.title}")
    booking.status = "CONFIRMED"
    # 闭环联动：站内通知预订人审批结果
    db.add(SysNotice(
        user_id=booking.user_id,
        title="会议室预订审批通过",
        content=f"您预订的会议【{booking.title}】已通过审批，请按时参会。",
        notice_type="SUCCESS", source_module="conference",
        link="/conference/bookings",
    ))
    room = await db.get(ConfRoom, booking.room_id)
    user_names = await user_name_map(db, {booking.user_id})
    return ok(
        serialize_booking(booking, {booking.room_id: room.name} if room else {}, user_names),
        "审批通过",
    )


# ---------------- affairs (政务会务统筹) ----------------

@router.get("/affairs")
async def list_affairs(
    p: Principal = Depends(require_perms("conference:affair:list")),
    db: AsyncSession = Depends(get_db),
    booking_id: str | None = None, meeting_type: str | None = None, security_level: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(ConfAffair).join(ConfBooking, ConfAffair.booking_id == ConfBooking.id)
    stmt = await apply_owner_scope(stmt, p, ConfBooking.user_id, db)
    stmt = stmt.order_by(ConfAffair.created_at.desc())
    if booking_id:
        stmt = stmt.where(ConfAffair.booking_id == parse_uuid(booking_id, "预订标识格式无效"))
    if meeting_type:
        stmt = stmt.where(ConfAffair.meeting_type == meeting_type)
    if security_level:
        stmt = stmt.where(ConfAffair.security_level == security_level)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    bookings = await booking_map(db, {a.booking_id for a in rows})
    room_names = await room_name_map(db, {b.room_id for b in bookings.values()})
    return page([serialize_affair(a, bookings, room_names) for a in rows], total)


@router.post("/affairs")
async def create_affair(
    body: dict,
    p: Principal = Depends(require_perms("conference:affair:add")),
    db: AsyncSession = Depends(get_db),
):
    booking = await get_booking_or_404(db, body.get("booking_id"))
    title = (body.get("title") or "").strip()
    if not title:
        raise ApiError(400, "会议名称不能为空")
    meeting_type = body.get("meeting_type", "WORK")
    if meeting_type not in MEETING_TYPES:
        raise ApiError(400, "会议性质无效")
    security_level = body.get("security_level", "NORMAL")
    if security_level not in SECURITY_LEVELS:
        raise ApiError(400, "保密级别无效")
    affair = ConfAffair(
        booking_id=booking.id, title=title, meeting_type=meeting_type,
        security_level=security_level, agenda_text=body.get("agenda_text"),
    )
    db.add(affair)
    await db.flush()
    bookings = await booking_map(db, {affair.booking_id})
    room_names = await room_name_map(db, {b.room_id for b in bookings.values()})
    return ok(serialize_affair(affair, bookings, room_names), "会务统筹单已创建")


# ---------------- attendees ----------------

@router.get("/attendees")
async def list_attendees(
    p: Principal = Depends(require_perms("conference:attendee:list")),
    db: AsyncSession = Depends(get_db),
    affair_id: str | None = None,
):
    if not affair_id:
        raise ApiError(400, "affair_id 不能为空")
    affair = await get_affair_or_404(db, affair_id)
    attendees = (await db.execute(
        select(ConfAttendee).where(ConfAttendee.affair_id == affair.affair_id)
    )).scalars().all()
    # 已排座的按席次从左到右，未排座在后（花名册视图）
    attendees.sort(key=lambda a: (a.seat_label is None, a.seat_label or "", a.attendee_id))
    return ok([serialize_attendee(a) for a in attendees])


@router.post("/attendees")
async def add_attendee(
    body: dict,
    p: Principal = Depends(require_perms("conference:attendee:add")),
    db: AsyncSession = Depends(get_db),
):
    affair = await get_affair_or_404(db, body.get("affair_id"))
    name = (body.get("name") or "").strip()
    if not name:
        raise ApiError(400, "参会人姓名不能为空")
    attendance_status = body.get("attendance_status", "CONFIRMED")
    if attendance_status not in ATTENDANCE_STATUSES:
        raise ApiError(400, "参会回执状态无效")
    attendee = ConfAttendee(
        affair_id=affair.affair_id, name=name,
        dept_name=body.get("dept_name"), post_name=body.get("post_name"),
        attendance_status=attendance_status, deputy_name=body.get("deputy_name"),
    )
    db.add(attendee)
    await db.flush()
    return ok(serialize_attendee(attendee), "参会人已登记")


@router.put("/attendees/{attendee_id}")
async def update_attendee(
    attendee_id: str, body: dict,
    p: Principal = Depends(require_perms("conference:attendee:edit")),
    db: AsyncSession = Depends(get_db),
):
    attendee = await db.get(ConfAttendee, parse_uuid(attendee_id, "参会人标识格式无效"))
    if not attendee:
        raise ApiError(404, "参会人不存在")
    if "attendance_status" in body:
        if body["attendance_status"] not in ATTENDANCE_STATUSES:
            raise ApiError(400, "参会回执状态无效")
        attendee.attendance_status = body["attendance_status"]
    if "deputy_name" in body:
        if attendee.attendance_status == "DEPUTY" and not (body.get("deputy_name") or "").strip():
            raise ApiError(400, "代会回执必须填写代会人员")
        attendee.deputy_name = body.get("deputy_name")
    return ok(serialize_attendee(attendee), "参会回执已更新")


@router.post("/attendees/{attendee_id}/checkin")
async def checkin_attendee(
    attendee_id: str,
    p: Principal = Depends(require_perms("conference:attendee:edit")),
    db: AsyncSession = Depends(get_db),
):
    attendee = await db.get(ConfAttendee, parse_uuid(attendee_id, "参会人标识格式无效"))
    if not attendee:
        raise ApiError(404, "参会人不存在")
    if attendee.sign_in_time:
        raise ApiError(400, "该参会人已签到，请勿重复操作")
    attendee.sign_in_time = datetime.now(timezone.utc)  # 扫码/现场电子签到
    return ok(serialize_attendee(attendee), "签到成功")


# ---------------- seating engine (政务排座) ----------------

def _seat_slots(rule_type: str, n: int) -> list[int]:
    """返回各名次（0 基）对应的槽位（0=最左）。保证结果为 0..n-1 的一个排列。

    CENTER_FIRST 以中为尊：1号居中，2号在1号左，3号在右，4号在2号左、5号在3号右……交替向外。
    """
    slots: list[int] = []
    if rule_type == "CENTER_FIRST":
        base = n // 2  # 奇数n居中；偶数n取中右（1号居中偏右，符合政务礼仪）
        for i in range(n):
            if i == 0:
                off = 0
            elif i % 2 == 1:
                off = -((i + 1) // 2)   # 左侧依次向外
            else:
                off = i // 2            # 右侧依次向外
            slots.append(base + off)
    elif rule_type == "RIGHT_FIRST":
        slots = [n - 1 - i for i in range(n)]  # 从右往左
    else:  # FRONT_FIRST / LEFT_FIRST：单序列顺序编号（从左往右）
        slots = list(range(n))
    return slots


def _apply_seating(rule_type: str, attendees: list[ConfAttendee]) -> list[dict]:
    # 注：ConfAttendee 模型无 created_at/序号字段（规范禁止改 models），按主键顺序作为录入顺序的稳定近似
    attendees = sorted(attendees, key=lambda a: a.attendee_id)
    slots = _seat_slots(rule_type, len(attendees))
    for rank, a in enumerate(attendees):
        a.seat_label = f"{slots[rank] + 1:02d}号"
    attendees.sort(key=lambda a: a.seat_label)
    return [serialize_attendee(a) for a in attendees]


@router.get("/seating/{affair_id}")
async def get_seating(
    affair_id: str,
    p: Principal = Depends(require_perms("conference:seating:list")),
    db: AsyncSession = Depends(get_db),
):
    affair = await get_affair_or_404(db, affair_id)
    attendees = (await db.execute(
        select(ConfAttendee).where(ConfAttendee.affair_id == affair.affair_id)
    )).scalars().all()
    attendees.sort(key=lambda a: (a.seat_label is None, a.seat_label or ""))
    return ok({
        "affair_id": str(affair.affair_id),
        "title": affair.title,
        "attendees": [serialize_attendee(a) for a in attendees],
    })


@router.post("/seating/{affair_id}")
async def generate_seating(
    affair_id: str, body: dict,
    p: Principal = Depends(require_perms("conference:seating:generate")),
    db: AsyncSession = Depends(get_db),
):
    rule_type = body.get("rule_type", "CENTER_FIRST")
    if rule_type not in SEATING_RULES:
        raise ApiError(400, f"排座规则无效，可选：{'/'.join(SEATING_RULES)}")
    affair = await get_affair_or_404(db, affair_id)
    attendees = (await db.execute(
        select(ConfAttendee).where(ConfAttendee.affair_id == affair.affair_id)
    )).scalars().all()
    if not attendees:
        raise ApiError(400, "该会议尚未登记参会人员，无法排座")
    seats = _apply_seating(rule_type, attendees)
    return ok(seats, f"已按「{SEATING_RULES[rule_type]}」规则完成排座")


# ---------------- service tickets (会务保障派工) ----------------

@router.get("/services")
async def list_services(
    p: Principal = Depends(require_perms("conference:service:list")),
    db: AsyncSession = Depends(get_db),
    booking_id: str | None = None, status: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(ConfServiceTicket).join(ConfBooking, ConfServiceTicket.booking_id == ConfBooking.id)
    stmt = await apply_owner_scope(stmt, p, ConfBooking.user_id, db)
    stmt = stmt.order_by(ConfServiceTicket.ticket_id)
    if booking_id:
        stmt = stmt.where(ConfServiceTicket.booking_id == parse_uuid(booking_id, "预订标识格式无效"))
    if status:
        stmt = stmt.where(ConfServiceTicket.status == status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    bookings = await booking_map(db, {t.booking_id for t in rows})
    return page([serialize_ticket(t, bookings) for t in rows], total)


@router.post("/services")
async def create_service_ticket(
    body: dict,
    p: Principal = Depends(require_perms("conference:service:add")),
    db: AsyncSession = Depends(get_db),
):
    booking = await get_booking_or_404(db, body.get("booking_id"))
    service_type = (body.get("service_type") or "").strip()
    if not service_type:
        raise ApiError(400, "服务类型不能为空")
    ticket = ConfServiceTicket(
        booking_id=booking.id, service_type=service_type,
        notes=body.get("notes"), status="PENDING",
    )
    db.add(ticket)
    booking.service_status = "PENDING"  # 有待保障工单，预订的服务状态联动
    await db.flush()
    return ok(serialize_ticket(ticket, {booking.id: booking}), "会务服务工单已创建")


@router.post("/services/{ticket_id}/dispatch")
async def dispatch_service_ticket(
    ticket_id: str, body: dict,
    p: Principal = Depends(require_perms("conference:service:dispatch")),
    db: AsyncSession = Depends(get_db),
):
    ticket = await db.get(ConfServiceTicket, parse_uuid(ticket_id, "工单标识格式无效"))
    if not ticket:
        raise ApiError(404, "服务工单不存在")
    if ticket.status != "PENDING":
        raise ApiError(400, "该工单已派发或已完成")
    assignee_name = (body.get("assignee_name") or "").strip()
    if not assignee_name:
        raise ApiError(400, "承办人不能为空")
    ticket.assignee_name = assignee_name
    ticket.status = "PROCESSING"
    booking = await db.get(ConfBooking, ticket.booking_id)
    if booking:
        booking.service_status = "DISPATCHED"
    return ok(serialize_ticket(ticket, {ticket.booking_id: booking} if booking else {}), "工单已派发")


@router.post("/services/{ticket_id}/complete")
async def complete_service_ticket(
    ticket_id: str,
    p: Principal = Depends(require_perms("conference:service:dispatch")),
    db: AsyncSession = Depends(get_db),
):
    ticket = await db.get(ConfServiceTicket, parse_uuid(ticket_id, "工单标识格式无效"))
    if not ticket:
        raise ApiError(404, "服务工单不存在")
    if ticket.status == "COMPLETED":
        raise ApiError(400, "该工单已完成，请勿重复操作")
    ticket.status = "COMPLETED"
    booking = await db.get(ConfBooking, ticket.booking_id)
    if booking:
        tickets = (await db.execute(
            select(ConfServiceTicket).where(ConfServiceTicket.booking_id == booking.id)
        )).scalars().all()
        if all(t.status == "COMPLETED" for t in tickets):
            booking.service_status = "COMPLETED"  # 全部工单完成 -> 保障闭环
    return ok(serialize_ticket(ticket, {ticket.booking_id: booking} if booking else {}), "工单已完成")


# ---------------- e-checkin stats ----------------

@router.get("/checkin/{affair_id}")
async def checkin_stats(
    affair_id: str,
    p: Principal = Depends(require_perms("conference:attendee:list")),
    db: AsyncSession = Depends(get_db),
):
    """电子签到大屏数据：应到/实到/缺席统计 + 名单。"""
    affair = await get_affair_or_404(db, affair_id)
    attendees = (await db.execute(
        select(ConfAttendee).where(ConfAttendee.affair_id == affair.affair_id)
    )).scalars().all()
    checked = sorted([a for a in attendees if a.sign_in_time], key=lambda a: a.sign_in_time)
    absent = [a for a in attendees if not a.sign_in_time]
    should_count = len(attendees)
    actual_count = len(checked)
    return ok({
        "affair_id": str(affair.affair_id),
        "title": affair.title,
        "should_count": should_count,
        "actual_count": actual_count,
        "absent_count": len(absent),
        "rate": round(actual_count / should_count * 100, 1) if should_count else 0.0,
        "checked_in": [serialize_attendee(a) for a in checked],
        "absent": [serialize_attendee(a) for a in absent],
    })


# ---------------- minutes & action items ----------------

@router.get("/minutes")
async def list_minutes(
    p: Principal = Depends(require_perms("conference:minutes:list")),
    db: AsyncSession = Depends(get_db),
    booking_id: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(ConfMinutes).join(ConfBooking, ConfMinutes.booking_id == ConfBooking.id)
    stmt = await apply_owner_scope(stmt, p, ConfBooking.user_id, db)
    stmt = stmt.order_by(ConfMinutes.created_at.desc())
    if booking_id:
        stmt = stmt.where(ConfMinutes.booking_id == parse_uuid(booking_id, "预订标识格式无效"))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    bookings = await booking_map(db, {m.booking_id for m in rows})
    user_names = await user_name_map(db, {m.author_id for m in rows})
    return page([serialize_minutes(m, bookings, user_names) for m in rows], total)


@router.get("/minutes/{minutes_id}")
async def get_minutes_detail(
    minutes_id: str,
    p: Principal = Depends(require_perms("conference:minutes:list")),
    db: AsyncSession = Depends(get_db),
):
    minutes = await db.get(ConfMinutes, parse_uuid(minutes_id, "纪要标识格式无效"))
    if not minutes:
        raise ApiError(404, "会议纪要不存在")
    items = (await db.execute(
        select(ConfActionItem).where(ConfActionItem.minutes_id == minutes.id)
    )).scalars().all()
    bookings = await booking_map(db, {minutes.booking_id})
    user_names = await user_name_map(db, {minutes.author_id})
    data = serialize_minutes(minutes, bookings, user_names)
    data["action_items"] = [serialize_action_item(i) for i in items]
    return ok(data)


@router.post("/minutes")
async def create_or_update_minutes(
    body: dict,
    p: Principal = Depends(require_perms("conference:minutes:add")),
    db: AsyncSession = Depends(get_db),
):
    if p.user_id is None:
        raise ApiError(400, "会议纪要需以用户身份操作")
    booking = await get_booking_or_404(db, body.get("booking_id"))
    content = (body.get("content") or "").strip()
    if not content:
        raise ApiError(400, "纪要内容不能为空")
    minutes = (await db.execute(
        select(ConfMinutes).where(ConfMinutes.booking_id == booking.id)
    )).scalar_one_or_none()
    if minutes:
        # 已有纪要：多人协作 -> 自动版本递增并留痕
        minutes.version += 1
        minutes.content = content
        msg = f"纪要已更新至第 {minutes.version} 版"
    else:
        minutes = ConfMinutes(booking_id=booking.id, author_id=p.user_id, content=content, version=1)
        db.add(minutes)
        msg = "纪要已创建"
    await db.flush()
    bookings = await booking_map(db, {minutes.booking_id})
    user_names = await user_name_map(db, {minutes.author_id})
    return ok(serialize_minutes(minutes, bookings, user_names), msg)


@router.put("/minutes/{minutes_id}")
async def update_minutes(
    minutes_id: str, body: dict,
    p: Principal = Depends(require_perms("conference:minutes:edit")),
    db: AsyncSession = Depends(get_db),
):
    minutes = await db.get(ConfMinutes, parse_uuid(minutes_id, "纪要标识格式无效"))
    if not minutes:
        raise ApiError(404, "会议纪要不存在")
    content = (body.get("content") or "").strip()
    if not content:
        raise ApiError(400, "纪要内容不能为空")
    minutes.version += 1  # 版本递增留痕
    minutes.content = content
    await db.flush()
    bookings = await booking_map(db, {minutes.booking_id})
    user_names = await user_name_map(db, {minutes.author_id})
    return ok(serialize_minutes(minutes, bookings, user_names), f"纪要已更新至第 {minutes.version} 版")


@router.post("/minutes/{minutes_id}/action-items")
async def add_action_item(
    minutes_id: str, body: dict,
    p: Principal = Depends(require_perms("conference:actionitem:add")),
    db: AsyncSession = Depends(get_db),
):
    minutes = await db.get(ConfMinutes, parse_uuid(minutes_id, "纪要标识格式无效"))
    if not minutes:
        raise ApiError(404, "会议纪要不存在")
    task_description = (body.get("task_description") or "").strip()
    if not task_description:
        raise ApiError(400, "议定事项描述不能为空")
    due_date = parse_dt(body["due_date"], "办结时限格式无效") if body.get("due_date") else None
    item = ConfActionItem(
        minutes_id=minutes.id, booking_id=minutes.booking_id,
        task_description=task_description, assignee_name=body.get("assignee_name"),
        due_date=due_date, status="PENDING",
    )
    db.add(item)
    await db.flush()
    return ok(serialize_action_item(item), "议定事项已登记")


@router.post("/action-items/{item_id}/to-supervision")
async def convert_action_item_to_supervision(
    item_id: str, body: dict,
    p: Principal = Depends(require_perms("conference:actionitem:convert")),
    db: AsyncSession = Depends(get_db),
):
    """关键协同接口：纪要议定事项一键直推【政务重点督办】生成督办单（source_type=COUNCIL_DECISION）。"""
    item = await db.get(ConfActionItem, parse_uuid(item_id, "议定事项标识格式无效"))
    if not item:
        raise ApiError(404, "议定事项不存在")
    if item.converted_supervision_id:
        raise ApiError(400, "该事项已转督办，请勿重复操作")
    if not body.get("lead_dept_id"):
        raise ApiError(400, "主办处室不能为空")
    lead_dept_id = parse_uuid(body["lead_dept_id"], "部门标识格式无效")
    if not await db.get(SysDept, lead_dept_id):
        raise ApiError(404, "主办处室不存在")
    if not body.get("deadline"):
        raise ApiError(400, "办结时限不能为空")
    deadline = parse_day(body["deadline"])
    priority = body.get("priority", "NORMAL")
    if priority not in PRIORITIES:
        raise ApiError(400, "紧急程度无效")
    task = await build_task(
        db,
        title=item.task_description[:200],  # SupTask.title 上限 200，议定事项描述上限 500，超长截断
        source_type="COUNCIL_DECISION",
        lead_dept_id=lead_dept_id,
        deadline=deadline,
        priority=priority,
        content=item.task_description,  # content = 议定事项原文
        created_by=p.display_name,
    )
    item.converted_supervision_id = task.task_id
    item.status = "IN_PROGRESS"
    return ok({
        "action_item_id": str(item.id),
        "task_id": str(task.task_id),
        "supervision_no": task.supervision_no,
        "title": task.title,
        "status": item.status,
    }, "已转督办立项")


# ---------------- visitor invitations (联动门禁访客闭环) ----------------

@router.post("/affairs/{affair_id}/visitor-invitations")
async def invite_visitors(
    affair_id: str, body: dict,
    p: Principal = Depends(require_perms("conference:affair:add")),
    db: AsyncSession = Depends(get_db),
):
    """为外部研讨会等会议批量邀约访客：生成 VisAppointment（PENDING_SECURITY）交由保卫处两级审核。"""
    affair = await get_affair_or_404(db, affair_id)
    booking = await db.get(ConfBooking, affair.booking_id)
    if not booking:
        raise ApiError(400, "该会务单关联的会议室预订不存在")
    visitors = body.get("visitors")
    if not visitors and body.get("visitor_names") and body.get("visitor_phones"):
        names = body["visitor_names"]
        phones = body["visitor_phones"]
        visitors = [{"name": n, "phone": p} for n, p in zip(names, phones)]
    if not isinstance(visitors, list) or not visitors:
        raise ApiError(400, "visitors 不能为空")
    created = []
    for idx, v in enumerate(visitors, 1):
        if not isinstance(v, dict):
            raise ApiError(400, f"第 {idx} 位访客信息格式无效")
        name = (v.get("name") or "").strip()
        phone = (v.get("phone") or "").strip()
        if not name or not phone:
            raise ApiError(400, f"第 {idx} 位访客姓名与手机号不能为空")
        appt = VisAppointment(
            visitor_name=name, visitor_phone=phone,
            company=v.get("company"), car_plate=v.get("car_plate"),
            visit_reason=f"【邀约】参会保障：{affair.title}",
            # Agent 凭据调用无用户身份时，回挂到预订归属人，保证邀约责任可追溯
            host_user_id=p.user_id or booking.user_id,
            scheduled_start=booking.during.lower,
            scheduled_end=booking.during.upper,
            access_code="VC" + uuid.uuid4().hex[:10].upper(),  # 二维码通行码
            status="PENDING_SECURITY",
        )
        db.add(appt)
        created.append(appt)
    await db.flush()
    return ok([{
        "appointment_id": str(a.appointment_id),
        "visitor_name": a.visitor_name,
        "visitor_phone": a.visitor_phone,
        "company": a.company,
        "car_plate": a.car_plate,
        "visit_reason": a.visit_reason,
        "access_code": a.access_code,
        "status": a.status,
        "scheduled_start": _fmt_dt(a.scheduled_start),
        "scheduled_end": _fmt_dt(a.scheduled_end),
    } for a in created], "访客邀约已创建，待保卫处安全审核")
