"""Add places table for UUID-based place records with rename support

Revision ID: 0014
Revises: 0013
Create Date: 2026-04-25

Changes:
  - places table: id, library_id, location_label (original geocoded), display_name (user override)
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0014"
down_revision: Union[str, None] = "0013"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "places",
        sa.Column("id",             sa.String(36),                             nullable=False),
        sa.Column("library_id",     sa.String(36),                             nullable=False),
        sa.Column("location_label", sa.Text,                                   nullable=False),
        sa.Column("display_name",   sa.Text,                                   nullable=True),
        sa.Column("created_at",     sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.ForeignKeyConstraint(["library_id"], ["libraries.id"], ondelete="CASCADE"),
        sa.UniqueConstraint("library_id", "location_label", name="uq_places_library_label"),
    )
    op.create_index("ix_places_library_id", "places", ["library_id"])


def downgrade() -> None:
    op.drop_index("ix_places_library_id", table_name="places")
    op.drop_table("places")
