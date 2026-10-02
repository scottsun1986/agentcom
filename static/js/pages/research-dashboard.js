/* /research/dashboard 全域调研全景看板 — pixel replica of design/mockups/062-research-dashboard.png
   Layout: greeting / 5 KPI cards / (点位热度榜 hbars | 课题状态分布 donut) / 近期问题台账 */
AppPages['/research/dashboard'] = {
  route: '/research/dashboard', title: '全域调研全景看板', category: 'RESEARCH', primaryAction: '新建调研', icon: 'map-pin',
  component: {
    data() {
      return {
        loading: true,
        kpi: { in_progress_topics: 0, covered_points: 0, issue_total: 0, rectified_rate: 0, conflict_hits: 0, conflict_topics: 0, total_topics: 0, rectified_total: 0 },
        heat: [],
        statusCounts: {},
        issues: [],
        greeting: '',
      };
    },
    computed: {
      today() {
        const d = new Date();
        const wd = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '年' + p(d.getMonth() + 1) + '月' + p(d.getDate()) + '日　星期' + wd;
      },
      hourGreet() {
        const h = new Date().getHours();
        if (h < 12) return '上午好';
        if (h < 14) return '中午好';
        if (h < 18) return '下午好';
        return '晚上好';
      },
      statusSegs() {
        const order = [
          ['PLANNED', '已规划', '#829AB1'], ['APPROVED', '已批准', '#246BFD'], ['IN_PROGRESS', '进行中', '#13A89E'],
          ['REPORT_REVIEW', '报告评审', '#F59E0B'], ['COMPLETED', '已完成', '#2FA96E'],
        ];
        const total = Object.values(this.statusCounts).reduce((a, b) => a + b, 0) || 1;
        let acc = 0;
        const segs = [];
        order.forEach(([key, name, color]) => {
          const v = this.statusCounts[key] || 0;
          if (!v) return;
          const start = acc / total * 360;
          acc += v;
          const end = acc / total * 360;
          segs.push({ key, name, count: v, pct: Math.round(v / total * 1000) / 10, color, start, end });
        });
        return segs;
      },
      donutStyle() {
        if (!this.statusSegs.length) return { background: '#EEF2F7' };
        const parts = this.statusSegs.map((s) => `${s.color} ${s.start}deg ${s.end}deg`);
        return { background: 'conic-gradient(' + parts.join(', ') + ')' };
      },
      maxHeat() { return Math.max(1, ...this.heat.map((h) => h.count)); },
      shownIssues() { return this.issues.slice(0, 8); },
    },
    async mounted() {
      const u = api.cachedUser();
      this.greeting = u ? (u.nick_name || u.user_name || '') : '';
      try {
        const d = await api.get('/api/research/dashboard');
        this.kpi = d;
        this.heat = d.point_heat_ranking || [];
        this.statusCounts = d.status_counts || {};
      } catch (e) { /* toast already shown */ }
      try {
        const r = await api.page('/api/research/issues', { pageNum: 1, pageSize: 8 });
        this.issues = r.rows || [];
      } catch (e) { this.issues = []; }
      this.loading = false;
    },
    methods: {
      issueTag(s) {
        return { LOGGED: 'tag-amber', SUPERVISED: 'tag-blue', RECTIFIED: 'tag-green' }[s] || 'tag-gray';
      },
      heatColor(i) {
        return i === 0 ? 'var(--primary)' : i === 1 ? '#5B8DEF' : i === 2 ? '#8FB3F5' : '#B9CFF8';
      },
    },
    template: `
    <div v-if="!loading">
      <div class="page-sub" style="margin-bottom:14px; font-size:14px">
        <b>{{ greeting }}，{{ hourGreet }}！</b>　当前全市调研工作平稳推进，累计立项 <b>{{ kpi.total_topics }}</b> 个课题、覆盖 <b>{{ kpi.covered_points }}</b> 个点位。
      </div>

      <!-- KPI row -->
      <div class="kpi-row-5 rs-kpi5">
        <div class="card kpi-card" @click="$root.go('/research/topics')">
          <div class="ico ico-blue"><ic name="users" size="28"></ic></div>
          <div class="meta"><div class="label">进行中调研组</div><div class="val" style="color:var(--primary)">{{ kpi.in_progress_topics }}</div>
            <div class="muted" style="font-size:12px">共立项 {{ kpi.total_topics }} 个课题</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/research/schedule-planner')">
          <div class="ico ico-teal"><ic name="map-pin" size="28"></ic></div>
          <div class="meta"><div class="label">覆盖点位</div><div class="val" style="color:var(--teal)">{{ kpi.covered_points }}</div>
            <div class="muted" style="font-size:12px">点位行程共 {{ kpi.point_total || 0 }} 站</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/research/issues')">
          <div class="ico ico-amber"><ic name="clipboard-list" size="28"></ic></div>
          <div class="meta"><div class="label">发现问题</div><div class="val" style="color:var(--amber)">{{ kpi.issue_total }}</div>
            <div class="muted" style="font-size:12px">已整改 {{ kpi.rectified_total }} 项</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/research/issues-to-supervision')">
          <div class="ico ico-green-kpi" style="background:var(--green-weak); color:var(--green)"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta"><div class="label">已整改转化率</div><div class="val" style="color:var(--green)">{{ kpi.rectified_rate }}%</div>
            <div class="progress" style="margin-top:6px"><div class="bar bar-green" :style="{width: Math.min(100, kpi.rectified_rate) + '%'}"></div></div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/research/schedule-planner')">
          <div class="ico ico-red"><ic name="siren" size="28"></ic></div>
          <div class="meta"><div class="label">撞期命中</div><div class="val" style="color:var(--red)">{{ kpi.conflict_hits }}</div>
            <div class="muted" style="font-size:12px">涉及课题 {{ kpi.conflict_topics }} 个</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="split-3-2">
        <!-- point heat ranking -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">点位热度榜</div>
            <span class="more" @click="$root.go('/research/schedule-planner')">路线统筹 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd" style="padding-top:8px">
            <div class="ast-hbar-row" v-for="(h, i) in heat" :key="h.point_name">
              <span class="sup-rank-badge" :class="'rank-' + (i < 3 ? i + 1 : 'n')">{{ i + 1 }}</span>
              <span class="nm" style="flex:1" :title="h.point_name">{{ h.point_name }}</span>
              <span class="ast-hbar" style="flex:1.4"><b :style="{ width: (h.count / maxHeat * 100) + '%', background: heatColor(i) }"></b></span>
              <span class="ast-hbar-val" style="width:52px">{{ h.count }} 次</span>
            </div>
            <div v-if="!heat.length" class="empty">暂无点位走访数据</div>
          </div>
        </div>

        <!-- topic status distribution -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">课题状态分布</div>
            <span class="more" @click="$root.go('/research/reports')">报告归档 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd">
            <div class="ast-donut-wrap" style="gap:24px">
              <div class="ast-donut" style="width:158px; height:158px" :style="donutStyle">
                <div class="ast-donut-hole" style="inset:32px">
                  <b>{{ kpi.total_topics }}</b>
                  <span class="muted" style="font-size:11.5px">课题总数</span>
                </div>
              </div>
              <div class="ast-legend">
                <div class="ast-legend-row" v-for="s in statusSegs" :key="s.key">
                  <i :style="{ background: s.color }"></i>{{ s.name }}
                  <span class="n strong">{{ s.count }}</span>
                  <span class="p">{{ s.pct }}%</span>
                </div>
                <div v-if="!statusSegs.length" class="empty">暂无课题</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- recent issues ledger -->
      <div class="card mt16">
        <div class="card-hd">
          <div class="t">近期问题台账</div>
          <span class="more" @click="$root.go('/research/issues')">查看更多 <ic name="chevron-right" size="14"></ic></span>
        </div>
        <div class="card-bd" style="padding-top:8px">
          <table class="table">
            <thead><tr><th style="width:52px">序号</th><th>问题标题</th><th>所属课题</th><th>发现点位</th><th>拟承办部门</th><th>登记时间</th><th style="width:110px">当前状态</th><th style="width:80px">操作</th></tr></thead>
            <tbody>
              <tr v-for="(it, i) in shownIssues" :key="it.issue_id">
                <td class="num muted">{{ i + 1 }}</td>
                <td class="ellipsis strong" style="max-width:240px" :title="it.issue_title">{{ it.issue_title }}</td>
                <td class="ellipsis" style="max-width:180px" :title="it.topic_title">{{ it.topic_title || '—' }}</td>
                <td class="muted">{{ it.point_name || '—' }}</td>
                <td>{{ it.target_dept_name || '待定' }}</td>
                <td class="num muted">{{ it.created_at ? it.created_at.slice(0, 10) : '—' }}</td>
                <td><span :class="['tag', issueTag(it.status)]">{{ it.status_label }}</span></td>
                <td class="actions"><button class="btn btn-text btn-sm" @click="$root.go('/research/issues')">查看</button></td>
              </tr>
              <tr v-if="!shownIssues.length"><td colspan="8"><div class="empty">暂无问题台账记录</div></td></tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
