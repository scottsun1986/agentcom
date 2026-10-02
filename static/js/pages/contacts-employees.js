/* /contacts/employees 干部与员工花名册 — pixel replica of design/mockups/042-contacts-employees.png
   Layout: (组织架构 dept list) | filters + employee table + server pager + detail modal */
AppPages['/contacts/employees'] = {
  route: '/contacts/employees', title: '干部与员工花名册', category: 'CONTACTS', primaryAction: null, icon: 'id-card',
  subtitle: '全员花名册统一管理，支持按部门穿透检索；手机号等敏感字段按查看者权限自动脱敏。',
  component: {
    data() {
      return {
        loading: true,
        rows: [],
        total: 0,
        pageNum: 1,
        pageSize: 12,
        keyword: '',
        status: '',
        deptId: '',
        deptFlat: [], // 扁平化部门 {dept_id, dept_name, depth, user_count}
        detail: null,
      };
    },
    computed: {
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
      curDept() { return this.deptFlat.find((d) => d.dept_id === this.deptId) || null; },
    },
    async mounted() {
      await Promise.all([this.load(), this.loadDepts()]);
      this.loading = false;
    },
    methods: {
      async load() {
        try {
          const r = await api.page('/api/contacts/employees', {
            keyword: this.keyword || undefined,
            status: this.status || undefined,
            dept_id: this.deptId || undefined,
            pageNum: this.pageNum,
            pageSize: this.pageSize,
          });
          this.rows = r.rows || [];
          this.total = r.total || 0;
        } catch (e) { this.rows = []; this.total = 0; }
      },
      async loadDepts() {
        const flat = [];
        const walk = (nodes, depth) => (nodes || []).forEach((n) => {
          flat.push({ dept_id: n.dept_id, dept_name: n.dept_name, depth, user_count: n.user_count });
          walk(n.children, depth + 1);
        });
        try { walk(await api.get('/api/contacts/org-tree'), 0); } catch (e) { /* empty */ }
        this.deptFlat = flat;
      },
      query() { this.pageNum = 1; this.load(); },
      reset() {
        this.keyword = ''; this.status = ''; this.deptId = '';
        this.query();
      },
      pickDept(id) {
        this.deptId = this.deptId === id ? '' : id;
        this.query();
      },
      goPage(p) {
        if (p < 1 || p > this.pageCount || p === this.pageNum) return;
        this.pageNum = p;
        this.load();
      },
      statusLabel(s) { return s === '0' ? '在编' : '停用'; },
      statusTag(s) { return s === '0' ? 'tag-green' : 'tag-gray'; },
      sexLabel(s) { return { '0': '男', '1': '女', '2': '未知' }[s] || '未知'; },
      day(s) { return s ? String(s).slice(0, 10) : '—'; },
    },
    template: `
    <div v-if="!loading">
      <div class="emp-layout">
        <!-- dept tree -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t"><ic name="building-2" size="15"></ic> 组织架构</div></div>
          <div class="card-bd" style="padding-top:8px">
            <div :class="['emp-dept', !deptId ? 'on' : '']" @click="pickDept('')">
              <ic name="landmark" size="15"></ic><span style="flex:1">全部部门</span>
              <span class="cnt">{{ total }}</span>
            </div>
            <div v-for="d in deptFlat" :key="d.dept_id" :class="['emp-dept', deptId === d.dept_id ? 'on' : '']"
              :style="{ paddingLeft: (12 + d.depth * 16) + 'px' }" @click="pickDept(d.dept_id)">
              <ic :name="d.depth === 0 ? 'landmark' : 'building-2'" size="14"></ic>
              <span style="flex:1" class="ellipsis" :title="d.dept_name">{{ d.dept_name }}</span>
              <span class="cnt">{{ d.user_count }}</span>
            </div>
            <div v-if="!deptFlat.length" class="empty">暂无部门</div>
          </div>
        </div>

        <!-- roster -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">员工列表
              <span class="muted" style="font-size:12px; font-weight:400; margin-left:8px">
                {{ curDept ? '当前部门：' + curDept.dept_name : '全部部门' }} · 共 {{ total }} 人
              </span>
            </div>
          </div>
          <div class="card-bd" style="padding-top:10px">
            <div class="filters">
              <input class="input" style="flex:1; min-width:200px" placeholder="姓名 / 账号 / 邮箱关键词" v-model="keyword" @keyup.enter="query">
              <select class="select" style="width:130px" v-model="status" @change="query">
                <option value="">全部状态</option>
                <option value="0">在编</option>
                <option value="1">停用</option>
              </select>
              <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
              <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
            </div>
            <table class="table table-tight">
              <thead>
                <tr>
                  <th>姓名</th><th style="width:92px">账号 / 工号</th><th>部门</th><th style="width:110px">岗位</th>
                  <th style="width:126px">手机号</th><th>邮箱</th><th style="width:76px">状态</th><th style="width:64px">操作</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="u in rows" :key="u.user_id">
                  <td class="strong">{{ u.nick_name || '—' }}<span class="muted" style="font-weight:400; font-size:12px; margin-left:6px">{{ u.sex === '0' ? '男' : u.sex === '1' ? '女' : '' }}</span></td>
                  <td class="num">{{ u.user_name || '—' }}</td>
                  <td class="ellipsis" style="max-width:160px" :title="u.dept_name || ''">{{ u.dept_name || '—' }}</td>
                  <td>{{ u.position || '—' }}</td>
                  <td class="num">
                    <template v-if="u.phonenumber">{{ u.phonenumber }}
                      <ic :name="u.masked ? 'eye-off' : 'eye'" size="12" :style="{ color: u.masked ? '#829AB1' : '#13A89E', marginLeft: '2px' }"></ic>
                    </template>
                    <span v-else class="muted">—</span>
                  </td>
                  <td class="ellipsis" style="max-width:170px" :title="u.email || ''">{{ u.email || '—' }}</td>
                  <td><span :class="['tag', statusTag(u.status)]">{{ statusLabel(u.status) }}</span></td>
                  <td class="actions"><button class="btn btn-text btn-sm" @click="detail = u">详情</button></td>
                </tr>
                <tr v-if="!rows.length"><td colspan="8"><div class="empty">暂无员工数据</div></td></tr>
              </tbody>
            </table>
            <div class="pager" v-if="pageCount > 1">
              <span>共 {{ total }} 条</span>
              <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
              <button v-for="p in pageCount" :key="p" v-show="pageCount <= 7 || p === 1 || p === pageCount || Math.abs(p - pageNum) <= 1"
                class="pg" :class="{ on: p === pageNum }" @click="goPage(p)">{{ p }}</button>
              <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
            </div>
          </div>
        </div>
      </div>

      <!-- detail modal -->
      <Modal title="员工详情" width="520px" v-if="detail" @close="detail = null">
        <div style="display:flex; align-items:center; gap:14px; margin-bottom:14px">
          <span class="emp-avatar">{{ (detail.nick_name || '?').slice(0, 1) }}</span>
          <div>
            <div class="strong" style="font-size:16px">{{ detail.nick_name }}
              <span :class="['tag', statusTag(detail.status)]" style="margin-left:8px">{{ statusLabel(detail.status) }}</span>
            </div>
            <div class="muted" style="font-size:12.5px; margin-top:2px">{{ detail.dept_name || '—' }}<template v-if="detail.position"> · {{ detail.position }}</template></div>
          </div>
        </div>
        <div class="desc-list">
          <span class="k">姓名</span><span class="strong">{{ detail.nick_name || '—' }}</span>
          <span class="k">账号 / 工号</span><span class="num">{{ detail.user_name || '—' }}</span>
          <span class="k">所属部门</span><span>{{ detail.dept_name || '—' }}</span>
          <span class="k">岗位职务</span><span>{{ detail.position || (detail.posts && detail.posts.length ? detail.posts.join('、') : '—') }}</span>
          <span class="k">性别</span><span>{{ sexLabel(detail.sex) }}</span>
          <span class="k">手机号</span>
          <span>{{ detail.phonenumber || '—' }}
            <span v-if="detail.masked" class="tag tag-gray" style="margin-left:6px"><ic name="eye-off" size="11"></ic>已脱敏</span>
          </span>
          <span class="k">电子邮箱</span><span>{{ detail.email || '—' }}</span>
          <span class="k">创建时间</span><span>{{ day(detail.created_at) }}</span>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="detail = null">关闭</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
