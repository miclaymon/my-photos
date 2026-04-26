from datetime import datetime
from sqlalchemy import String, Integer, Float, DateTime, Text, Boolean, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Subject(Base):
    """A detected person or pet cluster across a library."""
    __tablename__ = "subjects"

    id:                          Mapped[str]          = mapped_column(String(36), primary_key=True)  # UUID
    library_id:                  Mapped[str]          = mapped_column(ForeignKey("libraries.id"), nullable=False)
    type:                        Mapped[str]          = mapped_column(String(20), nullable=False)  # 'person' | 'pet'
    name:                        Mapped[str | None]   = mapped_column(Text)
    hidden:                      Mapped[bool]         = mapped_column(Boolean, nullable=False, default=False)
    pet_class:                   Mapped[list | None]  = mapped_column(JSONB)  # e.g. ["cat", "dog"]
    cover_media_id:              Mapped[str | None]   = mapped_column(String(36))
    representative_detection_id: Mapped[int | None]   = mapped_column(Integer)  # soft ref to subject_detections.id
    # Running average of all confirmed face embeddings for this subject (128-d float array).
    # Updated incrementally after each confirmed detection. Used for fast matching.
    avg_descriptor:              Mapped[list | None]  = mapped_column(JSONB)
    created_at:                  Mapped[datetime]     = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at:                  Mapped[datetime]     = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class SubjectDetection(Base):
    """Individual face/pet detection within a single photo."""
    __tablename__ = "subject_detections"

    id:            Mapped[int]          = mapped_column(primary_key=True, autoincrement=True)
    media_id:      Mapped[str]          = mapped_column(ForeignKey("media.id"), nullable=False)
    subject_id:    Mapped[str | None]   = mapped_column(ForeignKey("subjects.id"))  # null until clustered
    bounding_box:  Mapped[dict]         = mapped_column(JSONB, nullable=False)  # {x, y, w, h} as 0–1 fractions
    match_distance: Mapped[float | None] = mapped_column(Float)
    review_needed: Mapped[bool]         = mapped_column(Boolean, nullable=False, default=False)
    descriptor:    Mapped[list | None]  = mapped_column(JSONB)  # 128-d face embedding (float array)
    confidence:    Mapped[float]        = mapped_column(Float, nullable=False)
    # 'auto'          — assigned by the detector, not yet reviewed
    # 'confirmed'     — user confirmed this detection belongs to the subject
    # 'rejected'      — user rejected this detection (see detection_feedback for reason)
    # 'review_pending'— flagged for review but user has not yet responded
    status:        Mapped[str]          = mapped_column(String(20), nullable=False, server_default="auto")
    face_crop_key: Mapped[str | None]   = mapped_column(String(500))  # S3 key for cropped face WebP
    detected_at:   Mapped[datetime]     = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class DetectionFeedback(Base):
    """User feedback on a specific face/pet detection."""
    __tablename__ = "detection_feedback"

    id:                Mapped[int]          = mapped_column(primary_key=True, autoincrement=True)
    detection_id:      Mapped[int]          = mapped_column(ForeignKey("subject_detections.id", ondelete="CASCADE"), nullable=False)
    user_id:           Mapped[int]          = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    # 'confirmed'    — detection is correct
    # 'not_person'   — not a person or pet
    # 'not_subject'  — face is present but is a different (unknown) person
    # 'low_quality'  — blurry, occluded, or too small to be reliable
    # 'wrong_person' — misidentified; correct_subject_id may indicate who it actually is
    # 'sensitive'    — user flags as offensive or sensitive content
    feedback_type:     Mapped[str]          = mapped_column(String(20), nullable=False)
    correct_subject_id: Mapped[str | None]  = mapped_column(String(36))  # set when feedback_type == 'wrong_person'
    created_at:        Mapped[datetime]     = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
