/* /portal/notifications 消息通知 — pixel replica of design/mockups/004-portal-notifications.png
   Layout: 4 category stat cards / (通知列表: tabs+全部已读+状态筛选 | 通知详情面板) */
AppPages['/portal/notifications'] = {
  route: '/portal/notifications', title: '消息通知', category: 'PORTAL', primaryAction: '通知设置',
  subtitle: '及时获取审批、预警、会议及系统通知，掌握最新工作动态。',
  icon: 'bell',
  component: {
    data() {
      return {
        loading: true,
        items: [],
        unread: 0,
        tab: 'all',
        readSel: '',
        page: 1, pageSize: 10,
        selIds: [],
        sel: null,
        marking: false,
        tabs: [
          { key: 'all', label: '全部' },
          { key: 'approval', label: '审批提醒' },
          { key: 'warn', label: '红黄预警' },
          { key: 'meeting', label: '会议通知' },
          { key: 'system', label: '系统通知' },
        ],
        catMeta: {
          approval: { label: '审批提醒', icon: 'clipboard-list', cls: 'ico-blue' },
          warn: { label: '红黄预警', icon: 'siren', cls: 'ico-red' },
          meeting: { label: '会议通知', icon: 'calendar-days', cls: 'ico-teal' },
          system: { label: '系统通知', icon: 'megaphone', cls: 'ico-blue' },
        },
      };
    },
    computed: {
      catCount() {
        const c = { approval: 0, warn: 0, meeting: 0, system: 0 };
        this.items.forEach((n) => { c[this.catOf(n)]++; });
        return c;
      },
      unreadOf() {
        const c = { approval: 0, warn: 0, meeting: 0, system: 0 };
        this.items.forEach((n) => { if (!n.is_read) c[this.catOf(n)]++; });
        return c;
      },
      filtered() {
        return this.items.filter((n) => {
          if (this.tab !== 'all' && this.catOf(n) !== this.tab) return false;
          if (this.readSel === 'unread' && n.is_read) return false;
          if (this.readSel === 'read' && !n.is_read) return false;
          return true;
        });
      },
      total() { return this.filtered.length; },
      totalPages() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
      paged() {
        const p = Math.min(this.page, this.totalPages);
        return this.filtered.slice((p - 1) * this.pageSize, p * this.pageSize);
      },
      pagesToShow() {
        const arr = [];
        const s = Math.max(1, Math.min(this.page - 2, this.totalPages - 4));
        for (let i = s; i <= Math.min(this.totalPages, s + 4); i++) arr.push(i);
        return arr;
      },
      checkedRows() { return this.items.filter((n) => this.selIds.includes(n.notice_id) && !n.is_read); },
    },
    async mounted() { await this.load(); },
    methods: {
      catOf(n) {
        if (n.notice_type === 'WARNING' || n.notice_type === 'URGENT') return 'warn';
        const s = (n.source_module || '') + (n.title || '') + (n.link || '');
        if (s.indexOf('会议') >= 0 || s.indexOf('conference') >= 0) return 'meeting';
        if ((n.title || '').indexOf('审批') >= 0 || (n.title || '').indexOf('审核') >= 0 || (n.title || '').indexOf('待您') >= 0) return 'approval';
        return 'system';
      },
      rowIcon(n) {
        if (n.notice_type === 'URGENT') return { icon: 'siren', cls: 'ico-red' };
        if (n.notice_type === 'WARNING') return { icon: 'alert-triangle', cls: 'ico-amber' };
        return this.catMeta[this.catOf(n)];
      },
      typeLabel(t) { return { INFO: '通知', WARNING: '预警', URGENT: '紧急' }[t] || t || '通知'; },
      typeTag(t) { return { INFO: 'tag-blue', WARNING: 'tag-amber', URGENT: 'tag-red' }[t] || 'tag-gray'; },
      fmtTime(iso) {
        if (!iso) return '—';
        const d = new Date(iso);
        if (isNaN(d)) return iso.slice(0, 16).replace('T', ' ');
        const pad = (x) => String(x).padStart(2, '0');
        const hm = pad(d.getHours()) + ':' + pad(d.getMinutes());
        const now = new Date();
        const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
        const diff = (day(now) - day(d)) / 86400000;
        if (diff === 0) return '今天 ' + hm;
        if (diff === 1) return '昨天 ' + hm;
        return (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + hm;
      },
      fmtFull(iso) { return iso ? iso.slice(0, 16).replace('T', ' ') : '—'; },
      async load(keepSel) {
        try {
          const d = await api.get('/api/portal/notifications');
          this.items = d.items || [];
          this.unread = d.unread || 0;
        } catch (e) { this.items = []; }
        this.loading = false;
        if (this.page > this.totalPages) this.page = this.totalPages;
        if (keepSel && this.sel) {
          const again = this.items.find((n) => n.notice_id === this.sel.notice_id);
          this.sel = again || null;
        } else if (!this.sel) {
          this.sel = this.paged[0] || null;
        }
      },
      setTab(k) { this.tab = k; this.page = 1; this.selIds = []; },
      goPage(p) { this.page = Math.min(Math.max(1, p), this.totalPages); },
      selectRow(n) { this.sel = n; },
      toggleAll() {
        if (this.selIds.length === this.paged.length) this.selIds = [];
        else this.selIds = this.paged.map((n) => n.notice_id);
      },
      async markRead(rows) {
        const targets = (rows && rows.length ? rows : []).filter((n) => !n.is_read);
        if (!targets.length) return;
        this.marking = true;
        try {
          for (const n of targets) {
            await api.post('/api/portal/notifications/' + n.notice_id + '/read');
          }
          window.App && window.App.toast('已标记为已读', 'ok');
          this.selIds = [];
          await this.load(true);
          window.App && window.App.refreshBadges && window.App.refreshBadges();
        } catch (e) { /* toast shown */ }
        this.marking = false;
      },
      async markSingle() {
        if (!this.sel || this.sel.is_read || this.marking) return;
        this.marking = true;
        try {
          await api.post('/api/portal/notifications/' + this.sel.notice_id + '/read');
          window.App && window.App.toast('已标记为已读', 'ok');
          await this.load(true);
          window.App && window.App.refreshBadges && window.App.refreshBadges();
        } catch (e) { /* toast shown */ }
        this.marking = false;
      },
      async markAll() {
        if (this.marking) return;
        this.marking = true;
        try {
          await api.post('/api/portal/notifications/read-all');
          window.App && window.App.toast('全部通知已标为已读', 'ok');
          this.selIds = [];
          await this.load(true);
          window.App && window.App.refreshBadges && window.App.refreshBadges();
        } catch (e) { /* toast shown */ }
        this.marking = false;
      },
      goLink() {
        if (this.sel && this.sel.link) location.hash = '#' + this.sel.link;
        else window.App && window.App.toast('该通知暂无关联页面', 'warn');
      },
      onPrimary() { window.App && window.App.toast('通知渠道请在「系统管理 → 系统参数配置」中设置', 'warn'); },
    },
    template: `
    <div v-if="!loading">
      <!-- category stat cards -->
      <div class="kpi-row">
        <div class="card kpi-card" v-for="tb in tabs.filter(t => t.key !== 'all')" :key="tb.key"
             @click="setTab(tb.key)" :style="tab===tb.key ? 'border-color:var(--primary)' : ''">
          <div class="ico" :class="catMeta[tb.key].cls"><ic :name="catMeta[tb.key].icon" size="26"></ic></div>
          <div class="meta">
            <div class="label">{{ catMeta[tb.key].label }}</div>
            <div class="val" :style="{color: tb.key==='warn' ? 'var(--red)' : tb.key==='meeting' ? 'var(--teal)' : 'var(--primary)'}">{{ catCount[tb.key] }}</div>
          </div>
          <div style="text-align:right; flex:none">
            <div class="muted" style="font-size:12px">未读 <b style="color:var(--red)">{{ unreadOf[tb.key] }}</b></div>
          </div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="ntf-layout">
        <!-- left: notification list -->
        <div class="card" style="margin-top:0">
          <div style="display:flex; align-items:center; padding:0 14px; border-bottom:1px solid var(--line)">
            <div class="pg-tabs" style="flex:1; padding:0; border-bottom:none">
              <span v-for="tb in tabs" :key="tb.key" class="pg-tab" :class="{on: tab===tb.key}" @click="setTab(tb.key)">
                {{ tb.label }} <span class="cnt" v-if="tb.key==='all'">({{ items.length }})</span><span class="cnt" v-else>({{ catCount[tb.key] }})</span>
              </span>
            </div>
            <button class="btn btn-sm" style="margin-right:8px" :disabled="!checkedRows.length || marking" @click="markRead(checkedRows)">
              <ic name="check" size="13"></ic> 标记已读
            </button>
            <button class="btn btn-primary btn-sm" :disabled="!unread || marking" @click="markAll">全部已读</button>
            <select class="select" v-model="readSel" style="width:104px; margin-left:8px; font-size:12px">
              <option value="">全部状态</option>
              <option value="unread">未读</option>
              <option value="read">已读</option>
            </select>
          </div>
          <div>
            <div v-for="n in paged" :key="n.notice_id" class="ntf-row"
                 :class="{sel: sel && sel.notice_id===n.notice_id, unread: !n.is_read}" @click="selectRow(n)">
              <input type="checkbox" :value="n.notice_id" v-model="selIds" @click.stop>
              <span class="ntf-dot"></span>
              <span class="ico-box" :class="rowIcon(n).cls" style="display:inline-flex;width:28px;height:28px;border-radius:7px;align-items:center;justify-content:center;flex:none">
                <ic :name="rowIcon(n).icon" size="15"></ic>
              </span>
              <span class="ntf-title" :title="n.title">{{ n.title }}</span>
              <span class="ntf-content">{{ n.content }}</span>
              <span :class="['tag', typeTag(n.notice_type)]">{{ typeLabel(n.notice_type) }}</span>
              <span class="ntf-time">{{ fmtTime(n.created_at) }}</span>
              <span :class="['tag', n.is_read ? 'tag-gray' : 'tag-red']" style="width:46px; justify-content:center">{{ n.is_read ? '已读' : '未读' }}</span>
            </div>
            <div v-if="!paged.length" class="empty">暂无通知消息</div>
          </div>
          <div style="display:flex; align-items:center; justify-content:flex-end; gap:6px; padding:12px 14px 10px">
            <span class="muted" style="font-size:12.5px; margin-right:auto">共 {{ total }} 条 · 未读 {{ unread }} 条</span>
            <div class="pager" style="padding:0">
              <span class="pg" @click="goPage(page-1)"><ic name="chevron-left" size="14"></ic></span>
              <span v-for="p in pagesToShow" :key="p" class="pg" :class="{on: p===page}" @click="goPage(p)">{{ p }}</span>
              <span class="pg" @click="goPage(page+1)"><ic name="chevron-right" size="14"></ic></span>
            </div>
            <select class="select" v-model.number="pageSize" style="width:96px; font-size:12px">
              <option :value="10">10 条/页</option>
              <option :value="20">20 条/页</option>
              <option :value="50">50 条/页</option>
            </select>
          </div>
        </div>

        <!-- right: notification detail -->
        <div class="card" style="margin-top:0; position:sticky; top:72px">
          <div class="card-hd">
            <div class="t">通知详情</div>
            <ic name="more-horizontal" size="16" style="color:var(--text-3)"></ic>
          </div>
          <template v-if="sel">
            <div class="card-bd" style="padding-top:10px">
              <div style="display:flex; align-items:center; gap:8px">
                <span class="strong" style="font-size:16px; flex:1">{{ sel.title }}</span>
                <span :class="['tag', sel.is_read ? 'tag-gray' : 'tag-red']">{{ sel.is_read ? '已读' : '未读' }}</span>
              </div>
              <div style="display:flex; align-items:center; gap:8px; margin-top:8px; color:var(--text-3); font-size:12px">
                <span class="ico-box" :class="rowIcon(sel).cls" style="display:inline-flex;width:22px;height:22px;border-radius:6px;align-items:center;justify-content:center">
                  <ic :name="rowIcon(sel).icon" size="13"></ic>
                </span>
                <span>{{ sel.source_module || '系统平台' }}</span>
                <span style="margin-left:auto">{{ fmtFull(sel.created_at) }}</span>
              </div>
              <div style="font-size:13px; line-height:1.9; color:var(--text-2); margin-top:12px">{{ sel.content || '（无正文内容）' }}</div>

              <div class="dtl-box" style="margin-top:14px">
                <span class="k">通知类型</span>
                <span><span :class="['tag', typeTag(sel.notice_type)]">{{ typeLabel(sel.notice_type) }}</span></span>
                <span class="k">来源模块</span>
                <span>{{ sel.source_module || '系统平台' }}</span>
                <span class="k">关联事项</span>
                <span>
                  <a v-if="sel.link" style="cursor:pointer" @click="goLink">前往处理 <ic name="chevron-right" size="12"></ic></a>
                  <span v-else class="muted">—</span>
                </span>
              </div>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:10px; padding:12px 18px; border-top:1px solid var(--line)">
              <button class="btn btn-primary" @click="goLink"><ic name="link" size="14"></ic> 查看详情</button>
              <button class="btn" :disabled="sel.is_read || marking" @click="markSingle"><ic name="check" size="14"></ic> 标为已读</button>
              <button class="btn" @click="sel = null">稍后处理</button>
            </div>
          </template>
          <div v-else class="empty" style="padding:90px 20px">
            <ic name="bell" size="36" style="color:#C2CFDD"></ic>
            <div style="margin-top:10px">请在左侧选择通知<br>查看消息详情</div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
