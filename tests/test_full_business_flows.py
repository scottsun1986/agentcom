import pytest
import uuid
from datetime import datetime, timedelta
from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest.mark.asyncio
async def test_full_business_closed_loops():
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        # 1. Login as admin
        login_res = await client.post("/api/auth/login", json={"username": "admin", "password": "admin123"})
        assert login_res.status_code == 200, f"Login failed: {login_res.text}"
        token = login_res.json()["data"]["token"]
        headers = {"Authorization": f"Bearer {token}"}

        # 2. Test Attendance Closed Loop:
        clock_res = await client.post("/api/attendance/clock", json={"punch_type": "FIELD", "location_gps": "30.27,120.15", "address": "大厦A座"}, headers=headers)
        assert clock_res.status_code in (200, 400)
        if clock_res.status_code == 400:
            assert "已打卡" in clock_res.json()["msg"]
        
        # 3. Test Conference to Supervision & Visitor Cross-Module Closed Loop:
        rooms_res = await client.get("/api/conference/rooms", headers=headers)
        assert rooms_res.status_code == 200
        room_list = rooms_res.json().get("data", []) or rooms_res.json().get("rows", [])
        assert len(room_list) > 0, "No rooms found"
        room_id = room_list[0]["id"]

        # Dynamic times
        delta_days = 70 + (uuid.uuid4().int % 500)
        dt_start = (datetime.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=delta_days, hours=9))
        dt_end = dt_start + timedelta(hours=2)

        booking_res = await client.post("/api/conference/bookings", json={
            "room_id": room_id,
            "title": f"闭环验证研讨会议-{uuid.uuid4().hex[:6]}",
            "start_time": dt_start.isoformat(),
            "end_time": dt_end.isoformat(),
            "attendee_count": min(room_list[0].get("capacity", 10), 4),
            "host_name": "王主任"
        }, headers=headers)
        assert booking_res.status_code == 200, f"Booking failed: {booking_res.text}"
        booking_id = booking_res.json()["data"]["id"]

        # Create Affair
        affair_res = await client.post("/api/conference/affairs", json={
            "booking_id": booking_id,
            "title": f"全域政企协同工作部署会议-{uuid.uuid4().hex[:6]}",
            "meeting_type": "EXECUTIVE",
            "security_level": "NORMAL",
            "agenda_text": "1. 推进督办落实; 2. 优化资产调配;"
        }, headers=headers)
        assert affair_res.status_code == 200
        affair_id = affair_res.json()["data"]["affair_id"]

        # Generate Visitor Invitations from Affair
        vis_invite_res = await client.post(f"/api/conference/affairs/{affair_id}/visitor-invitations", json={
            "visitors": [
                {"name": "张教授", "phone": "13800001111", "company": "清华大学自动化系"},
                {"name": "李博士", "phone": "13800002222", "company": "中科院软件所"}
            ]
        }, headers=headers)
        assert vis_invite_res.status_code == 200, f"Visitor invite failed: {vis_invite_res.text}"
        assert len(vis_invite_res.json()["data"]) == 2

        # Create Minutes and Action Item
        min_res = await client.post("/api/conference/minutes", json={
            "booking_id": booking_id,
            "content": "# 会议决议\n全员推进数字政企一体化建设。",
            "version": 1
        }, headers=headers)
        assert min_res.status_code == 200
        min_id = min_res.json()["data"]["id"]

        action_res = await client.post(f"/api/conference/minutes/{min_id}/action-items", json={
            "booking_id": booking_id,
            "task_description": f"全面完成基层治理系统上线并验收-{uuid.uuid4().hex[:6]}",
            "assignee_name": "信息化研发中心",
            "due_date": (datetime.now() + timedelta(days=90)).isoformat()
        }, headers=headers)
        assert action_res.status_code == 200
        action_id = action_res.json()["data"]["id"]

        # Convert Action Item directly to Supervision Task
        depts_res = await client.get("/api/system/depts", headers=headers)
        dept_id = depts_res.json()["data"][0]["dept_id"]

        to_sup_res = await client.post(f"/api/conference/action-items/{action_id}/to-supervision", json={
            "lead_dept_id": dept_id,
            "deadline": (datetime.now() + timedelta(days=90)).strftime("%Y-%m-%d"),
            "priority": "URGENT"
        }, headers=headers)
        assert to_sup_res.status_code == 200, f"To-supervision failed: {to_sup_res.text}"
        sup_task_id = to_sup_res.json()["data"]["task_id"]
        assert sup_task_id is not None

        # 4. Test Research Issue to Supervision Task Cross-Module Closed Loop:
        topic_res = await client.post("/api/research/topics", json={
            "title": f"优化营商环境实地专项调研-{uuid.uuid4().hex[:6]}",
            "field_domain": "优化营商环境",
            "leader_name": "王局长",
            "lead_dept_id": dept_id,
            "start_date": (datetime.now() + timedelta(days=10)).strftime("%Y-%m-%d"),
            "end_date": (datetime.now() + timedelta(days=12)).strftime("%Y-%m-%d"),
            "research_type": "SPECIAL",
            "points": [
                {"point_name": "高新区政务办事大厅", "scheduled_date": (datetime.now() + timedelta(days=10)).strftime("%Y-%m-%d")},
                {"point_name": "江北科技产业园", "scheduled_date": (datetime.now() + timedelta(days=11)).strftime("%Y-%m-%d")}
            ]
        }, headers=headers)
        assert topic_res.status_code == 200
        topic_id = topic_res.json()["data"]["topic_id"]

        issue_res = await client.post("/api/research/issues", json={
            "topic_id": topic_id,
            "point_name": "高新区政务办事大厅",
            "issue_title": "企业不动产登记跨区通办业务受理流程较慢",
            "description": "部分涉税联办窗口等待时间超40分钟，需优化系统对接。",
            "target_dept_id": dept_id
        }, headers=headers)
        assert issue_res.status_code == 200
        issue_id = issue_res.json()["data"]["issue_id"]

        # Convert Research Issue to Supervision Task
        issue_to_sup = await client.post(f"/api/research/issues/{issue_id}/to-supervision", json={
            "deadline": (datetime.now() + timedelta(days=40)).strftime("%Y-%m-%d"),
            "priority": "TOP"
        }, headers=headers)
        assert issue_to_sup.status_code == 200
        research_sup_id = issue_to_sup.json()["data"]["task_id"]
        assert research_sup_id is not None

        # 5. Test Fleet Full Lifecycle:
        cars_res = await client.get("/api/fleet/vehicles", headers=headers)
        assert cars_res.status_code == 200
        car_id = (cars_res.json().get("data") or cars_res.json().get("rows"))[0]["vehicle_id"]

        drivers_res = await client.get("/api/fleet/drivers", headers=headers)
        assert drivers_res.status_code == 200
        driver_id = (drivers_res.json().get("data") or drivers_res.json().get("rows"))[0]["driver_id"]

        fleet_app_res = await client.post("/api/fleet/applications", json={
            "purpose": "赴高新区重大科技成果对接交流公务出行",
            "trip_type": "OFFICIAL_BUSINESS",
            "origin": "机关大院",
            "destination": "高新技术产业园区",
            "passenger_count": 4,
            "leader_name": "李总监",
            "start_time": (datetime.now() + timedelta(days=5)).isoformat(),
            "end_time": (datetime.now() + timedelta(days=5, hours=8)).isoformat()
        }, headers=headers)
        assert fleet_app_res.status_code == 200
        flt_app_id = fleet_app_res.json()["data"]["app_id"]

        # Dept Audit
        dept_audit = await client.post(f"/api/fleet/applications/{flt_app_id}/audit", json={
            "step": "DEPT", "action": "APPROVE", "comment": "同意出车"
        }, headers=headers)
        assert dept_audit.status_code == 200

        # Admin Audit
        admin_audit = await client.post(f"/api/fleet/applications/{flt_app_id}/audit", json={
            "step": "ADMIN", "action": "APPROVE", "comment": "合规无误，准予派车"
        }, headers=headers)
        assert admin_audit.status_code == 200

        # Dispatch
        dispatch_res = await client.post(f"/api/fleet/applications/{flt_app_id}/dispatch", json={
            "vehicle_id": car_id,
            "driver_id": driver_id,
            "start_mileage": 12050.0
        }, headers=headers)
        assert dispatch_res.status_code == 200
        dispatch_id = dispatch_res.json()["data"]["dispatch_id"]

        # Return Trip & Settle
        return_res = await client.post(f"/api/fleet/dispatches/{dispatch_id}/return", json={
            "end_mileage": 12120.0,
            "toll_cost": 35.0,
            "fuel_cost": 0.0,
            "notes": "按时归队，车况完好，停放原车位"
        }, headers=headers)
        assert return_res.status_code == 200
        assert return_res.json()["data"]["status"] == "RETURNED"

        # 6. Test Visitor Full Lifecycle:
        user_info = await client.get("/api/auth/info", headers=headers)
        user_id = user_info.json()["data"]["user"]["user_id"]

        vis_app_res = await client.post("/api/visitor/appointments", json={
            "visitor_name": f"访客-{uuid.uuid4().hex[:4]}",
            "visitor_phone": "13912345678",
            "id_card_number": "330106199001011234",
            "company": "智慧物联技术有限公司",
            "visit_reason": "洽谈数据安全合作",
            "host_user_id": user_id,
            "scheduled_start": (datetime.now() + timedelta(days=2)).isoformat(),
            "scheduled_end": (datetime.now() + timedelta(days=2, hours=3)).isoformat()
        }, headers=headers)
        assert vis_app_res.status_code == 200
        appt_id = vis_app_res.json()["data"]["appointment_id"]

        # Host Audit
        host_audit = await client.post(f"/api/visitor/appointments/{appt_id}/audit", json={
            "step": "HOST", "action": "APPROVE"
        }, headers=headers)
        assert host_audit.status_code == 200

        # Security Audit
        sec_audit = await client.post(f"/api/visitor/appointments/{appt_id}/audit", json={
            "step": "SECURITY", "action": "APPROVE"
        }, headers=headers)
        assert sec_audit.status_code == 200

        # Check in
        checkin_res = await client.post(f"/api/visitor/appointments/{appt_id}/checkin", headers=headers)
        assert checkin_res.status_code == 200
        assert checkin_res.json()["data"]["status"] == "CHECKED_IN"

        # Check out
        checkout_res = await client.post(f"/api/visitor/appointments/{appt_id}/checkout", headers=headers)
        assert checkout_res.status_code == 200
        assert checkout_res.json()["data"]["status"] == "CHECKED_OUT"

        print("\nAll full business closed loops successfully verified!")
