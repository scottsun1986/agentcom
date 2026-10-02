/* /system/role 角色与数据权限 — pixel replica of design/mockups/070-system-role.png
   Layout: (角色列表 | 角色信息+数据范围卡片+自定义部门 | 菜单与按钮权限树) master-detail 3 columns */
AppPages['/system/role'] = {
  route: '/system/role', title: '角色与数据权限', category: 'SYSTEM', primaryAction: '新建角色', icon: 'shield-check',
  subtitle: '管理系统角色，配置数据范围与功能权限，控制不同角色在各业务模块的访问范围和操作能力。',
  component: {
    data() {
      return {
        loading: true,
        roles: [], roleKw: '', rolePage: 1, rolePageSize: 10,
        selId: null, mode: 'create', saving: false,
        form: { role_name: '', role_key: '', role_sort: 1, data_scope: '5', status: '0' },
        checkedMenus: [],
        deptTree: [], checkedDepts: [], deptKw: '', deptExpanded: {},
        menuTree: [], menuMap: {}, menuKw: '', menuExpanded: {},
        scopes: [
          { v: '1', name: '全部数据', desc: '可查看和操作全系统所有数据', icon: 'database' },
          { v: '2', name: '自定义部门', desc: '按所选部门范围查看和操作数据', icon: 'network' },
          { v: '3', name: '本部门及以下', desc: '本部门及所有下级部门数据', icon: 'git-branch' },
          { v: '4', name: '本部门', desc: '仅查看和操作本人所在部门数据', icon: 'building' },
          { v: '5', name: '仅本人', desc: '仅查看和操作本人创建的数据', icon: 'user' },
        ],
      };
    },
    computed: {
      filteredRoles() {
        const kw = (this.roleKw || '').trim().toLowerCase();
        if (!kw) return this.roles;
        return this.roles.filter((r) => (r.role_name || '').toLowerCase().includes(kw) || (r.role_key || '').toLowerCase().includes(kw));
      },
      roleTotal() { return this.filteredRoles.length; },
      rolePageCount() { return Math.max(1, Math.ceil(this.roleTotal / this.rolePageSize)); },
      pagedRoles() { return this.filteredRoles.slice((this.rolePage - 1) * this.rolePageSize, this.rolePage * this.rolePageSize); },
      selRole() { return this.roles.find((r) => r.role_id === this.selId) || null; },
      scopeNote() {
        return {
          '1': '该角色可查看并操作平台内全部业务数据，仅建议授予系统管理员等超级角色。',
          '2': '按下方勾选的部门范围过滤数据，仅在数据范围选择"自定义部门"时生效。',
          '3': '可查看本部门及全部下级部门的数据，适合部门负责人使用。',
          '4': '仅可查看本部门内部数据，不含下级部门。',
          '5': '仅可查看和操作自己创建的数据，适合普通员工。',
        }[this.form.data_scope] || '';
      },
      checkedDeptChips() {
        const out = [];
        const walk = (nodes, path) => nodes.forEach((n) => {
          const p = path ? path + ' / ' + n.dept_name : n.dept_name;
          if (this.checkedDepts.includes(n.dept_id)) out.push({ id: n.dept_id, path: p });
          if (n.children && n.children.length) walk(n.children, p);
        });
        walk(this.deptTree, '');
        return out;
      },
      menuRows() {
        const kw = (this.menuKw || '').trim().toLowerCase();
        const walk = (nodes, depth) => {
          const out = [];
          nodes.forEach((n) => {
            const kids = n.children || [];
            const selfHit = !kw || [n.menu_name, n.path, n.perms].some((x) => (x || '').toLowerCase().includes(kw));
            const kidRows = walk(kids, depth + 1);
            if (!selfHit && !kidRows.length) return;
            const open = kw ? true : !!this.menuExpanded[n.menu_id];
            out.push({ id: n.menu_id, name: n.menu_name, type: n.menu_type, perms: n.perms, depth, open, hasKids: kids.length > 0 });
            if (open && kidRows.length) out.push(...kidRows);
          });
          return out;
        };
        return walk(this.menuTree, 0);
      },
      menuCheckedCount() { return this.checkedMenus.length; },
    },
    async mounted() {
      try {
        const [rs, ms, ds] = await Promise.all([
          api.page('/api/system/roles', { pageNum: 1, pageSize: 100 }), api.get('/api/system/menus'), api.get('/api/system/depts'),
        ]);
        this.roles = rs.rows || [];
        this.menuTree = ms || [];
        this.deptTree = ds || [];
        const map = {};
        const idx = (nodes) => nodes.forEach((n) => { map[n.menu_id] = n; if (n.children && n.children.length) idx(n.children); });
        idx(this.menuTree);
        this.menuMap = map;
        Object.keys(map).forEach((id) => { if (!map[id].parent_id) this.menuExpanded[id] = true; });
        this.deptTree.forEach((d) => { this.deptExpanded[d.dept_id] = true; });
        if (this.roles.length) this.selectRole(this.roles[0]);
      } catch (e) { /* empty state */ }
      this.loading = false;
    },
    methods: {
      statusTag(s) { return s === '0' ? 'tag-green' : 'tag-gray'; },
      statusLabel(s) { return s === '0' ? '启用' : '停用'; },
      typeLabel(t) { return { M: '目录', C: '菜单', F: '按钮' }[t] || t; },
      typeTag(t) { return { M: 'tag-blue', C: 'tag-teal', F: 'tag-gray' }[t] || 'tag-gray'; },
      selectRole(r) {
        this.selId = r.role_id;
        this.mode = 'edit';
        this.form = { role_name: r.role_name, role_key: r.role_key, role_sort: r.role_sort, data_scope: r.data_scope || '5', status: r.status };
        this.checkedMenus = [];
        this.checkedDepts = [];
      },
      openCreate() {
        this.mode = 'create';
        this.selId = null;
        this.form = { role_name: '', role_key: '', role_sort: (this.roles.length || 0) + 1, data_scope: '5', status: '0' };
        this.checkedMenus = [];
        this.checkedDepts = [];
      },
      setScope(v) { this.form.data_scope = v; },
      descendants(id) {
        const out = [];
        const walk = (n) => { out.push(n.menu_id); (n.children || []).forEach(walk); };
        const root = this.menuMap[id];
        if (root) walk(root);
        return out;
      },
      ancestorsOf(id) {
        const out = [];
        let cur = this.menuMap[id];
        while (cur && cur.parent_id && this.menuMap[cur.parent_id]) { out.push(cur.parent_id); cur = this.menuMap[cur.parent_id]; }
        return out;
      },
      toggleMenu(id) {
        const ids = this.descendants(id);
        const set = new Set(this.checkedMenus);
        if (set.has(id)) ids.forEach((x) => set.delete(x));
        else ids.forEach((x) => set.add(x));
        this.checkedMenus = [...set];
      },
      toggleDeptNode(id) {
        const set = new Set(this.checkedDepts);
        const node = this.findDept(this.deptTree, id);
        const ids = [];
        const walk = (n) => { ids.push(n.dept_id); (n.children || []).forEach(walk); };
        if (node) walk(node);
        if (set.has(id)) ids.forEach((x) => set.delete(x));
        else ids.forEach((x) => set.add(x));
        this.checkedDepts = [...set];
      },
      findDept(nodes, id) {
        for (const n of nodes) { if (n.dept_id === id) return n; const f = n.children && n.children.length ? this.findDept(n.children, id) : null; if (f) return f; }
        return null;
      },
      clearDepts() { this.checkedDepts = []; },
      deptFlat() {
        const out = [];
        const walk = (nodes, depth) => nodes.forEach((n) => { out.push({ id: n.dept_id, name: '　'.repeat(depth) + n.dept_name, depth }); if (n.children && n.children.length) walk(n.children, depth + 1); });
        walk(this.deptTree, 0);
        return out;
      },
      async saveRole() {
        const f = this.form;
        if (!f.role_name.trim()) return this.$root.toast('请填写角色名称', 'warn');
        if (!f.role_key.trim()) return this.$root.toast('请填写角色编码 (roleKey)', 'warn');
        this.saving = true;
        try {
          const menuIds = new Set(this.checkedMenus);
          this.checkedMenus.forEach((id) => this.ancestorsOf(id).forEach((a) => menuIds.add(a)));
          const body = {
            role_name: f.role_name.trim(), role_key: f.role_key.trim(), role_sort: Number(f.role_sort) || 0,
            data_scope: f.data_scope, status: f.status,
            menu_ids: [...menuIds], dept_ids: f.data_scope === '2' ? this.checkedDepts : [],
          };
          if (this.mode === 'create') {
            const d = await api.post('/api/system/roles', body);
            this.$root.toast('角色创建成功', 'ok');
            await this.reload();
            if (d && d.role_id) { const r = this.roles.find((x) => x.role_id === d.role_id); if (r) this.selectRole(r); }
          } else {
            await api.put('/api/system/roles/' + this.selId, body);
            this.$root.toast('角色权限配置已保存', 'ok');
            await this.reload();
            const r = this.roles.find((x) => x.role_id === this.selId);
            if (r) { this.form = { role_name: r.role_name, role_key: r.role_key, role_sort: r.role_sort, data_scope: r.data_scope || '5', status: r.status }; }
          }
        } catch (e) { /* toast shown */ }
        this.saving = false;
      },
      async removeRole() {
        if (!this.selRole) return;
        if (this.selRole.role_key === 'admin') return this.$root.toast('内置管理员角色不允许删除', 'warn');
        if (!window.confirm('确认删除角色「' + this.selRole.role_name + '」？')) return;
        try {
          await api.del('/api/system/roles/' + this.selId);
          this.$root.toast('角色已删除', 'ok');
          this.selId = null; this.mode = 'create';
          await this.reload();
          this.openCreate();
        } catch (e) { /* toast shown */ }
      },
      async reload() {
        try {
          const rs = await api.page('/api/system/roles', { pageNum: 1, pageSize: 100 });
          this.roles = rs.rows || [];
        } catch (e) { /* keep */ }
      },
      goRolePage(p) { if (p >= 1 && p <= this.rolePageCount) this.rolePage = p; },
      onPrimary() { this.openCreate(); },
    },
    template: `
    <div v-if="!loading">
      <div class="role-layout">
        <!-- role list -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">角色列表</div></div>
          <div class="card-bd">
            <div class="sys-tree-search">
              <ic name="search" size="14"></ic>
              <input class="input" placeholder="搜索角色名称或编码" v-model="roleKw">
            </div>
            <div class="role-list">
              <div v-for="r in pagedRoles" :key="r.role_id" class="role-item" :class="{on: selId === r.role_id}" @click="selectRole(r)">
                <ic name="shield-check" size="15"></ic>
                <span class="strong" style="font-size:13px">{{ r.role_name }}</span>
                <span class="rk">{{ r.role_key }}</span>
                <span :class="['tag', statusTag(r.status)]" style="margin-left:auto">{{ statusLabel(r.status) }}</span>
              </div>
              <div v-if="!pagedRoles.length" class="empty">暂无匹配角色</div>
            </div>
            <div class="pager" style="justify-content:center" v-if="rolePageCount > 1">
              <button class="pg" :disabled="rolePage <= 1" @click="goRolePage(rolePage - 1)"><ic name="chevron-left" size="13"></ic></button>
              <button v-for="p in rolePageCount" :key="p" class="pg" :class="{on: p === rolePage}" @click="goRolePage(p)">{{ p }}</button>
              <button class="pg" :disabled="rolePage >= rolePageCount" @click="goRolePage(rolePage + 1)"><ic name="chevron-right" size="13"></ic></button>
            </div>
          </div>
        </div>

        <!-- role info -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">角色信息 <span class="tag" :class="mode === 'create' ? 'tag-blue' : 'tag-gray'">{{ mode === 'create' ? '新建角色' : '编辑角色' }}</span></div>
          </div>
          <div class="card-bd">
            <div class="form-grid-2">
              <div class="form-item"><label class="req">角色名称</label>
                <input class="input" placeholder="如：部门负责人" v-model="form.role_name"></div>
              <div class="form-item"><label class="req">角色编码 (roleKey)</label>
                <input class="input" placeholder="如：dept_leader" v-model="form.role_key"></div>
              <div class="form-item"><label>角色排序</label>
                <input class="input" type="number" v-model="form.role_sort"></div>
              <div class="form-item"><label>状态</label>
                <div style="flex:1; display:flex; gap:18px; padding-top:8px">
                  <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" class="ck" value="0" v-model="form.status">启用</label>
                  <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" class="ck" value="1" v-model="form.status">停用</label>
                </div></div>
            </div>

            <div class="sec-title"><ic name="shield" size="15"></ic>数据范围权限</div>
            <div class="scope-cards">
              <div v-for="s in scopes" :key="s.v" class="scope-card" :class="{on: form.data_scope === s.v}" @click="setScope(s.v)">
                <div class="sc-ico"><ic :name="s.icon" size="18"></ic></div>
                <b>{{ s.name }}</b><span>{{ s.desc }}</span>
              </div>
            </div>
            <div class="cfg-help" style="margin-top:8px"><ic name="info" size="13"></ic> {{ scopeNote }}</div>

            <div v-if="form.data_scope === '2'" class="dept-pick-wrap">
              <div class="sec-title">自定义部门范围 <span class="muted" style="font-weight:400;font-size:12px">（仅在"自定义部门"时生效）</span></div>
              <div class="dept-pick-split">
                <div class="dept-pick-box">
                  <div class="sys-tree-search" style="margin-bottom:6px">
                    <ic name="search" size="14"></ic>
                    <input class="input" placeholder="搜索部门名称" v-model="deptKw">
                  </div>
                  <div class="tree-panel" style="max-height:200px">
                    <div v-for="d in deptFlat()" :key="d.id" class="ck-row" :style="{paddingLeft: (6 + d.depth * 16) + 'px'}">
                      <input type="checkbox" class="ck" :checked="checkedDepts.includes(d.id)" @change="toggleDeptNode(d.id)">
                      <span>{{ d.name }}</span>
                    </div>
                  </div>
                </div>
                <div class="dept-pick-box">
                  <div class="scan-hd">已选择的部门 ({{ checkedDeptChips.length }}) <a style="float:right; cursor:pointer; color:var(--primary); font-weight:400" @click="clearDepts">清空</a></div>
                  <div style="max-height:200px; overflow-y:auto">
                    <span v-for="c in checkedDeptChips" :key="c.id" class="sel-chip">{{ c.path }}<ic name="x" size="12" @click="checkedDepts = checkedDepts.filter(x => x !== c.id)"></ic></span>
                    <div v-if="!checkedDeptChips.length" class="empty" style="padding:20px 0">尚未选择部门</div>
                  </div>
                </div>
              </div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px">
              <button v-if="mode === 'edit' && selRole && selRole.role_key !== 'admin'" class="btn btn-ghost btn-reject" @click="removeRole"><ic name="trash" size="14"></ic>删除角色</button>
              <span style="flex:1"></span>
              <button class="btn btn-ghost" @click="mode === 'edit' && selRole ? selectRole(selRole) : openCreate()">取消</button>
              <button class="btn btn-primary" :disabled="saving" @click="saveRole"><ic name="save" size="14"></ic>{{ mode === 'create' ? '创建角色' : '保存角色配置' }}</button>
            </div>
          </div>
        </div>

        <!-- menu perms -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">菜单与按钮权限</div>
            <span class="more" title="勾选后随角色一并保存"><ic name="info" size="13"></ic> 权限配置说明</span>
          </div>
          <div class="card-bd">
            <div class="sys-tree-search">
              <ic name="search" size="14"></ic>
              <input class="input" placeholder="搜索菜单或功能" v-model="menuKw">
            </div>
            <div class="menu-check-tree">
              <div v-for="m in menuRows" :key="m.id" class="ck-row" :style="{paddingLeft: (6 + m.depth * 18) + 'px'}">
                <span class="tw" v-if="m.hasKids" @click="menuExpanded[m.id] ? delete menuExpanded[m.id] : menuExpanded[m.id] = true">
                  <ic :name="m.open ? 'chevron-down' : 'chevron-right'" size="13"></ic>
                </span>
                <span class="tw" v-else></span>
                <input type="checkbox" class="ck" :checked="checkedMenus.includes(m.id)" @change="toggleMenu(m.id)">
                <span :style="m.type === 'M' ? 'font-weight:600' : ''">{{ m.name }}</span>
                <span :class="['tag', typeTag(m.type)]" style="margin-left:auto">{{ typeLabel(m.type) }}</span>
              </div>
            </div>
            <div class="muted" style="font-size:12px; margin-top:8px">已勾选 {{ menuCheckedCount }} 项 · 勾选父级将自动包含全部子级</div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
