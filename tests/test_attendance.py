"""Attendance closed-loop tests."""

from datetime import datetime, timedelta


async def test_clock_in_and_idempotency(client, staff_headers):
    r = await client.post("/api/attendance/clock", headers=staff_headers,
                          json={"punch_type": "FIELD", "address": "测试地点"})
    body = r.json()
    assert r.status_code == 200 and body["msg"] == "打卡成功"
    r2 = await client.post("/api/attendance/clock", headers=staff_headers, json={"punch_type": "FIELD"})
    assert r2.status_code == 400
    assert "重复" in r2.json()["msg"]


async def test_leave_apply_and_quota_deduction(client, staff_headers, admin_headers):
    # balance before
    q_before = (await client.get("/api/attendance/quotas", headers=admin_headers)).json()["data"]
    li_annual_before = next((q["total_days"] - q["used_days"]) for q in q_before
                            if q["user_name"] == "李华" and q["leave_type"] == "ANNUAL")
    # apply 1 day annual leave
    now = datetime.now()
    r = await client.post("/api/attendance/leaves", headers=staff_headers, json={
        "leave_type": "ANNUAL",
        "start_time": (now + timedelta(days=30)).isoformat(),
        "end_time": (now + timedelta(days=31)).isoformat(),
        "reason": "测试年假申请",
    })
    assert r.status_code == 200, r.text
    apply_id = r.json()["data"]["apply_id"]
    # audit approve by admin
    r2 = await client.post(f"/api/attendance/leaves/{apply_id}/audit", headers=admin_headers,
                           json={"action": "APPROVE", "comment": "同意"})
    assert r2.status_code == 200
    assert r2.json()["data"]["audit_status"] == "APPROVED"
    # balance after reduced by 1
    q_after = (await client.get("/api/attendance/quotas", headers=admin_headers)).json()["data"]
    li_annual_after = next((q["total_days"] - q["used_days"]) for q in q_after
                           if q["user_name"] == "李华" and q["leave_type"] == "ANNUAL")
    assert abs(li_annual_before - li_annual_after - 1.0) < 0.01


async def test_leave_insufficient_quota_rejected(client, staff_headers):
    r = await client.post("/api/attendance/leaves", headers=staff_headers, json={
        "leave_type": "ANNUAL",
        "start_time": datetime.now().isoformat(),
        "end_time": (datetime.now() + timedelta(days=90)).isoformat(),
        "reason": "超额申请应被拒绝",
    })
    assert r.status_code == 400
    assert "余额不足" in r.json()["msg"]


async def test_trip_approval_flow(client, staff_headers, admin_headers):
    r = await client.post("/api/attendance/trips", headers=staff_headers, json={
        "trip_type": "BUSINESS_TRIP", "destination": "测试市政务中心",
        "start_time": (datetime.now() + timedelta(days=40)).isoformat(),
        "end_time": (datetime.now() + timedelta(days=41)).isoformat(),
        "purpose": "闭环测试出差",
    })
    trip = r.json()["data"]
    assert trip["audit_status"] == "PENDING"
    rid = trip["trip_id"]
    r2 = await client.post(f"/api/attendance/trips/{rid}/audit", headers=admin_headers, json={"action": "APPROVE"})
    assert r2.json()["data"]["audit_status"] == "APPROVED"
    # double audit rejected
    r3 = await client.post(f"/api/attendance/trips/{rid}/audit", headers=admin_headers, json={"action": "APPROVE"})
    assert r3.status_code == 400


async def test_remedy_approval_creates_record(client, staff_headers, admin_headers):
    r = await client.post("/api/attendance/remedies", headers=staff_headers, json={
        "remedy_time": (datetime.now() - timedelta(days=2)).isoformat(),
        "punch_type": "FIELD", "reason": "闭环测试补卡",
    })
    rid = r.json()["data"]["remedy_id"]
    r2 = await client.post(f"/api/attendance/remedies/{rid}/audit", headers=admin_headers, json={"action": "APPROVE"})
    assert r2.status_code == 200
    # corrected record exists
    r3 = await client.get("/api/attendance/records?pageNum=1&pageSize=100", headers=staff_headers)
    assert any("补卡修正" in (rec["notes"] or "") for rec in r3.json()["rows"])


async def test_monthly_settlement(client, admin_headers):
    r = await client.get("/api/attendance/monthly-settlement", headers=admin_headers)
    data = r.json()["data"]
    assert data["rows"], "settlement should include users"
    row = next(x for x in data["rows"] if x["user_name"] == "李华")
    assert {"should_days", "actual_days", "late", "early", "leave_days", "trip_days"} <= set(row)


async def test_rules_roundtrip(client, admin_headers, staff_headers):
    r = await client.get("/api/attendance/rules", headers=staff_headers)
    assert r.status_code == 200
    rules = r.json()["data"]
    rules["work_start"] = "08:30"
    r2 = await client.put("/api/attendance/rules", headers=admin_headers, json=rules)
    assert r2.status_code == 200
    r3 = await client.get("/api/attendance/rules", headers=staff_headers)
    assert r3.json()["data"]["work_start"] == "08:30"
