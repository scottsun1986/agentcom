/* /system/user 用户基础管理 — pixel replica of design/mockups/069-system-user.png
   Layout: (部门组织 tree | keyword/status filters + user table + pager) + 新增/编辑/重置密码 modal */
AppPages['/system/user'] = {
  route: '/system/user', title: '用户基础管理', category: 'SYSTEM', primaryAction: '新增用户', icon: 'user',
  subtitle: '统一管理平台用户账号、部门归属、岗位分配和角色权限，支持密码重置、账号停用/解冻等操作。',
  component: {
    data() {
      return {
        loading: true,
        rows: [], total: 0, pageNum: 1, pageSize: 10,
        filters: { keyword: '', dept_id: '', status: '' },
        selected: [],
        deptTree: [], deptKw: '', deptExpanded: {}, deptCountMap: {},
        roles: [], posts: [],
        showForm: false, formMode: 'create', saving: false,
        form: { user_name: '', nick_name: '', dept_id: '', phonenumber: '', email: '', sex: '0', status: '0', password: '', role_ids: [], post_ids: [] },
        showReset: false, resetTarget: null, resetPwd: '',
      };
    },
    computed: {
      deptRows() {
        const kw = (this.deptKw || '').trim().toLowerCase();
        const walk = (nodes, depth) => {
          const out = [];
          nodes.forEach((n) => {
            const kids = n.children || [];
            const selfHit = !kw || (n.dept_name || '').toLowerCase().includes(kw);
            const kidRows = walk(kids, depth + 1);
            if (!selfHit && !kidRows.length) return;
            const open = kw ? true : !!this.deptExpanded[n.dept_id];
            out.push({ id: n.dept_id, name: n.dept_name, depth, open, hasKids: kids.length > 0, cnt: this.deptCount(n) });
            if (open && kidRows.length) out.push(...kidRows);
          });
          return out;
        };
        return walk(this.deptTree, 0);
      },
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
    },
    async mounted() {
      try {
        const [depts, rs, ps] = await Promise.all([
          api.get('/api/system/depts'), api.page('/api/system/roles', { pageNum: 1, pageSize: 100 }), api.get('/api/system/posts'),
        ]);
        this.deptTree = depts || [];
        this.roles = rs.rows || [];
        this.posts = ps || [];
        (this.deptTree || []).forEach((d) => { this.deptExpanded[d.dept_id] = true; });
        this.loadCounts();
      } catch (e) { /* empty state shown */ }
      await this.load();
      this.loading = false;
    },
    methods: {
      async loadCounts() {
        try {
          const r = await api.page('/api/system/users', { pageNum: 1, pageSize: 500 });
          const m = {};
          (r.rows || []).forEach((u) => { if (u.dept_id) m[u.dept_id] = (m[u.dept_id] || 0) + 1; });
          this.deptCountMap = m;
        } catch (e) { this.deptCountMap = {}; }
      },
      deptCount(n) {
        let c = this.deptCountMap[n.dept_id] || 0;
        (n.children || []).forEach((k) => { c += this.deptCount(k); });
        return c;
      },
      toggleDept(id) {
        if (this.deptExpanded[id]) delete this.deptExpanded[id];
        else this.deptExpanded[id] = true;
      },
      pickDept(id) { this.filters.dept_id = this.filters.dept_id === id ? '' : id; this.query(); },
      deptOptions() {
        const out = [];
        const walk = (nodes, depth) => nodes.forEach((n) => { out.push({ id: n.dept_id, name: '　'.repeat(depth) + n.dept_name }); if (n.children && n.children.length) walk(n.children, depth + 1); });
        walk(this.deptTree, 0);
        return out;
      },
      async load() {
        try {
          const r = await api.page('/api/system/users', {
            keyword: this.filters.keyword, dept_id: this.filters.dept_id, status: this.filters.status,
            pageNum: this.pageNum, pageSize: this.pageSize,
          });
          this.rows = r.rows || [];
          this.total = r.total || 0;
        } catch (e) { this.rows = []; this.total = 0; }
      },
      query() { this.pageNum = 1; this.selected = []; this.load(); },
      reset() { this.filters = { keyword: '', dept_id: '', status: '' }; this.query(); },
      goPage(p) { if (p < 1 || p > this.pageCount) return; this.pageNum = p; this.selected = []; this.load(); },
      changeSize() { this.pageNum = 1; this.load(); },
      selAll(e) { this.selected = e.target.checked ? this.rows.map((r) => r.user_id) : []; },
      statusTag(s) { return s === '0' ? 'tag-green' : 'tag-gray'; },
      statusLabel(s) { return s === '0' ? '正常' : '停用'; },
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate());
      },
      isAdmin(u) { return u.user_name === 'admin'; },
      openCreate() {
        this.formMode = 'create';
        this.form = { user_name: '', nick_name: '', dept_id: this.filters.dept_id || '', phonenumber: '', email: '', sex: '0', status: '0', password: 'Zc@123456', role_ids: [], post_ids: [] };
        this.showForm = true;
      },
      openEdit(u) {
        this.formMode = 'edit';
        this.form = {
          user_id: u.user_id, user_name: u.user_name, nick_name: u.nick_name, dept_id: u.dept_id || '',
          phonenumber: u.phonenumber || '', email: u.email || '', sex: '0', status: u.status,
          password: '', role_ids: (u.roles || []).map((r) => r.role_id), post_ids: [],
        };
        this.showForm = true;
      },
      toggleRole(id) {
        const i = this.form.role_ids.indexOf(id);
        if (i >= 0) this.form.role_ids.splice(i, 1); else this.form.role_ids.push(id);
      },
      togglePost(id) {
        const i = this.form.post_ids.indexOf(id);
        if (i >= 0) this.form.post_ids.splice(i, 1); else this.form.post_ids.push(id);
      },
      async submitForm() {
        const f = this.form;
        if (this.formMode === 'create' && !f.user_name.trim()) return this.$root.toast('请填写登录账号', 'warn');
        if (!f.nick_name.trim()) return this.$root.toast('请填写用户姓名', 'warn');
        if (this.formMode === 'create' && !f.password) return this.$root.toast('请填写初始密码', 'warn');
        this.saving = true;
        try {
          if (this.formMode === 'create') {
            await api.post('/api/system/users', {
              user_name: f.user_name.trim(), nick_name: f.nick_name.trim(), dept_id: f.dept_id || null,
              phonenumber: f.phonenumber, email: f.email, sex: f.sex, password: f.password,
              role_ids: f.role_ids, post_ids: f.post_ids,
            });
            this.$root.toast('用户创建成功', 'ok');
          } else {
            await api.put('/api/system/users/' + f.user_id, {
              nick_name: f.nick_name.trim(), dept_id: f.dept_id || null, phonenumber: f.phonenumber,
              email: f.email, status: f.status, role_ids: f.role_ids, post_ids: f.post_ids,
            });
            this.$root.toast('用户信息已更新', 'ok');
          }
          this.showForm = false;
          await Promise.all([this.load(), this.loadCounts()]);
        } catch (e) { /* toast shown */ }
        this.saving = false;
      },
      openReset(u) { this.resetTarget = u; this.resetPwd = ''; this.showReset = true; },
      async submitReset() {
        if (!this.resetPwd) return this.$root.toast('请输入新密码', 'warn');
        try {
          await api.put('/api/system/users/' + this.resetTarget.user_id, { password: this.resetPwd });
          this.$root.toast('密码已重置', 'ok');
          this.showReset = false;
        } catch (e) { /* toast shown */ }
      },
      async toggleStatus(u) {
        const to = u.status === '0' ? '1' : '0';
        try {
          await api.put('/api/system/users/' + u.user_id, { status: to });
          this.$root.toast(to === '1' ? '账号已停用' : '账号已启用', 'ok');
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      async removeOne(u) {
        if (!window.confirm('确认删除用户「' + (u.nick_name || u.user_name) + '」？删除后不可恢复。')) return;
        try { await api.del('/api/system/users/' + u.user_id); this.$root.toast('删除成功', 'ok'); await Promise.all([this.load(), this.loadCounts()]); } catch (e) { /* toast shown */ }
      },
      async removeSelected() {
        if (!this.selected.length) return;
        if (!window.confirm('确认批量删除选中的 ' + this.selected.length + ' 个用户？')) return;
        for (const id of this.selected) { try { await api.del('/api/system/users/' + id); } catch (e) { /* continue */ } }
        this.$root.toast('批量删除完成', 'ok');
        this.selected = [];
        await Promise.all([this.load(), this.loadCounts()]);
      },
      onPrimary() { this.openCreate(); },
    },
    template: `
    <div v-if="!loading">
      <div class="sys-split">
        <!-- dept tree -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">部门组织</div></div>
          <div class="card-bd">
            <div class="sys-tree-search">
              <ic name="search" size="14"></ic>
              <input class="input" placeholder="搜索部门名称" v-model="deptKw">
            </div>
            <div class="tree-panel">
              <div class="tree-row" :class="{on: !filters.dept_id}" @click="pickDept('')">
                <span class="tw"></span><ic name="building-2" size="15"></ic>
                <span class="tname">全部部门</span>
                <span class="tcnt">{{ total }}</span>
              </div>
              <div v-for="d in deptRows" :key="d.id" class="tree-row" :class="{on: filters.dept_id === d.id}"
                   :style="{paddingLeft: (8 + d.depth * 16) + 'px'}" @click="pickDept(d.id)">
                <span class="tw" v-if="d.hasKids" @click.stop="toggleDept(d.id)">
                  <ic :name="d.open ? 'chevron-down' : 'chevron-right'" size="13"></ic>
                </span>
                <span class="tw" v-else></span>
                <ic name="building" size="14"></ic>
                <span class="tname" :title="d.name">{{ d.name }}</span>
                <span class="tcnt">({{ d.cnt }})</span>
              </div>
            </div>
          </div>
        </div>

        <!-- user table -->
        <div class="card" style="margin-top:0">
          <div class="card-bd">
            <div class="filters" style="margin-bottom:12px">
              <input class="input" style="width:250px" placeholder="请输入账号、姓名或手机号" v-model="filters.keyword" @keyup.enter="query">
              <select class="select" style="width:130px" v-model="filters.status" @change="query">
                <option value="">用户状态全部</option>
                <option value="0">正常</option>
                <option value="1">停用</option>
              </select>
              <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
              <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
              <span style="flex:1"></span>
              <button class="btn btn-ghost" v-if="selected.length" @click="removeSelected"><ic name="trash" size="14"></ic>批量删除 ({{ selected.length }})</button>
            </div>
            <table class="table">
              <thead><tr>
                <th style="width:36px"><input type="checkbox" class="ck" :checked="rows.length && selected.length === rows.length" @change="selAll"></th>
                <th>账号</th><th>姓名</th><th>部门归属</th><th>岗位</th><th>角色</th><th>状态</th><th style="width:210px">操作</th>
              </tr></thead>
              <tbody>
                <tr v-for="u in rows" :key="u.user_id">
                  <td><input type="checkbox" class="ck" :value="u.user_id" v-model="selected"></td>
                  <td class="mono strong">{{ u.user_name }}</td>
                  <td>{{ u.nick_name }}</td>
                  <td>{{ u.dept_name || '—' }}</td>
                  <td class="muted">{{ (u.post_names || []).join('、') || '—' }}</td>
                  <td>
                    <span v-for="(r, i) in (u.roles || []).slice(0, 2)" :key="r.role_id" :class="['tag', i === 0 ? 'tag-blue' : 'tag-teal']" style="margin-right:4px">{{ r.role_name }}</span>
                    <span v-if="(u.roles || []).length > 2" class="tag tag-gray">+{{ u.roles.length - 2 }}</span>
                    <span v-if="!(u.roles || []).length" class="muted">—</span>
                  </td>
                  <td><span :class="['tag', statusTag(u.status)]"><ic :name="u.status === '0' ? 'check-circle-2' : 'ban'" size="12"></ic>{{ statusLabel(u.status) }}</span></td>
                  <td class="actions">
                    <button class="btn btn-text btn-sm" @click="openEdit(u)">编辑</button>
                    <button class="btn btn-text btn-sm" @click="openReset(u)">重置密码</button>
                    <button v-if="!isAdmin(u)" class="btn btn-text btn-sm" @click="toggleStatus(u)">{{ u.status === '0' ? '停用' : '启用' }}</button>
                    <button v-if="!isAdmin(u)" class="btn btn-text btn-sm danger" @click="removeOne(u)">删除</button>
                  </td>
                </tr>
                <tr v-if="!rows.length"><td colspan="8"><div class="empty">暂无符合条件的用户</div></td></tr>
              </tbody>
            </table>
            <div class="pager">
              <span>共 {{ total }} 条</span>
              <select class="select" style="width:96px; height:28px; font-size:12px" v-model.number="pageSize" @change="changeSize">
                <option :value="10">10条/页</option><option :value="20">20条/页</option><option :value="50">50条/页</option>
              </select>
              <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
              <button v-for="p in pageCount" :key="p" v-show="pageCount <= 7 || p === 1 || p === pageCount || Math.abs(p - pageNum) <= 1"
                      class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
              <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
            </div>
          </div>
        </div>
      </div>

      <!-- create / edit modal -->
      <Modal :title="formMode === 'create' ? '新增用户' : '编辑用户'" width="620px" v-if="showForm" @close="showForm = false">
        <div class="form-grid-2">
          <div class="form-item"><label :class="{req: formMode === 'create'}">登录账号</label>
            <input class="input" :disabled="formMode === 'edit'" placeholder="用于登录，如 zhangm" v-model="form.user_name"></div>
          <div class="form-item"><label class="req">用户姓名</label>
            <input class="input" placeholder="请输入姓名" v-model="form.nick_name"></div>
          <div class="form-item"><label>所属部门</label>
            <select class="select" v-model="form.dept_id">
              <option value="">无（顶级）</option>
              <option v-for="d in deptOptions()" :key="d.id" :value="d.id">{{ d.name }}</option>
            </select></div>
          <div class="form-item"><label>手机号码</label>
            <input class="input" placeholder="请输入手机号" v-model="form.phonenumber"></div>
          <div class="form-item"><label>电子邮箱</label>
            <input class="input" placeholder="name@example.com" v-model="form.email"></div>
          <div class="form-item" v-if="formMode === 'create'"><label class="req">初始密码</label>
            <input class="input" type="text" placeholder="默认 Zc@123456" v-model="form.password"></div>
          <div class="form-item"><label>状态</label>
            <div style="flex:1; display:flex; gap:18px; padding-top:8px">
              <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" class="ck" value="0" v-model="form.status">正常</label>
              <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" class="ck" value="1" v-model="form.status">停用</label>
            </div></div>
        </div>
        <div class="form-item" style="align-items:flex-start">
          <label>分配角色</label>
          <div style="flex:1; display:flex; flex-wrap:wrap; gap:8px 14px; padding-top:7px">
            <label v-for="r in roles" :key="r.role_id" style="display:flex;align-items:center;gap:5px;cursor:pointer">
              <input type="checkbox" class="ck" :checked="form.role_ids.includes(r.role_id)" @change="toggleRole(r.role_id)">{{ r.role_name }}
            </label>
            <span v-if="!roles.length" class="muted">暂无角色</span>
          </div>
        </div>
        <div class="form-item" style="align-items:flex-start">
          <label>分配岗位</label>
          <div style="flex:1; display:flex; flex-wrap:wrap; gap:8px 14px; padding-top:7px">
            <label v-for="p in posts" :key="p.post_id" style="display:flex;align-items:center;gap:5px;cursor:pointer">
              <input type="checkbox" class="ck" :checked="form.post_ids.includes(p.post_id)" @change="togglePost(p.post_id)">{{ p.post_name }}
            </label>
            <span v-if="!posts.length" class="muted">暂无岗位</span>
          </div>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showForm = false">取消</button>
          <button class="btn btn-primary" :disabled="saving" @click="submitForm">{{ formMode === 'create' ? '创建用户' : '保存修改' }}</button>
        </template>
      </Modal>

      <!-- reset password modal -->
      <Modal title="重置密码" width="440px" v-if="showReset" @close="showReset = false">
        <div class="desc-list" style="margin-bottom:14px">
          <span class="k">当前用户</span><span class="strong">{{ resetTarget ? resetTarget.nick_name : '' }}（{{ resetTarget ? resetTarget.user_name : '' }}）</span>
        </div>
        <div class="form-item"><label class="req">新密码</label>
          <input class="input" placeholder="请输入新密码，建议包含大小写字母、数字与符号" v-model="resetPwd"></div>
        <div class="cfg-help">重置后请通知用户重新登录，系统默认密码策略：Zc@123456。</div>
        <template #footer>
          <button class="btn btn-ghost" @click="showReset = false">取消</button>
          <button class="btn btn-primary" @click="submitReset">确认重置</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
