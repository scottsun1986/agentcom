/* /fleet/trip-logs 出车登记与归队核销 — pixel replica of design/mockups/059-fleet-trip-logs.png
   Layout: 4 KPI / 筛选 + 出车登记台账 + 分页 / 归队核销 modal */
AppPages['/fleet/trip-logs'] = {
  route: '/fleet/trip-logs', title: '出车登记与归队核销', category: 'FLEET', primaryAction: null, icon: 'clipboard-check',
  subtitle: '出车登记系统自动记录出发里程，归队核销登记结束里程与过路费、油费，系统自动计算区间里程。',
  component: {
    data() {
      return {
        loading: true,
        all: [],
        filters: { status: '', keyword: '' },
        pageNum: 1, pageSize: 10,
        DST: { DISPATCHED: 'tag-blue', RETURNED: 'tag-green', SETTLED: 'tag-gray' },
        ret: null, saving: false,
        form: { end_mileage: '', toll_cost: '', fuel_cost: '', notes: '' },
      };
    },
    computed: {
      filtered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        return this.all.filter((r) => {
          if (this.filters.status && r.status !== this.filters.status) return false;
          if (kw && !((r.purpose || '') + (r.plate_no || '') + (r.driver_name || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      total() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      kpi() {
        const c = { running: 0, returned: 0, mileage: 0, toll: 0 };
        this.all.forEach((r) => {
          if (r.status === 'DISPATCHED') c.running++;
          else if (r.status === 'RETURNED') c.returned++;
          c.mileage += Number(r.trip_mileage) || 0;
          c.toll += Number(r.toll_cost) || 0;
        });
        return c;
      },
    },
    async mounted() {
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
      num(v) { return Number(v || 0).toLocaleString(); },
      money(v) { return Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
      dstTag(s) { return this.DST[s] || 'tag-gray'; },
      async load() {
        try {
          const r = await api.page('/api/fleet/trip-logs', { pageNum: 1, pageSize: 500 });
          this.all = r.rows || [];
        } catch (e) { this.all = []; }
      },
      query() { this.pageNum = 1; },
      reset() { this.filters = { status: '', keyword: '' }; this.query(); },
      goPage(p) { if (p < 1 || p > this.pageCount) return; this.pageNum = p; },
      openReturn(r) {
        this.ret = r;
        this.form = { end_mileage: r.start_mileage == null ? '' : r.start_mileage, toll_cost: '', fuel_cost: '', notes: '' };
      },
      async submitReturn() {
        const f = this.form;
        const end = Number(f.end_mileage);
        if (f.end_mileage === '' || isNaN(end)) return this.$root.toast('请填写返还里程（结束里程）', 'warn');
        if (this.ret.start_mileage != null && end < this.ret.start_mileage) {
          return this.$root.toast('返还里程不得小于出车登记里程 ' + this.ret.start_mileage + ' km', 'warn');
        }
        this.saving = true;
        try {
          await api.post('/api/fleet/dispatches/' + this.ret.dispatch_id + '/return', {
            end_mileage: end, toll_cost: Number(f.toll_cost) || 0, fuel_cost: Number(f.fuel_cost) || 0, notes: f.notes || null,
          });
          this.$root.toast('归队核销完成，行程已归档', 'ok');
          this.ret = null;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.saving = false;
      },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="ast-kpi5" style="grid-template-columns:repeat(4,1fr); margin-bottom:16px">
        <div class="card ast-kpi">
          <div class="ico ico-blue"><ic name="car" size="24"></ic></div>
          <div class="meta"><div class="label">出车中</div><div class="val" style="color:var(--primary)">{{ num(kpi.running) }} <i>车次</i></div>
            <div class="sub muted">待归队核销</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-green2"><ic name="check-circle-2" size="24"></ic></div>
          <div class="meta"><div class="label">已归队</div><div class="val" style="color:var(--green)">{{ num(kpi.returned) }} <i>车次</i></div>
            <div class="sub muted">已完成核销归档</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-amber"><ic name="road" size="24"></ic></div>
          <div class="meta"><div class="label">累计行驶里程</div><div class="val" style="color:var(--amber)">{{ num(kpi.mileage) }} <i>公里</i></div>
            <div class="sub muted">按结束/出发里程自动计算</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-red"><ic name="banknote" size="24"></ic></div>
          <div class="meta"><div class="label">过路过桥费合计</div><div class="val">{{ money(kpi.toll) }} <i>元</i></div>
            <div class="sub muted">归队核销时登记</div></div>
        </div>
      </div>

      <!-- trip log table -->
      <div class="card">
        <div class="card-hd"><div class="t">出车登记信息</div></div>
        <div class="card-bd" style="padding-top:10px">
          <div class="filters">
            <select class="select" style="width:140px" v-model="filters.status" @change="query">
              <option value="">全部状态</option>
              <option value="DISPATCHED">出车中</option>
              <option value="RETURNED">已归队</option>
            </select>
            <input class="input" style="width:220px" placeholder="车牌 / 司机 / 用车事由关键词" v-model="filters.keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr>
              <th>派车单号</th><th>车牌号</th><th>驾驶员</th><th>用车事由</th>
              <th style="width:100px">出发里程</th><th style="width:100px">返还里程</th><th style="width:92px">里程差</th>
              <th style="width:92px">过路费</th><th style="width:96px">状态</th><th>归队时间</th><th style="width:100px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="r in shownRows" :key="r.dispatch_id">
                <td class="muted num">{{ r.dispatch_id.slice(0, 8) }}</td>
                <td class="strong">{{ r.plate_no || '—' }}</td>
                <td>{{ r.driver_name || '—' }}</td>
                <td class="ellipsis" style="max-width:170px" :title="r.purpose">{{ r.purpose || '—' }}</td>
                <td class="num">{{ r.start_mileage == null ? '—' : num(r.start_mileage) }}</td>
                <td class="num">{{ r.end_mileage == null ? '—' : num(r.end_mileage) }}</td>
                <td class="num strong" :style="r.trip_mileage ? '' : 'color:var(--text-3)'">{{ r.trip_mileage == null ? '—' : num(r.trip_mileage) }} km</td>
                <td class="num">{{ r.toll_cost == null ? '—' : money(r.toll_cost) }}</td>
                <td><span :class="['tag', dstTag(r.status)]">{{ r.status_label }}</span></td>
                <td class="num muted">{{ r.actual_return_time ? bj(r.actual_return_time) : '—' }}</td>
                <td class="actions">
                  <button v-if="r.status === 'DISPATCHED'" class="btn btn-primary btn-sm" @click="openReturn(r)">归队核销</button>
                  <span v-else class="muted" style="font-size:12px">已核销</span>
                </td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="11"><div class="empty">暂无出车登记记录</div></td></tr>
            </tbody>
          </table>
          <div class="pager" v-if="pageCount > 1">
            <span>共 {{ total }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in pageCount" :key="p" v-show="pageCount <= 7 || p === 1 || p === pageCount || Math.abs(p - pageNum) <= 1" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
      </div>

      <!-- return modal -->
      <Modal title="归队核销登记" width="540px" v-if="ret" @close="ret = null">
        <div class="dtl-box" style="margin-bottom:14px">
          <span class="k">车辆</span><span class="strong">{{ ret.plate_no }}（{{ ret.brand_model || '—' }}）</span>
          <span class="k">驾驶员</span><span>{{ ret.driver_name || '—' }}</span>
          <span class="k">用车事由</span><span>{{ ret.purpose || '—' }}</span>
          <span class="k">出发里程</span><span class="num">{{ ret.start_mileage == null ? '—' : num(ret.start_mileage) }} km</span>
        </div>
        <div class="form-item"><label class="req">结束里程</label><input type="number" :min="ret.start_mileage || 0" class="input" placeholder="返队后仪表盘里程" v-model="form.end_mileage"></div>
        <div class="form-item"><label>过路费</label><input type="number" min="0" class="input" placeholder="元" v-model="form.toll_cost"></div>
        <div class="form-item"><label>油费</label><input type="number" min="0" class="input" placeholder="元" v-model="form.fuel_cost"></div>
        <div class="form-item"><label>备注</label><textarea class="input" maxlength="200" placeholder="行程备注（选填）" v-model="form.notes"></textarea></div>
        <div class="muted" style="font-size:12px; padding-left:102px">核销后系统自动计算区间里程，联动车辆转为待命、驾驶员转为在岗、申请标记完成。</div>
        <template #footer>
          <button class="btn btn-ghost" @click="ret = null">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="submitReturn">确认核销</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
