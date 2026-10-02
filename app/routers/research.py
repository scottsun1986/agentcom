"""Government research & inspection activity endpoints (closed loop):
课题立项 -> 点位路线规划(防撞期统筹) -> 报备审批 -> 调研实施 -> 问题台账
-> 报告评审归档 -> 问题一键转督办（跨模块调 supervision.build_task）。"""

import uuid
from collections import Counter
from datetime import date, datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.config import BUSINESS_TZ
from app.core.deps import Principal, apply_data_scope, require_perms
from app.core.errors import ApiError
from app.core.resp import ok, page
from app.database import get_db
from app.models.research import RschIssueLog, RschRoutePoint, RschTopic
from app.models.supervision import SupTask
from app.models.system import SysDept
from app.routers.supervision import PRIORITIES, build_task

router = APIRouter(prefix="/api/research", tags=["政务调研活动"])

RESEARCH_TYPE_LABELS = {
    "SPECIAL": "专项调研", "GRASSROOTS": "蹲点调研",
    "ANATOMY": "解剖式调研", "SECRET_VISIT": "暗访微调研",
}
TOPIC_STATUS_LABELS = {
    "PLANNED": "已立项待审批", "APPROVED": "已报备",
    "IN_PROGRESS": "调研进行中", "REPORT_REVIEW": "报告评审中", "COMPLETED": "已归档",
}
ISSUE_STATUSES = {"LOGGED", "SUPERVISED", "RECTIFIED"}
ISSUE_STATUS_LABELS = {"LOGGED": "已登记", "SUPERVISED": "已转督办", "RECTIFIED": "已整改"}


# ---------------- shared helpers ----------------

def parse_uuid(value, msg: str = "标识格式无效") -> uuid.UUID:
    try:
        return uuid.UUID(str(value))
    except (ValueError, AttributeError, TypeError):
        raise ApiError(400, msg)


def parse_date(value, msg: str = "日期格式无效，应为 YYYY-MM-DD") -> date:
    try:
        return date.fromisoformat(str(value))
    except (ValueError, TypeError):
        raise ApiError(400, msg)


