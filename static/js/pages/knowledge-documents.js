/* /knowledge/documents 知识文档 — pixel replica of design/mockups/080-knowledge-documents.png
   Layout: (知识库目录分类树 | 文档列表 table+筛选+分页) + 详情弹窗 / 新增编辑弹窗（admin） */
(function () {
  const CATS = ['政策法规', '制度规程', '讲话汇编', '成果档案'];

  AppPages['/knowledge/documents'] = {
    route: '/knowledge/documents', title: '知识文档', category: 'KNOWLEDGE', primaryAction: '新增文档', icon: 'file-text',
    subtitle: '沉淀政企知识，规范制度流程，支撑业务决策与高效协同。',
    component: {
      data() {
        return {
        tab: 'local', // local=本地文档库 | gbrainkg=GBrainKG 知识中枢
        kgLoading: false, kgItems: [], kgTotal: 0, kgKeyword: '', kgProbed: null,
          loading: true,
          rows: [],
          total: 0,
          totalAll: 0,
          catCounts: {},
          cats: CATS,
          filters: { keyword: '', category: '' },
          pageNum: 1,
          pageSize: 10,
          detail: { show: false, loading: false, doc: null },
          showForm: false,
          editing: null,
          submitting: false,
          form: { title: '', category: '政策法规', doc_no: '', source_org: '', publish_date: '', keywords: '', content: '' },
        };
      },
      computed: {
        pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
        pageStart() { return (this.pageNum - 1) * this.pageSize; },
        isAdmin() {
          const roles = (this.$root && this.$root.roles) || [];
          return roles.includes('admin');
        },
      },
      async mounted() {
        // URL 参数 ?category= 预置分类筛选；首页「新建知识」跳转时打开新增弹窗
        const params = new URLSearchParams(location.hash.split('?')[1] || '');
        if (params.get('category')) this.filters.category = params.get('category');
        this.loadStats();
        await this.load();
        this.loading = false;
        if (sessionStorage.getItem('knowledge_doc_new') === '1') {
          sessionStorage.removeItem('knowledge_doc_new');
          if (this.isAdmin) this.openForm(null);
          else this.$root.toast('仅管理员可维护知识文档', 'warn');
        }
        // 同页 hash 变化（如工作台再次点击分类进入）不会重挂载组件，这里监听刷新
        this._onHash = () => {
          if (!location.hash.startsWith('#/knowledge/documents')) return;
          const p = new URLSearchParams(location.hash.split('?')[1] || '');
          const ncat = p.get('category') || '';
          if (ncat !== this.filters.category) {
            this.filters.category = ncat;
            this.query();
          }
        };
        window.addEventListener('hashchange', this._onHash);
      },
      unmounted() {
        if (this._onHash) window.removeEventListener('hashchange', this._onHash);
      },
      methods: {
      async loadKg(force) {
        if (this.kgItems.length && !force && this.kgKeyword === this._kgLoadedKw) return;
        this.kgLoading = true;
        try {
          const d = await api.get('/api/knowledge/gbrainkg/documents', { keyword: this.kgKeyword || '', page_size: 30 });
          this.kgItems = d.items || [];
          this.kgTotal = d.total || 0;
          this._kgLoadedKw = this.kgKeyword;
        } catch (e) { this.kgItems = []; this.kgTotal = 0; }
        this.kgLoading = false;
      },
      async kgSearch() { await this.loadKg(true); },
      setTab(t) { this.tab = t; if (t === 'gbrainkg' && !this.kgProbed) this.probeKg(); },
      async probeKg() {
        try {
          this.kgProbed = await api.get('/api/knowledge/gbrainkg/status');
        } catch (e) { this.kgProbed = { reachable: false }; }
        if (this.tab === 'gbrainkg') await this.loadKg(true);
      },
        async loadStats() {
          try {
            const d = await api.get('/api/knowledge/stats');
            this.totalAll = d.total || 0;
            const m = {};
            (d.categories || []).forEach((c) => { m[c.category] = c.count; });
            this.catCounts = m;
          } catch (e) { /* 静默 */ }
        },
        async load() {
          try {
            const r = await api.page('/api/knowledge/documents', {
              keyword: this.filters.keyword.trim() || undefined,
              category: this.filters.category || undefined,
              pageNum: this.pageNum, pageSize: this.pageSize,
            });
            this.rows = r.rows || [];
            this.total = r.total || 0;
          } catch (e) { this.rows = []; this.total = 0; }
        },
        catTag(c) {
          return { '政策法规': 'tag-red', '制度规程': 'tag-blue', '讲话汇编': 'tag-amber', '成果档案': 'tag-teal' }[c] || 'tag-gray';
        },
        catCls(c) {
          return { '政策法规': 'ico-red', '制度规程': 'ico-blue', '讲话汇编': 'ico-amber', '成果档案': 'ico-teal' }[c] || 'ico-blue';
        },
        catColor(c) {
          return { '政策法规': 'var(--red)', '制度规程': 'var(--primary)', '讲话汇编': 'var(--amber)', '成果档案': 'var(--teal)' }[c] || 'var(--text-3)';
        },
        query() { this.pageNum = 1; this.load(); },
        reset() { this.filters = { keyword: '', category: '' }; this.query(); },
        pickCat(c) { this.filters.category = c; this.query(); },
        goPage(p) { if (p >= 1 && p <= this.pageCount && p !== this.pageNum) { this.pageNum = p; this.load(); } },
        pages() {
          const out = [];
          const start = Math.max(1, this.pageNum - 2);
          const end = Math.min(this.pageCount, start + 4);
          for (let i = start; i <= end; i++) out.push(i);
          return out;
        },
        async openDetail(d) {
          this.detail = { show: true, loading: true, doc: null };
          try {
            const doc = await api.get('/api/knowledge/documents/' + d.doc_id);
            this.detail.doc = doc;
          } catch (e) { this.detail.show = false; }
          this.detail.loading = false;
          this.load(); // 浏览量 +1 后同步列表
        },
        closeDetail() { this.detail.show = false; },
        onPrimary() {
          if (!this.isAdmin) return this.$root.toast('仅管理员可维护知识文档', 'warn');
          this.openForm(null);
        },
        async openForm(doc) {
          if (doc) {
            // 列表行只有 content_preview，编辑前拉取完整正文
            try { doc = await api.get('/api/knowledge/documents/' + doc.doc_id); } catch (e) { return; }
          }
          this.editing = doc || null;
          this.form = doc ? {
            title: doc.title || '', category: doc.category || '政策法规', doc_no: doc.doc_no || '',
            source_org: doc.source_org || '', publish_date: doc.publish_date || '',
            keywords: doc.keywords || '', content: doc.content || doc.content_preview || '',
          } : { title: '', category: this.filters.category || '政策法规', doc_no: '', source_org: '', publish_date: '', keywords: '', content: '' };
          this.showForm = true;
        },
        async submitForm() {
          const f = this.form;
          if (!f.title.trim()) return this.$root.toast('请填写文档标题', 'warn');
          this.submitting = true;
          try {
            const body = {
              title: f.title.trim(), category: f.category, doc_no: f.doc_no.trim(),
              source_org: f.source_org.trim(), publish_date: f.publish_date || null,
              keywords: f.keywords.trim(), content: f.content,
            };
            if (this.editing) await api.put('/api/knowledge/documents/' + this.editing.doc_id, body);
            else await api.post('/api/knowledge/documents', body);
            this.$root.toast(this.editing ? '文档已更新' : '文档已入库', 'ok');
            this.showForm = false;
            this.load();
            this.loadStats();
          } catch (e) { /* toast already shown */ }
          this.submitting = false;
        },
        async removeDoc(d) {
          if (!window.confirm('确认删除文档「' + d.title + '」？该操作不可恢复。')) return;
          try {
            await api.del('/api/knowledge/documents/' + d.doc_id);
            this.$root.toast('删除成功', 'ok');
            if (this.rows.length === 1 && this.pageNum > 1) this.pageNum -= 1;
            this.load();
            this.loadStats();
          } catch (e) { /* toast already shown */ }
        },
      },
      template: `
      <div v-if="!loading">
        <div class="kbdoc-layout">
          <!-- left: category tree -->
          <div class="card" style="margin-top:0">
            <div class="card-hd"><div class="t"><ic name="folder-open" size="16" style="color:var(--amber)"></ic>知识库目录</div></div>
            <div class="card-bd" style="padding-top:8px">
              <div class="kb-cat-item" :class="{on: !filters.category}" @click="pickCat('')">
                <ic name="layers" size="15"></ic><span>全部知识</span><b>{{ totalAll }}</b>
              </div>
              <div v-for="c in cats" :key="c" class="kb-cat-item" :class="{on: filters.category === c}" @click="pickCat(c)">
                <ic name="folder" size="15" :style="{color: catColor(c)}"></ic>
                <span>{{ c }}库</span><b>{{ catCounts[c] || 0 }}</b>
              </div>
            </div>
            <div class="card-bd" style="border-top:1px solid var(--line); padding-top:10px">
              <div class="muted" style="font-size:11.5px; line-height:1.7">
                <ic name="circle-help" size="12"></ic>
                点击分类可快速筛选文档；关键词检索覆盖标题、文号与关键词字段。
              </div>
            </div>
          </div>

          <!-- right: documents table -->
          <div class="card" style="margin-top:0">
            <div class="card-bd">
              <!-- source tabs: local / GBrainKG -->
              <div style="display:flex; align-items:center; gap:10px; margin-bottom:12px">
                <span class="kd-tab" :class="{on: tab === 'local'}" @click="setTab('local')"><ic name="database" size="14"></ic> 本地文档库</span>
                <span class="kd-tab" :class="{on: tab === 'gbrainkg'}" @click="setTab('gbrainkg')"><ic name="sparkles" size="14"></ic> GBrainKG 知识中枢
                  <span v-if="kgProbed && kgProbed.reachable" class="tag tag-green" style="margin-left:4px">已连接</span>
                  <span v-else-if="kgProbed" class="tag tag-gray" style="margin-left:4px">离线</span>
                </span>
              </div>

              <!-- GBrainKG remote view -->
              <div v-if="tab === 'gbrainkg'">
                <div class="filters" style="margin-bottom:10px">
                  <span class="f-label">探查词</span>
                  <input class="input" style="width:240px" placeholder="输入关键词探查远程知识库" v-model="kgKeyword" @keyup.enter="kgSearch">
                  <button class="btn btn-primary btn-sm" :disabled="kgLoading" @click="kgSearch"><ic :name="kgLoading ? 'loader-2' : 'search'" size="13"></ic> {{ kgLoading ? '检索中…' : '探查' }}</button>
                  <span class="muted" style="margin-left:auto; font-size:12px" v-if="kgProbed">
                    {{ kgProbed.reachable ? (kgProbed.base_url || '') + ' · ' + (kgProbed.kb_count || 0) + ' 个知识库 / ' + (kgProbed.document_count || 0) + ' 篇文档' : (kgProbed.reason || '服务不可达') }}
                  </span>
                </div>
                <table class="table">
                  <thead><tr><th>文档标题</th><th style="width:90px">所属库</th><th style="width:90px">命中分片</th><th style="width:100px">相关度</th><th>证据片段</th></tr></thead>
                  <tbody>
                    <tr v-for="d in kgItems" :key="(d.doc_id || '') + (d.title || '')">
                      <td class="strong"><ic name="file-text" size="13" style="vertical-align:-2px; color:var(--teal)"></ic> {{ d.title }}</td>
                      <td><span class="tag tag-teal">GBrainKG</span></td>
                      <td class="num">{{ d.chunk_count || 1 }}</td>
                      <td class="num">{{ d.score }}</td>
                      <td class="muted" style="max-width:420px"><div class="ellipsis">{{ (d.evidence || '').slice(0, 120) }}</div></td>
                    </tr>
                    <tr v-if="!kgItems.length && !kgLoading"><td colspan="5"><div class="empty">{{ kgProbed && !kgProbed.reachable ? 'GBrainKG 服务不可达（已自动回退本地库，请稍后重试）' : '暂无探查结果，请更换关键词' }}</div></td></tr>
                  </tbody>
                </table>
              </div>

              <!-- local view (original) -->
              <div v-else>
              <div class="filters" style="margin-bottom:0">
                <span class="f-label">关键词</span>
                <input class="input" style="width:210px" placeholder="标题 / 文号 / 关键词" v-model="filters.keyword" @keyup.enter="query">
                <span class="f-label">分类</span>
                <select class="select" style="width:140px" v-model="filters.category" @change="query">
                  <option value="">全部分类</option>
                  <option v-for="c in cats" :key="c" :value="c">{{ c }}</option>
                </select>
                <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic> 查询</button>
                <button class="btn btn-ghost" @click="reset">重置</button>
                <button v-if="isAdmin" class="btn btn-primary" style="margin-left:auto" @click="openForm(null)">
                  <ic name="plus" size="14"></ic> 新增文档
                </button>
              </div>
            </div>
            <div style="padding:0 18px 16px">
              <table class="table table-tight">
                <thead><tr>
                  <th>文档标题</th><th style="width:140px">文号</th><th style="width:130px">发布单位</th>
                  <th style="width:92px">分类</th><th style="width:104px">发布日期</th>
                  <th style="width:76px">浏览量</th><th style="width:150px">操作</th>
                </tr></thead>
                <tbody>
                  <tr v-for="d in rows" :key="d.doc_id">
                    <td>
                      <span class="kbdoc-title" @click="openDetail(d)" :title="d.title">
                        <span :class="['ico-box', catCls(d.category)]" style="display:inline-flex;width:24px;height:24px;border-radius:6px;align-items:center;justify-content:center;margin-right:8px;flex:none"><ic name="file-text" size="14"></ic></span>{{ d.title }}
                      </span>
                    </td>
                    <td class="muted">{{ d.doc_no || '—' }}</td>
                    <td class="muted">{{ d.source_org || '—' }}</td>
                    <td><span :class="['tag', catTag(d.category)]">{{ d.category }}</span></td>
                    <td class="muted num">{{ d.publish_date || '—' }}</td>
                    <td class="num muted">{{ d.view_count }}</td>
                    <td class="actions">
                      <button class="btn btn-text btn-sm" @click="openDetail(d)">查看</button>
                      <template v-if="isAdmin">
                        <button class="btn btn-text btn-sm" @click="openForm(d)">编辑</button>
                        <button class="btn btn-text btn-sm danger" @click="removeDoc(d)">删除</button>
                      </template>
                    </td>
                  </tr>
                  <tr v-if="!rows.length"><td colspan="7"><div class="empty">暂无符合条件的文档</div></td></tr>
                </tbody>
              </table>
              <div class="pager">
                <span>共 {{ total }} 条</span>
                <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)">上一页</button>
                <button v-for="p in pages()" :key="p" class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
                <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)">下一页</button>
              </div>
              </div><!-- /local view -->
            </div>
          </div>
        </div>
      </div>
      <div v-else class="empty" style="padding-top:120px">加载中…</div>

      <!-- detail modal -->
      <Modal title="知识文档详情" width="700px" v-if="detail.show" @close="closeDetail">
        <div v-if="detail.loading" class="empty" style="padding:30px 0">加载中…</div>
        <template v-else-if="detail.doc">
          <div style="display:flex; gap:10px; align-items:center">
            <span :class="['ico-box', catCls(detail.doc.category)]" style="display:inline-flex;width:38px;height:38px;border-radius:8px;align-items:center;justify-content:center">
              <ic name="file-text" size="20"></ic>
            </span>
            <div>
              <div class="strong" style="font-size:15px">{{ detail.doc.title }}</div>
              <div style="margin-top:3px"><span :class="['tag', catTag(detail.doc.category)]">{{ detail.doc.category }}</span></div>
            </div>
          </div>
          <div class="desc-list mt12" style="grid-template-columns:84px 1fr">
            <span class="k muted">文号</span><span>{{ detail.doc.doc_no || '—' }}</span>
            <span class="k muted">发布单位</span><span>{{ detail.doc.source_org || '—' }}</span>
            <span class="k muted">发布日期</span><span>{{ detail.doc.publish_date || '—' }}</span>
            <span class="k muted">关键词</span><span>{{ detail.doc.keywords || '—' }}</span>
            <span class="k muted">浏览量</span><span>{{ detail.doc.view_count }}</span>
          </div>
          <div class="divider"></div>
          <div class="kb-paper">{{ detail.doc.content || '（暂无正文内容）' }}</div>
        </template>
      </Modal>

      <!-- add / edit modal -->
      <Modal :title="editing ? '编辑文档' : '新增文档'" width="620px" v-if="showForm" @close="showForm = false">
        <div class="form-item"><label class="req">文档标题</label><input class="input" v-model="form.title" placeholder="请输入文档标题"></div>
        <div class="form-item"><label class="req">所属分类</label>
          <select class="select" v-model="form.category">
            <option v-for="c in cats" :key="c" :value="c">{{ c }}</option>
          </select>
        </div>
        <div class="form-item"><label>文号</label><input class="input" v-model="form.doc_no" placeholder="如：市政办发〔2024〕12 号"></div>
        <div class="form-item"><label>发布单位</label><input class="input" v-model="form.source_org" placeholder="如：市人民政府办公厅"></div>
        <div class="form-item"><label>发布日期</label><input type="date" class="input" v-model="form.publish_date"></div>
        <div class="form-item"><label>关键词</label><input class="input" v-model="form.keywords" placeholder="逗号分隔，如：公务用车,审批流程"></div>
        <div class="form-item"><label>正文内容</label><textarea class="input" rows="6" v-model="form.content" placeholder="请输入文档正文内容（用于全文检索与预览）"></textarea></div>
        <template #footer>
          <button class="btn btn-ghost" @click="showForm = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitForm">
            <ic :name="submitting ? 'loader-2' : 'save'" size="14"></ic> {{ submitting ? '保存中…' : '保存' }}
          </button>
        </template>
      </Modal>
      `,
    },
  };
})();
