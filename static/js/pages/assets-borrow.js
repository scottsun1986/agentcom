/* /assets/borrow 借用与归还 — pixel replica of design/mockups/017-assets-borrow.png
   Layout: 4 KPI cards / tabs(在借|即将到期|已超期|已归还) + borrow table (overdue rows highlighted) + 借用登记 modal */
AppPages['/assets/borrow'] = {
  route: '/assets/borrow', title: '借用与归还', category: 'ASSETS', primaryAction: '借用登记', icon: 'history',
  subtitle: '对办公资产、设备器材的借用登记、归还核验与催还管理，确保资产规范使用与及时回收。',
  component: {
    data() {
      const p = (n) => String(n).padStart(2, '0');
      const fmt = (d) => d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      const t = new Date();
      const lim = new Date();
      lim.setDate(lim.getDate() + 3);
      return {
        loading: true,
        today: fmt(t),
        dueLimit: fmt(lim),
        borrows: [],
        tab: 'active',
        keyword: '',
        pageNum: 1, pageSize: 10,
        showNew: false, assetOptions: [], loadingAssets: false,
        form: { asset_id: '', expected_return_date: '', reason: '' },
        submitting: false,
      };
    },
    computed: {
      activeRows() { return this.borrows.filter((r) => r.audit_status === 'APPROVED' && !r.actual_return_date); },
      dueRows() { return this.activeRows.filter((r) => r.expected_return_date && r.expected_return_date >= this.today && r.expected_return_date <= this.dueLimit); },
      overdueRows() { return this.activeRows.filter((r) => r.expected_return_date && r.expected_return_date < this.today); },
      returnedRows() { return this.borrows.filter((r) => r.actual_return_date); },
      returnedMonthCount() {
        const mk = this.today.slice(0, 7);
        return this.returnedRows.filter((r) => String(r.actual_return_date).slice(0, 7) === mk).length;
      },
      counts() { return { active: this.activeRows.length, due: this.dueRows.length, overdue: this.overdueRows.length, returned: this.returnedRows.length }; },
      filtered() {
        let list;
        if (this.tab === 'active') list = this.activeRows;
        else if (this.tab === 'due') list = this.dueRows;
        else if (this.tab === 'overdue') list = this.overdueRows;
        else if (this.tab === 'returned') list = this.returnedRows;
        else list = this.borrows;
        const kw = (this.keyword || '').trim().toLowerCase();
        if (kw) list = list.filter((r) => ((r.req_no || '') + (r.asset_name || '') + (r.asset_code || '') + (r.user_name || '')).toLowerCase().includes(kw));
        return list;
      },
      pageTotal() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
    },
    async mounted() {
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
      num(v) { return Number(v || 0).toLocaleString(); },
      isOverdue(r) {
        return r.audit_status === 'APPROVED' && !r.actual_return_date && !!r.expected_return_date && r.expected_return_date < this.today;
      },
      isDue(r) {
        return r.audit_status === 'APPROVED' && !r.actual_return_date && !!r.expected_return_date
          && r.expected_return_date >= this.today && r.expected_return_date <= this.dueLimit;
      },
      statusInfo(r) {
        if (r.audit_status === 'PENDING') return { label: '待审批', tag: 'tag-blue' };
        if (r.audit_status === 'REJECTED') return { label: '已驳回', tag: 'tag-red' };
        if (r.actual_return_date) return { label: '已归还', tag: 'tag-green' };
        if (this.isOverdue(r)) return { label: '已超期', tag: 'tag-red' };
        if (this.isDue(r)) return { label: '即将到期', tag: 'tag-amber' };
        return { label: '在借', tag: 'tag-blue' };
      },
      overdueDays(r) {
        if (!this.isOverdue(r)) return 0;
        const ms = new Date(this.today).getTime() - new Date(r.expected_return_date).getTime();
        return Math.max(1, Math.round(ms / 86400000));
      },
      async load() {
        try {
          const r = await api.page('/api/assets/requisitions', { req_type: 'BORROW', pageNum: 1, pageSize: 200 });
          this.borrows = r.rows || [];
        } catch (e) { this.borrows = []; }
      },
      setTab(t) { this.tab = t; this.pageNum = 1; },
      query() { this.pageNum = 1; },
      reset() { this.keyword = ''; this.query(); },
      goPage(p) { if (p < 1 || p > this.pageCount) return; this.pageNum = p; },
      async returnAsset(r) {
        if (!window.confirm('确认登记归还「' + (r.asset_name || r.asset_code || '该资产') + '」？')) return;
        try {
          await api.post('/api/assets/requisitions/' + r.req_id + '/return');
          this.$root.toast('归还登记完成，资产已回到在库状态', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      async openNew() {
        this.form = { asset_id: '', expected_return_date: '', reason: '' };
        this.showNew = true;
        this.loadingAssets = true;
        try {
          const r = await api.page('/api/assets/ledger', { status: 'IN_STOCK', pageNum: 1, pageSize: 200 });
          this.assetOptions = r.rows || [];
        } catch (e) { this.assetOptions = []; }
        this.loadingAssets = false;
      },
      async submitNew() {
        const f = this.form;
        if (!f.asset_id) return this.$root.toast('请选择借用资产', 'warn');
        if (!f.expected_return_date) return this.$root.toast('请选择预计归还日期', 'warn');
        if (f.expected_return_date < this.today) return this.$root.toast('预计归还日期不能早于今天', 'warn');
        if (!f.reason.trim()) return this.$root.toast('请填写借用事由', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/assets/requisitions', {
            req_type: 'BORROW', asset_id: f.asset_id,
            expected_return_date: f.expected_return_date, reason: f.reason.trim(),
          });
          this.$root.toast('借用申请已提交，等待审批', 'ok');
          this.showNew = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      onPrimary() { this.openNew(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card">
          <div class="ico ico-blue"><ic name="clipboard-list" size="28"></ic></div>
          <div class="meta">
            <div class="label">当前在借</div>
            <div class="val" style="color:var(--primary)">{{ num(counts.active) }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">件</span></div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-amber"><ic name="clock" size="28"></ic></div>
          <div class="meta">
            <div class="label">即将到期（3天内）</div>
            <div class="val" style="color:#C77F06">{{ num(counts.due) }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">件</span></div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-red"><ic name="siren" size="28"></ic></div>
          <div class="meta">
            <div class="label">已超期未还</div>
            <div class="val" style="color:var(--red)">{{ num(counts.overdue) }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">件</span></div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-teal"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta">
            <div class="label">本月已归还</div>
            <div class="val" style="color:var(--teal)">{{ num(returnedMonthCount) }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">件</span></div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <!-- borrow table with tabs -->
      <div class="card">
        <div class="pg-tabs">
          <span :class="['pg-tab', tab === 'active' ? 'on' : '']" @click="setTab('active')">在借资产 <span class="cnt">({{ counts.active }})</span></span>
          <span :class="['pg-tab', tab === 'due' ? 'on' : '']" @click="setTab('due')">即将到期 <span class="cnt">({{ counts.due }})</span></span>
          <span :class="['pg-tab', tab === 'overdue' ? 'on' : '']" @click="setTab('overdue')">已超期 <span class="cnt">({{ counts.overdue }})</span></span>
          <span :class="['pg-tab', tab === 'returned' ? 'on' : '']" @click="setTab('returned')">已归还 <span class="cnt">(本月{{ returnedMonthCount }})</span></span>
        </div>
        <div class="card-bd" style="padding-top:12px">
          <div class="filters" style="margin-bottom:12px">
            <input class="input" style="width:260px" placeholder="请输入资产名称、资产编号或借用人" v-model="keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table table-stripe">
            <thead><tr>
              <th>借用单号</th><th>资产名称</th><th>资产编号</th><th>借用人</th><th>所属部门</th><th>借用时间</th>
              <th>预计归还日期</th><th>实际归还日期</th><th>状态</th><th>操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in shownRows" :key="r.req_id" :class="{ 'ast-row-overdue': isOverdue(r) }">
                <td class="num strong">{{ r.req_no }}</td>
                <td class="strong">{{ r.asset_name || '—' }}</td>
                <td class="num muted">{{ r.asset_code || '—' }}</td>
                <td>{{ r.user_name || '—' }}</td>
                <td class="muted">{{ r.dept_name || '—' }}</td>
                <td class="num muted">{{ bjDate(r.created_at) }}</td>
                <td>
                  <span :class="isOverdue(r) ? 'ast-date-red' : (isDue(r) ? 'ast-date-amber' : 'num')">{{ r.expected_return_date || '—' }}</span>
                  <div v-if="isOverdue(r)" class="muted" style="font-size:11px; color:var(--red)">已超期 {{ overdueDays(r) }} 天</div>
                </td>
                <td class="num" :style="r.actual_return_date ? 'color:var(--green); font-weight:600' : 'color:var(--text-3)'">{{ r.actual_return_date || '—' }}</td>
                <td><span :class="['tag', statusInfo(r).tag]">{{ statusInfo(r).label }}</span></td>
                <td class="actions">
                  <button v-if="r.audit_status === 'APPROVED' && !r.actual_return_date" class="btn btn-primary btn-sm" @click="returnAsset(r)">归还</button>
                  <span v-else class="muted" style="font-size:12px">{{ r.audit_status === 'PENDING' ? '待审批' : '—' }}</span>
                </td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="10"><div class="empty">暂无借用记录</div></td></tr>
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

      <!-- new borrow modal -->
      <Modal title="借用登记" width="520px" v-if="showNew" @close="showNew = false">
        <div class="form-item">
          <label class="req">选择资产</label>
          <select class="select" v-model="form.asset_id">
            <option value="">{{ loadingAssets ? '资产加载中…' : '请选择在库资产' }}</option>
            <option v-for="a in assetOptions" :key="a.asset_id" :value="a.asset_id">{{ a.asset_code }} · {{ a.name }}</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">预计归还日期</label>
          <input type="date" class="input" :min="today" v-model="form.expected_return_date">
        </div>
        <div class="form-item">
          <label class="req">借用事由</label>
          <textarea class="input" maxlength="200" placeholder="请填写借用事由（不超过 200 字）" v-model="form.reason"></textarea>
        </div>
        <div class="muted" style="text-align:right; font-size:12px; margin-top:-8px">{{ form.reason.length }}/200</div>
        <div class="muted" style="font-size:12px">
          <ic name="info" size="13"></ic>
          借用申请审批通过后资产转为「借出」状态；到期未还将被标记为超期并进入催还提醒。
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
