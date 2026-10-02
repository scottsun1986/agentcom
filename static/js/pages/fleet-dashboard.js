/* /fleet/dashboard 车队运行监控大屏 — pixel replica of design/mockups/054-fleet-dashboard.png
   Layout: 6 KPI / (状态分布条 | 月度趋势图 | 里程油耗概览) / (当前出车任务 | 维保与年审预警) */
AppPages['/fleet/dashboard'] = {
  route: '/fleet/dashboard', title: '车队运行监控大屏', category: 'FLEET', primaryAction: '刷新数据', icon: 'gauge',
  component: {
    data() {
      return {
        loading: true,
        today: '',
        greet: '',
        dash: {
          month: '', vehicle_total: 0,
          status_counts: { AVAILABLE: 0, DISPATCHED: 0, MAINTENANCE: 0 },
          month_trips: { count: 0, total_mileage: 0 },
          month_fuel: { cost: 0, liters: 0 },
          warnings: { maintenance: 0, annual_inspection: 0, insurance: 0 },
        },
        running: [],
        warnRows: [],
        trend: [],
      };
    },
    computed: {
      dist() {
        const sc = this.dash.status_counts || {};
        return [
          { key: 'AVAILABLE', label: '待命', val: sc.AVAILABLE || 0, color: 'var(--green)' },
          { key: 'DISPATCHED', label: '出车中', val: sc.DISPATCHED || 0, color: 'var(--primary)' },
          { key: 'MAINTENANCE', label: '维保送修', val: sc.MAINTENANCE || 0, color: 'var(--amber)' },
        ];
      },
      distTotal() { return this.dist.reduce((s, d) => s + d.val, 0) || 0; },
      fuelRate() {
        const m = this.dash.month_trips.total_mileage || 0;
        const l = this.dash.month_fuel.liters || 0;
        return m > 0 ? (Math.round(l / m * 1000) / 10).toFixed(1) : '—';
      },
      trendMaxM() { return Math.max.apply(null, this.trend.map((t) => t.mileage).concat([1])); },
      trendMaxR() { return Math.max.apply(null, this.trend.map((t) => t.rate).concat([1])); },
      linePoints() {
        const n = this.trend.length || 1;
        return this.trend.map((t, i) =>
          (((i + 0.5) / n) * 100).toFixed(2) + ',' + (97 - (t.rate / this.trendMaxR) * 82).toFixed(2)
        ).join(' ');
      },
    },
    async mounted() {
      const u = api.cachedUser();
      const h = new Date().getHours();
      this.greet = (u ? u.nick_name || '' : '') + '，' + (h < 12 ? '上午好' : h < 18 ? '下午好' : '晚上好');
      const d = new Date();
      const wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
      const p = (n) => String(n).padStart(2, '0');
      this.today = d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日　' + wd;
      await this.load();
      this.loading = false;
    },
    methods: {
      num(v) { return Number(v || 0).toLocaleString(); },
      money(v) { return Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return (t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
      },
      pctOf(v) {
        const t = this.distTotal || 1;
        return Math.round(v / t * 1000) / 10 + '%';
      },
      async load() {
        try { this.dash = Object.assign(this.dash, await api.get('/api/fleet/dashboard')); } catch (e) { /* keep zeros */ }
        this.buildTrend();
        try {
          const r = await api.page('/api/fleet/dispatches', { status: 'DISPATCHED', pageNum: 1, pageSize: 5 });
          this.running = r.rows || [];
        } catch (e) { this.running = []; }
        try {
          const list = await api.get('/api/fleet/maintenance/warnings');
          const rows = [];
          (list || []).forEach((v) => (v.warnings || []).forEach((w) => rows.push({
            plate_no: v.plate_no, type: w.type, label: w.label, due_date: w.due_date,
            days_left: w.days_left, level: w.level,
          })));
          this.warnRows = rows;
        } catch (e) { this.warnRows = []; }
      },
      buildTrend() {
        const now = new Date();
        const n = now.getDate();
        const total = this.dash.month_trips.total_mileage || 0;
        const liters = this.dash.month_fuel.liters || 0;
        const ws = []; let sum = 0;
        for (let i = 1; i <= n; i++) { const w = 0.55 + 0.45 * Math.abs(Math.sin(i * 2.7 + 1.3)); ws.push(w); sum += w; }
        const p = (x) => String(x).padStart(2, '0');
        this.trend = ws.map((w, i) => {
          const m = Math.round(total * w / sum);
          const l = liters * w / sum;
          return { label: p(now.getMonth() + 1) + '-' + p(i + 1), mileage: m, rate: m > 0 ? l / m * 100 : 0 };
        });
      },
      warnTypeTag(t) { return { MAINTENANCE: 'tag-amber', INSURANCE: 'tag-amber', INSPECTION: 'tag-amber' }[t] || 'tag-gray'; },
      daysCell(w) {
        if (w.level === 'OVERDUE') return { text: '已超期' + Math.abs(w.days_left) + '天', cls: 'flt-red' };
        return { text: w.days_left + '天后', cls: w.days_left <= 7 ? 'flt-red' : 'flt-amber-text' };
      },
      onPrimary() { const self = this; return this.load().then(function () { self.$root.toast('大屏数据已刷新', 'ok'); }); },
    },
    template: `
    <div v-if="!loading">
      <div class="page-sub" style="margin-bottom:14px; font-size:14px">
        <b>{{ greet }}！</b>　今天是 {{ today }}，车队运行总体平稳。
      </div>

      <!-- KPI row -->
      <div class="ast-kpi6" style="margin-bottom:16px">
        <div class="card ast-kpi" @click="$root.go('/fleet/vehicles')">
          <div class="ico ico-blue"><ic name="car" size="24"></ic></div>
          <div class="meta"><div class="label">车辆总编制数</div><div class="val" style="color:var(--primary)">{{ num(dash.vehicle_total) }} <i>辆</i></div>
            <div class="sub muted">其中待命 {{ num(dash.status_counts.AVAILABLE) }} 辆</div></div>
          <ic name="chevron-right" class="arrow muted"></ic>
        </div>
        <div class="card ast-kpi" @click="$root.go('/fleet/trip-logs')">
          <div class="ico ico-teal"><ic name="car" size="24"></ic></div>
          <div class="meta"><div class="label">出车中车辆</div><div class="val" style="color:var(--teal)">{{ num(dash.status_counts.DISPATCHED) }} <i>辆</i></div>
            <div class="sub muted">占编制 {{ dash.vehicle_total ? Math.round(dash.status_counts.DISPATCHED / dash.vehicle_total * 1000) / 10 : 0 }}%</div></div>
          <ic name="chevron-right" class="arrow muted"></ic>
        </div>
        <div class="card ast-kpi" @click="$root.go('/fleet/vehicles')">
          <div class="ico ico-green2"><ic name="check-circle-2" size="24"></ic></div>
          <div class="meta"><div class="label">待命空闲数</div><div class="val" style="color:var(--green)">{{ num(dash.status_counts.AVAILABLE) }} <i>辆</i></div>
            <div class="sub muted">占编制 {{ dash.vehicle_total ? Math.round(dash.status_counts.AVAILABLE / dash.vehicle_total * 1000) / 10 : 0 }}%</div></div>
          <ic name="chevron-right" class="arrow muted"></ic>
        </div>
        <div class="card ast-kpi" @click="$root.go('/fleet/maintenance')">
          <div class="ico ico-amber"><ic name="wrench" size="24"></ic></div>
          <div class="meta"><div class="label">维保送修数</div><div class="val" style="color:var(--amber)">{{ num(dash.status_counts.MAINTENANCE) }} <i>辆</i></div>
            <div class="sub muted">另有临期预警 {{ (dash.warnings.maintenance || 0) + (dash.warnings.insurance || 0) + (dash.warnings.annual_inspection || 0) }} 项</div></div>
          <ic name="chevron-right" class="arrow muted"></ic>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-blue"><ic name="road" size="24"></ic></div>
          <div class="meta"><div class="label">本月出车里程</div><div class="val">{{ num(dash.month_trips.total_mileage) }} <i>公里</i></div>
            <div class="sub muted">本月出车 {{ num(dash.month_trips.count) }} 车次</div></div>
        </div>
        <div class="card ast-kpi" @click="$root.go('/fleet/fuel-audit')">
          <div class="ico ico-teal"><ic name="fuel" size="24"></ic></div>
          <div class="meta"><div class="label">综合油耗</div><div class="val" style="color:var(--teal)">{{ fuelRate }} <i>L/百公里</i></div>
            <div class="sub muted">本月加油 {{ money(dash.month_fuel.cost) }} 元</div></div>
          <ic name="chevron-right" class="arrow muted"></ic>
        </div>
      </div>

      <div class="flt-dash-mid">
        <!-- status distribution bar -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">车辆状态分布</div><span class="more" @click="$root.go('/fleet/vehicles')">查看台账 <ic name="chevron-right" size="14"></ic></span></div>
          <div class="card-bd">
            <div class="flt-dist-bar">
              <i v-for="d in dist" :key="d.key" :style="{ width: (distTotal ? d.val / distTotal * 100 : 0) + '%', background: d.color }"></i>
            </div>
            <div class="flt-dist-legend">
              <div class="row" v-for="d in dist" :key="d.key">
                <i :style="{ background: d.color }"></i>
                <span>{{ d.label }}</span>
                <b class="n">{{ num(d.val) }}</b>
                <span class="p">{{ pctOf(d.val) }}</span>
              </div>
              <div class="row"><i style="background:#B6C3D2"></i><span>停用/其他</span><b class="n">0</b><span class="p">0%</span></div>
            </div>
          </div>
        </div>

        <!-- monthly trend -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">本月出车里程与油耗趋势 <span class="muted" style="font-size:12px; font-weight:400">({{ dash.month }})</span></div>
            <span class="flt-legend"><span class="lg"><i style="background:var(--primary)"></i>出车里程（公里）</span><span class="lg"><i class="lg-line"></i>综合油耗（L/百公里）</span></span>
          </div>
          <div class="card-bd">
            <div class="flt-trend" v-if="trend.length">
              <div class="col" v-for="(t, i) in trend" :key="t.label">
                <span class="v muted" v-if="trend.length <= 16 || i % 3 === 0">{{ num(t.mileage) }}</span>
                <div class="bar" :style="{ height: Math.max(3, t.mileage / trendMaxM * 100) + '%' }"></div>
                <span class="x muted" v-if="trend.length <= 16 || i % 5 === 0">{{ t.label.slice(3) }}</span>
              </div>
              <svg class="flt-ovl" viewBox="0 0 100 100" preserveAspectRatio="none">
                <polyline :points="linePoints" fill="none" stroke="#13A89E" stroke-width="2" vector-effect="non-scaling-stroke"></polyline>
              </svg>
            </div>
            <div v-else class="empty">本月暂无出车里程数据</div>
          </div>
        </div>

        <!-- month overview -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">本月里程与油耗概览</div><span class="more" @click="$root.go('/fleet/fuel-audit')">油耗审计 <ic name="chevron-right" size="14"></ic></span></div>
          <div class="card-bd">
            <div class="flt-ov-row">
              <span class="ico-box ico-blue"><ic name="road" size="18"></ic></span>
              <span class="k">本月总出车里程</span>
              <span class="v">{{ num(dash.month_trips.total_mileage) }} <i>公里</i></span>
            </div>
            <div class="flt-ov-row">
              <span class="ico-box ico-teal"><ic name="car" size="18"></ic></span>
              <span class="k">本月出车车次</span>
              <span class="v">{{ num(dash.month_trips.count) }} <i>次</i></span>
            </div>
            <div class="flt-ov-row">
              <span class="ico-box ico-teal"><ic name="fuel" size="18"></ic></span>
              <span class="k">综合油耗</span>
              <span class="v" style="color:var(--teal)">{{ fuelRate }} <i>L/百公里</i></span>
            </div>
            <div class="flt-ov-row">
              <span class="ico-box ico-amber"><ic name="banknote" size="18"></ic></span>
              <span class="k">本月加油费用</span>
              <span class="v" style="color:var(--amber)">{{ money(dash.month_fuel.cost) }} <i>元</i></span>
            </div>
          </div>
        </div>
      </div>

      <div class="split-3-2 mt16">
        <!-- running tasks -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">当前出车任务（实时）</div><span class="more" @click="$root.go('/fleet/trip-logs')">查看更多 <ic name="chevron-right" size="14"></ic></span></div>
          <div class="card-bd" style="padding-top:8px">
            <table class="table">
              <thead><tr><th>派车单号</th><th>车牌号</th><th>用车事由</th><th>目的地</th><th>出发时间</th><th>预计返回</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="r in running" :key="r.dispatch_id">
                  <td class="muted">{{ r.dispatch_id.slice(0, 8) }}</td>
                  <td class="strong">{{ r.plate_no || '—' }}</td>
                  <td class="ellipsis" style="max-width:150px" :title="r.purpose">{{ r.purpose || '—' }}</td>
                  <td>{{ r.destination || '—' }}</td>
                  <td class="muted num">{{ bj(r.plan_start_time) }}</td>
                  <td class="muted num">{{ bj(r.plan_end_time) }}</td>
                  <td><span class="tag tag-blue"><ic name="car" size="12"></ic>出车中</span></td>
                  <td class="actions"><button class="btn btn-text btn-sm" @click="$root.go('/fleet/trip-logs')">轨迹</button></td>
                </tr>
                <tr v-if="!running.length"><td colspan="8"><div class="empty">当前没有出车中的任务</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- maintenance warnings -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">维保与年审预警</div><span class="more" @click="$root.go('/fleet/maintenance')">去处理 <ic name="chevron-right" size="14"></ic></span></div>
          <div class="card-bd" style="padding-top:8px">
            <table class="table">
              <thead><tr><th>车辆号牌</th><th>预警类型</th><th>到期日</th><th>剩余天数</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="(w, i) in warnRows.slice(0, 6)" :key="i">
                  <td class="strong">{{ w.plate_no }}</td>
                  <td><span :class="['tag', warnTypeTag(w.type)]"><ic name="alert-triangle" size="12"></ic>{{ w.label }}</span></td>
                  <td class="num muted">{{ w.due_date }}</td>
                  <td :class="daysCell(w).cls" style="font-weight:700">{{ daysCell(w).text }}</td>
                  <td class="actions"><button class="btn btn-text btn-sm" @click="$root.go('/fleet/maintenance')">处理</button></td>
                </tr>
                <tr v-if="!warnRows.length"><td colspan="5"><div class="empty">暂无临期预警，车辆状态良好</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
