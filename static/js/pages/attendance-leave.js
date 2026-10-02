/* /attendance/leave 请假休假中心 — pixel replica of design/mockups/008-attendance-leave.png
   Layout: 3 quota cards / tabs + filters + leave table + pager / (假种配置额度 | 调休流水) + 新增申请 modal */
AppPages['/attendance/leave'] = {
  route: '/attendance/leave', title: '请假休假中心', category: 'ATTENDANCE', primaryAction: '发起请假申请', icon: 'calendar-days',
  subtitle: '规范请假休假流程，支持多级审批、额度自动校验与销假闭环管理。',
  component: {
    data() {
      return {
        loading: true,
        leaves: [],
        quotas: [],
        myQuotas: [],
        canAudit: false,
        tab: 'all',
        filters: { type: '', status: '', start: '', end: '', keyword: '' },
        pageNum: 1,
        pageSize: 10,
        showApply: false,
        submitting: false,
        detail: null,
        form: { leave_type: 'ANNUAL', start_time: '', end_time: '', reason: '' },
        typeRules: {
          ANNUAL: '按国家规定和司龄计算', SICK: '需提供医院证明，按制度执行', CASUAL: '按制度执行',
          COMP: '根据加班时长兑换，1小时=1小时调休', MARITAL: '按国家规定婚假执行', MATERNITY: '按国家规定产假执行',
          PATERNITY: '按国家规定陪产假执行', HOME_VISIT: '按探亲假制度执行',
        },
      };
    },
    computed: {
      myId() { const u = api.cachedUser(); return u ? u.user_id : null; },
      tabCounts() {
        const c = { all: this.leaves.length, PENDING: 0, APPROVED: 0, REJECTED: 0 };
        this.leaves.forEach((l) => { if (c[l.audit_status] !== undefined) c[l.audit_status]++; });
        return c;
      },
      filtered() {
        const f = this.filters;
        const kw = (f.keyword || '').trim().toLowerCase();
        return this.leaves.filter((l) => {
          if (this.tab !== 'all' && l.audit_status !== this.tab) return false;
          if (f.type && l.leave_type !== f.type) return false;
          if (f.status && l.audit_status !== f.status) return false;
          if (f.start && this.bjDate(l.end_time) < f.start) return false;
          if (f.end && this.bjDate(l.start_time) > f.end) return false;
          if (kw && !((l.reason || '') + (l.user_name || '') + (l.approver_name || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      pageTotal() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      annualQuota() { return this.myQuotas.find((q) => q.leave_type === 'ANNUAL') || null; },
      compQuota() { return this.myQuotas.find((q) => q.leave_type === 'COMP') || null; },
      otherQuotas() { return this.myQuotas.filter((q) => !['ANNUAL', 'COMP'].includes(q.leave_type)); },
      quotaAgg() {
        const m = {};
        this.quotas.forEach((q) => {
          const k = q.leave_type;
          if (!m[k]) m[k] = { leave_type: k, leave_type_label: q.leave_type_label, total: 0, used: 0, remain: 0 };
          m[k].total += Number(q.total_days) || 0;
          m[k].used += Number(q.used_days) || 0;
          m[k].remain += Number(q.remain_days) || 0;
        });
        return Object.values(m);
      },
    },
    async mounted() {
      try {
        const info = await api.get('/api/auth/info');
        const perms = info.permissions || [];
        this.canAudit = perms.includes('*:*:*') || perms.includes('attendance:leave:audit');
      } catch (e) { /* keep false */ }
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
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
      },
      bjDate(s) { const v = this.bj(s); return v === '—' ? '' : v.slice(0, 10); },
      async load() {
        try {
          const r = await api.page('/api/attendance/leaves', { pageNum: 1, pageSize: 200 });
          this.leaves = r.rows || [];
        } catch (e) { this.leaves = []; }
        try { this.quotas = await api.get('/api/attendance/quotas'); } catch (e) { this.quotas = []; }
        this.myQuotas = this.quotas.filter((q) => !this.myId || q.user_id === this.myId);
      },
      statusLabel(s) { return { PENDING: '待审批', APPROVED: '已通过', REJECTED: '已驳回', CANCELLED: '已作废' }[s] || s; },
      statusTag(s) { return { PENDING: 'tag-blue', APPROVED: 'tag-green', REJECTED: 'tag-red', CANCELLED: 'tag-gray' }[s] || 'tag-gray'; },
      typeIcon(t) { return { ANNUAL: 'sun', SICK: 'activity', CASUAL: 'clipboard-list', COMP: 'history', MARITAL: 'star', MATERNITY: 'users', PATERNITY: 'user', HOME_VISIT: 'home' }[t] || 'file-text'; },
      setTab(t) { this.tab = t; this.pageNum = 1; },
      query() { this.pageNum = 1; },
      reset() { this.filters = { type: '', status: '', start: '', end: '', keyword: '' }; this.query(); },
      goPage(p) {
        if (p === '...' || p < 1 || p > this.pageCount) return;
        this.pageNum = p;
      },
      openApply() {
        this.form = { leave_type: 'ANNUAL', start_time: '', end_time: '', reason: '' };
        this.showApply = true;
      },
      async submitApply() {
        const f = this.form;
        if (!f.leave_type) return this.$root.toast('请选择假种类型', 'warn');
        if (!f.start_time || !f.end_time) return this.$root.toast('请选择请假起止时间', 'warn');
        if (f.end_time <= f.start_time) return this.$root.toast('结束时间必须晚于开始时间', 'warn');
        if (!f.reason.trim()) return this.$root.toast('请填写请假事由', 'warn');
        this.submitting = true;
        try {
          const st = f.start_time.length === 16 ? f.start_time + ':00+08:00' : f.start_time;
          const et = f.end_time.length === 16 ? f.end_time + ':00+08:00' : f.end_time;
          await api.post('/api/attendance/leaves', { leave_type: f.leave_type, start_time: st, end_time: et, reason: f.reason.trim() });
          this.$root.toast('请假申请已提交', 'ok');
          this.showApply = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async audit(l, action) {
        const tip = action === 'APPROVE' ? '确认通过该请假申请？' : '确认驳回该请假申请？';
        if (!window.confirm(tip)) return;
        try {
          await api.post('/api/attendance/leaves/' + l.apply_id + '/audit', { action, comment: action === 'APPROVE' ? '同意' : '不符合条件，驳回' });
          this.$root.toast(action === 'APPROVE' ? '已通过该请假申请' : '已驳回该请假申请', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openApply(); },
    },
    template: `
    <div v-if="!loading">
      <!-- quota summary cards -->
      <div class="leave-cards">
        <div class="card leave-card" style="margin-top:0">
          <span class="ico-box ico-blue" style="width:44px;height:44px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center"><ic name="sun" size="24"></ic></span>
          <div class="meta">
            <div class="label">年假余额 <a class="card-link" @click="$root.go('/attendance/rules')">额度详情 <ic name="chevron-right" size="12"></ic></a></div>
            <div class="val" style="color:var(--primary)">{{ annualQuota ? annualQuota.remain_days : 0 }} <span style="font-size:14px;font-weight:400;color:var(--text)">天</span></div>
            <div class="muted" style="font-size:12px">本年度总额 {{ annualQuota ? annualQuota.total_days : 0 }} 天 · 已用 {{ annualQuota ? annualQuota.used_days : 0 }} 天</div>
          </div>
        </div>
        <div class="card leave-card" style="margin-top:0">
          <span class="ico-box ico-teal" style="width:44px;height:44px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center"><ic name="history" size="24"></ic></span>
          <div class="meta">
            <div class="label">调休假余额 <a class="card-link" @click="tab='all'; query()">流水明细 <ic name="chevron-right" size="12"></ic></a></div>
            <div class="val" style="color:var(--teal)">{{ compQuota ? compQuota.remain_days : 0 }} <span style="font-size:14px;font-weight:400;color:var(--text)">天</span></div>
            <div class="muted" style="font-size:12px">加班兑换 · 已用 {{ compQuota ? compQuota.used_days : 0 }} 天 · 剩余 {{ compQuota ? compQuota.remain_days : 0 }} 天</div>
          </div>
        </div>
        <div class="card leave-card" style="margin-top:0">
          <span class="ico-box ico-amber" style="width:44px;height:44px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center"><ic name="file-text" size="24"></ic></span>
          <div class="meta">
            <div class="label">其他假期 <a class="card-link" @click="$root.go('/attendance/rules')">假种配置 <ic name="chevron-right" size="12"></ic></a></div>
            <div class="strong" style="font-size:14px; margin-top:4px">
              <template v-if="otherQuotas.length">
                <span v-for="q in otherQuotas" :key="q.leave_type" style="margin-right:10px">{{ q.leave_type_label }} {{ q.remain_days }}天</span>
              </template>
              <span v-else class="muted" style="font-weight:400">根据单位制度及个人情况计算</span>
            </div>
            <div class="muted" style="font-size:12px">病假 / 事假 / 婚假 / 产假等</div>
          </div>
        </div>
      </div>

      <!-- applications -->
      <div class="card mt16">
        <div class="card-bd" style="padding-top:4px">
          <div class="lr-tabs" style="margin:0 0 12px">
            <span :class="['lr-tab', tab === 'all' ? 'on' : '']" @click="setTab('all')">全部申请 ({{ tabCounts.all }})</span>
            <span :class="['lr-tab', tab === 'PENDING' ? 'on' : '']" @click="setTab('PENDING')">待审批 ({{ tabCounts.PENDING }})</span>
            <span :class="['lr-tab', tab === 'APPROVED' ? 'on' : '']" @click="setTab('APPROVED')">已通过 ({{ tabCounts.APPROVED }})</span>
            <span :class="['lr-tab', tab === 'REJECTED' ? 'on' : '']" @click="setTab('REJECTED')">已驳回 ({{ tabCounts.REJECTED }})</span>
          </div>
          <div class="filters">
            <select class="select" style="width:140px" v-model="filters.type" @change="query">
              <option value="">全部假种</option><option value="ANNUAL">年假</option><option value="SICK">病假</option><option value="CASUAL">事假</option><option value="COMP">调休假</option><option value="MARITAL">婚假</option><option value="MATERNITY">产假</option>
            </select>
            <select class="select" style="width:130px" v-model="filters.status" @change="query">
              <option value="">全部状态</option><option value="PENDING">待审批</option><option value="APPROVED">已通过</option><option value="REJECTED">已驳回</option>
            </select>
            <input type="date" class="input" style="width:145px" v-model="filters.start" @change="query">
            <span class="muted">~</span>
            <input type="date" class="input" style="width:145px" v-model="filters.end" @change="query">
            <input class="input" style="flex:1; min-width:180px" placeholder="请输入申请事由、审批人等" v-model="filters.keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr><th>申请人</th><th>假种类型</th><th>请假时间</th><th>请假时长</th><th>申请事由</th><th>申请日期</th><th>当前状态</th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="l in shownRows" :key="l.apply_id">
                <td class="strong">{{ l.user_name || '—' }}</td>
                <td><span class="tag tag-blue"><ic :name="typeIcon(l.leave_type)" size="12"></ic>{{ l.leave_type_label }}</span></td>
                <td class="num muted">{{ bjDate(l.start_time) }} ~ {{ bjDate(l.end_time) }}</td>
                <td class="num">{{ l.duration_days }} 天</td>
                <td class="ellipsis" :title="l.reason" style="max-width:220px">{{ l.reason || '—' }}</td>
                <td class="num muted">{{ bjDate(l.created_at) }}</td>
                <td><span :class="['tag', statusTag(l.audit_status)]">{{ statusLabel(l.audit_status) }}</span></td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="detail = l">查看</button>
                  <template v-if="canAudit && l.audit_status === 'PENDING'">
                    <button class="btn btn-text btn-sm" @click="audit(l, 'APPROVE')">通过</button>
                    <button class="btn btn-text btn-sm danger" @click="audit(l, 'REJECT')">驳回</button>
                  </template>
                </td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="8"><div class="empty">暂无请假申请</div></td></tr>
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

      <!-- quota config + comp flow -->
      <div class="split-2-1 mt16">
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">假种配置与额度规则</div></div>
          <div class="card-bd" style="padding-top:6px">
            <table class="table">
              <thead><tr><th>假种类型</th><th>计算规则与说明</th><th>年度额度</th><th>已用</th><th>剩余额度</th></tr></thead>
              <tbody>
                <tr v-for="q in quotaAgg" :key="q.leave_type">
                  <td class="strong">{{ q.leave_type_label }}</td>
                  <td class="muted">{{ typeRules[q.leave_type] || '按单位制度执行' }}</td>
                  <td class="num">{{ q.total }} 天</td>
                  <td class="num">{{ q.used }} 天</td>
                  <td class="num" style="color:var(--green); font-weight:600">{{ q.remain }} 天</td>
                </tr>
                <tr v-if="!quotaAgg.length"><td colspan="5"><div class="empty">暂无假期额度配置</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">加班兑换调休流水</div><span class="more">更多 <ic name="chevron-right" size="14"></ic></span></div>
          <div class="card-bd"><div class="empty">加班调休兑换功能即将上线，暂无流水</div></div>
        </div>
      </div>

      <!-- apply modal -->
      <Modal title="发起请假申请" width="560px" v-if="showApply" @close="showApply = false">
        <div class="form-item">
          <label class="req">假种类型</label>
          <select class="select" v-model="form.leave_type">
            <option value="ANNUAL">年假</option><option value="SICK">病假</option><option value="CASUAL">事假</option><option value="COMP">调休假</option><option value="MARITAL">婚假</option><option value="MATERNITY">产假</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">请假时间</label>
          <div style="flex:1; display:flex; align-items:center; gap:8px">
            <input type="datetime-local" class="input" v-model="form.start_time">
            <span class="muted">~</span>
            <input type="datetime-local" class="input" v-model="form.end_time">
          </div>
        </div>
        <div class="form-item">
          <label class="req">请假事由</label>
          <textarea class="input" maxlength="200" placeholder="请填写请假事由（不超过 200 字）" v-model="form.reason"></textarea>
        </div>
        <div class="muted" style="text-align:right; font-size:12px; margin-top:-8px">{{ form.reason.length }}/200</div>
        <template #footer>
          <button class="btn btn-ghost" @click="showApply = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitApply">提交申请</button>
        </template>
      </Modal>

      <!-- detail modal -->
      <Modal title="请假申请详情" width="520px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">申请人</span><span class="strong">{{ detail.user_name || '—' }}</span>
          <span class="k">假种类型</span><span>{{ detail.leave_type_label }}</span>
          <span class="k">请假时间</span><span class="num">{{ bj(detail.start_time) }} ~ {{ bj(detail.end_time) }}</span>
          <span class="k">请假时长</span><span>{{ detail.duration_days }} 天</span>
          <span class="k">申请事由</span><span>{{ detail.reason || '—' }}</span>
          <span class="k">当前状态</span><span><span :class="['tag', statusTag(detail.audit_status)]">{{ statusLabel(detail.audit_status) }}</span></span>
          <span class="k">审批人</span><span>{{ detail.approver_name || '待审批' }}</span>
          <span class="k">审批意见</span><span>{{ detail.audit_comment || '—' }}</span>
          <span class="k">申请日期</span><span>{{ bj(detail.created_at) }}</span>
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
