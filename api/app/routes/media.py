"""Media routes — mirrors Nitro /api/v1/media/* endpoints."""
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.library import Library, LibraryMedia
from app.models.job import BackgroundJob
from app.models.album import Album, AlbumItem
from app.models.media import DeletedItem, Media, MediaObject, MediaOcr
from app.models.subject import Subject, SubjectDetection
from app.models.tag import MediaTag, UserFavorite, UserTag
from app.models.user import User
from app.storage.s3 import delete_object, generate_presigned_download_url, generate_presigned_upload_url
from app.utils.media_processing import enqueue_jobs, process_after_upload

router = APIRouter()


# ---------------------------------------------------------------------------
# Request body schemas
# ---------------------------------------------------------------------------

class UploadUrlRequest(BaseModel):
    filename: str
    content_type: str
    library_ids: list[str]


class CheckDuplicatesRequest(BaseModel):
    hashes: list[str]


class CompleteUploadRequest(BaseModel):
    object_key: str
    filename: str
    content_type: str
    size: int
    library_ids: list[str]
    width: Optional[int] = None
    height: Optional[int] = None
    aspect_ratio: Optional[float] = None
    taken_at: Optional[str] = None  # ISO 8601 string
    hash: Optional[str] = None


# ---------------------------------------------------------------------------
# Helper utilities
# ---------------------------------------------------------------------------

def _safe_filename(filename: str) -> str:
    """Replace characters outside [a-zA-Z0-9._-] with underscores."""
    return re.sub(r"[^a-zA-Z0-9._\-]", "_", filename)


def _check_owner_or_admin(media: Media, current_user: User) -> None:
    if current_user.id != media.uploaded_by and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")


def _build_thumbnail_url(media: Media) -> Optional[str]:
    key = media.thumbnail_object_key or media.object_key
    return generate_presigned_download_url(key) if key else None


# ---------------------------------------------------------------------------
# Static routes MUST come before /{media_id}
# ---------------------------------------------------------------------------

