/* /assets/inbound 入库与建档 — pixel replica of design/mockups/015-assets-inbound.png
   Layout: 4 KPI cards / (入库登记 form | 一物一码标签预览) / 最近入库列表 */
AppPages['/assets/inbound'] = {
  route: '/assets/inbound', title: '入库与建档', category: 'ASSETS', primaryAction: '新建入库单', icon: 'file-plus',
  subtitle: '支持验收登记、录入建档生成资产卡片，并提供一键标签打印（一物一码）。',
  component: {
    data() {
      return {
        loading: true,
        categories: [],
        recent: [], totalAssets: 0, monthCount: 0, printed: 0,
        form: { name: '', category_id: '', model: '', brand: '', price: '', location: '', purchase_date: '', notes: '' },
        lastAsset: null,
        submitting: false,
        STATUS: {
          IN_STOCK: { label: '在库', tag: 'tag-gray' },
          IN_USE: { label: '在用', tag: 'tag-blue' },
          BORROWED: { label: '借出', tag: 'tag-amber' },
          IN_REPAIR: { label: '维修中', tag: 'tag-red' },
          SCRAPPED: { label: '已报废', tag: 'tag-red' },
        },
      };
    },
    computed: {
      remaining() { return Math.max(0, this.monthCount - this.printed); },
    },
    async mounted() {
      this.form.purchase_date = this.todayStr();
      await Promise.all([this.load(), this.loadCategories()]);
      this.loading = false;
    },
    methods: {
      todayStr() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); },
      monthKey() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1); },
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
      statusLabel(s) { return (this.STATUS[s] || {}).label || s; },
      statusTag(s) { return (this.STATUS[s] || {}).tag || 'tag-gray'; },
      brandModel(a) { return [a.brand, a.model].filter(Boolean).join(' ') || '—'; },
      async load() {
        try {
          const r = await api.page('/api/assets/ledger', { pageNum: 1, pageSize: 200 });
          const rows = r.rows || [];
          this.recent = rows.slice(0, 8);
          this.totalAssets = r.total || 0;
          const mk = this.monthKey();
          this.monthCount = rows.filter((a) => this.bj(a.created_at).slice(0, 7) === mk).length;
        } catch (e) { this.recent = []; this.totalAssets = 0; this.monthCount = 0; }
      },
      async loadCategories() {
        try { this.categories = await api.get('/api/assets/categories'); } catch (e) { this.categories = []; }
      },
      resetForm() {
        this.form = { name: '', category_id: '', model: '', brand: '', price: '', location: this.form.location, purchase_date: this.todayStr(), notes: '' };
      },
      async submitInbound() {
        const f = this.form;
        if (!f.name.trim()) return this.$root.toast('请填写资产名称', 'warn');
        if (!f.category_id) return this.$root.toast('请选择资产分类', 'warn');
        if (f.price === '' || !(Number(f.price) >= 0)) return this.$root.toast('请填写不小于 0 的资产价格', 'warn');
        this.submitting = true;
        try {
          const res = await api.post('/api/assets/ledger', {
            name: f.name.trim(), category_id: f.category_id, model: f.model || null, brand: f.brand || null,
            price: Number(f.price), location: f.location || null, purchase_date: f.purchase_date || null, notes: f.notes || null,
          });
          this.lastAsset = res;
          this.$root.toast('入库成功，已生成资产卡片 ' + (res.asset_code || ''), 'ok');
          this.form.name = ''; this.form.model = ''; this.form.brand = ''; this.form.price = ''; this.form.notes = '';
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      printLabel(a) {
        this.printed += 1;
        this.$root.toast('标签打印任务已发送：' + (a.asset_code || ''), 'ok');
      },
      onPrimary() {
        this.$nextTick(() => { const el = this.$refs.nameInput; if (el) el.focus(); });
      },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row (4) -->
      <div class="kpi-row">
        <div class="card kpi-card">
          <div class="ico ico-blue"><ic name="package" size="28"></ic></div>
          <div class="meta">
            <div class="label">累计资产卡片</div>
            <div class="val" style="color:var(--primary)">{{ num(totalAssets) }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">台/件</span></div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-teal"><ic name="file-plus" size="28"></ic></div>
          <div class="meta">
            <div class="label">本月入库</div>
            <div class="val" style="color:var(--teal)">{{ num(monthCount) }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">台/件</span></div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-amber"><ic name="printer" size="28"></ic></div>
          <div class="meta">
            <div class="label">已打印标签</div>
            <div class="val" style="color:#C77F06">{{ num(printed) }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">张</span></div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-red"><ic name="qr-code" size="28"></ic></div>
          <div class="meta">
            <div class="label">待打印标签</div>
            <div class="val" style="color:var(--red)">{{ num(remaining) }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">张</span></div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="ast-inbound-grid">
        <!-- inbound form -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">入库登记</div>
            <span class="muted" style="font-size:12px">提交后系统自动生成一物一码资产卡片</span>
          </div>
          <div class="card-bd" style="padding-top:12px">
            <div class="ast-form-grid">
              <div class="form-item"><label class="req">资产名称</label><input ref="nameInput" class="input" v-model="form.name" placeholder="请输入资产名称" @keyup.enter="submitInbound"></div>
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
              <div class="form-item"><label>存放地点</label><input class="input" v-model="form.location" placeholder="如 行政大楼3层"></div>
              <div class="form-item"><label>备注</label><input class="input" v-model="form.notes" placeholder="选填"></div>
            </div>
            <div style="display:flex; gap:10px; margin-top:4px">
              <button class="btn btn-primary" :disabled="submitting" @click="submitInbound"><ic name="check" size="14"></ic>提交入库</button>
              <button class="btn btn-ghost" @click="resetForm"><ic name="rotate-cw" size="14"></ic>重置</button>
            </div>
          </div>
        </div>

        <!-- one-code label preview -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">一物一码标签</div>
            <span class="muted" style="font-size:12px" v-if="lastAsset">{{ lastAsset.asset_code }}</span>
          </div>
          <div class="card-bd">
            <div v-if="!lastAsset" class="empty" style="padding:44px 0">
              <div style="color:#B6C3D2"><ic name="qr-code" size="44"></ic></div>
              <div style="margin-top:10px">入库登记成功后自动生成标签</div>
              <div class="muted" style="font-size:12px; margin-top:2px">编码规则：ZC-年份-序号</div>
            </div>
            <template v-else>
              <div class="ast-label-card">
                <div class="ast-label-qr"><ic name="qr-code" size="58"></ic></div>
                <div style="flex:1; min-width:0">
                  <div class="strong" style="font-size:15px">{{ lastAsset.name }}</div>
                  <div style="font-family:Menlo,Consolas,monospace; font-size:16px; font-weight:700; color:var(--primary); letter-spacing:1px; margin:4px 0">{{ lastAsset.asset_code }}</div>
                  <div class="muted" style="font-size:12px; line-height:1.9">
                    分　类：{{ lastAsset.category_name || '未分类' }}<br>
                    购置日期：{{ lastAsset.purchase_date || '—' }}<br>
                    存放地点：{{ lastAsset.location || '—' }}
                  </div>
                </div>
              </div>
              <button class="btn btn-primary" style="width:100%; margin-top:12px; justify-content:center" @click="printLabel(lastAsset)"><ic name="printer" size="14"></ic>打印标签</button>
            </template>
          </div>
        </div>
      </div>

      <!-- recent inbound list -->
      <div class="card mt16">
        <div class="card-hd">
          <div class="t">最近入库 <span class="muted" style="font-size:12px; font-weight:400">（按建档时间倒序）</span></div>
          <span class="more" @click="$root.go('/assets/ledger')">进入台账 <ic name="chevron-right" size="14"></ic></span>
        </div>
        <div class="card-bd" style="padding-top:8px">
          <table class="table table-stripe">
            <thead><tr><th>资产编码</th><th>资产名称</th><th>分类</th><th>规格型号</th><th>价格（元）</th><th>状态</th><th>入库时间</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="a in recent" :key="a.asset_id">
                <td class="num strong">{{ a.asset_code }}</td>
                <td class="strong">{{ a.name }}</td>
                <td>{{ a.category_name || '未分类' }}</td>
                <td class="muted ellipsis" style="max-width:160px" :title="brandModel(a)">{{ brandModel(a) }}</td>
                <td class="num">{{ money(a.price) }}</td>
                <td><span :class="['tag', statusTag(a.status)]">{{ statusLabel(a.status) }}</span></td>
                <td class="num muted">{{ bj(a.created_at) }}</td>
                <td class="actions"><button class="btn btn-text btn-sm" @click="printLabel(a)"><ic name="printer" size="13"></ic>打印标签</button></td>
              </tr>
              <tr v-if="!recent.length"><td colspan="8"><div class="empty">暂无入库记录，先在上方完成入库登记</div></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
