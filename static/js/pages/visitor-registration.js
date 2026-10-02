/* /visitor/registration 现场核验与临时发卡 — pixel replica of design/mockups/050-visitor-registration.png
   Layout: (左 核验面板: 通行码扫描 -> 匹配 -> 核验放行 + 通行成功 | 右 今日待入场列表) + 访客胸卡 modal */
AppPages['/visitor/registration'] = {
  route: '/visitor/registration', title: '现场核验与临时发卡', category: 'VISITOR', primaryAction: '临时发卡', icon: 'qr-code',
  subtitle: '请扫描或输入访客通行码完成现场核验，核验通过后可打印访客胸卡并下发临时通行权限。',
  component: {
    data() {
      return {
        loading: true,
        code: '',
        matchState: '',   // '' | ok | warn | err
        matchMsg: '',
        matched: null,
        passed: null,
        checking: false,
        list: [],
        rules: null,
        showBadge: false,
        badgeAppt: null,
      };
    },
    computed: {
      canPass() { return !!(this.matched && this.matched.status === 'APPROVED'); },
      todayStr() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
      },
      todayCount() { return this.list.filter((a) => this.bjDate(a.scheduled_start) === this.todayStr).length; },
    },
    async mounted() {
      await this.load();
      try { this.rules = await api.get('/api/visitor/access-rules'); } catch (e) { this.rules = null; }
      this.loading = false;
    },
    methods: {
      async load() {
        try {
          const r = await api.page('/api/visitor/appointments', { status: 'APPROVED', pageNum: 1, pageSize: 100 });
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
      statusLabel(s) { return { PENDING_HOST: '受访人待确认', PENDING_SECURITY: '保卫处待审核', APPROVED: '已发放通行码', CHECKED_IN: '在院访问中', CHECKED_OUT: '已离场', REJECTED: '已驳回', OVERDUE_STAY: '滞留告警' }[s] || s; },
      statusTag(s) { return { PENDING_HOST: 'tag-amber', PENDING_SECURITY: 'tag-amber', APPROVED: 'tag-blue', CHECKED_IN: 'tag-green', CHECKED_OUT: 'tag-gray', REJECTED: 'tag-red', OVERDUE_STAY: 'tag-red' }[s] || 'tag-gray'; },
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
      applyMatch(a) {
        this.matched = a;
        if (a.status === 'APPROVED') {
          this.matchState = 'ok';
          this.matchMsg = '通行码有效，访客信息核验通过，可放行入场';
        } else if (a.status === 'CHECKED_IN') {
          this.matchState = 'warn';
          this.matchMsg = '该访客已在院访问中，请勿重复办理入场';
        } else {
          this.matchState = 'warn';
          this.matchMsg = '该通行码当前状态为「' + this.statusLabel(a.status) + '」，不允许入场';
        }
      },
      async doMatch() {
        const kw = (this.code || '').trim().toUpperCase();
        if (!kw) return this.$root.toast('请输入或扫描访客通行码', 'warn');
        this.passed = null;
        const local = this.list.find((a) => String(a.access_code || '').toUpperCase() === kw);
        if (local) return this.applyMatch(local);
        try {
          const r = await api.page('/api/visitor/appointments', { keyword: this.code.trim(), pageNum: 1, pageSize: 20 });
          const hit = (r.rows || []).find((a) => String(a.access_code || '').toUpperCase() === kw);
          if (hit) {
            if (hit.status === 'APPROVED' && !this.list.some((a) => a.appointment_id === hit.appointment_id)) this.list.unshift(hit);
            return this.applyMatch(hit);
          }
        } catch (e) { /* fallthrough */ }
        this.matched = null;
        this.matchState = 'err';
        this.matchMsg = '通行码无效或不匹配，请核对后重新输入';
      },
      async checkin() {
        if (!this.canPass || this.checking) return;
        this.checking = true;
        try {
          const d = await api.post('/api/visitor/appointments/' + this.matched.appointment_id + '/checkin', { method: 'QRCODE', code: this.matched.access_code });
          this.$root.toast('核验通过，访客已入场', 'ok');
          this.passed = d;
          this.badgeAppt = d;
          this.showBadge = true;
          this.code = '';
          this.matched = null;
          this.matchState = '';
          this.matchMsg = '';
          await this.load();
        } catch (e) { /* toast shown */ }
        this.checking = false;
      },
      selectRow(a) {
        this.code = a.access_code;
        this.passed = null;
        this.applyMatch(a);
        window.scrollTo({ top: 0, behavior: 'smooth' });
      },
      printBadge() { this.$root.toast('已发送至办公区访客胸卡打印机', 'ok'); },
      onPrimary() {
        if (this.canPass) {
          this.badgeAppt = this.matched;
          this.showBadge = true;
        } else this.$root.toast('请先匹配一条「已发放通行码」的访客记录', 'warn');
      },
    },
    template: `
    <div v-if="!loading">
      <div class="cols-2" style="align-items:start">
        <!-- left: verify panel -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t"><span class="v-step-no">1</span>核验面板 · 通行码扫描</div>
            <span class="more"><ic name="scan-search" size="14"></ic> 支持扫码枪 / 手动输入</span>
          </div>
          <div class="card-bd">
            <div class="scan-input-row">
              <span class="scan-prefix"><ic name="qr-code" size="18"></ic></span>
              <input class="input v-code-input" placeholder="请输入或扫描访客通行码（如 ACXXXXXXXXXX）" v-model="code" @keyup.enter="doMatch">
              <button class="btn btn-primary" @click="doMatch"><ic name="search" size="14"></ic>匹配核验</button>
            </div>

            <div v-if="matchState" :class="['scan-panel', matchState]" style="margin-top:12px">
              <div style="display:flex; align-items:center; gap:8px; font-weight:600">
                <ic :name="matchState === 'ok' ? 'check-circle-2' : matchState === 'warn' ? 'alert-triangle' : 'x-circle'" size="16"></ic>
                {{ matchState === 'ok' ? '核验通过' : matchState === 'warn' ? '注意' : '核验失败' }}
              </div>
              <div class="scan-meta">{{ matchMsg }}</div>
            </div>

            <div v-if="matched" class="desc-list" style="margin-top:14px; background:#F8FAFD; border:1px solid var(--line); border-radius:8px; padding:12px 14px">
              <span class="k">访客姓名</span><span class="strong">{{ matched.visitor_name }}</span>
              <span class="k">来访单位</span><span>{{ matched.company || '—' }}</span>
              <span class="k">联系电话</span><span class="num">{{ matched.visitor_phone || '—' }}</span>
              <span class="k">受访人</span><span>{{ matched.host_name || '—' }}</span>
              <span class="k">来访事由</span><span>{{ matched.visit_reason || '—' }}</span>
              <span class="k">有效期</span><span class="num">{{ bj(matched.scheduled_start) }} ~ {{ bj(matched.scheduled_end) }}</span>
              <span class="k">通行区域</span><span class="num">{{ matched.pass_floor_permit || '—' }}</span>
              <span class="k">当前状态</span><span><span :class="['tag', statusTag(matched.status)]">{{ statusLabel(matched.status) }}</span></span>
            </div>

            <div v-if="passed" class="v-pass-banner">
              <div class="big"><ic name="check-circle-2" size="24"></ic> 通行成功</div>
              <div class="sub">访客 {{ passed.visitor_name }} 已于 {{ bj(passed.check_in_time).slice(11, 16) }} 核验入场，可打印访客胸卡</div>
            </div>

            <button class="btn btn-primary v-gate-btn" :disabled="!canPass || checking" @click="checkin">
              <ic name="door-open" size="16"></ic>{{ checking ? '核验中…' : '核验放行' }}
            </button>
            <div class="muted" style="text-align:center; font-size:12px; margin-top:8px">
              放行后自动记录入场时间并通知受访人<span v-if="rules">，通行有效期 {{ rules.valid_hours || 4 }} 小时</span>
            </div>
          </div>
        </div>

        <!-- right: today pending entry -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t"><span class="v-step-no" style="background:var(--teal)">2</span>今日待入场（{{ list.length }}）</div>
            <span class="more" @click="load()"><ic name="refresh-cw" size="14"></ic> 刷新</span>
          </div>
          <div class="card-bd" style="padding-top:4px; max-height:560px; overflow-y:auto">
            <div class="v-ihz-row" v-for="a in list" :key="a.appointment_id">
              <span class="v-ava" :class="bjDate(a.scheduled_start) === todayStr ? 'ava-blue' : 'ava-gray'">{{ a.visitor_name.slice(0, 1) }}</span>
              <div class="v-ihz-meta">
                <div><span class="strong">{{ a.visitor_name }}</span><span class="muted" style="font-size:12px">　{{ a.company || '外部访客' }}</span></div>
                <div class="muted" style="font-size:12px">受访人 {{ a.host_name || '—' }} · 预约 {{ bjDate(a.scheduled_start) }} {{ bj(a.scheduled_start).slice(11, 16) }}</div>
                <div><span class="v-code" style="font-size:12px">{{ a.access_code }}</span>
                  <button class="v-copy-btn" title="复制通行码" @click="selectRow(a)"><ic name="copy" size="13"></ic></button>
                </div>
              </div>
              <button class="btn btn-ghost btn-sm" @click="selectRow(a)">选择核验</button>
            </div>
            <div v-if="!list.length" class="empty">暂无待入场访客</div>
          </div>
        </div>
      </div>

      <!-- badge modal -->
      <Modal title="访客胸卡 · 临时通行凭证" width="430px" v-if="showBadge && badgeAppt" @close="showBadge = false">
        <div class="v-badge">
          <div class="v-badge-hd">
            <span class="b">AgentCom</span>
            <span class="n">访 客 证</span>
            <span class="no">NO.{{ badgeAppt.access_code }}</span>
          </div>
          <div class="v-badge-bd">
            <div>
              <div class="v-qr" style="width:104px; height:104px; padding:5px; margin:0"><i v-for="(d, i) in qrCells(badgeAppt.access_code)" :key="i" :class="{d: d}"></i></div>
            </div>
            <div class="v-badge-info">
              <span class="k">姓 名</span><span class="strong">{{ badgeAppt.visitor_name }}</span>
              <span class="k">单 位</span><span>{{ badgeAppt.company || '外部访客' }}</span>
              <span class="k">受访人</span><span>{{ badgeAppt.host_name || '—' }}</span>
              <span class="k">有效期</span><span class="num">{{ bj(badgeAppt.scheduled_start).slice(5, 16) }} 至 {{ bj(badgeAppt.scheduled_end).slice(5, 16) }}</span>
              <span class="k">通行码</span><span class="v-code" style="font-size:12.5px">{{ badgeAppt.access_code }}</span>
            </div>
          </div>
          <div class="v-badge-ft">
            <span>来访区域：{{ badgeAppt.pass_floor_permit || '1F,3F' }}</span>
            <span>凭证有效 · 逾期失效</span>
          </div>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="printBadge"><ic name="printer" size="14"></ic>打印胸卡</button>
          <button class="btn btn-primary" @click="showBadge = false">完成</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
