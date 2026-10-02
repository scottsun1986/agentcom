"""Portal aggregation endpoints: overview KPIs, cross-module todos,
collaborative calendar, notifications and the in-app assistant."""

import uuid
from datetime import date, datetime, time, timedelta, timezone

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.dialects.postgresql.ranges import Range
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import BUSINESS_TZ
from app.core.deps import Principal, require_auth
from app.core.errors import ApiError
from app.core.resp import ok
from app.database import get_db
from app.models.attendance import AttLeaveApplication, AttPunchRemedy, AttTripApplication
from app.models.assets import AstConsumableRequisition, AstRequisition
from app.models.conference import ConfBooking
from app.models.extras import SysNotice
from app.models.fleet import FltApplication
from app.models.research import RschIssueLog, RschTopic
from app.models.supervision import SupTask
from app.models.system import SysDept, SysUser, sys_user_role
from app.models.system import SysRole
from app.models.visitor import VisAppointment

router = APIRouter(prefix="/api/portal", tags=["综合门户"])


async def _name_maps(db: AsyncSession):
    users = (await db.execute(select(SysUser.user_id, SysUser.nick_name))).all()
    depts = (await db.execute(select(SysDept.dept_id, SysDept.dept_name))).all()
    return {str(u.user_id): u.nick_name for u in users}, {str(d.dept_id): d.dept_name for d in depts}


