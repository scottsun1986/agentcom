/* /fleet/fuel-audit 定点加油与油耗审计 — pixel replica of design/mockups/061-fleet-fuel-audit.png
   Layout: 4 KPI(含异常统计) / 筛选 + 加油流水表(百公里油耗自动计算) + 分页 + 新增加油流水 modal */
AppPages['/fleet/fuel-audit'] = {
  route: '/fleet/fuel-audit', title: '定点加油与油耗审计', category: 'FLEET', primaryAction: '新增加油流水', icon: 'fuel',
  subtitle: '记录定点加油流水，核算百公里油耗，自动预警“高油耗 / 非定点加油”异常。',
  component: {
    data() {
      return {
        loading: true,
        all: [],
        vehicles: [],
        monthCost: 0,
        filters: { vehicle_id: '', abnormal: '' },
        pageNum: 1, pageSize: 10,
        showForm: false, saving: false,
        form: { vehicle_id: '', fuel_date: '', station: '', liters: '', cost: '', mileage_at_fuel: '' },
      };
    },
    computed: {
      filtered() {
        return this.all.filter((f) => {
          if (this.filters.vehicle_id && f.vehicle_id !== this.filters.vehicle_id) return false;
          if (this.filters.abnormal !== '' && String(f.is_abnormal) !== this.filters.abnormal) return false;
          return true;
        });
      },
      total() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      kpi() {
        const c = { total: this.all.length, abnormalCnt: 0, abnormalCost: 0 };
        this.all.forEach((f) => {
          if (f.is_abnormal) { c.abnormalCnt++; c.abnormalCost += Number(f.cost) || 0; }
        });
        return c;
      },
    },
    async mounted() {
      try { const d = await api.get('/api/fleet/dashboard'); this.monthCost = (d.month_fuel || {}).cost || 0; } catch (e) { /* keep 0 */ }
      await Promise.all([this.load(), this.loadVehicles()]);
      this.loading = false;
    },
    methods: {
      num(v) { return Number(v || 0).toLocaleString(); },
      money(v) { return Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
      todayStr() { const d = new Date(); const p = (n) => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()); },
      async load() {
        try {
          const r = await api.page('/api/fleet/fuel-logs', { pageNum: 1, pageSize: 500 });
          const rows = r.rows || [];
          // 按车辆分组升序排列，逐条计算百公里油耗（与上一条流水比较）
          const byV = {};
          rows.forEach((f) => { (byV[f.vehicle_id] = byV[f.vehicle_id] || []).push(f); });
          Object.values(byV).forEach((list) => {
            list.sort((a, b) => ((a.fuel_date || '') + (a.created_at || '')).localeCompare((b.fuel_date || '') + (b.created_at || '')));
            let prev = null;
            list.forEach((f) => {
              f.per100 = null;
              if (prev) {
                const delta = Number(f.mileage_at_fuel || 0) - Number(prev.mileage_at_fuel || 0);
                const liters = Number(f.liters || 0);
                if (delta > 0 && liters > 0) f.per100 = Math.round(liters / delta * 1000) / 10;
              }
              prev = f;
            });
          });
          this.all = rows;
        } catch (e) { this.all = []; }
      },
      async loadVehicles() {
        try {
          const r = await api.page('/api/fleet/vehicles', { pageNum: 1, pageSize: 200 });
          this.vehicles = r.rows || [];
        } catch (e) { this.vehicles = []; }
      },
      query() { this.pageNum = 1; },
      reset() { this.filters = { vehicle_id: '', abnormal: '' }; this.query(); },
      goPage(p) { if (p < 1 || p > this.pageCount) return; this.pageNum = p; },
      openAdd() {
        this.form = { vehicle_id: '', fuel_date: this.todayStr(), station: '', liters: '', cost: '', mileage_at_fuel: '' };
        this.showForm = true;
      },
      async submitForm() {
        const f = this.form;
        if (!f.vehicle_id) return this.$root.toast('请选择加油车辆', 'warn');
        if (!f.fuel_date) return this.$root.toast('请选择加油日期', 'warn');
        if (!(Number(f.liters) > 0)) return this.$root.toast('请填写加油升数', 'warn');
        if (!(Number(f.mileage_at_fuel) >= 0)) return this.$root.toast('请填写加油时里程表读数', 'warn');
        this.saving = true;
        try {
          await api.post('/api/fleet/fuel-logs', {
            vehicle_id: f.vehicle_id, fuel_date: f.fuel_date, station: f.station || null,
            liters: Number(f.liters), cost: Number(f.cost) || 0, mileage_at_fuel: Number(f.mileage_at_fuel),
          });
          this.$root.toast('加油流水已登记', 'ok');
          this.showForm = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.saving = false;
      },
      onPrimary() { this.openAdd(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="ast-kpi5" style="grid-template-columns:repeat(4,1fr); margin-bottom:16px">
        <div class="card ast-kpi">
          <div class="ico ico-blue"><ic name="fuel" size="24"></ic></div>
          <div class="meta"><div class="label">加油流水总数</div><div class="val" style="color:var(--primary)">{{ num(kpi.total) }} <i>笔</i></div>
            <div class="sub muted">定点加油台账累计</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-teal"><ic name="banknote" size="24"></ic></div>
          <div class="meta"><div class="label">本月加油费用</div><div class="val" style="color:var(--teal)">{{ money(monthCost) }} <i>元</i></div>
            <div class="sub muted">来自车队运行大屏</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-red"><ic name="alert-triangle" size="24"></ic></div>
          <div class="meta"><div class="label">异常流水数</div><div class="val" style="color:var(--red)">{{ num(kpi.abnormalCnt) }} <i>笔</i></div>
            <div class="sub muted">高油耗 / 非定点加油</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-red"><ic name="wallet" size="24"></ic></div>
          <div class="meta"><div class="label">异常油费合计</div><div class="val" style="color:var(--red)">{{ money(kpi.abnormalCost) }} <i>元</i></div>
            <div class="sub muted">需核查说明</div></div>
        </div>
      </div>

      <!-- fuel logs -->
      <div class="card">
        <div class="card-hd"><div class="t">加油流水记录</div></div>
        <div class="card-bd" style="padding-top:10px">
          <div class="filters">
            <select class="select" style="width:200px" v-model="filters.vehicle_id" @change="query">
              <option value="">全部车辆</option>
              <option v-for="v in vehicles" :key="v.vehicle_id" :value="v.vehicle_id">{{ v.plate_no }}</option>
            </select>
            <select class="select" style="width:140px" v-model="filters.abnormal" @change="query">
              <option value="">全部流水</option>
              <option value="true">仅异常流水</option>
              <option value="false">仅正常流水</option>
            </select>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr>
              <th>加油日期</th><th>车辆</th><th>加油站</th><th style="width:90px">升数(L)</th>
              <th style="width:100px">金额(元)</th><th style="width:100px">里程(km)</th><th style="width:110px">百公里油耗(L)</th>
              <th style="width:90px">状态</th><th>异常原因</th>
            </tr></thead>
            <tbody>
              <tr v-for="f in shownRows" :key="f.fuel_id">
                <td class="num muted">{{ f.fuel_date || '—' }}</td>
                <td class="strong">{{ f.plate_no || '—' }}</td>
                <td>{{ f.station || '—' }}</td>
                <td class="num">{{ Number(f.liters || 0).toFixed(2) }}</td>
                <td class="num">{{ money(f.cost) }}</td>
                <td class="num">{{ num(f.mileage_at_fuel) }}</td>
                <td class="num" :style="f.per100 !== null && f.per100 > 15 ? 'color:var(--red); font-weight:700' : ''">
                  {{ f.per100 === null ? '—' : f.per100.toFixed(1) }}
                </td>
                <td>
                  <span v-if="f.is_abnormal" class="tag tag-red"><ic name="alert-triangle" size="12"></ic>异常</span>
                  <span v-else class="tag tag-green"><ic name="check-circle-2" size="12"></ic>正常</span>
                </td>
                <td class="flt-red" style="font-weight:400" :title="f.abnormal_reason">{{ f.is_abnormal ? (f.abnormal_reason || '—') : '—' }}</td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="9"><div class="empty">暂无加油流水，点击右上角“新增加油流水”登记</div></td></tr>
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

      <!-- add modal -->
      <Modal title="新增加油流水" width="560px" v-if="showForm" @close="showForm = false">
        <div class="flt-form-2col">
          <div class="form-item"><label class="req">车辆</label>
            <select class="select" v-model="form.vehicle_id">
              <option value="" disabled>请选择车辆</option>
              <option v-for="v in vehicles" :key="v.vehicle_id" :value="v.vehicle_id">{{ v.plate_no }}（{{ v.brand_model }}）</option>
            </select>
          </div>
          <div class="form-item"><label class="req">加油日期</label><input type="date" class="input" v-model="form.fuel_date"></div>
          <div class="form-item" style="grid-column:1 / -1"><label class="req">加油站</label><input class="input" placeholder="如 中石化XX加油站（非定点加油站将触发异常预警）" v-model="form.station"></div>
          <div class="form-item"><label class="req">升数(L)</label><input type="number" min="0" step="0.01" class="input" v-model="form.liters"></div>
          <div class="form-item"><label>金额(元)</label><input type="number" min="0" step="0.01" class="input" v-model="form.cost"></div>
          <div class="form-item" style="grid-column:1 / -1"><label class="req">里程读数</label><input type="number" min="0" class="input" placeholder="加油时仪表盘里程（km），用于核算百公里油耗" v-model="form.mileage_at_fuel"></div>
        </div>
        <div class="muted" style="font-size:12px; padding-left:102px">系统自动与该车上一条流水比较核算百公里油耗，超 15L/百公里或非定点加油将标记异常。</div>
        <template #footer>
          <button class="btn btn-ghost" @click="showForm = false">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="submitForm">登记</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
