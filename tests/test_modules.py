"""Research, contacts, knowledge, portal and system tests."""


async def test_topic_conflict_detection(client, admin_headers):
    """防撞期核心：自建两个课题占用同一点位与日期，后者必须命中冲突（动态未来日期，不依赖种子）。"""
    import uuid as _uuid
    from datetime import date, timedelta

    point = f"冲突检测点位-{_uuid.uuid4().hex[:6]}"
    d1 = str(date.today() + timedelta(days=15))
    d2 = str(date.today() + timedelta(days=16))
    r0 = await client.post("/api/research/topics", headers=admin_headers, json={
        "title": "冲突检测占位课题", "leader_name": "测试队长",
        "lead_dept_id": "00000000-0000-0000-0000-000000000010",
        "start_date": d1, "end_date": d2,
        "points": [{"point_name": point, "scheduled_date": d1}],
    })
    assert r0.status_code == 200, r0.text
    r = await client.post("/api/research/topics", headers=admin_headers, json={
        "title": "冲突检测测试课题", "leader_name": "测试队长",
        "lead_dept_id": "00000000-0000-0000-0000-000000000010",
        "start_date": d1, "end_date": d2,
        "points": [{"point_name": point, "scheduled_date": d1}],
    })
    assert r.status_code == 200, r.text
    topic = r.json()["data"]
    assert topic.get("has_conflict") is True


async def test_pure_conflict_check(client, admin_headers):
    """纯冲突检测：先占位点再检测同点位（动态未来日期）。"""
    import uuid as _uuid
    from datetime import date, timedelta

    point = f"纯冲突点位-{_uuid.uuid4().hex[:6]}"
    d1 = str(date.today() + timedelta(days=20))
    d3 = str(date.today() + timedelta(days=22))
    r0 = await client.post("/api/research/topics", headers=admin_headers, json={
        "title": "纯冲突占位课题", "leader_name": "测试队长",
        "lead_dept_id": "00000000-0000-0000-0000-000000000010",
        "start_date": d1, "end_date": d3,
        "points": [{"point_name": point, "scheduled_date": d1}],
    })
    assert r0.status_code == 200, r0.text
    r = await client.post("/api/research/check-conflicts", headers=admin_headers, json={
        "point_names": [point], "start_date": d1, "end_date": d3,
    })
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["has_conflict"] is True
    assert data["conflicts"][0]["topic_title"]


async def test_issue_to_supervision(client, admin_headers):
    # create topic + issue then convert
    r = await client.post("/api/research/topics", headers=admin_headers, json={
        "title": "问题转化测试课题", "leader_name": "测试队长",
        "lead_dept_id": "00000000-0000-0000-0000-000000000010",
        "start_date": "2026-11-01", "end_date": "2026-11-02",
        "points": [{"point_name": "问题转化测试点位", "scheduled_date": "2026-11-01"}],
    })
    topic = r.json()["data"]
    tid = topic["topic_id"]
    r2 = await client.post("/api/research/issues", headers=admin_headers, json={
        "topic_id": tid, "issue_title": "闭环测试问题", "description": "测试问题描述",
        "target_dept_id": "00000000-0000-0000-0000-000000000030",
    })
    issue = r2.json()["data"]
    iid = issue["issue_id"]
    r3 = await client.post(f"/api/research/issues/{iid}/to-supervision", headers=admin_headers,
                           json={"deadline": "2026-12-31"})
    assert r3.status_code == 200, r3.text
    assert r3.json()["data"].get("supervision_no", "").startswith("DB-")


async def test_topic_report_flow(client, admin_headers):
    topics = (await client.get("/api/research/topics", headers=admin_headers)).json()["rows"]
    t = topics[0]
    r = await client.post(f"/api/research/topics/{t['topic_id']}/report", headers=admin_headers,
                          json={"summary_report": "闭环测试调研报告"})
    assert r.status_code == 200


