/* /conference/bookings 预订管理与审批 — pixel replica of design/mockups/033-conference-bookings.png
   Layout: 4 KPI / filters + bookings table + pager / 快速预订 modal（预检 -> 创建）+ 详情 modal */
AppPages['/conference/bookings'] = {
  route: '/conference/bookings', title: '预订管理与审批', category: 'CONFERENCE', primaryAction: '快速预订会议室', icon: 'calendar-check-2',
  subtitle: '支持会议室快速预订、冲突预检与审批流程管理，保障重要会议顺利召开。',
  component: {
    data() {
      return {
        loading: true,
        all: [],
        rooms: [],
        filters: { date: '', status: '', room_id: '', keyword: '' },
        pageNum: 1,
        pageSize: 10,
        showBook: false,
        submitting: false,
        checking: false,
        checkResult: null,
        detail: null,
        form: { title: '', room_id: '', date: '', start: '09:00', end: '11:00', attendee_count: 10, host_name: '' },
      };
    },
    computed: {
      filtered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        return this.all.filter((b) => {
          if (this.filters.status && b.status !== this.filters.status) return false;
          if (this.filters.room_id && b.room_id !== this.filters.room_id) return false;
          if (this.filters.date && this.bjDate(b.start_time) !== this.filters.date && this.bjDate(b.end_time) !== this.filters.date) return false;
          if (kw && !((b.title || '') + (b.user_name || '') + (b.room_name || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      pageTotal() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      todayStr() {
        const d = new Date(Date.now() + (480 + new Date().getTimezoneOffset()) * 60000);
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      },
      todayCount() { return this.all.filter((b) => b.status !== 'CANCELLED' && (this.bjDate(b.start_time) === this.todayStr || this.bjDate(b.end_time) === this.todayStr)).length; },
      pendingCount() { return this.all.filter((b) => b.status === 'PENDING_APPROVAL').length; },
      weekAttendees() {
        const now = new Date(this.todayStr + 'T00:00:00');
        const week = new Date(now.getTime() + 7 * 86400000);
        return this.all.filter((b) => {
          if (b.status === 'CANCELLED') return false;
          const d = new Date(this.bjDate(b.start_time) + 'T00:00:00');
          return d >= now && d < week;
        }).reduce((s, b) => s + (Number(b.attendee_count) || 0), 0);
      },
      conflictCount() {
        const today = this.all.filter((b) => b.status !== 'CANCELLED' && (this.bjDate(b.start_time) === this.todayStr));
        let n = 0;
        const byRoom = {};
        today.forEach((b) => { (byRoom[b.room_id] = byRoom[b.room_id] || []).push(b); });
        Object.values(byRoom).forEach((list) => {
          for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
            if (list[i].start_time < list[j].end_time && list[j].start_time < list[i].end_time) n++;
          }
        });
        return n;
      },
      pickRoom() { return this.rooms.find((r) => r.room_id === this.form.room_id) || null; },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      bj(s) { return s ? String(s).slice(0, 16).replace('T', ' ') : '—'; },
      bjDate(s) { const v = this.bj(s); return v === '—' ? '' : v.slice(0, 10); },
      async load() {
        try {
          const r = await api.page('/api/conference/bookings', { pageNum: 1, pageSize: 300 });
          this.all = r.rows || [];
        } catch (e) { this.all = []; }
        try {
          const rr = await api.page('/api/conference/rooms', { pageNum: 1, pageSize: 100 });
          this.rooms = (rr.rows || []).filter((x) => x.status === 'AVAILABLE');
        } catch (e) { this.rooms = []; }
      },
      statusTag(s) { return { CONFIRMED: 'tag-green', PENDING_APPROVAL: 'tag-amber', CANCELLED: 'tag-gray' }[s] || 'tag-gray'; },
      query() { this.pageNum = 1; },
      reset() { this.filters = { date: '', status: '', room_id: '', keyword: '' }; this.query(); },
      goPage(p) { if (p >= 1 && p <= this.pageCount) this.pageNum = p; },
      openBook() {
        this.form = { title: '', room_id: (this.rooms[0] || {}).room_id || '', date: this.todayStr, start: '09:00', end: '11:00', attendee_count: 10, host_name: '' };
        this.checkResult = null;
        this.showBook = true;
      },
      async preCheck() {
        const f = this.form;
        if (!f.room_id) return this.$root.toast('请选择会议室', 'warn');
        if (!f.date || !f.start || !f.end) return this.$root.toast('请选择会议日期与起止时间', 'warn');
        if (f.end <= f.start) return this.$root.toast('结束时间必须晚于开始时间', 'warn');
        this.checking = true;
        this.checkResult = null;
        try {
          const res = await api.post('/api/conference/bookings/check', {
            room_id: f.room_id,
            start_time: f.date + 'T' + f.start + ':00',
            end_time: f.date + 'T' + f.end + ':00',
          });
          this.checkResult = res;
        } catch (e) { /* toast shown */ }
        this.checking = false;
      },
      async submitBook() {
        const f = this.form;
        if (!f.title.trim()) return this.$root.toast('请填写会议名称', 'warn');
        if (!f.room_id) return this.$root.toast('请选择会议室', 'warn');
        if (!f.date || !f.start || !f.end) return this.$root.toast('请选择会议日期与起止时间', 'warn');
        if (f.end <= f.start) return this.$root.toast('结束时间必须晚于开始时间', 'warn');
        if (!f.attendee_count || f.attendee_count < 1) return this.$root.toast('请填写参会人数', 'warn');
        this.submitting = true;
        try {
          const check = await api.post('/api/conference/bookings/check', {
            room_id: f.room_id,
            start_time: f.date + 'T' + f.start + ':00',
            end_time: f.date + 'T' + f.end + ':00',
          });
          if (check.conflict) {
            this.checkResult = check;
            this.$root.toast('时段冲突：' + (check.conflict_title || '已被占用'), 'err');
            this.submitting = false;
            return;
          }
          await api.post('/api/conference/bookings', {
            room_id: f.room_id, title: f.title.trim(),
            start_time: f.date + 'T' + f.start + ':00', end_time: f.date + 'T' + f.end + ':00',
            attendee_count: Number(f.attendee_count) || 1, host_name: (f.host_name || '').trim() || undefined,
          });
          this.$root.toast('会议室预订成功', 'ok');
          this.showBook = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async approve(b) {
        if (!window.confirm('确认通过该预订审批？通过后将正式占用该时段。')) return;
        try {
          await api.post('/api/conference/bookings/' + b.booking_id + '/approve', {});
          this.$root.toast('审批通过', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      async cancelBooking(b) {
        if (!window.confirm('确认取消该预订？')) return;
        try {
          await api.post('/api/conference/bookings/' + b.booking_id + '/cancel', {});
          this.$root.toast('预订已取消', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      durationText(b) {
        const s = new Date(b.start_time), e = new Date(b.end_time);
        const m = Math.max(0, Math.round((e - s) / 60000));
        const h = Math.floor(m / 60), mm = m % 60;
        return (h ? h + ' 小时' : '') + (mm ? (h ? ' ' : '') + mm + ' 分钟' : (h ? '' : '0 分钟'));
      },
      onPrimary() { this.openBook(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="calendar-check-2" size="28"></ic></div>
          <div class="meta"><div class="label">今日会议预订</div><div class="val" style="color:var(--primary)">{{ todayCount }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">场</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta"><div class="label">待审批预订</div><div class="val" style="color:var(--teal)">{{ pendingCount }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">场</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="users" size="28"></ic></div>
          <div class="meta"><div class="label">本周参会人数</div><div class="val" style="color:var(--amber)">{{ weekAttendees }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">人</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="siren" size="28"></ic></div>
          <div class="meta"><div class="label">冲突预警</div><div class="val" style="color:var(--red)">{{ conflictCount }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">条 · 需协调处理</span></div></div>
        </div>
      </div>

      <!-- list -->
      <div class="card mt16">
        <div class="card-hd"><div class="t">会议预订列表</div><span class="muted" style="font-size:12px">共 {{ pageTotal }} 条</span></div>
        <div class="card-bd" style="padding-top:10px">
          <div class="filters">
            <input type="date" class="input" style="width:150px" v-model="filters.date" @change="query">
            <select class="select" style="width:170px" v-model="filters.room_id" @change="query">
              <option value="">全部会议室</option>
              <option v-for="r in rooms" :key="r.room_id" :value="r.room_id">{{ r.name }}</option>
            </select>
            <select class="select" style="width:130px" v-model="filters.status" @change="query">
              <option value="">全部状态</option>
              <option value="CONFIRMED">已确认</option>
              <option value="PENDING_APPROVAL">待审批</option>
              <option value="CANCELLED">已取消</option>
            </select>
            <input class="input" style="flex:1; min-width:180px" placeholder="请输入会议名称、申请人或会议室" v-model="filters.keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr><th>会议名称</th><th>日期时间</th><th>会议室</th><th>申请人</th><th style="width:80px">参会人数</th><th style="width:100px">审批状态</th><th style="width:170px">操作</th></tr></thead>
            <tbody>
              <tr v-for="b in shownRows" :key="b.booking_id">
                <td class="strong ell" style="max-width:220px" :title="b.title">{{ b.title }}</td>
                <td class="num muted">{{ bj(b.start_time) }} ~ {{ bj(b.end_time).slice(11) }}</td>
                <td>{{ b.room_name || '—' }}</td>
                <td>{{ b.user_name || b.host_name || '—' }}</td>
                <td class="num">{{ b.attendee_count }} 人</td>
                <td><span :class="['tag', statusTag(b.status)]">{{ b.status_label }}</span></td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="detail = b">查看</button>
                  <button v-if="b.status === 'PENDING_APPROVAL'" class="btn btn-text btn-sm" @click="approve(b)">通过</button>
                  <button v-if="b.status !== 'CANCELLED'" class="btn btn-text btn-sm danger" @click="cancelBooking(b)">取消预订</button>
                </td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="7"><div class="empty">暂无会议预订</div></td></tr>
            </tbody>
          </table>
          <div class="pager" v-if="pageCount > 1">
            <span>共 {{ pageTotal }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in pageCount" :key="p" class="pg" :class="{ on: p === pageNum }" @click="goPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
      </div>

      <!-- quick booking modal -->
      <Modal title="快速预订会议室" width="560px" v-if="showBook" @close="showBook = false">
        <div class="form-item">
          <label class="req">会议名称</label>
          <input class="input" placeholder="请输入会议名称" v-model="form.title">
        </div>
        <div class="form-item">
          <label class="req">会议室</label>
          <select class="select" v-model="form.room_id">
            <option v-for="r in rooms" :key="r.room_id" :value="r.room_id">{{ r.name }}（{{ r.location }} · {{ r.capacity }}人）</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">会议时间</label>
          <div style="flex:1; display:flex; align-items:center; gap:8px">
            <input type="date" class="input" style="flex:1" v-model="form.date">
            <input type="time" class="input" style="width:104px" v-model="form.start">
            <span class="muted">~</span>
            <input type="time" class="input" style="width:104px" v-model="form.end">
          </div>
        </div>
        <div class="form-item">
          <label class="req">参会人数</label>
          <input type="number" class="input" style="width:120px" min="1" v-model="form.attendee_count">
          <span class="muted" style="padding-top:8px" v-if="pickRoom">会议室容量 {{ pickRoom.capacity }} 人</span>
        </div>
        <div class="form-item">
          <label>主持人</label>
          <input class="input" placeholder="默认为当前用户" v-model="form.host_name">
        </div>
        <div v-if="checkResult" class="bk-result" :class="checkResult.conflict ? 'bad' : 'ok'">
          <ic :name="checkResult.conflict ? 'siren' : 'check-circle-2'" size="15"></ic>
          <b>冲突预检结果：{{ checkResult.conflict ? '时段冲突' : '时段可用' }}</b>
          <div style="margin-top:2px">{{ checkResult.conflict ? '该时段已被「' + (checkResult.conflict_title || '其他会议') + '」占用，请调整时间或更换会议室。' : '所选时间段暂无与其他会议冲突，可正常预订。' }}</div>
        </div>
        <template #footer>
          <button class="btn btn-ghost" :disabled="checking" @click="preCheck"><ic name="scan-search" size="14"></ic>冲突预检</button>
          <button class="btn btn-ghost" @click="showBook = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting || checking" @click="submitBook">提交预订</button>
        </template>
      </Modal>

      <!-- detail modal -->
      <Modal title="会议预订详情" width="500px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">会议名称</span><span class="strong">{{ detail.title }}</span>
          <span class="k">会议室</span><span>{{ detail.room_name || '—' }}</span>
          <span class="k">会议时间</span><span class="num">{{ bj(detail.start_time) }} ~ {{ bj(detail.end_time) }}</span>
          <span class="k">会议时长</span><span>{{ durationText(detail) }}</span>
          <span class="k">申请人</span><span>{{ detail.user_name || '—' }}</span>
          <span class="k">主持人</span><span>{{ detail.host_name || '—' }}</span>
          <span class="k">参会人数</span><span>{{ detail.attendee_count }} 人</span>
          <span class="k">审批状态</span><span><span :class="['tag', statusTag(detail.status)]">{{ detail.status_label }}</span></span>
          <span class="k">预订时间</span><span class="num">{{ bj(detail.created_at) }}</span>
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
