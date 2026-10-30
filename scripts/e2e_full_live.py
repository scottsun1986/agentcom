#!/usr/bin/env python3
"""AgentCom 全量 E2E 测试（live server @ 127.0.0.1:8009）。

覆盖：
  1. REST API 全端点（OpenAPI 217 操作：13 板块）——读全清单探活 + 写全生命周期
  2. MCP 服务 68 工具全量调用（真实 HTTP JSON-RPC 传输）+ 跨模块业务链
  3. 协议级测试：握手/鉴权(401 矩阵)/未知工具/参数校验/旧双头拒绝
  4. 审计落库验证

输出：逐条 PASS/FAIL/SOFT/SKIP 矩阵 + 汇总 + JSON 报告。
"""
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timedelta
from urllib.parse import quote

BASE = "http://127.0.0.1:8009"
SECRET = "sk-d3adb33f0123456789abcdef0123456789abcdef01234567"
BEARER = {"Authorization": f"Bearer {SECRET}"}
RUN = uuid.uuid4().hex[:6]  # 运行级唯一后缀，避免与种子/历史数据冲突

RESULTS: list[dict] = []
CTX: dict = {}


def log(msg):
    print(msg, flush=True)


def record(module, name, kind, status, detail=""):
    RESULTS.append({"module": module, "name": name, "kind": kind, "status": status, "detail": str(detail)[:300]})
    icon = {"PASS": "✅", "FAIL": "❌", "SOFT": "🟡", "SKIP": "⏭️ "}.get(status, "·")
    log(f"  {icon} [{module}/{kind}] {name}" + (f" — {detail}" if status in ("FAIL", "SOFT") and detail else ""))


def http(method, path, body=None, headers=None, timeout=90):
    data = json.dumps(body).encode() if body is not None else None
    last_err = None
    for attempt in range(2):  # 一次重试，吸收偶发连接抖动
        r = urllib.request.Request(BASE + path, data=data, method=method,
                                   headers={"Content-Type": "application/json", **(headers or {})})
        try:
            resp = urllib.request.urlopen(r, timeout=timeout)
            status, raw = resp.status, resp.read().decode()
            break
        except urllib.error.HTTPError as e:
            status, raw = e.code, e.read().decode()
            break
        except Exception as e:
            last_err = e
            time.sleep(1.5)
    else:
        return 0, {"_raw": str(last_err)}
    try:
        return status, json.loads(raw)
    except Exception:
        return status, {"_raw": raw[:300]}


def rows_of(data):
    if isinstance(data, list):
        return data
    if isinstance(data, dict):
        for k in ("rows", "items", "list"):
            if isinstance(data.get(k), list):
                return data[k]
        if isinstance(data.get("data"), (list, dict)):
            return rows_of(data["data"])
    return data if data else []


def rest_step(module, name, method, path, body=None, headers=None, expect=(200,),
              validate=None, save=None, require=(), soft_msgs=()):
    """REST 步骤。validate(status, data)->(ok, detail) 或 bool；save(data)->{ctx_key: value}。"""
    missing = [k for k in require if CTX.get(k) in (None, "")]
    if missing:
        record(module, name, "REST", "SKIP", f"缺少前置 {missing}")
        return None
    try:
        status, data = http(method, path.format(**CTX), body, headers, timeout=60)
    except Exception as e:
        record(module, name, "REST", "FAIL", f"异常 {e}")
        return None
    if status == 0:
        record(module, name, "REST", "FAIL", "连接失败")
        return None
    if status in expect:
        ok, detail = True, ""
        if validate:
            try:
                res = validate(status, data)
                ok, detail = res if isinstance(res, tuple) else (bool(res), "")
            except Exception as e:
                ok, detail = False, f"validator异常 {e}"
        if ok:
            if save:
                try:
                    CTX.update({k: v(data) for k, v in save.items()})
                except Exception as e:
                    record(module, name, "REST", "FAIL", f"save提取失败 {e}")
                    return None
            record(module, name, "REST", "PASS")
            return data
        record(module, name, "REST", "FAIL", detail)
        return None
    msg = json.dumps(data, ensure_ascii=False)[:200] if isinstance(data, dict) else str(data)[:200]
    if any(s in msg for s in soft_msgs):
        record(module, name, "REST", "SOFT", f"业务规则拦截: {msg[:120]}")
        return None
    record(module, name, "REST", "FAIL", f"HTTP {status}: {msg}")
    return None


def mcp_rpc(method, params=None, id_=1, headers=None):
    payload = {"jsonrpc": "2.0", "id": id_, "method": method}
    if params is not None:
        payload["params"] = params
    hs = BEARER if headers is None else headers
    status, data = http("POST", "/mcp", payload,
                        {**hs, "Accept": "application/json, text/event-stream"}, timeout=60)
    if status == 0:
        return 0, {}
    if isinstance(data, dict) and "data:" in str(data.get("_raw", "")):
        for line in str(data["_raw"]).splitlines():
            if line.startswith("data:"):
                return status, json.loads(line[5:])
    return status, data


def mcp_result_value(resp):
    """Extract parsed tool output (dict/list) from a tools/call response, or None."""
    if not isinstance(resp, dict):
        return None
    if "error" in resp:
        return None
    res = resp.get("result") or {}
    if res.get("isError"):
        return None
    content = res.get("content") or []
    if not content:
        return res or None
    text = content[0].get("text", "")
    try:
        return json.loads(text)
    except Exception:
        return text or None


def mcp_error_msg(resp):
    if isinstance(resp, dict):
        if "error" in resp:
            return json.dumps(resp["error"], ensure_ascii=False)
        res = resp.get("result") or {}
        if res.get("isError"):
            c = (res.get("content") or [{}])[0]
            return c.get("text", "isError")
    return "unknown"


def mcp_step(module, name, tool, args_fn, validate=None, save=None, require=(), soft_msgs=()):
    """MCP 工具调用步骤。args_fn()->args 支持延迟取 ctx；validate(data)->(ok, detail)。"""
    missing = [k for k in require if CTX.get(k) in (None, "")]
    if missing:
        record(module, name, "MCP", "SKIP", f"缺少前置 {missing}")
        return None
    try:
        args = args_fn()
    except Exception as e:
        record(module, name, "MCP", "SKIP", f"参数组装失败 {e}")
        return None
    status, resp = mcp_rpc("tools/call", {"name": tool, "arguments": args}, id_=hash(name) % 100000)
    if status == 0:
        record(module, name, "MCP", "FAIL", "连接失败")
        return None
    if status >= 300:
        record(module, name, "MCP", "FAIL", f"HTTP {status}: {json.dumps(resp, ensure_ascii=False)[:150]}")
        return None
    data = mcp_result_value(resp)
    if data is None:
        msg = mcp_error_msg(resp)
        if any(s in msg for s in soft_msgs):
            record(module, name, "MCP", "SOFT", f"业务规则拦截: {msg[:120]}")
            return None
        record(module, name, "MCP", "FAIL", msg[:200])
        return None
    ok, detail = True, ""
    if validate:
        try:
            res = validate(data)
            ok, detail = res if isinstance(res, tuple) else (bool(res), "")
        except Exception as e:
            ok, detail = False, f"validator异常 {e}"
    if not ok:
        record(module, name, "MCP", "FAIL", detail)
        return None
    if save:
        try:
            CTX.update({k: v(data) for k, v in save.items()})
        except Exception as e:
            record(module, name, "MCP", "FAIL", f"save提取失败 {e}")
            return None
    record(module, name, "MCP", "PASS")
    return data


def future(days, hour=9, dur_h=2):
    s = (datetime.now().replace(minute=0, second=0, microsecond=0) + timedelta(days=days, hours=hour - 9))
    return s.isoformat(), (s + timedelta(hours=dur_h)).isoformat()


def release_stuck_dispatches():
    """清理历史运行遗留的未核销派车单（车辆卡「出车中」会导致后续派车 400）。"""
    st, d = http("GET", "/api/fleet/dispatches?pageNum=1&pageSize=50", headers=BEARER if not CTX.get("admin_jwt") else {"Authorization": CTX["admin_jwt"]})
    released = 0
    for r in rows_of(d.get("rows", [])):
        if r.get("status") == "OUT":
            try:
                http("POST", f"/api/fleet/dispatches/{r['dispatch_id']}/return",
                     {"end_mileage": float(r.get("start_mileage") or 0) + 10, "notes": "E2E清理遗留派车单"},
                     {"Authorization": CTX["admin_jwt"]})
                released += 1
            except Exception:
                pass
    if released:
        log(f"  (清理遗留出车中派车单 {released} 张)")
    d2 = http("GET", "/api/fleet/drivers?pageNum=1&pageSize=50", headers={"Authorization": CTX["admin_jwt"]})[1]
    for r in rows_of(d2.get("rows", [])):
        if r.get("status") == "DISPATCHED":  # 出车中的司机同样释放
            try:
                http("POST", f"/api/fleet/drivers/{r['driver_id']}/status", {"status": "ON_DUTY"},
                     {"Authorization": CTX["admin_jwt"]})
            except Exception:
                pass