async def test_contacts_masking(client, admin_headers, staff_headers):
    """非领导(李华)：管理员可见完整号码，普通员工只能看到掩码。"""
    r_admin = await client.get("/api/contacts/employees?keyword=李华", headers=admin_headers)
    row_admin = r_admin.json()["rows"][0]
    assert row_admin["phonenumber"] and "****" not in row_admin["phonenumber"]
    r_staff = await client.get("/api/contacts/employees?keyword=李华", headers=staff_headers)
    rows = r_staff.json()["rows"]
    assert rows and rows[0].get("phonenumber")
    assert "****" in rows[0]["phonenumber"]


async def test_org_tree(client, staff_headers):
    r = await client.get("/api/contacts/org-tree", headers=staff_headers)
    assert r.status_code == 200
    tree = r.json()["data"]
    assert tree and tree[0]["children"]


async def test_partners_experts(client, admin_headers):
    r = await client.get("/api/contacts/partners", headers=admin_headers)
    assert len(r.json()["rows"]) >= 5
    r2 = await client.get("/api/contacts/experts", headers=admin_headers)
    assert len(r2.json()["rows"]) >= 5
    r3 = await client.post("/api/contacts/partners", headers=admin_headers, json={
        "unit_name": "测试外联单位", "partner_type": "GOV_PEER", "contact_name": "测试联系人",
        "phone": "0571-80000000",
    })
    assert r3.status_code == 200


async def test_sync_import(client, admin_headers):
    r = await client.post("/api/contacts/sync/import", headers=admin_headers, json={
        "rows": [{"user_name": "testimport1", "nick_name": "导入测试员", "dept_name": "综合办公室",
                  "phonenumber": "13866667777", "sex": "0"}],
    })
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data.get("created", 0) + data.get("updated", 0) >= 1


async def test_knowledge_search_and_graph(client, staff_headers):
    r = await client.get("/api/knowledge/search?q=公务用车&top_k=5", headers=staff_headers)
    assert r.status_code == 200
    data = r.json()["data"]
    items = data if isinstance(data, list) else data.get("results", [])
    assert items, "hybrid search should return hits"
    # 远程语义命中可排前，本地关键词命中必须存在
    assert any("公务用车" in ((h.get("title") or "") + (h.get("snippet") or "")) for h in items)
    r2 = await client.get("/api/knowledge/graph", headers=staff_headers)
    g = r2.json()["data"]
    assert g["nodes"] and g["edges"]


async def test_knowledge_documents(client, admin_headers):
    r = await client.get("/api/knowledge/documents?category=政策法规", headers=admin_headers)
    assert len(r.json()["rows"]) >= 3
    doc = r.json()["rows"][0]
    r2 = await client.get(f"/api/knowledge/documents/{doc['doc_id']}", headers=admin_headers)
    assert r2.status_code == 200


async def test_portal_overview_and_todos(client, zhang_headers):
    r = await client.get("/api/portal/overview", headers=zhang_headers)
    data = r.json()["data"]
    assert {"todos", "meetings", "supervision", "warnings"} <= set(data["kpi"])
    r2 = await client.get("/api/portal/todos", headers=zhang_headers)
    counts = r2.json()["data"]["counts"]
    assert counts["all"] >= 5


async def test_portal_calendar_and_notifications(client, zhang_headers):
    r = await client.get("/api/portal/calendar?month=2026-10", headers=zhang_headers)
    events = r.json()["data"]["events"]
    assert isinstance(events, list)
    r2 = await client.get("/api/portal/notifications", headers=zhang_headers)
    items = r2.json()["data"]["items"]
    assert items
    # mark read
    nid = items[0]["notice_id"]
    r3 = await client.post(f"/api/portal/notifications/{nid}/read", headers=zhang_headers)
    assert r3.status_code == 200


