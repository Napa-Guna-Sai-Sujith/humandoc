"""Central configuration. Every value is read from the environment."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=(".env", "../../.env", "../.env"), extra="ignore", case_sensitive=False)

    app_name: str = "HumanDoc"
    app_url: str = "http://localhost:3000"
    api_public_url: str = "http://localhost:8000"
    cors_origins: str = "http://localhost:3000"
    environment: str = "development"

    database_url: str = (
        "postgresql+asyncpg://neondb_owner:npg_UKpB9MQn4zxO@ep-wandering-resonance-bdxwm7vi-pooler.c-8.us-east-2.aws.neon.tech/neondb?ssl=require"
    )

    @field_validator("database_url", mode="before")
    @classmethod
    def _normalize_database_url(cls, v: str) -> str:
        if not v:
            return v
        if v.startswith("postgresql://"):
            v = "postgresql+asyncpg://" + v[len("postgresql://"):]
        from urllib.parse import parse_qs, urlencode, urlparse, urlunparse
        parsed = urlparse(v)
        qs = parse_qs(parsed.query)
        if "sslmode" in qs:
            ssl_val = qs.pop("sslmode")[0]
            if "ssl" not in qs:
                qs["ssl"] = [ssl_val]
        qs.pop("channel_binding", None)
        new_query = urlencode(qs, doseq=True)
        return urlunparse(parsed._replace(query=new_query))
    redis_url: str = "redis://localhost:6379/0"

    s3_endpoint_url: str = "http://localhost:9000"
    s3_public_url: str = "/backend"
    s3_region: str = "us-east-1"
    s3_access_key_id: str = "minioadmin"
    s3_secret_access_key: str = "minioadmin"
    s3_bucket: str = "humandoc"
    s3_presign_expires: int = 900
    s3_force_path_style: bool = True
    retention_days: int = 7

    session_secret: str = "dev-secret"
    session_ttl_hours: int = 720
    bcrypt_cost: int = 12
    verify_token_ttl_min: int = 60
    reset_token_ttl_min: int = 30
    login_max_failures: int = 5
    login_lockout_min: int = 15

    anthropic_api_key: str = ""
    anthropic_model: str = "claude-sonnet-4-5"
    anthropic_max_tokens_out: int = 1200
    anthropic_max_retries: int = 2
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    openai_api_key: str = ""
    openai_base_url: str = ""
    openai_model: str = "gpt-4o-mini"
    llm_provider: str = "auto"
    llm_max_concurrency: int = 4
    price_per_1m_tokens: float = 3.0

    batch_size: int = 10
    worker_concurrency: int = 2
    job_max_pages: int = 2000
    max_upload_mb: int = 500
    upload_part_mb: int = 20
    celery_broker_url: str = "redis://localhost:6379/1"
    celery_result_backend: str = "redis://redis:6379/2"

    @model_validator(mode="after")
    def _sync_celery_urls(self) -> "Settings":
        if self.redis_url and "localhost" not in self.redis_url:
            if "localhost" in self.celery_broker_url:
                self.celery_broker_url = self.redis_url
            if "localhost" in self.celery_result_backend or "redis:6379" in self.celery_result_backend:
                self.celery_result_backend = self.redis_url

        def _ensure_ssl(u: str) -> str:
            if u.startswith("rediss://") and "ssl_cert_reqs" not in u:
                sep = "&" if "?" in u else "?"
                return f"{u}{sep}ssl_cert_reqs=CERT_NONE"
            return u

        self.celery_broker_url = _ensure_ssl(self.celery_broker_url)
        self.celery_result_backend = _ensure_ssl(self.celery_result_backend)
        return self

    field_encryption_key: str = ""
    virus_scan_enabled: bool = False
    clamav_host: str = ""
    clamav_port: int = 3310
    rate_limit_per_minute: int = 60

    tier_free_pages: int = 20
    tier_starter_pages: int = 100
    tier_pro_pages: int = 500
    tier_studio_pages: int = 2000

    tmp_dir: Path = Path("/tmp/humandoc")

    @property
    def cors_origins_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def tiers(self) -> dict[str, dict]:
        return {
            "free": {"name": "Free", "pages": self.tier_free_pages, "price": 0},
            "starter": {"name": "Starter", "pages": self.tier_starter_pages, "price": 12},
            "pro": {"name": "Pro", "pages": self.tier_pro_pages, "price": 29},
            "studio": {"name": "Studio", "pages": self.tier_studio_pages, "price": 79},
        }


@lru_cache
def get_settings() -> Settings:
    s = Settings()
    s.tmp_dir.mkdir(parents=True, exist_ok=True)
    return s


settings = get_settings()
