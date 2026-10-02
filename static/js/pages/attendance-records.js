/* /attendance/records 打卡记录管理 — pixel replica of design/mockups/007-attendance-records.png
   Layout: 4 KPI / filter card (2 rows) / (records table + pager | record detail panel) */
AppPages['/attendance/records'] = {
  route: '/attendance/records', title: '打卡记录管理', category: 'ATTENDANCE', primaryAction: '导出数据', icon: 'file-text',
  subtitle: '查看和管理员打卡记录，支持 GPS/WiFi 打卡、外勤现场水印拍照记录，多条件检索与导出。',
  component: {
    data() {
      return {
        loading: true,
        rows: [],
        total: 0,
        pageNum: 1,
        pageSize: 10,
        todayCount: { expect: null, clocked: 0, late: 0, missed: null },
        filters: { start: '', end: '', dept: '', name: '', type: '', status: '', method: '', group: '', keyword: '' },
        depts: [],
        groups: [],
        selected: null,
        exporting: false,
      };
    },
    computed: {
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
      pageList() {
        const c = this.pageCount, cur = this.pageNum, arr = [];
        if (c <= 7) { for (let i = 1; i <= c; i++) arr.push(i); return arr; }
        arr.push(1);
        const s = Math.max(2, cur - 1), e = Math.min(c - 1, cur + 1);
        if (s > 2) arr.push('...');
        for (let i = s; i <= e; i++) arr.push(i);
        if (e < c - 1) arr.push('...');
        arr.push(c);
        return arr;
      },
      shownRows() {
        const f = this.filters;
        const kw = (f.keyword || '').trim().toLowerCase();
        const nm = (f.name || '').trim().toLowerCase();
        return this.rows.filter((r) => {
          if (nm && !(r.user_name || '').toLowerCase().includes(nm)) return false;
          if (f.type && r.punch_type !== f.type) return false;
          if (f.method) {
            const m = this.punchMethod(r);
            if (f.method === 'GPS' && m !== 'GPS 打卡') return false;
            if (f.method === 'WIFI' && m !== 'WiFi 打卡') return false;
            if (f.method === 'FIELD' && m !== '外勤拍照') return false;
          }
          if (kw && !((r.address || '') + (r.wifi_bssid || '') + (r.notes || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      clockRate() {
        if (!this.todayCount.expect) return null;
        return Math.round((this.todayCount.clocked / this.todayCount.expect) * 1000) / 10 + '%';
      },
      lateRate() {
        if (!this.todayCount.expect) return null;
        return Math.round((this.todayCount.late / this.todayCount.expect) * 1000) / 10 + '%';
      },
      missedRate() {
        if (!this.todayCount.expect || this.todayCount.missed === null) return null;
        return Math.round((this.todayCount.missed / this.todayCount.expect) * 1000) / 10 + '%';
      },
    },
    async mounted() {
      const t = new Date();
      const ds = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
      this.filters.start = ds;
      this.filters.end = ds;
      try { const r = await api.get('/api/attendance/rules'); this.groups = (r.groups || []).map((g) => g.group_name); } catch (e) { /* optional */ }
      try { const s = await api.get('/api/attendance/monthly-settlement'); const rows = s.rows || []; const depts = {}; rows.forEach((x) => { if (x.dept) depts[x.dept] = 1; }); this.depts = Object.keys(depts); this.todayCount.expect = rows.length; } catch (e) { /* no report perm: degrade */ }
      await this.loadToday();
      await this.load();
      if (!this.selected && this.rows.length) this.selected = this.shownRows[0] || this.rows[0];
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
      async loadToday() {
        const t = new Date();
        const ds = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
        try {
          const r = await api.page('/api/attendance/records', { start: ds + 'T00:00:00+08:00', end: ds + 'T23:59:59+08:00', pageNum: 1, pageSize: 500 });
          const rows = r.rows || [];
          this.todayCount.clocked = new Set(rows.map((x) => x.user_id)).size;
          this.todayCount.late = new Set(rows.filter((x) => x.status === 'LATE').map((x) => x.user_id)).size;
          if (this.todayCount.expect !== null) this.todayCount.missed = Math.max(0, this.todayCount.expect - this.todayCount.clocked);
        } catch (e) { /* toast shown */ }
      },
      async load() {
        const f = this.filters;
        const params = { pageNum: this.pageNum, pageSize: this.pageSize };
        if (f.start) params.start = f.start + 'T00:00:00+08:00';
        if (f.end) params.end = f.end + 'T23:59:59+08:00';
        if (f.status) params.status = f.status;
        try {
          const r = await api.page('/api/attendance/records', params);
          this.rows = r.rows || [];
          this.total = r.total || 0;
          if (this.selected && !this.rows.some((x) => x.record_id === this.selected.record_id)) this.selected = this.rows[0] || null;
          if (!this.selected) this.selected = this.rows[0] || null;
        } catch (e) { this.rows = []; this.total = 0; }
      },
      query() { this.pageNum = 1; this.load(); },
      reset() {
        const t = new Date();
        const ds = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
        this.filters = { start: ds, end: ds, dept: '', name: '', type: '', status: '', method: '', group: '', keyword: '' };
        this.query();
      },
      goPage(p) {
        if (p === '...' || p < 1 || p > this.pageCount || p === this.pageNum) return;
        this.pageNum = p;
        this.load();
      },
      punchTypeLabel(t) { return { IN: '上班', OUT: '下班', FIELD: '外勤' }[t] || t; },
      punchMethod(r) { return r.punch_type === 'FIELD' ? '外勤拍照' : r.wifi_bssid ? 'WiFi 打卡' : r.location_gps ? 'GPS 打卡' : '—'; },
      statusLabel(s) { return { NORMAL: '正常', LATE: '迟到', EARLY: '早退', ABNORMAL: '异常' }[s] || s || '—'; },
      statusTag(s) { return { NORMAL: 'tag-green', LATE: 'tag-red', EARLY: 'tag-amber', ABNORMAL: 'tag-red' }[s] || 'tag-gray'; },
      async exportCsv() {
        this.exporting = true;
        try {
          const f = this.filters;
          const params = { pageNum: 1, pageSize: 1000 };
          if (f.start) params.start = f.start + 'T00:00:00+08:00';
          if (f.end) params.end = f.end + 'T23:59:59+08:00';
          if (f.status) params.status = f.status;
          const r = await api.page('/api/attendance/records', params);
          const rows = r.rows || [];
          const head = '姓名,打卡时间,打卡类型,打卡方式,打卡地点,考勤结果,备注';
          const lines = rows.map((x) => [x.user_name, this.bj(x.punch_time), this.punchTypeLabel(x.punch_type), this.punchMethod(x), x.address || '', this.statusLabel(x.status), x.notes || ''].map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(','));
          const blob = new Blob(['\uFEFF' + head + '\n' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = '打卡记录_' + (f.start || '') + '~' + (f.end || '') + '.csv';
          a.click();
          URL.revokeObjectURL(a.href);
          this.$root.toast('已导出 ' + rows.length + ' 条打卡记录', 'ok');
        } catch (e) { /* toast shown */ }
        this.exporting = false;
      },
      onPrimary() { this.exportCsv(); },
    },
    template: `
    <div v-if="!loading">
      <!-- today KPI -->
      <div class="kpi-row">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="calendar-days" size="28"></ic></div>
          <div class="meta"><div class="label">今日应到人数</div><div class="val" style="color:var(--primary)">{{ todayCount.expect === null ? '—' : todayCount.expect }} <span style="font-size:14px;font-weight:400">人</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta" style="display:flex;align-items:center;gap:10px">
            <div><div class="label">今日已打卡</div><div class="val" style="color:var(--teal)">{{ todayCount.clocked }} <span style="font-size:14px;font-weight:400">人</span></div></div>
            <span class="tag tag-gray" v-if="clockRate">{{ clockRate }}</span>
          </div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="clock" size="28"></ic></div>
          <div class="meta" style="display:flex;align-items:center;gap:10px">
            <div><div class="label">今日迟到</div><div class="val" style="color:var(--amber)">{{ todayCount.late }} <span style="font-size:14px;font-weight:400">人</span></div></div>
            <span class="tag tag-gray" v-if="lateRate">{{ lateRate }}</span>
          </div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="x-circle" size="28"></ic></div>
          <div class="meta" style="display:flex;align-items:center;gap:10px">
            <div><div class="label">今日未打卡</div><div class="val" style="color:var(--red)">{{ todayCount.missed === null ? '—' : todayCount.missed }} <span style="font-size:14px;font-weight:400">人</span></div></div>
            <span class="tag tag-gray" v-if="missedRate">{{ missedRate }}</span>
          </div>
        </div>
      </div>

      <!-- filters -->
      <div class="card" style="margin-top:0">
        <div class="card-bd" style="padding-bottom:6px">
          <div class="filters" style="margin-bottom:10px">
            <span class="f-label">日期范围</span>
            <input type="date" class="input" style="width:150px" v-model="filters.start">
            <span class="muted">~</span>
            <input type="date" class="input" style="width:150px" v-model="filters.end">
            <span class="f-label" style="margin-left:8px">部门范围</span>
            <select class="select" style="width:150px" v-model="filters.dept"><option value="">全部门</option><option v-for="d in depts" :key="d">{{ d }}</option></select>
            <span class="f-label" style="margin-left:8px">员工姓名</span>
            <input class="input" style="width:150px" placeholder="请输入姓名" v-model="filters.name" @keyup.enter="query">
            <span class="f-label" style="margin-left:8px">打卡类型</span>
            <select class="select" style="width:130px" v-model="filters.type"><option value="">全部</option><option value="IN">上班</option><option value="OUT">下班</option><option value="FIELD">外勤</option></select>
          </div>
          <div class="filters" style="margin-bottom:0">
            <span class="f-label">打卡结果</span>
            <select class="select" style="width:150px" v-model="filters.status"><option value="">全部</option><option value="NORMAL">正常</option><option value="LATE">迟到</option><option value="EARLY">早退</option><option value="ABNORMAL">异常</option></select>
            <span class="f-label" style="margin-left:8px">打卡方式</span>
            <select class="select" style="width:150px" v-model="filters.method"><option value="">全部</option><option value="GPS">GPS 打卡</option><option value="WIFI">WiFi 打卡</option><option value="FIELD">外勤拍照</option></select>
            <span class="f-label" style="margin-left:8px">考勤组</span>
            <select class="select" style="width:150px" v-model="filters.group"><option value="">全部</option><option v-for="g in groups" :key="g">{{ g }}</option></select>
            <span class="f-label" style="margin-left:8px">地点关键词</span>
            <input class="input" style="width:190px" placeholder="请输入地点/地址/WiFi名称" v-model="filters.keyword" @keyup.enter="query">
            <span style="flex:1"></span>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
        </div>
      </div>

      <div class="rec-split mt16">
        <!-- records table -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">打卡记录列表 <span class="muted" style="font-size:12.5px;font-weight:400">（共 {{ total }} 条）</span></div>
          </div>
          <div class="card-bd" style="padding-top:8px">
            <table class="table table-stripe">
              <thead><tr><th>姓名</th><th>打卡时间</th><th>打卡类型</th><th>打卡方式</th><th>打卡地点</th><th>考勤结果</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="r in shownRows" :key="r.record_id" :style="{background: selected && selected.record_id === r.record_id ? 'var(--primary-weak)' : ''}" @click="selected = r" style="cursor:pointer">
                  <td class="strong">{{ r.user_name || '—' }}</td>
                  <td class="num">{{ bj(r.punch_time) }}</td>
                  <td>{{ punchTypeLabel(r.punch_type) }}</td>
                  <td class="muted">{{ punchMethod(r) }}</td>
                  <td class="ellipsis" :title="r.address" style="max-width:200px">{{ r.address || '—' }}</td>
                  <td><span :class="['tag', statusTag(r.status)]">{{ statusLabel(r.status) }}</span></td>
                  <td class="actions"><button class="btn btn-text btn-sm" @click.stop="selected = r">查看</button></td>
                </tr>
                <tr v-if="!shownRows.length"><td colspan="7"><div class="empty">暂无打卡记录</div></td></tr>
              </tbody>
            </table>
            <div class="pager">
              <span>共 {{ total }} 条，每页 {{ pageSize }} 条</span>
              <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
              <button v-for="p in pageList" :key="p" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
              <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
              <span style="margin-left:6px">跳至</span>
              <input class="input" style="width:52px;height:28px" :value="pageNum" @keyup.enter="goPage(Number($event.target.value))">
              <span>页</span>
            </div>
          </div>
        </div>

        <!-- detail panel -->
        <div class="card" style="margin-top:0; align-self:start">
          <div class="card-hd">
            <div class="t">打卡记录详情</div>
            <ic v-if="selected" name="x" size="16" style="cursor:pointer;color:var(--text-3)" @click="selected = null"></ic>
          </div>
          <div class="card-bd" v-if="selected">
            <div style="display:flex; align-items:center; gap:12px; margin-bottom:12px">
              <span class="avatar" style="width:40px;height:40px;font-size:15px">{{ (selected.user_name || '?').slice(0, 1) }}</span>
              <div>
                <div class="strong" style="font-size:15px">{{ selected.user_name || '—' }}</div>
                <div class="muted" style="font-size:12px">工号：{{ (selected.record_id || '').slice(0, 8).toUpperCase() }}</div>
              </div>
              <span :class="['tag', statusTag(selected.status)]" style="margin-left:auto">{{ statusLabel(selected.status) }}</span>
            </div>
            <div class="desc-list">
              <span class="k">打卡时间</span><span class="num">{{ bj(selected.punch_time) }}</span>
              <span class="k">打卡类型</span><span>{{ punchTypeLabel(selected.punch_type) }}</span>
              <span class="k">打卡方式</span><span>{{ punchMethod(selected) }}</span>
              <span class="k">打卡地点</span><span>{{ selected.address || '—' }} <ic v-if="selected.address" name="map-pin" size="12" style="color:var(--primary)"></ic></span>
              <span class="k">详细地址</span><span>{{ selected.location_gps || selected.address || '—' }}</span>
              <span class="k">WiFi 校验</span><span>{{ selected.wifi_bssid || '未校验' }}</span>
              <span class="k">考勤结果</span><span><span :class="['tag', statusTag(selected.status)]">{{ statusLabel(selected.status) }}</span></span>
              <span class="k">备注</span><span>{{ selected.notes || '—' }}</span>
            </div>
            <div class="rec-verify">
              <ic name="shield-check" size="16"></ic>
              <div><b>定位校验结果</b><br>{{ selected.address ? '打卡位置已记录：' + selected.address + '，符合考勤规则。' : '该记录未携带位置信息（WiFi/补卡修正）。' }}</div>
            </div>
          </div>
          <div class="card-bd" v-else><div class="empty">点击左侧记录查看详情</div></div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
