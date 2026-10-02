/* /conference/minutes 会议纪要与行动项 — pixel replica of design/mockups/039-conference-minutes.png
   Layout: 纪要列表 table + pager / 编辑 modal（左 Markdown 编辑 | 右预览 + 行动项）+ 新建纪要 modal */
AppPages['/conference/minutes'] = {
  route: '/conference/minutes', title: '会议纪要与行动项', category: 'CONFERENCE', primaryAction: '新建纪要', icon: 'file-text',
  subtitle: '基于会议预订自动归集纪要，支持多人协作、自动版本递增、行动项指定，推动会议决策落地执行。',
  component: {
    data() {
      return {
        loading: true,
        minutes: [],
        total: 0,
        pageNum: 1,
        pageSize: 10,
        filters: { keyword: '' },
        showEdit: false,
        showCreate: false,
        submitting: false,
        current: null,
        editForm: { content: '' },
        newItem: { task_description: '', assignee_name: '', due_date: '' },
        createForm: { booking_id: '', content: '' },
        bookings: [],
      };
    },
    computed: {
      filtered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        return this.minutes.filter((m) => {
          if (kw && !((m.booking_title || '') + (m.author_name || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      pageTotal() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      previewHtml() { return this.mdPreview(this.editForm.content); },
      wordCount() { return (this.editForm.content || '').length; },
      bookable() { return this.bookings.filter((b) => b.status !== 'CANCELLED' && !this.minutes.some((m) => m.booking_id === b.booking_id)); },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      bj(s) { return s ? String(s).slice(0, 16).replace('T', ' ') : '—'; },
      async load() {
        try {
          const r = await api.page('/api/conference/minutes', { pageNum: 1, pageSize: 100 });
          this.minutes = r.rows || [];
          this.total = r.total || 0;
        } catch (e) { this.minutes = []; this.total = 0; }
        try {
          const rb = await api.page('/api/conference/bookings', { pageNum: 1, pageSize: 200 });
          this.bookings = rb.rows || [];
        } catch (e) { this.bookings = []; }
      },
      esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); },
      mdPreview(text) {
        const lines = String(text || '').split('\n');
        let html = '';
        let inList = false;
        const closeList = () => { if (inList) { html += '</div>'; inList = false; } };
        lines.forEach((raw) => {
          const line = raw.replace(/\s+$/, '');
          if (!line.trim()) { closeList(); return; }
          if (/^#\s/.test(line)) { closeList(); html += '<h4>' + this.esc(line.replace(/^#\s/, '')) + '</h4>'; return; }
          if (/^##\s/.test(line)) { closeList(); html += '<h5>' + this.esc(line.replace(/^##\s/, '')) + '</h5>'; return; }
          if (/^###\s/.test(line)) { closeList(); html += '<h5 style="font-size:13px">' + this.esc(line.replace(/^###\s/, '')) + '</h5>'; return; }
          if (/^[-*]\s/.test(line) || /^\d+[.、]\s?/.test(line)) {
            if (!inList) { html += '<div class="md-li">'; inList = true; }
            html += '<div>' + this.esc(line.replace(/^[-*]\s/, '').replace(/^(\d+[.、]\s?)/, '$1')) + '</div>';
            return;
          }
          closeList();
          html += '<p>' + this.esc(line) + '</p>';
        });
        closeList();
        return html || '<p class="muted">暂无内容</p>';
      },
      statusTag(s) { return { PENDING: 'tag-amber', IN_PROGRESS: 'tag-blue', DONE: 'tag-green' }[s] || 'tag-gray'; },
      statusLabel(s) { return { PENDING: '待处理', IN_PROGRESS: '进行中', DONE: '已完成' }[s] || s; },
      query() { this.pageNum = 1; },
      goPage(p) { if (p >= 1 && p <= this.pageCount) this.pageNum = p; },
      async openEdit(m) {
        try {
          this.current = await api.get('/api/conference/minutes/' + m.id);
          this.editForm = { content: this.current.content || '' };
          this.newItem = { task_description: '', assignee_name: '', due_date: '' };
          this.showEdit = true;
        } catch (e) { /* toast shown */ }
      },
      async saveMinutes() {
        if (!this.editForm.content.trim()) return this.$root.toast('纪要内容不能为空', 'warn');
        this.submitting = true;
        try {
          const d = await api.put('/api/conference/minutes/' + this.current.id, { content: this.editForm.content.trim() });
          this.$root.toast('纪要已保存' + (d && d.version ? '，当前第 ' + d.version + ' 版' : ''), 'ok');
          this.showEdit = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async addActionItem() {
        const f = this.newItem;
        if (!f.task_description.trim()) return this.$root.toast('请填写议定事项描述', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/conference/minutes/' + this.current.id + '/action-items', {
            task_description: f.task_description.trim(),
            assignee_name: (f.assignee_name || '').trim() || undefined,
            due_date: f.due_date || undefined,
          });
          this.$root.toast('议定事项已登记', 'ok');
          this.newItem = { task_description: '', assignee_name: '', due_date: '' };
          this.current = await api.get('/api/conference/minutes/' + this.current.id);
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      openCreate() {
        this.createForm = { booking_id: '', content: '' };
        this.showCreate = true;
      },
      async submitCreate() {
        const f = this.createForm;
        if (!f.booking_id) return this.$root.toast('请选择关联会议', 'warn');
        if (!f.content.trim()) return this.$root.toast('纪要内容不能为空', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/conference/minutes', { booking_id: f.booking_id, content: f.content.trim() });
          this.$root.toast('纪要已创建', 'ok');
          this.showCreate = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      onPrimary() { this.openCreate(); },
    },
    template: `
    <div v-if="!loading">
      <div class="card">
        <div class="card-hd"><div class="t">会议纪要列表</div><span class="muted" style="font-size:12px">共 {{ total }} 份</span></div>
        <div class="card-bd" style="padding-top:10px">
          <div class="filters">
            <input class="input" style="flex:1; min-width:200px" placeholder="请输入会议名称或纪要人" v-model="filters.keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
          </div>
          <table class="table">
            <thead><tr><th>会议名称</th><th>纪要人</th><th style="width:86px">版本号</th><th>更新时间</th><th style="width:150px">操作</th></tr></thead>
            <tbody>
              <tr v-for="m in shownRows" :key="m.id">
                <td class="strong ell" style="max-width:280px" :title="m.booking_title || ''">{{ m.booking_title || '未关联会议' }}</td>
                <td>{{ m.author_name || '—' }}</td>
                <td><span class="tag tag-blue">v{{ m.version }}</span></td>
                <td class="num muted">{{ bj(m.updated_at || m.created_at) }}</td>
                <td class="actions">
                  <button class="btn btn-text btn-sm" @click="openEdit(m)">查看编辑</button>
                  <button class="btn btn-text btn-sm" @click="$root.go('/conference/minutes-to-supervision')">转督办</button>
                </td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="5"><div class="empty">暂无会议纪要，点击右上角「新建纪要」创建</div></td></tr>
            </tbody>
          </table>
          <div class="pager" v-if="pageCount > 1">
            <span>共 {{ pageTotal }} 条</span>
            <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in pageCount" :key="p" class="pg" :class="{ on: p === pageNum }" @click="goPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
      </div>

      <!-- create modal -->
      <Modal title="新建会议纪要" width="640px" v-if="showCreate" @close="showCreate = false">
        <div class="form-item">
          <label class="req">关联会议</label>
          <select class="select" v-model="createForm.booking_id">
            <option value="" disabled>请选择会议预订（已有纪要的会议将自动递增版本）</option>
            <option v-for="b in bookings" :key="b.booking_id" :value="b.booking_id">{{ b.title }}（{{ bj(b.start_time).slice(5, 16) }}）</option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">纪要内容</label>
          <textarea class="input" rows="9" style="font-family:Consolas,Menlo,monospace; font-size:12.5px; line-height:1.7" placeholder="支持简单 Markdown：# 一级标题、## 二级标题、- 列表项&#10;如：&#10;# 会议纪要&#10;## 会议决议&#10;- 原则同意实施方案，按程序报批" v-model="createForm.content"></textarea>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showCreate = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitCreate">保存纪要</button>
        </template>
      </Modal>

      <!-- edit modal: editor | preview + action items -->
      <Modal title="会议纪要编辑与行动项" width="1020px" v-if="showEdit && current" @close="showEdit = false">
        <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-bottom:12px">
          <span class="strong" style="font-size:15px">{{ current.booking_title || '未关联会议' }}</span>
          <span class="tag tag-blue">v{{ current.version }}</span>
          <span class="muted" style="font-size:12px">纪要人：{{ current.author_name || '—' }} · 更新于 {{ bj(current.updated_at || current.created_at) }}</span>
          <span class="muted" style="margin-left:auto; font-size:12px">共 {{ wordCount }} 字</span>
        </div>
        <div class="ed-split">
          <div>
            <div class="ed-cap"><ic name="pencil" size="13"></ic> Markdown 编辑</div>
            <textarea class="input" v-model="editForm.content" placeholder="# 会议背景&#10;## 会议决议&#10;- 事项一&#10;- 事项二"></textarea>
          </div>
          <div>
            <div class="ed-cap"><ic name="eye" size="13"></ic> 实时预览</div>
            <div class="md-prev" v-html="previewHtml"></div>
          </div>
        </div>
        <div class="divider"></div>
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px">
          <span class="strong" style="font-size:13.5px">行动项（{{ (current.action_items || []).length }}）</span>
          <span class="muted" style="font-size:12px">登记议定事项后可在「议定决议转督办」一键生成督办单</span>
        </div>
        <table class="table" v-if="(current.action_items || []).length">
          <thead><tr><th style="width:36px">#</th><th>行动项内容</th><th style="width:90px">负责人</th><th style="width:110px">截止日期</th><th style="width:92px">状态</th></tr></thead>
          <tbody>
            <tr v-for="(it, i) in current.action_items" :key="it.id">
              <td class="num muted">{{ i + 1 }}</td>
              <td>{{ it.task_description }}</td>
              <td>{{ it.assignee_name || '—' }}</td>
              <td class="num muted">{{ it.due_date ? it.due_date.slice(0, 10) : '—' }}</td>
              <td>
                <span :class="['tag', statusTag(it.status)]">{{ it.status_label }}</span>
                <span v-if="it.converted_supervision_id" class="tag tag-teal" style="margin-left:4px">已转督办</span>
              </td>
            </tr>
          </tbody>
        </table>
        <div style="display:flex; gap:8px; margin-top:10px; align-items:center; flex-wrap:wrap">
          <input class="input" style="flex:1; min-width:200px" placeholder="议定事项描述，如：完善项目实施方案并报市政府审批" v-model="newItem.task_description">
          <input class="input" style="width:120px" placeholder="负责人" v-model="newItem.assignee_name">
          <input type="date" class="input" style="width:145px" v-model="newItem.due_date">
          <button class="btn btn-ghost" :disabled="submitting" @click="addActionItem"><ic name="plus" size="13"></ic>新增行动项</button>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showEdit = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="saveMinutes"><ic name="save" size="14"></ic>保存新版本</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
