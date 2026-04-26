from datetime import datetime
from sqlalchemy import String, DateTime, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class UserTag(Base):
    """Library-scoped user-created tag, visible to all library members."""
    __tablename__ = "user_tags"

    id:         Mapped[str]          = mapped_column(String(36), primary_key=True)  # UUID
    library_id: Mapped[str]          = mapped_column(ForeignKey("libraries.id"), nullable=False)
    name:       Mapped[str]          = mapped_column(Text, nullable=False)
    color:      Mapped[str | None]   = mapped_column(String(7))  # hex e.g. '#6366f1'
    created_by: Mapped[int]          = mapped_column(ForeignKey("users.id"), nullable=False)
    created_at: Mapped[datetime]     = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime]     = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )


class MediaTag(Base):
    """Many-to-many: media item ↔ user tag."""
    __tablename__ = "media_tags"

    tag_id:   Mapped[str]      = mapped_column(ForeignKey("user_tags.id"), primary_key=True)
    media_id: Mapped[str]      = mapped_column(ForeignKey("media.id"), primary_key=True)
    added_by: Mapped[int]      = mapped_column(ForeignKey("users.id"), nullable=False)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class UserFavorite(Base):
    """Per-user favorites. Scoped to library at query time via library_media join."""
    __tablename__ = "user_favorites"

    user_id:  Mapped[int]      = mapped_column(ForeignKey("users.id"), primary_key=True)
    media_id: Mapped[str]      = mapped_column(ForeignKey("media.id"), primary_key=True)
    added_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
