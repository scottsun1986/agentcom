/* /supervision/standing 督办立项管理 — pixel replica of design/mockups/024-supervision-standing.png
   Layout: 3 stat cards / tabs + filters + task table + pager / 新建立项 modal */
AppPages['/supervision/standing'] = {
  route: '/supervision/standing', title: '督办立项管理', category: 'SUPERVISION', primaryAction: '新建督办事项', icon: 'file-plus',
  subtitle: '规范重点事项立项登记，跟踪办结时限与预警状态，支持任务分解、进展催办全流程管理。',
  component: {
    data() {
      return {
        loading: true,
        statsTasks: [],
        rows: [],
        total: 0,
        tabCounts: { all: 0, IN_PROGRESS: 0, EXTENSION_PENDING: 0, CLOSE_PENDING: 0, CLOSED: 0 },
        tab: 'all',
        filters: { keyword: '', priority: '', status: '' },
        pageNum: 1,
        pageSize: 10,
        depts: [],
        showCreate: false,
        submitting: false,
        detail: null,
        form: { title: '', source_type: 'LEADER_INSTRUCTION', priority: 'NORMAL', lead_dept_id: '', assist_dept_names: '', leader_in_charge: '', deadline: '', content: '' },
      };
    },
    computed: {
      stats() {
        const nowM = this.bjDate(new Date().toISOString()).slice(0, 7);
        const prevD = new Date(); prevD.setMonth(prevD.getMonth() - 1);
        const prevM = prevD.getFullYear() + '-' + String(prevD.getMonth() + 1).padStart(2, '0');
        const s = {
          total: this.statsTasks.length,
          inProgress: this.statsTasks.filter((t) => t.status === 'IN_PROGRESS').length,
          closed: this.statsTasks.filter((t) => t.status === 'CLOSED').length,
          red: this.statsTasks.filter((t) => t.warning_level === 'RED' && !['CLOSED', 'CANCELLED'].includes(t.status)).length,
          newThisMonth: this.statsTasks.filter((t) => this.bjDate(t.created_at).slice(0, 7) === nowM).length,
          newPrevMonth: this.statsTasks.filter((t) => this.bjDate(t.created_at).slice(0, 7) === prevM).length,
          expiring: this.statsTasks.filter((t) => t.status === 'IN_PROGRESS' && t.days_left >= 0 && t.days_left <= 7).length,
        };
        return s;
      },
      newGrowth() {
        if (!this.stats.newPrevMonth) return this.stats.newThisMonth ? '新增 ' + this.stats.newThisMonth + ' 项' : '上月无新增';
        const pct = Math.round((this.stats.newThisMonth - this.stats.newPrevMonth) / this.stats.newPrevMonth * 100);
        return '较上月 ' + (pct >= 0 ? '↑ ' : '↓ ') + Math.abs(pct) + '%';
      },
    },
    async mounted() {
      this.loadDepts();
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
      bjDate(s) { const v = this.bj(s); return v === '—' ? '' : v.slice(0, 10); },
      async loadDepts() {
        try {
          const tree = await api.get('/api/system/depts');
          const flat = [];
          const walk = (nodes, depth) => (nodes || []).forEach((n) => { flat.push({ dept_id: n.dept_id, dept_name: n.dept_name, depth }); walk(n.children, depth + 1); });
          walk(tree, 0);
          this.depts = flat;
        } catch (e) { this.depts = []; }
      },
      async load() {
        try {
          const params = Object.assign({}, this.filters, { pageNum: this.pageNum, pageSize: this.pageSize });
          if (this.tab !== 'all') params.status = this.tab;
          const r = await api.page('/api/supervision/tasks', params);
          this.rows = r.rows || [];
          this.total = r.total || 0;
        } catch (e) { this.rows = []; this.total = 0; }
        try {
          const r2 = await api.page('/api/supervision/tasks', { pageNum: 1, pageSize: 200 });
          this.statsTasks = r2.rows || [];
        } catch (e) { this.statsTasks = []; }
        // 各状态计数（pageSize=1 只取 total）
        try {
          const c = { all: 0, IN_PROGRESS: 0, EXTENSION_PENDING: 0, CLOSE_PENDING: 0, CLOSED: 0 };
          c.all = (await api.page('/api/supervision/tasks', { pageNum: 1, pageSize: 1 })).total || 0;
          for (const s of ['IN_PROGRESS', 'EXTENSION_PENDING', 'CLOSE_PENDING', 'CLOSED']) {
            c[s] = (await api.page('/api/supervision/tasks', { pageNum: 1, pageSize: 1, status: s })).total || 0;
          }
          this.tabCounts = c;
        } catch (e) { /* keep last counts */ }
      },
      sourceTag(s) { return { LEADER_INSTRUCTION: 'tag-red', GOV_REPORT: 'tag-blue', COUNCIL_DECISION: 'tag-teal', EMERGENCY: 'tag-amber' }[s] || 'tag-gray'; },
      prioTag(s) { return { TOP: 'tag-red', URGENT: 'tag-amber', NORMAL: 'tag-gray' }[s] || 'tag-gray'; },
      warnTag(l) { return { GREEN: 'tag-green', YELLOW: 'tag-amber', RED: 'tag-red' }[l] || 'tag-gray'; },
      warnLabel(l) { return { GREEN: '绿码·正常', YELLOW: '黄码·临期预警', RED: '红码·超期' }[l] || l; },
      barCls(l) { return { GREEN: '', YELLOW: 'bar-amber', RED: 'bar-red' }[l] || ''; },
      statusTag(s) { return { DRAFT: 'tag-gray', IN_PROGRESS: 'tag-blue', EXTENSION_PENDING: 'tag-amber', CLOSE_PENDING: 'tag-teal', CLOSED: 'tag-green', CANCELLED: 'tag-gray' }[s] || 'tag-gray'; },
      setTab(t) { this.tab = t; this.pageNum = 1; this.load(); },
      query() { this.pageNum = 1; this.load(); },
      reset() { this.filters = { keyword: '', priority: '', status: '' }; this.setTab('all'); },
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
      goPage(p) {
        if (p < 1 || p > this.pageCount()) return;
        this.pageNum = p;
        this.load();
      },
      openCreate() {
        this.form = { title: '', source_type: 'LEADER_INSTRUCTION', priority: 'NORMAL', lead_dept_id: '', assist_dept_names: '', leader_in_charge: '', deadline: '', content: '' };
        this.showCreate = true;
      },
      async submitCreate() {
        const f = this.form;
        if (!f.title.trim()) return this.$root.toast('请填写事项标题', 'warn');
        if (!f.lead_dept_id) return this.$root.toast('请选择主办处室', 'warn');
        if (!f.deadline) return this.$root.toast('请选择办结时限', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/supervision/tasks', {
            title: f.title.trim(), source_type: f.source_type, priority: f.priority,
            lead_dept_id: f.lead_dept_id, assist_dept_names: f.assist_dept_names.trim() || null,
            leader_in_charge: f.leader_in_charge.trim() || null, deadline: f.deadline, content: f.content.trim(),
          });
          this.$root.toast('督办立项成功', 'ok');
          this.showCreate = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async urge(t) {
        if (!window.confirm('确认向「' + (t.lead_dept_name || '承办部门') + '」下发【' + t.supervision_no + '】的催办通知？')) return;
        try {
          await api.post('/api/supervision/tasks/' + t.task_id + '/urge');
          this.$root.toast('催办通知已下发', 'ok');
        } catch (e) { /* toast shown */ }
      },
      decompose(t) {
        window.__SUP_SELECT_TASK__ = t.task_id;
        this.$root.go('/supervision/decomposition');
      },
      onPrimary() { this.openCreate(); },
    },
    template: `
    <div v-if="!loading">
      <!-- stat cards -->
      <div class="leave-cards" style="margin-bottom:16px">
        <div class="card leave-card" style="margin-top:0">
          <span class="ico-box ico-blue" style="width:44px;height:44px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center"><ic name="file-text" size="24"></ic></span>
          <div class="meta">
            <div class="label">全部督办事项</div>
            <div class="val" style="color:var(--primary)">{{ stats.total }}</div>
            <div class="muted" style="font-size:12px">在办 {{ stats.inProgress }} · 已办结 {{ stats.closed }} · 已超期 <span style="color:var(--red)">{{ stats.red }}</span></div>
          </div>
        </div>
        <div class="card leave-card" style="margin-top:0">
          <span class="ico-box ico-teal" style="width:44px;height:44px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center"><ic name="clock" size="24"></ic></span>
          <div class="meta">
            <div class="label">本月新增</div>
            <div class="val" style="color:var(--teal)">{{ stats.newThisMonth }}</div>
            <div class="muted" style="font-size:12px">{{ newGrowth }}</div>
          </div>
        </div>
        <div class="card leave-card" style="margin-top:0">
          <span class="ico-box ico-amber" style="width:44px;height:44px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center"><ic name="siren" size="24"></ic></span>
          <div class="meta">
            <div class="label">即将到期 <span class="muted" style="font-size:12px">7 天内</span></div>
            <div class="val" style="color:var(--amber)">{{ stats.expiring }}</div>
            <div class="muted" style="font-size:12px">临期事项请及时催办跟进</div>
          </div>
        </div>
      </div>

      <!-- task table -->
      <div class="card mt16">
        <div class="card-bd" style="padding-top:4px">
          <div class="lr-tabs" style="margin:0 0 12px">
            <span :class="['lr-tab', tab === 'all' ? 'on' : '']" @click="setTab('all')">全部 ({{ tabCounts.all }})</span>
            <span :class="['lr-tab', tab === 'IN_PROGRESS' ? 'on' : '']" @click="setTab('IN_PROGRESS')">在办 ({{ tabCounts.IN_PROGRESS }})</span>
            <span :class="['lr-tab', tab === 'EXTENSION_PENDING' ? 'on' : '']" @click="setTab('EXTENSION_PENDING')">延期待审 ({{ tabCounts.EXTENSION_PENDING }})</span>
            <span :class="['lr-tab', tab === 'CLOSE_PENDING' ? 'on' : '']" @click="setTab('CLOSE_PENDING')">销号待审 ({{ tabCounts.CLOSE_PENDING }})</span>
            <span :class="['lr-tab', tab === 'CLOSED' ? 'on' : '']" @click="setTab('CLOSED')">已办结 ({{ tabCounts.CLOSED }})</span>
          </div>
          <div class="filters">
            <input class="input" style="flex:1; min-width:200px" placeholder="请输入督办编号、事项标题关键词" v-model="filters.keyword" @keyup.enter="query">
            <select class="select" style="width:150px" v-model="filters.priority" @change="query">
              <option value="">全部紧急程度</option><option value="TOP">特急</option><option value="URGENT">急</option><option value="NORMAL">常规</option>
            </select>
            <select class="select" style="width:140px" v-model="filters.status" @change="query">
              <option value="">全部办理状态</option><option value="IN_PROGRESS">在办</option><option value="EXTENSION_PENDING">延期待审</option><option value="CLOSE_PENDING">销号待审</option><option value="CLOSED">已办结</option><option value="CANCELLED">已取消</option>
            </select>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr>
              <th>督办编号</th><th>事项标题</th><th>督办来源</th><th>紧急程度</th><th>主办处室</th><th>办结时限</th><th>预警状态</th><th style="width:120px">进度</th><th>当前状态</th><th style="width:150px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="t in rows" :key="t.task_id">
                <td class="num">{{ t.supervision_no }}</td>
                <td class="ellipsis strong" style="max-width:220px" :title="t.title">{{ t.title }}</td>
                <td><span :class="['tag', sourceTag(t.source_type)]">{{ t.source_type_label }}</span></td>
                <td><span :class="['tag', prioTag(t.priority)]">{{ t.priority_label }}</span></td>
                <td>{{ t.lead_dept_name || '—' }}</td>
                <td class="num muted">{{ t.deadline }}</td>
                <td><span :class="['tag', warnTag(t.warning_level)]">
                  <ic :name="t.warning_level === 'RED' ? 'siren' : t.warning_level === 'YELLOW' ? 'alert-triangle' : 'check-circle-2'" size="12"></ic>
                  {{ warnLabel(t.warning_level) }}</span></td>
                <td><div style="display:flex; align-items:center; gap:8px"><div class="progress" style="flex:1"><div class="bar" :class="barCls(t.warning_level)" :style="{width: t.progress_pct + '%'}"></div></div><span class="num" style="font-size:12px">{{ t.progress_pct }}%</span></div></td>
                <td><span :class="['tag', statusTag(t.status)]">{{ t.status_label }}</span></td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="detail = t">详情</button>
                  <button class="btn btn-text btn-sm" @click="decompose(t)">分解</button>
                  <button class="btn btn-text btn-sm danger" @click="urge(t)">催办</button>
                </td>
              </tr>
              <tr v-if="!rows.length"><td colspan="10"><div class="empty">暂无督办事项，点击右上角「新建督办事项」立项</div></td></tr>
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

      <!-- create modal -->
      <Modal title="新建督办事项" width="600px" v-if="showCreate" @close="showCreate = false">
        <div class="form-item">
          <label class="req">事项标题</label>
          <div style="flex:1">
            <input class="input" maxlength="100" placeholder="请输入督办事项标题（不超过 100 字）" v-model="form.title">
            <div class="muted" style="text-align:right; font-size:12px">{{ form.title.length }}/100</div>
          </div>
        </div>
        <div class="form-item">
          <label class="req">督办来源</label>
          <select class="select" v-model="form.source_type">
            <option value="LEADER_INSTRUCTION">领导批示</option>
            <option value="GOV_REPORT">政府工作报告</option>
            <option value="COUNCIL_DECISION">党委会决议</option>
            <option value="EMERGENCY">应急专项</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">紧急程度</label>
          <div style="flex:1; display:flex; align-items:center; gap:22px; padding-top:7px">
            <label style="display:inline-flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" value="TOP" v-model="form.priority">特急</label>
            <label style="display:inline-flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" value="URGENT" v-model="form.priority">急</label>
            <label style="display:inline-flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" value="NORMAL" v-model="form.priority">常规</label>
          </div>
        </div>
        <div class="form-item">
          <label class="req">主办处室</label>
          <select class="select" v-model="form.lead_dept_id">
            <option value="">请选择主办处室</option>
            <option v-for="d in depts" :key="d.dept_id" :value="d.dept_id">{{ '　'.repeat(d.depth) + d.dept_name }}</option>
          </select>
        </div>
        <div class="form-item">
          <label>协办处室</label>
          <input class="input" placeholder="请输入协办处室名称，多个用、分隔" v-model="form.assist_dept_names">
        </div>
        <div class="form-item">
          <label>分管领导</label>
          <input class="input" placeholder="请输入分管领导姓名" v-model="form.leader_in_charge">
        </div>
        <div class="form-item">
          <label class="req">办结时限</label>
          <input type="date" class="input" v-model="form.deadline">
        </div>
        <div class="form-item">
          <label>事项说明</label>
          <div style="flex:1">
            <textarea class="input" maxlength="500" placeholder="请输入事项背景、主要内容和工作要求" v-model="form.content"></textarea>
            <div class="muted" style="text-align:right; font-size:12px">{{ form.content.length }}/500</div>
          </div>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showCreate = false">取 消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitCreate">保存立项</button>
        </template>
      </Modal>

      <!-- detail modal -->
      <Modal title="督办事项详情" width="580px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">督办编号</span><span class="num">{{ detail.supervision_no }}</span>
          <span class="k">事项标题</span><span class="strong">{{ detail.title }}</span>
          <span class="k">督办来源</span><span><span :class="['tag', sourceTag(detail.source_type)]">{{ detail.source_type_label }}</span></span>
          <span class="k">紧急程度</span><span><span :class="['tag', prioTag(detail.priority)]">{{ detail.priority_label }}</span></span>
          <span class="k">主办处室</span><span>{{ detail.lead_dept_name || '—' }}</span>
          <span class="k">协办处室</span><span>{{ detail.assist_dept_names || '—' }}</span>
          <span class="k">分管领导</span><span>{{ detail.leader_in_charge || '—' }}</span>
          <span class="k">办结时限</span><span class="num">{{ detail.deadline }}（剩余 {{ detail.days_left }} 天）</span>
          <span class="k">预警状态</span><span><span :class="['tag', warnTag(detail.warning_level)]">{{ warnLabel(detail.warning_level) }}</span></span>
          <span class="k">当前进度</span><span class="num">{{ detail.progress_pct }}%</span>
          <span class="k">当前状态</span><span><span :class="['tag', statusTag(detail.status)]">{{ detail.status_label }}</span></span>
          <span class="k">事项说明</span><span>{{ detail.content || '—' }}</span>
          <span class="k">立项时间</span><span class="num">{{ bj(detail.created_at) }}</span>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="detail = null">关闭</button>
          <button class="btn btn-primary" @click="decompose(detail); detail = null">前往分解</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