@router.get("/todos")
async def portal_todos(p: Principal = Depends(require_auth), db: AsyncSession = Depends(get_db)):
    """Aggregate cross-module pending items routed to the current user."""
    user_map, dept_map = await _name_maps(db)
    is_admin = p.is_admin and p.auth_kind == "user"
    can = p.has_perm if p.auth_kind == "user" else (lambda perm: True)
    items = []

    def add(item_id, kind, title, uid, dept_id, created, status, category, link):
        items.append({
            "id": item_id, "kind": kind, "title": title,
            "applicant": user_map.get(str(uid), "未知"),
            "dept": dept_map.get(str(dept_id)) if dept_id else None,
            "submitted_at": created.isoformat() if created else None,
            "status": status, "category": category, "link": link,
        })

    if can("attendance:leave:audit"):
        rows = (await db.execute(select(AttLeaveApplication).where(AttLeaveApplication.audit_status == "PENDING").limit(50))).scalars().all()
        for r in rows:
            if is_admin or (p.data_scope in ("1", "2", "3", "4")):
                add(str(r.apply_id), "leave", f"请假申请（{r.reason[:18]}）", r.user_id, r.user.dept_id if r.user else None, r.created_at, "待审批", "待审批", "/attendance/leave")
    if can("attendance:trip:audit"):
        rows = (await db.execute(select(AttTripApplication).where(AttTripApplication.audit_status == "PENDING").limit(50))).scalars().all()
        for r in rows:
            if is_admin or (p.data_scope in ("1", "2", "3", "4")):
                add(str(r.trip_id), "trip", f"{'出差' if r.trip_type == 'BUSINESS_TRIP' else '外出'}申请（{r.destination[:14]}）", r.user_id, r.user.dept_id if r.user else None, r.created_at, "待审批", "待审批", "/attendance/trip")
    if can("attendance:remedy:audit"):
        rows = (await db.execute(select(AttPunchRemedy).where(AttPunchRemedy.audit_status == "PENDING").limit(50))).scalars().all()
        for r in rows:
            if is_admin or (p.data_scope in ("1", "2", "3", "4")):
                add(str(r.remedy_id), "remedy", "补卡申请（考勤异常修正）", r.user_id, r.user.dept_id if r.user else None, r.created_at, "待审批", "待审批", "/attendance/remedy")
    if can("assets:requisition:audit"):
        rows = (await db.execute(select(AstRequisition).where(AstRequisition.audit_status == "PENDING").limit(50))).scalars().all()
        for r in rows:
            if is_admin or (p.data_scope in ("1", "2", "3", "4")):
                asset = await r.asset if False else None
                add(str(r.req_id), "asset_req", f"资产{'领用' if r.req_type == 'CLAIM' else '借用' if r.req_type == 'BORROW' else '调拨' if r.req_type == 'TRANSFER' else '报废' if r.req_type == 'SCRAP' else '退库'}申请", r.user_id, r.dept_id, r.created_at, "待审批", "待审批", "/assets/requisition")
    if can("assets:consumable:audit"):
        rows = (await db.execute(select(AstConsumableRequisition).where(AstConsumableRequisition.status == "PENDING").limit(50))).scalars().all()
        for r in rows:
            if is_admin or (p.data_scope in ("1", "2", "3", "4")):
                add(str(r.req_id), "consumable_req", f"耗材申领（{r.purpose[:16]}）", r.user_id, r.dept_id, r.created_at, "待审批", "待审批", "/assets/consumables")
    if can("fleet:application:audit"):
        for st, label in (("DEPT_PENDING", "待执行"), ("ADMIN_PENDING", "待审批")):
            rows = (await db.execute(select(FltApplication).where(FltApplication.status == st).limit(50))).scalars().all()
            for r in rows:
                if is_admin or (p.data_scope in ("1", "2", "3", "4")):
                    add(str(r.app_id), "fleet", f"用车申请（{r.destination[:14]}）", r.applicant_id, r.dept_id, r.created_at, label, "待审批" if st == "ADMIN_PENDING" else "待执行", "/fleet/applications")
    if can("visitor:appointment:audit"):
        rows = (await db.execute(select(VisAppointment).where(VisAppointment.status == "PENDING_SECURITY").limit(50))).scalars().all()
        for r in rows:
            add(str(r.appointment_id), "visitor", f"访客预约（{r.visitor_name}）", r.host_user_id, r.host_user.dept_id if r.host_user else None, r.created_at, "待审批", "待审批", "/visitor/reservations")
    if p.auth_kind == "user":
        rows = (await db.execute(select(VisAppointment).where(VisAppointment.status == "PENDING_HOST", VisAppointment.host_user_id == p.user_id).limit(50))).scalars().all()
        for r in rows:
            add(str(r.appointment_id), "visitor_host", f"访客来访确认（{r.visitor_name}）", r.host_user_id, r.host_user.dept_id if r.host_user else None, r.created_at, "待审批", "待审批", "/visitor/reservations")
    if can("supervision:task:audit"):
        rows = (await db.execute(select(SupTask).where(SupTask.status.in_(("EXTENSION_PENDING", "CLOSE_PENDING"))).limit(50))).scalars().all()
        for r in rows:
            add(str(r.task_id), "supervision", f"督办{'延期' if r.status == 'EXTENSION_PENDING' else '销号'}审批（{r.title[:14]}）", p.user_id, r.lead_dept_id, r.created_at, "待反馈", "待反馈", "/supervision/standing")

    items.sort(key=lambda x: x["submitted_at"] or "", reverse=True)
    pending = [i for i in items if i["category"] == "待审批"]
    executing = [i for i in items if i["category"] == "待执行"]
    feedback = [i for i in items if i["category"] == "待反馈"]
    return ok({"all": items, "pending": pending, "executing": executing, "feedback": feedback,
               "counts": {"all": len(items), "pending": len(pending), "executing": len(executing), "feedback": len(feedback)}})


