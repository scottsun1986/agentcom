/* /assets/requisition 领用与退库 — pixel replica of design/mockups/016-assets-requisition.png
   Layout: 4 KPI cards / tabs(CLAIM|RETURN) + filters + requisition table + 新建领用/退库申请 modal */
AppPages['/assets/requisition'] = {
  route: '/assets/requisition', title: '领用与退库', category: 'ASSETS', primaryAction: '新建领用申请', icon: 'file-check',
  subtitle: '支持资产领用申请、审批派发、签收确认及闲置退库验收入库，规范资产全生命周期管理。',
  component: {
    data() {
      return {
        loading: true,
        canAudit: false,
        tab: 'CLAIM',
        claims: [], returns: [], stockTotal: 0,
        statusFilter: '', keyword: '',
        pageNum: 1, pageSize: 10,
        showNew: false, newType: 'CLAIM', assetOptions: [], loadingAssets: false,
        form: { asset_id: '', reason: '' },
        submitting: false,
      };
    },
    computed: {
      rowsAll() { return this.tab === 'CLAIM' ? this.claims : this.returns; },
      pendingCount() { return this.claims.concat(this.returns).filter((r) => r.audit_status === 'PENDING').length; },
      monthClaimCount() { const mk = this.monthKey(); return this.claims.filter((r) => this.bjDate(r.created_at).slice(0, 7) === mk).length; },
      monthReturnCount() { const mk = this.monthKey(); return this.returns.filter((r) => this.bjDate(r.created_at).slice(0, 7) === mk).length; },
      filtered() {
        const kw = (this.keyword || '').trim().toLowerCase();
        return this.rowsAll.filter((r) => {
          if (this.statusFilter && r.audit_status !== this.statusFilter) return false;
          if (kw && !((r.req_no || '') + (r.asset_name || '') + (r.user_name || '') + (r.reason || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      pageTotal() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      newTitle() { return this.newType === 'CLAIM' ? '新建领用申请' : '新建退库申请'; },
    },
    async mounted() {
      try {
        const info = await api.get('/api/auth/info');
        const perms = info.permissions || [];
        this.canAudit = perms.includes('*:*:*') || perms.includes('assets:requisition:audit');
      } catch (e) { /* keep false */ }
      await this.load();
      this.loadOverview();
      this.loading = false;
    },
    methods: {
      monthKey() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1); },
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
      },
      bjDate(s) { const v = this.bj(s); return v === '—' ? '' : v.slice(0, 10); },
      num(v) { return Number(v || 0).toLocaleString(); },
      auditTag(s) { return { PENDING: 'tag-blue', APPROVED: 'tag-green', REJECTED: 'tag-red' }[s] || 'tag-gray'; },
      auditLabel(s) { return { PENDING: '待审批', APPROVED: '已通过', REJECTED: '已驳回' }[s] || s; },
      typeTag(t) { return { CLAIM: 'tag-teal', RETURN: 'tag-amber' }[t] || 'tag-gray'; },
      async load() {
        const p1 = api.page('/api/assets/requisitions', { req_type: 'CLAIM', pageNum: 1, pageSize: 200 })
          .then((r) => { this.claims = r.rows || []; }).catch(() => { this.claims = []; });
        const p2 = api.page('/api/assets/requisitions', { req_type: 'RETURN', pageNum: 1, pageSize: 200 })
          .then((r) => { this.returns = r.rows || []; }).catch(() => { this.returns = []; });
        await Promise.all([p1, p2]);
      },
      loadOverview() {
        api.get('/api/assets/overview').then((d) => { this.stockTotal = ((d.status_counts || {}).IN_STOCK) || 0; }).catch(() => {});
      },
      setTab(t) { this.tab = t; this.pageNum = 1; },
      query() { this.pageNum = 1; },
      reset() { this.statusFilter = ''; this.keyword = ''; this.query(); },
      goPage(p) { if (p < 1 || p > this.pageCount) return; this.pageNum = p; },
      async audit(r, action) {
        const kind = r.req_type === 'CLAIM' ? '领用' : '退库';
        const tip = action === 'APPROVE'
          ? '确认通过该' + kind + '申请？审批通过后将联动更新资产状态。'
          : '确认驳回该' + kind + '申请？';
        if (!window.confirm(tip)) return;
        try {
          await api.post('/api/assets/requisitions/' + r.req_id + '/audit', { action, comment: action === 'APPROVE' ? '同意' : '不符合条件，驳回' });
          this.$root.toast(action === 'APPROVE' ? '已通过该' + kind + '申请' : '已驳回该' + kind + '申请', 'ok');
          await this.load();
          this.loadOverview();
        } catch (e) { /* toast shown */ }
      },
      async openNew(type) {
        this.newType = type;
        this.form = { asset_id: '', reason: '' };
        this.showNew = true;
        this.loadingAssets = true;
        try {
          const st = type === 'CLAIM' ? 'IN_STOCK' : 'IN_USE';
          const r = await api.page('/api/assets/ledger', { status: st, pageNum: 1, pageSize: 200 });
          this.assetOptions = r.rows || [];
        } catch (e) { this.assetOptions = []; }
        this.loadingAssets = false;
      },
      async submitNew() {
        const f = this.form;
        if (!f.asset_id) return this.$root.toast('请选择资产', 'warn');
        if (!f.reason.trim()) return this.$root.toast('请填写申请事由', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/assets/requisitions', { req_type: this.newType, asset_id: f.asset_id, reason: f.reason.trim() });
          this.$root.toast(this.newType === 'CLAIM' ? '领用申请已提交' : '退库申请已提交', 'ok');
          this.showNew = false;
          this.tab = this.newType;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      onPrimary() { this.openNew('CLAIM'); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card">
          <div class="ico ico-blue"><ic name="clipboard-list" size="28"></ic></div>
          <div class="meta">
            <div class="label">待审批申请</div>
            <div class="val" style="color:var(--primary)">{{ num(pendingCount) }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">件</span></div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-teal"><ic name="package" size="28"></ic></div>
          <div class="meta">
            <div class="label">本月领用数量</div>
            <div class="val" style="color:var(--teal)">{{ num(monthClaimCount) }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">件</span></div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-amber"><ic name="rotate-ccw" size="28"></ic></div>
          <div class="meta">
            <div class="label">本月退库数量</div>
            <div class="val" style="color:#C77F06">{{ num(monthReturnCount) }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">件</span></div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-blue"><ic name="box" size="28"></ic></div>
          <div class="meta">
            <div class="label">在库资产总数</div>
            <div class="val" style="color:var(--primary)">{{ num(stockTotal) }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">件</span></div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <!-- requisition tabs + table -->
      <div class="card">
        <div class="pg-tabs">
          <span :class="['pg-tab', tab === 'CLAIM' ? 'on' : '']" @click="setTab('CLAIM')">领用申请 <span class="cnt">({{ claims.length }})</span></span>
          <span :class="['pg-tab', tab === 'RETURN' ? 'on' : '']" @click="setTab('RETURN')">退库管理 <span class="cnt">({{ returns.length }})</span></span>
        </div>
        <div class="card-bd" style="padding-top:12px">
          <div class="filters" style="margin-bottom:12px">
            <select class="select" style="width:140px" v-model="statusFilter" @change="query">
              <option value="">全部状态</option>
              <option value="PENDING">待审批</option>
              <option value="APPROVED">已通过</option>
              <option value="REJECTED">已驳回</option>
            </select>
            <input class="input" style="flex:1; min-width:200px" placeholder="请输入单号、资产名称、申请人或事由" v-model="keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
            <button class="btn btn-primary" style="margin-left:auto" @click="openNew(tab)"><ic name="plus" size="14"></ic>新建{{ tab === 'CLAIM' ? '领用' : '退库' }}申请</button>
          </div>
          <table class="table table-stripe">
            <thead><tr>
              <th>申请单号</th><th>申领资产</th><th>申请人</th><th>所属部门</th><th>申请事由</th><th>申请时间</th><th>当前状态</th><th>操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in shownRows" :key="r.req_id">
                <td class="num strong">{{ r.req_no }}</td>
                <td>
                  <div class="strong">{{ r.asset_name || '—' }}</div>
                  <div class="muted" style="font-size:11.5px">{{ r.asset_code || '' }}</div>
                </td>
                <td>{{ r.user_name || '—' }}</td>
                <td class="muted">{{ r.dept_name || '—' }}</td>
                <td class="ellipsis" :title="r.reason" style="max-width:220px">{{ r.reason || '—' }}</td>
                <td class="num muted">{{ bj(r.created_at) }}</td>
                <td><span :class="['tag', auditTag(r.audit_status)]">{{ auditLabel(r.audit_status) }}</span></td>
                <td class="actions">
                  <template v-if="canAudit && r.audit_status === 'PENDING'">
                    <button class="btn btn-text btn-sm" @click="audit(r, 'APPROVE')">通过</button>
                    <button class="btn btn-text btn-sm danger" @click="audit(r, 'REJECT')">驳回</button>
                  </template>
                  <span v-else class="muted" style="font-size:12px">{{ r.audit_status === 'PENDING' ? '等待审批' : '—' }}</span>
                </td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="8"><div class="empty">暂无{{ tab === 'CLAIM' ? '领用' : '退库' }}申请</div></td></tr>
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

      <!-- new claim / return modal -->
      <Modal :title="newTitle" width="520px" v-if="showNew" @close="showNew = false">
        <div class="form-item">
          <label class="req">选择资产</label>
          <select class="select" v-model="form.asset_id">
            <option value="">{{ loadingAssets ? '资产加载中…' : (newType === 'CLAIM' ? '请选择在库资产' : '请选择在用资产') }}</option>
            <option v-for="a in assetOptions" :key="a.asset_id" :value="a.asset_id">{{ a.asset_code }} · {{ a.name }}</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">申请事由</label>
          <textarea class="input" maxlength="200" :placeholder="newType === 'CLAIM' ? '请填写领用事由（不超过 200 字）' : '请填写退库事由（不超过 200 字）'" v-model="form.reason"></textarea>
        </div>
        <div class="muted" style="text-align:right; font-size:12px; margin-top:-8px">{{ form.reason.length }}/200</div>
        <div class="muted" style="font-size:12px">
          <ic name="info" size="13"></ic>
          {{ newType === 'CLAIM' ? '领用申请审批通过后，资产状态将联动置为「在用」，保管人变更为申请人。' : '退库申请审批通过后，资产状态将联动回到「在库」。' }}
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showNew = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitNew">提交申请</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
