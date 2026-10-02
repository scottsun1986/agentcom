/* /attendance/rules 班次与考勤组规则 — pixel replica of design/mockups/012-attendance-rules.png
   Layout: (考勤组列表 search+table | 规则设置 form: 考勤方式 radio-cards / 班次时间 / 打卡地点 / WiFi 限制) + 保存 PUT */
AppPages['/attendance/rules'] = {
  route: '/attendance/rules', title: '班次与考勤组规则', category: 'ATTENDANCE', primaryAction: '保存设置', icon: 'settings',
  subtitle: '按部门或人员配置考勤组，设置班次规则、打卡地点与网络限制等，支持固定班次、排班制与自由工时。',
  component: {
    data() {
      return {
        loading: true,
        saving: false,
        rules: { shift_name: '', work_days: '', work_start: '', work_end: '', late_threshold_min: 0, clock_radius_m: 500, wifi_bssid: '', flex_minutes: 0, groups: [] },
        backup: '',
        groups: [],
        selectedIdx: 0,
        groupSearch: '',
        wifiOn: true,
      };
    },
    computed: {
      filteredGroups() {
        const kw = (this.groupSearch || '').trim().toLowerCase();
        if (!kw) return this.groups;
        return this.groups.filter((g) => (g.group_name + ' ' + (g.mode || '')).toLowerCase().includes(kw));
      },
      selectedGroup() { return this.groups[this.selectedIdx] || null; },
      workHours() {
        const s = (this.rules.work_start || '09:00').split(':').map(Number);
        const e = (this.rules.work_end || '18:00').split(':').map(Number);
        const h = e[0] + e[1] / 60 - (s[0] + s[1] / 60);
        return (Math.round(h * 10) / 10) + ' 小时';
      },
    },
    async mounted() { await this.load(); this.loading = false; },
    methods: {
      modeTag(m) { return { 固定班次: 'tag-blue', 排班制: 'tag-teal', 自由工时: 'tag-amber' }[m] || 'tag-gray'; },
      async load() {
        try {
          const d = await api.get('/api/attendance/rules');
          this.rules = Object.assign({ shift_name: '', work_days: '', work_start: '09:00', work_end: '18:00', late_threshold_min: 10, clock_radius_m: 500, wifi_bssid: '', flex_minutes: 30, groups: [] }, d);
          this.groups = (this.rules.groups || []).map((g) => Object.assign({ enabled: true }, g));
          this.backup = JSON.stringify(this.snapshot());
        } catch (e) { /* toast shown */ }
      },
      snapshot() {
        return Object.assign({}, this.rules, { groups: this.groups.map((g) => ({ group_name: g.group_name, members: g.members, mode: g.mode })) });
      },
      selectGroup(i) {
        this.selectedIdx = this.groups.indexOf(this.filteredGroups[i]) >= 0 ? this.groups.indexOf(this.filteredGroups[i]) : i;
      },
      setMode(m) {
        if (this.selectedGroup) this.selectedGroup.mode = m;
      },
      async save() {
        if (this.saving) return;
        this.saving = true;
        try {
          await api.put('/api/attendance/rules', this.snapshot());
          this.$root.toast('考勤规则已保存', 'ok');
          this.backup = JSON.stringify(this.snapshot());
        } catch (e) { this.$root.toast('规则保存失败，请稍后重试', 'err'); }
        this.saving = false;
      },
      cancelEdit() {
        try {
          const b = JSON.parse(this.backup);
          this.rules = b;
          this.groups = (b.groups || []).map((g) => Object.assign({ enabled: true }, g));
          this.$root.toast('已还原为上次保存的设置', 'ok');
        } catch (e) { /* ignore */ }
      },
      onPrimary() { this.save(); },
    },
    template: `
    <div v-if="!loading">
      <div class="rules-split">
        <!-- group list -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">考勤组列表 <span class="muted" style="font-size:12.5px;font-weight:400">（共 {{ groups.length }} 个）</span></div></div>
          <div class="card-bd" style="padding-top:8px">
            <div style="position:relative; margin-bottom:10px">
              <input class="input" style="width:100%; padding-left:30px" placeholder="搜索考勤组名称、考勤方式" v-model="groupSearch">
              <ic name="search" size="15" style="position:absolute; left:9px; top:9px; color:#A7B6C7"></ic>
            </div>
            <table class="table">
              <thead><tr><th>考勤组名称</th><th>考勤类型</th><th>适用范围</th><th>启用</th><th></th></tr></thead>
              <tbody>
                <tr v-for="(g, i) in filteredGroups" :key="g.group_name" :style="{background: selectedGroup && selectedGroup.group_name === g.group_name ? 'var(--primary-weak)' : ''}" style="cursor:pointer" @click="selectGroup(i)">
                  <td class="strong">{{ g.group_name }}</td>
                  <td><span :class="['tag', modeTag(g.mode)]">{{ g.mode }}</span></td>
                  <td class="muted">共 {{ g.members }} 人</td>
                  <td><label class="switch" @click.stop><input type="checkbox" v-model="g.enabled"><i></i></label></td>
                  <td class="actions"><ic name="more-horizontal" size="16" style="color:var(--text-3)"></ic></td>
                </tr>
                <tr v-if="!filteredGroups.length"><td colspan="5"><div class="empty">未找到匹配的考勤组</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- rule settings -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">考勤组规则设置 <span class="muted" style="font-size:12px;font-weight:400">设置考勤方式、班次时间、打卡地点与网络限制等规则</span></div>
          </div>
          <div class="card-bd">
            <div class="form-item">
              <label class="req">考勤组名称</label>
              <input class="input" :value="selectedGroup ? selectedGroup.group_name : ''" @input="selectedGroup && (selectedGroup.group_name = $event.target.value)" placeholder="如：总部办公组">
            </div>
            <div class="form-item">
              <label>班次名称</label>
              <input class="input" v-model="rules.shift_name" placeholder="如：标准工时制">
            </div>
            <div class="form-item" style="align-items:center">
              <label class="req">适用考勤方式</label>
              <div class="mode-cards">
                <div :class="['mode-card', selectedGroup && selectedGroup.mode === '固定班次' ? 'on' : '']" @click="setMode('固定班次')">
                  <ic name="calendar-check-2" size="16"></ic><b>固定班次</b><span>按固定上下班时间考勤</span>
                </div>
                <div :class="['mode-card', selectedGroup && selectedGroup.mode === '排班制' ? 'on' : '']" @click="setMode('排班制')">
                  <ic name="calendar-days" size="16"></ic><b>排班制</b><span>按排班计划考勤，支持多班次</span>
                </div>
                <div :class="['mode-card', selectedGroup && selectedGroup.mode === '自由工时' ? 'on' : '']" @click="setMode('自由工时')">
                  <ic name="timer" size="16"></ic><b>自由工时</b><span>不设固定上下班时间，按时长统计</span>
                </div>
              </div>
            </div>

            <div class="rule-block">
              <div class="rule-block-hd"><b>班次时间设置</b><span class="muted" style="font-size:12px">工作日班次（{{ rules.work_days }}）· 每日工作时长 {{ workHours }} · 每天打卡 2 次（上班、下班）</span></div>
              <div style="display:flex; gap:12px; flex-wrap:wrap; align-items:center; margin-top:10px">
                <span class="f-label">上班时间</span><input type="time" class="input" style="width:120px" v-model="rules.work_start">
                <span class="f-label">下班时间</span><input type="time" class="input" style="width:120px" v-model="rules.work_end">
                <span class="f-label">迟到宽限</span><input type="number" class="input" style="width:90px" min="0" v-model="rules.late_threshold_min"><span class="muted" style="font-size:12px">分钟</span>
                <span class="f-label">弹性工时</span><input type="number" class="input" style="width:90px" min="0" v-model="rules.flex_minutes"><span class="muted" style="font-size:12px">分钟</span>
              </div>
            </div>

            <div class="rule-block mt12">
              <div class="rule-block-hd"><b>打卡地点设置 <i class="req" style="font-style:normal"></i></b><span class="muted" style="font-size:12px">设置办公地点位置与有效打卡半径</span></div>
              <div class="loc-row">
                <div class="map-holder">
                  <div class="map-ring" :style="{width: Math.min(150, 40 + Number(rules.clock_radius_m || 0) / 8) + 'px', height: Math.min(150, 40 + Number(rules.clock_radius_m || 0) / 8) + 'px'}"></div>
                  <ic name="map-pin" size="22" style="color:var(--primary)"></ic>
                  <span class="map-cap">有效打卡半径 {{ rules.clock_radius_m }} 米</span>
                </div>
                <div class="desc-list" style="flex:1; grid-template-columns:120px 1fr">
                  <span class="k">工作日</span><input class="input" style="height:30px" v-model="rules.work_days">
                  <span class="k">有效半径（米）</span><input type="number" class="input" style="height:30px" min="50" v-model="rules.clock_radius_m">
                  <span class="k">中心坐标</span><span class="muted" style="font-size:12px">默认单位总部坐标（由管理员在地图中标注）</span>
                </div>
              </div>
            </div>

            <div class="rule-block mt12">
              <div class="rule-block-hd"><b>网络环境限制</b><span class="muted" style="font-size:12px">可指定公司 WiFi 进行打卡验证</span></div>
              <div style="display:flex; align-items:center; gap:10px; margin-top:10px">
                <label style="display:flex; align-items:center; gap:6px; cursor:pointer"><input type="checkbox" v-model="wifiOn"> 启用公司 WiFi 限制</label>
              </div>
              <div style="display:flex; align-items:center; gap:12px; margin-top:10px; flex-wrap:wrap">
                <span class="f-label">BSSID（MAC 地址）</span>
                <input class="input" style="width:220px" v-model="rules.wifi_bssid" :disabled="!wifiOn" placeholder="如 AA:BB:CC:DD:EE:FF">
                <span class="muted" style="font-size:12px">员工需连接指定 WiFi 才能打卡</span>
              </div>
            </div>

            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:16px">
              <button class="btn btn-ghost" @click="cancelEdit">取消</button>
              <button class="btn btn-primary" :disabled="saving" @click="save"><ic name="save" size="14"></ic>{{ saving ? '保存中…' : '保存设置' }}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
