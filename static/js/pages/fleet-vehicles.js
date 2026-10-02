/* /fleet/vehicles 公务车辆台账（一车一档） — pixel replica of design/mockups/055-fleet-vehicles.png
   Layout: 4 KPI / (筛选+台账表格+分页 | 车辆档案详情) + 新增/编辑 modal */
AppPages['/fleet/vehicles'] = {
  route: '/fleet/vehicles', title: '公务车辆台账（一车一档）', category: 'FLEET', primaryAction: '新增车辆档案', icon: 'car',
  subtitle: '统一管理单位公务车辆基础信息，建立“一车一档”，实现车辆全生命周期管理。',
  component: {
    data() {
      return {
        loading: true,
        stats: { total: 0, available: 0, dispatched: 0, maintenance: 0, inspectionDue: 0 },
        rows: [], total: 0, pageNum: 1, pageSize: 10,
        filters: { keyword: '', quota_type: '', status: '' },
        QUOTA: {
          GENERAL_OFFICIAL: { label: '一般公务', tag: 'tag-blue' },
          EMERGENCY: { label: '机要应急', tag: 'tag-amber' },
          SPECIAL: { label: '调研接待', tag: 'tag-teal' },
        },
        VST: { AVAILABLE: 'tag-green', DISPATCHED: 'tag-blue', MAINTENANCE: 'tag-amber', SCRAPPED: 'tag-gray' },
        sel: null,
        showForm: false, saving: false, editing: null,
        form: { plate_no: '', brand_model: '', seat_count: 5, quota_type: 'GENERAL_OFFICIAL', current_mileage: '', designated_parking_spot: '', fuel_card_no: '', insurance_expire_date: '', annual_inspection_date: '' },
      };
    },
    computed: {
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
      seqStart() { return (this.pageNum - 1) * this.pageSize + 1; },
    },
    async mounted() {
      await Promise.all([this.load(), this.loadStats()]);
      if (!this.sel && this.rows.length) this.sel = this.rows[0];
      this.loading = false;
    },
    methods: {
      num(v) { return Number(v || 0).toLocaleString(); },
      quotaLabel(t) { return (this.QUOTA[t] || {}).label || t || '—'; },
      quotaTag(t) { return (this.QUOTA[t] || {}).tag || 'tag-gray'; },
      vstTag(s) { return this.VST[s] || 'tag-gray'; },
      daysLeft(s) {
        if (!s) return null;
        const d = new Date(s + 'T00:00:00');
        if (isNaN(d.getTime())) return null;
        const t0 = new Date(); t0.setHours(0, 0, 0, 0);
        return Math.round((d - t0) / 86400000);
      },
      dateCell(s) {
        const dl = this.daysLeft(s);
        if (dl !== null && dl <= 30) return { text: s, red: true, tip: dl < 0 ? '已过期' + Math.abs(dl) + '天' : '临期 ' + dl + ' 天' };
        return { text: s || '—', red: false, tip: '' };
      },
      async load() {
        try {
          const r = await api.page('/api/fleet/vehicles', {
            keyword: this.filters.keyword || undefined,
            quota_type: this.filters.quota_type || undefined,
            status: this.filters.status || undefined,
            pageNum: this.pageNum, pageSize: this.pageSize,
          });
          this.rows = r.rows || [];
          this.total = r.total || 0;
          if (this.sel && !this.rows.some((v) => v.vehicle_id === this.sel.vehicle_id)) this.sel = this.rows[0] || null;
        } catch (e) { this.rows = []; this.total = 0; }
      },
      async loadStats() {
        try {
          const d = await api.get('/api/fleet/dashboard');
          this.stats.total = d.vehicle_total || 0;
          this.stats.available = (d.status_counts || {}).AVAILABLE || 0;
          this.stats.dispatched = (d.status_counts || {}).DISPATCHED || 0;
          this.stats.maintenance = (d.status_counts || {}).MAINTENANCE || 0;
          this.stats.inspectionDue = (d.warnings || {}).annual_inspection || 0;
        } catch (e) { /* keep zeros */ }
      },
      query() { this.pageNum = 1; this.load(); },
      reset() { this.filters = { keyword: '', quota_type: '', status: '' }; this.query(); },
      goPage(p) { if (p < 1 || p > this.pageCount) return; this.pageNum = p; this.load(); },
      pick(v) { this.sel = v; },
      openAdd() {
        this.editing = null;
        this.form = { plate_no: '', brand_model: '', seat_count: 5, quota_type: 'GENERAL_OFFICIAL', current_mileage: '', designated_parking_spot: '', fuel_card_no: '', insurance_expire_date: '', annual_inspection_date: '' };
        this.showForm = true;
      },
      openEdit(v) {
        this.editing = v.vehicle_id;
        this.form = {
          plate_no: v.plate_no || '', brand_model: v.brand_model || '', seat_count: v.seat_count || 5,
          quota_type: v.quota_type || 'GENERAL_OFFICIAL', current_mileage: v.current_mileage == null ? '' : v.current_mileage,
          designated_parking_spot: v.designated_parking_spot || '', fuel_card_no: v.fuel_card_no || '',
          insurance_expire_date: v.insurance_expire_date || '', annual_inspection_date: v.annual_inspection_date || '',
        };
        this.showForm = true;
      },
      async submitForm() {
        const f = this.form;
        if (!f.plate_no.trim()) return this.$root.toast('请填写车牌号码', 'warn');
        if (!f.brand_model.trim()) return this.$root.toast('请填写品牌型号', 'warn');
        this.saving = true;
        const payload = {
          plate_no: f.plate_no.trim(), brand_model: f.brand_model.trim(), seat_count: Number(f.seat_count) || 5,
          quota_type: f.quota_type, current_mileage: f.current_mileage === '' ? null : Number(f.current_mileage),
          designated_parking_spot: f.designated_parking_spot || null, fuel_card_no: f.fuel_card_no || null,
          insurance_expire_date: f.insurance_expire_date || null, annual_inspection_date: f.annual_inspection_date || null,
        };
        try {
          if (this.editing) await api.put('/api/fleet/vehicles/' + this.editing, payload);
          else await api.post('/api/fleet/vehicles', payload);
          this.$root.toast(this.editing ? '车辆档案已更新' : '车辆建档成功', 'ok');
          this.showForm = false;
          await Promise.all([this.load(), this.loadStats()]);
        } catch (e) { /* toast shown */ }
        this.saving = false;
      },
      async removeV(v) {
        if (!window.confirm('确认删除车辆「' + v.plate_no + '」的档案？该车的派车、维保、加油记录将一并清除。')) return;
        try {
          await api.del('/api/fleet/vehicles/' + v.vehicle_id);
          this.$root.toast('车辆档案已删除', 'ok');
          if (this.sel && this.sel.vehicle_id === v.vehicle_id) this.sel = null;
          await Promise.all([this.load(), this.loadStats()]);
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openAdd(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="ast-kpi5" style="grid-template-columns:repeat(4,1fr); margin-bottom:16px">
        <div class="card ast-kpi">
          <div class="ico ico-blue"><ic name="car" size="24"></ic></div>
          <div class="meta"><div class="label">车辆总数</div><div class="val" style="color:var(--primary)">{{ num(stats.total) }}</div></div>
          <ic name="chevron-right" class="arrow muted"></ic>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-green2"><ic name="check-circle-2" size="24"></ic></div>
          <div class="meta"><div class="label">待命车辆</div><div class="val" style="color:var(--green)">{{ num(stats.available) }}</div></div>
          <ic name="chevron-right" class="arrow muted"></ic>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-amber"><ic name="wrench" size="24"></ic></div>
          <div class="meta"><div class="label">维保中</div><div class="val" style="color:var(--amber)">{{ num(stats.maintenance) }}</div></div>
          <ic name="chevron-right" class="arrow muted"></ic>
        </div>
        <div class="card ast-kpi" @click="$root.go('/fleet/maintenance')">
          <div class="ico ico-red"><ic name="alert-triangle" size="24"></ic></div>
          <div class="meta"><div class="label">年审到期（30天内）</div><div class="val" style="color:var(--red)">{{ num(stats.inspectionDue) }}</div></div>
          <ic name="chevron-right" class="arrow muted"></ic>
        </div>
      </div>

      <div class="flt-v-layout">
        <!-- ledger table -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">车辆台账列表</div>
          </div>
          <div class="card-bd" style="padding-top:10px">
            <div class="filters" style="justify-content:flex-end; margin-bottom:12px">
              <input class="input" style="width:220px" placeholder="请输入车牌号、品牌型号" v-model="filters.keyword" @keyup.enter="query">
              <select class="select" style="width:150px" v-model="filters.quota_type" @change="query">
                <option value="">全部编制性质</option>
                <option value="GENERAL_OFFICIAL">一般公务用车</option>
                <option value="EMERGENCY">机要通信/应急保障</option>
                <option value="SPECIAL">调研接待用车</option>
              </select>
              <select class="select" style="width:130px" v-model="filters.status" @change="query">
                <option value="">全部状态</option>
                <option value="AVAILABLE">待命</option>
                <option value="DISPATCHED">出车中</option>
                <option value="MAINTENANCE">维保送修</option>
              </select>
              <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
              <button class="btn btn-ghost" @click="reset">重置</button>
            </div>
            <table class="table table-tight">
              <thead><tr>
                <th style="width:52px">序号</th><th>车牌号码</th><th>品牌型号</th><th style="width:56px">座位</th>
                <th>编制性质</th><th style="width:96px">当前里程(km)</th><th>停放车位</th><th>油卡号</th>
                <th>保险到期</th><th>年审日期</th><th>状态</th><th style="width:120px">操作</th>
              </tr></thead>
              <tbody>
                <tr v-for="(v, i) in rows" :key="v.vehicle_id" :class="{ sel: sel && sel.vehicle_id === v.vehicle_id }" @click="pick(v)" style="cursor:pointer">
                  <td class="muted">{{ seqStart + i }}</td>
                  <td class="strong">{{ v.plate_no }}</td>
                  <td>{{ v.brand_model }}</td>
                  <td class="num">{{ v.seat_count }}</td>
                  <td><span :class="['tag', quotaTag(v.quota_type)]">{{ quotaLabel(v.quota_type) }}</span></td>
                  <td class="num">{{ num(v.current_mileage) }}</td>
                  <td class="muted">{{ v.designated_parking_spot || '—' }}</td>
                  <td class="muted num">{{ v.fuel_card_no || '—' }}</td>
                  <td :class="dateCell(v.insurance_expire_date).red ? 'ast-date-red' : 'muted'" :title="dateCell(v.insurance_expire_date).tip" style="font-variant-numeric:tabular-nums">{{ dateCell(v.insurance_expire_date).text }}</td>
                  <td :class="dateCell(v.annual_inspection_date).red ? 'ast-date-red' : 'muted'" :title="dateCell(v.annual_inspection_date).tip" style="font-variant-numeric:tabular-nums">{{ dateCell(v.annual_inspection_date).text }}</td>
                  <td><span :class="['tag', vstTag(v.status)]">{{ v.status_label }}</span></td>
                  <td class="actions">
                    <button class="btn btn-text btn-sm" @click.stop="pick(v)">查看</button>
                    <button class="btn btn-text btn-sm" @click.stop="openEdit(v)">编辑</button>
                    <button class="btn btn-text btn-sm danger" @click.stop="removeV(v)">删除</button>
                  </td>
                </tr>
                <tr v-if="!rows.length"><td colspan="12"><div class="empty">暂无车辆档案，点击右上角“新增车辆档案”建档</div></td></tr>
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

        <!-- vehicle detail -->
        <div class="card flt-v-dtl" style="margin-top:0">
          <div class="card-hd"><div class="t">车辆档案详情</div>
            <button v-if="sel" class="btn btn-ghost btn-sm" @click="openEdit(sel)"><ic name="edit" size="12"></ic>编辑档案</button>
          </div>
          <div class="card-bd" v-if="sel">
            <div class="flt-v-photo"><ic name="car" size="40"></ic></div>
            <div style="display:flex; align-items:center; gap:10px; margin-top:12px">
              <span class="strong" style="font-size:18px">{{ sel.plate_no }}</span>
              <span :class="['tag', vstTag(sel.status)]">{{ sel.status_label }}</span>
            </div>
            <div class="muted" style="margin-top:2px">{{ sel.brand_model }} · {{ sel.seat_count }} 座 · {{ quotaLabel(sel.quota_type) }}</div>
            <div class="divider"></div>
            <div class="desc-list" style="grid-template-columns:88px 1fr">
              <span class="k">车牌号码</span><span class="strong">{{ sel.plate_no }}</span>
              <span class="k">编制性质</span><span><span :class="['tag', quotaTag(sel.quota_type)]">{{ quotaLabel(sel.quota_type) }}</span></span>
              <span class="k">当前里程</span><span class="num">{{ num(sel.current_mileage) }} km</span>
              <span class="k">停放车位</span><span>{{ sel.designated_parking_spot || '—' }}</span>
              <span class="k">油卡卡号</span><span class="num">{{ sel.fuel_card_no || '—' }}</span>
              <span class="k">保险到期</span>
              <span :class="dateCell(sel.insurance_expire_date).red ? 'ast-date-red' : ''" :title="dateCell(sel.insurance_expire_date).tip">
                {{ sel.insurance_expire_date || '—' }}<span v-if="dateCell(sel.insurance_expire_date).red" class="tag tag-red" style="margin-left:6px">临期</span></span>
              <span class="k">年审日期</span>
              <span :class="dateCell(sel.annual_inspection_date).red ? 'ast-date-red' : ''" :title="dateCell(sel.annual_inspection_date).tip">
                {{ sel.annual_inspection_date || '—' }}<span v-if="dateCell(sel.annual_inspection_date).red" class="tag tag-red" style="margin-left:6px">临期</span></span>
              <span class="k">建档时间</span><span class="muted">{{ (sel.created_at || '').slice(0, 10) || '—' }}</span>
            </div>
            <div style="display:flex; gap:10px; margin-top:16px">
              <button class="btn btn-primary" style="flex:1" @click="openEdit(sel)"><ic name="edit" size="14"></ic>编辑档案</button>
              <button class="btn btn-ghost" style="flex:1; color:var(--red)" @click="removeV(sel)"><ic name="trash" size="14"></ic>删除档案</button>
            </div>
          </div>
          <div class="card-bd" v-else><div class="empty">请在左侧列表选择车辆</div></div>
        </div>
      </div>

      <!-- add/edit modal -->
      <Modal :title="editing ? '编辑车辆档案' : '新增车辆档案'" width="600px" v-if="showForm" @close="showForm = false">
        <div class="flt-form-2col">
          <div class="form-item"><label class="req">车牌号码</label><input class="input" placeholder="如 京A·12345" v-model="form.plate_no"></div>
          <div class="form-item"><label class="req">品牌型号</label><input class="input" placeholder="如 丰田 凯美瑞" v-model="form.brand_model"></div>
          <div class="form-item"><label>核定座位</label><input type="number" min="2" class="input" v-model="form.seat_count"></div>
          <div class="form-item"><label>编制性质</label>
            <select class="select" v-model="form.quota_type">
              <option value="GENERAL_OFFICIAL">一般公务用车</option>
              <option value="EMERGENCY">机要通信/应急保障</option>
              <option value="SPECIAL">调研接待用车</option>
            </select>
          </div>
          <div class="form-item"><label>当前里程</label><input type="number" min="0" class="input" placeholder="km" v-model="form.current_mileage"></div>
          <div class="form-item"><label>停放车位</label><input class="input" placeholder="如 A区-01" v-model="form.designated_parking_spot"></div>
          <div class="form-item"><label>油卡卡号</label><input class="input" placeholder="定点加油卡号" v-model="form.fuel_card_no"></div>
          <div class="form-item"><label>保险到期日</label><input type="date" class="input" v-model="form.insurance_expire_date"></div>
          <div class="form-item"><label>年审日期</label><input type="date" class="input" v-model="form.annual_inspection_date"></div>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showForm = false">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="submitForm">{{ editing ? '保存修改' : '建档' }}</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
