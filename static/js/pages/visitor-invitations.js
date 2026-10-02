/* /visitor/invitations 员工主动要约 — pixel replica of design/mockups/049-visitor-invitations.png
   Layout: 4 KPI / (邀约记录 table + pager | 电子邀请函预览 with pseudo-QR) / 发起邀约 modal */
AppPages['/visitor/invitations'] = {
  route: '/visitor/invitations', title: '员工主动要约', category: 'VISITOR', primaryAction: '发起邀约', icon: 'send',
  subtitle: '内部员工发起邀约，系统自动生成带加密时效的电子邀请函（H5/小程序二维码），访客免审核直接凭码通行。',
  component: {
    data() {
      return {
        loading: true,
        list: [],
        selected: null,
        pageNum: 1,
        pageSize: 8,
        showAdd: false,
        submitting: false,
        form: { visitor_name: '', visitor_phone: '', company: '', visit_reason: '', start_time: '', end_time: '' },
      };
    },
    computed: {
      nowTs() { return Date.now(); },
      todayStr() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      },
      monthPrefix() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      },
      kpiMonth() { return this.list.filter((a) => this.bjDate(a.created_at).startsWith(this.monthPrefix)).length; },
      kpiToday() { return this.list.filter((a) => this.bjDate(a.scheduled_start) === this.todayStr).length; },
      kpiActive() { return this.list.filter((a) => this.invState(a).key === 'doing').length; },
      kpiExpired() { return this.list.filter((a) => this.invState(a).key === 'expired').length; },
      pageTotal() { return this.list.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      shownRows() { return this.list.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      preview() {
        if (this.selected) return this.selected;
        return this.shownRows[0] || this.list[0] || null;
      },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      async load() {
        try {
          const r = await api.page('/api/visitor/invitations', { pageNum: 1, pageSize: 200 });
          this.list = r.rows || [];
        } catch (e) { this.list = []; }
      },
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
      },
      bjDate(s) { const v = this.bj(s); return v === '—' ? '' : v.slice(0, 10); },
      dt(v) { return v && v.length === 16 ? v + ':00+08:00' : v; },
      statusLabel(s) { return { PENDING_HOST: '受访人待确认', PENDING_SECURITY: '保卫处待审核', APPROVED: '已发放通行码', CHECKED_IN: '在院访问中', CHECKED_OUT: '已离场', REJECTED: '已驳回', OVERDUE_STAY: '滞留告警' }[s] || s; },
      statusTag(s) { return { PENDING_HOST: 'tag-amber', PENDING_SECURITY: 'tag-amber', APPROVED: 'tag-blue', CHECKED_IN: 'tag-green', CHECKED_OUT: 'tag-gray', REJECTED: 'tag-red', OVERDUE_STAY: 'tag-red' }[s] || 'tag-gray'; },
      maskPhone(p) { return p && p.length >= 7 ? p.slice(0, 3) + '****' + p.slice(-4) : (p || '—'); },
      invState(a) {
        if (a.status && a.status !== 'APPROVED') {
          return { key: 'other', label: this.statusLabel(a.status), tag: this.statusTag(a.status) };
        }
        const now = this.nowTs;
        const s = new Date(a.scheduled_start).getTime();
        const e = new Date(a.scheduled_end).getTime();
        if (now < s) return { key: 'wait', label: '待到访', tag: 'tag-blue' };
        if (now > e) return { key: 'expired', label: '已过期', tag: 'tag-gray' };
        return { key: 'doing', label: '进行中', tag: 'tag-green' };
      },
      qrCells(code) {
        const n = 11;
        let seed = 0;
        const str = String(code || 'AC');
        for (let i = 0; i < str.length; i++) seed = (seed * 31 + str.charCodeAt(i)) >>> 0;
        if (!seed) seed = 7;
        const rand = () => { seed = (seed * 1103515245 + 12345) >>> 0; return (seed >>> 16) / 65536; };
        const grid = [];
        for (let r = 0; r < n; r++) { grid.push([]); for (let c = 0; c < n; c++) grid[r].push(rand() > 0.52); }
        const finder = (r0, c0) => {
          for (let r = 0; r < 7; r++) {
            for (let c = 0; c < 7; c++) {
              const edge = r === 0 || r === 6 || c === 0 || c === 6;
              const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
              grid[r0 + r][c0 + c] = edge || core;
            }
          }
        };
        finder(0, 0); finder(0, n - 7); finder(n - 7, 0);
        const cells = [];
        for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) cells.push(grid[r][c]);
        return cells;
      },
      fallbackCopy(text, done) {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { this.$root.toast('复制失败，请手动复制', 'warn'); }
        document.body.removeChild(ta);
      },
      copyCode(code) {
        const done = () => this.$root.toast('通行码已复制：' + code, 'ok');
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(code).then(done, () => this.fallbackCopy(code, done));
        } else this.fallbackCopy(code, done);
      },
      goPage(p) {
        if (p === '...' || p < 1 || p > this.pageCount) return;
        this.pageNum = p;
      },
      openAdd() {
        this.form = { visitor_name: '', visitor_phone: '', company: '', visit_reason: '', start_time: '', end_time: '' };
        this.showAdd = true;
      },
      async submitAdd() {
        const f = this.form;
        if (!f.visitor_name.trim()) return this.$root.toast('请填写访客姓名', 'warn');
        if (!f.visitor_phone.trim()) return this.$root.toast('请填写访客手机号', 'warn');
        if (!f.visit_reason.trim()) return this.$root.toast('请填写来访事由', 'warn');
        if (!f.start_time || !f.end_time) return this.$root.toast('请选择到访起止时间', 'warn');
        if (f.end_time <= f.start_time) return this.$root.toast('离开时间必须晚于到达时间', 'warn');
        this.submitting = true;
        try {
          const d = await api.post('/api/visitor/invitations', {
            visitor_name: f.visitor_name.trim(),
            visitor_phone: f.visitor_phone.trim(),
            company: f.company.trim(),
            visit_reason: f.visit_reason.trim(),
            scheduled_start: this.dt(f.start_time),
            scheduled_end: this.dt(f.end_time),
          });
          this.$root.toast('邀约成功，访客通行码 ' + (d.access_code || '') + ' 已生成', 'ok');
          this.showAdd = false;
          await this.load();
          if (d && d.appointment_id) this.selected = d;
          this.pageNum = 1;
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      onPrimary() { this.openAdd(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card">
          <div class="ico ico-blue"><ic name="file-plus" size="28"></ic></div>
          <div class="meta">
            <div class="label">本月发起邀约</div>
            <div class="val" style="color:var(--primary)">{{ kpiMonth }}</div>
            <div class="muted" style="font-size:12px">免审核 · 自动发放通行码</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-teal"><ic name="users" size="28"></ic></div>
          <div class="meta">
            <div class="label">今日到访访客</div>
            <div class="val" style="color:var(--teal)">{{ kpiToday }}</div>
            <div class="muted" style="font-size:12px">按邀约到访时间统计</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-amber"><ic name="clock" size="28"></ic></div>
          <div class="meta">
            <div class="label">进行中邀约</div>
            <div class="val" style="color:var(--amber)">{{ kpiActive }}</div>
            <div class="muted" style="font-size:12px">当前在有效期内</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-red"><ic name="x-circle" size="28"></ic></div>
          <div class="meta">
            <div class="label">已过期邀约</div>
            <div class="val" style="color:var(--red)">{{ kpiExpired }}</div>
            <div class="muted" style="font-size:12px">超过有效期自动失效</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="split-3-2">
        <!-- invitation records -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">邀约记录</div></div>
          <div class="card-bd" style="padding-top:6px">
            <table class="table table-tight">
              <thead><tr><th>访客姓名</th><th>手机号</th><th>来访单位</th><th>到访时间</th><th>来访事由</th><th>通行码</th><th>状态</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="a in shownRows" :key="a.appointment_id" :class="{sel: selected && selected.appointment_id === a.appointment_id}" style="cursor:pointer" @click="selected = a">
                  <td class="strong">{{ a.visitor_name }}</td>
                  <td class="num muted">{{ maskPhone(a.visitor_phone) }}</td>
                  <td class="ellipsis" style="max-width:110px">{{ a.company || '—' }}</td>
                  <td class="num muted">{{ bjDate(a.scheduled_start) }}<br>{{ bj(a.scheduled_start).slice(11, 16) }} ~ {{ bj(a.scheduled_end).slice(11, 16) }}</td>
                  <td class="ellipsis" style="max-width:110px">{{ a.visit_reason }}</td>
                  <td>
                    <span class="v-code">{{ a.access_code }}</span>
                    <button class="v-copy-btn" title="复制通行码" @click.stop="copyCode(a.access_code)"><ic name="copy" size="14"></ic></button>
                  </td>
                  <td><span :class="['tag', invState(a).tag]">{{ invState(a).label }}</span></td>
                  <td class="actions"><button class="btn btn-text btn-sm" @click.stop="selected = a">查看</button></td>
                </tr>
                <tr v-if="!shownRows.length"><td colspan="8"><div class="empty">暂无邀约记录，点击右上角「发起邀约」创建</div></td></tr>
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

        <!-- invitation preview -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">电子邀请函预览</div><span class="more" @click="load()">刷新</span></div>
          <div class="card-bd">
            <template v-if="preview">
              <div class="v-invite">
                <div class="v-invite-hd"><span class="b">AgentCom</span><span class="s">企业与政务协同办公管理平台</span></div>
                <div class="v-invite-tt">访客电子邀请函</div>
                <div class="v-invite-sub">欢迎您的到访，请出示本二维码通行</div>
                <div class="v-qr"><i v-for="(d, i) in qrCells(preview.access_code)" :key="i" :class="{d: d}"></i></div>
                <div style="text-align:center; margin:8px 0 4px"><span class="v-code" style="font-size:15px">{{ preview.access_code }}</span>
                  <button class="v-copy-btn" @click="copyCode(preview.access_code)"><ic name="copy" size="14"></ic></button>
                </div>
                <div class="v-invite-info">
                  <span class="k">访客姓名</span><span class="strong">{{ preview.visitor_name }}</span>
                  <span class="k">手机号</span><span class="num">{{ maskPhone(preview.visitor_phone) }}</span>
                  <span class="k">来访单位</span><span>{{ preview.company || '—' }}</span>
                  <span class="k">到访时间</span><span class="num">{{ bj(preview.scheduled_start) }} 至 {{ bj(preview.scheduled_end) }}</span>
                  <span class="k">来访事由</span><span>{{ preview.visit_reason }}</span>
                  <span class="k">通行范围</span><span class="num">{{ preview.pass_floor_permit || '1F,3F' }}</span>
                </div>
                <div class="v-invite-valid">
                  <div class="t"><ic name="clock" size="14"></ic> 邀请函有效期</div>
                  <div style="font-weight:700; color:var(--text); font-size:13.5px; margin-top:2px">{{ bj(preview.scheduled_end) }} 前有效</div>
                  <div class="d">逾期自动失效，请在有效期内凭码通行</div>
                </div>
              </div>
            </template>
            <div v-else class="empty">暂无邀约，发起邀约后可预览电子邀请函</div>
          </div>
        </div>
      </div>

      <!-- add modal -->
      <Modal title="发起邀约" width="560px" v-if="showAdd" @close="showAdd = false">
        <div class="ast-form-grid">
          <div class="form-item">
            <label class="req">访客姓名</label>
            <input class="input" placeholder="请输入访客姓名" v-model="form.visitor_name">
          </div>
          <div class="form-item">
            <label class="req">访客手机号</label>
            <input class="input" placeholder="用于接收通行码短信" v-model="form.visitor_phone">
          </div>
        </div>
        <div class="form-item">
          <label>来访单位</label>
          <input class="input" placeholder="请输入来访单位（选填）" v-model="form.company">
        </div>
        <div class="form-item">
          <label class="req">来访事由</label>
          <textarea class="input" maxlength="100" placeholder="如：业务交流与技术方案沟通" v-model="form.visit_reason"></textarea>
        </div>
        <div class="form-item">
          <label class="req">到访时间</label>
          <div style="flex:1; display:flex; align-items:center; gap:8px">
            <input type="datetime-local" class="input" v-model="form.start_time">
            <span class="muted">至</span>
            <input type="datetime-local" class="input" v-model="form.end_time">
          </div>
        </div>
        <div class="muted" style="font-size:12px; margin-top:-6px; padding-left:102px">员工邀约免两级审核，提交后系统自动生成电子邀请函与访客通行码。</div>
        <template #footer>
          <button class="btn btn-ghost" @click="showAdd = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitAdd">生成邀请函</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
