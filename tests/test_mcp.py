"""MCP protocol + tool tests.

Transport-level protocol (initialize / tools-list) is exercised over
streamable HTTP with agent credentials; tool business logic is exercised by
calling the tool functions directly (the transport itself is verified against
the live server)."""

import pytest

from tests.conftest import AGENT_CRED, jsonrpc

INIT_PARAMS = {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {"name": "pytest-agent", "version": "1.0"},
}

EXPECTED_TOOLS = {
    "attendance_clock_in", "attendance_query_status", "attendance_apply_leave", "attendance_audit_workflow",
    "assets_query_stock", "assets_create_requisition", "assets_stocktake_scan", "assets_low_stock_reminder",
    "supervision_create_item", "supervision_submit_progress", "supervision_trigger_auto_urging",
    "supervision_generate_briefing",
    "meeting_book_room", "meeting_generate_seating", "meeting_dispatch_service", "meeting_convert_to_supervision",
    "contacts_search_person", "contacts_get_org_tree", "contacts_query_external",
    "visitor_create_invitation", "visitor_audit_request", "visitor_query_active",
    "fleet_apply_car", "fleet_dispatch_trip", "fleet_return_trip", "fleet_query_available_cars",
    "research_register_plan", "research_check_conflicts", "research_push_to_supervision",
    "knowledge_search",
}


async def test_mcp_requires_credentials(client):
    r = await client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": INIT_PARAMS},
                          headers={"Accept": "application/json, text/event-stream"})
    assert r.status_code == 401


async def test_mcp_wrong_secret(client):
    r = await client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": INIT_PARAMS},
                          headers={"Authorization": "Bearer sk-00000000" + "f" * 40,
                                   "Accept": "application/json, text/event-stream"})
    assert r.status_code == 401


async def test_mcp_legacy_dual_headers_rejected(client):
    """标准单 Secret 模式：旧版 X-App-ID / X-App-Secret 双头不再受理。"""
    r = await client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": INIT_PARAMS},
                          headers={"X-App-ID": "agentcom-d3adb33f", "X-App-Secret": "whatever",
                                   "Accept": "application/json, text/event-stream"})
    assert r.status_code == 401


async def test_mcp_initialize_and_tools_list(client, mcp_ready):
    """Full transport handshake: initialize + tools/list over streamable HTTP."""
    from tests.conftest import mcp_session
    async with mcp_session(client):
        res = await jsonrpc(client, "initialize", INIT_PARAMS, id_=1)
        assert "result" in res
        assert res["result"]["serverInfo"]["name"] == "agentcom"
        res2 = await jsonrpc(client, "tools/list", {}, id_=2)
        tools = [t["name"] for t in res2["result"]["tools"]]
        assert len(tools) == 68, f"expected 68 tools, got {len(tools)}"
        assert EXPECTED_TOOLS <= set(tools), f"missing: {EXPECTED_TOOLS - set(tools)}"


# ---------------- tool function tests (direct invocation) ----------------

ZHANG_UID = "00000000-0000-0000-0000-000000000002"


async def test_tool_knowledge_search(client):
    from app.mcp.server import knowledge_search
    data = await knowledge_search(query="八项规定", top_k=2)
    items = data if isinstance(data, list) else data.get("results", [])
    assert items and "八项规定" in items[0]["title"] + (items[0].get("keywords") or "")


async def test_tool_visitor_query_active(client):
    from app.mcp.server import visitor_query_active
    data = await visitor_query_active()
    assert "stats" in data or "overdue" in str(data)


async def test_tool_supervision_auto_urging(client):
    from app.mcp.server import supervision_trigger_auto_urging
    data = await supervision_trigger_auto_urging()
    assert "urged" in data and data["urged"] >= 1


async def test_tool_attendance_query_status(client):
    from app.mcp.server import attendance_query_status
    data = await attendance_query_status(user_id=ZHANG_UID)
    assert "today" in data and "month" in data


async def test_tool_assets_low_stock(client):
    from app.mcp.server import assets_low_stock_reminder
    data = await assets_low_stock_reminder()
    assert data["count"] >= 1 and "alerts" in data


async def test_tool_fleet_available_cars(client):
    from datetime import datetime, timedelta
    from app.mcp.server import fleet_query_available_cars
    s = (datetime.now() + timedelta(days=70)).isoformat()
    e = (datetime.now() + timedelta(days=70, hours=2)).isoformat()
    data = await fleet_query_available_cars(start_time=s, end_time=e, seats=3)
    assert isinstance(data, dict)


async def test_tool_research_check_conflicts(client):
    """自建课题占位后检测同点位（动态未来日期），必须命中冲突。"""
    import uuid as _uuid
    from datetime import date, timedelta
    from app.mcp.server import research_check_conflicts, research_register_plan
    point = f"E2E撞期点位-{_uuid.uuid4().hex[:6]}"
    sd = str(date.today() + timedelta(days=15))
    ed = str(date.today() + timedelta(days=17))
    await research_register_plan(
        title="撞期检测占位课题", leader_name="张明",
        lead_dept_id="00000000-0000-0000-0000-000000000010",
        start_date=sd, end_date=ed, route_points=[point])
    data = await research_check_conflicts(route_points=[point], start_date=sd, end_date=ed)
    assert data["has_conflict"] is True


