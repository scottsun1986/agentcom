/* /system/log 安全审计与日志 — pixel replica of design/mockups/076-system-log.png
   Layout: 操作日志/登录日志 tabs + 筛选 + KPI + 日志表格 + 分页 + 详情弹窗（请求参数代码块） */
AppPages['/system/log'] = {
  route: '/system/log', title: '安全审计与日志', category: 'SYSTEM', primaryAction: null, icon: 'history',
  subtitle: '记录系统操作行为与登录信息，支持按条件查询与追溯，保障平台安全合规运行。',
  component: {
    data() {
      return {
        loading: true,
        tab: 'oper',
        rows: [], total: 0, pageNum: 1, pageSize: 15,
        filters: { keyword: '', business_type: '' },
        stats: { today: 0, err: 0, avg: 0, total: 0 },
        detail: null,
        btMap: { '1': '其它', '2': '新增', '3': '修改', '4': '删除', '5': '授权', '6': '导出', '7': '导入', '8': '强退', '9': '生成', '10': '清空' },
      };
    },
    computed: {
      pageCount() { return Math.max(1, Math.ceil(this.total / this.pageSize)); },
    },
    async mounted() {
      await Promise.all([this.load(), this.loadStats()]);
      this.loading = false;
    },
    methods: {
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes()) + ':' + p(t.getUTCSeconds());
      },
      async load() {
        try {
          const r = await api.page('/api/system/logs', {
            keyword: this.filters.keyword, business_type: this.filters.business_type,
            pageNum: this.pageNum, pageSize: this.pageSize,
          });
          this.rows = r.rows || [];
          this.total = r.total || 0;
        } catch (e) { this.rows = []; this.total = 0; }
      },
      async loadStats() {
        try {
          const r = await api.page('/api/system/logs', { pageNum: 1, pageSize: 1000 });
          const rows = r.rows || [];
          const today = new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
          let todayN = 0, errN = 0, costSum = 0;
          rows.forEach((l) => {
            const d = new Date(l.oper_time);
            if (!isNaN(d.getTime()) && new Date(d.getTime() + 8 * 3600000).toISOString().slice(0, 10) === today) todayN++;
            if (l.status !== 0 && l.status !== '0') errN++;
            costSum += Number(l.cost_time) || 0;
          });
          this.stats = { today: todayN, err: errN, avg: rows.length ? Math.round(costSum / rows.length) : 0, total: r.total || rows.length };
        } catch (e) { this.stats = { today: 0, err: 0, avg: 0, total: 0 }; }
      },
      query() { this.pageNum = 1; this.load(); },
      reset() { this.filters = { keyword: '', business_type: '' }; this.query(); },
      goPage(p) { if (p < 1 || p > this.pageCount) return; this.pageNum = p; this.load(); },
      changeSize() { this.pageNum = 1; this.load(); },
      btLabel(t) { return this.btMap[String(t)] || '其它'; },
      btTag(t) {
        return { '2': 'tag-blue', '3': 'tag-teal', '4': 'tag-red', '5': 'tag-amber' }[String(t)] || 'tag-gray';
      },
      statusTag(s) { return (s === 0 || s === '0') ? 'tag-green' : 'tag-red'; },
      statusLabel(s) { return (s === 0 || s === '0') ? '成功' : '失败'; },
      async copyText(t) {
        try { await navigator.clipboard.writeText(t); this.$root.toast('已复制到剪贴板', 'ok'); }
        catch (e) {
          const ta = document.createElement('textarea');
          ta.value = t; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); this.$root.toast('已复制到剪贴板', 'ok'); } catch (e2) { this.$root.toast('复制失败，请手动选择复制', 'err'); }
          document.body.removeChild(ta);
        }
      },
      onPrimary() { /* no primary action */ },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI -->
      <div class="kpi-row">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="clipboard-list" size="28"></ic></div>
          <div class="meta"><div class="label">今日操作数</div><div class="val" style="color:var(--primary)">{{ stats.today }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">次</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="shield-alert" size="28"></ic></div>
          <div class="meta"><div class="label">异常操作</div><div class="val" style="color:var(--red)">{{ stats.err }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">次</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="timer" size="28"></ic></div>
          <div class="meta"><div class="label">平均耗时</div><div class="val" style="color:var(--teal)">{{ stats.avg }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">ms</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="database" size="28"></ic></div>
          <div class="meta"><div class="label">日志总数</div><div class="val" style="color:var(--amber)">{{ stats.total }} <span style="font-size:14px;font-weight:400;color:var(--text-3)">条</span></div></div>
        </div>
      </div>

      <!-- log table -->
      <div class="card">
        <div class="card-hd" style="padding-bottom:0; display:block">
          <div class="lr-tabs" style="margin:0">
            <span :class="['lr-tab', tab === 'oper' ? 'on' : '']" @click="tab = 'oper'">操作日志</span>
            <span :class="['lr-tab', tab === 'login' ? 'on' : '']" @click="tab = 'login'">登录日志</span>
          </div>
        </div>
        <div class="card-bd" v-if="tab === 'oper'">
          <div class="filters" style="margin-bottom:10px">
            <input class="input" style="width:250px" placeholder="请输入操作模块或操作人关键词" v-model="filters.keyword" @keyup.enter="query">
            <select class="select" style="width:140px" v-model="filters.business_type">
              <option value="">全部操作类型</option>
              <option value="2">新增</option><option value="3">修改</option><option value="4">删除</option>
              <option value="5">授权</option><option value="6">导出</option><option value="1">其它</option>
            </select>
            <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
            <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
          </div>
          <table class="table">
            <thead><tr>
              <th>发生时间</th><th>请求模块</th><th style="width:76px">操作类型</th><th>调用方法</th><th>操作人</th><th>操作人 IP</th><th style="width:80px">耗时(ms)</th><th style="width:74px">状态</th><th style="width:64px">操作</th>
            </tr></thead>
            <tbody>
              <tr v-for="l in rows" :key="l.oper_id" style="cursor:pointer" @click="detail = l">
                <td class="num muted" style="white-space:nowrap">{{ bj(l.oper_time) }}</td>
                <td class="strong">{{ l.title }}</td>
                <td><span :class="['tag', btTag(l.business_type)]">{{ btLabel(l.business_type) }}</span></td>
                <td class="mono muted ellipsis" style="max-width:250px">{{ l.request_method }} {{ l.oper_url }}</td>
                <td>{{ l.oper_name }}</td>
                <td class="mono muted">{{ l.oper_ip }}</td>
                <td class="num" :style="(l.cost_time || 0) > 1000 ? 'color:var(--red); font-weight:600' : ''">{{ l.cost_time }}</td>
                <td><span :class="['tag', statusTag(l.status)]">{{ statusLabel(l.status) }}</span></td>
                <td class="actions" @click.stop><button class="btn btn-text btn-sm" @click="detail = l">查看</button></td>
              </tr>
              <tr v-if="!rows.length"><td colspan="9"><div class="empty">暂无操作日志</div></td></tr>
            </tbody>
          </table>
          <div class="pager">
            <span>共 {{ total }} 条</span>
            <select class="select" style="width:96px; height:28px; font-size:12px" v-model.number="pageSize" @change="changeSize">
              <option :value="15">15条/页</option><option :value="30">30条/页</option><option :value="50">50条/页</option>
            </select>
            <button class="pg" :disabled="pageNum <= 1" @click="goPage(pageNum - 1)"><ic name="chevron-left" size="14"></ic></button>
            <button v-for="p in pageCount" :key="p" v-show="pageCount <= 7 || p === 1 || p === pageCount || Math.abs(p - pageNum) <= 1"
                    class="pg" :class="{on: p === pageNum}" @click="goPage(p)">{{ p }}</button>
            <button class="pg" :disabled="pageNum >= pageCount" @click="goPage(pageNum + 1)"><ic name="chevron-right" size="14"></ic></button>
          </div>
        </div>
        <div class="card-bd" v-else>
          <div class="empty" style="padding:70px 0">
            <ic name="lock" size="30" style="display:block; margin:0 auto 10px; color:#B6C3D2"></ic>
            登录日志暂未接入采集，当前仅记录操作日志
          </div>
        </div>
      </div>

      <!-- detail modal -->
      <Modal title="操作详情" width="620px" v-if="detail" @close="detail = null">
        <div class="desc-list">
          <span class="k">发生时间</span><span class="num">{{ bj(detail.oper_time) }}</span>
          <span class="k">操作人</span><span class="strong">{{ detail.oper_name }}</span>
          <span class="k">操作人 IP</span><span class="mono">{{ detail.oper_ip }}</span>
          <span class="k">请求模块</span><span>{{ detail.title }}</span>
          <span class="k">操作类型</span><span><span :class="['tag', btTag(detail.business_type)]">{{ btLabel(detail.business_type) }}</span></span>
          <span class="k">调用方法</span><span class="mono muted">{{ detail.method || '—' }}</span>
          <span class="k">请求方式</span><span class="mono">{{ detail.request_method }} {{ detail.oper_url }}</span>
          <span class="k">操作耗时</span><span class="num">{{ detail.cost_time }} ms</span>
          <span class="k">操作状态</span><span><span :class="['tag', statusTag(detail.status)]">{{ statusLabel(detail.status) }}</span></span>
        </div>
        <div class="sec-title" style="display:flex; align-items:center; justify-content:space-between">
          <span style="display:flex; align-items:center; gap:6px"><ic name="file-code-2" size="14"></ic>请求参数（已截断展示）</span>
          <button class="btn btn-ghost btn-sm" @click="copyText(detail.oper_param || '')"><ic name="copy" size="12"></ic>复制</button>
        </div>
        <div class="code-block">{{ detail.oper_param || '（该操作未记录请求参数）' }}</div>
        <template #footer>
          <button class="btn btn-ghost" @click="detail = null">关闭</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
