from datetime import datetime
from sqlalchemy import String, DateTime, Text, ForeignKey, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class Place(Base):
    """A geocoded location label, optionally renamed by the user."""
    __tablename__ = "places"
    __table_args__ = (
        UniqueConstraint("library_id", "location_label", name="uq_places_library_label"),
    )

    id:             Mapped[str]        = mapped_column(String(36), primary_key=True)
    library_id:     Mapped[str]        = mapped_column(ForeignKey("libraries.id", ondelete="CASCADE"), nullable=False)
    location_label: Mapped[str]        = mapped_column(Text, nullable=False)   # original geocoded label
    display_name:   Mapped[str | None] = mapped_column(Text)                   # user-provided custom name
    created_at:     Mapped[datetime]   = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
