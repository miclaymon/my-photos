from datetime import datetime
from sqlalchemy import String, DateTime, Text, ForeignKey, func, Index
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base

# Valid job types
JOB_TYPES = ("ocr", "object_detection", "face_grouping", "location_geocode", "deduplication", "barcode")
JOB_STATUSES = ("pending", "running", "completed", "failed")


class BackgroundJob(Base):
    __tablename__ = "background_jobs"

    id:           Mapped[int]          = mapped_column(primary_key=True, autoincrement=True)
    media_id:     Mapped[str]          = mapped_column(ForeignKey("media.id"), nullable=False)
    type:         Mapped[str]          = mapped_column(String(30), nullable=False)    # see JOB_TYPES
    status:       Mapped[str]          = mapped_column(String(20), nullable=False, default="pending")  # see JOB_STATUSES
    error:        Mapped[str | None]   = mapped_column(Text)
    # batch_id groups all jobs enqueued in one "Enqueue & Run" action.
    # job_id is SHA-256("{media_id}:{type}") — unique index allows upsert-by-key.
    batch_id:     Mapped[str | None]   = mapped_column(String(36), index=True)
    job_id:       Mapped[str | None]   = mapped_column(String(64))
    created_at:   Mapped[datetime]     = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    started_at:   Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    __table_args__ = (
        Index("uq_background_jobs_job_id", "job_id", unique=True),
    )
