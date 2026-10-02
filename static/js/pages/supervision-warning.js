/* /supervision/warning 动态预警与智能催办 — pixel replica of design/mockups/027-supervision-warning-v2.png
   Layout: 3 warning stat cards / (预警任务清单 table | 预警分布 donut + 催办通知单预览) */
AppPages['/supervision/warning'] = {
  route: '/supervision/warning', title: '动态预警与智能催办', category: 'SUPERVISION', primaryAction: '刷新预警', icon: 'bell',
  subtitle: '红黄绿三色动态预警督办任务，对临期、超期事项一键下发催办通知单。',
  component: {
    data() {
      return {
        loading: true,
        tasks: [],
        filterLevel: '',
        keyword: '',
        selIds: [],
        selTask: null,
        refreshInfo: null,
        refreshing: false,
        urging: false,
        urgeChannels: { sms: true, inbox: true, agent: true },
      };
    },
    computed: {
      activeTasks() {
        return this.tasks.filter((t) => t.status === 'IN_PROGRESS');
      },
      counts() {
        return {
          GREEN: this.activeTasks.filter((t) => t.warning_level === 'GREEN').length,
          YELLOW: this.activeTasks.filter((t) => t.warning_level === 'YELLOW').length,
          RED: this.activeTasks.filter((t) => t.warning_level === 'RED').length,
        };
      },
      total() { return this.activeTasks.length; },
      pctOf() {
        const t = this.total || 1;
        return {
          GREEN: Math.round(this.counts.GREEN / t * 100),
          YELLOW: Math.round(this.counts.YELLOW / t * 100),
          RED: Math.round(this.counts.RED / t * 100),
        };
      },
      donutSegs() {
        const total = this.total || 1;
        const C = 2 * Math.PI * 54;
        const segs = [];
        let acc = 0;
        [['GREEN', '#246BFD'], ['YELLOW', '#F59E0B'], ['RED', '#E5484D']].forEach(([k, color]) => {
          const n = this.counts[k];
          if (!n) return;
          const frac = n / total;
          segs.push({ color, dash: (frac * C).toFixed(2), gap: (C - frac * C).toFixed(2), offset: (-acc * C).toFixed(2) });
          acc += frac;
        });
        return segs;
      },
      filtered() {
        const kw = (this.keyword || '').trim().toLowerCase();
        return this.activeTasks.filter((t) => {
          if (this.filterLevel && t.warning_level !== this.filterLevel) return false;
          if (kw && !(t.title + t.supervision_no + (t.lead_dept_name || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      allChecked() { return this.filtered.length > 0 && this.filtered.every((t) => this.selIds.includes(t.task_id)); },
      noticeText() {
        const t = this.selTask;
        if (!t) return '请在左侧预警任务清单中选择任务，系统将自动生成督查催办通知单。';
        const days = t.days_left < 0 ? '已超期 ' + (-t.days_left) + ' 天' : '剩余 ' + t.days_left + ' 天';
        return '【督查催办通知单】' + (t.lead_dept_name || '承办部门') + '：贵部门承办的督办事项【' + t.supervision_no + '】'
          + t.title + ' 办结时限为 ' + t.deadline + '，当前进度 ' + t.progress_pct + '%（'
          + (t.warning_label || '') + '，' + days + '），请加快推进并按周期报送进展，逾期将纳入督查通报。';
      },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      async load() {
        try {
          const r = await api.page('/api/supervision/tasks', { pageNum: 1, pageSize: 200, status: 'IN_PROGRESS' });
          this.tasks = r.rows || [];
        } catch (e) { this.tasks = []; }
        if (!this.selTask && this.tasks.length) {
          const warn = this.tasks.find((t) => t.warning_level === 'RED') || this.tasks.find((t) => t.warning_level === 'YELLOW') || this.tasks[0];
          this.selTask = warn;
        }
        if (this.selTask && !this.tasks.some((t) => t.task_id === this.selTask.task_id)) {
          this.selTask = this.tasks[0] || null;
        }
        this.selIds = this.selIds.filter((id) => this.tasks.some((t) => t.task_id === id));
      },
      async refresh() {
        this.refreshing = true;
        try {
          const d = await api.post('/api/supervision/warning/refresh');
          this.refreshInfo = d;
          this.$root.toast('预警已刷新：正常 ' + d.GREEN + ' · 临期 ' + d.YELLOW + ' · 超期 ' + d.RED, 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
        this.refreshing = false;
      },
      warnTag(l) { return { GREEN: 'tag-blue', YELLOW: 'tag-amber', RED: 'tag-red' }[l] || 'tag-gray'; },
      warnLabel(l) { return { GREEN: '正常推进', YELLOW: '临期预警', RED: '超期告警' }[l] || l; },
      barCls(l) { return { GREEN: '', YELLOW: 'bar-amber', RED: 'bar-red' }[l] || ''; },
      daysColor(t) { return t.days_left < 0 ? 'color:var(--red)' : t.days_left <= 7 ? 'color:#C77F06' : 'color:var(--primary)'; },
      daysText(t) { return t.days_left < 0 ? '已超期 ' + (-t.days_left) + ' 天' : '剩余 ' + t.days_left + ' 天'; },
      rowCls(t) { return t.warning_level === 'RED' ? 'row-red' : ''; },
      toggleAll() {
        if (this.allChecked) this.selIds = [];
        else this.selIds = this.filtered.map((t) => t.task_id);
      },
      toggleOne(t) {
        this.selIds = this.selIds.includes(t.task_id)
          ? this.selIds.filter((x) => x !== t.task_id)
          : this.selIds.concat([t.task_id]);
      },
      pick(t) { this.selTask = t; },
      async urge(t) {
        if (!t) return this.$root.toast('请先选择要催办的任务', 'warn');
        if (!window.confirm('确认向「' + (t.lead_dept_name || '承办部门') + '」下发【' + t.supervision_no + '】催办通知单？')) return;
        this.urging = true;
        try {
          await api.post('/api/supervision/tasks/' + t.task_id + '/urge');
          this.$root.toast('催办通知已下发至 ' + (t.lead_dept_name || '承办部门'), 'ok');
        } catch (e) { /* toast shown */ }
        this.urging = false;
      },
      async urgeSelected() {
        const list = this.activeTasks.filter((t) => this.selIds.includes(t.task_id));
        if (!list.length) return this.$root.toast('请先勾选要催办的任务', 'warn');
        if (!window.confirm('确认对已勾选的 ' + list.length + ' 项任务批量下发催办通知单？')) return;
        this.urging = true;
        let ok = 0;
        for (const t of list) {
          try { await api.post('/api/supervision/tasks/' + t.task_id + '/urge'); ok++; } catch (e) { /* continue */ }
        }
        this.$root.toast('已下发 ' + ok + '/' + list.length + ' 份催办通知单', ok === list.length ? 'ok' : 'warn');
        this.urging = false;
      },
      onPrimary() { this.refresh(); },
    },
    template: `
    <div v-if="!loading">
      <!-- warning stat cards -->
      <div class="sup-3col" style="margin-bottom:16px">
        <div class="card kpi-card" style="margin-top:0" @click="filterLevel = ''; keyword = ''">
          <div class="ico ico-blue"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta">
            <div class="label">正常推进</div>
            <div class="val" style="color:var(--primary)">{{ counts.GREEN }} <span style="font-size:14px;font-weight:400">项</span></div>
            <div class="muted" style="font-size:12px">占比 {{ pctOf.GREEN }}%</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="margin-top:0" @click="filterLevel = 'YELLOW'">
          <div class="ico ico-amber"><ic name="clock" size="28"></ic></div>
          <div class="meta">
            <div class="label">临期预警</div>
            <div class="val" style="color:var(--amber)">{{ counts.YELLOW }} <span style="font-size:14px;font-weight:400">项</span></div>
            <div class="muted" style="font-size:12px">距办结时限 ≤ 7 天，点击筛选</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="margin-top:0" @click="filterLevel = 'RED'">
          <div class="ico ico-red"><ic name="siren" size="28"></ic></div>
          <div class="meta">
            <div class="label">超期告警</div>
            <div class="val" style="color:var(--red)">{{ counts.RED }} <span style="font-size:14px;font-weight:400">项</span></div>
            <div class="muted" style="font-size:12px">已超过办结时限，点击筛选</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="sup-r-layout">
        <!-- warning task list -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">预警任务清单
              <span v-if="refreshInfo" class="tag tag-gray" style="margin-left:8px">
                已刷新 {{ refreshInfo.refreshed }} 项：绿 {{ refreshInfo.GREEN }} / 黄 {{ refreshInfo.YELLOW }} / 红 {{ refreshInfo.RED }}
              </span>
            </div>
            <span class="muted" style="font-size:12px">共 {{ filtered.length }} 项</span>
          </div>
          <div class="card-bd" style="padding-top:8px">
            <div class="filters">
              <select class="select" style="width:130px" v-model="filterLevel">
                <option value="">全部预警状态</option>
                <option value="RED">红码·超期</option>
                <option value="YELLOW">黄码·临期预警</option>
                <option value="GREEN">绿码·正常</option>
              </select>
              <input class="input" style="flex:1; min-width:180px" placeholder="请输入任务名称、编号或承办部门" v-model="keyword">
              <button class="btn btn-primary" :disabled="urging" @click="urgeSelected"><ic name="megaphone" size="14"></ic>一键催办所选</button>
            </div>
            <table class="table">
              <thead><tr>
                <th style="width:36px"><input type="checkbox" :checked="allChecked" @change="toggleAll"></th>
                <th>预警状态</th><th>任务名称</th><th>承办部门</th><th>办结时限</th><th>剩余天数</th><th style="width:120px">当前进度</th><th style="width:110px">操作</th>
              </tr></thead>
              <tbody>
                <tr v-for="t in filtered" :key="t.task_id" :class="rowCls(t)" @click="pick(t)" style="cursor:pointer">
                  <td @click.stop><input type="checkbox" :checked="selIds.includes(t.task_id)" @change="toggleOne(t)"></td>
                  <td><span :class="['tag', warnTag(t.warning_level)]">
                    <ic :name="t.warning_level === 'RED' ? 'siren' : t.warning_level === 'YELLOW' ? 'alert-triangle' : 'check-circle-2'" size="12"></ic>
                    {{ warnLabel(t.warning_level) }}</span></td>
                  <td class="ellipsis strong" style="max-width:200px" :title="t.title">{{ t.title }}</td>
                  <td>{{ t.lead_dept_name || '—' }}</td>
                  <td class="num muted">{{ t.deadline }}</td>
                  <td class="num strong" :style="daysColor(t)">{{ daysText(t) }}</td>
                  <td><div style="display:flex; align-items:center; gap:8px"><div class="progress" style="flex:1"><div class="bar" :class="barCls(t.warning_level)" :style="{width: t.progress_pct + '%'}"></div></div><span class="num" style="font-size:12px">{{ t.progress_pct }}%</span></div></td>
                  <td class="actions">
                    <button class="btn btn-text btn-sm" @click.stop="urge(t)">催办</button>
                    <button class="btn btn-text btn-sm" @click.stop="pick(t)">详情</button>
                  </td>
                </tr>
                <tr v-if="!filtered.length"><td colspan="8"><div class="empty">暂无符合条件的预警任务</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- right column -->
        <div style="min-width:0; display:flex; flex-direction:column; gap:16px">
          <div class="card" style="margin-top:0">
            <div class="card-hd"><div class="t">当前任务预警分布</div></div>
            <div class="card-bd" style="display:flex; align-items:center; gap:10px">
              <div class="sup-donut">
                <svg viewBox="0 0 140 140" width="120" height="120">
                  <circle cx="70" cy="70" r="54" fill="none" stroke="#E8EDF3" stroke-width="20"></circle>
                  <circle v-for="(s, i) in donutSegs" :key="i" cx="70" cy="70" r="54" fill="none" :stroke="s.color"
                    stroke-width="20" :stroke-dasharray="s.dash + ' ' + s.gap" :stroke-dashoffset="s.offset"
                    style="transform:rotate(90deg); transform-origin:70px 70px"></circle>
                  <text x="70" y="66" text-anchor="middle" font-size="22" font-weight="700" fill="#102A43">{{ total }}</text>
                  <text x="70" y="86" text-anchor="middle" font-size="10.5" fill="#829AB1">督办任务总数</text>
                </svg>
              </div>
              <div style="flex:1; display:flex; flex-direction:column; gap:9px">
                <div v-for="k in ['GREEN','YELLOW','RED']" :key="k" style="display:flex; align-items:center; gap:7px">
                  <i :style="{background: {GREEN:'#246BFD',YELLOW:'#F59E0B',RED:'#E5484D'}[k], width:'9px',height:'9px',borderRadius:'50%',display:'inline-block'}"></i>
                  <span class="sub" style="flex:1; font-size:12px">{{ warnLabel(k) }}</span>
                  <b class="num" style="font-size:14px">{{ counts[k] }}</b>
                  <span class="muted num" style="font-size:11.5px; width:36px; text-align:right">{{ pctOf[k] }}%</span>
                </div>
                <div v-if="!total" class="empty" style="padding:4px 0">暂无在办任务</div>
              </div>
            </div>
          </div>

          <div class="card" style="margin-top:0">
            <div class="card-hd"><div class="t">催办通知单预览</div><span class="tag tag-blue">实时生成</span></div>
            <div class="card-bd">
              <div class="sup-notice">
                <div class="sup-notice-title">督查催办通知单</div>
                <div class="muted num" style="text-align:center; font-size:11.5px" v-if="selTask">督办（{{ new Date().getFullYear() }}）{{ selTask.supervision_no }}</div>
                <div class="divider" style="margin:8px 0"></div>
                <div class="desc-list" style="grid-template-columns:80px 1fr; row-gap:7px; font-size:12.5px" v-if="selTask">
                  <span class="k">责任部门</span><span class="strong">{{ selTask.lead_dept_name || '—' }}</span>
                  <span class="k">任务名称</span><span>{{ selTask.title }}</span>
                  <span class="k">计划完成时间</span><span class="num">{{ selTask.deadline }}</span>
                  <span class="k">当前进度</span><span class="num">{{ selTask.progress_pct }}%　<span :style="daysColor(selTask)">{{ daysText(selTask) }}</span></span>
                </div>
                <div class="sup-notice-body" style="margin-top:10px">{{ noticeText }}</div>
              </div>
              <div class="muted" style="font-size:12px; margin:12px 0 6px">选择催办方式</div>
              <div style="display:flex; gap:14px; flex-wrap:wrap; font-size:12.5px">
                <label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer"><input type="checkbox" v-model="urgeChannels.sms">短信通知</label>
                <label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer"><input type="checkbox" v-model="urgeChannels.inbox">站内信</label>
                <label style="display:inline-flex; align-items:center; gap:4px; cursor:pointer"><input type="checkbox" v-model="urgeChannels.agent">Agent 电话语音</label>
              </div>
              <button class="btn btn-primary" style="width:100%; justify-content:center; margin-top:12px" :disabled="urging || !selTask" @click="urge(selTask)">
                <ic name="send" size="14"></ic>下发催办通知单{{ selIds.length ? '（已选择 ' + selIds.length + ' 项任务）' : '' }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
