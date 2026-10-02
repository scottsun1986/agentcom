/* /conference/schedule 会议大屏与日程看板 — pixel replica of design/mockups/031-conference-schedule.png
   Layout: date switcher + greeting / 4 KPI / 会议室日程甘特(8:00-20:00) / (今日会议统计 | 会议室使用率 | 近期会议提醒) */
AppPages['/conference/schedule'] = {
  route: '/conference/schedule', title: '会议大屏与日程看板', category: 'CONFERENCE', primaryAction: '新建预订', icon: 'calendar-days',
  component: {
    data() {
      return {
        loading: true,
        date: '',
        rooms: [],
        detail: null,
        userName: '',
        hourGreet: '',
      };
    },
    computed: {
      isToday() { return this.date === this.bizToday(); },
      dateCn() {
        if (!this.date) return '';
        const d = new Date(this.date + 'T00:00:00');
        const wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
        return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + wd;
      },
      totalBookings() { return this.rooms.reduce((s, r) => s + (r.bookings || []).length, 0); },
      maintCount() { return this.rooms.filter((r) => r.status === 'MAINTENANCE').length; },
      usingCount() {
        if (!this.isToday) return 0;
        const now = this.nowMin();
        return this.rooms.filter((r) => (r.bookings || []).some((b) => b.status === 'CONFIRMED' && now >= this.bMin(b) && now < this.eMin(b))).length;
      },
      idleCount() { return Math.max(0, this.rooms.length - this.usingCount - this.maintCount); },
      usagePct() {
        const base = this.rooms.length - this.maintCount;
        return base > 0 ? Math.round(this.usingCount / base * 100) : 0;
      },
      statParts() {
        const p = { run: 0, soon: 0, end: 0, other: 0 };
        this.rooms.forEach((r) => (r.bookings || []).forEach((b) => { p[this.blockCat(b)]++; }));
        return p;
      },
      statDonut() {
        const p = this.statParts;
        return this.donutStyle([
          { val: p.run, color: '#246BFD' }, { val: p.soon, color: '#13A89E' },
          { val: p.end, color: '#CBD5E1' }, { val: p.other, color: '#F59E0B' },
        ]);
      },
      usageDonut() {
        return this.donutStyle([
          { val: this.usingCount, color: '#246BFD' }, { val: this.idleCount, color: '#13A89E' },
          { val: this.maintCount, color: '#CBD5E1' },
        ]);
      },
      upcoming() {
        const list = [];
        const now = this.nowMin();
        this.rooms.forEach((r) => (r.bookings || []).forEach((b) => {
          if (this.isToday && this.bMin(b) <= now) return;
          list.push(Object.assign({ room_name: r.name }, b, { _s: this.bMin(b) }));
        }));
        list.sort((a, b) => a._s - b._s);
        return list.slice(0, 5);
      },
    },
    async mounted() {
      const u = api.cachedUser();
      this.userName = (u && u.nick_name) || '';
      const h = new Date().getHours();
      this.hourGreet = h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
      this.date = this.bizToday();
      await this.load();
      this.loading = false;
    },
    methods: {
      bizToday() {
        const d = new Date(Date.now() + (480 + new Date().getTimezoneOffset()) * 60000);
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      },
      nowMin() {
        const d = new Date(Date.now() + (480 + new Date().getTimezoneOffset()) * 60000);
        return d.getHours() * 60 + d.getMinutes();
      },
      toMin(hm) { const p = String(hm || '0:0').split(':'); return (+p[0]) * 60 + (+p[1]); },
      bMin(b) { return this.toMin(String(b.time_range || '').slice(0, 5)); },
      eMin(b) { return this.toMin(String(b.time_range || '').slice(6, 11)); },
      async load() {
        try {
          const d = await api.get('/api/conference/schedule', { date: this.date });
          this.rooms = d.rooms || [];
        } catch (e) { this.rooms = []; }
      },
      async adjustDay(delta) {
        const d = new Date(this.date + 'T00:00:00');
        d.setDate(d.getDate() + delta);
        const p = (n) => String(n).padStart(2, '0');
        this.date = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
        await this.load();
      },
      blockCat(b) {
        if (b.status === 'PENDING_APPROVAL') return 'other';
        if (!this.isToday) { return this.bMin(b) >= this.nowMin() ? 'soon' : 'end'; }
        const now = this.nowMin();
        if (now >= this.bMin(b) && now < this.eMin(b)) return 'run';
        return this.bMin(b) > now ? 'soon' : 'end';
      },
      blockCls(b) { return { run: 'gb-blue', soon: 'gb-teal', end: 'gb-gray', other: 'gb-amber' }[this.blockCat(b)]; },
      blockStyle(b) {
        const start = Math.max(0, this.bMin(b) - 480);
        const end = Math.min(720, this.eMin(b) - 480);
        if (end - start < 3) return { display: 'none' };
        return { left: (start / 720 * 100) + '%', width: ((end - start) / 720 * 100) + '%' };
      },
      roomDot(r) { return { AVAILABLE: 'dot-green', MAINTENANCE: 'dot-red', DISABLED: 'dot-gray' }[r.status] || 'dot-gray'; },
      durationText(b) {
        const m = Math.max(0, this.eMin(b) - this.bMin(b));
        const h = Math.floor(m / 60), mm = m % 60;
        return (h ? h + ' 小时' : '') + (mm ? (h ? ' ' : '') + mm + ' 分钟' : (h ? '' : '0 分钟'));
      },
      donutStyle(parts) {
        const total = parts.reduce((s, p) => s + p.val, 0) || 1;
        let acc = 0; const stops = [];
        parts.forEach((p) => {
          const from = acc / total * 100; acc += p.val; const to = acc / total * 100;
          stops.push(p.color + ' ' + from.toFixed(2) + '% ' + to.toFixed(2) + '%');
        });
        return { background: 'conic-gradient(' + stops.join(', ') + ')' };
      },
      openDetail(b, room) {
        this.detail = Object.assign({}, b, { room_name: room.name, location: room.location });
      },
      onPrimary() { this.$root.go('/conference/bookings'); },
    },
    template: `
    <div v-if="!loading">
      <!-- toolbar + greeting -->
      <div style="display:flex; align-items:flex-start; justify-content:space-between; gap:12px; flex-wrap:wrap">
        <div class="page-sub" style="margin:0; font-size:14px">
          <b>{{ userName }}，{{ hourGreet }}！</b>　今天是 {{ dateCn }}，共有 <b>{{ totalBookings }}</b> 场会议，<b>{{ usingCount }}</b> 个会议室正在使用中。
        </div>
        <div style="display:flex; align-items:center; gap:8px">
          <button class="cal-nav-btn" @click="adjustDay(-1)"><ic name="chevron-left" size="14"></ic></button>
          <input type="date" class="input" style="width:150px" v-model="date" @change="load">
          <button class="cal-nav-btn" @click="adjustDay(1)"><ic name="chevron-right" size="14"></ic></button>
          <button class="btn btn-ghost" @click="date = bizToday(); load()">今天</button>
        </div>
      </div>

      <!-- KPI row -->
      <div class="kpi-row mt16">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="users" size="28"></ic></div>
          <div class="meta"><div class="label">今日会议总数</div><div class="val" style="color:var(--primary)">{{ totalBookings }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">场</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="door-open" size="28"></ic></div>
          <div class="meta"><div class="label">会议室总数</div><div class="val" style="color:var(--teal)">{{ rooms.length }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">间</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="door-open" size="28"></ic></div>
          <div class="meta"><div class="label">使用中</div><div class="val" style="color:var(--amber)">{{ usingCount }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">间</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="clock" size="28"></ic></div>
          <div class="meta"><div class="label">空闲中</div><div class="val" style="color:var(--primary)">{{ idleCount }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">间</span></div></div>
        </div>
      </div>

      <!-- gantt board -->
      <div class="card mt16">
        <div class="card-hd">
          <div class="t">会议室日程（甘特视图）</div>
          <div class="sch-legend">
            <span><i class="dot-blue"></i>会议进行中</span>
            <span><i class="dot-green"></i>即将开始</span>
            <span><i style="background:#CBD5E1"></i>已结束</span>
            <span><i class="dot-amber"></i>待审批</span>
            <span><i class="dot-red"></i>维修停用</span>
          </div>
        </div>
        <div class="card-bd" style="padding-top:8px">
          <!-- hour ruler -->
          <div class="gantt-row" style="margin-bottom:2px">
            <div class="gantt-label strong" style="color:var(--text)">会议室 / 时间</div>
            <div class="gantt-track" style="background:transparent; height:20px">
              <span v-for="h in 12" :key="'tk' + h" class="sch-tick-lb" :style="{ left: ((h - 1) / 12 * 100) + '%' }">{{ String(h + 7).padStart(2, '0') }}:00</span>
            </div>
          </div>
          <!-- room rows -->
          <div v-for="r in rooms" :key="r.room_id" class="gantt-row">
            <div class="gantt-label" style="width:150px; text-align:left; display:flex; align-items:center; gap:6px">
              <span class="strong" style="font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ r.name }}</span>
              <span class="muted" style="font-size:11px">{{ r.capacity }}人</span>
              <i :class="['gd-dot', roomDot(r)]" :title="r.status_label"></i>
            </div>
            <div class="gantt-track">
              <i v-for="h in 11" :key="'v' + r.room_id + h" class="gantt-vline" :style="{ left: (h / 12 * 100) + '%' }"></i>
              <i v-if="isToday && nowMin() >= 480 && nowMin() <= 1200" class="now-line" :style="{ left: Math.min(99.6, (nowMin() - 480) / 720 * 100) + '%' }"></i>
              <template v-if="r.status === 'MAINTENANCE'">
                <div class="gantt-block gb-red" style="left:0; width:100%; justify-content:center">
                  <span><b>08:00 - 20:00&nbsp;</b>设备维护（暂停使用）</span>
                </div>
              </template>
              <div v-for="b in r.bookings" :key="b.booking_id" class="gantt-block sch-block" :class="blockCls(b)"
                   :style="blockStyle(b)" style="cursor:pointer" @click="openDetail(b, r)">
                <span><b>{{ b.time_range }}&nbsp;</b>{{ b.title }}</span>
              </div>
              <div v-if="r.status !== 'MAINTENANCE' && !(r.bookings || []).length" class="gantt-free">空闲</div>
            </div>
          </div>
          <div v-if="!rooms.length" class="empty">暂无会议室数据</div>
        </div>
      </div>

      <!-- bottom stats -->
      <div class="split-3-2 mt16" style="grid-template-columns:1fr 1fr 1.2fr">
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">今日会议统计</div></div>
          <div class="card-bd donut-row">
            <div class="donut" :style="statDonut"><div class="donut-hole"><b>{{ totalBookings }}</b><span>场会议</span></div></div>
            <div class="dn-legend">
              <div class="row"><i class="dot-blue"></i>进行中<b>{{ statParts.run }} 场</b></div>
              <div class="row"><i class="dot-green"></i>即将开始<b>{{ statParts.soon }} 场</b></div>
              <div class="row"><i style="background:#CBD5E1"></i>已结束<b>{{ statParts.end }} 场</b></div>
              <div class="row"><i class="dot-amber"></i>待审批<b>{{ statParts.other }} 场</b></div>
            </div>
          </div>
        </div>
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">会议室使用率</div></div>
          <div class="card-bd donut-row">
            <div class="donut" :style="usageDonut"><div class="donut-hole"><b>{{ usagePct }}%</b><span>使用率</span></div></div>
            <div class="dn-legend">
              <div class="row"><i class="dot-blue"></i>使用中<b>{{ usingCount }} 间</b></div>
              <div class="row"><i class="dot-green"></i>空闲中<b>{{ idleCount }} 间</b></div>
              <div class="row"><i style="background:#CBD5E1"></i>维修停用<b>{{ maintCount }} 间</b></div>
              <div class="row muted" style="margin-left:18px">共 {{ rooms.length }} 间</div>
            </div>
          </div>
        </div>
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">近期会议提醒</div></div>
          <div class="card-bd" style="padding-top:6px">
            <div v-for="(u, i) in upcoming" :key="i" class="up-row" @click="openDetail(u, { name: u.room_name })">
              <i :class="['gd-dot', { 'gb-blue': 'dot-blue', 'gb-teal': 'dot-green', 'gb-gray': '', 'gb-amber': 'dot-amber' }[blockCls(u)]]"></i>
              <span class="num strong" style="width:96px; flex:none; font-size:12.5px">{{ u.time_range }}</span>
              <span class="ell" style="flex:1" :title="u.title">{{ u.title }}</span>
              <span class="muted" style="font-size:12px; flex:none">{{ u.room_name }}</span>
            </div>
            <div v-if="!upcoming.length" class="empty">今日已无待开始的会议</div>
          </div>
        </div>
      </div>

      <!-- booking detail modal -->
      <Modal title="会议预订详情" width="480px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">会议标题</span><span class="strong">{{ detail.title }}</span>
          <span class="k">会议室</span><span>{{ detail.room_name }}<span class="muted" v-if="detail.location">（{{ detail.location }}）</span></span>
          <span class="k">会议时间</span><span class="num">{{ detail.time_range }}</span>
          <span class="k">会议时长</span><span>{{ durationText(detail) }}</span>
          <span class="k">预约人</span><span>{{ detail.user_name || '—' }}</span>
          <span class="k">参会人数</span><span>{{ detail.attendee_count || '—' }} 人</span>
          <span class="k">当前状态</span><span><span :class="['tag', { CONFIRMED: 'tag-green', PENDING_APPROVAL: 'tag-amber', CANCELLED: 'tag-gray' }[detail.status]]">{{ detail.status_label }}</span></span>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="detail = null">关闭</button>
          <button class="btn btn-primary" @click="$root.go('/conference/bookings'); detail = null">前往预订管理</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
