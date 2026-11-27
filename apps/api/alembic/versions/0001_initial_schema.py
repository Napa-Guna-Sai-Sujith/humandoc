"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-11-23 00:00:00.000000

The SQLAlchemy models in app/models.py are the single source of truth. This initial
migration materialises exactly that metadata, so the two can never drift apart.
"""
from collections.abc import Sequence

from alembic import op

from app import models  # noqa: F401
from app.core.db import Base

revision: str = "0001"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    Base.metadata.drop_all(bind=bind, checkfirst=True)
