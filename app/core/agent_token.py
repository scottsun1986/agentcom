"""Agent MCP 单 Secret 令牌：生成与解析。

标准单 Secret 接入模式：客户端只需配置一个不透明令牌，通过标准
`Authorization: Bearer <Agent Secret>` 头访问 MCP（/mcp、/sse）与 OpenAPI。

Secret 形如 `sk-<8位key><40位随机体>`（单串），内嵌的 8 位 key 即凭据
路由信息（app_id = `agentcom-<key>`），服务端可 O(1) 定位凭据记录，再以
Argon2 校验整串密文。App ID 仅作为管理端展示用的标识，不参与客户端配置。
"""

import secrets

SECRET_PREFIX = "sk-"
_KEY_LEN = 8
_APP_ID_PREFIX = "agentcom-"


def new_agent_key() -> str:
    """8-hex credential routing key."""
    return secrets.token_hex(4)


def agent_secret_for_key(key: str) -> str:
    """Issue a fresh single secret for an existing key (rotation included)."""
    return f"{SECRET_PREFIX}{key}{secrets.token_hex(20)}"


def generate_agent_credential() -> tuple[str, str]:
    """Return (app_id, secret) for a newly created credential."""
    key = new_agent_key()
    return f"{_APP_ID_PREFIX}{key}", agent_secret_for_key(key)


def key_for_app_id(app_id: str) -> str | None:
    """Extract the embedded key from an app_id (None for legacy-format ids)."""
    if app_id.startswith(_APP_ID_PREFIX):
        key = app_id[len(_APP_ID_PREFIX):]
        if len(key) == _KEY_LEN:
            return key
    return None


def app_id_from_secret(secret: str) -> str | None:
    """Route an opaque single secret back to its credential's app_id."""
    if not secret or not secret.startswith(SECRET_PREFIX):
        return None
    key = secret[len(SECRET_PREFIX):len(SECRET_PREFIX) + _KEY_LEN]
    if len(key) != _KEY_LEN:
        return None
    return f"{_APP_ID_PREFIX}{key}"


def bearer_secret(authorization: str | None) -> str | None:
    """Extract the raw token from an Authorization header value, if Bearer."""
    if not authorization or not authorization.lower().startswith("bearer "):
        return None
    return authorization[7:].strip() or None
