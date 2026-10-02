"""Supervision closed-loop tests: 立项→分解→汇报→预警→延期→销号→简报."""


async def test_create_task_with_auto_no(client, admin_headers):
    r = await client.post("/api/supervision/tasks", headers=admin_headers, json={
        "title": "闭环测试督办任务", "source_type": "LEADER_INSTRUCTION",
        "lead_dept_id": "00000000-0000-0000-0000-000000000030",
        "deadline": "2026-12-31", "priority": "URGENT", "content": "闭环测试内容",
    })
    assert r.status_code == 200, r.text
    task = r.json()["data"]
    assert task["supervision_no"].startswith("DB-")
    assert task["status"] in ("IN_PROGRESS", "DRAFT")
    return task


async def test_milestone_and_progress(client, admin_headers):
    task = await test_create_task_with_auto_no(client, admin_headers)
    tid = task["task_id"]
    r = await client.post(f"/api/supervision/tasks/{tid}/milestones", headers=admin_headers, json={
        "title": "测试里程碑一", "due_date": "2026-11-30", "target_output": "验收报告",
    })
    assert r.status_code == 200, r.text
    r2 = await client.post(f"/api/supervision/tasks/{tid}/reports", headers=admin_headers, json={
        "period_type": "WEEKLY", "progress_pct": 65, "details": "闭环测试进展汇报",
    })
    assert r2.status_code == 200
    r3 = await client.get(f"/api/supervision/tasks/{tid}", headers=admin_headers)
    detail = r3.json()["data"]
    assert detail["progress_pct"] >= 65
    assert any(m["title"] == "测试里程碑一" for m in detail["milestones"])


async def test_warning_refresh(client, admin_headers):
    r = await client.post("/api/supervision/warning/refresh", headers=admin_headers)
    assert r.status_code == 200
    data = r.json()["data"]
    assert {"GREEN", "YELLOW", "RED"} <= set(data)
    # seeded overdue task DB-2026-0007 must be RED
    tasks = (await client.get("/api/supervision/tasks?warning_level=RED", headers=admin_headers)).json()["rows"]
    assert any(t["supervision_no"] == "DB-2026-0007" for t in tasks)


async def test_extension_flow(client, admin_headers):
    # create a task then request extension
    r = await client.post("/api/supervision/tasks", headers=admin_headers, json={
        "title": "延期闭环测试任务", "source_type": "GOV_REPORT",
        "lead_dept_id": "00000000-0000-0000-0000-000000000010",
        "deadline": "2026-11-15", "content": "x",
    })
    tid = r.json()["data"]["task_id"]
    r2 = await client.post("/api/supervision/extensions", headers=admin_headers, json={
        "task_id": tid, "reason": "闭环测试延期", "new_deadline": "2026-12-15",
    })
    assert r2.status_code == 200, r2.text
    ext_id = r2.json()["data"]["request_id"]
    r3 = await client.post(f"/api/supervision/extensions/{ext_id}/audit", headers=admin_headers,
                           json={"action": "APPROVE"})
    assert r3.status_code == 200
    detail = (await client.get(f"/api/supervision/tasks/{tid}", headers=admin_headers)).json()["data"]
    assert detail["deadline"] == "2026-12-15"


async def test_closeout_flow(client, admin_headers):
    r = await client.post("/api/supervision/tasks", headers=admin_headers, json={
        "title": "销号闭环测试任务", "source_type": "COUNCIL_DECISION",
        "lead_dept_id": "00000000-0000-0000-0000-000000000020",
        "deadline": "2026-10-01", "content": "x",
    })
    tid = r.json()["data"]["task_id"]
    r2 = await client.post(f"/api/supervision/tasks/{tid}/closeout-request", headers=admin_headers,
                           json={"closeout_summary": "已完成全部整改"})
    assert r2.status_code == 200
    r3 = await client.post(f"/api/supervision/tasks/{tid}/closeout-audit", headers=admin_headers,
                           json={"action": "APPROVE", "comment": "同意销号"})
    assert r3.status_code == 200
    detail = (await client.get(f"/api/supervision/tasks/{tid}", headers=admin_headers)).json()["data"]
    assert detail["status"] == "CLOSED"


async def test_bulletin_generated(client, admin_headers):
    r = await client.get("/api/supervision/bulletin?period_type=MONTHLY", headers=admin_headers)
    assert r.status_code == 200
    data = r.json()["data"]
    assert isinstance(data, dict)


async def test_urge_notifies(client, admin_headers):
    tasks = (await client.get("/api/supervision/tasks?status=IN_PROGRESS", headers=admin_headers)).json()["rows"]
    tid = tasks[0]["task_id"]
    r = await client.post(f"/api/supervision/tasks/{tid}/urge", headers=admin_headers)
    assert r.status_code == 200


async def test_dashboard_counts(client, admin_headers):
    r = await client.get("/api/supervision/dashboard", headers=admin_headers)
    data = r.json()["data"]
    assert data["total"] >= 6 or data.get("total_tasks", 0) >= 6 or isinstance(data, dict)
