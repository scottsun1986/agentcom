# AgentCom 开发规范（智能体协作契约）

## 一、后端 Router 规范（FastAPI + SQLAlchemy async）

### 1. 基础约定
- 文件位于 `app/routers/<module>.py`，顶层：`router = APIRouter(prefix="/api/<module>", tags=["<中文名>"])`
- 响应统一包裹：`from app.core.resp import ok, page`；成功 `return ok(data, "操作成功")`；分页 `return page(rows, total)`；失败 `raise ApiError(404, "xxx不存在")`。
- **永远不要**自己返回 `JSONResponse` 或 `HTTPException`。

### 2. 鉴权与权限
- 依赖注入（参考 `app/routers/attendance.py`）：
  - 当前身份：`p: Principal = Depends(require_perms("module:entity:action"))`
  - 需要数据库时：`db: AsyncSession = Depends(get_db)`
  - 权限串格式 `模块:实体:动作`，动作 ∈ {list, get, add, edit, del, audit, export, ...}
- Agent（App 凭据）调用时 `p.auth_kind == "agent"`，`require_perms` 自动校验 scopes，无需特殊处理。

### 3. 数据权限（RuoYi 5 级）
列表接口按记录归属人过滤（考勤为例）：
```python
from app.core.deps import DataScope as DS
if p.auth_kind == "user" and not p.is_admin:
    if p.data_scope == DS.SELF.value:
        stmt = stmt.where(Model.user_id == p.user_id)
    elif p.data_scope == DS.DEPT.value:
        stmt = stmt.where(Model.user_id.in_(select(SysUser.user_id).where(SysUser.dept_id == p.dept_id)))
    elif p.data_scope == DS.DEPT_AND_CHILD.value:
        ids = await dept_and_children(p.dept_id, db)   # 复制 attendance.py 中的同名辅助函数
        stmt = stmt.where(Model.user_id.in_(select(SysUser.user_id).where(SysUser.dept_id.in_(ids))))
```
按部门归属的实体（如督办任务 lead_dept_id）把过滤列换成 `dept_col`：SELF/DEPT 视为本部门。

### 4. 序列化
- 手写 `serialize_xxx()` 函数（参考 attendance.py），uuid 全部转 `str(...)`，datetime 用 `.isoformat()`，关系字段预先加载（懒加载在异步下会报错，用 `selectinload` 或在查询时 join 取名字缓存到 dict 后再序列化）。
- **重要**：异步会话中访问未加载的 relationship 会抛 `MissingGreenlet`。列表页需要显示 user_name/dept_name 时，先批量查 SysUser/SysDept 建 id→name 映射字典再填充。

### 5. 分页
```
stmt = select(X).order_by(X.created_at.desc())
total = (await db.execute(select(func.count()).select_from(stmt.subquery()))).scalar()
rows = (await db.execute(stmt.limit(pageSize).offset((pageNum-1)*pageSize))).scalars().all()
return page([...], total)
```

### 6. 闭环动作接口
审批/状态流转用 `POST /xxx/{id}/audit`、`POST /xxx/{id}/cancel` 等，校验当前状态合法后流转并写联动数据（如审批通过扣减额度、生成下一条记录），参照 attendance.py 的 `audit_leave`/`audit_remedy`。

### 7. 禁止事项
- 不要修改 `app/models/`、`app/core/`、`app/database.py`、`app/config.py`（发现缺字段用现有最接近字段替代，并在路由内用注释说明）。
- 不要新建 pydantic schema 文件；直接用 `body: dict` + 手动校验（与 attendance.py 一致）。
- 不要引入新的第三方依赖。

## 二、前端页面规范（Vue 3 全局构建，无打包器）

