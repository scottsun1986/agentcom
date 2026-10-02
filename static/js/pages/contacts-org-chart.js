/* /contacts/org-chart 组织架构全景树 — pixel replica of design/mockups/041-contacts-org-chart.png
   Layout: stats KPI row + (org tree card with collapsible dept cards, CSS connector lines) */
(function () {
  const OrgNode = {
    name: 'OrgNode',
    props: { node: Object, depth: { type: Number, default: 0 }, expanded: Object, forceOpen: Boolean },
    emits: ['toggle'],
    computed: {
      open() { return this.forceOpen || !!this.expanded[this.node.dept_id]; },
      hasChildren() { return !!(this.node.children && this.node.children.length); },
    },
    template: `
    <div class="oc-item">
      <div :class="['oc-card', depth === 0 ? 'root' : '']">
        <span class="oc-toggle" v-if="hasChildren" @click="$emit('toggle', node)">
          <ic :name="open ? 'chevron-down' : 'chevron-right'" size="14"></ic>
        </span>
        <span class="oc-toggle none" v-else></span>
        <span :class="['ico-box', depth === 0 ? 'ico-blue' : 'ico-teal']" style="width:32px;height:32px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;flex:none">
          <ic :name="depth === 0 ? 'landmark' : 'building-2'" size="17"></ic>
        </span>
        <div class="oc-main">
          <div class="oc-name">{{ node.dept_name }} <span class="oc-cnt">({{ node.user_count }})</span></div>
          <div class="oc-meta">
            <span><ic name="user" size="12"></ic> {{ node.leader || '负责人未配置' }}</span>
            <span><ic name="phone" size="12"></ic> {{ node.phone || '—' }}</span>
          </div>
        </div>
        <div class="oc-nums">
          <span>直属 <b>{{ node.member_count }}</b> 人</span>
          <span>在编 <b>{{ node.user_count }}</b> 人</span>
        </div>
      </div>
      <div class="oc-children" v-if="open && hasChildren">
        <org-node v-for="c in node.children" :key="c.dept_id" :node="c" :depth="depth + 1"
          :expanded="expanded" :force-open="forceOpen" @toggle="$emit('toggle', $event)"></org-node>
      </div>
    </div>`,
  };

  AppPages['/contacts/org-chart'] = {
    route: '/contacts/org-chart', title: '组织架构全景树', category: 'CONTACTS', primaryAction: null, icon: 'network',
    subtitle: '展示集团/局机关组织架构，支持多级穿透查看机构编制、负责人及人员信息。',
    component: {
      components: { 'org-node': OrgNode },
      data() {
        return {
          loading: true,
          tree: [],
          expanded: {},
          keyword: '',
        };
      },
      computed: {
        allNodes() {
          const arr = [];
          const walk = (nodes) => (nodes || []).forEach((n) => { arr.push(n); walk(n.children); });
          walk(this.tree);
          return arr;
        },
        deptTotal() { return this.allNodes.length; },
        staffTotal() { return this.tree.reduce((s, r) => s + (Number(r.user_count) || 0), 0); },
        directStaff() { return this.allNodes.reduce((s, n) => s + (Number(n.member_count) || 0), 0); },
        leaderCovered() { return this.allNodes.filter((n) => n.leader).length; },
        forceOpen() { return !!this.keyword.trim(); },
        displayTree() {
          const kw = this.keyword.trim().toLowerCase();
          if (!kw) return this.tree;
          const prune = (nodes) => (nodes || [])
            .map((n) => Object.assign({}, n, { children: prune(n.children) }))
            .filter((n) => n.dept_name.toLowerCase().includes(kw) || (n.leader || '').toLowerCase().includes(kw) || n.children.length);
          return prune(this.tree);
        },
      },
      async mounted() {
        try {
          this.tree = await api.get('/api/contacts/org-tree') || [];
        } catch (e) { this.tree = []; }
        const mark = (nodes, depth) => (nodes || []).forEach((n) => {
          if (depth < 2) this.expanded[n.dept_id] = true;
          mark(n.children, depth + 1);
        });
        mark(this.tree, 0);
        this.loading = false;
      },
      methods: {
        toggle(node) { this.expanded[node.dept_id] = !this.expanded[node.dept_id]; },
        expandAll() {
          this.allNodes.forEach((n) => { if (n.children && n.children.length) this.expanded[n.dept_id] = true; });
        },
        collapseAll() {
          this.allNodes.forEach((n) => { this.expanded[n.dept_id] = false; });
        },
      },
      template: `
    <div v-if="!loading">
      <!-- stats -->
      <div class="kpi-row" style="margin-bottom:16px">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="landmark" size="28"></ic></div>
          <div class="meta"><div class="label">部门总数</div><div class="val" style="color:var(--primary)">{{ deptTotal }}</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="users" size="28"></ic></div>
          <div class="meta"><div class="label">在编总人数</div><div class="val" style="color:var(--teal)">{{ staffTotal }}</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="building-2" size="28"></ic></div>
          <div class="meta"><div class="label">直属人员合计</div><div class="val" style="color:var(--amber)">{{ directStaff }}</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="user-check" size="28"></ic></div>
          <div class="meta"><div class="label">负责人已配置</div><div class="val" style="color:var(--red)">{{ leaderCovered }}<span style="font-size:14px;font-weight:400;color:var(--text-3)"> / {{ deptTotal }}</span></div></div>
        </div>
      </div>

      <!-- tree -->
      <div class="card" style="margin-top:0">
        <div class="card-hd">
          <div class="t"><ic name="network" size="16"></ic> 组织架构树</div>
          <div style="display:flex; align-items:center; gap:10px">
            <input class="input" style="width:220px" placeholder="搜索部门名称 / 负责人" v-model="keyword">
            <button class="btn btn-ghost btn-sm" @click="expandAll"><ic name="chevrons-down" size="13"></ic>展开全部</button>
            <button class="btn btn-ghost btn-sm" @click="collapseAll"><ic name="chevrons-up" size="13"></ic>收起全部</button>
          </div>
        </div>
        <div class="card-bd" style="padding-top:12px">
          <div class="oc-tree" v-if="displayTree.length">
            <org-node v-for="r in displayTree" :key="r.dept_id" :node="r" :depth="0"
              :expanded="expanded" :force-open="forceOpen" @toggle="toggle"></org-node>
          </div>
          <div v-else class="empty">{{ keyword ? '未找到匹配的部门' : '暂无组织架构数据' }}</div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
    },
  };
})();
