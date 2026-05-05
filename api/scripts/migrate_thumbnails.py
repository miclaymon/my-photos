#!/usr/bin/env python3
"""
Thumbnail migration script — generates multi-size WebP thumbnails for existing
media items and optionally migrates media files to the new /media/ path layout.

Usage:
  cd api
  python scripts/migrate_thumbnails.py [--dry-run] [--migrate-paths] [--limit N]

  Can also be run without activating the venv — the script re-execs itself
  using .venv/bin/python automatically when run with the system interpreter.

Usage:

What it does:
  1. Finds all media rows that have thumbnail_object_key (old single thumb) but
     no thumbnail_base_key (new multi-size).
  2. Downloads the original file from S3.
  3. Generates 5 WebP thumbnail sizes (64, 96, 128, 256, 512 px).
  4. Uploads them to {uid}/{uuid}/thumb/{size}.webp.
  5. Updates thumbnail_base_key in the database.

With --migrate-paths:
  Also copies the original media file from {uid}/{uuid}/{file} to
  {uid}/{uuid}/media/{file} and updates object_key in the database.
  The old key is deleted from S3 after a successful copy.
  The old single thumbnail (thumb.jpg) is also deleted.
"""
import argparse
import io
import logging
import os
import sys
from pathlib import Path

# Re-exec with the venv interpreter when sys.prefix doesn't point at our venv.
# sys.prefix is set correctly by Python itself when invoked via the venv's bin/ symlink,
# so this works whether or not the venv was activated with `source .venv/bin/activate`.
_SCRIPT_DIR = Path(__file__).parent.parent  # api/
_VENV_DIR   = (_SCRIPT_DIR / ".venv").resolve()
if Path(sys.prefix).resolve() != _VENV_DIR:
    _VENV_BIN    = _SCRIPT_DIR / ".venv" / "bin"
    _VENV_PYTHON = next((p for p in [_VENV_BIN / "python3", _VENV_BIN / "python"] if p.exists()), None)
    if _VENV_PYTHON:
        os.execv(str(_VENV_PYTHON), [str(_VENV_PYTHON)] + sys.argv)

# Ensure the api package is importable
sys.path.insert(0, str(_SCRIPT_DIR))

from PIL import Image, ImageOps

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def main() -> None:
    parser = argparse.ArgumentParser(description="Migrate thumbnails to multi-size WebP")
    parser.add_argument("--dry-run",       action="store_true", help="Do not write anything")
    parser.add_argument("--migrate-paths", action="store_true", help="Also migrate media to /media/ sub-path")
    parser.add_argument("--limit",         type=int, default=0, help="Stop after N items (0 = all)")
    args = parser.parse_args()

    # Import after path setup
    from app.config import settings
    from app.database import SessionLocal
    from app.models.media import Media
    from app.storage.s3 import get_object_bytes, get_s3_client
    from app.utils.media_processing import (
        THUMB_SIZES,
        generate_thumbnails,
        thumb_base_key,
        thumb_size_key,
    )

    db  = SessionLocal()
    s3  = get_s3_client()
    bucket = settings.storage_bucket_name

    # Fetch IDs upfront so commits inside the loop don't invalidate the cursor
    media_ids: list[str] = [
        row[0] for row in db.query(Media.id).filter(
            Media.thumbnail_object_key.isnot(None),
            Media.thumbnail_base_key.is_(None),
        ).all()
    ]
    if args.limit:
        media_ids = media_ids[:args.limit]
    total = len(media_ids)
    logger.info("Found %d items needing thumbnail migration", total)

    processed = 0
    errors    = 0

    for media_id in media_ids:
        media = db.query(Media).filter(Media.id == media_id).first()
        if not media:
            continue
        try:
            logger.info("[%d/%d] %s — %s", processed + 1, total, media_id, media.original_filename)

            # Download original
            raw = get_object_bytes(media.object_key)

            # Open image (or video frame from existing thumb)
            try:
                img = Image.open(io.BytesIO(raw))
                img = ImageOps.exif_transpose(img)
            except Exception:
                # For videos we need to use the existing single thumbnail
                if media.thumbnail_object_key:
                    thumb_raw = get_object_bytes(media.thumbnail_object_key)
                    img = Image.open(io.BytesIO(thumb_raw))
                else:
                    logger.warning("Cannot open image for %s — skipping", media.id)
                    errors += 1
                    continue

            base_key = thumb_base_key(media.object_key)

            if not args.dry_run:
                generate_thumbnails(img, s3, base_key)
                media.thumbnail_base_key = base_key
                db.commit()

            logger.info("  → thumbnails at %s/{64,96,128,256,512}.webp", base_key)

            # Optionally migrate the original file path
            if args.migrate_paths:
                parts = media.object_key.split("/")
                if len(parts) == 3 and parts[2] != "":
                    # Old format: {uid}/{uuid}/{file}
                    new_key = f"{parts[0]}/{parts[1]}/media/{parts[2]}"
                    logger.info("  → moving %s → %s", media.object_key, new_key)
                    if not args.dry_run:
                        # S3 copy + delete (no server-side move)
                        s3.copy_object(
                            Bucket=bucket,
                            CopySource={"Bucket": bucket, "Key": media.object_key},
                            Key=new_key,
                        )
                        s3.delete_object(Bucket=bucket, Key=media.object_key)
                        # Delete old single thumbnail
                        if media.thumbnail_object_key:
                            try:
                                s3.delete_object(Bucket=bucket, Key=media.thumbnail_object_key)
                            except Exception:
                                pass
                        media.object_key = new_key
                        media.thumbnail_object_key = None
                        db.commit()
                else:
                    logger.info("  → path already in new format, skipping move")

            processed += 1

        except Exception as exc:
            logger.exception("Error processing %s: %s", media.id, exc)
            db.rollback()
            errors += 1

    db.close()

    mode = "DRY RUN — " if args.dry_run else ""
    logger.info("%sDone. Processed: %d, Errors: %d", mode, processed, errors)


if __name__ == "__main__":
    main()