async def test_portal_assistant(client, zhang_headers):
    r = await client.post("/api/portal/assistant", headers=zhang_headers, json={"message": "查看督办预警"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert "督办" in data["reply"]
    assert data["actions"]


async def test_system_user_crud_and_role(client, admin_headers):
    r = await client.post("/api/system/users", headers=admin_headers, json={
        "user_name": "testsysuser", "nick_name": "系统测试员", "password": "Test@123",
    })
    assert r.status_code == 200
    uid = r.json()["data"]["user_id"]
    r2 = await client.put(f"/api/system/users/{uid}", headers=admin_headers, json={"status": "1"})
    assert r2.status_code == 200
    r3 = await client.delete(f"/api/system/users/{uid}", headers=admin_headers)
    assert r3.status_code == 200


async def test_system_roles_menus_dicts(client, admin_headers):
    r = await client.get("/api/system/roles", headers=admin_headers)
    roles = r.json()["rows"]
    assert {"admin", "dept_leader", "staff"} <= {x["role_key"] for x in roles}
    r2 = await client.get("/api/system/menus", headers=admin_headers)
    menus = r2.json()["data"]
    assert len(menus) >= 10
    r3 = await client.get("/api/system/dict/types", headers=admin_headers)
    assert r3.status_code == 200
    r4 = await client.get("/api/system/dict/data?dict_type=att_leave_type", headers=admin_headers)
    assert len(r4.json()["data"]) >= 4


async def test_system_apps_and_logs(client, admin_headers):
    from app.services.seed import DEMO_APP_ID
    r = await client.get("/api/system/apps", headers=admin_headers)
    assert any(x["app_id"] == DEMO_APP_ID for x in r.json()["data"])
    r2 = await client.get("/api/system/logs", headers=admin_headers)
    assert r2.status_code == 200
    r3 = await client.get("/api/system/configs", headers=admin_headers)
    assert len(r3.json()["data"]) >= 5


async def test_overtime_exchange_flow(client, staff_headers, admin_headers):
    """加班兑换闭环：工作日 20:30 下班打卡计入加班池 → 兑换 4 小时得 0.5 天调休 → COMP 额度入账。"""
    import uuid as _uuid
    from datetime import datetime, timedelta, timezone as _tz

    from app.config import BUSINESS_TZ
    from app.database import async_session_factory
    from app.models.attendance import AttClockRecord
    from app.models.system import SysUser
    from sqlalchemy import select

    r = await client.get("/api/contacts/employees", headers=admin_headers, params={"keyword": "李华"})
    uid = r.json()["rows"][0]["user_id"]

    async with async_session_factory() as db:
        user = (await db.execute(select(SysUser).where(SysUser.user_id == _uuid.UUID(uid)))).scalar_one()
        base = datetime.now(BUSINESS_TZ).replace(hour=20, minute=30, second=0, microsecond=0) - timedelta(days=7)
        inserted = 0
        for delta in range(0, 10):
            d = base - timedelta(days=delta)
            if d.weekday() >= 5:
                continue
            db.add(AttClockRecord(
                user_id=user.user_id, punch_type="OUT",
                punch_time=d.astimezone(_tz.utc),
            ))
            inserted += 1
            if inserted == 3:
                break
        await db.commit()

    s = await client.get("/api/attendance/overtime/summary", headers=staff_headers)
    assert s.status_code == 200, s.text
    data = s.json()["data"]
    assert data["accrued_hours"] >= 7.5, f"3 个工作日 20:30 下班应累计 7.5 小时, got {data['accrued_hours']}"
    assert data["available_hours"] == data["accrued_hours"]

    ex = await client.post("/api/attendance/overtime/exchange", headers=staff_headers,
                           json={"hours": 4, "note": "专项攻坚加班"})
    assert ex.status_code == 200, ex.text
    d = ex.json()["data"]
    assert d["days"] == 0.5
    assert d["available_hours"] == round(data["available_hours"] - 4, 1)

    s2 = await client.get("/api/attendance/overtime/summary", headers=staff_headers)
    d2 = s2.json()["data"]
    assert d2["exchanged_hours"] == 4 and d2["exchanged_days"] == 0.5
    assert d2["available_hours"] == d["available_hours"]

    # 超额兑换被拦截
    over = await client.post("/api/attendance/overtime/exchange", headers=staff_headers,
                             json={"hours": 9999})
    assert over.status_code == 400

    # 月度结算的加班时数为真实计算（非 0 占位）
    ms = await client.get("/api/attendance/monthly-settlement", headers=admin_headers)
    mine = [x for x in ms.json()["data"]["rows"] if x["user_id"] == uid]
    assert mine and mine[0]["overtime_hours"] > 0
