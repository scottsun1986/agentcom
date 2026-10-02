/* /supervision/reporting 进展反馈与台账填报 — pixel replica of design/mockups/026-supervision-reporting.png
   Layout: task selector / (基本信息 + 本期报送信息 | 历史报送记录 timeline) */
AppPages['/supervision/reporting'] = {
  route: '/supervision/reporting', title: '进展反馈与台账填报', category: 'SUPERVISION', primaryAction: '提交报送', icon: 'clipboard-check',
  subtitle: '按要求定期报送项目进展，填报完成情况、阶段性突破、存在困难与需要协调事项。',
  component: {
    data() {
      return {
        loading: true,
        tasks: [],
        selId: '',
        task: null,        // detail with milestones + reports
        periodType: 'WEEKLY',
        pct: 0,
        details: '',
        blockers: '',
        submitting: false,
      };
    },
    computed: {
      reports() {
        const list = (this.task && this.task.reports) || [];
        return list.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
      },
      periodLabel() {
        return { WEEKLY: '周报', HALF_MONTH: '半月报', MONTHLY: '月报', SPECIAL: '专项' }[this.periodType] || this.periodType;
      },
    },
    async mounted() {
      try {
        const r = await api.page('/api/supervision/tasks', { pageNum: 1, pageSize: 200, status: 'IN_PROGRESS' });
        this.tasks = r.rows || [];
      } catch (e) { this.tasks = []; }
      if (this.tasks.length) {
        this.selId = this.tasks[0].task_id;
        await this.loadDetail();
      }
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
      async loadDetail() {
        if (!this.selId) return;
        try {
          const prev = this.task;
          const d = await api.get('/api/supervision/tasks/' + this.selId);
          this.task = d;
          if (prev && prev.task_id === d.task_id) return; // 保留正在填写的内容
          this.pct = d.progress_pct || 0;
          this.details = '';
          this.blockers = '';
        } catch (e) { this.task = null; }
      },
      async changeTask() { await this.loadDetail(); },
      periodTag(t) { return { WEEKLY: 'tag-blue', HALF_MONTH: 'tag-teal', MONTHLY: 'tag-amber', SPECIAL: 'tag-red' }[t] || 'tag-gray'; },
      periodName(t) { return { WEEKLY: '周报', HALF_MONTH: '半月报', MONTHLY: '月报', SPECIAL: '专项' }[t] || t; },
      warnTag(l) { return { GREEN: 'tag-green', YELLOW: 'tag-amber', RED: 'tag-red' }[l] || 'tag-gray'; },
      warnLabel(l) { return { GREEN: '绿码·正常', YELLOW: '黄码·临期预警', RED: '红码·超期' }[l] || l; },
      statusTag(s) { return { IN_PROGRESS: 'tag-blue', EXTENSION_PENDING: 'tag-amber', CLOSE_PENDING: 'tag-teal', CLOSED: 'tag-green', CANCELLED: 'tag-gray', DRAFT: 'tag-gray' }[s] || 'tag-gray'; },
      async submitReport() {
        if (!this.task) return this.$root.toast('请先选择督办任务', 'warn');
        const pct = Number(this.pct);
        if (isNaN(pct) || pct < 0 || pct > 100) return this.$root.toast('完成百分比应在 0-100 之间', 'warn');
        if (!this.details.trim()) return this.$root.toast('请填写阶段性突破 / 进展详情', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/supervision/tasks/' + this.task.task_id + '/reports', {
            period_type: this.periodType, progress_pct: Math.round(pct),
            details: this.details.trim(), blockers: this.blockers.trim() || null,
          });
          this.$root.toast('进展已报送', 'ok');
          await this.loadDetail();
          this.details = '';
          this.blockers = '';
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      onPrimary() { this.submitReport(); },
    },
    template: `
    <div v-if="!loading">
      <!-- task selector -->
      <div class="card">
        <div class="card-bd" style="display:flex; align-items:center; gap:12px; padding:12px 18px">
          <span class="strong">选择督办任务</span>
          <select class="select" style="flex:1; max-width:480px" v-model="selId" @change="changeTask">
            <option v-for="t in tasks" :key="t.task_id" :value="t.task_id">{{ t.supervision_no }}　{{ t.title }}</option>
          </select>
          <span class="muted" style="font-size:12px" v-if="!tasks.length">暂无在办督办任务</span>
        </div>
      </div>

      <div class="sup-r-layout mt16">
        <div style="min-width:0">
          <!-- basic info -->
          <div class="card" style="margin-top:0">
            <div class="card-hd"><div class="t">基本信息</div>
              <div style="display:flex; gap:8px" v-if="task">
                <span :class="['tag', warnTag(task.warning_level)]">{{ warnLabel(task.warning_level) }}</span>
                <span :class="['tag', statusTag(task.status)]">{{ task.status_label }}</span>
              </div>
            </div>
            <div class="card-bd" v-if="task">
              <div class="desc-list" style="grid-template-columns:110px 1fr 110px 1fr; row-gap:12px">
                <span class="k">督办事项名称</span><span class="strong" style="min-width:0">{{ task.title }}</span>
                <span class="k">督办编号</span><span class="num">{{ task.supervision_no }}</span>
                <span class="k">责任单位</span><span>{{ task.lead_dept_name || '—' }}</span>
                <span class="k">牵头领导</span><span>{{ task.leader_in_charge || '—' }}</span>
                <span class="k">计划完成时间</span><span class="num">{{ task.deadline }}</span>
                <span class="k">当前进度</span>
                <span style="display:flex; align-items:center; gap:8px">
                  <div class="progress" style="flex:1"><div class="bar" :class="{['bar-amber']: task.warning_level === 'YELLOW', ['bar-red']: task.warning_level === 'RED'}" :style="{width: task.progress_pct + '%'}"></div></div>
                  <b class="num">{{ task.progress_pct }}%</b>
                </span>
              </div>
            </div>
            <div class="card-bd" v-else><div class="empty">暂无在办督办任务可报送</div></div>
          </div>

          <!-- report form -->
          <div class="card mt16">
            <div class="card-hd"><div class="t">本期报送信息</div></div>
            <div class="card-bd" v-if="task">
              <div class="form-item">
                <label class="req">报送类型</label>
                <div style="flex:1; display:flex; align-items:center; gap:22px; padding-top:7px">
                  <label style="display:inline-flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" value="WEEKLY" v-model="periodType">周报</label>
                  <label style="display:inline-flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" value="HALF_MONTH" v-model="periodType">半月报</label>
                  <label style="display:inline-flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" value="MONTHLY" v-model="periodType">月报</label>
                  <label style="display:inline-flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" value="SPECIAL" v-model="periodType">专项</label>
                </div>
              </div>
              <div class="form-item">
                <label class="req">完成百分比</label>
                <div style="flex:1; display:flex; align-items:center; gap:12px">
                  <input type="range" min="0" max="100" step="5" v-model.number="pct" style="flex:1; accent-color:var(--primary)">
                  <input type="number" min="0" max="100" class="input" style="width:80px; flex:none; text-align:right" v-model.number="pct">
                  <span class="strong">%</span>
                </div>
              </div>
              <div class="form-item">
                <label class="req">阶段性突破</label>
                <div style="flex:1">
                  <textarea class="input" maxlength="500" style="min-height:110px" placeholder="1. 完成的主要工作量；&#10;2. 取得的阶段性突破；&#10;3. 形成的成果文件。" v-model="details"></textarea>
                  <div class="muted" style="text-align:right; font-size:12px">{{ details.length }}/500</div>
                </div>
              </div>
              <div class="form-item">
                <label>存在的困难</label>
                <div style="flex:1">
                  <textarea class="input" maxlength="500" placeholder="填报推进中存在的困难与问题" v-model="blockers"></textarea>
                  <div class="muted" style="text-align:right; font-size:12px">{{ blockers.length }}/500</div>
                </div>
              </div>
              <div style="display:flex; justify-content:flex-end">
                <button class="btn btn-primary" :disabled="submitting" @click="submitReport"><ic name="send" size="14"></ic>提交报送</button>
              </div>
            </div>
            <div class="card-bd" v-else><div class="empty">选择任务后即可填报台账</div></div>
          </div>
        </div>

        <!-- history reports -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">历史报送记录</div><span class="muted" style="font-size:12px">共 {{ reports.length }} 条</span></div>
          <div class="card-bd" style="padding-top:6px">
            <div class="tl" v-if="reports.length">
              <div class="tl-item" v-for="r in reports" :key="r.report_id" :class="r.progress_pct >= 100 ? 'teal' : ''">
                <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">
                  <span :class="['tag', periodTag(r.period_type)]">{{ periodName(r.period_type) }}</span>
                  <span class="strong" style="font-size:13px">完成 <span class="num" style="color:var(--primary)">{{ r.progress_pct }}%</span></span>
                  <span class="tag tag-green">已报送</span>
                </div>
                <div style="font-size:12.5px; color:var(--text-2); margin-top:4px; white-space:pre-wrap">{{ r.details }}</div>
                <div v-if="r.blockers" style="font-size:12px; color:#C77F06; margin-top:4px; display:flex; gap:5px">
                  <ic name="alert-triangle" size="13" style="margin-top:1px"></ic><span>{{ r.blockers }}</span>
                </div>
                <div class="muted" style="font-size:11.5px; margin-top:4px">
                  {{ r.submit_user_name || '—' }} · {{ r.submit_dept_name || '—' }} · {{ bj(r.created_at) }}
                </div>
              </div>
            </div>
            <div v-else class="empty">该任务暂无报送记录，请在左侧填报本期进展</div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
