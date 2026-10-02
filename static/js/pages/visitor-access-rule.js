/* /visitor/access-rule 门禁与通行权限 — pixel replica of design/mockups/051-visitor-access-rule.png
   Layout: 4 KPI / (通行规则表单 | 楼层授权示意网格) / (规则说明 | 最近发放通行码) */
AppPages['/visitor/access-rule'] = {
  route: '/visitor/access-rule', title: '门禁与通行权限', category: 'VISITOR', primaryAction: '保存规则', icon: 'lock',
  subtitle: '为访客设置授权通行时长、通行区域及门禁权限，支持楼层梯控与涉密区域限制，保障园区安全有序。',
  component: {
    data() {
      return {
        loading: true,
        saving: false,
        stats: null,
        rules: { valid_hours: 4, allowed_floors: [], secret_floor_blocked: [], overdue_minutes: 30 },
        recent: [],
        floors: ['1F', '2F', '3F', '4F', '5F', '6F', '7F', '8F', '9F'],
      };
    },
    computed: {
      recentApproved() { return this.recent.slice(0, 5); },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      async load() {
        try { this.rules = await api.get('/api/visitor/access-rules'); } catch (e) { /* keep defaults */ }
        if (!Array.isArray(this.rules.allowed_floors)) this.rules.allowed_floors = [];
        if (!Array.isArray(this.rules.secret_floor_blocked)) this.rules.secret_floor_blocked = [];
        try {
          const d = await api.get('/api/visitor/dashboard');
          this.stats = d.stats || null;
        } catch (e) { this.stats = null; }
        try {
          const r = await api.page('/api/visitor/appointments', { status: 'APPROVED', pageNum: 1, pageSize: 5 });
          this.recent = r.rows || [];
        } catch (e) { this.recent = []; }
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
      isAllowed(f) { return (this.rules.allowed_floors || []).includes(f); },
      isBlocked(f) { return (this.rules.secret_floor_blocked || []).includes(f); },
      floorCls(f) {
        if (this.isBlocked(f)) return 'ban';
        if (this.isAllowed(f)) return 'ok';
        return 'off';
      },
      floorMark(f) {
        if (this.isBlocked(f)) return '禁行';
        if (this.isAllowed(f)) return '允许';
        return '未授权';
      },
      toggleFloor(f) {
        if (this.isBlocked(f)) {
          this.$root.toast(f + ' 为涉密管控楼层，由保卫处管控，不可授权通行', 'warn');
          return;
        }
        const list = this.rules.allowed_floors.slice();
        const i = list.indexOf(f);
        if (i >= 0) list.splice(i, 1);
        else list.push(f);
        this.rules.allowed_floors = list;
      },
      async save() {
        const vh = Number(this.rules.valid_hours);
        const om = Number(this.rules.overdue_minutes);
        if (!vh || vh <= 0 || vh > 24) return this.$root.toast('有效通行时长需为 1~24 小时', 'warn');
        if (isNaN(om) || om < 0) return this.$root.toast('滞留告警阈值需为不小于 0 的分钟数', 'warn');
        this.saving = true;
        try {
          await api.put('/api/visitor/access-rules', {
            valid_hours: vh,
            allowed_floors: this.rules.allowed_floors,
            secret_floor_blocked: this.rules.secret_floor_blocked,
            overdue_minutes: om,
          });
          this.$root.toast('通行规则已保存', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
        this.saving = false;
      },
      onPrimary() { this.save(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" @click="$root.go('/visitor/checkout')">
          <div class="ico ico-blue"><ic name="users" size="28"></ic></div>
          <div class="meta">
            <div class="label">今日在园访客</div>
            <div class="val" style="color:var(--primary)">{{ s('current_in') }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">人</span></div>
            <div class="muted" style="font-size:12px">今日预约 {{ s('today_appointments') }} 人</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-teal"><ic name="shield-check" size="28"></ic></div>
          <div class="meta">
            <div class="label">有效通行权限</div>
            <div class="val" style="color:var(--teal)">{{ rules.allowed_floors.length }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">个授权楼层</span></div>
            <div class="muted" style="font-size:12px">通行码已发放即生效</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/visitor/checkout')">
          <div class="ico ico-amber"><ic name="clock" size="28"></ic></div>
          <div class="meta">
            <div class="label">即将到期（2 小时内）</div>
            <div class="val" style="color:var(--amber)">{{ s('current_in') }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">人</span></div>
            <div class="muted" style="font-size:12px">单次通行 ≤ {{ rules.valid_hours }} 小时</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" @click="$root.go('/visitor/checkout')">
          <div class="ico ico-red"><ic name="ban" size="28"></ic></div>
          <div class="meta">
            <div class="label">受限区域触发</div>
            <div class="val" style="color:var(--red)">{{ s('overdue_alerts') }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">次</span></div>
            <div class="muted" style="font-size:12px">涉密楼层 {{ (rules.secret_floor_blocked || []).join(' / ') || '—' }} 禁行</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="split-2-1">
        <!-- rule form -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">通行时间与滞留规则设置</div>
            <span class="more">保存后即时生效 <ic name="info" size="14"></ic></span>
          </div>
          <div class="card-bd">
            <div class="ast-form-grid">
              <div class="form-item">
                <label class="req">有效通行时长</label>
                <div style="flex:1; display:flex; align-items:center; gap:8px">
                  <input type="number" min="1" max="24" class="input" style="width:110px" v-model="rules.valid_hours">
                  <span class="muted">小时（发放通行码后的授权窗口）</span>
                </div>
              </div>
              <div class="form-item">
                <label class="req">滞留告警阈值</label>
                <div style="flex:1; display:flex; align-items:center; gap:8px">
                  <input type="number" min="0" class="input" style="width:110px" v-model="rules.overdue_minutes">
                  <span class="muted">分钟（超过预约离场时间后触发）</span>
                </div>
              </div>
            </div>
            <div class="form-item">
              <label>默认通行楼层</label>
              <div style="flex:1; display:flex; align-items:center; gap:8px; flex-wrap:wrap">
                <span v-for="f in rules.allowed_floors" :key="'tag' + f" class="tag tag-green" style="margin:0 6px 6px 0">{{ f }} 可通行</span>
                <span class="muted" style="font-size:12px" v-if="!rules.allowed_floors.length">暂未授权任何楼层，请在右侧网格中勾选</span>
              </div>
            </div>
            <div class="form-item">
              <label>涉密管控楼层</label>
              <div style="flex:1; display:flex; align-items:center; gap:8px; flex-wrap:wrap">
                <span v-for="f in rules.secret_floor_blocked" :key="'st' + f" class="tag tag-red" style="margin:0 6px 6px 0"><ic name="lock" size="12"></ic>{{ f }} 涉密禁行</span>
                <span class="muted" style="font-size:12px">涉密楼层由保卫处统一管控，前台规则不可授权</span>
              </div>
            </div>
            <div style="text-align:right">
              <button class="btn btn-primary" :disabled="saving" @click="save"><ic name="save" size="14"></ic>{{ saving ? '保存中…' : '保存通行规则' }}</button>
            </div>
          </div>
        </div>

        <!-- recent issued codes -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">最近发放通行码</div><span class="more" @click="$root.go('/visitor/reservations')">查看更多 <ic name="chevron-right" size="14"></ic></span></div>
          <div class="card-bd" style="padding-top:6px">
            <table class="table table-tight">
              <thead><tr><th>访客</th><th>受访人</th><th>有效期至</th><th>通行码</th></tr></thead>
              <tbody>
                <tr v-for="a in recentApproved" :key="a.appointment_id">
                  <td class="strong">{{ a.visitor_name }}<div class="muted" style="font-size:11.5px">{{ a.company || '—' }}</div></td>
                  <td>{{ a.host_name || '—' }}</td>
                  <td class="num muted">{{ bj(a.scheduled_end).slice(5, 16) }}</td>
                  <td><span class="v-code" style="font-size:12px">{{ a.access_code }}</span></td>
                </tr>
                <tr v-if="!recentApproved.length"><td colspan="4"><div class="empty">暂无发放记录</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <!-- floor grid -->
      <div class="card mt16">
        <div class="card-hd">
          <div class="t">楼层授权示意</div>
          <span class="more">点击格子切换授权状态 <ic name="sliders-horizontal" size="14"></ic></span>
        </div>
        <div class="card-bd">
          <div class="v-floor-tip">
            <span><i style="background:var(--green)"></i>可通行（已授权）</span>
            <span><i style="background:var(--red)"></i>禁行（涉密管控）</span>
            <span><i style="background:#CBD5E1"></i>未授权（默认）</span>
          </div>
          <div class="v-floor-grid">
            <div v-for="f in floors" :key="f" :class="['v-floor', floorCls(f)]" @click="toggleFloor(f)">
              <ic :name="isBlocked(f) ? 'lock' : isAllowed(f) ? 'check' : 'door-open'" size="16"></ic>
              <span>{{ f }} 层</span>
              <span style="font-size:11px; font-weight:400">{{ floorMark(f) }}</span>
            </div>
          </div>
          <div class="rec-verify" style="margin-top:14px">
            <ic name="shield-alert" size="16"></ic>
            <div>访客通行码仅对「可通行」楼层生效；涉密楼层（红色）在预约、核验、闸机三个环节均会被拦截并提示安保人员。规则保存后对新发放的通行码即时生效。</div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
