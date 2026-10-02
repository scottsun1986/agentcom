/* /conference/minutes-to-supervision 议定决议转督办 — pixel replica of design/mockups/040-conference-minutes-to-supervision.png
   Layout: (1.选择会议及需转督办的议定事项 table) | (2.生成督办单 form) + 更换会议 modal */
AppPages['/conference/minutes-to-supervision'] = {
  route: '/conference/minutes-to-supervision', title: '议定决议转督办', category: 'CONFERENCE', primaryAction: null, icon: 'target',
  subtitle: '从会议纪要的 Action Items 中勾选重大事项，一键直推至【政务重点督办】生成督办单，推动会议决议落地落实。',
  component: {
    data() {
      return {
        loading: true,
        minutes: [],
        cur: null, // 当前纪要详情（含 action_items）
        depts: [], // 扁平化部门 {dept_id, dept_name, depth}
        selected: [], // 已勾选的未转办事项 id
        convNo: {}, // itemId -> 转办成功后后端返回的督办编号
        form: { lead_dept_id: '', deadline: '', priority: 'NORMAL' },
        converting: false,
        showPicker: false,
      };
    },
    computed: {
      items() { return (this.cur && this.cur.action_items) || []; },
      pendingItems() { return this.items.filter((i) => !i.converted_supervision_id); },
      convertedCount() { return this.items.length - this.pendingItems.length; },
      allChecked() { return this.pendingItems.length > 0 && this.pendingItems.every((i) => this.selected.includes(i.id)); },
    },
    async mounted() {
      await Promise.all([this.loadMinutes(), this.loadDepts()]);
      if (this.minutes.length) await this.pick(this.minutes[0].id);
      this.loading = false;
    },
    methods: {
      bj(s) { return s ? String(s).slice(0, 16).replace('T', ' ') : '—'; },
      day(s) { return s ? String(s).slice(0, 10) : '—'; },
      async loadMinutes() {
        try {
          const r = await api.page('/api/conference/minutes', { pageNum: 1, pageSize: 100 });
          this.minutes = r.rows || [];
        } catch (e) { this.minutes = []; }
      },
      async loadDepts() {
        const flat = [];
        const walk = (nodes, depth) => (nodes || []).forEach((n) => {
          flat.push({ dept_id: n.dept_id, dept_name: n.dept_name, depth });
          walk(n.children, depth + 1);
        });
        try { walk(await api.get('/api/system/depts'), 0); } catch (e) { /* empty */ }
        this.depts = flat;
      },
      async pick(id) {
        this.selected = [];
        try { this.cur = await api.get('/api/conference/minutes/' + id); } catch (e) { this.cur = null; }
      },
      convLabel(it) {
        if (this.convNo[it.id]) return '已转督办:' + this.convNo[it.id];
        if (it.converted_supervision_id) return '已转督办:' + String(it.converted_supervision_id).slice(0, 8).toUpperCase();
        return '';
      },
      statusTag(s) { return { PENDING: 'tag-amber', IN_PROGRESS: 'tag-blue', DONE: 'tag-green' }[s] || 'tag-gray'; },
      prioTag(p) { return { TOP: 'tag-red', URGENT: 'tag-amber', NORMAL: 'tag-blue' }[p] || 'tag-gray'; },
      toggleAll() {
        if (this.allChecked) this.selected = [];
        else this.selected = this.pendingItems.map((i) => i.id);
      },
      resetForm() {
        this.selected = [];
        this.form = { lead_dept_id: '', deadline: '', priority: 'NORMAL' };
      },
      async convert() {
        if (!this.selected.length) return this.$root.toast('请先在左侧勾选需转督办的事项', 'warn');
        if (!this.form.lead_dept_id) return this.$root.toast('请选择主办处室', 'warn');
        if (!this.form.deadline) return this.$root.toast('请选择办结时限', 'warn');
        this.converting = true;
        const nos = [];
        try {
          for (const id of this.selected) {
            const d = await api.post('/api/conference/action-items/' + id + '/to-supervision', {
              lead_dept_id: this.form.lead_dept_id,
              deadline: this.form.deadline,
              priority: this.form.priority,
            });
            if (d && d.supervision_no) { nos.push(d.supervision_no); this.convNo[id] = d.supervision_no; }
          }
          this.$root.toast('已生成督办单 ' + nos.join('、') + (nos.length > 1 ? '，共 ' + nos.length + ' 项' : ''), 'ok');
          this.resetForm();
          if (this.cur) await this.pick(this.cur.id);
        } catch (e) { /* toast shown */ if (this.cur) await this.pick(this.cur.id); }
        this.converting = false;
      },
      deptLabel(depth) { return depth ? '　'.repeat(depth) + '└ ' : ''; },
    },
    template: `
    <div v-if="!loading">
      <div class="split-3-2" style="align-items:start">
        <!-- step 1: pick minutes & action items -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">1. 选择会议及需转督办的议定事项</div>
            <button class="btn btn-ghost btn-sm" @click="showPicker = true" :disabled="!minutes.length"><ic name="refresh-cw" size="13"></ic>更换会议</button>
          </div>
          <div class="card-bd" style="padding-top:10px">
            <div class="muted" style="font-size:12.5px; margin-bottom:12px">请选择会议，并从纪要的行动项中勾选需要转督办的重大事项（可多选）。</div>
            <div v-if="cur" class="mts-meeting">
              <span class="ico-box ico-blue" style="width:42px;height:42px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex:none"><ic name="users" size="22"></ic></span>
              <div style="flex:1; min-width:0">
                <div class="strong" style="font-size:14.5px">{{ cur.booking_title || '未关联会议' }} <span class="tag tag-blue" style="margin-left:6px">v{{ cur.version }}</span></div>
                <div class="muted" style="font-size:12px; margin-top:4px">
                  <ic name="user" size="12"></ic> 纪要人：{{ cur.author_name || '—' }}　
                  <ic name="clock" size="12"></ic> 更新于 {{ bj(cur.updated_at || cur.created_at) }}
                </div>
                <div class="muted" style="font-size:12px; margin-top:2px; display:flex; align-items:center; gap:4px">
                  <ic name="file-text" size="12"></ic> 会议纪要：{{ (cur.booking_title || '会议') + '纪要' }}
                  <a class="card-link" @click="$root.go('/conference/minutes')">查看详情 <ic name="chevron-right" size="11"></ic></a>
                </div>
              </div>
            </div>
            <div v-else class="empty">暂无会议纪要，请先在「会议纪要与行动项」中创建</div>

            <template v-if="items.length">
              <div style="display:flex; align-items:center; justify-content:space-between; margin:16px 0 8px">
                <span class="strong" style="font-size:13.5px">会议纪要中的行动项 <span class="muted" style="font-weight:400">（共 {{ items.length }} 项，未转办 {{ pendingItems.length }} 项）</span></span>
                <span v-if="convertedCount" class="tag tag-teal">已转办 {{ convertedCount }} 项</span>
              </div>
              <table class="table table-tight">
                <thead>
                  <tr>
                    <th style="width:34px"><input type="checkbox" :checked="allChecked" @change="toggleAll" title="全选未转办事项"></th>
                    <th style="width:44px">序号</th>
                    <th>议定事项 / 行动项</th>
                    <th style="width:90px">责任人</th>
                    <th style="width:104px">计划完成时间</th>
                    <th style="width:170px">状态</th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="(it, i) in items" :key="it.id" :class="{ sel: selected.includes(it.id) }">
                    <td><input type="checkbox" :disabled="!!it.converted_supervision_id" :checked="selected.includes(it.id)" @change="selected.includes(it.id) ? selected = selected.filter(x => x !== it.id) : selected.push(it.id)"></td>
                    <td class="num muted">{{ i + 1 }}</td>
                    <td class="ellipsis" style="max-width:300px" :title="it.task_description">{{ it.task_description }}</td>
                    <td>{{ it.assignee_name || '—' }}</td>
                    <td class="num muted">{{ day(it.due_date) }}</td>
                    <td>
                      <span :class="['tag', statusTag(it.status)]">{{ it.status_label }}</span>
                      <span v-if="convLabel(it)" class="tag tag-teal" style="margin-left:4px"><ic name="check-circle-2" size="11"></ic>{{ convLabel(it) }}</span>
                    </td>
                  </tr>
                </tbody>
              </table>
            </template>
          </div>
        </div>

        <!-- step 2: build supervision task -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">2. 生成督办单 <span v-if="selected.length" class="tag tag-blue">已选择 {{ selected.length }} 项</span></div>
          </div>
          <div class="card-bd" style="padding-top:10px">
            <div class="muted" style="font-size:12.5px; margin-bottom:14px">为所选事项填写督办信息，确认后批量生成督办单至【政务重点督办】。</div>
            <div class="form-item">
              <label>来源会议</label>
              <div class="mts-source">
                <ic name="calendar-days" size="13"></ic>
                {{ cur ? (cur.booking_title || '未关联会议') : '—' }}
                <span class="muted" v-if="cur">（{{ bj(cur.updated_at || cur.created_at).slice(0, 10) }}）</span>
              </div>
            </div>
            <div class="form-item">
              <label class="req">主办处室</label>
              <select class="select" v-model="form.lead_dept_id">
                <option value="" disabled>请选择主办处室</option>
                <option v-for="d in depts" :key="d.dept_id" :value="d.dept_id">{{ deptLabel(d.depth) }}{{ d.dept_name }}</option>
              </select>
            </div>
            <div class="form-item">
              <label class="req">办理时限</label>
              <input type="date" class="input" v-model="form.deadline">
            </div>
            <div class="form-item">
              <label class="req">紧急程度</label>
              <select class="select" v-model="form.priority">
                <option value="NORMAL">普通</option>
                <option value="URGENT">紧急</option>
                <option value="TOP">特急</option>
              </select>
            </div>
            <div class="form-item" style="margin-bottom:0">
              <label></label>
              <div>
                <span :class="['tag', prioTag(form.priority)]">{{ { TOP: '特急件', URGENT: '紧急件', NORMAL: '普通件' }[form.priority] }}</span>
                <span class="muted" style="font-size:12px; margin-left:8px">转办后事项状态将置为「进行中」，并可在督办模块跟踪反馈。</span>
              </div>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:10px; margin-top:22px; padding-top:14px; border-top:1px solid var(--line)">
              <button class="btn btn-ghost" @click="resetForm">取 消</button>
              <button class="btn btn-primary" :disabled="converting || !selected.length" @click="convert">
                <ic name="send" size="14"></ic>生成督办单{{ selected.length ? '（' + selected.length + ' 项）' : '' }}
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- minutes picker modal -->
      <Modal title="更换会议（选择会议纪要）" width="640px" v-if="showPicker" @close="showPicker = false">
        <table class="table">
          <thead><tr><th>会议名称</th><th style="width:90px">纪要人</th><th style="width:70px">版本</th><th style="width:130px">更新时间</th><th style="width:70px">操作</th></tr></thead>
          <tbody>
            <tr v-for="m in minutes" :key="m.id">
              <td class="strong ellipsis" style="max-width:250px">{{ m.booking_title || '未关联会议' }}</td>
              <td>{{ m.author_name || '—' }}</td>
              <td><span class="tag tag-blue">v{{ m.version }}</span></td>
              <td class="num muted">{{ bj(m.updated_at || m.created_at) }}</td>
              <td class="actions"><button class="btn btn-text btn-sm" @click="pick(m.id); showPicker = false">选择</button></td>
            </tr>
            <tr v-if="!minutes.length"><td colspan="5"><div class="empty">暂无会议纪要</div></td></tr>
          </tbody>
        </table>
        <template #footer>
          <button class="btn btn-ghost" @click="showPicker = false">关闭</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
