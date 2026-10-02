/* /attendance/remedy 异常与补卡申请 — pixel replica of design/mockups/010-attendance-remedy.png
   Layout: 4 KPI / (补卡记录 tabs+filters+table+pager | 发起补卡申请 form panel) */
AppPages['/attendance/remedy'] = {
  route: '/attendance/remedy', title: '异常与补卡申请', category: 'ATTENDANCE', primaryAction: null, icon: 'rotate-ccw',
  subtitle: '漏打卡/机器故障异常补录，支持主管审批并自动修正打卡记录。',
  component: {
    data() {
      return {
        loading: true,
        remedies: [],
        canAudit: false,
        tab: 'all',
        filters: { start: '', end: '', keyword: '' },
        pageNum: 1,
        pageSize: 10,
        detail: null,
        form: { date: '', session: 'IN', time: '09:00', reason: '' },
        submitting: false,
      };
    },
    computed: {
      counts() {
        const c = { all: this.remedies.length, PENDING: 0, APPROVED: 0, REJECTED: 0 };
        this.remedies.forEach((r) => { if (c[r.audit_status] !== undefined) c[r.audit_status]++; });
        return c;
      },
      monthCount() {
        const m = new Date();
        const key = m.getFullYear() + '-' + String(m.getMonth() + 1).padStart(2, '0');
        return this.remedies.filter((r) => (r.created_at || '').slice(0, 7) === key).length;
      },
      filtered() {
        const f = this.filters;
        const kw = (f.keyword || '').trim().toLowerCase();
        return this.remedies.filter((r) => {
          if (this.tab !== 'all' && r.audit_status !== this.tab) return false;
          if (f.start && this.bjDate(r.remedy_time) < f.start) return false;
          if (f.end && this.bjDate(r.remedy_time) > f.end) return false;
          if (kw && !((r.reason || '') + (r.user_name || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      pageCount() { return Math.max(1, Math.ceil(this.filtered.length / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      expectTime() { return this.form.session === 'IN' ? '09:00' : '18:00'; },
    },
    async mounted() {
      const t = new Date();
      this.form.date = t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
      try {
        const info = await api.get('/api/auth/info');
        const perms = info.permissions || [];
        this.canAudit = perms.includes('*:*:*') || perms.includes('attendance:remedy:audit');
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
      weekDay(s) {
        const d = new Date(this.bjDate(s) + 'T12:00:00+08:00');
        return isNaN(d.getTime()) ? '—' : ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][d.getUTCDay()];
      },
      async load() {
        try {
          const r = await api.page('/api/attendance/remedies', { pageNum: 1, pageSize: 200 });
          this.remedies = r.rows || [];
        } catch (e) { this.remedies = []; }
      },
      statusLabel(s) { return { PENDING: '待审批', APPROVED: '已通过', REJECTED: '已驳回' }[s] || s; },
      statusTag(s) { return { PENDING: 'tag-amber', APPROVED: 'tag-green', REJECTED: 'tag-red' }[s] || 'tag-gray'; },
      sessionLabel(t) { return { IN: '上班', OUT: '下班', FIELD: '外勤' }[t] || t; },
      setTab(t) { this.tab = t; this.pageNum = 1; },
      query() { this.pageNum = 1; },
      reset() { this.filters = { start: '', end: '', keyword: '' }; this.query(); },
      goPage(p) { if (p >= 1 && p <= this.pageCount) this.pageNum = p; },
      async submit() {
        const f = this.form;
        if (!f.date) return this.$root.toast('请选择补卡日期', 'warn');
        if (!f.time) return this.$root.toast('请选择补录打卡时间', 'warn');
        if (!f.reason.trim()) return this.$root.toast('请填写申请事由', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/attendance/remedies', { remedy_time: f.date + 'T' + f.time + ':00+08:00', punch_type: f.session, reason: f.reason.trim() });
          this.$root.toast('补卡申请已提交', 'ok');
          this.form.reason = '';
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async audit(r, action) {
        if (!window.confirm(action === 'APPROVE' ? '确认通过补卡申请？通过后系统将自动修正打卡记录。' : '确认驳回该补卡申请？')) return;
        try {
          await api.post('/api/attendance/remedies/' + r.remedy_id + '/audit', { action });
          this.$root.toast(action === 'APPROVE' ? '已通过，打卡记录已修正' : '已驳回该补卡申请', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="clock" size="28"></ic></div>
          <div class="meta">
            <div class="label">待审批</div>
            <div class="val" style="color:var(--amber)">{{ counts.PENDING }} <span style="font-size:14px;font-weight:400">件</span></div>
            <div class="muted" style="font-size:12px">已通过 {{ counts.APPROVED }} · 已驳回 {{ counts.REJECTED }}</div>
          </div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="file-text" size="28"></ic></div>
          <div class="meta">
            <div class="label">本月申请</div>
            <div class="val" style="color:var(--primary)">{{ monthCount }} <span style="font-size:14px;font-weight:400">件</span></div>
            <div class="muted" style="font-size:12px">累计申请 {{ counts.all }} 件</div>
          </div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta">
            <div class="label">已修正打卡</div>
            <div class="val" style="color:var(--teal)">{{ counts.APPROVED }} <span style="font-size:14px;font-weight:400">条</span></div>
            <div class="muted" style="font-size:12px">审批通过自动写入打卡记录</div>
          </div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="alert-triangle" size="28"></ic></div>
          <div class="meta">
            <div class="label">已驳回</div>
            <div class="val" style="color:var(--red)">{{ counts.REJECTED }} <span style="font-size:14px;font-weight:400">件</span></div>
            <div class="muted" style="font-size:12px">异常待处理请及时补卡</div>
          </div>
        </div>
      </div>

      <div class="rem-split mt16">
        <!-- records list -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">补卡申请列表</div></div>
          <div class="card-bd" style="padding-top:4px">
            <div class="lr-tabs" style="margin:0 0 10px">
              <span :class="['lr-tab', tab === 'all' ? 'on' : '']" @click="setTab('all')">全部 ({{ counts.all }})</span>
              <span :class="['lr-tab', tab === 'PENDING' ? 'on' : '']" @click="setTab('PENDING')">待审批 ({{ counts.PENDING }})</span>
              <span :class="['lr-tab', tab === 'APPROVED' ? 'on' : '']" @click="setTab('APPROVED')">已通过 ({{ counts.APPROVED }})</span>
              <span :class="['lr-tab', tab === 'REJECTED' ? 'on' : '']" @click="setTab('REJECTED')">已驳回 ({{ counts.REJECTED }})</span>
            </div>
            <div class="filters">
              <input type="date" class="input" style="width:140px" v-model="filters.start" @change="query">
              <span class="muted">~</span>
              <input type="date" class="input" style="width:140px" v-model="filters.end" @change="query">
              <input class="input" style="flex:1; min-width:160px" placeholder="请输入姓名或事由关键词" v-model="filters.keyword" @keyup.enter="query">
              <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
              <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
            </div>
            <table class="table">
              <thead><tr><th>补卡日期</th><th>星期</th><th>异常时段</th><th>员工姓名</th><th>申请事由</th><th>提交时间</th><th>审批状态</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="r in shownRows" :key="r.remedy_id">
                  <td class="num">{{ bjDate(r.remedy_time) }}</td>
                  <td class="muted">{{ weekDay(r.remedy_time) }}</td>
                  <td>{{ sessionLabel(r.punch_type) }}</td>
                  <td class="strong">{{ r.user_name || '—' }}</td>
                  <td class="ellipsis" :title="r.reason" style="max-width:190px">{{ r.reason || '—' }}</td>
                  <td class="num muted">{{ bj(r.created_at) }}</td>
                  <td><span :class="['tag', statusTag(r.audit_status)]">{{ statusLabel(r.audit_status) }}</span></td>
                  <td class="actions">
                    <button class="btn btn-text btn-sm" @click="detail = r">查看</button>
                    <template v-if="canAudit && r.audit_status === 'PENDING'">
                      <button class="btn btn-text btn-sm" @click="audit(r, 'APPROVE')">通过</button>
                      <button class="btn btn-text btn-sm danger" @click="audit(r, 'REJECT')">驳回</button>
                    </template>
                  </td>
                </tr>
                <tr v-if="!shownRows.length"><td colspan="8"><div class="empty">暂无补卡申请</div></td></tr>
              </tbody>
            </table>
            <div class="pager" v-if="pageCount > 1">
              <span>共 {{ filtered.length }} 条记录</span>
              <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
              <button v-for="p in pageCount" :key="p" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
              <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
            </div>
          </div>
        </div>

        <!-- apply form -->
        <div class="card" style="margin-top:0; align-self:start">
          <div class="card-hd"><div class="t">发起补卡申请</div></div>
          <div class="card-bd">
            <div class="form-item" style="flex-direction:column; gap:6px; align-items:stretch">
              <label class="req" style="width:auto; text-align:left; padding:0">补卡日期</label>
              <input type="date" class="input" v-model="form.date">
            </div>
            <div class="form-item" style="flex-direction:column; gap:6px; align-items:stretch">
              <label class="req" style="width:auto; text-align:left; padding:0">异常时段</label>
              <div style="display:flex; gap:16px">
                <label style="display:flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" value="IN" v-model="form.session"> 上班（应打卡 {{ expectTime }}）</label>
                <label style="display:flex; align-items:center; gap:5px; cursor:pointer"><input type="radio" value="OUT" v-model="form.session"> 下班（应打卡 18:00）</label>
              </div>
            </div>
            <div class="form-item" style="flex-direction:column; gap:6px; align-items:stretch">
              <label class="req" style="width:auto; text-align:left; padding:0">补录打卡时间</label>
              <input type="time" class="input" v-model="form.time">
            </div>
            <div class="form-item" style="flex-direction:column; gap:6px; align-items:stretch; margin-bottom:4px">
              <label class="req" style="width:auto; text-align:left; padding:0">申请事由</label>
              <textarea class="input" maxlength="200" placeholder="请描述异常原因，如：当日因参加上级会议，返回办公室后发现忘记打上班卡" v-model="form.reason"></textarea>
              <div class="muted" style="text-align:right; font-size:12px">{{ form.reason.length }}/200</div>
            </div>
            <div class="rem-tip">
              <ic name="info" size="14"></ic>
              补卡申请审批通过后，系统将自动生成对应打卡记录并修正考勤结果。
            </div>
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:14px">
              <button class="btn btn-ghost" @click="form.reason = ''">取消</button>
              <button class="btn btn-primary" :disabled="submitting" @click="submit">提交申请</button>
            </div>
          </div>
        </div>
      </div>

      <!-- detail modal -->
      <Modal title="补卡申请详情" width="500px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">员工姓名</span><span class="strong">{{ detail.user_name || '—' }}</span>
          <span class="k">补卡日期</span><span class="num">{{ bj(detail.remedy_time) }}</span>
          <span class="k">异常时段</span><span>{{ sessionLabel(detail.punch_type) }}</span>
          <span class="k">申请事由</span><span>{{ detail.reason || '—' }}</span>
          <span class="k">审批状态</span><span><span :class="['tag', statusTag(detail.audit_status)]">{{ statusLabel(detail.audit_status) }}</span></span>
          <span class="k">审批人</span><span>{{ detail.approver_name || '待审批' }}</span>
          <span class="k">提交时间</span><span>{{ bj(detail.created_at) }}</span>
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
