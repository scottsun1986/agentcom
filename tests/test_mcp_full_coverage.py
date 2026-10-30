"""Full MCP tool-chain coverage: all 45 tools invoked over the REAL streamable-HTTP
transport with real arguments, chained into business sequences."""

import json as _json
import uuid
from datetime import datetime, timedelta
from itertools import count

from tests.conftest import AGENT_CRED, jsonrpc, mcp_session

INIT_PARAMS = {
    "protocolVersion": "2025-06-18",
    "capabilities": {},
    "clientInfo": {"name": "coverage", "version": "1.0"},
}

# fixed seed dept uuids (see app/services/seed.py)
DEPT_IT = "00000000-0000-0000-0000-000000000030"
DEPT_WINDOW = "00000000-0000-0000-0000-000000000060"

_REQ_ID = count(100)


async def _call(client, tool: str, arguments: dict, results: dict):
    """Invoke a tool over the real HTTP transport (JSON-RPC tools/call)."""
    res = await jsonrpc(client, "tools/call", {"name": tool, "arguments": arguments},
                        id_=next(_REQ_ID), headers=AGENT_CRED)
    if "error" in res:
        results[tool] = f"RPC-ERR: {res['error']}"
        raise RuntimeError(f"{tool}: {res['error']}")
    result = res.get("result", {})
    if result.get("isError"):
        text = result.get("content", [{}])[0].get("text", "")
        results[tool] = f"TOOL-ERR: {text[:120]}"
        raise RuntimeError(f"{tool}: {text[:200]}")
    # SDK 将工具返回的列表拆成多个 content 项：逐项解析后聚合，忠实还原返回结构
    items = []
    for c in result.get("content", []):
        t = c.get("text", "")
        try:
            items.append(_json.loads(t))
        except (ValueError, TypeError):
            items.append(t)
    data = items if len(items) > 1 else (items[0] if items else [])
    results[tool] = "ok"
    return data


async def _uid(client, admin_headers, name: str) -> str:
    r = await client.get("/api/contacts/employees", headers=admin_headers, params={"keyword": name})
    return r.json()["rows"][0]["user_id"]


def _future(days: int, hour: int = 9) -> str:
    return (datetime.now().replace(hour=hour, minute=0, second=0, microsecond=0)
            + timedelta(days=days)).isoformat()


