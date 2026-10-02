"""Auth, RBAC and data-scope tests."""


async def test_login_success(client):
    r = await client.post("/api/auth/login", json={"username": "zhangming", "password": "admin123"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["token"]
    assert data["user"]["nick_name"] == "张明"


async def test_login_wrong_password(client):
    r = await client.post("/api/auth/login", json={"username": "zhangming", "password": "bad"})
    assert r.status_code == 400
    assert "密码" in r.json()["msg"]


async def test_login_disabled_fields(client):
    r = await client.post("/api/auth/login", json={"username": "", "password": ""})
    assert r.status_code == 400


async def test_info_requires_token(client):
    r = await client.get("/api/auth/info")
    assert r.status_code == 401


async def test_info_and_routers(client, zhang_headers):
    r = await client.get("/api/auth/info", headers=zhang_headers)
    assert r.status_code == 200
    data = r.json()["data"]
    assert data["user"]["nick_name"] == "张明"
    assert "dept_leader" in data["roles"]
    assert data["data_scope"] == "4"
    r2 = await client.get("/api/auth/routers", headers=zhang_headers)
    menus = r2.json()["data"]["menus"]
    cats = {c["key"] for c in r2.json()["data"]["topCategories"]}
    assert len(menus) > 20
    assert {"PORTAL", "ATTENDANCE", "SUPERVISION"} <= cats


async def test_staff_routers_limited(client, staff_headers):
    r = await client.get("/api/auth/routers", headers=staff_headers)
    menus = r.json()["data"]["menus"]
    paths = {m["path"] for m in menus if m.get("path")}
    assert "/system/user" not in paths
    assert "/portal/overview" in paths


async def test_admin_sees_all(client, admin_headers):
    r = await client.get("/api/auth/info", headers=admin_headers)
    data = r.json()["data"]
    assert data["permissions"] == ["*:*:*"]


async def test_agent_credential_auth(client, agent_headers):
    r = await client.get("/api/supervision/tasks", headers=agent_headers)
    assert r.status_code == 200
    assert r.json()["code"] == 200


async def test_agent_credential_invalid(client):
    r = await client.get("/api/supervision/tasks", headers={"X-App-ID": "agentcom-demo", "X-App-Secret": "wrong"})
    assert r.status_code == 401


async def test_agent_scope_enforcement(client, admin_headers):
    """Create a narrow-scoped credential; it must be denied non-granted modules."""
    r = await client.post("/api/system/apps", json={"app_name": "只读考勤智能体", "scopes": "attendance:read"}, headers=admin_headers)
    assert r.status_code == 200
    data = r.json()["data"]
    app_id, secret = data["app_id"], data["app_secret"]
    try:
        h = {"X-App-ID": app_id, "X-App-Secret": secret}
        ok = await client.get("/api/attendance/records", headers=h)
        assert ok.status_code == 200
        denied = await client.get("/api/supervision/tasks", headers=h)
        assert denied.status_code == 403
    finally:
        await client.delete(f"/api/system/apps/{data['id']}", headers=admin_headers)


async def test_data_scope_self_only(client, staff_headers, zhang_headers):
    """李华 (仅本人) 只能看到自己的打卡记录。"""
    r = await client.get("/api/attendance/records?pageNum=1&pageSize=50", headers=staff_headers)
    rows = r.json()["rows"]
    assert rows, "staff should have own clock records"
    names = {row["user_name"] for row in rows}
    assert names == {"李华"}


async def test_dept_leader_sees_dept(client, zhang_headers):
    """张明 (本部门及以下) 能看到综合办公室及下属数据，多于仅本人。"""
    r = await client.get("/api/attendance/records?pageNum=1&pageSize=100", headers=zhang_headers)
    names = {row["user_name"] for row in r.json()["rows"]}
    assert "张明" in names
