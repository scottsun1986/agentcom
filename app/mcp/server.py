"""MCP 2.2.0 server exposing the AgentCom tool chain.

Transport: Streamable HTTP at /mcp (plus legacy SSE at /sse).
Auth: 标准单 Secret 模式 — `Authorization: Bearer <Agent Secret>` validated
against sys_app_credential (scopes enforced by tool-level scope declarations)."""

import asyncio
import contextlib
import contextvars
import time as time_mod
import uuid
from datetime import date, datetime, time, timedelta, timezone

from mcp.server.mcpserver import MCPServer

from app.config import BUSINESS_TZ, get_settings
from app.core.agent_token import app_id_from_secret, bearer_secret
from app.core.deps import Principal
from app.core.security import verify_password
from app.database import async_session_factory
from app.models.system import SysAppCredential, SysDept, SysUser

MCP = MCPServer(
    name="agentcom",
    title="AgentCom 政企协同办公平台",
    version="1.0.0",
    instructions=(
        "AgentCom 企业与政务协同办公平台 MCP 工具链。覆盖考勤、资产耗材、重点督办、"
        "会务会议、组织通讯、门禁访客、公务用车、调研活动、知识库九大业务域，"
        "支持 Agent 完成申请、审批、调度、预警、闭环整改等全链路操作。"
    ),
)

_current_agent: contextvars.ContextVar[SysAppCredential | None] = contextvars.ContextVar(
    "current_agent", default=None
)

_auth_cache: dict[str, tuple[float, SysAppCredential]] = {}
_AUTH_TTL = 300


async def validate_agent_secret(secret: str | None) -> SysAppCredential | None:
    """Validate a single agent secret (Bearer token) against DB (with short TTL cache)."""
    if not secret:
        return None
    app_id = app_id_from_secret(secret)
    if app_id is None:
        return None
    cached = _auth_cache.get(secret)
    if cached and time_mod.time() - cached[0] < _AUTH_TTL:
        return cached[1]
    async with async_session_factory() as db:
        cred = (await db.execute(
            SysAppCredential.__table__.select().where(
                SysAppCredential.app_id == app_id, SysAppCredential.is_active.is_(True)
            )
        )).first()
        if not cred:
            return None
        obj = SysAppCredential(**{k: getattr(cred, k) for k in (
            "id", "app_id", "app_secret_hash", "app_name", "description", "scopes",
            "rate_limit_per_minute", "is_active", "created_by")})
        if not verify_password(secret, obj.app_secret_hash):
            return None
    _auth_cache[secret] = (time_mod.time(), obj)
    return obj


def invalidate_agent_auth_cache() -> None:
    """Drop cached agent secrets — called after credential rotate/toggle/delete."""
    _auth_cache.clear()