async def test_tool_assets_stocktake_scan(client):
    from app.mcp.server import assets_stocktake_scan
    from sqlalchemy import select
    from app.database import async_session_factory
    from app.models.assets import AstStocktakePlan
    async with async_session_factory() as db:
        plan = (await db.execute(select(AstStocktakePlan).limit(1))).scalars().first()
        pid = str(plan.plan_id)
    h = dict(AGENT_CRED)
    rows = (await client.get("/api/assets/ledger?status=IN_STOCK", headers=h)).json()["rows"]
    code = rows[0]["asset_code"]
    data = await assets_stocktake_scan(plan_id=pid, asset_code=code)
    assert isinstance(data, dict)


async def test_tool_supervision_create_and_briefing(client):
    from app.mcp.server import supervision_create_item, supervision_generate_briefing, supervision_submit_progress
    task = await supervision_create_item(
        source="LEADER_INSTRUCTION", title="MCP闭环测试督办",
        lead_dept_id="00000000-0000-0000-0000-000000000030",
        deadline="2026-12-25", priority="NORMAL", content="MCP 创建")
    assert task["supervision_no"].startswith("DB-")
    prog = await supervision_submit_progress(task_id=task["task_id"], progress_pct=20, details="MCP 汇报")
    assert prog is not None
    brief = await supervision_generate_briefing(period_type="MONTHLY")
    assert isinstance(brief, dict)


async def test_tool_meeting_dispatch_service(client):
    """会议保障派工工具：给种子 bookings 里的一场会派茶歇工单。"""
    from app.mcp.server import meeting_dispatch_service
    rows = (await client.get("/api/conference/bookings?pageNum=1&pageSize=1", headers=AGENT_CRED)).json()["rows"]
    bid = rows[0]["id"] if "id" in rows[0] else rows[0]["booking_id"]
    data = await meeting_dispatch_service(meeting_id=bid, service_items=["TEA"], notes="MCP 派工")
    assert data["count"] == 1


async def test_tool_contacts_search_and_tree(client):
    from app.mcp.server import contacts_search_person, contacts_get_org_tree
    res = await contacts_search_person(name_or_keyword="张明")
    assert res["total"] >= 1 and res["matches"][0]["nick_name"] == "张明"
    tree = await contacts_get_org_tree()
    assert tree and tree[0].get("children")


async def test_tool_visitor_create_invitation(client):
    from datetime import datetime, timedelta
    from app.mcp.server import visitor_create_invitation
    start = datetime.now() + timedelta(days=80)
    data = await visitor_create_invitation(
        visitor_name="MCP邀约访客", phone="13899990000",
        visit_date=start.isoformat(), purpose="MCP 邀约联调", duration_hours=2)
    assert data["status"] == "APPROVED" and data["access_code"]


async def test_scope_limited_credential_denied(client, admin_headers):
    """A credential with narrow scope cannot call other modules' tools."""
    r = await client.post("/api/system/apps", headers=admin_headers,
                          json={"app_name": "狭窄凭据2", "scopes": "knowledge:read"})
    data = r.json()["data"]
    try:
        from app.mcp import server as srv
        fake = type("C", (), {"scopes": "knowledge:read", "is_active": True, "app_name": "t"})()
        token = srv._current_agent.set(fake)
        try:
            from app.mcp.server import supervision_trigger_auto_urging
            with pytest.raises(PermissionError):
                await supervision_trigger_auto_urging()
        finally:
            srv._current_agent.reset(token)
    finally:
        await client.delete(f"/api/system/apps/{data['id']}", headers=admin_headers)


async def test_sse_endpoint_route_registered(client):
    """Legacy SSE route is registered and credential-guarded (non-streaming probe)."""
    r = await client.post("/sse", headers={**AGENT_CRED, "Accept": "application/json"},
                          json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
    assert r.status_code in (405, 406, 400, 200)  # route exists; method negotiation handled by transport


async def test_app_secret_rotation(client, admin_headers):
    """重置密钥：旧密钥立即失效，新密钥可调用，响应含完整 mcp_config（单 Bearer 头）。"""
    r = await client.post("/api/system/apps", headers=admin_headers,
                          json={"app_name": "轮换测试凭据", "scopes": "knowledge:read"})
    d = r.json()["data"]
    old_secret = d["app_secret"]
    assert old_secret.startswith("sk-")
    h = {"Authorization": f"Bearer {old_secret}"}
    ok1 = await client.get("/api/knowledge/documents", headers=h)
    assert ok1.status_code == 200
    r2 = await client.put(f"/api/system/apps/{d['id']}/rotate", headers=admin_headers)
    assert r2.status_code == 200
    nd = r2.json()["data"]
    assert nd["app_secret"] != old_secret
    assert "mcpServers" in nd["mcp_config"]
    assert "Authorization" in nd["mcp_config"]["mcpServers"]["agentcom"]["headers"]
    dead = await client.get("/api/knowledge/documents", headers=h)
    assert dead.status_code == 401
    new_h = {"Authorization": f"Bearer {nd['app_secret']}"}
    alive = await client.get("/api/knowledge/documents", headers=new_h)
    assert alive.status_code == 200
    await client.delete(f"/api/system/apps/{d['id']}", headers=admin_headers)
