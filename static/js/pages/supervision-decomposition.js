/* /supervision/decomposition 任务分解与甘特里程碑 — pixel replica of design/mockups/025-supervision-decomposition.png
   Layout: 4 KPI / (left task selector list | right task header + milestone gantt) / milestone modals */
AppPages['/supervision/decomposition'] = {
  route: '/supervision/decomposition', title: '任务分解与甘特里程碑', category: 'SUPERVISION', primaryAction: '新增里程碑', icon: 'milestone',
  subtitle: '承办单位细化阶段性交付物、时间节点里程碑，责任到具体经办人。',
  component: {
    data() {
      return {
        loading: true,
        tasks: [],
        keyword: '',
        selId: '',
        task: null,        // detail with milestones
        ganttRange: { start: '', end: '', days: 1 },
        showAdd: false,
        editM: null,
        submitting: false,
        mForm: { title: '', due_date: '', target_output: '' },
        eForm: { progress_pct: 0, status: 'PENDING' },
      };
    },
    computed: {
      total() { return this.tasks.length; },
      inProgress() { return this.tasks.filter((t) => t.status === 'IN_PROGRESS').length; },
      closedCnt() { return this.tasks.filter((t) => t.status === 'CLOSED').length; },
      redCnt() { return this.tasks.filter((t) => t.warning_level === 'RED' && !['CLOSED', 'CANCELLED'].includes(t.status)).length; },
      filteredTasks() {
        const kw = (this.keyword || '').trim().toLowerCase();
        if (!kw) return this.tasks;
        return this.tasks.filter((t) => (t.title + t.supervision_no).toLowerCase().includes(kw));
      },
      milestones() { return (this.task && this.task.milestones) || []; },
      ticks() {
        const { start, end, days } = this.ganttRange;
        if (!start || !end || days <= 0) return [];
        const out = [];
        const step = Math.max(1, Math.round(days / 6));
        for (let d = 0; d <= days; d += step) {
          const dt = new Date(start + 'T00:00:00');
          dt.setDate(dt.getDate() + d);
          out.push({ pct: Math.round(d / days * 100), label: (dt.getMonth() + 1) + '/' + (dt.getDate()) });
        }
        return out;
      },
    },
    async mounted() {
      await this.loadTasks();
      const preset = window.__SUP_SELECT_TASK__;
      if (preset) { delete window.__SUP_SELECT_TASK__; this.selId = preset; }
      if (!this.selId && this.tasks.length) this.selId = this.tasks[0].task_id;
      if (this.selId) await this.loadDetail();
      this.loading = false;
    },
    methods: {
      async loadTasks() {
        try {
          const r = await api.page('/api/supervision/tasks', { pageNum: 1, pageSize: 200 });
          this.tasks = r.rows || [];
        } catch (e) { this.tasks = []; }
      },
      async loadDetail() {
        if (!this.selId) return;
        try {
          const d = await api.get('/api/supervision/tasks/' + this.selId);
          this.task = d;
          this.calcRange();
        } catch (e) { this.task = null; }
      },
      calcRange() {
        if (!this.task) return;
        const ds = [this.task.deadline];
        this.milestones.forEach((m) => ds.push(m.due_date));
        const created = this.bjDate(this.task.created_at);
        if (created) ds.push(created);
        ds.sort();
        const start = ds[0];
        const end = ds[ds.length - 1] > this.task.deadline ? ds[ds.length - 1] : this.task.deadline;
        const days = Math.max(1, Math.round((new Date(end + 'T00:00:00') - new Date(start + 'T00:00:00')) / 86400000));
        this.ganttRange = { start, end, days };
      },
      blockStyle(m, idx) {
        const { start, end, days } = this.ganttRange;
        const dayDiff = (a, b) => Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / 86400000);
        const s = idx === 0 ? start : (this.milestones[idx - 1].due_date > start ? this.milestones[idx - 1].due_date : start);
        const e = m.due_date < s ? s : m.due_date;
        const left = Math.min(96, Math.max(0, dayDiff(start, s) / days * 100));
        const width = Math.max(2, Math.min(100 - left, dayDiff(s, e) / days * 100));
        return { left: left + '%', width: width + '%' };
      },
      mTag(s) { return { PENDING: 'tag-gray', IN_PROGRESS: 'tag-blue', DONE: 'tag-green', OVERDUE: 'tag-red' }[s] || 'tag-gray'; },
      mLabel(s) { return { PENDING: '未开始', IN_PROGRESS: '进行中', DONE: '已完成', OVERDUE: '已逾期' }[s] || s; },
      mBlockCls(s) { return { PENDING: 'gb-gray', IN_PROGRESS: 'gb-blue', DONE: 'gb-green', OVERDUE: 'gb-red' }[s] || 'gb-gray'; },
      warnTag(l) { return { GREEN: 'tag-green', YELLOW: 'tag-amber', RED: 'tag-red' }[l] || 'tag-gray'; },
      warnLabel(l) { return { GREEN: '绿码·正常', YELLOW: '黄码·临期预警', RED: '红码·超期' }[l] || l; },
      statusTag(s) { return { DRAFT: 'tag-gray', IN_PROGRESS: 'tag-blue', EXTENSION_PENDING: 'tag-amber', CLOSE_PENDING: 'tag-teal', CLOSED: 'tag-green', CANCELLED: 'tag-gray' }[s] || 'tag-gray'; },
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate());
      },
      bjDate(s) { const v = this.bj(s); return v === '—' ? '' : v.slice(0, 10); },
      async select(t) {
        this.selId = t.task_id;
        await this.loadDetail();
      },
      openAdd() {
        if (!this.task) return this.$root.toast('请先选择左侧督办任务', 'warn');
        this.mForm = { title: '', due_date: '', target_output: '' };
        this.showAdd = true;
      },
      async submitAdd() {
        const f = this.mForm;
        if (!f.title.trim()) return this.$root.toast('请填写里程碑名称', 'warn');
        if (!f.due_date) return this.$root.toast('请选择里程碑时限', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/supervision/tasks/' + this.task.task_id + '/milestones', {
            title: f.title.trim(), due_date: f.due_date, target_output: f.target_output.trim() || null,
          });
          this.$root.toast('里程碑已登记', 'ok');
          this.showAdd = false;
          await this.loadDetail();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      edit(m) {
        this.editM = m;
        this.eForm = { progress_pct: m.progress_pct, status: m.status };
      },
      async saveEdit() {
        const pct = Number(this.eForm.progress_pct);
        if (isNaN(pct) || pct < 0 || pct > 100) return this.$root.toast('进度应在 0-100 之间', 'warn');
        this.submitting = true;
        try {
          await api.put('/api/supervision/milestones/' + this.editM.milestone_id, { progress_pct: Math.round(pct), status: this.eForm.status });
          this.$root.toast('里程碑进度已更新', 'ok');
          this.editM = null;
          await this.loadDetail();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async removeM(m) {
        if (!window.confirm('确认删除里程碑「' + m.title + '」？')) return;
        try {
          await api.del('/api/supervision/milestones/' + m.milestone_id);
          this.$root.toast('里程碑已删除', 'ok');
          await this.loadDetail();
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openAdd(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" @click="$root.go('/supervision/standing')">
          <div class="ico ico-blue"><ic name="file-text" size="28"></ic></div>
          <div class="meta"><div class="label">任务总数</div><div class="val" style="color:var(--primary)">{{ total }}</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/supervision/reporting')">
          <div class="ico ico-teal"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta"><div class="label">在办任务</div><div class="val" style="color:var(--teal)">{{ inProgress }}</div>
            <div class="muted" style="font-size:12px">已办结 {{ closedCnt }} 项</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-amber"><ic name="flag" size="28"></ic></div>
          <div class="meta"><div class="label">里程碑节点</div><div class="val" style="color:var(--amber)">{{ milestones.length }}</div>
            <div class="muted" style="font-size:12px">当前选中任务的里程碑</div></div>
        </div>
        <div class="card kpi-card" @click="$root.go('/supervision/warning')">
          <div class="ico ico-red"><ic name="siren" size="28"></ic></div>
          <div class="meta"><div class="label">风险预警</div><div class="val" style="color:var(--red)">{{ redCnt }}</div>
            <div class="muted" style="font-size:12px">红码超期任务需重点跟进</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="sup-d-layout">
        <!-- left: task selector -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">督办任务列表</div><span class="muted" style="font-size:12px">{{ filteredTasks.length }} 项</span></div>
          <div class="card-bd" style="padding-top:8px">
            <input class="input" style="width:100%; margin-bottom:10px" placeholder="搜索任务名称 / 编号" v-model="keyword">
            <div class="sup-task-list">
              <div v-for="t in filteredTasks" :key="t.task_id" class="sup-task-item" :class="{on: t.task_id === selId}" @click="select(t)">
                <i :style="{background: {RED:'#E5484D',YELLOW:'#F59E0B',GREEN:'#13A89E'}[t.warning_level]}" class="sup-up-dot"></i>
                <div style="flex:1; min-width:0">
                  <div class="strong ellipsis" style="font-size:12.5px" :title="t.title">{{ t.title }}</div>
                  <div class="muted num" style="font-size:11px">{{ t.supervision_no }} · {{ t.deadline }}</div>
                </div>
              </div>
              <div v-if="!filteredTasks.length" class="empty">暂无任务</div>
            </div>
          </div>
        </div>

        <!-- right: detail + gantt -->
        <div style="min-width:0">
          <div class="card" style="margin-top:0" v-if="task">
            <div class="card-hd">
              <div class="t">{{ task.title }}</div>
              <div style="display:flex; gap:8px">
                <span :class="['tag', warnTag(task.warning_level)]">{{ warnLabel(task.warning_level) }}</span>
                <span :class="['tag', statusTag(task.status)]">{{ task.status_label }}</span>
              </div>
            </div>
            <div class="card-bd">
              <div class="dtl-meta" style="margin:0 0 4px">
                <span>督办编号：<b class="num">{{ task.supervision_no }}</b></span>
                <span>主办处室：<b>{{ task.lead_dept_name || '—' }}</b></span>
                <span>协办：<b>{{ task.assist_dept_names || '—' }}</b></span>
                <span>分管领导：<b>{{ task.leader_in_charge || '—' }}</b></span>
                <span>办结时限：<b class="num">{{ task.deadline }}</b></span>
                <span>当前进度：<b class="num">{{ task.progress_pct }}%</b></span>
              </div>
              <div class="progress" style="height:10px"><div class="bar" :class="{['bar-amber']: task.warning_level === 'YELLOW', ['bar-red']: task.warning_level === 'RED'}" :style="{width: task.progress_pct + '%'}"></div></div>
              <div class="muted" style="font-size:12px; margin-top:6px" v-if="task.content">{{ task.content }}</div>
            </div>
          </div>
          <div class="card" style="margin-top:0" v-else>
            <div class="card-bd"><div class="empty">请选择左侧督办任务查看里程碑甘特</div></div>
          </div>

          <!-- gantt -->
          <div class="card mt16">
            <div class="card-hd">
              <div class="t">里程碑甘特 <span class="muted" style="font-size:12px; font-weight:400">（{{ ganttRange.start }} ~ {{ ganttRange.end }}）</span></div>
              <button class="btn btn-primary btn-sm" @click="openAdd"><ic name="plus" size="14"></ic>新增里程碑</button>
            </div>
            <div class="card-bd" style="padding-top:6px">
              <div class="gantt-row" style="margin-bottom:4px" v-if="milestones.length">
                <div class="gantt-label" style="font-weight:600">里程碑</div>
                <div class="gantt-track" style="background:transparent; height:20px; border-bottom:1px solid var(--line); border-radius:0">
                  <span v-for="tk in ticks" :key="tk.label" class="gantt-tick" :style="{left: tk.pct + '%'}">{{ tk.label }}</span>
                </div>
                <div style="width:196px; flex:none; font-weight:600; font-size:12.5px; color:var(--text-3)">时限 / 进度 / 操作</div>
              </div>
              <div v-for="(m, idx) in milestones" :key="m.milestone_id" class="gantt-row">
                <div class="gantt-label" :title="m.title" style="width:150px; text-align:left; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ m.title }}</div>
                <div class="gantt-track">
                  <div class="gantt-block" :class="mBlockCls(m.status)" :style="blockStyle(m, idx)">
                    {{ m.progress_pct }}%<span v-if="m.progress_pct >= 100"> ✓</span>
                  </div>
                </div>
                <div style="width:196px; flex:none; display:flex; align-items:center; gap:6px; font-size:12px">
                  <span class="num muted">{{ m.due_date }}</span>
                  <span :class="['tag', mTag(m.status)]">{{ mLabel(m.status) }}</span>
                  <button class="btn btn-text btn-sm" style="padding:2px 4px" @click="edit(m)">编辑</button>
                  <button class="btn btn-text btn-sm danger" style="padding:2px 4px" @click="removeM(m)">删除</button>
                </div>
              </div>
              <div v-if="!milestones.length" class="empty">该任务尚未分解里程碑，点击右上角「新增里程碑」登记阶段节点</div>
              <div class="muted" style="font-size:11.5px; margin-top:8px" v-if="milestones.length">
                图例：<span class="gb-blue gantt-block" style="position:static; display:inline-flex; padding:0 8px; height:18px">进行中</span>
                <span class="gb-green gantt-block" style="position:static; display:inline-flex; padding:0 8px; height:18px; margin-left:8px">已完成</span>
                <span class="gb-gray gantt-block" style="position:static; display:inline-flex; padding:0 8px; height:18px; margin-left:8px">未开始</span>
                <span class="gb-red gantt-block" style="position:static; display:inline-flex; padding:0 8px; height:18px; margin-left:8px">已逾期</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- add milestone modal -->
      <Modal title="新增里程碑" width="520px" v-if="showAdd" @close="showAdd = false">
        <div class="form-item">
          <label class="req">里程碑名称</label>
          <input class="input" maxlength="60" placeholder="如：完成方案评审并报批" v-model="mForm.title">
        </div>
        <div class="form-item">
          <label class="req">时限</label>
          <input type="date" class="input" v-model="mForm.due_date">
        </div>
        <div class="form-item">
          <label>目标交付物</label>
          <textarea class="input" maxlength="200" placeholder="请输入该阶段的目标交付物" v-model="mForm.target_output"></textarea>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showAdd = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitAdd">保存</button>
        </template>
      </Modal>

      <!-- edit milestone modal -->
      <Modal title="更新里程碑进度" width="460px" v-if="editM" @close="editM = null">
        <div class="desc-list" style="margin-bottom:14px">
          <span class="k">里程碑</span><span class="strong">{{ editM.title }}</span>
          <span class="k">时限</span><span class="num">{{ editM.due_date }}</span>
          <span class="k">交付物</span><span>{{ editM.target_output || '—' }}</span>
        </div>
        <div class="form-item">
          <label class="req">完成进度</label>
          <div style="flex:1; display:flex; align-items:center; gap:10px">
            <input type="range" min="0" max="100" step="5" v-model.number="eForm.progress_pct" style="flex:1; accent-color:var(--primary)">
            <input type="number" min="0" max="100" class="input" style="width:76px; flex:none" v-model.number="eForm.progress_pct">
            <span class="strong">%</span>
          </div>
        </div>
        <div class="form-item">
          <label class="req">里程碑状态</label>
          <select class="select" v-model="eForm.status">
            <option value="PENDING">未开始</option>
            <option value="IN_PROGRESS">进行中</option>
            <option value="DONE">已完成</option>
            <option value="OVERDUE">已逾期</option>
          </select>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="editM = null">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="saveEdit">保存</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
