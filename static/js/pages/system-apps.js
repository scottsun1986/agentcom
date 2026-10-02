/* /system/apps Agent 接入与应用凭据 — pixel replica of design/mockups/077-system-apps.png
   Layout: 4 KPI / 应用凭据表格 / MCP 客户端接入说明卡 / 创建凭据弹窗 + 凭据结果大弹窗（含 MCP 配置 JSON） */
AppPages['/system/apps'] = {
  route: '/system/apps', title: 'Agent 接入与应用凭据', category: 'SYSTEM', primaryAction: '新建应用凭据', icon: 'bot',
  subtitle: '为内外部应用、MCP 客户端等分配访问凭据，配置授权 Scopes 与限流配额，支持快速生成主流客户端的接入配置。',
  component: {
    data() {
      return {
        loading: true,
        apps: [],
        showCreate: false, creating: false,
        form: { app_name: '', description: '', scopes: ['*'], rate_limit_per_minute: 120 },
        scopeOptions: [
          { v: '*', label: '全部权限', desc: '可调用平台所有已开放给 Agent 的接口' },
          { v: 'portal:read', label: '门户读取', desc: '工作台、待办、通知查询' },
          { v: 'attendance:read', label: '考勤读取', desc: '打卡记录与统计查询' },
          { v: 'attendance:write', label: '考勤写入', desc: '报备、补卡等提交操作' },
          { v: 'conference:read', label: '会务读取', desc: '会议与预订查询' },
          { v: 'conference:write', label: '会务写入', desc: '会议室预订等操作' },
          { v: 'supervision:read', label: '督办读取', desc: '督办任务与预警查询' },
          { v: 'supervision:write', label: '督办写入', desc: '进展反馈等提交操作' },
          { v: 'visitor:read', label: '访客读取', desc: '访客预约与记录查询' },
          { v: 'visitor:write', label: '访客写入', desc: '邀约、核验与审批操作' },
          { v: 'fleet:read', label: '车辆读取', desc: '车辆、司机与派车查询' },
          { v: 'fleet:write', label: '车辆写入', desc: '用车申请与调度操作' },
          { v: 'assets:read', label: '资产读取', desc: '资产台账与耗材库存查询' },
          { v: 'assets:write', label: '资产写入', desc: '领用、盘点等操作' },
          { v: 'research:read', label: '调研读取', desc: '课题、点位与问题台账查询' },
          { v: 'research:write', label: '调研写入', desc: '立项、问题登记与转督办' },
          { v: 'system:read', label: '系统读取', desc: '用户与审计日志查询' },
          { v: 'knowledge:read', label: '知识读取', desc: '知识库检索' },
        ],
        credResult: null, credJson: '', showSecret: true,
        mcpEndpoint: (location.origin || 'http://localhost:8009'),
        cfgApp: null, cfgJson: '', cfgHeadersJson: '',
      };
    },
    computed: {
      kpi() {
        const total = this.apps.length;
        const active = this.apps.filter((a) => a.is_active).length;
        const scopes = new Set();
        this.apps.forEach((a) => (a.scopes || []).forEach((s) => scopes.add(s)));
        return { total, active, stopped: total - active, scopes: scopes.size };
      },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      async load() {
        try { this.apps = (await api.get('/api/system/apps')) || []; } catch (e) { this.apps = []; }
      },
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
      },
      appIcon(a) { return (a.scopes || []).includes('*') ? 'bot' : 'fingerprint'; },
      async toggleScope(v) {
        const i = this.form.scopes.indexOf(v);
        if (v === '*') {
          if (i >= 0) { if (this.form.scopes.length === 1) return; this.form.scopes = []; }
          else this.form.scopes = ['*'];
          return;
        }
        let next = this.form.scopes.filter((x) => x !== '*');
        if (i >= 0) next = next.filter((x) => x !== v);
        else next.push(v);
        this.form.scopes = next.length ? next : ['*'];
      },
      openCreate() {
        this.form = { app_name: '', description: '', scopes: ['*'], rate_limit_per_minute: 120 };
        this.showCreate = true;
      },
      async submitCreate() {
        if (!this.form.app_name.trim()) return this.$root.toast('请填写应用名称', 'warn');
        this.creating = true;
        try {
          const d = await api.post('/api/system/apps', {
            app_name: this.form.app_name.trim(), description: this.form.description.trim(),
            scopes: this.form.scopes.join(','), rate_limit_per_minute: Number(this.form.rate_limit_per_minute) || 120,
          });
          this.showCreate = false;
          this.credResult = d;
          try { this.credJson = JSON.stringify(d.mcp_config, null, 2); } catch (e) { this.credJson = ''; }
          await this.load();
        } catch (e) { /* toast shown */ }
        this.creating = false;
      },
      async toggleApp(a) {
        try {
          await api.put('/api/system/apps/' + a.id + '/toggle', {});
          this.$root.toast(a.is_active ? '应用已停用' : '应用已启用', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      async removeApp(a) {
        if (!window.confirm('确认删除应用凭据「' + a.app_name + '」？删除后使用该凭据的 Agent 将立即失去访问能力。')) return;
        try { await api.del('/api/system/apps/' + a.id); this.$root.toast('凭据已删除', 'ok'); await this.load(); } catch (e) { /* toast shown */ }
      },
      async copyText(t) {
        try { await navigator.clipboard.writeText(t); this.$root.toast('已复制到剪贴板', 'ok'); }
        catch (e) {
          const ta = document.createElement('textarea');
          ta.value = t; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); this.$root.toast('已复制到剪贴板', 'ok'); } catch (e2) { this.$root.toast('复制失败，请手动选择复制', 'err'); }
          document.body.removeChild(ta);
        }
      },
      closeCred() { this.credResult = null; this.credJson = ''; },
      buildConfigJson(a, secret) {
        return JSON.stringify({
          mcpServers: {
            agentcom: {
              type: 'streamable-http',
              url: this.mcpEndpoint + '/mcp',
              headers: { 'X-App-ID': a.app_id, 'X-App-Secret': secret },
            },
          },
        }, null, 2);
      },
      openConfig(a) {
        this.cfgApp = a;
        this.cfgJson = this.buildConfigJson(a, '<App Secret 创建或重置密钥时获取>');
        this.cfgHeadersJson = JSON.stringify({ 'X-App-ID': a.app_id, 'X-App-Secret': '<App Secret>' }, null, 2);
      },
      closeConfig() { this.cfgApp = null; this.cfgJson = ''; this.cfgHeadersJson = ''; },
      async rotateApp(a) {
        if (!window.confirm('确认重置「' + a.app_name + '」的 App Secret？旧密钥将立即失效，使用该凭据的 Agent 需更新配置。')) return;
        try {
          const d = await api.put('/api/system/apps/' + a.id + '/rotate', {});
          this.cfgApp = null;
          this.credResult = d;
          try { this.credJson = JSON.stringify(d.mcp_config, null, 2); } catch (e) { this.credJson = ''; }
          this.$root.toast('密钥已重置', 'ok');
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openCreate(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI -->
      <div class="kpi-row">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="box" size="28"></ic></div>
          <div class="meta"><div class="label">应用总数</div><div class="val" style="color:var(--primary)">{{ kpi.total }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">个</span></div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta"><div class="label">启用中</div><div class="val" style="color:var(--teal)">{{ kpi.active }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">个</span></div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="ban" size="28"></ic></div>
          <div class="meta"><div class="label">已停用</div><div class="val" style="color:var(--red)">{{ kpi.stopped }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">个</span></div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="key-round" size="28"></ic></div>
          <div class="meta"><div class="label">授权 Scope 种类</div><div class="val" style="color:var(--amber)">{{ kpi.scopes }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">项</span></div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <!-- credentials table -->
      <div class="card">
        <div class="card-hd">
          <div class="t">应用凭据列表</div>
          <span class="muted" style="font-size:12px">共 {{ apps.length }} 个应用 · App Secret 仅创建时展示一次</span>
        </div>
        <div class="card-bd" style="padding-top:8px">
          <table class="table">
            <thead><tr>
              <th>应用名称</th><th>App ID</th><th>授权 Scopes</th><th style="width:100px">限流配额</th><th style="width:80px">状态</th><th>创建时间</th><th style="width:210px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="a in apps" :key="a.id">
                <td>
                  <div style="display:flex; align-items:center; gap:8px">
                    <span :class="['ico-box', a.is_active ? 'ico-blue' : 'ico-red']" style="width:28px;height:28px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;flex:none"><ic :name="appIcon(a)" size="15"></ic></span>
                    <div>
                      <div class="strong">{{ a.app_name }}</div>
                      <div class="muted" style="font-size:11.5px" v-if="a.description">{{ a.description }}</div>
                    </div>
                  </div>
                </td>
                <td class="mono">{{ a.app_id }} <ic name="copy" size="13" style="cursor:pointer; color:var(--text-3); vertical-align:-2px" @click="copyText(a.app_id)"></ic></td>
                <td>
                  <div style="display:flex; flex-wrap:wrap; gap:4px; max-width:300px">
                    <span v-if="(a.scopes || []).includes('*')" class="tag tag-red">全部权限 *</span>
                    <template v-else>
                      <span v-for="s in (a.scopes || []).slice(0, 3)" :key="s" class="tag tag-blue">{{ s }}</span>
                      <span v-if="(a.scopes || []).length > 3" class="tag tag-gray" :title="(a.scopes || []).join(', ')">+{{ a.scopes.length - 3 }} 项</span>
                    </template>
                  </div>
                </td>
                <td class="num">{{ a.rate_limit_per_minute }} 次/分钟</td>
                <td><span :class="['tag', a.is_active ? 'tag-green' : 'tag-gray']"><ic :name="a.is_active ? 'check-circle-2' : 'ban'" size="12"></ic>{{ a.is_active ? '启用' : '已停用' }}</span></td>
                <td class="num muted" style="white-space:nowrap">{{ bj(a.created_at) }}</td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="openConfig(a)"><ic name="copy" size="12"></ic> 接入配置</button>
                  <button class="btn btn-text btn-sm" @click="toggleApp(a)">{{ a.is_active ? '停用' : '启用' }}</button>
                  <button class="btn btn-text btn-sm" @click="rotateApp(a)">重置密钥</button>
                  <button class="btn btn-text btn-sm danger" @click="removeApp(a)">删除</button>
                </td>
              </tr>
              <tr v-if="!apps.length"><td colspan="7"><div class="empty">暂无应用凭据，点击右上角「新建应用凭据」接入第一个 Agent</div></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- MCP access guide -->
      <div class="card mt16">
        <div class="card-hd">
          <div class="t"><ic name="terminal" size="16"></ic>MCP 客户端接入说明</div>
          <span class="muted" style="font-size:12px">适用于 Claude Desktop / Cursor 等支持 MCP 的智能体工具</span>
        </div>
        <div class="card-bd" style="display:grid; grid-template-columns: minmax(0,1fr) minmax(0,1.2fr); gap:20px">
          <div>
            <div class="mcp-step" v-for="(s, i) in [
                { t: '创建应用凭据', d: '点击右上角「新建应用凭据」，生成 App ID 与 App Secret（仅展示一次）。' },
                { t: '配置 MCP 客户端', d: '将生成的 mcpServers 配置 JSON 写入客户端配置文件（如 claude_desktop_config.json）。' },
                { t: '携带鉴权头调用', d: '所有请求需携带 X-App-ID 与 X-App-Secret 两个请求头完成鉴权。' },
                { t: '验证连通性', d: '客户端工具列表中出现 AgentCom 工具即代表接入成功。' },
              ]" :key="i">
              <span class="mcp-step-no">{{ i + 1 }}</span>
              <div><div class="strong" style="font-size:13px">{{ s.t }}</div><div class="muted" style="font-size:12px; line-height:1.55">{{ s.d }}</div></div>
            </div>
          </div>
          <div>
            <div class="desc-list" style="grid-template-columns: 130px 1fr; row-gap:10px">
              <span class="k">Streamable HTTP</span><span class="mono strong">{{ mcpEndpoint }}/mcp <span class="tag tag-green" style="margin-left:4px">推荐</span></span>
              <span class="k">SSE 兼容端点</span><span class="mono muted">{{ mcpEndpoint }}/sse</span>
              <span class="k">鉴权请求头 1</span><span class="mono">X-App-ID: &lt;App ID&gt;</span>
              <span class="k">鉴权请求头 2</span><span class="mono">X-App-Secret: &lt;App Secret&gt;</span>
              <span class="k">限流策略</span><span>按凭据维度限制每分钟请求数，超限返回 429</span>
              <span class="k">权限控制</span><span>Scopes 与接口权限串（模块:实体:动作）自动匹配，最小授权原则</span>
            </div>
            <div class="cfg-foot amber" style="margin-top:14px">
              <ic name="shield-alert" size="14" style="margin-top:2px"></ic>
              <span>请妥善保管 App Secret，泄露后请立即停用对应凭据并重新创建。</span>
            </div>
          </div>
        </div>
      </div>

      <!-- create modal -->
      <Modal title="创建应用凭据" width="600px" v-if="showCreate" @close="showCreate = false">
        <div class="form-grid-2">
          <div class="form-item"><label class="req">应用名称</label>
            <input class="input" placeholder="如：会议智能助手" v-model="form.app_name"></div>
          <div class="form-item"><label>限流配额</label>
            <div style="flex:1; display:flex; align-items:center; gap:8px">
              <input class="input" type="number" v-model="form.rate_limit_per_minute"><span class="muted" style="white-space:nowrap">次/分钟</span>
            </div></div>
        </div>
        <div class="form-item"><label>应用描述</label>
          <input class="input" placeholder="描述该 Agent 的用途，便于审计" v-model="form.description"></div>
        <div class="form-item" style="align-items:flex-start">
          <label class="req">授权 Scopes</label>
          <div style="flex:1">
            <div class="cfg-help" style="margin:2px 0 8px">Scope 格式为「模块:类别」，read/write/audit 为操作类别；勾选「全部权限」等同 *。</div>
            <div class="scope-grid">
              <label v-for="o in scopeOptions" :key="o.v" class="scope-opt" :class="{on: form.scopes.includes(o.v)}" @click.prevent="toggleScope(o.v)">
                <input type="checkbox" class="ck" :checked="form.scopes.includes(o.v)" @change="toggleScope(o.v)">
                <div><div class="strong" style="font-size:12.5px">{{ o.label }}</div><div class="muted" style="font-size:11px">{{ o.v === '*' ? o.desc : o.v + ' · ' + o.desc }}</div></div>
              </label>
            </div>
          </div>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showCreate = false">取消</button>
          <button class="btn btn-primary" :disabled="creating" @click="submitCreate"><ic name="key-round" size="14"></ic>生成凭据</button>
        </template>
      </Modal>

      <!-- per-app access config modal -->
      <Modal :title="'MCP 接入配置 — ' + (cfgApp ? cfgApp.app_name : '')" width="680px" v-if="cfgApp" @close="closeConfig">
        <div class="cred-row">
          <span class="cred-k">App ID</span>
          <code class="cred-val">{{ cfgApp.app_id }}</code>
          <button class="btn btn-ghost btn-sm" @click="copyText(cfgApp.app_id)"><ic name="copy" size="12"></ic>复制</button>
        </div>
        <div class="cred-row">
          <span class="cred-k">接入端点</span>
          <code class="cred-val">{{ mcpEndpoint }}/mcp</code>
          <button class="btn btn-ghost btn-sm" @click="copyText(mcpEndpoint + '/mcp')"><ic name="copy" size="12"></ic>复制</button>
        </div>
        <div class="sec-title" style="display:flex; align-items:center; justify-content:space-between; margin-top:12px">
          <span style="display:flex; align-items:center; gap:6px"><ic name="terminal" size="14"></ic>MCP 客户端配置 JSON</span>
          <span style="display:flex; gap:8px">
            <button class="btn btn-ghost btn-sm" @click="copyText(mcpEndpoint + '/mcp')"><ic name="copy" size="12"></ic>仅端点</button>
            <button class="btn btn-ghost btn-sm" @click="copyText(cfgHeadersJson)"><ic name="copy" size="12"></ic>仅鉴权头</button>
            <button class="btn btn-primary btn-sm" @click="copyText(cfgJson)"><ic name="copy" size="12"></ic>一键复制完整 JSON</button>
          </span>
        </div>
        <div class="code-block">{{ cfgJson }}</div>
        <div class="cfg-help" style="margin-top:8px">
          <ic name="info" size="13"></ic>
          App Secret 创建时仅展示一次，配置中已以占位符标注。如密钥遗失，点击列表「重置密钥」获取新密钥与完整配置。
          也可改用 SSE 端点 {{ mcpEndpoint }}/sse（将 type 改为 sse、url 改为该地址）。
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="rotateApp(cfgApp)"><ic name="rotate-cw" size="12"></ic>重置密钥并获取完整配置</button>
          <button class="btn btn-primary" @click="closeConfig">关闭</button>
        </template>
      </Modal>

      <!-- credential result modal -->
      <Modal title="凭据创建成功" width="680px" v-if="credResult" @close="closeCred">
        <div class="cfg-foot amber" style="margin:0 0 14px">
          <ic name="alert-triangle" size="15" style="margin-top:2px"></ic>
          <span><b>App Secret 仅此一次展示</b>，关闭弹窗后无法再次查看，请立即复制保存。</span>
        </div>
        <div class="cred-row">
          <span class="cred-k">App ID</span>
          <code class="cred-val">{{ credResult.app_id }}</code>
          <button class="btn btn-ghost btn-sm" @click="copyText(credResult.app_id)"><ic name="copy" size="12"></ic>复制</button>
        </div>
        <div class="cred-row">
          <span class="cred-k">App Secret</span>
          <code class="cred-val">{{ showSecret ? credResult.app_secret : '•'.repeat(24) }}</code>
          <button class="btn btn-ghost btn-sm" @click="showSecret = !showSecret"><ic :name="showSecret ? 'eye-off' : 'eye'" size="12"></ic>{{ showSecret ? '隐藏' : '显示' }}</button>
          <button class="btn btn-ghost btn-sm" @click="copyText(credResult.app_secret)"><ic name="copy" size="12"></ic>复制</button>
        </div>
        <div class="sec-title" style="display:flex; align-items:center; justify-content:space-between">
          <span style="display:flex; align-items:center; gap:6px"><ic name="terminal" size="14"></ic>MCP 客户端配置 JSON（data.mcp_config）</span>
          <button class="btn btn-ghost btn-sm" @click="copyText(credJson)"><ic name="copy" size="12"></ic>复制配置</button>
        </div>
        <div class="code-block">{{ credJson }}</div>
        <div class="cfg-help" style="margin-top:8px"><ic name="info" size="13"></ic> 将以上 mcpServers 配置加入 Claude Desktop（claude_desktop_config.json）、Cursor（mcp.json）等客户端配置文件，重启客户端即可完成接入。也可改用 SSE 端点 {{ mcpEndpoint }}/sse。</div>
        <template #footer>
          <button class="btn btn-primary" @click="closeCred">我已保存，关闭</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
