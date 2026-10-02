/* /knowledge/home 知识工作台 — pixel replica of design/mockups/078-knowledge-home.png
   Layout: 检索大框(分类下拉+关键词+热门搜索) / 四类知识库卡片 / (热门文档 TOP5 | GBrainKG 联动状态) */
(function () {
  const CAT_META = {
    '政策法规': { name: '政策法规库', desc: '法律法规 / 国家政策 / 地方政策 / 规范性文件', icon: 'landmark', cls: 'ico-red' },
    '制度规程': { name: '机关制度库', desc: '工作制度 / 管理办法 / 办事规程 / 内部规范', icon: 'book-open', cls: 'ico-blue' },
    '讲话汇编': { name: '讲话汇编库', desc: '重要讲话 / 会议发言 / 指示批示 / 学习资料', icon: 'megaphone', cls: 'ico-amber' },
    '成果档案': { name: '调研督办成果库', desc: '调研报告 / 课题研究 / 督办台账 / 典型案例', icon: 'award', cls: 'ico-teal' },
  };
  const HOT_WORDS = ['高质量发展', '营商环境', '数字政府', '安全生产', '乡村振兴', '碳达峰碳中和', '基层治理', '调查研究'];

  function pad(x) { return String(x).padStart(2, '0'); }

  AppPages['/knowledge/home'] = {
    route: '/knowledge/home', title: '知识工作台', category: 'KNOWLEDGE', primaryAction: '新建知识', icon: 'home',
    component: {
      data() {
        return {
          loading: true,
          nick: (api.cachedUser() || {}).nick_name || '',
          scope: '',
          q: '',
          total: 0,
          weekNew: 0,
          catCounts: {},
          hot: [],
          hotWords: HOT_WORDS,
          probing: false,
          kg: { probed: false, reachable: null, mode: '—', probedAt: '' },
        };
      },
      computed: {
        hourGreet() {
          const h = new Date().getHours();
          if (h < 6) return '凌晨好';
          if (h < 12) return '上午好';
          if (h < 14) return '中午好';
          if (h < 18) return '下午好';
          return '晚上好';
        },
        cats() {
          return ['政策法规', '制度规程', '讲话汇编', '成果档案'].map((c) => ({
            key: c, count: this.catCounts[c] || 0, meta: CAT_META[c],
          }));
        },
        kgTag() {
          if (!this.kg.probed) return 'tag-gray';
          return this.kg.reachable ? 'tag-green' : 'tag-amber';
        },
        kgLabel() {
          if (!this.kg.probed) return '未探测';
          return this.kg.reachable ? '在线 · hybrid 混合检索' : '本地模式 · local 回退';
        },
      },
      async mounted() {
        try {
          const d = await api.get('/api/knowledge/stats');
          this.total = d.total || 0;
          this.weekNew = d.week_new || 0;
          (d.categories || []).forEach((c) => { this.catCounts[c.category] = c.count; });
          this.hot = d.hot || [];
        } catch (e) { /* toast already shown; keep empty state */ }
        this.loading = false;
      },
      methods: {
        fmtNum(n) {
          n = Number(n) || 0;
          return n >= 10000 ? (n / 10000).toFixed(1).replace(/\.0$/, '') + '万' : String(n);
        },
        catTag(c) {
          return { '政策法规': 'tag-red', '制度规程': 'tag-blue', '讲话汇编': 'tag-amber', '成果档案': 'tag-teal' }[c] || 'tag-gray';
        },
        catColor(c) {
          return { '政策法规': 'var(--red)', '制度规程': 'var(--primary)', '讲话汇编': '#C77F06', '成果档案': 'var(--teal)' }[c] || 'var(--primary)';
        },
        doSearch() {
          const qs = [];
          if (this.q.trim()) qs.push('q=' + encodeURIComponent(this.q.trim()));
          if (this.scope) qs.push('category=' + encodeURIComponent(this.scope));
          location.hash = '#/knowledge/search' + (qs.length ? '?' + qs.join('&') : '');
        },
        hotWord(w) { this.q = w; this.doSearch(); },
        enterCat(c) { location.hash = '#/knowledge/documents?category=' + encodeURIComponent(c); },
        enterCatAll() { location.hash = '#/knowledge/documents'; },
        searchTitle(t) { location.hash = '#/knowledge/search?q=' + encodeURIComponent(t); },
        onPrimary() {
          if (!this.isAdmin()) return this.$root.toast('仅管理员可维护知识文档', 'warn');
          sessionStorage.setItem('knowledge_doc_new', '1');
          location.hash = '#/knowledge/documents';
        },
        isAdmin() {
          const roles = (this.$root && this.$root.roles) || [];
          return roles.includes('admin');
        },
        async probeKg() {
          this.probing = true;
          try {
            const d = await api.post('/api/knowledge/sync/gbrainkg');
            const now = new Date();
            this.kg = {
              probed: true,
              reachable: !!d.reachable,
              mode: d.mode || '—',
              probedAt: pad(now.getHours()) + ':' + pad(now.getMinutes()),
            };
            this.$root.toast(d.reachable ? 'GBrainKG 连接正常' : 'GBrainKG 不可达，已切换本地知识库模式', d.reachable ? 'ok' : 'warn');
          } catch (e) { /* toast already shown */ }
          this.probing = false;
        },
      },
      template: `
      <div v-if="!loading">
        <div class="page-sub" style="margin-bottom:14px; font-size:14px">
          <b>{{ nick }}，{{ hourGreet }}！</b>　欢迎使用智慧知识，助力政务知识沉淀与高效应用！库内共 <b>{{ total }}</b> 篇文档，本周新增 <b>{{ weekNew }}</b> 篇。
        </div>

        <!-- search hero -->
        <div class="card kb-hero" style="margin-top:0">
          <div class="kb-hero-row">
            <select class="select kb-hero-scope" v-model="scope">
              <option value="">全部知识</option>
              <option value="政策法规">政策法规</option>
              <option value="制度规程">制度规程</option>
              <option value="讲话汇编">讲话汇编</option>
              <option value="成果档案">成果档案</option>
            </select>
            <input class="input kb-hero-input" v-model="q" placeholder="请输入关键词，支持政策法规、机关制度、讲话内容、调研督办成果等统一检索"
                   @keyup.enter="doSearch">
            <button class="btn btn-primary kb-hero-btn" @click="doSearch"><ic name="search" size="16"></ic> 检索</button>
          </div>
          <div class="kb-hero-sub">
            <span class="muted" style="flex:none">热门搜索：</span>
            <span v-for="w in hotWords" :key="w" class="kb-hot-word" @click="hotWord(w)">{{ w }}</span>
            <span class="more" style="margin-left:auto; color:var(--primary); font-size:12.5px; cursor:pointer" @click="doSearch">
              高级检索 <ic name="chevron-right" size="14"></ic>
            </span>
          </div>
        </div>

        <!-- category cards -->
        <div class="kb-cat-grid">
          <div v-for="c in cats" :key="c.key" class="card kb-cat-card" style="margin-top:0" @click="enterCat(c.key)">
            <div class="kb-cat-top">
              <span :class="['ico-box', c.meta.cls]" style="display:inline-flex;width:46px;height:46px;border-radius:10px;align-items:center;justify-content:center">
                <ic :name="c.meta.icon" size="24"></ic>
              </span>
              <div>
                <div class="strong" style="font-size:15px">{{ c.meta.name }}</div>
                <div class="kb-cat-num" :style="{color: catColor(c.key)}"><b>{{ c.count.toLocaleString() }}</b> 篇</div>
              </div>
            </div>
            <div class="muted kb-cat-desc">{{ c.meta.desc }}</div>
            <div class="kb-cat-enter">进入 <ic name="chevron-right" size="14"></ic></div>
          </div>
        </div>

        <div class="split-3-2">
          <!-- hot documents top5 -->
          <div class="card" style="margin-top:0">
            <div class="card-hd">
              <div class="t"><ic name="trending-up" size="16" style="color:var(--red)"></ic>热门文档 TOP5</div>
              <span class="more" @click="enterCatAll">全部文档 <ic name="chevron-right" size="14"></ic></span>
            </div>
            <div class="card-bd" style="padding-top:8px">
              <table class="table">
                <thead><tr><th style="width:52px">排名</th><th>文档名称</th><th style="width:96px">所属分类</th><th style="width:90px">阅读量</th><th style="width:80px">操作</th></tr></thead>
                <tbody>
                  <tr v-for="(h, i) in hot" :key="h.doc_id">
                    <td><span :class="['sup-rank-badge', i < 3 ? 'rank-' + (i + 1) : 'rank-n']">{{ i + 1 }}</span></td>
                    <td class="ellipsis kb-title-link" :title="h.title" @click="searchTitle(h.title)">{{ h.title }}</td>
                    <td><span :class="['tag', catTag(h.category)]">{{ h.category }}</span></td>
                    <td class="num muted">{{ fmtNum(h.view_count) }}</td>
                    <td class="actions"><button class="btn btn-ghost btn-sm" @click="searchTitle(h.title)">检索</button></td>
                  </tr>
                  <tr v-if="!hot.length"><td colspan="5"><div class="empty">暂无热门文档</div></td></tr>
                </tbody>
              </table>
            </div>
          </div>

          <!-- right: GBrainKG sync + mini stats -->
          <div>
            <div class="card" style="margin-top:0">
              <div class="card-hd">
                <div class="t"><ic name="network" size="16" style="color:var(--primary)"></ic>GBrainKG 联动状态</div>
                <span :class="['tag', kgTag]">{{ kgLabel }}</span>
              </div>
              <div class="card-bd">
                <div class="desc-list" style="grid-template-columns:84px 1fr">
                  <span class="k muted">检索模式</span><span class="strong">{{ kg.mode }}</span>
                  <span class="k muted">上次探测</span><span>{{ kg.probedAt || '—' }}</span>
                  <span class="k muted">回退策略</span><span>不可达时自动回退本地知识库（local）</span>
                </div>
                <button class="btn btn-primary mt12" style="width:100%; justify-content:center" :disabled="probing" @click="probeKg">
                  <ic :name="probing ? 'loader-2' : 'refresh-cw'" size="14"></ic> {{ probing ? '探测中…' : '探测连接' }}
                </button>
                <div class="muted" style="font-size:11.5px; line-height:1.6; margin-top:8px">
                  探测政企知识图谱服务 GBrainKG 可达性：可达时启用 hybrid 混合检索，不可达静默切换本地模式，绝不中断检索服务。
                </div>
              </div>
            </div>
            <div class="card">
              <div class="card-hd"><div class="t"><ic name="bar-chart-3" size="16" style="color:var(--teal)"></ic>库容速览</div></div>
              <div class="card-bd kb-mini-grid">
                <div class="mini-stat"><div class="muted">文档总量</div><div class="ms-val">{{ total }}<i>篇</i></div></div>
                <div class="mini-stat"><div class="muted">本周新增</div><div class="ms-val">{{ weekNew }}<i>篇</i></div></div>
                <div class="mini-stat"><div class="muted">知识分类</div><div class="ms-val">{{ cats.filter(c => c.count > 0).length }}<i>类</i></div></div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="empty" style="padding-top:120px">加载中…</div>
      `,
    },
  };
})();

