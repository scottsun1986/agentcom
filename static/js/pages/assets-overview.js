/* /assets/overview 资产全景看板 — pixel replica of design/mockups/013-assets-overview.png
   Layout: greeting / 6 KPI cards / (资产生命周期分布 donut | 分类价值占比 CSS bars) / (低库存预警 | 近期维保) */
AppPages['/assets/overview'] = {
  route: '/assets/overview', title: '资产全景看板', category: 'ASSETS', primaryAction: '新增资产', icon: 'gauge',
  component: {
    data() {
      return {
        loading: true,
        greeting: '',
        kpi: { total_assets: 0, total_value: 0, in_use_rate: 0, idle_rate: 0, in_repair_count: 0, month_depreciation: 0, month: '', consumable_alert: 0, consumable_total: 0 },
        statusCounts: { IN_STOCK: 0, IN_USE: 0, BORROWED: 0, IN_REPAIR: 0, SCRAPPED: 0 },
        catMonth: '',
        catValues: [],
        lowStock: [],
        maintenance: [],
      };
    },
    computed: {
      statusTotal() { return Number(this.kpi.total_assets) || 0; },
      hourGreet() {
        const h = new Date().getHours();
        if (h < 6) return '凌晨好';
        if (h < 12) return '上午好';
        if (h < 14) return '中午好';
        if (h < 18) return '下午好';
        return '晚上好';
      },
      todayText() {
        const d = new Date();
        const wd = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'][d.getDay()];
        return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日 ' + wd;
      },
      donutSegs() {
        const c = this.statusCounts, t = this.statusTotal;
        return [
          { key: 'IN_USE', label: '在用', color: '#246BFD', count: c.IN_USE || 0 },
          { key: 'IN_STOCK', label: '在库（闲置）', color: '#13A89E', count: c.IN_STOCK || 0 },
          { key: 'BORROWED', label: '借出', color: '#F59E0B', count: c.BORROWED || 0 },
          { key: 'IN_REPAIR', label: '维修中', color: '#E5484D', count: c.IN_REPAIR || 0 },
          { key: 'SCRAPPED', label: '已报废', color: '#8B5CF6', count: c.SCRAPPED || 0 },
        ].map((s) => Object.assign({}, s, { pct: t ? Math.round(s.count / t * 1000) / 10 : 0 }));
      },
      donutStyle() {
        const total = this.statusTotal;
        if (!total) return { background: '#EEF2F7' };
        let acc = 0;
        const parts = [];
        this.donutSegs.forEach((s) => {
          const from = (acc / total) * 360;
          acc += s.count;
          const to = (acc / total) * 360;
          if (to > from) parts.push(s.color + ' ' + from.toFixed(2) + 'deg ' + to.toFixed(2) + 'deg');
        });
        return parts.length ? { background: 'conic-gradient(' + parts.join(', ') + ')' } : { background: '#EEF2F7' };
      },
      maxCatValue() {
        return Math.max(0, ...this.catValues.map((c) => Number(c.total_price) || 0));
      },
    },
    async mounted() {
      const u = api.cachedUser();
      this.greeting = (u && u.nick_name) || '';
      const jobs = [
        api.get('/api/assets/overview').then((d) => {
          this.kpi = Object.assign(this.kpi, d);
          this.statusCounts = d.status_counts || this.statusCounts;
        }).catch(() => {}),
        api.get('/api/assets/depreciation').then((d) => {
          this.catMonth = d.month || '';
          this.catValues = (d.categories || []).slice().sort((a, b) => (b.total_price || 0) - (a.total_price || 0)).slice(0, 7);
        }).catch(() => {}),
        api.page('/api/assets/consumables', { low_stock: 'true', pageNum: 1, pageSize: 6 }).then((r) => { this.lowStock = r.rows || []; }).catch(() => {}),
        api.page('/api/assets/maintenance', { pageNum: 1, pageSize: 6 }).then((r) => { this.maintenance = r.rows || []; }).catch(() => {}),
      ];
      await Promise.all(jobs);
      this.loading = false;
    },
    methods: {
      bj(s) {
        if (!s) return '—';
        const d = new Date(s);
        if (isNaN(d.getTime())) return String(s);
        const t = new Date(d.getTime() + 8 * 3600000);
        const p = (n) => String(n).padStart(2, '0');
        return t.getUTCFullYear() + '-' + p(t.getUTCMonth() + 1) + '-' + p(t.getUTCDate()) + ' ' + p(t.getUTCHours()) + ':' + p(t.getUTCMinutes());
      },
      money(v) { return Number(v || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
      wan(v) { return (Number(v || 0) / 10000).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); },
      num(v) { return Number(v || 0).toLocaleString(); },
      logTag(s) { return { IN_REPAIR: 'tag-blue', FIXED: 'tag-green', SCRAPPED: 'tag-red' }[s] || 'tag-gray'; },
      barW(v) {
        const mx = this.maxCatValue;
        return mx ? Math.max(3, Math.round((Number(v) || 0) / mx * 100)) + '%' : '0%';
      },
      barColor(i) { return ['var(--primary)', 'var(--teal)', 'var(--amber)'][i % 3]; },
      onPrimary() { this.$root.go('/assets/inbound'); },
    },
    template: `
    <div v-if="!loading">
      <!-- greeting -->
      <div class="page-sub" style="margin-bottom:14px; font-size:14px">
        <b>{{ greeting }}，{{ hourGreet }}！</b>　今天是 {{ todayText }}，资产运行平稳，各项指标正常。
      </div>

      <!-- KPI row (6) -->
      <div class="ast-kpi6">
        <div class="card ast-kpi">
          <span class="ico ico-blue"><ic name="database" size="22"></ic></span>
          <div style="min-width:0">
            <div class="label">固定资产总值</div>
            <div class="val">{{ wan(kpi.total_value) }} <span style="font-size:12px;font-weight:400;color:var(--text-3)">万元</span></div>
            <div class="sub muted">资产总数 {{ num(kpi.total_assets) }} 台/件</div>
          </div>
        </div>
        <div class="card ast-kpi">
          <span class="ico ico-teal"><ic name="pie-chart" size="22"></ic></span>
          <div style="min-width:0">
            <div class="label">在用率</div>
            <div class="val" style="color:var(--teal)">{{ kpi.in_use_rate }}<span style="font-size:14px">%</span></div>
            <div class="sub muted">在用 {{ num(statusCounts.IN_USE) }} 台/件</div>
          </div>
        </div>
        <div class="card ast-kpi">
          <span class="ico ico-amber"><ic name="pie-chart" size="22"></ic></span>
          <div style="min-width:0">
            <div class="label">闲置率</div>
            <div class="val" style="color:#C77F06">{{ kpi.idle_rate }}<span style="font-size:14px">%</span></div>
            <div class="sub muted">在库 {{ num(statusCounts.IN_STOCK) }} 台/件</div>
          </div>
        </div>
        <div class="card ast-kpi">
          <span class="ico ico-red"><ic name="wrench" size="22"></ic></span>
          <div style="min-width:0">
            <div class="label">待维修数</div>
            <div class="val" style="color:var(--red)">{{ num(kpi.in_repair_count) }}</div>
            <div class="sub muted">报修-维修-完结闭环</div>
          </div>
        </div>
        <div class="card ast-kpi">
          <span class="ico ico-blue"><ic name="wallet" size="22"></ic></span>
          <div style="min-width:0">
            <div class="label">本月折旧额</div>
            <div class="val" style="color:var(--primary)">{{ wan(kpi.month_depreciation) }} <span style="font-size:12px;font-weight:400;color:var(--text-3)">万元</span></div>
            <div class="sub muted">平均年限法5年 · {{ kpi.month || '—' }}</div>
          </div>
        </div>
        <div class="card ast-kpi">
          <span class="ico ico-red"><ic name="siren" size="22"></ic></span>
          <div style="min-width:0">
            <div class="label">耗材预警指数</div>
            <div class="val" :style="{ color: kpi.consumable_alert > 0 ? 'var(--red)' : 'var(--teal)' }">{{ num(kpi.consumable_alert) }}</div>
            <div class="sub muted">耗材目录共 {{ num(kpi.consumable_total) }} 项</div>
          </div>
        </div>
      </div>

      <div class="split-3-2">
        <!-- lifecycle donut -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">资产生命周期分布</div>
            <span class="more" @click="$root.go('/assets/ledger')">查看详情 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd">
            <div class="ast-donut-wrap">
              <div class="ast-donut" :style="donutStyle">
                <div class="ast-donut-hole">
                  <b>{{ num(statusTotal) }}</b>
                  <span class="muted" style="font-size:11.5px">资产总数（台/件）</span>
                </div>
              </div>
              <div class="ast-legend">
                <div class="ast-legend-row" v-for="s in donutSegs" :key="s.key">
                  <i :style="{ background: s.color }"></i><span>{{ s.label }}</span>
                  <span class="n strong">{{ num(s.count) }}</span>
                  <span class="p">{{ s.pct }}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- category value bars -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">分类价值占比</div>
            <span class="more" @click="$root.go('/assets/depreciation-scrap')">折旧明细 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd">
            <div class="muted" style="font-size:12px; margin-bottom:2px">按资产分类的原值合计（{{ catMonth || '本月' }}）</div>
            <div class="ast-hbar-row" v-for="(c, i) in catValues" :key="c.category_name">
              <span class="nm" :title="c.category_name">{{ c.category_name }}</span>
              <span class="ast-hbar"><b :style="{ width: barW(c.total_price), background: barColor(i) }"></b></span>
              <span class="ast-hbar-val">¥{{ wan(c.total_price) }} 万 · {{ c.count }} 件</span>
            </div>
            <div v-if="!catValues.length" class="empty">暂无分类价值数据</div>
          </div>
        </div>
      </div>

      <div class="split-3-2 mt16">
        <!-- low stock alerts -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">低值办公易耗品预警 <span class="tag tag-red" style="margin-left:2px">{{ num(kpi.consumable_alert) }}</span></div>
            <span class="more" @click="$root.go('/assets/consumables')">查看更多 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd" style="padding-top:8px">
            <table class="table">
              <thead><tr><th>物品名称</th><th>规格型号</th><th>当前库存</th><th>预警阈值</th><th>库存状态</th><th>操作</th></tr></thead>
              <tbody>
                <tr v-for="c in lowStock" :key="c.item_id">
                  <td class="strong"><ic name="package" size="14" style="color:var(--text-3); margin-right:6px"></ic>{{ c.name }}</td>
                  <td class="muted">{{ c.spec || '—' }}</td>
                  <td class="num">{{ c.stock_count }} {{ c.unit }}</td>
                  <td class="num muted">{{ c.min_stock }} {{ c.unit }}</td>
                  <td><span class="tag tag-red"><ic name="alert-triangle" size="12"></ic>库存不足</span></td>
                  <td class="actions"><button class="btn btn-text btn-sm" @click="$root.go('/assets/consumables')">申请采购</button></td>
                </tr>
                <tr v-if="!lowStock.length"><td colspan="6"><div class="empty">暂无低库存预警 🎉</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- recent maintenance -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">近期维保动态</div>
            <span class="more" @click="$root.go('/assets/maintenance')">查看更多 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd" style="padding-top:8px">
            <table class="table">
              <thead><tr><th>时间</th><th>资产</th><th>故障描述</th><th>维修商</th><th>状态</th></tr></thead>
              <tbody>
                <tr v-for="m in maintenance" :key="m.log_id">
                  <td class="num muted" style="white-space:nowrap">{{ bj(m.created_at) }}</td>
                  <td><div class="strong">{{ m.asset_name || '—' }}</div><div class="muted" style="font-size:11.5px">{{ m.asset_code || '' }}</div></td>
                  <td class="ellipsis" :title="m.fault_desc" style="max-width:150px">{{ m.fault_desc || '—' }}</td>
                  <td class="muted">{{ m.vendor || '内部维修' }}</td>
                  <td><span :class="['tag', logTag(m.status)]">{{ m.status_label }}</span></td>
                </tr>
                <tr v-if="!maintenance.length"><td colspan="5"><div class="empty">暂无维保记录</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
