from datetime import datetime
from sqlalchemy import String, Integer, Float, DateTime, Text, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Media(Base):
    __tablename__ = "media"

    id:                   Mapped[str]            = mapped_column(String(36), primary_key=True)  # UUID
    uploaded_by:          Mapped[int]            = mapped_column(ForeignKey("users.id"), nullable=False)
    object_key:           Mapped[str]            = mapped_column(Text, nullable=False, unique=True)
    original_filename:    Mapped[str]            = mapped_column(Text, nullable=False)
    content_type:         Mapped[str]            = mapped_column(String(100), nullable=False)
    size:                 Mapped[int]            = mapped_column(Integer, nullable=False)
    width:                Mapped[int | None]     = mapped_column(Integer)
    height:               Mapped[int | None]     = mapped_column(Integer)
    aspect_ratio:         Mapped[float | None]   = mapped_column(Float)
    duration_seconds:     Mapped[float | None]   = mapped_column(Float)
    taken_at:             Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at:           Mapped[datetime]       = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    # Processing outputs
    thumbnail_object_key: Mapped[str | None]     = mapped_column(Text)  # legacy single-thumb key
    thumbnail_base_key:   Mapped[str | None]     = mapped_column(Text)  # new: "{uid}/{uuid}/thumb" prefix
    preview_object_key:   Mapped[str | None]     = mapped_column(Text)
    exif_data:            Mapped[dict | None]    = mapped_column(JSONB)   # PostgreSQL JSONB (was TEXT in SQLite)
    hash:                 Mapped[str | None]     = mapped_column(String(64))  # SHA-256
    text:                 Mapped[str | None]     = mapped_column(Text)    # OCR output; indexed for full-text search
    # Lifecycle
    archived_at:          Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deletion_date:        Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_private:           Mapped[bool]            = mapped_column(nullable=False, server_default='false')
    # Background processing timestamps (null = not yet processed)
    objects_processed_at:  Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    faces_processed_at:    Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    ocr_processed_at:      Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    location_label:        Mapped[str | None]    = mapped_column(Text)
    location_processed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class DeletedItem(Base):
    __tablename__ = "deleted_items"

    id:           Mapped[int]      = mapped_column(primary_key=True, autoincrement=True)
    media_id:     Mapped[str]      = mapped_column(ForeignKey("media.id"), nullable=False)
    deleted_by:   Mapped[int]      = mapped_column(ForeignKey("users.id"), nullable=False)
    deletion_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    reason:       Mapped[str | None] = mapped_column(Text)
    created_at:   Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class MediaObject(Base):
    """COCO-SSD detected object per photo."""
    __tablename__ = "media_objects"

    id:          Mapped[int]   = mapped_column(primary_key=True, autoincrement=True)
    media_id:    Mapped[str]   = mapped_column(ForeignKey("media.id"), nullable=False)
    class_name:  Mapped[str]   = mapped_column("class", String(100), nullable=False)
    confidence:  Mapped[float] = mapped_column(Float, nullable=False)
    bounding_box: Mapped[dict] = mapped_column(JSONB, nullable=False)  # {x, y, w, h} in pixels
    detected_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class MediaOcr(Base):
    """Extracted text per photo."""
    __tablename__ = "media_ocr"

    id:          Mapped[int]         = mapped_column(primary_key=True, autoincrement=True)
    media_id:    Mapped[str]         = mapped_column(ForeignKey("media.id"), nullable=False, unique=True)
    text:        Mapped[str]         = mapped_column(Text, nullable=False)
    confidence:  Mapped[float | None] = mapped_column(Float)
    processed_at: Mapped[datetime]   = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
