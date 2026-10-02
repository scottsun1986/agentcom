/* /research/schedule-planner 点位路线规划与防撞期统筹 — pixel replica of design/mockups/064-research-schedule-planner.png
   Layout: 4 stat cards / 防撞期检测台（输入点位多行 + 日期范围 → 冲突明细红卡 / 无撞期绿卡）/ 课题点位时间线（CSS 横条）*/
AppPages['/research/schedule-planner'] = {
  route: '/research/schedule-planner', title: '点位路线规划与防撞期统筹', category: 'RESEARCH', primaryAction: '新建调研路线', icon: 'map-pin',
  subtitle: '选取拟走访考察企业、农村合作社、街道办事处、重大项目工地等点位，智能识别时间冲突，避免基层迎检过载。',
  component: {
    data() {
      return {
        loading: true,
        namesText: '',
        startDate: '',
        endDate: '',
        checking: false,
        checked: false,
        result: null,
        topics: [],
        points: [],
        globalConflict: 0,
      };
    },
    computed: {
      nameList() {
        const seen = new Set();
        return this.namesText.split('\n').map((s) => s.trim()).filter((s) => s && !seen.has(s) && seen.add(s));
      },
      conflictRows() { return (this.result && this.result.conflicts) || []; },
      statPoints() { return this.nameList.length; },
      statDays() {
        if (!this.startDate || !this.endDate) return 0;
        const d = (new Date(this.endDate) - new Date(this.startDate)) / 86400000;
        return isNaN(d) ? 0 : Math.max(0, Math.round(d)) + 1;
      },
      topicTracks() {
        const byTopic = {};
        this.points.forEach((p) => {
          (byTopic[p.topic_id] = byTopic[p.topic_id] || []).push(p);
        });
        return this.topics
          .filter((t) => byTopic[t.topic_id] && byTopic[t.topic_id].length)
          .map((t) => {
            const pts = byTopic[t.topic_id].slice().sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date));
            const s = t.start_date, e = t.end_date;
            const span = Math.max(1, (new Date(e) - new Date(s)) / 86400000);
            pts.forEach((p) => {
              const off = (new Date(p.scheduled_date) - new Date(s)) / 86400000;
              p._left = Math.min(97, Math.max(0, off / span * 97));
            });
            return { topic: t, points: pts };
          });
      },
    },
    async mounted() {
      try {
        const d = await api.get('/api/research/dashboard');
        this.globalConflict = d.conflict_topics || 0;
      } catch (e) { /* keep 0 */ }
      try {
        const r = await api.page('/api/research/topics', { pageNum: 1, pageSize: 100 });
        this.topics = r.rows || [];
      } catch (e) { this.topics = []; }
      try {
        const r = await api.page('/api/research/points', { pageNum: 1, pageSize: 300 });
        this.points = r.rows || [];
      } catch (e) { this.points = []; }
      this.loading = false;
    },
    methods: {
      statusLabel(s) {
        return { PLANNED: '已规划', APPROVED: '已批准', IN_PROGRESS: '进行中', REPORT_REVIEW: '报告评审', COMPLETED: '已完成' }[s] || s;
      },
      statusTag(s) {
        return { PLANNED: 'tag-gray', APPROVED: 'tag-blue', IN_PROGRESS: 'tag-teal', REPORT_REVIEW: 'tag-amber', COMPLETED: 'tag-green' }[s] || 'tag-gray';
      },
      async runCheck() {
        if (!this.nameList.length) return this.$root.toast('请输入至少一个点位名称（每行一个）', 'warn');
        if (!this.startDate || !this.endDate) return this.$root.toast('请选择检测日期范围', 'warn');
        if (this.endDate < this.startDate) return this.$root.toast('结束日期不能早于开始日期', 'warn');
        this.checking = true;
        try {
          this.result = await api.post('/api/research/check-conflicts', {
            point_names: this.nameList, start_date: this.startDate, end_date: this.endDate,
          });
          this.checked = true;
          this.$root.toast(this.result.has_conflict ? '检测到 ' + this.result.conflicts.length + ' 条撞期风险' : '无撞期风险', this.result.has_conflict ? 'warn' : 'ok');
        } catch (e) { /* toast shown */ }
        this.checking = false;
      },
    },
    template: `
    <div v-if="!loading">
      <!-- stat cards -->
      <div class="kpi-row-4 rs-kpi4">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="map-pin" size="28"></ic></div>
          <div class="meta"><div class="label">本次拟走访点位</div><div class="val" style="color:var(--primary)">{{ statPoints }} <span style="font-size:14px; font-weight:400">个</span></div>
            <div class="muted" style="font-size:12px">在左侧检测台逐行录入</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="calendar-days" size="28"></ic></div>
          <div class="meta"><div class="label">计划时间范围</div><div class="val" style="font-size:18px; color:var(--teal)">{{ startDate || '—' }} ~ {{ endDate || '—' }}</div>
            <div class="muted" style="font-size:12px">共 {{ statDays }} 天</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico" :class="checked && result && result.has_conflict ? 'ico-red' : 'ico-green-kpi'" :style="checked && result && result.has_conflict ? '' : 'background:var(--green-weak); color:var(--green)'">
            <ic :name="checked && result && result.has_conflict ? 'siren' : 'shield-check'" size="28"></ic></div>
          <div class="meta"><div class="label">潜在时间冲突</div>
            <div class="val" :style="{ color: checked && result && result.has_conflict ? 'var(--red)' : 'var(--green)' }">{{ checked && result ? result.conflicts.length : '—' }} <span style="font-size:14px; font-weight:400">条</span></div>
            <div class="muted" style="font-size:12px">{{ checked && result ? (result.has_conflict ? '已预警，建议调整或联合调研' : '无撞期风险') : '待检测' }}</div></div>
        </div>
        <div class="card kpi-card" @click="$root.go('/research/topics')">
          <div class="ico ico-amber"><ic name="alert-triangle" size="28"></ic></div>
          <div class="meta"><div class="label">在库撞期课题</div><div class="val" style="color:var(--amber)">{{ globalConflict }}</div>
            <div class="muted" style="font-size:12px">未结题且标记撞期</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <!-- conflict detection desk -->
      <div class="card mt16">
        <div class="card-hd">
          <div class="t"><ic name="scan-search" size="17"></ic>防撞期检测台</div>
          <span class="muted" style="font-size:12px">点位名称同名或互相包含、日期 ±1 天内即判定撞期</span>
        </div>
        <div class="card-bd">
          <div class="rs-check-grid">
            <div>
              <div class="rs-field-label req">拟走访点位名称（每行一个）</div>
              <textarea class="input" rows="7" placeholder="如：
临江街道办事处
高新社区党群服务中心
阳光花园小区" v-model="namesText"></textarea>
              <div class="muted" style="font-size:12px; margin-top:6px">已录入 <b style="color:var(--primary)">{{ statPoints }}</b> 个点位（自动去重）</div>
            </div>
            <div>
              <div class="rs-field-label req">检测日期范围</div>
              <div style="display:flex; align-items:center; gap:8px; margin-bottom:14px">
                <input type="date" class="input" style="flex:1" v-model="startDate">
                <span class="muted">~</span>
                <input type="date" class="input" style="flex:1" v-model="endDate">
              </div>
              <button class="btn btn-primary" style="width:100%; justify-content:center" :disabled="checking" @click="runCheck">
                <ic name="scan-search" size="15"></ic>{{ checking ? '检测中…' : '开始撞期检测' }}
              </button>
              <div class="rs-check-tip">
                <ic name="info" size="14"></ic>
                检测范围为全部未结题课题的调研点位；命中后请调整时间、错峰走访或开展联合调研。
              </div>
            </div>
          </div>

          <!-- result -->
          <template v-if="checked && result">
            <div v-if="result.has_conflict" class="rs-conflict-card">
              <div class="rs-conflict-hd">
                <ic name="siren" size="18"></ic>
                <b>检测到基层迎检过载风险（{{ result.conflicts.length }} 条撞期明细）</b>
                <span class="tag tag-red">高风险</span>
              </div>
              <table class="table">
                <thead><tr><th>送检点位</th><th>撞期课题</th><th>在库点位</th><th>撞期日期</th><th>领队</th><th>匹配方式</th></tr></thead>
                <tbody>
                  <tr v-for="(c, i) in conflictRows" :key="i">
                    <td class="strong">{{ c.point_name }}</td>
                    <td><span class="muted">{{ c.topic_no }}</span> {{ c.topic_title }}</td>
                    <td>{{ c.existing_point_name }}</td>
                    <td class="num" style="color:var(--red); font-weight:600">{{ c.scheduled_date }}</td>
                    <td>{{ c.leader_name }}</td>
                    <td><span :class="['tag', c.match_type === 'SAME' ? 'tag-red' : 'tag-amber']">{{ c.match_type === 'SAME' ? '同名' : '包含' }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
            <div v-else class="rs-safe-card">
              <ic name="check-circle-2" size="18"></ic>
              <div><b>无撞期风险</b><span style="font-size:12px; margin-left:8px">本次共检测 {{ result.checked_point_count }} 个点位，与在库未结题课题调研安排无时间冲突，可按计划开展。</span></div>
            </div>
          </template>
        </div>
      </div>

      <!-- topic-grouped point timeline -->
      <div class="card mt16">
        <div class="card-hd">
          <div class="t"><ic name="route" size="17"></ic>课题点位时间线</div>
          <span class="muted" style="font-size:12px">按课题调研周期定位各点位计划日期，<span style="color:var(--red)">红点为撞期点位</span></span>
        </div>
        <div class="card-bd" style="padding-top:6px">
          <div v-for="row in topicTracks" :key="row.topic.topic_id" class="rs-track-row">
            <div class="rs-track-label">
              <div class="strong ellipsis" style="max-width:220px" :title="row.topic.title">{{ row.topic.title }}</div>
              <div class="muted" style="font-size:11.5px">{{ row.topic.topic_no }} · {{ row.topic.leader_name }}</div>
              <span :class="['tag', statusTag(row.topic.status)]" style="margin-top:3px; align-self:flex-start">{{ statusLabel(row.topic.status) }}</span>
            </div>
            <div class="rs-track">
              <span class="rs-track-edge left">{{ row.topic.start_date }}</span>
              <span class="rs-track-edge right">{{ row.topic.end_date }}</span>
              <span v-for="p in row.points" :key="p.point_id" class="rs-track-dot" :class="{ conflict: p.conflict_detected }"
                :style="{ left: p._left + '%' }" :title="p.point_name + ' · ' + p.scheduled_date + (p.conflict_detected ? ' · 撞期' : '')">
                <span class="rs-track-pop">{{ p.point_name }}<br><i>{{ p.scheduled_date }}</i></span>
              </span>
            </div>
          </div>
          <div v-if="!topicTracks.length" class="empty">暂无课题点位数据，请先在课题立项中登记点位</div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
