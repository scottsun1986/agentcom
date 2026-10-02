import json, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent
previous = json.loads((ROOT/'manifest.json').read_text()) if (ROOT/'manifest.json').exists() else {}
previous_pages = {p['route']: p for p in previous.get('pages', [])}
source = (ROOT.parent / 'docs/企业与政务协同办公管理平台需求说明书.md').read_text()
nav = ['综合门户','考勤管理','资产耗材','重点督办','会务管理','组织通讯','门禁访客','公务用车','调研管理','智慧知识','系统管理']
groups = {'attendance':'考勤管理','assets':'资产耗材','supervision':'重点督办','conference':'会务管理','contacts':'组织通讯','visitor':'门禁访客','fleet':'公务用车','research':'调研管理','system':'系统管理'}
pages = [dict(title='工作总览',route='/portal/overview',category='综合门户',description='待办审批、今日会议、重点督办、预警，个人工作台、跨模块协同链路。',layout='Four KPI cards, pending approval table, today agenda, progress bars and cross-module activity chain.')]
extras = [
 ('我的待办','/portal/tasks','综合门户','跨模块待审批、待执行、已处理清单，来源模块、处理人、截止时间，审批详情和处理意见。','Main pending tasks table left, selected leave approval detail panel right with workflow timeline, reason, attachment, approve/reject buttons.'),
 ('协同日程','/portal/calendar','综合门户','个人与部门日程、会议、调研、出差与用车联动，冲突提示。','Large weekly calendar with time columns, blue meeting blocks, teal research blocks, small agenda right and visible clash alert.'),
 ('消息通知','/portal/notifications','综合门户','审批提醒、红黄预警、会议通知、系统通知、已读未读。','Notification list with category filter pills, unread blue dots, preview of selected supervision notice and link to business object.'),
 ('智能助手','/portal/assistant','综合门户','自然语言发起跨模块协同，显示查询结果、执行计划、权限边界、确认动作与执行反馈。','Chat workspace with conversation left and reviewable plan right: meeting room booking, seating, visitor invitation. Clear 待确认 status and 确认执行 button before writes, tool result cards after steps.'),
]
pages.extend(dict(title=t,route=r,category=c,description=d,layout=l) for t,r,c,d,l in extras)
pattern = re.compile(r'^\d+\. \*\*([^\n]*?)\*\* \(`([^`]+)`\)：(.*?)(?=^\d+\. \*\*|^####|^---|^###)',re.M|re.S)
for m in pattern.finditer(source):
    title, route, desc = m.groups()
    group=route.strip('/').split('/')[0]
    if group not in groups: continue
    desc=re.sub(r'`|\*|\$|\\rightarrow','',desc).strip()
    pages.append(dict(title=title,route=route,category=groups[group],description=desc,layout=''))
knowledge = [
 ('知识工作台','/knowledge/home','政策法规、机关制度、讲话汇编、调研督办成果四类知识，统一检索，最近阅读，图谱入口。','Large compact search box, four library cards, recent document table and recommended reading sidebar. Embedded GBrainKG content retains AgentCom global shell.'),
 ('知识检索','/knowledge/search','语义与关键词混合检索，知识分类、时间、来源过滤，相关性与来源溯源。','Search query 公务用车审批流程, results with snippets, source badges, document dates, left category filters and related entities right.'),
 ('知识文档','/knowledge/documents','政企知识正文阅读、来源、更新时间、访问权限、关联实体与引用。','Three columns: library folder tree, formal readable policy document, related entities and source metadata. Breadcrumb, download and collect actions. Faint watermark.'),
 ('知识图谱','/knowledge/graph','GBrainKG知识图谱切片，实体关系探索，选中节点展示依据文档，图谱与向量召回。','Large center knowledge graph with labeled nodes 公务用车、审批流程、调研活动、办公室、管理制度; left categories and search, right selected node evidence panel with source documents. Legible sparse node network.'),
]
pages.extend(dict(title=t,route=r,category='智慧知识',description=d,layout=l) for t,r,d,l in knowledge)
pages.append(dict(title='账号登录',route='/login',category='身份入口',description='政企统一身份登录、账号密码、单点登录、验证码、忘记密码入口。',layout='No application navigation. Full clean 16:9 login screenshot, left navy branded AgentCom panel with understated abstract network lines, right white login card with Chinese title 欢迎登录, organization name, account password verification fields, 登录 button, 统一身份登录, remember me. No invented certifications.'))

