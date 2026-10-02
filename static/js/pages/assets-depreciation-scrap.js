/* /assets/depreciation-scrap 折旧与报废处置 — pixel replica of design/mockups/021-assets-depreciation-scrap.png
   Layout: 4 summary cards / tabs(折旧计提 | 报废处置) tables / 发起报废申请 modal */
AppPages['/assets/depreciation-scrap'] = {
  route: '/assets/depreciation-scrap', title: '折旧与报废处置', category: 'ASSETS', primaryAction: '发起报废申请', icon: 'trending-down',
  subtitle: '按月平均年限法自动计提折旧，支持报废申请、技术鉴定报告上传、国资处置审批流程和残值回收变价登记。',
  component: {
    data() {
      return {
        loading: true,
        month: '',
        dep: { summary: { total_price: 0, total_monthly_depreciation: 0, total_current_value: 0 }, method: '', items: [] },
        scrapReqs: [],
        canAudit: false,
        canScrap: false,
        tab: 'dep',
        filters: { keyword: '' },
        pageNum: 1,
        pageSize: 10,
        reqPage: 1,
        reqPageSize: 8,
        showScrap: false,
        submitting: false,
        form: { asset_id: '', reason: '' },
        assets: [],
        detail: null,
      };
    },
    computed: {
      sum() { return this.dep.summary || { total_price: 0, total_monthly_depreciation: 0, total_current_value: 0 }; },
      pendingScrap() { return this.scrapReqs.filter((r) => r.audit_status === 'PENDING').length; },
      depFiltered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        if (!kw) return this.dep.items;
        return this.dep.items.filter((it) => ((it.asset_code || '') + (it.name || '') + (it.category_name || '')).toLowerCase().includes(kw));
      },
      depTotal() { return this.depFiltered.length; },
      depCount() { return Math.max(1, Math.ceil(this.depTotal / this.pageSize)); },
      depRows() { return this.depFiltered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      reqFiltered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        if (!kw) return this.scrapReqs;
        return this.scrapReqs.filter((r) => ((r.req_no || '') + (r.asset_name || '') + (r.asset_code || '') + (r.user_name || '')).toLowerCase().includes(kw));
      },
      reqTotal() { return this.reqFiltered.length; },
      reqCount() { return Math.max(1, Math.ceil(this.reqTotal / this.reqPageSize)); },
      reqRows() { return this.reqFiltered.slice((this.reqPage - 1) * this.reqPageSize, this.reqPage * this.reqPageSize); },
      hello() {
        const h = new Date().getHours();
        const w = h < 6 ? '凌晨好' : h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
        const u = api.cachedUser();
        return ((u && u.nick_name) || '您好') + '，' + w + '！';
      },
    },
    async mounted() {
      const n = new Date();
      this.month = n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0');
      try {
        const info = await api.get('/api/auth/info');
        const perms = info.permissions || [];
        this.canAudit = perms.includes('*:*:*') || perms.includes('assets:requisition:audit');
        this.canScrap = perms.includes('*:*:*') || perms.includes('assets:requisition:add');
      } catch (e) { /* keep false */ }
      await Promise.all([this.loadDep(), this.loadScrap()]);
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
      money(n) { return Number(n || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
      async loadDep() {
        try {
          this.dep = await api.get('/api/assets/depreciation', { month: this.month });
        } catch (e) { this.dep = { summary: { total_price: 0, total_monthly_depreciation: 0, total_current_value: 0 }, method: '', items: [] }; }
        this.pageNum = 1;
      },
      async loadScrap() {
        try {
          const r = await api.page('/api/assets/requisitions', { req_type: 'SCRAP', pageNum: 1, pageSize: 200 });
          this.scrapReqs = r.rows || [];
        } catch (e) { this.scrapReqs = []; }
      },
      usedMonths(it) {
        if (!it.purchase_date) return 0;
        const parts = this.month.split('-').map(Number);
        const pp = String(it.purchase_date).slice(0, 10).split('-').map(Number);
        const n = (parts[0] - pp[0]) * 12 + (parts[1] - pp[1]);
        return Math.max(0, Math.min(n, 60));
      },
      statusLabel(s) { return { PENDING: '待审批', APPROVED: '已通过', REJECTED: '已驳回' }[s] || s; },
      statusTag(s) { return { PENDING: 'tag-blue', APPROVED: 'tag-green', REJECTED: 'tag-red' }[s] || 'tag-gray'; },
      setTab(t) { this.tab = t; },
      query() { this.pageNum = 1; this.reqPage = 1; },
      reset() { this.filters = { keyword: '' }; this.query(); },
      goDepPage(p) { if (p === '...' || p < 1 || p > this.depCount) return; this.pageNum = p; },
      goReqPage(p) { if (p === '...' || p < 1 || p > this.reqCount) return; this.reqPage = p; },
      async openScrap() {
        this.form = { asset_id: '', reason: '' };
        if (!this.assets.length) {
          try {
            const r = await api.page('/api/assets/ledger', { pageNum: 1, pageSize: 200 });
            this.assets = (r.rows || []).filter((a) => a.status !== 'SCRAPPED');
          } catch (e) { this.assets = []; }
        }
        this.showScrap = true;
      },
      async submitScrap() {
        const f = this.form;
        if (!f.asset_id) return this.$root.toast('请选择报废资产', 'warn');
        if (!f.reason.trim()) return this.$root.toast('请填写报废原因', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/assets/requisitions', { req_type: 'SCRAP', asset_id: f.asset_id, reason: f.reason.trim() });
          this.$root.toast('报废申请已提交，等待审批', 'ok');
          this.showScrap = false;
          await this.loadScrap();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async audit(r, action) {
        const tip = action === 'APPROVE' ? '确认通过该报废申请？通过后资产将转为已报废状态。' : '确认驳回该报废申请？';
        if (!window.confirm(tip)) return;
        try {
          await api.post('/api/assets/requisitions/' + r.req_id + '/audit', { action, comment: action === 'APPROVE' ? '同意报废处置' : '不符合报废条件，驳回' });
          this.$root.toast(action === 'APPROVE' ? '已通过该报废申请' : '已驳回该报废申请', 'ok');
          await Promise.all([this.loadScrap(), this.loadDep()]);
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { if (this.canScrap) this.openScrap(); else this.$root.toast('您暂无发起报废申请的权限', 'warn'); },
    },
    template: `
    <div v-if="!loading">
      <!-- summary cards -->
      <div class="kpi-row">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="file-text" size="28"></ic></div>
          <div class="meta"><div class="label">资产原值合计 (元)</div><div class="val" style="color:var(--primary)">{{ money(sum.total_price) }}</div>
            <div class="muted" style="font-size:12px">在册非报废资产 {{ dep.items.length }} 项</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="bar-chart-3" size="28"></ic></div>
          <div class="meta"><div class="label">本月计提折旧 (元)</div><div class="val" style="color:var(--teal)">{{ money(sum.total_monthly_depreciation) }}</div>
            <div class="muted" style="font-size:12px">{{ dep.method || '平均年限法（5 年）' }}</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="wallet" size="28"></ic></div>
          <div class="meta"><div class="label">资产净值合计 (元)</div><div class="val" style="color:var(--amber)">{{ money(sum.total_current_value) }}</div>
            <div class="muted" style="font-size:12px">截至 {{ month }} 月末</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="trash" size="28"></ic></div>
          <div class="meta"><div class="label">待处置报废申请</div><div class="val" style="color:var(--red)">{{ pendingScrap }}</div>
            <div class="muted" style="font-size:12px">共 {{ scrapReqs.length }} 笔 · 待审批 {{ pendingScrap }}</div></div>
        </div>
      </div>

      <!-- tabs -->
      <div class="card" style="margin-top:0">
        <div class="pg-tabs">
          <span :class="['pg-tab', tab === 'dep' ? 'on' : '']" @click="setTab('dep')">折旧计提</span>
          <span :class="['pg-tab', tab === 'scrap' ? 'on' : '']" @click="setTab('scrap')">报废处置 <span class="cnt">({{ scrapReqs.length }})</span></span>
        </div>

        <div class="card-bd" style="padding-top:12px" v-if="tab === 'dep'">
          <div class="filters">
            <span class="strong" style="font-size:14px">{{ month }} 折旧计提明细</span>
            <span style="flex:1"></span>
            <input type="month" class="input" style="width:150px" v-model="month" @change="loadDep">
            <input class="input" style="width:220px" placeholder="请输入资产编号、名称或分类" v-model="filters.keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr>
              <th>资产编号</th><th>资产名称</th><th>资产分类</th><th>原值 (元)</th><th>已提月数</th>
              <th>本月折旧 (元)</th><th>净值 (元)</th><th>状态</th><th style="width:90px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="it in depRows" :key="it.asset_id">
                <td class="num">{{ it.asset_code }}</td>
                <td class="strong">{{ it.name }}</td>
                <td>{{ it.category_name }}</td>
                <td class="num">{{ money(it.price) }}</td>
                <td class="num">{{ usedMonths(it) }} / 60</td>
                <td class="num" style="color:var(--amber)">{{ money(it.monthly_depreciation) }}</td>
                <td class="num strong">{{ money(it.current_value) }}</td>
                <td><span class="tag tag-green"><ic name="check-circle-2" size="12"></ic>计提中</span></td>
                <td class="actions">
                  <button v-if="canScrap" class="btn btn-text btn-sm danger" @click="form.asset_id = it.asset_id; openScrap()">报废</button>
                  <span v-else class="muted" style="font-size:12px">—</span>
                </td>
              </tr>
              <tr v-if="!depRows.length"><td colspan="9"><div class="empty">暂无折旧计提明细</div></td></tr>
            </tbody>
          </table>
          <div class="pager" v-if="depCount > 1">
            <span>共 {{ depTotal }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goDepPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in depCount" :key="p" v-show="depCount <= 7 || p === 1 || p === depCount || Math.abs(p - pageNum) <= 1" class="pg" :class="{on: p === pageNum}" @click="goDepPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= depCount" @click="goDepPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>

        <div class="card-bd" style="padding-top:12px" v-else>
          <div class="filters">
            <span class="strong" style="font-size:14px">报废处置审批</span>
            <span style="flex:1"></span>
            <input class="input" style="width:220px" placeholder="请输入单号、资产或申请人" v-model="filters.keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr>
              <th>申请单号</th><th>资产</th><th>申请人</th><th>报废原因</th><th>申请时间</th><th>当前状态</th><th>审批人</th><th style="width:150px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in reqRows" :key="r.req_id">
                <td class="num strong">{{ r.req_no }}</td>
                <td><div class="strong">{{ r.asset_name || '—' }}</div><div class="muted" style="font-size:12px">{{ r.asset_code || '' }}</div></td>
                <td>{{ r.user_name || '—' }}</td>
                <td class="ellipsis" :title="r.reason" style="max-width:240px">{{ r.reason || '—' }}</td>
                <td class="num muted">{{ bj(r.created_at) }}</td>
                <td><span :class="['tag', statusTag(r.audit_status)]">{{ statusLabel(r.audit_status) }}</span></td>
                <td>{{ r.approver_name || '—' }}</td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="detail = r">查看</button>
                  <template v-if="canAudit && r.audit_status === 'PENDING'">
                    <button class="btn btn-text btn-sm" @click="audit(r, 'APPROVE')">通过</button>
                    <button class="btn btn-text btn-sm danger" @click="audit(r, 'REJECT')">驳回</button>
                  </template>
                </td>
              </tr>
              <tr v-if="!reqRows.length"><td colspan="8"><div class="empty">暂无报废处置申请</div></td></tr>
            </tbody>
          </table>
          <div class="pager" v-if="reqCount > 1">
            <span>共 {{ reqTotal }} 条</span>
            <button class="pg" :disabled="reqPage <= 1" @click="goReqPage(reqPage - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in reqCount" :key="p" v-show="reqCount <= 7 || p === 1 || p === reqCount || Math.abs(p - reqPage) <= 1" class="pg" :class="{on: p === reqPage}" @click="goReqPage(p)">{{ p }}</button>
            <button class="pg" :disabled="reqPage >= reqCount" @click="goReqPage(reqPage + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
      </div>

      <!-- scrap apply modal -->
      <Modal title="发起报废申请" width="560px" v-if="showScrap" @close="showScrap = false">
        <div class="form-item">
          <label class="req">报废资产</label>
          <select class="select" v-model="form.asset_id">
            <option value="">请选择资产</option>
            <option v-for="a in assets" :key="a.asset_id" :value="a.asset_id">{{ a.name }}（{{ a.asset_code }} · 原值 {{ money(a.price) }} 元）</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">报废原因</label>
          <textarea class="input" maxlength="200" placeholder="如：设备老化，频繁故障，无法满足业务需求" v-model="form.reason"></textarea>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showScrap = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitScrap">提交申请</button>
        </template>
      </Modal>

      <!-- scrap detail modal -->
      <Modal title="报废申请详情" width="560px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">申请单号</span><span class="strong num">{{ detail.req_no }}</span>
          <span class="k">资产</span><span>{{ detail.asset_name }}（{{ detail.asset_code }}）</span>
          <span class="k">申请人</span><span>{{ detail.user_name || '—' }}</span>
          <span class="k">申请时间</span><span class="num">{{ bj(detail.created_at) }}</span>
          <span class="k">报废原因</span><span>{{ detail.reason || '—' }}</span>
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
