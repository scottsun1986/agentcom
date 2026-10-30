/* /system/menu 菜单与按钮权限 — pixel replica of design/mockups/071-system-menu-v2.png
   Layout: 4 stat cards / (菜单树表格+筛选 | 菜单信息编辑+顶级菜单预览) */
AppPages['/system/menu'] = {
  route: '/system/menu', title: '菜单与按钮权限', category: 'SYSTEM', primaryAction: '新增菜单', icon: 'list',
  subtitle: '管理系统菜单、页面按钮及功能权限，支持按角色分配和控制，保障系统安全与规范使用。',
  component: {
    data() {
      return {
        loading: true,
        tree: [],
        kw: '', fTop: '', fType: '', fStatus: '',
        expanded: {},
        selId: null,
        editor: this.blankEditor(),
        saving: false,
        roleTotal: 0,
        catalog: (window.AppCatalog && window.AppCatalog.categories) || [],
      };
    },
    computed: {
      stats() {
        let sub = 0, btn = 0;
        const count = (nodes, depth) => nodes.forEach((n) => {
          if (depth === 1) sub++;
          if (n.menu_type === 'F') btn++;
          if (n.children && n.children.length) count(n.children, depth + 1);
        });
        count(this.tree, 0);
        return { top: this.tree.length, sub, btn, roles: this.roleTotal };
      },
      topOptions() {
        const seen = {};
        this.tree.forEach((n) => { if (n.top_category) seen[n.top_category] = true; });
        return this.catalog.filter((c) => seen[c.key]);
      },
      rows() {
        const kw = (this.kw || '').trim().toLowerCase();
        const match = (n) => {
          if (this.fType && n.menu_type !== this.fType) return false;
          if (this.fStatus && n.status !== this.fStatus) return false;
          if (!kw) return true;
          return [n.menu_name, n.path, n.perms].some((x) => (x || '').toLowerCase().includes(kw));
        };
        const walk = (nodes, depth, topCat) => {
          const out = [];
          nodes.forEach((n) => {
            if (this.fTop && topCat !== this.fTop) return;
            const kids = n.children || [];
            const selfHit = match(n);
            const kidRows = walk(kids, depth + 1, topCat);
            if (!selfHit && !kidRows.length) return;
            const open = kw || this.fType || this.fStatus ? true : !!this.expanded[n.menu_id];
            out.push({ n, depth, open, hasKids: kids.length > 0 });
            if (open && kidRows.length) out.push(...kidRows);
          });
          return out;
        };
        return walk(this.tree, 0, null);
      },
      parentOptions() {
        const out = [{ id: '', name: '顶级菜单（无上级）' }];
        const walk = (nodes, depth) => nodes.forEach((n) => {
          if (n.menu_id === this.editor.menu_id) return;
          out.push({ id: n.menu_id, name: '　'.repeat(depth) + n.menu_name + '（' + ({ M: '目录', C: '菜单', F: '按钮' }[n.menu_type] || '') + '）' });
          if (n.children && n.children.length) walk(n.children, depth + 1);
        });
        walk(this.tree, 0);
        return out;
      },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      blankEditor() {
        return { mode: 'create', menu_id: null, parent_id: '', top_category: 'SYSTEM', menu_name: '', menu_type: 'C', path: '', perms: '', icon: 'file-text', order_num: 1, status: '0' };
      },
      async load() {
        try {
          const [ms, rs] = await Promise.all([
            api.get('/api/system/menus'), api.page('/api/system/roles', { pageNum: 1, pageSize: 1 }),
          ]);
          this.tree = ms || [];
          this.roleTotal = rs.total || (rs.rows || []).length;
          this.tree.forEach((n) => { this.expanded[n.menu_id] = true; });
        } catch (e) { this.tree = []; }
      },
      toggle(id) { if (this.expanded[id]) delete this.expanded[id]; else this.expanded[id] = true; },
      typeLabel(t) { return { M: '目录', C: '菜单', F: '按钮' }[t] || t; },
      typeTag(t) { return { M: 'tag-blue', C: 'tag-teal', F: 'tag-gray' }[t] || 'tag-gray'; },
      typeIcon(t) { return { M: 'layers', C: 'file-text', F: 'settings' }[t] || 'file-text'; },
      statusTag(s) { return s === '0' ? 'tag-green' : 'tag-gray'; },
      statusLabel(s) { return s === '0' ? '启用' : '停用'; },
      catName(key) { const c = this.catalog.find((x) => x.key === key); return c ? c.name : key; },
      resetFilters() { this.kw = ''; this.fTop = ''; this.fType = ''; this.fStatus = ''; },
      selectRow(row) {
        const n = row.n;
        this.selId = n.menu_id;
        this.editor = {
          mode: 'edit', menu_id: n.menu_id, parent_id: n.parent_id || '', top_category: n.top_category || '',
          menu_name: n.menu_name || '', menu_type: n.menu_type || 'C', path: n.path || '', perms: n.perms || '',
          icon: n.icon || '', order_num: n.order_num || 0, status: n.status || '0',
        };
      },
      startCreate(parent) {
        this.selId = null;
        const p = parent ? { parent_id: parent.menu_id, top_category: parent.top_category, menu_type: parent.menu_type === 'C' ? 'F' : 'C' } : { parent_id: '', top_category: this.fTop || 'SYSTEM', menu_type: 'C' };
        this.editor = Object.assign(this.blankEditor(), { mode: 'create' }, p, { menu_name: '', path: '', perms: '' });
      },
      async saveMenu() {
        const e = this.editor;
        if (!e.menu_name.trim()) return this.$root.toast('请填写菜单名称', 'warn');
        if (!e.top_category) return this.$root.toast('请选择所属顶级菜单', 'warn');
        this.saving = true;
        try {
          const body = {
            menu_name: e.menu_name.trim(), parent_id: e.parent_id || null, top_category: e.top_category,
            order_num: Number(e.order_num) || 0, path: e.path || null, component: null,
            menu_type: e.menu_type, perms: e.perms || null, icon: e.icon || null, visible: '0', status: e.status,
          };
          if (e.mode === 'create') {
            await api.post('/api/system/menus', body);
            this.$root.toast('菜单创建成功', 'ok');
          } else {
            await api.put('/api/system/menus/' + e.menu_id, body);
            this.$root.toast('菜单已更新', 'ok');
          }
          await this.load();
        } catch (e2) { /* toast shown */ }
        this.saving = false;
      },
      async removeMenu(n) {
        if (!window.confirm('确认删除菜单「' + n.menu_name + '」？存在子菜单时将无法删除。')) return;
        try { await api.del('/api/system/menus/' + n.menu_id); this.$root.toast('删除成功', 'ok'); if (this.selId === n.menu_id) this.startCreate(null); await this.load(); } catch (e) { /* toast shown */ }
      },
      _countNodes(nodes) { return (nodes || []).reduce((s, n) => s + 1 + this._countNodes(n.children || []), 0); },
      _download(tree, name) {
        const blob = new Blob([JSON.stringify(tree, null, 2)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name + '-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click(); URL.revokeObjectURL(a.href);
      },
      async exportMenus() {
        try {
          const rows = await api.get('/api/system/menus');
          this._download(rows, 'menus');
          this.$root.toast('已导出 ' + this._countNodes(rows) + ' 条菜单', 'ok');
        } catch (e) { /* toast shown */ }
      },
      async importMenus() {
        const inp = document.createElement('input');
        inp.type = 'file'; inp.accept = '.json,application/json';
        inp.onchange = async () => {
          const file = inp.files && inp.files[0];
          if (!file) return;
          let tree;
          try { tree = JSON.parse(await file.text()); } catch (e) { return this.$root.toast('文件解析失败，请选择导出的 JSON 文件', 'err'); }
          if (!Array.isArray(tree)) return this.$root.toast('文件格式不正确（应为导出的菜单树）', 'err');
          if (!window.confirm('导入将按「同名同父更新、其余新建」合并 ' + this._countNodes(tree) + ' 条菜单，继续？')) return;
          const current = await api.get('/api/system/menus');
          const idMap = {};
          let created = 0, updated = 0, failed = 0;
          const findBy = (nodes, pid, name) => {
            for (const n of nodes) {
              if (n.menu_name === name && (n.parent_id || null) === (pid || null)) return n;
              const hit = findBy(n.children || [], pid, name);
              if (hit) return hit;
            }
            return null;
          };
          const insertCurrent = (node) => {
            if (node.parent_id) {
              const findId = (nodes) => {
                for (const n of nodes) { if (n.menu_id === node.parent_id) return n; const hit = findId(n.children || []); if (hit) return hit; }
                return null;
              };
              const p = findId(current);
              if (p) { p.children = p.children || []; p.children.push(node); return; }
            }
            current.push(node);
          };
          const walk = async (nodes, parentOld) => {
            for (const n of nodes) {
              const pid = parentOld ? (idMap[parentOld] || null) : null;
              const body = { menu_name: n.menu_name, parent_id: pid, top_category: n.top_category,
                             order_num: n.order_num, path: n.path, component: n.component,
                             menu_type: n.menu_type, perms: n.perms, icon: n.icon,
                             visible: n.visible, status: n.status };
              try {
                const dup = findBy(current, pid, n.menu_name);
                if (dup) {
                  await api.put('/api/system/menus/' + dup.menu_id, body);
                  updated++; idMap[n.menu_id] = dup.menu_id;
                } else {
                  const d = await api.post('/api/system/menus', body);
                  created++; idMap[n.menu_id] = d.menu_id;
                  insertCurrent({ menu_id: d.menu_id, menu_name: n.menu_name, parent_id: pid, children: [] });
                }
                await walk(n.children || [], n.menu_id);
              } catch (e) { failed++; }
            }
          };
          await walk(tree, null);
          await this.load();
          this.$root.toast('导入完成：新建 ' + created + '、更新 ' + updated + (failed ? '、失败 ' + failed : ''), failed ? 'warn' : 'ok');
        };
        inp.click();
      },
      onPrimary() { this.startCreate(null); },
    },
    template: `
    <div v-if="!loading">
      <!-- stat cards -->
      <div class="kpi-row">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="layers" size="28"></ic></div>
          <div class="meta"><div class="label">顶级菜单</div><div class="val" style="color:var(--primary)">{{ stats.top }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">个</span></div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="calendar-days" size="28"></ic></div>
          <div class="meta"><div class="label">二级菜单</div><div class="val" style="color:var(--teal)">{{ stats.sub }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">个</span></div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="settings" size="28"></ic></div>
          <div class="meta"><div class="label">页面按钮</div><div class="val" style="color:var(--amber)">{{ stats.btn }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">个</span></div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="shield-check" size="28"></ic></div>
          <div class="meta"><div class="label">已分配角色</div><div class="val" style="color:var(--red)">{{ stats.roles }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">个</span></div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="menu-layout">
        <!-- tree table -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="lr-tabs" style="margin:0">
              <span class="lr-tab on" style="font-size:14px; padding-bottom:10px">菜单权限配置</span>
            </div>
            <div style="display:flex; gap:8px">
              <button class="btn btn-ghost btn-sm" @click="importMenus"><ic name="download" size="14"></ic>导入</button>
              <button class="btn btn-ghost btn-sm" @click="exportMenus"><ic name="upload" size="14"></ic>导出</button>
            </div>
          </div>
          <div class="card-bd">
            <div class="filters" style="margin-bottom:10px">
              <input class="input" style="flex:1; min-width:170px" placeholder="请输入菜单名称、权限编码或路由进行搜索" v-model="kw">
              <select class="select" style="width:150px" v-model="fTop">
                <option value="">所属顶级菜单全部</option>
                <option v-for="c in topOptions" :key="c.key" :value="c.key">{{ c.name }}</option>
              </select>
              <select class="select" style="width:110px" v-model="fType">
                <option value="">菜单类型全部</option>
                <option value="M">目录</option><option value="C">菜单</option><option value="F">按钮</option>
              </select>
              <select class="select" style="width:96px" v-model="fStatus">
                <option value="">状态全部</option>
                <option value="0">启用</option><option value="1">停用</option>
              </select>
              <button class="btn btn-ghost btn-sm" @click="resetFilters"><ic name="rotate-cw" size="13"></ic>重置</button>
            </div>
            <table class="table">
              <thead><tr><th>菜单名称</th><th style="width:64px">类型</th><th>路由地址</th><th>权限编码</th><th style="width:74px">状态</th><th style="width:130px">操作</th></tr></thead>
              <tbody>
                <tr v-for="r in rows" :key="r.n.menu_id" :class="{sel: selId === r.n.menu_id}" style="cursor:pointer" @click="selectRow(r)">
                  <td :style="{paddingLeft: (12 + r.depth * 20) + 'px'}">
                    <span class="tw" v-if="r.hasKids" style="display:inline-flex;vertical-align:-3px;margin-right:4px;color:var(--text-3)" @click.stop="toggle(r.n.menu_id)">
                      <ic :name="r.open ? 'chevron-down' : 'chevron-right'" size="13"></ic>
                    </span>
                    <span class="tw" v-else style="display:inline-block;width:17px"></span>
                    <ic :name="typeIcon(r.n.menu_type)" size="14" style="color:var(--primary); vertical-align:-2px; margin-right:4px"></ic>
                    <span :class="r.n.menu_type === 'M' ? 'strong' : ''">{{ r.n.menu_name }}</span>
                  </td>
                  <td><span :class="['tag', typeTag(r.n.menu_type)]">{{ typeLabel(r.n.menu_type) }}</span></td>
                  <td class="mono muted">{{ r.n.path || '-' }}</td>
                  <td class="mono muted">{{ r.n.perms || '-' }}</td>
                  <td><span :class="['tag', statusTag(r.n.status)]">{{ statusLabel(r.n.status) }}</span></td>
                  <td class="actions" @click.stop>
                    <button class="btn btn-text btn-sm" @click="selectRow(r)">编辑</button>
                    <button v-if="r.n.menu_type !== 'F'" class="btn btn-text btn-sm" @click="startCreate(r.n)">新增</button>
                    <button class="btn btn-text btn-sm danger" @click="removeMenu(r.n)">删除</button>
                  </td>
                </tr>
                <tr v-if="!rows.length"><td colspan="6"><div class="empty">暂无菜单数据</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- editor -->
        <div>
          <div class="card" style="margin-top:0">
            <div class="card-hd">
              <div class="t">菜单信息{{ editor.mode === 'create' ? '新增' : '编辑' }}</div>
              <div style="display:flex; gap:8px">
                <button class="btn btn-ghost btn-sm" @click="startCreate(null)">取消</button>
                <button class="btn btn-primary btn-sm" :disabled="saving" @click="saveMenu"><ic name="save" size="13"></ic>保存</button>
              </div>
            </div>
            <div class="card-bd">
              <div class="form-item"><label>上级菜单</label>
                <select class="select" v-model="editor.parent_id">
                  <option v-for="p in parentOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
                </select></div>
              <div class="form-item"><label class="req">菜单名称</label>
                <input class="input" placeholder="请输入菜单名称" v-model="editor.menu_name"></div>
              <div class="form-item"><label class="req">菜单类型</label>
                <div style="flex:1; display:flex; gap:18px; padding-top:8px">
                  <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" class="ck" value="M" v-model="editor.menu_type">目录 (M)</label>
                  <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" class="ck" value="C" v-model="editor.menu_type">菜单 (C)</label>
                  <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" class="ck" value="F" v-model="editor.menu_type">按钮 (F)</label>
                </div></div>
              <div class="form-item"><label>路由地址</label>
                <input class="input" placeholder="如 /system/user，目录与菜单类型填写" v-model="editor.path"></div>
              <div class="form-item"><label>权限编码</label>
                <input class="input" placeholder="如 system:user:list" v-model="editor.perms"></div>
              <div class="form-item"><label>所属大类</label>
                <select class="select" v-model="editor.top_category">
                  <option v-for="c in catalog" :key="c.key" :value="c.key">{{ c.name }}（{{ c.key }}）</option>
                </select></div>
              <div class="form-item"><label>菜单图标</label>
                <div style="flex:1; display:flex; align-items:center; gap:8px">
                  <input class="input" placeholder="图标名，如 settings" v-model="editor.icon">
                  <span class="ico-box ico-blue" style="width:34px;height:34px;border-radius:8px;display:inline-flex;align-items:center;justify-content:center;flex:none"><ic :name="editor.icon || 'dot'" size="16"></ic></span>
                </div></div>
              <div class="form-item"><label>显示排序</label>
                <input class="input" type="number" v-model="editor.order_num"></div>
              <div class="form-item"><label>状态</label>
                <div style="flex:1; display:flex; gap:18px; padding-top:8px">
                  <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" class="ck" value="0" v-model="editor.status">启用</label>
                  <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" class="ck" value="1" v-model="editor.status">停用</label>
                </div></div>
            </div>
          </div>

          <div class="card">
            <div class="card-hd">
              <div class="t">顶级菜单预览（系统导航）</div>
              <span class="muted" style="font-size:12px">共 {{ tree.length }} 个顶级菜单</span>
            </div>
            <div class="card-bd" style="display:flex; flex-wrap:wrap; gap:8px">
              <div v-for="n in tree" :key="n.menu_id" class="cat-chip" :class="{on: editor.top_category === n.top_category}"
                   style="cursor:pointer" @click="fTop = n.top_category">
                <ic :name="(catalog.find(c => c.key === n.top_category) || {}).icon || 'dot'" size="16"></ic>
                <div>{{ n.menu_name }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
