"""Library routes — mirrors Nitro /api/v1/library/* endpoints."""
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import and_, asc, desc, extract, func, or_
from sqlalchemy.dialects.postgresql import insert as pg_insert

from app.database import get_db
from app.dependencies import get_current_user
from app.models.user import User
from app.models.library import Library, LibraryMedia, LibraryAccess
from app.models.media import Media, MediaObject
from app.models.album import Album, AlbumItem
from app.models.subject import Subject, SubjectDetection
from app.models.tag import UserTag, MediaTag, UserFavorite
from app.models.place import Place
from app.storage.s3 import generate_presigned_download_url

router = APIRouter()


# ---------------------------------------------------------------------------
# Request body schemas
# ---------------------------------------------------------------------------

class CreateLibraryBody(BaseModel):
    name: str
    type: str


class CreateAlbumBody(BaseModel):
    name: str


class CreateTagBody(BaseModel):
    name: str
    color: Optional[str] = None


class UpdateTagBody(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None


class AddTagItemsBody(BaseModel):
    media_ids: list[str]


class CopyFromBody(BaseModel):
    media_ids: list[str]


class RenamePlaceBody(BaseModel):
    display_name: Optional[str] = None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _presign(object_key: Optional[str]) -> Optional[str]:
    """Generate a presigned download URL, returning None on any error."""
    if not object_key:
        return None
    try:
        return generate_presigned_download_url(object_key)
    except Exception:
        return None


def _compute_dimensions(m: Media):
    """Return (aspect_ratio, width, height) with sensible defaults."""
    aspect_ratio = m.aspect_ratio
    if aspect_ratio is None:
        if m.width and m.height:
            aspect_ratio = m.width / m.height
        else:
            aspect_ratio = 1.5

    width = m.width
    height = m.height
    if width is None or height is None:
        if aspect_ratio >= 1:
            width = 1200
        else:
            width = 800
        height = round(width / aspect_ratio)
    return aspect_ratio, width, height


def _serialize_media_item(m: Media) -> dict:
    """Serialize a media row for the gallery list response.

    Only the thumbnail URL is returned here — the full-resolution `src` and
    `preview_src` (video hover clip) are omitted deliberately:
      • The gallery tile only needs a small thumbnail; returning all three URLs
        generates 3× as many presigned-URL computations and causes 3× as many
        concurrent requests to storage on initial page load.
      • The lightbox / preview page fetches the full URL via GET /api/v1/media/{id}
        the first time it needs it, adding a single lightweight round-trip only when
        the user actually opens a photo.
      • Videos without a server-extracted thumbnail need `src` so the <video>
        element can show the first frame; that's the only exception.
    """
    aspect_ratio, width, height = _compute_dimensions(m)
    # Fall back to created_at when EXIF date is absent so the item always lands
    # in a gallery section (upload day) rather than being silently dropped.
    date_src = m.taken_at or m.created_at
    taken_at = date_src.isoformat() if isinstance(date_src, datetime) else date_src
    is_video = m.content_type.startswith("video/")
    has_thumbnail = bool(m.thumbnail_object_key)

    return {
        "id": m.id,
        "original_filename": m.original_filename,
        "content_type": m.content_type,
        "width": width,
        "height": height,
        "aspect_ratio": aspect_ratio,
        "taken_at": taken_at,
        "created_at": m.created_at.isoformat() if isinstance(m.created_at, datetime) else m.created_at,
        "is_video": is_video,
        "duration_seconds": m.duration_seconds,
        # Full-res src: for any item without a thumbnail yet (images or videos).
        # Images normally show via thumbnailSrc; this fallback keeps newly uploaded
        # items visible in the gallery while the background thumbnail job is pending.
        "src": _presign(m.object_key) if not has_thumbnail else None,
        "thumbnail_src": _presign(m.thumbnail_object_key),
        # preview_src omitted — fetched on demand in the lightbox
        "preview_src": None,
    }


def _has_library_edit_access(db: Session, library_id: str, user: User) -> bool:
    if user.is_admin:
        return True
    access = db.query(LibraryAccess).filter(
        and_(
            LibraryAccess.library_id == library_id,
            LibraryAccess.user_id == user.id,
            LibraryAccess.role.in_(["owner", "editor"]),
        )
    ).first()
    return access is not None


# ---------------------------------------------------------------------------
# GET /api/v1/library/
# ---------------------------------------------------------------------------

@router.get("")
def list_libraries(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    libraries = db.query(Library).all()
    return {
        "libraries": [
            {
                "id": lib.id,
                "name": lib.name,
                "type": lib.type,
                "owner_id": lib.owner_id,
                "created_at": lib.created_at.isoformat() if isinstance(lib.created_at, datetime) else lib.created_at,
            }
            for lib in libraries
        ]
    }


# ---------------------------------------------------------------------------
# POST /api/v1/library/
# ---------------------------------------------------------------------------

@router.post("")
def create_library(
    body: CreateLibraryBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    lib = Library(
        id=str(uuid.uuid4()),
        name=body.name,
        type=body.type,
        owner_id=current_user.id,
    )
    db.add(lib)
    db.commit()
    db.refresh(lib)
    return {"id": lib.id, "name": lib.name, "type": lib.type}


# ---------------------------------------------------------------------------
# GET /api/v1/library/{library_id}/media
# ---------------------------------------------------------------------------

@router.get("/{library_id}/media")
def list_library_media(
    library_id: str,
    limit: int = Query(default=100, le=2000),
    before: Optional[str] = Query(default=None),
    after: Optional[str] = Query(default=None),
    cursor: Optional[str] = Query(default=None),   # alias for before
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    before = before or cursor  # backwards compat

    base_q = (
        db.query(Media)
        .join(LibraryMedia, LibraryMedia.media_id == Media.id)
        .filter(
            LibraryMedia.library_id == library_id,
            Media.deletion_date.is_(None),
            Media.archived_at.is_(None),
            Media.is_private.is_(False),
        )
    )

    if after:
        try:
            after_dt = datetime.fromisoformat(after)
            q = base_q.filter(
                or_(
                    Media.taken_at > after_dt,
                    and_(Media.taken_at.is_(None), Media.created_at > after_dt),
                )
            ).order_by(asc(Media.taken_at).nullslast(), asc(Media.created_at))
        except ValueError:
            q = base_q.order_by(desc(Media.taken_at), desc(Media.created_at))
        direction = "after"
    else:
        q = base_q
        if before:
            try:
                before_dt = datetime.fromisoformat(before)
                q = q.filter(
                    or_(
                        Media.taken_at < before_dt,
                        and_(Media.taken_at.is_(None), Media.created_at < before_dt),
                    )
                )
            except ValueError:
                pass
        q = q.order_by(desc(Media.taken_at), desc(Media.created_at))
        direction = "before"

    raw      = q.limit(limit + 1).all()
    has_more = len(raw) > limit
    page     = raw[:limit]

    if not page:
        return {
            "items":        [],
            "has_older":    False,
            "has_newer":    False,
            "older_cursor": None,
            "newer_cursor": None,
            "next_cursor":  None,
        }

    def _cursor_dt(m: Media) -> Optional[str]:
        pivot = m.taken_at or m.created_at
        return pivot.isoformat() if isinstance(pivot, datetime) else None

    if direction == "after":
        # ASC order: page[0] is oldest, page[-1] is newest in this batch
        older_cursor = _cursor_dt(page[0])
        newer_cursor = _cursor_dt(page[-1])
        has_older    = True   # items older than after_dt always exist
        has_newer    = has_more
    else:
        # DESC order: page[0] is newest, page[-1] is oldest in this batch
        newer_cursor = _cursor_dt(page[0])
        older_cursor = _cursor_dt(page[-1])
        has_older    = has_more
        has_newer    = bool(before)  # if we paged with `before`, newer items exist above

    return {
        "items":        [_serialize_media_item(m) for m in page],
        "has_older":    has_older,
        "has_newer":    has_newer,
        "older_cursor": older_cursor,
        "newer_cursor": newer_cursor,
        "next_cursor":  older_cursor if has_older else None,  # backwards compat
    }


# ---------------------------------------------------------------------------
# GET /api/v1/library/{library_id}/timeline
# ---------------------------------------------------------------------------

@router.get("/{library_id}/timeline")
def library_timeline(
    library_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Per-month photo counts + date range for the gallery timeline scrollbar.

    Only months that actually contain photos are returned — the frontend never
    renders ticks for empty months/years.  Results are meant to be cached by
    the client; the query is a single indexed aggregation and is fast.
    """
    # COALESCE(taken_at, created_at) so items without EXIF still land in a bucket
    date_expr = func.coalesce(Media.taken_at, Media.created_at)

    _filters = [
        LibraryMedia.library_id == library_id,
        Media.deletion_date.is_(None),
        Media.archived_at.is_(None),
        Media.is_private.is_(False),
    ]

    yr  = extract("year",  date_expr).label("yr")
    mo  = extract("month", date_expr).label("mo")
    cnt = func.count(Media.id).label("cnt")

    rows = (
        db.query(yr, mo, cnt)
        .select_from(Media)
        .join(LibraryMedia, LibraryMedia.media_id == Media.id)
        .filter(*_filters)
        .group_by(yr, mo)
        .order_by(desc(yr), desc(mo))
        .all()
    )

    rng = (
        db.query(
            func.min(date_expr).label("oldest"),
            func.max(date_expr).label("newest"),
        )
        .select_from(Media)
        .join(LibraryMedia, LibraryMedia.media_id == Media.id)
        .filter(*_filters)
        .first()
    )

    def _iso(dt) -> Optional[str]:
        if dt is None:
            return None
        return dt.isoformat() if isinstance(dt, datetime) else str(dt)

    return {
        "buckets": [
            {"year": int(r.yr), "month": int(r.mo), "count": r.cnt}
            for r in rows
        ],
        "total":      sum(r.cnt for r in rows),
        "newest_at":  _iso(rng.newest) if rng else None,
        "oldest_at":  _iso(rng.oldest) if rng else None,
    }


# ---------------------------------------------------------------------------
# GET /api/v1/library/{library_id}/albums
# ---------------------------------------------------------------------------

@router.get("/{library_id}/albums")
def list_albums(
    library_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    albums = (
        db.query(Album)
        .filter(Album.library_id == library_id, Album.deleted_at.is_(None))
        .all()
    )

    # Precompute library role for can_edit check
    lib_access = db.query(LibraryAccess).filter(
        and_(
            LibraryAccess.library_id == library_id,
            LibraryAccess.user_id == current_user.id,
            LibraryAccess.role.in_(["owner", "editor"]),
        )
    ).first()
    is_lib_editor = lib_access is not None or current_user.is_admin

    result = []
    for album in albums:
        item_count = (
            db.query(func.count(AlbumItem.id))
            .filter(AlbumItem.album_id == album.id)
            .scalar()
        )

        # Build cover media list: cover_id first, then fill up to 4 from sorted items
        cover_media_ids: list[str] = []
        if album.cover_id:
            cover_media_ids.append(album.cover_id)

        if len(cover_media_ids) < 4:
            remaining = 4 - len(cover_media_ids)
            extra_items = (
                db.query(AlbumItem.media_id)
                .filter(AlbumItem.album_id == album.id)
                .order_by(AlbumItem.sort_order)
                .limit(remaining + 1)  # overfetch in case cover_id is in list
                .all()
            )
            for (mid,) in extra_items:
                if mid not in cover_media_ids:
                    cover_media_ids.append(mid)
                if len(cover_media_ids) >= 4:
                    break

        # Resolve thumbnail URLs for covers
        cover_urls: list[str] = []
        if cover_media_ids:
            medias = (
                db.query(Media.thumbnail_object_key)
                .filter(Media.id.in_(cover_media_ids))
                .all()
            )
            for (key,) in medias:
                url = _presign(key)
                if url:
                    cover_urls.append(url)

        can_edit = current_user.id == album.owner_id or is_lib_editor

        result.append({
            "id": album.id,
            "name": album.name,
            "library_id": album.library_id,
            "owner_id": album.owner_id,
            "cover_id": album.cover_id,
            "item_count": item_count,
            "cover_urls": cover_urls,
            "created_at": album.created_at.isoformat() if isinstance(album.created_at, datetime) else album.created_at,
            "updated_at": album.updated_at.isoformat() if isinstance(album.updated_at, datetime) else album.updated_at,
            "can_edit": can_edit,
        })

    return {"albums": result}


# ---------------------------------------------------------------------------
# POST /api/v1/library/{library_id}/albums
# ---------------------------------------------------------------------------

@router.post("/{library_id}/albums")
def create_album(
    library_id: str,
    body: CreateAlbumBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not _has_library_edit_access(db, library_id, current_user):
        raise HTTPException(status_code=403, detail="Insufficient library access")

    album = Album(
        id=str(uuid.uuid4()),
        library_id=library_id,
        owner_id=current_user.id,
        name=body.name,
    )
    db.add(album)
    db.commit()
    db.refresh(album)
    return {"id": album.id, "name": album.name}


# ---------------------------------------------------------------------------
# GET /api/v1/library/{library_id}/subjects
# ---------------------------------------------------------------------------

@router.get("/{library_id}/subjects")
def list_subjects(
    library_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subjects = (
        db.query(Subject)
        .filter(Subject.library_id == library_id)
        .all()
    )

    # Sort: visible persons first, visible pets second, hidden last
    def subject_sort_key(s: Subject):
        if s.hidden:
            return 2
        if s.type == "person":
            return 0
        return 1  # pet

    subjects = sorted(subjects, key=subject_sort_key)

    result = []
    for subj in subjects:
        # Count detections — persons use subject_detections (face grouping);
        # pets use distinct media_ids in media_objects (object detection).
        if subj.type == "pet" and subj.pet_class:
            photo_count = (
                db.query(func.count(func.distinct(MediaObject.media_id)))
                .join(LibraryMedia, LibraryMedia.media_id == MediaObject.media_id)
                .filter(
                    LibraryMedia.library_id == library_id,
                    MediaObject.class_name.in_(subj.pet_class),
                )
                .scalar()
            ) or 0
        else:
            photo_count = (
                db.query(func.count(func.distinct(SubjectDetection.media_id)))
                .filter(SubjectDetection.subject_id == subj.id)
                .scalar()
            ) or 0

        # Determine thumbnail URL — priority order:
        # 1. Explicitly set cover media thumbnail
        # 2. Representative detection's face crop
        # 3. Fallback: any detection with a face crop key
        # 4. Fallback: representative detection's media thumbnail (+ bounding box)
        thumbnail_url: Optional[str] = None
        bounding_box: Optional[dict] = None

        if subj.cover_media_id:
            cover_media = db.query(Media).filter(Media.id == subj.cover_media_id).first()
            if cover_media:
                thumbnail_url = _presign(cover_media.thumbnail_object_key)
        elif subj.representative_detection_id is not None:
            rep = db.query(SubjectDetection).filter(
                SubjectDetection.id == subj.representative_detection_id
            ).first()
            if rep:
                if rep.face_crop_key:
                    thumbnail_url = _presign(rep.face_crop_key)
                else:
                    rep_media = db.query(Media).filter(Media.id == rep.media_id).first()
                    if rep_media:
                        thumbnail_url = _presign(rep_media.thumbnail_object_key)
                if subj.type == "person":
                    bounding_box = rep.bounding_box

        # Fallback: find any detection with a saved face crop (persons only)
        if thumbnail_url is None and subj.type == "person":
            any_crop = (
                db.query(SubjectDetection)
                .filter(
                    SubjectDetection.subject_id == subj.id,
                    SubjectDetection.face_crop_key.isnot(None),
                )
                .first()
            )
            if any_crop:
                thumbnail_url = _presign(any_crop.face_crop_key)
                bounding_box = any_crop.bounding_box

        # Fallback: pets — use thumbnail of any matching media_object in this library
        if thumbnail_url is None and subj.type == "pet" and subj.pet_class:
            any_obj = (
                db.query(MediaObject)
                .join(LibraryMedia, LibraryMedia.media_id == MediaObject.media_id)
                .filter(
                    LibraryMedia.library_id == library_id,
                    MediaObject.class_name.in_(subj.pet_class),
                )
                .first()
            )
            if any_obj:
                pet_media = db.query(Media).filter(Media.id == any_obj.media_id).first()
                if pet_media:
                    thumbnail_url = _presign(pet_media.thumbnail_object_key or pet_media.object_key)

        result.append({
            "id": subj.id,
            "name": subj.name,
            "type": subj.type,
            "hidden": subj.hidden,
            "pet_class": subj.pet_class,
            "photo_count": photo_count,
            "thumbnail_url": thumbnail_url,
            "bounding_box": bounding_box,
        })

    return {"subjects": result}


# ---------------------------------------------------------------------------
# GET /api/v1/library/{library_id}/subjects/{subject_id}/media
# ---------------------------------------------------------------------------

@router.get("/{library_id}/subjects/{subject_id}/media")
def subject_media(
    library_id: str,
    subject_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    subj = db.query(Subject).filter(
        Subject.id == subject_id,
        Subject.library_id == library_id,
    ).first()
    if not subj:
        raise HTTPException(status_code=404, detail="Subject not found")

    media_items = []

    if subj.type == "person":
        rows = (
            db.query(SubjectDetection, Media)
            .join(Media, Media.id == SubjectDetection.media_id)
            .filter(SubjectDetection.subject_id == subject_id)
            .order_by(desc(SubjectDetection.confidence))
            .all()
        )
        seen_media_ids: set[str] = set()
        for det, media in rows:
            # Skip duplicate media (multiple detections for same subject+photo after a recluster)
            if media.id in seen_media_ids:
                continue
            seen_media_ids.add(media.id)
            taken_at = media.taken_at.isoformat() if isinstance(media.taken_at, datetime) else media.taken_at
            media_items.append({
                "detection_id":     det.id,
                "media_id":         media.id,
                "original_filename": media.original_filename,
                "content_type":     media.content_type,
                "thumbnail_url":    _presign(media.thumbnail_object_key or media.object_key),
                "face_crop_url":    _presign(det.face_crop_key) if det.face_crop_key else None,
                "image_url":        _presign(media.object_key),
                "taken_at":         taken_at,
                "width":            media.width,
                "height":           media.height,
                "confidence":       det.confidence,
                "match_distance":   det.match_distance,
                "review_needed":    det.review_needed,
                "bounding_box":     det.bounding_box,
            })
    else:
        # Pet: match by pet_class via MediaObject, scoped to this library
        pet_classes = subj.pet_class or []
        if pet_classes:
            rows = (
                db.query(MediaObject, Media)
                .join(Media, Media.id == MediaObject.media_id)
                .join(LibraryMedia, LibraryMedia.media_id == Media.id)
                .filter(
                    MediaObject.class_name.in_(pet_classes),
                    LibraryMedia.library_id == library_id,
                )
                .order_by(desc(MediaObject.confidence))
                .all()
            )
            for obj, media in rows:
                taken_at = media.taken_at.isoformat() if isinstance(media.taken_at, datetime) else media.taken_at
                media_items.append({
                    "detection_id":      None,
                    "media_id":          media.id,
                    "original_filename": media.original_filename,
                    "content_type":      media.content_type,
                    "thumbnail_url":     _presign(media.thumbnail_object_key),
                    "image_url":         _presign(media.object_key),
                    "taken_at":          taken_at,
                    "width":             media.width,
                    "height":            media.height,
                    "confidence":        obj.confidence,
                    "match_distance":    None,
                    "review_needed":     False,
                    "bounding_box":      obj.bounding_box,
                })

    return {
        "subject": {
            "id":                          subj.id,
            "type":                        subj.type,
            "name":                        subj.name,
            "hidden":                      subj.hidden,
            "cover_media_id":              subj.cover_media_id,
            "representative_detection_id": subj.representative_detection_id,
        },
        "media": media_items,
    }


# ---------------------------------------------------------------------------
# GET /api/v1/library/{library_id}/favorites
# ---------------------------------------------------------------------------

@router.get("/{library_id}/favorites")
def list_favorites(
    library_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(Media)
        .join(LibraryMedia, LibraryMedia.media_id == Media.id)
        .join(UserFavorite, UserFavorite.media_id == Media.id)
        .filter(
            LibraryMedia.library_id == library_id,
            UserFavorite.user_id == current_user.id,
        )
        .all()
    )

    items = []
    for media in rows:
        taken_at = media.taken_at.isoformat() if isinstance(media.taken_at, datetime) else media.taken_at
        is_video = (media.content_type or "").startswith("video/")
        items.append({
            "id":               media.id,
            "originalFilename": media.original_filename,
            "contentType":      media.content_type,
            "width":            media.width or 0,
            "height":           media.height or 0,
            "aspectRatio":      media.aspect_ratio or 1.5,
            "isVideo":          is_video,
            "takenAt":          taken_at,
            "thumbnailSrc":     _presign(media.thumbnail_object_key),
            "src":              _presign(media.object_key) if is_video and not media.thumbnail_object_key else None,
        })

    return {"items": items}


# ---------------------------------------------------------------------------
# GET /api/v1/library/{library_id}/places
# ---------------------------------------------------------------------------

@router.get("/{library_id}/places")
def list_places(
    library_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Aggregate distinct location labels with counts from media
    rows = (
        db.query(Media.location_label, func.count(Media.id).label("count"))
        .join(LibraryMedia, LibraryMedia.media_id == Media.id)
        .filter(
            LibraryMedia.library_id == library_id,
            Media.location_label.isnot(None),
            Media.deletion_date.is_(None),
            Media.archived_at.is_(None),
        )
        .group_by(Media.location_label)
        .order_by(desc("count"))
        .all()
    )

    # Ensure Place records exist for every geocoded label (upsert by label)
    label_set = {label for label, _ in rows}
    existing_places = (
        db.query(Place)
        .filter(Place.library_id == library_id, Place.location_label.in_(label_set))
        .all()
    ) if label_set else []
    place_by_label = {p.location_label: p for p in existing_places}

    for label in label_set:
        if label not in place_by_label:
            p = Place(
                id=str(__import__("uuid").uuid4()),
                library_id=library_id,
                location_label=label,
            )
            db.add(p)
            place_by_label[label] = p
    if label_set:
        db.commit()

    result = []
    for label, count in rows:
        place = place_by_label.get(label)
        if not place:
            continue

        # Fetch up to 4 thumbnail URLs for the cover collage
        cover_media = (
            db.query(Media)
            .join(LibraryMedia, LibraryMedia.media_id == Media.id)
            .filter(
                LibraryMedia.library_id == library_id,
                Media.location_label == label,
                Media.deletion_date.is_(None),
                Media.archived_at.is_(None),
            )
            .order_by(Media.taken_at.desc())
            .limit(4)
            .all()
        )
        cover_urls = [
            url for m in cover_media
            if (url := _presign(m.thumbnail_object_key or m.object_key))
        ]

        result.append({
            "id": place.id,
            "label": place.display_name or place.location_label,
            "count": count,
            "cover_urls": cover_urls,
        })

    return {"places": result}


# ---------------------------------------------------------------------------
# PATCH /api/v1/library/{library_id}/places/{place_id}
# ---------------------------------------------------------------------------

@router.patch("/{library_id}/places/{place_id}")
def rename_place(
    library_id: str,
    place_id: str,
    body: RenamePlaceBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    place = db.query(Place).filter(
        Place.id == place_id,
        Place.library_id == library_id,
    ).first()
    if not place:
        raise HTTPException(status_code=404, detail="Place not found")

    # Setting display_name to None or empty string resets to the geocoded label
    place.display_name = body.display_name.strip() if body.display_name and body.display_name.strip() else None
    db.commit()
    return {"ok": True, "label": place.display_name or place.location_label}


# ---------------------------------------------------------------------------
# GET /api/v1/library/{library_id}/places/{place_id}/items
# ---------------------------------------------------------------------------

@router.get("/{library_id}/places/{place_id}/items")
def place_items(
    library_id: str,
    place_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    place = db.query(Place).filter(
        Place.id == place_id,
        Place.library_id == library_id,
    ).first()
    if not place:
        raise HTTPException(status_code=404, detail="Place not found")

    rows = (
        db.query(Media)
        .join(LibraryMedia, LibraryMedia.media_id == Media.id)
        .filter(
            LibraryMedia.library_id == library_id,
            Media.location_label == place.location_label,
            Media.deletion_date.is_(None),
            Media.archived_at.is_(None),
        )
        .all()
    )

    items = []
    for media in rows:
        taken_at = media.taken_at.isoformat() if isinstance(media.taken_at, datetime) else media.taken_at
        items.append({
            "id": media.id,
            "originalFilename": media.original_filename,
            "contentType": media.content_type,
            "width": media.width or 0,
            "height": media.height or 0,
            "aspectRatio": media.aspect_ratio or 1.5,
            "isVideo": (media.content_type or "").startswith("video/"),
            "takenAt": taken_at,
            "thumbnailSrc": _presign(media.thumbnail_object_key),
            "src": _presign(media.object_key),
        })

    return {
        "id": place.id,
        "label": place.display_name or place.location_label,
        "items": items,
    }


# ---------------------------------------------------------------------------
# GET /api/v1/library/{library_id}/tags
# ---------------------------------------------------------------------------

@router.get("/{library_id}/tags")
def list_tags(
    library_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tags = db.query(UserTag).filter(UserTag.library_id == library_id).all()

    result = []
    for tag in tags:
        item_count = (
            db.query(func.count(MediaTag.media_id))
            .filter(MediaTag.tag_id == tag.id)
            .scalar()
        )
        result.append({
            "id": tag.id,
            "name": tag.name,
            "color": tag.color,
            "item_count": item_count,
        })

    return {"tags": result}


# ---------------------------------------------------------------------------
# POST /api/v1/library/{library_id}/tags
# ---------------------------------------------------------------------------

@router.post("/{library_id}/tags")
def create_tag(
    library_id: str,
    body: CreateTagBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = UserTag(
        id=str(uuid.uuid4()),
        library_id=library_id,
        name=body.name,
        color=body.color,
        created_by=current_user.id,
    )
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return {"id": tag.id, "name": tag.name, "color": tag.color}


# ---------------------------------------------------------------------------
# GET /api/v1/library/{library_id}/tags/{tag_id}
# ---------------------------------------------------------------------------

@router.get("/{library_id}/tags/{tag_id}")
def get_tag(
    library_id: str,
    tag_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = db.query(UserTag).filter(
        UserTag.id == tag_id,
        UserTag.library_id == library_id,
    ).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    rows = (
        db.query(Media)
        .join(MediaTag, MediaTag.media_id == Media.id)
        .filter(MediaTag.tag_id == tag_id)
        .all()
    )

    items = []
    for media in rows:
        taken_at = media.taken_at.isoformat() if isinstance(media.taken_at, datetime) else media.taken_at
        items.append({
            "id": media.id,
            "original_filename": media.original_filename,
            "thumbnail_url": _presign(media.thumbnail_object_key),
            "image_url": _presign(media.object_key),
            "taken_at": taken_at,
        })

    return {
        "id": tag.id,
        "name": tag.name,
        "color": tag.color,
        "library_id": tag.library_id,
        "items": items,
    }


# ---------------------------------------------------------------------------
# PATCH /api/v1/library/{library_id}/tags/{tag_id}
# ---------------------------------------------------------------------------

@router.patch("/{library_id}/tags/{tag_id}")
def update_tag(
    library_id: str,
    tag_id: str,
    body: UpdateTagBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = db.query(UserTag).filter(
        UserTag.id == tag_id,
        UserTag.library_id == library_id,
    ).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    updates: dict = {}
    if body.name is not None:
        updates[UserTag.name] = body.name
    # color can be explicitly set to None to clear it; use model_fields_set to detect
    if "color" in body.model_fields_set:
        updates[UserTag.color] = body.color

    if updates:
        db.query(UserTag).filter(UserTag.id == tag_id).update(updates)
        db.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# DELETE /api/v1/library/{library_id}/tags/{tag_id}
# ---------------------------------------------------------------------------

@router.delete("/{library_id}/tags/{tag_id}")
def delete_tag(
    library_id: str,
    tag_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = db.query(UserTag).filter(
        UserTag.id == tag_id,
        UserTag.library_id == library_id,
    ).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    db.query(MediaTag).filter(MediaTag.tag_id == tag_id).delete()
    db.query(UserTag).filter(UserTag.id == tag_id).delete()
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# POST /api/v1/library/{library_id}/tags/{tag_id}/items
# ---------------------------------------------------------------------------

@router.post("/{library_id}/tags/{tag_id}/items")
def add_tag_items(
    library_id: str,
    tag_id: str,
    body: AddTagItemsBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    tag = db.query(UserTag).filter(
        UserTag.id == tag_id,
        UserTag.library_id == library_id,
    ).first()
    if not tag:
        raise HTTPException(status_code=404, detail="Tag not found")

    if body.media_ids:
        values = [
            {"tag_id": tag_id, "media_id": mid, "added_by": current_user.id}
            for mid in body.media_ids
        ]
        stmt = pg_insert(MediaTag.__table__).values(values).on_conflict_do_nothing()
        db.execute(stmt)
        db.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# DELETE /api/v1/library/{library_id}/tags/{tag_id}/items/{media_id}
# ---------------------------------------------------------------------------

@router.delete("/{library_id}/tags/{tag_id}/items/{media_id}")
def remove_tag_item(
    library_id: str,
    tag_id: str,
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    db.query(MediaTag).filter(
        MediaTag.tag_id == tag_id,
        MediaTag.media_id == media_id,
    ).delete()
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# POST /api/v1/library/{library_id}/copy-from
# ---------------------------------------------------------------------------

@router.post("/{library_id}/copy-from")
def copy_from_library(
    library_id: str,
    body: CopyFromBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not body.media_ids:
        return {"ok": True, "count": 0}

    values = [
        {"library_id": library_id, "media_id": mid}
        for mid in body.media_ids
    ]
    stmt = pg_insert(LibraryMedia.__table__).values(values).on_conflict_do_nothing()
    result = db.execute(stmt)
    db.commit()
    return {"ok": True, "count": result.rowcount}


# ---------------------------------------------------------------------------
# GET /api/v1/library/{library_id}/archive
# ---------------------------------------------------------------------------

@router.get("/{library_id}/archive")
def list_archive(
    library_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(Media)
        .join(LibraryMedia, LibraryMedia.media_id == Media.id)
        .filter(
            LibraryMedia.library_id == library_id,
            Media.archived_at.isnot(None),
            Media.deletion_date.is_(None),
        )
        .order_by(desc(Media.archived_at))
        .all()
    )

    items = []
    for media in rows:
        taken_at = media.taken_at.isoformat() if isinstance(media.taken_at, datetime) else media.taken_at
        archived_at = media.archived_at.isoformat() if isinstance(media.archived_at, datetime) else media.archived_at
        items.append({
            "id": media.id,
            "originalFilename": media.original_filename,
            "contentType": media.content_type,
            "width": media.width or 0,
            "height": media.height or 0,
            "aspectRatio": media.aspect_ratio or 1.5,
            "isVideo": (media.content_type or "").startswith("video/"),
            "takenAt": taken_at,
            "archivedAt": archived_at,
            "thumbnailSrc": _presign(media.thumbnail_object_key),
            "src": _presign(media.object_key),
        })

    return {"items": items}


# ---------------------------------------------------------------------------
# GET /api/v1/library/{library_id}/private
# ---------------------------------------------------------------------------

@router.get("/{library_id}/private")
def list_private(
    library_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(Media)
        .join(LibraryMedia, LibraryMedia.media_id == Media.id)
        .filter(
            LibraryMedia.library_id == library_id,
            Media.is_private.is_(True),
            Media.deletion_date.is_(None),
        )
        .order_by(desc(Media.taken_at), desc(Media.created_at))
        .all()
    )

    items = []
    for media in rows:
        taken_at = media.taken_at.isoformat() if isinstance(media.taken_at, datetime) else media.taken_at
        items.append({
            "id": media.id,
            "originalFilename": media.original_filename,
            "contentType": media.content_type,
            "width": media.width or 0,
            "height": media.height or 0,
            "aspectRatio": media.aspect_ratio or 1.5,
            "isVideo": (media.content_type or "").startswith("video/"),
            "takenAt": taken_at,
            "thumbnailSrc": _presign(media.thumbnail_object_key),
            "src": _presign(media.object_key) if (media.content_type or "").startswith("video/") and not media.thumbnail_object_key else None,
        })

    return {"items": items}


# ---------------------------------------------------------------------------
# GET /api/v1/library/{library_id}/trash
# ---------------------------------------------------------------------------

@router.get("/{library_id}/trash")
def list_trash(
    library_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    rows = (
        db.query(Media)
        .join(LibraryMedia, LibraryMedia.media_id == Media.id)
        .filter(
            LibraryMedia.library_id == library_id,
            Media.deletion_date.isnot(None),
        )
        .order_by(Media.deletion_date)
        .all()
    )

    items = []
    for media in rows:
        taken_at = media.taken_at.isoformat() if isinstance(media.taken_at, datetime) else media.taken_at
        deletion_date = (
            media.deletion_date.isoformat()
            if isinstance(media.deletion_date, datetime)
            else media.deletion_date
        )
        items.append({
            "id": media.id,
            "originalFilename": media.original_filename,
            "contentType": media.content_type,
            "width": media.width or 0,
            "height": media.height or 0,
            "aspectRatio": media.aspect_ratio or 1.5,
            "isVideo": (media.content_type or "").startswith("video/"),
            "takenAt": taken_at,
            "deletionDate": deletion_date,
            "thumbnailSrc": _presign(media.thumbnail_object_key),
            "src": _presign(media.object_key),
        })

    return {"items": items}