class MCPAuthMiddleware:
    """ASGI middleware guarding /mcp and /sse with the single agent secret.

    Standard single-secret mode: the client presents one opaque token via
    `Authorization: Bearer <Agent Secret>`.

    Also normalizes the exact mount path (/mcp, /sse) to a trailing slash so
    the mounted sub-app's root route matches (Starlette quirk)."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        headers = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope.get("headers", [])}
        cred = await validate_agent_secret(bearer_secret(headers.get("authorization")))
        if cred is None:
            body = '{"jsonrpc":"2.0","error":{"code":-32001,"message":"无效的 Agent 凭据（Authorization: Bearer <Agent Secret>）"},"id":null}'.encode("utf-8")
            await send({
                "type": "http.response.start", "status": 401,
                "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())],
            })
            await send({"type": "http.response.body", "body": body})
            return
        token = _current_agent.set(cred)
        try:
            await self.app(scope, receive, send)
        finally:
            _current_agent.reset(token)


def _agent_scopes() -> set[str]:
    cred = _current_agent.get()
    if not cred:
        return {"*"}
    return {s.strip() for s in (cred.scopes or "*").split(",") if s.strip()}


def _require_scope(tool_scope: str):
    """tool_scope like 'attendance:write'; '*'-scoped credentials bypass."""
    scopes = _agent_scopes()
    if "*" in scopes or tool_scope in scopes:
        return
    raise PermissionError(f"凭据缺少工具作用域 {tool_scope}")


async def _user_principal(db, user_id: str | None = None) -> Principal:
    """Build a delegating principal for a target user (permission pre-validated at MCP layer)."""
    user = None
    if user_id:
        user = await db.get(SysUser, uuid.UUID(user_id))
    if user is None:
        user = (await db.execute(
            SysUser.__table__.select().where(SysUser.user_name == "admin")
        )).first()
        user = await db.get(SysUser, user.user_id) if user else None
    if user is None:
        raise ValueError("目标用户不存在")
    return Principal(auth_kind="user", user=user, permissions={"*:*:*"}, roles=["admin"])


async def _system_principal() -> Principal:
    return Principal(auth_kind="user", user=None, permissions={"*:*:*"}, roles=["admin"])


def _now() -> datetime:
    return datetime.now(BUSINESS_TZ).astimezone(timezone.utc)


def _parse_dt(s: str) -> datetime:
    dt = datetime.fromisoformat(s)
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=BUSINESS_TZ)
    return dt.astimezone(timezone.utc)


# ================= 考勤 =================

@MCP.tool()
async def attendance_clock_in(
    user_id: str, clock_type: str = "IN", location: str = "", wifi_mac: str = "",
) -> dict:
    """员工或外勤代理打卡。clock_type: IN(上班) OUT(下班) FIELD(外勤)"""
    _require_scope("attendance:write")
    from app.routers import attendance as mod
    async with async_session_factory() as db:
        p = await _user_principal(db, user_id)
        res = await mod.clock_in(
            {"punch_type": clock_type.upper(), "address": location, "wifi_bssid": wifi_mac}, p=p, db=db
        )
        await db.commit()
        return res["data"]


@MCP.tool()
async def attendance_query_status(user_id: str, date: str = "") -> dict:
    """查验个人出勤明细与打卡异常（date 格式 YYYY-MM-DD，留空为今天）。"""
    _require_scope("attendance:read")
    from app.routers import attendance as mod
    async with async_session_factory() as db:
        p = await _user_principal(db, user_id)
        res = await mod.attendance_dashboard(p=p, db=db)
        data = res["data"]
        if date:
            data["query_date"] = date
        return data


@MCP.tool()
async def attendance_apply_leave(
    user_id: str, leave_type: str, start_time: str, end_time: str, reason: str,
) -> dict:
    """自然语言代办发起请假并自动查验假种额度（leave_type: ANNUAL/SICK/CASUAL/COMP...）。"""
    _require_scope("attendance:write")
    from app.routers import attendance as mod
    async with async_session_factory() as db:
        p = await _user_principal(db, user_id)
        res = await mod.apply_leave({
            "leave_type": leave_type.upper(), "start_time": _parse_dt(start_time).isoformat(),
            "end_time": _parse_dt(end_time).isoformat(), "reason": reason,
        }, p=p, db=db)
        await db.commit()
        return res["data"]


@MCP.tool()
async def attendance_audit_workflow(instance_id: str, action: str, comment: str = "") -> dict:
    """主管 Agent 代办审批请假/补卡/出差单据。action: APPROVE|REJECT。自动识别单据类型。"""
    _require_scope("attendance:audit")
    from app.routers import attendance as mod
    async with async_session_factory() as db:
        p = await _system_principal()
        from app.models.attendance import AttLeaveApplication, AttPunchRemedy, AttTripApplication
        from sqlalchemy import select
        for model, fn in (
            (AttLeaveApplication, mod.audit_leave),
            (AttTripApplication, mod.audit_trip),
            (AttPunchRemedy, mod.audit_remedy),
        ):
            row = (await db.execute(
                select(model).where(model.__table__.c[
                    {"AttLeaveApplication": "apply_id", "AttTripApplication": "trip_id", "AttPunchRemedy": "remedy_id"}[model.__name__]
                ] == uuid.UUID(instance_id))
            )).scalar_one_or_none()
            if row:
                res = await fn(instance_id, {"action": action.upper(), "comment": comment}, p=p, db=db)
                await db.commit()
                return {"doc_type": model.__name__, "result": res["data"]}
        raise ValueError("未找到对应的待审批单据")


# ================= 资产 =================

@MCP.tool()
async def assets_query_stock(keyword: str = "", status: str = "", category_id: str = "") -> dict:
    """检索固定资产卡片或耗材库存（keyword 匹配名称/编码，status: IN_STOCK/IN_USE/...）。"""
    _require_scope("assets:read")
    from app.routers import assets as mod
    async with async_session_factory() as db:
        res = await mod.list_ledger(
            keyword=keyword or None, status=status or None,
            category_id=category_id or None, pageNum=1, pageSize=20,
            p=await _system_principal(), db=db,
        )
        return {"total": res["total"], "items": res["rows"]}


@MCP.tool()
async def assets_create_requisition(item_id: str, req_type: str = "CLAIM", reason: str = "", user_id: str = "") -> dict:
    """提交资产领用/借用/调拨/报废申领（req_type: CLAIM/BORROW/TRANSFER/SCRAP）。"""
    _require_scope("assets:write")
    from app.routers import assets as mod
    async with async_session_factory() as db:
        p = await _user_principal(db, user_id)
        res = await mod.create_requisition(
            {"req_type": req_type.upper(), "asset_id": item_id, "reason": reason}, p=p, db=db
        )
        await db.commit()
        return res["data"]


@MCP.tool()
async def assets_stocktake_scan(plan_id: str, asset_code: str) -> dict:
    """移动盘点扫描资产条码核验，实时回传盘点进度。"""
    _require_scope("assets:write")
    from app.routers import assets as mod
    async with async_session_factory() as db:
        res = await mod.stocktake_scan(plan_id, {"asset_code": asset_code}, p=await _system_principal(), db=db)
        await db.commit()
        return res["data"]


@MCP.tool()
async def assets_low_stock_reminder() -> dict:
    """巡检低于安全库存的办公耗材并生成补货建议单。"""
    _require_scope("assets:read")
    from sqlalchemy import select
    from app.models.assets import AstConsumable
    async with async_session_factory() as db:
        rows = (await db.execute(
            select(AstConsumable).where(AstConsumable.stock_count <= AstConsumable.min_stock)
        )).scalars().all()
        return {"alerts": [{
            "item_id": str(c.item_id), "item_code": c.item_code, "name": c.name,
            "stock_count": c.stock_count, "min_stock": c.min_stock,
            "suggest_restock": max(c.min_stock * 2 - c.stock_count, 0),
        } for c in rows], "count": len(rows)}


# ================= 督办 =================

@MCP.tool()
async def supervision_create_item(
    source: str, title: str, lead_dept_id: str, deadline: str, priority: str = "NORMAL", content: str = "",
) -> dict:
    """领导批示或会议决议一键立项督办任务（source: LEADER_INSTRUCTION/GOV_REPORT/COUNCIL_DECISION/EMERGENCY）。"""
    _require_scope("supervision:write")
    from app.routers import supervision as mod
    async with async_session_factory() as db:
        res = await mod.create_task({
            "title": title, "source_type": source.upper(), "lead_dept_id": lead_dept_id,
            "deadline": deadline, "priority": priority.upper(), "content": content or title,
        }, p=await _system_principal(), db=db)
        await db.commit()
        return res["data"]


@MCP.tool()
async def supervision_submit_progress(
    task_id: str, progress_pct: int, details: str, milestone_id: str = "",
) -> dict:
    """填报督办阶段性里程碑进展与佐证说明。"""
    _require_scope("supervision:write")
    from app.routers import supervision as mod
    async with async_session_factory() as db:
        res = await mod.submit_report(
            task_id,
            {"period_type": "SPECIAL", "progress_pct": progress_pct, "details": details},
            p=await _system_principal(), db=db,
        )
        await db.commit()
        return res["data"]


@MCP.tool()
async def supervision_trigger_auto_urging() -> dict:
    """自动化巡检临期红黄码督办任务并自动下发催办通知。"""
    _require_scope("supervision:write")
    from sqlalchemy import func, select
    from app.models.supervision import SupTask
    from app.models.extras import SysNotice
    from app.routers import supervision as mod
    async with async_session_factory() as db:
        await mod.refresh_warnings(p=await _system_principal(), db=db)
        targets = (await db.execute(
            select(SupTask).where(
                SupTask.warning_level.in_(("YELLOW", "RED")),
                SupTask.status.in_(("IN_PROGRESS", "EXTENSION_PENDING")),
            )
        )).scalars().all()
        for t in targets:
            db.add(SysNotice(
                title=f"督办催办通知（{t.supervision_no}）", notice_type="WARNING" if t.warning_level == "YELLOW" else "URGENT",
                source_module="supervision", content=f"【{t.title}】{'临近办结时限' if t.warning_level == 'YELLOW' else '已超期'}，请承办单位抓紧推进并报送进展。",
                link="/supervision/warning",
            ))
        await db.commit()
        return {"urged": len(targets), "yellow": sum(1 for t in targets if t.warning_level == "YELLOW"),
                "red": sum(1 for t in targets if t.warning_level == "RED")}


@MCP.tool()
async def supervision_generate_briefing(period_type: str = "MONTHLY", date_range: str = "") -> dict:
    """自动汇编提炼督办周报/月报简报（date_range 格式 YYYY-MM 或 YYYY-MM~YYYY-MM）。"""
    _require_scope("supervision:read")
    from app.routers import supervision as mod
    async with async_session_factory() as db:
        month = date_range.split("~")[0] if date_range else _now().astimezone(BUSINESS_TZ).strftime("%Y-%m")
        res = await mod.bulletin(period_type=period_type.upper(), month=month, p=await _system_principal(), db=db)
        return res["data"]


# ================= 会务 =================

@MCP.tool()
async def meeting_book_room(
    room_id: str, start_time: str, end_time: str, title: str, attendee_count: int = 1, user_id: str = "",
) -> dict:
    """防双重冲突安全预订会议室（数据库 tsrange+GiST 排除约束兜底）。"""
    _require_scope("conference:write")
    from app.routers import conference as mod
    async with async_session_factory() as db:
        p = await _user_principal(db, user_id)
        res = await mod.create_booking({
            "room_id": room_id, "title": title, "start_time": _parse_dt(start_time).isoformat(),
            "end_time": _parse_dt(end_time).isoformat(), "attendee_count": attendee_count,
        }, p=p, db=db)
        await db.commit()
        return res["data"]


@MCP.tool()
async def meeting_generate_seating(meeting_id: str, rule_type: str = "CENTER_FIRST") -> dict:
    """遵循政务座次礼仪智能排布坐席（rule_type: CENTER_FIRST/FRONT_FIRST/LEFT_FIRST/RIGHT_FIRST）。"""
    _require_scope("conference:write")
    from app.routers import conference as mod
    async with async_session_factory() as db:
        res = await mod.generate_seating(meeting_id, {"rule_type": rule_type.upper()}, p=await _system_principal(), db=db)
        await db.commit()
        return res["data"]


@MCP.tool()
async def meeting_dispatch_service(meeting_id: str, service_items: list[str], notes: str = "") -> dict:
    """一键派发会务保障工单（service_items: TEA/AV_PROJECTOR/LED_BANNER/AC 列表）。"""
    _require_scope("conference:write")
    from app.routers import conference as mod
    async with async_session_factory() as db:
        created = []
        for svc in service_items:
            res = await mod.create_service_ticket({"booking_id": meeting_id, "service_type": svc.upper(), "notes": notes},
                                           p=await _system_principal(), db=db)
            created.append(res["data"])
        await db.commit()
        return {"tickets": created, "count": len(created)}


@MCP.tool()
async def meeting_convert_to_supervision(minutes_item_id: str, lead_dept_id: str, deadline: str) -> dict:
    """会议纪要议定事项一键转办为督办任务（闭环落地）。"""
    _require_scope("conference:write")
    from app.routers import conference as mod
    async with async_session_factory() as db:
        res = await mod.convert_action_item_to_supervision(
            minutes_item_id, {"lead_dept_id": lead_dept_id, "deadline": deadline},
            p=await _system_principal(), db=db,
        )
        await db.commit()
        return res["data"]


# ================= 组织通讯 =================

@MCP.tool()
async def contacts_search_person(name_or_keyword: str, dept_id: str = "") -> dict:
    """智能检索干部员工姓名/分机/办公室/职责（联系方式按权限自动脱敏）。"""
    _require_scope("contacts:read")
    from app.routers import contacts as mod
    async with async_session_factory() as db:
        res = await mod.list_employees(
            keyword=name_or_keyword, dept_id=dept_id or None, pageNum=1, pageSize=10,
            p=await _system_principal(), db=db,
        )
        return {"total": res["total"], "matches": res["rows"]}


@MCP.tool()
async def contacts_get_org_tree(parent_id: str = "") -> dict:
    """获取多层级部门组织树与负责人信息。"""
    _require_scope("contacts:read")
    from app.routers import contacts as mod
    async with async_session_factory() as db:
        res = await mod.org_tree(parent_id=parent_id or None, p=await _system_principal(), db=db)
        return res["data"]


@MCP.tool()
async def contacts_query_external(unit_name: str = "", tag: str = "") -> dict:
    """查找对口外联单位与专家联系信息。"""
    _require_scope("contacts:read")
    from app.routers import contacts as mod
    async with async_session_factory() as db:
        partners = await mod.list_partners(keyword=unit_name or None, pageNum=1, pageSize=10,
                                           p=await _system_principal(), db=db)
        return {"partners": partners["rows"]}


# ================= 门禁访客 =================

@MCP.tool()
async def visitor_create_invitation(
    visitor_name: str, phone: str, visit_date: str, purpose: str, host_user_id: str = "",
    duration_hours: float = 2.0,
) -> dict:
    """员工委托 Agent 生成带安全时效的电子访客通行码（免两级审核直接生效）。"""
    _require_scope("visitor:write")
    from app.routers import visitor as mod
    start = _parse_dt(visit_date)
    async with async_session_factory() as db:
        p = await _user_principal(db, host_user_id)
        res = await mod.create_invitation({
            "visitor_name": visitor_name, "visitor_phone": phone,
            "visit_reason": purpose or "公务来访",
            "scheduled_start": start.isoformat(),
            "scheduled_end": (start + timedelta(hours=duration_hours)).isoformat(),
        }, p=p, db=db)
        await db.commit()
        return res["data"]


@MCP.tool()
async def visitor_audit_request(appointment_id: str, action: str, reason: str = "") -> dict:
    """保卫处/受访人审批访客来访申请（action: APPROVE|REJECT，自动推进两级状态机）。"""
    _require_scope("visitor:audit")
    from app.routers import visitor as mod
    async with async_session_factory() as db:
        res = await mod.audit_appointment(
            appointment_id, {"action": action.upper(), "reason": reason},
            p=await _system_principal(), db=db,
        )
        await db.commit()
        return res["data"]


@MCP.tool()
async def visitor_query_active() -> dict:
    """查验当前建筑物内停留访客名单及滞留风险指标。"""
    _require_scope("visitor:read")
    from app.routers import visitor as mod
    async with async_session_factory() as db:
        res = await mod.visitor_dashboard(p=await _system_principal(), db=db)
        return res["data"]


# ================= 公务用车 =================

@MCP.tool()
async def fleet_apply_car(
    purpose: str, origin: str, destination: str, start_time: str, end_time: str,
    seats: int = 1, user_id: str = "", leader_name: str = "",
) -> dict:
    """代办提交合规公车使用申请（进入部门负责人三级审批流）。"""
    _require_scope("fleet:write")
    from app.routers import fleet as mod
    async with async_session_factory() as db:
        p = await _user_principal(db, user_id)
        res = await mod.create_application({
            "purpose": purpose, "origin": origin, "destination": destination,
            "passenger_count": seats, "leader_name": leader_name,
            "start_time": _parse_dt(start_time).isoformat(), "end_time": _parse_dt(end_time).isoformat(),
        }, p=p, db=db)
        await db.commit()
        return res["data"]


@MCP.tool()
async def fleet_dispatch_trip(application_id: str, vehicle_id: str, driver_id: str) -> dict:
    """车队调度分配车辆与司机资源并出具电子派车单。"""
    _require_scope("fleet:write")
    from app.routers import fleet as mod
    async with async_session_factory() as db:
        res = await mod.dispatch_application(
            application_id, {"vehicle_id": vehicle_id, "driver_id": driver_id},
            p=await _system_principal(), db=db,
        )
        await db.commit()
        return res["data"]


@MCP.tool()
async def fleet_return_trip(dispatch_id: str, return_mileage: float, toll_cost: float = 0.0, notes: str = "") -> dict:
    """归队报备实际里程与过路费，核销行程单并释放车辆资源。"""
    _require_scope("fleet:write")
    from app.routers import fleet as mod
    async with async_session_factory() as db:
        res = await mod.return_dispatch(
            dispatch_id, {"end_mileage": return_mileage, "toll_cost": toll_cost, "notes": notes},
            p=await _system_principal(), db=db,
        )
        await db.commit()
        return res["data"]


@MCP.tool()
async def fleet_query_available_cars(start_time: str, end_time: str, seats: int = 1) -> dict:
    """查询指定时段可用公车与当班司机资源（排除时段冲突派车）。"""
    _require_scope("fleet:read")
    from app.routers import fleet as mod
    async with async_session_factory() as db:
        res = await mod.query_available(
            start_time=_parse_dt(start_time).isoformat(), end_time=_parse_dt(end_time).isoformat(),
            seats=seats, p=await _system_principal(), db=db,
        )
        return res["data"]


# ================= 调研 =================

@MCP.tool()
async def research_register_plan(
    title: str, leader_name: str, lead_dept_id: str, start_date: str, end_date: str,
    route_points: list[str] = "", escort_members: str = "", user_id: str = "",
) -> dict:
    """登记新调研方案并自动执行基层点位防撞期冲突检测。route_points 为点位名称列表。"""
    _require_scope("research:write")
    from app.routers import research as mod
    async with async_session_factory() as db:
        p = await _user_principal(db, user_id)
        points = []
        if isinstance(route_points, str):
            route_points = [x for x in route_points.split(",") if x.strip()]
        for i, name in enumerate(route_points):
            points.append({"point_name": name,
                           "scheduled_date": (date.fromisoformat(start_date) + timedelta(days=min(i, 2))).isoformat()})
        res = await mod.create_topic({
            "title": title, "leader_name": leader_name, "lead_dept_id": lead_dept_id,
            "start_date": start_date, "end_date": end_date,
            "escort_members": escort_members, "points": points,
        }, p=p, db=db)
        await db.commit()
        return res["data"]


@MCP.tool()
async def research_check_conflicts(route_points: list[str], start_date: str, end_date: str) -> dict:
    """预防多组基层走访扎堆冲突：检测点位在时段内是否已被其他调研组占用。"""
    _require_scope("research:read")
    if isinstance(route_points, str):
        route_points = [x for x in route_points.split(",") if x.strip()]
    from app.routers import research as mod
    async with async_session_factory() as db:
        res = await mod.check_conflicts({
            "point_names": route_points, "start_date": start_date, "end_date": end_date,
        }, p=await _system_principal(), db=db)
        return res["data"]


@MCP.tool()
async def research_push_to_supervision(issue_id: str, deadline: str) -> dict:
    """调研发现重大堵点问题一键转督办，限期整改销号闭环。"""
    _require_scope("research:write")
    from app.routers import research as mod
    async with async_session_factory() as db:
        res = await mod.convert_issue_to_supervision(
            issue_id, {"deadline": deadline}, p=await _system_principal(), db=db,
        )
        await db.commit()
        return res["data"]


# ================= 知识库 =================

@MCP.tool()
async def knowledge_search(query: str, top_k: int = 5, category: str = "") -> dict:
    """混合知识检索：优先 GBrainKG 演示环境语义检索（远程），自动合并本地政策文档关键词命中；每条含来源(source)与证据片段(evidence/snippet)。"""
    _require_scope("knowledge:read")
    from app.routers import knowledge as mod
    async with async_session_factory() as db:
        res = await mod.search_documents(q=query, top_k=top_k, category=category or None,
                                    p=await _system_principal(), db=db)
        return res["data"]


# ================= 高频补充工具（v1.2 梳理新增） =================

# -------- 考勤 --------

@MCP.tool()
async def attendance_trip_apply(
    user_id: str, destination: str, start_time: str, end_time: str, purpose: str,
    trip_type: str = "BUSINESS_TRIP", origin: str = "单位总部",
) -> dict:
    """代办提交外出/出差报备（审批通过后自动关联免打卡）。trip_type: OUTING(市内外出)/BUSINESS_TRIP(出差)"""
    _require_scope("attendance:write")
    from app.routers import attendance as mod
    async with async_session_factory() as db:
        p = await _user_principal(db, user_id)
        res = await mod.apply_trip({
            "trip_type": trip_type.upper(), "origin": origin, "destination": destination,
            "start_time": _parse_dt(start_time).isoformat(), "end_time": _parse_dt(end_time).isoformat(),
            "purpose": purpose,
        }, p=p, db=db)
        await db.commit()
        return res["data"]


@MCP.tool()
async def attendance_remedy_apply(user_id: str, remedy_time: str, reason: str, punch_type: str = "IN") -> dict:
    """代办提交漏打卡补卡申请（审批通过后自动写入修正打卡记录）。punch_type: IN/OUT"""
    _require_scope("attendance:write")
    from app.routers import attendance as mod
    async with async_session_factory() as db:
        p = await _user_principal(db, user_id)
        res = await mod.apply_remedy({
            "remedy_time": _parse_dt(remedy_time).isoformat(), "punch_type": punch_type.upper(), "reason": reason,
        }, p=p, db=db)
        await db.commit()
        return res["data"]


# -------- 督办 --------

@MCP.tool()
async def supervision_query_tasks(
    keyword: str = "", status: str = "", warning_level: str = "", page_size: int = 10,
) -> dict:
    """查询督办任务列表（keyword 匹配标题/编号；status: IN_PROGRESS/CLOSE_PENDING/CLOSED...；warning_level: GREEN/YELLOW/RED）"""
    _require_scope("supervision:read")
    from app.routers import supervision as mod
    async with async_session_factory() as db:
        res = await mod.list_tasks(
            keyword=keyword or None, status=status or None, warning_level=warning_level or None,
            pageNum=1, pageSize=max(1, min(int(page_size), 50)),
            p=await _system_principal(), db=db,
        )
        return {"total": res["total"], "tasks": res["rows"]}


@MCP.tool()
async def supervision_closeout_request(task_id: str, closeout_summary: str) -> dict:
    """承办单位提交办结销号申请（附办结情况与销号材料摘要，提交后进入督查室审核）。"""
    _require_scope("supervision:write")
    from app.routers import supervision as mod
    async with async_session_factory() as db:
        res = await mod.request_closeout(
            task_id, {"closeout_summary": closeout_summary}, p=await _system_principal(), db=db)
        await db.commit()
        return res["data"]


# -------- 会务 --------

@MCP.tool()
async def meeting_query_available_rooms(start_time: str, end_time: str, seats: int = 1) -> dict:
    """查询指定时段可预订的会议室（按容量筛选，排除已占用/维护/停用），供预订前决策。"""
    _require_scope("conference:read")
    from app.routers import conference as mod
    s, e = _parse_dt(start_time), _parse_dt(end_time)
    if e <= s:
        raise ValueError("end_time 必须晚于 start_time")
    async with async_session_factory() as db:
        from sqlalchemy import select as _select
        rooms = (await db.execute(
            _select(mod.ConfRoom)
            .where(mod.ConfRoom.status == "AVAILABLE", mod.ConfRoom.capacity >= seats)
            .order_by(mod.ConfRoom.capacity)
        )).scalars().all()
        available = []
        for room in rooms:
            conflict = await mod.find_conflict(db, room.id, s, e)
            if conflict is None:
                available.append({
                    "room_id": str(room.id), "name": room.name, "capacity": room.capacity,
                    "location": room.location, "amenities": room.amenities or [],
                })
        return {"available_count": len(available), "rooms": available}


@MCP.tool()
async def meeting_query_schedule(date: str = "") -> dict:
    """查询某日全部会议室预订安排（date 格式 YYYY-MM-DD，留空为今天），返回各会议室时间线。"""
    _require_scope("conference:read")
    from app.routers import conference as mod
    async with async_session_factory() as db:
        res = await mod.schedule_board(date=date or None, p=await _system_principal(), db=db)
        return res["data"]


# -------- 访客 --------

@MCP.tool()
async def visitor_query_appointments(status: str = "", keyword: str = "", page_size: int = 10) -> dict:
    """查询访客预约记录（status: PENDING_HOST/PENDING_SECURITY/APPROVED/CHECKED_IN/CHECKED_OUT/OVERDUE_STAY；keyword 匹配姓名/单位）。"""
    _require_scope("visitor:read")
    from app.routers import visitor as mod
    async with async_session_factory() as db:
        res = await mod.list_appointments(
            status=status or None, keyword=keyword or None,
            pageNum=1, pageSize=max(1, min(int(page_size), 50)),
            p=await _system_principal(), db=db,
        )
        return {"total": res["total"], "appointments": res["rows"]}


@MCP.tool()
async def visitor_checkin(appointment_id: str, code: str = "", method: str = "QRCODE") -> dict:
    """访客到场核验入场（method: QRCODE 需提供通行码 code / FACE 人脸核验）。仅 APPROVED 状态可入场。"""
    _require_scope("visitor:write")
    from app.routers import visitor as mod
    async with async_session_factory() as db:
        res = await mod.checkin(appointment_id, {"method": method.upper(), "code": code},
                                p=await _system_principal(), db=db)
        await db.commit()
        return res["data"]


@MCP.tool()
async def visitor_checkout(appointment_id: str) -> dict:
    """访客离场核销签退（CHECKED_IN/OVERDUE_STAY 状态可核销，滞留记录一并销号）。"""
    _require_scope("visitor:write")
    from app.routers import visitor as mod
    async with async_session_factory() as db:
        res = await mod.checkout(appointment_id, p=await _system_principal(), db=db)
        await db.commit()
        return res["data"]


# -------- 公车 --------

@MCP.tool()
async def fleet_query_applications(status: str = "", keyword: str = "", page_size: int = 10) -> dict:
    """查询用车申请记录与审批状态（status: DEPT_PENDING/ADMIN_PENDING/APPROVED/DISPATCHED/COMPLETED/REJECTED）。"""
    _require_scope("fleet:read")
    from app.routers import fleet as mod
    async with async_session_factory() as db:
        res = await mod.list_applications(
            status=status or None, keyword=keyword or None,
            pageNum=1, pageSize=max(1, min(int(page_size), 50)),
            p=await _system_principal(), db=db,
        )
        return {"total": res["total"], "applications": res["rows"]}


# -------- 调研 --------

@MCP.tool()
async def research_log_issue(
    topic_id: str, issue_title: str, description: str,
    point_name: str = "", target_dept_id: str = "",
) -> dict:
    """调研现场登记问题台账（PRD 4.8：基层急难愁盼问题入账，明确初步承办部门）。"""
    _require_scope("research:write")
    from app.routers import research as mod
    async with async_session_factory() as db:
        p = await _system_principal()
        res = await mod.create_issue({
            "topic_id": topic_id, "issue_title": issue_title, "description": description,
            "point_name": point_name or None, "target_dept_id": target_dept_id or None,
        }, p=p, db=db)
        await db.commit()
        return res["data"]


@MCP.tool()
async def research_query_issues(topic_id: str = "", status: str = "", page_size: int = 10) -> dict:
    """查询调研问题台账（status: LOGGED 待整改/SUPERVISED 已转督办/RECTIFIED 已整改）。"""
    _require_scope("research:read")
    from app.routers import research as mod
    async with async_session_factory() as db:
        res = await mod.list_issues(
            topic_id=topic_id or None, status=status or None,
            pageNum=1, pageSize=max(1, min(int(page_size), 50)),
            p=await _system_principal(), db=db,
        )
        return {"total": res["total"], "issues": res["rows"]}


@MCP.tool()
async def research_query_topics(keyword: str = "", status: str = "", page_size: int = 10) -> dict:
    """查询调研课题列表（status: PLANNED/APPROVED/IN_PROGRESS/REPORT_REVIEW/COMPLETED；返回含撞期标记）。"""
    _require_scope("research:read")
    from app.routers import research as mod
    async with async_session_factory() as db:
        res = await mod.list_topics(
            keyword=keyword or None, status=status or None,
            pageNum=1, pageSize=max(1, min(int(page_size), 50)),
            p=await _system_principal(), db=db,
        )
        return {"total": res["total"], "topics": res["rows"]}


# -------- 知识 / 通讯 --------

@MCP.tool()
async def knowledge_get_doc_detail(doc_id: str) -> dict:
    """获取本地政策文件正文详情与元数据（source=local 的结果；GBrainKG 远程命中的证据片段已内联在检索结果 evidence 字段中）。"""
    _require_scope("knowledge:read")
    from app.routers import knowledge as mod
    async with async_session_factory() as db:
        res = await mod.get_document(doc_id, p=await _system_principal(), db=db)
        return res["data"]


@MCP.tool()
async def knowledge_gbrainkg_search(query: str, top_k: int = 8, kb_id: str = "") -> dict:
    """直连 GBrainKG 知识中枢（演示环境 50003）语义/混合检索：返回分片级命中（chunks）与按文档聚合视图（documents）。"""
    _require_scope("knowledge:read")
    from app.routers import knowledge as mod
    res = await mod.gbrainkg_search(q=query, top_k=top_k, kb_id=kb_id or None,
                                    p=await _system_principal())
    return res["data"]


@MCP.tool()
async def knowledge_gbrainkg_status() -> dict:
    """探测 GBrainKG 知识中枢接入状态：可达性/模式/知识库清单/各库文档数（不可达时平台自动回退本地知识库）。"""
    _require_scope("knowledge:read")
    from app.services import gbrainkg
    gbrainkg.invalidate_status_cache()
    return await gbrainkg.probe()


@MCP.tool()
async def contacts_search_experts(keyword: str = "", field_domain: str = "", level: str = "") -> dict:
    """查询专家人才库（keyword 匹配姓名/单位；level: NATIONAL 国家级/PROVINCIAL 省级/MUNICIPAL 市级），供评审专家推荐。"""
    _require_scope("contacts:read")
    from app.routers import contacts as mod
    async with async_session_factory() as db:
        res = await mod.list_experts(
            keyword=keyword or None, field_domain=field_domain or None, level=level or None,
            pageNum=1, pageSize=10, p=await _system_principal(), db=db,
        )
        return {"total": res["total"], "experts": res["rows"]}



# ================= 角色化补充工具 v1.3（管理层看板 / 个人中心 / 演示全量） =================

# -------- 门户（个人 + 管理层） --------

@MCP.tool()
async def portal_query_my_todos(category: str = "") -> dict:
    """查询我的跨模块待办（category 留空返回全部与分类计数：待审批/待执行/待反馈），含来源模块与处理入口。"""
    _require_scope("portal:read")
    from app.routers import portal as mod
    async with async_session_factory() as db:
        p = await _system_principal()
        res = await mod.portal_todos(p=p, db=db)
        data = res["data"]
        if category:
            key = {"待审批": "pending", "待执行": "executing", "待反馈": "feedback"}.get(category)
            items = data.get(key, []) if key else data["all"]
            return {"count": len(items), "todos": items}
        return data


@MCP.tool()
async def portal_query_notifications(only_unread: bool = False) -> dict:
    """查询我的消息通知（督办预警/访客提醒/系统公告等，可只看未读）。"""
    _require_scope("portal:read")
    from app.routers import portal as mod
    async with async_session_factory() as db:
        res = await mod.list_notifications(only_unread=only_unread, p=await _system_principal(), db=db)
        return res["data"]


@MCP.tool()
async def portal_query_overview() -> dict:
    """全局工作台总览（管理层视角）：待办/今日会议/重点督办/待处理预警 KPI、今日安排、重点工作进展。"""
    _require_scope("portal:read")
    from app.routers import portal as mod
    async with async_session_factory() as db:
        res = await mod.portal_overview(p=await _system_principal(), db=db)
        return res["data"]


@MCP.tool()
async def portal_query_calendar(month: str = "") -> dict:
    """查询协同日程（month 格式 YYYY-MM，留空为当月）：会议/调研/督办截止按日聚合。"""
    _require_scope("portal:read")
    from datetime import datetime as _dt
    from app.routers import portal as mod
    m = month or _dt.now(BUSINESS_TZ).strftime("%Y-%m")
    async with async_session_factory() as db:
        res = await mod.portal_calendar(month=m, p=await _system_principal(), db=db)
        return res["data"]


# -------- 考勤（个人 + 管理层） --------

@MCP.tool()
async def attendance_query_quotas(user_id: str = "") -> dict:
    """查询假期余额（user_id 留空返回全员；指定则返回该员工年假/病假/事假/调休余额）。"""
    _require_scope("attendance:read")
    from app.routers import attendance as mod
    async with async_session_factory() as db:
        res = await mod.list_quotas(p=await _system_principal(), db=db)
        rows = res["data"]
        if user_id:
            rows = [r for r in rows if r["user_id"] == user_id]
        return {"count": len(rows), "quotas": rows}


@MCP.tool()
async def attendance_query_my_applications(leave_status: str = "", trip_status: str = "", page_size: int = 10) -> dict:
    """查询请假/出差/补卡三类申请及审批状态（*_status: PENDING/APPROVED/REJECTED，留空为全部）。"""
    _require_scope("attendance:read")
    from app.routers import attendance as mod
    size = max(1, min(int(page_size), 50))
    async with async_session_factory() as db:
        p = await _system_principal()
        leaves = (await mod.list_leaves(audit_status=leave_status or None, pageNum=1, pageSize=size, p=p, db=db))["rows"]
        trips = (await mod.list_trips(audit_status=trip_status or None, pageNum=1, pageSize=size, p=p, db=db))["rows"]
        remedies = (await mod.list_remedies(audit_status=leave_status or None, pageNum=1, pageSize=size, p=p, db=db))["rows"]
        return {"leaves": leaves, "trips": trips, "remedies": remedies}


@MCP.tool()
async def attendance_query_monthly_stats(month: str = "") -> dict:
    """月度全员考勤汇总（管理层）：应出勤/实际出勤/迟到/早退/请假/出差天数（month 格式 YYYY-MM，留空当月）。"""
    _require_scope("attendance:read")
    from app.routers import attendance as mod
    async with async_session_factory() as db:
        res = await mod.monthly_settlement(month=month or None, p=await _system_principal(), db=db)
        return res["data"]


# -------- 督办（管理层） --------

@MCP.tool()
async def supervision_query_dashboard() -> dict:
    """督办指挥大屏统计（管理层）：总数/在办/按期办结率/红黄绿三色分布/承办部门排名。"""
    _require_scope("supervision:read")
    from app.routers import supervision as mod
    async with async_session_factory() as db:
        res = await mod.supervision_dashboard(p=await _system_principal(), db=db)
        return res["data"]


@MCP.tool()
async def supervision_get_task_detail(task_id: str) -> dict:
    """督办任务详情：里程碑、历史进展汇报、延期记录、销号材料（供领导深查）。"""
    _require_scope("supervision:read")
    from app.routers import supervision as mod
    async with async_session_factory() as db:
        res = await mod.get_task_detail(task_id, p=await _system_principal(), db=db)
        return res["data"]


@MCP.tool()
async def supervision_query_extensions(status: str = "", page_size: int = 10) -> dict:
    """查询延期申请（status: PENDING/APPROVED/REJECTED，PENDING 为待督查室审核）。"""
    _require_scope("supervision:read")
    from app.routers import supervision as mod
    async with async_session_factory() as db:
        res = await mod.list_extensions(
            status=status or None, pageNum=1, pageSize=max(1, min(int(page_size), 50)),
            p=await _system_principal(), db=db)
        return {"total": res["total"], "extensions": res["rows"]}


# -------- 资产（管理层 + 领用查询） --------

@MCP.tool()
async def assets_query_overview() -> dict:
    """资产全景统计（管理层）：资产总值/在用率/闲置率/待维修/本月折旧/耗材预警。"""
    _require_scope("assets:read")
    from app.routers import assets as mod
    async with async_session_factory() as db:
        res = await mod.assets_overview(p=await _system_principal(), db=db)
        return res["data"]


@MCP.tool()
async def assets_query_consumables(keyword: str = "", low_stock: bool = False, page_size: int = 10) -> dict:
    """查询耗材库存（keyword 匹配名称/编码；low_stock=true 只看低于安全库存，含补货建议）。"""
    _require_scope("assets:read")
    from app.routers import assets as mod
    async with async_session_factory() as db:
        res = await mod.list_consumables(
            keyword=keyword or None, low_stock="true" if low_stock else None,
            pageNum=1, pageSize=max(1, min(int(page_size), 50)),
            p=await _system_principal(), db=db)
        return {"total": res["total"], "items": res["rows"]}


# -------- 公车（管理层 + 调度） --------

@MCP.tool()
async def fleet_query_dashboard() -> dict:
    """车队运行统计（管理层）：编制总数/出车中/待命/维保/本月里程与油耗/预警数。"""
    _require_scope("fleet:read")
    from app.routers import fleet as mod
    async with async_session_factory() as db:
        res = await mod.fleet_dashboard(p=await _system_principal(), db=db)
        return res["data"]


@MCP.tool()
async def fleet_query_drivers(status: str = "", page_size: int = 10) -> dict:
    """查询驾驶员排班（status: ON_DUTY 在岗/DISPATCHED 出车/OFF_DUTY 休班）。"""
    _require_scope("fleet:read")
    from app.routers import fleet as mod
    async with async_session_factory() as db:
        res = await mod.list_drivers(
            status=status or None, pageNum=1, pageSize=max(1, min(int(page_size), 50)),
            p=await _system_principal(), db=db)
        return {"total": res["total"], "drivers": res["rows"]}


@MCP.tool()
async def fleet_query_maintenance_warnings() -> dict:
    """车辆维保/年审/保险临期预警（管理层关注，30 天内到期按剩余天数排序）。"""
    _require_scope("fleet:read")
    from app.routers import fleet as mod
    async with async_session_factory() as db:
        res = await mod.maintenance_warnings(p=await _system_principal(), db=db)
        return res["data"]


# -------- 访客（保卫处 + 管理层） --------

@MCP.tool()
async def visitor_query_dashboard() -> dict:
    """访客安全看板（保卫处/管理层）：今日预约/在院/离场/待审核/滞留告警明细。"""
    _require_scope("visitor:read")
    from app.routers import visitor as mod
    async with async_session_factory() as db:
        res = await mod.visitor_dashboard(p=await _system_principal(), db=db)
        return res["data"]


@MCP.tool()
async def visitor_query_blacklist(keyword: str = "", page_size: int = 10) -> dict:
    """查询安防黑名单（keyword 匹配姓名/单位），预约自动拦截依据。"""
    _require_scope("visitor:read")
    from app.routers import visitor as mod
    async with async_session_factory() as db:
        res = await mod.list_blacklist(
            keyword=keyword or None, pageNum=1, pageSize=max(1, min(int(page_size), 50)),
            p=await _system_principal(), db=db)
        return {"total": res["total"], "blacklist": res["rows"]}


# -------- 调研（管理层） --------

@MCP.tool()
async def research_query_dashboard() -> dict:
    """调研全景统计（管理层）：进行中调研组/覆盖点位/发现问题数/整改转化率/撞期命中。"""
    _require_scope("research:read")
    from app.routers import research as mod
    async with async_session_factory() as db:
        res = await mod.research_dashboard(p=await _system_principal(), db=db)
        return res["data"]


@MCP.tool()
async def research_query_reports(keyword: str = "", page_size: int = 10) -> dict:
    """查询已提交的调研报告（供成果查阅与评审跟踪）。"""
    _require_scope("research:read")
    from app.routers import research as mod
    async with async_session_factory() as db:
        res = await mod.list_reports(
            keyword=keyword or None, pageNum=1, pageSize=max(1, min(int(page_size), 50)),
            p=await _system_principal(), db=db)
        return {"total": res["total"], "reports": res["rows"]}


# -------- 系统（管理演示） --------

@MCP.tool()
async def system_query_users(keyword: str = "", dept_id: str = "", page_size: int = 10) -> dict:
    """查询平台用户（keyword 匹配账号/姓名；dept_id 过滤部门），含角色与岗位信息。"""
    _require_scope("system:read")
    from app.routers import system as mod
    async with async_session_factory() as db:
        res = await mod.list_users(
            keyword=keyword or None, dept_id=dept_id or None,
            pageNum=1, pageSize=max(1, min(int(page_size), 50)),
            p=await _system_principal(), db=db)
        return {"total": res["total"], "users": res["rows"]}


@MCP.tool()
async def system_query_logs(keyword: str = "", page_size: int = 10) -> dict:
    """查询操作审计日志（等保三级：谁在何时对什么模块做了什么，keyword 匹配模块/操作人）。"""
    _require_scope("system:read")
    from app.routers import system as mod
    async with async_session_factory() as db:
        res = await mod.list_logs(
            keyword=keyword or None, pageNum=1, pageSize=max(1, min(int(page_size), 50)),
            p=await _system_principal(), db=db)
        return {"total": res["total"], "logs": res["rows"]}



def build_mcp_apps():
    """Return (streamable_app, sse_app) wrapped with credential auth."""
    http_app = MCP.streamable_http_app(
        stateless_http=True, json_response=True,
        streamable_http_path="/mcp", host="0.0.0.0", transport_security=None,
    )
    sse_app = MCP.sse_app(sse_path="/sse", message_path="/messages/", host="0.0.0.0", transport_security=None)
    return MCPAuthMiddleware(http_app), MCPAuthMiddleware(sse_app)
