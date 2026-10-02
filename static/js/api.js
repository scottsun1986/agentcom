/* API client with token handling and unified error toast */
(function () {
  const TOKEN_KEY = "agentcom_token";
  const USER_KEY = "agentcom_user";

  function token() { return localStorage.getItem(TOKEN_KEY) || ""; }
  function setToken(t) { t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY); }
  function cachedUser() {
    try { return JSON.parse(localStorage.getItem(USER_KEY) || "null"); } catch { return null; }
  }
  function setUser(u) { u ? localStorage.setItem(USER_KEY, JSON.stringify(u)) : localStorage.removeItem(USER_KEY); }

  async function request(method, path, params, body) {
    let url = path;
    if (params && Object.keys(params).length) {
      const qs = Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== "")
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
        .join("&");
      if (qs) url += (url.includes("?") ? "&" : "?") + qs;
    }
    const headers = { "Content-Type": "application/json" };
    if (token()) headers["Authorization"] = "Bearer " + token();
    let resp;
    try {
      resp = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    } catch (e) {
      window.App?.toast?.("网络异常，请检查服务是否启动", "err");
      throw e;
    }
    let data = null;
    try { data = await resp.json(); } catch { data = { code: resp.status, msg: "响应解析失败" }; }
    if (resp.status === 401) {
      window.App?.onUnauthorized?.();
      const err = new Error(data.msg || "未登录");
      err.unauthorized = true;
      throw err;
    }
    if (data.code !== 200) {
      window.App?.toast?.(data.msg || "操作失败", "err");
      const err = new Error(data.msg || "操作失败");
      err.code = data.code;
      throw err;
    }
    return data;
  }

  async function get(path, params) { return (await request("GET", path, params)).data; }
  async function page(path, params) { return await request("GET", path, params); } // {rows,total}
  async function post(path, body) { return (await request("POST", path, null, body)).data; }
  async function postRaw(path, body) { return await request("POST", path, null, body); }
  async function put(path, body) { return (await request("PUT", path, null, body)).data; }
  async function del(path) { return (await request("DELETE", path)).data; }

  window.api = { token, setToken, cachedUser, setUser, get, page, post, postRaw, put, del };
})();
