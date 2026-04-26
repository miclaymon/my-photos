"""Add face_crop_key to subject_detections

Revision ID: 0013
Revises: 0012
Create Date: 2026-04-25

Changes:
  - subject_detections.face_crop_key  VARCHAR(500)  — S3 object key for the cropped face WebP
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0013"
down_revision: Union[str, None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "subject_detections",
        sa.Column("face_crop_key", sa.String(500), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("subject_detections", "face_crop_key")
