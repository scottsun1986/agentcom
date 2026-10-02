/* /portal/tasks 我的待办 — pixel replica of design/mockups/002-portal-tasks.png
   Layout: 3 stat cards / (待办 table + tabs + filters | 审批详情面板: 基本信息+流程时间线+审批动作) */
AppPages['/portal/tasks'] = {
  route: '/portal/tasks', title: '我的待办', category: 'PORTAL', primaryAction: null,
  subtitle: '集中处理跨模块的待审批、待执行事项，及时跟进协同工作。',
  icon: 'clipboard-list',
  component: {
    data() {
      return {
        loading: true,
        tab: 'pending',
        all: [],
        counts: { all: 0, pending: 0, executing: 0, feedback: 0 },
        moduleSel: '', typeSel: '', statusSel: '', kw: '',
        page: 1, pageSize: 10,
        selIds: [],
        selected: null,
        comment: '',
        auditing: false,
        tabs: [
          { key: 'pending', label: '待审批' },
          { key: 'executing', label: '待执行' },
          { key: 'feedback', label: '待反馈' },
        ],
        kindMeta: {
          leave: { icon: 'file-text', cls: 'ico-blue', module: '考勤管理', type: '请假申请', no: 'QJ' },
          trip: { icon: 'map-pin', cls: 'ico-red', module: '考勤管理', type: '外出报备', no: 'WC' },
          remedy: { icon: 'rotate-ccw', cls: 'ico-amber', module: '考勤管理', type: '补卡申请', no: 'BK' },
          asset_req: { icon: 'box', cls: 'ico-teal', module: '资产耗材', type: '资产领用', no: 'ZC' },
          consumable_req: { icon: 'package', cls: 'ico-teal', module: '资产耗材', type: '耗材申领', no: 'HC' },
          fleet: { icon: 'car', cls: 'ico-blue', module: '公务用车', type: '用车申请', no: 'YC' },
          visitor: { icon: 'users', cls: 'ico-blue', module: '门禁访客', type: '访客预约', no: 'FK' },
          visitor_host: { icon: 'users', cls: 'ico-teal', module: '门禁访客', type: '访客确认', no: 'FK' },
          supervision: { icon: 'target', cls: 'ico-amber', module: '重点督办', type: '督办审批', no: 'DB' },
        },
      };
    },
    computed: {
      userNick() { const u = api.cachedUser() || {}; return u.nick_name || '我'; },
      tabLabel() { const t = this.tabs.find((x) => x.key === this.tab); return t ? t.label : '待审批'; },
      moduleOptions() { return [...new Set(this.all.map((t) => this.moduleOf(t)))]; },
      typeOptions() { return [...new Set(this.all.map((t) => this.typeOf(t)))]; },
      statusOptions() { return [...new Set(this.all.map((t) => t.status).filter(Boolean))]; },
      filtered() {
        const kw = (this.kw || '').trim().toLowerCase();
        return this.all.filter((t) => {
          if (t.category !== this.tabLabel) return false;
          if (this.moduleSel && this.moduleOf(t) !== this.moduleSel) return false;
          if (this.typeSel && this.typeOf(t) !== this.typeSel) return false;
          if (this.statusSel && t.status !== this.statusSel) return false;
          if (kw && !((t.title || '').toLowerCase().includes(kw) || (t.applicant || '').toLowerCase().includes(kw))) return false;
          return true;
        });
      },
      total() { return this.filtered.length; },
      totalPages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
      paged() {
        const p = Math.min(this.page, this.totalPages);
        return this.filtered.slice((p - 1) * this.pageSize, p * this.pageSize);
      },
      pagesToShow() {
        const arr = [];
        const s = Math.max(1, Math.min(this.page - 2, this.totalPages - 4));
        for (let i = s; i <= Math.min(this.totalPages, s + 4); i++) arr.push(i);
        return arr;
      },
      allChecked() { return this.paged.length > 0 && this.paged.every((t) => this.selIds.includes(this.keyOf(t))); },
    },
    async mounted() { await this.load(); },
    methods: {
      keyOf(t) { return t.kind + '-' + t.id; },
      moduleOf(t) { return (this.kindMeta[t.kind] || {}).module || '其他'; },
      typeOf(t) { return (this.kindMeta[t.kind] || {}).type || '协同事项'; },
      kindIcon(t) { return (this.kindMeta[t.kind] || { icon: 'file-text' }).icon; },
      kindCls(t) { return (this.kindMeta[t.kind] || { cls: 'ico-blue' }).cls; },
      applyNo(t) {
        const no = (this.kindMeta[t.kind] || { no: 'XX' }).no;
        return no + String(t.id).replace(/-/g, '').slice(0, 10).toUpperCase();
      },
      fmtTime(s) { return s ? s.slice(0, 16).replace('T', ' ') : '—'; },
      fmtDay(s) { return s ? s.slice(0, 10) : '—'; },
      isLate(t) { return !!t.deadline && t.deadline.slice(0, 10) < new Date().toISOString().slice(0, 10); },
      statusTag(cat) { return { '待审批': 'tag-blue', '待执行': 'tag-teal', '待反馈': 'tag-amber' }[cat] || 'tag-gray'; },
      reasonOf(t) {
        const m = (t.title || '').match(/（(.+?)）/);
        return m ? m[1] : (t.title || '—');
      },
      async load() {
        try {
          const d = await api.get('/api/portal/todos');
          this.all = d.all || [];
          this.counts = d.counts || this.counts;
        } catch (e) { this.all = []; }
        this.loading = false;
        if (this.page > this.totalPages) this.page = this.totalPages;
        if (!this.selected || !this.filtered.some((t) => this.keyOf(t) === this.keyOf(this.selected))) {
          this.selected = this.paged[0] || null;
          this.comment = '';
        }
      },
      setTab(k) {
        this.tab = k; this.page = 1; this.selIds = [];
        if (!this.filtered.some((t) => this.selected && this.keyOf(t) === this.keyOf(this.selected))) {
          this.selected = this.filtered[0] || null;
          this.comment = '';
        }
      },
      selectItem(t) { this.selected = t; this.comment = ''; },
      closeDetail() { this.selected = null; },
      toggleAll() {
        if (this.allChecked) this.selIds = [];
        else this.selIds = this.paged.map((t) => this.keyOf(t));
      },
      goPage(p) { this.page = Math.min(Math.max(1, p), this.totalPages); },
      auditUrl(t) {
        const map = {
          leave: '/api/attendance/leaves/', trip: '/api/attendance/trips/', remedy: '/api/attendance/remedies/',
          asset_req: '/api/assets/requisitions/', consumable_req: '/api/assets/consumables/requisitions/',
          fleet: '/api/fleet/applications/', visitor: '/api/visitor/appointments/', visitor_host: '/api/visitor/appointments/',
        };
        const base = map[t.kind];
        return base ? base + t.id + '/audit' : null;
      },
      async doAudit(action) {
        const t = this.selected;
        if (!t || this.auditing) return;
        this.auditing = true;
        try {
          const body = { action, comment: this.comment || (action === 'APPROVE' ? '同意' : '不同意') };
          if (t.kind === 'fleet') body.step = 'ADMIN';
          if (t.kind === 'visitor' || t.kind === 'visitor_host') body.reason = body.comment;
          if (t.kind === 'supervision') {
            if ((t.title || '').indexOf('督办延期审批') === 0) {
              const ext = await api.page('/api/supervision/extensions', { task_id: t.id, status: 'PENDING', pageNum: 1, pageSize: 1 });
              const rid = ext.rows && ext.rows[0] && ext.rows[0].request_id;
              if (!rid) throw new Error('未找到待审的延期申请');
              await api.post('/api/supervision/extensions/' + rid + '/audit', body);
            } else {
              await api.post('/api/supervision/tasks/' + t.id + '/closeout-audit', body);
            }
          } else {
            const url = this.auditUrl(t);
            if (!url) throw new Error('该事项暂不支持在线审批');
            await api.post(url, body);
          }
          window.App && window.App.toast(action === 'APPROVE' ? '审批通过' : '已驳回', 'ok');
          this.selected = null;
          this.selIds = [];
          await this.load();
          window.App && window.App.refreshBadges && window.App.refreshBadges();
        } catch (e) { /* toast already shown by api */ }
        this.auditing = false;
      },
      openTodo(t) { location.hash = '#' + t.link; },
    },
    template: `
    <div v-if="!loading">
      <!-- stat cards -->
      <div class="grid cols-3">
        <div class="card kpi-card" v-for="tb in tabs" :key="tb.key" @click="setTab(tb.key)"
             :style="tab===tb.key ? 'border-color:var(--primary)' : ''">
          <div class="ico" :class="tb.key==='pending' ? 'ico-blue' : tb.key==='executing' ? 'ico-teal' : 'ico-amber'">
            <ic :name="tb.key==='pending' ? 'clipboard-list' : tb.key==='executing' ? 'play' : 'check-circle-2'" size="24"></ic>
          </div>
          <div class="meta">
            <div class="label">{{ tb.label }}</div>
            <div class="val" :style="{color: tb.key==='pending' ? 'var(--primary)' : tb.key==='executing' ? 'var(--teal)' : 'var(--amber)'}">{{ counts[tb.key] }}</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="task-layout mt16">
        <!-- left: todo table -->
        <div class="card" style="margin-top:0">
          <div class="pg-tabs">
            <span v-for="tb in tabs" :key="tb.key" class="pg-tab" :class="{on: tab===tb.key}" @click="setTab(tb.key)">
              {{ tb.label }} <span class="cnt">({{ counts[tb.key] }})</span>
            </span>
          </div>
          <div class="card-bd" style="padding-top:14px">
            <div class="filters" style="margin-bottom:12px">
              <select class="select" v-model="moduleSel" style="width:130px">
                <option value="">全部模块</option>
                <option v-for="m in moduleOptions" :key="m" :value="m">{{ m }}</option>
              </select>
              <select class="select" v-model="typeSel" style="width:130px">
                <option value="">全部类型</option>
                <option v-for="m in typeOptions" :key="m" :value="m">{{ m }}</option>
              </select>
              <select class="select" v-model="statusSel" style="width:120px">
                <option value="">全部状态</option>
                <option v-for="s in statusOptions" :key="s" :value="s">{{ s }}</option>
              </select>
              <div style="position:relative; flex:1; max-width:280px">
                <ic name="search" size="14" style="position:absolute; left:10px; top:9px; color:#A7B6C7"></ic>
                <input class="input" v-model="kw" placeholder="请输入事项名称、申请人" style="width:100%; padding-left:30px">
              </div>
            </div>
            <table class="table table-tight">
              <thead>
                <tr>
                  <th style="width:34px"><input type="checkbox" :checked="allChecked" @change="toggleAll"></th>
                  <th>事项名称</th>
                  <th style="width:84px">来源模块</th>
                  <th style="width:72px">申请人</th>
                  <th style="width:118px">提交时间</th>
                  <th style="width:96px">截止时间</th>
                  <th style="width:74px">状态</th>
                  <th style="width:56px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in paged" :key="keyOf(t)" :style="selected && keyOf(selected)===keyOf(t) ? 'background:var(--primary-weak)' : ''" @click="selectItem(t)">
                  <td @click.stop><input type="checkbox" :value="keyOf(t)" v-model="selIds"></td>
                  <td class="ellipsis" :title="t.title" style="max-width:220px">
                    <span :class="['ico-box', kindCls(t)]" style="display:inline-flex;width:26px;height:26px;border-radius:6px;align-items:center;justify-content:center;margin-right:8px;vertical-align:middle"><ic :name="kindIcon(t)" size="15"></ic></span>{{ t.title }}
                  </td>
                  <td class="muted">{{ moduleOf(t) }}</td>
                  <td>{{ t.applicant }}</td>
                  <td class="muted num">{{ fmtTime(t.submitted_at) }}</td>
                  <td class="num" :style="isLate(t) ? 'color:var(--red)' : ''">{{ fmtDay(t.deadline) }}</td>
                  <td><span :class="['tag', statusTag(t.category)]">{{ t.status }}</span></td>
                  <td class="actions"><button class="btn-text" style="padding:0" @click.stop="selectItem(t)">查看</button></td>
                </tr>
                <tr v-if="!paged.length"><td colspan="8"><div class="empty">当前筛选条件下暂无待办事项 🎉</div></td></tr>
              </tbody>
            </table>
            <div style="display:flex; align-items:center; justify-content:space-between; padding-top:12px">
              <span class="muted" style="font-size:12.5px">共 {{ total }} 条</span>
              <div style="display:flex; align-items:center; gap:6px">
                <div class="pager" style="padding:0">
                  <span class="pg" @click="goPage(page-1)"><ic name="chevron-left" size="14"></ic></span>
                  <span v-for="p in pagesToShow" :key="p" class="pg" :class="{on: p===page}" @click="goPage(p)">{{ p }}</span>
                  <span class="pg" @click="goPage(page+1)"><ic name="chevron-right" size="14"></ic></span>
                </div>
                <select class="select" v-model.number="pageSize" style="width:96px; font-size:12px">
                  <option :value="10">每页 10 条</option>
                  <option :value="20">每页 20 条</option>
                  <option :value="50">每页 50 条</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <!-- right: audit detail panel -->
        <div class="dtl-sticky">
          <div class="card" style="margin-top:0">
            <template v-if="selected">
              <div class="card-hd">
                <div class="t">
                  <span class="ico-box ico-blue" style="display:inline-flex;width:28px;height:28px;border-radius:6px;align-items:center;justify-content:center"><ic :name="kindIcon(selected)" size="16"></ic></span>
                  <span class="ellipsis" style="max-width:250px" :title="selected.title">{{ selected.title }}</span>
                  <span :class="['tag', statusTag(selected.category)]">{{ selected.status }}</span>
                </div>
                <ic name="x" size="16" style="cursor:pointer; color:var(--text-3)" @click="closeDetail"></ic>
              </div>
              <div style="padding:0 18px">
                <div class="dtl-meta">
                  <span>来源模块：{{ moduleOf(selected) }}</span>
                  <span>提交时间：{{ fmtTime(selected.submitted_at) }}</span>
                  <span>申请编号：{{ applyNo(selected) }}</span>
                </div>
              </div>
              <div class="card-bd" style="padding-top:10px">
                <div class="dtl-sec" style="margin-top:0"><ic name="file-text" size="15" style="color:var(--primary)"></ic>基本信息</div>
                <div class="dtl-grid">
                  <span class="k">申请人</span><span>{{ selected.applicant }}</span>
                  <span class="k">所属部门</span><span>{{ selected.dept || '—' }}</span>
                  <span class="k">申请类型</span><span>{{ typeOf(selected) }}</span>
                  <span class="k">当前状态</span><span><span :class="['tag', statusTag(selected.category)]">{{ selected.status }}</span></span>
                  <span class="k">申请事由</span><span>{{ reasonOf(selected) }}</span>
                </div>

                <div class="dtl-sec"><ic name="paperclip" size="15" style="color:var(--primary)"></ic>附件材料</div>
                <div class="empty" style="padding:8px 0; text-align:left; font-size:12.5px">暂无附件材料</div>

                <div class="dtl-sec"><ic name="milestone" size="15" style="color:var(--primary)"></ic>审批流程</div>
                <div class="tl">
                  <div class="tl-item">
                    <div style="display:flex; align-items:center">
                      <span class="strong">{{ selected.applicant }}</span>
                      <span class="muted" style="margin-left:8px; font-size:12px">发起申请</span>
                      <span class="tl-node-time">{{ fmtTime(selected.submitted_at) }}</span>
                    </div>
                  </div>
                  <div class="tl-item">
                    <div style="display:flex; align-items:center">
                      <span class="strong">{{ userNick }}</span>
                      <span style="margin-left:8px; font-size:12px; color:var(--primary)">当前审批人（待您处理）</span>
                      <span class="tl-node-time">{{ fmtTime(selected.submitted_at) }}</span>
                    </div>
                    <div class="muted" style="font-size:12px; margin-top:2px">等待您的审批意见</div>
                  </div>
                  <div class="tl-item gray" style="padding-bottom:4px">
                    <div style="display:flex; align-items:center">
                      <span class="strong" style="color:var(--text-2)">分管领导</span>
                      <span class="muted" style="margin-left:8px; font-size:12px">下一审批人</span>
                    </div>
                    <div class="muted" style="font-size:12px; margin-top:2px">待处理</div>
                  </div>
                </div>

                <div class="form-item" style="margin:16px 0 0">
                  <textarea class="input" v-model="comment" style="width:100%; min-height:64px" placeholder="请输入审批意见（选填）"></textarea>
                </div>
              </div>
              <div style="display:flex; justify-content:flex-end; gap:10px; padding:12px 18px; border-top:1px solid var(--line)">
                <button class="btn" @click="closeDetail">返回</button>
                <button class="btn btn-reject" :disabled="auditing" @click="doAudit('REJECT')"><ic name="x-circle" size="14"></ic> 驳回</button>
                <button class="btn btn-primary" :disabled="auditing" @click="doAudit('APPROVE')"><ic name="check" size="14"></ic> 同意</button>
              </div>
            </template>
            <div v-else class="empty" style="padding:90px 20px">
              <ic name="clipboard-list" size="36" style="color:#C2CFDD"></ic>
              <div style="margin-top:10px">请在左侧选择待办事项<br>查看审批详情并处理</div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
