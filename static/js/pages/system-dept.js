/* /system/dept 部门组织机构 — pixel replica of design/mockups/072-system-dept.png
   Layout: (组织架构树搜索 + 树形表格 | 部门信息编辑面板 + ancestors 路径) */
AppPages['/system/dept'] = {
  route: '/system/dept', title: '部门组织机构', category: 'SYSTEM', primaryAction: '新增部门', icon: 'building-2',
  subtitle: '维护单位的组织架构信息，设置部门负责人、联系方式及排序，支持多级组织管理。',
  component: {
    data() {
      return {
        loading: true,
        tree: [],
        kw: '',
        expanded: {},
        selId: null,
        saving: false,
        editor: this.blankEditor(),
      };
    },
    computed: {
      flatMap() {
        const m = {};
        const walk = (nodes) => nodes.forEach((n) => { m[n.dept_id] = n; if (n.children && n.children.length) walk(n.children); });
        walk(this.tree);
        return m;
      },
      rows() {
        const kw = (this.kw || '').trim().toLowerCase();
        const walk = (nodes, depth) => {
          const out = [];
          nodes.forEach((n) => {
            const kids = n.children || [];
            const selfHit = !kw || [n.dept_name, n.leader, n.phone].some((x) => (x || '').toLowerCase().includes(kw));
            const kidRows = walk(kids, depth + 1);
            if (!selfHit && !kidRows.length) return;
            const open = kw ? true : !!this.expanded[n.dept_id];
            out.push({ n, depth, open, hasKids: kids.length > 0 });
            if (open && kidRows.length) out.push(...kidRows);
          });
          return out;
        };
        return walk(this.tree, 0);
      },
      selDept() { return this.selId ? this.flatMap[this.selId] : null; },
      ancestorsPath() {
        const d = this.selDept || (this.editor.mode === 'edit' ? this.flatMap[this.editor.dept_id] : null);
        if (!d) return [];
        const chain = [];
        let cur = d;
        const guard = {};
        while (cur && !guard[cur.dept_id]) {
          guard[cur.dept_id] = true;
          chain.unshift(cur.dept_name);
          cur = cur.parent_id ? this.flatMap[cur.parent_id] : null;
        }
        return chain;
      },
      parentOptions() {
        const out = [{ id: '', name: '无（顶级部门）' }];
        const walk = (nodes, depth) => nodes.forEach((n) => {
          if (n.dept_id !== this.selId) out.push({ id: n.dept_id, name: '　'.repeat(depth) + n.dept_name });
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
        return { mode: 'create', dept_id: null, parent_id: '', dept_name: '', order_num: 1, leader: '', phone: '', email: '', status: '0', ancestors: '' };
      },
      async load() {
        try {
          const d = await api.get('/api/system/depts');
          this.tree = d || [];
          this.tree.forEach((n) => { this.expanded[n.dept_id] = true; });
          if (!this.selId && this.tree.length) this.selectDept(this.tree[0]);
        } catch (e) { this.tree = []; }
      },
      toggle(id) { if (this.expanded[id]) delete this.expanded[id]; else this.expanded[id] = true; },
      statusTag(s) { return s === '0' ? 'tag-green' : 'tag-gray'; },
      statusLabel(s) { return s === '0' ? '启用' : '停用'; },
      selectDept(n) {
        this.selId = n.dept_id;
        this.editor = {
          mode: 'edit', dept_id: n.dept_id, parent_id: n.parent_id || '', dept_name: n.dept_name || '',
          order_num: n.order_num || 0, leader: n.leader || '', phone: n.phone || '', email: n.email || '',
          status: n.status || '0', ancestors: n.ancestors || '',
        };
      },
      startCreate(parent) {
        this.selId = null;
        this.editor = Object.assign(this.blankEditor(), {
          mode: 'create',
          parent_id: parent ? parent.dept_id : '',
          order_num: parent && parent.children ? parent.children.length + 1 : 1,
        });
      },
      async saveDept() {
        const e = this.editor;
        if (!e.dept_name.trim()) return this.$root.toast('请填写部门名称', 'warn');
        this.saving = true;
        try {
          if (e.mode === 'create') {
            await api.post('/api/system/depts', {
              dept_name: e.dept_name.trim(), parent_id: e.parent_id || null, order_num: Number(e.order_num) || 0,
              leader: e.leader || null, phone: e.phone || null, email: e.email || null,
            });
            this.$root.toast('部门创建成功', 'ok');
          } else {
            await api.put('/api/system/depts/' + e.dept_id, {
              dept_name: e.dept_name.trim(), order_num: Number(e.order_num) || 0,
              leader: e.leader || null, phone: e.phone || null, email: e.email || null, status: e.status,
            });
            this.$root.toast('部门信息已保存', 'ok');
          }
          const keep = this.selId;
          await this.load();
          if (keep && this.flatMap[keep]) this.selectDept(this.flatMap[keep]);
        } catch (e2) { /* toast shown */ }
        this.saving = false;
      },
      async removeDept(n) {
        if (!window.confirm('确认删除部门「' + n.dept_name + '」？存在下级部门时将无法删除。')) return;
        try {
          await api.del('/api/system/depts/' + n.dept_id);
          this.$root.toast('删除成功', 'ok');
          if (this.selId === n.dept_id) this.startCreate(null);
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      importDepts() { this.$root.toast('组织导入功能即将上线', 'warn'); },
      exportDepts() { this.$root.toast('组织导出功能即将上线', 'warn'); },
      onPrimary() { this.startCreate(null); },
    },
    template: `
    <div v-if="!loading">
      <div class="dept-layout">
        <!-- tree table -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">组织架构树</div>
            <div style="display:flex; gap:8px; align-items:center">
              <div class="sys-tree-search" style="margin:0; width:260px">
                <ic name="search" size="14"></ic>
                <input class="input" placeholder="搜索部门名称、负责人或联系方式" v-model="kw">
              </div>
              <button class="btn btn-ghost btn-sm" @click="importDepts"><ic name="download" size="13"></ic>导入</button>
              <button class="btn btn-ghost btn-sm" @click="exportDepts"><ic name="upload" size="13"></ic>导出</button>
            </div>
          </div>
          <div class="card-bd" style="padding-top:10px">
            <table class="table">
              <thead><tr><th>部门名称</th><th>部门负责人</th><th>联系电话</th><th>联系邮箱</th><th style="width:64px">排序</th><th style="width:74px">状态</th><th style="width:130px">操作</th></tr></thead>
              <tbody>
                <tr v-for="r in rows" :key="r.n.dept_id" :class="{sel: selId === r.n.dept_id}" style="cursor:pointer" @click="selectDept(r.n)">
                  <td :style="{paddingLeft: (12 + r.depth * 22) + 'px'}">
                    <span class="tw" v-if="r.hasKids" style="display:inline-flex;vertical-align:-3px;margin-right:4px;color:var(--text-3)" @click.stop="toggle(r.n.dept_id)">
                      <ic :name="r.open ? 'chevron-down' : 'chevron-right'" size="13"></ic>
                    </span>
                    <span class="tw" v-else style="display:inline-block;width:17px"></span>
                    <ic name="building-2" size="14" style="color:var(--primary); vertical-align:-2px; margin-right:4px"></ic>
                    <span :class="r.depth === 0 ? 'strong' : ''">{{ r.n.dept_name }}</span>
                  </td>
                  <td>{{ r.n.leader || '—' }}</td>
                  <td class="num">{{ r.n.phone || '—' }}</td>
                  <td class="muted">{{ r.n.email || '—' }}</td>
                  <td class="num muted">{{ r.n.order_num }}</td>
                  <td><span :class="['tag', statusTag(r.n.status)]">{{ statusLabel(r.n.status) }}</span></td>
                  <td class="actions" @click.stop>
                    <button class="btn btn-text btn-sm" @click="startCreate(r.n)">新增子部门</button>
                    <button class="btn btn-text btn-sm danger" @click="removeDept(r.n)">删除</button>
                  </td>
                </tr>
                <tr v-if="!rows.length"><td colspan="7"><div class="empty">暂无部门数据</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- dept editor -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">部门信息 <span class="tag" :class="editor.mode === 'create' ? 'tag-blue' : 'tag-gray'">{{ editor.mode === 'create' ? '新增部门' : '编辑部门' }}</span></div>
            <ic name="x" size="16" style="cursor:pointer; color:var(--text-3)" @click="startCreate(null)"></ic>
          </div>
          <div class="card-bd">
            <template v-if="editor.mode === 'edit' && ancestorsPath.length">
              <div class="sec-title" style="margin-top:0">组织路径（ancestors）</div>
              <div class="anc-path">
                <template v-for="(p, i) in ancestorsPath" :key="i">
                  <span class="anc-crumb">{{ p }}</span>
                  <ic v-if="i < ancestorsPath.length - 1" name="chevron-right" size="12" style="color:#B6C3D2"></ic>
                </template>
              </div>
            </template>
            <div class="form-item"><label>上级部门</label>
              <select class="select" v-model="editor.parent_id" :disabled="editor.mode === 'edit'">
                <option v-for="p in parentOptions" :key="p.id" :value="p.id">{{ p.name }}</option>
              </select></div>
            <div class="muted" v-if="editor.mode === 'edit'" style="font-size:11.5px; margin:-8px 0 12px 102px">保存后不可变更上级部门；如需调整请新建部门并迁移。</div>
            <div class="form-item"><label class="req">部门名称</label>
              <input class="input" placeholder="请输入部门全称" v-model="editor.dept_name"></div>
            <div class="form-item"><label>显示排序</label>
              <input class="input" type="number" v-model="editor.order_num"></div>
            <div class="form-item"><label>部门负责人</label>
              <input class="input" placeholder="请输入负责人姓名" v-model="editor.leader"></div>
            <div class="form-item"><label>联系电话</label>
              <input class="input" placeholder="如 0571-88008001" v-model="editor.phone"></div>
            <div class="form-item"><label>联系邮箱</label>
              <input class="input" placeholder="name@agency.gov.cn" v-model="editor.email"></div>
            <div class="form-item"><label>状态</label>
              <div style="flex:1; display:flex; gap:18px; padding-top:8px">
                <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" class="ck" value="0" v-model="editor.status">启用</label>
                <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" class="ck" value="1" v-model="editor.status">停用</label>
              </div></div>
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px">
              <button class="btn btn-ghost" @click="editor.mode === 'edit' && selDept ? selectDept(selDept) : startCreate(null)">取消</button>
              <button class="btn btn-primary" :disabled="saving" @click="saveDept"><ic name="save" size="14"></ic>保存</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
