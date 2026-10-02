/* Application shell: login gate, top category nav, sidebar, watermark, assistant */
(function () {
  const { createApp, defineComponent } = Vue;

  const AppRoot = defineComponent({
    components: Object.assign({}, window.AppComponents),
    data() {
      return {
        booted: false,
        user: api.cachedUser(),
        roles: [],
        allowedPaths: null, // null = allow all (admin)
        route: ((location.hash || "#/portal/overview").slice(1)).split("?")[0],
        currentCategory: "PORTAL",
        notifications: [],
        todos: [],
        watermarkOn: true,
        aiOpen: false,
        aiMsgs: [{ role: "bot", text: "您好，我是 AgentCom 智能助手，可以帮您查询督办预警、安排会议、提交用车申请等。请描述您的需求。" }],
        aiInput: "",
        aiBusy: false,
        toasts: [],
        _toastSeq: 0,
      };
    },
    computed: {
      categories() { return (window.AppCatalog && window.AppCatalog.categories) || []; },
      visibleCategories() {
        if (!this.categories.length) return [];
        if (this.allowedPaths === null) return this.categories;
        return this.categories
          .map((c) => Object.assign({}, c, { pages: c.pages.filter((p) => this.allowedPaths.has(p.route)) }))
          .filter((c) => c.pages.length);
      },
      sidebarPages() {
        const c = this.visibleCategories.find((x) => x.key === this.currentCategory);
        return c ? c.pages : [];
      },
      currentDef() {
        const r = (!this.user || this.route === "/login") ? "/login" : this.route;
        return (window.AppPages && window.AppPages[r]) || null;
      },
      currentComponent() {
        if (!this.currentDef) return null;
        const comp = Object.assign({}, this.currentDef.component);
        comp.components = Object.assign({}, this.components, comp.components || {});
        return comp;
      },
      components() { return window.AppComponents; },
      breadcrumb() {
        const def = this.currentDef;
        if (!def) return [];
        const cat = this.categories.find((c) => c.pages.some((p) => p.route === this.route));
        return cat ? [cat.name, def.title] : [def.title];
      },
      unreadCount() {
        const n = this.notifications.filter((x) => !x.is_read).length;
        return n || (this.todos.length ? String(this.todos.length).length && this.todos.length && 0 : 0);
      },
      todayText() {
        const d = new Date();
        const wd = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][d.getDay()];
        return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日  ${wd}`;
      },
      watermarkText() {
        if (!this.user) return "";
        const no = String(this.user.user_name || "").replace(/\D/g, "").slice(-5) || "0000";
        return `${this.user.nick_name || ""} ${no}`;
      },
    },
    watch: {
      route(v) {
        const def = window.AppPages && window.AppPages[v];
        if (def) this.currentCategory = def.category;
      },
    },
    methods: {
      go(path) {
        location.hash = "#" + path;
      },
      onHashChange() {
        this.route = ((location.hash || "#/portal/overview").slice(1)).split("?")[0];
        if (!window.AppPages || !window.AppPages[this.route]) {
          const cat = this.visibleCategories.find((c) => c.key === this.currentCategory) || this.visibleCategories[0];
          if (cat && cat.pages.length) {
            this.route = cat.pages[0].route;
            return;
          }
        }
        this.refreshBadges();
      },
      selectCategory(key) {
        this.currentCategory = key;
        const c = this.visibleCategories.find((x) => x.key === key);
        if (c && c.pages.length && !c.pages.some((p) => p.route === this.route)) {
          this.go(c.pages[0].route);
        }
      },
      primaryAction() {
        const c = this.$refs.pageComp;
        if (c && typeof c.onPrimary === "function") c.onPrimary();
        else this.toast("请在页面内使用对应操作按钮", "warn");
      },
      iconFor(route) {
        const def = window.AppPages && window.AppPages[route];
        if (def && def.icon) return def.icon;
        const cat = this.categories.find((c) => c.pages.some((p) => p.route === route));
        return (cat && cat.icon) || "dot";
      },
      toast(msg, kind) {
        const id = ++this._toastSeq;
        this.toasts.push({ id, msg, kind: kind || "ok" });
        setTimeout(() => { this.toasts = this.toasts.filter((t) => t.id !== id); }, 2600);
      },
      onUnauthorized() {
        api.setToken(null);
        api.setUser(null);
        this.user = null;
        this.go("/login");
      },
      async logout() {
        try { await api.post("/api/auth/logout"); } catch (e) { /* ignore */ }
        this.onUnauthorized();
      },
      toggleWatermark() { this.watermarkOn = !this.watermarkOn; },
      async refreshBadges() {
        if (!api.token() || !this.user) return;
        try {
          const n = await api.get("/api/portal/notifications", { only_unread: true });
          this.notifications = n.items || [];
        } catch (e) { this.notifications = []; }
        try {
          const t = await api.get("/api/portal/todos");
          this.todos = (t.all || []).slice(0, 99);
        } catch (e) { this.todos = []; }
      },
      async sendAssistant() {
        const text = (this.aiInput || "").trim();
        if (!text || this.aiBusy) return;
        this.aiMsgs.push({ role: "user", text });
        this.aiInput = "";
        this.aiBusy = true;
        try {
          const res = await api.post("/api/portal/assistant", { message: text });
          this.aiMsgs.push({ role: "bot", text: res.reply, actions: res.actions || [] });
        } catch (e) {
          this.aiMsgs.push({ role: "bot", text: "抱歉，处理指令时出现问题，请稍后再试。" });
        }
        this.aiBusy = false;
        this.$nextTick(() => {
          const box = this.$refs.aiMsgs;
          if (box) box.scrollTop = box.scrollHeight;
        });
      },
      async boot() {
        if (!api.token()) {
          this.booted = true;
          if (this.route !== "/login") this.go("/login");
          return;
        }
        try {
          const info = await api.get("/api/auth/info");
          this.user = info.user;
          api.setUser(info.user);
          this.roles = info.roles || [];
          const routers = await api.get("/api/auth/routers");
          const paths = (routers.menus || []).filter((m) => m.menu_type === "C" && m.path).map((m) => m.path);
          this.allowedPaths = this.roles.includes("admin") ? null : new Set(paths.length ? paths : []);
          if (!this.roles.includes("admin") && paths.length === 0) this.allowedPaths = new Set();
        } catch (e) {
          api.setToken(null); this.user = null;
          if (this.route !== "/login") this.go("/login");
        }
        this.booted = true;
        if (this.user) this.refreshBadges();
      },
    },
    mounted() {
      window.addEventListener("hashchange", this.onHashChange);
      this.onHashChange();
      this.boot();
      window.App = this;
    },
    });

  const tpl = `
  <div>
    <div v-if="!booted" class="empty" style="padding-top:40vh">加载中…</div>

    <!-- LOGIN -->
    <div v-else-if="route === '/login' || !user" style="min-height:100vh">
      <component :is="currentComponent" :key="route"></component>
    </div>

    <!-- MAIN SHELL -->
    <div v-else-if="user">
      <header class="topbar">
        <div class="logo">
          <div class="mark">A</div>
          <div class="name">AgentCom</div>
        </div>
        <nav class="topnav">
          <div v-for="c in visibleCategories" :key="c.key" class="cat" :class="{active: c.key === currentCategory}" @click="selectCategory(c.key)">{{ c.name }}</div>
        </nav>
        <div class="tools">
          <span class="tbtn" title="全局搜索"><ic name="search" size="18"></ic></span>
          <span class="tbtn" title="待办与通知" @click="go('/portal/notifications')">
            <ic name="bell" size="18"></ic>
            <span class="badge" v-if="todos.length || notifications.filter(n=>!n.is_read).length">{{ todos.length + notifications.filter(n=>!n.is_read).length > 99 ? '99+' : todos.length + notifications.filter(n=>!n.is_read).length }}</span>
          </span>
          <span class="uinfo" @click="logout()" title="点击退出登录">
            <span class="avatar">{{ (user.nick_name || '?').slice(0,1) }}</span>
            <span>{{ user.nick_name }}</span>
            <ic name="chevron-down" size="14"></ic>
          </span>
        </div>
      </header>

      <aside class="sidebar">
        <div v-for="p in sidebarPages" :key="p.route" class="side-item" :class="{active: p.route === route}" @click="go(p.route)">
          <ic :name="iconFor(p.route)" size="18"></ic><span>{{ p.title }}</span>
        </div>
      </aside>

      <main class="main">
        <div class="page-body" v-if="currentComponent">
          <div class="page-head">
            <div>
              <div class="crumb"><template v-for="(b, i) in breadcrumb" :key="i">{{ b }}<span v-if="i < breadcrumb.length-1" style="margin:0 6px">/</span></template></div>
              <div class="page-title-row">
                <span class="page-title">{{ currentDef.title }}</span>
                <span class="page-date">{{ todayText }}</span>
              </div>
              <div class="page-sub" v-if="currentDef.subtitle" v-html="currentDef.subtitle"></div>
            </div>
            <button class="btn btn-primary" v-if="currentDef.primaryAction" @click="primaryAction">
              <ic name="plus" size="14"></ic>{{ currentDef.primaryAction }}
            </button>
          </div>
          <component :is="currentComponent" :key="route" ref="pageComp"></component>
        </div>
        <div class="page-body" v-else><div class="empty">页面未注册：{{ route }}</div></div>
      </main>

      <!-- AI launcher -->
      <div class="ai-launcher" @click="aiOpen = !aiOpen">
        <div class="ball"><ic name="bot" size="26"></ic><span class="reddot"></span></div>
        <span>智能助手</span>
      </div>
      <div class="ai-panel" v-if="aiOpen">
        <div class="hd"><ic name="bot" size="18"></ic> AgentCom 智能助手 <ic name="x" size="16" style="margin-left:auto;cursor:pointer" @click="aiOpen=false"></ic></div>
        <div class="msgs" ref="aiMsgs">
          <div v-for="(m, i) in aiMsgs" :key="i" class="msg" :class="m.role">{{ m.text }}
            <div v-if="m.actions && m.actions.length" style="margin-top:6px">
              <span v-for="(a, j) in m.actions" :key="j" class="tag tag-blue" style="margin-right:4px">{{ a.tool }}</span>
            </div>
          </div>
          <div v-if="aiBusy" class="msg bot muted">正在处理…</div>
        </div>
        <div class="input-row">
          <input class="input" v-model="aiInput" placeholder="输入指令，如：查看督办预警" @keyup.enter="sendAssistant">
          <button class="btn btn-primary btn-sm" @click="sendAssistant">发送</button>
        </div>
      </div>

      <!-- watermark -->
      <div class="watermark-layer" v-if="watermarkOn">
        <span v-for="n in 36" :key="n" :style="{ left: ((n % 6) * 17 + 4) + '%', top: (Math.floor((n-1) / 6) * 15 + 4) + '%' }">{{ watermarkText }}</span>
      </div>
    </div>

    <!-- not logged in but deep link -->
    <div v-else class="empty" style="padding-top:40vh">
      <button class="btn btn-primary" @click="go('/login')">前往登录</button>
    </div>

    <div class="toast-wrap">
      <div v-for="t in toasts" :key="t.id" class="toast" :class="t.kind">
        <ic :name="t.kind === 'err' ? 'x-circle' : t.kind === 'warn' ? 'alert-triangle' : 'check-circle-2'" size="16"></ic>{{ t.msg }}
      </div>
    </div>
  </div>
  `;

  AppRoot.template = tpl;

  window.mountApp = function mountApp() {
    const app = createApp(AppRoot);
    app.config.compilerOptions.whitespace = "condense";
    window.vm = app.mount("#app");
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", window.mountApp);
  } else {
    window.mountApp();
  }
})();
