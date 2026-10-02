/* /portal/calendar 协同日程 — month grid view + selected-day agenda
   (adapted from design/mockups/003-portal-calendar.png; events from GET /api/portal/calendar) */
AppPages['/portal/calendar'] = {
  route: '/portal/calendar', title: '协同日程', category: 'PORTAL', primaryAction: null,
  icon: 'calendar-days',
  component: {
    data() {
      const now = new Date();
      const pad = (n) => String(n).padStart(2, '0');
      return {
        loading: true,
        user: api.cachedUser() || {},
        y: now.getFullYear(), m: now.getMonth() + 1,
        events: [],
        selDate: now.getFullYear() + '-' + pad(now.getMonth() + 1) + '-' + pad(now.getDate()),
        typeFilter: '',
        weekNames: ['一', '二', '三', '四', '五', '六', '日'],
      };
    },
    computed: {
      monthStr() { return this.y + '-' + String(this.m).padStart(2, '0'); },
      monthLabel() { return this.y + '年' + this.m + '月'; },
      todayIso() { return this.isoOf(new Date()); },
      greeting() {
        const h = new Date().getHours();
        if (h < 12) return '上午好';
        if (h < 14) return '中午好';
        if (h < 18) return '下午好';
        return '晚上好';
      },
      todayText() {
        const d = new Date();
        const wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
        return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + wd;
      },
      evMap() {
        const map = {};
        (this.events || []).forEach((e) => {
          if (!e.date) return;
          (map[e.date] = map[e.date] || []).push(e);
        });
        Object.values(map).forEach((arr) => arr.sort((a, b) => String(a.time || '').localeCompare(String(b.time || ''))));
        return map;
      },
      cells() {
        const first = new Date(this.y, this.m - 1, 1);
        const offset = (first.getDay() + 6) % 7; // Monday-first
        const start = new Date(this.y, this.m - 1, 1 - offset);
        const cells = [];
        for (let i = 0; i < 42; i++) {
          const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
          const iso = this.isoOf(d);
          let evs = this.evMap[iso] || [];
          if (this.typeFilter) evs = evs.filter((e) => e.type === this.typeFilter);
          cells.push({
            iso, day: d.getDate(),
            out: d.getMonth() + 1 !== this.m,
            isToday: iso === this.todayIso,
            evs: evs.slice(0, 3), more: evs.length - Math.min(evs.length, 3),
          });
        }
        return cells;
      },
      countOfType() {
        const c = { meeting: 0, research: 0, deadline: 0 };
        (this.events || []).forEach((e) => { if (c[e.type] !== undefined) c[e.type]++; });
        return c;
      },
      selLabel() {
        const parts = this.selDate.split('-');
        const d = new Date(+parts[0], +parts[1] - 1, +parts[2]);
        const wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
        return (+parts[1]) + '月' + (+parts[2]) + '日 ' + wd;
      },
      selEvents() { return this.evMap[this.selDate] || []; },
    },
    async mounted() { await this.load(); },
    methods: {
      isoOf(d) {
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      },
      async load() {
        this.loading = true;
        try {
          const d = await api.get('/api/portal/calendar', { month: this.monthStr });
          this.events = d.events || [];
        } catch (e) { this.events = []; }
        this.loading = false;
      },
      async prevMonth() { this.m--; if (this.m < 1) { this.m = 12; this.y--; } await this.load(); },
      async nextMonth() { this.m++; if (this.m > 12) { this.m = 1; this.y++; } await this.load(); },
      async goToday() {
        const now = new Date();
        this.y = now.getFullYear(); this.m = now.getMonth() + 1;
        this.selDate = this.isoOf(now);
        await this.load();
      },
      toggleFilter(type) { this.typeFilter = this.typeFilter === type ? '' : type; },
      evCls(type) { return { meeting: 'meeting', research: 'research', deadline: 'deadline' }[type] || 'other'; },
      evTag(type) { return { meeting: 'tag-blue', research: 'tag-teal', deadline: 'tag-red' }[type] || 'tag-gray'; },
      evLabel(type) { return { meeting: '会议', research: '调研', deadline: '督办截止' }[type] || '日程'; },
    },
    template: `
    <div v-if="!loading">
      <div class="page-sub" style="margin-bottom:14px; font-size:14px">
        <b>{{ (user.nick_name || '您好') }}，{{ greeting }}！</b>　今天是 {{ todayText }}，合理安排时间，高效协同！
      </div>

      <!-- KPI row (counts derived from current month events) -->
      <div class="kpi-row">
        <div class="card kpi-card" @click="toggleFilter('meeting')" :style="typeFilter==='meeting' ? 'border-color:var(--primary)' : ''">
          <div class="ico ico-blue"><ic name="calendar-days" size="28"></ic></div>
          <div class="meta"><div class="label">本月会议</div><div class="val" style="color:var(--primary)">{{ countOfType.meeting }}</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="toggleFilter('research')" :style="typeFilter==='research' ? 'border-color:var(--teal)' : ''">
          <div class="ico ico-teal"><ic name="map-pin" size="28"></ic></div>
          <div class="meta"><div class="label">调研安排</div><div class="val" style="color:var(--teal)">{{ countOfType.research }}</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="toggleFilter('deadline')" :style="typeFilter==='deadline' ? 'border-color:var(--red)' : ''">
          <div class="ico ico-red"><ic name="siren" size="28"></ic></div>
          <div class="meta"><div class="label">督办截止</div><div class="val" style="color:var(--red)">{{ countOfType.deadline }}</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="toggleFilter('')">
          <div class="ico ico-amber"><ic name="calendar-check-2" size="28"></ic></div>
          <div class="meta"><div class="label">本月日程合计</div><div class="val" style="color:var(--amber)">{{ events.length }}</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div style="display:grid; grid-template-columns:minmax(0,1fr) 360px; gap:16px; align-items:start">
        <!-- month grid -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">我的日程（{{ monthLabel }}）</div>
            <div style="display:flex; align-items:center; gap:8px">
              <span class="cal-legend"><i style="background:var(--primary)"></i>会议</span>
              <span class="cal-legend"><i style="background:var(--teal)"></i>调研</span>
              <span class="cal-legend"><i style="background:var(--red)"></i>督办截止</span>
              <span class="cal-nav-btn" @click="prevMonth"><ic name="chevron-left" size="15"></ic></span>
              <span class="strong" style="font-size:13.5px; padding:0 2px">{{ monthLabel }}</span>
              <span class="cal-nav-btn" @click="nextMonth"><ic name="chevron-right" size="15"></ic></span>
              <button class="btn btn-sm" @click="goToday">今天</button>
            </div>
          </div>
          <div class="card-bd" style="padding-top:12px">
            <div class="cal-grid">
              <div class="cal-head" v-for="w in weekNames" :key="'h' + w">周{{ w }}</div>
              <div v-for="c in cells" :key="c.iso" class="cal-cell"
                   :class="{out: c.out, sel: c.iso === selDate}" @click="selDate = c.iso">
                <span class="cal-num" :class="{today: c.isToday}">{{ c.day }}</span>
                <div v-for="(e, i) in c.evs" :key="i" class="cal-ev" :class="evCls(e.type)" :title="e.title">{{ e.title }}</div>
                <div v-if="c.more > 0" class="cal-more">还有 {{ c.more }} 项</div>
              </div>
            </div>
          </div>
        </div>

        <!-- selected day agenda -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">{{ selLabel }}</div>
            <span class="tag" :class="selDate === todayIso ? 'tag-blue' : 'tag-gray'">{{ selDate === todayIso ? '今天' : '已选日期' }}</span>
          </div>
          <div class="card-bd">
            <div class="tl">
              <div class="tl-item" v-for="(e, i) in selEvents" :key="i"
                   :class="e.type === 'deadline' ? 'amber' : e.type === 'research' ? 'teal' : ''">
                <div style="display:flex; justify-content:space-between; align-items:center">
                  <span class="strong" style="font-size:13px">{{ e.time || '全天' }}</span>
                  <span :class="['tag', evTag(e.type)]">{{ evLabel(e.type) }}</span>
                </div>
                <div class="strong" style="margin-top:2px">{{ e.title }}</div>
              </div>
              <div v-if="!selEvents.length" class="empty">当日暂无安排</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
