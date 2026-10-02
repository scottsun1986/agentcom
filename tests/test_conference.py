"""Conference closed-loop tests: 预订防冲突→统筹→参会人→排座→保障→纪要→转督办→访客联动."""

from datetime import datetime, timedelta

TOMORROW_9 = (datetime.now().replace(hour=9, minute=0, second=0, microsecond=0) + timedelta(days=50)).isoformat()
TOMORROW_11 = (datetime.now().replace(hour=11, minute=0, second=0, microsecond=0) + timedelta(days=50)).isoformat()


async def _room(client, headers, name="测试会议室", capacity=20):
    r = await client.post("/api/conference/rooms", headers=headers, json={
        "name": name, "capacity": capacity, "location": "测试楼1层", "amenities": ["投影"],
    })
    assert r.status_code == 200, r.text
    return r.json()["data"]


async def test_room_crud(client, admin_headers):
    room = await _room(client, admin_headers, "测试临时会议室A")
    rid = room["room_id"] if "room_id" in room else room["id"]
    r = await client.get(f"/api/conference/rooms?keyword=测试临时会议室A", headers=admin_headers)
    assert r.json()["rows"]


async def test_booking_and_conflict_detection(client, admin_headers, zhang_headers):
    room = await _room(client, admin_headers, "测试冲突会议室B")
    rid = room["room_id"] if "room_id" in room else room["id"]
    # first booking ok
    r = await client.post("/api/conference/bookings", headers=zhang_headers, json={
        "room_id": rid, "title": "闭环测试会议一", "start_time": TOMORROW_9, "end_time": TOMORROW_11,
        "attendee_count": 10,
    })
    assert r.status_code == 200, r.text
    # dry-run check reports conflict
    r2 = await client.post("/api/conference/bookings/check", headers=zhang_headers, json={
        "room_id": rid, "start_time": TOMORROW_9, "end_time": TOMORROW_11,
    })
    data = r2.json()["data"] if isinstance(r2.json().get("data"), dict) else r2.json()
    assert (data.get("conflict") is True) or (data.get("conflict_title") is not None) or data.get("has_conflict")
    # actual overlapping booking rejected
    r3 = await client.post("/api/conference/bookings", headers=zhang_headers, json={
        "room_id": rid, "title": "冲突会议", "start_time": TOMORROW_9, "end_time": TOMORROW_11,
        "attendee_count": 5,
    })
    assert r3.status_code == 400
    assert "被预订" in r3.json()["msg"]


async def test_affair_attendees_seating_checkin(client, admin_headers, zhang_headers):
    room = await _room(client, admin_headers, "测试排座会议室C")
    rid = room["room_id"] if "room_id" in room else room["id"]
    r = await client.post("/api/conference/bookings", headers=zhang_headers, json={
        "room_id": rid, "title": "闭环测试党组会", "start_time": TOMORROW_9, "end_time": TOMORROW_11,
        "attendee_count": 5,
    })
    bid = r.json()["data"]["id"] if "id" in r.json()["data"] else r.json()["data"]["booking_id"]
    r2 = await client.post("/api/conference/affairs", headers=zhang_headers, json={
        "booking_id": bid, "title": "闭环测试党组会", "meeting_type": "PARTY_COMMITTEE",
        "security_level": "NORMAL", "agenda_text": "一、测试议程",
    })
    assert r2.status_code == 200, r2.text
    aid = r2.json()["data"]["affair_id"] if "affair_id" in r2.json()["data"] else r2.json()["data"]["id"]
    for name, dept in [("张明", "综合办公室"), ("王磊", "信息技术部"), ("陈静", "行政管理部"), ("赵敏", "督查督办室"), ("李华", "综合办公室")]:
        r3 = await client.post("/api/conference/attendees", headers=zhang_headers, json={
            "affair_id": aid, "name": name, "dept_name": dept, "post_name": "处室正职",
        })
        assert r3.status_code == 200
    r4 = await client.post(f"/api/conference/seating/{aid}", headers=zhang_headers, json={"rule_type": "CENTER_FIRST"})
    assert r4.status_code == 200, r4.text
    seats = r4.json()["data"]
    assert isinstance(seats, (list, dict))
    r5 = await client.get(f"/api/conference/checkin/{aid}", headers=zhang_headers)
    stats = r5.json()["data"]
    assert stats is not None


