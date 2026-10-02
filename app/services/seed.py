"""Database seeding: RBAC foundation (RuoYi style) + demo business data for all modules."""

import uuid
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import BUSINESS_TZ, get_settings
from app.core.security import hash_password
from app.database import Base
from app.models import (
    AstCategory, AstConsumable, AstConsumableRequisition, AstItemCard, AstMaintenanceLog, AstRequisition,
    AstStocktakePlan, AttClockRecord, AttLeaveApplication, AttLeaveQuota, AttPunchRemedy, AttTripApplication,
    ConfActionItem, ConfAffair, ConfAttendee, ConfBooking, ConfMinutes, ConfRoom, ConfServiceTicket,
    CtExpert, CtExternalPartner, FltApplication, FltDriver, FltFuelLog, FltMaintenanceLog, FltTripDispatch,
    FltVehicle, KnbDocument, RschIssueLog, RschRoutePoint, RschTopic, SupExtensionRequest, SupMilestone,
    SupProgressReport, SupTask, SysAppCredential, SysConfig, SysDept, SysDictData, SysDictType, SysMenu,
    SysNotice, SysOperLog, SysPost, SysRole, SysUser, VisAppointment, VisBlacklist,
    sys_role_menu, sys_user_post, sys_user_role,
)
from sqlalchemy.dialects.postgresql import TSRANGE
from sqlalchemy.dialects.postgresql.ranges import Range

PAGES = [
    # (top_category, module_name, [(path, title, icon, perms)])  path 为页面路由
    ("PORTAL", "综合门户", [
        ("/portal/overview", "工作总览", "layout-grid", "portal:overview:list"),
        ("/portal/tasks", "我的待办", "clipboard-list", "portal:todo:list"),
        ("/portal/calendar", "协同日程", "calendar-days", "portal:calendar:list"),
        ("/portal/notifications", "消息通知", "bell", "portal:notice:list"),
        ("/portal/assistant", "智能助手", "bot", "portal:assistant:list"),
    ]),
    ("ATTENDANCE", "考勤管理", [
        ("/attendance/dashboard", "考勤工作台", "clock", "attendance:dashboard:list"),
        ("/attendance/records", "打卡记录管理", "activity", "attendance:record:list"),
        ("/attendance/leave", "请假休假中心", "calendar-check-2", "attendance:leave:list"),
        ("/attendance/trip", "外出与出差报备", "map-pin", "attendance:trip:list"),
        ("/attendance/remedy", "异常与补卡申请", "rotate-ccw", "attendance:remedy:list"),
        ("/attendance/monthly-settlement", "月度考勤汇总报表", "database", "attendance:report:list"),
        ("/attendance/rules", "班次与考勤组规则", "sliders-horizontal", "attendance:rule:list"),
    ]),
    ("ASSETS", "资产耗材", [
        ("/assets/overview", "资产全景看板", "layout-grid", "assets:overview:list"),
        ("/assets/ledger", "固定资产台账", "box", "assets:ledger:list"),
        ("/assets/inbound", "入库与建档", "package", "assets:ledger:add"),
        ("/assets/requisition", "领用与退库", "copy", "assets:requisition:list"),
        ("/assets/borrow", "借用与归还", "rotate-cw", "assets:requisition:list"),
        ("/assets/transfer", "资产调拨管理", "arrow-right", "assets:requisition:list"),
        ("/assets/maintenance", "维保与维修", "settings", "assets:maintenance:list"),
        ("/assets/stocktake", "智能资产盘点", "scan-search", "assets:stocktake:list"),
        ("/assets/depreciation-scrap", "折旧与报废处置", "database", "assets:ledger:list"),
        ("/assets/consumables", "低值办公易耗品", "package", "assets:consumable:list"),
    ]),
    ("SUPERVISION", "重点督办", [
        ("/supervision/dashboard", "督办指挥大屏", "layout-grid", "supervision:dashboard:list"),
        ("/supervision/standing", "督办立项管理", "clipboard-list", "supervision:task:list"),
        ("/supervision/decomposition", "任务分解与甘特里程碑", "layers", "supervision:milestone:edit"),
        ("/supervision/reporting", "进展反馈与台账填报", "file-text", "supervision:report:add"),
        ("/supervision/warning", "动态预警与智能催办", "alert-triangle", "supervision:task:list"),
        ("/supervision/extension", "延期申请与变更审核", "rotate-ccw", "supervision:extension:audit"),
        ("/supervision/closeout", "办结销号与现场核验", "check-circle-2", "supervision:closeout:audit"),
        ("/supervision/bulletin", "督查简报与考核通报", "file-code-2", "supervision:bulletin:list"),
    ]),
    ("CONFERENCE", "会务管理", [
        ("/conference/schedule", "会议大屏与日程看板", "calendar-days", "conference:booking:list"),
        ("/conference/rooms", "会议室维护管理", "door-open", "conference:room:list"),
        ("/conference/bookings", "预订管理与审批", "calendar-plus", "conference:booking:add"),
        ("/conference/affairs", "政务会务统筹", "clipboard-list", "conference:affair:list"),
        ("/conference/attendees", "参会人员与报名回执", "users", "conference:attendee:list"),
        ("/conference/seating", "智能排座与席卡系统", "users", "conference:seating:list"),
        ("/conference/services", "会务保障派工", "settings", "conference:service:list"),
        ("/conference/checkin", "电子签到大屏", "scan-search", "conference:attendee:list"),
        ("/conference/minutes", "会议纪要与行动项", "file-text", "conference:minutes:list"),
        ("/conference/minutes-to-supervision", "议定决议转督办", "arrow-right", "conference:actionitem:convert"),
    ]),
    ("CONTACTS", "组织通讯", [
        ("/contacts/org-chart", "组织架构全景树", "network", "contacts:org:list"),
        ("/contacts/employees", "干部与员工花名册", "users", "contacts:employee:list"),
        ("/contacts/privacy-mask", "高管隐私与号码脱敏", "eye-off", "contacts:employee:list"),
        ("/contacts/partners", "政务外联通讯录", "link", "contacts:partner:list"),
        ("/contacts/experts", "专家人才库", "crown", "contacts:expert:list"),
        ("/contacts/sync", "通讯录导入与同步", "rotate-cw", "contacts:sync:list"),
    ]),
    ("VISITOR", "门禁访客", [
        ("/visitor/dashboard", "访客安全指挥屏", "shield-check", "visitor:dashboard:list"),
        ("/visitor/reservations", "访客预约审核", "clipboard-list", "visitor:appointment:list"),
        ("/visitor/invitations", "员工主动要约", "key-round", "visitor:invitation:list"),
        ("/visitor/registration", "现场核验与临时发卡", "scan-search", "visitor:appointment:checkin"),
        ("/visitor/access-rule", "门禁与通行权限", "door-open", "visitor:rule:edit"),
        ("/visitor/blacklist", "黑名单与安防预警", "ban", "visitor:blacklist:list"),
        ("/visitor/checkout", "滞留告警与出场核销", "alert-triangle", "visitor:appointment:checkout"),
    ]),
    ("FLEET", "公务用车", [
        ("/fleet/dashboard", "车队运行监控大屏", "layout-grid", "fleet:dashboard:list"),
        ("/fleet/vehicles", "公务车辆台账（一车一档）", "box", "fleet:vehicle:list"),
        ("/fleet/drivers", "驾驶员档案与排班", "users", "fleet:driver:list"),
        ("/fleet/applications", "用车申请与三级审批", "file-text", "fleet:application:list"),
        ("/fleet/dispatch", "智能调度与派车单", "settings", "fleet:dispatch:list"),
        ("/fleet/trip-logs", "出车登记与归队核销", "activity", "fleet:dispatch:list"),
        ("/fleet/maintenance", "维保与年审预警", "wrench", "fleet:maintenance:list"),
        ("/fleet/fuel-audit", "定点加油与油耗审计", "database", "fleet:fuel:list"),
    ]),
    ("RESEARCH", "调研管理", [
        ("/research/dashboard", "全域调研全景看板", "layout-grid", "research:dashboard:list"),
        ("/research/topics", "调研课题立项申报", "clipboard-list", "research:topic:list"),
        ("/research/schedule-planner", "点位路线规划与防撞期统筹", "map-pin", "research:point:list"),
        ("/research/itinerary", "调研接待与动线方案", "arrow-right", "research:point:list"),
        ("/research/issues", "调研现场实录与问题台账", "alert-triangle", "research:issue:list"),
        ("/research/reports", "调研报告评审与归档", "file-text", "research:report:list"),
        ("/research/issues-to-supervision", "调研问题转督办闭环", "arrow-right", "research:issue:convert"),
    ]),
    ("KNOWLEDGE", "智慧知识", [
        ("/knowledge/home", "知识工作台", "layout-grid", "knowledge:doc:list"),
        ("/knowledge/search", "知识检索", "search", "knowledge:search:list"),
        ("/knowledge/documents", "知识文档", "file-text", "knowledge:doc:list"),
        ("/knowledge/graph", "知识图谱", "network", "knowledge:doc:list"),
    ]),
    ("SYSTEM", "系统管理", [
        ("/system/user", "用户基础管理", "user", "system:user:list"),
        ("/system/role", "角色与数据权限", "shield-check", "system:role:list"),
        ("/system/menu", "菜单与按钮权限", "layers", "system:menu:list"),
        ("/system/dept", "部门组织机构", "building-2", "system:dept:list"),
        ("/system/post", "岗位编制管理", "crown", "system:post:list"),
        ("/system/dict", "数据字典管理", "database", "system:dict:list"),
        ("/system/config", "系统参数配置", "sliders-horizontal", "system:config:list"),
        ("/system/log", "安全审计与日志", "file-code-2", "system:log:list"),
        ("/system/apps", "Agent 接入与应用凭据", "terminal", "system:app:list"),
    ]),
]

