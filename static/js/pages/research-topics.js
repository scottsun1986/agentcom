/* /research/topics 调研课题立项申报 — pixel replica of design/mockups/063-research-topics.png
   Layout: 4 KPI cards / filters + topic table + pager / 立项申报 modal（动态点位行 + 撞期提示）*/
AppPages['/research/topics'] = {
  route: '/research/topics', title: '调研课题立项申报', category: 'RESEARCH', primaryAction: '新建课题申报', icon: 'file-plus',
  subtitle: '围绕中心工作，规范开展调查研究，推动问题发现与解决。',
  component: {
    data() {
      return {
        loading: true,
        topics: [],
        depts: [],
        filters: { keyword: '', status: '', type: '' },
        pageNum: 1,
        pageSize: 10,
        showCreate: false,
        submitting: false,
        detail: null,
        conflicts: [],
        form: this.emptyForm(),
      };
    },
    computed: {
      counts() {
        const c = { total: this.topics.length, PLANNED: 0, APPROVED: 0, IN_PROGRESS: 0, REPORT_REVIEW: 0, COMPLETED: 0, conflict: 0 };
        this.topics.forEach((t) => {
          if (c[t.status] !== undefined) c[t.status]++;
          if (t.has_conflict) c.conflict++;
        });
        return c;
      },
      filtered() {
        const f = this.filters;
        const kw = (f.keyword || '').trim().toLowerCase();
        return this.topics.filter((t) => {
          if (f.status && t.status !== f.status) return false;
          if (f.type && t.research_type !== f.type) return false;
          if (kw && !((t.title || '') + (t.topic_no || '') + (t.leader_name || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      pageTotal() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      flatDepts() {
        const out = [];
        const walk = (nodes, depth) => (nodes || []).forEach((n) => {
          out.push({ dept_id: n.dept_id, dept_name: (depth > 0 ? '　'.repeat(depth) : '') + n.dept_name });
          walk(n.children, depth + 1);
        });
        walk(this.depts, 0);
        return out;
      },
    },
    async mounted() { await this.load(); this.loading = false; },
    methods: {
      emptyForm() {
        return {
          title: '', leader_name: '', lead_dept_id: '', escort_members: '',
          start_date: '', end_date: '', research_type: 'SPECIAL',
          points: [{ point_name: '', scheduled_date: '' }],
        };
      },
      async load() {
        try {
          const r = await api.page('/api/research/topics', { pageNum: 1, pageSize: 200 });
          this.topics = r.rows || [];
        } catch (e) { this.topics = []; }
        try { this.depts = await api.get('/api/system/depts'); } catch (e) { this.depts = []; }
      },
      typeLabel(t) {
        return { SPECIAL: '专题调研', GRASSROOTS: '蹲点调研', ANATOMY: '解剖式调研', SECRET_VISIT: '暗访微调研' }[t] || t;
      },
      typeTag(t) {
        return { SPECIAL: 'tag-blue', GRASSROOTS: 'tag-teal', ANATOMY: 'tag-amber', SECRET_VISIT: 'tag-red' }[t] || 'tag-gray';
      },
      statusLabel(s) {
        return { PLANNED: '已规划', APPROVED: '已批准', IN_PROGRESS: '进行中', REPORT_REVIEW: '报告评审', COMPLETED: '已完成' }[s] || s;
      },
      statusTag(s) {
        return { PLANNED: 'tag-gray', APPROVED: 'tag-blue', IN_PROGRESS: 'tag-teal', REPORT_REVIEW: 'tag-amber', COMPLETED: 'tag-green' }[s] || 'tag-gray';
      },
      query() { this.pageNum = 1; },
      reset() { this.filters = { keyword: '', status: '', type: '' }; this.query(); },
      goPage(p) {
        if (p === '...' || p < 1 || p > this.pageCount) return;
        this.pageNum = p;
      },
      openCreate() {
        this.form = this.emptyForm();
        this.conflicts = [];
        this.showCreate = true;
      },
      addPoint() { this.form.points.push({ point_name: '', scheduled_date: '' }); },
      rmPoint(i) { this.form.points.splice(i, 1); },
      async submitCreate() {
        const f = this.form;
        if (!f.title.trim()) return this.$root.toast('请填写课题名称', 'warn');
        if (!f.leader_name.trim()) return this.$root.toast('请填写领队领导', 'warn');
        if (!f.lead_dept_id) return this.$root.toast('请选择牵头部门', 'warn');
        if (!f.start_date || !f.end_date) return this.$root.toast('请选择调研周期', 'warn');
        if (f.end_date < f.start_date) return this.$root.toast('结束日期不能早于开始日期', 'warn');
        const points = f.points.filter((p) => p.point_name.trim());
        if (!points.length) return this.$root.toast('请至少填写一个调研点位', 'warn');
        if (points.some((p) => !p.scheduled_date)) return this.$root.toast('请为每个点位选择计划日期', 'warn');
        this.submitting = true;
        try {
          const d = await api.post('/api/research/topics', {
            title: f.title.trim(), leader_name: f.leader_name.trim(), lead_dept_id: f.lead_dept_id,
            escort_members: f.escort_members.trim() || null, start_date: f.start_date, end_date: f.end_date,
            research_type: f.research_type,
            points: points.map((p) => ({ point_name: p.point_name.trim(), scheduled_date: p.scheduled_date })),
          });
          this.$root.toast('课题已立项，编号 ' + d.topic_no, 'ok');
          this.showCreate = false;
          this.conflicts = d.conflicts || [];
          if (this.conflicts.length) this.$root.toast('检测到撞期风险，请查看提示', 'warn');
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async approve(t) {
        if (!window.confirm('确认通过课题【' + t.title + '】的报备审批？')) return;
        try {
          await api.post('/api/research/topics/' + t.topic_id + '/approve', {});
          this.$root.toast('报备审批通过', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      async start(t) {
        if (!window.confirm('确认开始实施课题【' + t.title + '】？')) return;
        try {
          await api.post('/api/research/topics/' + t.topic_id + '/start', {});
          this.$root.toast('调研已开始实施', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      async openDetail(t) {
        try { this.detail = await api.get('/api/research/topics/' + t.topic_id); } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openCreate(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI cards -->
      <div class="kpi-row-4 rs-kpi4">
        <div class="card kpi-card">
          <div class="ico ico-blue"><ic name="file-text" size="28"></ic></div>
          <div class="meta"><div class="label">全部课题</div><div class="val" style="color:var(--primary)">{{ counts.total }}</div></div>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-teal"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta"><div class="label">已批准 / 进行中</div><div class="val" style="color:var(--teal)">{{ counts.APPROVED }} / {{ counts.IN_PROGRESS }}</div></div>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-amber"><ic name="clock" size="28"></ic></div>
          <div class="meta"><div class="label">待审批（已规划）</div><div class="val" style="color:var(--amber)">{{ counts.PLANNED }}</div></div>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-red"><ic name="siren" size="28"></ic></div>
          <div class="meta"><div class="label">撞期预警课题</div><div class="val" style="color:var(--red)">{{ counts.conflict }}</div></div>
        </div>
      </div>

      <!-- topic list -->
      <div class="card mt16">
        <div class="card-bd" style="padding-top:4px">
          <div class="filters" style="margin-bottom:12px">
            <input class="input" style="width:220px" placeholder="请输入课题名称 / 编号关键词" v-model="filters.keyword" @keyup.enter="query">
            <select class="select" style="width:140px" v-model="filters.type" @change="query">
              <option value="">全部调研类型</option><option value="SPECIAL">专题调研</option><option value="GRASSROOTS">蹲点调研</option><option value="ANATOMY">解剖式调研</option><option value="SECRET_VISIT">暗访微调研</option>
            </select>
            <select class="select" style="width:140px" v-model="filters.status" @change="query">
              <option value="">全部状态</option><option value="PLANNED">已规划</option><option value="APPROVED">已批准</option><option value="IN_PROGRESS">进行中</option><option value="REPORT_REVIEW">报告评审</option><option value="COMPLETED">已完成</option>
            </select>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr><th style="width:36px"></th><th>课题编号 / 名称</th><th style="width:110px">调研类型</th><th style="width:90px">领队</th><th style="width:130px">牵头部门</th><th style="width:190px">调研周期</th><th style="width:96px">状态</th><th style="width:110px">撞期预警</th><th style="width:200px">操作</th></tr></thead>
            <tbody>
              <tr v-for="t in shownRows" :key="t.topic_id">
                <td><span class="rs-no-badge">{{ t.topic_no.split('-').pop() }}</span></td>
                <td><div class="strong ellipsis" style="max-width:280px; cursor:pointer" @click="openDetail(t)" :title="t.title">{{ t.title }}</div>
                  <div class="muted" style="font-size:12px">{{ t.topic_no }}</div></td>
                <td><span :class="['tag', typeTag(t.research_type)]">{{ typeLabel(t.research_type) }}</span></td>
                <td>{{ t.leader_name }}</td>
                <td class="muted">{{ t.lead_dept_name || '—' }}</td>
                <td class="num muted">{{ t.start_date }}<br>至 {{ t.end_date }}</td>
                <td><span :class="['tag', statusTag(t.status)]">{{ statusLabel(t.status) }}</span></td>
                <td><span v-if="t.has_conflict" class="tag tag-red"><ic name="siren" size="12"></ic>撞期预警</span><span v-else class="muted">—</span></td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="openDetail(t)">查看</button>
                  <button v-if="t.status === 'PLANNED'" class="btn btn-primary btn-sm" @click="approve(t)">报备审批</button>
                  <button v-if="t.status === 'APPROVED'" class="btn btn-primary btn-sm" @click="start(t)">开始调研</button>
                </td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="9"><div class="empty">暂无调研课题</div></td></tr>
            </tbody>
          </table>
          <div class="pager" v-if="pageCount > 1">
            <span>共 {{ pageTotal }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in pageCount" :key="p" v-show="pageCount <= 7 || p === 1 || p === pageCount || Math.abs(p - pageNum) <= 1" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
      </div>

      <!-- create modal -->
      <Modal title="新建课题申报" width="620px" v-if="showCreate" @close="showCreate = false">
        <div class="form-item">
          <label class="req">课题名称</label>
          <input class="input" placeholder="请输入调研课题名称" v-model="form.title">
        </div>
        <div class="form-item">
          <label class="req">调研类型</label>
          <select class="select" v-model="form.research_type">
            <option value="SPECIAL">专题调研</option><option value="GRASSROOTS">蹲点调研</option><option value="ANATOMY">解剖式调研</option><option value="SECRET_VISIT">暗访微调研</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">领队领导</label>
          <input class="input" placeholder="请输入领队领导姓名" v-model="form.leader_name">
        </div>
        <div class="form-item">
          <label class="req">牵头部门</label>
          <select class="select" v-model="form.lead_dept_id">
            <option value="">请选择牵头部门</option>
            <option v-for="d in flatDepts" :key="d.dept_id" :value="d.dept_id">{{ d.dept_name }}</option>
          </select>
        </div>
        <div class="form-item">
          <label>陪同人员</label>
          <input class="input" placeholder="请输入陪同人员名单，多个用顿号或逗号分隔" v-model="form.escort_members">
        </div>
        <div class="form-item">
          <label class="req">调研周期</label>
          <div style="flex:1; display:flex; align-items:center; gap:8px">
            <input type="date" class="input" v-model="form.start_date">
            <span class="muted">~</span>
            <input type="date" class="input" v-model="form.end_date">
          </div>
        </div>
        <div class="form-item">
          <label class="req" style="padding-top:6px">调研点位</label>
          <div style="flex:1">
            <div v-for="(p, i) in form.points" :key="i" class="rs-point-row">
              <span class="rs-point-idx">{{ i + 1 }}</span>
              <input class="input" style="flex:1" placeholder="点位名称，如：临江街道办事处" v-model="p.point_name">
              <input type="date" class="input" style="width:150px" v-model="p.scheduled_date">
              <button v-if="form.points.length > 1" class="btn btn-ghost btn-sm rs-point-rm" @click="rmPoint(i)" title="删除点位"><ic name="x" size="14"></ic></button>
            </div>
            <button class="btn btn-ghost btn-sm" @click="addPoint"><ic name="plus" size="14"></ic>添加点位</button>
          </div>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showCreate = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitCreate">提交立项申报</button>
        </template>
      </Modal>

      <!-- conflict alert modal -->
      <Modal title="撞期预警提示" width="560px" v-if="conflicts.length" @close="conflicts = []">
        <div class="rs-conflict-banner">
          <ic name="siren" size="20"></ic>
          <div><b>检测到 {{ conflicts.length }} 条撞期风险</b><div style="font-size:12px; margin-top:2px">以下时段已有其它未结题课题安排同一/相近点位，建议调整时间或开展联合调研，避免基层迎检过载。</div></div>
        </div>
        <table class="table" style="margin-top:12px">
          <thead><tr><th>送检点位</th><th>撞期课题</th><th>撞期点位</th><th>撞期日期</th><th>领队</th></tr></thead>
          <tbody>
            <tr v-for="(c, i) in conflicts" :key="i">
              <td>{{ c.point_name }}</td>
              <td class="ellipsis" style="max-width:160px" :title="c.topic_title"><span class="muted">{{ c.topic_no }}</span> {{ c.topic_title }}</td>
              <td>{{ c.existing_point_name }}</td>
              <td class="num" style="color:var(--red); font-weight:600">{{ c.scheduled_date }}</td>
              <td>{{ c.leader_name }}</td>
            </tr>
          </tbody>
        </table>
        <template #footer>
          <button class="btn btn-primary" @click="conflicts = []">我已知晓</button>
        </template>
      </Modal>

      <!-- detail modal -->
      <Modal title="课题申报详情" width="640px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">课题编号</span><span class="strong">{{ detail.topic_no }}</span>
          <span class="k">课题名称</span><span class="strong">{{ detail.title }}</span>
          <span class="k">调研类型</span><span><span :class="['tag', typeTag(detail.research_type)]">{{ detail.research_type_label }}</span></span>
          <span class="k">领队 / 部门</span><span>{{ detail.leader_name }} · {{ detail.lead_dept_name || '—' }}</span>
          <span class="k">陪同人员</span><span>{{ detail.escort_members || '—' }}</span>
          <span class="k">调研周期</span><span class="num">{{ detail.start_date }} ~ {{ detail.end_date }}</span>
          <span class="k">当前状态</span><span><span :class="['tag', statusTag(detail.status)]">{{ detail.status_label }}</span>
            <span v-if="detail.has_conflict" class="tag tag-red" style="margin-left:6px"><ic name="siren" size="12"></ic>撞期预警</span></span>
        </div>
        <div class="dtl-sec"><ic name="map-pin" size="15"></ic>计划调研点位（{{ (detail.points || []).length }}）</div>
        <table class="table" v-if="(detail.points || []).length">
          <thead><tr><th>点位名称</th><th>计划日期</th><th>联系人</th><th>联系电话</th><th>撞期</th></tr></thead>
          <tbody>
            <tr v-for="p in detail.points" :key="p.point_id">
              <td class="strong">{{ p.point_name }}</td>
              <td class="num muted">{{ p.scheduled_date }}</td>
              <td>{{ p.contact_person || '—' }}</td>
              <td class="num">{{ p.contact_phone || '—' }}</td>
              <td><span v-if="p.conflict_detected" class="tag tag-red">撞期</span><span v-else class="muted">—</span></td>
            </tr>
          </tbody>
        </table>
        <div v-else class="empty">暂未登记点位</div>
        <div class="dtl-sec"><ic name="clipboard-list" size="15"></ic>问题台账（{{ (detail.issues || []).length }}）</div>
        <div v-if="(detail.issues || []).length">
          <div v-for="it in detail.issues" :key="it.issue_id" class="sup-upcoming">
            <span class="sup-up-dot" :style="{ background: it.status === 'RECTIFIED' ? 'var(--green)' : it.status === 'SUPERVISED' ? 'var(--primary)' : 'var(--amber)' }"></span>
            <span style="flex:1" class="ellipsis" :title="it.issue_title">{{ it.issue_title }}</span>
            <span :class="['tag', it.status === 'RECTIFIED' ? 'tag-green' : it.status === 'SUPERVISED' ? 'tag-blue' : 'tag-amber']">{{ it.status_label }}</span>
          </div>
        </div>
        <div v-else class="empty">该课题暂无问题记录</div>
        <template #footer>
          <button class="btn btn-ghost" @click="detail = null">关闭</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
