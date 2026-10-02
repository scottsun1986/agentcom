"""Government supervision & key-task tracking endpoints (closed loop):
立项登记 -> 里程碑分解 -> 进展反馈 -> 红黄绿预警 -> 延期审核 -> 办结销号 -> 督查简报."""

import uuid
from collections import Counter
from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import BUSINESS_TZ
from app.core.deps import Principal, apply_data_scope, require_auth, require_perms
from app.core.errors import ApiError
from app.core.resp import ok, page
from app.database import get_db
from app.models.extras import SupExtensionRequest, SysNotice
from app.models.supervision import SupMilestone, SupProgressReport, SupTask
from app.models.system import SysDept, SysUser

router = APIRouter(prefix="/api/supervision", tags=["政务督查督办"])

SOURCE_TYPES = {"LEADER_INSTRUCTION", "GOV_REPORT", "COUNCIL_DECISION", "EMERGENCY"}
PRIORITIES = {"TOP", "URGENT", "NORMAL"}
TASK_STATUSES = {"DRAFT", "IN_PROGRESS", "EXTENSION_PENDING", "CLOSE_PENDING", "CLOSED", "CANCELLED"}
MILESTONE_STATUSES = {"PENDING", "IN_PROGRESS", "DONE", "OVERDUE"}
PERIOD_TYPES = {"WEEKLY", "HALF_MONTH", "MONTHLY", "SPECIAL"}

SOURCE_TYPE_LABELS = {
    "LEADER_INSTRUCTION": "领导批示", "GOV_REPORT": "政府工作报告",
    "COUNCIL_DECISION": "会议决议", "EMERGENCY": "应急专项",
}
PRIORITY_LABELS = {"TOP": "特急", "URGENT": "急", "NORMAL": "常规"}
STATUS_LABELS = {
    "DRAFT": "草稿", "IN_PROGRESS": "在办", "EXTENSION_PENDING": "延期待审",
    "CLOSE_PENDING": "销号待审", "CLOSED": "已办结", "CANCELLED": "已取消",
}
WARNING_LABELS = {"GREEN": "绿码·正常", "YELLOW": "黄码·临期预警", "RED": "红码·超期"}
EXTENSION_STATUS_LABELS = {"PENDING": "待审核", "APPROVED": "已批准", "REJECTED": "已驳回"}


# ---------------- shared helpers ----------------

def parse_uuid(value: str, msg: str = "标识格式无效") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise ApiError(400, msg)


def parse_date(value, msg: str = "日期格式无效，应为 YYYY-MM-DD") -> date:
    try:
        return date.fromisoformat(str(value))
    except (ValueError, TypeError):
        raise ApiError(400, msg)


async def next_supervision_no(db: AsyncSession) -> str:
    """督办编号自动生成：DB-2026-NNN（取当年最大序号 +1）。"""
    year = datetime.now(BUSINESS_TZ).year
    prefix = f"DB-{year}-"
    nos = (await db.execute(
        select(SupTask.supervision_no).where(SupTask.supervision_no.like(prefix + "%"))
    )).scalars().all()
    max_seq = 0
    for no in nos:
        tail = no.rsplit("-", 1)[-1]
        if tail.isdigit():
            max_seq = max(max_seq, int(tail))
    return f"{prefix}{max_seq + 1:03d}"


async def dept_name_map(db: AsyncSession, dept_ids) -> dict:
    """批量 id->name 映射，避免异步会话懒加载（MissingGreenlet）。"""
    ids = {d for d in dept_ids if d is not None}
    if not ids:
        return {}
    rows = (await db.execute(
        select(SysDept.dept_id, SysDept.dept_name).where(SysDept.dept_id.in_(ids))
    )).all()
    return {r.dept_id: r.dept_name for r in rows}


def recalc_warning(task: SupTask, today: date | None = None) -> str:
    """预警规则：距 deadline≤7 天且未 100% -> YELLOW；已超期未办结 -> RED；其余 GREEN。"""
    today = today or datetime.now(BUSINESS_TZ).date()
    if task.deadline < today:
        task.warning_level = "RED"
    elif (task.deadline - today).days <= 7 and task.progress_pct < 100:
        task.warning_level = "YELLOW"
    else:
        task.warning_level = "GREEN"
    return task.warning_level


