/* /conference/seating 智能排座与席卡系统 — pixel replica of design/mockups/036-conference-seating.png
   Layout: 3-col (参会人员列表 | 主席台+列席区座次图 | 座次规则+席卡导出) */
AppPages['/conference/seating'] = {
  route: '/conference/seating', title: '智能排座与席卡系统', category: 'CONFERENCE', primaryAction: '一键排座', icon: 'layout-grid',
  subtitle: '支持「以中为尊、前排为尊、左为上/右为上」等政务座次礼仪，可视化排座并一键生成标准席卡。',
  component: {
    data() {
      return {
        loading: true,
        affairs: [],
        affairId: '',
        title: '',
        attendees: [],
        rule: 'CENTER_FIRST',
        generating: false,
        rules: [
          { key: 'CENTER_FIRST', name: '以中为尊', desc: '主席台正中为主宾，左右依次排列', icon: 'crown' },
          { key: 'FRONT_FIRST', name: '前排为尊', desc: '前排优先，后排依次排开', icon: 'users' },
          { key: 'LEFT_FIRST', name: '左为上（面向主席台）', desc: '面向主席台时，左侧为上', icon: 'align-justify' },
          { key: 'RIGHT_FIRST', name: '右为上（面向主席台）', desc: '面向主席台时，右侧为上', icon: 'align-justify' },
        ],
      };
    },
    computed: {
      affair() { return this.affairs.find((a) => a.affair_id === this.affairId) || null; },
      seated() { return this.attendees.filter((a) => a.seat_label); },
      unseated() { return this.attendees.filter((a) => !a.seat_label); },
      stageSeats() { return this.seated.slice(0, Math.min(5, this.seated.length)); },
      floorSeats() { return this.seated.slice(Math.min(5, this.seated.length)); },
    },
    async mounted() {
      try {
        const r = await api.page('/api/conference/affairs', { pageNum: 1, pageSize: 100 });
        this.affairs = r.rows || [];
      } catch (e) { this.affairs = []; }
      if (this.affairs.length) {
        this.affairId = this.affairs[0].affair_id;
        await this.loadSeating();
      }
      this.loading = false;
    },
    methods: {
      bj(s) { return s ? String(s).slice(0, 16).replace('T', ' ') : '—'; },
      async loadSeating() {
        this.attendees = [];
        this.title = '';
        if (!this.affairId) return;
        try {
          const d = await api.get('/api/conference/seating/' + this.affairId);
          this.attendees = d.attendees || [];
          this.title = d.title || '';
        } catch (e) { /* toast shown */ }
      },
      onAffairChange() { this.loadSeating(); },
      async generate() {
        if (!this.affairId) return this.$root.toast('请先选择会务统筹单', 'warn');
        this.generating = true;
        try {
          const seats = await api.post('/api/conference/seating/' + this.affairId, { rule_type: this.rule });
          this.attendees = seats || [];
          const name = (this.rules.find((r) => r.key === this.rule) || {}).name || this.rule;
          this.$root.toast('已按「' + name + '」规则完成排座', 'ok');
        } catch (e) { /* toast shown */ }
        this.generating = false;
      },
      seatPost(a) { return a.post_name || a.dept_name || ''; },
      esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); },
      exportCards() {
        const rows = this.seated;
        if (!rows.length) return this.$root.toast('暂无座次数据，请先完成排座', 'warn');
        const title = this.title || '会议席卡';
        const cards = rows.map((a) =>
          '<div class="sc"><div class="sc-no">' + this.esc(a.seat_label) + '</div><div class="sc-name">' + this.esc(a.name) + '</div><div class="sc-ps">' + this.esc(this.seatPost(a)) + '</div></div>'
        ).join('');
        const html = '<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>' + this.esc(title) + ' - 席卡</title><style>'
          + 'body{font-family:"PingFang SC","Microsoft YaHei",sans-serif;background:#fff;margin:24px;text-align:center}'
          + 'h2{color:#102A43;margin-bottom:6px}p{color:#829AB1;font-size:13px;margin:0 0 18px}'
          + '.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;max-width:900px;margin:0 auto}'
          + '.sc{border:2px solid #B0423F;border-radius:10px;padding:18px 8px 14px;margin:0 auto;width:100%;max-width:200mm;background:#fff}'
          + '.sc-no{color:#A9803F;font-size:12px;letter-spacing:2px}.sc-name{font-size:22px;font-weight:700;color:#102A43;margin:6px 0 2px}'
          + '.sc-ps{font-size:13px;color:#486581}'
          + '@media print{.grid{gap:8mm}}'
          + '</style></head><body><h2>' + this.esc(title) + '</h2><p>批量席卡导出 · 共 ' + rows.length + ' 张（A4 打印建议每页 4 张）</p><div class="grid">' + cards + '</div>'
          + '<script>window.onload=function(){window.print()}<\/script></body></html>';
        const w = window.open('', '_blank');
        if (w) {
          w.document.write(html);
          w.document.close();
        } else {
          const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
          const a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = '会议席卡.html';
          a.click();
          URL.revokeObjectURL(a.href);
          this.$root.toast('浏览器拦截了弹窗，已改为下载席卡 HTML 文件', 'warn');
        }
      },
      onPrimary() { this.generate(); },
    },
    template: `
    <div v-if="!loading">
      <!-- affair selector -->
      <div class="card">
        <div class="card-bd" style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:14px 18px">
          <ic name="calendar-days" size="18" style="color:var(--primary)"></ic>
          <select class="select" style="width:300px" v-model="affairId" @change="onAffairChange">
            <option value="" disabled>请选择会务统筹单</option>
            <option v-for="a in affairs" :key="a.affair_id" :value="a.affair_id">{{ a.title }}</option>
          </select>
          <span class="muted" style="font-size:12.5px" v-if="affair">
            <ic name="clock" size="13"></ic> {{ bj(affair.start_time) }} ~ {{ bj(affair.end_time).slice(11) }}　
            <ic name="map-pin" size="13"></ic> {{ affair.room_name || '待定' }}
          </span>
          <span style="margin-left:auto; display:flex; gap:8px">
            <button class="btn btn-primary" :disabled="generating" @click="generate"><ic name="sparkles" size="14"></ic>一键排座</button>
            <button class="btn btn-ghost" @click="exportCards"><ic name="printer" size="14"></ic>批量导出席卡</button>
          </span>
        </div>
      </div>

      <div class="seat-layout mt16">
        <!-- attendee list -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">参会人员列表（{{ attendees.length }}人）</div></div>
          <div class="card-bd" style="padding-top:6px">
            <div class="lr-tabs" style="margin:0 0 8px; display:flex; gap:14px">
              <span class="lr-tab on" style="font-size:13px; padding-bottom:6px">全部 ({{ attendees.length }})</span>
              <span class="lr-tab" style="font-size:13px; padding-bottom:6px; cursor:default">已排座 ({{ seated.length }})</span>
              <span class="lr-tab" style="font-size:13px; padding-bottom:6px; cursor:default">未排座 ({{ unseated.length }})</span>
            </div>
            <div class="att-scroll">
              <div v-for="a in attendees" :key="a.attendee_id" class="att-row">
                <span class="ava" :class="{ 'ava-vip': a.seat_label === seated[0] && seated[0] && a.attendee_id === seated[0].attendee_id }">{{ (a.name || '?').slice(0, 1) }}</span>
                <div style="flex:1; min-width:0">
                  <div class="strong" style="font-size:13px">{{ a.name }} <span class="muted" style="font-weight:400; font-size:11.5px" v-if="a.seat_label">{{ a.seat_label }}</span></div>
                  <div class="muted" style="font-size:11.5px">{{ a.post_name || a.dept_name || '—' }}</div>
                </div>
                <span v-if="a.sign_in_time" class="tag tag-green" style="flex:none">已签到</span>
              </div>
              <div v-if="!attendees.length" class="empty">{{ affairId ? '该会议尚未登记参会人员<br>请前往「参会人员与报名回执」添加' : '请先选择会务统筹单' }}</div>
            </div>
          </div>
        </div>

        <!-- seat map -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">座次图<span class="muted" style="font-size:12px; font-weight:400; margin-left:8px" v-if="title">{{ title }}</span></div>
            <span class="muted" style="font-size:12px">主席台 {{ stageSeats.length }} 席 · 列席区 {{ floorSeats.length }} 席</span>
          </div>
          <div class="card-bd" v-if="seated.length">
            <div class="stage-band">主 席 台</div>
            <div class="stage-floor">
              <div v-for="a in stageSeats" :key="'st' + a.attendee_id" class="seat-card" :class="{ vip: a.attendee_id === (stageSeats[Math.floor(stageSeats.length / 2)] || {}).attendee_id }">
                <div class="no">{{ a.seat_label }}</div>
                <div class="nm">{{ a.name }}</div>
                <div class="ps">{{ seatPost(a) }}</div>
              </div>
            </div>
            <div v-if="floorSeats.length" class="seat-grid">
              <div v-for="a in floorSeats" :key="'fl' + a.attendee_id" class="seat-card">
                <div class="no">{{ a.seat_label }}</div>
                <div class="nm">{{ a.name }}</div>
                <div class="ps">{{ seatPost(a) }}</div>
              </div>
            </div>
            <div class="muted" style="text-align:center; font-size:11.5px; margin-top:12px">面向主席台方向 · 席位号由排座引擎按礼仪规则自动生成</div>
          </div>
          <div class="card-bd" v-else><div class="empty" style="padding:70px 0">尚未排座，选择右侧排座规则后点击「一键排座」</div></div>
        </div>

        <!-- rule panel -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">座次规则设置</div><span class="more" title="按政务礼仪规则自动排座"><ic name="circle-help" size="14"></ic> 礼仪说明</span></div>
          <div class="card-bd">
            <label v-for="r in rules" :key="r.key" class="rule-opt" :class="{ on: rule === r.key }">
              <input type="radio" :value="r.key" v-model="rule">
              <div style="flex:1">
                <div class="rt"><ic :name="r.icon" size="15" style="color:var(--primary)"></ic>{{ r.name }}</div>
                <div class="rd">{{ r.desc }}</div>
              </div>
            </label>
            <button class="btn btn-primary" style="width:100%; justify-content:center; margin-top:4px" :disabled="generating || !affairId" @click="generate">
              <ic name="sparkles" size="14"></ic>{{ generating ? '排座中…' : '一键排座' }}
            </button>
            <div class="divider"></div>
            <div class="strong" style="font-size:13px; margin-bottom:6px">席卡样式</div>
            <div style="display:flex; gap:8px">
              <div class="seat-card" style="flex:1"><div class="no">01号</div><div class="nm">姓名</div><div class="ps">职务</div></div>
              <div class="seat-card vip" style="flex:1"><div class="no">02号</div><div class="nm">姓名</div><div class="ps">职务</div></div>
            </div>
            <div class="muted" style="font-size:11.5px; margin-top:6px">导出为 HTML 席卡页，可直接打印或另存 PDF（约 200×100mm/张）</div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
