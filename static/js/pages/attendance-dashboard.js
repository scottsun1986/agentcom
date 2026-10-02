/* /attendance/dashboard 考勤工作台 — pixel replica of design/mockups/006-attendance-dashboard.png
   Layout: greeting / 4 KPI / (今日打卡状态 | 考勤日历 | 假期余额) / (快捷申请 | 近期待勤异常 | 本月考勤汇总) */
AppPages['/attendance/dashboard'] = {
  route: '/attendance/dashboard', title: '考勤工作台', category: 'ATTENDANCE', primaryAction: '发起申请', icon: 'home',
  component: {
    data() {
      return {
        loading: true,
        greeting: '',
        today: { clocked_in: false, clocked_out: false, records: [], on_approved_trip: false },
        month: { late: 0, early: 0, absent_days: 0, workdays: 0, attendance_rate: 0 },
        quotas: [],
        monthRecords: [],
        monthLeaves: [],
        monthTrips: [],
        monthRemedies: [],
        nowText: '',
        calMonth: '',
        userName: '',
        punching: false,
      };
    },
    computed: {
      myId() { const u = api.cachedUser(); return u ? u.user_id : null; },
      actualDays() { return Math.max(0, (this.month.workdays || 0) - (this.month.absent_days || 0)); },
      leaveDays() {
        return this.monthLeaves.reduce((s, l) => s + (Number(l.duration_days) || 0), 0);
      },
      remedyCount() { return this.monthRemedies.length; },
      inRecord() { return this.today.records.find((r) => r.punch_type === 'IN') || this.today.records.find((r) => r.punch_type === 'FIELD') || null; },
      outRecord() { return this.today.records.find((r) => r.punch_type === 'OUT') || null; },
      todayStatus() {
        if (this.today.on_approved_trip) return { cls: 'tag-teal', text: '出差免打卡' };
        if (this.today.clocked_in && this.today.clocked_out) return { cls: 'tag-green', text: '正常' };
        if (this.today.clocked_in || this.today.clocked_out) return { cls: 'tag-blue', text: '已打卡' };
        return { cls: 'tag-amber', text: '待打卡' };
      },
      calTitle() { return this.calMonth.replace('-', ' 年 ') + ' 月'; },
      calCells() {
        const [y, m] = this.calMonth.split('-').map(Number);
        const first = new Date(y, m - 1, 1);
        const start = new Date(y, m - 1, 1 - first.getDay());
        const todayStr = this.bjDate(new Date().toISOString());
        const cells = [];
        for (let i = 0; i < 42; i++) {
          const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
          const ds = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
          cells.push({ day: d.getDate(), ds, inMonth: d.getMonth() === m - 1, weekend: d.getDay() === 0 || d.getDay() === 6, future: ds > todayStr, isToday: ds === todayStr, status: this.dayStatus(ds, d.getDay()) });
        }
        return cells;
      },
      anomalies() {
        const list = [];
        this.monthRecords.forEach((r) => {
          if (r.status === 'LATE' || r.status === 'EARLY' || r.status === 'ABNORMAL') {
            const type = { LATE: '迟到', EARLY: '早退', ABNORMAL: '异常' }[r.status];
            const rem = this.monthRemedies.find((x) => this.bjDate(x.remedy_time) === this.bjDate(r.punch_time) && x.punch_type === r.punch_type);
            list.push({ date: this.bjDate(r.punch_time), type, time: this.bj(r.punch_time).slice(11), status: rem ? (rem.audit_status === 'APPROVED' ? '已处理' : '待处理') : '待处理', progress: rem ? (rem.audit_status === 'APPROVED' ? '审核通过' : '审核中') : '待申请补卡' });
          }
        });
        return list.slice(0, 5);
      },
    },
    async mounted() {
      const u = api.cachedUser();
      this.userName = (u && u.nick_name) || '';
      const h = new Date().getHours();
      this.greeting = h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
      const now = new Date();
      this.nowText = now.getFullYear() + '年' + (now.getMonth() + 1) + '月' + now.getDate() + '日';
      this.calMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
      await this.load();
    },
    methods: {
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) + ':' + p(t.getUTCSeconds());
      },
      bjDate(s) { const v = this.bj(s); return v === '—' ? '' : v.slice(0, 10); },
      mine(list) { return (list || []).filter((x) => !this.myId || x.user_id === this.myId); },
      dayStatus(ds, dow) {
        if (this.monthTrips.some((t) => this.bjDate(t.start_time) <= ds && ds <= this.bjDate(t.end_time))) return 'trip';
        if (this.monthLeaves.some((l) => this.bjDate(l.start_time) <= ds && ds <= this.bjDate(l.end_time))) return 'leave';
        const recs = this.monthRecords.filter((r) => this.bjDate(r.punch_time) === ds);
        if (recs.some((r) => r.status === 'ABNORMAL')) return 'absent';
        if (recs.some((r) => r.status === 'LATE')) return 'late';
        if (recs.some((r) => r.status === 'EARLY')) return 'early';
        if (recs.length) return 'normal';
        return dow === 0 || dow === 6 ? 'holiday' : '';
      },
      async load() {
        const month = this.calMonth;
        try {
          const d = await api.get('/api/attendance/dashboard');
          this.today = d.today || this.today;
          this.month = d.month || this.month;
          this.quotas = d.quotas || [];
        } catch (e) { /* toast shown */ }
        const mStart = month + '-01T00:00:00+08:00';
        const [y, m] = month.split('-').map(Number);
        const mEnd = new Date(y, m, 1);
        const mEndStr = mEnd.getFullYear() + '-' + String(mEnd.getMonth() + 1).padStart(2, '0') + '-' + String(mEnd.getDate()).padStart(2, '0') + 'T00:00:00+08:00';
        const fail = [];
        try { const r = await api.page('/api/attendance/records', { start: mStart, end: mEndStr, pageNum: 1, pageSize: 200 }); this.monthRecords = this.mine(r.rows); } catch (e) { fail.push(1); }
        try { const r = await api.page('/api/attendance/leaves', { pageNum: 1, pageSize: 100 }); this.monthLeaves = this.mine(r.rows).filter((l) => l.start_time.slice(0, 7) === month || l.end_time.slice(0, 7) === month); } catch (e) { fail.push(1); }
        try { const r = await api.page('/api/attendance/trips', { pageNum: 1, pageSize: 100 }); this.monthTrips = this.mine(r.rows).filter((t) => t.start_time.slice(0, 7) === month || t.end_time.slice(0, 7) === month); } catch (e) { fail.push(1); }
        try { const r = await api.page('/api/attendance/remedies', { pageNum: 1, pageSize: 100 }); this.monthRemedies = this.mine(r.rows).filter((x) => (x.created_at || x.remedy_time).slice(0, 7) === month); } catch (e) { fail.push(1); }
        this.loading = false;
      },
      async punch(type) {
        if (this.punching) return;
        this.punching = true;
        try {
          await api.post('/api/attendance/clock', { punch_type: type });
          this.$root.toast(type === 'IN' ? '上班打卡成功' : '下班打卡成功', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
        this.punching = false;
      },
      quotaIcon(t) {
        return { ANNUAL: 'sun', SICK: 'activity', CASUAL: 'clipboard-list', COMP: 'history', MARITAL: 'star', MATERNITY: 'users', PATERNITY: 'user', HOME_VISIT: 'home' }[t] || 'calendar-check-2';
      },
      quotaColor(t) {
        return { ANNUAL: 'ico-blue', SICK: 'ico-teal', CASUAL: 'ico-amber', COMP: 'ico-teal', MARITAL: 'ico-blue', MATERNITY: 'ico-red', PATERNITY: 'ico-blue', HOME_VISIT: 'ico-teal' }[t] || 'ico-blue';
      },
      barCls(q) {
        const pct = q.total_days ? (q.used_days / q.total_days) * 100 : 0;
        if (pct >= 90) return 'bar-red';
        if (pct >= 70) return 'bar-amber';
        return { ANNUAL: '', SICK: 'bar-teal', CASUAL: 'bar-amber', COMP: 'bar-teal' }[q.leave_type] || '';
      },
      dotCls(st) {
        return { normal: 'dot-green', late: 'dot-amber', early: 'dot-orange', absent: 'dot-red', leave: 'dot-blue', trip: 'dot-purple', holiday: 'dot-pink' }[st] || '';
      },
      dayTitle(st) {
        return { normal: '正常', late: '迟到', early: '早退', absent: '旷工', leave: '请假', trip: '出差', holiday: '节假日' }[st] || '';
      },
      anomalyTag(s) { return s === '已处理' ? 'tag-green' : 'tag-amber'; },
      progressCls(p) { return p === '审核通过' ? 'teal-link' : p === '审核中' ? 'amber-link' : 'muted'; },
      onPrimary() { this.$root.go('/attendance/leave'); },
    },
    template: `
    <div v-if="!loading">
      <div class="page-sub" style="margin-bottom:14px; font-size:14px">
        <b>{{ userName }}，{{ greeting }}！</b>　今天是 {{ nowText }}，祝您工作顺利！
      </div>

      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" @click="$root.go('/attendance/monthly-settlement')">
          <div class="ico ico-blue"><ic name="calendar-check-2" size="28"></ic></div>
          <div class="meta">
            <div class="label">本月出勤率</div>
            <div class="val" style="color:var(--primary)">{{ month.attendance_rate }}%</div>
            <div class="muted" style="font-size:12px">出勤 {{ actualDays }} 天 / 应出勤 {{ month.workdays }} 天</div>
          </div>
        </div>
        <div class="card kpi-card" @click="$root.go('/attendance/records')">
          <div class="ico ico-teal"><ic name="clock" size="28"></ic></div>
          <div class="meta">
            <div class="label">本月迟到</div>
            <div class="val" style="color:var(--teal)">{{ month.late }} <span style="font-size:14px;font-weight:400">次</span></div>
            <div class="muted" style="font-size:12px">较上月{{ month.late > 0 ? '有所增加' : '保持 0 次' }}</div>
          </div>
        </div>
        <div class="card kpi-card" @click="$root.go('/attendance/records')">
          <div class="ico ico-amber"><ic name="log-out" size="28"></ic></div>
          <div class="meta">
            <div class="label">本月早退</div>
            <div class="val" style="color:var(--amber)">{{ month.early }} <span style="font-size:14px;font-weight:400">次</span></div>
            <div class="muted" style="font-size:12px">按 18:00 标准核算</div>
          </div>
        </div>
        <div class="card kpi-card" @click="$root.go('/attendance/remedy')">
          <div class="ico ico-red"><ic name="alert-triangle" size="28"></ic></div>
          <div class="meta">
            <div class="label">本月旷工</div>
            <div class="val" style="color:var(--red)">{{ month.absent_days }} <span style="font-size:14px;font-weight:400">次</span></div>
            <div class="muted" style="font-size:12px">漏打卡可申请补卡</div>
          </div>
        </div>
      </div>

      <div class="att-3col">
        <!-- today punch status -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">今日打卡状态</div>
            <span :class="['tag', todayStatus.cls]"><ic :name="todayStatus.cls==='tag-green' ? 'check-circle-2' : 'clock'" size="12"></ic>{{ todayStatus.text }}</span>
          </div>
          <div class="card-bd">
            <div class="muted" style="font-size:12.5px; margin-bottom:10px">{{ nowText }}　{{ ['星期日','星期一','星期二','星期三','星期四','星期五','星期六'][new Date().getDay()] }}</div>
            <div class="att-punch-row">
              <div class="punch-box">
                <div :class="['punch-ico', today.clocked_in ? 'ok' : '']"><ic :name="today.clocked_in ? 'check-circle-2' : 'clock'" size="30"></ic></div>
                <div class="strong" style="margin-top:6px">上班打卡</div>
                <div class="punch-time" :style="{color: today.clocked_in ? 'var(--green)' : 'var(--text-3)'}">{{ today.clocked_in ? bj(inRecord.punch_time) : '待打卡' }}</div>
                <div class="muted" style="font-size:11.5px; margin-top:2px"><ic name="map-pin" size="12"></ic> {{ (inRecord && inRecord.address) || '应打卡时间 09:00' }}</div>
                <button class="btn btn-primary btn-sm" style="margin-top:10px" :disabled="today.clocked_in || punching" @click="punch('IN')">上班打卡</button>
              </div>
              <div class="punch-box">
                <div :class="['punch-ico', today.clocked_out ? 'ok' : '']"><ic :name="today.clocked_out ? 'check-circle-2' : 'clock'" size="30"></ic></div>
                <div class="strong" style="margin-top:6px">下班打卡</div>
                <div class="punch-time" :style="{color: today.clocked_out ? 'var(--green)' : 'var(--text-3)'}">{{ today.clocked_out ? bj(outRecord.punch_time) : '待打卡' }}</div>
                <div class="muted" style="font-size:11.5px; margin-top:2px"><ic name="map-pin" size="12"></ic> {{ (outRecord && outRecord.address) || '下班时间 18:00' }}</div>
                <button class="btn btn-primary btn-sm" style="margin-top:10px" :disabled="today.clocked_out || punching" @click="punch('OUT')">下班打卡</button>
              </div>
            </div>
          </div>
        </div>

        <!-- month calendar -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">{{ calTitle }}　考勤日历</div>
            <span class="more" @click="$root.go('/attendance/records')">打卡明细 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd">
            <div class="cal-legend">
              <span><i class="dot-green"></i>正常</span><span><i class="dot-amber"></i>迟到</span><span><i class="dot-orange"></i>早退</span>
              <span><i class="dot-red"></i>旷工</span><span><i class="dot-blue"></i>请假</span><span><i class="dot-purple"></i>出差</span><span><i class="dot-pink"></i>节假日</span>
            </div>
            <div class="cal">
              <div class="cal-wd">日</div><div class="cal-wd">一</div><div class="cal-wd">二</div><div class="cal-wd">三</div><div class="cal-wd">四</div><div class="cal-wd">五</div><div class="cal-wd">六</div>
              <div v-for="c in calCells" :key="c.ds" class="cal-cell" :class="{out: !c.inMonth, today: c.isToday}">
                <div class="cal-day" :class="{red: c.weekend && c.inMonth}">{{ c.day }}</div>
                <i v-if="c.status" :class="['cal-dot', dotCls(c.status)]" :title="dayTitle(c.status)"></i>
              </div>
            </div>
          </div>
        </div>

        <!-- quota balances -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">假期余额 <span class="muted" style="font-size:12px;font-weight:400">（截至 {{ nowText.replace(/年|月/g, '-').replace('日','') }}）</span></div>
            <span class="more" @click="$root.go('/attendance/leave')">查看详情 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd" style="padding-top:6px">
            <div v-for="q in quotas" :key="q.leave_type" class="quota-row">
              <span :class="['ico-box', 'ico-weak', quotaColor(q.leave_type)]" style="width:26px;height:26px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center"><ic :name="quotaIcon(q.leave_type)" size="15"></ic></span>
              <span class="strong" style="width:46px">{{ q.leave_type_label }}</span>
              <span class="quota-nums">{{ q.used_days }} 天 / {{ q.total_days }} 天</span>
              <div class="progress" style="flex:1"><div class="bar" :class="barCls(q)" :style="{width: (q.total_days ? Math.round(q.used_days/q.total_days*100) : 0) + '%'}"></div></div>
              <span class="muted" style="width:38px;text-align:right;font-size:12px">{{ q.total_days ? Math.round(q.used_days/q.total_days*100) : 0 }}%</span>
            </div>
            <div v-if="!quotas.length" class="empty" style="padding:24px 0">本年度暂无假期额度记录</div>
          </div>
        </div>
      </div>

      <div class="att-3col mt16">
        <!-- quick apply -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">快捷申请</div></div>
          <div class="card-bd" style="display:grid; grid-template-columns:1fr 1fr; gap:10px">
            <div class="shortcut" @click="$root.go('/attendance/leave')">
              <span class="ico-box ico-blue" style="width:38px;height:38px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center"><ic name="calendar-plus" size="20"></ic></span>
              <span class="sc-meta"><b>请假申请</b><i>年假 / 事假 / 病假等</i></span>
              <ic name="chevron-right" size="16" style="color:#B6C3D2"></ic>
            </div>
            <div class="shortcut" @click="$root.go('/attendance/trip')">
              <span class="ico-box ico-teal" style="width:38px;height:38px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center"><ic name="send" size="20"></ic></span>
              <span class="sc-meta"><b>外出报备</b><i>外出 / 公干 / 开会等</i></span>
              <ic name="chevron-right" size="16" style="color:#B6C3D2"></ic>
            </div>
            <div class="shortcut" @click="$root.go('/attendance/trip')">
              <span class="ico-box ico-amber" style="width:38px;height:38px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center"><ic name="briefcase" size="20"></ic></span>
              <span class="sc-meta"><b>出差申请</b><i>国内 / 国外出差</i></span>
              <ic name="chevron-right" size="16" style="color:#B6C3D2"></ic>
            </div>
            <div class="shortcut" @click="$root.go('/attendance/remedy')">
              <span class="ico-box ico-red" style="width:38px;height:38px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center"><ic name="rotate-ccw" size="20"></ic></span>
              <span class="sc-meta"><b>补卡申请</b><i>漏打卡 / 异常打卡</i></span>
              <ic name="chevron-right" size="16" style="color:#B6C3D2"></ic>
            </div>
          </div>
        </div>

        <!-- recent anomalies -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">近期待勤异常</div>
            <span class="more" @click="$root.go('/attendance/remedy')">查看更多 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd" style="padding-top:6px">
            <table class="table">
              <thead><tr><th>日期</th><th>异常类型</th><th>时间</th><th>状态</th><th>处理进度</th></tr></thead>
              <tbody>
                <tr v-for="a in anomalies" :key="a.date + a.type">
                  <td class="num">{{ a.date }}</td>
                  <td><span class="tag tag-amber"><ic name="alert-triangle" size="12"></ic>{{ a.type }}</span></td>
                  <td class="num">{{ a.time }}</td>
                  <td><span :class="['tag', anomalyTag(a.status)]">{{ a.status }}</span></td>
                  <td :class="progressCls(a.progress)" style="font-size:12.5px">{{ a.progress }}</td>
                </tr>
                <tr v-if="!anomalies.length"><td colspan="5"><div class="empty">本月暂无考勤异常 👍</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- month summary -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">本月考勤汇总</div>
            <span class="more" @click="$root.go('/attendance/monthly-settlement')">查看详情 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd">
            <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:12px">
              <div class="mini-stat"><div class="muted">应出勤天数</div><div class="ms-val" style="color:var(--primary)">{{ month.workdays }}<i>天</i></div></div>
              <div class="mini-stat"><div class="muted">实际出勤</div><div class="ms-val" style="color:var(--green)">{{ actualDays }}<i>天</i></div></div>
              <div class="mini-stat"><div class="muted">请假天数</div><div class="ms-val" style="color:var(--amber)">{{ leaveDays }}<i>天</i></div></div>
            </div>
            <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:8px">
              <div class="mini-stat"><div class="muted">迟到</div><div class="ms-val">{{ month.late }}<i>次</i></div></div>
              <div class="mini-stat"><div class="muted">早退</div><div class="ms-val">{{ month.early }}<i>次</i></div></div>
              <div class="mini-stat"><div class="muted">旷工</div><div class="ms-val" :style="{color: month.absent_days ? 'var(--red)' : ''}">{{ month.absent_days }}<i>次</i></div></div>
              <div class="mini-stat"><div class="muted">补卡</div><div class="ms-val">{{ remedyCount }}<i>次</i></div></div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
