"""
Helpers that run whenever a new user account is created, regardless of
the creation path (setup script, invite acceptance, future OAuth, etc.).
"""
import uuid

from sqlalchemy.orm import Session

from app.models.library import Library


def provision_personal_library(db: Session, user_id: int, display_name: str | None = None) -> Library:
    """Create a personal library for *user_id* if one doesn't already exist.

    Returns the (possibly pre-existing) personal library.
    """
    existing = (
        db.query(Library)
        .filter(Library.owner_id == user_id, Library.type == "personal")
        .first()
    )
    if existing:
        return existing

    name = f"{display_name}'s Library" if display_name else "My Library"
    library = Library(
        id=str(uuid.uuid4()),
        name=name,
        type="personal",
        owner_id=user_id,
    )
    db.add(library)
    db.commit()
    db.refresh(library)
    return library