def sync_task_progress(task: SupTask) -> int:
    """task.progress_pct = 最大里程碑/上报值。"""
    candidates = [0]
    candidates += [m.progress_pct for m in (task.milestones or [])]
    candidates += [r.progress_pct for r in (task.reports or [])]
    task.progress_pct = max(candidates)
    return task.progress_pct


async def get_task_or_404(db: AsyncSession, task_id: str) -> SupTask:
    task = await db.get(SupTask, parse_uuid(task_id, "任务标识格式无效"))
    if not task:
        raise ApiError(404, "督办任务不存在")
    return task


# ---------------- serializers ----------------

def serialize_task(t: SupTask, dept_names: dict | None = None) -> dict:
    if dept_names is not None:
        lead_name = dept_names.get(t.lead_dept_id)
    else:
        # 调用方须已 selectinload(SupTask.lead_dept)
        lead_name = t.lead_dept.dept_name if t.lead_dept is not None else None
    days_left = (t.deadline - datetime.now(BUSINESS_TZ).date()).days
    return {
        "task_id": str(t.task_id),
        "supervision_no": t.supervision_no,
        "title": t.title,
        "source_type": t.source_type,
        "source_type_label": SOURCE_TYPE_LABELS.get(t.source_type, t.source_type),
        "priority": t.priority,
        "priority_label": PRIORITY_LABELS.get(t.priority, t.priority),
        "lead_dept_id": str(t.lead_dept_id),
        "lead_dept_name": lead_name,
        "assist_dept_names": t.assist_dept_names,
        "leader_in_charge": t.leader_in_charge,
        "deadline": t.deadline.isoformat(),
        "days_left": days_left,
        "warning_level": t.warning_level,
        "warning_label": WARNING_LABELS.get(t.warning_level, t.warning_level),
        "progress_pct": t.progress_pct,
        "status": t.status,
        "status_label": STATUS_LABELS.get(t.status, t.status),
        "content": t.content,
        "closeout_summary": t.closeout_summary,
        "closeout_approved_by": t.closeout_approved_by,
        "closeout_at": t.closeout_at.isoformat() if t.closeout_at else None,
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }


def serialize_milestone(m: SupMilestone) -> dict:
    return {
        "milestone_id": str(m.milestone_id),
        "task_id": str(m.task_id),
        "title": m.title,
        "due_date": m.due_date.isoformat(),
        "target_output": m.target_output,
        "progress_pct": m.progress_pct,
        "status": m.status,
    }


def serialize_report(r: SupProgressReport, dept_names: dict | None = None, user_names: dict | None = None) -> dict:
    return {
        "report_id": str(r.report_id),
        "task_id": str(r.task_id),
        "period_type": r.period_type,
        "progress_pct": r.progress_pct,
        "details": r.details,
        "blockers": r.blockers,
        "submit_dept_id": str(r.submit_dept_id) if r.submit_dept_id else None,
        "submit_dept_name": (dept_names or {}).get(r.submit_dept_id),
        "submit_user_id": str(r.submit_user_id) if r.submit_user_id else None,
        "submit_user_name": (user_names or {}).get(r.submit_user_id),
        "created_at": r.created_at.isoformat() if r.created_at else None,
    }


def serialize_extension(x: SupExtensionRequest, task_titles: dict | None = None) -> dict:
    return {
        "request_id": str(x.request_id),
        "task_id": str(x.task_id),
        "task_title": (task_titles or {}).get(x.task_id),
        "reason": x.reason,
        "old_deadline": x.old_deadline.isoformat(),
        "new_deadline": x.new_deadline.isoformat(),
        "status": x.status,
        "status_label": EXTENSION_STATUS_LABELS.get(x.status, x.status),
        "applicant_name": x.applicant_name,
        "audit_comment": x.audit_comment,
        "created_at": x.created_at.isoformat() if x.created_at else None,
    }


# ---------------- module-level service (跨模块调用：会务/调研转督办) ----------------

