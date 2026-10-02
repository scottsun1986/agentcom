/* /research/reports 调研报告评审与归档 — pixel replica of design/mockups/067-research-reports.png
   Layout: 3 KPI cards / filters + report table + server pager / 查看全文 modal / 评审通过（归档办结） */
AppPages['/research/reports'] = {
  route: '/research/reports', title: '调研报告评审与归档', category: 'RESEARCH', primaryAction: null, icon: 'file-check',
  subtitle: '支持调研报告的草拟、修改、处室联合评议、正式成果归档，全过程留痕可回溯。',
  component: {
    data() {
      return {
        loading: true,
        rows: [],
        total: 0,
        filters: { keyword: '', status: '' },
        pageNum: 1,
        pageSize: 10,
        detail: null,
        finalizing: false,
      };
    },
    computed: {
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
      counts() {
        const c = { total: this.total, REPORT_REVIEW: 0, COMPLETED: 0 };
        this.rows.forEach((r) => { if (c[r.status] !== undefined) c[r.status]++; });
        return c;
      },
      summaryExcerpt() {
        return (t) => (t.summary_report || '').slice(0, 60);
      },
    },
    async mounted() { await this.load(); this.loading = false; },
    methods: {
      async load() {
        try {
          const r = await api.page('/api/research/reports', {
            keyword: this.filters.keyword || undefined,
            status: this.filters.status || undefined,
            pageNum: this.pageNum, pageSize: this.pageSize,
          });
          this.rows = r.rows || [];
          this.total = r.total || 0;
        } catch (e) { this.rows = []; this.total = 0; }
      },
      statusLabel(s) { return { REPORT_REVIEW: '评审中', COMPLETED: '已归档' }[s] || s; },
      statusTag(s) { return { REPORT_REVIEW: 'tag-amber', COMPLETED: 'tag-green' }[s] || 'tag-gray'; },
      query() { this.pageNum = 1; this.load(); },
      reset() { this.filters = { keyword: '', status: '' }; this.query(); },
      goPage(p) {
        if (p === '...' || p < 1 || p > this.pageCount) return;
        this.pageNum = p;
        this.load();
      },
      async finalize(t) {
        if (!window.confirm('确认评审通过并将课题【' + t.title + '】归档办结？')) return;
        this.finalizing = true;
        try {
          await api.post('/api/research/topics/' + t.topic_id + '/finalize', {});
          this.$root.toast('评审通过，课题已归档办结', 'ok');
          this.detail = null;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.finalizing = false;
      },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI cards -->
      <div class="kpi-row-4 rs-kpi4">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="file-check" size="28"></ic></div>
          <div class="meta"><div class="label">已提交报告课题</div><div class="val" style="color:var(--primary)">{{ total }}</div>
            <div class="muted" style="font-size:12px">可参与评审与归档</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="clock" size="28"></ic></div>
          <div class="meta"><div class="label">报告评审中</div><div class="val" style="color:var(--amber)">{{ rows.filter(r => r.status === 'REPORT_REVIEW').length }}</div>
            <div class="muted" style="font-size:12px">本页待评审课题数</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico" style="background:var(--green-weak); color:var(--green)"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta"><div class="label">已归档办结</div><div class="val" style="color:var(--green)">{{ rows.filter(r => r.status === 'COMPLETED').length }}</div>
            <div class="muted" style="font-size:12px">本页已归档课题数</div></div>
        </div>
        <div class="card kpi-card" @click="$root.go('/research/dashboard')">
          <div class="ico ico-teal"><ic name="pie-chart" size="28"></ic></div>
          <div class="meta"><div class="label">成果转化</div><div class="val" style="color:var(--teal)">问题→督办</div>
            <div class="muted" style="font-size:12px">调研成果闭环看板</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <!-- report list -->
      <div class="card mt16">
        <div class="card-bd" style="padding-top:4px">
          <div class="filters" style="margin-bottom:12px">
            <input class="input" style="width:240px" placeholder="课题名称 / 编号关键词" v-model="filters.keyword" @keyup.enter="query">
            <select class="select" style="width:150px" v-model="filters.status" @change="query">
              <option value="">全部状态</option><option value="REPORT_REVIEW">评审中</option><option value="COMPLETED">已归档</option>
            </select>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr><th style="width:52px">序号</th><th>课题编号 / 名称</th><th style="width:90px">领队</th><th style="width:130px">牵头部门</th><th style="width:190px">调研周期</th><th>报告摘要</th><th style="width:96px">状态</th><th style="width:180px">操作</th></tr></thead>
            <tbody>
              <tr v-for="(r, i) in rows" :key="r.topic_id">
                <td class="num muted">{{ (pageNum - 1) * pageSize + i + 1 }}</td>
                <td><div class="strong ellipsis" style="max-width:230px; cursor:pointer" :title="r.title" @click="detail = r">{{ r.title }}</div>
                  <div class="muted" style="font-size:12px">{{ r.topic_no }}</div></td>
                <td>{{ r.leader_name }}</td>
                <td class="muted">{{ r.lead_dept_name || '—' }}</td>
                <td class="num muted">{{ r.start_date }}<br>至 {{ r.end_date }}</td>
                <td class="muted ellipsis" style="max-width:240px" :title="r.summary_report">{{ summaryExcerpt(r) }}…</td>
                <td><span :class="['tag', statusTag(r.status)]">{{ statusLabel(r.status) }}</span></td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="detail = r">查看全文</button>
                  <button v-if="r.status === 'REPORT_REVIEW'" class="btn btn-primary btn-sm" @click="finalize(r)">评审通过</button>
                  <span v-else class="tag tag-green" style="margin-left:4px"><ic name="check" size="12"></ic>已归档</span>
                </td>
              </tr>
              <tr v-if="!rows.length"><td colspan="8"><div class="empty">暂无已提交报告的课题</div></td></tr>
            </tbody>
          </table>
          <div class="pager" v-if="pageCount > 1">
            <span>共 {{ total }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in pageCount" :key="p" v-show="pageCount <= 7 || p === 1 || p === pageCount || Math.abs(p - pageNum) <= 1" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
      </div>

      <!-- full text modal -->
      <Modal title="调研报告全文" width="680px" v-if="detail" @close="detail = null">
        <div class="desc-list" style="margin-bottom:12px">
          <span class="k">课题名称</span><span class="strong">{{ detail.title }}</span>
          <span class="k">课题编号</span><span class="num">{{ detail.topic_no }}</span>
          <span class="k">领队 / 部门</span><span>{{ detail.leader_name }} · {{ detail.lead_dept_name || '—' }}</span>
          <span class="k">调研周期</span><span class="num">{{ detail.start_date }} ~ {{ detail.end_date }}</span>
          <span class="k">当前状态</span><span><span :class="['tag', statusTag(detail.status)]">{{ statusLabel(detail.status) }}</span></span>
        </div>
        <div class="doc-paper" style="max-height:340px">
          <div class="doc-h2">调研报告摘要</div>
          <div class="doc-summary" style="background:#fff">{{ detail.summary_report || '（暂无报告内容）' }}</div>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="detail = null">关闭</button>
          <button v-if="detail.status === 'REPORT_REVIEW'" class="btn btn-primary" :disabled="finalizing" @click="finalize(detail)">评审通过并归档</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
