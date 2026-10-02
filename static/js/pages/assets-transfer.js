/* /assets/transfer 资产调拨管理 — pixel replica of design/mockups/018-assets-transfer.png
   Layout: 4 KPI cards / 流转面板(来源部门→目标部门→责任人变更) / 调拨申请单 table / (趋势 | 流程) */
AppPages['/assets/transfer'] = {
  route: '/assets/transfer', title: '资产调拨管理', category: 'ASSETS', primaryAction: '发起资产调拨', icon: 'truck',
  subtitle: '支持跨部门、跨项目的资产调剂流转，原责任人与新接收人双方会签确认，确保资产权责清晰、流转合规。',
  component: {
    data() {
      return {
        loading: true,
        rows: [],
        assets: [],
        depts: [],
        employees: [],
        canAudit: false,
        selected: null,
        tab: 'all',
        filters: { keyword: '', status: '' },
        pageNum: 1,
        pageSize: 8,
        showApply: false,
        submitting: false,
        form: { asset_id: '', target_dept_id: '', target_user_id: '', reason: '' },
        detail: null,
      };
    },
    computed: {
      kpi() {
        const now = new Date();
        const mk = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        const c = { total: this.rows.length, month: 0, approved: 0, monthApproved: 0, pending: 0, rejected: 0 };
        this.rows.forEach((r) => {
          if ((r.created_at || '').slice(0, 7) === mk) c.month++;
          if (r.audit_status === 'APPROVED') { c.approved++; if ((r.created_at || '').slice(0, 7) === mk) c.monthApproved++; }
          else if (r.audit_status === 'PENDING') c.pending++;
          else if (r.audit_status === 'REJECTED') c.rejected++;
        });
        return c;
      },
      tabCounts() {
        const c = { all: this.rows.length, PENDING: 0, APPROVED: 0, REJECTED: 0 };
        this.rows.forEach((r) => { if (c[r.audit_status] !== undefined) c[r.audit_status]++; });
        return c;
      },
      filtered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        return this.rows.filter((r) => {
          if (this.tab !== 'all' && r.audit_status !== this.tab) return false;
          if (this.filters.status && r.audit_status !== this.filters.status) return false;
          if (kw && !((r.req_no || '') + (r.asset_name || '') + (r.asset_code || '') + (r.user_name || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      pageTotal() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      trend() {
        const out = [];
        const now = new Date();
        for (let i = 5; i >= 0; i--) {
          const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
          out.push({ key: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'), label: (d.getMonth() + 1) + '月', count: 0 });
        }
        this.rows.forEach((r) => {
          const t = out.find((x) => x.key === (r.created_at || '').slice(0, 7));
          if (t) t.count++;
        });
        return out;
      },
      trendMax() { return Math.max(1, ...this.trend.map((t) => t.count)); },
      flowSteps() {
        const st = this.selected ? this.selected.audit_status : null;
        const lbl = (s) => ({ done: ['done', 'tag-green', '已完成'], doing: ['doing', 'tag-blue', '进行中'], err: ['err', 'tag-red', '已驳回'], wait: ['wait', 'tag-gray', '待开始'] }[s]);
        const s2 = st === 'REJECTED' ? 'err' : st === 'PENDING' ? 'doing' : st === 'APPROVED' ? 'done' : 'wait';
        const sRest = st === 'APPROVED' ? 'done' : 'wait';
        const mk = (i, title, desc, state, icon) => {
          const [cls, tag, label] = lbl(state);
          return { title, desc, state: cls, tag, label, icon };
        };
        return [
          mk(1, '提交申请', '调出部门发起申请\n填写调拨信息', 'done', 'file-plus'),
          mk(2, '部门审批', '调出/调入部门\n负责人审批', s2, 'clipboard-check'),
          mk(3, '双方会签', '原责任人与新接收人\n确认资产交接', sRest, 'users'),
          mk(4, '交接验收', '清点实物\n确认无误', sRest, 'package'),
          mk(5, '归档完成', '生成调拨台账\n更新资产卡片', sRest, 'check-circle-2'),
        ];
      },
    },
    async mounted() {
      try {
        const info = await api.get('/api/auth/info');
        const perms = info.permissions || [];
        this.canAudit = perms.includes('*:*:*') || perms.includes('assets:requisition:audit');
      } catch (e) { /* keep false */ }
      await this.load();
      this.loading = false;
    },
    methods: {
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
      },
      async load() {
        try {
          const r = await api.page('/api/assets/requisitions', { req_type: 'TRANSFER', pageNum: 1, pageSize: 200 });
          this.rows = r.rows || [];
        } catch (e) { this.rows = []; }
        if (!this.selected && this.rows.length) {
          this.selected = this.rows.find((r) => r.audit_status === 'PENDING') || this.rows[0];
        }
      },
      async loadOptions() {
        if (!this.assets.length) {
          try {
            const r = await api.page('/api/assets/ledger', { pageNum: 1, pageSize: 200 });
            this.assets = (r.rows || []).filter((a) => a.status !== 'SCRAPPED');
          } catch (e) { this.assets = []; }
        }
        if (!this.depts.length) {
          try {
            const tree = await api.get('/api/system/depts');
            const flat = [];
            const walk = (nodes, depth) => (nodes || []).forEach((d) => {
              flat.push({ dept_id: d.dept_id, dept_name: (depth > 0 ? '\u00A0\u00A0'.repeat(depth) + '› ' : '') + d.dept_name, raw: d.dept_name });
              walk(d.children, depth + 1);
            });
            walk(tree, 0);
            this.depts = flat;
          } catch (e) { this.depts = []; }
        }
        if (!this.employees.length) {
          try {
            const r = await api.page('/api/contacts/employees', { pageNum: 1, pageSize: 200 });
            this.employees = r.rows || [];
          } catch (e) { this.employees = []; }
        }
      },
      statusLabel(s) { return { PENDING: '审批中', APPROVED: '已完成', REJECTED: '已退回' }[s] || s; },
      statusTag(s) { return { PENDING: 'tag-blue', APPROVED: 'tag-green', REJECTED: 'tag-red' }[s] || 'tag-gray'; },
      setTab(t) { this.tab = t; this.pageNum = 1; },
      query() { this.pageNum = 1; },
      reset() { this.filters = { keyword: '', status: '' }; this.query(); },
      goPage(p) { if (p === '...' || p < 1 || p > this.pageCount) return; this.pageNum = p; },
      pickRow(r) { this.selected = r; },
      async openApply() {
        this.form = { asset_id: '', target_dept_id: '', target_user_id: '', reason: '' };
        await this.loadOptions();
        this.showApply = true;
      },
      async submitApply() {
        const f = this.form;
        if (!f.asset_id) return this.$root.toast('请选择调拨资产', 'warn');
        if (!f.target_dept_id) return this.$root.toast('请选择调入部门', 'warn');
        if (!f.reason.trim()) return this.$root.toast('请填写调拨事由', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/assets/requisitions', {
            req_type: 'TRANSFER', asset_id: f.asset_id,
            target_dept_id: f.target_dept_id, target_user_id: f.target_user_id || undefined,
            reason: f.reason.trim(),
          });
          this.$root.toast('调拨申请已提交，等待审批', 'ok');
          this.showApply = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async audit(r, action) {
        const tip = action === 'APPROVE' ? '确认通过该调拨申请？通过后资产将划转至调入部门。' : '确认驳回该调拨申请？';
        if (!window.confirm(tip)) return;
        try {
          await api.post('/api/assets/requisitions/' + r.req_id + '/audit', { action, comment: action === 'APPROVE' ? '同意调拨' : '不符合调拨条件，驳回' });
          this.$root.toast(action === 'APPROVE' ? '已通过该调拨申请' : '已驳回该调拨申请', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openApply(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="box" size="28"></ic></div>
          <div class="meta"><div class="label">调拨申请</div><div class="val" style="color:var(--primary)">{{ kpi.total }}</div>
            <div class="muted" style="font-size:12px">本月 {{ kpi.month }} · 待审批 {{ kpi.pending }}</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta"><div class="label">已完成调拨</div><div class="val" style="color:var(--teal)">{{ kpi.approved }}</div>
            <div class="muted" style="font-size:12px">本月 {{ kpi.monthApproved }} 笔</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="clock" size="28"></ic></div>
          <div class="meta"><div class="label">进行中</div><div class="val" style="color:var(--amber)">{{ kpi.pending }}</div>
            <div class="muted" style="font-size:12px">审批中，等待双方会签</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="x-circle" size="28"></ic></div>
          <div class="meta"><div class="label">异常 / 退回</div><div class="val" style="color:var(--red)">{{ kpi.rejected }}</div>
            <div class="muted" style="font-size:12px">已驳回单据</div></div>
        </div>
      </div>

      <!-- transfer route panel -->
      <div class="card" style="margin-top:0">
        <div class="card-hd"><div class="t">调拨流转信息</div><span class="more" v-if="selected" @click="selected = null">清除选中</span></div>
        <div class="card-bd">
          <div class="swap-grid" v-if="selected">
            <div class="swap-box">
              <div class="swap-hd">调拨来源部门</div>
              <div style="display:flex; gap:12px; align-items:center; margin-top:8px">
                <span class="ico-box ico-blue" style="width:44px;height:44px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex:none"><ic name="building-2" size="22"></ic></span>
                <div>
                  <div class="strong" style="font-size:14px">{{ selected.dept_name || '—' }}</div>
                  <div class="muted" style="font-size:12px; margin-top:2px">原保管人：{{ selected.user_name || '—' }}</div>
                </div>
              </div>
            </div>
            <div class="swap-mid"><ic name="arrow-right" size="18"></ic><span>调拨至</span></div>
            <div class="swap-box swap-teal">
              <div class="swap-hd">调拨目标部门</div>
              <div style="display:flex; gap:12px; align-items:center; margin-top:8px">
                <span class="ico-box ico-teal" style="width:44px;height:44px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex:none"><ic name="network" size="22"></ic></span>
                <div>
                  <div class="strong" style="font-size:14px">{{ selected.target_dept_name || '—' }}</div>
                  <div class="muted" style="font-size:12px; margin-top:2px">新接收人：{{ selected.target_user_name || '待指定' }}</div>
                </div>
              </div>
            </div>
            <div class="swap-box swap-user">
              <div class="swap-hd">责任人变更</div>
              <div style="display:flex; align-items:center; gap:8px; margin-top:8px">
                <div style="flex:1; min-width:0">
                  <div class="muted" style="font-size:12px">原责任人</div>
                  <div class="strong" style="font-size:13.5px">{{ selected.user_name || '—' }}</div>
                  <div class="muted" style="font-size:11.5px">{{ selected.dept_name || '' }}</div>
                </div>
                <ic name="arrow-right" size="16" style="color:#B6C3D2; flex:none"></ic>
                <div style="flex:1; min-width:0">
                  <div class="muted" style="font-size:12px">新接收人</div>
                  <div class="strong" style="font-size:13.5px; color:var(--primary)">{{ selected.target_user_name || '待指定' }}</div>
                  <div class="muted" style="font-size:11.5px">{{ selected.target_dept_name || '' }}</div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="empty" style="padding:22px 0">点击下方申请单行，查看调拨来源部门、目标部门与责任人变更</div>
        </div>
      </div>

      <!-- requisition list -->
      <div class="card mt16">
        <div class="card-bd" style="padding-top:4px">
          <div class="lr-tabs" style="margin:0 0 12px">
            <span :class="['lr-tab', tab === 'all' ? 'on' : '']" @click="setTab('all')">全部 ({{ tabCounts.all }})</span>
            <span :class="['lr-tab', tab === 'PENDING' ? 'on' : '']" @click="setTab('PENDING')">审批中 ({{ tabCounts.PENDING }})</span>
            <span :class="['lr-tab', tab === 'APPROVED' ? 'on' : '']" @click="setTab('APPROVED')">已完成 ({{ tabCounts.APPROVED }})</span>
            <span :class="['lr-tab', tab === 'REJECTED' ? 'on' : '']" @click="setTab('REJECTED')">已退回 ({{ tabCounts.REJECTED }})</span>
          </div>
          <div class="filters">
            <input class="input" style="flex:1; min-width:200px" placeholder="请输入资产名称、编号或申请人" v-model="filters.keyword" @keyup.enter="query">
            <select class="select" style="width:130px" v-model="filters.status" @change="query">
              <option value="">全部状态</option><option value="PENDING">审批中</option><option value="APPROVED">已完成</option><option value="REJECTED">已退回</option>
            </select>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr>
              <th>申请单号</th><th>资产</th><th>调出部门</th><th>调入部门</th><th>新保管人</th>
              <th>申请人</th><th>申请时间</th><th>当前状态</th><th style="width:130px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in shownRows" :key="r.req_id" :class="{sel: selected && selected.req_id === r.req_id}" @click="pickRow(r)" style="cursor:pointer">
                <td class="num strong">{{ r.req_no }}</td>
                <td><div class="strong">{{ r.asset_name || '—' }}</div><div class="muted" style="font-size:12px">{{ r.asset_code || '' }}</div></td>
                <td>{{ r.dept_name || '—' }}</td>
                <td>{{ r.target_dept_name || '—' }}</td>
                <td>{{ r.target_user_name || '待指定' }}</td>
                <td>{{ r.user_name || '—' }}</td>
                <td class="num muted">{{ bj(r.created_at) }}</td>
                <td><span :class="['tag', statusTag(r.audit_status)]">{{ statusLabel(r.audit_status) }}</span></td>
                <td class="actions" @click.stop>
                  <button class="btn btn-text btn-sm" @click="detail = r; pickRow(r)">查看</button>
                  <template v-if="canAudit && r.audit_status === 'PENDING'">
                    <button class="btn btn-text btn-sm" @click="audit(r, 'APPROVE')">通过</button>
                    <button class="btn btn-text btn-sm danger" @click="audit(r, 'REJECT')">驳回</button>
                  </template>
                </td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="9"><div class="empty">暂无调拨申请</div></td></tr>
            </tbody>
          </table>
          <div class="pager" v-if="pageCount > 1">
            <span>共 {{ pageTotal }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in pageCount" :key="p" v-show="pageCount <= 7 || p === 1 || p === pageCount || Math.abs(p - pageNum) <= 1" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
      </div>

      <!-- trend + flow -->
      <div class="split-3-2 mt16">
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">调拨数量趋势（近 6 个月）</div><span class="more">单位：单</span></div>
          <div class="card-bd">
            <div class="mini-bars">
              <div class="mb-col" v-for="t in trend" :key="t.key">
                <span class="mb-val">{{ t.count }}</span>
                <div class="mb-bar" :style="{height: Math.max(4, t.count / trendMax * 100) + '%'}"></div>
                <span class="mb-lb">{{ t.label }}</span>
              </div>
            </div>
          </div>
        </div>
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">调拨流程</div><span class="more">查看流程说明</span></div>
          <div class="card-bd">
            <div class="flow-steps">
              <div class="flow-step" v-for="(s, i) in flowSteps" :key="i">
                <div :class="['fs-node', s.state]"><ic :name="s.icon" size="18"></ic></div>
                <div class="fs-t">{{ i + 1 }}. {{ s.title }}</div>
                <div class="fs-d">{{ s.desc }}</div>
                <span :class="['tag', s.tag]" style="margin-top:5px">{{ s.label }}</span>
                <div v-if="i < flowSteps.length - 1" class="fs-arrow"><ic name="arrow-right" size="14"></ic></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- apply modal -->
      <Modal title="发起资产调拨" width="560px" v-if="showApply" @close="showApply = false">
        <div class="form-item">
          <label class="req">调拨资产</label>
          <select class="select" v-model="form.asset_id">
            <option value="">请选择资产</option>
            <option v-for="a in assets" :key="a.asset_id" :value="a.asset_id">{{ a.name }}（{{ a.asset_code }} · {{ a.dept_name || '未分配' }}）</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">调入部门</label>
          <select class="select" v-model="form.target_dept_id">
            <option value="">请选择调入部门</option>
            <option v-for="d in depts" :key="d.dept_id" :value="d.dept_id">{{ d.dept_name }}</option>
          </select>
        </div>
        <div class="form-item">
          <label>新保管人</label>
          <select class="select" v-model="form.target_user_id">
            <option value="">暂不指定</option>
            <option v-for="e in employees" :key="e.user_id" :value="e.user_id">{{ e.nick_name }}{{ e.dept_name ? '（' + e.dept_name + '）' : '' }}</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">调拨事由</label>
          <textarea class="input" maxlength="200" placeholder="请填写调拨事由（不超过 200 字）" v-model="form.reason"></textarea>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showApply = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitApply">提交申请</button>
        </template>
      </Modal>

      <!-- detail modal -->
      <Modal title="调拨申请详情" width="560px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">申请单号</span><span class="strong num">{{ detail.req_no }}</span>
          <span class="k">资产</span><span>{{ detail.asset_name }}（{{ detail.asset_code }}）</span>
          <span class="k">调出部门</span><span>{{ detail.dept_name || '—' }}</span>
          <span class="k">调入部门</span><span>{{ detail.target_dept_name || '—' }}</span>
          <span class="k">新保管人</span><span>{{ detail.target_user_name || '待指定' }}</span>
          <span class="k">申请人</span><span>{{ detail.user_name || '—' }}</span>
          <span class="k">申请时间</span><span class="num">{{ bj(detail.created_at) }}</span>
          <span class="k">调拨事由</span><span>{{ detail.reason || '—' }}</span>
          <span class="k">当前状态</span><span><span :class="['tag', statusTag(detail.audit_status)]">{{ statusLabel(detail.audit_status) }}</span></span>
          <span class="k">审批人</span><span>{{ detail.approver_name || '待审批' }}</span>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="detail = null">关闭</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
