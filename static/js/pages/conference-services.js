/* /conference/services 会务保障派工 — pixel replica of design/mockups/037-conference-services.png
   Layout: 4 KPI / filters / 3-col kanban（待派工 | 进行中 | 已完成）+ 新建工单 modal + 派工 modal */
AppPages['/conference/services'] = {
  route: '/conference/services', title: '会务保障派工', category: 'CONFERENCE', primaryAction: '新建保障工单', icon: 'wrench',
  subtitle: '对会务服务事项进行派工与过程跟踪，确保茶歇备水、调音测试、LED 欢迎横幅投影、空调预开等保障任务按时完成。',
  component: {
    data() {
      return {
        loading: true,
        tickets: [],
        bookings: [],
        filters: { booking_id: '', status: '', keyword: '' },
        showForm: false,
        showDispatch: false,
        submitting: false,
        dispatching: null,
        assignee: '',
        form: { booking_id: '', service_type: 'TEA', notes: '' },
        types: [
          { key: 'TEA', label: '茶歇备水', icon: 'coffee', tag: 'tag-amber' },
          { key: 'AV_PROJECTOR', label: '音响投影', icon: 'mic', tag: 'tag-blue' },
          { key: 'LED_BANNER', label: '横幅屏显', icon: 'monitor', tag: 'tag-teal' },
          { key: 'AC', label: '空调调试', icon: 'sliders-horizontal', tag: 'tag-green' },
        ],
        cols: [
          { key: 'PENDING', name: '待派工', cls: 'c-pending', dot: 'dot-amber' },
          { key: 'PROCESSING', name: '进行中', cls: 'c-processing', dot: 'dot-blue' },
          { key: 'COMPLETED', name: '已完成', cls: 'c-completed', dot: 'dot-green' },
        ],
      };
    },
    computed: {
      filtered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        return this.tickets.filter((t) => {
          if (this.filters.status && t.status !== this.filters.status) return false;
          if (this.filters.booking_id && t.booking_id !== this.filters.booking_id) return false;
          if (kw && !((t.booking_title || '') + (t.notes || '') + (t.assignee_name || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      stat() {
        const s = { total: this.tickets.length, PENDING: 0, PROCESSING: 0, COMPLETED: 0 };
        this.tickets.forEach((t) => { if (s[t.status] !== undefined) s[t.status]++; });
        return s;
      },
      byCol() {
        const m = { PENDING: [], PROCESSING: [], COMPLETED: [] };
        this.filtered.forEach((t) => { if (m[t.status]) m[t.status].push(t); });
        return m;
      },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      async load() {
        try {
          const r = await api.page('/api/conference/services', { pageNum: 1, pageSize: 300 });
          this.tickets = r.rows || [];
        } catch (e) { this.tickets = []; }
        try {
          const rb = await api.page('/api/conference/bookings', { pageNum: 1, pageSize: 200 });
          this.bookings = (rb.rows || []).filter((b) => b.status !== 'CANCELLED');
        } catch (e) { this.bookings = []; }
      },
      typeInfo(t) { return this.types.find((x) => x.key === t.service_type) || { label: t.service_type_label || t.service_type, icon: 'wrench', tag: 'tag-gray' }; },
      colTickets(key) { return this.byCol[key] || []; },
      pct(n) { return this.stat.total ? Math.round(n / this.stat.total * 100) : 0; },
      openForm() {
        this.form = { booking_id: this.bookings[0] ? this.bookings[0].booking_id : '', service_type: 'TEA', notes: '' };
        this.showForm = true;
      },
      async submitForm() {
        const f = this.form;
        if (!f.booking_id) return this.$root.toast('请选择关联会议预订', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/conference/services', {
            booking_id: f.booking_id, service_type: f.service_type,
            notes: (f.notes || '').trim() || undefined,
          });
          this.$root.toast('会务服务工单已创建', 'ok');
          this.showForm = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      openDispatch(t) {
        this.dispatching = t;
        this.assignee = '';
        this.showDispatch = true;
      },
      async submitDispatch() {
        if (!this.assignee.trim()) return this.$root.toast('请填写承办人姓名', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/conference/services/' + this.dispatching.ticket_id + '/dispatch', { assignee_name: this.assignee.trim() });
          this.$root.toast('工单已派发给 ' + this.assignee.trim(), 'ok');
          this.showDispatch = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async complete(t) {
        if (!window.confirm('确认该工单已完成？')) return;
        try {
          await api.post('/api/conference/services/' + t.ticket_id + '/complete', {});
          this.$root.toast('工单已完成', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openForm(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="clipboard-list" size="28"></ic></div>
          <div class="meta"><div class="label">工单总数</div><div class="val" style="color:var(--primary)">{{ stat.total }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">单</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="hourglass" size="28"></ic></div>
          <div class="meta"><div class="label">待派工</div><div class="val" style="color:var(--amber)">{{ stat.PENDING }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">占比 {{ pct(stat.PENDING) }}%</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="loader-2" size="28"></ic></div>
          <div class="meta"><div class="label">进行中</div><div class="val" style="color:var(--teal)">{{ stat.PROCESSING }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">占比 {{ pct(stat.PROCESSING) }}%</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta"><div class="label">已完成</div><div class="val" style="color:var(--green)">{{ stat.COMPLETED }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">占比 {{ pct(stat.COMPLETED) }}%</span></div></div>
        </div>
      </div>

      <!-- kanban -->
      <div class="card mt16">
        <div class="card-hd">
          <div class="t">保障工单看板</div>
          <span class="muted" style="font-size:12px">共 {{ filtered.length }} 单</span>
        </div>
        <div class="card-bd" style="padding-top:10px">
          <div class="filters">
            <select class="select" style="width:250px" v-model="filters.booking_id">
              <option value="">全部会议</option>
              <option v-for="b in bookings" :key="b.booking_id" :value="b.booking_id">{{ b.title }}</option>
            </select>
            <select class="select" style="width:130px" v-model="filters.status">
              <option value="">全部状态</option>
              <option value="PENDING">待派工</option>
              <option value="PROCESSING">进行中</option>
              <option value="COMPLETED">已完成</option>
            </select>
            <input class="input" style="flex:1; min-width:170px" placeholder="请输入会议名称或工单备注" v-model="filters.keyword">
            <button class="btn btn-primary" @click="load"><ic name="refresh-cw" size="14"></ic>刷新</button>
          </div>
          <div class="kb-cols">
            <div v-for="c in cols" :key="c.key" class="kb-col" :class="c.cls">
              <div class="kb-hd"><i :class="['gd-dot', c.dot]"></i>{{ c.name }}<span class="cnt">{{ colTickets(c.key).length }} 单</span></div>
              <div v-for="t in colTickets(c.key)" :key="t.ticket_id" class="kb-card">
                <div class="tt">
                  <span class="ell" style="flex:1" :title="t.booking_title || ''">{{ t.booking_title || '未关联会议' }}</span>
                  <span :class="['tag', typeInfo(t).tag]"><ic :name="typeInfo(t).icon" size="11"></ic>{{ t.service_type_label }}</span>
                </div>
                <div class="nt">{{ t.notes || '无备注' }}</div>
                <div class="as">
                  <ic name="user" size="13"></ic>
                  <span v-if="t.assignee_name">承办人：{{ t.assignee_name }}</span>
                  <span v-else class="muted">尚未派工</span>
                  <span :class="['tag', { PENDING: 'tag-amber', PROCESSING: 'tag-blue', COMPLETED: 'tag-green' }[t.status]]" style="margin-left:auto">{{ t.status_label }}</span>
                </div>
                <div style="display:flex; gap:6px; justify-content:flex-end; margin-top:8px">
                  <button v-if="t.status === 'PENDING'" class="btn btn-primary btn-sm" @click="openDispatch(t)"><ic name="send" size="12"></ic>派工</button>
                  <button v-if="t.status === 'PROCESSING'" class="btn btn-ghost btn-sm" @click="complete(t)"><ic name="check" size="12"></ic>完成</button>
                </div>
              </div>
              <div v-if="!colTickets(c.key).length" class="empty" style="padding:26px 0; font-size:12px">暂无工单</div>
            </div>
          </div>
        </div>
      </div>

      <!-- create ticket modal -->
      <Modal title="新建保障工单" width="520px" v-if="showForm" @close="showForm = false">
        <div class="form-item">
          <label class="req">关联会议</label>
          <select class="select" v-model="form.booking_id">
            <option value="" disabled>请选择会议预订</option>
            <option v-for="b in bookings" :key="b.booking_id" :value="b.booking_id">{{ b.title }}（{{ b.room_name }}）</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">服务类型</label>
          <select class="select" v-model="form.service_type">
            <option v-for="t in types" :key="t.key" :value="t.key">{{ t.label }}</option>
          </select>
        </div>
        <div class="form-item">
          <label>备注说明</label>
          <textarea class="input" rows="3" placeholder="如：茶歇备水 50 人，会前 30 分钟到位" v-model="form.notes"></textarea>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showForm = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitForm">创建工单</button>
        </template>
      </Modal>

      <!-- dispatch modal -->
      <Modal title="工单派工" width="460px" v-if="showDispatch && dispatching" @close="showDispatch = false">
        <div class="desc-list" style="margin-bottom:14px">
          <span class="k">关联会议</span><span class="strong">{{ dispatching.booking_title || '—' }}</span>
          <span class="k">服务类型</span><span>{{ dispatching.service_type_label }}</span>
          <span class="k">备注</span><span>{{ dispatching.notes || '无' }}</span>
        </div>
        <div class="form-item">
          <label class="req">承办人</label>
          <input class="input" placeholder="请输入承办人姓名，如：李华" v-model="assignee" @keyup.enter="submitDispatch">
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showDispatch = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitDispatch">确认派工</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
