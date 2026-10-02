/* /conference/affairs 政务会务统筹 — pixel replica of design/mockups/034-conference-affairs.png
   Layout: 5 KPI（按会议性质）/ filters + 统筹单列表 table + pager / 新建统筹单 modal + 详情 modal */
AppPages['/conference/affairs'] = {
  route: '/conference/affairs', title: '政务会务统筹', category: 'CONFERENCE', primaryAction: '新建统筹会议', icon: 'clipboard-list',
  subtitle: '统筹党组会、常务会、工作例会与外部研讨会等政务会议的方案、议程与保密管理。',
  component: {
    data() {
      return {
        loading: true,
        affairs: [],
        bookings: [],
        filters: { meeting_type: '', security_level: '', keyword: '' },
        pageNum: 1,
        pageSize: 10,
        showForm: false,
        submitting: false,
        detail: null,
        form: { booking_id: '', title: '', meeting_type: 'WORK', security_level: 'NORMAL', agenda_text: '' },
      };
    },
    computed: {
      filtered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        return this.affairs.filter((a) => {
          if (this.filters.meeting_type && a.meeting_type !== this.filters.meeting_type) return false;
          if (this.filters.security_level && a.security_level !== this.filters.security_level) return false;
          if (kw && !((a.title || '') + (a.agenda_text || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      pageTotal() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      shownRows() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      typeCounts() {
        const c = { PARTY_COMMITTEE: 0, EXECUTIVE: 0, WORK: 0, EXTERNAL: 0 };
        this.affairs.forEach((a) => { if (c[a.meeting_type] !== undefined) c[a.meeting_type]++; });
        return c;
      },
      bookable() { return this.bookings.filter((b) => b.status !== 'CANCELLED'); },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      bj(s) { return s ? String(s).slice(0, 16).replace('T', ' ') : '—'; },
      async load() {
        try {
          const r = await api.page('/api/conference/affairs', { pageNum: 1, pageSize: 200 });
          this.affairs = r.rows || [];
        } catch (e) { this.affairs = []; }
        try {
          const rb = await api.page('/api/conference/bookings', { pageNum: 1, pageSize: 200 });
          this.bookings = rb.rows || [];
        } catch (e) { this.bookings = []; }
      },
      typeTag(t) { return { PARTY_COMMITTEE: 'tag-red', EXECUTIVE: 'tag-amber', WORK: 'tag-blue', EXTERNAL: 'tag-teal' }[t] || 'tag-gray'; },
      typeIco(t) { return { PARTY_COMMITTEE: 'flag', EXECUTIVE: 'landmark', WORK: 'clipboard-list', EXTERNAL: 'users' }[t] || 'file-text'; },
      secTag(s) { return { TOP_SECRET: 'tag-red', CONFIDENTIAL: 'tag-amber', NORMAL: 'tag-green' }[s] || 'tag-gray'; },
      query() { this.pageNum = 1; },
      reset() { this.filters = { meeting_type: '', security_level: '', keyword: '' }; this.query(); },
      goPage(p) { if (p >= 1 && p <= this.pageCount) this.pageNum = p; },
      openForm() {
        this.form = { booking_id: '', title: '', meeting_type: 'WORK', security_level: 'NORMAL', agenda_text: '' };
        this.showForm = true;
      },
      async submitForm() {
        const f = this.form;
        if (!f.booking_id) return this.$root.toast('请选择关联的会议室预订', 'warn');
        if (!f.title.trim()) return this.$root.toast('请填写会议名称', 'warn');
        this.submitting = true;
        try {
          await api.post('/api/conference/affairs', {
            booking_id: f.booking_id, title: f.title.trim(), meeting_type: f.meeting_type,
            security_level: f.security_level, agenda_text: (f.agenda_text || '').trim() || undefined,
          });
          this.$root.toast('会务统筹单已创建', 'ok');
          this.showForm = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      onPrimary() { this.openForm(); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row (5) -->
      <div class="kpi-row kpi-row-5">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="clipboard-list" size="28"></ic></div>
          <div class="meta"><div class="label">统筹会议总数</div><div class="val" style="color:var(--primary)">{{ affairs.length }}</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="flag" size="28"></ic></div>
          <div class="meta"><div class="label">党组会议</div><div class="val" style="color:var(--red)">{{ typeCounts.PARTY_COMMITTEE }}</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="landmark" size="28"></ic></div>
          <div class="meta"><div class="label">常务会议</div><div class="val" style="color:var(--amber)">{{ typeCounts.EXECUTIVE }}</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="clipboard-list" size="28"></ic></div>
          <div class="meta"><div class="label">工作例会</div><div class="val" style="color:var(--teal)">{{ typeCounts.WORK }}</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="users" size="28"></ic></div>
          <div class="meta"><div class="label">外部研讨会</div><div class="val" style="color:var(--primary)">{{ typeCounts.EXTERNAL }}</div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <!-- list -->
      <div class="card mt16">
        <div class="card-hd"><div class="t">会务统筹单</div><span class="muted" style="font-size:12px">共 {{ pageTotal }} 条</span></div>
        <div class="card-bd" style="padding-top:10px">
          <div class="filters">
            <select class="select" style="width:150px" v-model="filters.meeting_type" @change="query">
              <option value="">全部会议性质</option>
              <option value="PARTY_COMMITTEE">党组会</option>
              <option value="EXECUTIVE">常务会</option>
              <option value="WORK">工作例会</option>
              <option value="EXTERNAL">外部研讨会</option>
            </select>
            <select class="select" style="width:140px" v-model="filters.security_level" @change="query">
              <option value="">全部保密级别</option>
              <option value="TOP_SECRET">涉密</option>
              <option value="CONFIDENTIAL">秘密</option>
              <option value="NORMAL">非密</option>
            </select>
            <input class="input" style="flex:1; min-width:180px" placeholder="请输入会议名称或议程关键词" v-model="filters.keyword" @keyup.enter="query">
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr><th>会议名称</th><th style="width:110px">会议性质</th><th style="width:92px">保密级别</th><th>议程摘要</th><th>关联预订时间</th><th style="width:88px">操作</th></tr></thead>
            <tbody>
              <tr v-for="a in shownRows" :key="a.affair_id">
                <td class="strong ell" style="max-width:200px" :title="a.title">{{ a.title }}</td>
                <td><span :class="['tag', typeTag(a.meeting_type)]"><ic :name="typeIco(a.meeting_type)" size="12"></ic>{{ a.meeting_type_label }}</span></td>
                <td><span :class="['tag', secTag(a.security_level)]">{{ a.security_level_label }}</span></td>
                <td class="muted ell" style="max-width:230px" :title="a.agenda_text">{{ a.agenda_text || '暂无议程' }}</td>
                <td class="num muted">
                  <div class="ell" style="max-width:220px" :title="a.booking_title || ''">{{ a.booking_title || '—' }}</div>
                  <div style="font-size:12px">{{ bj(a.start_time) }} ~ {{ bj(a.end_time).slice(11) }}</div>
                </td>
                <td class="actions"><button class="btn btn-text btn-sm" @click="detail = a">查看</button></td>
              </tr>
              <tr v-if="!shownRows.length"><td colspan="6"><div class="empty">暂无会务统筹单，点击右上角「新建统筹会议」创建</div></td></tr>
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
      <Modal title="新建会务统筹单" width="580px" v-if="showForm" @close="showForm = false">
        <div class="form-item">
          <label class="req">关联预订</label>
          <select class="select" v-model="form.booking_id">
            <option value="">请选择会议室预订</option>
            <option v-for="b in bookable" :key="b.booking_id" :value="b.booking_id">
              {{ b.title }}（{{ b.room_name }} {{ bj(b.start_time).slice(5, 16) }}）
            </option>
          </select>
        </div>
        <div class="form-item">
          <label class="req">会议名称</label>
          <input class="input" placeholder="如：市政府党组会议（第18次）" v-model="form.title">
        </div>
        <div class="form-item">
          <label class="req">会议性质</label>
          <div class="type-pick" style="flex:1">
            <span class="tp" :class="{ on: form.meeting_type === 'PARTY_COMMITTEE' }" @click="form.meeting_type = 'PARTY_COMMITTEE'"><ic name="flag" size="13"></ic> 党组会</span>
            <span class="tp" :class="{ on: form.meeting_type === 'EXECUTIVE' }" @click="form.meeting_type = 'EXECUTIVE'"><ic name="landmark" size="13"></ic> 常务会</span>
            <span class="tp" :class="{ on: form.meeting_type === 'WORK' }" @click="form.meeting_type = 'WORK'"><ic name="clipboard-list" size="13"></ic> 工作例会</span>
            <span class="tp" :class="{ on: form.meeting_type === 'EXTERNAL' }" @click="form.meeting_type = 'EXTERNAL'"><ic name="users" size="13"></ic> 外部研讨会</span>
          </div>
        </div>
        <div class="form-item">
          <label class="req">保密级别</label>
          <div style="flex:1; display:flex; gap:18px; padding-top:8px">
            <label class="radio-dot"><input type="radio" value="TOP_SECRET" v-model="form.security_level">涉密</label>
            <label class="radio-dot"><input type="radio" value="CONFIDENTIAL" v-model="form.security_level">秘密</label>
            <label class="radio-dot"><input type="radio" value="NORMAL" v-model="form.security_level">非密</label>
          </div>
        </div>
        <div class="form-item">
          <label>会议议程</label>
          <textarea class="input" rows="5" placeholder="请输入议程安排，每行一项，如：&#10;09:00-09:10 会议签到、宣布会议开始&#10;09:10-09:30 传达学习上级有关文件精神" v-model="form.agenda_text"></textarea>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showForm = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitForm">创建统筹单</button>
        </template>
      </Modal>

      <!-- detail modal -->
      <Modal title="会务统筹单详情" width="560px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">会议名称</span><span class="strong">{{ detail.title }}</span>
          <span class="k">会议性质</span><span><span :class="['tag', typeTag(detail.meeting_type)]">{{ detail.meeting_type_label }}</span></span>
          <span class="k">保密级别</span><span><span :class="['tag', secTag(detail.security_level)]">{{ detail.security_level_label }}</span></span>
          <span class="k">关联预订</span><span>{{ detail.booking_title || '—' }}</span>
          <span class="k">会议室</span><span>{{ detail.room_name || '—' }}</span>
          <span class="k">会议时间</span><span class="num">{{ bj(detail.start_time) }} ~ {{ bj(detail.end_time) }}</span>
          <span class="k">创建时间</span><span class="num">{{ bj(detail.created_at) }}</span>
        </div>
        <div class="strong" style="margin:12px 0 6px">会议议程</div>
        <div class="agenda-box">{{ detail.agenda_text || '暂无议程安排' }}</div>
        <template #footer>
          <button class="btn btn-ghost" @click="detail = null">关闭</button>
          <button class="btn btn-primary" @click="$root.go('/conference/attendees'); detail = null">管理参会人员</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