async def build_task(
    db: AsyncSession,
    *,
    title,
    source_type,
    lead_dept_id,
    deadline,
    priority="NORMAL",
    content="",
    assist_dept_names=None,
    leader_in_charge=None,
    created_by="系统",
) -> SupTask:
    """自动生成 supervision_no 并落库（flush 不 commit）。

    供会务（决议事项转督办）/调研（批示转督办）等模块跨模块调用。
    注：SupTask 模型无 created_by 字段（规范禁止修改 models），该参数仅作调用方
    追溯标识，通过日志留存，不落库。
    """
    task = SupTask(
        title=str(title),
        source_type=str(source_type or "LEADER_INSTRUCTION"),
        lead_dept_id=lead_dept_id if isinstance(lead_dept_id, uuid.UUID) else uuid.UUID(str(lead_dept_id)),
        deadline=deadline if isinstance(deadline, date) else date.fromisoformat(str(deadline)),
        priority=str(priority or "NORMAL"),
        content=str(content or ""),
        assist_dept_names=assist_dept_names,
        leader_in_charge=leader_in_charge,
        status="IN_PROGRESS",
    )
    task.supervision_no = await next_supervision_no(db)
    recalc_warning(task)
    db.add(task)
    await db.flush()
    return task


# ---------------- dashboard ----------------

