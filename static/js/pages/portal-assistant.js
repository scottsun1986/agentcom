/* /portal/assistant 智能助手 — chat UI adapted from design/mockups/005-portal-assistant.png
   Layout: (chat messages + quick commands + input | capability cards + tips) */
(function () {
  function nowTime() {
    const d = new Date();
    const pad = (x) => String(x).padStart(2, '0');
    return pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  AppPages['/portal/assistant'] = {
  route: '/portal/assistant', title: '智能助手', category: 'PORTAL', primaryAction: null,
  subtitle: '通过自然语言发起跨模块协同，自动理解需求、拆解任务、调用系统能力，提升办公效率。',
  icon: 'bot',
  component: {
    data() {
      return {
        msgs: [{
          role: 'bot',
          text: '您好，我是 AgentCom 智能助手，可以帮您查询督办预警、安排会议、查询在院访客、提交用车申请等。\n请描述您的需求，或点击下方快捷指令。',
          time: nowTime(),
          actions: [],
        }],
        input: '',
        busy: false,
        quickCmds: ['查看督办预警', '今日会议', '在院访客', '用车申请'],
        caps: [
          { icon: 'siren', cls: 'ico-red', title: '督办预警', desc: '巡检红黄码任务并智能催办', cmd: '查看督办预警' },
          { icon: 'calendar-days', cls: 'ico-blue', title: '会议安排', desc: '查询今日议程与会议室预订', cmd: '今日会议' },
          { icon: 'users', cls: 'ico-teal', title: '访客查询', desc: '在院访客统计与预约审核', cmd: '在院访客' },
          { icon: 'car', cls: 'ico-amber', title: '用车申请', desc: '自然语言代提交用车申请', cmd: '用车申请' },
          { icon: 'file-text', cls: 'ico-blue', title: '假期余额', desc: '查询年假调休剩余额度', cmd: '请假余额' },
          { icon: 'book-open', cls: 'ico-teal', title: '知识检索', desc: '检索政策制度与知识文档', cmd: '知识检索' },
        ],
        tips: [
          '支持自然语言描述，无需固定指令格式',
          '可跨模块拆解任务并生成执行计划',
          '输入"帮助"可查看全部支持的能力',
        ],
      };
    },
    methods: {
      scrollBottom() {
        this.$nextTick(() => {
          const box = this.$refs.msgs;
          if (box) box.scrollTop = box.scrollHeight;
        });
      },
      async send(text) {
        const msg = (text !== undefined ? text : this.input || '').trim();
        if (!msg || this.busy) return;
        this.msgs.push({ role: 'user', text: msg, time: nowTime(), actions: [] });
        this.input = '';
        this.busy = true;
        this.scrollBottom();
        try {
          const res = await api.post('/api/portal/assistant', { message: msg });
          this.msgs.push({ role: 'bot', text: res.reply || '（无返回内容）', time: nowTime(), actions: res.actions || [] });
        } catch (e) {
          this.msgs.push({ role: 'bot', text: '抱歉，处理指令时出现问题，请稍后再试。', time: nowTime(), actions: [] });
        }
        this.busy = false;
        this.scrollBottom();
      },
    },
    template: `
    <div style="display:grid; grid-template-columns:minmax(0,1fr) 340px; gap:16px; align-items:start">
      <!-- chat card -->
      <div class="card chat-card" style="margin-top:0">
        <div class="card-hd" style="padding:14px 18px 10px">
          <div class="t">
            <span class="ico-box ico-blue" style="display:inline-flex;width:30px;height:30px;border-radius:8px;align-items:center;justify-content:center"><ic name="bot" size="18"></ic></span>
            AgentCom 智能助手
            <span class="tag tag-green"><span style="width:6px;height:6px;border-radius:50%;background:var(--green);display:inline-block"></span>在线</span>
          </div>
          <span class="muted" style="font-size:12px; display:inline-flex; align-items:center; gap:4px"><ic name="sparkles" size="14"></ic>智能协同引擎</span>
        </div>
        <div class="chat-msgs" ref="msgs">
          <div v-for="(m, i) in msgs" :key="i" class="chat-row" :class="m.role">
            <div class="chat-ava" :class="m.role === 'user' ? 'ico-teal' : 'ico-blue'">
              <ic :name="m.role === 'user' ? 'user' : 'bot'" size="18"></ic>
            </div>
            <div class="chat-bubble">{{ m.text }}
              <div v-if="m.actions && m.actions.length" class="chat-acts">
                <div v-for="(a, j) in m.actions" :key="j" class="chat-act">
                  <ic name="check-circle-2" size="14" style="color:var(--teal)"></ic>
                  <span>{{ a.summary || a.tool }}</span>
                  <span class="tag tag-gray" style="margin-left:auto">{{ a.tool }}</span>
                </div>
              </div>
            </div>
            <span class="chat-time">{{ m.time }}</span>
          </div>
          <div v-if="busy" class="chat-row bot">
            <div class="chat-ava ico-blue"><ic name="bot" size="18"></ic></div>
            <div class="chat-bubble muted">正在处理您的需求…</div>
          </div>
        </div>
        <div class="quick-cmds">
          <span class="muted" style="font-size:12px; align-self:center">快捷指令</span>
          <span v-for="q in quickCmds" :key="q" class="quick-cmd" @click="send(q)">
            <ic name="send" size="12"></ic>{{ q }}
          </span>
        </div>
        <div style="display:flex; gap:10px; padding:12px 14px 14px">
          <input class="input" v-model="input" style="flex:1" placeholder="请输入您的需求，例如：安排会议、查询督办预警、提交用车申请…" @keyup.enter="send()">
          <button class="btn btn-primary" :disabled="busy || !input.trim()" @click="send()"><ic name="send" size="14"></ic> 发送</button>
        </div>
      </div>

      <!-- right: capability cards + tips -->
      <div>
        <div class="card" style="margin-top:0">
          <div class="card-hd"><div class="t"><ic name="layout-grid" size="16" style="color:var(--primary)"></ic>能力卡片</div></div>
          <div class="card-bd">
            <div class="cap-grid">
              <div v-for="c in caps" :key="c.title" class="cap-card" @click="send(c.cmd)">
                <span class="ico-box" :class="c.cls" style="display:inline-flex;width:32px;height:32px;border-radius:8px;align-items:center;justify-content:center">
                  <ic :name="c.icon" size="17"></ic>
                </span>
                <div class="tt">{{ c.title }}</div>
                <div class="dd">{{ c.desc }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="card mt16">
          <div class="card-hd"><div class="t"><ic name="circle-help" size="16" style="color:var(--teal)"></ic>使用贴士</div></div>
          <div class="card-bd" style="padding-top:8px">
            <div class="tl">
              <div class="tl-item teal" v-for="(t, i) in tips" :key="i" style="padding-bottom:10px">
                <span class="muted" style="font-size:12.5px">{{ t }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    `,
  },
  };
})();
