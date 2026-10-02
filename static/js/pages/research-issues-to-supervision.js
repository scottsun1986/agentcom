/* /research/issues-to-supervision 调研问题转督办闭环 — pixel replica of design/mockups/068-research-issues-to-supervision.png
   Layout: 4 KPI cards / (LOGGED 问题清单（勾选转办） | 转督办立项表单) + SUPERVISED 已转办列表（督办编号 tag）*/
AppPages['/research/issues-to-supervision'] = {
  route: '/research/issues-to-supervision', title: '调研问题转督办闭环', category: 'RESEARCH', primaryAction: '新建督办转办', icon: 'rotate-ccw',
  subtitle: '将调研中发现的久拖不决的体制机制问题或重大民生隐患，一键转交为【政务重点督办】立项，要求承办处室限期整改销号。',
  component: {
    data() {
      return {
        loading: true,
        logged: [],
        supervised: [],
        rectified: 0,
        loggedTotal: 0,
        pageNum: 1,
        pageSize: 10,
        selected: [],
        deadline: '',
        priority: 'NORMAL',
        submitting: false,
        detail: null,
        priorities: [
          { key: 'TOP', label: '特急' },
          { key: 'URGENT', label: '紧急' },
          { key: 'NORMAL', label: '常规' },
        ],
      };
    },
    computed: {
      pageCount() { return Math.max(1, Math.ceil(this.loggedTotal / this.pageSize)); },
      allChecked() { return this.logged.length > 0 && this.selected.length === this.logged.length; },
    },
    async mounted() { await this.load(); this.loading = false; },
    methods: {
      async load() {
        try {
          const r = await api.page('/api/research/issues', { status: 'LOGGED', pageNum: this.pageNum, pageSize: this.pageSize });
          this.logged = r.rows || [];
          this.loggedTotal = r.total || 0;
        } catch (e) { this.logged = []; this.loggedTotal = 0; }
        try {
          const r = await api.page('/api/research/issues', { status: 'SUPERVISED', pageNum: 1, pageSize: 50 });
          this.supervised = r.rows || [];
        } catch (e) { this.supervised = []; }
        try {
          const r = await api.page('/api/research/issues', { status: 'RECTIFIED', pageNum: 1, pageSize: 1 });
          this.rectified = r.total || 0;
        } catch (e) { this.rectified = 0; }
      },
      statusTag(s) { return { LOGGED: 'tag-amber', SUPERVISED: 'tag-blue', RECTIFIED: 'tag-green' }[s] || 'tag-gray'; },
      toggleAll() {
        this.selected = this.allChecked ? [] : this.logged.map((i) => i.issue_id);
      },
      toggleOne(id) {
        const i = this.selected.indexOf(id);
        if (i >= 0) this.selected.splice(i, 1);
        else this.selected.push(id);
      },
      selIssue() { return this.logged.find((i) => i.issue_id === this.selected[0]) || null; },
      goPage(p) {
        if (p === '...' || p < 1 || p > this.pageCount) return;
        this.pageNum = p;
        this.selected = [];
        this.load();
      },
      defaultDeadline() {
        const d = new Date(Date.now() + 30 * 86400000);
        const pad = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
      },
      async submitConvert() {
        if (!this.selected.length) return this.$root.toast('请先勾选需要转督办的问题', 'warn');
        if (!this.deadline) return this.$root.toast('请选择整改时限', 'warn');
        this.submitting = true;
        let lastNo = '';
        for (const id of this.selected) {
          try {
            const d = await api.post('/api/research/issues/' + id + '/to-supervision', {
              deadline: this.deadline, priority: this.priority,
            });
            lastNo = d.supervision_no || lastNo;
          } catch (e) { /* toast shown, continue */ }
        }
        this.submitting = false;
        if (lastNo) this.$root.toast('已转督办立项，督办编号 ' + lastNo, 'ok');
        this.selected = [];
        this.deadline = '';
        this.priority = 'NORMAL';
        await this.load();
      },
      onPrimary() {
        if (!this.selected.length) return this.$root.toast('请先在清单中勾选待转督办问题', 'warn');
        this.deadline = this.deadline || this.defaultDeadline();
      },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI cards -->
      <div class="kpi-row-4 rs-kpi4">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="clipboard-list" size="28"></ic></div>
          <div class="meta"><div class="label">待转督办问题</div><div class="val" style="color:var(--primary)">{{ loggedTotal }}</div>
            <div class="muted" style="font-size:12px">LOGGED 已登记状态</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="send" size="28"></ic></div>
          <div class="meta"><div class="label">已转督办问题</div><div class="val" style="color:var(--teal)">{{ supervised.length }}<span v-if="supervised.length >= 50">+</span></div>
            <div class="muted" style="font-size:12px">已生成督办立项</div></div>
        </div>
        <div class="card kpi-card" @click="$root.go('/supervision/standing')">
          <div class="ico ico-amber"><ic name="clock" size="28"></ic></div>
          <div class="meta"><div class="label">整改进行中</div><div class="val" style="color:var(--amber)">{{ supervised.length }}<span v-if="supervised.length >= 50">+</span></div>
            <div class="muted" style="font-size:12px">督办台账跟踪销号</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/research/issues')">
          <div class="ico" style="background:var(--green-weak); color:var(--green)"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta"><div class="label">已整改销号</div><div class="val" style="color:var(--green)">{{ rectified }}</div>
            <div class="muted" style="font-size:12px">调研问题闭环完成</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="split-3-2" style="margin-top:16px; grid-template-columns: minmax(0, 1.25fr) minmax(340px, 1fr)">
        <!-- LOGGED issue list -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">调研问题清单（可转督办）</div>
            <span class="muted" style="font-size:12px">已选 <b style="color:var(--primary)">{{ selected.length }}</b> 项</span>
          </div>
          <div class="card-bd" style="padding-top:8px">
            <table class="table table-tight">
              <thead><tr>
                <th style="width:36px"><input type="checkbox" :checked="allChecked" @change="toggleAll" style="accent-color:var(--primary)"></th>
                <th>调研问题标题</th><th style="width:100px">发现时间</th><th style="width:120px">承办部门</th><th style="width:150px">操作</th>
              </tr></thead>
              <tbody>
                <tr v-for="it in logged" :key="it.issue_id" :class="{ sel: selected.includes(it.issue_id) }">
                  <td><input type="checkbox" :checked="selected.includes(it.issue_id)" @change="toggleOne(it.issue_id)" style="accent-color:var(--primary)"></td>
                  <td><div class="strong ellipsis" style="max-width:220px; cursor:pointer" :title="it.issue_title" @click="detail = it">{{ it.issue_title }}</div>
                    <div class="muted ellipsis" style="font-size:11.5px; max-width:220px" :title="it.topic_title">{{ it.topic_title || '—' }}<template v-if="it.point_name"> · {{ it.point_name }}</template></div></td>
                  <td class="num muted">{{ it.created_at ? it.created_at.slice(0, 10) : '—' }}</td>
                  <td>{{ it.target_dept_name || '待定' }}</td>
                  <td class="actions">
                    <button class="btn btn-text btn-sm" @click="detail = it">查看</button>
                    <button class="btn btn-primary btn-sm" @click="selected.includes(it.issue_id) || toggleOne(it.issue_id); deadline = deadline || defaultDeadline()">转督办</button>
                  </td>
                </tr>
                <tr v-if="!logged.length"><td colspan="5"><div class="empty">暂无待转督办问题 🎉</div></td></tr>
              </tbody>
            </table>
            <div class="pager" v-if="pageCount > 1">
              <span>共 {{ loggedTotal }} 条</span>
              <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
              <button v-for="p in pageCount" :key="p" v-show="pageCount <= 7 || p === 1 || p === pageCount || Math.abs(p - pageNum) <= 1" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
              <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
            </div>
          </div>

          <!-- supervised list -->
          <div class="card-hd" style="padding-top:6px"><div class="t">已转督办台账</div></div>
          <div class="card-bd" style="padding-top:6px">
            <table class="table table-tight" v-if="supervised.length">
              <thead><tr><th>调研问题标题</th><th style="width:170px">督办编号</th><th style="width:100px">状态</th></tr></thead>
              <tbody>
                <tr v-for="it in supervised" :key="it.issue_id">
                  <td><div class="ellipsis" style="max-width:240px" :title="it.issue_title">{{ it.issue_title }}</div></td>
                  <td class="num"><span class="tag tag-blue" style="font-variant-numeric:tabular-nums">{{ it.converted_supervision_no || '—' }}</span></td>
                  <td><span :class="['tag', statusTag(it.status)]">已转督办</span></td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty">暂无已转督办的问题</div>
          </div>
        </div>

        <!-- convert form -->
        <div class="card rs-convert-card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">转督办立项信息</div>
            <span :class="['tag', selected.length ? 'tag-green' : 'tag-gray']">
              <ic :name="selected.length ? 'check-circle-2' : 'circle-help'" size="12"></ic>{{ selected.length ? '已关联调研问题 ' + selected.length + ' 项' : '未关联调研问题' }}</span>
          </div>
          <div class="card-bd">
            <div v-if="selIssue" class="rs-linked-box">
              <div class="rs-linked-hd">关联的调研问题 <span class="more" style="margin-left:auto" @click="detail = selIssue">查看原问题 <ic name="chevron-right" size="12"></ic></span></div>
              <div class="rs-linked-grid">
                <span class="k">问题标题</span><span class="strong">{{ selIssue.issue_title }}</span>
                <span class="k">调研课题</span><span>{{ selIssue.topic_title || '—' }}</span>
                <span class="k">拟承办部门</span><span>{{ selIssue.target_dept_name || '默认课题牵头部门' }}</span>
              </div>
            </div>
            <div v-else class="rs-linked-box empty-box">请在左侧清单勾选需要转督办的问题（支持多选批量转办）</div>

            <div class="form-item" style="margin-top:14px">
              <label class="req">整改时限</label>
              <input type="date" class="input" v-model="deadline">
            </div>
            <div class="form-item">
              <label class="req">紧急程度</label>
              <div style="flex:1; display:flex; gap:8px">
                <span v-for="p in priorities" :key="p.key" class="mode-card" :class="{ on: priority === p.key }" style="flex:1; align-items:center" @click="priority = p.key">
                  <b><ic :name="p.key === 'TOP' ? 'siren' : p.key === 'URGENT' ? 'alert-triangle' : 'flag'" size="13"></ic>{{ p.label }}</b>
                </span>
              </div>
            </div>
            <div class="rs-convert-tip">
              <ic name="info" size="14"></ic>
              转办后将自动在【重点督办】模块生成督办事项立项，要求承办部门限期整改销号，进度可在督办指挥大屏跟踪。
            </div>
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px">
              <button class="btn btn-ghost" @click="selected = []; deadline = ''">取消</button>
              <button class="btn btn-primary" :disabled="submitting || !selected.length" @click="submitConvert">
                <ic name="send" size="14"></ic>{{ submitting ? '转办中…' : '转办督办' }}</button>
            </div>
          </div>
        </div>
      </div>

      <!-- detail modal -->
      <Modal title="调研问题详情" width="560px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">问题标题</span><span class="strong">{{ detail.issue_title }}</span>
          <span class="k">调研课题</span><span>{{ detail.topic_title || '—' }}</span>
          <span class="k">发现点位</span><span>{{ detail.point_name || '—' }}</span>
          <span class="k">拟承办部门</span><span>{{ detail.target_dept_name || '待定' }}</span>
          <span class="k">问题描述</span><span style="white-space:pre-wrap">{{ detail.description || '—' }}</span>
          <span class="k">办理状态</span><span><span :class="['tag', statusTag(detail.status)]">{{ detail.status_label }}</span></span>
          <span class="k">督办编号</span><span class="num">{{ detail.converted_supervision_no || '—' }}</span>
          <span class="k">登记时间</span><span class="num">{{ detail.created_at ? detail.created_at.slice(0, 16).replace('T', ' ') : '—' }}</span>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="detail = null">关闭</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
