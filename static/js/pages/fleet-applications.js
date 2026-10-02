/* /fleet/applications 用车申请与三级审批 — pixel replica of design/mockups/057-fleet-applications.png
   Layout: 4 KPI / 状态 tabs + 申请列表(服务端分页) / 详情含三级审批进度 + 新建申请 modal */
AppPages['/fleet/applications'] = {
  route: '/fleet/applications', title: '用车申请与三级审批', category: 'FLEET', primaryAction: '新建用车申请', icon: 'file-text',
  subtitle: '规范公务用车申请与“部门负责人 → 车管科 → 调度派车”三级审批流转。',
  component: {
    data() {
      return {
        loading: true,
        canAudit: false,
        counts: { all: 0, DEPT_PENDING: 0, ADMIN_PENDING: 0, APPROVED: 0, DISPATCHED: 0, COMPLETED: 0, REJECTED: 0 },
        tab: '',
        rows: [], total: 0, pageNum: 1, pageSize: 10,
        keyword: '',
        APPST: {
          DEPT_PENDING: 'tag-amber', ADMIN_PENDING: 'tag-amber', APPROVED: 'tag-blue',
          DISPATCHED: 'tag-teal', COMPLETED: 'tag-green', REJECTED: 'tag-red',
        },
        showApply: false, submitting: false,
        form: { purpose: '', destination: '', trip_type: 'OFFICIAL_BUSINESS', passenger_count: 1, start_time: '', end_time: '', leader_name: '' },
        detail: null,
      };
    },
    computed: {
      tabs() {
        return [
          { key: '', label: '全部' }, { key: 'DEPT_PENDING', label: '待部门审批' }, { key: 'ADMIN_PENDING', label: '待车管科审批' },
          { key: 'APPROVED', label: '已批准待派车' }, { key: 'DISPATCHED', label: '出车中' },
          { key: 'COMPLETED', label: '已完成' }, { key: 'REJECTED', label: '已驳回' },
        ];
      },
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
    },
    async mounted() {
      try {
        const info = await api.get('/api/auth/info');
        const perms = info.permissions || [];
        this.canAudit = perms.includes('*:*:*') || perms.includes('fleet:application:audit');
      } catch (e) { /* keep false */ }
      await Promise.all([this.load(), this.loadCounts()]);
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
      bjDate(s) { const v = this.bj(s); return v === '—' ? '' : v.slice(5, 16); },
      appTag(s) { return this.APPST[s] || 'tag-gray'; },
      async load() {
        try {
          const r = await api.page('/api/fleet/applications', {
            status: this.tab || undefined, keyword: this.keyword || undefined,
            pageNum: this.pageNum, pageSize: this.pageSize,
          });
          this.rows = r.rows || [];
          this.total = r.total || 0;
        } catch (e) { this.rows = []; this.total = 0; }
      },
      async loadCounts() {
        const one = async (status) => {
          try { const r = await api.page('/api/fleet/applications', { status: status || undefined, pageNum: 1, pageSize: 1 }); return r.total || 0; }
          catch (e) { return 0; }
        };
        const [all, dept, admin, approved, dispatched, completed, rejected] = await Promise.all(
          ['', 'DEPT_PENDING', 'ADMIN_PENDING', 'APPROVED', 'DISPATCHED', 'COMPLETED', 'REJECTED'].map((s) => one(s))
        );
        this.counts = { all, DEPT_PENDING: dept, ADMIN_PENDING: admin, APPROVED: approved, DISPATCHED: dispatched, COMPLETED: completed, REJECTED: rejected };
      },
      setTab(t) { this.tab = t; this.pageNum = 1; this.load(); },
      query() { this.pageNum = 1; this.load(); },
      goPage(p) { if (p < 1 || p > this.pageCount) return; this.pageNum = p; this.load(); },
      openApply() {
        this.form = { purpose: '', destination: '', trip_type: 'OFFICIAL_BUSINESS', passenger_count: 1, start_time: '', end_time: '', leader_name: '' };
        this.showApply = true;
      },
      async submitApply() {
        const f = this.form;
        if (!f.purpose.trim()) return this.$root.toast('请填写用车事由', 'warn');
        if (!f.destination.trim()) return this.$root.toast('请填写目的地', 'warn');
        if (!f.start_time || !f.end_time) return this.$root.toast('请选择用车起止时间', 'warn');
        if (f.end_time <= f.start_time) return this.$root.toast('结束时间必须晚于开始时间', 'warn');
        this.submitting = true;
        const iso = (v) => (v.length === 16 ? v + ':00+08:00' : v);
        try {
          await api.post('/api/fleet/applications', {
            purpose: f.purpose.trim(), destination: f.destination.trim(), trip_type: f.trip_type,
            passenger_count: Number(f.passenger_count) || 1, leader_name: f.leader_name || null,
            start_time: iso(f.start_time), end_time: iso(f.end_time),
          });
          this.$root.toast('用车申请已提交，等待部门负责人审批', 'ok');
          this.showApply = false;
          await Promise.all([this.load(), this.loadCounts()]);
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async audit(a, action) {
        const step = a.status === 'DEPT_PENDING' ? 'DEPT' : 'ADMIN';
        const stepName = step === 'DEPT' ? '部门负责人' : '车管科';
        const tip = action === 'APPROVE' ? '确认以「' + stepName + '」身份通过该用车申请？' : '确认驳回该用车申请？';
        if (!window.confirm(tip)) return;
        try {
          await api.post('/api/fleet/applications/' + a.app_id + '/audit', { action, step });
          this.$root.toast(action === 'APPROVE' ? '审批已通过' : '申请已驳回', 'ok');
          await Promise.all([this.load(), this.loadCounts()]);
        } catch (e) { /* toast shown */ }
      },
      flowSteps(a) {
        const order = ['DEPT_PENDING', 'ADMIN_PENDING', 'APPROVED', 'DISPATCHED', 'COMPLETED'];
        const idx = a ? order.indexOf(a.status) : -1;
        if (a && a.status === 'REJECTED') {
          return [
            { name: '1. 部门负责人审批', state: idx >= 0 || a.status === 'REJECTED' ? (a.status === 'REJECTED' ? 'done' : 'doing') : 'wait' },
            { name: '2. 车管科审核', state: 'err' },
            { name: '3. 调度派车', state: 'wait' },
          ];
        }
        return [
          { name: '1. 部门负责人审批', state: idx > 0 ? 'done' : 'doing' },
          { name: '2. 车管科审核', state: idx >= 2 ? 'done' : idx === 1 ? 'doing' : 'wait' },
          { name: '3. 调度派车与出车', state: a && a.status === 'COMPLETED' ? 'done' : idx >= 3 ? 'doing' : 'wait' },
        ];
      },
      flowStateTag(s) { return { done: 'tag-green', doing: 'tag-blue', wait: 'tag-gray', err: 'tag-red' }[s] || 'tag-gray'; },
      flowStateLabel(s) { return { done: '已通过', doing: '审核中', wait: '待审批', err: '已驳回' }[s] || s; },
      onPrimary() { this.openApply(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="ast-kpi5" style="grid-template-columns:repeat(4,1fr); margin-bottom:16px">
        <div class="card ast-kpi">
          <div class="ico ico-blue"><ic name="file-text" size="24"></ic></div>
          <div class="meta"><div class="label">用车申请总数</div><div class="val" style="color:var(--primary)">{{ counts.all }}</div>
            <div class="sub muted">全部状态申请累计</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-green2"><ic name="check-circle-2" size="24"></ic></div>
          <div class="meta"><div class="label">已完成用车</div><div class="val" style="color:var(--green)">{{ counts.COMPLETED }}</div>
            <div class="sub muted">出车归队并核销</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-amber"><ic name="clock" size="24"></ic></div>
          <div class="meta"><div class="label">审批中</div><div class="val" style="color:var(--amber)">{{ counts.DEPT_PENDING + counts.ADMIN_PENDING }}</div>
            <div class="sub muted">部门 {{ counts.DEPT_PENDING }} · 车管科 {{ counts.ADMIN_PENDING }}</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-red"><ic name="x-circle" size="24"></ic></div>
          <div class="meta"><div class="label">已驳回</div><div class="val" style="color:var(--red)">{{ counts.REJECTED }}</div>
            <div class="sub muted">不符合公车使用规范</div></div>
        </div>
      </div>

      <!-- application list -->
      <div class="card">
        <div class="card-bd" style="padding-top:4px">
          <div class="lr-tabs" style="margin:0 0 12px">
            <span v-for="t in tabs" :key="t.key" :class="['lr-tab', tab === t.key ? 'on' : '']" @click="setTab(t.key)">
              {{ t.label }} ({{ t.key ? counts[t.key] : counts.all }})
            </span>
          </div>
          <div class="filters">
            <input class="input" style="flex:1; min-width:220px" placeholder="请输入用车事由、目的地关键词" v-model="keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
          </div>
          <table class="table">
            <thead><tr>
              <th>申请人</th><th>所属部门</th><th>用车事由</th><th>目的地</th><th style="width:76px">乘车人数</th>
              <th>用车时间</th><th>当前状态</th><th style="width:170px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="a in rows" :key="a.app_id">
                <td class="strong">{{ a.applicant_name || '—' }}</td>
                <td class="muted">{{ a.dept_name || '—' }}</td>
                <td class="ellipsis" style="max-width:180px" :title="a.purpose">{{ a.purpose || '—' }}</td>
                <td>{{ a.destination || '—' }}</td>
                <td class="num">{{ a.passenger_count }} 人</td>
                <td class="num muted">{{ bjDate(a.start_time) }} ~ {{ bjDate(a.end_time) }}</td>
                <td><span :class="['tag', appTag(a.status)]">{{ a.status_label }}</span></td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="detail = a">详情</button>
                  <template v-if="canAudit && a.status === 'DEPT_PENDING'">
                    <button class="btn btn-text btn-sm" @click="audit(a, 'APPROVE')">通过</button>
                    <button class="btn btn-text btn-sm danger" @click="audit(a, 'REJECT')">驳回</button>
                  </template>
                  <template v-else-if="canAudit && a.status === 'ADMIN_PENDING'">
                    <button class="btn btn-text btn-sm" @click="audit(a, 'APPROVE')">通过</button>
                    <button class="btn btn-text btn-sm danger" @click="audit(a, 'REJECT')">驳回</button>
                  </template>
                  <button v-else-if="a.status === 'APPROVED'" class="btn btn-text btn-sm" @click="$root.go('/fleet/dispatch')">去派车</button>
                </td>
              </tr>
              <tr v-if="!rows.length"><td colspan="8"><div class="empty">暂无用车申请</div></td></tr>
            </tbody>
          </table>
          <div class="pager" v-if="pageCount > 1">
            <span>共 {{ total }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in pageCount" :key="p" v-show="pageCount <= 7 || p === 1 || p === pageCount || Math.abs(p - pageNum) <= 1" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
      </div>

      <!-- apply modal -->
      <Modal title="新建用车申请" width="600px" v-if="showApply" @close="showApply = false">
        <div class="flt-form-2col">
          <div class="form-item" style="grid-column:1 / -1"><label class="req">用车事由</label><input class="input" placeholder="如 赴市政府参加工作会商" v-model="form.purpose"></div>
          <div class="form-item"><label class="req">目的地</label><input class="input" placeholder="如 市政府主楼" v-model="form.destination"></div>
          <div class="form-item"><label>用车类型</label>
            <select class="select" v-model="form.trip_type">
              <option value="OFFICIAL_BUSINESS">公务出行</option>
              <option value="LEADERSHIP_RESEARCH">领导调研</option>
              <option value="EMERGENCY">应急保障</option>
            </select>
          </div>
          <div class="form-item"><label>乘车人数</label><input type="number" min="1" class="input" v-model="form.passenger_count"></div>
          <div class="form-item"><label>随车领导</label><input class="input" placeholder="选填" v-model="form.leader_name"></div>
          <div class="form-item" style="grid-column:1 / -1"><label class="req">用车时间</label>
            <div style="flex:1; display:flex; align-items:center; gap:8px">
              <input type="datetime-local" class="input" v-model="form.start_time">
              <span class="muted">~</span>
              <input type="datetime-local" class="input" v-model="form.end_time">
            </div>
          </div>
        </div>
        <div class="muted" style="font-size:12px; padding-left:102px">提交后先由部门负责人审批，再转车管科合规审批，审批通过后进入调度派车环节。</div>
        <template #footer>
          <button class="btn btn-ghost" @click="showApply = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitApply">提交申请</button>
        </template>
      </Modal>

      <!-- detail modal with 3-step flow -->
      <Modal title="用车申请详情" width="640px" v-if="detail" @close="detail = null">
        <div class="desc-list" style="grid-template-columns:88px 1fr">
          <span class="k">申请编号</span><span class="num muted">{{ detail.app_id.slice(0, 8) }}</span>
          <span class="k">申请人</span><span class="strong">{{ detail.applicant_name || '—' }}<span class="muted" style="font-weight:400">（{{ detail.dept_name || '—' }}）</span></span>
          <span class="k">申请时间</span><span class="num muted">{{ bj(detail.created_at) }}</span>
          <span class="k">用车类型</span><span>{{ detail.trip_type_label }}</span>
          <span class="k">用车事由</span><span>{{ detail.purpose || '—' }}</span>
          <span class="k">出发地</span><span>{{ detail.origin || '—' }}</span>
          <span class="k">目的地</span><span>{{ detail.destination || '—' }}</span>
          <span class="k">用车时间</span><span class="num">{{ bj(detail.start_time) }} 至 {{ bj(detail.end_time) }}</span>
          <span class="k">乘车人数</span><span>{{ detail.passenger_count }} 人<span v-if="detail.leader_name" class="muted">（随车领导：{{ detail.leader_name }}）</span></span>
          <span class="k">当前状态</span><span><span :class="['tag', appTag(detail.status)]">{{ detail.status_label }}</span><span v-if="detail.plate_no" class="strong" style="margin-left:8px">已派 {{ detail.plate_no }}</span></span>
        </div>
        <div class="divider"></div>
        <div class="strong" style="margin-bottom:10px">三级审批进度</div>
        <div class="flow-steps">
          <div class="flow-step" v-for="(s, i) in flowSteps(detail)" :key="s.name">
            <div class="fs-node" :class="s.state === 'done' ? 'done' : s.state === 'doing' ? 'doing' : s.state === 'err' ? 'err' : ''">
              <ic :name="s.state === 'done' ? 'check' : s.state === 'err' ? 'x' : 'clock'" size="18"></ic>
            </div>
            <div class="fs-t">{{ s.name }}</div>
            <span :class="['tag', flowStateTag(s.state)]" style="margin-top:4px">{{ flowStateLabel(s.state) }}</span>
            <div v-if="i < flowSteps(detail).length - 1" class="fs-arrow"><ic name="chevron-right" size="16"></ic></div>
          </div>
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
