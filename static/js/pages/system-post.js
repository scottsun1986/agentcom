/* /system/post 岗位编制管理 — pixel replica of design/mockups/073-system-post.png
   Layout: 4 KPI / (岗位编制列表+筛选 | 岗位信息编辑面板) */
AppPages['/system/post'] = {
  route: '/system/post', title: '岗位编制管理', category: 'SYSTEM', primaryAction: '新增岗位', icon: 'briefcase',
  subtitle: '管理单位各类岗位的编制设置、职级体系与人员配置情况，支持岗位新增、调整与停用。',
  component: {
    data() {
      return {
        loading: true,
        posts: [],
        kw: '', fStatus: '',
        selId: null, saving: false,
        editor: this.blankEditor(),
      };
    },
    computed: {
      kpi() {
        const total = this.posts.length;
        const onJob = this.posts.reduce((s, p) => s + (Number(p.user_count) || 0), 0);
        const active = this.posts.filter((p) => p.status === '0').length;
        return { total, onJob, active, stopped: total - active };
      },
      filtered() {
        const kw = (this.kw || '').trim().toLowerCase();
        return this.posts.filter((p) => {
          if (this.fStatus && p.status !== this.fStatus) return false;
          if (kw && !((p.post_name || '') + (p.post_code || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      selPost() { return this.selId ? this.posts.find((p) => p.post_id === this.selId) : null; },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      blankEditor() {
        return { mode: 'create', post_id: null, post_code: '', post_name: '', post_sort: 1, status: '0' };
      },
      async load() {
        try {
          const d = await api.get('/api/system/posts');
          this.posts = d || [];
          if (!this.selId && this.posts.length) this.selectPost(this.posts[0]);
        } catch (e) { this.posts = []; }
      },
      statusTag(s) { return s === '0' ? 'tag-green' : 'tag-gray'; },
      statusLabel(s) { return s === '0' ? '正常' : '停用'; },
      selectPost(p) {
        this.selId = p.post_id;
        this.editor = { mode: 'edit', post_id: p.post_id, post_code: p.post_code || '', post_name: p.post_name || '', post_sort: p.post_sort || 0, status: p.status || '0' };
      },
      startCreate() {
        this.selId = null;
        this.editor = Object.assign(this.blankEditor(), { post_sort: this.posts.length + 1 });
      },
      resetFilter() { this.kw = ''; this.fStatus = ''; },
      async savePost() {
        const e = this.editor;
        if (!e.post_code.trim()) return this.$root.toast('请填写岗位编码', 'warn');
        if (!e.post_name.trim()) return this.$root.toast('请填写岗位名称', 'warn');
        this.saving = true;
        try {
          const body = { post_code: e.post_code.trim(), post_name: e.post_name.trim(), post_sort: Number(e.post_sort) || 0, status: e.status };
          if (e.mode === 'create') {
            await api.post('/api/system/posts', body);
            this.$root.toast('岗位创建成功', 'ok');
          } else {
            await api.put('/api/system/posts/' + e.post_id, body);
            this.$root.toast('岗位信息已保存', 'ok');
          }
          const keep = this.selId;
          await this.load();
          if (keep) { const p = this.posts.find((x) => x.post_id === keep); if (p) this.selectPost(p); }
        } catch (e2) { /* toast shown */ }
        this.saving = false;
      },
      async removePost(p) {
        if (!window.confirm('确认删除岗位「' + p.post_name + '」？')) return;
        try {
          await api.del('/api/system/posts/' + p.post_id);
          this.$root.toast('删除成功', 'ok');
          if (this.selId === p.post_id) this.startCreate();
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.startCreate(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI -->
      <div class="kpi-row">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="briefcase" size="28"></ic></div>
          <div class="meta"><div class="label">岗位总数</div><div class="val" style="color:var(--primary)">{{ kpi.total }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">个</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="pie-chart" size="28"></ic></div>
          <div class="meta"><div class="label">在岗人数合计</div><div class="val" style="color:var(--teal)">{{ kpi.onJob }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">人</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="user-check" size="28"></ic></div>
          <div class="meta"><div class="label">启用岗位</div><div class="val" style="color:var(--amber)">{{ kpi.active }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">个</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="user-x" size="28"></ic></div>
          <div class="meta"><div class="label">停用岗位</div><div class="val" style="color:var(--red)">{{ kpi.stopped }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">个</span></div></div>
        </div>
      </div>

      <div class="post-layout">
        <!-- list -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">岗位编制列表</div></div>
          <div class="card-bd">
            <div class="filters" style="margin-bottom:10px">
              <input class="input" style="width:240px" placeholder="请输入岗位名称、岗位编码" v-model="kw">
              <select class="select" style="width:130px" v-model="fStatus">
                <option value="">全部状态</option><option value="0">正常</option><option value="1">停用</option>
              </select>
              <button class="btn btn-primary" @click="resetFilter"><ic name="rotate-cw" size="14"></ic>重置</button>
            </div>
            <table class="table">
              <thead><tr><th style="width:56px">序号</th><th>岗位编码</th><th>岗位名称</th><th style="width:64px">排序</th><th style="width:86px">在岗人数</th><th style="width:74px">状态</th><th style="width:100px">操作</th></tr></thead>
              <tbody>
                <tr v-for="(p, i) in filtered" :key="p.post_id" :class="{sel: selId === p.post_id}" style="cursor:pointer" @click="selectPost(p)">
                  <td class="num muted">{{ i + 1 }}</td>
                  <td class="mono strong">{{ p.post_code }}</td>
                  <td>{{ p.post_name }}</td>
                  <td class="num muted">{{ p.post_sort }}</td>
                  <td class="num">{{ p.user_count }} 人</td>
                  <td><span :class="['tag', statusTag(p.status)]">{{ statusLabel(p.status) }}</span></td>
                  <td class="actions" @click.stop>
                    <button class="btn btn-text btn-sm" @click="selectPost(p)">编辑</button>
                    <button class="btn btn-text btn-sm danger" @click="removePost(p)">删除</button>
                  </td>
                </tr>
                <tr v-if="!filtered.length"><td colspan="7"><div class="empty">暂无岗位数据</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- editor -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">岗位信息 <span class="tag" :class="editor.mode === 'create' ? 'tag-blue' : 'tag-gray'">{{ editor.mode === 'create' ? '新增岗位' : '编辑岗位' }}</span></div>
            <button class="btn btn-ghost btn-sm" @click="startCreate"><ic name="plus" size="13"></ic>新增</button>
          </div>
          <div class="card-bd">
            <div class="form-item"><label class="req">岗位编码</label>
              <input class="input" placeholder="如 STAFF，建议大写英文" v-model="editor.post_code"></div>
            <div class="form-item"><label class="req">岗位名称</label>
              <input class="input" placeholder="如：科员" v-model="editor.post_name"></div>
            <div class="form-item"><label>显示排序</label>
              <input class="input" type="number" v-model="editor.post_sort"></div>
            <div class="form-item"><label>状态</label>
              <div style="flex:1; display:flex; gap:18px; padding-top:8px">
                <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" class="ck" value="0" v-model="editor.status">正常</label>
                <label style="display:flex;align-items:center;gap:5px;cursor:pointer"><input type="radio" class="ck" value="1" v-model="editor.status">停用</label>
              </div></div>
            <div v-if="editor.mode === 'edit' && selPost" class="mini-stat" style="margin:4px 0 14px">
              <div class="muted" style="font-size:12px">当前在岗人数</div>
              <div class="ms-val">{{ selPost.user_count }} <i>人</i></div>
            </div>
            <div class="cfg-help"><ic name="info" size="13"></ic> 岗位用于组织架构与业务流程流转的职务标识，可在「用户基础管理」中分配给具体用户。</div>
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px">
              <button class="btn btn-ghost" @click="editor.mode === 'edit' && selPost ? selectPost(selPost) : startCreate()">取消</button>
              <button class="btn btn-primary" :disabled="saving" @click="savePost"><ic name="save" size="14"></ic>保存</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
