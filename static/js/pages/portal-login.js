/* /login 账号登录 — pixel replica of design/mockups/082-login-v2.png */
AppPages['/login'] = {
  route: '/login', title: '账号登录', category: 'LOGIN',
  component: {
    data() {
      return {
        username: 'zhangming',
        password: 'admin123',
        captcha: '',
        captchaCode: '',
        captchaColors: ['#1D6FE0', '#1D6FE0', '#13A89E', '#D33A41'],
        remember: true,
        tab: 'account',
        pwdType: 'password',
        loading: false,
        err: '',
      };
    },
    created() { this.refreshCaptcha(); },
    methods: {
      refreshCaptcha() {
        const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
        let code = '';
        for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
        this.captchaCode = code;
        this.captchaColors = code.split('').map(() => ['#1D6FE0', '#0E7C74', '#D33A41', '#7A4FD1'][Math.floor(Math.random() * 4)]);
      },
      async doLogin() {
        if (this.loading) return;
        this.err = '';
        if (!this.username || !this.password) { this.err = '请输入账号与密码'; return; }
        if (this.captcha.toLowerCase() !== this.captchaCode.toLowerCase()) {
          this.err = '验证码不正确';
          this.refreshCaptcha(); this.captcha = '';
          return;
        }
        this.loading = true;
        try {
          const raw = await api.postRaw('/api/auth/login', { username: this.username, password: this.password });
          api.setToken(raw.data.token);
          const info = await api.get('/api/auth/info');
          api.setUser(info.user);
          location.hash = '#/portal/overview';
          setTimeout(() => location.reload(), 30);
        } catch (e) {
          this.err = e.message || '登录失败';
          this.refreshCaptcha(); this.captcha = '';
        }
        this.loading = false;
      },
    },
    template: `
    <div class="login-wrap">
      <div class="login-card">
        <div class="login-left">
          <div class="ll-brand">
            <div class="ll-logo">AgentCom</div>
            <div class="ll-sub">企业与政务协同办公管理平台</div>
            <div class="ll-line"></div>
          </div>
          <div class="ll-points">
            <div>统一身份 · 安全可信 · 高效协同</div>
            <div>连接业务　服务组织　支撑决策</div>
          </div>
          <div class="ll-globe">
            <svg viewBox="0 0 400 240" width="100%" height="100%" preserveAspectRatio="xMidYMid slice">
              <circle cx="200" cy="260" r="150" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="1.4"/>
              <circle cx="200" cy="260" r="118" fill="none" stroke="rgba(255,255,255,.2)" stroke-width="1"/>
              <circle cx="200" cy="260" r="86" fill="none" stroke="rgba(255,255,255,.16)" stroke-width="1"/>
              <line x1="40" y1="200" x2="360" y2="120" stroke="rgba(255,255,255,.18)"/>
              <line x1="90" y1="140" x2="330" y2="220" stroke="rgba(255,255,255,.14)"/>
              <line x1="60" y1="120" x2="300" y2="40" stroke="rgba(255,255,255,.12)"/>
              <circle cx="200" cy="130" r="5" fill="#7FB1FF"/>
              <circle cx="120" cy="170" r="4" fill="#5E97E8"/>
              <circle cx="300" cy="180" r="4" fill="#7FB1FF"/>
              <circle cx="255" cy="95" r="3" fill="#9CC4FF"/>
              <circle cx="95" cy="105" r="3" fill="#9CC4FF"/>
              <circle cx="330" cy="90" r="3" fill="#5E97E8"/>
            </svg>
          </div>
          <div class="ll-foot">政企协同 · 数智办公 · 共建高效组织</div>
        </div>
        <div class="login-right">
          <h1 class="lr-title">欢迎登录</h1>
          <div class="lr-org">政务服务中心</div>
          <div class="lr-plat">AgentCom 企业与政务协同办公管理平台</div>
          <div class="lr-tabs">
            <span class="lr-tab" :class="{on: tab==='account'}" @click="tab='account'">账号密码登录</span>
            <span class="lr-sep"></span>
            <span class="lr-tab" :class="{on: tab==='sso'}" @click="tab='sso'">统一身份登录</span>
          </div>
          <template v-if="tab==='account'">
            <div class="lr-field">
              <ic name="user" size="18"></ic>
              <input v-model="username" placeholder="请输入账号" @keyup.enter="doLogin">
              <ic v-if="username" name="x-circle" size="16" class="lr-clear" @click="username=''"></ic>
            </div>
            <div class="lr-field">
              <ic name="lock" size="18"></ic>
              <input v-model="password" :type="pwdType" placeholder="请输入密码" @keyup.enter="doLogin">
              <ic :name="pwdType==='password' ? 'eye-off' : 'eye'" size="16" class="lr-clear" @click="pwdType = pwdType==='password' ? 'text' : 'password'"></ic>
            </div>
            <div class="lr-captcha-row">
              <div class="lr-field" style="flex:1">
                <ic name="shield-check" size="18"></ic>
                <input v-model="captcha" placeholder="请输入验证码" maxlength="4" @keyup.enter="doLogin">
              </div>
              <div class="lr-captcha" @click="refreshCaptcha">
                <span v-for="(ch, i) in captchaCode.split('')" :key="i" :style="{color: captchaColors[i]}">{{ ch }}</span>
              </div>
              <a class="lr-refresh" @click="refreshCaptcha"><ic name="refresh-cw" size="14"></ic> 换一张</a>
            </div>
            <div class="lr-mid">
              <label class="lr-remember"><input type="checkbox" v-model="remember"> 下次自动登录</label>
              <a class="lr-forgot">忘记密码?</a>
            </div>
            <div class="lr-err" v-if="err"><ic name="alert-circle" size="14"></ic> {{ err }}</div>
            <button class="lr-btn" :disabled="loading" @click="doLogin">{{ loading ? '登录中…' : '登 录' }}</button>
          </template>
          <template v-else>
            <div class="lr-sso">
              <ic name="fingerprint" size="42"></ic>
              <p>请使用浙政钉 / 政务统一身份认证平台扫码登录</p>
              <div class="lr-qrcode"><ic name="qr-code" size="72"></ic></div>
              <a class="lr-back" @click="tab='account'">返回账号密码登录</a>
            </div>
          </template>
        </div>
      </div>
    </div>
    
    `,
  },
};
