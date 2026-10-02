/* /contacts/experts 专家人才库 — pixel replica of design/mockups/045-contacts-experts.png
   Layout: filters (领域/层级/关键词) + expert card grid (3 col) + server pager + add/edit modal */
AppPages['/contacts/experts'] = {
  route: '/contacts/experts', title: '专家人才库', category: 'CONTACTS', primaryAction: '新增专家', icon: 'award',
  subtitle: '汇聚评审专家、行业顾问、涉密审查员等专业人才，支持研究领域与标签多维检索，为决策咨询、项目评审和政务合作提供人才支撑。',
  component: {
    data() {
      return {
        loading: true,
        rows: [],
        total: 0,
        pageNum: 1,
        pageSize: 9,
        filters: { field_domain: '', level: '', keyword: '' },
        fields: [],
        showForm: false,
        submitting: false,
        editingId: '',
        form: { name: '', title: '', organization: '', field_domain: '', level: 'NATIONAL', phone: '', email: '', bio: '' },
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
          const r = await api.page('/api/contacts/experts', {
            field_domain: this.filters.field_domain || undefined,
            level: this.filters.level || undefined,
            keyword: this.filters.keyword || undefined,
            pageNum: this.pageNum,
            pageSize: this.pageSize,
          });
          this.rows = r.rows || [];
          this.total = r.total || 0;
        } catch (e) { this.rows = []; this.total = 0; }
        try {
          const all = await api.get('/api/contacts/experts', { pageSize: 500 });
          this.fields = [...new Set((all.rows || []).map((e) => e.field_domain).filter(Boolean))];
        } catch (e) { /* keep old */ }
      },
      query() { this.pageNum = 1; this.load(); },
      reset() { this.filters = { field_domain: '', level: '', keyword: '' }; this.query(); },
      goPage(p) {
        if (p < 1 || p > this.pageCount || p === this.pageNum) return;
        this.pageNum = p;
        this.load();
      },
      levelTag(l) { return { NATIONAL: 'tag-red', PROVINCIAL: 'tag-amber', MUNICIPAL: 'tag-blue' }[l] || 'tag-gray'; },
      fieldList(s) { return String(s || '').split(/[,，、/\s]+/).filter(Boolean); },
      openAdd() {
        this.editingId = '';
        this.form = { name: '', title: '', organization: '', field_domain: '', level: 'NATIONAL', phone: '', email: '', bio: '' };
        this.showForm = true;
      },
      openEdit(e) {
        this.editingId = e.expert_id;
        this.form = {
          name: e.name || '', title: e.title || '', organization: e.organization || '',
          field_domain: e.field_domain || '', level: e.level || 'NATIONAL',
          phone: e.phone || '', email: e.email || '', bio: e.bio || '',
        };
        this.showForm = true;
      },
      async submit() {
        const f = this.form;
        if (!f.name.trim()) return this.$root.toast('姓名不能为空', 'warn');
        if (!f.organization.trim()) return this.$root.toast('所在机构不能为空', 'warn');
        if (!f.field_domain.trim()) return this.$root.toast('研究领域不能为空', 'warn');
        if (!f.phone.trim()) return this.$root.toast('联系电话不能为空', 'warn');
        this.submitting = true;
        try {
          if (this.editingId) {
            await api.put('/api/contacts/experts/' + this.editingId, f);
            this.$root.toast('专家档案已更新', 'ok');
          } else {
            await api.post('/api/contacts/experts', f);
            this.$root.toast('专家档案已登记', 'ok');
          }
          this.showForm = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async remove(e) {
        if (!window.confirm('确认删除专家【' + e.name + '】的档案？')) return;
        try {
          await api.del('/api/contacts/experts/' + e.expert_id);
          this.$root.toast('删除成功', 'ok');
          await this.load();
        } catch (e2) { /* toast shown */ }
      },
      onPrimary() { this.openAdd(); },
    },
    template: `
    <div v-if="!loading">
      <div class="card" style="margin-top:0">
        <div class="card-hd">
          <div class="t">专家列表 <span class="muted" style="font-size:12px; font-weight:400">共找到 {{ total }} 位专家</span></div>
        </div>
        <div class="card-bd" style="padding-top:10px">
          <div class="filters">
            <select class="select" style="width:170px" v-model="filters.field_domain" @change="query">
              <option value="">全部研究领域</option>
              <option v-for="f in fields" :key="f" :value="f">{{ f }}</option>
            </select>
            <select class="select" style="width:140px" v-model="filters.level" @change="query">
              <option value="">全部层级</option>
              <option value="NATIONAL">国家级</option>
              <option value="PROVINCIAL">省级</option>
              <option value="MUNICIPAL">市级</option>
            </select>
            <input class="input" style="flex:1; min-width:200px" placeholder="姓名、机构、研究方向关键词" v-model="filters.keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>

          <div class="exp-grid" v-if="rows.length">
            <div class="exp-card" v-for="e in rows" :key="e.expert_id">
              <div style="display:flex; align-items:flex-start; gap:12px">
                <span class="emp-avatar" style="width:44px;height:44px;font-size:17px;background:var(--primary-weak);color:var(--primary)">{{ (e.name || '?').slice(0, 1) }}</span>
                <div style="flex:1; min-width:0">
                  <div style="display:flex; align-items:center; gap:6px">
                    <span class="strong" style="font-size:14.5px">{{ e.name }}</span>
                    <span class="muted" style="font-size:12px">{{ e.title || '' }}</span>
                  </div>
                  <div class="muted" style="font-size:12px; margin-top:3px; display:flex; align-items:center; gap:4px">
                    <ic name="building-2" size="12"></ic> {{ e.organization }}
                  </div>
                </div>
                <span :class="['tag', levelTag(e.level)]" style="flex:none">{{ e.level_label }}</span>
              </div>
              <div style="margin-top:10px">
                <span v-for="t in fieldList(e.field_domain)" :key="t" class="tag tag-blue" style="margin:0 4px 4px 0">{{ t }}</span>
              </div>
              <div class="exp-bio" v-if="e.bio" :title="e.bio">{{ e.bio }}</div>
              <div class="exp-foot">
                <div class="muted" style="font-size:12px; min-width:0">
                  <div style="white-space:nowrap"><ic name="phone" size="12"></ic> {{ e.phone }}</div>
                  <div style="white-space:nowrap; overflow:hidden; text-overflow:ellipsis" :title="e.email || ''" v-if="e.email"><ic name="mail" size="12"></ic> {{ e.email }}</div>
                </div>
                <div style="flex:none">
                  <button class="btn btn-text btn-sm" @click="openEdit(e)"><ic name="edit" size="12"></ic>编辑</button>
                  <button class="btn btn-text btn-sm danger" @click="remove(e)"><ic name="trash" size="12"></ic>删除</button>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="empty">暂无专家数据，点击右上角「新增专家」登记</div>

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
      <Modal :title="editingId ? '编辑专家档案' : '新增专家档案'" width="560px" v-if="showForm" @close="showForm = false">
        <div class="form-item">
          <label class="req">姓名</label>
          <input class="input" maxlength="100" placeholder="请输入专家姓名" v-model="form.name">
        </div>
        <div class="form-item">
          <label>职称</label>
          <input class="input" maxlength="100" placeholder="如：教授 / 研究员 / 高级工程师" v-model="form.title">
        </div>
        <div class="form-item">
          <label class="req">所在机构</label>
          <input class="input" maxlength="150" placeholder="请输入所在单位 / 高校 / 研究机构" v-model="form.organization">
        </div>
        <div class="form-item">
          <label class="req">研究领域</label>
          <input class="input" maxlength="100" placeholder="如：公共管理、数字化转型（多个用逗号分隔）" v-model="form.field_domain">
        </div>
        <div class="form-item">
          <label class="req">专家层级</label>
          <select class="select" v-model="form.level">
            <option value="NATIONAL">国家级</option>
            <option value="PROVINCIAL">省级</option>
            <option value="MUNICIPAL">市级</option>
          </select>
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
          <label>专家简介</label>
          <textarea class="input" maxlength="1000" placeholder="履历、专长、评审经验等（选填）" v-model="form.bio"></textarea>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showForm = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submit">{{ editingId ? '保存修改' : '登记专家' }}</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
