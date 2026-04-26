from datetime import datetime
from sqlalchemy import String, Integer, DateTime, Text, ForeignKey, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Album(Base):
    __tablename__ = "albums"

    id:         Mapped[str]          = mapped_column(String(36), primary_key=True)  # UUID
    library_id: Mapped[str]          = mapped_column(ForeignKey("libraries.id"), nullable=False)
    owner_id:   Mapped[int]          = mapped_column(ForeignKey("users.id"), nullable=False)
    name:       Mapped[str]          = mapped_column(Text, nullable=False)
    cover_id:   Mapped[str | None]   = mapped_column(String(36))  # soft ref — no FK
    created_at: Mapped[datetime]     = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    updated_at: Mapped[datetime]     = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class AlbumItem(Base):
    """Ordered, captioned media within an album."""
    __tablename__ = "album_items"

    id:         Mapped[int]          = mapped_column(primary_key=True, autoincrement=True)
    album_id:   Mapped[str]          = mapped_column(ForeignKey("albums.id"), nullable=False)
    media_id:   Mapped[str]          = mapped_column(ForeignKey("media.id"), nullable=False)
    sort_order: Mapped[int]          = mapped_column(Integer, nullable=False, default=0)
    caption:    Mapped[str | None]   = mapped_column(Text)
    added_at:   Mapped[datetime]     = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )


class AlbumAccess(Base):
    """Per-album sharing grants."""
    __tablename__ = "album_access"

    id:         Mapped[int]      = mapped_column(primary_key=True, autoincrement=True)
    album_id:   Mapped[str]      = mapped_column(ForeignKey("albums.id"), nullable=False)
    user_id:    Mapped[int]      = mapped_column(ForeignKey("users.id"), nullable=False)
    permission: Mapped[str]      = mapped_column(String(20), nullable=False)  # 'view' | 'edit'
    granted_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
