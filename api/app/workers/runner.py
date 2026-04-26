"""Background job dispatcher.

Polls the background_jobs table for pending jobs and dispatches them to the
appropriate worker. Designed to run as a long-lived process alongside the API
server (e.g. a second process in the same container, or a separate service).

Usage:
    python -m app.workers.runner
"""
import logging
import time
from datetime import datetime, timezone
from sqlalchemy.orm import Session

from app.database import SessionLocal
from app.models.job import BackgroundJob

logger = logging.getLogger(__name__)

POLL_INTERVAL_SECONDS = 5


def _runner_cfg() -> dict:
    """Return the [runner] section from worker_config.json (best-effort)."""
    try:
        from app.worker_config import get_section  # noqa: PLC0415
        return get_section("runner") or {}
    except Exception:
        return {}


def _now():
    return datetime.now(timezone.utc)


def process_job(job: BackgroundJob, db: Session) -> None:
    from app.workers import ocr, object_detection, face_grouping, geocoding, deduplication, barcode

    dispatch = {
        "ocr":              ocr.run,
        "object_detection": object_detection.run,
        "face_grouping":    face_grouping.run,
        "location_geocode": geocoding.run,
        "deduplication":    deduplication.run,
        "barcode":          barcode.run,
    }

    fn = dispatch.get(job.type)
    if fn is None:
        logger.warning("Unknown job type: %s", job.type)
        job.status = "failed"
        job.error = f"Unknown job type: {job.type}"
        job.completed_at = _now()
        db.commit()
        return

    job.status = "running"
    job.started_at = _now()
    db.commit()

    try:
        fn(job.media_id, db)
        job.status = "completed"
    except Exception as exc:
        logger.exception("Job %s failed: %s", job.id, exc)
        job.status = "failed"
        job.error = str(exc)
    finally:
        job.completed_at = _now()
        try:
            db.commit()
        except Exception:
            # The worker may have left the session in an aborted transaction
            # (e.g. a DB write inside the worker raised an error that psycopg2
            # automatically rolled back).  Roll back here, then retry so the
            # job status is persisted rather than staying stuck as "running".
            logger.warning("Job %s: status commit failed — rolling back and retrying", job.id)
            try:
                db.rollback()
            except Exception:
                pass
            try:
                db.commit()
            except Exception:
                logger.exception("Job %s: could not persist final status; job may appear stuck", job.id)


def _reset_stuck_jobs() -> None:
    """On startup reset any jobs left in 'running' state from a previous crash."""
    db = SessionLocal()
    try:
        stuck = db.query(BackgroundJob).filter(BackgroundJob.status == "running").all()
        if stuck:
            logger.warning("Resetting %d stuck job(s) back to pending", len(stuck))
            for job in stuck:
                job.status = "pending"
                job.started_at = None
            db.commit()
    except Exception:
        logger.exception("Failed to reset stuck jobs on startup")
        db.rollback()
    finally:
        db.close()


def run_loop() -> None:
    _reset_stuck_jobs()
    logger.info("Worker runner started. Polling every %ds.", POLL_INTERVAL_SECONDS)
    while True:
        cfg = _runner_cfg()
        sleep_after = float(cfg.get("sleep_after_job_seconds", 0))

        db = SessionLocal()
        try:
            job = (
                db.query(BackgroundJob)
                .filter(BackgroundJob.status == "pending")
                .order_by(BackgroundJob.created_at)
                .with_for_update(skip_locked=True)
                .first()
            )
            if job:
                logger.info("Processing job %s (type=%s, media=%s)", job.id, job.type, job.media_id)
                process_job(job, db)
                if sleep_after > 0:
                    time.sleep(sleep_after)
            else:
                time.sleep(POLL_INTERVAL_SECONDS)
        except Exception:
            logger.exception("Unhandled error in job runner loop — retrying in %ds", POLL_INTERVAL_SECONDS)
            try:
                db.rollback()
            except Exception:
                pass
            time.sleep(POLL_INTERVAL_SECONDS)
        finally:
            try:
                db.close()
            except Exception:
                pass


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    run_loop()
