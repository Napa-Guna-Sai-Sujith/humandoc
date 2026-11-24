"""Password hashing, tokens, lockout logic, field encryption and rate limiting."""
from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import secrets
from typing import Any

import bcrypt
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.core.config import settings


# ---------------------------------------------------------------- passwords
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=settings.bcrypt_cost)).decode()


def verify_password(password: str, hashed: str | None) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))
    except ValueError:
        return False


# ---------------------------------------------------------------- tokens
def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def constant_time_eq(a: str, b: str) -> bool:
    return hmac.compare_digest(a.encode(), b.encode())


# ---------------------------------------------------------------- lockout
def is_locked(locked_until: dt.datetime | None, now: dt.datetime | None = None) -> bool:
    if not locked_until:
        return False
    now = now or dt.datetime.now(dt.UTC)
    if locked_until.tzinfo is None:
        locked_until = locked_until.replace(tzinfo=dt.UTC)
    return locked_until > now


def register_failure(count: int) -> int:
    return count + 1


def lockout_deadline(now: dt.datetime | None = None) -> dt.datetime:
    now = now or dt.datetime.now(dt.UTC)
    return now + dt.timedelta(minutes=settings.login_lockout_min)


def should_lock(count: int) -> bool:
    return count >= settings.login_max_failures


# ---------------------------------------------------------------- encryption at rest
def _key() -> bytes:
    raw = settings.field_encryption_key or settings.session_secret
    return hashlib.sha256(raw.encode()).digest()


def encrypt_field(plaintext: str) -> str:
    """AES-256-GCM, output is urlsafe base64(nonce|ciphertext)."""
    nonce = secrets.token_bytes(12)
    ct = AESGCM(_key()).encrypt(nonce, plaintext.encode("utf-8"), None)
    return base64.urlsafe_b64encode(nonce + ct).decode()


def decrypt_field(token: str) -> str:
    raw = base64.urlsafe_b64decode(token.encode())
    return AESGCM(_key()).decrypt(raw[:12], raw[12:], None).decode("utf-8")


# ---------------------------------------------------------------- audit
def audit_meta(**kwargs: Any) -> dict:
    return {k: (str(v)[:500] if v is not None else None) for k, v in kwargs.items()}


# ---------------------------------------------------------------- virus scanning
def clamav_scan(data: bytes) -> tuple[bool, str]:
    """Stream the file to ClamAV via INSTREAM. Returns (clean, signature)."""
    import socket
    import struct

    if not settings.clamav_host:
        return True, "scan-not-configured"
    with socket.create_connection((settings.clamav_host, settings.clamav_port), timeout=30) as sock:
        sock.sendall(b"zINSTREAM\x00")
        chunk_size = 64 * 1024
        for i in range(0, len(data), chunk_size):
            chunk = data[i : i + chunk_size]
            sock.sendall(struct.pack("!L", len(chunk)) + chunk)
        sock.sendall(struct.pack("!L", 0))
        response = sock.recv(4096).decode(errors="replace").strip()
    clean = response.endswith("OK")
    return clean, response