@router.get("/overview")
async def portal_overview(p: Principal = Depends(require_auth), db: AsyncSession = Depends(get_db)):
    tznow = datetime.now(BUSINESS_TZ)
    today = tznow.date()
    day_start = datetime.combine(today, time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    day_end = day_start + timedelta(days=1)

    todos = (await portal_todos(p, db))["data"]
    today_bookings = (await db.execute(
        select(ConfBooking).where(ConfBooking.during.overlaps(__import__("sqlalchemy.dialects.postgresql", fromlist=["TSRANGE"]).Range(day_start, day_end)), ConfBooking.status != "CANCELLED")
    )).scalars().all()
    sup_in_progress = (await db.execute(select(func.count()).select_from(SupTask).where(SupTask.status.in_(("IN_PROGRESS", "EXTENSION_PENDING", "CLOSE_PENDING"))))).scalar()
    sup_red = (await db.execute(select(func.count()).select_from(SupTask).where(SupTask.warning_level == "RED", SupTask.status != "CLOSED"))).scalar()
    sup_yellow = (await db.execute(select(func.count()).select_from(SupTask).where(SupTask.warning_level == "YELLOW", SupTask.status != "CLOSED"))).scalar()

    user_map, dept_map = await _name_maps(db)
    from app.models.conference import ConfRoom
    room_ids = {b.room_id for b in today_bookings}
    room_loc = {}
    if room_ids:
        rooms = (await db.execute(select(ConfRoom).where(ConfRoom.id.in_(room_ids)))).scalars().all()
        room_loc = {r.id: r.location for r in rooms}
    agenda = []
    for b in today_bookings:
        agenda.append({
            "time": f"{b.during.lower.astimezone(BUSINESS_TZ):%H:%M} - {b.during.upper.astimezone(BUSINESS_TZ):%H:%M}",
            "title": b.title, "type": "会议", "location": room_loc.get(b.room_id), "link": "/conference/schedule",
        })
    trips = (await db.execute(
        select(AttTripApplication).where(
            AttTripApplication.audit_status == "APPROVED",
            AttTripApplication.start_time < day_end, AttTripApplication.end_time >= day_start,
            AttTripApplication.user_id == p.user_id,
        )
    )).scalars().all()
    for t in trips:
        agenda.append({"time": f"{t.start_time.astimezone(BUSINESS_TZ):%H:%M}", "title": f"{'出差' if t.trip_type == 'BUSINESS_TRIP' else '外出'}：{t.destination}", "type": "调研" if t.trip_type == "BUSINESS_TRIP" else "外出", "location": t.destination, "link": "/attendance/trip"})
    agenda.sort(key=lambda x: x["time"])

    key_tasks = (await db.execute(
        select(SupTask).where(SupTask.status.in_(("IN_PROGRESS", "EXTENSION_PENDING"))).order_by(SupTask.deadline).limit(6)
    )).scalars().all()
    warnings = (await db.execute(
        select(SysNotice).where(SysNotice.notice_type.in_(("WARNING", "URGENT"))).order_by(SysNotice.created_at.desc()).limit(5)
    )).scalars().all()
    return ok({
        "greeting_name": p.display_name,
        "kpi": {
            "todos": todos["counts"]["all"], "meetings": len(today_bookings),
            "supervision": sup_in_progress, "warnings": sup_red + sup_yellow,
        },
        "todos": todos["all"][:8], "todo_counts": todos["counts"],
        "agenda": agenda,
        "key_tasks": [{
            "task_id": str(t.task_id), "title": t.title, "progress_pct": t.progress_pct,
            "deadline": t.deadline.isoformat(), "warning_level": t.warning_level,
            "lead_dept": dept_map.get(str(t.lead_dept_id)),
        } for t in key_tasks],
        "warnings": [{"notice_id": str(n.notice_id), "title": n.title, "type": n.notice_type, "created_at": n.created_at.isoformat()} for n in warnings],
    })


@router.get("/calendar")
async def portal_calendar(
    month: str = "2026-10",
    p: Principal = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    y, m = (int(x) for x in month.split("-"))
    m_start = datetime(y, m, 1, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    m_end = datetime(y + (m == 12), (m % 12) + 1, 1, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    bookings = (await db.execute(
        select(ConfBooking).where(ConfBooking.during.overlaps(Range(m_start, m_end)), ConfBooking.status != "CANCELLED")
    )).scalars().all()
    topics = (await db.execute(
        select(RschTopic).where(RschTopic.start_date <= m_end.date(), RschTopic.end_date >= m_start.date())
    )).scalars().all()
    tasks = (await db.execute(select(SupTask).where(SupTask.deadline >= m_start.date(), SupTask.deadline <= m_end.date()))).scalars().all()
    events = []
    for b in bookings:
        events.append({"date": b.during.lower.astimezone(BUSINESS_TZ).date().isoformat(), "title": b.title, "type": "meeting", "time": f"{b.during.lower.astimezone(BUSINESS_TZ):%H:%M}"})
    for t in topics:
        events.append({"date": t.start_date.isoformat(), "title": t.title[:18], "type": "research", "time": "全天"})
    for t in tasks:
        events.append({"date": t.deadline.isoformat(), "title": f"督办截止：{t.title[:16]}", "type": "deadline", "time": "当天"})
    return ok({"month": month, "events": events})


@router.get("/notifications")
async def list_notifications(
    only_unread: bool = False,
    p: Principal = Depends(require_auth),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SysNotice).order_by(SysNotice.created_at.desc()).limit(50)
    if p.auth_kind == "user":
        stmt = stmt.where(or_(SysNotice.user_id == p.user_id, SysNotice.user_id.is_(None)))
    if only_unread:
        stmt = stmt.where(SysNotice.is_read.is_(False))
    rows = (await db.execute(stmt)).scalars().all()
    unread = (await db.execute(
        select(func.count()).select_from(SysNotice).where(
            or_(SysNotice.user_id == p.user_id, SysNotice.user_id.is_(None)) if p.auth_kind == "user" else True,
            SysNotice.is_read.is_(False),
        )
    )).scalar()
    return ok({
        "unread": unread,
        "items": [{
            "notice_id": str(n.notice_id), "title": n.title, "content": n.content,
            "notice_type": n.notice_type, "source_module": n.source_module,
            "link": n.link, "is_read": n.is_read, "created_at": n.created_at.isoformat(),
        } for n in rows],
    })


@router.post("/notifications/{notice_id}/read")
async def read_notification(notice_id: str, p: Principal = Depends(require_auth), db: AsyncSession = Depends(get_db)):
    n = await db.get(SysNotice, uuid.UUID(notice_id))
    if n:
        n.is_read = True
    return ok(None, "已读")


@router.post("/notifications/read-all")
async def read_all_notifications(p: Principal = Depends(require_auth), db: AsyncSession = Depends(get_db)):
    if p.auth_kind == "user":
        rows = (await db.execute(select(SysNotice).where(or_(SysNotice.user_id == p.user_id, SysNotice.user_id.is_(None)), SysNotice.is_read.is_(False)))).scalars().all()
        for n in rows:
            n.is_read = True
    return ok(None, "全部已读")


@router.post("/assistant")
async def assistant(body: dict, p: Principal = Depends(require_auth), db: AsyncSession = Depends(get_db)):
    """Rule-driven assistant executing platform capabilities on behalf of the user."""
    q = (body.get("message") or "").strip()
    if not q:
        raise ApiError(400, "请输入指令")
    tznow = datetime.now(BUSINESS_TZ)
    day_start = datetime.combine(tznow.date(), time.min, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    day_end = day_start + timedelta(days=1)
    actions = []

    if any(k in q for k in ("督办", "督查", "预警")):
        red = (await db.execute(select(func.count()).select_from(SupTask).where(SupTask.warning_level == "RED", SupTask.status != "CLOSED"))).scalar()
        yellow = (await db.execute(select(func.count()).select_from(SupTask).where(SupTask.warning_level == "YELLOW", SupTask.status != "CLOSED"))).scalar()
        total = (await db.execute(select(func.count()).select_from(SupTask).where(SupTask.status != "CLOSED"))).scalar()
        reply = f"当前重点督办在办 {total} 项，其中黄码预警 {yellow} 项、红码超期 {red} 项。建议优先关注红码任务，可前往「重点督办→动态预警」下发催办通知。"
        actions.append({"tool": "supervision_trigger_auto_urging", "summary": f"巡检完成：黄码{yellow}、红码{red}"})
    elif any(k in q for k in ("会议", "会议室", "议程")):
        bookings = (await db.execute(
            select(ConfBooking).where(ConfBooking.during.overlaps(Range(day_start, day_end)), ConfBooking.status != "CANCELLED")
        ).order_by(ConfBooking.during)).scalars().all()
        lines = [f"{b.during.lower.astimezone(BUSINESS_TZ):%H:%M}-{b.during.upper.astimezone(BUSINESS_TZ):%H:%M} {b.title}" for b in bookings[:6]]
        reply = "今日会议安排：\n" + ("\n".join(lines) if lines else "今日暂无会议")
        actions.append({"tool": "meeting_book_room", "summary": "如需预订可告知时间与人数"})
    elif any(k in q for k in ("访客", "来访")):
        active = (await db.execute(select(func.count()).select_from(VisAppointment).where(VisAppointment.status == "CHECKED_IN"))).scalar()
        pending = (await db.execute(select(func.count()).select_from(VisAppointment).where(VisAppointment.status.in_(("PENDING_HOST", "PENDING_SECURITY"))))).scalar()
        reply = f"当前在院访客 {active} 人，待审核预约 {pending} 条。需要我生成访客邀请码或审核预约吗？"
        actions.append({"tool": "visitor_query_active", "summary": f"在院{active}人"})
    elif any(k in q for k in ("用车", "车辆", "公车", "派车")):
        avail = (await db.execute(select(func.count()).select_from(FltApplication).where(FltApplication.status.in_(("DEPT_PENDING", "ADMIN_PENDING"))))).scalar()
        reply = f"车队当前有 {avail} 条用车申请待调度。请告知用车时间、目的地与乘车人数，我可代为提交用车申请。"
        actions.append({"tool": "fleet_query_available_cars", "summary": "可查询指定时段可用车辆"})
    elif any(k in q for k in ("请假", "年假", "调休")):
        from app.models.extras import AttLeaveQuota
        quotas = (await db.execute(select(AttLeaveQuota).where(AttLeaveQuota.user_id == p.user_id, AttLeaveQuota.year == tznow.year))).scalars().all()
        if quotas:
            lines = [f"{q.leave_type}: 剩余 {q.total_days - q.used_days:.1f} 天" for q in quotas]
            reply = "您的假期余额：\n" + "\n".join(lines) + "\n如需请假请告知起止时间与事由。"
        else:
            reply = "本年度暂无假期额度记录，请联系人事初始化额度。"
        actions.append({"tool": "attendance_apply_leave", "summary": "可自然语言代提交请假"})
    elif any(k in q for k in ("知识", "政策", "制度", "文件", "规定")):
        from app.models.extras import KnbDocument
        docs = (await db.execute(select(KnbDocument).limit(3))).scalars().all()
        reply = "为您检索到以下相关知识：\n" + "\n".join(f"· {d.title}" for d in docs) if docs else "知识库暂无匹配内容"
        actions.append({"tool": "knowledge_search", "summary": f"命中 {len(docs)} 条"})
    elif any(k in q for k in ("调研", "课题")):
        topics = (await db.execute(select(func.count()).select_from(RschTopic).where(RschTopic.status.in_(("PLANNED", "APPROVED", "IN_PROGRESS"))))).scalar()
        issues = (await db.execute(select(func.count()).select_from(RschIssueLog).where(RschIssueLog.status == "LOGGED"))).scalar()
        reply = f"当前调研课题 {topics} 个在推进，未整改问题台账 {issues} 条。可为我安排新调研计划并自动执行防撞期检测。"
        actions.append({"tool": "research_check_conflicts", "summary": "支持撞期检测"})
    else:
        reply = ("我可以协助您完成以下事项：\n· 查询重点督办与预警情况\n· 查看今日会议与议程\n· 查询访客在院与预约审核\n· 用车申请与车辆调度\n· 请假余额查询与代提交\n· 知识库政策检索\n· 调研课题与防撞期检测\n请直接描述您的需求。")
    return ok({"reply": reply, "actions": actions})