async def next_topic_no(db: AsyncSession) -> str:
    """课题编号自动生成：DY-2026-NNN（取当年最大序号 +1）。"""
    year = datetime.now(BUSINESS_TZ).year
    prefix = f"DY-{year}-"
    nos = (await db.execute(
        select(RschTopic.topic_no).where(RschTopic.topic_no.like(prefix + "%"))
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


async def topic_title_map(db: AsyncSession, topic_ids) -> dict:
    """批量课题 id -> (编号, 标题) 映射。"""
    ids = {t for t in topic_ids if t is not None}
    if not ids:
        return {}
    rows = (await db.execute(
        select(RschTopic.topic_id, RschTopic.topic_no, RschTopic.title).where(RschTopic.topic_id.in_(ids))
    )).all()
    return {r.topic_id: (r.topic_no, r.title) for r in rows}


async def supervision_no_map(db: AsyncSession, task_ids) -> dict:
    """批量督办任务 id -> 督办编号 映射（问题转督办后回显）。"""
    ids = {t for t in task_ids if t is not None}
    if not ids:
        return {}
    rows = (await db.execute(
        select(SupTask.task_id, SupTask.supervision_no).where(SupTask.task_id.in_(ids))
    )).all()
    return {r.task_id: r.supervision_no for r in rows}


async def get_topic_or_404(db: AsyncSession, topic_id, msg: str = "课题标识格式无效") -> RschTopic:
    if not topic_id:
        raise ApiError(400, msg)
    topic = await db.get(RschTopic, parse_uuid(topic_id, msg))
    if not topic:
        raise ApiError(404, "调研课题不存在")
    return topic


def _names_hit(a: str, b: str) -> bool:
    """点位名称命中：同名或互相包含（如“临江街道办”命中“临江街道办事处”）。"""
    a, b = (a or "").strip(), (b or "").strip()
    return bool(a) and bool(b) and (a == b or a in b or b in a)


async def detect_conflicts(
    db: AsyncSession,
    point_names: list[str],
    start: date,
    end: date,
    exclude_topic_id: uuid.UUID | None = None,
) -> list[dict]:
    """防撞期检测核心：查询其它 status 不是 COMPLETED 的课题的点位中，
    名称同名（或包含关系）且 scheduled_date 落在 [start-1d, end+1d] 内的记录。
    返回扁平冲突明细（point_name 为送检名称，existing_point_name 为库内名称）。"""
    lo, hi = sorted((start, end))
    lo, hi = lo - timedelta(days=1), hi + timedelta(days=1)
    names: list[str] = []
    for n in point_names:
        if (n or "").strip() and n not in names:
            names.append(n)
    if not names:
        return []
    stmt = (
        select(RschRoutePoint, RschTopic)
        .join(RschTopic, RschRoutePoint.topic_id == RschTopic.topic_id)
        .where(
            RschTopic.status != "COMPLETED",
            RschRoutePoint.scheduled_date >= lo,
            RschRoutePoint.scheduled_date <= hi,
        )
    )
    if exclude_topic_id is not None:
        stmt = stmt.where(RschRoutePoint.topic_id != exclude_topic_id)
    rows = (await db.execute(stmt)).all()
    conflicts = []
    for pt, topic in rows:
        matched = next((n for n in names if _names_hit(n, pt.point_name)), None)
        if matched is None:
            continue
        conflicts.append({
            "point_name": matched,
            "existing_point_name": pt.point_name,
            "match_type": "SAME" if matched == pt.point_name else "CONTAINS",
            "topic_id": str(topic.topic_id),
            "topic_no": topic.topic_no,
            "topic_title": topic.title,
            "leader_name": topic.leader_name,
            "lead_dept_id": str(topic.lead_dept_id),
            "scheduled_date": pt.scheduled_date.isoformat(),
        })
    return conflicts


async def refresh_topic_conflicts(db: AsyncSession, topic: RschTopic) -> list[dict]:
    """按课题级口径整体重算撞期标记：has_conflict 与各点位 conflict_detected。"""
    points = (await db.execute(
        select(RschRoutePoint)
        .where(RschRoutePoint.topic_id == topic.topic_id)
        .order_by(RschRoutePoint.scheduled_date)
    )).scalars().all()
    conflicts = await detect_conflicts(
        db, [pt.point_name for pt in points], topic.start_date, topic.end_date,
        exclude_topic_id=topic.topic_id,
    )
    hit_names = {c["point_name"] for c in conflicts}
    topic.has_conflict = bool(conflicts)
    for pt in points:
        pt.conflict_detected = pt.point_name in hit_names
    return conflicts


# ---------------- serializers ----------------

def serialize_point(pt: RschRoutePoint) -> dict:
    return {
        "point_id": str(pt.point_id),
        "topic_id": str(pt.topic_id),
        "point_name": pt.point_name,
        "point_address": pt.point_address,
        "scheduled_date": pt.scheduled_date.isoformat(),
        "contact_person": pt.contact_person,
        "contact_phone": pt.contact_phone,
        "conflict_detected": bool(pt.conflict_detected),
    }


def serialize_topic(t: RschTopic, dept_names: dict, *, with_report: bool = False) -> dict:
    data = {
        "topic_id": str(t.topic_id),
        "topic_no": t.topic_no,
        "title": t.title,
        "field_domain": t.field_domain,
        "leader_name": t.leader_name,
        "lead_dept_id": str(t.lead_dept_id),
        "lead_dept_name": dept_names.get(t.lead_dept_id),
        "escort_members": t.escort_members,
        "start_date": t.start_date.isoformat(),
        "end_date": t.end_date.isoformat(),
        "research_type": t.research_type,
        "research_type_label": RESEARCH_TYPE_LABELS.get(t.research_type, t.research_type),
        "has_conflict": bool(t.has_conflict),
        "status": t.status,
        "status_label": TOPIC_STATUS_LABELS.get(t.status, t.status),
        "created_at": t.created_at.isoformat() if t.created_at else None,
    }
    if with_report:
        data["summary_report"] = t.summary_report
    return data


def serialize_issue(i: RschIssueLog, topic_titles: dict, dept_names: dict, sup_nos: dict) -> dict:
    return {
        "issue_id": str(i.issue_id),
        "topic_id": str(i.topic_id),
        "topic_title": topic_titles.get(i.topic_id),
        "point_name": i.point_name,
        "issue_title": i.issue_title,
        "description": i.description,
        "target_dept_id": str(i.target_dept_id) if i.target_dept_id else None,
        "target_dept_name": dept_names.get(i.target_dept_id),
        "status": i.status,
        "status_label": ISSUE_STATUS_LABELS.get(i.status, i.status),
        "converted_supervision_id": str(i.converted_supervision_id) if i.converted_supervision_id else None,
        "converted_supervision_no": sup_nos.get(i.converted_supervision_id),
        "created_at": i.created_at.isoformat() if i.created_at else None,
    }


# ---------------- dashboard ----------------

@router.get("/dashboard")
async def research_dashboard(
    p: Principal = Depends(require_perms("research:dashboard:list")),
    db: AsyncSession = Depends(get_db),
):
    stmt = select(RschTopic)
    stmt = await apply_data_scope(stmt, p, RschTopic.lead_dept_id, None, db)
    topics = (await db.execute(stmt)).scalars().all()
    topic_ids = [t.topic_id for t in topics]

    points: list[RschRoutePoint] = []
    issues: list[RschIssueLog] = []
    if topic_ids:
        points = (await db.execute(
            select(RschRoutePoint).where(RschRoutePoint.topic_id.in_(topic_ids))
        )).scalars().all()
        issues = (await db.execute(
            select(RschIssueLog).where(RschIssueLog.topic_id.in_(topic_ids))
        )).scalars().all()

    issue_total = len(issues)
    rectified = sum(1 for i in issues if i.status == "RECTIFIED")
    heat = Counter(pt.point_name for pt in points if pt.point_name)
    return ok({
        "in_progress_topics": sum(1 for t in topics if t.status == "IN_PROGRESS"),
        "total_topics": len(topics),
        "covered_points": len({pt.point_name for pt in points if pt.point_name}),
        "point_total": len(points),
        "issue_total": issue_total,
        "rectified_total": rectified,
        "rectified_rate": round(rectified / max(1, issue_total) * 100, 1),
        "conflict_hits": sum(1 for pt in points if pt.conflict_detected),
        "conflict_topics": sum(1 for t in topics if t.has_conflict),
        "status_counts": {s: sum(1 for t in topics if t.status == s) for s in TOPIC_STATUS_LABELS},
        "point_heat_ranking": [{"point_name": n, "count": c} for n, c in heat.most_common(8)],
        "generated_at": datetime.now(BUSINESS_TZ).isoformat(),
    })


# ---------------- topics CRUD ----------------

@router.get("/topics")
async def list_topics(
    p: Principal = Depends(require_perms("research:topic:list")),
    db: AsyncSession = Depends(get_db),
    keyword: str | None = None, status: str | None = None, field_domain: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = select(RschTopic).order_by(RschTopic.created_at.desc())
    # 数据范围：按牵头部门 lead_dept_id 过滤（SELF/DEPT 本部门，DEPT_AND_CHILD 用 ancestors）
    stmt = await apply_data_scope(stmt, p, RschTopic.lead_dept_id, None, db)
    if keyword:
        stmt = stmt.where(or_(
            RschTopic.title.contains(keyword),
            RschTopic.topic_no.contains(keyword),
        ))
    if status:
        stmt = stmt.where(RschTopic.status == status)
    if field_domain:
        stmt = stmt.where(RschTopic.field_domain == field_domain)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    names = await dept_name_map(db, {r.lead_dept_id for r in rows})
    return page([serialize_topic(r, names) for r in rows], total)


@router.get("/topics/{topic_id}")
async def get_topic_detail(
    topic_id: str,
    p: Principal = Depends(require_perms("research:topic:list")),
    db: AsyncSession = Depends(get_db),
):
    stmt = (
        select(RschTopic)
        .where(RschTopic.topic_id == parse_uuid(topic_id, "课题标识格式无效"))
        .options(selectinload(RschTopic.points), selectinload(RschTopic.issues))
    )
    stmt = await apply_data_scope(stmt, p, RschTopic.lead_dept_id, None, db)
    topic = (await db.execute(stmt)).scalar_one_or_none()
    if not topic:
        raise ApiError(404, "调研课题不存在")
    topic.points.sort(key=lambda x: (x.scheduled_date, x.point_name))
    topic.issues.sort(key=lambda x: (x.created_at is None, x.created_at))
    dept_names = await dept_name_map(
        db, {topic.lead_dept_id, *(i.target_dept_id for i in topic.issues if i.target_dept_id)}
    )
    sup_nos = await supervision_no_map(
        db, {i.converted_supervision_id for i in topic.issues if i.converted_supervision_id}
    )
    data = serialize_topic(topic, dept_names, with_report=True)
    data["points"] = [serialize_point(pt) for pt in topic.points]
    data["issues"] = [
        serialize_issue(i, {topic.topic_id: topic.title}, dept_names, sup_nos)
        for i in topic.issues
    ]
    return ok(data)


@router.post("/topics")
async def create_topic(
    body: dict,
    p: Principal = Depends(require_perms("research:topic:add")),
    db: AsyncSession = Depends(get_db),
):
    title = (body.get("title") or "").strip()
    if not title:
        raise ApiError(400, "课题名称不能为空")
    leader_name = (body.get("leader_name") or "").strip()
    if not leader_name:
        raise ApiError(400, "领队领导不能为空")
    lead_dept_id = parse_uuid(body.get("lead_dept_id"), "牵头部门标识格式无效")
    if not await db.get(SysDept, lead_dept_id):
        raise ApiError(404, "牵头部门不存在")
    start_date = parse_date(body.get("start_date"), "调研开始日期格式无效，应为 YYYY-MM-DD")
    end_date = parse_date(body.get("end_date"), "调研结束日期格式无效，应为 YYYY-MM-DD")
    if end_date < start_date:
        raise ApiError(400, "结束日期不能早于开始日期")
    research_type = body.get("research_type", "SPECIAL")
    if research_type not in RESEARCH_TYPE_LABELS:
        raise ApiError(400, "调研类型无效")
    raw_points = body.get("points") or []
    if not isinstance(raw_points, list):
        raise ApiError(400, "points 应为点位数组")
    planned_points = []
    for item in raw_points:
        if not isinstance(item, dict):
            raise ApiError(400, "点位格式无效")
        point_name = (item.get("point_name") or "").strip()
        if not point_name:
            raise ApiError(400, "点位名称不能为空")
        planned_points.append({
            "point_name": point_name,
            "point_address": item.get("point_address"),
            "scheduled_date": parse_date(item.get("scheduled_date"), "点位计划日期格式无效，应为 YYYY-MM-DD"),
            "contact_person": item.get("contact_person"),
            "contact_phone": item.get("contact_phone"),
        })

    topic = RschTopic(
        title=title,
        field_domain=(body.get("field_domain") or "经济与产业").strip() or "经济与产业",
        leader_name=leader_name,
        lead_dept_id=lead_dept_id,
        escort_members=body.get("escort_members"),
        start_date=start_date,
        end_date=end_date,
        research_type=research_type,
        status="PLANNED",
    )
    topic.topic_no = await next_topic_no(db)
    db.add(topic)
    await db.flush()
    for item in planned_points:
        db.add(RschRoutePoint(topic_id=topic.topic_id, **item))
    await db.flush()
    # 防撞期统筹：对每个点位名检测其它未结题课题的撞期记录并回写标记
    conflicts = await refresh_topic_conflicts(db, topic)
    names = await dept_name_map(db, {topic.lead_dept_id})
    data = serialize_topic(topic, names, with_report=True)
    data["conflicts"] = conflicts
    return ok(
        data,
        "调研课题已立项" + ("，检测到撞期风险，建议调整时间或开展联合调研" if conflicts else ""),
    )


@router.put("/topics/{topic_id}")
async def update_topic(
    topic_id: str, body: dict,
    p: Principal = Depends(require_perms("research:topic:edit")),
    db: AsyncSession = Depends(get_db),
):
    topic = await get_topic_or_404(db, topic_id)
    dates_changed = False
    if "title" in body:
        if not (body.get("title") or "").strip():
            raise ApiError(400, "课题名称不能为空")
        topic.title = body["title"].strip()
    if "field_domain" in body and (body.get("field_domain") or "").strip():
        topic.field_domain = body["field_domain"].strip()
    if "leader_name" in body:
        if not (body.get("leader_name") or "").strip():
            raise ApiError(400, "领队领导不能为空")
        topic.leader_name = body["leader_name"].strip()
    if "lead_dept_id" in body:
        new_dept = parse_uuid(body["lead_dept_id"], "牵头部门标识格式无效")
        if not await db.get(SysDept, new_dept):
            raise ApiError(404, "牵头部门不存在")
        topic.lead_dept_id = new_dept
    if "escort_members" in body:
        topic.escort_members = body.get("escort_members")
    if "start_date" in body:
        topic.start_date = parse_date(body["start_date"], "调研开始日期格式无效，应为 YYYY-MM-DD")
        dates_changed = True
    if "end_date" in body:
        topic.end_date = parse_date(body["end_date"], "调研结束日期格式无效，应为 YYYY-MM-DD")
        dates_changed = True
    if topic.end_date < topic.start_date:
        raise ApiError(400, "结束日期不能早于开始日期")
    if "research_type" in body:
        if body["research_type"] not in RESEARCH_TYPE_LABELS:
            raise ApiError(400, "调研类型无效")
        topic.research_type = body["research_type"]
    conflicts: list[dict] = []
    if dates_changed:
        # 调研周期变化后按课题级口径重算防撞期标记
        conflicts = await refresh_topic_conflicts(db, topic)
    names = await dept_name_map(db, {topic.lead_dept_id})
    data = serialize_topic(topic, names, with_report=True)
    if dates_changed:
        data["conflicts"] = conflicts
    return ok(data, "课题已更新")


@router.delete("/topics/{topic_id}")
async def delete_topic(
    topic_id: str,
    p: Principal = Depends(require_perms("research:topic:del")),
    db: AsyncSession = Depends(get_db),
):
    topic = await get_topic_or_404(db, topic_id)
    await db.delete(topic)  # 点位/问题台账由 CASCADE 级联删除
    return ok(None, "删除成功")


# ---------------- topic workflow transitions ----------------

@router.post("/topics/{topic_id}/approve")
async def approve_topic(
    topic_id: str,
    p: Principal = Depends(require_perms("research:topic:audit")),
    db: AsyncSession = Depends(get_db),
):
    topic = await get_topic_or_404(db, topic_id)
    if topic.status != "PLANNED":
        raise ApiError(400, "仅待审批（PLANNED）课题可报备审批")
    topic.status = "APPROVED"
    names = await dept_name_map(db, {topic.lead_dept_id})
    return ok(serialize_topic(topic, names), "报备审批通过")


@router.post("/topics/{topic_id}/start")
async def start_topic(
    topic_id: str,
    p: Principal = Depends(require_perms("research:topic:audit", "research:topic:edit")),
    db: AsyncSession = Depends(get_db),
):
    topic = await get_topic_or_404(db, topic_id)
    if topic.status != "APPROVED":
        raise ApiError(400, "仅已报备（APPROVED）课题可开始实施")
    topic.status = "IN_PROGRESS"
    names = await dept_name_map(db, {topic.lead_dept_id})
    return ok(serialize_topic(topic, names), "调研已开始实施")


@router.post("/topics/{topic_id}/report")
async def submit_topic_report(
    topic_id: str, body: dict,
    p: Principal = Depends(require_perms("research:topic:edit")),
    db: AsyncSession = Depends(get_db),
):
    topic = await get_topic_or_404(db, topic_id)
    summary = (body.get("summary_report") or "").strip()
    if not summary:
        raise ApiError(400, "调研报告内容不能为空")
    topic.summary_report = summary
    topic.status = "REPORT_REVIEW"
    names = await dept_name_map(db, {topic.lead_dept_id})
    return ok(serialize_topic(topic, names, with_report=True), "调研报告已提交评审")


@router.post("/topics/{topic_id}/finalize")
async def finalize_topic(
    topic_id: str,
    p: Principal = Depends(require_perms("research:topic:audit")),
    db: AsyncSession = Depends(get_db),
):
    topic = await get_topic_or_404(db, topic_id)
    if topic.status != "REPORT_REVIEW":
        raise ApiError(400, "仅报告评审中（REPORT_REVIEW）课题可归档办结")
    topic.status = "COMPLETED"
    names = await dept_name_map(db, {topic.lead_dept_id})
    return ok(serialize_topic(topic, names, with_report=True), "课题已归档办结")


# ---------------- conflict inspection ----------------

@router.get("/topics/{topic_id}/conflicts")
async def list_topic_conflicts(
    topic_id: str,
    p: Principal = Depends(require_perms("research:topic:list")),
    db: AsyncSession = Depends(get_db),
):
    topic = await get_topic_or_404(db, topic_id)
    points = (await db.execute(
        select(RschRoutePoint).where(RschRoutePoint.topic_id == topic.topic_id)
    )).scalars().all()
    conflicts = await detect_conflicts(
        db, [pt.point_name for pt in points], topic.start_date, topic.end_date,
        exclude_topic_id=topic.topic_id,
    )
    dept_names = await dept_name_map(db, {uuid.UUID(c["lead_dept_id"]) for c in conflicts})
    grouped: dict[str, dict] = {}
    for c in conflicts:
        g = grouped.setdefault(c["topic_id"], {
            "topic_id": c["topic_id"],
            "topic_no": c["topic_no"],
            "topic_title": c["topic_title"],
            "leader_name": c["leader_name"],
            "lead_dept_name": dept_names.get(uuid.UUID(c["lead_dept_id"])),
            "matched_points": [],
        })
        g["matched_points"].append({
            "point_name": c["point_name"],
            "existing_point_name": c["existing_point_name"],
            "match_type": c["match_type"],
            "scheduled_date": c["scheduled_date"],
        })
    return ok({
        "topic_id": str(topic.topic_id),
        "topic_no": topic.topic_no,
        "title": topic.title,
        "has_conflict": bool(conflicts),
        "conflict_topic_count": len(grouped),
        "conflicts": list(grouped.values()),
    })


@router.post("/check-conflicts")
async def check_conflicts(
    body: dict,
    p: Principal = Depends(require_perms("research:topic:list", "research:point:list")),
    db: AsyncSession = Depends(get_db),
):
    """纯校验接口（不落库）：供 MCP 工具 research_check_conflicts 调用。"""
    point_names = body.get("point_names") or []
    if not isinstance(point_names, list) or not [n for n in point_names if (n or "").strip()]:
        raise ApiError(400, "point_names 不能为空")
    start = parse_date(body.get("start_date"), "开始日期格式无效，应为 YYYY-MM-DD")
    end = parse_date(body.get("end_date"), "结束日期格式无效，应为 YYYY-MM-DD")
    conflicts = await detect_conflicts(db, [str(n) for n in point_names], start, end)
    return ok({
        "has_conflict": bool(conflicts),
        "checked_point_count": len({n for n in point_names if (n or "").strip()}),
        "conflicts": conflicts,
    }, "检测完成" if conflicts else "无撞期风险")


# ---------------- route points ----------------

@router.get("/points")
async def list_points(
    p: Principal = Depends(require_perms("research:point:list")),
    db: AsyncSession = Depends(get_db),
    topic_id: str | None = None, keyword: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = (
        select(RschRoutePoint)
        .join(RschTopic, RschRoutePoint.topic_id == RschTopic.topic_id)
        .order_by(RschRoutePoint.scheduled_date.desc(), RschRoutePoint.point_name)
    )
    # 数据范围跟随所属课题的牵头部门
    stmt = await apply_data_scope(stmt, p, RschTopic.lead_dept_id, None, db)
    if topic_id:
        stmt = stmt.where(RschRoutePoint.topic_id == parse_uuid(topic_id, "课题标识格式无效"))
    if keyword:
        stmt = stmt.where(RschRoutePoint.point_name.contains(keyword))
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    briefs = await topic_title_map(db, {r.topic_id for r in rows})
    items = []
    for r in rows:
        d = serialize_point(r)
        d["topic_no"], d["topic_title"] = briefs.get(r.topic_id, (None, None))
        items.append(d)
    return page(items, total)


@router.post("/points")
async def create_point(
    body: dict,
    p: Principal = Depends(require_perms("research:point:add")),
    db: AsyncSession = Depends(get_db),
):
    topic = await get_topic_or_404(db, body.get("topic_id"), "所属课题标识不能为空")
    point_name = (body.get("point_name") or "").strip()
    if not point_name:
        raise ApiError(400, "点位名称不能为空")
    scheduled = parse_date(body.get("scheduled_date"), "点位计划日期格式无效，应为 YYYY-MM-DD")
    pt = RschRoutePoint(
        topic_id=topic.topic_id, point_name=point_name,
        point_address=body.get("point_address"), scheduled_date=scheduled,
        contact_person=body.get("contact_person"), contact_phone=body.get("contact_phone"),
    )
    db.add(pt)
    await db.flush()
    # 单点位防撞期：以该点位自身日期 ±1 天为窗口检测其它未结题课题
    conflicts = await detect_conflicts(
        db, [point_name], scheduled, scheduled, exclude_topic_id=topic.topic_id,
    )
    pt.conflict_detected = bool(conflicts)
    if conflicts:
        topic.has_conflict = True
    data = serialize_point(pt)
    data["conflicts"] = conflicts
    return ok(data, "点位已登记" + ("，检测到撞期风险" if conflicts else ""))


@router.put("/points/{point_id}")
async def update_point(
    point_id: str, body: dict,
    p: Principal = Depends(require_perms("research:point:edit")),
    db: AsyncSession = Depends(get_db),
):
    pt = await db.get(RschRoutePoint, parse_uuid(point_id, "点位标识格式无效"))
    if not pt:
        raise ApiError(404, "调研点位不存在")
    changed = False
    if "point_name" in body:
        new_name = (body.get("point_name") or "").strip()
        if not new_name:
            raise ApiError(400, "点位名称不能为空")
        if new_name != pt.point_name:
            pt.point_name = new_name
            changed = True
    if "point_address" in body:
        pt.point_address = body.get("point_address")
    if "scheduled_date" in body:
        new_date = parse_date(body["scheduled_date"], "点位计划日期格式无效，应为 YYYY-MM-DD")
        if new_date != pt.scheduled_date:
            pt.scheduled_date = new_date
            changed = True
    if "contact_person" in body:
        pt.contact_person = body.get("contact_person")
    if "contact_phone" in body:
        pt.contact_phone = body.get("contact_phone")
    conflicts: list[dict] = []
    if changed:
        conflicts = await detect_conflicts(
            db, [pt.point_name], pt.scheduled_date, pt.scheduled_date,
            exclude_topic_id=pt.topic_id,
        )
        pt.conflict_detected = bool(conflicts)
        if conflicts:
            topic = await db.get(RschTopic, pt.topic_id)
            if topic:
                topic.has_conflict = True
    data = serialize_point(pt)
    if changed:
        data["conflicts"] = conflicts
    return ok(data, "点位已更新")


@router.delete("/points/{point_id}")
async def delete_point(
    point_id: str,
    p: Principal = Depends(require_perms("research:point:del")),
    db: AsyncSession = Depends(get_db),
):
    pt = await db.get(RschRoutePoint, parse_uuid(point_id, "点位标识格式无效"))
    if not pt:
        raise ApiError(404, "调研点位不存在")
    await db.delete(pt)
    return ok(None, "删除成功")


# ---------------- issue log ----------------

@router.get("/issues")
async def list_issues(
    p: Principal = Depends(require_perms("research:issue:list")),
    db: AsyncSession = Depends(get_db),
    topic_id: str | None = None, status: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    stmt = (
        select(RschIssueLog)
        .join(RschTopic, RschIssueLog.topic_id == RschTopic.topic_id)
        .order_by(RschIssueLog.created_at.desc())
    )
    # 数据范围跟随所属课题的牵头部门
    stmt = await apply_data_scope(stmt, p, RschTopic.lead_dept_id, None, db)
    if topic_id:
        stmt = stmt.where(RschIssueLog.topic_id == parse_uuid(topic_id, "课题标识格式无效"))
    if status:
        stmt = stmt.where(RschIssueLog.status == status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    titles = await topic_title_map(db, {r.topic_id for r in rows})
    dept_names = await dept_name_map(db, {r.target_dept_id for r in rows if r.target_dept_id})
    sup_nos = await supervision_no_map(
        db, {r.converted_supervision_id for r in rows if r.converted_supervision_id}
    )
    return page([
        serialize_issue(
            r,
            {tid: brief[1] for tid, brief in titles.items()},
            dept_names, sup_nos,
        ) for r in rows
    ], total)


@router.post("/issues")
async def create_issue(
    body: dict,
    p: Principal = Depends(require_perms("research:issue:add")),
    db: AsyncSession = Depends(get_db),
):
    topic = await get_topic_or_404(db, body.get("topic_id"), "课题标识不能为空")
    issue_title = (body.get("issue_title") or "").strip()
    if not issue_title:
        raise ApiError(400, "问题标题不能为空")
    description = (body.get("description") or "").strip()
    if not description:
        raise ApiError(400, "问题描述不能为空")
    target_dept_id = None
    if body.get("target_dept_id"):
        target_dept_id = parse_uuid(body["target_dept_id"], "责任部门标识格式无效")
        if not await db.get(SysDept, target_dept_id):
            raise ApiError(404, "责任部门不存在")
    issue = RschIssueLog(
        topic_id=topic.topic_id,
        point_name=(body.get("point_name") or "").strip() or None,
        issue_title=issue_title,
        description=description,
        target_dept_id=target_dept_id,
        status="LOGGED",
    )
    db.add(issue)
    await db.flush()
    titles = await topic_title_map(db, {issue.topic_id})
    dept_names = await dept_name_map(db, {issue.target_dept_id} if issue.target_dept_id else set())
    return ok(
        serialize_issue(issue, {tid: b[1] for tid, b in titles.items()}, dept_names, {}),
        "调研问题已登记",
    )


@router.put("/issues/{issue_id}")
async def update_issue(
    issue_id: str, body: dict,
    p: Principal = Depends(require_perms("research:issue:edit")),
    db: AsyncSession = Depends(get_db),
):
    issue = await db.get(RschIssueLog, parse_uuid(issue_id, "问题标识格式无效"))
    if not issue:
        raise ApiError(404, "调研问题不存在")
    if "issue_title" in body:
        if not (body.get("issue_title") or "").strip():
            raise ApiError(400, "问题标题不能为空")
        issue.issue_title = body["issue_title"].strip()
    if "description" in body:
        if not (body.get("description") or "").strip():
            raise ApiError(400, "问题描述不能为空")
        issue.description = body["description"].strip()
    if "point_name" in body:
        issue.point_name = (body.get("point_name") or "").strip() or None
    if "target_dept_id" in body:
        if body.get("target_dept_id"):
            new_dept = parse_uuid(body["target_dept_id"], "责任部门标识格式无效")
            if not await db.get(SysDept, new_dept):
                raise ApiError(404, "责任部门不存在")
            issue.target_dept_id = new_dept
        else:
            issue.target_dept_id = None
    if "status" in body:
        if body["status"] not in ISSUE_STATUSES:
            raise ApiError(400, "问题状态无效")
        issue.status = body["status"]
    titles = await topic_title_map(db, {issue.topic_id})
    dept_names = await dept_name_map(db, {issue.target_dept_id} if issue.target_dept_id else set())
    sup_nos = await supervision_no_map(
        db, {issue.converted_supervision_id} if issue.converted_supervision_id else set()
    )
    return ok(
        serialize_issue(issue, {tid: b[1] for tid, b in titles.items()}, dept_names, sup_nos),
        "问题台账已更新",
    )


@router.post("/issues/{issue_id}/to-supervision")
async def convert_issue_to_supervision(
    issue_id: str, body: dict,
    p: Principal = Depends(require_perms("research:issue:convert")),
    db: AsyncSession = Depends(get_db),
):
    """核心协同闭环：调研发现的问题一键转【政务督查督办】立项，限期整改销号。"""
    issue = await db.get(RschIssueLog, parse_uuid(issue_id, "问题标识格式无效"))
    if not issue:
        raise ApiError(404, "调研问题不存在")
    if issue.status == "SUPERVISED":
        raise ApiError(400, "该问题已转督办，请勿重复提交")
    deadline = parse_date(body.get("deadline"), "整改时限格式无效，应为 YYYY-MM-DD")
    priority = body.get("priority", "NORMAL")
    if priority not in PRIORITIES:
        raise ApiError(400, "紧急程度无效")
    topic = await db.get(RschTopic, issue.topic_id)
    lead_dept_id = issue.target_dept_id or (topic.lead_dept_id if topic else None)
    if not lead_dept_id:
        raise ApiError(400, "缺少责任部门，无法转督办")
    task = await build_task(
        db,
        title=f"调研问题整改：{issue.issue_title}",
        source_type="RESEARCH_ISSUE",
        lead_dept_id=lead_dept_id,
        deadline=deadline,
        priority=priority,
        content=issue.description,
        created_by=p.display_name,
    )
    issue.converted_supervision_id = task.task_id
    issue.status = "SUPERVISED"
    return ok({
        "issue_id": str(issue.issue_id),
        "status": issue.status,
        "status_label": ISSUE_STATUS_LABELS.get(issue.status, issue.status),
        "task_id": str(task.task_id),
        "supervision_no": task.supervision_no,
        "title": task.title,
        "lead_dept_id": str(task.lead_dept_id),
        "deadline": task.deadline.isoformat(),
        "priority": task.priority,
    }, "已转督办立项，限期整改销号")


# ---------------- report archive ----------------

@router.get("/reports")
async def list_reports(
    p: Principal = Depends(require_perms("research:report:list")),
    db: AsyncSession = Depends(get_db),
    keyword: str | None = None, status: str | None = None,
    pageNum: int = 1, pageSize: int = 10,
):
    """已提交调研报告（summary_report）的课题分页，供报告评审与成果归档。"""
    stmt = select(RschTopic).where(
        RschTopic.summary_report.is_not(None),
        RschTopic.summary_report != "",
    ).order_by(RschTopic.created_at.desc())
    stmt = await apply_data_scope(stmt, p, RschTopic.lead_dept_id, None, db)
    if keyword:
        stmt = stmt.where(or_(
            RschTopic.title.contains(keyword),
            RschTopic.topic_no.contains(keyword),
        ))
    if status:
        stmt = stmt.where(RschTopic.status == status)
    total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
    rows = (await db.execute(stmt.limit(pageSize).offset((pageNum - 1) * pageSize))).scalars().all()
    names = await dept_name_map(db, {r.lead_dept_id for r in rows})
    return page([serialize_topic(r, names, with_report=True) for r in rows], total)
