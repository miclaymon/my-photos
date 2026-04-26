"""Album routes — mirrors Nitro /api/v1/albums/* endpoints."""
from typing import Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import and_, func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_current_user
from app.models.album import Album, AlbumItem
from app.models.media import Media
from app.models.user import User
from app.storage.s3 import generate_presigned_download_url

router = APIRouter()


# ---------------------------------------------------------------------------
# Request body schemas
# ---------------------------------------------------------------------------

class UpdateAlbumBody(BaseModel):
    name: Optional[str] = None
    cover_id: Optional[str] = None


class AddItemsBody(BaseModel):
    media_ids: list[str]


class UpdateItemBody(BaseModel):
    caption: Optional[str] = None
    sort_order: Optional[int] = None


class ReorderItemEntry(BaseModel):
    media_id: str
    sort_order: int


class ReorderBody(BaseModel):
    items: list[ReorderItemEntry]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _get_album_or_404(album_id: str, db: Session) -> Album:
    album = db.query(Album).filter(Album.id == album_id).first()
    if not album or album.deleted_at is not None:
        raise HTTPException(status_code=404, detail="Album not found")
    return album


def _safe_presigned(key: Optional[str]) -> Optional[str]:
    if not key:
        return None
    try:
        return generate_presigned_download_url(key)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/{album_id}")
def get_album(
    album_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    album = _get_album_or_404(album_id, db)

    # Fetch album items joined with media, ordered by sort_order
    rows = (
        db.query(AlbumItem, Media)
        .join(Media, Media.id == AlbumItem.media_id)
        .filter(AlbumItem.album_id == album_id)
        .order_by(AlbumItem.sort_order)
        .all()
    )

    items = []
    cover_thumbnail_url: Optional[str] = None
    for item, media in rows:
        thumbnail_url = _safe_presigned(media.thumbnail_object_key or media.object_key)
        image_url = _safe_presigned(media.object_key)
        if album.cover_id == media.id:
            cover_thumbnail_url = thumbnail_url
        items.append({
            "id": item.id,
            "media_id": item.media_id,
            "sort_order": item.sort_order,
            "caption": item.caption,
            "thumbnail_url": thumbnail_url,
            "image_url": image_url,
            "original_filename": media.original_filename,
            "content_type": media.content_type,
            "width": media.width,
            "height": media.height,
            "aspect_ratio": media.aspect_ratio,
            "duration_seconds": media.duration_seconds,
            "taken_at": media.taken_at.isoformat() if media.taken_at else None,
        })

    # Fall back to first item thumbnail as cover if cover_id not found in items
    if not cover_thumbnail_url and items:
        cover_thumbnail_url = items[0]["thumbnail_url"]

    can_edit = album.owner_id == current_user.id or current_user.is_admin

    return {
        "id": album.id,
        "name": album.name,
        "library_id": album.library_id,
        "owner_id": album.owner_id,
        "cover_id": album.cover_id,
        "cover_url": cover_thumbnail_url,
        "can_edit": can_edit,
        "created_at": album.created_at.isoformat() if album.created_at else None,
        "updated_at": album.updated_at.isoformat() if album.updated_at else None,
        "items": items,
    }


@router.patch("/{album_id}")
def update_album(
    album_id: str,
    body: UpdateAlbumBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    album = _get_album_or_404(album_id, db)

    if body.name is not None:
        album.name = body.name
    if body.cover_id is not None:
        album.cover_id = body.cover_id

    db.commit()
    return {"ok": True}


@router.delete("/{album_id}")
def delete_album(
    album_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Look up the album without filtering deleted_at so this endpoint is
    # idempotent — re-deleting an already-soft-deleted album returns 200.
    album = db.query(Album).filter(Album.id == album_id).first()
    if not album:
        raise HTTPException(status_code=404, detail="Album not found")

    if album.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Forbidden")

    if album.deleted_at is None:
        album.deleted_at = datetime.now(timezone.utc)
        db.commit()
    return {"ok": True}


@router.post("/{album_id}/items")
def add_items(
    album_id: str,
    body: AddItemsBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_album_or_404(album_id, db)

    added = 0
    for media_id in body.media_ids:
        # Determine current max sort_order
        max_order = db.query(func.max(AlbumItem.sort_order)).filter(
            AlbumItem.album_id == album_id
        ).scalar()
        next_order = (max_order + 1) if max_order is not None else 0

        stmt = (
            pg_insert(AlbumItem.__table__)
            .values(
                album_id=album_id,
                media_id=media_id,
                sort_order=next_order,
            )
            .on_conflict_do_nothing()
        )
        result = db.execute(stmt)
        if result.rowcount:
            added += 1

    db.commit()
    return {"ok": True, "added": added}


@router.patch("/{album_id}/items/{media_id}")
def update_item(
    album_id: str,
    media_id: str,
    body: UpdateItemBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_album_or_404(album_id, db)

    updates: dict = {}
    if body.caption is not None:
        updates["caption"] = body.caption
    if body.sort_order is not None:
        updates["sort_order"] = body.sort_order

    if updates:
        db.query(AlbumItem).filter(
            and_(AlbumItem.album_id == album_id, AlbumItem.media_id == media_id)
        ).update(updates)
        db.commit()

    return {"ok": True}


@router.delete("/{album_id}/items/{media_id}")
def remove_item(
    album_id: str,
    media_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_album_or_404(album_id, db)

    db.query(AlbumItem).filter(
        and_(AlbumItem.album_id == album_id, AlbumItem.media_id == media_id)
    ).delete()
    db.commit()
    return {"ok": True}


@router.post("/{album_id}/reorder")
def reorder_items(
    album_id: str,
    body: ReorderBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    _get_album_or_404(album_id, db)

    for entry in body.items:
        db.query(AlbumItem).filter(
            and_(AlbumItem.album_id == album_id, AlbumItem.media_id == entry.media_id)
        ).update({"sort_order": entry.sort_order})

    db.commit()
    return {"ok": True}