# 按钮级权限（F 菜单）：模块 -> 按钮权限串列表
MODULE_BUTTONS = {
    "PORTAL": [],
    "ATTENDANCE": ["attendance:leave:add", "attendance:leave:audit", "attendance:trip:add", "attendance:trip:audit",
                    "attendance:remedy:add", "attendance:remedy:audit", "attendance:rule:edit", "attendance:clock:add"],
    "ASSETS": ["assets:ledger:add", "assets:ledger:edit", "assets:ledger:del", "assets:requisition:add",
               "assets:requisition:audit", "assets:maintenance:add", "assets:stocktake:add", "assets:stocktake:scan",
               "assets:consumable:add", "assets:consumable:audit"],
    "SUPERVISION": ["supervision:task:add", "supervision:task:edit", "supervision:task:audit", "supervision:report:add",
                     "supervision:milestone:edit", "supervision:extension:audit", "supervision:closeout:audit"],
    "CONFERENCE": ["conference:room:add", "conference:room:edit", "conference:room:del", "conference:booking:add",
                    "conference:booking:audit", "conference:booking:cancel", "conference:affair:add",
                    "conference:attendee:add", "conference:attendee:edit", "conference:seating:generate",
                    "conference:service:add", "conference:service:dispatch", "conference:minutes:add",
                    "conference:minutes:edit", "conference:actionitem:add", "conference:actionitem:convert"],
    "CONTACTS": ["contacts:partner:add", "contacts:partner:edit", "contacts:partner:del", "contacts:expert:add",
                  "contacts:expert:edit", "contacts:expert:del", "contacts:sync:import", "contacts:sync:export",
                  "contacts:privacy:view"],
    "VISITOR": ["visitor:appointment:add", "visitor:appointment:audit", "visitor:appointment:checkin",
                 "visitor:appointment:checkout", "visitor:invitation:add", "visitor:blacklist:add",
                 "visitor:blacklist:del", "visitor:rule:edit"],
    "FLEET": ["fleet:vehicle:add", "fleet:vehicle:edit", "fleet:vehicle:del", "fleet:driver:add", "fleet:driver:edit",
              "fleet:application:add", "fleet:application:audit", "fleet:dispatch:add", "fleet:dispatch:return",
              "fleet:maintenance:add", "fleet:fuel:add"],
    "RESEARCH": ["research:topic:add", "research:topic:edit", "research:topic:audit", "research:point:add",
                  "research:point:edit", "research:issue:add", "research:issue:edit", "research:issue:convert"],
    "KNOWLEDGE": ["knowledge:doc:add", "knowledge:doc:edit", "knowledge:doc:del", "knowledge:search:list"],
    "SYSTEM": ["system:user:add", "system:user:edit", "system:user:del", "system:role:add", "system:role:edit",
               "system:role:del", "system:menu:add", "system:menu:edit", "system:menu:del", "system:dept:add",
               "system:dept:edit", "system:dept:del", "system:post:add", "system:post:edit", "system:post:del",
               "system:dict:add", "system:dict:edit", "system:dict:del", "system:config:edit", "system:log:list",
               "system:app:list", "system:app:add", "system:app:edit", "system:app:del"],
}

# 普通员工自助按钮权限
STAFF_BUTTONS = [
    "attendance:clock:add", "attendance:leave:add", "attendance:trip:add", "attendance:remedy:add",
    "assets:requisition:add", "assets:consumable:add", "fleet:application:add",
    "visitor:invitation:add", "conference:booking:add",
]

# 特定角色按业务域追加按钮权限
ROLE_BUTTON_EXTRAS = {
    "security_officer": [b for ps in MODULE_BUTTONS.values() for b in ps if b.startswith("visitor:")],
    "fleet_dispatcher": [b for ps in MODULE_BUTTONS.values() for b in ps if b.startswith(("fleet:", "attendance:trip", "attendance:leave:audit"))],
    "hr": [b for ps in MODULE_BUTTONS.values() for b in ps if b.startswith(("contacts:", "attendance:", "system:dict"))],
}

CATEGORY_NAMES = {
    "PORTAL": "综合门户", "ATTENDANCE": "考勤管理", "ASSETS": "资产耗材", "SUPERVISION": "重点督办",
    "CONFERENCE": "会务管理", "CONTACTS": "组织通讯", "VISITOR": "门禁访客", "FLEET": "公务用车",
    "RESEARCH": "调研管理", "KNOWLEDGE": "智慧知识", "SYSTEM": "系统管理",
}


def _utc(dt: datetime) -> datetime:
    return dt.astimezone(timezone.utc)


async def seed_all(db: AsyncSession, reset: bool = True) -> dict:
    """Create schema and seed demo data. Returns summary counts."""
    if reset:
        await conn_run_drop(db)
    async with db.begin():
        await _seed(db)
    return {"ok": True}


async def conn_run_drop(db: AsyncSession):
    from sqlalchemy import text
    from app.database import engine
    import app.routers.assets  # noqa: F401  ensure router-defined models registered
    async with engine.begin() as conn:
        await conn.execute(text("DROP SCHEMA public CASCADE"))
        await conn.execute(text("CREATE SCHEMA public"))
        try:
            await conn.execute(text("CREATE EXTENSION IF NOT EXISTS btree_gist"))
        except Exception:
            pass  # extension unavailable: application-level conflict checks still enforce booking exclusivity
        await conn.run_sync(Base.metadata.create_all)


