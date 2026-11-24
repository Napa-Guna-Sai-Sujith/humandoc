from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base


def uuid_pk() -> Mapped[uuid.UUID]:
    return mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()"))


class TimestampMixin:
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class User(TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (Index("ix_users_email_lower", func.lower(text("email")), unique=True),)

    id: Mapped[uuid.UUID] = uuid_pk()
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str] = mapped_column(String(16), default="user", server_default=text("'user'"), nullable=False)
    email_verified_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    failed_login_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"), nullable=False)
    locked_until: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    sessions: Mapped[list[Session]] = relationship(back_populates="user", cascade="all, delete-orphan")
    jobs: Mapped[list[Job]] = relationship(back_populates="user", cascade="all, delete-orphan")


class OAuthAccount(Base):
    __tablename__ = "oauth_accounts"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    provider: Mapped[str] = mapped_column(String(32), nullable=False)
    provider_account_id: Mapped[str] = mapped_column(String(255), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (Index("ix_oauth_provider_account", "provider", "provider_account_id", unique=True),)


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    csrf_token: Mapped[str] = mapped_column(String(128), nullable=False)
    user_agent: Mapped[str | None] = mapped_column(String(512))
    ip: Mapped[str | None] = mapped_column(String(64))
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    revoked_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="sessions")


class EmailVerificationToken(Base):
    __tablename__ = "email_verification_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class PasswordResetToken(Base):
    __tablename__ = "password_reset_tokens"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    used_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Upload(Base):
    __tablename__ = "uploads"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    key: Mapped[str] = mapped_column(String(512), nullable=False)
    filename: Mapped[str] = mapped_column(String(512), nullable=False)
    size: Mapped[int] = mapped_column(BigInteger, default=0)
    mime: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="uploading")
    s3_upload_id: Mapped[str | None] = mapped_column(String(255))
    parts: Mapped[list] = mapped_column(JSONB, default=list)
    etag: Mapped[str | None] = mapped_column(String(255))
    expires_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    completed_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))


class Job(TimestampMixin, Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_user_created", "user_id", "created_at"),)

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="queued", nullable=False, index=True)
    source_key: Mapped[str] = mapped_column(String(512), nullable=False)
    output_key: Mapped[str | None] = mapped_column(String(512))
    qa_key: Mapped[str | None] = mapped_column(String(512))
    source_filename: Mapped[str] = mapped_column(String(512), nullable=False)
    source_size: Mapped[int] = mapped_column(BigInteger, default=0)
    source_mime: Mapped[str] = mapped_column(String(128), nullable=False)
    file_kind: Mapped[str] = mapped_column(String(16), nullable=False)
    total_pages: Mapped[int] = mapped_column(Integer, default=0)
    processed_pages: Mapped[int] = mapped_column(Integer, default=0)
    total_blocks: Mapped[int] = mapped_column(Integer, default=0)
    rewritten_blocks: Mapped[int] = mapped_column(Integer, default=0)
    flagged_blocks: Mapped[int] = mapped_column(Integer, default=0)
    skipped_blocks: Mapped[int] = mapped_column(Integer, default=0)
    total_words: Mapped[int] = mapped_column(Integer, default=0)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)
    cost_usd: Mapped[float] = mapped_column(Numeric(10, 4), default=0)
    options: Mapped[dict] = mapped_column(JSONB, default=dict)
    analysis: Mapped[dict | None] = mapped_column(JSONB)
    current_section: Mapped[str | None] = mapped_column(String(255))
    error: Mapped[str | None] = mapped_column(Text)
    started_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    finished_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship(back_populates="jobs")
    pages: Mapped[list[JobPage]] = relationship(
        back_populates="job", cascade="all, delete-orphan", order_by="JobPage.page_number"
    )


class JobPage(Base):
    __tablename__ = "job_pages"
    __table_args__ = (Index("ix_job_pages_job_page", "job_id", "page_number", unique=True),)

    id: Mapped[uuid.UUID] = uuid_pk()
    job_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False)
    page_number: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="pending")
    blocks: Mapped[list] = mapped_column(JSONB, default=list)
    notes: Mapped[dict] = mapped_column(JSONB, default=dict)
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    job: Mapped[Job] = relationship(back_populates="pages")


class UsageRecord(Base):
    __tablename__ = "usage_records"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    period: Mapped[str] = mapped_column(String(7), nullable=False)  # YYYY-MM
    pages: Mapped[int] = mapped_column(Integer, default=0)
    words: Mapped[int] = mapped_column(Integer, default=0)
    tokens: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    __table_args__ = (Index("ix_usage_user_period", "user_id", "period"),)


class Subscription(Base):
    __tablename__ = "subscriptions"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    stripe_customer_id: Mapped[str | None] = mapped_column(String(255))
    stripe_subscription_id: Mapped[str | None] = mapped_column(String(255), unique=True)
    tier: Mapped[str] = mapped_column(String(24), default="free", nullable=False)
    status: Mapped[str] = mapped_column(String(24), default="active", nullable=False)
    pages_per_month: Mapped[int] = mapped_column(Integer, default=20)
    current_period_end: Mapped[dt.datetime | None] = mapped_column(DateTime(timezone=True))
    cancel_at_period_end: Mapped[bool] = mapped_column(Boolean, default=False, server_default=text("false"))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[dt.datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class Invoice(Base):
    __tablename__ = "invoices"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    stripe_invoice_id: Mapped[str] = mapped_column(String(255), unique=True)
    amount: Mapped[int] = mapped_column(BigInteger, default=0)
    currency: Mapped[str] = mapped_column(String(8), default="usd")
    status: Mapped[str] = mapped_column(String(24), default="open")
    hosted_url: Mapped[str | None] = mapped_column(String(1024))
    pdf_url: Mapped[str | None] = mapped_column(String(1024))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[uuid.UUID] = uuid_pk()
    user_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    action: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    meta: Mapped[dict] = mapped_column(JSONB, default=dict, server_default=text("'{}'::jsonb"))
    ip: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)
