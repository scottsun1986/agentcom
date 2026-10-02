# AgentCom 企业与政务协同办公管理平台

面向政企组织的协同办公、资产治理、政务督办、后勤保障一体化管理平台。原生支持 **Web UI（顶部大类 + 左侧功能二级导航）**、**OpenAPI 3.1** 与 **MCP (Model Context Protocol 2.2.0)** 双协议，供人类员工与 AI Agent 协同闭环操作。

## 功能总览（10 大业务域 · 83 页面）

| 顶部大类 | 覆盖能力 |
|---|---|
| 📊 综合门户 | 工作总览、跨模块待办审批、协同日程、消息通知、智能助手 |
| ⏰ 考勤管理 | 打卡（幂等）/请假（额度校验+审批扣减）/外出出差/补卡修正闭环/月度报表/规则 |
| 📦 资产耗材 | 一物一码台账、入库建档、领用/借用/调拨/报废审批闭环、维保、扫码盘点、折旧、低值耗材 |
| 🎯 重点督办 | 立项编号、里程碑甘特、进展台账、红黄蓝三色预警、延期审批、销号核验、简报汇编 |
| 🏛️ 会务管理 | 会议室 tsrange+GiST 防冲突预订、政务统筹、回执、智能排座（以中为尊）、保障派工、电子签到、纪要、决议一键转督办 |
| 👥 组织通讯 | 组织树、花名册、手机号动态脱敏、外联单位、专家库、导入同步 |
| 🛡️ 门禁访客 | 预约两级审批、黑名单拦截、邀约免审通行码、核验入场、滞留告警、出场核销 |
| 🚗 公务用车 | 一车一档、三级审批、调度派车单、归队里程核销、维保/年审预警、定点油耗审计 |
| 📋 调研管理 | 课题立项、**防撞期检测**、动线接待、问题台账、问题一键转督办 |
| 🧠 智慧知识 | 知识工作台、打分检索、文档库、知识图谱、GBrainKG 联动探测 |
| ⚙️ 系统管理 | 若依 RBAC（用户/角色/菜单/部门/岗位/字典/参数/日志）+ Agent 凭据（MCP 接入） |

## 快速开始

```bash
# 依赖：Python 3.12+，PostgreSQL 16（含 btree_gist），Redis（可选）
pip install -e ".[dev]"          # 或按 pyproject 安装依赖

# 初始化数据库并灌入演示数据（会重建 schema）
python3 -m app.seed_reset

# 启动（默认 0.0.0.0:8009）
python3 -m uvicorn app.main:app --host 0.0.0.0 --port 8009
```

- Web UI：http://localhost:8009/
- OpenAPI 文档：http://localhost:8009/docs
- 健康检查：http://localhost:8009/healthz

### 演示账号（密码均为 admin123）

| 账号 | 姓名 | 角色 | 数据范围 |
|---|---|---|---|
| admin | 系统管理员 | 超级管理员 | 全部 |
| zhangming | 张明 | 部门负责人 | 本部门及以下 |
| lihua | 李华 | 普通员工 | 仅本人 |
| zhouzhengan | 周正安 | 保卫处安保员 | 本部门 |
| sunqiang | 孙强 | 车队调度员 | 本部门 |

### 数据库连接

`.env` 中配置（默认指向 localhost:5434 的 agentcom 库）：

```
DATABASE_URL=postgresql+asyncpg://meetmanager:meetmanager@localhost:5434/agentcom
```

## Agent / MCP 接入

平台在 `/mcp`（Streamable HTTP）与 `/sse`（SSE）暴露 **66 个 MCP 工具**，按使用者角色全覆盖：管理层看板类（全局总览/督办形势/考勤汇总/资产家底/车队费用/调研整改/维保预警）、个人自助类（我的待办/假期余额/申请进度/订会议室/查通讯录/查制度）、专项操作类（安保核验/车队调度/督办催办销号/调研转办）与系统审计类，凭据鉴权（Header：`X-App-ID` / `X-App-Secret`）+ 细粒度 Scopes。

1. 在【系统管理 → Agent 接入与应用凭据】创建凭据（或使用内置演示凭据）：

```
X-App-ID: agentcom-demo
X-App-Secret: agentcom-demo-secret-2026
```

2. 在 Claude Desktop / Cursor / Windsurf 等智能体工具的 MCP 配置中加入：

```json
{
  "mcpServers": {
    "agentcom": {
      "type": "streamable-http",
      "url": "http://localhost:8009/mcp",
      "headers": {
        "X-App-ID": "agentcom-demo",
        "X-App-Secret": "agentcom-demo-secret-2026"
      }
    }
  }
}
```

3. 可用工具示例：`supervision_create_item`（一键立项）、`meeting_book_room`（防冲突预订）、`meeting_generate_seating`（政务排座）、`visitor_create_invitation`（访客通行码）、`fleet_apply_car` / `fleet_dispatch_trip` / `fleet_return_trip`（用车闭环）、`research_check_conflicts`（防撞期）、`knowledge_search`（知识检索）等。

## 测试

```bash
python3 -m pytest tests/ -q          # 97 项：RBAC/数据范围、十大模块业务闭环、MCP 协议与工具
```

## 架构

```
app/
  main.py            # FastAPI 组装（API + MCP 双传输 + 静态 SPA）
  config.py          # pydantic-settings 配置
  database.py        # 异步引擎/会话；relationship 全局 selectin 预加载
  core/              # security(Argon2id+JWT) / deps(RBAC+数据范围) / errors / resp
  models/            # SQLAlchemy 2.0 模型（若依 RBAC + 十域业务 + 扩展）
  routers/           # 12 个业务路由（160+ REST 端点，统一 {code,msg} 包裹）
  core/audit.py      # 写操作审计中间件（等保三级）
  mcp/server.py      # MCP 2.2.0 Server（30 工具 + 凭据中间件）
  services/seed.py   # 演示数据种子（组织/用户/菜单/字典/全业务样例）
static/
  index.html         # SPA 入口
  css/app.css        # 设计系统（藏青顶栏/208px 侧栏/卡片/表格/甘特/排座/登录页）
  js/shell.js        # 应用外壳（大类导航/侧栏/水印/智能助手面板）
  js/pages/*.js      # 83 个页面组件（Vue 3 全局注册，无打包器）
tests/               # pytest 异步测试套件
design/mockups/      # 高保真设计图（83 张，页面 1:1 复刻来源）
docs/                # 需求说明书 PRD + 开发规范
```

## 技术要点

- **防双重预订**：`conf_booking.during` 使用 PostgreSQL `TSTZRANGE` + GiST 排除约束，应用层预检 + 数据库层兜底。
- **若依 RBAC**：用户-角色-岗位-菜单-部门五维模型；数据范围 5 级（全部/自定义/本部门/本部门及以下/仅本人）在 SQL 层注入。
- **双模鉴权**：人类 JWT（Argon2id 口令哈希）与 Agent App 凭据（Scopes 校验）共用同一套权限串体系。
- **跨模块闭环**：会议决议→督办、调研问题→督办、会务统筹→访客邀约、出差→免打卡、资产领用→状态流转。