async def test_service_tickets(client, admin_headers, zhang_headers):
    room = await _room(client, admin_headers, "测试保障会议室D")
    rid = room["room_id"] if "room_id" in room else room["id"]
    r = await client.post("/api/conference/bookings", headers=zhang_headers, json={
        "room_id": rid, "title": "保障测试会", "start_time": TOMORROW_9, "end_time": TOMORROW_11,
        "attendee_count": 8,
    })
    bid = r.json()["data"]["id"] if "id" in r.json()["data"] else r.json()["data"]["booking_id"]
    r2 = await client.post("/api/conference/services", headers=zhang_headers, json={
        "booking_id": bid, "service_type": "TEA", "notes": "矿泉水10瓶",
    })
    assert r2.status_code == 200
    ticket = r2.json()["data"]
    tid = ticket["ticket_id"] if "ticket_id" in ticket else ticket["id"]
    r3 = await client.post(f"/api/conference/services/{tid}/dispatch", headers=zhang_headers,
                           json={"assignee_name": "李华"})
    assert r3.status_code == 200
    r4 = await client.post(f"/api/conference/services/{tid}/complete", headers=zhang_headers, json={})
    assert r4.status_code == 200


async def test_minutes_action_to_supervision(client, admin_headers, zhang_headers):
    room = await _room(client, admin_headers, "测试纪要会议室E")
    rid = room["room_id"] if "room_id" in room else room["id"]
    r = await client.post("/api/conference/bookings", headers=zhang_headers, json={
        "room_id": rid, "title": "纪要测试会", "start_time": TOMORROW_9, "end_time": TOMORROW_11,
        "attendee_count": 6,
    })
    bid = r.json()["data"]["id"] if "id" in r.json()["data"] else r.json()["data"]["booking_id"]
    r2 = await client.post("/api/conference/minutes", headers=zhang_headers, json={
        "booking_id": bid, "content": "# 测试纪要\n1. 议定闭环测试事项",
    })
    assert r2.status_code == 200, r2.text
    minutes = r2.json()["data"]
    mid = minutes["id"] if "id" in minutes else minutes["minutes_id"]
    # update increments version
    r3 = await client.put(f"/api/conference/minutes/{mid}", headers=zhang_headers, json={"content": "# 修订版"})
    assert r3.status_code == 200
    ver = r3.json()["data"].get("version", 1)
    assert ver >= 2
    # add action item
    r4 = await client.post(f"/api/conference/minutes/{mid}/action-items", headers=zhang_headers, json={
        "task_description": "闭环测试议定事项", "assignee_name": "王磊",
    })
    assert r4.status_code == 200
    items = r4.json()["data"]
    item = items[-1] if isinstance(items, list) else items
    iid = item["id"] if "id" in item else item["item_id"]
    # convert to supervision
    r5 = await client.post(f"/api/conference/action-items/{iid}/to-supervision", headers=zhang_headers, json={
        "lead_dept_id": "00000000-0000-0000-0000-000000000030", "deadline": "2026-12-20",
    })
    assert r5.status_code == 200, r5.text
    data = r5.json()["data"]
    assert data.get("supervision_no", "").startswith("DB-") or data.get("task_id")


async def test_visitor_invitation_from_affair(client, admin_headers, zhang_headers):
    """跨模块闭环：会务统筹一键生成访客邀约（进入门禁访客审核流）。"""
    room = await _room(client, admin_headers, "测试邀约会议室F")
    rid = room["room_id"] if "room_id" in room else room["id"]
    r = await client.post("/api/conference/bookings", headers=zhang_headers, json={
        "room_id": rid, "title": "涉外研讨会", "start_time": TOMORROW_9, "end_time": TOMORROW_11,
        "attendee_count": 12,
    })
    bid = r.json()["data"]["id"] if "id" in r.json()["data"] else r.json()["data"]["booking_id"]
    r2 = await client.post("/api/conference/affairs", headers=zhang_headers, json={
        "booking_id": bid, "title": "涉外研讨会", "meeting_type": "EXTERNAL",
    })
    aid = r2.json()["data"]["affair_id"] if "affair_id" in r2.json()["data"] else r2.json()["data"]["id"]
    r3 = await client.post(f"/api/conference/affairs/{aid}/visitor-invitations", headers=zhang_headers, json={
        "visitors": [{"name": "测试专家", "phone": "13800001111", "company": "测试大学"}],
    })
    assert r3.status_code == 200, r3.text
    created = r3.json()["data"]
    assert isinstance(created, (list, dict))
    # appears in visitor appointments as PENDING_SECURITY
    r4 = await client.get("/api/visitor/appointments?status=PENDING_SECURITY", headers=admin_headers)
    rows = r4.json()["rows"]
    assert any(row["visitor_name"] == "测试专家" for row in rows)
