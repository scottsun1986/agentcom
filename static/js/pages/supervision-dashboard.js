/* /supervision/dashboard 督办指挥大屏 — pixel replica of design/mockups/023-supervision-dashboard.png
   Layout: greeting / 4 KPI / (预警状态分布 donut | 办结趋势 line | 承办部门排行榜) / (重点督办事项清单 | 即将到期事项) */
AppPages['/supervision/dashboard'] = {
  route: '/supervision/dashboard', title: '督办指挥大屏', category: 'SUPERVISION', primaryAction: '新增督办事项', icon: 'gauge',
  subtitle: '',
  component: {
    data() {
      return {
        loading: true,
        userName: '',
        greeting: '',
        kpi: { total: 0, handling: 0, on_time_rate: 0, red: 0, closed: 0, in_progress: 0, on_time_closed: 0 },
        dist: { GREEN: 0, YELLOW: 0, RED: 0 },
        trend: [],           // [{month, closed_count, new_count}]
        ranking: [],         // [{dept_name, closed_count, total, rate}]
        tasks: [],           // all tasks (for list / upcoming)
        listTab: 'all',
        detail: null,
      };
    },
    computed: {
      activeTasks() {
        return this.tasks.filter((t) => !['CLOSED', 'CANCELLED'].includes(t.status));
      },
      distTotal() { const d = this.dist || {}; return (Number(d.GREEN) || 0) + (Number(d.YELLOW) || 0) + (Number(d.RED) || 0); },
      donutSegs() {
        const total = this.distTotal || 1;
        const C = 2 * Math.PI * 54;
        const segs = [];
        let acc = 0;
        const order = [['GREEN', '#246BFD'], ['YELLOW', '#F59E0B'], ['RED', '#E5484D']];
        order.forEach(([k, color]) => {
          const n = this.dist[k] || 0;
          if (!n) return;
          const frac = n / total;
          segs.push({ color, dash: (frac * C).toFixed(2), gap: (C - frac * C).toFixed(2), offset: (-acc * C).toFixed(2), label: k, count: n });
          acc += frac;
        });
        return segs;
      },
      trendMax() {
        let m = 4;
        this.trend.forEach((t) => { m = Math.max(m, t.closed_count, t.new_count); });
        return Math.ceil(m / 10) * 10;
      },
      trendPts() {
        const W = 560, H = 170, padL = 34, padB = 24, padT = 8, n = Math.max(1, this.trend.length - 1);
        const x = (i) => padL + (W - padL - 10) * (i / n);
        const y = (v) => padT + (H - padB - padT) * (1 - v / this.trendMax);
        const line = (key) => this.trend.map((t, i) => x(i).toFixed(1) + ',' + y(t[key]).toFixed(1)).join(' ');
        return { W, H, padL, padB, x, y, line, dots: (key) => this.trend.map((t, i) => ({ cx: x(i).toFixed(1), cy: y(t[key]).toFixed(1), v: t[key], month: t.month })) };
      },
      gridLines() {
        const max = this.trendMax, step = max / 4, out = [];
        for (let i = 0; i <= 4; i++) out.push({ v: Math.round(max - step * i), y: this.trendPts.y(max - step * i).toFixed(1) });
        return out;
      },
      rankMax() { return Math.max(1, ...this.ranking.map((r) => r.closed_count)); },
      listTabs() {
        return [
          { key: 'all', label: '全部', count: this.activeTasks.length },
          { key: 'RED', label: '红色预警', count: this.activeTasks.filter((t) => t.warning_level === 'RED').length },
          { key: 'YELLOW', label: '黄色预警', count: this.activeTasks.filter((t) => t.warning_level === 'YELLOW').length },
          { key: 'GREEN', label: '正常推进', count: this.activeTasks.filter((t) => t.warning_level === 'GREEN').length },
        ];
      },
      shownTasks() {
        const rows = this.listTab === 'all' ? this.activeTasks : this.activeTasks.filter((t) => t.warning_level === this.listTab);
        return rows.slice(0, 8);
      },
      upcoming() {
        return this.activeTasks.slice().sort((a, b) => a.deadline.localeCompare(b.deadline)).slice(0, 6);
      },
    },
    async mounted() {
      const u = api.cachedUser();
      this.userName = (u && u.nick_name) || '';
      const h = new Date().getHours();
      this.greeting = h < 12 ? '上午好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好';
      await this.load();
      this.loading = false;
    },
    methods: {
      pct(k) {
        const d = this.dist || {};
        const total = (Number(d.GREEN) || 0) + (Number(d.YELLOW) || 0) + (Number(d.RED) || 0) || 1;
        return Math.round((Number(d[k]) || 0) / total * 1000) / 10;
      },
      monthKey(s) { return this.bjDate(s).slice(0, 7); },
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
          const d = await api.get('/api/supervision/dashboard');
          this.kpi = {
            total: d.total || 0, handling: d.handling || 0, on_time_rate: d.on_time_rate || 0,
            closed: d.closed || 0, in_progress: d.in_progress || 0, on_time_closed: d.on_time_closed || 0,
            red: (d.warning_distribution && d.warning_distribution.RED) || 0,
          };
          this.dist = Object.assign({ GREEN: 0, YELLOW: 0, RED: 0 }, d.warning_distribution || {});
          const base = (d.closed_trend || []).map((t) => ({ month: t.month, closed_count: t.closed_count, new_count: 0 }));
          try {
            const r = await api.page('/api/supervision/tasks', { pageNum: 1, pageSize: 200 });
            this.tasks = r.rows || [];
            const created = {};
            this.tasks.forEach((t) => {
              const m = this.monthKey(t.created_at);
              if (m) created[m] = (created[m] || 0) + 1;
            });
            base.forEach((t) => { t.new_count = created[t.month] || 0; });
          } catch (e) { this.tasks = []; }
          this.trend = base;
          const totals = {};
          (this.tasks || []).forEach((t) => {
            const k = t.lead_dept_name || '未知部门';
            totals[k] = totals[k] || { total: 0, closed: 0 };
            totals[k].total++;
            if (t.status === 'CLOSED') totals[k].closed++;
          });
          this.ranking = (d.dept_ranking || []).map((x) => {
            const st = totals[x.dept_name] || { total: 0, closed: 0 };
            return { dept_name: x.dept_name || '未知部门', closed_count: x.closed_count, total: st.total, rate: st.total ? Math.round(st.closed / st.total * 100) : 0 };
          }).slice(0, 5);
        } catch (e) { /* toast shown, keep empty state */ }
      },
      distTag(k) { return { GREEN: 'tag-blue', YELLOW: 'tag-amber', RED: 'tag-red' }[k] || 'tag-gray'; },
      distLabel(k) { return { GREEN: '正常推进', YELLOW: '黄色预警（临近到期）', RED: '红色预警（超期）' }[k] || k; },
      warnTag(l) { return { GREEN: 'tag-blue', YELLOW: 'tag-amber', RED: 'tag-red' }[l] || 'tag-gray'; },
      warnLabel(l) { return { GREEN: '正常推进', YELLOW: '临近到期', RED: '已超期' }[l] || l; },
      barCls(l) { return { GREEN: '', YELLOW: 'bar-amber', RED: 'bar-red' }[l] || ''; },
      daysColor(t) {
        if (t.warning_level === 'RED') return 'color:var(--red)';
        if (t.warning_level === 'YELLOW') return 'color:#C77F06';
        return 'color:var(--primary)';
      },
      daysText(t) { return t.days_left < 0 ? '超 ' + (-t.days_left) + ' 天' : '剩 ' + t.days_left + ' 天'; },
      rankCls(i) { return i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-n'; },
      setTab(k) { this.listTab = k; },
      onPrimary() { this.$root.go('/supervision/standing'); },
    },
    template: `
    <div v-if="!loading">
      <div class="page-sub" style="margin-bottom:14px; font-size:14px">
        <b>{{ userName }}，{{ greeting }}！</b>　当前共有 <b>{{ kpi.handling }}</b> 项督办事项在办，请持续关注重点事项进展。
      </div>

      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" @click="$root.go('/supervision/standing')">
          <div class="ico ico-blue"><ic name="file-text" size="28"></ic></div>
          <div class="meta"><div class="label">督办事项总数</div><div class="val" style="color:var(--primary)">{{ kpi.total }}</div>
            <div class="muted" style="font-size:12px">已办结 {{ kpi.closed }} 项 · 在办 {{ kpi.handling }} 项</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/supervision/reporting')">
          <div class="ico ico-teal"><ic name="play" size="28"></ic></div>
          <div class="meta"><div class="label">在办数</div><div class="val" style="color:var(--teal)">{{ kpi.handling }}</div>
            <div class="muted" style="font-size:12px">其中在办推进 {{ kpi.in_progress }} 项</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/supervision/bulletin')">
          <div class="ico ico-amber"><ic name="target" size="28"></ic></div>
          <div class="meta"><div class="label">按期办结率</div><div class="val" style="color:#C77F06">{{ kpi.on_time_rate }}%</div>
            <div class="muted" style="font-size:12px">按期办结 {{ kpi.on_time_closed }} / 已办结 {{ kpi.closed }} 项</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/supervision/warning')">
          <div class="ico ico-red"><ic name="siren" size="28"></ic></div>
          <div class="meta"><div class="label">逾期事项数</div><div class="val" style="color:var(--red)">{{ kpi.red }}</div>
            <div class="muted" style="font-size:12px">红码超期事项需重点跟进</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="sup-3col">
        <!-- warning distribution -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">预警状态分布</div>
            <span class="more" @click="$root.go('/supervision/warning')">查看详情 <ic name="chevron-right" size="14"></ic></span></div>
          <div class="card-bd" style="display:flex; align-items:center; gap:14px">
            <div class="sup-donut">
              <svg viewBox="0 0 140 140" width="140" height="140">
                <circle cx="70" cy="70" r="54" fill="none" stroke="#E8EDF3" stroke-width="20"></circle>
                <circle v-for="(s, i) in donutSegs" :key="i" cx="70" cy="70" r="54" fill="none" :stroke="s.color"
                  stroke-width="20" :stroke-dasharray="s.dash + ' ' + s.gap" :stroke-dashoffset="s.offset"
                  stroke-linecap="butt" style="transform:rotate(90deg); transform-origin:70px 70px"></circle>
                <text x="70" y="66" text-anchor="middle" font-size="24" font-weight="700" fill="#102A43">{{ distTotal }}</text>
                <text x="70" y="86" text-anchor="middle" font-size="11" fill="#829AB1">督办事项</text>
              </svg>
            </div>
            <div style="flex:1; display:flex; flex-direction:column; gap:12px">
              <div v-for="k in ['RED','YELLOW','GREEN']" :key="k" style="display:flex; align-items:center; gap:8px">
                <i :style="{background: {RED:'#E5484D',YELLOW:'#F59E0B',GREEN:'#246BFD'}[k], width:'9px',height:'9px',borderRadius:'50%',display:'inline-block'}"></i>
                <span class="sub" style="flex:1; font-size:12.5px">{{ distLabel(k) }}</span>
                <b class="num" :style="{color: {RED:'var(--red)',YELLOW:'#C77F06',GREEN:'var(--primary)'}[k], fontSize:'15px'}">{{ dist[k] }}</b>
                <span class="muted num" style="font-size:12px; width:46px; text-align:right">{{ pct(k) }}%</span>
              </div>
              <div v-if="!distTotal" class="empty" style="padding:6px 0">暂无在办任务</div>
            </div>
          </div>
        </div>

        <!-- closed trend -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">督办事项办结趋势</div>
            <span class="more" @click="$root.go('/supervision/bulletin')">查看详情 <ic name="chevron-right" size="14"></ic></span></div>
          <div class="card-bd">
            <div style="display:flex; justify-content:flex-end; gap:16px; font-size:12px; color:var(--text-2); margin-bottom:2px">
              <span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--primary);margin-right:5px"></i>立项数</span>
              <span><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--teal);margin-right:5px"></i>办结数</span>
            </div>
            <svg viewBox="0 0 560 170" width="100%" height="170" preserveAspectRatio="none" v-if="trend.length">
              <g v-for="g in gridLines" :key="g.v">
                <line x1="34" :y1="g.y" x2="550" :y2="g.y" stroke="#EDF1F7" stroke-width="1"></line>
                <text x="28" :y="Number(g.y) + 4" text-anchor="end" font-size="11" fill="#829AB1">{{ g.v }}</text>
              </g>
              <polyline :points="trendPts.line('new_count')" fill="none" stroke="#246BFD" stroke-width="2"></polyline>
              <polyline :points="trendPts.line('closed_count')" fill="none" stroke="#13A89E" stroke-width="2"></polyline>
              <circle v-for="(d, i) in trendPts.dots('new_count')" :key="'n' + i" :cx="d.cx" :cy="d.cy" r="3.5" fill="#fff" stroke="#246BFD" stroke-width="2"></circle>
              <circle v-for="(d, i) in trendPts.dots('closed_count')" :key="'c' + i" :cx="d.cx" :cy="d.cy" r="3.5" fill="#fff" stroke="#13A89E" stroke-width="2"></circle>
              <text v-for="(t, i) in trend" :key="'m' + i" :x="trendPts.x(i)" y="164" text-anchor="middle" font-size="11" fill="#829AB1">{{ Number(t.month.slice(5)) }}月</text>
            </svg>
            <div v-else class="empty">暂无趋势数据</div>
          </div>
        </div>

        <!-- dept ranking -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">承办部门办结排行榜</div>
            <span class="more" @click="$root.go('/supervision/bulletin')">查看更多 <ic name="chevron-right" size="14"></ic></span></div>
          <div class="card-bd" style="padding-top:6px">
            <div class="sup-rank" v-for="(r, i) in ranking" :key="r.dept_name">
              <span :class="['sup-rank-badge', rankCls(i)]">{{ i + 1 }}</span>
              <span class="strong" style="width:88px; font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap" :title="r.dept_name">{{ r.dept_name || '—' }}</span>
              <div class="progress" style="flex:1; height:10px"><div class="bar" :style="{width: Math.round(r.closed_count / rankMax * 100) + '%'}"></div></div>
              <span class="num strong" style="width:26px; text-align:right">{{ r.closed_count }}</span>
              <span class="muted num" style="width:40px; text-align:right; font-size:12px">{{ r.rate }}%</span>
            </div>
            <div v-if="!ranking.length" class="empty">暂无部门办结数据</div>
          </div>
        </div>
      </div>

      <div class="split-3-2 mt16">
        <!-- key task list -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">重点督办事项清单
              <span class="lr-tabs" style="margin:0 0 0 14px; display:inline-flex; gap:14px">
                <span v-for="tb in listTabs" :key="tb.key" :class="['tag', listTab === tb.key ? 'tag-blue' : 'tag-gray']" style="cursor:pointer" @click="setTab(tb.key)">{{ tb.label }} ({{ tb.count }})</span>
              </span>
            </div>
            <span class="more" @click="$root.go('/supervision/standing')">查看更多 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd" style="padding-top:8px">
            <table class="table">
              <thead><tr><th style="width:44px">序号</th><th>事项名称</th><th>承办部门</th><th>责任人</th><th>计划完成时间</th><th>当前状态</th><th style="width:130px">进展情况</th><th style="width:70px">操作</th></tr></thead>
              <tbody>
                <tr v-for="(t, i) in shownTasks" :key="t.task_id">
                  <td class="num muted">{{ i + 1 }}</td>
                  <td class="ellipsis" :title="t.title">{{ t.title }}</td>
                  <td>{{ t.lead_dept_name || '—' }}</td>
                  <td>{{ t.leader_in_charge || '—' }}</td>
                  <td class="num muted">{{ t.deadline }}</td>
                  <td><span :class="['tag', warnTag(t.warning_level)]">
                    <ic :name="t.warning_level === 'RED' ? 'siren' : t.warning_level === 'YELLOW' ? 'alert-triangle' : 'check-circle-2'" size="12"></ic>
                    {{ warnLabel(t.warning_level) }}</span></td>
                  <td><div style="display:flex; align-items:center; gap:8px"><div class="progress" style="flex:1"><div class="bar" :class="barCls(t.warning_level)" :style="{width: t.progress_pct + '%'}"></div></div><span class="num" style="font-size:12px">{{ t.progress_pct }}%</span></div></td>
                  <td class="actions"><button class="btn btn-primary btn-sm" @click="detail = t">查看</button></td>
                </tr>
                <tr v-if="!shownTasks.length"><td colspan="8"><div class="empty">暂无督办事项</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- upcoming deadlines -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">即将到期事项</div>
            <span class="more" @click="$root.go('/supervision/warning')">查看更多 <ic name="chevron-right" size="14"></ic></span></div>
          <div class="card-bd" style="padding-top:4px">
            <div v-for="t in upcoming" :key="t.task_id" class="sup-upcoming" @click="detail = t">
              <i :style="{background: {RED:'#E5484D',YELLOW:'#F59E0B',GREEN:'#246BFD'}[t.warning_level]}" class="sup-up-dot"></i>
              <div style="flex:1; min-width:0">
                <div class="strong ellipsis" style="font-size:13px">{{ t.title }}</div>
                <div class="muted" style="font-size:11.5px">{{ t.lead_dept_name || '—' }} · {{ t.deadline }}</div>
              </div>
              <span class="num strong" :style="daysColor(t)">{{ daysText(t) }}</span>
            </div>
            <div v-if="!upcoming.length" class="empty">暂无即将到期事项</div>
          </div>
        </div>
      </div>

      <!-- task detail modal -->
      <Modal title="督办事项详情" width="560px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">督办编号</span><span class="num">{{ detail.supervision_no }}</span>
          <span class="k">事项标题</span><span class="strong">{{ detail.title }}</span>
          <span class="k">督办来源</span><span>{{ detail.source_type_label }}</span>
          <span class="k">紧急程度</span><span>{{ detail.priority_label }}</span>
          <span class="k">主办处室</span><span>{{ detail.lead_dept_name || '—' }}</span>
          <span class="k">协办处室</span><span>{{ detail.assist_dept_names || '—' }}</span>
          <span class="k">办结时限</span><span class="num">{{ detail.deadline }}（{{ daysText(detail) }}）</span>
          <span class="k">当前状态</span><span><span :class="['tag', warnTag(detail.warning_level)]">{{ warnLabel(detail.warning_level) }}</span>　<span class="tag tag-gray">{{ detail.status_label }}</span></span>
          <span class="k">当前进度</span><span class="num">{{ detail.progress_pct }}%</span>
          <span class="k">事项说明</span><span>{{ detail.content || '—' }}</span>
        </div>
        <template #footer><button class="btn btn-ghost" @click="detail = null">关闭</button></template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
