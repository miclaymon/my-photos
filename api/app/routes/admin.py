"""Admin-only routes."""
import hashlib
import uuid as uuid_module
from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import get_admin_user
from app.models.job import BackgroundJob, JOB_TYPES
from app.models.album import AlbumItem
from app.models.library import Library, LibraryAccess, LibraryMedia, ShareLink
from app.models.media import DeletedItem, Media, MediaObject, MediaOcr
from app.models.subject import Subject, SubjectDetection
from app.models.tag import MediaTag, UserFavorite
from app.models.user import User
from app.storage.s3 import delete_object, generate_presigned_download_url, get_s3_client
from app.cache import clear_all as cache_clear_all, invalidate_key as cache_invalidate_key, list_entries as cache_list_entries
from app.config import settings
from app.worker_config import get_config, update_config

router = APIRouter()


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------

class RunJobBody(BaseModel):
    job: str
    library_id: Optional[str] = None
    reprocess: bool = False


class ResetSubjectsBody(BaseModel):
    library_id: Optional[str] = None
    what: str  # 'processing' | 'detections' | 'all'


class PatchMediaBody(BaseModel):
    original_filename: Optional[str] = None
    taken_at: Optional[str] = None  # ISO string or null
    width: Optional[int] = None
    height: Optional[int] = None
    aspect_ratio: Optional[float] = None


class DeleteLibraryBody(BaseModel):
    mark_orphans_for_deletion: bool = False
    delete_orphans_immediately: bool = False


class GrantAccessBody(BaseModel):
    email: str
    role: str  # 'owner' | 'editor' | 'viewer'


class ChangeAccessRoleBody(BaseModel):
    role: str


class BucketDeleteBody(BaseModel):
    key: str
    delete_db_record: bool = False


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _delete_media_rows(db: Session, media_id: str) -> None:
    """Delete all satellite DB rows for a media item (the Media row itself is NOT deleted here)."""
    db.query(BackgroundJob).filter(BackgroundJob.media_id == media_id).delete()
    db.query(AlbumItem).filter(AlbumItem.media_id == media_id).delete()
    db.query(DeletedItem).filter(DeletedItem.media_id == media_id).delete()
    db.query(MediaTag).filter(MediaTag.media_id == media_id).delete()
    db.query(UserFavorite).filter(UserFavorite.media_id == media_id).delete()
    db.query(SubjectDetection).filter(SubjectDetection.media_id == media_id).delete()
    db.query(MediaObject).filter(MediaObject.media_id == media_id).delete()
    db.query(MediaOcr).filter(MediaOcr.media_id == media_id).delete()
    db.query(LibraryMedia).filter(LibraryMedia.media_id == media_id).delete()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/overview")
