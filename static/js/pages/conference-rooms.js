/* /conference/rooms 会议室维护管理 — pixel replica of design/mockups/032-conference-rooms.png
   Layout: 4 KPI / (会议室列表 table+filters+pager | 会议室配置详情) + 新增/编辑 modal */
AppPages['/conference/rooms'] = {
  route: '/conference/rooms', title: '会议室维护管理', category: 'CONFERENCE', primaryAction: '新增会议室', icon: 'door-open',
  subtitle: '统一维护会议室基础信息、设备配置与预订规则，保障会议资源有序使用。',
  component: {
    data() {
      return {
        loading: true,
        allRooms: [],
        selected: null,
        filters: { keyword: '', status: '' },
        pageNum: 1,
        pageSize: 8,
        showForm: false,
        editing: null,
        submitting: false,
        amenityOptions: ['LED屏', '投影', '音响', '视频', '视频会议', '会议终端', '同传', '录播', '电视', '白板'],
        form: { name: '', location: '', capacity: 20, status: 'AVAILABLE', amenities: [], max_duration_hours: 8, advance_booking_days: 30, buffer_time_minutes: 15 },
      };
    },
    computed: {
      filtered() {
        const kw = (this.filters.keyword || '').trim().toLowerCase();
        return this.allRooms.filter((r) => {
          if (this.filters.status && r.status !== this.filters.status) return false;
          if (kw && !((r.name || '') + (r.location || '')).toLowerCase().includes(kw)) return false;
          return true;
        });
      },
      pageTotal() { return this.filtered.length; },
      pageCount() { return Math.max(1, Math.ceil(this.pageTotal / this.pageSize)); },
      rooms() { return this.filtered.slice((this.pageNum - 1) * this.pageSize, this.pageNum * this.pageSize); },
      openCount() { return this.allRooms.filter((r) => r.status === 'AVAILABLE').length; },
      stopCount() { return this.allRooms.filter((r) => r.status !== 'AVAILABLE').length; },
      totalCapacity() { return this.allRooms.reduce((s, r) => s + (Number(r.capacity) || 0), 0); },
      mediaCount() {
        const keys = ['LED屏', '投影', '视频', '视频会议', '会议终端', '电视', '录播', '同传'];
        return this.allRooms.filter((r) => (r.amenities || []).some((a) => keys.includes(a))).length;
      },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      async load() {
        try {
          const r = await api.page('/api/conference/rooms', { pageNum: 1, pageSize: 200 });
          this.allRooms = r.rows || [];
        } catch (e) { this.allRooms = []; }
        if (!this.selected && this.allRooms.length) this.selected = this.allRooms[0];
        if (this.selected) this.selected = this.allRooms.find((r) => r.room_id === this.selected.room_id) || this.selected;
      },
      statusTag(s) { return { AVAILABLE: 'tag-green', MAINTENANCE: 'tag-amber', DISABLED: 'tag-gray' }[s] || 'tag-gray'; },
      statusLabel(s) { return { AVAILABLE: '开放', MAINTENANCE: '维护中', DISABLED: '停用' }[s] || s; },
      statusIcon(s) { return { AVAILABLE: 'check-circle-2', MAINTENANCE: 'wrench', DISABLED: 'ban' }[s] || 'circle-help'; },
      query() { this.pageNum = 1; },
      reset() { this.filters = { keyword: '', status: '' }; this.query(); },
      goPage(p) { if (p >= 1 && p <= this.pageCount) this.pageNum = p; },
      pick(r) { this.selected = r; },
      maxAmenity(r) { return (r.amenities || []).slice(0, 4); },
      openForm(room) {
        this.editing = room || null;
        this.form = room ? {
          name: room.name, location: room.location, capacity: room.capacity, status: room.status,
          amenities: (room.amenities || []).slice(), max_duration_hours: room.max_duration_hours || 8,
          advance_booking_days: room.advance_booking_days || 30, buffer_time_minutes: room.buffer_time_minutes || 15,
        } : { name: '', location: '', capacity: 20, status: 'AVAILABLE', amenities: [], max_duration_hours: 8, advance_booking_days: 30, buffer_time_minutes: 15 };
        this.showForm = true;
      },
      toggleAmenity(a) {
        const i = this.form.amenities.indexOf(a);
        if (i >= 0) this.form.amenities.splice(i, 1); else this.form.amenities.push(a);
      },
      async submitForm() {
        const f = this.form;
        if (!f.name.trim()) return this.$root.toast('请填写会议室名称', 'warn');
        if (!f.location.trim()) return this.$root.toast('请填写所属位置', 'warn');
        if (!f.capacity || f.capacity <= 0) return this.$root.toast('容纳人数必须大于 0', 'warn');
        this.submitting = true;
        try {
          const body = {
            name: f.name.trim(), location: f.location.trim(), capacity: Number(f.capacity) || 1,
            status: f.status, amenities: f.amenities,
            max_duration_hours: Number(f.max_duration_hours) || 8,
            advance_booking_days: Number(f.advance_booking_days) || 30,
            buffer_time_minutes: Number(f.buffer_time_minutes) || 15,
          };
          if (this.editing) {
            await api.put('/api/conference/rooms/' + this.editing.room_id, body);
            this.$root.toast('会议室已更新', 'ok');
          } else {
            await api.post('/api/conference/rooms', body);
            this.$root.toast('会议室已创建', 'ok');
          }
          this.showForm = false;
          await this.load();
        } catch (e) { /* toast shown */ }
        this.submitting = false;
      },
      async removeRoom(r) {
        if (!window.confirm('确认删除会议室「' + r.name + '」？该操作不可恢复。')) return;
        try {
          await api.del('/api/conference/rooms/' + r.room_id);
          this.$root.toast('删除成功', 'ok');
          if (this.selected && this.selected.room_id === r.room_id) this.selected = null;
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.openForm(null); },
    },
    template: `
    <div v-if="!loading">
      <!-- KPI row -->
      <div class="kpi-row">
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-blue"><ic name="door-open" size="28"></ic></div>
          <div class="meta"><div class="label">会议室总数</div><div class="val" style="color:var(--primary)">{{ allRooms.length }} <span style="font-size:12px;font-weight:400;color:var(--text-2)">开放 {{ openCount }} · 停用/维护 {{ stopCount }}</span></div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-teal"><ic name="users" size="28"></ic></div>
          <div class="meta"><div class="label">总容纳人数</div><div class="val" style="color:var(--teal)">{{ totalCapacity }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">人</span></div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-amber"><ic name="monitor" size="28"></ic></div>
          <div class="meta"><div class="label">配备多媒体设备</div><div class="val" style="color:var(--amber)">{{ mediaCount }} <span style="font-size:13px;font-weight:400;color:var(--text-2)">间</span></div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
        <div class="card kpi-card" style="cursor:default">
          <div class="ico ico-red"><ic name="file-check" size="28"></ic></div>
          <div class="meta"><div class="label">预订审批规则</div><div class="val" style="color:var(--red)">3 <span style="font-size:12px;font-weight:400;color:var(--text-2)">按人数 · 按时长 · 按间隔</span></div></div>
          <ic name="chevron-right" class="arrow"></ic>
        </div>
      </div>

      <div class="rooms-layout mt16">
        <!-- room list -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">会议室列表</div><span class="muted" style="font-size:12px">共 {{ pageTotal }} 间</span></div>
          <div class="card-bd" style="padding-top:10px">
            <div class="filters" style="margin-bottom:10px">
              <input class="input" style="flex:1; min-width:160px" placeholder="请输入会议室名称 / 位置" v-model="filters.keyword" @keyup.enter="query">
              <select class="select" style="width:130px" v-model="filters.status" @change="query">
                <option value="">全部状态</option>
                <option value="AVAILABLE">开放</option>
                <option value="MAINTENANCE">维护中</option>
                <option value="DISABLED">停用</option>
              </select>
              <button class="btn btn-primary" @click="query"><ic name="search" size="14"></ic>查询</button>
              <button class="btn btn-ghost" @click="reset"><ic name="rotate-cw" size="14"></ic>重置</button>
            </div>
            <table class="table">
              <thead><tr><th>会议室名称</th><th>位置</th><th style="width:76px">容纳人数</th><th>主要设备</th><th style="width:96px">状态</th><th style="width:130px">操作</th></tr></thead>
              <tbody>
                <tr v-for="r in rooms" :key="r.room_id" :class="{ sel: selected && selected.room_id === r.room_id }" style="cursor:pointer" @click="pick(r)">
                  <td class="strong">{{ r.name }}</td>
                  <td class="muted">{{ r.location || '—' }}</td>
                  <td class="num">{{ r.capacity }} 人</td>
                  <td><span v-for="a in maxAmenity(r)" :key="a" class="amenity-chip" style="margin-right:4px"><ic name="monitor" size="11"></ic>{{ a }}</span><span v-if="!(r.amenities||[]).length" class="muted">—</span></td>
                  <td><span :class="['tag', statusTag(r.status)]"><ic :name="statusIcon(r.status)" size="12"></ic>{{ statusLabel(r.status) }}</span></td>
                  <td class="actions">
                    <button class="btn btn-text btn-sm" @click.stop="openForm(r)">编辑</button>
                    <button class="btn btn-text btn-sm danger" @click.stop="removeRoom(r)">删除</button>
                  </td>
                </tr>
                <tr v-if="!rooms.length"><td colspan="6"><div class="empty">暂无会议室，点击右上角「新增会议室」创建</div></td></tr>
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

        <!-- room config detail -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">会议室配置</div>
            <button class="btn btn-ghost btn-sm" v-if="selected" @click="openForm(selected)"><ic name="pencil" size="13"></ic>编辑配置</button>
          </div>
          <div class="card-bd" v-if="selected">
            <div class="room-photo"><ic name="door-open" size="40"></ic></div>
            <div style="display:flex; align-items:center; gap:10px; margin-top:12px">
              <span class="strong" style="font-size:16px">{{ selected.name }}</span>
              <span :class="['tag', statusTag(selected.status)]"><ic :name="statusIcon(selected.status)" size="12"></ic>{{ statusLabel(selected.status) }}</span>
            </div>
            <div class="muted" style="font-size:12.5px; margin-top:3px; display:flex; align-items:center; gap:4px"><ic name="map-pin" size="13"></ic>{{ selected.location || '—' }}　<ic name="users" size="13"></ic>容纳 {{ selected.capacity }} 人</div>
            <div class="divider"></div>
            <div class="room-meta">
              <span class="k">会议室编号</span><span class="num">{{ selected.room_id.slice(0, 8).toUpperCase() }}</span>
              <span class="k">所在位置</span><span>{{ selected.location || '—' }}</span>
              <span class="k">管理部门</span><span>{{ selected.department_name || '综合办公室' }}</span>
              <span class="k">时长上限</span><span>单次不超过 {{ selected.max_duration_hours || 8 }} 小时</span>
              <span class="k">提前预订</span><span>需提前 {{ selected.advance_booking_days || 30 }} 天申请</span>
              <span class="k">场次间隔</span><span>相邻预订间隔 {{ selected.buffer_time_minutes || 15 }} 分钟</span>
            </div>
            <div class="divider"></div>
            <div class="strong" style="font-size:13px; margin-bottom:8px">多媒体设备</div>
            <div style="display:flex; flex-wrap:wrap; gap:6px">
              <span v-for="a in (selected.amenities || [])" :key="a" class="amenity-chip"><ic name="monitor" size="12"></ic>{{ a }}</span>
              <span v-if="!(selected.amenities || []).length" class="muted" style="font-size:12px">暂未配置设备</span>
            </div>
          </div>
          <div class="card-bd" v-else><div class="empty">请在左侧选择会议室查看配置</div></div>
        </div>
      </div>

      <!-- add / edit modal -->
      <Modal :title="editing ? '编辑会议室' : '新增会议室'" width="600px" v-if="showForm" @close="showForm = false">
        <div class="form-item">
          <label class="req">会议室名称</label>
          <input class="input" placeholder="如：第一会议室" v-model="form.name">
        </div>
        <div class="form-item">
          <label class="req">所属位置</label>
          <input class="input" placeholder="如：行政楼A / 2层" v-model="form.location">
        </div>
        <div class="form-item">
          <label class="req">容纳人数</label>
          <input type="number" class="input" style="flex:1" min="1" v-model="form.capacity">
        </div>
        <div class="form-item">
          <label>会议室状态</label>
          <select class="select" v-model="form.status">
            <option value="AVAILABLE">开放</option>
            <option value="MAINTENANCE">维护中</option>
            <option value="DISABLED">停用</option>
          </select>
        </div>
        <div class="form-item">
          <label>设备标签</label>
          <div style="flex:1; display:flex; flex-wrap:wrap; gap:6px">
            <span v-for="a in amenityOptions" :key="a" class="chip chip-pick" :class="{ on: form.amenities.includes(a) }" @click="toggleAmenity(a)">{{ a }}</span>
          </div>
        </div>
        <div class="form-item">
          <label>预订规则</label>
          <div style="flex:1; display:flex; gap:8px; align-items:center">
            <input type="number" class="input" style="width:80px" min="1" v-model="form.max_duration_hours"><span class="muted">小时/次</span>
            <input type="number" class="input" style="width:80px" min="0" v-model="form.advance_booking_days"><span class="muted">天内可订</span>
            <input type="number" class="input" style="width:80px" min="0" v-model="form.buffer_time_minutes"><span class="muted">分钟间隔</span>
          </div>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="showForm = false">取消</button>
          <button class="btn btn-primary" :disabled="submitting" @click="submitForm">{{ editing ? '保存修改' : '创建会议室' }}</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