@router.post("/upload-url")
def get_upload_url(
    body: UploadUrlRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    safe = _safe_filename(body.filename)
    object_key = f"{current_user.id}/{uuid.uuid4()}/{safe}"
    upload_url = generate_presigned_upload_url(object_key, body.content_type, expires_in=900)
    return {"upload_url": upload_url, "object_key": object_key}


@router.post("/check-duplicates")
def check_duplicates(
    body: CheckDuplicatesRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    matches = db.query(Media).filter(Media.hash.in_(body.hashes)).all()
    duplicates = []
    for m in matches:
        thumb_key = m.thumbnail_object_key or m.object_key
        thumbnail_url = generate_presigned_download_url(thumb_key)
        duplicates.append({
            "id":                m.id,
            "hash":              m.hash,
            "original_filename": m.original_filename,
            "content_type":      m.content_type,
            "size":              m.size,
            "width":             m.width,
            "height":            m.height,
            "taken_at":          m.taken_at.isoformat() if m.taken_at else None,
            "thumbnail_url":     thumbnail_url,
        })
    return {"duplicates": duplicates}


@router.post("/complete")
def complete_upload(
    body: CompleteUploadRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    taken_at: Optional[datetime] = None
    if body.taken_at:
        taken_at = datetime.fromisoformat(body.taken_at)

    media = Media(
        id=str(uuid.uuid4()),
        uploaded_by=current_user.id,
        object_key=body.object_key,
        original_filename=body.filename,
        content_type=body.content_type,
        size=body.size,
        width=body.width,
        height=body.height,
        aspect_ratio=body.aspect_ratio,
        taken_at=taken_at,
        hash=body.hash,
    )
    db.add(media)
    db.flush()  # get media.id into the session without committing yet

    for library_id in body.library_ids:
        # Upsert library row (do nothing if it already exists)
        lib_stmt = (
            pg_insert(Library.__table__)
            .values(
                id=library_id,
                name=library_id,   # placeholder name — caller owns the real name
                type="personal",
                owner_id=current_user.id,
            )
            .on_conflict_do_nothing()
        )
        db.execute(lib_stmt)

        # Insert library_media (do nothing if already linked)
        lm_stmt = (
            pg_insert(LibraryMedia.__table__)
            .values(library_id=library_id, media_id=media.id)
            .on_conflict_do_nothing()
        )
        db.execute(lm_stmt)

    db.commit()
    db.refresh(media)
    enqueue_jobs(media.id, body.content_type, bool(body.hash), db)
    background_tasks.add_task(process_after_upload, media.id)
    return {"id": media.id}


# ---------------------------------------------------------------------------
# /{media_id} routes
# ---------------------------------------------------------------------------

@router.get("/{media_id}")
def get_media(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Not found")

    image_url = generate_presigned_download_url(media.object_key)
    thumbnail_url = (
        generate_presigned_download_url(media.thumbnail_object_key)
        if media.thumbnail_object_key
        else None
    )
    preview_url = (
        generate_presigned_download_url(media.preview_object_key)
        if media.preview_object_key
        else None
    )

    return {
        "id": media.id,
        "uploaded_by": media.uploaded_by,
        "object_key": media.object_key,
        "original_filename": media.original_filename,
        "content_type": media.content_type,
        "size": media.size,
        "width": media.width,
        "height": media.height,
        "aspect_ratio": media.aspect_ratio,
        "duration_seconds": media.duration_seconds,
        "taken_at": media.taken_at.isoformat() if media.taken_at else None,
        "created_at": media.created_at.isoformat() if media.created_at else None,
        "thumbnail_object_key": media.thumbnail_object_key,
        "preview_object_key": media.preview_object_key,
        "exif_data": {k: v for k, v in (media.exif_data or {}).items() if k != "barcodes"} or None,
        "hash": media.hash,
        "text": media.text,
        "archived_at": media.archived_at.isoformat() if media.archived_at else None,
        "deletion_date": media.deletion_date.isoformat() if media.deletion_date else None,
        "objects_processed_at": media.objects_processed_at.isoformat() if media.objects_processed_at else None,
        "faces_processed_at": media.faces_processed_at.isoformat() if media.faces_processed_at else None,
        "ocr_processed_at": media.ocr_processed_at.isoformat() if media.ocr_processed_at else None,
        "location_label": media.location_label,
        "location_processed_at": media.location_processed_at.isoformat() if media.location_processed_at else None,
        "image_url": image_url,
        "thumbnail_url": thumbnail_url,
        "preview_url": preview_url,
    }


@router.post("/{media_id}/soft-delete")
def soft_delete(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Not found")

    _check_owner_or_admin(media, current_user)

    deletion_date = datetime.now(timezone.utc) + timedelta(days=30)
    media.deletion_date = deletion_date

    deleted_item = DeletedItem(
        media_id=media_id,
        deleted_by=current_user.id,
        deletion_date=deletion_date,
        reason=None,
    )
    db.add(deleted_item)
    db.commit()
    return {"ok": True}


@router.post("/{media_id}/restore")
def restore(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Not found")

    _check_owner_or_admin(media, current_user)

    media.deletion_date = None
    db.query(DeletedItem).filter(DeletedItem.media_id == media_id).delete()
    db.commit()
    return {"ok": True}


@router.post("/{media_id}/archive")
def archive_media(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Not found")

    _check_owner_or_admin(media, current_user)

    media.archived_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


@router.post("/{media_id}/unarchive")
def unarchive_media(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Not found")

    _check_owner_or_admin(media, current_user)

    media.archived_at = None
    db.commit()
    return {"ok": True}


@router.post("/{media_id}/permanent-delete")
def permanent_delete(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Not found")

    # Must be soft-deleted already, OR caller is the owner/admin.
    # Owners can force-delete without the soft-delete step (e.g. overwrite during re-upload).
    is_owner = current_user.id == media.uploaded_by
    if media.deletion_date is None and not current_user.is_admin and not is_owner:
        raise HTTPException(status_code=400, detail="Media must be soft-deleted before permanent deletion")

    _check_owner_or_admin(media, current_user)

    # Delete storage objects — failures are non-fatal
    for key in [media.object_key, media.thumbnail_object_key, media.preview_object_key]:
        if key:
            try:
                delete_object(key)
            except Exception:
                pass

    # Delete dependent DB rows
    db.query(BackgroundJob).filter(BackgroundJob.media_id == media_id).delete()
    db.query(AlbumItem).filter(AlbumItem.media_id == media_id).delete()
    db.query(DeletedItem).filter(DeletedItem.media_id == media_id).delete()
    db.query(MediaTag).filter(MediaTag.media_id == media_id).delete()
    db.query(UserFavorite).filter(UserFavorite.media_id == media_id).delete()
    db.query(SubjectDetection).filter(SubjectDetection.media_id == media_id).delete()
    db.query(MediaObject).filter(MediaObject.media_id == media_id).delete()
    db.query(MediaOcr).filter(MediaOcr.media_id == media_id).delete()
    db.query(LibraryMedia).filter(LibraryMedia.media_id == media_id).delete()

    db.delete(media)
    db.commit()
    return {"ok": True}


@router.put("/{media_id}/favorite")
def add_favorite(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    stmt = (
        pg_insert(UserFavorite.__table__)
        .values(user_id=current_user.id, media_id=media_id)
        .on_conflict_do_nothing()
    )
    db.execute(stmt)
    db.commit()
    return {"ok": True}


@router.delete("/{media_id}/favorite")
def remove_favorite(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(UserFavorite).filter(
        and_(UserFavorite.user_id == current_user.id, UserFavorite.media_id == media_id)
    ).delete()
    db.commit()
    return {"ok": True}


@router.get("/{media_id}/subjects")
def get_subjects(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Fetch all detections for this media that are linked to a subject
    rows = (
        db.query(SubjectDetection, Subject)
        .join(Subject, Subject.id == SubjectDetection.subject_id)
        .filter(
            SubjectDetection.media_id == media_id,
            SubjectDetection.subject_id.isnot(None),
        )
        .all()
    )

    # Deduplicate by subject_id: one row per subject, preferring detections with a
    # face crop key so the best available thumbnail wins when there are multiple
    # detections of the same person/pet in the same photo.
    best: dict[str, tuple[SubjectDetection, Subject]] = {}
    for detection, subject in rows:
        existing = best.get(subject.id)
        if existing is None or (detection.face_crop_key and not existing[0].face_crop_key):
            best[subject.id] = (detection, subject)

    results = []
    for detection, subject in best.values():
        bounding_box = detection.bounding_box  # already fractional (0-1)

        # Build thumbnail URL for this subject.
        # Prefer the face crop from this detection, then subject cover, then
        # representative detection thumbnail.
        thumbnail_url: Optional[str] = None

        if detection.face_crop_key:
            thumbnail_url = generate_presigned_download_url(detection.face_crop_key)

        elif subject.cover_media_id:
            cover = db.query(Media).filter(Media.id == subject.cover_media_id).first()
            if cover:
                cover_key = cover.thumbnail_object_key or cover.object_key
                thumbnail_url = generate_presigned_download_url(cover_key)

        elif subject.representative_detection_id is not None:
            rep_detection = (
                db.query(SubjectDetection)
                .filter(SubjectDetection.id == subject.representative_detection_id)
                .first()
            )
            if rep_detection:
                if rep_detection.face_crop_key:
                    thumbnail_url = generate_presigned_download_url(rep_detection.face_crop_key)
                else:
                    rep_media = db.query(Media).filter(Media.id == rep_detection.media_id).first()
                    if rep_media:
                        rep_key = rep_media.thumbnail_object_key or rep_media.object_key
                        thumbnail_url = generate_presigned_download_url(rep_key)

        results.append({
            "subject_id": subject.id,
            "name": subject.name,
            "type": subject.type,
            "hidden": subject.hidden,
            "bounding_box": bounding_box,
            "thumbnail_url": thumbnail_url,
            "pet_class": subject.pet_class,
            "match_distance": detection.match_distance,
            "review_needed": detection.review_needed,
        })

    return {"subjects": results}


@router.get("/{media_id}/albums")
def get_media_albums(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(AlbumItem, Album)
        .join(Album, Album.id == AlbumItem.album_id)
        .filter(
            AlbumItem.media_id == media_id,
            Album.deleted_at.is_(None),
        )
        .order_by(Album.name)
        .all()
    )
    return {
        "albums": [
            {"id": album.id, "name": album.name, "library_id": album.library_id}
            for _, album in rows
        ]
    }


@router.get("/{media_id}/barcodes")
def get_media_barcodes(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Not found")
    barcodes = (media.exif_data or {}).get("barcodes", [])
    return {"barcodes": barcodes}


@router.get("/{media_id}/objects")
def get_objects(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    media = db.query(Media).filter(Media.id == media_id).first()
    if not media:
        raise HTTPException(status_code=404, detail="Not found")

    objs = db.query(MediaObject).filter(MediaObject.media_id == media_id).all()

    normalized = []
    for obj in objs:
        bb = obj.bounding_box  # pixels: {x, y, w, h}
        if media.width and media.height and media.width > 0 and media.height > 0:
            norm_bb = {
                "x": bb.get("x", 0) / media.width,
                "y": bb.get("y", 0) / media.height,
                "w": bb.get("w", 0) / media.width,
                "h": bb.get("h", 0) / media.height,
            }
        else:
            norm_bb = bb  # cannot normalize without dimensions

        normalized.append({
            "id": obj.id,
            "class_name": obj.class_name,
            "confidence": obj.confidence,
            "bounding_box": norm_bb,
        })

    return {"objects": normalized}


@router.get("/{media_id}/tags")
def get_tags(
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(MediaTag, UserTag)
        .join(UserTag, UserTag.id == MediaTag.tag_id)
        .filter(MediaTag.media_id == media_id)
        .all()
    )

    tags = [
        {
            "id": tag.id,
            "name": tag.name,
            "color": tag.color,
            "library_id": tag.library_id,
        }
        for _media_tag, tag in rows
    ]

    return {"tags": tags}
