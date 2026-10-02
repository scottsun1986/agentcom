/* /supervision/closeout 办结销号与现场核验 — pixel replica of design/mockups/029-supervision-closeout.png
   Layout: 4 KPI / (销号申请队列 | 申请详情+销号审批流程) / 申请销号 modal / 已办结销号台账 */
AppPages['/supervision/closeout'] = {
  route: '/supervision/closeout', title: '办结销号与现场核验', category: 'SUPERVISION', primaryAction: '申请销号', icon: 'file-check',
  subtitle: '对已完成的督办任务，按程序提出销号申请、审核销号材料，主管领导签批同意销号，完成全链条闭环。',
  component: {
    data() {
      return {
        loading: true,
        closeouts: [],
        coTotal: 0,
        selId: '',
        selTask: null,
        allTasks: [],
        canAudit: false,
        showApply: false,
        submitting: false,
        form: { task_id: '', closeout_summary: '' },
      };
    },
    computed: {
      stats() {
        const nowM = this.bjDate(new Date().toISOString()).slice(0, 7);
        const closed = this.allTasks.filter((t) => t.status === 'CLOSED');
        return {
          pending: this.coTotal,
          closed: closed.length,
          closedThisMonth: closed.filter((t) => this.bjDate(t.closeout_at).slice(0, 7) === nowM).length,
          inProgress: this.allTasks.filter((t) => t.status === 'IN_PROGRESS').length,
        };
      },
      applyTasks() { return this.allTasks.filter((t) => t.status === 'IN_PROGRESS'); },
      closedTasks() { return this.allTasks.filter((t) => t.status === 'CLOSED'); },
    },
    async mounted() {
      try {
        const info = await api.get('/api/auth/info');
        const perms = info.permissions || [];
        this.canAudit = perms.includes('*:*:*') || perms.includes('supervision:closeout:audit');
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
      bjDate(s) { const v = this.bj(s); return v === '—' ? '' : v.slice(0, 10); },
      async load() {
        try {
          const r = await api.page('/api/supervision/closeouts', { pageNum: 1, pageSize: 100 });
          this.closeouts = r.rows || [];
          this.coTotal = r.total || 0;
        } catch (e) { this.closeouts = []; this.coTotal = 0; }
        try {
          const r2 = await api.page('/api/supervision/tasks', { pageNum: 1, pageSize: 200 });
          this.allTasks = r2.rows || [];
        } catch (e) { this.allTasks = []; }
        if (!this.selId && this.closeouts.length) this.selId = this.closeouts[0].task_id;
        this.selTask = this.closeouts.find((t) => t.task_id === this.selId) || null;
      },
      pick(t) { this.selId = t.task_id; this.selTask = t; },
      warnTag(l) { return { GREEN: 'tag-green', YELLOW: 'tag-amber', RED: 'tag-red' }[l] || 'tag-gray'; },
      warnLabel(l) { return { GREEN: '绿码·正常', YELLOW: '黄码·临期预警', RED: '红码·超期' }[l] || l; },
      async openApply() {
        if (!this.applyTasks.length) return this.$root.toast('暂无在办任务可申请销号', 'warn');
        this.form = { task_id: '', closeout_summary: '' };
        this.showApply = true;
      },
      selApplyTask() { return this.applyTasks.find((t) => t.task_id === this.form.task_id) || null; },
      async submitApply() {
        const f = this.form;
        if (!f.task_id) return this.$root.toast('请选择要销号的督办任务', 'warn');
        if (!f.closeout_summary.trim()) return this.$root.toast('请填写办结销号说明（销号材料摘要）', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/supervision/tasks/' + f.task_id + '/closeout-request', { closeout_summary: f.closeout_summary.trim() });
          this.$root.toast('销号申请已提交，待督查室审核', 'ok');
          this.showApply = false;
          this.selId = f.task_id;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async audit(t, action) {
        const tip = action === 'APPROVE'
          ? '确认审签同意「' + t.title + '」办结销号？通过后任务将办结销号归档。'
          : '确认退回「' + t.title + '」的销号申请？任务将回退为在办。';
        if (!window.confirm(tip)) return;
        this.submitting = true;
        try {
          await api.post('/api/supervision/tasks/' + t.task_id + '/closeout-audit', {
            action, comment: action === 'APPROVE' ? '材料齐全，同意销号' : '材料不齐，退回补充',
          });
          this.$root.toast(action === 'APPROVE' ? '已审签销号，任务办结归档' : '已退回销号申请', 'ok');
          if (this.selId === t.task_id) this.selId = '';
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      onPrimary() { this.openApply(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI -->
      <div class="kpi-row">
        <div class="card kpi-card">
          <div class="ico ico-blue"><ic name="file-text" size="28"></ic></div>
          <div class="meta"><div class="label">待审核销号申请</div><div class="val" style="color:var(--primary)">{{ stats.pending }} <span style="font-size:14px;font-weight:400">件</span></div>
            <div class="muted" style="font-size:12px">销号申请队列待审签</div></div>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-teal"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta"><div class="label">已完成销号</div><div class="val" style="color:var(--teal)">{{ stats.closed }} <span style="font-size:14px;font-weight:400">件</span></div>
            <div class="muted" style="font-size:12px">本月销号 {{ stats.closedThisMonth }} 件</div></div>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-amber"><ic name="scan-search" size="28"></ic></div>
          <div class="meta"><div class="label">现场核验环节</div><div class="val" style="color:var(--amber)">按需</div>
            <div class="muted" style="font-size:12px">必要时组织实地勘查后签批</div></div>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-red"><ic name="play" size="28"></ic></div>
          <div class="meta"><div class="label">在办任务</div><div class="val" style="color:var(--red)">{{ stats.inProgress }} <span style="font-size:14px;font-weight:400">件</span></div>
            <div class="muted" style="font-size:12px">办结后可发起销号申请</div></div>
        </div>
      </div>

      <div class="sup-c-layout">
        <!-- left: closeout queue -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">销号申请队列 <span class="muted" style="font-size:12.5px; font-weight:400">（{{ coTotal }}）</span></div></div>
          <div class="card-bd" style="padding-top:6px">
            <table class="table table-tight">
              <thead><tr><th style="width:40px">序号</th><th>任务名称</th><th>承办部门</th><th style="width:64px">操作</th></tr></thead>
              <tbody>
                <tr v-for="(t, i) in closeouts" :key="t.task_id" :class="{sel: t.task_id === selId}" style="cursor:pointer" @click="pick(t)">
                  <td class="num muted">{{ i + 1 }}</td>
                  <td class="ellipsis strong" style="max-width:150px" :title="t.title">{{ t.title }}</td>
                  <td class="ellipsis" style="max-width:90px">{{ t.lead_dept_name || '—' }}</td>
                  <td class="actions"><button class="btn btn-text btn-sm" @click.stop="pick(t)">审核</button></td>
                </tr>
                <tr v-if="!closeouts.length"><td colspan="4"><div class="empty">暂无待审核销号申请</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- middle: detail -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">销号申请详情</div>
            <span v-if="selTask" class="tag tag-teal"><ic name="scan-search" size="12"></ic>待督查室审核</span>
          </div>
          <div class="card-bd" v-if="selTask">
            <div class="strong" style="font-size:15px; margin-bottom:8px">{{ selTask.title }}</div>
            <div class="dtl-meta" style="margin:0 0 10px">
              <span>督办编号：<b class="num">{{ selTask.supervision_no }}</b></span>
              <span>承办单位：<b>{{ selTask.lead_dept_name || '—' }}</b></span>
              <span>办结时限：<b class="num">{{ selTask.deadline }}</b></span>
              <span>当前进度：<b class="num">{{ selTask.progress_pct }}%</b></span>
              <span>预警状态：<b>{{ warnLabel(selTask.warning_level) }}</b></span>
            </div>
            <div class="sup-summary-box">
              <div class="strong" style="margin-bottom:4px"><ic name="paperclip" size="13"></ic> 销号材料摘要</div>
              <div style="white-space:pre-wrap; font-size:12.5px; color:var(--text-2)">{{ selTask.closeout_summary || '承办单位未填写销号材料摘要' }}</div>
            </div>
            <div v-if="canAudit" style="display:flex; gap:10px; margin-top:14px">
              <button class="btn btn-ghost btn-reject" style="flex:1; justify-content:center" :disabled="submitting" @click="audit(selTask, 'REJECT')"><ic name="rotate-ccw" size="14"></ic>退回补充</button>
              <button class="btn btn-primary" style="flex:1; justify-content:center" :disabled="submitting" @click="audit(selTask, 'APPROVE')"><ic name="check" size="14"></ic>审签销号</button>
            </div>
          </div>
          <div class="card-bd" v-else><div class="empty">请从左侧销号申请队列选择待审任务</div></div>
        </div>

        <!-- right: audit flow -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">销号审批流程</div></div>
          <div class="card-bd">
            <div class="tl">
              <div class="tl-item teal">
                <div class="strong" style="font-size:13px">提交销号申请</div>
                <div class="muted" style="font-size:11.5px">承办单位填报办结情况与销号材料摘要</div>
              </div>
              <div class="tl-item">
                <div class="strong" style="font-size:13px">督查室材料审核</div>
                <div class="muted" style="font-size:11.5px">核对销号材料摘要，材料不全可退回补充</div>
              </div>
              <div class="tl-item amber">
                <div class="strong" style="font-size:13px">组织现场实地勘查</div>
                <div class="muted" style="font-size:11.5px">必要时现场核验整改成效，无重大问题后进入签批</div>
              </div>
              <div class="tl-item">
                <div class="strong" style="font-size:13px">主管领导签批</div>
                <div class="muted" style="font-size:11.5px">审签同意销号，请继续做好后续长效管理</div>
              </div>
              <div class="tl-item gray">
                <div class="strong" style="font-size:13px">完成销号</div>
                <div class="muted" style="font-size:11.5px">任务办结归档，纳入督查简报统计</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- closed ledger -->
      <div class="card mt16">
        <div class="card-hd"><div class="t">已办结销号台账 <span class="muted" style="font-size:12.5px; font-weight:400">（{{ closedTasks.length }}）</span></div></div>
        <div class="card-bd" style="padding-top:6px">
          <table class="table">
            <thead><tr><th style="width:48px">序号</th><th>督办编号</th><th>任务名称</th><th>承办部门</th><th>办结时限</th><th>销号时间</th><th>审签人</th><th style="width:110px">销号状态</th></tr></thead>
            <tbody>
              <tr v-for="(t, i) in closedTasks" :key="t.task_id">
                <td class="num muted">{{ i + 1 }}</td>
                <td class="num">{{ t.supervision_no }}</td>
                <td class="ellipsis strong" style="max-width:240px" :title="t.title">{{ t.title }}</td>
                <td>{{ t.lead_dept_name || '—' }}</td>
                <td class="num muted">{{ t.deadline }}</td>
                <td class="num muted">{{ bjDate(t.closeout_at) }}</td>
                <td>{{ t.closeout_approved_by || '—' }}</td>
                <td><span class="stamp-seal">已销号<i>{{ bjDate(t.closeout_at) }}</i></span></td>
              </tr>
              <tr v-if="!closedTasks.length"><td colspan="8"><div class="empty">暂无已办结销号任务</div></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- apply modal -->
      <Modal title="申请办结销号" width="560px" v-if="showApply" @close="showApply = false">
        <div class="form-item">
          <label class="req">督办任务</label>
          <select class="select" v-model="form.task_id">
            <option value="">请选择在办督办任务</option>
            <option v-for="t in applyTasks" :key="t.task_id" :value="t.task_id">{{ t.supervision_no }}　{{ t.title }}</option>
          </select>
        </div>
        <div class="form-item" v-if="selApplyTask()">
          <label>当前进度</label>
          <div style="flex:1; padding-top:7px" class="num strong">{{ selApplyTask().progress_pct }}%　<span class="muted" style="font-weight:400">办结时限 {{ selApplyTask().deadline }}</span></div>
        </div>
        <div class="form-item">
          <label class="req">销号材料摘要</label>
          <textarea class="input" maxlength="500" style="min-height:110px" placeholder="请填报办结情况、成果文件与销号材料摘要，供督查室审核与现场核验" v-model="form.closeout_summary"></textarea>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showApply = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitApply">提交销号申请</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
