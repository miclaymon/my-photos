"""Add batch_id and job_id to background_jobs

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-25

Changes:
  - background_jobs.batch_id  VARCHAR(36)  — groups all jobs from one enqueue action
  - background_jobs.job_id    VARCHAR(64)  — SHA-256 of "{media_id}:{job_type}", unique per live job
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

revision: str = "0012"
down_revision: Union[str, None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column(
        "background_jobs",
        sa.Column("batch_id", sa.String(36), nullable=True),
    )
    op.add_column(
        "background_jobs",
        sa.Column("job_id", sa.String(64), nullable=True),
    )
    # UNIQUE allows multiple NULLs in PostgreSQL (old rows stay harmless)
    op.create_index(
        "uq_background_jobs_job_id",
        "background_jobs",
        ["job_id"],
        unique=True,
    )
    op.create_index(
        "ix_background_jobs_batch_id",
        "background_jobs",
        ["batch_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_background_jobs_batch_id", table_name="background_jobs")
    op.drop_index("uq_background_jobs_job_id", table_name="background_jobs")
    op.drop_column("background_jobs", "job_id")
    op.drop_column("background_jobs", "batch_id")
