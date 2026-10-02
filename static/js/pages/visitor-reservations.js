/* /visitor/reservations 访客预约审核 — pixel replica of design/mockups/048-visitor-reservations.png
   Layout: 4 KPI / status tabs + filters + appointments table + pager / audit actions + 新增预约 modal */
AppPages['/visitor/reservations'] = {
  route: '/visitor/reservations', title: '访客预约审核', category: 'VISITOR', primaryAction: '新增访客预约', icon: 'clipboard-list',
  subtitle: '访客预约需经受访人确认与保卫处审核两级把关，审核通过后系统自动发放访客通行码。',
  component: {
    data() {
      return {
        loading: true,
        list: [],
        tab: '',
        filters: { keyword: '', date: '' },
        pageNum: 1,
        pageSize: 10,
        employees: [],
        showAdd: false,
        submitting: false,
        detail: null,
        form: { visitor_name: '', visitor_phone: '', id_card_number: '', company: '', car_plate: '', visit_reason: '', host_user_id: '', start_time: '', end_time: '' },
      };
    },
    computed: {
      counts() {
        const c = { '': this.list.length, PENDING_HOST: 0, PENDING_SECURITY: 0, APPROVED: 0, REJECTED: 0 };
        this.list.forEach((a) => { if (c[a.status] !== undefined) c[a.status]++; });
        return c;
      },
      todayStr() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      },
      weekRange() {
        const d = new Date();
        const day = (d.getDay() + 6) % 7;
        const f = (x) => x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0');
        const s = new Date(d.getFullYear(), d.getMonth(), d.getDate() - day);
        const e = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 6);
        return [f(s), f(e)];
      },
      kpiToday() { return this.list.filter((a) => this.bjDate(a.scheduled_start) === this.todayStr); },
      kpiWeek() {
        const [ws, we] = this.weekRange;
        return this.list.filter((a) => this.bjDate(a.scheduled_start) >= ws && this.bjDate(a.scheduled_start) <= we);
      },
      filtered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        return this.list.filter((a) => {
          if (this.tab && a.status !== this.tab) return false;
          if (this.filters.date && this.bjDate(a.scheduled_start) !== this.filters.date) return false;
          if (kw && !((a.visitor_name || '') + (a.visitor_phone || '') + (a.company || '') + (a.visit_reason || '') + (a.host_name || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      pageTotal() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
    },
    async mounted() {
      await this.load();
      this.loadEmployees();
      this.loading = false;
    },
    methods: {
      async load() {
        try {
          const r = await api.page('/api/visitor/appointments', { pageNum: 1, pageSize: 200 });
          this.list = r.rows || [];
        } catch (e) { this.list = []; }
      },
      async loadEmployees() {
        try {
          const r = await api.page('/api/contacts/employees', { pageNum: 1, pageSize: 200, status: '0' });
          this.employees = r.rows || [];
        } catch (e) { this.employees = []; }
      },
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
      },
      bjDate(s) { const v = this.bj(s); return v === '—' ? '' : v.slice(0, 10); },
      dt(v) { return v && v.length === 16 ? v + ':00+08:00' : v; },
      statusLabel(s) { return { PENDING_HOST: '受访人待确认', PENDING_SECURITY: '保卫处待审核', APPROVED: '已发放通行码', CHECKED_IN: '在院访问中', CHECKED_OUT: '已离场', REJECTED: '已驳回', OVERDUE_STAY: '滞留告警' }[s] || s; },
      statusTag(s) { return { PENDING_HOST: 'tag-amber', PENDING_SECURITY: 'tag-amber', APPROVED: 'tag-blue', CHECKED_IN: 'tag-green', CHECKED_OUT: 'tag-gray', REJECTED: 'tag-red', OVERDUE_STAY: 'tag-red' }[s] || 'tag-gray'; },
      maskPhone(p) { return p && p.length >= 7 ? p.slice(0, 3) + '****' + p.slice(-4) : (p || '—'); },
      setTab(t) { this.tab = t; this.pageNum = 1; },
      query() { this.pageNum = 1; },
      reset() { this.filters = { keyword: '', date: '' }; this.query(); },
      goPage(p) {
        if (p === '...' || p < 1 || p > this.pageCount) return;
        this.pageNum = p;
      },
      async audit(a, action) {
        const tip = action === 'APPROVE'
          ? (a.status === 'PENDING_HOST' ? '确认接待访客 ' + a.visitor_name + ' 并提交保卫处审核？' : '确认通过保卫处审核，向访客 ' + a.visitor_name + ' 发放通行码？')
          : '确认驳回访客 ' + a.visitor_name + ' 的预约申请？';
        if (!window.confirm(tip)) return;
        try {
          await api.post('/api/visitor/appointments/' + a.appointment_id + '/audit', { action, reason: action === 'APPROVE' ? '' : '不符合来访条件' });
          this.$root.toast(action === 'APPROVE' ? (a.status === 'PENDING_HOST' ? '已确认，待保卫处审核' : '审核通过，通行码已发放') : '已驳回该预约', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      openAdd() {
        const me = api.cachedUser();
        this.form = { visitor_name: '', visitor_phone: '', id_card_number: '', company: '', car_plate: '', visit_reason: '', host_user_id: (me && me.user_id) || '', start_time: '', end_time: '' };
        this.showAdd = true;
      },
      async submitAdd() {
        const f = this.form;
        if (!f.visitor_name.trim()) return this.$root.toast('请填写访客姓名', 'warn');
        if (!f.visitor_phone.trim()) return this.$root.toast('请填写访客联系电话', 'warn');
        if (!f.visit_reason.trim()) return this.$root.toast('请填写来访事由', 'warn');
        if (!f.host_user_id) return this.$root.toast('请选择受访人', 'warn');
        if (!f.start_time || !f.end_time) return this.$root.toast('请选择预约到达与离开时间', 'warn');
        if (f.end_time <= f.start_time) return this.$root.toast('离开时间必须晚于到达时间', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/visitor/appointments', {
            visitor_name: f.visitor_name.trim(),
            visitor_phone: f.visitor_phone.trim(),
            id_card_number: f.id_card_number.trim(),
            company: f.company.trim(),
            car_plate: f.car_plate.trim(),
            visit_reason: f.visit_reason.trim(),
            host_user_id: f.host_user_id,
            scheduled_start: this.dt(f.start_time),
            scheduled_end: this.dt(f.end_time),
          });
          this.$root.toast('预约已提交，等待受访人确认', 'ok');
          this.showAdd = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      onPrimary() { this.openAdd(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" @click="setTab('PENDING_HOST')">
          <div class="ico ico-blue"><ic name="clipboard-list" size="28"></ic></div>
          <div class="meta">
            <div class="label">待我处理</div>
            <div class="val" style="color:var(--primary)">{{ counts.PENDING_HOST + counts.PENDING_SECURITY }}</div>
            <div class="muted" style="font-size:12px">受访人确认 {{ counts.PENDING_HOST }} ｜ 保卫处审核 {{ counts.PENDING_SECURITY }}</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-teal"><ic name="calendar-check-2" size="28"></ic></div>
          <div class="meta">
            <div class="label">今日到访</div>
            <div class="val" style="color:var(--teal)">{{ kpiToday.length }}</div>
            <div class="muted" style="font-size:12px">已入场 {{ kpiToday.filter(a => a.status === 'CHECKED_IN' || a.status === 'CHECKED_OUT').length }} ｜ 待入场 {{ kpiToday.filter(a => a.status === 'APPROVED').length }}</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-amber"><ic name="clock" size="28"></ic></div>
          <div class="meta">
            <div class="label">本周预约</div>
            <div class="val" style="color:var(--amber)">{{ kpiWeek.length }}</div>
            <div class="muted" style="font-size:12px">其中待审核 {{ kpiWeek.filter(a => a.status === 'PENDING_HOST' || a.status === 'PENDING_SECURITY').length }} 单</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="setTab('REJECTED')">
          <div class="ico ico-red"><ic name="siren" size="28"></ic></div>
          <div class="meta">
            <div class="label">安防预警</div>
            <div class="val" style="color:var(--red)">{{ counts.REJECTED }}</div>
            <div class="muted" style="font-size:12px">已驳回 {{ counts.REJECTED }} ｜ 黑名单自动拦截</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <!-- appointments -->
      <div class="card">
        <div class="card-bd" style="padding-top:4px">
          <div class="lr-tabs" style="margin:0 0 12px">
            <span :class="['lr-tab', tab === '' ? 'on' : '']" @click="setTab('')">全部申请 ({{ counts[''] }})</span>
            <span :class="['lr-tab', tab === 'PENDING_HOST' ? 'on' : '']" @click="setTab('PENDING_HOST')">受访人确认 ({{ counts.PENDING_HOST }})</span>
            <span :class="['lr-tab', tab === 'PENDING_SECURITY' ? 'on' : '']" @click="setTab('PENDING_SECURITY')">保卫处审核 ({{ counts.PENDING_SECURITY }})</span>
            <span :class="['lr-tab', tab === 'APPROVED' ? 'on' : '']" @click="setTab('APPROVED')">已发放通行码 ({{ counts.APPROVED }})</span>
            <span :class="['lr-tab', tab === 'REJECTED' ? 'on' : '']" @click="setTab('REJECTED')">已驳回 ({{ counts.REJECTED }})</span>
          </div>
          <div class="filters">
            <input type="date" class="input" style="width:150px" v-model="filters.date" @change="query">
            <input class="input" style="width:200px" placeholder="请输入访客姓名、单位等" v-model="filters.keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr><th>访客姓名</th><th>来访单位</th><th>来访事由</th><th>受访人</th><th>预约时间</th><th>车牌号</th><th>当前状态</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="a in shownRows" :key="a.appointment_id">
                <td class="strong">{{ a.visitor_name }}<div class="muted" style="font-size:12px">{{ maskPhone(a.visitor_phone) }}</div></td>
                <td>{{ a.company || '—' }}</td>
                <td class="ellipsis" style="max-width:170px">{{ a.visit_reason }}</td>
                <td>{{ a.host_name || '—' }}</td>
                <td class="num muted">{{ bjDate(a.scheduled_start) }} {{ bj(a.scheduled_start).slice(11, 16) }} ~ {{ bj(a.scheduled_end).slice(11, 16) }}</td>
                <td class="num">{{ a.car_plate || '—' }}</td>
                <td><span :class="['tag', statusTag(a.status)]">{{ statusLabel(a.status) }}</span></td>
                <td class="actions">
                  <button v-if="a.status === 'PENDING_HOST'" class="btn btn-primary btn-sm" @click="audit(a, 'APPROVE')">受访人确认</button>
                  <button v-if="a.status === 'PENDING_SECURITY'" class="btn btn-primary btn-sm" @click="audit(a, 'APPROVE')">保卫处审核</button>
                  <button v-if="a.status === 'PENDING_HOST' || a.status === 'PENDING_SECURITY'" class="btn btn-text btn-sm danger" @click="audit(a, 'REJECT')">驳回</button>
                  <button class="btn btn-text btn-sm" @click="detail = a">查看</button>
                </td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="8"><div class="empty">暂无访客预约申请</div></td></tr>
            </tbody>
          </table>
          <div class="pager" v-if="pageCount > 1">
            <span>共 {{ pageTotal }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in pageCount" :key="p" v-show="pageCount <= 7 || p === 1 || p === pageCount || Math.abs(p - pageNum) <= 1" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
      </div>

      <!-- add modal -->
      <Modal title="新增访客预约" width="600px" v-if="showAdd" @close="showAdd = false">
        <div class="ast-form-grid">
          <div class="form-item">
            <label class="req">访客姓名</label>
            <input class="input" placeholder="请输入访客姓名" v-model="form.visitor_name">
          </div>
          <div class="form-item">
            <label class="req">联系电话</label>
            <input class="input" placeholder="请输入访客手机号" v-model="form.visitor_phone">
          </div>
          <div class="form-item">
            <label>身份证号</label>
            <input class="input" placeholder="选填，用于黑名单比对" v-model="form.id_card_number">
          </div>
          <div class="form-item">
            <label>来访单位</label>
            <input class="input" placeholder="请输入来访单位" v-model="form.company">
          </div>
          <div class="form-item">
            <label>车牌号</label>
            <input class="input" placeholder="自驾来访请填车牌（选填）" v-model="form.car_plate">
          </div>
          <div class="form-item">
            <label class="req">受访人</label>
            <select class="select" v-model="form.host_user_id">
              <option value="" disabled>请选择受访员工</option>
              <option v-for="e in employees" :key="e.user_id" :value="e.user_id">{{ e.nick_name }}（{{ e.dept_name || '—' }}）</option>
            </select>
          </div>
        </div>
        <div class="form-item">
          <label class="req">来访事由</label>
          <input class="input" placeholder="如：商务洽谈、项目交流、设备演示" v-model="form.visit_reason">
        </div>
        <div class="form-item">
          <label class="req">预约时间</label>
          <div style="flex:1; display:flex; align-items:center; gap:8px">
            <input type="datetime-local" class="input" v-model="form.start_time">
            <span class="muted">~</span>
            <input type="datetime-local" class="input" v-model="form.end_time">
          </div>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showAdd = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitAdd">提交预约</button>
        </template>
      </Modal>

      <!-- detail modal -->
      <Modal title="访客预约详情" width="540px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">访客姓名</span><span class="strong">{{ detail.visitor_name }}</span>
          <span class="k">联系电话</span><span class="num">{{ detail.visitor_phone || '—' }}</span>
          <span class="k">身份证号</span><span class="num">{{ detail.id_card_number || '—' }}</span>
          <span class="k">来访单位</span><span>{{ detail.company || '—' }}</span>
          <span class="k">车牌号</span><span class="num">{{ detail.car_plate || '—' }}</span>
          <span class="k">来访事由</span><span>{{ detail.visit_reason }}</span>
          <span class="k">受访人</span><span>{{ detail.host_name || '—' }}</span>
          <span class="k">预约时间</span><span class="num">{{ bj(detail.scheduled_start) }} ~ {{ bj(detail.scheduled_end) }}</span>
          <span class="k">当前状态</span><span><span :class="['tag', statusTag(detail.status)]">{{ statusLabel(detail.status) }}</span></span>
          <span class="k">通行码</span><span v-if="detail.access_code"><span class="v-code">{{ detail.access_code }}</span> <span class="muted" style="font-size:12px">（{{ detail.status === 'APPROVED' ? '已发放' : '审核通过后生效' }}）</span></span><span v-else>—</span>
          <span class="k">通行区域</span><span class="num">{{ detail.pass_floor_permit || '—' }}</span>
          <span class="k">入场时间</span><span class="num">{{ detail.check_in_time ? bj(detail.check_in_time) : '—' }}</span>
          <span class="k">离场时间</span><span class="num">{{ detail.check_out_time ? bj(detail.check_out_time) : '—' }}</span>
          <span class="k">提交时间</span><span class="num">{{ bj(detail.created_at) }}</span>
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
