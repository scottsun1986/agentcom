/* /knowledge/graph 知识图谱 — pixel replica of design/mockups/081-knowledge-graph.png
   Layout: (实体类型+图谱统计 | 图谱 SVG(极坐标布局: 分类外圈/文档中圈/关键词内圈, 可拖拽) | 节点详情)
   节点 > 60 时按连接度抽样渲染防卡顿；pointer 事件拖拽节点；hover/搜索高亮。 */
(function () {
  const CX = 450, CY = 310, VB_W = 900, VB_H = 620;
  const NODE_LIMIT = 60;
  const CAT_COLOR = { '政策法规': '#E5484D', '制度规程': '#246BFD', '讲话汇编': '#F59E0B', '成果档案': '#13A89E' };

  AppPages['/knowledge/graph'] = {
    route: '/knowledge/graph', title: '知识图谱', category: 'KNOWLEDGE', primaryAction: null, icon: 'git-branch',
    subtitle: '基于 GBrainKG 构建的政务办公知识图谱，融合分类、文档、关键词多源知识，支持实体关系探索与文档溯源。',
    component: {
      data() {
        return {
          loading: true,
          error: false,
          nodes: [],      // 渲染节点 {id,label,type,x,y,r,color,anchorX,anchorY,deg}
          edges: [],      // 渲染边 {source,target}
          rawTotal: 0,
          sampled: false,
          loadTime: '',
          hoverId: '',
          selId: '',
          typeFilter: '',
          searchKw: '',
          zoom: 1,
          drag: null,
          detail: { show: false, loading: false, doc: null },
        };
      },
      computed: {
        viewBox() {
          const z = this.zoom;
          return `${CX - (CX / z)} ${CY - (CY / z)} ${VB_W / z} ${VB_H / z}`;
        },
        posMap() {
          const m = {};
          this.nodes.forEach((n) => { m[n.id] = n; });
          return m;
        },
        counts() {
          const c = { category: 0, doc: 0, keyword: 0 };
          this.nodes.forEach((n) => { c[n.type] = (c[n.type] || 0) + 1; });
          return c;
        },
        selNode() { return this.posMap[this.selId] || null; },
        selLinks() {
          if (!this.selId) return [];
          const out = [];
          this.edges.forEach((e) => {
            if (e.source === this.selId && this.posMap[e.target]) out.push(this.posMap[e.target]);
            else if (e.target === this.selId && this.posMap[e.source]) out.push(this.posMap[e.source]);
          });
          return out.slice(0, 12);
        },
        legendCats() {
          const present = new Set(this.nodes.filter((n) => n.type === 'category').map((n) => n.label));
          return Object.keys(CAT_COLOR).filter((c) => present.has(c));
        },
      },
      async mounted() {
        await this.load();
        this.loading = false;
      },
      methods: {
        async load() {
          try {
            const d = await api.get('/api/knowledge/graph');
            this.build(d || { nodes: [], edges: [] });
            const now = new Date();
            const pad = (x) => String(x).padStart(2, '0');
            this.loadTime = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
          } catch (e) { this.error = true; this.nodes = []; this.edges = []; }
        },
        build(data) {
          let nodes = data.nodes || [];
          let edges = data.edges || [];
          this.rawTotal = nodes.length;
          const deg = {};
          edges.forEach((e) => { deg[e.source] = (deg[e.source] || 0) + 1; deg[e.target] = (deg[e.target] || 0) + 1; });

          let cats = nodes.filter((n) => n.type === 'category');
          let docs = nodes.filter((n) => n.type === 'doc');
          let kws = nodes.filter((n) => n.type === 'keyword');
          if (nodes.length > NODE_LIMIT) {
            this.sampled = true;
            docs.sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0));
            kws.sort((a, b) => (deg[b.id] || 0) - (deg[a.id] || 0));
            docs = docs.slice(0, 36);
            kws = kws.slice(0, 16);
            const keep = new Set([].concat(cats.map((c) => c.id), docs.map((d) => d.id), kws.map((k) => k.id)));
            edges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
          } else {
            this.sampled = false;
          }

          // —— 极坐标预置布局：分类均分外圈，文档挂分类旁扇形展开，关键词聚合内圈 ——
          const squash = 0.78; // y 轴压扁适配 16:11 画布
          cats.forEach((c, i) => {
            const a = ((-90 + (360 / Math.max(1, cats.length)) * i) * Math.PI) / 180;
            c.r = 20;
            c.color = CAT_COLOR[c.label] || '#246BFD';
            c.x = CX + 250 * Math.cos(a);
            c.y = CY + 250 * squash * Math.sin(a);
          });
          const catAngle = {};
          cats.forEach((c, i) => { catAngle[c.id] = (-90 + (360 / Math.max(1, cats.length)) * i) * Math.PI / 180; });

          // 文档按所属分类分组
          const docsByCat = {};
          const docCat = {};
          edges.forEach((e) => {
            if (e.source.startsWith('cat:') && e.target.startsWith('doc:')) {
              (docsByCat[e.source] = docsByCat[e.source] || []).push(e.target);
              docCat[e.target] = e.source;
            }
          });
          const docNodeById = {};
          docs.forEach((d) => { docNodeById[d.id] = d; d.r = 9; d.color = '#246BFD'; });
          Object.keys(docsByCat).forEach((catId) => {
            const list = docsByCat[catId].filter((id) => docNodeById[id]);
            const base = catAngle[catId] !== undefined ? catAngle[catId] : 0;
            const step = Math.min(0.34, 1.5 / Math.max(1, list.length)); // 弧度步长
            list.forEach((id, j) => {
              const d = docNodeById[id];
              const a = base + (j - (list.length - 1) / 2) * step;
              const rr = 138 + (j % 3) * 26;
              d.anchorX = d.x = CX + rr * Math.cos(a);
              d.anchorY = d.y = CY + rr * squash * Math.sin(a);
            });
          });
          docs.forEach((d) => {
            if (d.x === undefined) { d.anchorX = d.x = CX; d.anchorY = d.y = CY; }
          });

          // 关键词：沿所连文档的平均方向聚合到内圈；方向过于分散时内圈均布
          const kwDocs = {};
          edges.forEach((e) => {
            if (e.source.startsWith('doc:') && e.target.startsWith('kw:')) {
              (kwDocs[e.target] = kwDocs[e.target] || []).push(e.source);
            }
          });
          const kwList = kws.filter((k) => k);
          kwList.forEach((k, idx) => { k.r = 6; k.color = '#64809C'; });
          kwList.forEach((k, idx) => {
            const refs = (kwDocs[k.id] || []).map((id) => docNodeById[id]).filter(Boolean);
            let vx = 0, vy = 0;
            refs.forEach((d) => {
              const dx = d.x - CX, dy = d.y - CY;
              const len = Math.hypot(dx, dy) || 1;
              vx += dx / len; vy += dy / len;
            });
            if (refs.length && Math.hypot(vx, vy) > 0.18) {
              const len = Math.hypot(vx, vy) || 1;
              k.anchorX = k.x = CX + (vx / len) * 64;
              k.anchorY = k.y = CY + (vy / len) * 64 * squash;
            } else {
              const a = ((-90 + idx * (360 / Math.max(1, kwList.length))) * Math.PI) / 180;
              k.anchorX = k.x = CX + 60 * Math.cos(a);
              k.anchorY = k.y = CY + 60 * squash * Math.sin(a);
            }
          });
          kws.forEach((k) => {
            if (k.x === undefined) { k.anchorX = k.x = CX; k.anchorY = k.y = CY; }
          });

          // 轻量松弛：同圈文档互斥，避免重叠（锚点弹簧拉回预置位）
          const relaxNodes = docs.concat(kws);
          for (let it = 0; it < 50; it++) {
            for (let i = 0; i < relaxNodes.length; i++) {
              for (let j = i + 1; j < relaxNodes.length; j++) {
                const a = relaxNodes[i], b = relaxNodes[j];
                let dx = b.x - a.x, dy = b.y - a.y;
                let dist = Math.hypot(dx, dy);
                const minD = a.r + b.r + 16;
                if (dist < minD && dist > 0.01) {
                  const push = ((minD - dist) / dist) * 0.22;
                  dx *= push; dy *= push;
                  a.x -= dx; a.y -= dy; b.x += dx; b.y += dy;
                }
              }
            }
            relaxNodes.forEach((n) => {
              n.x += (n.anchorX - n.x) * 0.08;
              n.y += (n.anchorY - n.y) * 0.08;
            });
          }

          const all = cats.concat(docs, kws);
          all.forEach((n) => {
            n.x = Math.max(24, Math.min(VB_W - 24, n.x));
            n.y = Math.max(20, Math.min(VB_H - 20, n.y));
            n.deg = deg[n.id] || 0;
          });
          this.nodes = all;
          this.edges = edges;
        },
        typeLabel(t) { return { category: '分类', doc: '文档', keyword: '关键词' }[t] || t; },
        typeTag(t) { return { category: 'tag-red', doc: 'tag-blue', keyword: 'tag-teal' }[t] || 'tag-gray'; },
        edgeStyle(e) {
          const s = this.posMap[e.source], t = this.posMap[e.target];
          if (!s || !t) return { display: 'none' };
          let stroke = '#C9D6E4', width = 1, opacity = 0.9;
          if (s.type === 'category') { stroke = s.color; opacity = 0.4; }
          if (this.hoverId) {
            if (e.source === this.hoverId || e.target === this.hoverId) { stroke = '#246BFD'; width = 1.8; opacity = 1; }
            else opacity = 0.12;
          }
          if (this.typeFilter) {
            const touches = s.type === this.typeFilter || t.type === this.typeFilter;
            if (!touches) opacity = Math.min(opacity, 0.1);
          }
          const kw = this.searchKw.trim();
          if (kw) {
            const hit = s.label.indexOf(kw) >= 0 || t.label.indexOf(kw) >= 0;
            opacity = hit ? 0.95 : Math.min(opacity, 0.12);
          }
          return { stroke, strokeWidth: width, opacity };
        },
        nodeOpacity(n) {
          if (this.typeFilter && n.type !== this.typeFilter) return 0.15;
          const kw = this.searchKw.trim();
          if (kw && n.label.indexOf(kw) < 0) return 0.15;
          return 1;
        },
        showLabel(n) {
          return n.type === 'category' || this.hoverId === n.id || this.selId === n.id;
        },
        onNodeDown(n, e) {
          e.preventDefault();
          this.drag = { node: n, moved: false };
          window.addEventListener('pointermove', this.onNodeMove);
          window.addEventListener('pointerup', this.onNodeUp);
        },
        onNodeMove(e) {
          if (!this.drag) return;
          const svg = this.$refs.svg;
          if (!svg) return;
          const pt = svg.createSVGPoint();
          pt.x = e.clientX; pt.y = e.clientY;
          const ctm = svg.getScreenCTM();
          if (!ctm) return;
          const loc = pt.matrixTransform(ctm.inverse());
          this.drag.moved = true;
          this.drag.node.x = Math.max(20, Math.min(VB_W - 20, loc.x));
          this.drag.node.y = Math.max(16, Math.min(VB_H - 16, loc.y));
        },
        onNodeUp() {
          window.removeEventListener('pointermove', this.onNodeMove);
          window.removeEventListener('pointerup', this.onNodeUp);
          this.drag = null;
        },
        pick(n) { this.selId = n.id; },
        zoomIn() { this.zoom = Math.min(1.8, +(this.zoom + 0.15).toFixed(2)); },
        zoomOut() { this.zoom = Math.max(0.7, +(this.zoom - 0.15).toFixed(2)); },
        zoomReset() { this.zoom = 1; },
        async openDoc() {
          if (!this.selNode || this.selNode.type !== 'doc') return;
          const docId = this.selNode.id.replace(/^doc:/, '');
          this.detail = { show: true, loading: true, doc: null };
          try {
            const d = await api.get('/api/knowledge/documents/' + docId);
            this.detail.doc = d;
          } catch (e) { this.detail.show = false; }
          this.detail.loading = false;
        },
        closeDetail() { this.detail.show = false; },
        resetView() {
          this.selId = ''; this.hoverId = ''; this.typeFilter = ''; this.searchKw = ''; this.zoom = 1;
        },
      },
      template: `
      <div v-if="!loading">
        <div class="kbgraph-layout">
          <!-- left: entity types + stats -->
          <div>
            <div class="card" style="margin-top:0">
              <div class="card-hd"><div class="t">实体类型</div></div>
              <div class="card-bd" style="padding-top:8px">
                <div class="kg-type-row" :class="{on: !typeFilter}" @click="typeFilter = ''">
                  <span class="ico-box ico-blue" style="display:inline-flex;width:28px;height:28px;border-radius:7px;align-items:center;justify-content:center"><ic name="network" size="16"></ic></span>
                  <span class="kg-type-name">全部实体</span><b>{{ nodes.length }}</b>
                </div>
                <div class="kg-type-row" :class="{on: typeFilter === 'category'}" @click="typeFilter = 'category'">
                  <span class="ico-box ico-red" style="display:inline-flex;width:28px;height:28px;border-radius:7px;align-items:center;justify-content:center"><ic name="landmark" size="16"></ic></span>
                  <span class="kg-type-name">分类节点</span><b>{{ counts.category }}</b>
                </div>
                <div class="kg-type-row" :class="{on: typeFilter === 'doc'}" @click="typeFilter = 'doc'">
                  <span class="ico-box ico-blue" style="display:inline-flex;width:28px;height:28px;border-radius:7px;align-items:center;justify-content:center"><ic name="file-text" size="16"></ic></span>
                  <span class="kg-type-name">文档节点</span><b>{{ counts.doc }}</b>
                </div>
                <div class="kg-type-row" :class="{on: typeFilter === 'keyword'}" @click="typeFilter = 'keyword'">
                  <span class="ico-box ico-teal" style="display:inline-flex;width:28px;height:28px;border-radius:7px;align-items:center;justify-content:center"><ic name="hash" size="16"></ic></span>
                  <span class="kg-type-name">关键词节点</span><b>{{ counts.keyword }}</b>
                </div>
              </div>
            </div>
            <div class="card">
              <div class="card-hd"><div class="t">图谱统计</div></div>
              <div class="card-bd" style="padding-top:6px">
                <div class="kg-stat-row"><span>渲染节点</span><b>{{ nodes.length }}</b></div>
                <div class="kg-stat-row"><span>关系边数</span><b>{{ edges.length }}</b></div>
                <div class="kg-stat-row"><span>知识分类</span><b>{{ counts.category }}</b></div>
                <div class="kg-stat-row"><span>文档实体</span><b>{{ counts.doc }}</b></div>
                <div class="kg-stat-row"><span>关键词</span><b>{{ counts.keyword }}</b></div>
                <div class="kg-stat-row"><span>最近更新</span><b style="font-size:11.5px">{{ loadTime || '—' }}</b></div>
                <div v-if="sampled" class="kg-sample-tip">
                  <ic name="info" size="12"></ic> 全图 {{ rawTotal }} 节点，已按连接度抽样渲染 {{ nodes.length }} 个以防卡顿。
                </div>
              </div>
            </div>
          </div>

          <!-- center: graph svg -->
          <div class="card" style="margin-top:0; display:flex; flex-direction:column">
            <div class="card-hd" style="flex-wrap:wrap; gap:8px">
              <div class="t">
                <span class="kg-legend-item" v-for="c in legendCats" :key="c"><i :style="{background: {'政策法规':'#E5484D','制度规程':'#246BFD','讲话汇编':'#F59E0B','成果档案':'#13A89E'}[c]}"></i>{{ c }}</span>
                <span class="kg-legend-item"><i :style="{background:'#fff', border:'2px solid #246BFD'}"></i>文档</span>
                <span class="kg-legend-item"><i :style="{background:'#64809C'}"></i>关键词</span>
              </div>
              <div style="display:flex; align-items:center; gap:8px; margin-left:auto">
                <div class="kg-search">
                  <ic name="search" size="14"></ic>
                  <input v-model="searchKw" placeholder="定位实体 / 关键词">
                  <span v-if="searchKw" class="kg-search-clear" @click="searchKw = ''"><ic name="x" size="12"></ic></span>
                </div>
                <button class="btn btn-ghost btn-sm" @click="resetView">重置视图</button>
                <span class="kg-zoom">
                  <button @click="zoomOut"><ic name="minus" size="13"></ic></button>
                  <b>{{ Math.round(zoom * 100) }}%</b>
                  <button @click="zoomIn"><ic name="plus" size="13"></ic></button>
                </span>
              </div>
            </div>
            <div class="kg-canvas" style="flex:1">
              <div v-if="error" class="empty" style="padding-top:180px">知识图谱加载失败，请稍后重试</div>
              <div v-else-if="!nodes.length" class="empty" style="padding-top:180px">暂无图谱数据，请先在「知识文档」中入库文档</div>
              <svg v-else ref="svg" :viewBox="viewBox" class="kg-svg" @pointerleave="hoverId = ''">
                <line v-for="(e, i) in edges" :key="'e' + i"
                      :x1="posMap[e.source] ? posMap[e.source].x : 0" :y1="posMap[e.source] ? posMap[e.source].y : 0"
                      :x2="posMap[e.target] ? posMap[e.target].x : 0" :y2="posMap[e.target] ? posMap[e.target].y : 0"
                      :style="edgeStyle(e)" stroke-linecap="round"></line>
                <g v-for="n in nodes" :key="n.id"
                   :transform="'translate(' + n.x + ' ' + n.y + ')'"
                   :opacity="nodeOpacity(n)"
                   style="cursor: grab"
                   @pointerdown="onNodeDown(n, $event)"
                   @pointerenter="hoverId = n.id"
                   @click="pick(n)">
                  <circle r="26" fill="transparent"></circle>
                  <template v-if="n.type === 'category'">
                    <circle r="20" :fill="n.color"></circle>
                    <circle r="20" fill="none" :stroke="n.color" stroke-opacity=".25" stroke-width="7"></circle>
                    <text text-anchor="middle" dy="4.5" fill="#fff" font-size="13" font-weight="700" style="pointer-events:none">{{ n.label.slice(0, 1) }}</text>
                    <text text-anchor="middle" y="38" fill="#102A43" font-size="12.5" font-weight="600" style="pointer-events:none">{{ n.label }}</text>
                  </template>
                  <template v-else-if="n.type === 'doc'">
                    <circle r="9" fill="#fff" stroke="#246BFD" :stroke-width="hoverId === n.id || selId === n.id ? 3 : 2"></circle>
                    <circle r="3.4" fill="#246BFD" style="pointer-events:none"></circle>
                  </template>
                  <template v-else>
                    <circle r="6" fill="#64809C" :stroke="hoverId === n.id || selId === n.id ? '#246BFD' : '#fff'" stroke-width="2"></circle>
                  </template>
                  <text v-if="showLabel(n) && n.type !== 'category'" text-anchor="middle" :y="n.type === 'doc' ? 24 : 19"
                        fill="#102A43" font-size="11" style="pointer-events:none; paint-order: stroke; stroke:#fff; stroke-width:3px">
                    {{ n.label.length > 14 ? n.label.slice(0, 13) + '…' : n.label }}
                  </text>
                  <title>{{ n.label }}（{{ typeLabel(n.type) }}，{{ n.deg }} 条关联）</title>
                </g>
              </svg>
            </div>
          </div>

          <!-- right: node detail -->
          <div class="card" style="margin-top:0">
            <div class="card-hd">
              <div class="t">节点详情</div>
              <span v-if="selNode" :class="['tag', typeTag(selNode.type)]">{{ typeLabel(selNode.type) }}</span>
            </div>
            <div class="card-bd">
              <div v-if="!selNode" class="empty" style="padding:36px 0">
                <ic name="circle-help" size="22"></ic>
                <div style="margin-top:6px">点击图中节点查看详情<br><span style="font-size:11.5px">节点可拖拽，悬停显示名称</span></div>
              </div>
              <template v-else>
                <div style="display:flex; gap:10px; align-items:center">
                  <span class="kg-sel-ico" :style="{background: selNode.type === 'category' ? selNode.color : selNode.type === 'doc' ? 'var(--primary-weak)' : '#EEF2F7', color: selNode.type === 'category' ? '#fff' : selNode.type === 'doc' ? 'var(--primary)' : 'var(--text-2)'}">
                    <ic :name="selNode.type === 'category' ? 'layers' : selNode.type === 'doc' ? 'file-text' : 'hash'" size="18"></ic>
                  </span>
                  <div style="min-width:0">
                    <div class="strong" style="font-size:14px; word-break:break-all">{{ selNode.label }}</div>
                    <div class="muted" style="font-size:12px; margin-top:1px">{{ typeLabel(selNode.type) }} · {{ selNode.deg }} 条关联</div>
                  </div>
                </div>
                <button v-if="selNode.type === 'doc'" class="btn btn-primary btn-sm mt12" style="width:100%; justify-content:center" @click="openDoc">
                  <ic name="eye" size="14"></ic> 查看文档详情
                </button>
                <div class="kg-link-hd">关联节点</div>
                <div v-if="!selLinks.length" class="muted" style="font-size:12px">暂无关联节点</div>
                <div v-for="l in selLinks" :key="l.id" class="kg-link-row" @click="pick(l)">
                  <i :style="{background: l.type === 'category' ? l.color : l.type === 'doc' ? '#246BFD' : '#64809C'}"></i>
                  <span class="ellipsis" :title="l.label">{{ l.label }}</span>
                  <span class="muted" style="font-size:11px; flex:none">{{ typeLabel(l.type) }}</span>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="empty" style="padding-top:120px">加载中…</div>

      <!-- doc detail modal -->
      <Modal title="知识文档详情" width="680px" v-if="detail.show" @close="closeDetail">
        <div v-if="detail.loading" class="empty" style="padding:30px 0">加载中…</div>
        <template v-else-if="detail.doc">
          <div class="strong" style="font-size:15px">{{ detail.doc.title }}</div>
          <div style="margin-top:4px"><span :class="['tag', {'政策法规':'tag-red','制度规程':'tag-blue','讲话汇编':'tag-amber','成果档案':'tag-teal'}[detail.doc.category] || 'tag-gray']">{{ detail.doc.category }}</span></div>
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
