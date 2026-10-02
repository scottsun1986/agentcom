/* /supervision/bulletin 督查简报与考核通报 — pixel replica of design/mockups/030-supervision-bulletin.png
   Layout: 生成工具条 / 4 KPI / (各单位推进情况表 | 督查通报预览文档) / 导出简报 */
AppPages['/supervision/bulletin'] = {
  route: '/supervision/bulletin', title: '督查简报与考核通报', category: 'SUPERVISION', primaryAction: '导出简报', icon: 'book-open',
  subtitle: '系统自动按月度、季度将各单位推进情况、红黄牌次数、办结质量一键生成规范格式的《督查通报》。',
  component: {
    data() {
      return {
        loading: true,
        periodType: 'MONTHLY',
        month: '',
        bulletin: null,
        tasks: [],
        loadingBulletin: false,
      };
    },
    computed: {
      monthLabel() {
        if (!this.month) return '';
        const [y, m] = this.month.split('-');
        return this.periodType === 'QUARTERLY' ? y + '年第' + (Math.floor((Number(m) - 1) / 3) + 1) + '季度' : y + '年' + Number(m) + '月';
      },
      deptStats() {
        const map = {};
        (this.tasks || []).forEach((t) => {
          const k = t.lead_dept_name || '未知部门';
          const s = map[k] = map[k] || { dept_name: k, total: 0, closed: 0, active: 0, red: 0, yellow: 0 };
          s.total++;
          if (t.status === 'CLOSED') s.closed++;
          else if (!['CANCELLED', 'DRAFT'].includes(t.status)) {
            s.active++;
            if (t.warning_level === 'RED') s.red++;
            if (t.warning_level === 'YELLOW') s.yellow++;
          }
        });
        const arr = Object.values(map).map((s) => {
          s.rate = s.total ? Math.round(s.closed / s.total * 100) : 0;
          const score = s.rate - s.red * 15 - s.yellow * 5;
          s.grade = score >= 90 ? '优秀' : score >= 75 ? '良好' : score >= 60 ? '合格' : '不合格';
          s.quality = s.red === 0 && s.yellow === 0 ? '优' : s.red === 0 ? '良' : s.red <= 1 ? '一般' : '较差';
          return s;
        });
        arr.sort((a, b) => b.rate - a.rate || a.red - b.red || a.yellow - b.yellow || b.total - a.total);
        return arr;
      },
      kpi() {
        const b = this.bulletin || {};
        return {
          units: this.deptStats.length,
          total: this.tasks.length,
          closed: this.tasks.filter((t) => t.status === 'CLOSED').length,
          redCards: (b.card_ranking || []).reduce((s, r) => s + (r.red_count || 0), 0),
          yellowCards: (b.card_ranking || []).reduce((s, r) => s + (r.yellow_count || 0), 0),
          newCount: b.new_count || 0,
          closedCount: b.closed_count || 0,
          overdueCount: b.overdue_count || 0,
          cardUnits: (b.card_ranking || []).length,
        };
      },
      gradeTag() {
        return { 优秀: 'tag-green', 良好: 'tag-blue', 合格: 'tag-amber', 不合格: 'tag-red' };
      },
      qualityTag() {
        return { 优: 'tag-green', 良: 'tag-teal', 一般: 'tag-amber', 较差: 'tag-red' };
      },
    },
    async mounted() {
      const now = new Date();
      this.month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
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
        this.loadingBulletin = true;
        try {
          const b = await api.get('/api/supervision/bulletin', { period_type: this.periodType, month: this.month });
          this.bulletin = b;
        } catch (e) { this.bulletin = null; }
        try {
          const r = await api.page('/api/supervision/tasks', { pageNum: 1, pageSize: 200 });
          this.tasks = r.rows || [];
        } catch (e) { this.tasks = []; }
        this.loadingBulletin = false;
      },
      shiftMonth(delta) {
        const [y, m] = this.month.split('-').map(Number);
        const d = new Date(y, m - 1 + delta, 1);
        this.month = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        this.load();
      },
      exportBulletin() {
        if (!this.bulletin) return this.$root.toast('简报尚未生成，请先点击「生成督查通报」', 'warn');
        const b = this.bulletin;
        const L = [];
        L.push('督 查 通 报');
        L.push('（' + new Date().getFullYear() + '）' + (b.label || this.monthLabel));
        L.push('');
        L.push('==== ' + (b.label || '') + '重点工作督查通报 ====');
        L.push('');
        L.push('一、总体情况');
        L.push('本期新立项督办事项 ' + this.kpi.newCount + ' 项，办结销号 ' + this.kpi.closedCount + ' 项，超期未结 ' + this.kpi.overdueCount + ' 项；红黄牌单位 ' + this.kpi.cardUnits + ' 个（红牌 ' + this.kpi.redCards + ' 次、黄牌 ' + this.kpi.yellowCards + ' 次）。');
        L.push('');
        L.push('二、各单位推进情况');
        this.deptStats.forEach((s, i) => {
          L.push((i + 1) + '. ' + s.dept_name + '：任务总数 ' + s.total + '，已办结 ' + s.closed + '，办结率 ' + s.rate + '%，红牌 ' + s.red + ' 次、黄牌 ' + s.yellow + ' 次，考核等次 ' + s.grade + '。');
        });
        L.push('');
        L.push('三、通报正文');
        L.push(b.summary || '');
        L.push('');
        L.push('AgentCom 督查室');
        L.push(this.bj(b.generated_at));
        const blob = new Blob([L.join('\n')], { type: 'text/plain;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = '督查简报_' + (b.label || this.monthLabel) + '.txt';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
        this.$root.toast('简报已导出下载', 'ok');
      },
      onPrimary() { this.exportBulletin(); },
    },
    template: `
    <div v-if="!loading">
      <!-- generator toolbar -->
      <div class="card">
        <div class="card-bd" style="display:flex; align-items:center; gap:18px; flex-wrap:wrap; padding:14px 18px">
          <div style="display:flex; align-items:center; gap:10px">
            <span class="strong">生成周期</span>
            <div class="seg-group">
              <span :class="['seg', periodType === 'MONTHLY' ? 'on' : '']" @click="periodType = 'MONTHLY'; load()">按月</span>
              <span :class="['seg', periodType === 'QUARTERLY' ? 'on' : '']" @click="periodType = 'QUARTERLY'; load()">按季</span>
            </div>
          </div>
          <div style="display:flex; align-items:center; gap:8px">
            <span class="strong">时间范围</span>
            <button class="cal-nav-btn" @click="shiftMonth(-1)"><ic name="chevron-left" size="14"></ic></button>
            <input type="month" class="input" style="width:150px" v-model="month" @change="load">
            <button class="cal-nav-btn" @click="shiftMonth(1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
          <div style="display:flex; align-items:center; gap:10px">
            <span class="strong">通报类型</span>
            <select class="select" style="width:170px"><option>综合督查通报</option><option>专项督查通报</option></select>
          </div>
          <div style="display:flex; align-items:center; gap:10px">
            <span class="strong">纳入单位</span>
            <select class="select" style="width:150px"><option>全部单位</option></select>
          </div>
          <button class="btn btn-primary" style="margin-left:auto" :disabled="loadingBulletin" @click="load"><ic name="file-check" size="14"></ic>生成督查通报</button>
        </div>
      </div>

      <!-- KPI -->
      <div class="kpi-row">
        <div class="card kpi-card">
          <div class="ico ico-blue"><ic name="building-2" size="28"></ic></div>
          <div class="meta"><div class="label">纳入考核单位</div><div class="val" style="color:var(--primary)">{{ kpi.units }} <span style="font-size:14px;font-weight:400">个</span></div>
            <div class="muted" style="font-size:12px">{{ monthLabel }}度督查考核范围</div></div>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-teal"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta"><div class="label">任务总数</div><div class="val" style="color:var(--teal)">{{ kpi.total }} <span style="font-size:14px;font-weight:400">项</span></div>
            <div class="muted" style="font-size:12px">本期办结销号 {{ kpi.closed }} 项</div></div>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-amber"><ic name="alert-triangle" size="28"></ic></div>
          <div class="meta"><div class="label">红黄牌次数</div><div class="val" style="color:var(--amber)">{{ kpi.redCards + kpi.yellowCards }} <span style="font-size:14px;font-weight:400">次</span></div>
            <div class="muted" style="font-size:12px">红牌 <span style="color:var(--red)">{{ kpi.redCards }}</span> · 黄牌 <span style="color:#C77F06">{{ kpi.yellowCards }}</span></div></div>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-red"><ic name="award" size="28"></ic></div>
          <div class="meta"><div class="label">本期新立项 / 超期未结</div><div class="val" style="color:var(--red)">{{ kpi.newCount }} <span style="font-size:14px;font-weight:400">/ {{ kpi.overdueCount }} 项</span></div>
            <div class="muted" style="font-size:12px">红黄牌单位 {{ kpi.cardUnits }} 个</div></div>
        </div>
      </div>

      <div class="split-3-2">
        <!-- dept table -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">各单位考核情况</div><span class="muted" style="font-size:12px">{{ monthLabel }} · 共 {{ deptStats.length }} 个单位</span></div>
          <div class="card-bd" style="padding-top:6px">
            <table class="table table-tight">
              <thead><tr>
                <th style="width:52px">排名</th><th>单位名称</th><th>任务总数</th><th>已办结</th><th>办结率</th><th>红牌次数</th><th>黄牌次数</th><th>办结质量</th><th>考核等次</th>
              </tr></thead>
              <tbody>
                <tr v-for="(s, i) in deptStats" :key="s.dept_name">
                  <td><span :class="['sup-rank-badge', i === 0 ? 'rank-1' : i === 1 ? 'rank-2' : i === 2 ? 'rank-3' : 'rank-n']">{{ i + 1 }}</span></td>
                  <td class="strong">{{ s.dept_name }}</td>
                  <td class="num">{{ s.total }}</td>
                  <td class="num">{{ s.closed }}</td>
                  <td class="num" :style="{color: s.rate >= 80 ? 'var(--green)' : s.rate >= 60 ? 'var(--text)' : 'var(--red)', fontWeight: 600}">{{ s.rate }}%</td>
                  <td class="num" :style="{color: s.red ? 'var(--red)' : 'var(--text-3)'}">{{ s.red }}</td>
                  <td class="num" :style="{color: s.yellow ? '#C77F06' : 'var(--text-3)'}">{{ s.yellow }}</td>
                  <td><span :class="['tag', qualityTag[s.quality]]">{{ s.quality }}</span></td>
                  <td><span :class="['tag', gradeTag[s.grade]]">{{ s.grade }}</span></td>
                </tr>
                <tr v-if="!deptStats.length"><td colspan="9"><div class="empty">暂无单位考核数据</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- bulletin preview -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">督查通报预览</div></div>
          <div class="card-bd">
            <div class="doc-paper" v-if="bulletin">
              <div class="doc-title">督 查 通 报</div>
              <div class="doc-rule"></div>
              <div class="muted num" style="text-align:center; font-size:12px">（{{ new Date().getFullYear() }}）{{ bulletin.label }}</div>
              <div class="doc-h2">{{ bulletin.label }}重点工作督查通报</div>
              <p class="doc-p" style="text-indent:2em">根据年度重点工作安排，现将{{ bulletin.label }}各单位重点任务推进情况通报如下：</p>
              <div class="doc-h3">一、总体情况</div>
              <p class="doc-p" style="text-indent:2em">本期新立项督办事项 {{ bulletin.new_count }} 项，办结销号 {{ bulletin.closed_count }} 项；截至期末超期未结 {{ bulletin.overdue_count }} 项，红黄牌单位 {{ (bulletin.card_ranking || []).length }} 个。</p>
              <div class="doc-h3">二、各单位推进情况</div>
              <p class="doc-p" style="text-indent:2em" v-for="(s, i) in deptStats.slice(0, 6)" :key="s.dept_name">
                {{ s.dept_name }}承办任务 {{ s.total }} 项、已办结 {{ s.closed }} 项（办结率 {{ s.rate }}%），红牌 {{ s.red }} 次、黄牌 {{ s.yellow }} 次，考核等次 {{ s.grade }}。
              </p>
              <div class="doc-h3">三、通报正文</div>
              <div class="doc-p doc-summary">{{ bulletin.summary }}</div>
              <div style="text-align:right; margin-top:16px; font-size:13px">
                <div>AgentCom 督查室</div>
                <div class="num">{{ bj(bulletin.generated_at) }}</div>
              </div>
            </div>
            <div v-else class="empty">{{ loadingBulletin ? '简报生成中…' : '简报尚未生成，请点击右上角「生成督查通报」' }}</div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
