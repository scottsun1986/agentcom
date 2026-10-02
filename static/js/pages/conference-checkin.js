/* /conference/checkin 电子签到大屏 — pixel replica of design/mockups/038-conference-checkin.png
   Layout: 会议信息头 + 刷新 / 4 KPI（应到/实到/签到率/缺席）/ 签到墙（tab + 搜索 + 头像卡网格） */
AppPages['/conference/checkin'] = {
  route: '/conference/checkin', title: '电子签到大屏', category: 'CONFERENCE', primaryAction: '刷新数据', icon: 'scan-face',
  component: {
    data() {
      return {
        loading: true,
        affairs: [],
        affairId: '',
        stats: null,
        tab: 'all',
        keyword: '',
        refreshing: false,
        updatedAt: '',
      };
    },
    computed: {
      affair() { return this.affairs.find((a) => a.affair_id === this.affairId) || null; },
      allPeople() {
        if (!this.stats) return [];
        const checked = (this.stats.checked_in || []).map((a) => Object.assign({}, a, { _signed: true }));
        const absent = (this.stats.absent || []).map((a) => Object.assign({}, a, { _signed: false }));
        return checked.concat(absent);
      },
      shown() {
        const kw = (this.keyword || '').trim().toLowerCase();
        return this.allPeople.filter((a) => {
          if (this.tab === 'signed' && !a._signed) return false;
          if (this.tab === 'unsigned' && a._signed) return false;
          if (kw && !((a.name || '') + (a.dept_name || '') + (a.post_name || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      absentRate() {
        return this.stats && this.stats.should_count ? (100 - this.stats.rate).toFixed(1) : '0.0';
      },
    },
    async mounted() {
      try {
        const r = await api.page('/api/conference/affairs', { pageNum: 1, pageSize: 100 });
        this.affairs = r.rows || [];
      } catch (e) { this.affairs = []; }
      if (this.affairs.length) {
        this.affairId = this.affairs[0].affair_id;
        await this.load();
      }
      this.loading = false;
    },
    methods: {
      bj(s) { return s ? String(s).slice(0, 16).replace('T', ' ') : '—'; },
      hm(s) { return s ? String(s).slice(11, 16) : ''; },
      async load() {
        if (!this.affairId) return;
        this.refreshing = true;
        try {
          this.stats = await api.get('/api/conference/checkin/' + this.affairId);
          const d = new Date(Date.now() + (480 + new Date().getTimezoneOffset()) * 60000);
          const p = (n) => String(n).padStart(2, '0');
          this.updatedAt = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
        } catch (e) { this.stats = null; }
        this.refreshing = false;
      },
      onAffairChange() { this.load(); },
      initial(n) { return (n || '?').slice(0, 1); },
      onPrimary() { this.load(); },
    },
    template: `
    <div v-if="!loading">
      <!-- meeting header -->
      <div class="card">
        <div class="card-bd" style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:14px 18px">
          <ic name="calendar-days" size="18" style="color:var(--primary)"></ic>
          <select class="select" style="width:300px" v-model="affairId" @change="onAffairChange">
            <option value="" disabled>请选择会务统筹单</option>
            <option v-for="a in affairs" :key="a.affair_id" :value="a.affair_id">{{ a.title }}</option>
          </select>
          <template v-if="stats">
            <span class="tag tag-blue"><ic name="loader-2" size="12"></ic>{{ stats.actual_count >= stats.should_count && stats.should_count ? '签到完成' : '进行中' }}</span>
            <span class="muted" style="font-size:12.5px"><ic name="clock" size="13"></ic> {{ affair ? bj(affair.start_time) : '' }}</span>
            <span class="muted" style="font-size:12.5px" v-if="affair"><ic name="map-pin" size="13"></ic> {{ affair.room_name || '待定' }}</span>
          </template>
          <span style="margin-left:auto; display:flex; align-items:center; gap:10px">
            <span class="muted" style="font-size:12px"><ic name="refresh-cw" size="12"></ic> 数据更新时间：{{ updatedAt || '—' }}</span>
            <button class="btn btn-ghost" :disabled="refreshing" @click="load"><ic name="refresh-cw" size="14"></ic>刷新</button>
          </span>
        </div>
      </div>

      <!-- KPI row -->
      <div class="kpi-row mt16" v-if="stats">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="users" size="28"></ic></div>
          <div class="meta"><div class="label">应到人数</div><div class="val" style="color:var(--primary)">{{ stats.should_count }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">人</span></div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="check-circle-2" size="28"></ic></div>
          <div class="meta"><div class="label">实到人数</div><div class="val" style="color:var(--teal)">{{ stats.actual_count }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">人</span></div></div>
          <div style="text-align:right; flex:none"><div class="muted" style="font-size:12px">签到率</div><div class="strong" style="font-size:18px; color:var(--teal)">{{ stats.rate }}%</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="user-x" size="28"></ic></div>
          <div class="meta"><div class="label">缺席人数</div><div class="val" style="color:var(--red)">{{ stats.absent_count }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">人</span></div></div>
          <div style="text-align:right; flex:none"><div class="muted" style="font-size:12px">缺席率</div><div class="strong" style="font-size:18px; color:var(--red)">{{ absentRate }}%</div></div>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="meta" style="flex:1">
            <div class="label">签到进度</div>
            <div class="progress mt8"><div class="bar bar-teal" :style="{ width: stats.rate + '%' }"></div></div>
            <div class="muted" style="font-size:12px; margin-top:6px">已签到 {{ stats.actual_count }} / {{ stats.should_count }} 人</div>
          </div>
        </div>
      </div>

      <!-- checkin wall -->
      <div class="card mt16">
        <div class="card-hd" style="flex-wrap:wrap">
          <div class="t">参会人员签到墙</div>
          <div style="display:flex; align-items:center; gap:10px">
            <div class="lr-tabs" style="margin:0; display:flex; gap:14px">
              <span :class="['lr-tab', tab === 'all' ? 'on' : '']" @click="tab = 'all'">全部人员 ({{ allPeople.length }})</span>
              <span :class="['lr-tab', tab === 'signed' ? 'on' : '']" @click="tab = 'signed'">已签到 ({{ stats ? stats.actual_count : 0 }})</span>
              <span :class="['lr-tab', tab === 'unsigned' ? 'on' : '']" @click="tab = 'unsigned'">未签到 ({{ stats ? stats.absent_count : 0 }})</span>
            </div>
            <input class="input" style="width:200px" placeholder="请输入姓名或部门" v-model="keyword">
          </div>
        </div>
        <div class="card-bd" style="padding-top:10px">
          <div class="ci-wall">
            <div v-for="a in shown" :key="a.attendee_id" class="ci-card" :class="{ signed: a._signed }">
              <span class="ava">{{ initial(a.name) }}</span>
              <div class="nm">{{ a.name }}</div>
              <div class="dp">{{ a.dept_name || '—' }}<template v-if="a.post_name"> · {{ a.post_name }}</template></div>
              <div v-if="a._signed" class="tm"><ic name="check-circle-2" size="11"></ic> {{ hm(a.sign_in_time) }} 已签到</div>
              <div v-else class="tm" style="color:var(--text-3)">未签到</div>
            </div>
          </div>
          <div v-if="!shown.length" class="empty">{{ affairId ? '暂无符合条件的参会人员' : '请先选择会务统筹单' }}</div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
