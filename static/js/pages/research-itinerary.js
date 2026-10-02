/* /research/itinerary 调研接待与动线方案 — pixel replica of design/mockups/065-research-itinerary.png
   Layout: topic selector / 4 info cards / (动线时间轴 tl | 接待要点卡 escort + 规范提示) */
AppPages['/research/itinerary'] = {
  route: '/research/itinerary', title: '调研接待与动线方案', category: 'RESEARCH', primaryAction: '新建调研方案', icon: 'map-pin',
  component: {
    data() {
      return {
        loading: true,
        topics: [],
        topicId: '',
        detail: null,
      };
    },
    computed: {
      dayCount() {
        if (!this.detail) return 0;
        const d = (new Date(this.detail.end_date) - new Date(this.detail.start_date)) / 86400000;
        return isNaN(d) ? 1 : Math.max(1, Math.round(d)) + 1;
      },
      escortList() {
        if (!this.detail || !this.detail.escort_members) return [];
        return this.detail.escort_members.split(/[、,，;；\s]+/).map((s) => s.trim()).filter(Boolean);
      },
      points() { return (this.detail && this.detail.points) || []; },
    },
    async mounted() {
      try {
        const r = await api.page('/api/research/topics', { pageNum: 1, pageSize: 100 });
        this.topics = (r.rows || []).filter((t) => t.status !== 'COMPLETED' && t.status !== 'PLANNED');
        if (!this.topics.length) this.topics = r.rows || [];
        if (this.topics.length) {
          this.topicId = this.topics[0].topic_id;
          await this.pick();
        }
      } catch (e) { /* toast shown */ }
      this.loading = false;
    },
    methods: {
      async pick() {
        if (!this.topicId) { this.detail = null; return; }
        try { this.detail = await api.get('/api/research/topics/' + this.topicId); } catch (e) { this.detail = null; }
      },
      typeTag(t) {
        return { SPECIAL: 'tag-blue', GRASSROOTS: 'tag-teal', ANATOMY: 'tag-amber', SECRET_VISIT: 'tag-red' }[t] || 'tag-gray';
      },
      statusTag(s) {
        return { PLANNED: 'tag-gray', APPROVED: 'tag-blue', IN_PROGRESS: 'tag-teal', REPORT_REVIEW: 'tag-amber', COMPLETED: 'tag-green' }[s] || 'tag-gray';
      },
    },
    template: `
    <div v-if="!loading">
      <!-- topic selector -->
      <div class="card" style="margin-top:0">
        <div class="card-bd" style="display:flex; align-items:center; gap:12px; flex-wrap:wrap; padding:14px 18px">
          <span class="strong" style="font-size:13.5px"><ic name="compass" size="16"></ic> 选择调研课题</span>
          <select class="select" style="width:360px" v-model="topicId" @change="pick">
            <option v-for="t in topics" :key="t.topic_id" :value="t.topic_id">{{ t.topic_no }} · {{ t.title }}（{{ t.start_date }} ~ {{ t.end_date }}）</option>
          </select>
          <template v-if="detail">
            <span :class="['tag', typeTag(detail.research_type)]">{{ detail.research_type_label }}</span>
            <span :class="['tag', statusTag(detail.status)]">{{ detail.status_label }}</span>
            <span v-if="detail.has_conflict" class="tag tag-red"><ic name="siren" size="12"></ic>撞期预警</span>
          </template>
        </div>
      </div>

      <div v-if="detail">
        <!-- scheme info cards -->
        <div class="kpi-row-4 rs-kpi4" style="margin-top:16px">
          <div class="card kpi-card" style="cursor:default">
            <div class="ico ico-blue"><ic name="calendar-days" size="28"></ic></div>
            <div class="meta"><div class="label">调研日期</div><div class="val" style="font-size:18px; color:var(--primary)">{{ detail.start_date }} ~ {{ detail.end_date }}</div>
              <div class="muted" style="font-size:12px">共 {{ dayCount }} 天 · {{ points.length }} 个点位</div></div>
          </div>
          <div class="card kpi-card" style="cursor:default">
            <div class="ico ico-teal"><ic name="users" size="28"></ic></div>
            <div class="meta"><div class="label">调研人员</div><div class="val" style="color:var(--teal)">{{ 1 + escortList.length }} <span style="font-size:14px; font-weight:400">人</span></div>
              <div class="muted" style="font-size:12px">领队 {{ detail.leader_name }} · 陪同 {{ escortList.length }} 人</div></div>
          </div>
          <div class="card kpi-card" style="cursor:default">
            <div class="ico ico-amber"><ic name="clipboard-list" size="28"></ic></div>
            <div class="meta"><div class="label">发现问题</div><div class="val" style="color:var(--amber)">{{ (detail.issues || []).length }} <span style="font-size:14px; font-weight:400">项</span></div>
              <div class="muted" style="font-size:12px">现场实录登记问题数</div></div>
          </div>
          <div class="card kpi-card" style="cursor:default">
            <div class="ico" style="background:var(--green-weak); color:var(--green)"><ic name="shield-check" size="28"></ic></div>
            <div class="meta"><div class="label">接待纪律</div><div class="strong" style="font-size:15px; margin-top:4px">工作餐 · 不迎送 · 不铺展</div>
              <div class="muted" style="font-size:12px">严格执行中央八项规定精神</div></div>
          </div>
        </div>

        <div class="split-3-2" style="margin-top:16px">
          <!-- itinerary timeline -->
          <div class="card" style="margin-top:0">
            <div class="card-hd">
              <div class="t">行程规划与动线</div>
              <span class="muted" style="font-size:12px">按点位计划日期排序，共 {{ points.length }} 站</span>
            </div>
            <div class="card-bd">
              <div class="tl">
                <div class="tl-item" v-for="(p, i) in points" :key="p.point_id" :class="p.conflict_detected ? 'amber' : i % 3 === 1 ? 'teal' : ''">
                  <div style="display:flex; justify-content:space-between; align-items:center; gap:8px">
                    <span class="strong" style="font-size:13px">第 {{ i + 1 }} 站 · {{ p.point_name }}</span>
                    <span :class="['tag', p.conflict_detected ? 'tag-red' : 'tag-blue']" style="flex:none">
                      <ic :name="p.conflict_detected ? 'siren' : 'calendar-check-2'" size="12"></ic>{{ p.scheduled_date }}{{ p.conflict_detected ? ' 撞期' : '' }}</span>
                  </div>
                  <div class="muted" style="font-size:12px; margin-top:3px"><ic name="map-pin" size="12"></ic> {{ p.point_address || '地址待补充' }}</div>
                  <div class="muted" style="font-size:12px; margin-top:1px">
                    <ic name="user" size="12"></ic> 联系人：{{ p.contact_person || '待确认' }}
                    <span style="margin-left:14px"><ic name="phone" size="12"></ic> {{ p.contact_phone || '—' }}</span>
                  </div>
                </div>
                <div v-if="!points.length" class="empty">该课题暂未登记调研点位</div>
              </div>
            </div>
          </div>

          <!-- reception key points -->
          <div class="card" style="margin-top:0">
            <div class="card-hd"><div class="t">接待要点</div></div>
            <div class="card-bd">
              <div class="rs-receive-box">
                <div class="rs-receive-hd"><ic name="crown" size="15"></ic>领队信息</div>
                <div class="strong" style="margin-top:6px">{{ detail.leader_name }}</div>
                <div class="muted" style="font-size:12px">牵头部门：{{ detail.lead_dept_name || '—' }}</div>
              </div>
              <div class="rs-receive-box" style="margin-top:12px">
                <div class="rs-receive-hd"><ic name="users" size="15"></ic>陪同人员（{{ escortList.length }}）</div>
                <div style="margin-top:8px; display:flex; flex-wrap:wrap; gap:6px">
                  <span v-for="m in escortList" :key="m" class="chip"><ic name="user" size="12"></ic>{{ m }}</span>
                  <span v-if="!escortList.length" class="muted" style="font-size:12px">未登记陪同人员</span>
                </div>
              </div>
              <div class="rs-receive-box" style="margin-top:12px">
                <div class="rs-receive-hd"><ic name="shield-check" size="15"></ic>接待规范提示</div>
                <div class="rs-rule"><span class="tag tag-teal">工作餐</span>在点位用工作餐，按标准缴费，不安排宴请</div>
                <div class="rs-rule"><span class="tag tag-blue">不迎送</span>轻车简从，不搞层层陪同、不安排迎送</div>
                <div class="rs-rule"><span class="tag tag-amber">不铺展</span>不铺设欢迎横幅、不摆放花草、不制作展板</div>
              </div>
            </div>
          </div>
        </div>

        <!-- issues of this topic -->
        <div class="card mt16">
          <div class="card-hd">
            <div class="t">本课题发现问题</div>
            <span class="more" @click="$root.go('/research/issues')">前往问题台账 <ic name="chevron-right" size="14"></ic></span>
          </div>
          <div class="card-bd" style="padding-top:6px">
            <table class="table" v-if="(detail.issues || []).length">
              <thead><tr><th style="width:52px">序号</th><th>问题标题</th><th>发现点位</th><th>拟承办部门</th><th style="width:110px">状态</th><th style="width:110px">登记时间</th></tr></thead>
              <tbody>
                <tr v-for="(it, i) in detail.issues" :key="it.issue_id">
                  <td class="num muted">{{ i + 1 }}</td>
                  <td class="strong ellipsis" style="max-width:300px" :title="it.issue_title">{{ it.issue_title }}</td>
                  <td class="muted">{{ it.point_name || '—' }}</td>
                  <td>{{ it.target_dept_name || '待定' }}</td>
                  <td><span :class="['tag', it.status === 'RECTIFIED' ? 'tag-green' : it.status === 'SUPERVISED' ? 'tag-blue' : 'tag-amber']">{{ it.status_label }}</span></td>
                  <td class="num muted">{{ it.created_at ? it.created_at.slice(0, 10) : '—' }}</td>
                </tr>
              </tbody>
            </table>
            <div v-else class="empty">该课题暂无问题记录</div>
          </div>
        </div>
      </div>
      <div v-else class="card mt16"><div class="empty">暂无可选调研课题，请先完成立项申报</div></div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
