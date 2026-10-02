/* /contacts/privacy-mask 高管隐私与号码脱敏 — pixel replica of design/mockups/043-contacts-privacy-mask.png
   Layout: 4 KPI cards / (脱敏规则说明 + 防截屏水印设置) | 高管名单卡片 grid（免打扰开关为纯前端演示） */
AppPages['/contacts/privacy-mask'] = {
  route: '/contacts/privacy-mask', title: '高管隐私与号码脱敏', category: 'CONTACTS', primaryAction: null, icon: 'lock',
  subtitle: '根据当前查看者的角色权限自动进行手机号等敏感信息掩码，支持高管免打扰、不可直接查阅等权限控制。',
  component: {
    data() {
      return {
        loading: true,
        watermark: '',
        execs: [],
        dnd: {}, // 免打扰开关（纯前端演示）
        wmOn: true,
        wmName: true,
        wmNo: true,
        wmTime: true,
        rules: [
          { icon: 'phone', color: 'blue', text: '11 位手机号按「前 3 后 4」掩码展示，如 138****5678' },
          { icon: 'phone', color: 'teal', text: '座机及其他号码按「前 2 后 2」掩码展示，过短号码整体打码' },
          { icon: 'shield-check', color: 'amber', text: '部门负责人（高管）号码无条件强制脱敏，不随查看者权限放开' },
          { icon: 'lock', color: 'red', text: '非授权角色仅可见脱敏结果，完整号码需经审批或持 contacts:privacy:view 权限' },
        ],
      };
    },
    computed: {
      maskedCount() { return this.execs.filter((e) => e.masked && e.phonenumber).length; },
      dndCount() { return Object.values(this.dnd).filter(Boolean).length; },
      hiddenCount() { return this.execs.filter((e) => !e.phonenumber).length; },
      wmIdentity() {
        const u = this.$root.user;
        if (u && u.nick_name) {
          const no = String(u.user_name || '').replace(/\D/g, '').slice(-4) || '0000';
          return u.nick_name + ' ' + no;
        }
        return this.watermark || '未登录用户';
      },
      wmTimeText() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
      },
      wmSample() {
        let t = '';
        if (this.wmName) t += this.wmIdentity;
        if (this.wmNo) t += (t ? ' · ' : '') + '工号' + String(this.wmIdentity).split(' ').pop();
        if (this.wmTime) t += (t ? ' · ' : '') + this.wmTimeText;
        return t || '（未选择水印内容）';
      },
    },
    async mounted() {
      try {
        const d = await api.get('/api/contacts/privacy-mask');
        this.watermark = d.watermark || '';
        this.execs = d.executives || [];
        this.execs.forEach((e, i) => { this.dnd[e.user_id || 'idx' + i] = i % 3 === 0; });
      } catch (e) { this.execs = []; }
      this.loading = false;
    },
    methods: {
      dndKey(e, i) { return e.user_id || 'idx' + i; },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="kpi-row" style="margin-bottom:16px">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="users" size="28"></ic></div>
          <div class="meta">
            <div class="label">高管人员总数</div>
            <div class="val" style="color:var(--primary)">{{ execs.length }}</div>
            <div class="muted" style="font-size:11.5px">各部门负责人（强制脱敏名单）</div>
          </div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="shield-check" size="28"></ic></div>
          <div class="meta">
            <div class="label">已脱敏手机号</div>
            <div class="val" style="color:var(--teal)">{{ maskedCount }}</div>
            <div class="muted" style="font-size:11.5px">按角色权限自动掩码</div>
          </div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="bell" size="28"></ic></div>
          <div class="meta">
            <div class="label">免打扰设置</div>
            <div class="val" style="color:var(--amber)">{{ dndCount }}</div>
            <div class="muted" style="font-size:11.5px">不接收非必要联系请求</div>
          </div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="lock" size="28"></ic></div>
          <div class="meta">
            <div class="label">未登记号码</div>
            <div class="val" style="color:var(--red)">{{ hiddenCount }}</div>
            <div class="muted" style="font-size:11.5px">需经申请审批后补充查看</div>
          </div>
        </div>
      </div>

      <div class="pm-layout">
        <!-- left: rules + watermark -->
        <div>
          <div class="card" style="margin-top:0">
            <div class="card-hd"><div class="t"><ic name="shield-alert" size="15"></ic> 号码脱敏规则说明</div><span class="tag tag-teal">已生效</span></div>
            <div class="card-bd" style="padding-top:10px">
              <div class="pm-rule" v-for="(r, i) in rules" :key="i">
                <span :class="['ico-box', 'ico-' + r.color]" style="width:28px;height:28px;border-radius:7px;display:inline-flex;align-items:center;justify-content:center;flex:none"><ic :name="r.icon" size="14"></ic></span>
                <span style="flex:1">{{ r.text }}</span>
              </div>
            </div>
          </div>

          <div class="card mt16">
            <div class="card-hd">
              <div class="t">防截屏水印设置
                <span :class="['tag', wmOn ? 'tag-green' : 'tag-gray']" style="margin-left:6px">
                  <ic :name="wmOn ? 'check-circle-2' : 'ban'" size="11"></ic>{{ wmOn ? '已启用' : '已关闭' }}
                </span>
              </div>
              <label class="sw"><input type="checkbox" v-model="wmOn"><i></i></label>
            </div>
            <div class="card-bd" style="padding-top:10px">
              <div class="muted" style="font-size:12.5px; margin-bottom:10px">在页面区域叠加动态数字水印，包含操作人姓名、工号和当前时间，防止敏感信息截图泄露。</div>
              <div class="pm-wm-id">
                <span class="k">当前水印身份</span>
                <span class="strong" style="font-family:Consolas,Menlo,monospace">{{ wmIdentity }}</span>
                <span class="muted" style="font-size:11.5px">（取自当前登录用户）</span>
              </div>
              <div style="display:flex; gap:16px; flex-wrap:wrap; margin:10px 0 12px; font-size:12.5px; color:var(--text-2)">
                <label style="display:inline-flex; align-items:center; gap:5px; cursor:pointer"><input type="checkbox" v-model="wmName">操作人姓名</label>
                <label style="display:inline-flex; align-items:center; gap:5px; cursor:pointer"><input type="checkbox" v-model="wmNo">工号</label>
                <label style="display:inline-flex; align-items:center; gap:5px; cursor:pointer"><input type="checkbox" v-model="wmTime">当前时间</label>
              </div>
              <div class="wm-sample" v-if="wmOn">
                <span v-for="n in 8" :key="n" :style="{ left: ((n % 4) * 24 + 2) + '%', top: (Math.floor((n - 1) / 4) * 52 + 12) + '%' }">{{ wmSample }}</span>
                <span style="left:34%; top:46%; font-size:13px; opacity:.45">水印示例（动态变化）</span>
              </div>
              <div v-else class="empty" style="padding:34px 0">水印已关闭，正式环境由系统强制开启</div>
            </div>
          </div>
        </div>

        <!-- right: executives cards -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">高管联系方式（脱敏展示）<span class="tag tag-blue" style="margin-left:6px">{{ execs.length }} 人</span></div>
            <span class="more"><ic name="info" size="13"></ic> 免打扰开关为页面演示，不会同步后端</span>
          </div>
          <div class="card-bd" style="padding-top:10px">
            <div class="pm-grid" v-if="execs.length">
              <div class="pm-card" v-for="(e, i) in execs" :key="e.dept_id">
                <span class="emp-avatar" style="background:var(--primary-weak); color:var(--primary)">{{ (e.nick_name || e.leader || '?').slice(0, 1) }}</span>
                <div style="flex:1; min-width:0">
                  <div style="display:flex; align-items:center; gap:6px">
                    <span class="strong" style="font-size:13.5px">{{ e.nick_name || e.leader }}</span>
                    <span class="tag tag-gray">{{ e.dept_name }}</span>
                  </div>
                  <div style="font-size:12.5px; margin-top:5px; color:var(--text-2)">
                    <template v-if="e.phonenumber"><ic name="phone" size="12"></ic> {{ e.phonenumber }}
                      <ic name="eye-off" size="12" style="color:#829AB1"></ic>
                    </template>
                    <span v-else class="muted"><ic name="ban" size="12"></ic> 未登记号码</span>
                  </div>
                </div>
                <div style="text-align:right; flex:none">
                  <label class="sw" :title="'免打扰演示开关'">
                    <input type="checkbox" v-model="dnd[dndKey(e, i)]"><i></i>
                  </label>
                  <div class="muted" style="font-size:11px; margin-top:2px">免打扰</div>
                </div>
              </div>
            </div>
            <div v-else class="empty">暂无高管名单数据</div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
