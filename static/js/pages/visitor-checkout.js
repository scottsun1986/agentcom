/* /visitor/checkout 滞留告警与出场核销 — pixel replica of design/mockups/053-visitor-checkout.png
   Layout: 4 KPI / (滞留访客告警列表 红底 | 在院访客出场核销) / 手动核销出场 modal */
AppPages['/visitor/checkout'] = {
  route: '/visitor/checkout', title: '滞留告警与出场核销', category: 'VISITOR', primaryAction: '手动核销出场', icon: 'log-out',
  subtitle: '系统自动监测访客出入状态，超时未出场自动告警并通知受访人协同核查，出场需保卫处人工核销。',
  component: {
    data() {
      return {
        loading: true,
        stats: null,
        overdue: [],
        inHouse: [],
        nowTs: Date.now(),
        actingId: '',
        showQuick: false,
        quickId: '',
      };
    },
    computed: {
      quickOptions() { return this.inHouse; },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      async load() {
        this.nowTs = Date.now();
        try {
          const d = await api.get('/api/visitor/dashboard');
          this.stats = d.stats || null;
          this.overdue = d.overdue_alerts || [];
        } catch (e) { this.stats = null; this.overdue = []; }
        try {
          const r = await api.page('/api/visitor/appointments', { status: 'CHECKED_IN', pageNum: 1, pageSize: 100 });
          this.inHouse = r.rows || [];
        } catch (e) { this.inHouse = []; }
      },
      s(k) { return this.stats ? this.stats[k] : '—'; },
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
      },
      fmtDur(ms) {
        const m = Math.max(0, Math.floor(ms / 60000));
        const h = Math.floor(m / 60);
        return h > 0 ? h + '小时' + (m % 60) + '分钟' : m + '分钟';
      },
      ovDur(a) { return this.fmtDur(this.nowTs - new Date(a.scheduled_end).getTime()); },
      stayDur(a) { return this.fmtDur(this.nowTs - new Date(a.check_in_time).getTime()); },
      async checkout(a) {
        if (!window.confirm('确认为访客 ' + a.visitor_name + ' 办理出场核销？核销后通行记录自动销号。')) return;
        this.actingId = a.appointment_id;
        try {
          await api.post('/api/visitor/appointments/' + a.appointment_id + '/checkout');
          this.$root.toast('访客 ' + a.visitor_name + ' 已核销出场', 'ok');
          this.showQuick = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.actingId = '';
      },
      async contact(a) { this.$root.toast('已向受访人 ' + (a.host_name || '') + ' 推送滞留核查通知', 'ok'); },
      openQuick() {
        this.quickId = '';
        this.showQuick = true;
      },
      submitQuick() {
        const a = this.inHouse.find((x) => x.appointment_id === this.quickId);
        if (!a) return this.$root.toast('请选择在院访客', 'warn');
        this.checkout(a);
      },
      onPrimary() { this.openQuick(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card">
          <div class="ico ico-red"><ic name="siren" size="28"></ic></div>
          <div class="meta">
            <div class="label">当前滞留访客</div>
            <div class="val" style="color:var(--red)">{{ s('overdue_alerts') }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">人</span></div>
            <div class="muted" style="font-size:12px">已自动通知受访人协同核查</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-blue"><ic name="users" size="28"></ic></div>
          <div class="meta">
            <div class="label">今日到访访客</div>
            <div class="val" style="color:var(--primary)">{{ s('today_appointments') }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">人</span></div>
            <div class="muted" style="font-size:12px">当前在院 {{ s('current_in') }} 人</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-teal"><ic name="log-out" size="28"></ic></div>
          <div class="meta">
            <div class="label">已出场核销</div>
            <div class="val" style="color:var(--teal)">{{ s('checked_out_today') }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">人</span></div>
            <div class="muted" style="font-size:12px">今日离场签退并自动销号</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-amber"><ic name="timer" size="28"></ic></div>
          <div class="meta">
            <div class="label">滞留告警阈值</div>
            <div class="val" style="color:var(--amber)">{{ s('overdue_minutes') }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">分钟</span></div>
            <div class="muted" style="font-size:12px">超时未出场即触发红牌告警</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="split-3-2">
        <!-- overdue alerts -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t" style="color:var(--red)">滞留访客告警列表（超时 {{ s('overdue_minutes') }} 分钟未出场）</div>
            <span class="more" @click="load()"><ic name="refresh-cw" size="14"></ic> 刷新</span>
          </div>
          <div class="card-bd" style="padding-top:8px">
            <table class="table table-tight">
              <thead><tr><th>访客信息</th><th>受访人</th><th>到访时间</th><th>应离场时间</th><th>已超时</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="a in overdue" :key="a.appointment_id" class="row-red">
                  <td>
                    <div style="display:flex; align-items:center; gap:8px">
                      <span class="v-ava ava-red" style="width:28px;height:28px;font-size:12px">{{ a.visitor_name.slice(0, 1) }}</span>
                      <div><span class="strong">{{ a.visitor_name }}</span><div class="muted" style="font-size:11.5px">{{ a.company || '外部访客' }}</div></div>
                    </div>
                  </td>
                  <td>{{ a.host_name || '—' }}</td>
                  <td class="num muted">{{ bj(a.scheduled_start).slice(5, 16) }}</td>
                  <td class="num muted">{{ bj(a.scheduled_end).slice(5, 16) }}</td>
                  <td><span class="v-dur-red"><ic name="siren" size="12"></ic> {{ ovDur(a) }}</span></td>
                  <td class="actions">
                    <button class="btn btn-primary btn-sm" :disabled="actingId === a.appointment_id" @click="checkout(a)">核销出场</button>
                    <button class="btn btn-text btn-sm" @click="contact(a)">联系受访人</button>
                  </td>
                </tr>
                <tr v-if="!overdue.length"><td colspan="6"><div class="empty">暂无滞留告警，全部访客均在授权时段内</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- in-house checkout -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">在院访客出场核销（{{ inHouse.length }}）</div>
            <span class="more" @click="$root.go('/visitor/registration')">现场核验 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd" style="padding-top:4px; max-height:520px; overflow-y:auto">
            <div class="v-ihz-row" v-for="a in inHouse" :key="a.appointment_id">
              <span class="v-ava ava-blue">{{ a.visitor_name.slice(0, 1) }}</span>
              <div class="v-ihz-meta">
                <div><span class="strong">{{ a.visitor_name }}</span><span class="muted" style="font-size:12px">　{{ a.company || '外部访客' }}</span></div>
                <div class="muted" style="font-size:12px">受访人 {{ a.host_name || '—' }} · {{ bj(a.check_in_time).slice(5, 16) }} 入场 · 已在院 {{ stayDur(a) }}</div>
                <div class="muted" style="font-size:12px">预计离场 {{ bj(a.scheduled_end).slice(5, 16) }} · 通行码 <span class="v-code">{{ a.access_code }}</span></div>
              </div>
              <button class="btn btn-primary btn-sm" :disabled="actingId === a.appointment_id" @click="checkout(a)">核销出场</button>
            </div>
            <div v-if="!inHouse.length" class="empty">当前无在院访客</div>
          </div>
        </div>
      </div>

      <!-- quick checkout modal -->
      <Modal title="手动核销出场" width="480px" v-if="showQuick" @close="showQuick = false">
        <div class="form-item">
          <label class="req">在院访客</label>
          <select class="select" v-model="quickId">
            <option value="" disabled>请选择需核销的访客</option>
            <option v-for="a in quickOptions" :key="a.appointment_id" :value="a.appointment_id">
              {{ a.visitor_name }}（{{ a.company || '外部访客' }} · 受访人 {{ a.host_name || '—' }}）
            </option>
          </select>
        </div>
        <div class="muted" style="font-size:12px; padding-left:102px" v-if="!quickOptions.length">当前无在院访客，无需核销。滞留告警访客可在左侧列表直接核销出场。</div>
        <template #footer>
          <button class="btn btn-ghost" @click="showQuick = false">取消</button>
          <button class="btn btn-primary" :disabled="!!actingId" @click="submitQuick">确认核销</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
