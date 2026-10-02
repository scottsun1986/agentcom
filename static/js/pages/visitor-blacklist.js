/* /visitor/blacklist 黑名单与安防预警 — pixel replica of design/mockups/052-visitor-blacklist.png
   Layout: 4 KPI / (黑名单人员列表 filters + table + pager | 安防预警 tip + 最近拦截记录) / 新增黑名单 modal */
AppPages['/visitor/blacklist'] = {
  route: '/visitor/blacklist', title: '黑名单与安防预警', category: 'VISITOR', primaryAction: '新增黑名单', icon: 'shield-alert',
  subtitle: '不良信访记录、上访失信人员、推销骚扰人员自动列入黑名单，预约时立即拦截并提示安保人员。',
  component: {
    data() {
      return {
        loading: true,
        list: [],
        rejected: [],
        filters: { keyword: '' },
        pageNum: 1,
        pageSize: 10,
        showAdd: false,
        submitting: false,
        form: { name: '', phone: '', id_card_number: '', reason: '' },
      };
    },
    computed: {
      monthPrefix() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      },
      kpiMonth() { return this.list.filter((b) => this.bjDate(b.created_at).startsWith(this.monthPrefix)).length; },
      kpiWithId() { return this.list.filter((b) => b.id_card_number).length; },
      kpiWithPhone() { return this.list.filter((b) => b.phone).length; },
      filtered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        if (!kw) return this.list;
        return this.list.filter((b) => ((b.name || '') + (b.phone || '') + (b.id_card_number || '')).toLowerCase().includes(kw));
      },
      pageTotal() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
    },
    async mounted() {
      await this.load();
      this.loadRejected();
      this.loading = false;
    },
    methods: {
      async load() {
        try {
          const r = await api.page('/api/visitor/blacklist', { pageNum: 1, pageSize: 500 });
          this.list = r.rows || [];
        } catch (e) { this.list = []; }
      },
      async loadRejected() {
        try {
          const r = await api.page('/api/visitor/appointments', { status: 'REJECTED', pageNum: 1, pageSize: 5 });
          this.rejected = r.rows || [];
        } catch (e) { this.rejected = []; }
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
      maskPhone(p) { return p && p.length >= 7 ? p.slice(0, 3) + '****' + p.slice(-4) : '—'; },
      maskId(v) {
        if (!v) return '—';
        if (v.length >= 11) return v.slice(0, 6) + '****' + v.slice(-4);
        return v.slice(0, 2) + '****';
      },
      avaCls(i) { return ['ava-red', 'ava-amber', 'ava-gray'][i % 3]; },
      query() { this.pageNum = 1; },
      reset() { this.filters = { keyword: '' }; this.query(); },
      goPage(p) {
        if (p === '...' || p < 1 || p > this.pageCount) return;
        this.pageNum = p;
      },
      async remove(b) {
        if (!window.confirm('确认将 ' + b.name + ' 移出黑名单？移出后其预约不再被自动拦截。')) return;
        try {
          await api.del('/api/visitor/blacklist/' + b.blacklist_id);
          this.$root.toast('已将 ' + b.name + ' 移出黑名单', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      openAdd() {
        this.form = { name: '', phone: '', id_card_number: '', reason: '' };
        this.showAdd = true;
      },
      async submitAdd() {
        const f = this.form;
        if (!f.name.trim()) return this.$root.toast('请填写黑名单姓名', 'warn');
        if (!f.reason.trim()) return this.$root.toast('请填写拉黑原因', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/visitor/blacklist', {
            name: f.name.trim(),
            phone: f.phone.trim(),
            id_card_number: f.id_card_number.trim(),
            reason: f.reason.trim(),
          });
          this.$root.toast('已加入黑名单，预约与现场核验将自动拦截', 'ok');
          this.showAdd = false;
          await this.load();
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
          <div class="ico ico-red"><ic name="users" size="28"></ic></div>
          <div class="meta">
            <div class="label">黑名单总数</div>
            <div class="val" style="color:var(--red)">{{ list.length }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">人</span></div>
            <div class="muted" style="font-size:12px">本月新增 {{ kpiMonth }} 人</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-blue"><ic name="ban" size="28"></ic></div>
          <div class="meta">
            <div class="label">拦截能力覆盖</div>
            <div class="val" style="color:var(--primary)">预约 + 现场</div>
            <div class="muted" style="font-size:12px">提交预约与闸机核验双重拦截</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-amber"><ic name="id-card" size="28"></ic></div>
          <div class="meta">
            <div class="label">证件号码命中</div>
            <div class="val" style="color:var(--amber)">{{ kpiWithId }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">条</span></div>
            <div class="muted" style="font-size:12px">已采集身份证号，可精准比对</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card">
          <div class="ico ico-teal"><ic name="phone" size="28"></ic></div>
          <div class="meta">
            <div class="label">手机号命中</div>
            <div class="val" style="color:var(--teal)">{{ kpiWithPhone }} <span style="font-size:13px;font-weight:400;color:var(--text-3)">条</span></div>
            <div class="muted" style="font-size:12px">已采集手机号，可精准比对</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="split-3-2">
        <!-- blacklist table -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">黑名单人员列表</div></div>
          <div class="card-bd" style="padding-top:6px">
            <div class="filters">
              <input class="input" style="flex:1; min-width:200px" placeholder="请输入姓名、证件号、手机号等关键词" v-model="filters.keyword" @keyup.enter="query">
              <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
              <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
            </div>
            <table class="table">
              <thead><tr><th style="width:44px">序号</th><th>姓名</th><th>手机号</th><th>身份证号</th><th>列入原因</th><th>列入人</th><th>列入时间</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="(b, i) in shownRows" :key="b.blacklist_id">
                  <td class="num">{{ (pageNum - 1) * pageSize + i + 1 }}</td>
                  <td class="strong">{{ b.name }}</td>
                  <td class="num muted">{{ maskPhone(b.phone) }}</td>
                  <td class="num muted">{{ maskId(b.id_card_number) }}</td>
                  <td class="ellipsis" style="max-width:200px" :title="b.reason">{{ b.reason }}</td>
                  <td>{{ b.created_by || '—' }}</td>
                  <td class="num muted">{{ bjDate(b.created_at) }}</td>
                  <td class="actions"><button class="btn btn-text btn-sm danger" @click="remove(b)"><ic name="trash" size="13"></ic>移除</button></td>
                </tr>
                <tr v-if="!shownRows.length"><td colspan="8"><div class="empty">黑名单为空，暂无拦截对象</div></td></tr>
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

        <!-- security warnings -->
        <div>
          <div class="card" style="margin-top:0">
            <div class="card-hd"><div class="t">安防拦截策略</div></div>
            <div class="card-bd">
              <div class="v-warn-tip">
                <ic name="shield-alert" size="16"></ic>
                <div>命中黑名单的访客在「提交预约」「员工邀约」「现场核验」三个环节均会被系统自动拦截，并即时提示安保人员核实处置。</div>
              </div>
              <div class="desc-list" style="margin-top:14px">
                <span class="k">预约拦截</span><span>提交预约时按姓名 / 手机 / 证件号实时比对</span>
                <span class="k">邀约拦截</span><span>员工发起邀约同样校验，防止绕过审核</span>
                <span class="k">审核拦截</span><span>保卫处审核通过前再次复核黑名单命中</span>
                <span class="k">移出机制</span><span>核实误列或风险解除后可由管理员移除</span>
              </div>
            </div>
          </div>
          <div class="card">
            <div class="card-hd"><div class="t">最近拦截记录</div><span class="more" @click="$root.go('/visitor/reservations')">查看更多 <ic name="chevron-right" size="14"></ic></span></div>
            <div class="card-bd" style="padding-top:4px">
              <div class="v-flow-row" v-for="a in rejected" :key="a.appointment_id">
                <span class="v-ava ava-red" style="width:28px;height:28px;font-size:12px">{{ a.visitor_name.slice(0, 1) }}</span>
                <div style="flex:1; min-width:0">
                  <div><span class="strong">{{ a.visitor_name }}</span><span class="muted" style="font-size:12px">　{{ a.company || '外部访客' }}</span></div>
                  <div class="muted" style="font-size:12px">{{ bjDate(a.created_at) }} · 受访人 {{ a.host_name || '—' }}</div>
                </div>
                <span class="tag tag-red">已拦截</span>
              </div>
              <div v-if="!rejected.length" class="empty">暂无拦截记录，安防态势平稳</div>
            </div>
          </div>
        </div>
      </div>

      <!-- add modal -->
      <Modal title="新增黑名单" width="520px" v-if="showAdd" @close="showAdd = false">
        <div class="form-item">
          <label class="req">姓名</label>
          <input class="input" placeholder="请输入人员姓名" v-model="form.name">
        </div>
        <div class="form-item">
          <label>手机号</label>
          <input class="input" placeholder="选填，用于预约比对" v-model="form.phone">
        </div>
        <div class="form-item">
          <label>身份证号</label>
          <input class="input" placeholder="选填，用于精准比对" v-model="form.id_card_number">
        </div>
        <div class="form-item">
          <label class="req">拉黑原因</label>
          <textarea class="input" maxlength="200" placeholder="如：多次重复信访，扰乱办公秩序 / 上门推销骚扰员工" v-model="form.reason"></textarea>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showAdd = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitAdd">确认列入</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
