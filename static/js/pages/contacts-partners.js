/* /contacts/partners 政务外联通讯录 — pixel replica of design/mockups/044-contacts-partners.png
   Layout: 4 type KPI cards (click to filter) + filters + partner table + server pager + add/edit modal */
AppPages['/contacts/partners'] = {
  route: '/contacts/partners', title: '政务外联通讯录', category: 'CONTACTS', primaryAction: '新增外联单位', icon: 'book-2',
  subtitle: '汇聚上级部门、协作单位、智库专家、应急联动单位联系方式，支撑政务对外沟通与协同工作。',
  component: {
    data() {
      return {
        loading: true,
        rows: [],
        total: 0,
        pageNum: 1,
        pageSize: 10,
        filters: { partner_type: '', keyword: '' },
        counts: { GOV_PEER: 0, SUPPLIER: 0, THINKTANK: 0, EMERGENCY: 0, total: 0 },
        showForm: false,
        submitting: false,
        editingId: '',
        form: { unit_name: '', partner_type: 'GOV_PEER', contact_name: '', phone: '', email: '', address: '', tags: '', notes: '' },
        typeCards: [
          { key: '', label: '外部协同单位', sub: '含兄弟城市、委办局、企事业单位', icon: 'building', color: 'blue', countKey: 'total' },
          { key: 'GOV_PEER', label: '对口协同单位', sub: '中央及省级发文联系窗口', icon: 'network', color: 'teal', countKey: 'GOV_PEER' },
          { key: 'THINKTANK', label: '常年合作智库', sub: '高校、研究机构、行业专家', icon: 'award', color: 'amber', countKey: 'THINKTANK' },
          { key: 'EMERGENCY', label: '应急联动单位', sub: '应急、公安、消防、医疗等', icon: 'siren', color: 'red', countKey: 'EMERGENCY' },
        ],
      };
    },
    computed: {
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      async load() {
        try {
          const r = await api.page('/api/contacts/partners', {
            partner_type: this.filters.partner_type || undefined,
            keyword: this.filters.keyword || undefined,
            pageNum: this.pageNum,
            pageSize: this.pageSize,
          });
          this.rows = r.rows || [];
          this.total = r.total || 0;
        } catch (e) { this.rows = []; this.total = 0; }
        try {
          const all = await api.get('/api/contacts/partners', { pageSize: 500 });
          const c = { GOV_PEER: 0, SUPPLIER: 0, THINKTANK: 0, EMERGENCY: 0, total: (all.rows || []).length };
          (all.rows || []).forEach((p) => { if (c[p.partner_type] !== undefined) c[p.partner_type]++; });
          this.counts = c;
        } catch (e) { /* keep old */ }
      },
      query() { this.pageNum = 1; this.load(); },
      reset() { this.filters = { partner_type: '', keyword: '' }; this.query(); },
      filterType(t) { this.filters.partner_type = t; this.query(); },
      goPage(p) {
        if (p < 1 || p > this.pageCount || p === this.pageNum) return;
        this.pageNum = p;
        this.load();
      },
      typeTag(t) { return { GOV_PEER: 'tag-blue', SUPPLIER: 'tag-teal', THINKTANK: 'tag-amber', EMERGENCY: 'tag-red' }[t] || 'tag-gray'; },
      tagList(s) { return String(s || '').split(/[,，、;；\s]+/).filter(Boolean); },
      day(s) { return s ? String(s).slice(0, 10) : '—'; },
      openAdd() {
        this.editingId = '';
        this.form = { unit_name: '', partner_type: 'GOV_PEER', contact_name: '', phone: '', email: '', address: '', tags: '', notes: '' };
        this.showForm = true;
      },
      openEdit(p) {
        this.editingId = p.partner_id;
        this.form = {
          unit_name: p.unit_name || '', partner_type: p.partner_type || 'GOV_PEER',
          contact_name: p.contact_name || '', phone: p.phone || '', email: p.email || '',
          address: p.address || '', tags: p.tags || '', notes: p.notes || '',
        };
        this.showForm = true;
      },
      async submit() {
        const f = this.form;
        if (!f.unit_name.trim()) return this.$root.toast('单位名称不能为空', 'warn');
        if (!f.contact_name.trim()) return this.$root.toast('联系人不能为空', 'warn');
        if (!f.phone.trim()) return this.$root.toast('联系电话不能为空', 'warn');
        this.submitting = true;
        try {
          if (this.editingId) {
            await api.put('/api/contacts/partners/' + this.editingId, f);
            this.$root.toast('外联单位已更新', 'ok');
          } else {
            await api.post('/api/contacts/partners', f);
            this.$root.toast('外联单位已登记', 'ok');
          }
          this.showForm = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async remove(p) {
        if (!window.confirm('确认删除外联单位【' + p.unit_name + '】？')) return;
        try {
          await api.del('/api/contacts/partners/' + p.partner_id);
          this.$root.toast('删除成功', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openAdd(); },
    },
    template: `
    <div v-if="!loading">
      <!-- type KPI cards -->
      <div class="kpi-row" style="margin-bottom:16px">
        <div v-for="c in typeCards" :key="c.label" class="card kpi-card"
          :style="{ cursor: 'pointer', outline: filters.partner_type === c.key ? '2px solid var(--primary)' : 'none' }"
          @click="filterType(c.key)">
          <div :class="['ico', 'ico-' + c.color]"><ic :name="c.icon" size="28"></ic></div>
          <div class="meta">
            <div class="label">{{ c.label }}</div>
            <div class="val" :style="{ color: 'var(--' + (c.color === 'blue' ? 'primary' : c.color) + ')' }">{{ counts[c.countKey] || 0 }}</div>
            <div class="muted" style="font-size:11.5px">{{ c.sub }}</div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <!-- partner table -->
      <div class="card" style="margin-top:0">
        <div class="card-hd">
          <div class="t">外联单位列表 <span class="muted" style="font-size:12px; font-weight:400">共 {{ total }} 条记录</span></div>
        </div>
        <div class="card-bd" style="padding-top:10px">
          <div class="filters">
            <select class="select" style="width:160px" v-model="filters.partner_type" @change="query">
              <option value="">全部类型</option>
              <option value="GOV_PEER">对口协同单位</option>
              <option value="SUPPLIER">核心供应商</option>
              <option value="THINKTANK">智库机构</option>
              <option value="EMERGENCY">应急协作</option>
            </select>
            <input class="input" style="flex:1; min-width:200px" placeholder="搜索单位、联系人、职务或业务关键词" v-model="filters.keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>搜索</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead>
              <tr>
                <th>单位名称</th><th style="width:120px">类型</th><th style="width:90px">联系人</th>
                <th style="width:130px">联系电话</th><th>标签</th><th>备注</th><th style="width:110px">操作</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="p in rows" :key="p.partner_id">
                <td>
                  <div class="strong">{{ p.unit_name }}</div>
                  <div class="muted" style="font-size:11.5px" v-if="p.email"><ic name="mail" size="11"></ic> {{ p.email }}</div>
                </td>
                <td><span :class="['tag', typeTag(p.partner_type)]">{{ p.partner_type_label }}</span></td>
                <td>{{ p.contact_name }}</td>
                <td class="num"><ic name="phone" size="12"></ic> {{ p.phone }}</td>
                <td>
                  <span v-for="t in tagList(p.tags).slice(0, 3)" :key="t" class="tag tag-gray" style="margin:1px 4px 1px 0">{{ t }}</span>
                  <span v-if="!tagList(p.tags).length" class="muted">—</span>
                </td>
                <td class="ellipsis" style="max-width:180px" :title="p.notes || ''">{{ p.notes || '—' }}</td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="openEdit(p)"><ic name="edit" size="12"></ic>编辑</button>
                  <button class="btn btn-text btn-sm danger" @click="remove(p)"><ic name="trash" size="12"></ic>删除</button>
                </td>
              </tr>
              <tr v-if="!rows.length"><td colspan="7"><div class="empty">暂无外联单位，点击右上角「新增外联单位」登记</div></td></tr>
            </tbody>
          </table>
          <div class="pager" v-if="pageCount > 1">
            <span>共 {{ total }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in pageCount" :key="p" v-show="pageCount <= 7 || p === 1 || p === pageCount || Math.abs(p - pageNum) <= 1"
              class="pg" :class="{ on: p === pageNum }" @click="goPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
      </div>

      <!-- add / edit modal -->
      <Modal :title="editingId ? '编辑外联单位' : '新增外联单位'" width="560px" v-if="showForm" @close="showForm = false">
        <div class="form-item">
          <label class="req">单位名称</label>
          <input class="input" maxlength="150" placeholder="请输入单位全称" v-model="form.unit_name">
        </div>
        <div class="form-item">
          <label class="req">单位类型</label>
          <select class="select" v-model="form.partner_type">
            <option value="GOV_PEER">对口协同单位</option>
            <option value="SUPPLIER">核心供应商</option>
            <option value="THINKTANK">智库机构</option>
            <option value="EMERGENCY">应急协作</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">联系人</label>
          <input class="input" maxlength="100" placeholder="请输入联系人姓名" v-model="form.contact_name">
        </div>
        <div class="form-item">
          <label class="req">联系电话</label>
          <input class="input" maxlength="50" placeholder="手机或座机号" v-model="form.phone">
        </div>
        <div class="form-item">
          <label>电子邮箱</label>
          <input class="input" maxlength="100" placeholder="选填" v-model="form.email">
        </div>
        <div class="form-item">
          <label>单位地址</label>
          <input class="input" maxlength="255" placeholder="选填" v-model="form.address">
        </div>
        <div class="form-item">
          <label>业务标签</label>
          <input class="input" maxlength="200" placeholder="多个标签用逗号分隔，如：政策对接,资金申报" v-model="form.tags">
        </div>
        <div class="form-item">
          <label>备注</label>
          <textarea class="input" maxlength="500" placeholder="单位职责、对接事项等备注说明" v-model="form.notes"></textarea>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showForm = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submit">{{ editingId ? '保存修改' : '登记单位' }}</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
