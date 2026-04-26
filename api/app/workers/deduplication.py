"""Deduplication worker — computes and stores file hash for duplicate detection."""
import hashlib
import logging
from sqlalchemy.orm import Session

from app.models.media import Media
from app.storage.s3 import get_object_bytes

logger = logging.getLogger(__name__)

CHUNK_SIZE = 65536


def run(media_id: str, db: Session) -> None:
    media = db.query(Media).filter(Media.id == media_id).first()
    if media is None:
        raise ValueError(f"Media {media_id} not found")

    if media.hash:
        logger.info("Media %s already has a hash, skipping.", media_id)
        return

    data = get_object_bytes(media.object_key)
    sha256 = hashlib.sha256(data).hexdigest()
    media.hash = sha256
    db.commit()
    logger.info("Hashed media %s → %s", media_id, sha256)
