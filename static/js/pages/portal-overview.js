/* /portal/overview 工作总览 — pixel replica of design/mockups/001-portal-overview.png
   Layout: 4 KPI cards / (我的待办 table | 今日安排) / (重点工作进展 | 跨模块协同) */
AppPages['/portal/overview'] = {
  route: '/portal/overview', title: '工作总览', category: 'PORTAL', primaryAction: '发起申请',
  component: {
    data() {
      return {
        loading: true,
        kpi: { todos: 0, meetings: 0, supervision: 0, warnings: 0 },
        todoTab: 'all',
        todos: [],
        todoCounts: { all: 0, pending: 0, executing: 0, feedback: 0 },
        agenda: [],
        keyTasks: [],
        warnings: [],
        crossFlow: [
          { name: '调研立项', desc: '发起调研任务\n明确调研主题和计划', icon: 'file-plus', color: 'blue', step: 'done' },
          { name: '车辆保障', desc: '提交用车申请\n完成车辆调度', icon: 'car', color: 'teal', step: 'done' },
          { name: '考勤报备', desc: '外出考勤报备\n同步日程信息', icon: 'clipboard-check', color: 'blue', step: 'doing' },
          { name: '问题督办', desc: '生成督办事项\n跟踪整改落实', icon: 'target', color: 'amber', step: 'wait' },
        ],
        greeting: '',
      };
    },
    computed: {
      shownTodos() {
        if (this.todoTab === 'all') return this.todos.slice(0, 5);
        if (this.todoTab === 'pending') return this.todos.filter((t) => t.category === '待审批').slice(0, 5);
        if (this.todoTab === 'executing') return this.todos.filter((t) => t.category === '待执行').slice(0, 5);
        return this.todos.filter((t) => t.category === '待反馈').slice(0, 5);
      },
      hourGreet() {
        const h = new Date().getHours();
        if (h < 6) return '凌晨好';
        if (h < 9) return '上午好';
        if (h < 12) return '上午好';
        if (h < 14) return '中午好';
        if (h < 18) return '下午好';
        return '晚上好';
      },
    },
    async mounted() {
      try {
        const d = await api.get('/api/portal/overview');
        this.kpi = d.kpi;
        this.todos = d.todos || [];
        this.todoCounts = d.todo_counts || this.todoCounts;
        this.agenda = d.agenda || [];
        this.keyTasks = d.key_tasks || [];
        this.warnings = d.warnings || [];
        this.greeting = d.greeting_name || '';
      } catch (e) { /* toast already shown */ }
      this.loading = false;
    },
    methods: {
      statusTag(cat) {
        return { '待审批': 'tag-amber', '待执行': 'tag-blue', '待反馈': 'tag-red' }[cat] || 'tag-gray';
      },
      warnTag(level) {
        return { GREEN: 'tag-green', YELLOW: 'tag-amber', RED: 'tag-red' }[level] || 'tag-gray';
      },
      warnLabel(level) {
        return { GREEN: '正常', YELLOW: '临期预警', RED: '已超期' }[level] || level;
      },
      barColor(level) {
        return { GREEN: 'bar-teal', YELLOW: 'bar-amber', RED: 'bar-red' }[level] || 'bar-teal';
      },
      todoIcon(t) {
        return { leave: 'file-text', trip: 'map-pin', remedy: 'rotate-ccw', asset_req: 'box', consumable_req: 'package', fleet: 'car', visitor: 'users', visitor_host: 'users', supervision: 'target' }[t.kind] || 'file-text';
      },
      todoIconCls(t) {
        return { leave: 'ico-blue', trip: 'ico-teal', remedy: 'ico-amber', asset_req: 'ico-blue', consumable_req: 'ico-teal', fleet: 'ico-red', visitor: 'ico-teal', visitor_host: 'ico-teal', supervision: 'ico-amber' }[t.kind] || 'ico-blue';
      },
      stepTag(s) {
        return { done: 'tag-green', doing: 'tag-blue', wait: 'tag-gray' }[s] || 'tag-gray';
      },
      stepLabel(s) {
        return { done: '已完成', doing: '进行中', wait: '待开始' }[s] || s;
      },
      openTodo(t) { location.hash = '#' + t.link; },
      onPrimary() { location.hash = '#/portal/tasks'; },
    },
    template: `
    <div v-if="!loading">
      <!-- greeting -->
      <div class="page-sub" style="margin-bottom:14px; font-size:14px">
        <b>{{ greeting }}，{{ hourGreet }}！</b>　祝您工作顺利，今天共有 <b>{{ kpi.todos }}</b> 项待办、<b>{{ kpi.meetings }}</b> 场会议。
      </div>

      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" @click="$root.go('/portal/tasks')">
          <div class="ico ico-blue"><ic name="clipboard-list" size="28"></ic></div>
          <div class="meta"><div class="label">待办审批</div><div class="val" style="color:var(--primary)">{{ kpi.todos }}</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/conference/schedule')">
          <div class="ico ico-teal"><ic name="calendar-days" size="28"></ic></div>
          <div class="meta"><div class="label">今日会议</div><div class="val" style="color:var(--teal)">{{ kpi.meetings }}</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/supervision/dashboard')">
          <div class="ico ico-amber"><ic name="target" size="28"></ic></div>
          <div class="meta"><div class="label">重点督办</div><div class="val" style="color:var(--amber)">{{ kpi.supervision }}</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/supervision/warning')">
          <div class="ico ico-red"><ic name="siren" size="28"></ic></div>
          <div class="meta"><div class="label">待处理预警</div><div class="val" style="color:var(--red)">{{ kpi.warnings }}</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="split-3-2">
        <!-- my todos -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">我的待办
              <span class="lr-tabs" style="margin:0 0 0 14px; display:inline-flex; gap:14px">
                <span :class="['tag', todoTab==='all' ? 'tag-blue' : 'tag-gray']" style="cursor:pointer" @click="todoTab='all'">全部 ({{ todoCounts.all }})</span>
                <span :class="['tag', todoTab==='pending' ? 'tag-blue' : 'tag-gray']" style="cursor:pointer" @click="todoTab='pending'">待审批 ({{ todoCounts.pending }})</span>
                <span :class="['tag', todoTab==='executing' ? 'tag-blue' : 'tag-gray']" style="cursor:pointer" @click="todoTab='executing'">待执行 ({{ todoCounts.executing }})</span>
              </span>
            </div>
            <span class="more" @click="$root.go('/portal/tasks')">查看更多 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd" style="padding-top:8px">
            <table class="table">
              <thead><tr><th>事项名称</th><th>申请人</th><th>所属部门</th><th>提交时间</th><th>当前状态</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="t in shownTodos" :key="t.kind + t.id">
                  <td>
                    <span class="card" style="display:inline-flex;padding:0;border:none">
                      <span :class="['ico-box', todoIconCls(t)]" style="display:inline-flex;width:26px;height:26px;border-radius:6px;align-items:center;justify-content:center;margin-right:8px"><ic :name="todoIcon(t)" size="16"></ic></span>
                    </span>{{ t.title }}
                  </td>
                  <td>{{ t.applicant }}</td>
                  <td>{{ t.dept || '—' }}</td>
                  <td class="muted">{{ t.submitted_at ? t.submitted_at.slice(0,16).replace('T',' ') : '—' }}</td>
                  <td><span :class="['tag', statusTag(t.category)]">{{ t.status }}</span></td>
                  <td class="actions"><button class="btn btn-primary btn-sm" @click="openTodo(t)">处理</button></td>
                </tr>
                <tr v-if="!shownTodos.length"><td colspan="6"><div class="empty">暂无待办事项 🎉</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- today agenda -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">今日安排</div>
            <span class="more" @click="$root.go('/portal/calendar')">查看更多 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd">
            <div class="tl">
              <div class="tl-item" v-for="(a, i) in agenda" :key="i" :class="i % 3 === 1 ? 'teal' : i % 3 === 2 ? 'amber' : ''">
                <div style="display:flex; justify-content:space-between; align-items:center">
                  <span class="strong" style="font-size:13px">{{ a.time }}</span>
                  <span :class="['tag', a.type === '会议' ? 'tag-blue' : a.type === '调研' ? 'tag-teal' : 'tag-amber']">{{ a.type }}</span>
                </div>
                <div class="strong" style="margin-top:2px">{{ a.title }}</div>
                <div class="muted" style="font-size:12px; margin-top:1px"><ic name="map-pin" size="12"></ic> {{ a.location || '待定' }}</div>
              </div>
              <div v-if="!agenda.length" class="empty">今日暂无安排</div>
            </div>
          </div>
        </div>
      </div>

      <div class="split-3-2 mt16">
        <!-- key tasks -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">重点工作进展</div>
            <span class="more" @click="$root.go('/supervision/dashboard')">查看更多 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd" style="padding-top:6px">
            <table class="table">
              <thead><tr><th>工作事项</th><th style="width:180px">进展情况</th><th style="width:70px">完成率</th><th style="width:100px">状态</th><th style="width:100px">预计完成</th></tr></thead>
              <tbody>
                <tr v-for="t in keyTasks" :key="t.task_id">
                  <td class="ellipsis" :title="t.title">{{ t.title }}</td>
                  <td><div class="progress"><div class="bar" :class="barColor(t.warning_level)" :style="{width: t.progress_pct + '%'}"></div></div></td>
                  <td class="num">{{ t.progress_pct }}%</td>
                  <td><span :class="['tag', warnTag(t.warning_level)]">
                    <ic :name="t.warning_level==='RED' ? 'siren' : t.warning_level==='YELLOW' ? 'alert-triangle' : 'check-circle-2'" size="12"></ic>
                    {{ warnLabel(t.warning_level) }}</span></td>
                  <td class="muted">{{ t.deadline }}</td>
                </tr>
                <tr v-if="!keyTasks.length"><td colspan="5"><div class="empty">暂无重点工作</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- cross module flow -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">跨模块协同</div>
            <span class="more" @click="$root.go('/portal/assistant')">查看更多 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd">
            <div style="display:grid; grid-template-columns:repeat(4, 1fr); gap:6px; align-items:stretch">
              <div v-for="(f, i) in crossFlow" :key="f.name" style="text-align:center; position:relative">
                <div :class="['ico-box', 'ico-' + f.color]" style="width:44px;height:44px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center">
                  <ic :name="f.icon" size="22"></ic>
                </div>
                <div class="strong" style="margin-top:6px">{{ f.name }}</div>
                <div class="muted" style="font-size:11px; white-space:pre-line; margin-top:2px">{{ f.desc }}</div>
                <span :class="['tag', stepTag(f.step)]" style="margin-top:6px">
                  <ic :name="f.step==='done' ? 'check-circle-2' : f.step==='doing' ? 'clock' : 'circle-help'" size="12"></ic>{{ stepLabel(f.step) }}
                </span>
                <div v-if="i < crossFlow.length-1" style="position:absolute; right:-8px; top:18px; color:#B6C3D2"><ic name="arrow-right" size="16"></ic></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
