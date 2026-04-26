from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Library(Base):
    __tablename__ = "libraries"

    id:        Mapped[str]         = mapped_column(String(36), primary_key=True)  # UUID
    name:      Mapped[str]         = mapped_column(Text, nullable=False)
    type:      Mapped[str]         = mapped_column(String(20), nullable=False)    # 'personal' | 'shared'
    owner_id:  Mapped[int | None]  = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime]   = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class LibraryMedia(Base):
    """Many-to-many: a media item can belong to multiple libraries."""
    __tablename__ = "library_media"

    library_id: Mapped[str]      = mapped_column(ForeignKey("libraries.id"), primary_key=True)
    media_id:   Mapped[str]      = mapped_column(ForeignKey("media.id"), primary_key=True)
    added_at:   Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class LibraryAccess(Base):
    """Per-user role within a shared library."""
    __tablename__ = "library_access"

    id:         Mapped[int]      = mapped_column(primary_key=True, autoincrement=True)
    library_id: Mapped[str]      = mapped_column(ForeignKey("libraries.id"), nullable=False)
    user_id:    Mapped[int]      = mapped_column(ForeignKey("users.id"), nullable=False)
    role:       Mapped[str]      = mapped_column(String(20), nullable=False)  # 'owner' | 'editor' | 'viewer'
    added_at:   Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class ShareLink(Base):
    __tablename__ = "share_links"

    id:          Mapped[str]          = mapped_column(String(36), primary_key=True)  # UUID token
    library_id:  Mapped[str]          = mapped_column(ForeignKey("libraries.id"), nullable=False)
    album_id:    Mapped[str | None]   = mapped_column(String(36))
    media_ids:   Mapped[list | None]  = mapped_column(JSONB)  # array of media UUIDs; null = whole library/album
    created_by:  Mapped[int]          = mapped_column(ForeignKey("users.id"), nullable=False)
    expires_at:  Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at:  Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at:  Mapped[datetime]     = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
