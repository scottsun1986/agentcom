/* /assets/stocktake 智能资产盘点 — pixel replica of design/mockups/020-assets-stocktake.png
   Layout: greeting / 5 KPI cards / 盘点计划 table (进度条) / 新建盘点 + 模拟扫码 + 差异报告 modals */
AppPages['/assets/stocktake'] = {
  route: '/assets/stocktake', title: '智能资产盘点', category: 'ASSETS', primaryAction: '创建盘点任务', icon: 'scan-search',
  component: {
    data() {
      return {
        loading: true,
        plans: [],
        depts: [],
        canCreate: false,
        canScan: false,
        pageNum: 1,
        pageSize: 8,
        filters: { keyword: '', status: '' },
        showCreate: false,
        submitting: false,
        form: { title: '', scope_dept_id: '' },
        // scan modal state
        scanPlan: null,
        scanCode: '',
        scanning: false,
        scanResult: null,
        scanHistory: [],
        // diff report modal state
        report: null,
      };
    },
    computed: {
      kpi() {
        const c = { total: 0, verified: 0, unverified: 0, surplus: 0, loss: 0, rate: 0, active: 0 };
        this.plans.forEach((p) => {
          c.total += p.total_count || 0;
          c.verified += p.verified_count || 0;
          c.surplus += p.surplus_count || 0;
          c.loss += p.loss_count || 0;
          if (p.status === 'IN_PROGRESS') c.active++;
        });
        c.unverified = Math.max(0, c.total - c.verified);
        c.rate = c.total ? Math.round(c.verified / c.total * 1000) / 10 : 0;
        return c;
      },
      filtered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        return this.plans.filter((p) => {
          if (this.filters.status && p.status !== this.filters.status) return false;
          if (kw && !((p.plan_no || '') + (p.title || '') + (p.scope_dept_name || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      pageTotal() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      scanPct() {
        const p = this.scanPlan;
        if (!p) return 0;
        return Math.round((p.verified_count || 0) / Math.max(1, p.total_count || 1) * 1000) / 10;
      },
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
        this.canCreate = perms.includes('*:*:*') || perms.includes('assets:stocktake:add');
        this.canScan = perms.includes('*:*:*') || perms.includes('assets:stocktake:scan');
      } catch (e) { /* keep false */ }
      try {
        const tree = await api.get('/api/system/depts');
        const flat = [];
        const walk = (nodes, depth) => (nodes || []).forEach((d) => {
          flat.push({ dept_id: d.dept_id, dept_name: (depth > 0 ? '\u00A0\u00A0'.repeat(depth) + '› ' : '') + d.dept_name });
          walk(d.children, depth + 1);
        });
        walk(tree, 0);
        this.depts = flat;
      } catch (e) { this.depts = []; }
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
          const r = await api.page('/api/assets/stocktake', { pageNum: 1, pageSize: 100 });
          this.plans = r.rows || [];
        } catch (e) { this.plans = []; }
      },
      statusLabel(s) { return { DRAFT: '草稿', IN_PROGRESS: '进行中', COMPLETED: '已完成' }[s] || s; },
      statusTag(s) { return { DRAFT: 'tag-gray', IN_PROGRESS: 'tag-blue', COMPLETED: 'tag-green' }[s] || 'tag-gray'; },
      barCls(p) { return p.progress >= 100 ? 'bar-teal' : ''; },
      goPage(p) { if (p === '...' || p < 1 || p > this.pageCount) return; this.pageNum = p; },
      query() { this.pageNum = 1; },
      reset() { this.filters = { keyword: '', status: '' }; this.query(); },
      openCreate() {
        this.form = { title: '', scope_dept_id: '' };
        this.showCreate = true;
      },
      async submitCreate() {
        if (!this.form.title.trim()) return this.$root.toast('请填写盘点任务名称', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/assets/stocktake', { title: this.form.title.trim(), scope_dept_id: this.form.scope_dept_id || undefined });
          this.$root.toast('盘点任务已创建，可点击「扫码盘点」开始核验', 'ok');
          this.showCreate = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async openScan(p) {
        this.scanPlan = JSON.parse(JSON.stringify(p));
        this.scanCode = '';
        this.scanResult = null;
        this.scanHistory = [];
        this.$nextTick(() => { const el = document.getElementById('scan-input'); if (el) el.focus(); });
      },
      async doScan() {
        const code = (this.scanCode || '').trim();
        if (!code) return this.$root.toast('请输入资产编码', 'warn');
        if (!this.scanPlan) return;
        this.scanning = true;
        try {
          const d = await api.post('/api/assets/stocktake/' + this.scanPlan.plan_id + '/scan', { asset_code: code });
          this.scanResult = d;
          const labels = { matched: '已盘', duplicate: '重复', not_found: '未找到', out_of_scope: '范围外' };
          const tags = { matched: 'tag-green', duplicate: 'tag-amber', not_found: 'tag-red', out_of_scope: 'tag-red' };
          this.scanHistory.unshift({ code: d.asset_code, name: d.asset_name || '未知资产', status: d.status, label: labels[d.status] || d.status, tag: tags[d.status] || 'tag-gray', time: new Date().toLocaleTimeString('zh-CN', { hour12: false }) });
          if (d.matched) {
            this.scanPlan.verified_count = d.verified_count;
            this.scanPlan.total_count = d.total_count;
          }
          this.scanCode = '';
          this.$nextTick(() => { const el = document.getElementById('scan-input'); if (el) el.focus(); });
        } catch (e) { /* toast shown */ }
        this.scanning = false;
      },
      async finishScan() {
        const p = this.scanPlan;
        if (!p) return;
        const left = Math.max(0, (p.total_count || 0) - (p.verified_count || 0));
        if (left > 0 && !window.confirm('仍有 ' + left + ' 项资产未盘点，确认完成盘点并生成差异报告？')) return;
        try {
          const rep = await api.post('/api/assets/stocktake/' + p.plan_id + '/complete', {});
          this.report = rep;
          this.scanPlan = null;
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      resultHead(r) {
        return {
          matched: '盘点成功！资产信息已核验为已盘。',
          duplicate: '该资产本次盘点已核验过，请勿重复扫码。',
          not_found: '未找到该编码的资产卡片，请核对编码或登记为盘盈。',
          out_of_scope: '该资产不在本次盘点范围内。',
        }[r] || '';
      },
      onPrimary() { this.openCreate(); },
    },
    template: `
    <div v-if="!loading">
      <div class="page-sub" style="margin-bottom:14px; font-size:14px">
        <b>{{ hello }}</b>　当前有 <b>{{ kpi.active }}</b> 个盘点任务进行中，请扫码核验资产实物。
      </div>

      <!-- KPI row -->
      <div class="kpi-row kpi-row-5">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="layers" size="28"></ic></div>
          <div class="meta"><div class="label">应盘资产总数</div><div class="val" style="color:var(--primary)">{{ kpi.total }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">项</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta" style="flex:1"><div class="label">已盘资产</div><div class="val" style="color:var(--teal)">{{ kpi.verified }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">项</span></div>
            <div style="display:flex; align-items:center; gap:6px; margin-top:3px"><div class="progress" style="flex:1; height:6px"><div class="bar bar-teal" :style="{width: kpi.rate + '%'}"></div></div><span class="muted" style="font-size:11.5px">{{ kpi.rate }}%</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="clock" size="28"></ic></div>
          <div class="meta"><div class="label">未盘资产</div><div class="val" style="color:var(--amber)">{{ kpi.unverified }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">项</span></div>
            <div class="muted" style="font-size:12px">待扫码核验</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="trending-up" size="28"></ic></div>
          <div class="meta"><div class="label">盘盈数量</div><div class="val" style="color:var(--green)">{{ kpi.surplus }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">项</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="trending-down" size="28"></ic></div>
          <div class="meta"><div class="label">盘亏数量</div><div class="val" style="color:var(--red)">{{ kpi.loss }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">项</span></div></div>
        </div>
      </div>

      <!-- plans table -->
      <div class="card">
        <div class="card-hd"><div class="t">盘点任务</div></div>
        <div class="card-bd" style="padding-top:8px">
          <div class="filters">
            <input class="input" style="flex:1; min-width:200px" placeholder="请输入计划号或任务名称" v-model="filters.keyword" @keyup.enter="query">
            <select class="select" style="width:130px" v-model="filters.status" @change="query">
              <option value="">全部状态</option><option value="DRAFT">草稿</option><option value="IN_PROGRESS">进行中</option><option value="COMPLETED">已完成</option>
            </select>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr>
              <th>计划号</th><th>盘点任务</th><th>盘点范围</th><th>应盘总数</th><th>已盘</th><th>盘盈</th><th>盘亏</th>
              <th>状态</th><th style="width:150px">盘点进度</th><th style="width:120px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="p in shownRows" :key="p.plan_id">
                <td class="num strong">{{ p.plan_no }}</td>
                <td class="ellipsis" :title="p.title" style="max-width:180px">{{ p.title }}</td>
                <td>{{ p.scope_dept_name || '全校区 / 全部部门' }}</td>
                <td class="num">{{ p.total_count }}</td>
                <td class="num" style="color:var(--teal); font-weight:600">{{ p.verified_count }}</td>
                <td class="num">{{ p.surplus_count }}</td>
                <td class="num" :style="p.loss_count > 0 ? 'color:var(--red); font-weight:600' : ''">{{ p.loss_count }}</td>
                <td><span :class="['tag', statusTag(p.status)]">{{ statusLabel(p.status) }}</span></td>
                <td><div style="display:flex; align-items:center; gap:8px"><div class="progress" style="flex:1"><div class="bar" :class="barCls(p)" :style="{width: (p.progress || 0) + '%'}"></div></div><span class="muted" style="font-size:12px">{{ p.progress || 0 }}%</span></div></td>
                <td class="actions">
                  <button v-if="p.status === 'IN_PROGRESS'" class="btn btn-primary btn-sm" @click="openScan(p)"><ic name="scan-search" size="13"></ic>扫码盘点</button>
                  <template v-else-if="p.status === 'COMPLETED'">
                    <button class="btn btn-text btn-sm" @click="openScan(p)">盘点记录</button>
                  </template>
                  <span v-else class="muted" style="font-size:12px">—</span>
                </td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="10"><div class="empty">暂无盘点任务</div></td></tr>
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

      <!-- create modal -->
      <Modal title="创建盘点任务" width="520px" v-if="showCreate" @close="showCreate = false">
        <div class="form-item">
          <label class="req">任务名称</label>
          <input class="input" maxlength="50" placeholder="如：2026年第四季度固定资产盘点" v-model="form.title">
        </div>
        <div class="form-item">
          <label>盘点范围</label>
          <select class="select" v-model="form.scope_dept_id">
            <option value="">全校区 / 全部部门</option>
            <option v-for="d in depts" :key="d.dept_id" :value="d.dept_id">{{ d.dept_name }}</option>
          </select>
        </div>
        <div class="rec-verify" style="margin-top:2px">
          <ic name="info" size="14"></ic>
          <span>创建后任务立即开始，盘点基数为范围内全部非报废资产；在「扫码盘点」中输入/扫描资产编码完成核验，完成后自动生成差异报告。</span>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showCreate = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitCreate">创建盘点任务</button>
        </template>
      </Modal>

      <!-- scan modal -->
      <Modal title="扫码盘点核验" width="640px" v-if="scanPlan" @close="scanPlan = null">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px">
          <div>
            <span class="strong" style="font-size:14px">{{ scanPlan.title }}</span>
            <span class="tag tag-blue" style="margin-left:8px">{{ statusLabel(scanPlan.status) }}</span>
          </div>
          <span class="num muted" style="font-size:12.5px">{{ scanPlan.plan_no }}</span>
        </div>
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:14px">
          <div class="progress" style="flex:1"><div class="bar bar-teal" :style="{width: scanPct + '%'}"></div></div>
          <span class="num strong" style="font-size:13px; white-space:nowrap">{{ scanPlan.verified_count }} / {{ scanPlan.total_count }}（{{ scanPct }}%）</span>
        </div>
        <template v-if="scanPlan.status === 'IN_PROGRESS'">
          <div class="scan-input-row">
            <span class="scan-prefix"><ic name="scan-search" size="16"></ic></span>
            <input id="scan-input" class="input" style="flex:1" placeholder="请扫描资产条码 / 输入资产编码后回车" v-model="scanCode" @keyup.enter="doScan" :disabled="scanning">
            <button class="btn btn-primary" :disabled="scanning" @click="doScan">{{ scanning ? '核验中…' : '确认核验' }}</button>
          </div>
          <div v-if="scanResult" :class="['scan-panel', scanResult.matched ? 'ok' : scanResult.status === 'duplicate' ? 'warn' : 'err']">
            <div style="display:flex; align-items:center; gap:8px; font-weight:600">
              <ic :name="scanResult.matched ? 'check-circle-2' : scanResult.status === 'duplicate' ? 'alert-triangle' : 'x-circle'" size="16"></ic>
              {{ resultHead(scanResult.status) }}
            </div>
            <div v-if="scanResult.status !== 'not_found'" class="scan-meta">
              <span>资产编码 <b>{{ scanResult.asset_code }}</b></span>
              <span>资产名称 <b>{{ scanResult.asset_name }}</b></span>
              <span v-if="scanResult.dept_name">所属部门 <b>{{ scanResult.dept_name }}</b></span>
              <span v-if="scanResult.location">存放位置 <b>{{ scanResult.location }}</b></span>
            </div>
            <div v-else class="scan-meta"><span>资产编码 <b>{{ scanResult.asset_code }}</b></span></div>
          </div>
          <div class="scan-hist" v-if="scanHistory.length">
            <div class="scan-hd">核验记录（{{ scanHistory.length }}）</div>
            <div class="scan-hist-row" v-for="(h, i) in scanHistory" :key="i">
              <ic :name="h.status === 'matched' ? 'check-circle-2' : h.status === 'duplicate' ? 'alert-triangle' : 'x-circle'" size="14" :style="{color: h.status === 'matched' ? 'var(--green)' : h.status === 'duplicate' ? 'var(--amber)' : 'var(--red)'}"></ic>
              <span class="num" style="width:130px">{{ h.code }}</span>
              <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ h.name }}</span>
              <span :class="['tag', h.tag]">{{ h.label }}</span>
              <span class="muted num" style="font-size:11.5px">{{ h.time }}</span>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="empty" style="padding:26px 0">该盘点任务已完成，累计核验 {{ scanPlan.verified_count }} / {{ scanPlan.total_count }} 项</div>
        </template>
        <template #footer>
          <button class="btn btn-ghost" @click="scanPlan = null">关闭</button>
          <button v-if="scanPlan.status === 'IN_PROGRESS'" class="btn btn-primary" @click="finishScan"><ic name="check" size="14"></ic>完成盘点</button>
        </template>
      </Modal>

      <!-- diff report modal -->
      <Modal title="盘点差异报告" width="720px" v-if="report" @close="report = null">
        <div class="rp-sum">
          <div class="rp-cell"><div class="k">盘点任务</div><div class="strong" style="font-size:13.5px">{{ report.title }}</div><div class="muted num" style="font-size:12px">{{ report.plan_no }}</div></div>
          <div class="rp-cell"><div class="k">应盘总数</div><div class="v">{{ report.total_count }}</div></div>
          <div class="rp-cell"><div class="k">已盘核验</div><div class="v" style="color:var(--teal)">{{ report.verified_count }}</div></div>
          <div class="rp-cell"><div class="k">盘盈</div><div class="v" style="color:var(--green)">{{ report.surplus_count }}</div></div>
          <div class="rp-cell"><div class="k">盘亏</div><div class="v" style="color:var(--red)">{{ report.loss_count }}</div></div>
          <div class="rp-cell"><div class="k">盘亏率</div><div class="v" style="color:var(--red)">{{ report.loss_rate }}%</div></div>
        </div>
        <div class="scan-hd" style="margin:14px 0 8px">未盘资产清单（疑似盘亏，共 {{ (report.unverified || []).length }} 项）</div>
        <div class="rp-list">
          <table class="table" v-if="(report.unverified || []).length">
            <thead><tr><th>资产编号</th><th>资产名称</th><th>所属部门</th><th>存放位置</th></tr></thead>
            <tbody>
              <tr v-for="a in report.unverified" :key="a.asset_id">
                <td class="num">{{ a.asset_code }}</td>
                <td>{{ a.name }}</td>
                <td>{{ a.dept_name || '—' }}</td>
                <td class="muted">{{ a.location || '—' }}</td>
              </tr>
            </tbody>
          </table>
          <div v-else class="empty" style="padding:24px 0"><ic name="check-circle-2" size="20" style="color:var(--green)"></ic> 全部资产已核验，无盘亏差异</div>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="report = null">关闭</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
