/* /research/issues 调研现场实录与问题台账 — pixel replica of design/mockups/066-research-issues.png
   Layout: 4 KPI cards / filters + issue table + server pager / 新增问题 modal / 整改标记 */
AppPages['/research/issues'] = {
  route: '/research/issues', title: '调研现场实录与问题台账', category: 'RESEARCH', primaryAction: '新增现场记录', icon: 'clipboard-list',
  subtitle: '通过现场拍照、录音记录，收集基层反映的急难愁盼问题，明确初步承办整改部门，推动问题闭环解决。',
  component: {
    data() {
      return {
        loading: true,
        rows: [],
        total: 0,
        topics: [],
        depts: [],
        filters: { topic_id: '', status: '' },
        pageNum: 1,
        pageSize: 10,
        showCreate: false,
        submitting: false,
        detail: null,
        form: this.emptyForm(),
      };
    },
    computed: {
      counts() {
        const c = { total: this.total, LOGGED: 0, SUPERVISED: 0, RECTIFIED: 0 };
        this.rows.forEach((r) => { if (c[r.status] !== undefined) c[r.status]++; });
        return c;
      },
      rectifiedPct() { return this.counts.total ? Math.round(this.counts.RECTIFIED / this.counts.total * 1000) / 10 : 0; },
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
    async mounted() {
      try {
        const r = await api.page('/api/research/topics', { pageNum: 1, pageSize: 200 });
        this.topics = r.rows || [];
      } catch (e) { this.topics = []; }
      try { this.depts = await api.get('/api/system/depts'); } catch (e) { this.depts = []; }
      await this.load();
      this.loading = false;
    },
    methods: {
      emptyForm() {
        return { topic_id: '', issue_title: '', description: '', point_name: '', target_dept_id: '' };
      },
      async load() {
        try {
          const r = await api.page('/api/research/issues', {
            topic_id: this.filters.topic_id || undefined,
            status: this.filters.status || undefined,
            pageNum: this.pageNum, pageSize: this.pageSize,
          });
          this.rows = r.rows || [];
          this.total = r.total || 0;
        } catch (e) { this.rows = []; this.total = 0; }
      },
      statusLabel(s) { return { LOGGED: '待整改', SUPERVISED: '已转督办', RECTIFIED: '已整改' }[s] || s; },
      statusTag(s) { return { LOGGED: 'tag-amber', SUPERVISED: 'tag-blue', RECTIFIED: 'tag-green' }[s] || 'tag-gray'; },
      statusIcon(s) { return { LOGGED: 'alert-triangle', SUPERVISED: 'target', RECTIFIED: 'check-circle-2' }[s] || 'circle-help'; },
      query() { this.pageNum = 1; this.load(); },
      reset() { this.filters = { topic_id: '', status: '' }; this.query(); },
      goPage(p) {
        if (p === '...' || p < 1 || p > this.pageCount) return;
        this.pageNum = p;
        this.load();
      },
      openCreate() {
        this.form = this.emptyForm();
        if (this.filters.topic_id) this.form.topic_id = this.filters.topic_id;
        this.showCreate = true;
      },
      async submitCreate() {
        const f = this.form;
        if (!f.topic_id) return this.$root.toast('请选择所属课题', 'warn');
        if (!f.issue_title.trim()) return this.$root.toast('请填写问题标题', 'warn');
        if (!f.description.trim()) return this.$root.toast('请填写问题描述', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/research/issues', {
            topic_id: f.topic_id, issue_title: f.issue_title.trim(), description: f.description.trim(),
            point_name: f.point_name.trim() || null, target_dept_id: f.target_dept_id || null,
          });
          this.$root.toast('调研问题已登记', 'ok');
          this.showCreate = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async markRectified(it) {
        if (!window.confirm('确认问题【' + it.issue_title + '】已完成整改？')) return;
        try {
          await api.put('/api/research/issues/' + it.issue_id, { status: 'RECTIFIED' });
          this.$root.toast('已标记为已整改', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openCreate(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI cards -->
      <div class="kpi-row-4 rs-kpi4">
        <div class="card kpi-card">
          <div class="ico ico-blue"><ic name="clipboard-list" size="28"></ic></div>
          <div class="meta"><div class="label">调研发现问题</div><div class="val" style="color:var(--primary)">{{ counts.total }}</div>
            <div class="muted" style="font-size:12px">台账累计登记</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-amber"><ic name="alert-triangle" size="28"></ic></div>
          <div class="meta"><div class="label">待整改（已登记）</div><div class="val" style="color:var(--amber)">{{ counts.LOGGED }}</div>
            <div class="muted" style="font-size:12px">本页占比 {{ rows.length ? Math.round(counts.LOGGED / rows.length * 100) : 0 }}%</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-teal"><ic name="target" size="28"></ic></div>
          <div class="meta"><div class="label">已转督办</div><div class="val" style="color:var(--teal)">{{ counts.SUPERVISED }}</div>
            <div class="muted" style="font-size:12px">限期整改销号中</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/research/issues-to-supervision')">
          <div class="ico" style="background:var(--green-weak); color:var(--green)"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta"><div class="label">已完成整改</div><div class="val" style="color:var(--green)">{{ counts.RECTIFIED }}</div>
            <div class="muted" style="font-size:12px">本页占比 {{ rows.length ? Math.round(counts.RECTIFIED / rows.length * 100) : 0 }}%</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <!-- issue ledger -->
      <div class="card mt16">
        <div class="card-bd" style="padding-top:4px">
          <div class="filters" style="margin-bottom:12px">
            <select class="select" style="width:280px" v-model="filters.topic_id" @change="query">
              <option value="">全部调研课题</option>
              <option v-for="t in topics" :key="t.topic_id" :value="t.topic_id">{{ t.topic_no }} · {{ t.title }}</option>
            </select>
            <select class="select" style="width:140px" v-model="filters.status" @change="query">
              <option value="">全部办理状态</option><option value="LOGGED">待整改</option><option value="SUPERVISED">已转督办</option><option value="RECTIFIED">已整改</option>
            </select>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
            <span style="flex:1"></span>
            <button class="btn btn-ghost" @click="openCreate"><ic name="plus" size="14"></ic>新增问题</button>
          </div>
          <table class="table">
            <thead><tr><th style="width:52px">序号</th><th>问题标题</th><th>所属课题</th><th>发现点位</th><th>拟承办部门</th><th style="width:110px">状态</th><th style="width:110px">登记时间</th><th style="width:170px">操作</th></tr></thead>
            <tbody>
              <tr v-for="(it, i) in rows" :key="it.issue_id">
                <td class="num muted">{{ (pageNum - 1) * pageSize + i + 1 }}</td>
                <td><div class="strong ellipsis" style="max-width:250px; cursor:pointer" :title="it.issue_title" @click="detail = it">{{ it.issue_title }}</div></td>
                <td class="ellipsis" style="max-width:170px" :title="it.topic_title">{{ it.topic_title || '—' }}</td>
                <td class="muted">{{ it.point_name || '—' }}</td>
                <td>{{ it.target_dept_name || '待定' }}</td>
                <td><span :class="['tag', statusTag(it.status)]"><ic :name="statusIcon(it.status)" size="12"></ic>{{ it.status_label }}</span>
                  <div v-if="it.converted_supervision_no" class="muted" style="font-size:11px; margin-top:2px">{{ it.converted_supervision_no }}</div></td>
                <td class="num muted">{{ it.created_at ? it.created_at.slice(0, 16).replace('T', ' ') : '—' }}</td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="detail = it">查看</button>
                  <button v-if="it.status === 'LOGGED'" class="btn btn-text btn-sm" @click="$root.go('/research/issues-to-supervision')">转督办</button>
                  <button v-if="it.status !== 'RECTIFIED'" class="btn btn-primary btn-sm" @click="markRectified(it)">整改标记</button>
                </td>
              </tr>
              <tr v-if="!rows.length"><td colspan="8"><div class="empty">暂无问题台账记录</div></td></tr>
            </tbody>
          </table>
          <div class="pager" v-if="total > pageSize">
            <span>共 {{ total }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in pageCount" :key="p" v-show="pageCount <= 7 || p === 1 || p === pageCount || Math.abs(p - pageNum) <= 1" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
      </div>

      <!-- create modal -->
      <Modal title="新增现场记录（问题登记）" width="580px" v-if="showCreate" @close="showCreate = false">
        <div class="form-item">
          <label class="req">所属课题</label>
          <select class="select" v-model="form.topic_id">
            <option value="">请选择所属调研课题</option>
            <option v-for="t in topics" :key="t.topic_id" :value="t.topic_id">{{ t.topic_no }} · {{ t.title }}</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">问题标题</label>
          <input class="input" placeholder="简要概括问题，如：社区养老服务站点人员配备不足" v-model="form.issue_title">
        </div>
        <div class="form-item">
          <label class="req">问题描述</label>
          <textarea class="input" maxlength="500" placeholder="描述现场情况、群众诉求与初步核实结论" v-model="form.description"></textarea>
        </div>
        <div class="form-item">
          <label>发现点位</label>
          <input class="input" placeholder="如：XX区·幸福社区（可留空）" v-model="form.point_name">
        </div>
        <div class="form-item">
          <label>拟承办部门</label>
          <select class="select" v-model="form.target_dept_id">
            <option value="">待定</option>
            <option v-for="d in flatDepts" :key="d.dept_id" :value="d.dept_id">{{ d.dept_name }}</option>
          </select>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showCreate = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitCreate">登记问题</button>
        </template>
      </Modal>

      <!-- detail modal -->
      <Modal title="问题详情" width="560px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">问题标题</span><span class="strong">{{ detail.issue_title }}</span>
          <span class="k">所属课题</span><span>{{ detail.topic_title || '—' }}</span>
          <span class="k">发现点位</span><span>{{ detail.point_name || '—' }}</span>
          <span class="k">拟承办部门</span><span>{{ detail.target_dept_name || '待定' }}</span>
          <span class="k">问题描述</span><span style="white-space:pre-wrap">{{ detail.description || '—' }}</span>
          <span class="k">办理状态</span><span><span :class="['tag', statusTag(detail.status)]">{{ detail.status_label }}</span></span>
          <span class="k">督办编号</span><span class="num">{{ detail.converted_supervision_no || '—' }}</span>
          <span class="k">登记时间</span><span class="num">{{ detail.created_at ? detail.created_at.slice(0, 16).replace('T', ' ') : '—' }}</span>
        </div>
        <template #footer>
          <button v-if="detail.status !== 'RECTIFIED'" class="btn btn-primary" @click="markRectified(detail); detail = null">整改标记</button>
          <button class="btn btn-ghost" @click="detail = null">关闭</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
