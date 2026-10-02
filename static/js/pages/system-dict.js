/* /system/dict 数据字典管理 — pixel replica of design/mockups/074-system-dict.png
   Layout: (字典类别列表 | 字典项列表+筛选+表格 | 字典项编辑面板) */
AppPages['/system/dict'] = {
  route: '/system/dict', title: '数据字典管理', category: 'SYSTEM', primaryAction: null, icon: 'book-open',
  subtitle: '集中维护全局共享的数据字典，用于系统各业务模块的标准化选项配置，如假种字典、资产分类字典、公车类型字典、督办紧急度字典、访客状态字典等。',
  component: {
    data() {
      return {
        loading: true,
        types: [], typeKw: '', selType: null,
        dataCache: {}, counts: {},
        kw: '',
        editor: this.blankEditor(),
        saving: false,
        typeIcons: ['sun', 'box', 'car', 'siren', 'users', 'calendar-check-2', 'file-text', 'megaphone', 'target', 'clipboard-list', 'settings', 'layers'],
        classOptions: [
          { v: 'default', label: '默认', tag: 'tag-gray' },
          { v: 'primary', label: '主要', tag: 'tag-blue' },
          { v: 'success', label: '成功', tag: 'tag-green' },
          { v: 'info', label: '信息', tag: 'tag-gray' },
          { v: 'warning', label: '警告', tag: 'tag-amber' },
          { v: 'danger', label: '危险', tag: 'tag-red' },
        ],
      };
    },
    computed: {
      filteredTypes() {
        const kw = (this.typeKw || '').trim().toLowerCase();
        if (!kw) return this.types;
        return this.types.filter((t) => (t.dict_name || '').toLowerCase().includes(kw) || (t.dict_type || '').toLowerCase().includes(kw));
      },
      selTypeMeta() { return this.types.find((t) => t.dict_type === this.selType) || null; },
      currentRows() {
        let rows = this.dataCache[this.selType] || [];
        const kw = (this.kw || '').trim().toLowerCase();
        if (kw) rows = rows.filter((d) => ((d.dict_label || '') + (d.dict_value || '')).toLowerCase().includes(kw));
        return rows;
      },
    },
    async mounted() {
      try {
        const ts = await api.get('/api/system/dict/types');
        this.types = ts || [];
        if (this.types.length) await this.selectType(this.types[0].dict_type, true);
        this.loadCounts();
      } catch (e) { /* empty state */ }
      this.loading = false;
    },
    methods: {
      blankEditor() {
        return { mode: 'create', dict_code: null, dict_label: '', dict_value: '', dict_sort: 1, list_class: 'default' };
      },
      async loadCounts() {
        for (const t of this.types) {
          try {
            const d = await api.get('/api/system/dict/data', { dict_type: t.dict_type });
            this.counts[t.dict_type] = (d || []).length;
          } catch (e) { this.counts[t.dict_type] = 0; }
        }
      },
      async selectType(dictType, keepEditor) {
        this.selType = dictType;
        this.kw = '';
        if (!keepEditor) this.editor = this.blankEditor();
        if (!this.dataCache[dictType]) {
          try {
            const d = await api.get('/api/system/dict/data', { dict_type: dictType });
            this.dataCache = Object.assign({}, this.dataCache, { [dictType]: d || [] });
          } catch (e) { this.dataCache = Object.assign({}, this.dataCache, { [dictType]: [] }); }
        }
      },
      typeIcon(i) { return this.typeIcons[i % this.typeIcons.length]; },
      classTag(c) { const o = this.classOptions.find((x) => x.v === c); return o ? o.tag : 'tag-gray'; },
      classLabel(c) { const o = this.classOptions.find((x) => x.v === c); return o ? o.label : (c || '默认'); },
      startCreate() {
        if (!this.selType) return this.$root.toast('请先在左侧选择字典类别', 'warn');
        this.editor = Object.assign(this.blankEditor(), { dict_sort: (this.currentRows.length || 0) + 1 });
      },
      startEdit(d) {
        this.editor = { mode: 'edit', dict_code: d.dict_code, dict_label: d.dict_label, dict_value: d.dict_value, dict_sort: d.dict_sort, list_class: d.list_class || 'default' };
      },
      async saveItem() {
        const e = this.editor;
        if (!e.dict_label.trim()) return this.$root.toast('请填写字典标签 (Label)', 'warn');
        if (!e.dict_value.trim()) return this.$root.toast('请填写字典键值 (Value)', 'warn');
        this.saving = true;
        try {
          const body = {
            dict_label: e.dict_label.trim(), dict_value: e.dict_value.trim(), dict_type: this.selType,
            dict_sort: Number(e.dict_sort) || 0, list_class: e.list_class,
          };
          if (e.mode === 'create') {
            await api.post('/api/system/dict/data', body);
            this.$root.toast('字典项已新增', 'ok');
          } else {
            await api.put('/api/system/dict/data/' + e.dict_code, body);
            this.$root.toast('字典项已保存', 'ok');
          }
          this.dataCache = Object.assign({}, this.dataCache, { [this.selType]: null });
          delete this.dataCache[this.selType];
          await this.selectType(this.selType, true);
          this.counts[this.selType] = (this.dataCache[this.selType] || []).length;
        } catch (e2) { /* toast shown */ }
        this.saving = false;
      },
      async removeItem(d) {
        if (!window.confirm('确认删除字典项「' + d.dict_label + '」？')) return;
        try {
          await api.del('/api/system/dict/data/' + d.dict_code);
          this.$root.toast('删除成功', 'ok');
          this.dataCache = Object.assign({}, this.dataCache, { [this.selType]: null });
          delete this.dataCache[this.selType];
          await this.selectType(this.selType, true);
          this.counts[this.selType] = (this.dataCache[this.selType] || []).length;
          if (this.editor.mode === 'edit' && this.editor.dict_code === d.dict_code) this.editor = this.blankEditor();
        } catch (e) { /* toast shown */ }
      },
    },
    template: `
    <div v-if="!loading">
      <div class="dict-layout">
        <!-- dict types -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">字典类别</div></div>
          <div class="card-bd">
            <div class="sys-tree-search">
              <ic name="search" size="14"></ic>
              <input class="input" placeholder="搜索字典类别名称" v-model="typeKw">
            </div>
            <div class="dict-type-list">
              <div v-for="(t, i) in filteredTypes" :key="t.dict_id" class="dict-type-item" :class="{on: selType === t.dict_type}" @click="selectType(t.dict_type)">
                <ic :name="typeIcon(i)" size="15"></ic>
                <span style="overflow:hidden; text-overflow:ellipsis; white-space:nowrap">{{ t.dict_name }}</span>
                <span class="cnt">{{ counts[t.dict_type] !== undefined ? counts[t.dict_type] : '…' }}</span>
              </div>
              <div v-if="!filteredTypes.length" class="empty">暂无字典类别</div>
            </div>
          </div>
        </div>

        <!-- dict data -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">字典项列表{{ selTypeMeta ? '（' + selTypeMeta.dict_name + '）' : '' }}</div>
            <div style="display:flex; gap:8px; align-items:center">
              <input class="input" style="width:190px; height:30px" placeholder="请输入字典项名称或值" v-model="kw">
              <button class="btn btn-primary btn-sm" @click="startCreate"><ic name="plus" size="13"></ic>新增字典项</button>
            </div>
          </div>
          <div class="card-bd" style="padding-top:10px">
            <table class="table">
              <thead><tr><th style="width:52px">序号</th><th>字典标签 (Label)</th><th>字典键值 (Value)</th><th style="width:76px">显示顺序</th><th style="width:86px">样式</th><th style="width:96px">操作</th></tr></thead>
              <tbody>
                <tr v-for="(d, i) in currentRows" :key="d.dict_code" :class="{sel: editor.mode === 'edit' && editor.dict_code === d.dict_code}" style="cursor:pointer" @click="startEdit(d)">
                  <td class="num muted">{{ i + 1 }}</td>
                  <td class="strong">{{ d.dict_label }}</td>
                  <td class="mono">{{ d.dict_value }}</td>
                  <td class="num muted">{{ d.dict_sort }}</td>
                  <td><span :class="['tag', classTag(d.list_class)]">{{ classLabel(d.list_class) }}</span></td>
                  <td class="actions" @click.stop>
                    <button class="btn btn-text btn-sm" @click="startEdit(d)">编辑</button>
                    <button class="btn btn-text btn-sm danger" @click="removeItem(d)">删除</button>
                  </td>
                </tr>
                <tr v-if="!currentRows.length"><td colspan="6"><div class="empty">{{ selType ? '该类别暂无字典项，点击右上角新增' : '请先选择左侧字典类别' }}</div></td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <!-- editor -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">字典项{{ editor.mode === 'create' ? '新增' : '编辑' }}</div>
            <ic name="x" size="16" style="cursor:pointer; color:var(--text-3)" @click="editor = blankEditor()"></ic>
          </div>
          <div class="card-bd" v-if="selType">
            <div class="form-item" style="display:block">
              <label style="text-align:left; width:auto; padding-top:0" class="req">字典标签 (Label)</label>
              <input class="input" style="width:100%; margin-top:6px" placeholder="在各业务场景中显示的名称" v-model="editor.dict_label">
            </div>
            <div class="form-item" style="display:block">
              <label style="text-align:left; width:auto; padding-top:0" class="req">字典键值 (Value)</label>
              <input class="input" style="width:100%; margin-top:6px" placeholder="用于程序判断，建议大写英文或数字" v-model="editor.dict_value">
              <div class="cfg-help">用于程序判断，建议使用字母或数字，保存后不建议修改。</div>
            </div>
            <div class="form-item" style="display:block">
              <label style="text-align:left; width:auto; padding-top:0" class="req">显示顺序</label>
              <input class="input" style="width:100%; margin-top:6px" type="number" v-model="editor.dict_sort">
              <div class="cfg-help">数值越小，显示越靠前。</div>
            </div>
            <div class="form-item" style="display:block">
              <label style="text-align:left; width:auto; padding-top:0">样式属性</label>
              <select class="select" style="width:100%; margin-top:6px" v-model="editor.list_class">
                <option v-for="o in classOptions" :key="o.v" :value="o.v">{{ o.label }}（{{ o.v }}）</option>
              </select>
              <div style="margin-top:8px"><span :class="['tag', classTag(editor.list_class)]">预览效果</span></div>
            </div>
            <div class="mini-stat" style="margin:6px 0 14px">
              <div class="muted" style="font-size:12px">所属字典类别</div>
              <div class="strong" style="font-size:13px">{{ selTypeMeta ? selTypeMeta.dict_name : '—' }} <span class="mono muted" style="font-size:11px">{{ selType }}</span></div>
            </div>
            <div style="display:flex; justify-content:flex-end; gap:10px">
              <button class="btn btn-ghost" @click="editor = blankEditor()">取消</button>
              <button class="btn btn-primary" :disabled="saving || !selType" @click="saveItem"><ic name="save" size="14"></ic>保存</button>
            </div>
          </div>
          <div class="card-bd" v-else><div class="empty">请先选择字典类别</div></div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
