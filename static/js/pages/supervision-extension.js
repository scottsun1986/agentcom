/* /supervision/extension 延期申请与变更审核 — pixel replica of design/mockups/028-supervision-extension.png
   Layout: 4 status KPI / filters + extension table + pager / 申请详情 modal + 发起延期 modal */
AppPages['/supervision/extension'] = {
  route: '/supervision/extension', title: '延期申请与变更审核', category: 'SUPERVISION', primaryAction: '发起延期申请', icon: 'calendar-clock',
  subtitle: '因客观政策或不可抗力导致滞后的，须由主办单位发起说明并经督查室审批后方可调整工期。',
  component: {
    data() {
      return {
        loading: true,
        rows: [],
        total: 0,
        allRows: [],
        filters: { status: '', keyword: '' },
        pageNum: 1,
        pageSize: 10,
        canAudit: false,
        showApply: false,
        submitting: false,
        detail: null,
        inProgressTasks: [],
        form: { task_id: '', reason: '', new_deadline: '' },
      };
    },
    computed: {
      counts() {
        const c = { PENDING: 0, APPROVED: 0, REJECTED: 0, ALL: this.allRows.length };
        this.allRows.forEach((x) => { if (c[x.status] !== undefined) c[x.status]++; });
        return c;
      },
      delayDays() { return (x) => Math.max(0, Math.round((new Date(x.new_deadline + 'T00:00:00') - new Date(x.old_deadline + 'T00:00:00')) / 86400000)); },
      minNewDeadline() {
        const t = this.inProgressTasks.find((x) => x.task_id === this.form.task_id);
        if (!t) return '';
        const d = new Date(t.deadline + 'T00:00:00');
        d.setDate(d.getDate() + 1);
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      },
      selTask() { return this.inProgressTasks.find((x) => x.task_id === this.form.task_id) || null; },
    },
    async mounted() {
      try {
        const info = await api.get('/api/auth/info');
        const perms = info.permissions || [];
        this.canAudit = perms.includes('*:*:*') || perms.includes('supervision:extension:audit');
      } catch (e) { /* keep false */ }
      await this.load();
      this.loading = false;
    },
    methods: {
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate());
      },
      async load() {
        try {
          const params = Object.assign({}, this.filters, { pageNum: this.pageNum, pageSize: this.pageSize });
          const r = await api.page('/api/supervision/extensions', params);
          this.rows = r.rows || [];
          this.total = r.total || 0;
        } catch (e) { this.rows = []; this.total = 0; }
        try {
          const r2 = await api.page('/api/supervision/extensions', { pageNum: 1, pageSize: 200 });
          this.allRows = r2.rows || [];
        } catch (e) { this.allRows = []; }
      },
      query() { this.pageNum = 1; this.load(); },
      reset() { this.filters = { status: '', keyword: '' }; this.query(); },
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
      goPage(p) {
        if (p < 1 || p > this.pageCount()) return;
        this.pageNum = p;
        this.load();
      },
      statusTag(s) { return { PENDING: 'tag-blue', APPROVED: 'tag-green', REJECTED: 'tag-red' }[s] || 'tag-gray'; },
      async loadInProgress() {
        try {
          const r = await api.page('/api/supervision/tasks', { pageNum: 1, pageSize: 200, status: 'IN_PROGRESS' });
          this.inProgressTasks = r.rows || [];
        } catch (e) { this.inProgressTasks = []; }
      },
      async openApply() {
        await this.loadInProgress();
        this.form = { task_id: '', reason: '', new_deadline: '' };
        if (!this.inProgressTasks.length) return this.$root.toast('暂无在办任务可申请延期', 'warn');
        this.showApply = true;
      },
      async submitApply() {
        const f = this.form;
        if (!f.task_id) return this.$root.toast('请选择督办任务', 'warn');
        if (!f.reason.trim()) return this.$root.toast('请填写延期理由', 'warn');
        if (!f.new_deadline) return this.$root.toast('请选择申请调整后的时限', 'warn');
        if (this.selTask && f.new_deadline <= this.selTask.deadline) return this.$root.toast('新时限必须晚于原时限 ' + this.selTask.deadline, 'warn');
        this.submitting = true;
        try {
          await api.post('/api/supervision/extensions', { task_id: f.task_id, reason: f.reason.trim(), new_deadline: f.new_deadline });
          this.$root.toast('延期申请已提交，待督查室审核', 'ok');
          this.showApply = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async audit(x, action) {
        const tip = action === 'APPROVE'
          ? '确认批准该延期申请？批准后任务工期将调整为 ' + x.new_deadline + '。'
          : '确认驳回该延期申请？';
        if (!window.confirm(tip)) return;
        try {
          await api.post('/api/supervision/extensions/' + x.request_id + '/audit', {
            action, comment: action === 'APPROVE' ? '同意延期，请按新时限加快推进' : '理由不充分，驳回',
          });
          this.$root.toast(action === 'APPROVE' ? '已批准该延期申请' : '已驳回该延期申请', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openApply(); },
    },
    template: `
    <div v-if="!loading">
      <!-- status KPI -->
      <div class="kpi-row">
        <div class="card kpi-card" @click="filters.status = 'PENDING'; query()">
          <div class="ico ico-blue"><ic name="file-text" size="28"></ic></div>
          <div class="meta"><div class="label">待督查室审核</div><div class="val" style="color:var(--primary)">{{ counts.PENDING }}</div>
            <div class="muted" style="font-size:12px">点击筛选待审申请</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="filters.status = 'APPROVED'; query()">
          <div class="ico ico-teal"><ic name="user-check" size="28"></ic></div>
          <div class="meta"><div class="label">已批准变更</div><div class="val" style="color:var(--teal)">{{ counts.APPROVED }}</div>
            <div class="muted" style="font-size:12px">批准后工期自动调整</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="filters.status = 'REJECTED'; query()">
          <div class="ico ico-red"><ic name="x-circle" size="28"></ic></div>
          <div class="meta"><div class="label">已驳回</div><div class="val" style="color:var(--red)">{{ counts.REJECTED }}</div>
            <div class="muted" style="font-size:12px">点击筛选被驳回申请</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="filters.status = ''; query()">
          <div class="ico ico-amber"><ic name="calendar-clock" size="28"></ic></div>
          <div class="meta"><div class="label">延期申请总数</div><div class="val" style="color:var(--amber)">{{ counts.ALL }}</div>
            <div class="muted" style="font-size:12px">点击查看全部申请</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <!-- list -->
      <div class="card mt0" style="margin-top:0">
        <div class="card-bd" style="padding-top:4px">
          <div class="filters" style="margin-top:8px">
            <select class="select" style="width:150px" v-model="filters.status" @change="query">
              <option value="">全部申请状态</option>
              <option value="PENDING">待审核</option>
              <option value="APPROVED">已批准</option>
              <option value="REJECTED">已驳回</option>
            </select>
            <input class="input" style="flex:1; min-width:200px" placeholder="请输入项目名称或申请理由关键词" v-model="filters.keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <div class="strong" style="margin:4px 0 10px; font-size:14px">延期申请列表 <span class="muted" style="font-weight:400; font-size:12.5px">（共 {{ total }} 条）</span></div>
          <table class="table">
            <thead><tr>
              <th style="width:48px">序号</th><th>任务名称</th><th>原计划完成</th><th>申请调整至</th><th>延期天数</th><th>申请理由</th><th>申请人</th><th>申请时间</th><th>当前状态</th><th style="width:130px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="(x, i) in rows" :key="x.request_id">
                <td class="num muted">{{ (pageNum - 1) * pageSize + i + 1 }}</td>
                <td class="ellipsis strong" style="max-width:210px" :title="x.task_title">{{ x.task_title || '—' }}</td>
                <td class="num muted">{{ x.old_deadline }}</td>
                <td class="num">{{ x.new_deadline }}</td>
                <td class="num">{{ delayDays(x) }} 天</td>
                <td class="ellipsis" style="max-width:200px" :title="x.reason">{{ x.reason }}</td>
                <td>{{ x.applicant_name || '—' }}</td>
                <td class="num muted">{{ bj(x.created_at) }}</td>
                <td><span :class="['tag', statusTag(x.status)]">{{ x.status_label }}</span></td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="detail = x">查看</button>
                  <template v-if="canAudit && x.status === 'PENDING'">
                    <button class="btn btn-text btn-sm" @click="audit(x, 'APPROVE')">通过</button>
                    <button class="btn btn-text btn-sm danger" @click="audit(x, 'REJECT')">驳回</button>
                  </template>
                </td>
              </tr>
              <tr v-if="!rows.length"><td colspan="10"><div class="empty">暂无延期申请</div></td></tr>
            </tbody>
          </table>
          <div class="pager">
            <span>共 {{ total }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in pageCount()" :key="p" v-show="pageCount() <= 7 || p === 1 || p === pageCount() || Math.abs(p - pageNum) <= 1" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= pageCount()" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
      </div>

      <!-- apply modal -->
      <Modal title="发起延期申请" width="560px" v-if="showApply" @close="showApply = false">
        <div class="form-item">
          <label class="req">督办任务</label>
          <select class="select" v-model="form.task_id">
            <option value="">请选择在办督办任务</option>
            <option v-for="t in inProgressTasks" :key="t.task_id" :value="t.task_id">{{ t.supervision_no }}　{{ t.title }}</option>
          </select>
        </div>
        <div class="form-item" v-if="selTask">
          <label>原办结时限</label>
          <div style="flex:1; padding-top:7px" class="num strong">{{ selTask.deadline }} <span class="muted" style="font-weight:400">（{{ selTask.title }}）</span></div>
        </div>
        <div class="form-item">
          <label class="req">申请调整至</label>
          <input type="date" class="input" :min="minNewDeadline" v-model="form.new_deadline">
        </div>
        <div class="form-item">
          <label class="req">延期理由</label>
          <textarea class="input" maxlength="300" placeholder="请说明因客观政策、不可抗力等导致滞后的具体原因" v-model="form.reason"></textarea>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showApply = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitApply">提交申请</button>
        </template>
      </Modal>

      <!-- detail modal -->
      <Modal title="延期申请详情" width="560px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">任务名称</span><span class="strong">{{ detail.task_title || '—' }}</span>
          <span class="k">原计划完成</span><span class="num">{{ detail.old_deadline }}</span>
          <span class="k">申请调整至</span><span class="num">{{ detail.new_deadline }}（延期 {{ delayDays(detail) }} 天）</span>
          <span class="k">申请人</span><span>{{ detail.applicant_name || '—' }}</span>
          <span class="k">申请时间</span><span class="num">{{ bj(detail.created_at) }}</span>
          <span class="k">当前状态</span><span><span :class="['tag', statusTag(detail.status)]">{{ detail.status_label }}</span></span>
          <span class="k">申请理由</span><span>{{ detail.reason }}</span>
          <span class="k">审批意见</span><span>{{ detail.audit_comment || '—' }}</span>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="detail = null">关闭</button>
          <template v-if="canAudit && detail.status === 'PENDING'">
            <button class="btn btn-ghost btn-reject" @click="audit(detail, 'REJECT'); detail = null">驳回</button>
            <button class="btn btn-primary" @click="audit(detail, 'APPROVE'); detail = null">批准</button>
          </template>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