@router.get("/dashboard")
async def supervision_dashboard(
    p: Principal = Depends(require_perms("supervision:dashboard:list")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(SupTask)
    stmt = await apply_data_scope(stmt, p, SupTask.lead_dept_id, None, db)
    tasks = (await db.execute(stmt)).scalars().all()

    tznow = datetime.now(BUSINESS_TZ)
    today = tznow.date()

    total = len(tasks)
    closed_tasks = [t for t in tasks if t.status == "CLOSED"]
    cancelled = sum(1 for t in tasks if t.status == "CANCELLED")
    handling = total - len(closed_tasks) - cancelled  # 在办 = 未办结未取消
    in_progress = sum(1 for t in tasks if t.status == "IN_PROGRESS")

    on_time_closed = sum(
        1 for t in closed_tasks
        if t.closeout_at and t.closeout_at.astimezone(BUSINESS_TZ).date() <= t.deadline
    )
    on_time_rate = round(on_time_closed / max(1, len(closed_tasks)) * 100, 1)

    active = [t for t in tasks if t.status == "IN_PROGRESS"]
    warning_distribution = {
        "GREEN": sum(1 for t in active if t.warning_level == "GREEN"),
        "YELLOW": sum(1 for t in active if t.warning_level == "YELLOW"),
        "RED": sum(1 for t in active if t.warning_level == "RED"),
    }

    # 承办部门办结排行榜（按办结数）
    dept_names = await dept_name_map(db, {t.lead_dept_id for t in tasks})
    closed_counter = Counter(t.lead_dept_id for t in closed_tasks)
    dept_ranking = [
        {
            "dept_id": str(dept_id),
            "dept_name": dept_names.get(dept_id),
            "closed_count": count,
        }
        for dept_id, count in closed_counter.most_common(10)
    ]

    # 近 6 个月办结趋势（按 closeout_at 归属月份）
    trend = []
    base_index = tznow.year * 12 + (tznow.month - 1)
    for k in range(5, -1, -1):
        idx = base_index - k
        y, m0 = divmod(idx, 12)
        m = m0 + 1
        m_start = datetime(y, m, 1, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
        ny, nm0 = divmod(idx + 1, 12)
        m_end = datetime(ny, nm0 + 1, 1, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
        count = sum(
            1 for t in closed_tasks
            if t.closeout_at and m_start <= t.closeout_at < m_end
        )
        trend.append({"month": f"{y:04d}-{m:02d}", "closed_count": count})

    status_counts = {s: sum(1 for t in tasks if t.status == s) for s in TASK_STATUSES}
    return ok({
        "total": total,
        "handling": handling,
        "in_progress": in_progress,
        "closed": len(closed_tasks),
        "on_time_closed": on_time_closed,
        "on_time_rate": on_time_rate,
        "warning_distribution": warning_distribution,
        "status_counts": status_counts,
        "dept_ranking": dept_ranking,
        "closed_trend": trend,
        "generated_at": tznow.isoformat(),
    })


# ---------------- tasks CRUD ----------------

@router.get("/tasks")
async def list_tasks(
    p: Principal = Depends(require_perms("supervision:task:list")),
    db: AsyncSession = Depends(get_db),
    keyword: str | None = None, status: str | None = None,
    warning_level: str | None = None, priority: str | None = None,
    lead_dept_id: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(SupTask).order_by(SupTask.created_at.desc())
    # 数据范围：按 lead_dept_id 过滤（SELF/DEPT 视为本部门，DEPT_AND_CHILD 用 ancestors）
    stmt = await apply_data_scope(stmt, p, SupTask.lead_dept_id, None, db)
    if keyword:
        stmt = stmt.where(or_(
            SupTask.title.contains(keyword),
            SupTask.supervision_no.contains(keyword),
        ))
    if status:
        stmt = stmt.where(SupTask.status == status)
    if warning_level:
        stmt = stmt.where(SupTask.warning_level == warning_level)
    if priority:
        stmt = stmt.where(SupTask.priority == priority)
    if lead_dept_id:
        stmt = stmt.where(SupTask.lead_dept_id == parse_uuid(lead_dept_id, "部门标识格式无效"))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    names = await dept_name_map(db, {r.lead_dept_id for r in rows})
    return page([serialize_task(r, names) for r in rows], total)


@router.get("/tasks/{task_id}")
async def get_task_detail(
    task_id: str,
    p: Principal = Depends(require_perms("supervision:task:list")),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(SupTask)
        .where(SupTask.task_id == parse_uuid(task_id, "任务标识格式无效"))
        .options(
            selectinload(SupTask.lead_dept),
            selectinload(SupTask.milestones),
            selectinload(SupTask.reports),
        )
    )
    stmt = await apply_data_scope(stmt, p, SupTask.lead_dept_id, None, db)
    task = (await db.execute(stmt)).scalar_one_or_none()
    if not task:
        raise ApiError(404, "督办任务不存在")
    task.milestones.sort(key=lambda m: m.due_date)
    extensions = (await db.execute(
        select(SupExtensionRequest)
        .where(SupExtensionRequest.task_id == task.task_id)
        .order_by(SupExtensionRequest.created_at.desc())
    )).scalars().all()
    dept_names = await dept_name_map(
        db, {task.lead_dept_id, *(r.submit_dept_id for r in task.reports)}
    )
    user_ids = {r.submit_user_id for r in task.reports if r.submit_user_id}
    user_names = {}
    if user_ids:
        urows = (await db.execute(
            select(SysUser.user_id, SysUser.nick_name).where(SysUser.user_id.in_(user_ids))
        )).all()
        user_names = {u.user_id: u.nick_name for u in urows}
    data = serialize_task(task, dept_names)
    data["milestones"] = [serialize_milestone(m) for m in task.milestones]
    data["reports"] = [serialize_report(r, dept_names, user_names) for r in task.reports]
    data["extensions"] = [serialize_extension(x) for x in extensions]
    return ok(data)


@router.post("/tasks")
async def create_task(
    body: dict,
    p: Principal = Depends(require_perms("supervision:task:add")),
    db: AsyncSession = Depends(get_db),
):
    title = (body.get("title") or "").strip()
    if not title:
        raise ApiError(400, "任务标题不能为空")
    if "lead_dept_id" not in body or not body.get("lead_dept_id"):
        raise ApiError(400, "主办处室不能为空")
    lead_dept_id = parse_uuid(body["lead_dept_id"], "部门标识格式无效")
    dept = await db.get(SysDept, lead_dept_id)
    if not dept:
        raise ApiError(404, "主办处室不存在")
    source_type = body.get("source_type", "LEADER_INSTRUCTION")
    if source_type not in SOURCE_TYPES:
        raise ApiError(400, "督办来源无效")
    priority = body.get("priority", "NORMAL")
    if priority not in PRIORITIES:
        raise ApiError(400, "紧急程度无效")
    deadline = parse_date(body.get("deadline"), "办结时限格式无效，应为 YYYY-MM-DD")
    task = await build_task(
        db,
        title=title,
        source_type=source_type,
        lead_dept_id=lead_dept_id,
        deadline=deadline,
        priority=priority,
        content=body.get("content", ""),
        assist_dept_names=body.get("assist_dept_names"),
        leader_in_charge=body.get("leader_in_charge"),
        created_by=p.display_name,
    )
    names = await dept_name_map(db, {task.lead_dept_id})
    return ok(serialize_task(task, names), "督办立项成功")


@router.put("/tasks/{task_id}")
async def update_task(
    task_id: str, body: dict,
    p: Principal = Depends(require_perms("supervision:task:edit")),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    if "title" in body:
        if not (body.get("title") or "").strip():
            raise ApiError(400, "任务标题不能为空")
        task.title = body["title"].strip()
    if "source_type" in body:
        if body["source_type"] not in SOURCE_TYPES:
            raise ApiError(400, "督办来源无效")
        task.source_type = body["source_type"]
    if "priority" in body:
        if body["priority"] not in PRIORITIES:
            raise ApiError(400, "紧急程度无效")
        task.priority = body["priority"]
    if "lead_dept_id" in body:
        new_dept = parse_uuid(body["lead_dept_id"], "部门标识格式无效")
        if not await db.get(SysDept, new_dept):
            raise ApiError(404, "主办处室不存在")
        task.lead_dept_id = new_dept
    if "deadline" in body:
        task.deadline = parse_date(body["deadline"], "办结时限格式无效，应为 YYYY-MM-DD")
    if "content" in body:
        task.content = body.get("content") or ""
    if "assist_dept_names" in body:
        task.assist_dept_names = body.get("assist_dept_names")
    if "leader_in_charge" in body:
        task.leader_in_charge = body.get("leader_in_charge")
    recalc_warning(task)
    names = await dept_name_map(db, {task.lead_dept_id})
    return ok(serialize_task(task, names), "任务已更新")


@router.delete("/tasks/{task_id}")
async def delete_task(
    task_id: str,
    p: Principal = Depends(require_perms("supervision:task:del")),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    await db.delete(task)  # 里程碑/进展/延期申请由 CASCADE 级联删除
    return ok(None, "删除成功")


# ---------------- milestones ----------------

@router.post("/tasks/{task_id}/milestones")
async def add_milestone(
    task_id: str, body: dict,
    p: Principal = Depends(require_perms("supervision:task:add", "supervision:milestone:edit")),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    title = (body.get("title") or "").strip()
    if not title:
        raise ApiError(400, "里程碑名称不能为空")
    due_date = parse_date(body.get("due_date"), "里程碑时限格式无效，应为 YYYY-MM-DD")
    m = SupMilestone(
        task_id=task.task_id, title=title, due_date=due_date,
        target_output=body.get("target_output"),
        progress_pct=0, status="PENDING",
    )
    db.add(m)
    await db.flush()
    return ok(serialize_milestone(m), "里程碑已登记")


@router.put("/milestones/{milestone_id}")
async def update_milestone(
    milestone_id: str, body: dict,
    p: Principal = Depends(require_perms("supervision:milestone:edit")),
    db: AsyncSession = Depends(get_db),
):
    m = await db.get(SupMilestone, parse_uuid(milestone_id, "里程碑标识格式无效"))
    if not m:
        raise ApiError(404, "里程碑不存在")
    if "progress_pct" in body:
        try:
            pct = int(body["progress_pct"])
        except (TypeError, ValueError):
            raise ApiError(400, "进度百分比无效")
        if not 0 <= pct <= 100:
            raise ApiError(400, "进度百分比应在 0-100 之间")
        m.progress_pct = pct
    if "status" in body:
        if body["status"] not in MILESTONE_STATUSES:
            raise ApiError(400, "里程碑状态无效")
        m.status = body["status"]
    return ok(serialize_milestone(m), "里程碑已更新")


@router.delete("/milestones/{milestone_id}")
async def delete_milestone(
    milestone_id: str,
    p: Principal = Depends(require_perms("supervision:milestone:edit")),
    db: AsyncSession = Depends(get_db),
):
    m = await db.get(SupMilestone, parse_uuid(milestone_id, "里程碑标识格式无效"))
    if not m:
        raise ApiError(404, "里程碑不存在")
    await db.delete(m)
    return ok(None, "删除成功")


# ---------------- progress reports ----------------

@router.post("/tasks/{task_id}/reports")
async def submit_report(
    task_id: str, body: dict,
    p: Principal = Depends(require_perms("supervision:report:add")),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    period_type = body.get("period_type", "WEEKLY")
    if period_type not in PERIOD_TYPES:
        raise ApiError(400, "报送周期类型无效")
    details = (body.get("details") or "").strip()
    if not details:
        raise ApiError(400, "进展详情不能为空")
    try:
        pct = int(body.get("progress_pct", 0))
    except (TypeError, ValueError):
        raise ApiError(400, "进度百分比无效")
    if not 0 <= pct <= 100:
        raise ApiError(400, "进度百分比应在 0-100 之间")
    report = SupProgressReport(
        task_id=task.task_id,
        submit_dept_id=p.dept_id,
        submit_user_id=p.user_id,
        period_type=period_type,
        progress_pct=pct,
        details=details,
        blockers=body.get("blockers"),
    )
    db.add(report)
    await db.flush()
    # task.progress_pct 取最大里程碑/上报值，并重算预警
    task.reports.append(report)
    sync_task_progress(task)
    recalc_warning(task)
    dept_names = await dept_name_map(db, {report.submit_dept_id} if report.submit_dept_id else set())
    return ok(serialize_report(report, dept_names), "进展已报送")


# ---------------- urge (催办) ----------------

@router.post("/tasks/{task_id}/urge")
async def urge_task(
    task_id: str,
    p: Principal = Depends(require_perms("supervision:task:audit")),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    dept = await db.get(SysDept, task.lead_dept_id)
    dept_name = dept.dept_name if dept else "承办部门"
    # 承办部门负责人：优先按 dept.leader 姓名匹配部门内用户，未匹配到则站内广播
    leader_user = None
    if dept and dept.leader:
        leader_user = (await db.execute(
            select(SysUser).where(
                SysUser.dept_id == task.lead_dept_id,
                SysUser.nick_name == dept.leader,
                SysUser.del_flag == "0", SysUser.status == "0",
            )
        )).scalars().first()
    content = (
        f"【督查催办通知单】{dept_name}：贵部门承办的督办事项 "
        f"【{task.supervision_no}】{task.title} 办结时限为 {task.deadline.isoformat()}，"
        f"当前进度 {task.progress_pct}%（{WARNING_LABELS.get(task.warning_level, task.warning_level)}），"
        f"请加快推进并按周期报送进展，逾期将纳入督查通报。"
    )
    notice = SysNotice(
        user_id=leader_user.user_id if leader_user else None,
        title="督办催办通知",
        content=content,
        notice_type="WARNING",
        source_module="supervision",
        link=f"/supervision/decomposition?task_id={task.task_id}",
    )
    db.add(notice)
    await db.flush()
    return ok({
        "task_id": str(task.task_id),
        "notice_id": str(notice.notice_id),
        "noticed_dept": dept_name,
        "noticed_user": leader_user.nick_name if leader_user else None,
    }, "催办通知已下发")


# ---------------- warning refresh ----------------

@router.post("/warning/refresh")
async def refresh_warnings(
    p: Principal = Depends(require_perms("supervision:task:edit", "supervision:task:audit")),
    db: AsyncSession = Depends(get_db),
):
    """全量重算所有 IN_PROGRESS 任务的预警等级并返回各色计数。"""
    stmt = select(SupTask).where(SupTask.status == "IN_PROGRESS")
    tasks = (await db.execute(stmt)).scalars().all()
    counts = {"GREEN": 0, "YELLOW": 0, "RED": 0}
    for t in tasks:
        counts[recalc_warning(t)] += 1
    return ok({
        "refreshed": len(tasks),
        "GREEN": counts["GREEN"],
        "YELLOW": counts["YELLOW"],
        "RED": counts["RED"],
    }, "预警状态已刷新")


# ---------------- extension (延期申请与审核) ----------------

@router.get("/extensions")
async def list_extensions(
    p: Principal = Depends(require_perms("supervision:task:list")),
    db: AsyncSession = Depends(get_db),
    status: str | None = None, task_id: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = (
        select(SupExtensionRequest)
        .join(SupTask, SupExtensionRequest.task_id == SupTask.task_id)
        .order_by(SupExtensionRequest.created_at.desc())
    )
    # 数据范围：延期申请跟随所属督办任务的 lead_dept_id
    stmt = await apply_data_scope(stmt, p, SupTask.lead_dept_id, None, db)
    if status:
        stmt = stmt.where(SupExtensionRequest.status == status)
    if task_id:
        stmt = stmt.where(SupExtensionRequest.task_id == parse_uuid(task_id, "任务标识格式无效"))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    task_titles = {}
    if rows:
        trows = (await db.execute(
            select(SupTask.task_id, SupTask.title).where(
                SupTask.task_id.in_({r.task_id for r in rows})
            )
        )).all()
        task_titles = {t.task_id: t.title for t in trows}
    return page([serialize_extension(r, task_titles) for r in rows], total)


@router.post("/extensions")
async def apply_extension(
    body: dict,
    p: Principal = Depends(require_perms("supervision:task:edit")),
    db: AsyncSession = Depends(get_db),
):
    if "task_id" not in body or not body.get("task_id"):
        raise ApiError(400, "任务标识不能为空")
    task = await get_task_or_404(db, body["task_id"])
    if task.status != "IN_PROGRESS":
        raise ApiError(400, "当前任务状态不允许申请延期")
    reason = (body.get("reason") or "").strip()
    if not reason:
        raise ApiError(400, "延期理由不能为空")
    new_deadline = parse_date(body.get("new_deadline"), "新时限格式无效，应为 YYYY-MM-DD")
    if new_deadline <= task.deadline:
        raise ApiError(400, "新时限必须晚于原时限")
    req = SupExtensionRequest(
        task_id=task.task_id, reason=reason,
        old_deadline=task.deadline, new_deadline=new_deadline,
        status="PENDING", applicant_name=p.display_name,
    )
    db.add(req)
    task.status = "EXTENSION_PENDING"
    await db.flush()
    return ok(serialize_extension(req), "延期申请已提交，待督查室审核")


@router.post("/extensions/{request_id}/audit")
async def audit_extension(
    request_id: str, body: dict,
    p: Principal = Depends(require_perms("supervision:extension:audit")),
    db: AsyncSession = Depends(get_db),
):
    req = await db.get(SupExtensionRequest, parse_uuid(request_id, "申请标识格式无效"))
    if not req:
        raise ApiError(404, "延期申请不存在")
    if req.status != "PENDING":
        raise ApiError(400, "该申请已审批完成")
    action = body.get("action", "")
    if action not in ("APPROVE", "REJECT"):
        raise ApiError(400, "审批动作无效")
    task = await db.get(SupTask, req.task_id)
    if action == "APPROVE":
        req.status = "APPROVED"
        # 闭环联动：批准后调整工期、任务回到在办、预警复位绿码
        if task:
            task.deadline = req.new_deadline
            task.status = "IN_PROGRESS"
            task.warning_level = "GREEN"
    else:
        req.status = "REJECTED"
        if task:
            task.status = "IN_PROGRESS"
            recalc_warning(task)  # 工期未变，按现行规则还原预警
    req.audit_comment = body.get("comment")
    await db.flush()
    task_titles = {req.task_id: task.title} if task else {}
    return ok(serialize_extension(req, task_titles), "审批完成")


# ---------------- closeout (办结销号) ----------------

@router.get("/closeouts")
async def list_closeouts(
    p: Principal = Depends(require_perms("supervision:closeout:audit", "supervision:task:list")),
    db: AsyncSession = Depends(get_db),
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(SupTask).where(SupTask.status == "CLOSE_PENDING").order_by(SupTask.created_at.desc())
    stmt = await apply_data_scope(stmt, p, SupTask.lead_dept_id, None, db)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    names = await dept_name_map(db, {r.lead_dept_id for r in rows})
    return page([serialize_task(r, names) for r in rows], total)


@router.post("/tasks/{task_id}/closeout-request")
async def request_closeout(
    task_id: str, body: dict,
    p: Principal = Depends(require_perms("supervision:task:edit")),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    if task.status != "IN_PROGRESS":
        raise ApiError(400, "当前任务状态不允许申请销号")
    summary = (body.get("closeout_summary") or "").strip()
    if not summary:
        raise ApiError(400, "办结销号说明不能为空")
    task.closeout_summary = summary
    task.status = "CLOSE_PENDING"
    names = await dept_name_map(db, {task.lead_dept_id})
    return ok(serialize_task(task, names), "销号申请已提交，待督查室审核")


@router.post("/tasks/{task_id}/closeout-audit")
async def audit_closeout(
    task_id: str, body: dict,
    p: Principal = Depends(require_perms("supervision:closeout:audit")),
    db: AsyncSession = Depends(get_db),
):
    task = await get_task_or_404(db, task_id)
    if task.status != "CLOSE_PENDING":
        raise ApiError(400, "该任务未在销号审核中")
    action = body.get("action", "")
    if action not in ("APPROVE", "REJECT"):
        raise ApiError(400, "审批动作无效")
    if action == "APPROVE":
        task.status = "CLOSED"
        task.closeout_at = datetime.now(timezone.utc)
        task.closeout_approved_by = p.display_name
        task.warning_level = "GREEN"
        if (body.get("comment") or "").strip():
            task.closeout_summary = f"{task.closeout_summary or ''}\n【审签意见】{body['comment'].strip()}"
    else:
        task.status = "IN_PROGRESS"
        recalc_warning(task)  # 驳回回退在办，按现行规则还原预警
    names = await dept_name_map(db, {task.lead_dept_id})
    return ok(serialize_task(task, names), "审批完成")


# ---------------- bulletin (督查简报) ----------------

@router.get("/bulletin")
async def bulletin(
    period_type: str = Query(default="MONTHLY", description="MONTHLY / QUARTERLY"),
    month: str = Query(default=None, description="YYYY-MM，缺省为当前月"),
    p: Principal = Depends(require_perms("supervision:bulletin:list")),
    db: AsyncSession = Depends(get_db),
):
    tznow = datetime.now(BUSINESS_TZ)
    if month:
        try:
            y, m = (int(x) for x in month.split("-"))
            assert 1 <= m <= 12
        except (ValueError, AssertionError):
            raise ApiError(400, "月份格式无效，应为 YYYY-MM")
    else:
        y, m = tznow.year, tznow.month
    # WEEKLY 等其他类型暂按月度口径汇编（简报以月报/季报为主）
    if period_type == "QUARTERLY":
        q_start = ((m - 1) // 3) * 3 + 1
        label = f"{y}年第{(m - 1) // 3 + 1}季度"
        start_idx = y * 12 + (q_start - 1)
        end_idx = start_idx + 3
    else:
        period_type = "MONTHLY"
        label = f"{y}年{m}月"
        start_idx = y * 12 + (m - 1)
        end_idx = start_idx + 1
    sy, sm0 = divmod(start_idx, 12)
    ey, em0 = divmod(end_idx, 12)
    period_start = datetime(sy, sm0 + 1, 1, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)
    period_end = datetime(ey, em0 + 1, 1, tzinfo=BUSINESS_TZ).astimezone(timezone.utc)

    stmt = select(SupTask)
    stmt = await apply_data_scope(stmt, p, SupTask.lead_dept_id, None, db)
    tasks = (await db.execute(stmt)).scalars().all()

    new_count = sum(
        1 for t in tasks
        if t.created_at and period_start <= t.created_at < period_end
    )
    closed_count = sum(
        1 for t in tasks
        if t.closeout_at and period_start <= t.closeout_at < period_end
    )
    end_date = period_end.astimezone(BUSINESS_TZ).date()
    overdue_count = sum(
        1 for t in tasks
        if t.deadline < end_date
        and t.status not in ("CLOSED", "CANCELLED")
        and (t.created_at is None or t.created_at < period_end)
    )

    # 红黄牌单位排名（期末仍在办事项）
    dept_names = await dept_name_map(db, {t.lead_dept_id for t in tasks})
    card_counter: dict = {}
    for t in tasks:
        if t.status not in ("IN_PROGRESS", "EXTENSION_PENDING", "CLOSE_PENDING"):
            continue
        if t.warning_level not in ("RED", "YELLOW"):
            continue
        stat = card_counter.setdefault(t.lead_dept_id, {"RED": 0, "YELLOW": 0})
        stat[t.warning_level] += 1
    card_ranking = sorted(
        (
            {
                "dept_id": str(dept_id),
                "dept_name": dept_names.get(dept_id),
                "red_count": stat["RED"],
                "yellow_count": stat["YELLOW"],
                "total": stat["RED"] + stat["YELLOW"],
            }
            for dept_id, stat in card_counter.items()
        ),
        key=lambda x: (-x["red_count"], -x["yellow_count"]),
    )

    lines = [
        f"【督查督办工作简报】{label}",
        f"一、总体情况：本期新立项督办事项 {new_count} 项，办结销号 {closed_count} 项；"
        f"截至期末超期未结 {overdue_count} 项。",
    ]
    if card_ranking:
        rank_lines = "；".join(
            f"{i}. {r['dept_name'] or '未知部门'}（红牌 {r['red_count']}、黄牌 {r['yellow_count']}）"
            for i, r in enumerate(card_ranking[:5], start=1)
        )
        lines.append(f"二、红黄牌单位排名：{rank_lines}。")
    else:
        lines.append("二、红黄牌单位排名：本期无红黄牌单位。")
    lines.append(
        "三、请各单位对照办结时限加快推进，按周期如实报送进展；"
        "逾期事项将在下期督查通报中点名批评。"
    )
    summary = "\n".join(lines)
    return ok({
        "period_type": period_type,
        "month": f"{y:04d}-{m:02d}",
        "label": label,
        "new_count": new_count,
        "closed_count": closed_count,
        "overdue_count": overdue_count,
        "card_ranking": card_ranking,
        "summary": summary,
        "generated_at": tznow.isoformat(),
    })
