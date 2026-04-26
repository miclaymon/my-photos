"""Face grouping — avg_descriptor on subjects, status on detections, detection_feedback table

Revision ID: 0011
Revises: 0010
Create Date: 2026-04-18

Changes:
  - subjects.avg_descriptor  JSONB  — running average of face embeddings for the group
  - subject_detections.status  VARCHAR(20)  — 'auto'|'confirmed'|'rejected'|'review_pending'
  - detection_feedback table  — user feedback records on individual face/pet detections
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision: str = "0011"
down_revision: Union[str, None] = "0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # ── subjects: add avg_descriptor ──────────────────────────────────────────
    op.add_column(
        "subjects",
        sa.Column("avg_descriptor", JSONB, nullable=True),
    )

    # ── subject_detections: add status ────────────────────────────────────────
    op.add_column(
        "subject_detections",
        sa.Column(
            "status",
            sa.String(20),
            nullable=False,
            server_default="auto",
        ),
    )
    op.create_index(
        "ix_subject_detections_status",
        "subject_detections",
        ["status"],
    )

    # ── detection_feedback ────────────────────────────────────────────────────
    # Valid feedback_type values:
    #   'confirmed'   — user confirmed this detection is correct
    #   'not_person'  — the detected face/body is not a person or pet
    #   'not_subject' — this face is in the photo but is not this subject
    #   'low_quality' — blurry, occluded, or too small to be useful
    #   'wrong_person'— misidentified: belongs to a different named subject
    #   'sensitive'   — user flags content as offensive or sensitive
    op.create_table(
        "detection_feedback",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "detection_id",
            sa.Integer,
            sa.ForeignKey("subject_detections.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "user_id",
            sa.Integer,
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("feedback_type", sa.String(20), nullable=False),
        # For 'wrong_person': the subject the user says it actually is (optional)
        sa.Column("correct_subject_id", sa.String(36), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
    )
    op.create_index(
        "ix_detection_feedback_detection_id",
        "detection_feedback",
        ["detection_id"],
    )
    op.create_index(
        "ix_detection_feedback_user_id",
        "detection_feedback",
        ["user_id"],
    )


def downgrade() -> None:
    op.drop_table("detection_feedback")
    op.drop_index("ix_subject_detections_status", "subject_detections")
    op.drop_column("subject_detections", "status")
    op.drop_column("subjects", "avg_descriptor")
