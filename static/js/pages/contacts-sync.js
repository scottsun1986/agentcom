/* /contacts/sync 通讯录导入与同步 — pixel replica of design/mockups/046-contacts-sync.png
   Layout: (模板下载 | 批量导入 | 导出通讯录) 3 cards / (模板列定义 + 导入结果) | 外部通讯录同步源卡片 */
AppPages['/contacts/sync'] = {
  route: '/contacts/sync', title: '通讯录导入与同步', category: 'CONTACTS', primaryAction: null, icon: 'refresh-cw',
  subtitle: '支持标准 Excel/CSV 模板批量导入导出，并可与 LDAP、政务微信、钉钉通讯录进行单/双向同步，统一管理组织通讯录。',
  component: {
    data() {
      return {
        loading: true,
        cols: [], // /sync/template 列定义
        fileName: '',
        parsedRows: null,
        parseError: '',
        importResult: null,
        importing: false,
        exporting: false,
        sources: [
          { key: 'LDAP', name: 'LDAP（单位总目录）', icon: 'server', desc: '单位组织与人员目录，支持按 OU 同步', dir: '双向同步' },
          { key: 'GOVWX', name: '政务微信通讯录', icon: 'message-square', desc: '政务微信组织架构与成员联系方式', dir: '单向导入（外部 → 本系统）' },
          { key: 'DING', name: '钉钉通讯录', icon: 'send', desc: '钉钉部门与成员，支持增量同步', dir: '双向同步' },
        ],
      };
    },
    computed: {
      previewRows() { return (this.parsedRows || []).slice(0, 5); },
      previewCols() { return this.cols.length ? this.cols.map((c) => c.column) : ['user_name', 'nick_name']; },
    },
    async mounted() {
      try { this.cols = await api.get('/api/contacts/sync/template') || []; } catch (e) { this.cols = []; }
      this.loading = false;
    },
    methods: {
      esc(v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; },
      downloadCsv(name, header, rows) {
        const lines = [header].concat(rows || []).map((r) => r.map(this.esc).join(','));
        const blob = new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = name;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      },
      today() {
        const d = new Date();
        const p = (n) => String(n).padStart(2, '0');
        return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
      },
      downloadTemplate() {
        const header = this.cols.map((c) => c.label);
        const sample = this.cols.map((c) => ({
          user_name: 'gz0001', nick_name: '张三', dept_name: '办公室', phonenumber: '13800000001', email: 'zhangsan@example.com', sex: '男',
        }[c.column] || ''));
        this.downloadCsv('通讯录导入模板_' + this.today() + '.csv', header, [sample]);
        this.$root.toast('模板已下载，请按列定义填写后导入', 'ok');
      },
      parseCsv(text) {
        text = text.replace(/^\ufeff/, '');
        const rows = []; let row = []; let cell = ''; let inQ = false;
        for (let i = 0; i < text.length; i++) {
          const ch = text[i];
          if (inQ) {
            if (ch === '"') {
              if (text[i + 1] === '"') { cell += '"'; i++; } else inQ = false;
            } else cell += ch;
          } else if (ch === '"') inQ = true;
          else if (ch === ',') { row.push(cell); cell = ''; }
          else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cell); cell = '';
            if (row.length > 1 || String(row[0] || '').trim() !== '') rows.push(row);
            row = [];
          } else cell += ch;
        }
        row.push(cell);
        if (row.length > 1 || String(row[0] || '').trim() !== '') rows.push(row);
        return rows;
      },
      onFile(ev) {
        const f = ev.target.files && ev.target.files[0];
        if (!f) return;
        this.parsedRows = null;
        this.importResult = null;
        this.parseError = '';
        this.fileName = f.name;
        const reader = new FileReader();
        reader.onload = () => {
          try {
            const text = String(reader.result || '');
            let arr = null;
            if (/\.json$/i.test(f.name) || text.trim().startsWith('[') || text.trim().startsWith('{')) {
              const j = JSON.parse(text);
              arr = Array.isArray(j) ? j : (j && Array.isArray(j.rows) ? j.rows : null);
              if (!arr) throw new Error('JSON 内容需为数组或含 rows 数组的对象');
            } else {
              const table = this.parseCsv(text);
              if (!table.length) throw new Error('文件内容为空');
              const header = table[0].map((h) => String(h).trim());
              const keyOf = (h) => {
                const c = this.cols.find((x) => x.column === h || x.label === h);
                return c ? c.column : h;
              };
              arr = table.slice(1)
                .filter((r) => r.some((c) => String(c == null ? '' : c).trim() !== ''))
                .map((r) => {
                  const o = {};
                  header.forEach((h, i) => { o[keyOf(h)] = String(r[i] == null ? '' : r[i]).trim(); });
                  return o;
                });
            }
            this.parsedRows = arr;
            if (!arr.length) this.parseError = '未解析到有效数据行';
          } catch (e) {
            this.parseError = e.message || '文件解析失败';
          }
        };
        reader.onerror = () => { this.parseError = '文件读取失败'; };
        reader.readAsText(f, 'utf-8');
        ev.target.value = '';
      },
      async doImport() {
        if (!this.parsedRows || !this.parsedRows.length) return this.$root.toast('请先选择并解析数据文件', 'warn');
        this.importing = true;
        try {
          const d = await api.post('/api/contacts/sync/import', { rows: this.parsedRows });
          this.importResult = d || { created: 0, updated: 0, skipped: 0 };
          this.$root.toast('导入完成：新增 ' + this.importResult.created + ' 条、更新 ' + this.importResult.updated + ' 条、跳过 ' + this.importResult.skipped + ' 条', 'ok');
        } catch (e) { /* toast shown */ }
        this.importing = false;
      },
      async doExport() {
        this.exporting = true;
        try {
          const rows = await api.post('/api/contacts/sync/export', {});
          const sexOf = (v) => ({ '0': '男', '1': '女', '2': '未知' }[v] || v);
          const header = this.cols.map((c) => c.label);
          const body = (rows || []).map((r) => this.cols.map((c) => (c.column === 'sex' ? sexOf(r[c.column]) : r[c.column])));
          this.downloadCsv('通讯录导出_' + this.today() + '.csv', header, body);
          this.$root.toast('已导出 ' + (rows || []).length + ' 条通讯录数据', 'ok');
        } catch (e) { /* toast shown */ }
        this.exporting = false;
      },
      syncNow(s) { this.$root.toast(s.name + ' 未配置连接，请先在系统管理中配置同步源', 'warn'); },
    },
    template: `
    <div v-if="!loading">
      <!-- top 3 action cards -->
      <div class="sync-3col" style="margin-bottom:16px">
        <div class="card sync-card" style="margin-top:0">
          <span class="ico-box ico-teal" style="width:46px;height:46px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex:none"><ic name="file-text" size="24"></ic></span>
          <div style="flex:1; min-width:0">
            <div class="strong" style="font-size:14.5px">标准模板下载</div>
            <div class="muted" style="font-size:12px; margin-top:4px; line-height:1.6">使用标准 CSV/Excel 模板批量导入通讯录，包含{{ cols.map(c => c.label).join('、') }}等字段</div>
            <div style="display:flex; gap:8px; margin-top:10px">
              <button class="btn btn-primary btn-sm" @click="downloadTemplate"><ic name="download" size="13"></ic>下载模板</button>
            </div>
          </div>
        </div>
        <div class="card sync-card" style="margin-top:0">
          <span class="ico-box ico-blue" style="width:46px;height:46px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex:none"><ic name="upload" size="24"></ic></span>
          <div style="flex:1; min-width:0">
            <div class="strong" style="font-size:14.5px">批量导入</div>
            <div class="muted" style="font-size:12px; margin-top:4px; line-height:1.6">支持 JSON 数组或 CSV（首行为列名/列说明）格式，按账号 upsert</div>
            <div style="display:flex; gap:8px; margin-top:10px; align-items:center; flex-wrap:wrap">
              <label class="btn btn-primary btn-sm" style="cursor:pointer"><ic name="upload" size="13"></ic>选择文件上传<input type="file" accept=".csv,.json,text/csv,application/json" style="display:none" @change="onFile"></label>
              <span v-if="fileName" class="muted" style="font-size:12px"><ic name="file-text" size="12"></ic> {{ fileName }}（{{ parsedRows ? parsedRows.length + ' 行' : '解析中…' }}）</span>
            </div>
            <div v-if="parseError" style="margin-top:6px"><span class="tag tag-red"><ic name="alert-triangle" size="11"></ic>{{ parseError }}</span></div>
          </div>
        </div>
        <div class="card sync-card" style="margin-top:0">
          <span class="ico-box ico-amber" style="width:46px;height:46px;border-radius:10px;display:inline-flex;align-items:center;justify-content:center;flex:none"><ic name="download" size="24"></ic></span>
          <div style="flex:1; min-width:0">
            <div class="strong" style="font-size:14.5px">导出通讯录</div>
            <div class="muted" style="font-size:12px; margin-top:4px; line-height:1.6">按当前查看者权限导出组织通讯录（敏感号码按规则脱敏），生成 CSV 文件</div>
            <div style="display:flex; gap:8px; margin-top:10px">
              <button class="btn btn-ghost btn-sm" :disabled="exporting" @click="doExport"><ic name="download" size="13"></ic>{{ exporting ? '导出中…' : '导出数据' }}</button>
            </div>
          </div>
        </div>
      </div>

      <div class="split-3-2" style="align-items:start">
        <!-- left: template columns + validation/import result -->
        <div class="card" style="margin-top:0">
          <div class="card-hd">
            <div class="t">模板列定义与数据校验</div>
            <span v-if="parsedRows" class="tag tag-blue">已解析 {{ parsedRows.length }} 行</span>
          </div>
          <div class="card-bd" style="padding-top:10px">
            <table class="table table-tight">
              <thead><tr><th style="width:150px">字段名</th><th>列说明</th><th style="width:90px">是否必填</th></tr></thead>
              <tbody>
                <tr v-for="c in cols" :key="c.column">
                  <td class="num" style="font-family:Consolas,Menlo,monospace; font-size:12.5px">{{ c.column }}</td>
                  <td>{{ c.label }}</td>
                  <td><span :class="['tag', c.required ? 'tag-red' : 'tag-gray']">{{ c.required ? '必填' : '选填' }}</span></td>
                </tr>
                <tr v-if="!cols.length"><td colspan="3"><div class="empty">模板列定义加载失败</div></td></tr>
              </tbody>
            </table>

            <div v-if="parsedRows && parsedRows.length" style="margin-top:14px">
              <div class="strong" style="font-size:13.5px; margin-bottom:6px">数据预览 <span class="muted" style="font-weight:400; font-size:12px">（前 {{ previewRows.length }} 行）</span></div>
              <table class="table table-tight">
                <thead><tr><th v-for="c in previewCols" :key="c">{{ c }}</th></tr></thead>
                <tbody>
                  <tr v-for="(r, i) in previewRows" :key="i">
                    <td v-for="c in previewCols" :key="c" class="ellipsis" style="max-width:140px">{{ r[c] || '—' }}</td>
                  </tr>
                </tbody>
              </table>
              <div style="margin-top:12px">
                <button class="btn btn-primary" :disabled="importing" @click="doImport"><ic name="upload" size="14"></ic>{{ importing ? '导入中…' : '确认导入（' + parsedRows.length + ' 行）' }}</button>
              </div>
            </div>

            <div v-if="importResult" class="sync-result">
              <div :class="['sr-chip', 'ok']"><ic name="check-circle-2" size="16"></ic><div><b>{{ importResult.created }}</b><span>新增人员</span></div></div>
              <div :class="['sr-chip', 'blue']"><ic name="refresh-cw" size="16"></ic><div><b>{{ importResult.updated }}</b><span>更新人员</span></div></div>
              <div :class="['sr-chip', 'gray']"><ic name="ban" size="16"></ic><div><b>{{ importResult.skipped }}</b><span>跳过（缺账号/姓名）</span></div></div>
            </div>
          </div>
        </div>

        <!-- right: external sync sources -->
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t">外部通讯录同步</div><span class="tag tag-gray"><ic name="settings" size="11"></ic>同步源管理</span></div>
          <div class="card-bd" style="padding-top:10px">
            <div v-for="s in sources" :key="s.key" class="sync-source">
              <span class="ico-box ico-blue" style="width:38px;height:38px;border-radius:9px;display:inline-flex;align-items:center;justify-content:center;flex:none"><ic :name="s.icon" size="19"></ic></span>
              <div style="flex:1; min-width:0">
                <div style="display:flex; align-items:center; gap:8px">
                  <span class="strong" style="font-size:13.5px">{{ s.name }}</span>
                  <span class="tag tag-gray"><ic name="link" size="11"></ic>未配置连接</span>
                </div>
                <div class="muted" style="font-size:12px; margin-top:3px">{{ s.desc }}</div>
                <div class="muted" style="font-size:12px; margin-top:2px">最后同步：—</div>
                <div style="display:flex; align-items:center; gap:8px; margin-top:8px">
                  <span class="muted" style="font-size:12px">同步方向</span>
                  <select class="select" style="width:190px" disabled>
                    <option>{{ s.dir }}</option>
                  </select>
                  <button class="btn btn-ghost btn-sm" @click="syncNow(s)">立即同步</button>
                </div>
              </div>
            </div>
            <div class="muted" style="font-size:12px; margin-top:12px; line-height:1.7">
              <ic name="info" size="12"></ic> 同步源连接参数（服务器地址、凭据、同步范围）请到【系统管理】-【系统参数配置】中设置，配置后此处显示连接状态与最后同步时间。
            </div>
          </div>
        </div>
      </div>
    </div>
    <div v-else class="empty" style="padding-top:120px">加载中…</div>
    `,
  },
};
