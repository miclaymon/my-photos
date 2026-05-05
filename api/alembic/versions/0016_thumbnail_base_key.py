"""Add thumbnail_base_key to media table.

Stores the S3 key prefix for multi-size WebP thumbnails
(e.g. "{user_id}/{uuid}/thumb"). Individual sizes are derived
as "{base_key}/{size}.webp" for sizes 64, 96, 128, 256, 512.

Revision ID: 0016
Revises: 0015
Create Date: 2026-05-02
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("media", sa.Column("thumbnail_base_key", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("media", "thumbnail_base_key")