### 1. 文件与注册
- 每个页面一个文件：`static/js/pages/<module>-<name>.js`，例如 `portal-overview.js`。
- 通过全局注册：
```js
window.AppPages = window.AppPages || {};
AppPages['/portal/overview'] = {
  route: '/portal/overview', title: '工作总览', category: 'PORTAL',
  breadcrumb: ['综合门户', '工作总览'],
  primaryAction: '发起申请',           // 顶部右侧主按钮文案（可为 null）
  icon: 'layout-grid',               // 侧栏图标（可选）
  component: {
    template: `<div>...</div>`,        // 必须内联 template 字符串
    // 页面头部主按钮点击回调（可选）：onPrimary() { ... }
    data() { return {...} },
    async mounted() { await this.load(); },
    methods: { ... }
  }
};
```
- HTML 模板放 `static/pages-tpl/<module>-<name>.html`，由 index.html 以 `<script type="text/x-template" id="tpl-...">` 引入？——不，统一用 **template 字符串内联**，避免 83 个额外文件加载管理复杂度。

### 2. 数据获取
- 全局 `window.api`（见 static/js/api.js）：
  - `api.get(path, params)` / `api.post(path, body)` / `api.put(path, body)` → 返回 `data` 字段（分页接口返回整个 envelope `{rows, total}`）。
  - 失败自动 toast 并 reject。
- 页面挂载后 `mounted()` 中拉取真实后端数据；**接口失败必须容错**：`try/catch` 后展示空状态，不得整页白屏。

### 3. 设计系统（严格遵循，像素级复刻 design/mockups/*.png）
- 顶栏 56px 藏青 `#102A43`；左侧栏 208px 白底；内容区背景 `#F3F6FA`；卡片白底 8px 圆角、1px `#E3E8EF` 边框；主色 `#246BFD`，成功/青 `#13A89E`，警示 `#F59E0B`，危险 `#E5484D`。
- 文本：主 `#102A43`，次 `#486581`，弱 `#829AB1`；字号：页标题 22px/700，卡片题 15px/600，正文 13px，辅助 12px。
- 通用 class 在 `static/css/app.css`：`.card, .card-hd, .kpi-card, .btn, .btn-primary, .btn-ghost, .tag, .table, .status-pill, .progress, .search-bar, .page-header` 等，页面内不要重复定义这些。
- 状态必须有文字（如 "有风险"/"按计划"），不能只靠颜色。
- 每页右下角由外壳统一渲染 智能助手 悬浮按钮，页面内不需要画。
- 图标用全局组件：`<ic name="bell" size="16"></ic>`（size 可为 14/16/18/20/28）。可用图标集合 = `static/icons.js` ∪ `static/js/icons-extra.js`（window.__ICONS__ 的 key）。缺的图标往 icons-extra.js 追加（先用 node -e 检查 `window.__ICONS__[name]` 是否已存在）。
- 页面内容宽度自适应 1280~1920，网格用 CSS grid/flex，与设计图 12 列密度对齐。

### 4. 表格页通用结构（对照 mockup）
```
[面包屑+页头+主按钮]
[筛选行: 关键词输入 / 下拉 / 日期 / 查询按钮]
[卡片内 table：复选框列可选 + 字段列 + 状态 pill + 操作列(处理/编辑/...)]
[分页条: 共 N 条  上一页 1 2 3 下一页]
```
状态 pill 颜色映射：审批中/待审批=蓝、待执行/进行中=蓝绿、正常/已完成=青绿、预警/临期=琥珀、逾期/驳回/风险=红。

### 5. 禁止事项
- 不用外部 CDN（离线环境）；只加载本地 vendor/vue.global.prod.js。
- **严禁**在 template 里写 `<style>` 标签（Vue 编译器会丢弃）；页面特有样式：少量用内联 style，较多则追加到 `static/css/app.css` 末尾（用 `/* page: <route> */` 注释分节）。多个 agent 并行修改 app.css 时只做**文件末尾追加**，不要改动文件其他部分。
- 不使用单文件组件构建语法（.vue 文件），只用 `component: { template, data, methods }` 选项式 API。
