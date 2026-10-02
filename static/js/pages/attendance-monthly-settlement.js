/* /attendance/monthly-settlement 月度考勤汇总报表 — pixel replica of design/mockups/011-attendance-monthly-settlement.png
   Layout: month nav / 5 KPI / detail table (search + pager + total row) + CSV export */
AppPages['/attendance/monthly-settlement'] = {
  route: '/attendance/monthly-settlement', title: '月度考勤汇总报表', category: 'ATTENDANCE', primaryAction: '导出归档', icon: 'bar-chart-3',
  subtitle: '全员出勤天数、迟到早退次数、各类假期扣减工时自动核算，支持 HR 月末一键锁账与导出归档。',
  component: {
    data() {
      return {
        loading: true,
        month: '',
        locked: false,
        rows: [],
        keyword: '',
        pageNum: 1,
        pageSize: 10,
        detail: null,
      };
    },
    computed: {
      monthLabel() {
        if (!this.month) return '';
        const [y, m] = this.month.split('-');
        return y + ' 年 ' + Number(m) + ' 月';
      },
      filtered() {
        const kw = (this.keyword || '').trim().toLowerCase();
        if (!kw) return this.rows;
        return this.rows.filter((r) => ((r.user_name || '') + (r.dept || '')).toLowerCase().includes(kw));
      },
      pageCount() { return Math.max(1, Math.ceil(this.filtered.length / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      totals() {
        const t = { should: 0, actual: 0, late: 0, early: 0, leave: 0, trip: 0 };
        this.filtered.forEach((r) => {
          t.should += r.should_days || 0; t.actual += r.actual_days || 0;
          t.late += r.late || 0; t.early += r.early || 0;
          t.leave += r.leave_days || 0; t.trip += r.trip_days || 0;
        });
        return t;
      },
      kpi() {
        const n = this.rows.length;
        const lateEarlyPeople = this.rows.filter((r) => (r.late || 0) + (r.early || 0) > 0).length;
        const leavePeople = this.rows.filter((r) => (r.leave_days || 0) > 0).length;
        const tripPeople = this.rows.filter((r) => (r.trip_days || 0) > 0).length;
        const rate = this.totals.should ? Math.round((this.totals.actual / this.totals.should) * 1000) / 10 : 0;
        return {
          headcount: n, rate,
          actual: this.totals.actual, lateEarly: this.totals.late + this.totals.early, lateEarlyPeople,
          leaveDays: this.totals.leave, leavePeople,
          tripDays: this.totals.trip, tripPeople,
        };
      },
    },
    async mounted() {
      const t = new Date();
      this.month = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0');
      await this.load();
      this.loading = false;
    },
    methods: {
      async load() {
        try {
          const d = await api.get('/api/attendance/monthly-settlement', { month: this.month });
          this.rows = d.rows || [];
          this.locked = !!d.locked;
        } catch (e) { this.rows = []; }
        this.pageNum = 1;
      },
      shiftMonth(delta) {
        const [y, m] = this.month.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        this.month = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        this.load();
      },
      onMonthInput() { this.load(); },
      query() { this.pageNum = 1; },
      goPage(p) { if (p >= 1 && p <= this.pageCount) this.pageNum = p; },
      rowStatus(r) {
        return (r.late || 0) + (r.early || 0) >= 3 || (r.should_days || 0) - (r.actual_days || 0) > 5 ? { label: '异常', cls: 'tag-red' } : { label: '正常', cls: 'tag-green' };
      },
      exportCsv() {
        const head = '姓名,所属部门,应出勤天数,实际出勤天数,迟到次数,早退次数,请假扣减(天),外出出差(天),状态';
        const lines = this.filtered.map((r) => [r.user_name, r.dept || '', r.should_days, r.actual_days, r.late, r.early, r.leave_days, r.trip_days, this.rowStatus(r).label].map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','));
        const t = this.totals;
        lines.push(['"合计","",' + t.should + ',' + t.actual + ',' + t.late + ',' + t.early + ',' + t.leave + ',' + t.trip + ',""']);
        const blob = new Blob(['\uFEFF' + head + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '月度考勤汇总报表_' + this.month + '.csv';
        a.click();
        URL.revokeObjectURL(a.href);
        this.$root.toast('已导出 ' + this.filtered.length + ' 条汇总数据', 'ok');
      },
      onPrimary() { this.exportCsv(); },
    },
    template: `
    <div v-if="!loading">
      <!-- month nav -->
      <div style="display:flex; align-items:center; justify-content:flex-end; gap:10px; margin-bottom:14px">
        <span v-if="locked" class="tag tag-amber"><ic name="lock" size="12"></ic>本月已锁定</span>
        <div class="card" style="display:flex; align-items:center; padding:4px 6px; gap:4px">
          <button class="btn btn-text" style="padding:2px 6px" @click="shiftMonth(-1)"><ic name="chevron-left" size="16"></ic></button>
          <input type="month" class="input" style="width:130px; border:none; box-shadow:none; text-align:center" v-model="month" @change="onMonthInput">
          <button class="btn btn-text" style="padding:2px 6px" @click="shiftMonth(1)"><ic name="chevron-right" size="16"></ic></button>
        </div>
      </div>

      <!-- KPI row -->
      <div class="settle-kpis">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="users" size="28"></ic></div>
          <div class="meta">
            <div class="label">应出勤人数</div>
            <div class="val" style="color:var(--primary)">{{ kpi.headcount }} <span style="font-size:14px;font-weight:400">人</span></div>
            <div class="muted" style="font-size:12px">在册员工全员核算</div>
          </div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="calendar-check-2" size="28"></ic></div>
          <div class="meta">
            <div class="label">全员出勤天数</div>
            <div class="val" style="color:var(--teal)">{{ kpi.actual }} <span style="font-size:14px;font-weight:400">天</span></div>
            <div class="muted" style="font-size:12px">出勤率 {{ kpi.rate }}%</div>
          </div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="clock" size="28"></ic></div>
          <div class="meta">
            <div class="label">迟到早退次数</div>
            <div class="val" style="color:var(--amber)">{{ kpi.lateEarly }} <span style="font-size:14px;font-weight:400">次</span></div>
            <div class="muted" style="font-size:12px">涉及 {{ kpi.lateEarlyPeople }} 人</div>
          </div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="file-text" size="28"></ic></div>
          <div class="meta">
            <div class="label">假期扣减</div>
            <div class="val">{{ kpi.leaveDays }} <span style="font-size:14px;font-weight:400">天</span></div>
            <div class="muted" style="font-size:12px">已审批请假 · 涉及 {{ kpi.leavePeople }} 人</div>
          </div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="briefcase" size="28"></ic></div>
          <div class="meta">
            <div class="label">外出与出差天数</div>
            <div class="val" style="color:var(--red)">{{ kpi.tripDays }} <span style="font-size:14px;font-weight:400">天</span></div>
            <div class="muted" style="font-size:12px">免打卡核算 · 涉及 {{ kpi.tripPeople }} 人</div>
          </div>
        </div>
      </div>

      <!-- detail table -->
      <div class="card mt16">
        <div class="card-hd">
          <div class="t">部门人员月度考勤明细 <span class="muted" style="font-size:12.5px;font-weight:400">（{{ monthLabel }}，共 {{ filtered.length }} 人）</span></div>
          <div style="display:flex; gap:8px; align-items:center">
            <input class="input" style="width:220px" placeholder="请输入姓名或部门" v-model="keyword" @keyup.enter="query">
            <button class="btn btn-primary btn-sm" @click="query"><ic name="search" size="14"></ic>筛选</button>
          </div>
        </div>
        <div class="card-bd" style="padding-top:8px">
          <table class="table table-stripe">
            <thead>
              <tr>
                <th style="width:56px">序号</th><th>姓名</th><th>所属部门</th><th>应出勤天数</th><th>实际出勤天数</th>
                <th>迟到次数</th><th>早退次数</th><th>请假扣减(天)</th><th>外出出差(天)</th><th>状态</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(r, i) in shownRows" :key="r.user_id">
                <td class="num muted">{{ (pageNum - 1) * pageSize + i + 1 }}</td>
                <td class="strong">{{ r.user_name || '—' }}</td>
                <td>{{ r.dept || '—' }}</td>
                <td class="num">{{ r.should_days }}</td>
                <td class="num">{{ r.actual_days }}</td>
                <td class="num" :style="{color: r.late ? 'var(--red)' : ''}">{{ r.late }}</td>
                <td class="num" :style="{color: r.early ? 'var(--amber)' : ''}">{{ r.early }}</td>
                <td class="num">{{ r.leave_days }}</td>
                <td class="num">{{ r.trip_days }}</td>
                <td><span :class="['tag', rowStatus(r).cls]">{{ rowStatus(r).label }}</span></td>
                <td class="actions"><button class="btn btn-text btn-sm" @click="detail = r">详情</button></td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="11"><div class="empty">该月份暂无考勤汇总数据</div></td></tr>
            </tbody>
            <tfoot v-if="filtered.length">
              <tr style="background:#F8FAFD; font-weight:600">
                <td colspan="3">合计（{{ filtered.length }} 人）</td>
                <td class="num">{{ totals.should }}</td>
                <td class="num">{{ totals.actual }}</td>
                <td class="num">{{ totals.late }}</td>
                <td class="num">{{ totals.early }}</td>
                <td class="num">{{ totals.leave }}</td>
                <td class="num">{{ totals.trip }}</td>
                <td colspan="2"></td>
              </tr>
            </tfoot>
          </table>
          <div class="pager" v-if="pageCount > 1">
            <span>共 {{ filtered.length }} 条记录，每页 {{ pageSize }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in pageCount" :key="p" v-show="pageCount <= 7 || p === 1 || p === pageCount || Math.abs(p - pageNum) <= 1" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
      </div>

      <!-- detail modal -->
      <Modal :title="(detail && detail.user_name || '') + ' 的月度考勤详情'" width="480px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">统计月份</span><span>{{ monthLabel }}</span>
          <span class="k">姓名</span><span class="strong">{{ detail.user_name }}</span>
          <span class="k">所属部门</span><span>{{ detail.dept || '—' }}</span>
          <span class="k">应出勤天数</span><span>{{ detail.should_days }} 天</span>
          <span class="k">实际出勤天数</span><span>{{ detail.actual_days }} 天</span>
          <span class="k">迟到 / 早退</span><span>{{ detail.late }} 次 / {{ detail.early }} 次</span>
          <span class="k">请假扣减</span><span>{{ detail.leave_days }} 天</span>
          <span class="k">外出出差</span><span>{{ detail.trip_days }} 天</span>
          <span class="k">考勤状态</span><span><span :class="['tag', rowStatus(detail).cls]">{{ rowStatus(detail).label }}</span></span>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="detail = null">关闭</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
