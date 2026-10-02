/* /fleet/maintenance 维保与年审预警 — pixel replica of design/mockups/060-fleet-maintenance.png
   Layout: 顶部临期预警条 + 4 KPI / 类型筛选 + 维保记录表(服务端分页) + 新增维保记录 modal */
AppPages['/fleet/maintenance'] = {
  route: '/fleet/maintenance', title: '维保与年审预警', category: 'FLEET', primaryAction: '新增维保记录', icon: 'wrench',
  subtitle: '保养、保险、年审、维修全量登记，30 天内到期事项自动预警提醒。',
  component: {
    data() {
      return {
        loading: true,
        warnItems: [],
        kpi: { maintenance: 0, insurance: 0, inspection: 0, total: 0 },
        rows: [], total: 0, pageNum: 1, pageSize: 10,
        filters: { log_type: '' },
        LOGTAG: { MAINTENANCE: 'tag-blue', INSURANCE: 'tag-teal', INSPECTION: 'tag-amber', REPAIR: 'tag-red' },
        vehicles: [],
        showForm: false, saving: false,
        form: { vehicle_id: '', log_type: 'MAINTENANCE', mileage_at_service: '', cost: '', vendor: '', next_due_date: '', next_due_mileage: '', notes: '' },
      };
    },
    computed: {
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
    },
    async mounted() {
      await Promise.all([this.load(), this.loadWarnings(), this.loadVehicles()]);
      this.loading = false;
    },
    methods: {
      num(v) { return Number(v || 0).toLocaleString(); },
      money(v) { return Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
      logTag(t) { return this.LOGTAG[t] || 'tag-gray'; },
      daysLeft(s) {
        if (!s) return null;
        const d = new Date(s + 'T00:00:00');
        if (isNaN(d.getTime())) return null;
        const t0 = new Date(); t0.setHours(0, 0, 0, 0);
        return Math.round((d - t0) / 86400000);
      },
      async load() {
        try {
          const r = await api.page('/api/fleet/maintenance', {
            log_type: this.filters.log_type || undefined,
            pageNum: this.pageNum, pageSize: this.pageSize,
          });
          this.rows = r.rows || [];
          this.total = r.total || 0;
          this.kpi.total = r.total || 0;
        } catch (e) { this.rows = []; this.total = 0; }
      },
      async loadWarnings() {
        try {
          const list = await api.get('/api/fleet/maintenance/warnings');
          const items = [];
          (list || []).forEach((v) => (v.warnings || []).forEach((w) => items.push({
            plate_no: v.plate_no, type: w.type, label: w.label, due_date: w.due_date, days_left: w.days_left, level: w.level,
          })));
          this.warnItems = items;
          this.kpi.maintenance = items.filter((w) => w.type === 'MAINTENANCE').length;
          this.kpi.insurance = items.filter((w) => w.type === 'INSURANCE').length;
          this.kpi.inspection = items.filter((w) => w.type === 'INSPECTION').length;
        } catch (e) { this.warnItems = []; }
      },
      async loadVehicles() {
        try {
          const r = await api.page('/api/fleet/vehicles', { pageNum: 1, pageSize: 200 });
          this.vehicles = r.rows || [];
        } catch (e) { this.vehicles = []; }
      },
      query() { this.pageNum = 1; this.load(); },
      reset() { this.filters = { log_type: '' }; this.query(); },
      goPage(p) { if (p < 1 || p > this.pageCount) return; this.pageNum = p; this.load(); },
      openAdd() {
        this.form = { vehicle_id: '', log_type: 'MAINTENANCE', mileage_at_service: '', cost: '', vendor: '', next_due_date: '', next_due_mileage: '', notes: '' };
        this.showForm = true;
      },
      async submitForm() {
        const f = this.form;
        if (!f.vehicle_id) return this.$root.toast('请选择车辆', 'warn');
        this.saving = true;
        try {
          await api.post('/api/fleet/maintenance', {
            vehicle_id: f.vehicle_id, log_type: f.log_type,
            mileage_at_service: f.mileage_at_service === '' ? 0 : Number(f.mileage_at_service),
            cost: f.cost === '' ? 0 : Number(f.cost),
            vendor: f.vendor || null, next_due_date: f.next_due_date || null,
            next_due_mileage: f.next_due_mileage === '' ? null : Number(f.next_due_mileage),
            notes: f.notes || null,
          });
          this.$root.toast('维保记录已登记', 'ok');
          this.showForm = false;
          await Promise.all([this.load(), this.loadWarnings()]);
        } catch (e) { /* toast shown */ }
        this.saving = false;
      },
      onPrimary() { this.openAdd(); },
    },
    template: `
    <div v-if="!loading">
      <!-- warning strip -->
      <div class="card" style="margin-bottom:16px" v-if="warnItems.length">
        <div class="card-bd" style="padding:12px 18px">
          <div style="display:flex; align-items:center; gap:8px; margin-bottom:10px">
            <ic name="siren" size="16" style="color:var(--red)"></ic>
            <span class="strong" style="font-size:14px">临期预警事项（30 天内到期）</span>
            <span class="tag tag-red">{{ warnItems.length }} 项</span>
          </div>
          <div class="flt-warnbar">
            <span v-for="(w, i) in warnItems" :key="i" class="flt-warn-item" :class="{ overdue: w.level === 'OVERDUE' }">
              <ic name="alert-triangle" size="13"></ic>
              <b>{{ w.plate_no }}</b>
              <span>{{ w.label }}</span>
              <span class="muted" style="color:inherit; opacity:.75">{{ w.due_date }}</span>
              <span :class="w.level === 'OVERDUE' ? 'flt-red' : 'flt-amber-text'" style="font-weight:700">
                {{ w.days_left < 0 ? '已超期' + Math.abs(w.days_left) + '天' : '剩 ' + w.days_left + ' 天' }}
              </span>
            </span>
          </div>
        </div>
      </div>

      <!-- KPI row -->
      <div class="ast-kpi5" style="grid-template-columns:repeat(4,1fr); margin-bottom:16px">
        <div class="card ast-kpi">
          <div class="ico ico-amber"><ic name="wrench" size="24"></ic></div>
          <div class="meta"><div class="label">保养临期</div><div class="val" style="color:var(--amber)">{{ num(kpi.maintenance) }} <i>辆</i></div>
            <div class="sub muted">30 天内需保养</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-teal"><ic name="shield-check" size="24"></ic></div>
          <div class="meta"><div class="label">车险到期</div><div class="val" style="color:var(--teal)">{{ num(kpi.insurance) }} <i>辆</i></div>
            <div class="sub muted">30 天内需续保</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-red"><ic name="car" size="24"></ic></div>
          <div class="meta"><div class="label">年审到期</div><div class="val" style="color:var(--red)">{{ num(kpi.inspection) }} <i>辆</i></div>
            <div class="sub muted">30 天内需年审</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-blue"><ic name="history" size="24"></ic></div>
          <div class="meta"><div class="label">维保记录总数</div><div class="val" style="color:var(--primary)">{{ num(kpi.total) }} <i>条</i></div>
            <div class="sub muted">保养/保险/年审/维修</div></div>
        </div>
      </div>

      <!-- maintenance records -->
      <div class="card">
        <div class="card-hd"><div class="t">车辆维保记录</div></div>
        <div class="card-bd" style="padding-top:10px">
          <div class="filters">
            <select class="select" style="width:160px" v-model="filters.log_type" @change="query">
              <option value="">全部类型</option>
              <option value="MAINTENANCE">定期保养</option>
              <option value="INSURANCE">保险续保</option>
              <option value="INSPECTION">安全年审</option>
              <option value="REPAIR">维修送修</option>
            </select>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr>
              <th>车辆</th><th style="width:110px">维保类型</th><th style="width:110px">服务里程(km)</th>
              <th style="width:100px">费用(元)</th><th>维修厂/服务商</th><th>下次到期</th><th>备注</th><th>登记日期</th>
            </tr></thead>
            <tbody>
              <tr v-for="m in rows" :key="m.log_id">
                <td class="strong">{{ m.plate_no || '—' }}</td>
                <td><span :class="['tag', logTag(m.log_type)]">{{ m.log_type_label }}</span></td>
                <td class="num">{{ num(m.mileage_at_service) }}</td>
                <td class="num">{{ money(m.cost) }}</td>
                <td>{{ m.vendor || '—' }}</td>
                <td>
                  <template v-if="m.next_due_date">
                    <span :class="daysLeft(m.next_due_date) !== null && daysLeft(m.next_due_date) <= 30 ? 'ast-date-red' : ''">{{ m.next_due_date }}</span>
                    <span v-if="daysLeft(m.next_due_date) !== null && daysLeft(m.next_due_date) <= 30" class="tag tag-red" style="margin-left:6px">临期</span>
                  </template>
                  <span v-else class="muted">—</span>
                </td>
                <td class="ellipsis muted" style="max-width:170px" :title="m.notes">{{ m.notes || '—' }}</td>
                <td class="num muted">{{ (m.created_at || '').slice(0, 10) || '—' }}</td>
              </tr>
              <tr v-if="!rows.length"><td colspan="8"><div class="empty">暂无维保记录，点击右上角“新增维保记录”登记</div></td></tr>
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
      <Modal title="新增维保记录" width="600px" v-if="showForm" @close="showForm = false">
        <div class="flt-form-2col">
          <div class="form-item"><label class="req">车辆</label>
            <select class="select" v-model="form.vehicle_id">
              <option value="" disabled>请选择车辆</option>
              <option v-for="v in vehicles" :key="v.vehicle_id" :value="v.vehicle_id">{{ v.plate_no }}（{{ v.brand_model }}）</option>
            </select>
          </div>
          <div class="form-item"><label class="req">维保类型</label>
            <select class="select" v-model="form.log_type">
              <option value="MAINTENANCE">定期保养</option>
              <option value="INSURANCE">保险续保</option>
              <option value="INSPECTION">安全年审</option>
              <option value="REPAIR">维修送修</option>
            </select>
          </div>
          <div class="form-item"><label>服务里程</label><input type="number" min="0" class="input" placeholder="km" v-model="form.mileage_at_service"></div>
          <div class="form-item"><label>费用(元)</label><input type="number" min="0" class="input" v-model="form.cost"></div>
          <div class="form-item"><label>维修厂</label><input class="input" placeholder="如 XX汽车服务中心" v-model="form.vendor"></div>
          <div class="form-item"><label>下次到期日</label><input type="date" class="input" v-model="form.next_due_date"></div>
          <div class="form-item"><label>下次到期里程</label><input type="number" min="0" class="input" placeholder="km（选填）" v-model="form.next_due_mileage"></div>
          <div class="form-item"><label>备注</label><input class="input" placeholder="维保项目说明（选填）" v-model="form.notes"></div>
        </div>
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
