"""Visitor closed-loop tests: 预约→两级审批→通行码→入场→出场/滞留."""

from datetime import datetime, timedelta


def _future(hours=48):
    s = datetime.now() + timedelta(hours=hours)
    return s.isoformat(), (s + timedelta(hours=2)).isoformat()


async def test_appointment_two_level_audit(client, zhang_headers, admin_headers, uid):
    start, end = _future()
    r = await client.post("/api/visitor/appointments", headers=zhang_headers, json={
        "visitor_name": "闭环访客甲", "visitor_phone": "13811112222",
        "company": "闭环科技公司", "visit_reason": "闭环测试来访",
        "host_user_id": await uid("张明"),
        "scheduled_start": start, "scheduled_end": end,
    })
    assert r.status_code == 200, r.text
    appt = r.json()["data"]
    aid = appt["appointment_id"]
    assert appt["status"] == "PENDING_HOST"
    assert appt["access_code"].startswith("AC")
    # host approves → PENDING_SECURITY
    r2 = await client.post(f"/api/visitor/appointments/{aid}/audit", headers=zhang_headers,
                           json={"action": "APPROVE"})
    assert r2.status_code == 200, r2.text
    # security approves → APPROVED (admin holds audit perm)
    r3 = await client.post(f"/api/visitor/appointments/{aid}/audit", headers=admin_headers,
                           json={"action": "APPROVE"})
    assert r3.status_code == 200, r3.text
    assert r3.json()["data"]["status"] == "APPROVED"


async def test_blacklist_blocks_reservation(client, zhang_headers, admin_headers, uid):
    r = await client.post("/api/visitor/blacklist", headers=admin_headers, json={
        "name": "黑名单测试人", "phone": "13922223333", "reason": "闭环测试拉黑",
    })
    assert r.status_code == 200
    start, end = _future(72)
    r2 = await client.post("/api/visitor/appointments", headers=zhang_headers, json={
        "visitor_name": "黑名单测试人", "visitor_phone": "13922223333",
        "visit_reason": "应当被拦截", "host_user_id": await uid("张明"),
        "scheduled_start": start, "scheduled_end": end,
    })
    assert r2.status_code == 403
    assert "黑名单" in r2.json()["msg"]


async def test_checkin_checkout_flow(client, admin_headers):
    # approve the seeded PENDING_SECURITY appointment (吴敏) then check in/out
    rows = (await client.get("/api/visitor/appointments?status=PENDING_SECURITY", headers=admin_headers)).json()["rows"]
    assert rows, "seed should contain a PENDING_SECURITY appointment"
    aid = rows[0]["appointment_id"]
    code = rows[0]["access_code"]
    r0 = await client.post(f"/api/visitor/appointments/{aid}/audit", headers=admin_headers, json={"action": "APPROVE"})
    assert r0.status_code == 200
    r = await client.post(f"/api/visitor/appointments/{aid}/checkin", headers=admin_headers,
                          json={"method": "QRCODE", "code": code})
    assert r.status_code == 200, r.text
    r2 = await client.post(f"/api/visitor/appointments/{aid}/checkout", headers=admin_headers)
    assert r2.status_code == 200
    assert r2.json()["data"]["status"] == "CHECKED_OUT"


async def test_invitation_direct_pass(client, zhang_headers):
    start, end = _future(96)
    r = await client.post("/api/visitor/invitations", headers=zhang_headers, json={
        "visitor_name": "邀约访客", "visitor_phone": "13833334444",
        "visit_reason": "技术交流", "scheduled_start": start, "scheduled_end": end,
    })
    assert r.status_code == 200, r.text
    data = r.json()["data"]
    assert data["status"] == "APPROVED"
    assert data["access_code"]


async def test_overdue_detection(client, admin_headers):
    r = await client.get("/api/visitor/dashboard", headers=admin_headers)
    data = r.json()["data"]
    assert "stats" in data or "overdue" in str(data)


async def test_access_rules_roundtrip(client, admin_headers):
    r = await client.get("/api/visitor/access-rules", headers=admin_headers)
    assert r.status_code == 200
    rules = r.json()["data"]
    rules["overdue_minutes"] = 30
    r2 = await client.put("/api/visitor/access-rules", headers=admin_headers, json=rules)
    assert r2.status_code == 200
