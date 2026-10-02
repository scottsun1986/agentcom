/* /assets/consumables 低值办公易耗品 — pixel replica of design/mockups/022-assets-consumables.png
   Layout: greeting / 4 KPI cards / tabs(库存清单 | 申领记录) tables / 新增编辑耗材 + 申领 modals */
AppPages['/assets/consumables'] = {
  route: '/assets/consumables', title: '低值办公易耗品', category: 'ASSETS', primaryAction: '新增耗材', icon: 'package',
  component: {
    data() {
      return {
        loading: true,
        items: [],
        reqs: [],
        canEdit: false,
        canAudit: false,
        tab: 'stock',
        filters: { keyword: '' },
        onlyLow: false,
        pageNum: 1,
        pageSize: 10,
        reqPage: 1,
        reqPageSize: 8,
        showItem: false,
        editingId: null,
        submitting: false,
        itemForm: { item_code: '', name: '', category: '办公文具', spec: '', unit: '件', stock_count: 0, min_stock: 10, unit_price: 0 },
        showReq: false,
        reqForm: { item_id: '', quantity: 1, purpose: '' },
        categories: ['办公文具', '打印耗材', '办公纸张', '清洁用品', '生活用品'],
      };
    },
    computed: {
      kpi() {
        const c = { kinds: this.items.length, stock: 0, low: 0, reqs: this.reqs.length, reqPending: 0 };
        this.items.forEach((i) => {
          c.stock += Number(i.stock_count) || 0;
          if (i.low_stock) c.low++;
        });
        this.reqs.forEach((r) => { if (r.status === 'PENDING') c.reqPending++; });
        return c;
      },
      stockFiltered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        return this.items.filter((i) => {
          if (this.onlyLow && !i.low_stock) return false;
          if (kw && !((i.item_code || '') + (i.name || '') + (i.spec || '') + (i.category || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      stockTotal() { return this.stockFiltered.length; },
      stockCount() { return Math.max(1, Math.ceil(this.stockTotal / this.pageSize)); },
      stockRows() { return this.stockFiltered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      reqFiltered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        if (!kw) return this.reqs;
        return this.reqs.filter((r) => ((r.item_name || '') + (r.user_name || '') + (r.purpose || '')).toLowerCase().includes(kw));
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
      try {
        const info = await api.get('/api/auth/info');
        const perms = info.permissions || [];
        this.canEdit = perms.includes('*:*:*') || perms.includes('assets:consumable:add');
        this.canAudit = perms.includes('*:*:*') || perms.includes('assets:consumable:audit');
      } catch (e) { /* keep false */ }
      await Promise.all([this.loadItems(), this.loadReqs()]);
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
      async loadItems() {
        try {
          const r = await api.page('/api/assets/consumables', { pageNum: 1, pageSize: 200 });
          this.items = r.rows || [];
        } catch (e) { this.items = []; }
      },
      async loadReqs() {
        try {
          const r = await api.page('/api/assets/consumables/requisitions', { pageNum: 1, pageSize: 200 });
          this.reqs = r.rows || [];
        } catch (e) { this.reqs = []; }
      },
      statusLabel(s) { return { PENDING: '待审批', APPROVED: '已通过', REJECTED: '已驳回' }[s] || s; },
      statusTag(s) { return { PENDING: 'tag-blue', APPROVED: 'tag-green', REJECTED: 'tag-red' }[s] || 'tag-gray'; },
      suggest(i) {
        if (!i.low_stock) return null;
        const need = Math.max(i.min_stock * 2 - i.stock_count, i.min_stock);
        return '建议补货 ' + need + ' ' + (i.unit || '件');
      },
      setTab(t) { this.tab = t; },
      query() { this.pageNum = 1; this.reqPage = 1; },
      reset() { this.filters = { keyword: '' }; this.onlyLow = false; this.query(); },
      goStockPage(p) { if (p === '...' || p < 1 || p > this.stockCount) return; this.pageNum = p; },
      goReqPage(p) { if (p === '...' || p < 1 || p > this.reqCount) return; this.reqPage = p; },
      openAdd() {
        this.editingId = null;
        this.itemForm = { item_code: '', name: '', category: '办公文具', spec: '', unit: '件', stock_count: 0, min_stock: 10, unit_price: 0 };
        this.showItem = true;
      },
      openEdit(i) {
        this.editingId = i.item_id;
        this.itemForm = {
          item_code: i.item_code || '', name: i.name || '', category: i.category || '办公文具', spec: i.spec || '',
          unit: i.unit || '件', stock_count: i.stock_count || 0, min_stock: i.min_stock || 0, unit_price: i.unit_price || 0,
        };
        this.showItem = true;
      },
      async submitItem() {
        const f = this.itemForm;
        if (!f.name.trim()) return this.$root.toast('请填写耗材名称', 'warn');
        const stock = Number(f.stock_count), minStock = Number(f.min_stock), price = Number(f.unit_price);
        if (isNaN(stock) || stock < 0) return this.$root.toast('当前库存必须为不小于 0 的整数', 'warn');
        if (isNaN(minStock) || minStock < 0) return this.$root.toast('安全库存必须为不小于 0 的整数', 'warn');
        if (isNaN(price) || price < 0) return this.$root.toast('单价必须为不小于 0 的数字', 'warn');
        this.submitting = true;
        try {
          if (this.editingId) {
            await api.put('/api/assets/consumables/' + this.editingId, {
              name: f.name.trim(), category: f.category, spec: f.spec, unit: f.unit,
              stock_count: Math.floor(stock), min_stock: Math.floor(minStock), unit_price: price,
            });
            this.$root.toast('耗材目录已更新', 'ok');
          } else {
            await api.post('/api/assets/consumables', {
              item_code: f.item_code.trim() || undefined, name: f.name.trim(), category: f.category, spec: f.spec,
              unit: f.unit, stock_count: Math.floor(stock), min_stock: Math.floor(minStock), unit_price: price,
            });
            this.$root.toast('耗材目录已新增', 'ok');
          }
          this.showItem = false;
          await this.loadItems();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      openReq(i) {
        this.reqForm = { item_id: i ? i.item_id : '', quantity: 1, purpose: '' };
        this.showReq = true;
      },
      async submitReq() {
        const f = this.reqForm;
        if (!f.item_id) return this.$root.toast('请选择申领耗材', 'warn');
        const qty = Number(f.quantity);
        if (!qty || qty < 1) return this.$root.toast('申领数量必须大于 0', 'warn');
        if (!f.purpose.trim()) return this.$root.toast('请填写申领用途', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/assets/consumables/requisitions', { item_id: f.item_id, quantity: Math.floor(qty), purpose: f.purpose.trim() });
          this.$root.toast('耗材领用申请已提交，等待审批', 'ok');
          this.showReq = false;
          await Promise.all([this.loadReqs(), this.loadItems()]);
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async audit(r, action) {
        const tip = action === 'APPROVE' ? '确认通过该领用申请？通过后将核减对应耗材库存。' : '确认驳回该领用申请？';
        if (!window.confirm(tip)) return;
        try {
          await api.post('/api/assets/consumables/requisitions/' + r.req_id + '/audit', { action });
          this.$root.toast(action === 'APPROVE' ? '已通过该领用申请并核减库存' : '已驳回该领用申请', 'ok');
          await Promise.all([this.loadReqs(), this.loadItems()]);
        } catch (e) { /* toast shown */ }
      },
      onPrimary() {
        if (this.tab === 'stock') this.openAdd();
        else this.openReq(null);
      },
    },
    template: `
    <div v-if="!loading">
      <div class="page-sub" style="margin-bottom:14px; font-size:14px">
        <b>{{ hello }}</b>　当前共有 <b :style="kpi.low ? 'color:var(--red)' : ''">{{ kpi.low }}</b> 个品类库存低于安全阈值，请及时补货。
      </div>

      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="package" size="28"></ic></div>
          <div class="meta"><div class="label">易耗品品类总数</div><div class="val" style="color:var(--primary)">{{ kpi.kinds }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">个</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="box" size="28"></ic></div>
          <div class="meta"><div class="label">当前库存总量</div><div class="val" style="color:var(--teal)">{{ kpi.stock.toLocaleString() }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">件</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="alert-triangle" size="28"></ic></div>
          <div class="meta"><div class="label">低库存预警</div><div class="val" :style="{color: kpi.low ? 'var(--amber)' : 'var(--text)'}">{{ kpi.low }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">个</span></div>
            <div class="muted" style="font-size:12px">低于安全库存的品类</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="clipboard-list" size="28"></ic></div>
          <div class="meta"><div class="label">领用申请</div><div class="val" style="color:var(--red)">{{ kpi.reqs }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">笔</span></div>
            <div class="muted" style="font-size:12px">待审批 {{ kpi.reqPending }} 笔</div></div>
        </div>
      </div>

      <!-- tabs -->
      <div class="card" style="margin-top:0">
        <div class="pg-tabs">
          <span :class="['pg-tab', tab === 'stock' ? 'on' : '']" @click="setTab('stock')">易耗品库存清单</span>
          <span :class="['pg-tab', tab === 'req' ? 'on' : '']" @click="setTab('req')">申领记录 <span class="cnt">({{ reqs.length }})</span></span>
        </div>

        <div class="card-bd" style="padding-top:12px" v-if="tab === 'stock'">
          <div class="filters">
            <input class="input" style="flex:1; min-width:200px" placeholder="请输入名称、规格或编码" v-model="filters.keyword" @keyup.enter="query">
            <label class="switch" style="gap:8px" title="仅看低于安全库存的品类">
              <input type="checkbox" v-model="onlyLow" @change="query"><i></i>
              <span class="sub" style="font-size:12.5px; white-space:nowrap">仅看低库存</span>
            </label>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
            <span style="flex:1"></span>
            <button v-if="canEdit" class="btn btn-primary" @click="openAdd"><ic name="plus" size="14"></ic>新增耗材</button>
          </div>
          <table class="table">
            <thead><tr>
              <th>编码</th><th>物品名称</th><th>规格型号</th><th>单位</th><th>当前库存</th><th>安全库存</th>
              <th>单价 (元)</th><th>状态</th><th>补货建议</th><th style="width:110px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="i in stockRows" :key="i.item_id">
                <td class="num">{{ i.item_code }}</td>
                <td><span class="strong">{{ i.name }}</span><span class="tag tag-gray" style="margin-left:6px">{{ i.category || '未分类' }}</span></td>
                <td class="muted">{{ i.spec || '—' }}</td>
                <td>{{ i.unit }}</td>
                <td class="num" :class="{'low-num': i.low_stock}">{{ i.stock_count }}</td>
                <td class="num muted">{{ i.min_stock }}</td>
                <td class="num">{{ money(i.unit_price) }}</td>
                <td>
                  <span v-if="i.low_stock" class="tag tag-red"><ic name="alert-triangle" size="12"></ic>库存不足</span>
                  <span v-else class="tag tag-green"><ic name="check-circle-2" size="12"></ic>正常</span>
                </td>
                <td>
                  <span v-if="i.low_stock" class="tag tag-amber">{{ suggest(i) }}</span>
                  <span v-else class="muted">—</span>
                </td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="openReq(i)">申领</button>
                  <button v-if="canEdit" class="btn btn-text btn-sm" @click="openEdit(i)">编辑</button>
                </td>
              </tr>
              <tr v-if="!stockRows.length"><td colspan="10"><div class="empty">暂无易耗品库存</div></td></tr>
            </tbody>
          </table>
          <div class="pager" v-if="stockCount > 1">
            <span>共 {{ stockTotal }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goStockPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in stockCount" :key="p" v-show="stockCount <= 7 || p === 1 || p === stockCount || Math.abs(p - pageNum) <= 1" class="pg" :class="{on: p === pageNum}" @click="goStockPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= stockCount" @click="goStockPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>

        <div class="card-bd" style="padding-top:12px" v-else>
          <div class="filters">
            <input class="input" style="flex:1; min-width:200px" placeholder="请输入耗材、领用人或用途" v-model="filters.keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
            <span style="flex:1"></span>
            <button class="btn btn-primary" @click="openReq(null)"><ic name="plus" size="14"></ic>新增申领</button>
          </div>
          <table class="table">
            <thead><tr>
              <th>申领人</th><th>所属部门</th><th>耗材</th><th>数量</th><th>用途</th><th>申请时间</th><th>当前状态</th><th style="width:150px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in reqRows" :key="r.req_id">
                <td class="strong">{{ r.user_name || '—' }}</td>
                <td>{{ r.dept_name || '—' }}</td>
                <td><span class="strong">{{ r.item_name || '—' }}</span><span class="muted" style="font-size:12px; margin-left:6px">{{ r.item_code || '' }}</span></td>
                <td class="num">{{ r.quantity }} {{ r.unit || '' }}</td>
                <td class="ellipsis" :title="r.purpose" style="max-width:220px">{{ r.purpose || '—' }}</td>
                <td class="num muted">{{ bj(r.created_at) }}</td>
                <td><span :class="['tag', statusTag(r.status)]">{{ statusLabel(r.status) }}</span></td>
                <td class="actions">
                  <template v-if="canAudit && r.status === 'PENDING'">
                    <button class="btn btn-text btn-sm" @click="audit(r, 'APPROVE')">通过</button>
                    <button class="btn btn-text btn-sm danger" @click="audit(r, 'REJECT')">驳回</button>
                  </template>
                  <span v-else class="muted" style="font-size:12px">已处理</span>
                </td>
              </tr>
              <tr v-if="!reqRows.length"><td colspan="8"><div class="empty">暂无领用申请</div></td></tr>
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

      <!-- add/edit consumable modal -->
      <Modal :title="editingId ? '编辑耗材' : '新增耗材'" width="560px" v-if="showItem" @close="showItem = false">
        <div class="form-item">
          <label class="req">耗材名称</label>
          <input class="input" maxlength="50" placeholder="如：A4打印纸 80g" v-model="itemForm.name">
        </div>
        <div class="form-item">
          <label>耗材编码</label>
          <input class="input" maxlength="32" placeholder="留空自动生成 HC-YYYY-XXXXX" v-model="itemForm.item_code" :disabled="!!editingId">
        </div>
        <div class="form-item">
          <label>品类</label>
          <select class="select" v-model="itemForm.category">
            <option v-for="c in categories" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="form-item">
          <label>规格型号</label>
          <input class="input" maxlength="50" placeholder="如：A4 80g/500张" v-model="itemForm.spec">
        </div>
        <div class="form-item">
          <label>单位</label>
          <input class="input" maxlength="10" placeholder="如：箱 / 包 / 支" v-model="itemForm.unit">
        </div>
        <div class="form-item">
          <label class="req">当前库存</label>
          <input type="number" class="input" min="0" step="1" v-model="itemForm.stock_count">
        </div>
        <div class="form-item">
          <label class="req">安全库存</label>
          <input type="number" class="input" min="0" step="1" placeholder="低于该值触发低库存预警" v-model="itemForm.min_stock">
        </div>
        <div class="form-item">
          <label class="req">单价 (元)</label>
          <input type="number" class="input" min="0" step="0.01" v-model="itemForm.unit_price">
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showItem = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitItem">{{ editingId ? '保存修改' : '确认新增' }}</button>
        </template>
      </Modal>

      <!-- requisition modal -->
      <Modal title="新增耗材申领" width="520px" v-if="showReq" @close="showReq = false">
        <div class="form-item">
          <label class="req">申领耗材</label>
          <select class="select" v-model="reqForm.item_id">
            <option value="">请选择耗材</option>
            <option v-for="i in items" :key="i.item_id" :value="i.item_id">{{ i.name }}（{{ i.spec || i.item_code }} · 库存 {{ i.stock_count }} {{ i.unit }}）</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">申领数量</label>
          <input type="number" class="input" min="1" step="1" v-model="reqForm.quantity">
        </div>
        <div class="form-item">
          <label class="req">申领用途</label>
          <textarea class="input" maxlength="200" placeholder="请填写申领用途，如：季度办公文具补充" v-model="reqForm.purpose"></textarea>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showReq = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitReq">提交申请</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