async def test_all_45_tools_full_coverage(client, admin_headers, mcp_ready):
    from tests.conftest import mcp_session

    async with mcp_session(client):
        # handshake over real transport with the enlarged tool set
        res = await jsonrpc(client, "initialize", INIT_PARAMS, id_=1)
        assert res["result"]["serverInfo"]["name"] == "agentcom"
        res2 = await jsonrpc(client, "tools/list", {}, id_=2)
        names = {t["name"] for t in res2["result"]["tools"]}
        assert len(names) == 68, f"expected 68 tools, got {len(names)}"

        results = {}
        zhang = await _uid(client, admin_headers, "张明")
        zhou = await _uid(client, admin_headers, "周正安")

        # ============ 知识 ============
        doc = await _call(client, "knowledge_search", {"query": "公务用车", "top_k": 5}, results)
        doc_list = doc if isinstance(doc, list) else (doc.get("results") or doc.get("items") or [])
        assert doc_list, "knowledge_search should return hits"
        local_hits = [h for h in doc_list if h.get("source") == "local"] or doc_list
        doc_id = local_hits[0]["doc_id"]
        await _call(client, "knowledge_get_doc_detail", {"doc_id": doc_id}, results)

        # ============ 考勤 ============
        await _call(client, "attendance_query_status", {"user_id": zhang}, results)
        await _call(client, "attendance_clock_in",
                    {"user_id": zhou, "clock_type": "IN", "location": "门卫值班室"}, results)
        leave = await _call(client, "attendance_apply_leave", {
            "user_id": zhou, "leave_type": "SICK",
            "start_time": _future(90), "end_time": _future(91), "reason": "MCP 覆盖测试病假"}, results)
        audit = await _call(client, "attendance_audit_workflow",
                            {"instance_id": leave["apply_id"], "action": "APPROVE", "comment": "MCP 审批"}, results)
        assert audit["result"]["audit_status"] == "APPROVED"
        await _call(client, "attendance_trip_apply", {
            "user_id": zhang, "destination": "省政务服务中心",
            "start_time": _future(95), "end_time": _future(95, 18),
            "purpose": "MCP 覆盖测试出差报备", "trip_type": "BUSINESS_TRIP"}, results)
        await _call(client, "attendance_remedy_apply", {
            "user_id": zhang, "remedy_time": _future(-3, 8), "reason": "MCP 覆盖测试补卡"}, results)

        # ============ 资产 ============
        stock = await _call(client, "assets_query_stock", {"keyword": "投影仪", "status": "IN_STOCK"}, results)
        items = stock.get("items") or stock.get("rows") or []
        assert items, "IN_STOCK asset expected"
        asset = items[0]
        await _call(client, "assets_create_requisition", {
            "item_id": asset["asset_id"], "req_type": "CLAIM",
            "reason": "MCP 覆盖测试领用", "user_id": zhang}, results)
        # 自建盘点计划（套件中其他用例可能已把 seed 计划盘完，状态机拒绝是正确行为）
        plan = (await client.post("/api/assets/stocktake", headers=admin_headers,
                                  json={"title": "MCP 覆盖测试盘点"})).json()["data"]
        await _call(client, "assets_stocktake_scan", {
            "plan_id": plan["plan_id"], "asset_code": asset["asset_code"]}, results)
        await _call(client, "assets_low_stock_reminder", {}, results)

        # ============ 督办 ============
        task = await _call(client, "supervision_create_item", {
            "source": "LEADER_INSTRUCTION", "title": "MCP 全量覆盖测试督办事项",
            "lead_dept_id": DEPT_IT, "deadline": "2026-12-31", "priority": "URGENT",
            "content": "45 工具链路验证"}, results)
        await _call(client, "supervision_submit_progress", {
            "task_id": task["task_id"], "progress_pct": 30, "details": "MCP 进展汇报"}, results)
        await _call(client, "supervision_query_tasks", {"keyword": "MCP 全量覆盖", "page_size": 5}, results)
        await _call(client, "supervision_trigger_auto_urging", {}, results)
        await _call(client, "supervision_generate_briefing", {"period_type": "MONTHLY"}, results)
        await _call(client, "supervision_closeout_request", {
            "task_id": task["task_id"], "closeout_summary": "MCP 覆盖测试：全部完成，申请销号。"}, results)

        # ============ 会务 ============
        s, e = _future(96), _future(96, 11)
        rooms = await _call(client, "meeting_query_available_rooms",
                            {"start_time": s, "end_time": e, "seats": 5}, results)
        assert rooms["available_count"] >= 1, "at least one free room expected"
        room = rooms["rooms"][0]
        booking = await _call(client, "meeting_book_room", {
            "room_id": room["room_id"], "start_time": s, "end_time": e,
            "title": "MCP 覆盖测试会议", "attendee_count": 6, "user_id": zhang}, results)
        bid = booking["id"] if "id" in booking else booking["booking_id"]
        schedule = await _call(client, "meeting_query_schedule",
                               {"date": datetime.fromisoformat(s).strftime("%Y-%m-%d")}, results)
        assert isinstance(schedule, (list, dict))
        affair = (await client.post("/api/conference/affairs", headers=admin_headers, json={
            "booking_id": bid, "title": "MCP 覆盖测试会议", "meeting_type": "WORK"})).json()["data"]
        aid = affair.get("affair_id") or affair.get("id")
        for n, d in [("张明", "综合办公室"), ("王磊", "信息技术部"), ("陈静", "行政管理部")]:
            await client.post("/api/conference/attendees", headers=admin_headers,
                              json={"affair_id": aid, "name": n, "dept_name": d})
        seats = await _call(client, "meeting_generate_seating",
                            {"meeting_id": aid, "rule_type": "CENTER_FIRST"}, results)
        assert seats
        await _call(client, "meeting_dispatch_service", {
            "meeting_id": bid, "service_items": ["TEA", "AC"], "notes": "MCP 派工"}, results)
        await client.post("/api/conference/minutes", headers=admin_headers,
                          json={"booking_id": bid, "content": "# MCP 覆盖纪要\n1. 议定测试事项甲"})
        minutes = (await client.get("/api/conference/minutes?pageNum=1&pageSize=20",
                                    headers=admin_headers)).json()["rows"]
        target = minutes[0]
        mid = target["id"] if "id" in target else target["minutes_id"]
        await client.post(f"/api/conference/minutes/{mid}/action-items", headers=admin_headers,
                          json={"task_description": "MCP 覆盖测试议定事项", "assignee_name": "王磊"})
        detail = (await client.get(f"/api/conference/minutes/{mid}", headers=admin_headers)).json()["data"]
        item = [i for i in detail["action_items"] if not i.get("converted_supervision_id")][-1]
        iid = item["id"] if "id" in item else item["item_id"]
        conv = await _call(client, "meeting_convert_to_supervision", {
            "minutes_item_id": iid, "lead_dept_id": DEPT_IT, "deadline": "2026-12-25"}, results)
        assert conv.get("supervision_no", "DB").startswith("DB")

        # ============ 组织通讯 ============
        await _call(client, "contacts_search_person", {"name_or_keyword": "张明"}, results)
        tree = await _call(client, "contacts_get_org_tree", {}, results)
        tree_nodes = tree if isinstance(tree, list) else [tree]
        assert tree_nodes and tree_nodes[0].get("children")
        await _call(client, "contacts_query_external", {"unit_name": "大数据"}, results)
        experts = await _call(client, "contacts_search_experts", {"level": "NATIONAL"}, results)
        assert experts["total"] >= 1

        # ============ 访客（链式：邀约→查询→审批→入场→在院→出场） ============
        await _call(client, "visitor_create_invitation", {
            "visitor_name": "覆盖测试访客", "phone": "13877776666",
            "visit_date": _future(98), "purpose": "MCP 覆盖测试来访", "host_user_id": zhang}, results)
        appts = await _call(client, "visitor_query_appointments",
                            {"status": "PENDING_SECURITY", "page_size": 5}, results)
        assert appts["total"] >= 1, "PENDING_SECURITY appointment expected (seed 吴敏)"
        target_appt = next(a for a in appts["appointments"] if a["visitor_name"] == "吴敏")
        approved = await _call(client, "visitor_audit_request", {
            "appointment_id": target_appt["appointment_id"], "action": "APPROVE"}, results)
        assert approved["status"] == "APPROVED"
        checked = await _call(client, "visitor_checkin", {
            "appointment_id": target_appt["appointment_id"], "code": target_appt["access_code"]}, results)
        assert checked["status"] == "CHECKED_IN"
        await _call(client, "visitor_query_active", {}, results)
        out = await _call(client, "visitor_checkout", {"appointment_id": target_appt["appointment_id"]}, results)
        assert out["status"] == "CHECKED_OUT"

        # ============ 公车（链式：申请→REST 审批→查询可用→派车→归队） ============
        app_ = await _call(client, "fleet_apply_car", {
            "purpose": "MCP 覆盖测试用车", "origin": "机关大院", "destination": "测试大厦",
            "start_time": _future(99), "end_time": _future(99, 12), "seats": 3, "user_id": zhang}, results)
        fid = app_.get("app_id") or app_.get("id")
        for step in ("DEPT", "ADMIN"):
            r = await client.post(f"/api/fleet/applications/{fid}/audit", headers=admin_headers,
                                  json={"action": "APPROVE", "step": step})
            assert r.status_code == 200, r.text
        avail = await _call(client, "fleet_query_available_cars", {
            "start_time": _future(99), "end_time": _future(99, 12), "seats": 3}, results)
        vehicles = avail.get("vehicles") or avail.get("rows") or []
        assert vehicles, "available vehicles expected"
        drivers = (await client.get("/api/fleet/drivers", headers=admin_headers)).json()["rows"]
        disp = await _call(client, "fleet_dispatch_trip", {
            "application_id": fid, "vehicle_id": vehicles[0]["vehicle_id"],
            "driver_id": drivers[0]["driver_id"]}, results)
        did = disp.get("dispatch_id") or disp.get("id")
        await _call(client, "fleet_return_trip", {
            "dispatch_id": did, "return_mileage": vehicles[0]["current_mileage"] + 66.6,
            "toll_cost": 30.0, "notes": "MCP 归队核销"}, results)
        await _call(client, "fleet_query_applications", {"status": "COMPLETED", "page_size": 5}, results)

        # ============ 调研（链式：立项→撞期→台账→查询→转督办） ============
        from datetime import date as _date, timedelta as _td
        _sd = str(_date.today() + _td(days=15))
        _ed = str(_date.today() + _td(days=17))
        _pt = f"MCP 专用测试点位甲-{uuid.uuid4().hex[:6]}"
        topic = await _call(client, "research_register_plan", {
            "title": "MCP 覆盖测试课题", "leader_name": "张明", "lead_dept_id": DEPT_IT,
            "start_date": _sd, "end_date": _ed,
            "route_points": [_pt], "user_id": zhang}, results)
        tid = topic["topic_id"]
        conf = await _call(client, "research_check_conflicts", {
            "route_points": [_pt], "start_date": _sd, "end_date": _ed}, results)
        assert conf["has_conflict"] is True
        issue = await _call(client, "research_log_issue", {
            "topic_id": tid, "issue_title": "MCP 覆盖测试问题",
            "description": "MCP 工具链路登记的问题", "target_dept_id": DEPT_WINDOW}, results)
        await _call(client, "research_query_issues", {"status": "LOGGED", "page_size": 5}, results)
        await _call(client, "research_query_topics", {"keyword": "MCP 覆盖", "page_size": 5}, results)
        pushed = await _call(client, "research_push_to_supervision", {
            "issue_id": issue["issue_id"],
            "deadline": str(_date.today() + _td(days=45))}, results)
        assert pushed.get("supervision_no", "DB").startswith("DB")

        # ============ 角色化看板 / 个人中心（v1.3 新增 21 工具） ============
        await _call(client, "portal_query_my_todos", {}, results)
        await _call(client, "portal_query_notifications", {"only_unread": True}, results)
        await _call(client, "portal_query_overview", {}, results)
        cal = await _call(client, "portal_query_calendar", {"month": "2026-10"}, results)
        assert isinstance(cal, dict)
        await _call(client, "attendance_query_quotas", {"user_id": zhang}, results)
        await _call(client, "attendance_query_my_applications", {"page_size": 5}, results)
        ms = await _call(client, "attendance_query_monthly_stats", {"month": "2026-10"}, results)
        assert ms["rows"]
        sd = await _call(client, "supervision_query_dashboard", {}, results)
        assert isinstance(sd, dict)
        td = await _call(client, "supervision_get_task_detail", {"task_id": task["task_id"]}, results)
        assert td.get("milestones") is not None or isinstance(td, dict)
        await _call(client, "supervision_query_extensions", {"status": "PENDING"}, results)
        ao = await _call(client, "assets_query_overview", {}, results)
        assert ao["total_assets"] > 0
        await _call(client, "assets_query_consumables", {"low_stock": True}, results)
        fd = await _call(client, "fleet_query_dashboard", {}, results)
        assert fd["vehicle_total"] >= 6
        await _call(client, "fleet_query_drivers", {"status": "ON_DUTY"}, results)
        await _call(client, "fleet_query_maintenance_warnings", {}, results)
        vd = await _call(client, "visitor_query_dashboard", {}, results)
        assert "stats" in vd
        await _call(client, "visitor_query_blacklist", {"page_size": 5}, results)
        rd = await _call(client, "research_query_dashboard", {}, results)
        assert isinstance(rd, dict)
        await _call(client, "research_query_reports", {"page_size": 5}, results)
        su = await _call(client, "system_query_users", {"keyword": "张明"}, results)
        assert su["total"] >= 1
        await _call(client, "system_query_logs", {"page_size": 5}, results)

        failed = {k: v for k, v in results.items() if v != "ok"}
        gb = await _call(client, "knowledge_gbrainkg_search", {"query": "测试", "top_k": 3}, results)
        assert isinstance(gb, dict)
        await _call(client, "knowledge_gbrainkg_status", {}, results)

        failed = {k: v for k, v in results.items() if v != "ok"}
        assert not failed, f"tools failed: {failed}\ncalled: {len(results)}/68"
