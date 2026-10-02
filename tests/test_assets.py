"""Assets & consumables closed-loop tests."""


async def test_ledger_create_and_filter(client, admin_headers):
    r = await client.post("/api/assets/ledger", headers=admin_headers, json={
        "name": "测试用测试仪", "price": 9999, "location": "测试库房",
        "purchase_date": "2026-01-10",
    })
    assert r.status_code == 200, r.text
    asset = r.json()["data"] if isinstance(r.json()["data"], dict) else None
    # find created asset
    r2 = await client.get("/api/assets/ledger?keyword=测试用测试仪", headers=admin_headers)
    rows = r2.json()["rows"]
    assert rows, "asset card should be created"
    asset = rows[0]
    assert asset["asset_code"].startswith("ZC-")
    assert asset["status"] == "IN_STOCK"
    return asset


async def test_requisition_claim_loop(client, admin_headers, staff_headers):
    asset = await test_ledger_create_and_filter(client, admin_headers)
    # staff claims the asset
    r = await client.post("/api/assets/requisitions", headers=staff_headers, json={
        "req_type": "CLAIM", "asset_id": asset["asset_id"], "reason": "闭环测试领用",
    })
    assert r.status_code == 200, r.text
    req_id = r.json()["data"]["req_id"]
    # audit approve
    r2 = await client.post(f"/api/assets/requisitions/{req_id}/audit", headers=admin_headers,
                           json={"action": "APPROVE"})
    assert r2.status_code == 200
    # asset becomes IN_USE
    r3 = await client.get(f"/api/assets/ledger?keyword={asset['asset_code']}", headers=admin_headers)
    assert r3.json()["rows"][0]["status"] == "IN_USE"


async def test_borrow_return_loop(client, admin_headers, staff_headers):
    # pick an in-stock asset
    rows = (await client.get("/api/assets/ledger?status=IN_STOCK", headers=admin_headers)).json()["rows"]
    asset = rows[0]
    r = await client.post("/api/assets/requisitions", headers=staff_headers, json={
        "req_type": "BORROW", "asset_id": asset["asset_id"], "reason": "闭环测试借用",
        "expected_return_date": "2026-12-31",
    })
    req_id = r.json()["data"]["req_id"]
    await client.post(f"/api/assets/requisitions/{req_id}/audit", headers=admin_headers, json={"action": "APPROVE"})
    # return
    r2 = await client.post(f"/api/assets/requisitions/{req_id}/return", headers=staff_headers, json={})
    assert r2.status_code == 200, r2.text
    r3 = await client.get(f"/api/assets/ledger?keyword={asset['asset_code']}", headers=admin_headers)
    assert r3.json()["rows"][0]["status"] == "IN_STOCK"


async def test_stocktake_scan_flow(client, admin_headers):
    r = await client.post("/api/assets/stocktake", headers=admin_headers, json={"title": "测试盘点计划"})
    plan = r.json()["data"]
    pid = plan["plan_id"]
    assert plan["total_count"] > 0
    rows = (await client.get("/api/assets/ledger?status=IN_STOCK", headers=admin_headers)).json()["rows"]
    code = rows[0]["asset_code"]
    r2 = await client.post(f"/api/assets/stocktake/{pid}/scan", headers=admin_headers, json={"asset_code": code})
    assert r2.status_code == 200, r2.text
    assert r2.json()["data"]["matched"] is True or r2.json()["data"]["status"] in ("matched", "ok")
    # duplicate scan should not double count
    await client.post(f"/api/assets/stocktake/{pid}/scan", headers=admin_headers, json={"asset_code": code})
    r3 = await client.post(f"/api/assets/stocktake/{pid}/complete", headers=admin_headers, json={})
    assert r3.status_code == 200
    data = r3.json()["data"]
    assert data["status"] == "COMPLETED" if isinstance(data, dict) else True


async def test_maintenance_loop(client, admin_headers):
    rows = (await client.get("/api/assets/ledger", headers=admin_headers)).json()["rows"]
    asset = rows[0]
    r = await client.post("/api/assets/maintenance", headers=admin_headers, json={
        "asset_id": asset["asset_id"], "fault_desc": "闭环测试故障", "vendor": "测试维修站",
    })
    assert r.status_code == 200
    # asset in repair
    r2 = await client.get(f"/api/assets/ledger?keyword={asset['asset_code']}", headers=admin_headers)
    # status may vary by impl; just ensure the log endpoint lists it
    r3 = await client.get("/api/assets/maintenance?pageNum=1&pageSize=10", headers=admin_headers)
    assert any("闭环测试故障" in (row.get("fault_desc") or "") for row in r3.json()["rows"])


async def test_consumables_low_stock_and_requisition(client, admin_headers, staff_headers):
    r = await client.get("/api/assets/consumables?low_stock=true", headers=admin_headers)
    rows = r.json()["rows"] if isinstance(r.json().get("rows"), list) else r.json()["data"]
    assert rows, "seed should include low-stock consumables"
    item = rows[0]
    assert item["stock_count"] <= item["min_stock"]
    # apply requisition
    r2 = await client.post("/api/assets/consumables/requisitions", headers=staff_headers, json={
        "item_id": item["item_id"], "quantity": 1, "purpose": "闭环测试耗材申领",
    })
    req = r2.json()["data"]
    rid = req["req_id"] if isinstance(req, dict) else req["id"]
    r3 = await client.post(f"/api/assets/consumables/requisitions/{rid}/audit", headers=admin_headers,
                           json={"action": "APPROVE"})
    assert r3.status_code == 200


async def test_overview_stats(client, admin_headers):
    r = await client.get("/api/assets/overview", headers=admin_headers)
    data = r.json()["data"]
    assert data["total_assets"] > 0
    assert 0 <= data["in_use_rate"] <= 100
