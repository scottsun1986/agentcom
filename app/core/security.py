"""Password hashing (Argon2id) and JWT token utilities."""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError

from app.config import get_settings

_settings = get_settings()
_hasher = PasswordHasher()


def hash_password(plain: str) -> str:
    """Hash a password with Argon2id."""
    return _hasher.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    """Verify a plaintext password against an Argon2id hash."""
    try:
        return _hasher.verify(hashed, plain)
    except (VerifyMismatchError, ValueError):
        return False


def create_access_token(
    subject: str,
    extra: dict[str, Any] | None = None,
    expires_minutes: int | None = None,
) -> tuple[str, int]:
    """Create a signed JWT. Returns (token, expires_in_seconds)."""
    expires_in = (expires_minutes or _settings.access_token_expire_minutes) * 60
    now = datetime.now(timezone.utc)
    payload: dict[str, Any] = {
        "sub": subject,
        "iat": now,
        "exp": now + timedelta(seconds=expires_in),
        "jti": uuid.uuid4().hex,
        "typ": "user",
    }
    if extra:
        payload.update(extra)
    token = jwt.encode(payload, _settings.secret_key, algorithm="HS256")
    return token, expires_in


def decode_token(token: str) -> dict[str, Any]:
    """Decode and validate a JWT; raises jwt.PyJWTError on failure."""
    return jwt.decode(token, _settings.secret_key, algorithms=["HS256"])
