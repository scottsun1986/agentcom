/* /assets/maintenance 维保与维修 — pixel replica of design/mockups/019-assets-maintenance.png
   Layout: greeting / 4 KPI cards / 维修工单 table with status tabs + pager / 报修 + 完成维修 modals */
AppPages['/assets/maintenance'] = {
  route: '/assets/maintenance', title: '维保与维修', category: 'ASSETS', primaryAction: '新建报修', icon: 'wrench',
  component: {
    data() {
      return {
        loading: true,
        logs: [],
        canOp: false,
        tab: 'all',
        filters: { keyword: '', status: '' },
        pageNum: 1,
        pageSize: 10,
        showReport: false,
        submitting: false,
        form: { asset_id: '', fault_desc: '', vendor: '' },
        assets: [],
        showComplete: false,
        completeTarget: null,
        completeForm: { cost: '', result: 'FIXED' },
      };
    },
    computed: {
      kpi() {
        const now = new Date();
        const mk = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
        const c = { monthCount: 0, totalCost: 0, repairing: 0, fixed: 0, scrapped: 0, lastMonth: 0 };
        const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        const lk = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        this.logs.forEach((l) => {
          const m = (l.created_at || '').slice(0, 7);
          if (m === mk) c.monthCount++;
          if (m === lk) c.lastMonth++;
          c.totalCost += Number(l.cost) || 0;
          if (l.status === 'IN_REPAIR') c.repairing++;
          else if (l.status === 'FIXED') c.fixed++;
          else if (l.status === 'SCRAPPED') c.scrapped++;
        });
        c.totalCost = Math.round(c.totalCost * 100) / 100;
        c.trend = c.lastMonth ? Math.round((c.monthCount - c.lastMonth) / c.lastMonth * 100) : null;
        return c;
      },
      tabCounts() {
        const c = { all: this.logs.length, IN_REPAIR: 0, FIXED: 0, SCRAPPED: 0 };
        this.logs.forEach((l) => { if (c[l.status] !== undefined) c[l.status]++; });
        return c;
      },
      filtered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        return this.logs.filter((l) => {
          if (this.tab !== 'all' && l.status !== this.tab) return false;
          if (this.filters.status && l.status !== this.filters.status) return false;
          if (kw && !((l.asset_name || '') + (l.asset_code || '') + (l.fault_desc || '') + (l.vendor || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      pageTotal() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      hello() {
        const h = new Date().getHours();
        const w = h < 6 ? '凌晨好' : h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
        const u = api.cachedUser();
        return ((u && u.nick_name) || '您好') + '，' + w + '！';
      },
    },
    async mounted() {
      try {
        const info = await api.get('/api/auth/info');
        const perms = info.permissions || [];
        this.canOp = perms.includes('*:*:*') || perms.includes('assets:maintenance:add');
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
      money(n) { return n === null || n === undefined ? '—' : Number(n).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
      async load() {
        try {
          const r = await api.page('/api/assets/maintenance', { pageNum: 1, pageSize: 200 });
          this.logs = r.rows || [];
        } catch (e) { this.logs = []; }
      },
      statusLabel(s) { return { IN_REPAIR: '维修中', FIXED: '已修复', SCRAPPED: '已报废' }[s] || s; },
      statusTag(s) { return { IN_REPAIR: 'tag-amber', FIXED: 'tag-green', SCRAPPED: 'tag-red' }[s] || 'tag-gray'; },
      setTab(t) { this.tab = t; this.pageNum = 1; },
      query() { this.pageNum = 1; },
      reset() { this.filters = { keyword: '', status: '' }; this.query(); },
      goPage(p) { if (p === '...' || p < 1 || p > this.pageCount) return; this.pageNum = p; },
      async openReport() {
        this.form = { asset_id: '', fault_desc: '', vendor: '' };
        if (!this.assets.length) {
          try {
            const r = await api.page('/api/assets/ledger', { pageNum: 1, pageSize: 200 });
            this.assets = (r.rows || []).filter((a) => a.status !== 'SCRAPPED');
          } catch (e) { this.assets = []; }
        }
        this.showReport = true;
      },
      async submitReport() {
        const f = this.form;
        if (!f.asset_id) return this.$root.toast('请选择报修资产', 'warn');
        if (!f.fault_desc.trim()) return this.$root.toast('请填写故障描述', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/assets/maintenance', { asset_id: f.asset_id, fault_desc: f.fault_desc.trim(), vendor: f.vendor.trim() || undefined });
          this.$root.toast('报修登记成功，资产已转为维修中', 'ok');
          this.showReport = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      openComplete(l) {
        this.completeTarget = l;
        this.completeForm = { cost: '', result: 'FIXED' };
        this.showComplete = true;
      },
      async submitComplete() {
        const t = this.completeTarget;
        if (!t) return;
        const cost = Number(this.completeForm.cost);
        if (this.completeForm.cost === '' || isNaN(cost) || cost < 0) return this.$root.toast('请填写有效的维修费用', 'warn');
        try {
          await api.post('/api/assets/maintenance/' + t.log_id + '/complete', { cost, result: this.completeForm.result });
          this.$root.toast(this.completeForm.result === 'SCRAPPED' ? '维修单已完结，资产判定报废' : '维修完成，资产已修复回库', 'ok');
          this.showComplete = false;
          this.completeTarget = null;
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openReport(); },
    },
    template: `
    <div v-if="!loading">
      <div class="page-sub" style="margin-bottom:14px; font-size:14px">
        <b>{{ hello }}</b>　当前共有 <b>{{ kpi.repairing }}</b> 条维修工单正在处理。
      </div>

      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="wrench" size="28"></ic></div>
          <div class="meta"><div class="label">本月报修工单</div><div class="val" style="color:var(--primary)">{{ kpi.monthCount }}</div>
            <div class="muted" style="font-size:12px">上月 {{ kpi.lastMonth }} 单<span v-if="kpi.trend !== null"> · 环比 <span :style="{color: kpi.trend >= 0 ? 'var(--red)' : 'var(--green)'}">{{ kpi.trend >= 0 ? '↑' : '↓' }} {{ Math.abs(kpi.trend) }}%</span></span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="banknote" size="28"></ic></div>
          <div class="meta"><div class="label">累计维修费用 (元)</div><div class="val" style="color:var(--teal)">{{ money(kpi.totalCost) }}</div>
            <div class="muted" style="font-size:12px">已完结工单费用合计</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="timer" size="28"></ic></div>
          <div class="meta"><div class="label">维修中工单</div><div class="val" style="color:var(--amber)">{{ kpi.repairing }}</div>
            <div class="muted" style="font-size:12px">待完成维修并验收</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="package" size="28"></ic></div>
          <div class="meta"><div class="label">已修复 / 已报废</div><div class="val" style="color:var(--red)">{{ kpi.fixed }} <span style="font-size:15px;color:var(--text-3)">/ {{ kpi.scrapped }}</span></div>
            <div class="muted" style="font-size:12px">历史完结工单</div></div>
        </div>
      </div>

      <!-- work order list -->
      <div class="card">
        <div class="card-bd" style="padding-top:4px">
          <div class="lr-tabs" style="margin:0 0 12px">
            <span :class="['lr-tab', tab === 'all' ? 'on' : '']" @click="setTab('all')">全部工单 ({{ tabCounts.all }})</span>
            <span :class="['lr-tab', tab === 'IN_REPAIR' ? 'on' : '']" @click="setTab('IN_REPAIR')">维修中 ({{ tabCounts.IN_REPAIR }})</span>
            <span :class="['lr-tab', tab === 'FIXED' ? 'on' : '']" @click="setTab('FIXED')">已修复 ({{ tabCounts.FIXED }})</span>
            <span :class="['lr-tab', tab === 'SCRAPPED' ? 'on' : '']" @click="setTab('SCRAPPED')">已报废 ({{ tabCounts.SCRAPPED }})</span>
          </div>
          <div class="filters">
            <input class="input" style="flex:1; min-width:200px" placeholder="请输入资产名称、编号、故障描述或维修单位" v-model="filters.keyword" @keyup.enter="query">
            <select class="select" style="width:130px" v-model="filters.status" @change="query">
              <option value="">全部状态</option><option value="IN_REPAIR">维修中</option><option value="FIXED">已修复</option><option value="SCRAPPED">已报废</option>
            </select>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr>
              <th>资产</th><th>故障描述</th><th>维修单位</th><th>维修费用 (元)</th><th>状态</th><th>报修时间</th><th style="width:130px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="l in shownRows" :key="l.log_id">
                <td><div class="strong">{{ l.asset_name || '—' }}</div><div class="muted" style="font-size:12px">{{ l.asset_code || '' }}</div></td>
                <td class="ellipsis" :title="l.fault_desc" style="max-width:260px">{{ l.fault_desc || '—' }}</td>
                <td>{{ l.vendor || '—' }}</td>
                <td class="num">{{ l.cost === null || l.cost === undefined ? '—' : money(l.cost) }}</td>
                <td><span :class="['tag', statusTag(l.status)]">{{ statusLabel(l.status) }}</span></td>
                <td class="num muted">{{ bj(l.created_at) }}</td>
                <td class="actions">
                  <button v-if="canOp && l.status === 'IN_REPAIR'" class="btn btn-primary btn-sm" @click="openComplete(l)">完成维修</button>
                  <span v-else class="muted" style="font-size:12px">已完结</span>
                </td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="7"><div class="empty">暂无维修工单</div></td></tr>
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

      <!-- report fault modal -->
      <Modal title="新建报修" width="560px" v-if="showReport" @close="showReport = false">
        <div class="form-item">
          <label class="req">报修资产</label>
          <select class="select" v-model="form.asset_id">
            <option value="">请选择资产</option>
            <option v-for="a in assets" :key="a.asset_id" :value="a.asset_id">{{ a.name }}（{{ a.asset_code }} · {{ a.status_label }}）</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">故障描述</label>
          <textarea class="input" maxlength="200" placeholder="请描述故障现象，如：按下电源键无反应，疑似主板故障" v-model="form.fault_desc"></textarea>
        </div>
        <div class="form-item">
          <label>维修单位</label>
          <input class="input" maxlength="50" placeholder="请输入维修单位 / 服务商名称" v-model="form.vendor">
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showReport = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitReport">提交报修</button>
        </template>
      </Modal>

      <!-- complete modal -->
      <Modal title="完成维修登记" width="480px" v-if="showComplete && completeTarget" @close="showComplete = false">
        <div class="dtl-box" style="margin-bottom:14px">
          <span class="k">资产</span><span class="strong">{{ completeTarget.asset_name }}（{{ completeTarget.asset_code }}）</span>
          <span class="k">故障描述</span><span>{{ completeTarget.fault_desc }}</span>
          <span class="k">维修单位</span><span>{{ completeTarget.vendor || '—' }}</span>
        </div>
        <div class="form-item">
          <label class="req">维修结果</label>
          <select class="select" v-model="completeForm.result">
            <option value="FIXED">修复完成（资产转为在库）</option>
            <option value="SCRAPPED">判定报废（资产转为已报废）</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">维修费用 (元)</label>
          <input type="number" class="input" min="0" step="0.01" placeholder="请输入本次维修费用" v-model="completeForm.cost">
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showComplete = false">取消</button>
          <button class="btn btn-primary" @click="submitComplete">确认完结</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
