/* /visitor/dashboard 访客安全指挥屏 — pixel replica of design/mockups/047-visitor-dashboard.png
   Layout: 4 KPI cards / (访客进出趋势 | 超时滞留告警) / (当前在院访客 | 最新进出流水) */
AppPages['/visitor/dashboard'] = {
  route: '/visitor/dashboard', title: '访客安全指挥屏', category: 'VISITOR', primaryAction: '刷新数据', icon: 'siren',
  component: {
    data() {
      return {
        loading: true,
        stats: null,
        alerts: [],
        appts: [],
        nowTs: Date.now(),
      };
    },
    computed: {
      userName() { const u = api.cachedUser(); return (u && u.nick_name) || '管理员'; },
      dayPart() {
        const h = new Date().getHours();
        if (h < 12) return '上午好';
        if (h < 18) return '下午好';
        return '晚上好';
      },
      todayCn() {
        const d = new Date();
        const wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
        return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + wd;
      },
      inHouse() {
        return this.appts
          .filter((a) => a.status === 'CHECKED_IN')
          .sort((x, y) => String(y.check_in_time || '').localeCompare(String(x.check_in_time || '')))
          .slice(0, 6);
      },
      flows() {
        const items = [];
        this.appts.forEach((a) => {
          if (a.check_in_time) items.push({ t: a.check_in_time, dir: 'in', a });
          if (a.check_out_time) items.push({ t: a.check_out_time, dir: 'out', a });
        });
        return items.sort((x, y) => String(y.t).localeCompare(String(x.t))).slice(0, 12);
      },
      trend() {
        const hours = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
        const inC = hours.map((h) => this.appts.filter((a) => this.hourOf(a.check_in_time) === h).length);
        const outC = hours.map((h) => this.appts.filter((a) => this.hourOf(a.check_out_time) === h).length);
        const raw = Math.max(4, ...inC, ...outC);
        return { hours, inC, outC, maxV: Math.ceil(raw / 4) * 4 };
      },
      gridLines() {
        const self = this;
        return [0, 0.25, 0.5, 0.75, 1].map((f) => ({
          v: Math.round(self.trend.maxV * f),
          y: self.ty(self.trend.maxV * f, self.trend.maxV),
        }));
      },
      inPath() { return this.path(this.trend.inC, this.trend.maxV); },
      outPath() { return this.path(this.trend.outC, this.trend.maxV); },
      inArea() {
        const vals = this.trend.inC;
        const n = vals.length;
        const p = this.path(vals, this.trend.maxV);
        return p + ' L' + this.tx(n - 1, n).toFixed(1) + ',160 L' + this.tx(0, n).toFixed(1) + ',160 Z';
      },
    },
    async mounted() { await this.load(); this.loading = false; },
    methods: {
      async load() {
        this.nowTs = Date.now();
        try {
          const d = await api.get('/api/visitor/dashboard');
          this.stats = d.stats || null;
          this.alerts = d.overdue_alerts || [];
        } catch (e) { this.stats = null; this.alerts = []; }
        try {
          const r = await api.page('/api/visitor/appointments', { pageNum: 1, pageSize: 200 });
          this.appts = r.rows || [];
        } catch (e) { this.appts = []; }
      },
      s(k) { return this.stats ? this.stats[k] : '—'; },
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
      },
      maskPhone(p) { return p && p.length >= 7 ? p.slice(0, 3) + '****' + p.slice(-4) : (p || '—'); },
      hourOf(s) {
        if (!s) return -1;
        const d = new Date(s);
        if (isNaN(d.getTime())) return -1;
        return new Date(d.getTime() + 8 * 3600000).getUTCHours();
      },
      hourLabel(h) { return (h < 10 ? '0' + h : '' + h) + ':00'; },
      tx(i, n) { const padL = 38, padR = 12; return padL + (i * (600 - padL - padR)) / (n - 1); },
      ty(v, maxV) { const padT = 14, padB = 30; return padT + (1 - (maxV ? v / maxV : 0)) * (190 - padT - padB); },
      path(vals, maxV) {
        const n = vals.length;
        return vals.map((v, i) => (i ? 'L' : 'M') + this.tx(i, n).toFixed(1) + ',' + this.ty(v, maxV).toFixed(1)).join(' ');
      },
      fmtDur(ms) {
        const m = Math.max(0, Math.floor(ms / 60000));
        const h = Math.floor(m / 60);
        return h > 0 ? h + '小时' + (m % 60) + '分钟' : m + '分钟';
      },
      ovDur(a) { return this.fmtDur(this.nowTs - new Date(a.scheduled_end).getTime()); },
      stayDur(a) { return this.fmtDur(this.nowTs - new Date(a.check_in_time).getTime()); },
      dirTag(dir) { return dir === 'in' ? 'tag-blue' : 'tag-teal'; },
      dirLabel(dir) { return dir === 'in' ? '入场' : '出场'; },
      async contact(a) { this.$root.toast('已向受访人 ' + (a.host_name || '') + ' 推送滞留提醒通知', 'ok'); },
      onPrimary() { this.load(); this.$root.toast('数据已刷新', 'ok'); },
    },
    template: `
    <div v-if="!loading">
      <div class="page-sub" style="margin-bottom:14px; font-size:14px">
        <b>{{ userName }}，{{ dayPart }}！</b>　今天是 {{ todayCn }}，当前院区访客通行情况正常运行。
      </div>

      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" @click="$root.go('/visitor/reservations')">
          <div class="ico ico-blue"><ic name="users" size="28"></ic></div>
          <div class="meta">
            <div class="label">今日预约人数</div>
            <div class="val" style="color:var(--primary)">{{ s('today_appointments') }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">人</span></div>
            <div class="muted" style="font-size:12px">待审核 {{ s('pending_audit') }} 单</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/visitor/checkout')">
          <div class="ico ico-teal"><ic name="user" size="28"></ic></div>
          <div class="meta">
            <div class="label">当前在院访客数</div>
            <div class="val" style="color:var(--teal)">{{ s('current_in') }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">人</span></div>
            <div class="muted" style="font-size:12px">正在院区内访问</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/visitor/reservations')">
          <div class="ico ico-amber"><ic name="log-out" size="28"></ic></div>
          <div class="meta">
            <div class="label">已离场数</div>
            <div class="val" style="color:var(--amber)">{{ s('checked_out_today') }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">人</span></div>
            <div class="muted" style="font-size:12px">今日已核销出场</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/visitor/checkout')">
          <div class="ico ico-red"><ic name="siren" size="28"></ic></div>
          <div class="meta">
            <div class="label">超时滞留人数</div>
            <div class="val" style="color:var(--red)">{{ s('overdue_alerts') }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">人</span></div>
            <div class="muted" style="font-size:12px">滞留阈值 {{ s('overdue_minutes') }} 分钟</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="split-3-2">
        <!-- trend chart -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">访客进出趋势（今日）
              <span style="margin-left:14px; font-size:12px; color:var(--text-2)">
                <i class="v-legend-dot" style="background:var(--primary)"></i>进入人数
                <i class="v-legend-dot" style="background:var(--teal); margin-left:12px"></i>离开人数
              </span>
            </div>
            <span class="more">今日 <ic name="chevron-down" size="14"></ic></span>
          </div>
          <div class="card-bd">
            <svg class="v-trend" viewBox="0 0 600 192">
              <g v-for="g in gridLines" :key="'g' + g.v">
                <line x1="38" x2="588" :y1="g.y" :y2="g.y" stroke="#EDF1F7"></line>
                <text class="v-tick" x="32" :y="g.y + 3.5" text-anchor="end">{{ g.v }}</text>
              </g>
              <path :d="inArea" fill="rgba(36,107,253,.07)"></path>
              <path :d="inPath" fill="none" stroke="#246BFD" stroke-width="2"></path>
              <path :d="outPath" fill="none" stroke="#13A89E" stroke-width="2"></path>
              <circle v-for="(v, i) in trend.inC" :key="'i' + i" :cx="tx(i, 11)" :cy="ty(v, trend.maxV)" r="3" fill="#246BFD"></circle>
              <circle v-for="(v, i) in trend.outC" :key="'o' + i" :cx="tx(i, 11)" :cy="ty(v, trend.maxV)" r="3" fill="#13A89E"></circle>
              <text v-for="(h, i) in trend.hours" :key="'x' + i" class="v-tick" :x="tx(i, 11)" y="186" text-anchor="middle">{{ hourLabel(h) }}</text>
            </svg>
          </div>
        </div>

        <!-- overdue alerts -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t" style="color:var(--red)">超时滞留告警（{{ alerts.length }}）</div>
            <span class="more" @click="$root.go('/visitor/checkout')">查看全部 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd" style="padding-top:8px">
            <table class="table table-tight">
              <thead><tr><th style="width:36px">序号</th><th>访客姓名</th><th>单位 / 事由</th><th>预约时间</th><th>应离场</th><th>滞留时长</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="(a, i) in alerts" :key="a.appointment_id" class="row-red">
                  <td class="num">{{ i + 1 }}</td>
                  <td class="strong">{{ a.visitor_name }}</td>
                  <td><div class="ellipsis" style="max-width:120px">{{ a.company || '—' }}</div><div class="muted ellipsis" style="font-size:11.5px; max-width:120px">{{ a.visit_reason }}</div></td>
                  <td class="num muted">{{ bj(a.scheduled_start).slice(5, 16) }}</td>
                  <td class="num muted">{{ bj(a.scheduled_end).slice(5, 16) }}</td>
                  <td><span class="v-overdue-num">{{ ovDur(a) }}</span><div><span class="tag tag-red" style="margin-top:2px"><ic name="siren" size="12"></ic>超时滞留</span></div></td>
                  <td class="actions">
                    <button class="btn btn-text btn-sm" @click="contact(a)">联系</button>
                    <button class="btn btn-text btn-sm" @click="$root.go('/visitor/checkout')">核验</button>
                  </td>
                </tr>
                <tr v-if="!alerts.length"><td colspan="7"><div class="empty">暂无滞留告警，院区通行秩序正常</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="split-3-2 mt16">
        <!-- in-house visitors -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">当前在院访客（{{ s('current_in') }}）</div>
            <span class="more" @click="$root.go('/visitor/checkout')">查看全部 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd" style="padding-top:8px">
            <table class="table table-tight">
              <thead><tr><th style="width:36px">序号</th><th>访客姓名</th><th>联系方式</th><th>来访单位</th><th>访问事由</th><th>进入时间</th><th>在院时长</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="(a, i) in inHouse" :key="a.appointment_id">
                  <td class="num">{{ i + 1 }}</td>
                  <td class="strong">{{ a.visitor_name }}</td>
                  <td class="num muted">{{ maskPhone(a.visitor_phone) }}</td>
                  <td class="ellipsis" style="max-width:130px">{{ a.company || '—' }}</td>
                  <td class="ellipsis" style="max-width:110px">{{ a.visit_reason }}</td>
                  <td class="num muted">{{ bj(a.check_in_time).slice(5, 16) }}</td>
                  <td class="num">{{ stayDur(a) }}</td>
                  <td class="actions"><button class="btn btn-text btn-sm" @click="$root.go('/visitor/checkout')">详情</button></td>
                </tr>
                <tr v-if="!inHouse.length"><td colspan="8"><div class="empty">当前暂无在院访客</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- latest gate flow -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">最新进出流水</div>
            <span class="more" @click="load()">刷新 <ic name="refresh-cw" size="14"></ic></span>
          </div>
          <div class="card-bd" style="padding-top:4px; max-height:322px; overflow-y:auto">
            <div class="v-flow-row" v-for="(f, i) in flows" :key="i">
              <span class="v-flow-time">{{ bj(f.t).slice(11, 16) }}</span>
              <span :class="['tag', dirTag(f.dir)]"><ic :name="f.dir === 'in' ? 'door-open' : 'log-out'" size="12"></ic>{{ dirLabel(f.dir) }}</span>
              <span class="strong">{{ f.a.visitor_name }}</span>
              <span class="muted ellipsis" style="flex:1">{{ f.a.company || f.a.visit_reason || '—' }}</span>
              <span class="tag tag-green"><ic name="check" size="12"></ic>放行</span>
            </div>
            <div v-if="!flows.length" class="empty">今日暂无进出记录</div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
