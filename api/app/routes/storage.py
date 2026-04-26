"""Storage health/stats routes."""
from fastapi import APIRouter, Depends
from sqlalchemy import func, and_
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.dependencies import get_admin_user, get_current_user
from app.models.media import Media
from app.models.user import User
from app.storage.s3 import get_s3_client

router = APIRouter()


@router.get("/health")
def storage_health(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    client = get_s3_client()
    try:
        client.list_objects_v2(Bucket=settings.storage_bucket_name, MaxKeys=1)
        ok = True
    except Exception:
        ok = False

    return {
        "ok": ok,
        "bucket": settings.storage_bucket_name,
        "endpoint": settings.storage_endpoint,
    }


@router.get("/stats")
def storage_stats(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    # Total active (not deleted, not archived)
    active_q = db.query(
        func.count(Media.id).label("count"),
        func.coalesce(func.sum(Media.size), 0).label("bytes"),
    ).filter(
        Media.deletion_date.is_(None),
        Media.archived_at.is_(None),
    ).one()

    # By content type prefix
    all_media = db.query(Media.content_type, Media.size).filter(
        Media.deletion_date.is_(None),
    ).all()

    by_type: dict[str, int] = {"image": 0, "video": 0, "other": 0}
    for row in all_media:
        if row.content_type.startswith("image/"):
            by_type["image"] += 1
        elif row.content_type.startswith("video/"):
            by_type["video"] += 1
        else:
            by_type["other"] += 1

    # By year (using taken_at or created_at)
    all_dates = db.query(Media.taken_at, Media.created_at).filter(
        Media.deletion_date.is_(None),
    ).all()

    by_year: dict[str, int] = {}
    for row in all_dates:
        dt = row.taken_at or row.created_at
        if dt:
            yr = str(dt.year)
            by_year[yr] = by_year.get(yr, 0) + 1

    archived_count = db.query(func.count(Media.id)).filter(
        Media.archived_at.isnot(None),
        Media.deletion_date.is_(None),
    ).scalar()

    return {
        "total_count": active_q.count,
        "total_bytes": active_q.bytes,
        "by_type": by_type,
        "by_year": dict(sorted(by_year.items())),
        "archived_count": archived_count,
    }
