/* /knowledge/search 知识检索 — pixel replica of design/mockups/079-knowledge-search.png
   Layout: 大检索框+筛选行 / (结果列表(标题高亮+评分+snippet) | 相关主题+热门文档) */
(function () {
  const CATS = ['政策法规', '制度规程', '讲话汇编', '成果档案'];
  const HOT_WORDS = ['高质量发展', '营商环境', '数字政府', '安全生产', '乡村振兴', '碳达峰碳中和', '基层治理', '调查研究'];

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  AppPages['/knowledge/search'] = {
    route: '/knowledge/search', title: '知识检索', category: 'KNOWLEDGE', primaryAction: null, icon: 'search',
    subtitle: '基于关键词打分（标题×5 / 关键词×3 / 正文×1）的混合检索，快速找到所需的制度、流程、文档和经验知识。',
    component: {
      data() {
        return {
          q: '',
          cat: '',
          sort: 'score',
          results: [],
          searched: false,
          searching: false,
          enrich: {}, // doc_id -> {doc_no, source_org}
          hotDocs: [],
          hotWords: HOT_WORDS,
          cats: CATS,
          detail: { show: false, loading: false, doc: null },
        };
      },
      computed: {
        shown() {
          const list = this.results.slice();
          if (this.sort === 'date') {
            list.sort((a, b) => String(b.publish_date || '').localeCompare(String(a.publish_date || '')));
          }
          return list;
        },
        maxScore() {
          return this.results.reduce((m, r) => Math.max(m, r.score || 0), 0);
        },
      },
      async mounted() {
        // URL 参数 ?q=&category= 自动检索
        const qs = (location.hash.split('?')[1] || '');
        const params = new URLSearchParams(qs);
        this.q = params.get('q') || '';
        this.cat = params.get('category') || '';
        this.loadEnrich();
        this.loadHot();
        if (this.q.trim()) this.doSearch();
        // 同页 hash 变化（如热门文档再次检索）不会重挂载组件，这里监听刷新
        this._onHash = () => {
          if (!location.hash.startsWith('#/knowledge/search')) return;
          const p = new URLSearchParams(location.hash.split('?')[1] || '');
          const nq = p.get('q') || '';
          if (nq !== this.q || (p.get('category') || '') !== this.cat) {
            this.q = nq;
            this.cat = p.get('category') || '';
            if (this.q.trim()) this.doSearch();
          }
        };
        window.addEventListener('hashchange', this._onHash);
      },
      unmounted() {
        if (this._onHash) window.removeEventListener('hashchange', this._onHash);
      },
      methods: {
        async loadHot() {
          try {
            const d = await api.get('/api/knowledge/stats');
            this.hotDocs = (d.hot || []).slice(0, 5);
          } catch (e) { /* 右栏辅助数据，静默失败 */ }
        },
        catTag(c) {
          return { '政策法规': 'tag-red', '制度规程': 'tag-blue', '讲话汇编': 'tag-amber', '成果档案': 'tag-teal', 'GBrainKG': 'tag-teal' }[c] || 'tag-gray';
        },
        catCls(c) {
          return { '政策法规': 'ico-red', '制度规程': 'ico-blue', '讲话汇编': 'ico-amber', '成果档案': 'ico-teal' }[c] || 'ico-blue';
        },
        async loadEnrich() {
          try {
            const r = await api.page('/api/knowledge/documents', { pageNum: 1, pageSize: 500 });
            const map = {};
            (r.rows || []).forEach((d) => { map[d.doc_id] = { doc_no: d.doc_no, source_org: d.source_org }; });
            this.enrich = map;
          } catch (e) { /* 非关键数据，静默失败 */ }
        },
        hl(text) {
          const raw = String(text || '');
          const safe = escapeHtml(raw);
          const tokens = this.q.trim().split(/\s+/).filter(Boolean).map(escapeHtml)
            .sort((a, b) => b.length - a.length);
          if (!tokens.length) return safe;
          let out = safe;
          tokens.forEach((t) => {
            out = out.replace(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), (m) => '<mark class="ks-hl">' + m + '</mark>');
          });
          return out;
        },
        scorePct(score) {
          const max = this.maxScore || 1;
          return Math.max(30, Math.round((score / max) * 100));
        },
        async doSearch() {
          const kw = this.q.trim();
          if (!kw) { this.$root.toast('请输入检索关键词', 'warn'); return; }
          this.searching = true;
          try {
            const d = await api.get('/api/knowledge/search', { q: kw, top_k: 20, category: this.cat || undefined });
            this.results = d || [];
            this.searched = true;
          } catch (e) { this.results = []; this.searched = true; }
          this.searching = false;
        },
        clearQ() { this.q = ''; this.results = []; this.searched = false; },
        retry(w) { this.q = w; this.cat = ''; this.doSearch(); },
        async openDetail(r) {
          this.detail = { show: true, loading: true, doc: null };
          try {
            const d = await api.get('/api/knowledge/documents/' + r.doc_id);
            this.detail.doc = d;
          } catch (e) { this.detail.show = false; }
          this.detail.loading = false;
        },
        closeDetail() { this.detail.show = false; },
      },
      template: `
      <div>
        <!-- hero search -->
        <div class="card kb-hero" style="margin-top:0">
          <div class="kb-hero-row">
            <span class="kb-hero-ico"><ic name="search" size="18"></ic></span>
            <input class="input kb-hero-input" v-model="q" placeholder="请输入实体名称、关键词或问题，如：公务用车 审批流程" @keyup.enter="doSearch">
            <span v-if="q" class="kb-hero-clear" @click="clearQ"><ic name="x" size="14"></ic></span>
            <button class="btn btn-primary kb-hero-btn" :disabled="searching" @click="doSearch">
              <ic :name="searching ? 'loader-2' : 'search'" size="16"></ic> {{ searching ? '检索中…' : '检索' }}
            </button>
          </div>
          <div class="kb-hero-sub" style="margin-top:10px">
            <span style="color:var(--text-2); font-size:12.5px; flex:none">知识分类</span>
            <select class="select" style="width:150px" v-model="cat">
              <option value="">全部分类</option>
              <option v-for="c in cats" :key="c" :value="c">{{ c }}</option>
            </select>
            <span style="color:var(--text-2); font-size:12.5px; flex:none; margin-left:10px">排序方式</span>
            <select class="select" style="width:150px" v-model="sort">
              <option value="score">相关度优先</option>
              <option value="date">发布日期最新</option>
            </select>
            <span class="more" style="margin-left:auto; color:var(--primary); font-size:12.5px; cursor:pointer" @click="doSearch">
              高级检索 <ic name="chevron-right" size="14"></ic>
            </span>
          </div>
        </div>

        <div class="ks-layout mt16">
          <!-- results -->
          <div class="card" style="margin-top:0">
            <div class="card-hd" v-if="searched">
              <div class="t">检索结果 <span class="muted" style="font-size:12.5px; font-weight:400">共找到 <b style="color:var(--primary)">{{ results.length }}</b> 条相关结果</span></div>
              <span class="muted" style="font-size:12px">“{{ q }}”</span>
            </div>
            <div class="card-bd" style="padding-top:6px">
              <div v-if="searching" class="empty" style="padding:60px 0"><ic name="loader-2" size="20"></ic> 正在检索知识库…</div>

              <template v-else-if="shown.length">
                <div v-for="r in shown" :key="r.doc_id" class="ks-item" @click="openDetail(r)">
                  <div class="ks-item-row">
                    <span :class="['ico-box', catCls(r.category)]" style="display:inline-flex;width:34px;height:34px;border-radius:8px;align-items:center;justify-content:center;flex:none">
                      <ic name="file-text" size="18"></ic>
                    </span>
                    <div class="ks-item-main">
                      <div class="ks-title" v-html="hl(r.title)"></div>
                      <div class="ks-snippet" v-html="hl(r.snippet)"></div>
                      <div class="ks-meta">
                        <span v-if="r.source === 'gbrainkg'" class="tag" style="background:#EEF6FF;color:#0B5FFF;border:1px solid #BBD9FF"><ic name="sparkles" size="11"></ic> GBrainKG 语义命中</span>
                        <span :class="['tag', catTag(r.category)]">{{ r.category }}</span>
                        <span class="muted" v-if="enrich[r.doc_id] && enrich[r.doc_id].source_org"><ic name="building" size="12"></ic> {{ enrich[r.doc_id].source_org }}</span>
                        <span class="muted" v-if="enrich[r.doc_id] && enrich[r.doc_id].doc_no"><ic name="hash" size="12"></ic> {{ enrich[r.doc_id].doc_no }}</span>
                        <span class="muted" v-if="r.publish_date"><ic name="calendar-days" size="12"></ic> {{ r.publish_date }}</span>
                      </div>
                    </div>
                    <div class="ks-score">
                      <div class="ks-score-num">相关度 {{ r.score }}</div>
                      <div class="progress" style="width:72px; height:6px"><div class="bar" :style="{width: scorePct(r.score) + '%'}"></div></div>
                    </div>
                  </div>
                </div>
              </template>

              <!-- empty state -->
              <div v-else-if="searched" class="ks-empty">
                <span class="ks-empty-ico"><ic name="scan-search" size="30"></ic></span>
                <div class="strong" style="font-size:15px; margin-top:10px">未找到与“{{ q }}”相关的知识文档</div>
                <div class="muted" style="margin-top:4px">建议更换关键词、检查字词拼写，或从以下热门主题入手：</div>
                <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; justify-content:center">
                  <span v-for="w in hotWords" :key="w" class="kb-hot-word" @click="retry(w)">{{ w }}</span>
                </div>
              </div>

              <div v-else class="ks-empty">
                <span class="ks-empty-ico"><ic name="book-open" size="30"></ic></span>
                <div class="strong" style="font-size:15px; margin-top:10px">输入关键词，统一检索政策法规、机关制度、讲话汇编与调研督办成果</div>
                <div style="margin-top:12px; display:flex; gap:8px; flex-wrap:wrap; justify-content:center">
                  <span v-for="w in hotWords.slice(0, 5)" :key="w" class="kb-hot-word" @click="retry(w)">{{ w }}</span>
                </div>
              </div>
            </div>
          </div>

          <!-- right rail -->
          <div>
            <div class="card" style="margin-top:0">
              <div class="card-hd"><div class="t">相关主题</div></div>
              <div class="card-bd" style="padding-top:8px">
                <div v-for="(w, i) in hotWords.slice(0, 6)" :key="w" class="ks-topic" @click="retry(w)">
                  <span :class="['sup-rank-badge', i < 3 ? 'rank-' + (i + 1) : 'rank-n']">{{ i + 1 }}</span>
                  <span class="ks-topic-name">{{ w }}</span>
                  <ic name="chevron-right" size="14" style="color:#B6C3D2"></ic>
                </div>
              </div>
            </div>
            <div class="card">
              <div class="card-hd"><div class="t">热门文档</div></div>
              <div class="card-bd" style="padding-top:8px">
                <div v-if="!hotDocs.length" class="empty" style="padding:16px 0">暂无数据</div>
                <div v-for="(h, i) in hotDocs" :key="h.doc_id" class="ks-topic" @click="retry(h.title.slice(0, 12))">
                  <span :class="['sup-rank-badge', i < 3 ? 'rank-' + (i + 1) : 'rank-n']">{{ i + 1 }}</span>
                  <span class="ks-topic-name ellipsis" :title="h.title">{{ h.title }}</span>
                  <span class="muted" style="font-size:11.5px; flex:none">{{ h.view_count }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- doc detail modal -->
      <Modal title="知识文档详情" width="680px" v-if="detail.show" @close="closeDetail">
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
      `,
    },
  };
})();
