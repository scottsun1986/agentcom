/* /assets/ledger 固定资产台账 — pixel replica of design/mockups/014-assets-ledger.png
   Layout: 5 stat cards / filters + ledger table (server paging) + 新增/编辑 modal + 详情 modal */
AppPages['/assets/ledger'] = {
  route: '/assets/ledger', title: '固定资产台账', category: 'ASSETS', primaryAction: '新增资产', icon: 'clipboard-list',
  subtitle: '统一管理单位固定资产，支持一物一码、全生命周期管理。',
  component: {
    data() {
      return {
        loading: true,
        stats: { total_assets: 0, total_value: 0, in_use: 0, in_use_rate: 0, in_repair: 0, scrapped: 0 },
        rows: [], total: 0, pageNum: 1, pageSize: 10,
        filters: { keyword: '', category_id: '', status: '', dept_id: '' },
        categories: [], depts: [], users: [],
        STATUS: {
          IN_STOCK: { label: '在库', tag: 'tag-gray' },
          IN_USE: { label: '在用', tag: 'tag-blue' },
          BORROWED: { label: '借出', tag: 'tag-amber' },
          IN_REPAIR: { label: '维修中', tag: 'tag-red' },
          SCRAPPED: { label: '已报废', tag: 'tag-red' },
        },
        showForm: false, saving: false, editing: null, detail: null,
        form: { name: '', category_id: '', model: '', brand: '', price: '', purchase_date: '', location: '', custodian_user_id: '', status: 'IN_STOCK', notes: '' },
      };
    },
    computed: {
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
    },
    async mounted() {
      this.form.purchase_date = this.todayStr();
      await Promise.all([this.load(), this.loadStats(), this.loadCategories(), this.loadDepts(), this.loadUsers()]);
      this.loading = false;
    },
    methods: {
      todayStr() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); },
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
      },
      money(v) { return Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
      num(v) { return Number(v || 0).toLocaleString(); },
      pct(n) { const t = this.stats.total_assets || 0; return t ? (Math.round(n / t * 1000) / 10).toFixed(1) + '%' : '0%'; },
      statusLabel(s) { return (this.STATUS[s] || {}).label || s; },
      statusTag(s) { return (this.STATUS[s] || {}).tag || 'tag-gray'; },
      brandModel(a) { return [a.brand, a.model].filter(Boolean).join(' ') || '—'; },
      async load() {
        try {
          const r = await api.page('/api/assets/ledger', {
            keyword: this.filters.keyword || undefined,
            status: this.filters.status || undefined,
            category_id: this.filters.category_id || undefined,
            dept_id: this.filters.dept_id || undefined,
            pageNum: this.pageNum, pageSize: this.pageSize,
          });
          this.rows = r.rows || [];
          this.total = r.total || 0;
        } catch (e) { this.rows = []; this.total = 0; }
      },
      async loadStats() {
        try {
          const d = await api.get('/api/assets/overview');
          const sc = d.status_counts || {};
          this.stats = {
            total_assets: d.total_assets || 0, total_value: d.total_value || 0,
            in_use: sc.IN_USE || 0, in_use_rate: d.in_use_rate || 0,
            in_repair: d.in_repair_count || 0, scrapped: sc.SCRAPPED || 0,
          };
        } catch (e) { /* keep zeros */ }
      },
      async loadCategories() {
        try { this.categories = await api.get('/api/assets/categories'); } catch (e) { this.categories = []; }
      },
      async loadDepts() {
        try {
          const tree = await api.get('/api/system/depts');
          const out = [];
          const walk = (list, depth) => (list || []).forEach((d) => {
            out.push({ id: d.dept_id, name: '　'.repeat(depth) + d.dept_name });
            walk(d.children, depth + 1);
          });
          walk(tree, 0);
          this.depts = out;
        } catch (e) { this.depts = []; }
      },
      async loadUsers() {
        try {
          const r = await api.page('/api/system/users', { pageNum: 1, pageSize: 500 });
          this.users = (r.rows || []).map((u) => ({ id: u.user_id, name: u.nick_name || u.user_name }));
        } catch (e) { this.users = []; }
      },
      query() { this.pageNum = 1; this.load(); },
      reset() { this.filters = { keyword: '', category_id: '', status: '', dept_id: '' }; this.query(); },
      goPage(p) { if (p < 1 || p > this.pageCount) return; this.pageNum = p; this.load(); },
      openAdd() {
        this.editing = null;
        this.form = { name: '', category_id: '', model: '', brand: '', price: '', purchase_date: this.todayStr(), location: '', custodian_user_id: '', status: 'IN_STOCK', notes: '' };
        this.showForm = true;
      },
      openEdit(a) {
        this.editing = a.asset_id;
        this.form = {
          name: a.name || '', category_id: a.category_id || '', model: a.model || '', brand: a.brand || '',
          price: a.price == null ? '' : a.price, purchase_date: a.purchase_date || '', location: a.location || '',
          custodian_user_id: a.custodian_user_id || '', status: a.status || 'IN_STOCK', notes: a.notes || '',
        };
        this.showForm = true;
      },
      async submitForm() {
        const f = this.form;
        if (!f.name.trim()) return this.$root.toast('请填写资产名称', 'warn');
        if (!f.category_id) return this.$root.toast('请选择资产分类', 'warn');
        if (f.price === '' || !(Number(f.price) >= 0)) return this.$root.toast('请填写不小于 0 的资产价格', 'warn');
        this.saving = true;
        const payload = {
          name: f.name.trim(), category_id: f.category_id || null, model: f.model || null, brand: f.brand || null,
          price: Number(f.price), purchase_date: f.purchase_date || null, location: f.location || null,
          custodian_user_id: f.custodian_user_id || null, status: f.status, notes: f.notes || null,
        };
        try {
          if (this.editing) {
            await api.put('/api/assets/ledger/' + this.editing, payload);
            this.$root.toast('资产卡片已更新', 'ok');
          } else {
            const res = await api.post('/api/assets/ledger', payload);
            this.$root.toast('资产卡片已创建：' + (res.asset_code || ''), 'ok');
          }
          this.showForm = false;
          await Promise.all([this.load(), this.loadStats()]);
        } catch (e) { /* toast shown */ }
        this.saving = false;
      },
      async del(a) {
        if (!window.confirm('确认删除资产「' + a.name + '」？其领用、维保等关联记录将一并清除。')) return;
        try {
          await api.del('/api/assets/ledger/' + a.asset_id);
          this.$root.toast('资产卡片已删除', 'ok');
          await Promise.all([this.load(), this.loadStats()]);
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openAdd(); },
    },
    template: `
    <div v-if="!loading">
      <!-- stat cards (5) -->
      <div class="ast-kpi5">
        <div class="card ast-kpi">
          <span class="ico ico-blue"><ic name="box" size="22"></ic></span>
          <div style="flex:1; min-width:0">
            <div class="label">资产总数</div>
            <div class="val">{{ num(stats.total_assets) }} <span style="font-size:12px;font-weight:400;color:var(--text-3)">件</span></div>
          </div>
        </div>
        <div class="card ast-kpi">
          <span class="ico ico-teal"><ic name="banknote" size="22"></ic></span>
          <div style="flex:1; min-width:0">
            <div class="label">资产原值总额</div>
            <div class="val" style="color:var(--teal)">{{ money(stats.total_value) }} <span style="font-size:12px;font-weight:400;color:var(--text-3)">元</span></div>
          </div>
        </div>
        <div class="card ast-kpi">
          <span class="ico ico-blue"><ic name="bar-chart-3" size="22"></ic></span>
          <div style="flex:1; min-width:0">
            <div class="label">在用资产</div>
            <div class="val" style="color:var(--primary)">{{ num(stats.in_use) }} <span style="font-size:12px;font-weight:400;color:var(--text-3)">件</span></div>
          </div>
          <div class="pct">{{ stats.in_use_rate }}%<br><span style="font-size:11px">占比</span></div>
        </div>
        <div class="card ast-kpi">
          <span class="ico ico-red"><ic name="wrench" size="22"></ic></span>
          <div style="flex:1; min-width:0">
            <div class="label">维修中资产</div>
            <div class="val" style="color:var(--red)">{{ num(stats.in_repair) }} <span style="font-size:12px;font-weight:400;color:var(--text-3)">件</span></div>
          </div>
          <div class="pct">{{ pct(stats.in_repair) }}<br><span style="font-size:11px">占比</span></div>
        </div>
        <div class="card ast-kpi">
          <span class="ico ico-amber"><ic name="trash" size="22"></ic></span>
          <div style="flex:1; min-width:0">
            <div class="label">待报废资产</div>
            <div class="val" style="color:#C77F06">{{ num(stats.scrapped) }} <span style="font-size:12px;font-weight:400;color:var(--text-3)">件</span></div>
          </div>
          <div class="pct">{{ pct(stats.scrapped) }}<br><span style="font-size:11px">占比</span></div>
        </div>
      </div>

      <!-- ledger table -->
      <div class="card">
        <div class="card-hd">
          <div class="t">资产台账列表</div>
          <span class="muted" style="font-size:12px">一物一码（ZC-年份-序号） · 全生命周期管理</span>
        </div>
        <div class="card-bd" style="padding-top:10px">
          <div class="filters">
            <input class="input" style="width:230px" placeholder="请输入资产名称、编码或型号" v-model="filters.keyword" @keyup.enter="query">
            <select class="select" style="width:160px" v-model="filters.category_id" @change="query">
              <option value="">全部分类</option>
              <option v-for="c in categories" :key="c.category_id" :value="c.category_id">{{ c.category_name }}</option>
            </select>
            <select class="select" style="width:120px" v-model="filters.status" @change="query">
              <option value="">全部状态</option>
              <option v-for="(v, k) in STATUS" :key="k" :value="k">{{ v.label }}</option>
            </select>
            <select class="select" style="width:160px" v-model="filters.dept_id" @change="query">
              <option value="">全部部门</option>
              <option v-for="d in depts" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table table-stripe">
            <thead><tr>
              <th>资产编码</th><th>资产名称</th><th>资产分类</th><th>规格型号</th><th>原值（元）</th><th>净值（元）</th>
              <th>状态</th><th>保管人</th><th>存放地点</th><th>操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="a in rows" :key="a.asset_id">
                <td class="num strong">{{ a.asset_code }}</td>
                <td class="strong">{{ a.name }}</td>
                <td>{{ a.category_name || '未分类' }}</td>
                <td class="muted ellipsis" style="max-width:150px" :title="brandModel(a)">{{ brandModel(a) }}</td>
                <td class="num">{{ money(a.price) }}</td>
                <td class="num">{{ money(a.current_value) }}</td>
                <td><span :class="['tag', statusTag(a.status)]">{{ statusLabel(a.status) }}</span></td>
                <td>{{ a.custodian_name || '—' }}</td>
                <td class="muted ellipsis" style="max-width:130px" :title="a.location">{{ a.location || '—' }}</td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="detail = a">查看</button>
                  <button class="btn btn-text btn-sm" @click="openEdit(a)">编辑</button>
                  <button class="btn btn-text btn-sm danger" @click="del(a)">删除</button>
                </td>
              </tr>
              <tr v-if="!rows.length"><td colspan="10"><div class="empty">暂无资产数据</div></td></tr>
            </tbody>
          </table>
          <div class="pager">
            <span>共 {{ num(total) }} 条数据，每页 {{ pageSize }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in pageCount" :key="p" v-show="pageCount <= 7 || p === 1 || p === pageCount || Math.abs(p - pageNum) <= 1" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
      </div>

      <!-- add / edit modal -->
      <Modal :title="editing ? '编辑资产卡片' : '新增资产卡片'" width="620px" v-if="showForm" @close="showForm = false">
        <div class="ast-form-grid">
          <div class="form-item"><label class="req">资产名称</label><input class="input" v-model="form.name" placeholder="请输入资产名称"></div>
          <div class="form-item"><label class="req">资产分类</label>
            <select class="select" v-model="form.category_id">
              <option value="">请选择分类</option>
              <option v-for="c in categories" :key="c.category_id" :value="c.category_id">{{ c.category_name }}</option>
            </select>
          </div>
          <div class="form-item"><label>规格型号</label><input class="input" v-model="form.model" placeholder="如 ThinkPad X1"></div>
          <div class="form-item"><label>品牌</label><input class="input" v-model="form.brand" placeholder="如 联想"></div>
          <div class="form-item"><label class="req">价格（元）</label><input type="number" class="input" min="0" step="0.01" v-model="form.price" placeholder="0.00"></div>
          <div class="form-item"><label>采购日期</label><input type="date" class="input" v-model="form.purchase_date"></div>
          <div class="form-item"><label>存放地点</label><input class="input" v-model="form.location" placeholder="如 综合办公楼2层"></div>
          <div class="form-item"><label>保管人</label>
            <select class="select" v-model="form.custodian_user_id">
              <option value="">未指定</option>
              <option v-for="u in users" :key="u.id" :value="u.id">{{ u.name }}</option>
            </select>
          </div>
          <div class="form-item"><label>资产状态</label>
            <select class="select" v-model="form.status">
              <option v-for="(v, k) in STATUS" :key="k" :value="k">{{ v.label }}</option>
            </select>
          </div>
          <div class="form-item"><label>备注</label><input class="input" v-model="form.notes" placeholder="选填"></div>
        </div>
        <div class="muted" style="font-size:12px; margin-top:-4px">资产编码由系统按「ZC-年份-序号」自动生成一物一码。</div>
        <template #footer>
          <button class="btn btn-ghost" @click="showForm = false">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="submitForm">{{ editing ? '保存修改' : '创建资产卡片' }}</button>
        </template>
      </Modal>

      <!-- detail modal -->
      <Modal title="资产详情" width="520px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">资产编码</span><span class="num strong">{{ detail.asset_code }}</span>
          <span class="k">资产名称</span><span class="strong">{{ detail.name }}</span>
          <span class="k">资产分类</span><span>{{ detail.category_name || '未分类' }}</span>
          <span class="k">规格型号</span><span>{{ brandModel(detail) }}</span>
          <span class="k">原值（元）</span><span class="num">{{ money(detail.price) }}</span>
          <span class="k">净值（元）</span><span class="num">{{ money(detail.current_value) }}</span>
          <span class="k">采购日期</span><span class="num">{{ detail.purchase_date || '—' }}</span>
          <span class="k">资产状态</span><span><span :class="['tag', statusTag(detail.status)]">{{ statusLabel(detail.status) }}</span></span>
          <span class="k">保管人</span><span>{{ detail.custodian_name || '—' }}</span>
          <span class="k">所属部门</span><span>{{ detail.dept_name || '—' }}</span>
          <span class="k">存放地点</span><span>{{ detail.location || '—' }}</span>
          <span class="k">备注</span><span>{{ detail.notes || '—' }}</span>
          <span class="k">建档时间</span><span class="num">{{ bj(detail.created_at) }}</span>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="detail = null">关闭</button>
          <button class="btn btn-primary" @click="openEdit(detail); detail = null"><ic name="pencil" size="14"></ic>编辑</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
