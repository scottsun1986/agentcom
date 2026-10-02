/* /fleet/dispatch 智能调度与派车单 — pixel replica of design/mockups/058-fleet-dispatch.png
   Layout: 4 KPI / 待调度申请表 + 派车单台账(服务端分页) / 调度弹窗(可用车辆+司机) + 电子派车单弹窗 */
AppPages['/fleet/dispatch'] = {
  route: '/fleet/dispatch', title: '智能调度与派车单', category: 'FLEET', primaryAction: null, icon: 'route',
  subtitle: '调度员对已批准申请指派车辆与驾驶员，生成具有防伪水印的《电子派车单》。',
  component: {
    data() {
      return {
        loading: true,
        kpi: { pending: 0, running: 0, returned: 0, warnings: 0 },
        pendingApps: [],
        rows: [], total: 0, pageNum: 1, pageSize: 10,
        filters: { status: '', keyword: '' },
        DST: { DISPATCHED: 'tag-blue', RETURNED: 'tag-green', SETTLED: 'tag-gray' },
        // dispatch modal
        dispApp: null, dispVehicles: [], dispDrivers: [], dispVehicle: '', dispDriver: '', dispLoading: false, dispatching: false,
        // electronic dispatch note
        note: null,
      };
    },
    computed: {
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
    },
    async mounted() {
      await Promise.all([this.load(), this.loadPending(), this.loadKpi()]);
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
      num(v) { return Number(v || 0).toLocaleString(); },
      dstTag(s) { return this.DST[s] || 'tag-gray'; },
      async load() {
        try {
          const r = await api.page('/api/fleet/dispatches', {
            status: this.filters.status || undefined, keyword: this.filters.keyword || undefined,
            pageNum: this.pageNum, pageSize: this.pageSize,
          });
          this.rows = r.rows || [];
          this.total = r.total || 0;
        } catch (e) { this.rows = []; this.total = 0; }
      },
      async loadPending() {
        try {
          const r = await api.page('/api/fleet/applications', { status: 'APPROVED', pageNum: 1, pageSize: 50 });
          this.pendingApps = r.rows || [];
        } catch (e) { this.pendingApps = []; }
      },
      async loadKpi() {
        const one = async (status) => {
          try { const r = await api.page('/api/fleet/dispatches', { status: status || undefined, pageNum: 1, pageSize: 1 }); return r.total || 0; }
          catch (e) { return 0; }
        };
        try {
          const [pending, running, returned] = await Promise.all([
            api.page('/api/fleet/applications', { status: 'APPROVED', pageNum: 1, pageSize: 1 }).then((r) => r.total || 0).catch(() => 0),
            one('DISPATCHED'), one('RETURNED'),
          ]);
          this.kpi.pending = pending; this.kpi.running = running; this.kpi.returned = returned;
          const w = await api.get('/api/fleet/maintenance/warnings');
          this.kpi.warnings = (w || []).reduce((s, v) => s + (v.warnings || []).length, 0);
        } catch (e) { /* keep zeros */ }
      },
      query() { this.pageNum = 1; this.load(); },
      reset() { this.filters = { status: '', keyword: '' }; this.query(); },
      goPage(p) { if (p < 1 || p > this.pageCount) return; this.pageNum = p; this.load(); },
      async openDispatch(a) {
        this.dispApp = a;
        this.dispVehicle = ''; this.dispDriver = '';
        this.dispLoading = true;
        try {
          const d = await api.get('/api/fleet/available', { start_time: a.start_time, end_time: a.end_time, seats: a.passenger_count || 1 });
          this.dispVehicles = d.vehicles || [];
          this.dispDrivers = d.drivers || [];
        } catch (e) { this.dispVehicles = []; this.dispDrivers = []; }
        this.dispLoading = false;
      },
      async submitDispatch() {
        if (!this.dispVehicle) return this.$root.toast('请选择可用车辆', 'warn');
        if (!this.dispDriver) return this.$root.toast('请选择出车驾驶员', 'warn');
        this.dispatching = true;
        try {
          const d = await api.post('/api/fleet/applications/' + this.dispApp.app_id + '/dispatch', { vehicle_id: this.dispVehicle, driver_id: this.dispDriver });
          this.$root.toast('派车成功，电子派车单已生成', 'ok');
          this.note = d;
          this.dispApp = null;
          await Promise.all([this.load(), this.loadPending(), this.loadKpi()]);
        } catch (e) { /* toast shown */ }
        this.dispatching = false;
      },
      showNote(r) { this.note = r; },
      onPrimary() { if (this.pendingApps.length) this.openDispatch(this.pendingApps[0]); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="ast-kpi5" style="grid-template-columns:repeat(4,1fr); margin-bottom:16px">
        <div class="card ast-kpi">
          <div class="ico ico-blue"><ic name="file-text" size="24"></ic></div>
          <div class="meta"><div class="label">待调度用车申请</div><div class="val" style="color:var(--primary)">{{ num(kpi.pending) }}</div>
            <div class="sub muted">已批准待派车</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-teal"><ic name="car" size="24"></ic></div>
          <div class="meta"><div class="label">出车中任务</div><div class="val" style="color:var(--teal)">{{ num(kpi.running) }}</div>
            <div class="sub muted">派车单出车中</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-green2"><ic name="check-circle-2" size="24"></ic></div>
          <div class="meta"><div class="label">已归队</div><div class="val" style="color:var(--green)">{{ num(kpi.returned) }}</div>
            <div class="sub muted">累计完成派车任务</div></div>
        </div>
        <div class="card ast-kpi" @click="$root.go('/fleet/maintenance')">
          <div class="ico ico-amber"><ic name="wrench" size="24"></ic></div>
          <div class="meta"><div class="label">维保/年审预警</div><div class="val" style="color:var(--amber)">{{ num(kpi.warnings) }}</div>
            <div class="sub muted">调度前请留意车辆临期</div></div>
        </div>
      </div>

      <!-- pending applications -->
      <div class="card">
        <div class="card-hd"><div class="t">待调度用车申请（{{ pendingApps.length }}）</div><span class="more" @click="$root.go('/fleet/applications')">用车申请管理 <ic name="chevron-right" size="14"></ic></span></div>
        <div class="card-bd" style="padding-top:8px">
          <table class="table">
            <thead><tr>
              <th style="width:60px">序号</th><th>申请人</th><th>用车事由</th><th>出发地 → 目的地</th>
              <th style="width:76px">乘车人数</th><th>用车时间</th><th style="width:120px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="(a, i) in pendingApps" :key="a.app_id">
                <td class="muted">{{ i + 1 }}</td>
                <td class="strong">{{ a.applicant_name || '—' }}</td>
                <td class="ellipsis" style="max-width:200px" :title="a.purpose">{{ a.purpose || '—' }}</td>
                <td>{{ (a.origin || '—') + ' → ' + (a.destination || '—') }}</td>
                <td class="num">{{ a.passenger_count }} 人</td>
                <td class="num muted">{{ bj(a.start_time) }} ~ {{ bj(a.end_time) }}</td>
                <td class="actions"><button class="btn btn-primary btn-sm" @click="openDispatch(a)"><ic name="car" size="12"></ic>调度派车</button></td>
              </tr>
              <tr v-if="!pendingApps.length"><td colspan="7"><div class="empty">暂无待调度的用车申请</div></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- dispatch ledger -->
      <div class="card mt16">
        <div class="card-hd"><div class="t">派车单台账</div></div>
        <div class="card-bd" style="padding-top:10px">
          <div class="filters">
            <select class="select" style="width:140px" v-model="filters.status" @change="query">
              <option value="">全部状态</option>
              <option value="DISPATCHED">出车中</option>
              <option value="RETURNED">已归队</option>
            </select>
            <input class="input" style="width:220px" placeholder="申请事由 / 车牌 / 司机关键词" v-model="filters.keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr>
              <th>派车单号</th><th>申请事由</th><th>车牌号</th><th>驾驶员</th><th style="width:110px">出发里程(km)</th>
              <th style="width:96px">状态</th><th>派车时间</th><th style="width:110px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in rows" :key="r.dispatch_id">
                <td class="muted num">{{ r.dispatch_id.slice(0, 8) }}</td>
                <td class="ellipsis" style="max-width:200px" :title="r.purpose">{{ r.purpose || '—' }}</td>
                <td class="strong">{{ r.plate_no || '—' }}</td>
                <td>{{ r.driver_name || '—' }}</td>
                <td class="num">{{ r.start_mileage == null ? '—' : num(r.start_mileage) }}</td>
                <td><span :class="['tag', dstTag(r.status)]">{{ r.status_label }}</span></td>
                <td class="num muted">{{ bj(r.plan_start_time) }}</td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="note = r">电子派车单</button>
                  <button v-if="r.status === 'DISPATCHED'" class="btn btn-text btn-sm" @click="$root.go('/fleet/trip-logs')">归队核销</button>
                </td>
              </tr>
              <tr v-if="!rows.length"><td colspan="8"><div class="empty">暂无派车单记录</div></td></tr>
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

      <!-- dispatch modal -->
      <Modal title="调度派车" width="560px" v-if="dispApp" @close="dispApp = null">
        <div class="dtl-box" style="margin-bottom:14px">
          <span class="k">申请事由</span><span class="strong">{{ dispApp.purpose }}</span>
          <span class="k">出发/目的</span><span>{{ (dispApp.origin || '—') + ' → ' + (dispApp.destination || '—') }}</span>
          <span class="k">用车时间</span><span class="num">{{ bj(dispApp.start_time) }} ~ {{ bj(dispApp.end_time) }}</span>
          <span class="k">乘车人数</span><span>{{ dispApp.passenger_count }} 人<span v-if="dispApp.leader_name" class="muted">（领导：{{ dispApp.leader_name }}）</span></span>
        </div>
        <div class="form-item"><label class="req">可用车辆</label>
          <select class="select" v-model="dispVehicle" :disabled="dispLoading">
            <option value="" disabled>{{ dispLoading ? '正在查询时段可用车辆…' : '请选择可用车辆' }}</option>
            <option v-for="v in dispVehicles" :key="v.vehicle_id" :value="v.vehicle_id">
              {{ v.plate_no }}（{{ v.brand_model }} · {{ v.seat_count }}座 · {{ v.quota_type_label }}）
            </option>
          </select>
        </div>
        <div class="form-item"><label class="req">出车驾驶员</label>
          <select class="select" v-model="dispDriver" :disabled="dispLoading">
            <option value="" disabled>{{ dispLoading ? '正在查询当班驾驶员…' : '请选择驾驶员' }}</option>
            <option v-for="d in dispDrivers" :key="d.driver_id" :value="d.driver_id">
              {{ d.name }}（准驾 {{ d.license_type }} · 安全里程 {{ num(d.safe_mileage) }}km）
            </option>
          </select>
        </div>
        <div v-if="!dispLoading && !dispVehicles.length" class="rem-tip" style="margin-left:102px"><ic name="alert-triangle" size="14"></ic>该时段暂无满足座位需求的可用车辆，请调整用车时间或先完成其他任务归队。</div>
        <template #footer>
          <button class="btn btn-ghost" @click="dispApp = null">取消</button>
          <button class="btn btn-primary" :disabled="dispatching || dispLoading" @click="submitDispatch">确认派车</button>
        </template>
      </Modal>

      <!-- electronic dispatch note -->
      <Modal title="电子派车单" width="620px" v-if="note" @close="note = null">
        <div class="flt-note">
          <div class="flt-note-wm">
            <span style="top:18%; left:4%">公务用车凭证</span>
            <span style="top:52%; left:22%">公务用车凭证</span>
            <span style="top:82%; left:8%">公务用车凭证</span>
          </div>
          <div class="flt-note-title">电 子 派 车 单</div>
          <div class="muted" style="text-align:center; font-size:11px; letter-spacing:2px; margin-top:2px">OFFICIAL VEHICLE DISPATCH CERTIFICATE</div>
          <div class="flt-note-no">
            <span>单号：{{ note.dispatch_id.slice(0, 8).toUpperCase() }}</span>
            <span :class="['tag', dstTag(note.status)]">{{ note.status_label }}</span>
          </div>
          <div class="flt-note-grid">
            <span class="k">车辆号牌</span><span class="strong" style="font-size:16px">{{ note.plate_no || '—' }}</span>
            <span class="k">车辆型号</span><span>{{ note.brand_model || '—' }}</span>
            <span class="k">驾驶员</span><span class="strong">{{ note.driver_name || '—' }}<span class="muted" style="font-weight:400" v-if="note.driver_phone">（{{ note.driver_phone }}）</span></span>
            <span class="k">申请人</span><span>{{ note.applicant_name || '—' }}</span>
            <span class="k">用车事由</span><span>{{ note.purpose || '—' }}</span>
            <span class="k">出车路线</span><span class="strong">{{ (note.origin || '—') + ' → ' + (note.destination || '—') }}</span>
            <span class="k">用车时间</span><span class="num">{{ bj(note.plan_start_time) }} 至 {{ bj(note.plan_end_time) }}</span>
            <span class="k">出发里程</span><span class="num">{{ note.start_mileage == null ? '—' : num(note.start_mileage) }} km</span>
            <span class="k">归队时间</span><span class="num">{{ note.actual_return_time ? bj(note.actual_return_time) : '—' }}</span>
          </div>
          <div class="flt-note-foot">本单据由公务用车管理平台自动生成，具有防伪水印，仅限本次任务使用。</div>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="note = null">关闭</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