layouts = {
 '/attendance/dashboard':'Today clock-in card with 上班08:52 and 下班待打卡, 2026 October monthly attendance calendar colored statuses, leave balance card and recent anomalies.',
 '/attendance/records':'Detailed attendance records table: employee, department, time, 上班/下班, GPS/WiFi, normal/late, plus selected record with small field photo and verification summary.',
 '/attendance/leave':'Leave balance cards 年假8天 调休12小时, leave request table, right drawer new leave application showing leave type, dates, balance check, attachment and multilevel approval timeline.',
 '/attendance/trip':'Business trip requests table left; right selected request with dates, route, colleagues, approvals and blue banner 审批通过后自动免打卡; linked vehicle application.',
 '/attendance/remedy':'Missing-clock anomalies table with yellow badges, right correction form with date, replacement clock time, reason, evidence and supervisor approval.',
 '/attendance/monthly-settlement':'Wide monthly employee matrix with attendance days, late counts, leave hours, trip days, total hours; summary cards; month selector; 锁定月账 and 导出归档.',
 '/attendance/rules':'Attendance group list left, rule editor right with fixed/flexible shift tabs, time range, break rules, GPS radius map card and WiFi BSSID fields.',
 '/assets/overview':'Four asset-value KPI cards, lifecycle donut, department asset bar chart, low consumables alert table and recent asset movements.',
 '/assets/ledger':'Asset ledger table with unique code, category, model, original/net value, keeper, location and status; right asset card showing QR code and lifecycle timeline.',
 '/assets/inbound':'Inbound batch list and purchase acceptance form with contract attachment, equipment table, validation summary and buttons 生成资产卡片 and 打印标签.',
 '/assets/requisition':'Requisition and return tabs, pending application table, selected application approval steps 申请→审批→派发→签收 and receipt action.',
 '/assets/borrow':'Borrowed asset table with expected return dates, yellow due-soon and red overdue status; return inspection drawer, condition and photo evidence.',
 '/assets/transfer':'Cross-department transfer list, selected transfer source/target department cards, responsible keeper change, dual countersign workflow and handover receipt.',
 '/assets/maintenance':'Repair jobs kanban 待受理/维修中/待验收/已完成 with repair cost summary, selected repair detail and service provider assignment.',
 '/assets/stocktake':'Stocktake progress KPI matched/unscanned/surplus/shortage, scan input panel, discrepancy table, action 导出差异报告 and 调账审批.',
 '/assets/depreciation-scrap':'Tabs 折旧计提/报废处置; monthly depreciation table, selected disposal detail with appraisal file, multistage approval and residual-value recovery.',
 '/assets/consumables':'Consumable inventory table with current stock, safety minimum, department quota, low-stock alerts, mini stock trends and replenishment suggestions.',
 '/supervision/dashboard':'Same light management shell, large compact command dashboard, 4 KPIs, red yellow blue warning distribution, completion trend, department leaderboard and priority task list. Use BLUE normal, YELLOW due, RED overdue consistently, show word labels.',
 '/supervision/standing':'Supervision projects table plus new project form with source, auto编号, urgency, lead/cooperating department and total deadline.',
 '/supervision/decomposition':'Wide true Gantt chart with left work breakdown tree, labeled horizontal timebars and diamond milestones, responsible person and deadline columns. Detail inspector right.',
 '/supervision/reporting':'Progress submission editor with percent slider, key advances, obstacles, coordination requests and evidence attachments; historical weekly updates timeline.',
 '/supervision/warning':'Blue/yellow/red filter cards labeled 正常推进/临期预警/超期告警, warning table with deadline/overdue days, selected 催办通知 preview and 下发催办 button.',
 '/supervision/extension':'Extension requests table; selected original vs requested deadline, explanation, evidence and review timeline 督查室→分管领导.',
 '/supervision/closeout':'Closeout queue left; selected task evidence files and field verification checklist center; signoff timeline right, 退回补充 and 审签销号 buttons.',
 '/supervision/bulletin':'Report generation controls by week/month/quarter, department score table left and formal 督查通报 document preview right with Word/PDF export.',
 '/conference/schedule':'Large room-by-time Gantt calendar for 08:00-18:00, meeting blocks spanning columns, room availability legend, date switch and 新建预订.',
 '/conference/rooms':'Meeting room cards with room names, building/floor, capacity and equipment icons, open/closed badges, selected editable room configuration.',
 '/conference/bookings':'Booking list and reservation drawer with room/time/attendee count, visible conflict precheck result 時段可用, alternate room options and approval steps.',
 '/conference/affairs':'Selected formal meeting planning workspace: meeting nature, classification, agenda editable timeline, budget summary, preparation checklist.',
 '/conference/attendees':'Attendance RSVP KPI 应邀/已回执/请假/代会, roster with notice delivery, confirmation, substitutes, resend actions.',
 '/conference/seating':'Large visual seating editor with a stage 主席台, symmetrical podium seat labels and audience rows, left attendee list, right rank-rule inspector with 以中为尊/前排为尊/左为上, actions 自动排座 and 打印席卡.',
 '/conference/services':'Service work-order board columns 待派工/进行中/待验收/已完成 for 音视频/茶歇/空调/LED, assigned staff avatars, deadlines and acceptance checklist.',
 '/conference/checkin':'Meeting check-in operations screen retaining slim same navy top shell, big 应到120/实到108/缺席12 counters, big center check-in QR with meeting title, recent check-ins list and attendee grid. Camera status indicator.',
 '/conference/minutes':'Document collaboration editor with title and paragraph content, version v3 badge, action items right with assignees/deadlines, version timeline and 保存版本.',
 '/conference/minutes-to-supervision':'Two-pane conversion workspace: checklist of meeting decisions left, supervision project form right, source meeting retained, lead department/deadline required, 生成督办单.',
 '/contacts/org-chart':'Expandable department tree left, large organization chart cards center with responsible leader and headcount, selected department inspector right.',
 '/contacts/employees':'Department tree left and employee roster table center with name, ID, post, phone masked, extension, office and responsibilities; employee profile drawer.',
 '/contacts/privacy-mask':'Privacy policy matrix by role/field, leader masked contacts preview, access restriction controls and watermark settings. Never show real full sensitive numbers.',
 '/contacts/partners':'External unit directory left grouped 上级部门/协作单位/应急联动, contact cards/list center with work responsibility and masked phone, selected organization detail.',
 '/contacts/experts':'Expert search with discipline tag chips, clean expert profile cards with specialty, institution, review experience and masked contacts; filters left.',
 '/contacts/sync':'Excel import stepper 上传→字段映射→校验→导入, sample validation table, LDAP/政务微信/钉钉 connection cards with sync direction/status.',
 '/visitor/dashboard':'Security summary KPIs, in-building visitor list, overdue warning panel, small gate capture thumbnails and real-time entry/exit event timeline. Light admin shell.',
 '/visitor/reservations':'Two-step approval queue with tabs 受访人确认/保卫处审核, selected visit detail including masked identity, visitor group, equipment declaration, approve/reject.',
 '/visitor/invitations':'Invitation list and invitation editor with visitor/date/purpose and security scope, right electronic invite preview with expiring QR code and masked phone.',
 '/visitor/registration':'Gate desk verification workstation with ID reading status, masked ID, photo placeholder, face comparison status, print visitor badge preview and 临时发卡.',
 '/visitor/access-rule':'Time-window and allowed-building/floor access editor, clean floor permission matrix with restricted floors locked, credential expiry summary.',
 '/visitor/blacklist':'Restricted access risk list, masked identities, documented reason/status, blocking alert, review trail and explicit removal review process. Fictional neutral sample reasons.',
 '/visitor/checkout':'Overdue visitor red warning list, host and security follow-up timeline, last gate event, departure verification and 完成出场核销 action.',
 '/fleet/dashboard':'Fleet KPIs total/on-trip/available/in-maintenance, vehicle status distribution, monthly mileage and fuel trend, current trips and maintenance alerts.',
 '/fleet/vehicles':'Vehicle registry table with fictional plates, model, engine, quota class, assigned parking and masked fuel card, right detailed vehicle archive.',
 '/fleet/drivers':'Driver profiles left and weekly assignment matrix center with work/rest/on-trip labels, safe-mileage KPI, qualification and health review info.',
 '/fleet/applications':'Vehicle application list, selected request purpose/route/time/passengers and three-stage approval timeline 部门负责人→车管审核→授权审批; fictional policy check summary.',
 '/fleet/dispatch':'Dispatch scheduling Gantt top, pending trip requests left, recommended available vehicle+driver match cards right, shared-route suggestion and 生成派车单.',
 '/fleet/trip-logs':'Departure vs return odometer photo slots, initial/end mileage fields, automatically calculated distance, toll receipt attachments, parking confirmation and 归队核销.',
 '/fleet/maintenance':'Mileage/time maintenance list with upcoming insurance renewal/annual inspection warning, selected service archive and cost timeline.',
 '/fleet/fuel-audit':'Fuel transaction table, liters/cost/km summary, per-vehicle L/100km comparison chart, abnormal consumption and offsite fuel-card alert panel.',
 '/research/dashboard':'Research KPI ongoing groups/points/issues/rectified percent, administrative schematic area heatmap, upcoming team schedule and unresolved issue list.',
 '/research/topics':'Topic application table, form with research type/leader/team/date range and objectives, approval status and planned field visits.',
 '/research/schedule-planner':'Three-panel planning: schematic map with ordered research points left, team timeline center, amber collision alert right showing same point and time two teams, 调整时间/联合调研 actions.',
 '/research/itinerary':'Time-based itinerary with point stops and travel segments, contact assignments, meeting agenda, reception budget limits and linked vehicle/attendance status.',
 '/research/issues':'Field issue ledger with photos, audio note chips, description, responsible department, severity and follow-up progress; selected issue detail.',
 '/research/reports':'Research report editor with structured headings, joint-department review comments right, approval/version history and 归档成果.',
 '/research/issues-to-supervision':'Research issues checklist left, target supervision form right with lead department/deadline, linked source issue retained, 转办督办 action and existing conversion status.',
 '/system/user':'Department tree and account management table, role/post assignment drawer, status switches, reset password and deactivate actions.',
 '/system/role':'Roles list left, selected role center with five data-scope choices 全部数据/自定义部门/本部门/本部门及以下/仅本人, department tree for custom scope, menu/button permissions tree right.',
 '/system/menu':'Hierarchical menu tree table with type badges M/C/F, route and permission-code columns, selected menu editor and top-category preview.',
 '/system/dept':'Administrative department tree table with hierarchy, lead person, contact, order/status and editable selected node form.',
 '/system/post':'Position registry table including code/title/rank/headcount/current occupancy and status, selected position form.',
 '/system/dict':'Dictionary category list left, selected leave-type dictionary entries table center, value/label/order/status editor.',
 '/system/config':'Categorized parameter editor with labeled fields and units: attendance radius 米, visitor validity 小时, maintenance mileage 公里; last-change history.',
 '/system/log':'Security audit tabs 操作日志/登录日志, filter by human/Agent/time/IP/status, detailed operation table and selected event detail with secret-redacted request/response.',
 '/system/apps':'Agent credential table with App ID, masked secret, scopes/quota/status; selected credential configuration with scopes checklist, secret shown only masked, MCP connector helper tabs and 测试连通性. No actual credential.',
}
style = '''Use case: ui-mockup. Asset type: single high-fidelity Chinese desktop web UI screenshot. Create ONE flat landscape 16:9 screenshot at preferably 1920x1080 or higher. No device frame, no perspective, no multiple screens. Product AgentCom 企业与政务协同办公管理平台. EXACT consistent shell: 56px navy #102A43 top bar, white AgentCom compact logo at left, eleven equal-width four-character categories in ONE row: 综合门户 考勤管理 资产耗材 重点督办 会务管理 组织通讯 门禁访客 公务用车 调研管理 智慧知识 系统管理. Small search/notification/avatar at right. White 208px left sidebar, thin navy outline icons, pale blue selected item. Main background #F3F6FA, white cards, 8px corners, fine gray borders, 24px main gutters. Primary blue #246BFD, teal #13A89E, amber #F59E0B and red #E5484D only warnings. Clean crisp Chinese sans-serif, readable precise labels. Dark navy text, slate secondary text. Calm modern government/enterprise design, carefully aligned practical information density. Selected top category blue pill+underline. Page header breadcrumb, title, one primary action. Charts subtle with labeled axes. Data statuses always have text, not color alone. Faint watermark 张明 10086. Fictional data only, masked private fields and secrets. Small unobtrusive 智能助手 launcher bottom right. Same visual proportions and style as the AgentCom 工作总览 reference. Avoid marketing hero, large illustrations, gradients, 3D, confusing layouts, overflowing nav or tiny illegible text. '''
for i,p in enumerate(pages,1):
    p['id']=f'{i:03d}'
    p['file']=f"mockups/{i:03d}-{p['route'].strip('/').replace('/','-')}.png"
    p['layout']=p['layout'] or layouts.get(p['route'],'Well structured functional management workspace.')
    sidebar=[x['title'] for x in pages if x['category']==p['category']]
    p['prompt']=style+f"Active category: {p['category']}. Exact page title: {p['title']}. Sidebar items for this module: {' / '.join(sidebar)}. Select current page. Core requirements faithfully visualize: {p['description']}. Composition: {p['layout']}. Display realistic relevant Chinese labels and concise sample rows. Every page must be visibly distinct based on its workflow."
    old = previous_pages.get(p['route'], {})
    for key in ('file', 'revisions', 'dimensions', 'status'):
        if key in old: p[key] = old[key]
    p['status']='complete' if (ROOT/p['file']).exists() else 'pending'
(ROOT/'manifest.json').write_text(json.dumps({'navigation':nav,'style':style,'source':'../docs/企业与政务协同办公管理平台需求说明书.md','pages':pages},ensure_ascii=False,indent=2))
print(f'{len(pages)} pages; {len([p for p in pages if p["route"].split("/")[1] in groups])} explicit PRD routes')