def overview(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    # ── Build user lookup ─────────────────────────────────────────────────────
    all_users = db.query(User).all()
    user_map: dict[int, str] = {u.id: u.email for u in all_users}

    # ── Libraries (full dict, used for both media associations and lib list) ──
    all_libs = db.query(Library).all()
    lib_lookup: dict[str, Library] = {lib.id: lib for lib in all_libs}

    # ── Media (most recent 200, with associations) ────────────────────────────
    media_rows = db.query(Media).order_by(Media.created_at.desc()).limit(200).all()
    media_ids = [m.id for m in media_rows]

    # Batch-load library memberships for those media
    lm_rows = (
        db.query(LibraryMedia).filter(LibraryMedia.media_id.in_(media_ids)).all()
        if media_ids else []
    )
    media_libraries: dict[str, list] = {}
    for lm in lm_rows:
        lib = lib_lookup.get(lm.library_id)
        if lib:
            media_libraries.setdefault(lm.media_id, []).append(
                {"id": lib.id, "name": lib.name, "type": lib.type}
            )

    media_list = []
    for m in media_rows:
        thumb_key = m.thumbnail_object_key or m.object_key
        try:
            thumb_url = generate_presigned_download_url(thumb_key) if thumb_key else None
        except Exception:
            thumb_url = None
        try:
            src_url = generate_presigned_download_url(m.object_key) if m.object_key else None
        except Exception:
            src_url = None
        media_list.append({
            "id": m.id,
            "object_key": m.object_key,
            "original_filename": m.original_filename,
            "content_type": m.content_type,
            "size": m.size,
            "width": m.width,
            "height": m.height,
            "aspect_ratio": m.aspect_ratio,
            "taken_at": m.taken_at.isoformat() if m.taken_at else None,
            "created_at": m.created_at.isoformat() if m.created_at else None,
            "uploader_email": user_map.get(m.uploaded_by),
            "src": src_url,
            "thumbnail_src": thumb_url,
            "libraries": media_libraries.get(m.id, []),
        })

    # ── Libraries with access grants + share links ────────────────────────────
    all_access = db.query(LibraryAccess).all()
    all_links = db.query(ShareLink).all()

    lib_access: dict[str, list] = {}
    for a in all_access:
        lib_access.setdefault(a.library_id, []).append({
            "user_id": a.user_id,
            "email": user_map.get(a.user_id, ""),
            "role": a.role,
            "added_at": a.added_at.isoformat() if a.added_at else None,
        })

    lib_links: dict[str, list] = {}
    for lnk in all_links:
        lib_links.setdefault(lnk.library_id, []).append({
            "id": lnk.id,
            "album_id": lnk.album_id,
            "media_ids": lnk.media_ids,
            "created_by_email": user_map.get(lnk.created_by),
            "expires_at": lnk.expires_at.isoformat() if lnk.expires_at else None,
            "last_used_at": lnk.last_used_at.isoformat() if lnk.last_used_at else None,
            "revoked_at": lnk.revoked_at.isoformat() if lnk.revoked_at else None,
            "created_at": lnk.created_at.isoformat(),
        })

    lib_list = []
    for lib in all_libs:
        lib_list.append({
            "id": lib.id,
            "name": lib.name,
            "type": lib.type,
            "owner_id": lib.owner_id,
            "owner_email": user_map.get(lib.owner_id) if lib.owner_id else None,
            "created_at": lib.created_at.isoformat() if lib.created_at else None,
            "access": lib_access.get(lib.id, []),
            "share_links": lib_links.get(lib.id, []),
        })

    return {
        "counts": {
            "db_media": db.query(func.count(Media.id)).scalar(),
            "db_libraries": len(lib_list),
        },
        "media": media_list,
        "libraries": lib_list,
    }


@router.get("/bucket-objects")
def list_bucket_objects(
    current_user: User = Depends(get_admin_user),
):
    """List up to 1 000 objects in the storage bucket with presigned download URLs."""
    bucket_objects: list = []
    try:
        s3 = get_s3_client()
        resp = s3.list_objects_v2(Bucket=settings.storage_bucket_name, MaxKeys=1000)
        for obj in resp.get("Contents", []):
            key = obj["Key"]
            try:
                src = generate_presigned_download_url(key, expires_in=3600)
            except Exception:
                src = None
            bucket_objects.append({
                "key": key,
                "size": obj.get("Size", 0),
                "last_modified": obj["LastModified"].isoformat() if "LastModified" in obj else None,
                "src": src,
            })
    except Exception:
        pass  # storage unreachable — return empty list

    return {"bucket_objects": bucket_objects, "count": len(bucket_objects)}


@router.post("/cleanup")
def cleanup(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    now = datetime.now(timezone.utc)
    expired = db.query(Media).filter(
        Media.deletion_date.isnot(None),
        Media.deletion_date <= now,
    ).all()

    processed = 0
    failed = 0
    for m in expired:
        try:
            for key in [m.object_key, m.thumbnail_object_key, m.preview_object_key]:
                if key:
                    try:
                        delete_object(key)
                    except Exception:
                        pass
            _delete_media_rows(db, m.id)
            db.delete(m)
            db.commit()
            processed += 1
        except Exception:
            db.rollback()
            failed += 1

    return {"processed": processed, "failed": failed}


@router.get("/jobs/status")
def job_status(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """Return per-type queue counts scoped to the latest batch for each job type."""
    display_types = [t for t in JOB_TYPES if t != "deduplication"]
    result: dict = {}

    for job_type in display_types:
        # Find the latest batch_id for this type (most recently created job with a batch)
        latest_batch: str | None = (
            db.query(BackgroundJob.batch_id)
            .filter(
                BackgroundJob.type == job_type,
                BackgroundJob.batch_id.isnot(None),
            )
            .order_by(BackgroundJob.created_at.desc())
            .limit(1)
            .scalar()
        )

        if latest_batch:
            rows = (
                db.query(BackgroundJob.status, func.count(BackgroundJob.id))
                .filter(
                    BackgroundJob.type == job_type,
                    BackgroundJob.batch_id == latest_batch,
                )
                .group_by(BackgroundJob.status)
                .all()
            )
            counts: dict[str, int] = {"pending": 0, "running": 0, "completed": 0, "failed": 0}
            for status, count in rows:
                if status in counts:
                    counts[status] = count

            last_failed = (
                db.query(BackgroundJob)
                .filter(
                    BackgroundJob.type == job_type,
                    BackgroundJob.batch_id == latest_batch,
                    BackgroundJob.status == "failed",
                    BackgroundJob.error.isnot(None),
                )
                .order_by(BackgroundJob.completed_at.desc())
                .first()
            )
        else:
            counts = {"pending": 0, "running": 0, "completed": 0, "failed": 0}
            last_failed = None

        result[job_type] = {
            **counts,
            "last_error": last_failed.error if last_failed else None,
            "batch_id": latest_batch,
        }

    return {"jobs": result}


@router.post("/jobs/run")
def run_job(
    body: RunJobBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """Enqueue (or re-enqueue) background jobs for all eligible media items.

    Uses a deterministic job_id (SHA-256 of "{media_id}:{job_type}") so that
    re-enqueueing is an upsert: pending/failed/completed jobs get reset to the
    new batch; running jobs are left alone.
    """
    user_runnable = {"object_detection", "face_grouping", "ocr", "location_geocode", "barcode"}
    if body.job not in user_runnable:
        raise HTTPException(status_code=400, detail=f"Unknown job type: {body.job!r}")

    processed_col_map = {
        "object_detection": Media.objects_processed_at,
        "face_grouping":    Media.faces_processed_at,
        "ocr":              Media.ocr_processed_at,
        "location_geocode": Media.location_processed_at,
    }
    processed_col = processed_col_map.get(body.job)

    # Build the media candidate query
    q = db.query(Media.id)
    if body.library_id:
        q = q.join(LibraryMedia, LibraryMedia.media_id == Media.id).filter(
            LibraryMedia.library_id == body.library_id
        )

    # Without reprocess, only target unprocessed media
    if not body.reprocess and processed_col is not None:
        q = q.filter(processed_col.is_(None))

    media_ids = [r[0] for r in q.all()]
    if not media_ids:
        return {"enqueued": 0}

    # When reprocessing, clear the processed_at timestamp so workers don't
    # short-circuit their own idempotency checks and skip the item.
    if body.reprocess and processed_col is not None:
        db.query(Media).filter(Media.id.in_(media_ids)).update(
            {processed_col: None}, synchronize_session=False
        )

    # All jobs in this enqueue action share a single batch_id
    batch_id = str(uuid_module.uuid4())

    rows = [
        {
            "media_id":     mid,
            "type":         body.job,
            "status":       "pending",
            "batch_id":     batch_id,
            "job_id":       hashlib.sha256(f"{mid}:{body.job}".encode()).hexdigest(),
            "error":        None,
            "started_at":   None,
            "completed_at": None,
        }
        for mid in media_ids
    ]

    stmt = pg_insert(BackgroundJob.__table__).values(rows)
    stmt = stmt.on_conflict_do_update(
        index_elements=["job_id"],
        set_={
            "batch_id":     stmt.excluded.batch_id,
            "status":       "pending",
            "error":        None,
            "started_at":   None,
            "completed_at": None,
        },
        # Leave running jobs alone — the WHERE condition refers to the existing row
        where=(BackgroundJob.__table__.c.status != "running"),
    )
    db.execute(stmt)
    db.commit()

    return {"enqueued": len(media_ids), "batch_id": batch_id}


@router.delete("/jobs/pending")
def delete_pending_jobs(
    job_type: Optional[str] = Query(None, description="Job type to delete; omit for all types"),
    library_id: Optional[str] = Query(None, description="Scope to a specific library"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """Delete all pending (not running) jobs, optionally scoped by type and library."""
    q = db.query(BackgroundJob).filter(BackgroundJob.status == "pending")

    if job_type:
        q = q.filter(BackgroundJob.type == job_type)

    if library_id:
        media_in_library = [
            r.media_id for r in db.query(LibraryMedia.media_id).filter(
                LibraryMedia.library_id == library_id
            ).all()
        ]
        q = q.filter(BackgroundJob.media_id.in_(media_in_library))

    deleted = q.delete(synchronize_session=False)
    db.commit()
    return {"deleted": deleted}


@router.get("/jobs/recent")
def recent_jobs(
    limit: int = Query(100, le=500),
    job_type: Optional[str] = Query(None),
    library_id: Optional[str] = Query(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """Return the most recent BackgroundJob records with timing info."""
    q = db.query(BackgroundJob).order_by(BackgroundJob.created_at.desc())

    if job_type:
        q = q.filter(BackgroundJob.type == job_type)

    if library_id:
        media_in_library = [
            r.media_id for r in db.query(LibraryMedia.media_id).filter(
                LibraryMedia.library_id == library_id
            ).all()
        ]
        q = q.filter(BackgroundJob.media_id.in_(media_in_library))

    jobs = q.limit(limit).all()

    def duration_ms(job: BackgroundJob) -> int | None:
        if job.started_at and job.completed_at:
            return int((job.completed_at - job.started_at).total_seconds() * 1000)
        return None

    return {
        "jobs": [
            {
                "id":           j.id,
                "type":         j.type,
                "status":       j.status,
                "media_id":     j.media_id,
                "error":        j.error,
                "batch_id":     j.batch_id,
                "created_at":   j.created_at.isoformat() if j.created_at else None,
                "started_at":   j.started_at.isoformat() if j.started_at else None,
                "completed_at": j.completed_at.isoformat() if j.completed_at else None,
                "duration_ms":  duration_ms(j),
            }
            for j in jobs
        ]
    }


@router.post("/subjects/reset")
def reset_subjects(
    body: ResetSubjectsBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    what = body.what
    library_id = body.library_id
    counts: dict[str, int] = {}

    if what in ("processing", "all"):
        q = db.query(Media)
        if library_id:
            q = q.join(LibraryMedia, LibraryMedia.media_id == Media.id).filter(
                LibraryMedia.library_id == library_id
            )
        n = q.update({
            Media.objects_processed_at:  None,
            Media.faces_processed_at:    None,
            Media.ocr_processed_at:      None,
            Media.location_processed_at: None,
        }, synchronize_session=False)
        counts["cleared_timestamps"] = n

    if what in ("detections", "all"):
        if library_id:
            media_ids = [
                r.media_id for r in db.query(LibraryMedia.media_id).filter(
                    LibraryMedia.library_id == library_id
                ).all()
            ]
            nd = db.query(SubjectDetection).filter(
                SubjectDetection.media_id.in_(media_ids)
            ).delete(synchronize_session=False)
            ns = db.query(Subject).filter(Subject.library_id == library_id).delete()
        else:
            nd = db.query(SubjectDetection).delete()
            ns = db.query(Subject).delete()
        counts["deleted_detections"] = nd
        counts["deleted_subjects"] = ns

    db.commit()
    return {"ok": True, "counts": counts}


@router.post("/subjects/recluster")
def recluster_subjects(
    library_id: str = Query(None, description="Library ID to scope re-clustering; omit for all libraries"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    """Merge person subjects whose face embeddings are within cluster_threshold of each other.

    For subjects with avg_descriptor=null, computes a representative descriptor from
    their individual SubjectDetection records. Useful after adjusting thresholds that
    were previously too strict, causing each face to get its own subject.
    """
    try:
        import numpy as np  # noqa: PLC0415
    except ImportError:
        raise HTTPException(status_code=500, detail="numpy not available")

    from collections import defaultdict  # noqa: PLC0415
    from app.worker_config import get_section  # noqa: PLC0415
    cfg = get_section("face_detection") or {}
    CLUSTER_THRESH = float(cfg.get("cluster_threshold", 1.10))

    # Load ALL person subjects (scoped to library if provided)
    q = db.query(Subject).filter(Subject.type == "person")
    if library_id:
        q = q.filter(Subject.library_id == library_id)
    all_subjects = q.all()
    total = len(all_subjects)

    # Build effective descriptor for each subject — prefer avg_descriptor,
    # fall back to mean of individual SubjectDetection.descriptor values.
    def _effective_descriptor(subj: Subject) -> list | None:
        if subj.avg_descriptor:
            return subj.avg_descriptor
        dets = (
            db.query(SubjectDetection)
            .filter(
                SubjectDetection.subject_id == subj.id,
                SubjectDetection.descriptor.isnot(None),
            )
            .all()
        )
        raw = [np.array(d.descriptor, dtype=np.float32) for d in dets if d.descriptor]
        if not raw:
            return None
        return np.mean(raw, axis=0).tolist()

    # Only subjects where we can compute a descriptor participate in clustering
    usable = [(s, _effective_descriptor(s)) for s in all_subjects]
    usable = [(s, d) for s, d in usable if d is not None]
    no_descriptor_count = total - len(usable)

    if len(usable) < 2:
        return {
            "ok": True,
            "merged": 0,
            "remaining": total,
            "total_subjects": total,
            "usable_for_clustering": len(usable),
            "no_descriptor": no_descriptor_count,
            "cluster_threshold": CLUSTER_THRESH,
        }

    n = len(usable)
    subj_list = [s for s, _ in usable]
    ids = [s.id for s in subj_list]

    # L2-normalise descriptors
    descs = np.array([d for _, d in usable], dtype=np.float32)
    norms = np.linalg.norm(descs, axis=1, keepdims=True) + 1e-6
    descs = descs / norms

    # Union-find (path-compressed)
    parent = list(range(n))

    def _find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def _union(x: int, y: int) -> None:
        px, py = _find(x), _find(y)
        if px != py:
            parent[px] = py

    # Record closest distances for diagnostics
    min_dist = float("inf")
    max_dist = 0.0
    pairs_within_thresh = 0

    for i in range(n):
        for j in range(i + 1, n):
            diff = descs[i] - descs[j]
            dist = float(np.linalg.norm(diff))
            min_dist = min(min_dist, dist)
            max_dist = max(max_dist, dist)
            if dist < CLUSTER_THRESH:
                pairs_within_thresh += 1
                _union(i, j)

    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(n):
        groups[_find(i)].append(i)

    merged_count = 0
    for members in groups.values():
        if len(members) < 2:
            continue

        det_counts = {
            idx: db.query(SubjectDetection)
                   .filter(SubjectDetection.subject_id == ids[idx])
                   .count()
            for idx in members
        }
        primary_idx = max(members, key=lambda i: det_counts[i])
        secondary_idxs = [i for i in members if i != primary_idx]
        primary_id = ids[primary_idx]
        primary_subj = db.query(Subject).filter(Subject.id == primary_id).first()

        for sec_idx in secondary_idxs:
            sec_id = ids[sec_idx]
            sec_subj = db.query(Subject).filter(Subject.id == sec_id).first()

            db.query(SubjectDetection).filter(SubjectDetection.subject_id == sec_id).update(
                {SubjectDetection.subject_id: primary_id}, synchronize_session=False
            )

            if primary_subj and not primary_subj.name and sec_subj and sec_subj.name:
                primary_subj.name = sec_subj.name

            if (primary_subj and not primary_subj.representative_detection_id
                    and sec_subj and sec_subj.representative_detection_id):
                primary_subj.representative_detection_id = sec_subj.representative_detection_id

            db.query(Subject).filter(Subject.id == sec_id).delete()
            merged_count += 1

        # Recompute avg_descriptor from all detections now assigned to primary
        all_dets = (
            db.query(SubjectDetection)
            .filter(SubjectDetection.subject_id == primary_id, SubjectDetection.descriptor.isnot(None))
            .all()
        )
        raw_descs = [np.array(d.descriptor, dtype=np.float32) for d in all_dets if d.descriptor]
        if raw_descs and primary_subj:
            primary_subj.avg_descriptor = np.mean(raw_descs, axis=0).tolist()

    db.commit()

    rq = db.query(Subject).filter(Subject.type == "person")
    if library_id:
        rq = rq.filter(Subject.library_id == library_id)
    remaining = rq.count()

    return {
        "ok": True,
        "merged": merged_count,
        "remaining": remaining,
        "total_subjects": total,
        "usable_for_clustering": n,
        "no_descriptor": no_descriptor_count,
        "cluster_threshold": CLUSTER_THRESH,
        "pairs_within_threshold": pairs_within_thresh,
        "min_distance": round(min_dist, 4) if min_dist != float("inf") else None,
        "max_distance": round(max_dist, 4),
    }


@router.patch("/media/{media_id}")
def patch_media(
    media_id: str,
    body: PatchMediaBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    m = db.query(Media).filter(Media.id == media_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")

    if body.original_filename is not None:
        m.original_filename = body.original_filename
    if body.taken_at is not None:
        m.taken_at = datetime.fromisoformat(body.taken_at)
    if body.width is not None:
        m.width = body.width
    if body.height is not None:
        m.height = body.height
    if body.aspect_ratio is not None:
        m.aspect_ratio = body.aspect_ratio

    db.commit()
    return {"ok": True}


@router.delete("/media/{media_id}")
def delete_media(
    media_id: str,
    delete_objects: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    m = db.query(Media).filter(Media.id == media_id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Media not found")

    if delete_objects:
        for key in [m.object_key, m.thumbnail_object_key, m.preview_object_key]:
            if key:
                try:
                    delete_object(key)
                except Exception:
                    pass

    _delete_media_rows(db, media_id)
    db.delete(m)
    db.commit()
    return {"ok": True}


@router.delete("/library/{library_id}")
def delete_library(
    library_id: str,
    body: DeleteLibraryBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    lib = db.query(Library).filter(Library.id == library_id).first()
    if not lib:
        raise HTTPException(status_code=404, detail="Library not found")

    # Find orphan media — in this library but no other
    media_in_lib = {
        r.media_id for r in db.query(LibraryMedia.media_id).filter(
            LibraryMedia.library_id == library_id
        ).all()
    }
    orphans = [
        mid for mid in media_in_lib
        if db.query(func.count(LibraryMedia.media_id)).filter(
            LibraryMedia.media_id == mid,
            LibraryMedia.library_id != library_id,
        ).scalar() == 0
    ]

    if body.delete_orphans_immediately:
        for mid in orphans:
            m = db.query(Media).filter(Media.id == mid).first()
            if m:
                for key in [m.object_key, m.thumbnail_object_key, m.preview_object_key]:
                    if key:
                        try:
                            delete_object(key)
                        except Exception:
                            pass
                _delete_media_rows(db, mid)
                db.delete(m)
    elif body.mark_orphans_for_deletion:
        cutoff = datetime.now(timezone.utc) + timedelta(days=30)
        db.query(Media).filter(Media.id.in_(orphans)).update(
            {Media.deletion_date: cutoff}, synchronize_session=False
        )

    db.query(LibraryMedia).filter(LibraryMedia.library_id == library_id).delete()
    db.query(LibraryAccess).filter(LibraryAccess.library_id == library_id).delete()
    db.delete(lib)
    db.commit()
    return {"ok": True, "orphans_affected": len(orphans)}


@router.post("/library/{library_id}/access")
def grant_access(
    library_id: str,
    body: GrantAccessBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    user = db.query(User).filter(User.email == body.email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    existing = db.query(LibraryAccess).filter(
        LibraryAccess.library_id == library_id,
        LibraryAccess.user_id == user.id,
    ).first()
    if existing:
        existing.role = body.role
    else:
        db.add(LibraryAccess(library_id=library_id, user_id=user.id, role=body.role))

    db.commit()
    return {"ok": True}


@router.patch("/library/{library_id}/access/{user_id}")
def change_access_role(
    library_id: str,
    user_id: int,
    body: ChangeAccessRoleBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    access = db.query(LibraryAccess).filter(
        LibraryAccess.library_id == library_id,
        LibraryAccess.user_id == user_id,
    ).first()
    if not access:
        raise HTTPException(status_code=404, detail="Access grant not found")

    access.role = body.role
    db.commit()
    return {"ok": True}


@router.delete("/library/{library_id}/access/{user_id}")
def revoke_access(
    library_id: str,
    user_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    db.query(LibraryAccess).filter(
        LibraryAccess.library_id == library_id,
        LibraryAccess.user_id == user_id,
    ).delete()
    db.commit()
    return {"ok": True}


@router.post("/share-links/{link_id}/revoke")
def revoke_share_link(
    link_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    link = db.query(ShareLink).filter(ShareLink.id == link_id).first()
    if not link:
        raise HTTPException(status_code=404, detail="Share link not found")
    link.revoked_at = datetime.now(timezone.utc)
    db.commit()
    return {"ok": True}


@router.post("/bucket/delete")
def delete_bucket_object(
    body: BucketDeleteBody,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_admin_user),
):
    try:
        delete_object(body.key)
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Storage error: {e}")

    if body.delete_db_record:
        m = db.query(Media).filter(Media.object_key == body.key).first()
        if m:
            _delete_media_rows(db, m.id)
            db.delete(m)
            db.commit()

    return {"ok": True}


# ---------------------------------------------------------------------------
# Worker config
# ---------------------------------------------------------------------------

@router.get("/worker-config")
def get_worker_config(current_user: User = Depends(get_admin_user)):
    """Return the current worker_config.json contents."""
    return get_config()


# ---------------------------------------------------------------------------
# Response cache admin
# ---------------------------------------------------------------------------

@router.get("/cache")
def get_cache_entries(current_user: User = Depends(get_admin_user)):
    """Return metadata for all current response-cache entries."""
    entries = cache_list_entries(settings.cache_db_path)
    return {"entries": entries, "total": len(entries)}


@router.delete("/cache")
def clear_cache(current_user: User = Depends(get_admin_user)):
    """Wipe all response-cache entries."""
    deleted = cache_clear_all(settings.cache_db_path)
    return {"deleted": deleted}


@router.delete("/cache/{key}")
def delete_cache_entry(key: str, current_user: User = Depends(get_admin_user)):
    """Remove a single cache entry by its SHA-256 key."""
    cache_invalidate_key(settings.cache_db_path, key)
    return {"ok": True}


@router.patch("/worker-config")
def patch_worker_config(
    patch: dict,
    current_user: User = Depends(get_admin_user),
):
    """Merge patch into worker_config.json and write it back atomically."""
    try:
        updated = update_config(patch)
    except (ValueError, KeyError) as e:
        raise HTTPException(status_code=400, detail=str(e))
    return updated
