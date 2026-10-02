/* /conference/attendees 参会人员与报名回执 — pixel replica of design/mockups/035-conference-attendees.png
   Layout: 4 KPI / (回执情况统计 donut | 会议信息) / 回执列表 table + 编辑回执 modal + 添加参会人 modal */
AppPages['/conference/attendees'] = {
  route: '/conference/attendees', title: '参会人员与报名回执', category: 'CONFERENCE', primaryAction: '添加参会人', icon: 'user-check',
  subtitle: '登记参会人员、收集报名回执并支持代会与代签到，确保会议组织有序。',
  component: {
    data() {
      return {
        loading: true,
        affairs: [],
        affairId: '',
        attendees: [],
        filters: { keyword: '', status: '' },
        pageNum: 1,
        pageSize: 10,
        showAdd: false,
        showEdit: false,
        submitting: false,
        editing: null,
        addForm: { name: '', dept_name: '', post_name: '', attendance_status: 'CONFIRMED', deputy_name: '' },
        editForm: { attendance_status: 'CONFIRMED', deputy_name: '' },
      };
    },
    computed: {
      affair() { return this.affairs.find((a) => a.affair_id === this.affairId) || null; },
      filtered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        return this.attendees.filter((a) => {
          if (this.filters.status && a.attendance_status !== this.filters.status) return false;
          if (kw && !((a.name || '') + (a.dept_name || '') + (a.post_name || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      pageTotal() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      stat() {
        const s = { total: this.attendees.length, CONFIRMED: 0, LEAVE: 0, DEPUTY: 0, signed: 0 };
        this.attendees.forEach((a) => {
          if (s[a.attendance_status] !== undefined) s[a.attendance_status]++;
          if (a.sign_in_time) s.signed++;
        });
        return s;
      },
      ratePct() { return this.stat.total ? Math.round(this.stat.CONFIRMED / this.stat.total * 1000) / 10 : 0; },
      leavePct() { return this.stat.total ? Math.round(this.stat.LEAVE / this.stat.total * 1000) / 10 : 0; },
      deputyPct() { return this.stat.total ? Math.round(this.stat.DEPUTY / this.stat.total * 1000) / 10 : 0; },
      nonePct() {
        const n = Math.max(0, this.stat.total - this.stat.CONFIRMED - this.stat.LEAVE - this.stat.DEPUTY);
        return this.stat.total ? Math.round(n / this.stat.total * 1000) / 10 : 0;
      },
      donutStyle() {
        const total = this.stat.total || 1;
        const parts = [
          { val: this.stat.CONFIRMED, color: '#13A89E' },
          { val: this.stat.LEAVE, color: '#E5484D' },
          { val: this.stat.DEPUTY, color: '#F59E0B' },
          { val: Math.max(0, total - this.stat.CONFIRMED - this.stat.LEAVE - this.stat.DEPUTY), color: '#CBD5E1' },
        ];
        let acc = 0; const stops = [];
        parts.forEach((p) => {
          const from = acc / total * 100; acc += p.val; const to = acc / total * 100;
          stops.push(p.color + ' ' + from.toFixed(2) + '% ' + to.toFixed(2) + '%');
        });
        return { background: 'conic-gradient(' + stops.join(', ') + ')' };
      },
    },
    async mounted() {
      try {
        const r = await api.page('/api/conference/affairs', { pageNum: 1, pageSize: 100 });
        this.affairs = r.rows || [];
      } catch (e) { this.affairs = []; }
      if (this.affairs.length) {
        this.affairId = this.affairs[0].affair_id;
        await this.loadAttendees();
      }
      this.loading = false;
    },
    methods: {
      bj(s) { return s ? String(s).slice(0, 16).replace('T', ' ') : '—'; },
      async loadAttendees() {
        this.attendees = [];
        if (!this.affairId) return;
        try { this.attendees = await api.get('/api/conference/attendees', { affair_id: this.affairId }); } catch (e) { this.attendees = []; }
        this.pageNum = 1;
      },
      onAffairChange() { this.loadAttendees(); },
      statusTag(s) { return { CONFIRMED: 'tag-green', LEAVE: 'tag-amber', DEPUTY: 'tag-blue' }[s] || 'tag-gray'; },
      statusLabel(s) { return { CONFIRMED: '确认参会', LEAVE: '请假', DEPUTY: '代会' }[s] || s; },
      query() { this.pageNum = 1; },
      reset() { this.filters = { keyword: '', status: '' }; this.query(); },
      goPage(p) { if (p >= 1 && p <= this.pageCount) this.pageNum = p; },
      openAdd() {
        this.addForm = { name: '', dept_name: '', post_name: '', attendance_status: 'CONFIRMED', deputy_name: '' };
        this.showAdd = true;
      },
      async submitAdd() {
        if (!this.affairId) return this.$root.toast('请先选择会务统筹单', 'warn');
        const f = this.addForm;
        if (!f.name.trim()) return this.$root.toast('请填写参会人姓名', 'warn');
        if (f.attendance_status === 'DEPUTY' && !f.deputy_name.trim()) return this.$root.toast('代会回执必须填写代会人员', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/conference/attendees', {
            affair_id: this.affairId, name: f.name.trim(),
            dept_name: (f.dept_name || '').trim() || undefined, post_name: (f.post_name || '').trim() || undefined,
            attendance_status: f.attendance_status, deputy_name: (f.deputy_name || '').trim() || undefined,
          });
          this.$root.toast('参会人已登记', 'ok');
          this.showAdd = false;
          await this.loadAttendees();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      openEdit(a) {
        this.editing = a;
        this.editForm = { attendance_status: a.attendance_status, deputy_name: a.deputy_name || '' };
        this.showEdit = true;
      },
      async submitEdit() {
        const f = this.editForm;
        if (f.attendance_status === 'DEPUTY' && !f.deputy_name.trim()) return this.$root.toast('代会回执必须填写代会人员', 'warn');
        this.submitting = true;
        try {
          await api.put('/api/conference/attendees/' + this.editing.attendee_id, {
            attendance_status: f.attendance_status,
            deputy_name: f.attendance_status === 'DEPUTY' ? f.deputy_name.trim() : '',
          });
          this.$root.toast('参会回执已更新', 'ok');
          this.showEdit = false;
          await this.loadAttendees();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async checkin(a) {
        if (!window.confirm('确认为「' + a.name + '」代签到？')) return;
        try {
          await api.post('/api/conference/attendees/' + a.attendee_id + '/checkin', {});
          this.$root.toast('签到成功', 'ok');
          await this.loadAttendees();
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openAdd(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="users" size="28"></ic></div>
          <div class="meta"><div class="label">应邀参会</div><div class="val" style="color:var(--primary)">{{ stat.total }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">人</span></div><div class="muted" style="font-size:12px">本次会议应邀人数</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta"><div class="label">已回执确认</div><div class="val" style="color:var(--teal)">{{ stat.CONFIRMED }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">人</span></div><div class="muted" style="font-size:12px">{{ ratePct }}%</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="user-x" size="28"></ic></div>
          <div class="meta"><div class="label">请假说明</div><div class="val" style="color:var(--red)">{{ stat.LEAVE }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">人</span></div><div class="muted" style="font-size:12px">{{ leavePct }}%</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="user-plus" size="28"></ic></div>
          <div class="meta"><div class="label">指派代会人员</div><div class="val" style="color:var(--amber)">{{ stat.DEPUTY }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">人</span></div><div class="muted" style="font-size:12px">{{ deputyPct }}%</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="split-1-2 mt16">
        <!-- donut -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">回执情况统计</div></div>
          <div class="card-bd donut-row">
            <div class="donut" :style="donutStyle"><div class="donut-hole"><b>{{ stat.total }}</b><span>应邀人数</span></div></div>
            <div class="dn-legend">
              <div class="row"><i class="dot-green"></i>已回执确认<b>{{ stat.CONFIRMED }} 人 {{ ratePct }}%</b></div>
              <div class="row"><i class="dot-red"></i>请假说明<b>{{ stat.LEAVE }} 人 {{ leavePct }}%</b></div>
              <div class="row"><i class="dot-amber"></i>指派代会人员<b>{{ stat.DEPUTY }} 人 {{ deputyPct }}%</b></div>
              <div class="row"><i style="background:#CBD5E1"></i>未回执<b>{{ Math.max(0, stat.total - stat.CONFIRMED - stat.LEAVE - stat.DEPUTY) }} 人 {{ nonePct }}%</b></div>
            </div>
          </div>
        </div>

        <!-- affair info -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">会议信息</div>
            <span class="more" @click="$root.go('/conference/affairs')">查看统筹单 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd" v-if="affair">
            <div class="strong" style="font-size:15px">{{ affair.title }}</div>
            <div class="desc-list" style="grid-template-columns:96px 1fr; margin-top:8px">
              <span class="k">会议性质</span><span><span :class="['tag', { PARTY_COMMITTEE: 'tag-red', EXECUTIVE: 'tag-amber', WORK: 'tag-blue', EXTERNAL: 'tag-teal' }[affair.meeting_type]]">{{ affair.meeting_type_label }}</span></span>
              <span class="k">保密级别</span><span>{{ affair.security_level_label }}</span>
              <span class="k">会议时间</span><span class="num">{{ bj(affair.start_time) }} ~ {{ bj(affair.end_time).slice(11) }}</span>
              <span class="k">会议地点</span><span>{{ affair.room_name || '待定' }}</span>
            </div>
          </div>
          <div class="card-bd" v-else><div class="empty">暂无会务统筹单，请先在「政务会务统筹」创建</div></div>
        </div>
      </div>

      <!-- roster -->
      <div class="card mt16">
        <div class="card-hd">
          <div class="t">参会人员回执列表</div>
          <span class="muted" style="font-size:12px">共 {{ pageTotal }} 人 · 已签到 {{ stat.signed }} 人</span>
        </div>
        <div class="card-bd" style="padding-top:10px">
          <div class="filters">
            <select class="select" style="width:280px" v-model="affairId" @change="onAffairChange">
              <option value="" disabled>请选择会务统筹单</option>
              <option v-for="a in affairs" :key="a.affair_id" :value="a.affair_id">{{ a.title }}</option>
            </select>
            <input class="input" style="flex:1; min-width:170px" placeholder="请输入姓名、部门或职务" v-model="filters.keyword" @keyup.enter="query">
            <select class="select" style="width:130px" v-model="filters.status" @change="query">
              <option value="">全部回执状态</option>
              <option value="CONFIRMED">确认参会</option>
              <option value="LEAVE">请假</option>
              <option value="DEPUTY">代会</option>
            </select>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr><th>姓名</th><th>单位/部门</th><th>职务</th><th style="width:104px">回执状态</th><th>代会人</th><th style="width:84px">席卡号</th><th>签到时间</th><th style="width:150px">操作</th></tr></thead>
            <tbody>
              <tr v-for="a in shownRows" :key="a.attendee_id">
                <td class="strong">{{ a.name }}</td>
                <td class="muted">{{ a.dept_name || '—' }}</td>
                <td>{{ a.post_name || '—' }}</td>
                <td><span :class="['tag', statusTag(a.attendance_status)]">{{ a.attendance_status_label }}</span></td>
                <td>{{ a.attendance_status === 'DEPUTY' ? (a.deputy_name || '—') : '—' }}</td>
                <td class="num">{{ a.seat_label || '未排座' }}</td>
                <td class="num muted">{{ a.sign_in_time ? bj(a.sign_in_time) : '未签到' }}</td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="openEdit(a)">编辑回执</button>
                  <button v-if="!a.sign_in_time" class="btn btn-text btn-sm" @click="checkin(a)">代签到</button>
                </td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="8"><div class="empty">{{ affairId ? '该会议暂无参会人员，点击右上角「添加参会人」登记' : '请先选择会务统筹单' }}</div></td></tr>
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

      <!-- add modal -->
      <Modal title="添加参会人" width="520px" v-if="showAdd" @close="showAdd = false">
        <div class="form-item">
          <label class="req">姓名</label>
          <input class="input" placeholder="请输入参会人姓名" v-model="addForm.name">
        </div>
        <div class="form-item">
          <label>单位/部门</label>
          <input class="input" placeholder="如：综合办公室" v-model="addForm.dept_name">
        </div>
        <div class="form-item">
          <label>职务</label>
          <input class="input" placeholder="如：主任" v-model="addForm.post_name">
        </div>
        <div class="form-item">
          <label>回执状态</label>
          <select class="select" v-model="addForm.attendance_status">
            <option value="CONFIRMED">确认参会</option>
            <option value="LEAVE">请假</option>
            <option value="DEPUTY">代会</option>
          </select>
        </div>
        <div class="form-item" v-if="addForm.attendance_status === 'DEPUTY'">
          <label class="req">代会人员</label>
          <input class="input" placeholder="请输入代参会人员姓名" v-model="addForm.deputy_name">
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showAdd = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitAdd">登记参会人</button>
        </template>
      </Modal>

      <!-- edit receipt modal -->
      <Modal title="编辑参会回执" width="480px" v-if="showEdit && editing" @close="showEdit = false">
        <div class="desc-list" style="margin-bottom:14px">
          <span class="k">参会人</span><span class="strong">{{ editing.name }}（{{ editing.dept_name || '—' }} {{ editing.post_name || '' }}）</span>
        </div>
        <div class="form-item">
          <label class="req">回执状态</label>
          <select class="select" v-model="editForm.attendance_status">
            <option value="CONFIRMED">确认参会</option>
            <option value="LEAVE">请假</option>
            <option value="DEPUTY">代会</option>
          </select>
        </div>
        <div class="form-item" v-if="editForm.attendance_status === 'DEPUTY'">
          <label class="req">代会人员</label>
          <input class="input" placeholder="请输入代参会人员姓名" v-model="editForm.deputy_name">
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showEdit = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitEdit">保存回执</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
