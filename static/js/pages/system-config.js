/* /system/config 系统参数配置 — pixel replica of design/mockups/075-system-config.png
   Layout: 按模块分组参数卡片（行内编辑+用途说明） / 参数一览表格 + 编辑弹窗 */
AppPages['/system/config'] = {
  route: '/system/config', title: '系统参数配置', category: 'SYSTEM', primaryAction: '保存全部修改', icon: 'sliders-horizontal',
  subtitle: '管理平台运行所需的基础参数，支持按业务模块分类配置。修改后将实时生效，并记录操作日志。',
  component: {
    data() {
      return {
        loading: true,
        configs: [],
        edits: {},
        saving: false,
        showEdit: false, editTarget: null, editName: '', editValue: '',
        groupMeta: [
          {
            prefix: 'attendance', name: '考勤管理参数', desc: '配置考勤打卡范围、时间规则等参数。', icon: 'users', color: 'blue',
            fields: {
              'attendance.clock.radius': { unit: '米', help: '员工在规定地点的有效打卡范围，超出该范围将无法打卡。' },
              'attendance.rule.json': { help: '考勤规则 JSON 配置：班次、工作日、弹性分钟、考勤组等。' },
            },
          },
          {
            prefix: 'visitor', name: '访客管理参数', desc: '配置访客通行有效期、预约规则等参数。', icon: 'id-card', color: 'teal',
            fields: {
              'visitor.pass.valid_hours': { unit: '小时', help: '访客凭证在入场后/门通行的有效时长，超时将自动失效。' },
              'visitor.overdue.minutes': { unit: '分钟', help: '访客滞留超过该时长将触发滞留告警并通知被访人。' },
              'visitor.access.rules.json': { help: '门禁通行规则 JSON 配置：允许楼层、保密层禁行、滞留阈值等。' },
            },
          },
          {
            prefix: 'fleet', name: '公务用车管理参数', desc: '配置车辆保养、使用及预警相关参数。', icon: 'car', color: 'amber',
            fields: {
              'fleet.maintenance.mileage': { unit: '公里', help: '车辆行驶里程达到该阈值时，系统自动发出保养提醒。' },
              'fleet.fuel.threshold': { unit: '升/百公里', help: '百公里油耗超过该阈值将判定为油耗异常并生成审计线索。' },
            },
          },
        ],
        otherMeta: { name: '知识库与其他参数', desc: '知识库服务地址及扩展配置。', icon: 'server', color: 'teal', fields: {} },
      };
    },
    computed: {
      knownKeys() {
        const s = new Set();
        this.groupMeta.forEach((g) => Object.keys(g.fields).forEach((k) => s.add(k)));
        return s;
      },
      groups() {
        const gs = this.groupMeta.map((g) => Object.assign({}, g, { items: [] }));
        const other = Object.assign({}, this.otherMeta, { items: [] });
        this.configs.forEach((c) => {
          const p = (c.config_key || '').split('.')[0];
          const g = gs.find((x) => x.prefix === p);
          (g || other).items.push(c);
        });
        const out = gs.filter((g) => g.items.length);
        if (other.items.length) out.push(other);
        return out;
      },
      dirtyCount() {
        return this.configs.filter((c) => this.isDirty(c)).length;
      },
    },
    async mounted() {
      await this.load();
      this.loading = false;
    },
    methods: {
      async load() {
        try { this.configs = (await api.get('/api/system/configs')) || []; } catch (e) { this.configs = []; }
      },
      metaOf(key) {
        for (const g of this.groupMeta) if (g.fields[key]) return g.fields[key];
        return null;
      },
      isJson(v) { return typeof v === 'string' && v.trim().startsWith('{'); },
      val(c) { return this.edits[c.config_key] !== undefined ? this.edits[c.config_key] : c.config_value; },
      isDirty(c) { return this.edits[c.config_key] !== undefined && this.edits[c.config_key] !== c.config_value; },
      async saveOne(c) {
        if (!this.isDirty(c)) return;
        try {
          await api.put('/api/system/configs/' + c.config_id, { config_value: this.edits[c.config_key] });
          this.$root.toast('「' + c.config_name + '」已保存', 'ok');
          delete this.edits[c.config_key];
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      async saveAll() {
        const dirty = this.configs.filter((c) => this.isDirty(c));
        if (!dirty.length) return this.$root.toast('没有待保存的修改', 'warn');
        this.saving = true;
        let okn = 0;
        for (const c of dirty) {
          try { await api.put('/api/system/configs/' + c.config_id, { config_value: this.edits[c.config_key] }); okn++; delete this.edits[c.config_key]; } catch (e) { /* keep */ }
        }
        this.$root.toast('已保存 ' + okn + ' / ' + dirty.length + ' 项参数', okn === dirty.length ? 'ok' : 'warn');
        await this.load();
        this.saving = false;
      },
      openEdit(c) { this.editTarget = c; this.editName = c.config_name; this.editValue = c.config_value; this.showEdit = true; },
      async submitEdit() {
        if (!this.editName.trim()) return this.$root.toast('参数名称不能为空', 'warn');
        try {
          await api.put('/api/system/configs/' + this.editTarget.config_id, { config_name: this.editName.trim(), config_value: this.editValue });
          this.$root.toast('参数已更新', 'ok');
          this.showEdit = false;
          await this.load();
        } catch (e) { /* toast shown */ }
      },
      onPrimary() { this.saveAll(); },
    },
    template: `
    <div v-if="!loading">
      <!-- grouped param cards -->
      <div class="cfg-cards">
        <div v-for="g in groups" :key="g.name" class="card" style="margin-top:0; padding:16px 18px">
          <div style="display:flex; align-items:center; gap:12px; margin-bottom:2px">
            <span :class="['ico-box', 'ico-' + g.color]" style="width:42px;height:42px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex:none"><ic :name="g.icon" size="22"></ic></span>
            <div>
              <div class="strong" style="font-size:15px">{{ g.name }}</div>
              <div class="muted" style="font-size:12px">{{ g.desc }}</div>
            </div>
          </div>
          <div v-for="c in g.items" :key="c.config_id" class="cfg-field">
            <div class="cfg-label">{{ c.config_name }} <span class="tag tag-gray" style="font-weight:400">{{ c.config_type === 'Y' ? '内置' : '业务' }}</span></div>
            <div class="cfg-input-row">
              <textarea v-if="isJson(c.config_value) || isJson(val(c))" class="input cfg-json" rows="4"
                        :value="val(c)" @input="edits[c.config_key] = $event.target.value"></textarea>
              <template v-else>
                <input class="input" :value="val(c)" @input="edits[c.config_key] = $event.target.value">
                <span v-if="metaOf(c.config_key) && metaOf(c.config_key).unit" class="cfg-unit">{{ metaOf(c.config_key).unit }}</span>
              </template>
            </div>
            <div class="cfg-help">{{ (metaOf(c.config_key) && metaOf(c.config_key).help) || (isJson(c.config_value) ? 'JSON 结构配置，请按原有格式编辑。' : '平台运行参数，修改后实时生效。') }}</div>
            <div v-if="isDirty(c)" style="text-align:right; margin-top:4px">
              <button class="btn btn-primary btn-sm" :disabled="saving" @click="saveOne(c)"><ic name="save" size="12"></ic>保存该参数</button>
            </div>
          </div>
          <div class="cfg-foot" :class="g.color">
            <ic name="clock" size="14" style="margin-top:2px"></ic>
            <span>修改后将实时生效并记入 <a @click="$root.go('/system/log')" style="cursor:pointer">安全审计与日志</a>，请谨慎操作。</span>
          </div>
        </div>
      </div>

      <!-- all params table -->
      <div class="card mt16">
        <div class="card-hd">
          <div class="t">参数一览</div>
          <span class="muted" style="font-size:12px">共 {{ configs.length }} 项 ·{{ dirtyCount ? ' 有 ' + dirtyCount + ' 项待保存' : ' 无待保存修改' }}</span>
        </div>
        <div class="card-bd" style="padding-top:8px">
          <table class="table">
            <thead><tr><th>参数名称</th><th>参数键名</th><th>参数值</th><th style="width:70px">内置</th><th style="width:90px">操作</th></tr></thead>
            <tbody>
              <tr v-for="c in configs" :key="c.config_id">
                <td class="strong">{{ c.config_name }} <span v-if="isDirty(c)" class="tag tag-amber" style="margin-left:4px">待保存</span></td>
                <td class="mono muted">{{ c.config_key }}</td>
                <td class="mono ellipsis" style="max-width:380px" :title="c.config_value">{{ c.config_value }}</td>
                <td><span :class="['tag', c.config_type === 'Y' ? 'tag-blue' : 'tag-gray']">{{ c.config_type === 'Y' ? '是' : '否' }}</span></td>
                <td class="actions"><button class="btn btn-text btn-sm" @click="openEdit(c)">编辑</button></td>
              </tr>
              <tr v-if="!configs.length"><td colspan="5"><div class="empty">暂无系统参数</div></td></tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- edit modal -->
      <Modal title="编辑系统参数" width="600px" v-if="showEdit" @close="showEdit = false">
        <div class="desc-list" style="margin-bottom:14px">
          <span class="k">参数键名</span><span class="mono">{{ editTarget ? editTarget.config_key : '' }}</span>
        </div>
        <div class="form-item"><label>参数名称</label>
          <input class="input" v-model="editName"></div>
        <div class="form-item"><label class="req">参数值</label>
          <textarea class="input" style="min-height:110px; font-family:ui-monospace,Menlo,Consolas,monospace" v-model="editValue"></textarea></div>
        <div class="cfg-help"><ic name="alert-triangle" size="13"></ic> 修改后将实时生效，请确认取值合法；非法 JSON 将导致相关模块异常。</div>
        <template #footer>
          <button class="btn btn-ghost" @click="showEdit = false">取消</button>
          <button class="btn btn-primary" @click="submitEdit">保存修改</button>
        </template>
      </Modal>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
