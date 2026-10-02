/* /fleet/drivers 驾驶员档案与排班 — pixel replica of design/mockups/056-fleet-drivers.png
   Layout: 4 KPI / 筛选 + 驾驶员档案表 + 分页 + 新增/编辑 modal + 排班状态切换 */
AppPages['/fleet/drivers'] = {
  route: '/fleet/drivers', title: '驾驶员档案与排班', category: 'FLEET', primaryAction: '新增驾驶员', icon: 'id-card',
  component: {
    data() {
      return {
        loading: true,
        all: [],
        filters: { keyword: '', status: '' },
        pageNum: 1, pageSize: 10,
        DST: { ON_DUTY: 'tag-green', DISPATCHED: 'tag-blue', OFF_DUTY: 'tag-gray' },
        showForm: false, saving: false, editing: null,
        form: { name: '', phone: '', license_type: 'A1', safe_mileage: '' },
      };
    },
    computed: {
      filtered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        return this.all.filter((d) => {
          if (this.filters.status && d.status !== this.filters.status) return false;
          if (kw && !((d.name || '') + (d.phone || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      total() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      kpi() {
        const c = { total: this.all.length, on: 0, disp: 0, off: 0, mileage: 0 };
        this.all.forEach((d) => {
          if (d.status === 'ON_DUTY') c.on++;
          else if (d.status === 'DISPATCHED') c.disp++;
          else if (d.status === 'OFF_DUTY') c.off++;
          c.mileage += Number(d.safe_mileage) || 0;
        });
        return c;
      },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      num(v) { return Number(v || 0).toLocaleString(); },
      wan(v) { return (Number(v || 0) / 10000).toFixed(1); },
      dstTag(s) { return this.DST[s] || 'tag-gray'; },
      async load() {
        try {
          const r = await api.page('/api/fleet/drivers', { pageNum: 1, pageSize: 500 });
          this.all = r.rows || [];
        } catch (e) { this.all = []; }
      },
      query() { this.pageNum = 1; },
      reset() { this.filters = { keyword: '', status: '' }; this.query(); },
      goPage(p) { if (p < 1 || p > this.pageCount) return; this.pageNum = p; },
      openAdd() {
        this.editing = null;
        this.form = { name: '', phone: '', license_type: 'A1', safe_mileage: '' };
        this.showForm = true;
      },
      openEdit(d) {
        this.editing = d.driver_id;
        this.form = { name: d.name || '', phone: d.phone || '', license_type: d.license_type || 'A1', safe_mileage: d.safe_mileage == null ? '' : d.safe_mileage };
        this.showForm = true;
      },
      async submitForm() {
        const f = this.form;
        if (!f.name.trim()) return this.$root.toast('请填写驾驶员姓名', 'warn');
        if (!f.phone.trim()) return this.$root.toast('请填写联系电话', 'warn');
        this.saving = true;
        const payload = { name: f.name.trim(), phone: f.phone.trim(), license_type: f.license_type, safe_mileage: f.safe_mileage === '' ? 0 : Number(f.safe_mileage) };
        try {
          if (this.editing) await api.put('/api/fleet/drivers/' + this.editing, payload);
          else await api.post('/api/fleet/drivers', payload);
          this.$root.toast(this.editing ? '驾驶员信息已更新' : '驾驶员档案已创建', 'ok');
          this.showForm = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.saving = false;
      },
      async switchStatus(d) {
        const target = d.status === 'ON_DUTY' ? 'OFF_DUTY' : 'ON_DUTY';
        const tip = target === 'OFF_DUTY' ? '确认将驾驶员「' + d.name + '」调整为休班？' : '确认将驾驶员「' + d.name + '」恢复在岗？';
        if (!window.confirm(tip)) return;
        try {
          await api.post('/api/fleet/drivers/' + d.driver_id + '/status', { status: target });
          this.$root.toast('排班状态已切换为「' + (target === 'ON_DUTY' ? '在岗待命' : '休班') + '」', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openAdd(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="ast-kpi5" style="grid-template-columns:repeat(4,1fr); margin-bottom:16px">
        <div class="card ast-kpi">
          <div class="ico ico-blue"><ic name="users" size="24"></ic></div>
          <div class="meta"><div class="label">驾驶员总数</div><div class="val" style="color:var(--primary)">{{ num(kpi.total) }} <i>人</i></div>
            <div class="sub muted">在岗 {{ kpi.on }} · 出车 {{ kpi.disp }} · 休班 {{ kpi.off }}</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-green2"><ic name="user-check" size="24"></ic></div>
          <div class="meta"><div class="label">在岗待命</div><div class="val" style="color:var(--green)">{{ num(kpi.on) }} <i>人</i></div>
            <div class="sub muted">可随时接受调度派车</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-teal"><ic name="car" size="24"></ic></div>
          <div class="meta"><div class="label">出车中</div><div class="val" style="color:var(--teal)">{{ num(kpi.disp) }} <i>人</i></div>
            <div class="sub muted">由派车流程自动联动维护</div></div>
        </div>
        <div class="card ast-kpi">
          <div class="ico ico-amber"><ic name="award" size="24"></ic></div>
          <div class="meta"><div class="label">累计安全行驶里程</div><div class="val" style="color:var(--amber)">{{ wan(kpi.mileage) }} <i>万公里</i></div>
            <div class="sub muted">全员安全驾驶无事故</div></div>
        </div>
      </div>

      <!-- driver table -->
      <div class="card">
        <div class="card-hd"><div class="t">驾驶员档案</div></div>
        <div class="card-bd" style="padding-top:10px">
          <div class="filters">
            <input class="input" style="width:220px" placeholder="请输入姓名、手机号" v-model="filters.keyword" @keyup.enter="query">
            <select class="select" style="width:140px" v-model="filters.status" @change="query">
              <option value="">全部状态</option>
              <option value="ON_DUTY">在岗待命</option>
              <option value="DISPATCHED">出车中</option>
              <option value="OFF_DUTY">休班</option>
            </select>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr>
              <th style="width:64px">序号</th><th>姓名</th><th>联系电话</th><th style="width:96px">准驾车型</th>
              <th style="width:130px">安全行驶里程</th><th style="width:120px">在岗状态</th><th style="width:150px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="(d, i) in shownRows" :key="d.driver_id">
                <td class="muted">{{ (pageNum - 1) * pageSize + i + 1 }}</td>
                <td>
                  <span class="flt-d-avatar">{{ (d.name || '?').slice(0, 1) }}</span>
                  <span class="strong" style="margin-left:8px">{{ d.name }}</span>
                </td>
                <td class="num">{{ d.phone || '—' }}</td>
                <td><span class="tag tag-blue">{{ d.license_type || '—' }}</span></td>
                <td class="num">{{ num(d.safe_mileage) }} km</td>
                <td><span :class="['tag', dstTag(d.status)]">{{ d.status_label }}</span></td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="openEdit(d)">编辑</button>
                  <button v-if="d.status === 'ON_DUTY'" class="btn btn-text btn-sm danger" @click="switchStatus(d)">转休班</button>
                  <button v-else-if="d.status === 'OFF_DUTY'" class="btn btn-text btn-sm" @click="switchStatus(d)">恢复在岗</button>
                  <span v-else class="muted" style="font-size:12px">出车联动中</span>
                </td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="7"><div class="empty">暂无驾驶员档案</div></td></tr>
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

      <!-- add/edit modal -->
      <Modal :title="editing ? '编辑驾驶员档案' : '新增驾驶员'" width="520px" v-if="showForm" @close="showForm = false">
        <div class="form-item"><label class="req">姓名</label><input class="input" placeholder="驾驶员姓名" v-model="form.name"></div>
        <div class="form-item"><label class="req">联系电话</label><input class="input" placeholder="手机号码" v-model="form.phone"></div>
        <div class="form-item"><label>准驾车型</label>
          <select class="select" v-model="form.license_type">
            <option value="A1">A1（大型客车）</option>
            <option value="A2">A2（牵引车）</option>
            <option value="B1">B1（中型客车）</option>
            <option value="B2">B2（大型货车）</option>
            <option value="C1">C1（小型汽车）</option>
          </select>
        </div>
        <div class="form-item"><label>安全里程</label><input type="number" min="0" class="input" placeholder="累计安全驾驶里程（km）" v-model="form.safe_mileage"></div>
        <div class="muted" style="font-size:12px; padding-left:102px">排班状态请在列表中切换；出车中状态由派车流程自动维护。</div>
        <template #footer>
          <button class="btn btn-ghost" @click="showForm = false">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="submitForm">{{ editing ? '保存修改' : '创建档案' }}</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
