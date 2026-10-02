/* /attendance/trip 外出与出差报备 — pixel replica of design/mockups/009-attendance-trip.png
   Layout: 4 KPI / (trip list with tabs+filters+pager | trip detail & audit panel) + 新建报备 modal */
AppPages['/attendance/trip'] = {
  route: '/attendance/trip', title: '外出与出差报备', category: 'ATTENDANCE', primaryAction: '新建外出/出差报备', icon: 'briefcase',
  subtitle: '用于登记因公外出、出差等行程安排，审批通过后自动关联免打卡名单。',
  component: {
    data() {
      return {
        loading: true,
        trips: [],
        canAudit: false,
        tab: 'all', // all | OUTING | BUSINESS_TRIP
        filters: { status: '', start: '', end: '', keyword: '' },
        selected: null,
        pageNum: 1,
        pageSize: 10,
        showApply: false,
        submitting: false,
        form: { trip_type: 'OUTING', origin: '单位总部', destination: '', start_time: '', end_time: '', purpose: '' },
      };
    },
    computed: {
      byStatus() {
        const c = { all: this.trips.length, APPROVED: 0, PENDING: 0, REJECTED: 0 };
        this.trips.forEach((t) => { if (c[t.audit_status] !== undefined) c[t.audit_status]++; });
        return c;
      },
      monthCount() {
        const m = new Date();
        const key = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0');
        return this.trips.filter((t) => (t.created_at || '').slice(0, 7) === key).length;
      },
      pct() {
        const n = this.trips.length || 1;
        return {
          APPROVED: Math.round((this.byStatus.APPROVED / n) * 100),
          PENDING: Math.round((this.byStatus.PENDING / n) * 100),
          REJECTED: Math.round((this.byStatus.REJECTED / n) * 100),
        };
      },
      filtered() {
        const f = this.filters;
        const kw = (f.keyword || '').trim().toLowerCase();
        return this.trips.filter((t) => {
          if (this.tab !== 'all' && t.trip_type !== this.tab) return false;
          if (f.status && t.audit_status !== f.status) return false;
          if (f.start && this.bjDate(t.end_time) < f.start) return false;
          if (f.end && this.bjDate(t.start_time) > f.end) return false;
          if (kw && !((t.purpose || '') + (t.user_name || '') + (t.destination || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      pageCount() { return Math.max(1, Math.ceil(this.filtered.length / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
    },
    async mounted() {
      try {
        const info = await api.get('/api/auth/info');
        const perms = info.permissions || [];
        this.canAudit = perms.includes('*:*:*') || perms.includes('attendance:trip:audit');
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
      bjDate(s) { const v = this.bj(s); return v === '—' ? '' : v.slice(0, 10); },
      async load() {
        try {
          const r = await api.page('/api/attendance/trips', { pageNum: 1, pageSize: 200 });
          this.trips = r.rows || [];
        } catch (e) { this.trips = []; }
        if (this.selected && !this.trips.some((t) => t.trip_id === this.selected.trip_id)) this.selected = null;
        if (!this.selected && this.trips.length) this.selected = this.shownRows[0] || this.trips[0];
      },
      statusLabel(s) { return { PENDING: '审批中', APPROVED: '已通过', REJECTED: '已驳回' }[s] || s; },
      statusTag(s) { return { PENDING: 'tag-amber', APPROVED: 'tag-green', REJECTED: 'tag-red' }[s] || 'tag-gray'; },
      typeLabel(t) { return { OUTING: '外出', BUSINESS_TRIP: '出差' }[t] || t; },
      typeTag(t) { return { OUTING: 'tag-teal', BUSINESS_TRIP: 'tag-blue' }[t] || 'tag-gray'; },
      setTab(t) { this.tab = t; this.pageNum = 1; if (this.shownRows.length) this.selected = this.shownRows[0]; },
      query() { this.pageNum = 1; if (this.shownRows.length) this.selected = this.shownRows[0]; },
      reset() { this.filters = { status: '', start: '', end: '', keyword: '' }; this.query(); },
      goPage(p) {
        if (p < 1 || p > this.pageCount) return;
        this.pageNum = p;
        if (this.shownRows.length) this.selected = this.shownRows[0];
      },
      days(t) {
        if (!t.start_time || !t.end_time) return 0;
        return Math.max(1, Math.round((new Date(t.end_time) - new Date(t.start_time)) / 86400000 * 10) / 10);
      },
      openApply() {
        this.form = { trip_type: 'OUTING', origin: '单位总部', destination: '', start_time: '', end_time: '', purpose: '' };
        this.showApply = true;
      },
      async submitApply() {
        const f = this.form;
        if (!f.destination.trim()) return this.$root.toast('请填写目的地', 'warn');
        if (!f.start_time || !f.end_time) return this.$root.toast('请选择起止时间', 'warn');
        if (f.end_time <= f.start_time) return this.$root.toast('结束时间必须晚于开始时间', 'warn');
        if (!f.purpose.trim()) return this.$root.toast('请填写外出/出差事由', 'warn');
        this.submitting = true;
        try {
          const st = f.start_time.length === 16 ? f.start_time + ':00+08:00' : f.start_time;
          const et = f.end_time.length === 16 ? f.end_time + ':00+08:00' : f.end_time;
          await api.post('/api/attendance/trips', { trip_type: f.trip_type, origin: f.origin.trim() || '单位总部', destination: f.destination.trim(), start_time: st, end_time: et, purpose: f.purpose.trim() });
          this.$root.toast('外出/出差申请已提交', 'ok');
          this.showApply = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async audit(t, action) {
        if (!window.confirm(action === 'APPROVE' ? '确认通过该外出/出差申请？' : '确认驳回该外出/出差申请？')) return;
        try {
          await api.post('/api/attendance/trips/' + t.trip_id + '/audit', { action });
          this.$root.toast(action === 'APPROVE' ? '已通过该申请' : '已驳回该申请', 'ok');
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
          <div class="ico ico-blue"><ic name="file-text" size="28"></ic></div>
          <div class="meta"><div class="label">本月申请</div><div class="val" style="color:var(--primary)">{{ monthCount }} <span style="font-size:14px;font-weight:400">件</span></div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta" style="display:flex;align-items:center;gap:10px">
            <div><div class="label">已通过</div><div class="val" style="color:var(--teal)">{{ byStatus.APPROVED }}</div></div>
            <span class="tag tag-gray">占比 {{ pct.APPROVED }}%</span>
          </div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="clock" size="28"></ic></div>
          <div class="meta" style="display:flex;align-items:center;gap:10px">
            <div><div class="label">审批中</div><div class="val" style="color:var(--amber)">{{ byStatus.PENDING }}</div></div>
            <span class="tag tag-gray">占比 {{ pct.PENDING }}%</span>
          </div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="x-circle" size="28"></ic></div>
          <div class="meta" style="display:flex;align-items:center;gap:10px">
            <div><div class="label">已驳回</div><div class="val" style="color:var(--red)">{{ byStatus.REJECTED }}</div></div>
            <span class="tag tag-gray">占比 {{ pct.REJECTED }}%</span>
          </div>
        </div>
      </div>

      <div class="trip-split mt16">
        <!-- list -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">外出/出差申请列表</div></div>
          <div class="card-bd" style="padding-top:4px">
            <div class="lr-tabs" style="margin:0 0 10px">
              <span :class="['lr-tab', tab === 'all' ? 'on' : '']" @click="setTab('all')">全部 ({{ trips.length }})</span>
              <span :class="['lr-tab', tab === 'OUTING' ? 'on' : '']" @click="setTab('OUTING')">外出 ({{ trips.filter(t=>t.trip_type==='OUTING').length }})</span>
              <span :class="['lr-tab', tab === 'BUSINESS_TRIP' ? 'on' : '']" @click="setTab('BUSINESS_TRIP')">出差 ({{ trips.filter(t=>t.trip_type==='BUSINESS_TRIP').length }})</span>
            </div>
            <div class="filters">
              <input class="input" style="flex:1; min-width:170px" placeholder="请输入事由、申请人、目的地等关键词" v-model="filters.keyword" @keyup.enter="query">
              <select class="select" style="width:120px" v-model="filters.status" @change="query">
                <option value="">全部状态</option><option value="PENDING">审批中</option><option value="APPROVED">已通过</option><option value="REJECTED">已驳回</option>
              </select>
              <input type="date" class="input" style="width:140px" v-model="filters.start" @change="query">
              <span class="muted">~</span>
              <input type="date" class="input" style="width:140px" v-model="filters.end" @change="query">
              <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            </div>
            <table class="table">
              <thead><tr><th>申请编号</th><th>事由</th><th>类型</th><th>目的地</th><th>开始时间</th><th>结束时间</th><th>申请人</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="t in shownRows" :key="t.trip_id" :style="{background: selected && selected.trip_id === t.trip_id ? 'var(--primary-weak)' : ''}" style="cursor:pointer" @click="selected = t">
                  <td class="num muted">{{ t.trip_id.slice(0, 8).toUpperCase() }}</td>
                  <td class="ellipsis" :title="t.purpose" style="max-width:150px">{{ t.purpose || '—' }}</td>
                  <td><span :class="['tag', typeTag(t.trip_type)]">{{ typeLabel(t.trip_type) }}</span></td>
                  <td>{{ t.destination || '—' }}</td>
                  <td class="num muted">{{ bjDate(t.start_time) }}</td>
                  <td class="num muted">{{ bjDate(t.end_time) }}</td>
                  <td>{{ t.user_name || '—' }}</td>
                  <td><span :class="['tag', statusTag(t.audit_status)]">{{ statusLabel(t.audit_status) }}</span></td>
                  <td class="actions">
                    <button class="btn btn-text btn-sm" @click.stop="selected = t">查看</button>
                    <template v-if="canAudit && t.audit_status === 'PENDING'">
                      <button class="btn btn-text btn-sm" @click.stop="audit(t, 'APPROVE')">通过</button>
                      <button class="btn btn-text btn-sm danger" @click.stop="audit(t, 'REJECT')">驳回</button>
                    </template>
                  </td>
                </tr>
                <tr v-if="!shownRows.length"><td colspan="9"><div class="empty">暂无外出/出差申请</div></td></tr>
              </tbody>
            </table>
            <div class="pager" v-if="pageCount > 1">
              <span>共 {{ filtered.length }} 条</span>
              <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
              <button v-for="p in pageCount" :key="p" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
              <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
            </div>
          </div>
        </div>

        <!-- detail -->
        <div class="card" style="margin-top:0; align-self:start">
          <template v-if="selected">
            <div class="card-hd">
              <div class="t">{{ selected.purpose || '外出/出差详情' }} <span :class="['tag', statusTag(selected.audit_status)]">{{ statusLabel(selected.audit_status) }}</span></div>
            </div>
            <div class="card-bd">
              <div class="muted" style="font-size:12px; margin-bottom:10px">
                申请编号：{{ selected.trip_id.slice(0, 8).toUpperCase() }} 　申请时间：{{ bj(selected.created_at) }} 　申请人：{{ selected.user_name || '—' }}
              </div>
              <div class="trip-free" v-if="selected.audit_status === 'APPROVED'">
                <ic name="check-circle-2" size="18"></ic>
                <div><b>审批通过后已自动关联免打卡名单</b><br>行程期间系统将自动生成免打卡记录，无需手动申请补卡。</div>
              </div>
              <div class="strong" style="font-size:13.5px; margin:12px 0 8px">行程信息</div>
              <div class="desc-list">
                <span class="k">事由</span><span>{{ selected.purpose || '—' }}</span>
                <span class="k">类型</span><span>{{ typeLabel(selected.trip_type) }}（{{ selected.trip_type === 'BUSINESS_TRIP' ? '外地' : '市内' }}）</span>
                <span class="k">出发地</span><span>{{ selected.origin || '—' }}</span>
                <span class="k">目的地</span><span>{{ selected.destination || '—' }}</span>
                <span class="k">行程时间</span><span class="num">{{ bj(selected.start_time) }} 至 {{ bj(selected.end_time) }}　共 {{ days(selected) }} 天</span>
                <span class="k">申请人</span><span>{{ selected.user_name || '—' }}</span>
              </div>
              <div class="divider"></div>
              <div class="strong" style="font-size:13.5px; margin-bottom:8px">审批信息</div>
              <div class="desc-list">
                <span class="k">审批结果</span><span><span :class="['tag', statusTag(selected.audit_status)]">{{ statusLabel(selected.audit_status) }}</span></span>
                <span class="k">审批人</span><span>{{ selected.approver_name || '待审批' }}</span>
              </div>
              <div v-if="canAudit && selected.audit_status === 'PENDING'" style="display:flex; gap:10px; justify-content:flex-end; margin-top:14px">
                <button class="btn btn-primary" @click="audit(selected, 'APPROVE')"><ic name="check" size="14"></ic>通过</button>
                <button class="btn btn-ghost" style="color:var(--red)" @click="audit(selected, 'REJECT')"><ic name="x" size="14"></ic>驳回</button>
              </div>
            </div>
          </template>
          <template v-else>
            <div class="card-hd"><div class="t">申请详情</div></div>
            <div class="card-bd"><div class="empty">点击左侧申请查看详情</div></div>
          </template>
        </div>
      </div>

      <!-- apply modal -->
      <Modal title="新建外出/出差报备" width="560px" v-if="showApply" @close="showApply = false">
        <div class="form-item">
          <label class="req">报备类型</label>
          <div style="flex:1; display:flex; gap:10px; padding-top:5px">
            <label style="display:flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" value="OUTING" v-model="form.trip_type"> 市内外出</label>
            <label style="display:flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" value="BUSINESS_TRIP" v-model="form.trip_type"> 出差（外地）</label>
          </div>
        </div>
        <div class="form-item">
          <label>出发地</label>
          <input class="input" v-model="form.origin" placeholder="默认：单位总部">
        </div>
        <div class="form-item">
          <label class="req">目的地</label>
          <input class="input" v-model="form.destination" placeholder="请输入目的地">
        </div>
        <div class="form-item">
          <label class="req">起止时间</label>
          <div style="flex:1; display:flex; align-items:center; gap:8px">
            <input type="datetime-local" class="input" v-model="form.start_time">
            <span class="muted">~</span>
            <input type="datetime-local" class="input" v-model="form.end_time">
          </div>
        </div>
        <div class="form-item">
          <label class="req">外出/出差事由</label>
          <textarea class="input" maxlength="200" placeholder="请填写事由，如：客户项目现场调研" v-model="form.purpose"></textarea>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showApply = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitApply">提交报备</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