async def _seed(db: AsyncSession):
    settings = get_settings()
    now = datetime.now(BUSINESS_TZ)
    today = now.date()

    # ---------- depts ----------
    root = SysDept(dept_id=uuid.UUID("00000000-0000-0000-0000-000000000001"), dept_name="市数字化治理服务中心", parent_id=None, ancestors="0", leader="张明", phone="0571-88008001", order_num=1)
    office = SysDept(dept_id=uuid.UUID("00000000-0000-0000-0000-000000000010"), dept_name="综合办公室", parent_id=root.dept_id, ancestors=f"0,{root.dept_id}", leader="张明", phone="0571-88008010", order_num=1)
    supervision_dept = SysDept(dept_id=uuid.UUID("00000000-0000-0000-0000-000000000020"), dept_name="督查督办室", parent_id=root.dept_id, ancestors=f"0,{root.dept_id}", leader="赵敏", phone="0571-88008020", order_num=2)
    it = SysDept(dept_id=uuid.UUID("00000000-0000-0000-0000-000000000030"), dept_name="信息技术部", parent_id=root.dept_id, ancestors=f"0,{root.dept_id}", leader="王磊", phone="0571-88008030", order_num=3)
    admin = SysDept(dept_id=uuid.UUID("00000000-0000-0000-0000-000000000040"), dept_name="行政管理部", parent_id=root.dept_id, ancestors=f"0,{root.dept_id}", leader="陈静", phone="0571-88008040", order_num=4)
    security = SysDept(dept_id=uuid.UUID("00000000-0000-0000-0000-000000000041"), dept_name="保卫处", parent_id=admin.dept_id, ancestors=f"0,{root.dept_id},{admin.dept_id}", leader="周正安", phone="0571-88008041", order_num=1)
    fleet_dept = SysDept(dept_id=uuid.UUID("00000000-0000-0000-0000-000000000050"), dept_name="机关车队", parent_id=admin.dept_id, ancestors=f"0,{root.dept_id},{admin.dept_id}", leader="刘洋", phone="0571-88008050", order_num=2)
    window = SysDept(dept_id=uuid.UUID("00000000-0000-0000-0000-000000000060"), dept_name="窗口服务处", parent_id=root.dept_id, ancestors=f"0,{root.dept_id}", leader="孙倩", phone="0571-88008060", order_num=5)
    db.add_all([root, office, supervision_dept, it, admin, security, fleet_dept, window])
    await db.flush()

    # ---------- posts ----------
    posts_data = [("BUREAU", "局领导", 1), ("DIRECTOR", "处室正职", 2), ("DEPUTY", "处室副职", 3),
                  ("STAFF", "科员", 4), ("FLEET_DISPATCH", "车队调度员", 5), ("GUARD", "保卫干事", 6),
                  ("ASSET_KEEPER", "资产管理员", 7), ("HR", "人事专员", 8)]
    posts = {code: SysPost(post_code=code, post_name=name, post_sort=sort) for code, name, sort in posts_data}
    db.add_all(posts.values())
    await db.flush()

    # ---------- roles ----------
    role_admin = SysRole(role_name="超级管理员", role_key="admin", role_sort=1, data_scope="1")
    role_leader = SysRole(role_name="部门负责人", role_key="dept_leader", role_sort=2, data_scope="4")
    role_staff = SysRole(role_name="普通员工", role_key="staff", role_sort=3, data_scope="5")
    role_guard = SysRole(role_name="保卫处安保员", role_key="security_officer", role_sort=4, data_scope="3")
    role_dispatcher = SysRole(role_name="车队调度员", role_key="fleet_dispatcher", role_sort=5, data_scope="3")
    role_hr = SysRole(role_name="人事专员", role_key="hr", role_sort=6, data_scope="4")
    db.add_all([role_admin, role_leader, role_staff, role_guard, role_dispatcher, role_hr])
    await db.flush()

    # ---------- menus (all pages, F-level button perms derived) ----------
    menu_map = {}
    for cat, mod_name, pages in PAGES:
        dir_menu = SysMenu(menu_name=mod_name, menu_type="M", top_category=cat, order_num=len(menu_map) + 1, icon="folder")
        db.add(dir_menu)
        await db.flush()
        menu_map[f"M:{cat}"] = dir_menu
        for i, (path, title, icon, perm) in enumerate(pages):
            m = SysMenu(menu_name=title, menu_type="C", top_category=cat, parent_id=dir_menu.menu_id,
                        order_num=i + 1, path=path, icon=icon, perms=perm)
            db.add(m)
            menu_map[path] = m
    await db.flush()
    # bind all menus to leader & dispatcher-ish roles; staff gets PORTAL/CONTACTS/KNOWLEDGE + self pages
    all_menus = list(menu_map.values())
    limited_keys = {"/portal/overview", "/portal/tasks", "/portal/calendar", "/portal/notifications", "/portal/assistant",
                    "/attendance/dashboard", "/attendance/records", "/attendance/leave", "/attendance/trip", "/attendance/remedy",
                    "/contacts/org-chart", "/contacts/employees", "/contacts/partners", "/contacts/experts",
                    "/conference/schedule", "/conference/bookings", "/conference/rooms", "/conference/minutes",
                    "/fleet/applications", "/visitor/invitations", "/knowledge/home", "/knowledge/search", "/knowledge/documents", "/knowledge/graph",
                    "/assets/overview", "/assets/ledger", "/assets/requisition", "/assets/consumables"}
    limited_menus = [menu_map[k] for k in limited_keys if k in menu_map]
    for m in all_menus:
        await db.execute(sys_role_menu.insert().values(role_id=role_admin.role_id, menu_id=m.menu_id))
    for m in all_menus:
        await db.execute(sys_role_menu.insert().values(role_id=role_leader.role_id, menu_id=m.menu_id))
    for m in limited_menus:
        await db.execute(sys_role_menu.insert().values(role_id=role_staff.role_id, menu_id=m.menu_id))
        await db.execute(sys_role_menu.insert().values(role_id=role_guard.role_id, menu_id=m.menu_id))
        await db.execute(sys_role_menu.insert().values(role_id=role_dispatcher.role_id, menu_id=m.menu_id))
        await db.execute(sys_role_menu.insert().values(role_id=role_hr.role_id, menu_id=m.menu_id))
    await db.flush()

    # 按钮级 F 菜单（挂到各模块目录下）并按角色绑定
    role_by_key = {r.role_key: r for r in (role_admin, role_leader, role_staff, role_guard, role_dispatcher, role_hr)}
    button_role_map = {}
    for cat, perms_list in MODULE_BUTTONS.items():
        for perm in perms_list:
            db.add(SysMenu(menu_name=perm, menu_type="F", top_category=cat,
                           parent_id=menu_map[f"M:{cat}"].menu_id, order_num=99, perms=perm))
            button_role_map[perm] = [role_admin, role_leader]
            if perm in STAFF_BUTTONS:
                button_role_map[perm].append(role_staff)
            for rk, extras in ROLE_BUTTON_EXTRAS.items():
                if perm in extras:
                    button_role_map[perm].append(role_by_key[rk])
    await db.flush()
    button_menus = {m.perms: m for m in (await db.execute(
        select(SysMenu).where(SysMenu.menu_type == "F")
    )).scalars().all()}
    for perm, roles in button_role_map.items():
        m = button_menus.get(perm)
        if m:
            for r in roles:
                await db.execute(sys_role_menu.insert().values(role_id=r.role_id, menu_id=m.menu_id))
    await db.flush()

    # ---------- users ----------
    pwd = hash_password("admin123")

    def mk(user_name, nick, dept, sex="0", phone=None):
        return SysUser(user_name=user_name, nick_name=nick, dept_id=dept.dept_id, sex=sex,
                       phonenumber=phone, password_hash=pwd, email=f"{user_name}@agentcom.local")

    u_admin = mk("admin", "系统管理员", office)
    u_admin.roles.append(role_admin)
    u_zhang = mk("zhangming", "张明", office, phone="13805710086")
    u_zhang.roles.append(role_leader)
    u_zhang.posts.append(posts["DIRECTOR"])
    u_li = mk("lihua", "李华", office, sex="1", phone="13905710201")
    u_li.roles.append(role_staff)
    u_li.posts.append(posts["STAFF"])
    u_wang = mk("wanglei", "王磊", it, phone="13905710302")
    u_wang.roles.append(role_leader)
    u_wang.posts.append(posts["DIRECTOR"])
    u_chen = mk("chenjing", "陈静", admin, sex="1", phone="13905710403")
    u_chen.roles.append(role_leader)
    u_chen.posts.append(posts["DIRECTOR"])
    u_liu = mk("liuyang", "刘洋", office, phone="13905710504")
    u_liu.roles.append(role_staff)
    u_liu.posts.append(posts["FLEET_DISPATCH"])
    u_zhao = mk("zhaomin", "赵敏", supervision_dept, sex="1", phone="13905710605")
    u_zhao.roles.append(role_leader)
    u_zhao.posts.append(posts["DIRECTOR"])
    u_zhou = mk("zhouzhengan", "周正安", security, phone="13905710706")
    u_zhou.roles.append(role_guard)
    u_zhou.posts.append(posts["GUARD"])
    u_sun = mk("sunqiang", "孙强", fleet_dept, phone="13905710807")
    u_sun.roles.append(role_dispatcher)
    u_sun.posts.append(posts["FLEET_DISPATCH"])
    u_sunqian = mk("sunqian", "孙倩", window, sex="1", phone="13905710908")
    u_sunqian.roles.append(role_staff)
    u_sunqian.posts.append(posts["HR"])
    db.add_all([u_admin, u_zhang, u_li, u_wang, u_chen, u_liu, u_zhao, u_zhou, u_sun, u_sunqian])
    await db.flush()
    users = {"admin": u_admin, "zhang": u_zhang, "li": u_li, "wang": u_wang, "chen": u_chen,
             "liu": u_liu, "zhao": u_zhao, "zhou": u_zhou, "sun": u_sun, "sunqian": u_sunqian}

    # ---------- dict ----------
    dict_defs = [
        ("请假类型", "att_leave_type", [("ANNUAL", "年假", "primary"), ("SICK", "病假", "info"), ("CASUAL", "事假", "info"), ("COMP", "调休假", "success"), ("MARITAL", "婚假", "success"), ("MATERNITY", "产假", "success")]),
        ("督办紧急度", "sup_priority", [("TOP", "特急", "danger"), ("URGENT", "急", "warning"), ("NORMAL", "常规", "primary")]),
        ("督办状态", "sup_status", [("IN_PROGRESS", "推进中", "primary"), ("YELLOW", "黄码预警", "warning"), ("RED", "红码超期", "danger"), ("CLOSED", "已办结", "success")]),
        ("公车编制类型", "flt_quota_type", [("GENERAL_OFFICIAL", "一般公务用车", "primary"), ("EMERGENCY", "机要通信/应急", "warning"), ("SPECIAL", "调研接待用车", "success")]),
        ("会议性质", "conf_meeting_type", [("PARTY_COMMITTEE", "党组会", "primary"), ("EXECUTIVE", "常务会", "warning"), ("WORK", "工作例会", "info"), ("EXTERNAL", "外部研讨会", "success")]),
        ("访客状态", "vis_status", [("PENDING_HOST", "受访人待确认", "warning"), ("PENDING_SECURITY", "保卫处待审核", "warning"), ("APPROVED", "已发放通行码", "primary"), ("CHECKED_IN", "在院访问中", "success"), ("CHECKED_OUT", "已离场", "info"), ("OVERDUE_STAY", "滞留告警", "danger")]),
        ("调研类型", "rsch_type", [("SPECIAL", "专题调研", "primary"), ("GRASSROOTS", "蹲点走访", "info"), ("SECRET_VISIT", "暗访微调研", "warning")]),
        ("资产状态", "ast_status", [("IN_STOCK", "在库", "info"), ("IN_USE", "在用", "primary"), ("BORROWED", "借出", "warning"), ("IN_REPAIR", "维修中", "danger"), ("SCRAPPED", "已报废", "danger")]),
    ]
    for name, dtype, items in dict_defs:
        t = SysDictType(dict_name=name, dict_type=dtype, remark="演示字典")
        db.add(t)
        await db.flush()
        for i, (v, label, cls) in enumerate(items):
            db.add(SysDictData(dict_type=dtype, dict_label=label, dict_value=v, dict_sort=i + 1, list_class=cls))

    # ---------- configs ----------
    cfgs = [
        ("考勤打卡有效半径（米）", "attendance.clock.radius", "500", "Y"),
        ("访客通行有效时间（小时）", "visitor.pass.valid_hours", "4", "Y"),
        ("访客滞留告警阈值（分钟）", "visitor.overdue.minutes", "30", "Y"),
        ("公车保养里程告警阈值（公里）", "fleet.maintenance.mileage", "5000", "Y"),
        ("油耗异常阈值（升/百公里）", "fleet.fuel.threshold", "15", "Y"),
        ("GBrainKG 知识库地址", "knowledge.gbrainkg.url", settings.gbrainkg_url, "Y"),
    ]
    for n, k, v, t in cfgs:
        db.add(SysConfig(config_name=n, config_key=k, config_value=v, config_type=t))

    # ---------- attendance ----------
    q_types = [("ANNUAL", 5, 1.0), ("SICK", 15, 0), ("CASUAL", 10, 0), ("COMP", 3, 0.5)]
    for key in ("li", "wang", "chen", "liu", "zhao", "zhang"):
        u = users[key]
        for lt, total, used in q_types:
            db.add(AttLeaveQuota(user_id=u.user_id, year=today.year, leave_type=lt, total_days=total, used_days=used))
    # clock records last 15 workdays
    for d in range(15):
        day = today - timedelta(days=d)
        if day.weekday() >= 5:
            continue
        for key, late_prob in (("li", 0.2), ("wang", 0.1), ("chen", 0), ("liu", 0.3), ("zhao", 0), ("zhang", 0)):
            u = users[key]
            base = datetime.combine(day, time(9, 5) if d % 7 == 3 and late_prob else time(8, 52), tzinfo=BUSINESS_TZ)
            db.add(AttClockRecord(user_id=u.user_id, punch_time=_utc(base), punch_type="IN",
                                  status="LATE" if base.time() > time(9, 0) else "NORMAL",
                                  address="机关大院1号楼", location_gps="120.15507,30.27408"))
            db.add(AttClockRecord(user_id=u.user_id, punch_time=_utc(datetime.combine(day, time(18, 4), tzinfo=BUSINESS_TZ)),
                                  punch_type="OUT", status="NORMAL", address="机关大院1号楼"))
    leave_pending = AttLeaveApplication(user_id=users["li"].user_id, leave_type="ANNUAL",
                                        start_time=_utc(datetime.combine(today + timedelta(days=3), time(9, 0), tzinfo=BUSINESS_TZ)),
                                        end_time=_utc(datetime.combine(today + timedelta(days=6), time(18, 0), tzinfo=BUSINESS_TZ)),
                                        duration_days=3, reason="家中老人需要陪护，申请年假三天", audit_status="PENDING")
    leave_approved = AttLeaveApplication(user_id=users["liu"].user_id, leave_type="COMP",
                                         start_time=_utc(datetime.combine(today - timedelta(days=10), time(9, 0), tzinfo=BUSINESS_TZ)),
                                         end_time=_utc(datetime.combine(today - timedelta(days=10), time(18, 0), tzinfo=BUSINESS_TZ)),
                                         duration_days=1, reason="上月底加班调休", audit_status="APPROVED",
                                         approver_id=u_zhang.user_id, audit_comment="情况属实，同意")
    trip_pending = AttTripApplication(user_id=users["liu"].user_id, trip_type="BUSINESS_TRIP", origin="单位总部",
                                      destination="省政务服务中心（杭州）", purpose="参加全省一体化政务服务平台运维协调会",
                                      start_time=_utc(datetime.combine(today + timedelta(days=2), time(9, 0), tzinfo=BUSINESS_TZ)),
                                      end_time=_utc(datetime.combine(today + timedelta(days=3), time(18, 0), tzinfo=BUSINESS_TZ)),
                                      audit_status="PENDING")
    trip_approved = AttTripApplication(user_id=users["wang"].user_id, trip_type="OUTING", origin="单位总部",
                                       destination="高新区数据分中心", purpose="现场检查机房设备运行情况",
                                       start_time=_utc(datetime.combine(today, time(14, 0), tzinfo=BUSINESS_TZ)),
                                       end_time=_utc(datetime.combine(today, time(17, 0), tzinfo=BUSINESS_TZ)),
                                       audit_status="APPROVED", approver_id=u_zhang.user_id)
    remedy_pending = AttPunchRemedy(user_id=users["liu"].user_id, remedy_time=_utc(datetime.combine(today - timedelta(days=1), time(8, 50), tzinfo=BUSINESS_TZ)),
                                    punch_type="IN", reason="考勤机指纹故障，漏打卡一次，有同事见证", audit_status="PENDING")
    db.add_all([leave_pending, leave_approved, trip_pending, trip_approved, remedy_pending])

    # ---------- assets ----------
    cat_elec = AstCategory(category_code="A", category_name="电子设备", order_num=1)
    cat_furn = AstCategory(category_code="B", category_name="办公家具", order_num=2)
    cat_veh = AstCategory(category_code="C", category_name="车辆", order_num=3)
    cat_spec = AstCategory(category_code="D", category_name="专用设备", order_num=4)
    db.add_all([cat_elec, cat_furn, cat_veh, cat_spec])
    await db.flush()
    asset_defs = [
        ("ZC-2026-00001", "笔记本电脑", cat_elec.category_id, "ThinkPad X1", "联想", 12999, office, users["li"], "IN_USE", "1号楼302"),
        ("ZC-2026-00002", "台式电脑", cat_elec.category_id, "OptiPlex 7010", "戴尔", 5499, it, users["wang"], "IN_USE", "1号楼305"),
        ("ZC-2026-00003", "激光打印机", cat_elec.category_id, "HL-2595DW", "兄弟", 2399, office, users["li"], "IN_USE", "1号楼301文印室"),
        ("ZC-2026-00004", "高清投影仪", cat_elec.category_id, "CB-X5000", "爱普生", 6999, office, users["liu"], "IN_STOCK", "1号楼306库房"),
        ("ZC-2026-00005", "视频会议终端", cat_elec.category_id, "DX80", "思科", 18999, it, users["wang"], "IN_USE", "第一会议室"),
        ("ZC-2026-00006", "会议桌（20人）", cat_furn.category_id, "HZ-20A", "圣奥", 15800, office, None, "IN_USE", "第一会议室"),
        ("ZC-2026-00007", "办公椅", cat_furn.category_id, "HY-11", "震旦", 899, office, None, "IN_STOCK", "1号楼306库房"),
        ("ZC-2026-00008", "立式空调", cat_furn.category_id, "KFR-120LW", "格力", 7800, admin, users["chen"], "IN_USE", "2号楼大厅"),
        ("ZC-2026-00009", "复印一体机", cat_elec.category_id, "iR-ADV", "佳能", 21500, admin, users["chen"], "IN_REPAIR", "1号楼文印室"),
        ("ZC-2026-00010", "扫描仪", cat_elec.category_id, "DR-M260", "佳能", 4200, supervision_dept, users["zhao"], "IN_USE", "2号楼201"),
        ("ZC-2026-00011", "执法记录仪", cat_spec.category_id, "DSJ-A5", "警翼", 3200, security, users["zhou"], "IN_USE", "门卫值班室"),
        ("ZC-2026-00012", "人证核验闸机", cat_spec.category_id, "TDB-08", "天地众合", 28600, admin, users["zhou"], "IN_USE", "大院正门"),
        ("ZC-2026-00013", "服务器", cat_elec.category_id, "2288H V5", "华为", 65999, it, users["wang"], "IN_USE", "机房B1"),
        ("ZC-2026-00014", "碎纸机", cat_elec.category_id, "C-380", "得力", 1150, supervision_dept, users["zhao"], "SCRAPPED", "2号楼201"),
    ]
    assets = []
    for code, name, cat, model, brand, price, dept, keeper, status, loc in asset_defs:
        a = AstItemCard(asset_code=code, name=name, category_id=cat, model=model, brand=brand,
                        price=price, current_value=round(price * 0.82, 2), purchase_date=date(today.year - 1, 3, 15),
                        dept_id=dept.dept_id, custodian_user_id=keeper.user_id if keeper else None,
                        status=status, location=loc)
        db.add(a)
        assets.append(a)
    await db.flush()
    req_pending = AstRequisition(req_no="LY-2026-00007", req_type="CLAIM", asset_id=assets[3].asset_id,
                                 user_id=users["wang"].user_id, dept_id=it.dept_id,
                                 reason="下周数字政府专题会需要投影仪备用", audit_status="PENDING")
    req_borrow = AstRequisition(req_no="LY-2026-00005", req_type="BORROW", asset_id=assets[6].asset_id,
                                user_id=users["liu"].user_id, dept_id=office.dept_id,
                                reason="周末机关运动会临时借用办公椅30把", expected_return_date=today + timedelta(days=4),
                                audit_status="APPROVED", approver_id=u_chen.user_id)
    db.add_all([req_pending, req_borrow])
    db.add(AstMaintenanceLog(asset_id=assets[8].asset_id, fault_desc="卡纸频繁，进纸器异响", vendor="佳能特约维修站",
                             cost=0.0, status="IN_REPAIR", reported_by="陈静"))
    db.add(AstStocktakePlan(plan_no="PD-2026-00003", title="三季度机关本部固定资产抽盘", scope_dept_id=root.dept_id,
                            status="IN_PROGRESS", total_count=13, verified_count=9, surplus_count=0, loss_count=0))
    consumable_defs = [
        ("HC-001", "A4复印纸", "办公文具", "70g/500张", "包", 46, 40, 22),
        ("HC-002", "打印机硒鼓", "办公耗材", "HP-88A", "个", 8, 10, 260),
        ("HC-003", "签字笔（黑）", "办公文具", "0.5mm", "盒", 65, 30, 12),
        ("HC-004", "文件夹", "办公文具", "A4双夹", "个", 120, 50, 6.5),
        ("HC-005", "抽杆夹", "办公文具", "A4", "个", 88, 30, 3.2),
        ("HC-006", "茶叶（会议用）", "后勤物资", "100g/罐", "罐", 6, 10, 45),
        ("HC-007", "瓶装饮用水", "后勤物资", "550ml*24", "箱", 3, 10, 35),
        ("HC-008", "一次性纸杯", "后勤物资", "250ml*50", "包", 15, 20, 8),
    ]
    consumables = []
    for code, name, cat, spec, unit, stock, min_stock, price in consumable_defs:
        c = AstConsumable(item_code=code, name=name, category=cat, spec=spec, unit=unit,
                          stock_count=stock, min_stock=min_stock, unit_price=price)
        db.add(c)
        consumables.append(c)
    await db.flush()
    db.add(AstConsumableRequisition(item_id=consumables[0].item_id, user_id=users["li"].user_id,
                                    dept_id=office.dept_id, quantity=5, purpose="三季度综合材料印制", status="PENDING"))

    # ---------- supervision ----------
    def mk_sup(no, title, source, dept, deadline_delta, progress, status, warning, content, priority="NORMAL"):
        return SupTask(supervision_no=no, title=title, source_type=source, priority=priority,
                       lead_dept_id=dept.dept_id, deadline=today + timedelta(days=deadline_delta),
                       progress_pct=progress, status=status, warning_level=warning, content=content,
                       leader_in_charge="张明")

    sup1 = mk_sup("DB-2026-0012", "市区综合环境提升项目", "GOV_REPORT", it, 18, 75, "IN_PROGRESS", "YELLOW",
                  "政府工作报告确定的重点工程，要求年底前完成核心片区环境提升", "URGENT")
    sup2 = mk_sup("DB-2026-0009", "智慧办公系统升级改造", "COUNCIL_DECISION", it, 44, 60, "IN_PROGRESS", "GREEN",
                  "党委会决议事项：办公系统国产化适配与智能升级", "NORMAL")
    sup3 = mk_sup("DB-2026-0007", "机关节能降耗专项行动", "LEADER_INSTRUCTION", admin, -3, 40, "IN_PROGRESS", "RED",
                  "局领导批示：开展节能降耗专项行动，季度末实现能耗下降8%", "TOP")
    sup4 = mk_sup("DB-2026-0015", "窗口服务作风专项督查", "EMERGENCY", window, 9, 85, "CLOSE_PENDING", "GREEN",
                  "针对窗口服务投诉开展的作风建设专项督查")
    sup5 = mk_sup("DB-2026-0003", "档案数字化三年行动中期评估", "GOV_REPORT", supervision_dept, -12, 100, "CLOSED", "GREEN",
                  "档案数字化三年行动方案中期评估事项", "NORMAL")
    sup6 = mk_sup("DB-2026-0016", "基层减负措施落实回头看", "LEADER_INSTRUCTION", office, 25, 30, "EXTENSION_PENDING", "GREEN",
                  "基层减负措施落实情况回头看，牵头处室申请延期", "URGENT")
    db.add_all([sup1, sup2, sup3, sup4, sup5, sup6])
    await db.flush()
    ms1 = SupMilestone(task_id=sup1.task_id, title="完成核心片区拆除清表", due_date=today + timedelta(days=6), progress_pct=90, status="IN_PROGRESS")
    ms2 = SupMilestone(task_id=sup1.task_id, title="完成绿化种植与亮化", due_date=today + timedelta(days=14), progress_pct=55, status="IN_PROGRESS")
    ms3 = SupMilestone(task_id=sup2.task_id, title="国产化适配方案评审", due_date=today - timedelta(days=5), progress_pct=100, status="DONE")
    db.add_all([ms1, ms2, ms3])
    db.add(SupProgressReport(task_id=sup1.task_id, submit_dept_id=it.dept_id, submit_user_id=users["wang"].user_id,
                             period_type="WEEKLY", progress_pct=75,
                             details="本周完成2条主街立面整治，完成率75%。存在困难：管线迁改需电力部门配合。"))
    db.add(SupProgressReport(task_id=sup3.task_id, submit_dept_id=admin.dept_id, submit_user_id=users["chen"].user_id,
                             period_type="WEEKLY", progress_pct=40,
                             details="完成机关食堂、照明节能改造招标。"))
    db.add(SupExtensionRequest(task_id=sup6.task_id, reason="牵头处室人员抽调参加巡察，人手紧张，申请延期两周",
                               old_deadline=today + timedelta(days=11), new_deadline=today + timedelta(days=25),
                               status="PENDING", applicant_name="张明"))
    db.add(SysNotice(user_id=u_zhang.user_id, title="督办任务红码告警", notice_type="URGENT", source_module="supervision",
                     content="【DB-2026-0007】机关节能降耗专项行动已超期未办结，请督促承办单位限期整改。", link="/supervision/warning"))
    db.add(SysNotice(user_id=u_zhang.user_id, title="访客滞留提醒", notice_type="WARNING", source_module="visitor",
                     content="访客钱进已超过预约离场时间30分钟仍未出闸，请协同保卫处核查。", link="/visitor/checkout"))
    db.add(SysNotice(title="系统版本更新通知", notice_type="INFO", content="平台已升级至 v1.2.0，新增智能排座与防撞期检测能力。", link=None))
    db.add(SysNotice(user_id=u_zhang.user_id, title="会议室预订待处理", notice_type="INFO", source_module="conference",
                     content="明天 14:00 第二会议室申请预订需要您审批。", link="/conference/bookings"))

    # ---------- conference ----------
    room1 = ConfRoom(name="第一会议室", capacity=20, min_capacity=5, max_capacity=24, location="2号楼3层",
                     amenities=["投影", "音响", "视频会议", "席卡打印"], department_id=office.dept_id)
    room2 = ConfRoom(name="第二会议室", capacity=8, min_capacity=2, max_capacity=10, location="2号楼3层",
                     amenities=["白板", "电视"], department_id=office.dept_id)
    room3 = ConfRoom(name="第三会议室", capacity=15, min_capacity=3, max_capacity=18, location="1号楼5层",
                     amenities=["投影", "录音"], department_id=office.dept_id)
    room_big = ConfRoom(name="大型多功能厅", capacity=120, min_capacity=30, max_capacity=150, location="综合楼1层",
                        amenities=["LED大屏", "音响", "直播推流", "同传"], department_id=admin.dept_id)
    room_vip = ConfRoom(name="外宾接待室", capacity=6, min_capacity=2, max_capacity=8, location="1号楼2层",
                        amenities=["茶歇", "投影"], department_id=admin.dept_id)
    db.add_all([room1, room2, room3, room_big, room_vip])
    await db.flush()
    def mk_booking(room, start_h, end_h, title, day_offset, count, user):
        start = _utc(datetime.combine(today + timedelta(days=day_offset), time(start_h), tzinfo=BUSINESS_TZ))
        end = _utc(datetime.combine(today + timedelta(days=day_offset), time(end_h), tzinfo=BUSINESS_TZ))
        return ConfBooking(room_id=room.id, user_id=user.user_id, title=title, during=Range(start, end),
                           attendee_count=count, status="CONFIRMED", host_name=user.nick_name)
    b1 = mk_booking(room1, 9, 10, "党组会议", 0, 12, u_zhang)
    b2 = mk_booking(room3, 16, 17, "专项督办协调会", 0, 8, u_zhao)
    b3 = mk_booking(room2, 14, 15, "信息技术部周例会", 0, 6, u_wang)
    b4 = mk_booking(room1, 10, 12, "全市数字政务推进会", 1, 45, u_chen)
    b5 = mk_booking(room2, 14, 15, "资产盘点方案讨论", 1, 5, u_chen)
    b6 = mk_booking(room_big, 9, 12, "智慧城市产业研讨会", 3, 110, u_wang)
    db.add_all([b1, b2, b3, b4, b5, b6])
    await db.flush()
    affair1 = ConfAffair(booking_id=b1.id, title="党组会议", meeting_type="PARTY_COMMITTEE", security_level="NORMAL",
                         agenda_text="一、传达上级文件精神\n二、审议智慧办公升级方案\n三、研究干部人事事项")
    db.add(affair1)
    await db.flush()
    att_data = [("张明", "综合办公室", "处室正职", "CONFIRMED", None), ("王磊", "信息技术部", "处室正职", "CONFIRMED", None),
                ("陈静", "行政管理部", "处室正职", "CONFIRMED", None), ("赵敏", "督查督办室", "处室正职", "CONFIRMED", None),
                ("李华", "综合办公室", "科员", "DEPUTY", "钱芳"), ("刘洋", "机关车队", "调度员", "LEAVE", None)]
    seat_rule = ["03号", "01号", "02号", "04号", "05号", "06号"]
    for i, (name, dept, post, st, deputy) in enumerate(att_data):
        db.add(ConfAttendee(affair_id=affair1.affair_id, name=name, dept_name=dept, post_name=post,
                            attendance_status=st, deputy_name=deputy, seat_label=seat_rule[i] if st != "LEAVE" else None))
    db.add(ConfServiceTicket(booking_id=b1.id, service_type="TEA", assignee_name="李华", status="COMPLETED", notes="矿泉水12瓶"))
    db.add(ConfServiceTicket(booking_id=b1.id, service_type="AV_PROJECTOR", assignee_name="王磊", status="PROCESSING", notes="会前调试"))
    db.add(ConfServiceTicket(booking_id=b4.id, service_type="LED_BANNER", status="PENDING", notes="欢迎横幅：热烈欢迎各位领导莅临指导"))
    minutes1 = ConfMinutes(booking_id=b1.id, author_id=u_zhang.user_id,
                           content="# 党组会议纪要\n\n## 议定事项\n1. 原则同意智慧办公系统升级方案，由信息技术部牵头实施。\n2. 秋季安全大检查由行政管理部负责组织。")
    db.add(minutes1)
    await db.flush()
    db.add(ConfActionItem(minutes_id=minutes1.id, booking_id=b1.id,
                          task_description="推进智慧办公系统升级改造，年内完成国产化适配",
                          assignee_name="王磊", due_date=_utc(datetime.combine(today + timedelta(days=44), time(18, 0), tzinfo=BUSINESS_TZ)),
                          status="PENDING", converted_supervision_id=sup2.task_id))
    db.add(ConfActionItem(minutes_id=minutes1.id, booking_id=b1.id,
                          task_description="组织秋季机关安全大检查并形成整改台账",
                          assignee_name="陈静", due_date=_utc(datetime.combine(today + timedelta(days=20), time(18, 0), tzinfo=BUSINESS_TZ)),
                          status="PENDING"))

    # ---------- contacts ----------
    partner_defs = [
        ("省政务服务管理办公室", "GOV_PEER", "马建国", "0571-87052100", "上级业务指导部门", "发文对接,数据共享"),
        ("市大数据局", "GOV_PEER", "林晓峰", "0571-87052200", "数据共享与云资源保障单位", "数据共享,项目协同"),
        ("市保密局", "GOV_PEER", "郑卫东", "0571-87052300", "保密工作指导与检查", "保密检查,培训"),
        ("华为技术有限公司（杭州办）", "SUPPLIER", "高翔", "13858001234", "信息化核心供应商", "运维保障,采购"),
        ("市经济与社会发展研究院", "THINKTANK", "范教授", "13958005678", "数字化转型智库支撑单位", "课题研究,专家评审"),
        ("市消防救援支队", "EMERGENCY", "值班室", "0571-87052600", "消防应急联动单位", "应急联动"),
    ]
    for unit, ptype, contact, phone, notes, tags in partner_defs:
        db.add(CtExternalPartner(unit_name=unit, partner_type=ptype, contact_name=contact, phone=phone, notes=notes, tags=tags))
    expert_defs = [
        ("钱学敏", "教授/博导", "浙江大学公共管理学院", "数字政府", "13958009001", "NATIONAL"),
        ("吴刚", "高级工程师", "省信息化发展研究院", "网络安全", "13958009002", "PROVINCIAL"),
        ("郑一鸣", "研究员", "市经济发展研究院", "财政审计", "13958009003", "MUNICIPAL"),
        ("冯丽华", "教授级高工", "省城乡规划设计院", "规划建设", "13958009004", "PROVINCIAL"),
        ("陈立群", "特聘顾问", "中国行政管理学会", "基层治理", "13958009005", "NATIONAL"),
        ("许文强", "高级顾问", "市法学会", "依法行政", "13958009006", "MUNICIPAL"),
    ]
    for name, title, org, field_, phone, level in expert_defs:
        db.add(CtExpert(name=name, title=title, organization=org, field_domain=field_, phone=phone, level=level,
                        bio=f"长期从事{field_}领域研究与实践"))

    # ---------- visitors ----------
    vis1 = VisAppointment(visitor_name="钱进", visitor_phone="13968001234", id_card_number="330106198001012345",
                          company="XX科技有限公司", car_plate="浙A·8D2K6", visit_reason="数字政务项目对接洽谈",
                          host_user_id=u_zhang.user_id,
                          scheduled_start=_utc(datetime.combine(today, time(14, 0), tzinfo=BUSINESS_TZ)),
                          scheduled_end=_utc(datetime.combine(today, time(16, 0), tzinfo=BUSINESS_TZ)),
                          access_code="AC1A2B3C4D", status="CHECKED_IN",
                          check_in_time=_utc(datetime.combine(today, time(13, 52), tzinfo=BUSINESS_TZ)),
                          pass_floor_permit="1F,3F")
    vis2 = VisAppointment(visitor_name="吴敏", visitor_phone="13968005678", id_card_number="330108198505052354",
                          company="省政务办", visit_reason="全省平台运维协调会参会",
                          host_user_id=u_zhang.user_id,
                          scheduled_start=_utc(datetime.combine(today + timedelta(days=1), time(9, 30), tzinfo=BUSINESS_TZ)),
                          scheduled_end=_utc(datetime.combine(today + timedelta(days=1), time(12, 0), tzinfo=BUSINESS_TZ)),
                          access_code="AC5E6F7G8H", status="PENDING_SECURITY", pass_floor_permit="1F,3F,5F")
    vis3 = VisAppointment(visitor_name="郑海涛", visitor_phone="13968009012", company="网络安全测评中心",
                          visit_reason="等级保护测评现场核查",
                          host_user_id=u_wang.user_id,
                          scheduled_start=_utc(datetime.combine(today + timedelta(days=2), time(10, 0), tzinfo=BUSINESS_TZ)),
                          scheduled_end=_utc(datetime.combine(today + timedelta(days=2), time(12, 0), tzinfo=BUSINESS_TZ)),
                          access_code="AC9K2M4N6P", status="PENDING_HOST", pass_floor_permit="1F,B1")
    vis4 = VisAppointment(visitor_name="孙丽", visitor_phone="13968003456", company="市档案局",
                          visit_reason="档案数字化验收交流",
                          host_user_id=u_zhao.user_id,
                          scheduled_start=_utc(datetime.combine(today - timedelta(days=1), time(9, 0), tzinfo=BUSINESS_TZ)),
                          scheduled_end=_utc(datetime.combine(today - timedelta(days=1), time(11, 0), tzinfo=BUSINESS_TZ)),
                          access_code="AC7Q8R9S0T", status="CHECKED_OUT",
                          check_in_time=_utc(datetime.combine(today - timedelta(days=1), time(8, 55), tzinfo=BUSINESS_TZ)),
                          check_out_time=_utc(datetime.combine(today - timedelta(days=1), time(10, 48), tzinfo=BUSINESS_TZ)))
    vis5 = VisAppointment(visitor_name="何伟", visitor_phone="13968007890", company="设备维保单位",
                          visit_reason="机房精密空调巡检维保",
                          host_user_id=u_wang.user_id,
                          scheduled_start=_utc(datetime.combine(today, time(9, 0), tzinfo=BUSINESS_TZ)),
                          scheduled_end=_utc(datetime.combine(today, time(11, 0), tzinfo=BUSINESS_TZ)),
                          access_code="ACU1V3W5X7", status="OVERDUE_STAY",
                          check_in_time=_utc(datetime.combine(today, time(8, 58), tzinfo=BUSINESS_TZ)),
                          pass_floor_permit="B1")
    db.add_all([vis1, vis2, vis3, vis4, vis5])
    db.add_all([
        VisBlacklist(name="冯某", phone="13000000001", reason="多次无理缠访闹访，列入重点关注名单"),
        VisBlacklist(name="卫某", phone="13000000002", reason="推销骚扰、假冒记者", ),
        VisBlacklist(name="吕某", id_card_number="330106197505051234", reason="失信被执行人，涉诉在身"),
    ])

    # ---------- fleet ----------
    veh_defs = [
        ("浙AD5120", "丰田考斯特 23座", 23, "SPECIAL", "AVAILABLE", "院内1号位", "OC-1101", 48600),
        ("浙AD5215", "红旗H9 5座", 5, "GENERAL_OFFICIAL", "AVAILABLE", "院内2号位", "OC-1102", 22100),
        ("浙AD5336", "别克GL8 7座", 7, "GENERAL_OFFICIAL", "AVAILABLE", "院内3号位", "OC-1103", 35800),
        ("浙AD5470", "大众帕萨特 5座", 5, "EMERGENCY", "DISPATCHED", "院内4号位", "OC-1104", 18900),
        ("浙AD5528", "依维柯 17座", 17, "GENERAL_OFFICIAL", "MAINTENANCE", "院内5号位", "OC-1105", 62300),
        ("浙AD5639", "比亚迪秦PLUS 5座", 5, "GENERAL_OFFICIAL", "AVAILABLE", "院内6号位", "OC-1106", 9800),
    ]
    vehicles = []
    for plate, model, seats, quota, status, spot, card, mileage in veh_defs:
        v = FltVehicle(plate_no=plate, brand_model=model, seat_count=seats, quota_type=quota, status=status,
                       designated_parking_spot=spot, fuel_card_no=card, current_mileage=mileage,
                       insurance_expire_date=today + timedelta(days=25 if plate == "浙AD5215" else 200),
                       annual_inspection_date=today + timedelta(days=18 if plate == "浙AD5470" else 300))
        db.add(v)
        vehicles.append(v)
    await db.flush()
    drv_defs = [("孙强", "13905710807", "A1", "ON_DUTY", 620000), ("马师傅", "13905711111", "A2", "ON_DUTY", 480000),
                ("朱师傅", "13905712222", "B1", "DISPATCHED", 390000), ("胡师傅", "13905713333", "C1", "OFF_DUTY", 150000)]
    drivers = []
    for name, phone, lic, status, mileage in drv_defs:
        d = FltDriver(name=name, phone=phone, license_type=lic, status=status, safe_mileage=mileage)
        db.add(d)
        drivers.append(d)
    await db.flush()
    app_pending = FltApplication(applicant_id=users["liu"].user_id, dept_id=office.dept_id,
                                 purpose="赴市政务服务中心对接一体化平台运维事项", trip_type="OFFICIAL_BUSINESS",
                                 origin="机关大院", destination="市政务服务中心", passenger_count=3,
                                 start_time=_utc(datetime.combine(today + timedelta(days=1), time(9, 0), tzinfo=BUSINESS_TZ)),
                                 end_time=_utc(datetime.combine(today + timedelta(days=1), time(12, 0), tzinfo=BUSINESS_TZ)),
                                 status="DEPT_PENDING")
    app_approved = FltApplication(applicant_id=users["zhao"].user_id, dept_id=supervision_dept.dept_id,
                                  purpose="赴高新区开展重点督查现场核查", trip_type="LEADERSHIP_RESEARCH",
                                  origin="机关大院", destination="高新区管委会", leader_name="张明",
                                  passenger_count=4,
                                  start_time=_utc(datetime.combine(today, time(14, 0), tzinfo=BUSINESS_TZ)),
                                  end_time=_utc(datetime.combine(today, time(17, 30), tzinfo=BUSINESS_TZ)),
                                  status="DISPATCHED")
    db.add_all([app_pending, app_approved])
    await db.flush()
    dispatch1 = FltTripDispatch(app_id=app_approved.app_id, vehicle_id=vehicles[3].vehicle_id, driver_id=drivers[2].driver_id,
                                start_mileage=vehicles[3].current_mileage, status="DISPATCHED", notes="出车前车况检查正常")
    db.add(dispatch1)
    await db.flush()
    app_done = FltApplication(applicant_id=users["wang"].user_id, dept_id=it.dept_id,
                              purpose="赴省政务办报送数据对接材料", trip_type="OFFICIAL_BUSINESS",
                              origin="机关大院", destination="省政务办", passenger_count=2,
                              start_time=_utc(datetime.combine(today - timedelta(days=2), time(9, 0), tzinfo=BUSINESS_TZ)),
                              end_time=_utc(datetime.combine(today - timedelta(days=2), time(17, 0), tzinfo=BUSINESS_TZ)),
                              status="COMPLETED")
    db.add(app_done)
    await db.flush()
    dispatch2 = FltTripDispatch(app_id=app_done.app_id, vehicle_id=vehicles[1].vehicle_id, driver_id=drivers[0].driver_id,
                                start_mileage=vehicles[1].current_mileage - 86.5, end_mileage=vehicles[1].current_mileage,
                                toll_cost=35.0, fuel_cost=62.0, status="RETURNED",
                                actual_return_time=_utc(datetime.combine(today - timedelta(days=2), time(17, 40), tzinfo=BUSINESS_TZ)),
                                notes="行程正常，过路费已登记")
    db.add(dispatch2)
    db.add(FltMaintenanceLog(vehicle_id=vehicles[4].vehicle_id, log_type="MAINTENANCE", mileage_at_service=62000,
                             cost=1280.0, vendor="定点维保厂", next_due_date=today + timedelta(days=90),
                             notes="更换机油机滤，刹车片检查"))
    db.add(FltMaintenanceLog(vehicle_id=vehicles[1].vehicle_id, log_type="INSURANCE", mileage_at_service=22050,
                             cost=4200.0, vendor="人保财险", next_due_date=today + timedelta(days=25),
                             notes="交强险+商业险续保"))
    db.add(FltFuelLog(vehicle_id=vehicles[1].vehicle_id, fuel_date=today - timedelta(days=2), station="机关定点加油站",
                      liters=8.7, cost=68.0, mileage_at_fuel=22013.5))
    db.add(FltFuelLog(vehicle_id=vehicles[1].vehicle_id, fuel_date=today - timedelta(days=10), station="中石化XX加油站",
                      liters=42.0, cost=330.0, mileage_at_fuel=21930.0, is_abnormal=False))
    db.add(FltFuelLog(vehicle_id=vehicles[0].vehicle_id, fuel_date=today - timedelta(days=5), station="郊区某私营加油站",
                      liters=90.0, cost=720.0, mileage_at_fuel=48500.0, is_abnormal=True, abnormal_reason="非定点加油，请车队核查"))

    # ---------- research ----------
    topic1 = RschTopic(topic_no="DY-2026-006", title="基层政务服务便民化专项调研", field_domain="基层治理",
                       leader_name="张明", lead_dept_id=office.dept_id, escort_members="李华、刘洋",
                       start_date=today, end_date=today + timedelta(days=2), research_type="SPECIAL",
                       status="IN_PROGRESS")
    topic2 = RschTopic(topic_no="DY-2026-007", title="数字经济产业政策落实蹲点调研", field_domain="经济与产业",
                       leader_name="王磊", lead_dept_id=it.dept_id, escort_members="孙倩",
                       start_date=today + timedelta(days=1), end_date=today + timedelta(days=2),
                       research_type="GRASSROOTS", status="PLANNED")
    topic3 = RschTopic(topic_no="DY-2026-004", title="机关运行保障标准化暗访调研", field_domain="基层治理",
                       leader_name="陈静", lead_dept_id=admin.dept_id, escort_members="周正安",
                       start_date=today - timedelta(days=20), end_date=today - timedelta(days=18),
                       research_type="SECRET_VISIT", status="COMPLETED", summary_report="形成暗访问题清单9项，已转办7项。")
    db.add_all([topic1, topic2, topic3])
    await db.flush()
    p1 = RschRoutePoint(topic_id=topic1.topic_id, point_name="XX区政务服务中心", point_address="XX区光明路100号",
                        scheduled_date=today, contact_person="钱主任", contact_phone="13906712001")
    p2 = RschRoutePoint(topic_id=topic1.topic_id, point_name="临江街道便民服务中心", point_address="临江街道育才路8号",
                        scheduled_date=today + timedelta(days=1), contact_person="孙主任")
    p3 = RschRoutePoint(topic_id=topic2.topic_id, point_name="高新区重点实验室", point_address="高新区科创大道88号",
                        scheduled_date=today + timedelta(days=1), contact_person="高工", conflict_detected=True)
    db.add_all([p1, p2, p3])
    topic2.has_conflict = True
    issue1 = RschIssueLog(topic_id=topic1.topic_id, point_name="XX区政务服务中心",
                          issue_title="综合窗口授权不到位，高频事项仍需多头跑",
                          description="现场发现不动产登记与水电气过户仍需分别取号，建议推进一件事一次办集成改革。",
                          target_dept_id=window.dept_id, status="LOGGED")
    issue2 = RschIssueLog(topic_id=topic1.topic_id, point_name="临江街道便民服务中心",
                          issue_title="自助终端利用率低，适老化改造滞后",
                          description="大厅自助终端日均使用不足10人次，老年群体引导服务缺失。",
                          target_dept_id=window.dept_id, status="LOGGED")
    issue3 = RschIssueLog(topic_id=topic3.topic_id, point_name="机关食堂",
                          issue_title="反食品浪费宣传标识不足",
                          description="食堂取餐区未见适量取餐提示标识。",
                          target_dept_id=admin.dept_id, status="RECTIFIED")
    db.add_all([issue1, issue2, issue3])

    # ---------- knowledge ----------
    doc_defs = [
        ("中央八项规定实施细则（节选）", "政策法规", "中办发〔2026〕8号", "中共中央办公厅", "改进调查研究、精简会议活动、厉行勤俭节约等具体要求。", "八项规定,作风建设,勤俭节约"),
        ("党政机关公务用车管理办法", "政策法规", "国管〔2023〕118号", "国家机关事务管理局", "公务用车编制、配备更新、使用管理与监督要求，严禁公车私用。", "公务用车,编制管理,八项规定"),
        ("党政机关督查工作条例（试行）", "政策法规", "中办发〔2025〕21号", "中共中央办公厅", "督查立项、分办、督办、三色预警、办结销号与通报的规范流程。", "督查督办,三色预警,销号"),
        ("机关财务报销规程", "制度规程", "JG-CW-2026-02", "综合办公室", "差旅费、会议费、公务接待费报销标准与审批流程。", "财务,报销,差旅费"),
        ("公务用车使用管理细则", "制度规程", "JG-CW-2026-05", "机关车队", "用车申请三级审批、派车单、里程核销与定点加油管理细则。", "公务用车,派车,油耗"),
        ("保密纪律与涉密载体管理规定", "制度规程", "JG-BM-2026-01", "综合办公室", "涉密文件流转、存储、销毁与计算机使用保密要求。", "保密,涉密,安全"),
        ("年度重点督查通报（第一期）", "成果档案", "DBTB-2026-01", "督查督办室", "一季度各单位督办任务推进情况通报，2家单位黄牌预警。", "督查通报,黄牌"),
        ("大兴调查研究工作方案", "政策法规", "中办发〔2023〕33号", "中共中央办公厅", "在全党大兴调查研究的工作要求：课题统筹、防止扎堆、成果转化。", "调查研究,防撞期,成果转化"),
        ("优秀调研成果汇编（2025）", "成果档案", "DYCG-2025", "督查督办室", "年度优秀调研报告12篇，含基层治理与营商环境专题。", "调研报告,汇编"),
        ("会议室管理与会务保障规范", "制度规程", "JG-HW-2026-03", "综合办公室", "会议室预订、排座礼仪、席卡制作与会务保障派工规范。", "会议室,排座,会务保障"),
    ]
    for title, cat, no, org, content, kw in doc_defs:
        db.add(KnbDocument(title=title, category=cat, doc_no=no, source_org=org,
                           content=content + "\n（此处为演示正文节选……）", keywords=kw,
                           publish_date=date(today.year - 1, 6, 1), view_count=20 + no.__hash__() % 180))

    # ---------- oper logs ----------
    log_defs = [
        ("督办立项", "supervision:task:add", "POST", "张明", "/api/supervision/tasks", "0", 120),
        ("会议室预订", "conference:booking:add", "POST", "陈静", "/api/conference/bookings", "0", 85),
        ("用车申请提交", "fleet:application:add", "POST", "刘洋", "/api/fleet/applications", "0", 66),
        ("用户登录", "auth:login", "POST", "赵敏", "/api/auth/login", "0", 45),
        ("资产领用审批", "assets:requisition:audit", "POST", "陈静", "/api/assets/requisitions", "0", 92),
        ("角色权限修改", "system:role:edit", "PUT", "admin", "/api/system/roles", "0", 158),
    ]
    for title, method, rm, name, url, status, cost in log_defs:
        db.add(SysOperLog(title=title, business_type="2", method=method, request_method=rm,
                          oper_name=name, oper_url=url, oper_ip="192.168.1.66", status=int(status),
                          cost_time=cost, oper_time=_utc(now - timedelta(hours=len(log_defs)))))

    # ---------- agent credential ----------
    db.add(SysAppCredential(
        app_id="agentcom-demo", app_secret_hash=hash_password("agentcom-demo-secret-2026"),
        app_name="演示智能体", description="内置演示凭据，scopes=*，可用于 MCP 工具联调",
        scopes="*", rate_limit_per_minute=600, created_by="admin",
    ))
    await db.flush()
