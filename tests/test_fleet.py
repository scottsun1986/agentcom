"""Fleet closed-loop tests: 三级审批→派车→归队核销→油耗审计."""

from datetime import datetime, timedelta


async def test_vehicle_and_driver_crud(client, admin_headers):
    r = await client.post("/api/fleet/vehicles", headers=admin_headers, json={
        "plate_no": "测试A12345", "brand_model": "测试轿车 5座", "seat_count": 5,
        "quota_type": "GENERAL_OFFICIAL",
    })
    assert r.status_code == 200, r.text
    r2 = await client.post("/api/fleet/drivers", headers=admin_headers, json={
        "name": "测试司机", "phone": "13800000001", "license_type": "C1",
    })
    assert r2.status_code == 200


async def test_application_two_step_audit_and_dispatch(client, admin_headers, staff_headers, zhang_headers):
    r = await client.post("/api/fleet/applications", headers=staff_headers, json={
        "purpose": "闭环测试用车", "origin": "机关大院", "destination": "测试大厦",
        "passenger_count": 3,
        "start_time": (datetime.now() + timedelta(days=60)).isoformat(),
        "end_time": (datetime.now() + timedelta(days=60, hours=3)).isoformat(),
    })
    assert r.status_code == 200, r.text
    app = r.json()["data"]
    aid = app["app_id"] if "app_id" in app else app["id"]
    assert app["status"] == "DEPT_PENDING"
    # step 1: dept leader
    r2 = await client.post(f"/api/fleet/applications/{aid}/audit", headers=zhang_headers,
                           json={"action": "APPROVE", "step": "DEPT"})
    assert r2.status_code == 200, r2.text
    assert r2.json()["data"]["status"] == "ADMIN_PENDING"
    # step 2: fleet admin
    r3 = await client.post(f"/api/fleet/applications/{aid}/audit", headers=admin_headers,
                           json={"action": "APPROVE", "step": "ADMIN"})
    assert r3.json()["data"]["status"] == "APPROVED"
    # dispatch: pick an available vehicle & driver
    avail = (await client.get("/api/fleet/available", headers=admin_headers,
                              params={"start_time": (datetime.now() + timedelta(days=60)).isoformat(),
                                      "end_time": (datetime.now() + timedelta(days=60, hours=3)).isoformat(),
                                      "seats": 3})).json()["data"]
    vehicles = avail.get("vehicles") or avail.get("rows") or []
    drivers = avail.get("drivers") or []
    assert vehicles, "should have available vehicles"
    vid = vehicles[0]["vehicle_id"]
    did = drivers[0]["driver_id"] if drivers else (await client.get("/api/fleet/drivers", headers=admin_headers)).json()["rows"][0]["driver_id"]
    r4 = await client.post(f"/api/fleet/applications/{aid}/dispatch", headers=admin_headers,
                           json={"vehicle_id": vid, "driver_id": did})
    assert r4.status_code == 200, r4.text
    disp = r4.json()["data"]
    disp_id = disp["dispatch_id"] if "dispatch_id" in disp else disp["id"]
    # return
    r5 = await client.post(f"/api/fleet/dispatches/{disp_id}/return", headers=admin_headers, json={
        "end_mileage": 99999.0, "toll_cost": 20.0, "notes": "闭环测试归队",
    })
    assert r5.status_code == 200, r5.text
    # application completed
    rows = (await client.get("/api/fleet/applications?status=COMPLETED", headers=admin_headers)).json()["rows"]
    assert any((x["app_id"] if "app_id" in x else x["id"]) == aid for x in rows)


async def test_fuel_abnormal_detection(client, admin_headers):
    vehicles = (await client.get("/api/fleet/vehicles", headers=admin_headers)).json()["rows"]
    v = next(x for x in vehicles if x["status"] == "AVAILABLE")
    vid = v["vehicle_id"]
    r = await client.post("/api/fleet/fuel-logs", headers=admin_headers, json={
        "vehicle_id": vid, "fuel_date": "2026-10-01", "station": "外地某加油站",
        "liters": 50, "cost": 400, "mileage_at_fuel": 12345.0,
    })
    assert r.status_code == 200, r.text
    logs = (await client.get("/api/fleet/fuel-logs", headers=admin_headers)).json()["rows"]
    assert any(l.get("is_abnormal") for l in logs)


async def test_maintenance_warnings(client, admin_headers):
    r = await client.get("/api/fleet/maintenance/warnings", headers=admin_headers)
    assert r.status_code == 200
    data = r.json()["data"]
    assert isinstance(data, (list, dict))
    # seeded 红旗H9 insurance within 30 days / 帕萨特 inspection within 30 days
    items = data if isinstance(data, list) else data.get("warnings", [])
    assert len(items) >= 1


async def test_dashboard(client, admin_headers):
    r = await client.get("/api/fleet/dashboard", headers=admin_headers)
    data = r.json()["data"]
    assert data["vehicle_total"] >= 6