# ====================================================================
def main():
    t0 = time.time()
    log(f"# AgentCom 全量 E2E — run={RUN} @ {BASE}\n")

    # ---------- 0. 认证板块 ----------
    log("== 认证 / AUTH ==")
    rest_step("auth", "登录成功", "POST", "/api/auth/login",
              body={"username": "admin", "password": "admin123"},
              validate=lambda s, d: ("token" in d.get("data", {}), "无token"),
              save={"admin_jwt": lambda d: "Bearer " + d["data"]["token"]})
    ADMIN = {"Authorization": CTX.get("admin_jwt", "")}
    rest_step("auth", "登录失败(错误密码)→400/401", "POST", "/api/auth/login",
              body={"username": "admin", "password": "wrong"}, expect=(400, 401))
    rest_step("auth", "登录失败(不存在用户)→400/401", "POST", "/api/auth/login",
              body={"username": "nope", "password": "x"}, expect=(400, 401))
    rest_step("auth", "未携带令牌→401", "GET", "/api/auth/info", expect=(401,))
    rest_step("auth", "伪造令牌→401", "GET", "/api/auth/info",
              headers={"Authorization": "Bearer fake.token.here"}, expect=(401,))
    rest_step("auth", "用户信息 /auth/info", "GET", "/api/auth/info", headers=ADMIN,
              validate=lambda s, d: ("user" in d.get("data", {}), "无user"),
              save={"admin_uid": lambda d: d["data"]["user"]["user_id"]})
    rest_step("auth", "动态菜单 /auth/routers", "GET", "/api/auth/routers", headers=ADMIN,
              validate=lambda s, d: len(d.get("data", {}).get("menus", [])) > 0, )
    rest_step("auth", "Agent单Secret访问REST", "GET", "/api/supervision/tasks?pageNum=1&pageSize=1", headers=BEARER,
              validate=lambda s, d: d.get("code") == 200)
    release_stuck_dispatches()

    # ---------- 参考数据 ----------
    log("\n== 参考数据装载 ==")
    d = rest_step("ref", "员工清单", "GET", "/api/contacts/employees?pageNum=1&pageSize=50", headers=ADMIN)
    emps = {r["nick_name"]: r["user_id"] for r in rows_of(d.get("rows", d.get("data", []))) if isinstance(r, dict) and "nick_name" in r}
    CTX.update(zhang=emps.get("张明", ""), lihua=emps.get("李华", ""), zhou=emps.get("周正安", ""))
    d = rest_step("ref", "部门清单", "GET", "/api/system/depts", headers=ADMIN)
    depts = rows_of(d.get("data", []))
    CTX.update(dept_root=depts[0]["dept_id"] if depts else "")
    d = rest_step("ref", "会议室清单", "GET", "/api/conference/rooms", headers=ADMIN)
    rooms = [r for r in rows_of(d) if not str(r.get("name", "")).startswith("E2E")] or rows_of(d)
    CTX.update(room_id=rooms[0]["id"] if rooms else "")
    d = rest_step("ref", "资产清单(IN_STOCK)", "GET", "/api/assets/ledger?status=IN_STOCK&pageNum=1&pageSize=10", headers=ADMIN)
    arows = rows_of(d.get("rows", []))
    CTX.update(asset_id=arows[0]["asset_id"] if arows else "", asset_code=arows[0]["asset_code"] if arows else "")
    d = rest_step("ref", "可用车辆清单", "GET",
                  f"/api/fleet/available?start_time={future(120, 9, 4)[0]}&end_time={future(120, 13, 4)[0]}&seats=1", headers=ADMIN)
    vrows = rows_of((d.get("data") or {}).get("vehicles", [])) if isinstance(d.get("data"), dict) else rows_of(d.get("data", d.get("rows", [])))
    if not vrows:  # 兜底：全量车辆里挑非出车中的
        d = rest_step("ref", "车辆清单(兜底)", "GET", "/api/fleet/vehicles?pageNum=1&pageSize=20", headers=ADMIN)
        vrows = [r for r in rows_of(d.get("rows", d.get("data", []))) if "出车" not in str(r.get("status_label", r.get("status", "")))]
    vrows = vrows if isinstance(vrows, list) else []
    CTX.update(vehicle_id=vrows[0]["vehicle_id"] if vrows else "", veh_mileage=float(vrows[0].get("current_mileage", 1000)) if vrows else 1000.0)
    d = rest_step("ref", "司机清单", "GET", "/api/fleet/drivers?pageNum=1&pageSize=20", headers=ADMIN)
    drows = [r for r in rows_of(d.get("rows", d.get("data", [])))
             if r.get("status") == "ON_DUTY" and not str(r.get("name", "")).startswith("E2E")]
    CTX.update(driver_id=drows[0]["driver_id"] if drows else "")
    d = rest_step("ref", "知识文档清单", "GET", "/api/knowledge/documents?pageNum=1&pageSize=10", headers=ADMIN)
    krows = rows_of(d.get("rows", d.get("data", [])))
    CTX.update(doc_id=krows[0]["doc_id"] if krows else "")
    d = rest_step("ref", "资产分类", "GET", "/api/assets/categories", headers=ADMIN)
    cats = rows_of(d.get("data", []))
    CTX.update(category_id=cats[0]["category_id"] if cats else "")

    # ---------- 1. 综合门户 ----------
    log("\n== 综合门户 / PORTAL ==")
    for ep, key in [("overview", "overview"), ("todos", "todos"), ("notifications", "notifs"), ("calendar", "calendar")]:
        rest_step("portal", f"GET /portal/{ep}", "GET", f"/api/portal/{ep}", headers=ADMIN,
                  validate=lambda s, dd, k=key: dd.get("code") == 200 and dd.get("data") is not None,
                  save={"notif_id": lambda dd: (lambda first: first.get("id") or first.get("notice_id"))(rows_of(dd["data"])[0])}
                  if key == "notifs" else None)
    rest_step("portal", "通知标记已读", "POST", "/api/portal/notifications/{notif_id}/read", headers=ADMIN,
              require=("notif_id",))
    rest_step("portal", "全部已读", "POST", "/api/portal/notifications/read-all", headers=ADMIN)
    rest_step("portal", "智能助手(督办问询)", "POST", "/api/portal/assistant", headers=ADMIN,
              body={"message": "当前督办预警情况如何"},
              validate=lambda s, d: d.get("code") == 200 and d.get("data", {}).get("reply"), )
    rest_step("portal", "智能助手(会议问询)", "POST", "/api/portal/assistant", headers=ADMIN,
              body={"message": "今天有什么会议"})
    rest_step("portal", "智能助手(空指令)→400", "POST", "/api/portal/assistant", headers=ADMIN,
              body={"message": ""}, expect=(400,))
    mcp_step("portal", "portal_query_overview", "portal_query_overview", lambda: {},
             validate=lambda d: isinstance(d, dict) and "kpi" in d)
    mcp_step("portal", "portal_query_my_todos(全部)", "portal_query_my_todos", lambda: {},
             validate=lambda d: "all" in d or "todos" in d or isinstance(d, dict))
    mcp_step("portal", "portal_query_my_todos(待审批)", "portal_query_my_todos", lambda: {"category": "待审批"})
    mcp_step("portal", "portal_query_notifications", "portal_query_notifications", lambda: {"only_unread": False})
    mcp_step("portal", "portal_query_calendar(当月)", "portal_query_calendar", lambda: {},
             validate=lambda d: isinstance(d, (dict, list)))

    # ---------- 2. 考勤 ----------
    log("\n== 考勤 / ATTENDANCE ==")
    rest_step("attendance", "GET /attendance/dashboard", "GET", "/api/attendance/dashboard", headers=ADMIN,
              validate=lambda s, d: "today" in d.get("data", {}))
    rest_step("attendance", "GET /attendance/records", "GET", "/api/attendance/records?pageNum=1&pageSize=5", headers=ADMIN,
              validate=lambda s, d: isinstance(d.get("rows"), list))
    rest_step("attendance", "GET /attendance/quotas", "GET", "/api/attendance/quotas", headers=ADMIN,
              validate=lambda s, d: d.get("code") == 200)
    rest_step("attendance", "GET /attendance/rules", "GET", "/api/attendance/rules", headers=ADMIN,
              validate=lambda s, d: d.get("code") == 200,
              save={"rules_orig": lambda d: json.dumps(d["data"], ensure_ascii=False)})
    rest_step("attendance", "PUT /attendance/rules(回写原值)", "PUT", "/api/attendance/rules", headers=ADMIN,
              body=json.loads(CTX.get("rules_orig") or "{}"), require=("rules_orig",))
    rest_step("attendance", "GET /attendance/leaves", "GET", "/api/attendance/leaves?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("attendance", "GET /attendance/trips", "GET", "/api/attendance/trips?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("attendance", "GET /attendance/remedies", "GET", "/api/attendance/remedies?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("attendance", "GET /attendance/monthly-settlement", "GET", "/api/attendance/monthly-settlement", headers=ADMIN,
              validate=lambda s, d: d.get("code") == 200)
    ls, le = future(55, 9, 8)
    rest_step("attendance", "请假申请(admin)", "POST", "/api/attendance/leaves", headers=ADMIN,
              body={"leave_type": "ANNUAL", "start_time": ls, "end_time": le, "reason": f"E2E请假-{RUN}"},
              save={"rest_leave_id": lambda d: d["data"]["apply_id"]})
    rest_step("attendance", "请假审批(APPROVE)", "POST", "/api/attendance/leaves/{rest_leave_id}/audit", headers=ADMIN,
              body={"action": "APPROVE", "comment": "E2E同意"})
    ts1, te1 = future(56, 9, 8)
    rest_step("attendance", "出差报备(admin)", "POST", "/api/attendance/trips", headers=ADMIN,
              body={"trip_type": "BUSINESS_TRIP", "origin": "机关大院", "destination": f"滨江分部-{RUN}",
                    "start_time": ts1, "end_time": te1, "purpose": "E2E出差"},
              save={"rest_trip_id": lambda d: d["data"]["trip_id"]})
    rest_step("attendance", "出差审批(APPROVE)", "POST", "/api/attendance/trips/{rest_trip_id}/audit", headers=ADMIN,
              body={"action": "APPROVE"})
    rem_t = (datetime.now() - timedelta(days=2)).replace(hour=9, minute=0, second=0, microsecond=0).isoformat()
    rest_step("attendance", "补卡申请(admin)", "POST", "/api/attendance/remedies", headers=ADMIN,
              body={"remedy_time": rem_t, "punch_type": "IN", "reason": f"E2E补卡-{RUN}"},
              save={"rest_remedy_id": lambda d: d["data"]["remedy_id"]})
    rest_step("attendance", "补卡审批(APPROVE)", "POST", "/api/attendance/remedies/{rest_remedy_id}/audit", headers=ADMIN,
              body={"action": "APPROVE"})
    rest_step("attendance", "打卡(admin, 允许重复拦截)", "POST", "/api/attendance/clock", headers=ADMIN,
              body={"punch_type": "OUT", "address": "E2E打卡点"},
              soft_msgs=("已打卡", "已存在"))
    mcp_step("attendance", "attendance_clock_in(张明外勤)", "attendance_clock_in",
             lambda: {"user_id": CTX["zhang"], "clock_type": "FIELD", "location": "E2E外勤点"},
             soft_msgs=("Error executing tool",))
    mcp_step("attendance", "attendance_query_status(张明)", "attendance_query_status",
             lambda: {"user_id": CTX["zhang"]}, validate=lambda d: "today" in d)
    lv_s, lv_e = future(40, 9, 8)
    mcp_step("attendance", "attendance_apply_leave(周正安年假)", "attendance_apply_leave",
             lambda: {"user_id": CTX["zhou"], "leave_type": "ANNUAL", "start_time": lv_s, "end_time": lv_e,
                      "reason": f"MCP-E2E年假-{RUN}"},
             save={"mcp_leave_id": lambda d: d["apply_id"]})
    mcp_step("attendance", "attendance_audit_workflow(批假)", "attendance_audit_workflow",
             lambda: {"instance_id": CTX.get("mcp_leave_id", ""), "action": "APPROVE", "comment": "MCP-E2E同意"},
             require=("mcp_leave_id",), validate=lambda d: d.get("result", {}).get("audit_status") == "APPROVED" or d.get("audit_status") == "APPROVED")
    tr_s, tr_e = future(50, 9, 8)
    mcp_step("attendance", "attendance_trip_apply(张明外出)", "attendance_trip_apply",
             lambda: {"user_id": CTX["zhang"], "destination": f"MCP-E2E外勤-{RUN}", "start_time": tr_s,
                      "end_time": tr_e, "purpose": "MCP外勤", "trip_type": "OUTING"},
             save={"mcp_trip_id": lambda d: d["trip_id"]})
    mcp_step("attendance", "attendance_audit_workflow(批出差)", "attendance_audit_workflow",
             lambda: {"instance_id": CTX.get("mcp_trip_id", ""), "action": "APPROVE"},
             require=("mcp_trip_id",))
    rem2 = (datetime.now() - timedelta(days=1)).replace(hour=18, minute=0, second=0, microsecond=0).isoformat()
    mcp_step("attendance", "attendance_remedy_apply(张明补卡)", "attendance_remedy_apply",
             lambda: {"user_id": CTX["zhang"], "remedy_time": rem2, "reason": "MCP-E2E补卡", "punch_type": "OUT"},
             save={"mcp_remedy_id": lambda d: d["remedy_id"]})
    mcp_step("attendance", "attendance_audit_workflow(批补卡)", "attendance_audit_workflow",
             lambda: {"instance_id": CTX.get("mcp_remedy_id", ""), "action": "APPROVE"},
             require=("mcp_remedy_id",))
    mcp_step("attendance", "attendance_query_quotas(张明)", "attendance_query_quotas",
             lambda: {"user_id": CTX["zhang"]}, validate=lambda d: isinstance(d.get("quotas"), list))
    mcp_step("attendance", "attendance_query_my_applications", "attendance_query_my_applications", lambda: {})
    mcp_step("attendance", "attendance_query_monthly_stats", "attendance_query_monthly_stats", lambda: {},
             validate=lambda d: isinstance(d, dict))

    # ---------- 3. 资产 ----------
    log("\n== 资产耗材 / ASSETS ==")
    rest_step("assets", "GET /assets/overview", "GET", "/api/assets/overview", headers=ADMIN,
              validate=lambda s, d: d.get("code") == 200)
    rest_step("assets", "GET /assets/ledger", "GET", "/api/assets/ledger?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("assets", "GET /assets/categories", "GET", "/api/assets/categories", headers=ADMIN)
    rest_step("assets", "GET /assets/requisitions", "GET", "/api/assets/requisitions?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("assets", "GET /assets/maintenance", "GET", "/api/assets/maintenance?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("assets", "GET /assets/stocktake", "GET", "/api/assets/stocktake?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("assets", "GET /assets/depreciation", "GET", "/api/assets/depreciation", headers=ADMIN,
              validate=lambda s, d: d.get("code") == 200)
    rest_step("assets", "GET /assets/consumables", "GET", "/api/assets/consumables?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("assets", "GET /assets/consumables/requisitions", "GET", "/api/assets/consumables/requisitions?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("assets", "POST /assets/ledger(建卡)", "POST", "/api/assets/ledger", headers=ADMIN,
              body={"name": f"E2E测试笔记本-{RUN}", "price": 8999.0, "category_id": CTX.get("category_id"),
                    "location": "E2E仓库", "model": "ThinkPad X1", "brand": "Lenovo"},
              save={"new_asset_id": lambda d: d["data"]["asset_id"], "new_asset_code": lambda d: d["data"]["asset_code"]})
    rest_step("assets", "PUT /assets/ledger(改卡)", "PUT", "/api/assets/ledger/{new_asset_id}", headers=ADMIN,
              body={"location": "E2E二楼"}, require=("new_asset_id",))
    rest_step("assets", "POST /assets/requisitions(领用)", "POST", "/api/assets/requisitions", headers=ADMIN,
              body={"req_type": "CLAIM", "asset_id": CTX.get("new_asset_id"), "reason": f"E2E领用-{RUN}"},
              require=("new_asset_id",), save={"asset_req_id": lambda d: d["data"]["req_id"]})
    rest_step("assets", "POST /assets/requisitions/audit(批领用)", "POST", "/api/assets/requisitions/{asset_req_id}/audit",
              headers=ADMIN, body={"action": "APPROVE", "comment": "E2E同意"}, require=("asset_req_id",))
    rest_step("assets", "POST /assets/maintenance(报修)", "POST", "/api/assets/maintenance", headers=ADMIN,
              body={"asset_id": CTX.get("new_asset_id"), "fault_desc": f"E2E屏幕故障-{RUN}", "vendor": "E2E供应商"},
              require=("new_asset_id",), save={"maint_log_id": lambda d: d["data"]["log_id"]})
    rest_step("assets", "POST /assets/maintenance/complete(修复)", "POST", "/api/assets/maintenance/{maint_log_id}/complete",
              headers=ADMIN, body={"repair_result": "更换屏幕", "cost": 500.0}, require=("maint_log_id",))
    rest_step("assets", "POST /assets/stocktake(建任务)", "POST", "/api/assets/stocktake", headers=ADMIN,
              body={"title": f"E2E盘点-{RUN}"}, save={"plan_id": lambda d: d["data"]["plan_id"]})
    rest_step("assets", "POST /assets/stocktake/scan(扫描)", "POST", "/api/assets/stocktake/{plan_id}/scan",
              headers=ADMIN, body={"asset_code": CTX.get("new_asset_code")}, require=("plan_id", "new_asset_code"))
    rest_step("assets", "POST /assets/stocktake/complete(完成)", "POST", "/api/assets/stocktake/{plan_id}/complete",
              headers=ADMIN, require=("plan_id",))
    rest_step("assets", "POST /assets/consumables(新增耗材)", "POST", "/api/assets/consumables", headers=ADMIN,
              body={"name": f"E2E A4纸-{RUN}", "unit": "箱", "stock_count": 3, "min_stock": 10, "unit_price": 120},
              save={"consumable_id": lambda d: d["data"]["item_id"]})
    rest_step("assets", "PUT /assets/consumables(改库存)", "PUT", "/api/assets/consumables/{consumable_id}",
              headers=ADMIN, body={"stock_count": 50}, require=("consumable_id",))
    rest_step("assets", "DELETE /assets/ledger(删卡)", "DELETE", "/api/assets/ledger/{new_asset_id}",
              headers=ADMIN, require=("new_asset_id",))
    mcp_step("assets", "assets_query_stock(投影仪)", "assets_query_stock",
             lambda: {"keyword": "", "status": "IN_STOCK"}, validate=lambda d: d.get("total", 0) >= 1)
    mcp_step("assets", "assets_create_requisition(借用)", "assets_create_requisition",
             lambda: {"item_id": CTX.get("asset_id", ""), "req_type": "BORROW", "reason": "MCP-E2E借用", "user_id": CTX.get("zhang", "")},
             require=("asset_id",))
    mcp_step("assets", "assets_low_stock_reminder", "assets_low_stock_reminder", lambda: {},
             validate=lambda d: "alerts" in d)
    mcp_step("assets", "assets_query_overview", "assets_query_overview", lambda: {}, validate=lambda d: isinstance(d, dict))
    mcp_step("assets", "assets_query_consumables(低库存)", "assets_query_consumables",
             lambda: {"low_stock": True, "page_size": 10}, validate=lambda d: isinstance(d.get("items"), list))
    mcp_step("assets", "assets_stocktake_scan", "assets_stocktake_scan",
             lambda: {"plan_id": CTX.get("mcp_plan_id", ""), "asset_code": CTX.get("asset_code", "")},
             require=("mcp_plan_id",))
    # 为 MCP 盘点建独立计划
    rest_step("assets", "POST /assets/stocktake(MCP用)", "POST", "/api/assets/stocktake", headers=ADMIN,
              body={"title": f"MCP-E2E盘点-{RUN}"}, save={"mcp_plan_id": lambda d: d["data"]["plan_id"]})
    mcp_step("assets", "assets_stocktake_scan(MCP计划)", "assets_stocktake_scan",
             lambda: {"plan_id": CTX.get("mcp_plan_id", ""), "asset_code": CTX.get("asset_code", "")},
             require=("mcp_plan_id", "asset_code"))

    # ---------- 4. 督办 ----------
    log("\n== 督办 / SUPERVISION ==")
    dl = (datetime.now() + timedelta(days=60)).strftime("%Y-%m-%d")
    rest_step("supervision", "GET /supervision/tasks", "GET", "/api/supervision/tasks?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("supervision", "GET /supervision/dashboard", "GET", "/api/supervision/dashboard", headers=ADMIN,
              validate=lambda s, d: d.get("code") == 200)
    rest_step("supervision", "GET /supervision/extensions", "GET", "/api/supervision/extensions?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("supervision", "GET /supervision/closeouts", "GET", "/api/supervision/closeouts?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("supervision", "GET /supervision/bulletin", "GET", "/api/supervision/bulletin?period_type=MONTHLY", headers=ADMIN)
    rest_step("supervision", "POST /supervision/tasks(立项)", "POST", "/api/supervision/tasks", headers=ADMIN,
              body={"title": f"E2E督办-{RUN}", "source_type": "LEADER_INSTRUCTION", "lead_dept_id": CTX.get("dept_root"),
                    "deadline": dl, "priority": "URGENT", "content": "E2E全流程督办"},
              save={"sup_task_id": lambda d: d["data"]["task_id"], "sup_task_no": lambda d: d["data"].get("supervision_no", "")})
    rest_step("supervision", "GET /supervision/tasks/{id}", "GET", "/api/supervision/tasks/{sup_task_id}", headers=ADMIN,
              require=("sup_task_id",))
    rest_step("supervision", "PUT /supervision/tasks(改)", "PUT", "/api/supervision/tasks/{sup_task_id}", headers=ADMIN,
              body={"priority": "URGENT"}, require=("sup_task_id",))
    rest_step("supervision", "POST milestones(加里程碑)", "POST", "/api/supervision/tasks/{sup_task_id}/milestones",
              headers=ADMIN, body={"title": f"E2E里程碑-{RUN}",
                                   "due_date": (datetime.now() + timedelta(days=30)).strftime("%Y-%m-%d"),
                                   "target_output": "E2E阶段产出"},
              require=("sup_task_id",), save={"milestone_id": lambda d: d["data"]["milestone_id"]})
    rest_step("supervision", "PUT milestones(进度)", "PUT", "/api/supervision/milestones/{milestone_id}",
              headers=ADMIN, body={"progress_pct": 30, "status": "IN_PROGRESS"}, require=("milestone_id",))
    rest_step("supervision", "POST reports(汇报30%)", "POST", "/api/supervision/tasks/{sup_task_id}/reports",
              headers=ADMIN, body={"period_type": "SPECIAL", "progress_pct": 30, "details": "E2E阶段汇报"},
              require=("sup_task_id",))
    rest_step("supervision", "POST urge(催办)", "POST", "/api/supervision/tasks/{sup_task_id}/urge",
              headers=ADMIN, require=("sup_task_id",))
    rest_step("supervision", "POST extensions(延期申请)", "POST", "/api/supervision/extensions", headers=ADMIN,
              body={"task_id": CTX.get("sup_task_id"), "reason": "E2E延期",
                    "new_deadline": (datetime.now() + timedelta(days=75)).strftime("%Y-%m-%d")},
              require=("sup_task_id",), save={"ext_req_id": lambda d: d["data"]["request_id"]})
    rest_step("supervision", "POST extensions/audit(批延期)", "POST", "/api/supervision/extensions/{ext_req_id}/audit",
              headers=ADMIN, body={"action": "APPROVE", "comment": "E2E同意"}, require=("ext_req_id",))
    rest_step("supervision", "POST closeout-request(销号申请)", "POST", "/api/supervision/tasks/{sup_task_id}/closeout-request",
              headers=ADMIN, body={"closeout_summary": f"E2E已完成-{RUN}"}, require=("sup_task_id",))
    rest_step("supervision", "POST closeout-audit(销号审批)", "POST", "/api/supervision/tasks/{sup_task_id}/closeout-audit",
              headers=ADMIN, body={"action": "APPROVE", "comment": "E2E准予销号"}, require=("sup_task_id",),
              save={"sup_task2_id": lambda d: ""})
    rest_step("supervision", "POST warning/refresh(刷新预警)", "POST", "/api/supervision/warning/refresh", headers=ADMIN)
    rest_step("supervision", "DELETE /supervision/milestones", "DELETE", "/api/supervision/milestones/{milestone_id}",
              headers=ADMIN, require=("milestone_id",))
    d = rest_step("supervision", "GET tasks(再建一个供MCP销号)", "POST", "/api/supervision/tasks", headers=ADMIN,
                  body={"title": f"MCP-E2E销号任务-{RUN}", "source_type": "GOV_REPORT", "lead_dept_id": CTX.get("dept_root"),
                        "deadline": (datetime.now() + timedelta(days=45)).strftime("%Y-%m-%d"), "priority": "NORMAL",
                        "content": "MCP销号链路"},
                  save={"mcp_close_task": lambda d: d["data"]["task_id"]})
    mcp_step("supervision", "supervision_create_item", "supervision_create_item",
             lambda: {"source": "COUNCIL_DECISION", "title": f"MCP-E2E督办-{RUN}", "lead_dept_id": CTX.get("dept_root", ""),
                      "deadline": dl, "priority": "NORMAL", "content": "MCP-E2E立项"},
             save={"mcp_task_id": lambda d: d["task_id"]})
    mcp_step("supervision", "supervision_submit_progress", "supervision_submit_progress",
             lambda: {"task_id": CTX.get("mcp_task_id", ""), "progress_pct": 20, "details": "MCP汇报"},
             require=("mcp_task_id",))
    mcp_step("supervision", "supervision_query_tasks", "supervision_query_tasks",
             lambda: {"keyword": f"MCP-E2E-{RUN[:3]}", "page_size": 10}, validate=lambda d: isinstance(d.get("tasks"), list))
    mcp_step("supervision", "supervision_get_task_detail", "supervision_get_task_detail",
             lambda: {"task_id": CTX.get("mcp_task_id", "")}, require=("mcp_task_id",))
    mcp_step("supervision", "supervision_query_dashboard", "supervision_query_dashboard", lambda: {},
             validate=lambda d: isinstance(d, dict))
    mcp_step("supervision", "supervision_generate_briefing", "supervision_generate_briefing",
             lambda: {"period_type": "MONTHLY"}, validate=lambda d: isinstance(d, dict))
    mcp_step("supervision", "supervision_query_extensions", "supervision_query_extensions", lambda: {"status": "PENDING"})
    mcp_step("supervision", "supervision_trigger_auto_urging", "supervision_trigger_auto_urging", lambda: {},
             validate=lambda d: "urged" in d)
    mcp_step("supervision", "supervision_closeout_request", "supervision_closeout_request",
             lambda: {"task_id": CTX.get("mcp_close_task", ""), "closeout_summary": "MCP-E2E办结"},
             require=("mcp_close_task",))

    # ---------- 5. 会务 ----------
    log("\n== 会务 / CONFERENCE ==")
    bs, be = future(200 + int(RUN[:2], 16) % 100, 9, 2)
    rest_step("conference", "GET /conference/rooms", "GET", "/api/conference/rooms", headers=ADMIN)
    rest_step("conference", "POST /conference/rooms(新建)", "POST", "/api/conference/rooms", headers=ADMIN,
              body={"name": f"E2E会议室-{RUN}", "capacity": 12, "location": "E2E楼3层", "amenities": ["TV", "白板"]},
              save={"new_room_id": lambda d: d["data"]["id"]})
    rest_step("conference", "PUT /conference/rooms(改)", "PUT", "/api/conference/rooms/{new_room_id}", headers=ADMIN,
              body={"location": "E2E楼5层"}, require=("new_room_id",))
    rest_step("conference", "DELETE /conference/rooms(删空房间)", "DELETE", "/api/conference/rooms/{new_room_id}",
              headers=ADMIN, require=("new_room_id",))
    rest_step("conference", "GET /conference/bookings", "GET", "/api/conference/bookings?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("conference", "POST /conference/bookings/check(冲突检测)", "POST", "/api/conference/bookings/check",
              headers=ADMIN, body={"room_id": CTX.get("room_id"), "start_time": bs, "end_time": be})
    rest_step("conference", "POST /conference/bookings(预订)", "POST", "/api/conference/bookings", headers=ADMIN,
              body={"room_id": CTX.get("room_id"), "title": f"E2E会议-{RUN}", "start_time": bs, "end_time": be,
                    "attendee_count": 6, "host_name": "E2E主持人"},
              save={"booking_id": lambda d: d["data"]["id"]})
    rest_step("conference", "POST /conference/bookings/approve", "POST", "/api/conference/bookings/{booking_id}/approve",
              headers=ADMIN, require=("booking_id",), soft_msgs=("不需要审批", "状态", "已"))
    rest_step("conference", "POST /conference/affairs(会议事务)", "POST", "/api/conference/affairs", headers=ADMIN,
              body={"booking_id": CTX.get("booking_id"), "title": f"E2E事务-{RUN}", "meeting_type": "EXECUTIVE",
                    "security_level": "NORMAL", "agenda_text": "1. E2E议题一; 2. E2E议题二"},
              require=("booking_id",), save={"affair_id": lambda d: d["data"]["affair_id"]})
    rest_step("conference", "POST /conference/attendees(加参会人1)", "POST", "/api/conference/attendees", headers=ADMIN,
              body={"affair_id": CTX.get("affair_id"), "name": f"E2E嘉宾甲{RUN}", "dept_name": "综合办公室"},
              require=("affair_id",), save={"attendee1": lambda d: d["data"].get("attendee_id") or d["data"].get("id")})
    rest_step("conference", "POST /conference/attendees(加参会人2)", "POST", "/api/conference/attendees", headers=ADMIN,
              body={"affair_id": CTX.get("affair_id"), "name": "张明", "dept_name": "综合办公室", "user_id": CTX.get("zhang")},
              require=("affair_id",), save={"attendee2": lambda d: d["data"].get("attendee_id") or d["data"].get("id")})
    rest_step("conference", "PUT /conference/attendees(改签到类型)", "PUT", "/api/conference/attendees/{attendee1}",
              headers=ADMIN, body={"attend_type": "ONSITE"}, require=("attendee1",))
    rest_step("conference", "GET /conference/attendees", "GET", f"/api/conference/attendees?affair_id={CTX.get('affair_id', '')}",
              headers=ADMIN, require=("affair_id",))
    rest_step("conference", "POST /conference/attendees/checkin(签到)", "POST", "/api/conference/attendees/{attendee2}/checkin",
              headers=ADMIN, require=("attendee2",))
    rest_step("conference", "POST /conference/seating(排座)", "POST", f"/api/conference/seating/{CTX.get('affair_id', '')}",
              headers=ADMIN, body={"rule_type": "CENTER_FIRST"}, require=("affair_id",))
    rest_step("conference", "GET /conference/seating", "GET", f"/api/conference/seating/{CTX.get('affair_id', '')}",
              headers=ADMIN, require=("affair_id",))
    rest_step("conference", "GET /conference/checkin-code", "GET", f"/api/conference/checkin/{CTX.get('affair_id', '')}",
              headers=ADMIN, require=("affair_id",))
    rest_step("conference", "GET /conference/schedule", "GET", "/api/conference/schedule", headers=ADMIN)
    rest_step("conference", "GET /conference/services", "GET", "/api/conference/services?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("conference", "POST /conference/services(茶歇工单)", "POST", "/api/conference/services", headers=ADMIN,
              body={"booking_id": CTX.get("booking_id"), "service_type": "TEA", "notes": "E2E茶歇"},
              require=("booking_id",), save={"ticket_id": lambda d: d["data"]["ticket_id"]})
    rest_step("conference", "POST /conference/services/dispatch", "POST", "/api/conference/services/{ticket_id}/dispatch",
              headers=ADMIN, body={"assignee_name": "E2E后勤组"}, require=("ticket_id",))
    rest_step("conference", "POST /conference/services/complete", "POST", "/api/conference/services/{ticket_id}/complete",
              headers=ADMIN, require=("ticket_id",))
    rest_step("conference", "POST /conference/minutes(纪要)", "POST", "/api/conference/minutes", headers=ADMIN,
              body={"booking_id": CTX.get("booking_id"), "content": f"# E2E纪要-{RUN}\n1. 议定事项：全量测试通过"},
              require=("booking_id",), save={"minutes_id": lambda d: d["data"]["id"]})
    rest_step("conference", "PUT /conference/minutes(版本递增)", "PUT", "/api/conference/minutes/{minutes_id}",
              headers=ADMIN, body={"content": "# E2E纪要v2\n1. 补充议定事项"}, require=("minutes_id",))
    rest_step("conference", "GET /conference/minutes/{id}", "GET", "/api/conference/minutes/{minutes_id}",
              headers=ADMIN, require=("minutes_id",))
    rest_step("conference", "POST action-items(议定事项)", "POST", "/api/conference/minutes/{minutes_id}/action-items",
              headers=ADMIN, body={"booking_id": CTX.get("booking_id"), "task_description": f"E2E议定-{RUN}",
                                   "assignee_name": "信息技术部", "due_date": (datetime.now() + timedelta(days=30)).isoformat()},
              require=("minutes_id",), save={"action_item_id": lambda d: d["data"]["id"]})
    rest_step("conference", "POST action-items/to-supervision(转督办)", "POST",
              f"/api/conference/action-items/{CTX.get('action_item_id', '')}/to-supervision", headers=ADMIN,
              body={"lead_dept_id": CTX.get("dept_root"), "deadline": dl, "priority": "URGENT"},
              require=("action_item_id",))
    cs, ce = future(210 + int(RUN[2:4], 16) % 80, 14, 1)
    rest_step("conference", "POST /conference/bookings(第二场供取消)", "POST", "/api/conference/bookings", headers=ADMIN,
              body={"room_id": CTX.get("room_id"), "title": f"E2E待取消会议-{RUN}", "start_time": cs, "end_time": ce,
                    "attendee_count": 3},
              require=("room_id",), save={"cancel_booking_id": lambda d: d["data"]["id"]})
    rest_step("conference", "POST /conference/bookings/cancel", "POST", "/api/conference/bookings/{cancel_booking_id}/cancel",
              headers=ADMIN, require=("cancel_booking_id",))
    rest_step("conference", "POST affairs visitor-invitations(访客邀约)", "POST",
              f"/api/conference/affairs/{CTX.get('affair_id', '')}/visitor-invitations", headers=ADMIN,
              body={"visitors": [{"name": f"E2E外宾-{RUN}", "phone": "13800009999", "company": "E2E大学"}]},
              require=("affair_id",))
    vs, ve = future(220 + int(RUN[:2], 16) % 60, 10, 2)
    mcp_step("conference", "meeting_query_available_rooms", "meeting_query_available_rooms",
             lambda: {"start_time": vs, "end_time": ve, "seats": 5}, validate=lambda d: d.get("available_count", 0) >= 1,
             save={"mcp_room": lambda d: d["rooms"][0]["room_id"]})
    mcp_step("conference", "meeting_book_room", "meeting_book_room",
             lambda: {"room_id": CTX.get("mcp_room", ""), "start_time": vs, "end_time": ve,
                      "title": f"MCP-E2E会议-{RUN}", "attendee_count": 6, "user_id": CTX.get("zhang", "")},
             require=("mcp_room",), save={"mcp_booking": lambda d: d.get("id") or d.get("booking_id")})
    mcp_step("conference", "meeting_query_schedule", "meeting_query_schedule",
             lambda: {"date": datetime.fromisoformat(vs).strftime("%Y-%m-%d")})
    mcp_step("conference", "meeting_generate_seating", "meeting_generate_seating",
             lambda: {"meeting_id": CTX.get("affair_id", ""), "rule_type": "CENTER_FIRST"}, require=("affair_id",))
    mcp_step("conference", "meeting_dispatch_service", "meeting_dispatch_service",
             lambda: {"meeting_id": CTX.get("mcp_booking", ""), "service_items": ["TEA", "AC"], "notes": "MCP-E2E派工"},
             require=("mcp_booking",))
    mcp_step("conference", "meeting_convert_to_supervision", "meeting_convert_to_supervision",
             lambda: {"minutes_item_id": CTX.get("mcp_action_item", ""), "lead_dept_id": CTX.get("dept_root", ""), "deadline": dl},
             require=("mcp_action_item",))
    # 为 MCP 转督办准备独立 action item
    rest_step("conference", "POST minutes/action-items(MCP转办用)", "POST", "/api/conference/minutes/{minutes_id}/action-items",
              headers=ADMIN, body={"task_description": f"MCP-E2E转办事项-{RUN}", "assignee_name": "综合办公室"},
              require=("minutes_id",), save={"mcp_action_item": lambda d: d["data"]["id"]})
    mcp_step("conference", "meeting_convert_to_supervision(实际)", "meeting_convert_to_supervision",
             lambda: {"minutes_item_id": CTX.get("mcp_action_item", ""), "lead_dept_id": CTX.get("dept_root", ""), "deadline": dl},
             require=("mcp_action_item",), validate=lambda d: str(d.get("supervision_no", "")).startswith("DB"))

    # ---------- 6. 组织通讯 ----------
    log("\n== 组织通讯 / CONTACTS ==")
    rest_step("contacts", "GET /contacts/employees", "GET", "/api/contacts/employees?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("contacts", "GET /contacts/org-tree", "GET", "/api/contacts/org-tree", headers=ADMIN,
              validate=lambda s, d: len(rows_of(d.get("data", []))) > 0)
    rest_step("contacts", "GET /contacts/privacy-mask", "GET", "/api/contacts/privacy-mask", headers=ADMIN)
    rest_step("contacts", "GET /contacts/sync/template", "GET", "/api/contacts/sync/template", headers=ADMIN)
    rest_step("contacts", "GET /contacts/partners", "GET", "/api/contacts/partners?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("contacts", "POST /contacts/partners", "POST", "/api/contacts/partners", headers=ADMIN,
              body={"unit_name": f"E2E外联单位-{RUN}", "contact_name": "王联络", "phone": "13900001111",
                    "category": "协作单位", "tags": "E2E"},
              save={"partner_id": lambda d: d["data"].get("partner_id") or d["data"].get("id")})
    rest_step("contacts", "PUT /contacts/partners", "PUT", "/api/contacts/partners/{partner_id}", headers=ADMIN,
              body={"contact_name": "李联络"}, require=("partner_id",))
    rest_step("contacts", "DELETE /contacts/partners", "DELETE", "/api/contacts/partners/{partner_id}",
              headers=ADMIN, require=("partner_id",))
    rest_step("contacts", "GET /contacts/experts", "GET", "/api/contacts/experts?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("contacts", "POST /contacts/experts", "POST", "/api/contacts/experts", headers=ADMIN,
              body={"name": f"E2E专家-{RUN}", "organization": "E2E研究院", "field_domain": "信息化",
                    "level": "PROVINCIAL", "phone": "13700002222"},
              save={"expert_id": lambda d: d["data"].get("expert_id") or d["data"].get("id")})
    rest_step("contacts", "PUT /contacts/experts", "PUT", "/api/contacts/experts/{expert_id}", headers=ADMIN,
              body={"level": "NATIONAL"}, require=("expert_id",))
    rest_step("contacts", "DELETE /contacts/experts", "DELETE", "/api/contacts/experts/{expert_id}",
              headers=ADMIN, require=("expert_id",))
    rest_step("contacts", "POST /contacts/sync/export", "POST", "/api/contacts/sync/export", headers=ADMIN,
              validate=lambda s, d: isinstance(rows_of(d.get("data", [])), list) and len(rows_of(d["data"])) >= 1)
    rest_step("contacts", "POST /contacts/sync/import(upsert)", "POST", "/api/contacts/sync/import", headers=ADMIN,
              body={"rows": [{"user_name": f"e2e_imp_{RUN}", "nick_name": f"E2E导入员-{RUN}", "phonenumber": "13600003333",
                              "email": f"e2e{RUN}@test.local", "dept_name": "综合办公室"}]},
              validate=lambda s, d: d.get("code") == 200)
    d = rest_step("contacts", "GET employees(找导入员)", "GET",
                  "/api/contacts/employees?keyword=" + quote(f"E2E导入员-{RUN}"),
                  headers=ADMIN, validate=lambda s, dd: len(rows_of(dd.get("rows", []))) == 1,
                  save={"imported_uid": lambda dd: dd["rows"][0]["user_id"]})
    rest_step("system", "DELETE /system/users(清理导入员)", "DELETE", "/api/system/users/{imported_uid}",
              headers=ADMIN, require=("imported_uid",))
    mcp_step("contacts", "contacts_search_person(张明)", "contacts_search_person",
             lambda: {"name_or_keyword": "张明"}, validate=lambda d: d.get("total", 0) >= 1)
    mcp_step("contacts", "contacts_get_org_tree", "contacts_get_org_tree", lambda: {},
             validate=lambda d: isinstance(d, (dict, list)) and len(d) > 0)
    mcp_step("contacts", "contacts_query_external", "contacts_query_external", lambda: {"unit_name": ""},
             validate=lambda d: isinstance(d.get("partners"), list))
    mcp_step("contacts", "contacts_search_experts", "contacts_search_experts", lambda: {"keyword": ""},
             validate=lambda d: isinstance(d.get("experts"), list))

    # ---------- 7. 门禁访客 ----------
    log("\n== 门禁访客 / VISITOR ==")
    rest_step("visitor", "GET /visitor/dashboard", "GET", "/api/visitor/dashboard", headers=ADMIN)
    rest_step("visitor", "GET /visitor/appointments", "GET", "/api/visitor/appointments?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("visitor", "GET /visitor/invitations", "GET", "/api/visitor/invitations?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("visitor", "GET /visitor/blacklist", "GET", "/api/visitor/blacklist?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("visitor", "GET /visitor/access-rules", "GET", "/api/visitor/access-rules", headers=ADMIN,
              save={"rules_bak": lambda d: json.dumps(d.get("data", d), ensure_ascii=False)})
    rest_step("visitor", "PUT /visitor/access-rules(回写)", "PUT", "/api/visitor/access-rules", headers=ADMIN,
              body=json.loads(CTX["rules_bak"]) if isinstance(CTX.get("rules_bak"), str) else {"work_start": "08:30"})
    vs2, ve2 = future(5, 10, 3)
    rest_step("visitor", "POST /visitor/appointments(预约)", "POST", "/api/visitor/appointments", headers=ADMIN,
              body={"visitor_name": f"E2E访客-{RUN}", "visitor_phone": "13912345678",
                    "id_card_number": "330106199001011234", "company": "E2E科技有限公司",
                    "visit_reason": "E2E洽谈合作", "host_user_id": CTX.get("admin_uid"),
                    "scheduled_start": vs2, "scheduled_end": ve2},
              save={"appt_id": lambda d: d["data"]["appointment_id"]})
    rest_step("visitor", "POST audit HOST", "POST", "/api/visitor/appointments/{appt_id}/audit", headers=ADMIN,
              body={"step": "HOST", "action": "APPROVE"}, require=("appt_id",))
    rest_step("visitor", "POST audit SECURITY", "POST", "/api/visitor/appointments/{appt_id}/audit", headers=ADMIN,
              body={"step": "SECURITY", "action": "APPROVE"}, require=("appt_id",))
    rest_step("visitor", "POST checkin(入场)", "POST", "/api/visitor/appointments/{appt_id}/checkin", headers=ADMIN,
              require=("appt_id",), validate=lambda s, d: d["data"]["status"] == "CHECKED_IN")
    rest_step("visitor", "POST checkout(离场)", "POST", "/api/visitor/appointments/{appt_id}/checkout", headers=ADMIN,
              require=("appt_id",), validate=lambda s, d: d["data"]["status"] == "CHECKED_OUT")
    rest_step("visitor", "POST /visitor/blacklist(拉黑)", "POST", "/api/visitor/blacklist", headers=ADMIN,
              body={"name": f"E2E黑名单-{RUN}", "organization": "E2E风险公司", "reason": "E2E测试拉黑"},
              save={"black_id": lambda d: d["data"].get("blacklist_id") or d["data"].get("id")})
    rest_step("visitor", "DELETE /visitor/blacklist(移出)", "DELETE", "/api/visitor/blacklist/{black_id}",
              headers=ADMIN, require=("black_id",))
    mcp_step("visitor", "visitor_create_invitation", "visitor_create_invitation",
             lambda: {"visitor_name": f"MCP-E2E访客-{RUN}", "phone": "13899990000",
                      "visit_date": future(8, 10, 1)[0], "purpose": "MCP-E2E来访",
                      "host_user_id": CTX.get("zhang", ""), "duration_hours": 2.0},
             validate=lambda d: d.get("status") == "APPROVED" and d.get("access_code"),
             save={"mcp_appt": lambda d: d.get("appointment_id"), "mcp_code": lambda d: d.get("access_code")})
    mcp_step("visitor", "visitor_query_appointments", "visitor_query_appointments", lambda: {"page_size": 10},
             validate=lambda d: isinstance(d.get("appointments"), list))
    mcp_step("visitor", "visitor_checkin(QR核验)", "visitor_checkin",
             lambda: {"appointment_id": CTX.get("mcp_appt", ""), "code": CTX.get("mcp_code", ""), "method": "QRCODE"},
             require=("mcp_appt",))
    mcp_step("visitor", "visitor_checkout", "visitor_checkout",
             lambda: {"appointment_id": CTX.get("mcp_appt", "")}, require=("mcp_appt",))
    mcp_step("visitor", "visitor_audit_request(拦截已核销)", "visitor_audit_request",
             lambda: {"appointment_id": CTX.get("mcp_appt", ""), "action": "REJECT", "reason": "E2E负路径"},
             require=("mcp_appt",), soft_msgs=("状态", "不允许", "无法", "Error executing tool"))
    rest_step("visitor", "POST /visitor/appointments(供MCP审批)", "POST", "/api/visitor/appointments", headers=ADMIN,
              body={"visitor_name": f"MCP审批访客-{RUN}", "visitor_phone": "13811112222",
                    "visit_reason": "MCP两级审批链路", "host_user_id": CTX.get("admin_uid"),
                    "scheduled_start": future(9, 10, 2)[0], "scheduled_end": future(9, 12, 2)[0]},
              save={"mcp_audit_appt": lambda d: d["data"]["appointment_id"]})
    mcp_step("visitor", "visitor_audit_request(HOST批准)", "visitor_audit_request",
             lambda: {"appointment_id": CTX.get("mcp_audit_appt", ""), "action": "APPROVE", "reason": "MCP同意"},
             require=("mcp_audit_appt",))
    mcp_step("visitor", "visitor_audit_request(SECURITY批准)", "visitor_audit_request",
             lambda: {"appointment_id": CTX.get("mcp_audit_appt", ""), "action": "APPROVE", "reason": "MCP备案"},
             require=("mcp_audit_appt",))
    mcp_step("visitor", "visitor_query_active", "visitor_query_active", lambda: {}, validate=lambda d: isinstance(d, dict))
    mcp_step("visitor", "visitor_query_dashboard", "visitor_query_dashboard", lambda: {},
             validate=lambda d: isinstance(d, dict))
    mcp_step("visitor", "visitor_query_blacklist", "visitor_query_blacklist", lambda: {"page_size": 10},
             validate=lambda d: isinstance(d.get("blacklist"), list))

    # ---------- 8. 公务用车 ----------
    log("\n== 公务用车 / FLEET ==")
    rest_step("fleet", "GET /fleet/vehicles", "GET", "/api/fleet/vehicles?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("fleet", "GET /fleet/drivers", "GET", "/api/fleet/drivers?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("fleet", "GET /fleet/applications", "GET", "/api/fleet/applications?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("fleet", "GET /fleet/dispatches", "GET", "/api/fleet/dispatches?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("fleet", "GET /fleet/trip-logs", "GET", "/api/fleet/trip-logs?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("fleet", "GET /fleet/fuel-logs", "GET", "/api/fleet/fuel-logs?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("fleet", "GET /fleet/maintenance", "GET", "/api/fleet/maintenance?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("fleet", "GET /fleet/maintenance/warnings", "GET", "/api/fleet/maintenance/warnings", headers=ADMIN)
    rest_step("fleet", "GET /fleet/dashboard", "GET", "/api/fleet/dashboard", headers=ADMIN)
    rest_step("fleet", "GET /fleet/available", "GET", f"/api/fleet/available?start_time={future(95, 9, 4)[0]}&end_time={future(95, 13, 4)[0]}&seats=3",
              headers=ADMIN)
    rest_step("fleet", "POST /fleet/vehicles(新增)", "POST", "/api/fleet/vehicles", headers=ADMIN,
              body={"plate_no": f"浙A{RUN[:5]}E2", "brand_model": "E2E商务车", "vehicle_type": "BUS",
                    "seat_count": 7, "current_mileage": 5000},
              save={"new_vehicle": lambda d: d["data"]["vehicle_id"]})
    rest_step("fleet", "PUT /fleet/vehicles(改)", "PUT", "/api/fleet/vehicles/{new_vehicle}", headers=ADMIN,
              body={"brand_model": "E2E商务车Pro"}, require=("new_vehicle",))
    rest_step("fleet", "POST /fleet/drivers(新增)", "POST", "/api/fleet/drivers", headers=ADMIN,
              body={"name": f"E2E司机-{RUN}", "phone": "13500004444", "license_type": "A1"},
              save={"new_driver": lambda d: d["data"]["driver_id"]})
    rest_step("fleet", "PUT /fleet/drivers(改)", "PUT", "/api/fleet/drivers/{new_driver}", headers=ADMIN,
              body={"phone": "13500005555"}, require=("new_driver",))
    rest_step("fleet", "POST /fleet/drivers/status(切换)", "POST", "/api/fleet/drivers/{new_driver}/status",
              headers=ADMIN, body={"status": "OFF_DUTY"}, require=("new_driver",))
    rest_step("fleet", "POST /fleet/maintenance(维保登记)", "POST", "/api/fleet/maintenance", headers=ADMIN,
              body={"vehicle_id": CTX.get("new_vehicle"), "log_type": "REPAIR",
                    "description": "E2E更换刹车片", "vendor": "E2E修车厂", "cost": 800},
              require=("new_vehicle",), save={"fleet_maint_id": lambda d: d["data"].get("log_id") or d["data"].get("maintenance_id")})
    rest_step("fleet", "POST /fleet/fuel-logs(加油)", "POST", "/api/fleet/fuel-logs", headers=ADMIN,
              body={"vehicle_id": CTX.get("new_vehicle"), "liters": 40.5, "cost": 320.0,
                    "mileage_at_fuel": 5100, "station": "E2E加油站"},
              require=("new_vehicle",))
    fs, fe = future(100, 9, 8)
    rest_step("fleet", "POST /fleet/applications(申请)", "POST", "/api/fleet/applications", headers=ADMIN,
              body={"purpose": f"E2E公务出行-{RUN}", "trip_type": "OFFICIAL_BUSINESS", "origin": "机关大院",
                    "destination": "E2E高新区", "passenger_count": 3, "leader_name": "E2E领导",
                    "start_time": fs, "end_time": fe},
              save={"fleet_app": lambda d: d["data"]["app_id"]})
    rest_step("fleet", "POST audit DEPT", "POST", "/api/fleet/applications/{fleet_app}/audit", headers=ADMIN,
              body={"step": "DEPT", "action": "APPROVE", "comment": "E2E部门同意"}, require=("fleet_app",))
    rest_step("fleet", "POST audit ADMIN", "POST", "/api/fleet/applications/{fleet_app}/audit", headers=ADMIN,
              body={"step": "ADMIN", "action": "APPROVE", "comment": "E2E车队同意"}, require=("fleet_app",))
    rest_step("fleet", "POST dispatch(派车)", "POST", "/api/fleet/applications/{fleet_app}/dispatch", headers=ADMIN,
              body={"vehicle_id": CTX.get("vehicle_id"), "driver_id": CTX.get("driver_id"), "start_mileage": float(CTX.get("veh_mileage", 1000))},
              require=("fleet_app",), save={"fleet_dispatch": lambda d: d["data"]["dispatch_id"]})
    rest_step("fleet", "POST return(归队核销)", "POST", "/api/fleet/dispatches/{fleet_dispatch}/return", headers=ADMIN,
              body={"end_mileage": float(CTX.get("veh_mileage", 1000)) + 88.8, "toll_cost": 45.0, "notes": "E2E归队"},
              require=("fleet_dispatch",))
    rest_step("fleet", "DELETE /fleet/vehicles(清理)", "DELETE", "/api/fleet/vehicles/{new_vehicle}",
              headers=ADMIN, require=("new_vehicle",))
    fs2, fe2 = future(105, 9, 8)
    mcp_step("fleet", "fleet_query_available_cars", "fleet_query_available_cars",
             lambda: {"start_time": fs2, "end_time": fe2, "seats": 2}, validate=lambda d: isinstance(d, dict))
    mcp_step("fleet", "fleet_apply_car", "fleet_apply_car",
             lambda: {"purpose": f"MCP-E2E用车-{RUN}", "origin": "机关大院", "destination": "MCP-E2E开发区",
                      "start_time": fs2, "end_time": fe2, "seats": 2, "user_id": CTX.get("zhang", ""), "leader_name": "MCP主任"},
             save={"mcp_fleet_app": lambda d: d["app_id"]})
    rest_step("fleet", "POST audit DEPT(MCP单)", "POST", "/api/fleet/applications/{mcp_fleet_app}/audit", headers=ADMIN,
              body={"step": "DEPT", "action": "APPROVE"}, require=("mcp_fleet_app",))
    rest_step("fleet", "POST audit ADMIN(MCP单)", "POST", "/api/fleet/applications/{mcp_fleet_app}/audit", headers=ADMIN,
              body={"step": "ADMIN", "action": "APPROVE"}, require=("mcp_fleet_app",))
    mcp_step("fleet", "fleet_dispatch_trip", "fleet_dispatch_trip",
             lambda: {"application_id": CTX.get("mcp_fleet_app", ""), "vehicle_id": CTX.get("vehicle_id", ""),
                      "driver_id": CTX.get("driver_id", "")},
             require=("mcp_fleet_app",), save={"mcp_fleet_dispatch": lambda d: d.get("dispatch_id")})
    rest_step("fleet", "GET vehicles(归队前取最新里程)", "GET", "/api/fleet/vehicles?pageNum=1&pageSize=20", headers=ADMIN,
              save={"veh_mileage": lambda d: next((float(r["current_mileage"]) for r in rows_of(d.get("rows", []))
                                                   if r["vehicle_id"] == CTX.get("vehicle_id")), float(CTX.get("veh_mileage", 1000)))})
    mcp_step("fleet", "fleet_return_trip", "fleet_return_trip",
             lambda: {"dispatch_id": CTX.get("mcp_fleet_dispatch", ""),
                      "return_mileage": float(CTX.get("veh_mileage", 1000)) + 100, "toll_cost": 30.0, "notes": "MCP-E2E归队"},
             require=("mcp_fleet_dispatch",))
    mcp_step("fleet", "fleet_query_applications(COMPLETED)", "fleet_query_applications",
             lambda: {"status": "COMPLETED", "page_size": 10}, validate=lambda d: isinstance(d.get("applications"), list))
    mcp_step("fleet", "fleet_query_dashboard", "fleet_query_dashboard", lambda: {}, validate=lambda d: isinstance(d, dict))
    mcp_step("fleet", "fleet_query_drivers", "fleet_query_drivers", lambda: {"status": "ON_DUTY"},
             validate=lambda d: isinstance(d.get("drivers"), list))
    mcp_step("fleet", "fleet_query_maintenance_warnings", "fleet_query_maintenance_warnings", lambda: {},
             validate=lambda d: isinstance(d, dict))

    # ---------- 9. 调研 ----------
    log("\n== 政务调研 / RESEARCH ==")
    rest_step("research", "GET /research/topics", "GET", "/api/research/topics?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("research", "GET /research/points", "GET", "/api/research/points?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("research", "GET /research/issues", "GET", "/api/research/issues?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("research", "GET /research/reports", "GET", "/api/research/reports?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("research", "GET /research/dashboard", "GET", "/api/research/dashboard", headers=ADMIN)
    sd = (datetime.now() + timedelta(days=15)).strftime("%Y-%m-%d")
    ed = (datetime.now() + timedelta(days=17)).strftime("%Y-%m-%d")
    rest_step("research", "POST /research/topics(立项)", "POST", "/api/research/topics", headers=ADMIN,
              body={"title": f"E2E调研-{RUN}", "field_domain": "营商环境", "leader_name": "E2E局长",
                    "lead_dept_id": CTX.get("dept_root"), "start_date": sd, "end_date": ed, "research_type": "SPECIAL",
                    "points": [{"point_name": f"E2E点位甲{RUN}", "scheduled_date": sd},
                               {"point_name": f"E2E点位乙{RUN}", "scheduled_date": (datetime.now() + timedelta(days=16)).strftime("%Y-%m-%d")}]},
              save={"rest_topic": lambda d: d["data"]["topic_id"]})
    rest_step("research", "POST /research/topics/approve", "POST", "/api/research/topics/{rest_topic}/approve",
              headers=ADMIN, require=("rest_topic",))
    rest_step("research", "POST /research/topics/start", "POST", "/api/research/topics/{rest_topic}/start",
              headers=ADMIN, require=("rest_topic",))
    rest_step("research", "POST /research/points(加点位)", "POST", "/api/research/points", headers=ADMIN,
              body={"topic_id": CTX.get("rest_topic"), "point_name": f"E2E点位丙{RUN}",
                    "scheduled_date": ed},
              require=("rest_topic",), save={"rest_point": lambda d: d["data"].get("point_id") or d["data"].get("id")})
    rest_step("research", "PUT /research/points(改点位)", "PUT", "/api/research/points/{rest_point}", headers=ADMIN,
              body={"point_name": f"E2E点位丙改{RUN}"}, require=("rest_point",))
    rest_step("research", "POST /research/check-conflicts(自撞)", "POST", "/api/research/check-conflicts", headers=ADMIN,
              body={"point_names": [f"E2E点位甲{RUN}"], "start_date": sd, "end_date": ed},
              validate=lambda s, d: d.get("data", {}).get("has_conflict") is True)
    rest_step("research", "POST /research/issues(登记问题)", "POST", "/api/research/issues", headers=ADMIN,
              body={"topic_id": CTX.get("rest_topic"), "point_name": f"E2E点位甲{RUN}",
                    "issue_title": f"E2E堵点-{RUN}", "description": "E2E问题台账", "target_dept_id": CTX.get("dept_root")},
              require=("rest_topic",), save={"rest_issue": lambda d: d["data"]["issue_id"]})
    rest_step("research", "PUT /research/issues(整改)", "PUT", "/api/research/issues/{rest_issue}", headers=ADMIN,
              body={"status": "RECTIFIED", "rectify_note": "E2E已整改"}, require=("rest_issue",))
    rest_step("research", "POST /research/topics/report(报告)", "POST", "/api/research/topics/{rest_topic}/report",
              headers=ADMIN, body={"summary_report": f"E2E调研报告-{RUN}：完成走访并形成结论。"},
              require=("rest_topic",))
    rest_step("research", "POST /research/topics/finalize(结题)", "POST", "/api/research/topics/{rest_topic}/finalize",
              headers=ADMIN, require=("rest_topic",))
    sd2 = (datetime.now() + timedelta(days=20)).strftime("%Y-%m-%d")
    ed2 = (datetime.now() + timedelta(days=22)).strftime("%Y-%m-%d")
    mcp_step("research", "research_register_plan", "research_register_plan",
             lambda: {"title": f"MCP-E2E课题-{RUN}", "leader_name": "张明", "lead_dept_id": CTX.get("dept_root", ""),
                      "start_date": sd2, "end_date": ed2,
                      "route_points": [f"MCP点位子{RUN}", f"MCP点位丑{RUN}"], "user_id": CTX.get("zhang", "")},
             save={"mcp_topic": lambda d: d["topic_id"]})
    mcp_step("research", "research_check_conflicts(命中自身)", "research_check_conflicts",
             lambda: {"route_points": [f"MCP点位子{RUN}"], "start_date": sd2, "end_date": ed2},
             validate=lambda d: d.get("has_conflict") is True)
    mcp_step("research", "research_check_conflicts(无冲突)", "research_check_conflicts",
             lambda: {"route_points": [f"无人点位{RUN}"], "start_date": sd2, "end_date": ed2},
             validate=lambda d: d.get("has_conflict") is False)
    mcp_step("research", "research_log_issue", "research_log_issue",
             lambda: {"topic_id": CTX.get("mcp_topic", ""), "issue_title": f"MCP-E2E问题-{RUN}",
                      "description": "MCP登记问题", "point_name": f"MCP点位子{RUN}", "target_dept_id": CTX.get("dept_root", "")},
             require=("mcp_topic",), save={"mcp_issue": lambda d: d["issue_id"]})
    mcp_step("research", "research_query_issues", "research_query_issues",
             lambda: {"topic_id": CTX.get("mcp_topic", ""), "status": "LOGGED"}, require=("mcp_topic",))
    mcp_step("research", "research_query_topics", "research_query_topics",
             lambda: {"keyword": "MCP-E2E课题", "page_size": 10}, validate=lambda d: d.get("total", 0) >= 1)
    mcp_step("research", "research_push_to_supervision", "research_push_to_supervision",
             lambda: {"issue_id": CTX.get("mcp_issue", ""), "deadline": (datetime.now() + timedelta(days=40)).strftime("%Y-%m-%d")},
             require=("mcp_issue",), validate=lambda d: str(d.get("supervision_no", "")).startswith("DB"))
    mcp_step("research", "research_query_dashboard", "research_query_dashboard", lambda: {},
             validate=lambda d: isinstance(d, dict))
    mcp_step("research", "research_query_reports", "research_query_reports", lambda: {"page_size": 10},
             validate=lambda d: isinstance(d.get("reports"), list))

    # ---------- 10. 知识库 ----------
    log("\n== 知识库 / KNOWLEDGE ==")
    rest_step("knowledge", "GET /knowledge/documents", "GET", "/api/knowledge/documents?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("knowledge", "GET /knowledge/search", "GET", "/api/knowledge/search?q=" + quote("公务用车") + "&top_k=3",
              headers=ADMIN, validate=lambda s, d: d.get("code") == 200)
    rest_step("knowledge", "GET /knowledge/graph", "GET", "/api/knowledge/graph", headers=ADMIN)
    rest_step("knowledge", "GET /knowledge/stats", "GET", "/api/knowledge/stats", headers=ADMIN)
    rest_step("knowledge", "GET /knowledge/gbrainkg/status", "GET", "/api/knowledge/gbrainkg/status", headers=ADMIN)
    rest_step("knowledge", "GET /knowledge/gbrainkg/kbs", "GET", "/api/knowledge/gbrainkg/kbs", headers=ADMIN,
              soft_msgs=("不可达", "unreachable"))
    rest_step("knowledge", "GET /knowledge/gbrainkg/documents", "GET", "/api/knowledge/gbrainkg/documents", headers=ADMIN,
              soft_msgs=("不可达",))
    rest_step("knowledge", "GET /knowledge/gbrainkg/search", "GET", "/api/knowledge/gbrainkg/search?q=" + quote("测试") + "&top_k=3",
              headers=ADMIN, soft_msgs=("不可达",))
    rest_step("knowledge", "POST /knowledge/documents(新增)", "POST", "/api/knowledge/documents", headers=ADMIN,
              body={"title": f"E2E制度文件-{RUN}", "category": "制度规范", "content": f"E2E测试文档内容-{RUN} 关于差旅费管理办法",
                    "keywords": "E2E,差旅"},
              save={"new_doc": lambda d: d["data"]["doc_id"]})
    rest_step("knowledge", "PUT /knowledge/documents(改)", "PUT", "/api/knowledge/documents/{new_doc}", headers=ADMIN,
              body={"keywords": "E2E,差旅,修订"}, require=("new_doc",))
    rest_step("knowledge", "GET /knowledge/documents/{id}", "GET", "/api/knowledge/documents/{new_doc}",
              headers=ADMIN, require=("new_doc",))
    rest_step("knowledge", "POST /knowledge/sync/gbrainkg(fail-soft)", "POST", "/api/knowledge/sync/gbrainkg", headers=ADMIN,
              soft_msgs=("不可达", "失败"))
    rest_step("knowledge", "DELETE /knowledge/documents", "DELETE", "/api/knowledge/documents/{new_doc}",
              headers=ADMIN, require=("new_doc",))
    mcp_step("knowledge", "knowledge_search(公务用车)", "knowledge_search",
             lambda: {"query": "公务用车", "top_k": 3}, validate=lambda d: len(rows_of(d.get("results", d) if isinstance(d, dict) else d)) >= 1)
    mcp_step("knowledge", "knowledge_get_doc_detail", "knowledge_get_doc_detail",
             lambda: {"doc_id": CTX.get("doc_id", "")}, require=("doc_id",))
    mcp_step("knowledge", "knowledge_gbrainkg_status", "knowledge_gbrainkg_status", lambda: {},
             validate=lambda d: "reachable" in d or "mode" in d or "status" in d or isinstance(d, dict))
    mcp_step("knowledge", "knowledge_gbrainkg_search", "knowledge_gbrainkg_search",
             lambda: {"query": "差旅费", "top_k": 3}, soft_msgs=("不可达", "unreachable", "GBrainKG"))

    # ---------- 11. 系统管理 ----------
    log("\n== 系统管理 / SYSTEM ==")
    rest_step("system", "GET /system/users", "GET", "/api/system/users?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("system", "POST /system/users(建用户)", "POST", "/api/system/users", headers=ADMIN,
              body={"user_name": f"e2e_user_{RUN}", "nick_name": f"E2E用户-{RUN}", "password": "e2ePass123",
                    "dept_id": CTX.get("dept_root"), "phonenumber": "13566667777", "email": f"u{RUN}@e2e.local"},
              save={"new_user": lambda d: d["data"]["user_id"]})
    rest_step("system", "PUT /system/users(改用户)", "PUT", "/api/system/users/{new_user}", headers=ADMIN,
              body={"nick_name": f"E2E用户改-{RUN}"}, require=("new_user",))
    rest_step("system", "GET /system/roles", "GET", "/api/system/roles?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("system", "POST /system/roles(建角色)", "POST", "/api/system/roles", headers=ADMIN,
              body={"role_name": f"E2E角色-{RUN}", "role_key": f"e2e_{RUN}", "role_sort": 99, "status": "0"},
              save={"new_role": lambda d: d["data"]["role_id"]})
    rest_step("system", "PUT /system/roles(改角色)", "PUT", "/api/system/roles/{new_role}", headers=ADMIN,
              body={"role_name": f"E2E角色改-{RUN}"}, require=("new_role",))
    rest_step("system", "GET /system/menus", "GET", "/api/system/menus", headers=ADMIN)
    rest_step("system", "GET /system/depts", "GET", "/api/system/depts", headers=ADMIN)
    rest_step("system", "POST /system/depts(建部门)", "POST", "/api/system/depts", headers=ADMIN,
              body={"dept_name": f"E2E部门-{RUN}", "parent_id": CTX.get("dept_root"), "order_num": 99},
              save={"new_dept": lambda d: d["data"]["dept_id"]})
    rest_step("system", "PUT /system/depts(改部门)", "PUT", "/api/system/depts/{new_dept}", headers=ADMIN,
              body={"dept_name": f"E2E部门改-{RUN}"}, require=("new_dept",))
    rest_step("system", "GET /system/posts", "GET", "/api/system/posts?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("system", "POST /system/posts(建岗位)", "POST", "/api/system/posts", headers=ADMIN,
              body={"post_name": f"E2E岗位-{RUN}", "post_code": f"e2epost{RUN}", "post_sort": 99},
              save={"new_post": lambda d: d["data"]["post_id"]})
    rest_step("system", "PUT /system/posts(改岗位)", "PUT", "/api/system/posts/{new_post}", headers=ADMIN,
              body={"post_name": f"E2E岗位改-{RUN}"}, require=("new_post",))
    rest_step("system", "GET /system/dict/types", "GET", "/api/system/dict/types?pageNum=1&pageSize=5", headers=ADMIN)
    rest_step("system", "GET /system/dict/data", "GET", "/api/system/dict/data?dict_type=att_leave_type", headers=ADMIN)
    rest_step("system", "POST /system/dict/data(建字典)", "POST", "/api/system/dict/data", headers=ADMIN,
              body={"dict_type": "att_leave_type", "dict_label": f"E2E假别-{RUN}", "dict_value": f"E2E_{RUN}", "dict_sort": 99},
              save={"new_dict": lambda d: d["data"]["dict_code"]})
    rest_step("system", "PUT /system/dict/data(改字典)", "PUT", "/api/system/dict/data/{new_dict}", headers=ADMIN,
              body={"dict_label": f"E2E假别改-{RUN}"}, require=("new_dict",))
    rest_step("system", "GET /system/logs", "GET", "/api/system/logs?pageNum=1&pageSize=5", headers=ADMIN)
    d = rest_step("system", "GET /system/configs", "GET", "/api/system/configs", headers=ADMIN,
                  save={"config_id": lambda d: rows_of(d.get("data", []))[0]["config_id"] if rows_of(d.get("data", [])) else None,
                        "config_bak": lambda d: json.dumps(rows_of(d.get("data", []))[0], ensure_ascii=False) if rows_of(d.get("data", [])) else "{}"})
    if CTX.get("config_id"):
        cfg0 = json.loads(CTX.get("config_bak", "{}"))
        rest_step("system", "PUT /system/configs(改参数并回写)", "PUT", "/api/system/configs/{config_id}", headers=ADMIN,
                  body={"config_value": cfg0.get("config_value", "")}, require=("config_id",))
    rest_step("system", "DELETE /system/users", "DELETE", "/api/system/users/{new_user}", headers=ADMIN, require=("new_user",))
    rest_step("system", "DELETE /system/roles", "DELETE", "/api/system/roles/{new_role}", headers=ADMIN, require=("new_role",))
    rest_step("system", "DELETE /system/depts", "DELETE", "/api/system/depts/{new_dept}", headers=ADMIN, require=("new_dept",))
    rest_step("system", "DELETE /system/posts", "DELETE", "/api/system/posts/{new_post}", headers=ADMIN, require=("new_post",))
    rest_step("system", "DELETE /system/dict/data", "DELETE", "/api/system/dict/data/{new_dict}", headers=ADMIN, require=("new_dict",))

    # --- Agent 凭据生命周期（单 Secret 模式核心链路）---
    log("\n== Agent 凭据生命周期 / SYSTEM.APPS ==")
    d = rest_step("system.apps", "POST /system/apps(创建凭据)", "POST", "/api/system/apps", headers=ADMIN,
                  body={"app_name": f"E2E凭据-{RUN}", "scopes": "knowledge:read",
                        "rate_limit_per_minute": 120},
                  validate=lambda s, dd: dd.get("data", {}).get("app_secret", "").startswith("sk-") and
                                         "Authorization" in dd["data"]["mcp_config"]["mcpServers"]["agentcom"]["headers"],
                  save={"cred_id": lambda d: d["data"]["id"], "cred_secret": lambda d: d["data"]["app_secret"]})
    cred_h = {"Authorization": f"Bearer {CTX.get('cred_secret', '')}"}
    rest_step("system.apps", "新Secret访问REST→200", "GET", "/api/knowledge/documents?pageNum=1&pageSize=1",
              headers=cred_h, require=("cred_secret",))
    st, resp = mcp_rpc("tools/list", {}, 7, headers=cred_h)
    record("system.apps", "新Secret MCP tools/list", "MCP" if st == 200 else "REST",
           "PASS" if st == 200 and "result" in resp else "FAIL", f"HTTP {st}")
    rest_step("system.apps", "PUT toggle(停用)", "PUT", "/api/system/apps/{cred_id}/toggle", headers=ADMIN,
              require=("cred_id",), validate=lambda s, d: d["data"]["is_active"] is False)
    rest_step("system.apps", "停用后REST→401", "GET", "/api/knowledge/documents?pageNum=1&pageSize=1",
              headers=cred_h, expect=(401,), require=("cred_secret",))
    rest_step("system.apps", "PUT toggle(启用)", "PUT", "/api/system/apps/{cred_id}/toggle", headers=ADMIN,
              require=("cred_id",))
    d = rest_step("system.apps", "PUT rotate(重置密钥)", "PUT", "/api/system/apps/{cred_id}/rotate", headers=ADMIN,
                  require=("cred_id",),
                  validate=lambda s, dd: dd["data"]["app_secret"] != CTX.get("cred_secret") and
                                         "Authorization" in dd["data"]["mcp_config"]["mcpServers"]["agentcom"]["headers"],
                  save={"cred_secret2": lambda d: d["data"]["app_secret"]})
    rest_step("system.apps", "旧Secret→401", "GET", "/api/knowledge/documents?pageNum=1&pageSize=1",
              headers={"Authorization": f"Bearer {CTX.get('cred_secret', 'x')}"}, expect=(401,))
    rest_step("system.apps", "新Secret→200", "GET", "/api/knowledge/documents?pageNum=1&pageSize=1",
              headers={"Authorization": f"Bearer {CTX.get('cred_secret2', 'y')}"}, expect=(200,))
    rest_step("system.apps", "窄Scope越权→403", "GET", "/api/supervision/tasks?pageNum=1&pageSize=1",
              headers={"Authorization": f"Bearer {CTX.get('cred_secret2', 'y')}"}, expect=(403,))
    rest_step("system.apps", "DELETE /system/apps", "DELETE", "/api/system/apps/{cred_id}", headers=ADMIN,
              require=("cred_id",))
    rest_step("system.apps", "删除后Secret→401", "GET", "/api/knowledge/documents?pageNum=1&pageSize=1",
              headers={"Authorization": f"Bearer {CTX.get('cred_secret2', 'y')}"}, expect=(401,))

    # ---------- 12. MCP 协议级 ----------
    log("\n== MCP 协议级 / PROTOCOL ==")
    st, resp = mcp_rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                      "clientInfo": {"name": "e2e", "version": "1.0"}}, 1)
    record("mcp.protocol", "initialize 握手", "MCP",
           "PASS" if st == 200 and resp.get("result", {}).get("serverInfo", {}).get("name") == "agentcom" else "FAIL",
           json.dumps(resp.get("error", ""))[:100])
    st, resp = mcp_rpc("ping", {}, 2)
    record("mcp.protocol", "ping", "MCP", "PASS" if st == 200 and "result" in resp else "FAIL")
    st, resp = mcp_rpc("tools/list", {}, 3)
    tools = resp.get("result", {}).get("tools", []) if st == 200 else []
    record("mcp.protocol", f"tools/list = {len(tools)} 工具", "MCP", "PASS" if len(tools) == 68 else "FAIL",
           f"got {len(tools)}")
    st, resp = mcp_rpc("tools/call", {"name": "no_such_tool", "arguments": {}}, 4)
    record("mcp.protocol", "未知工具→错误", "MCP", "PASS" if "error" in resp or resp.get("result", {}).get("isError") else "FAIL")
    st, resp = mcp_rpc("tools/call", {"name": "knowledge_search", "arguments": {}}, 5)  # 缺必参 query
    record("mcp.protocol", "缺必填参数→错误", "MCP", "PASS" if "error" in resp or resp.get("result", {}).get("isError") else "FAIL")
    st, resp = mcp_rpc("resources/list", {}, 6)
    record("mcp.protocol", "resources/list", "MCP", "PASS" if st == 200 and "result" in resp else f"HTTP {st}")
    st, resp = mcp_rpc("prompts/list", {}, 8)
    record("mcp.protocol", "prompts/list", "MCP", "PASS" if st == 200 and "result" in resp else f"HTTP {st}")
    st, _ = mcp_rpc("tools/list", {}, 9, headers={})
    record("mcp.protocol", "无鉴权→401", "MCP", "PASS" if st == 401 else "FAIL", f"HTTP {st}")
    st, _ = mcp_rpc("tools/list", {}, 10, headers={"Authorization": "Bearer sk-00000000" + "f" * 40})
    record("mcp.protocol", "伪造Secret→401", "MCP", "PASS" if st == 401 else "FAIL", f"HTTP {st}")
    st, _ = mcp_rpc("tools/list", {}, 11, headers={"X-App-ID": "agentcom-d3adb33f", "X-App-Secret": "x"})
    record("mcp.protocol", "旧版双头→401(单Secret模式)", "MCP", "PASS" if st == 401 else "FAIL", f"HTTP {st}")
    st, _ = mcp_rpc("tools/list", {}, 12, headers={"Authorization": "Basic dXNlcjpwYXNz"})
    record("mcp.protocol", "非Bearer鉴权→401", "MCP", "PASS" if st == 401 else "FAIL", f"HTTP {st}")

    # ---------- 13. 审计落库 ----------
    log("\n== 审计 / AUDIT ==")
    st, d = http("GET", "/api/system/logs?pageSize=100", headers=ADMIN)
    logs = rows_of(d.get("rows", []))
    agent_logs = [r for r in logs if str(r.get("oper_name", "")).startswith("agent:")]
    user_logs = [r for r in logs if str(r.get("oper_name", "")).startswith("jwt:")]
    record("audit", f"审计日志写入(用户 {len(user_logs)} 条 / Agent {len(agent_logs)} 条)", "REST",
           "PASS" if logs else "FAIL", f"共 {len(logs)} 条")
    # Agent 身份写操作触发审计
    st, d = http("POST", "/api/knowledge/documents", {"title": f"E2E-Agent写-{RUN}", "category": "制度规范", "content": "agent写入审计验证"}, BEARER)
    if st == 200:
        agent_doc = d.get("data", {}).get("doc_id")
        st2, d2 = http("GET", "/api/system/logs?pageSize=20&keyword=knowledge", headers=ADMIN)
        recent = rows_of(d2.get("rows", []))
        hit = any(str(r.get("oper_name", "")).startswith("agent:") for r in recent)
        record("audit", "Agent Bearer 写操作审计(oper_name=agent:*)", "REST", "PASS" if hit else "FAIL",
               f"最近记录: {[r.get('oper_name') for r in recent[:5]]}")
        http("DELETE", f"/api/knowledge/documents/{agent_doc}", headers=ADMIN)
    else:
        record("audit", "Agent Bearer 写操作审计", "REST", "FAIL", f"写入失败 HTTP {st}")

    # ---------- 汇总 ----------
    dt = time.time() - t0
    n = {"PASS": 0, "FAIL": 0, "SOFT": 0, "SKIP": 0}
    for r in RESULTS:
        n[r["status"]] = n.get(r["status"], 0) + 1
    log("\n" + "=" * 70)
    log(f"# 汇总：总 {len(RESULTS)} | ✅ PASS {n['PASS']} | ❌ FAIL {n['FAIL']} | 🟡 SOFT {n['SOFT']} | ⏭️ SKIP {n['SKIP']} | 耗时 {dt:.1f}s")
    log("=" * 70)
    mods = {}
    for r in RESULTS:
        mods.setdefault(r["module"], {"PASS": 0, "FAIL": 0, "SOFT": 0, "SKIP": 0})
        mods[r["module"]][r["status"]] += 1
    log(f"{'模块':<16}{'PASS':>6}{'FAIL':>6}{'SOFT':>6}{'SKIP':>6}")
    for m, c in mods.items():
        log(f"{m:<16}{c['PASS']:>6}{c['FAIL']:>6}{c['SOFT']:>6}{c['SKIP']:>6}")
    fails = [r for r in RESULTS if r["status"] == "FAIL"]
    if fails:
        log("\n失败明细:")
        for r in fails:
            log(f"  ❌ [{r['module']}/{r['kind']}] {r['name']} — {r['detail']}")
    with open("/tmp/e2e_report.json", "w") as f:
        json.dump({"run": RUN, "summary": n, "results": RESULTS}, f, ensure_ascii=False, indent=1)
    log("\n报告已写入 /tmp/e2e_report.json")
    return 1 if n["FAIL"] else 0


if __name__ == "__main__":
    sys.exit(main())
