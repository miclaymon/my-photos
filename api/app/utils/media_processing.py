"""
Media processing utilities — run after upload completes.

process_after_upload(media_id) is registered as a FastAPI BackgroundTask
from the /complete endpoint. It creates its own DB session (the request
session is already closed by the time the task runs).

enqueue_jobs(media_id, content_type, has_hash, db) inserts background_jobs
rows for ML workers based on what's enabled in worker_config.json.
"""
import io
import logging
import os
import tempfile
from datetime import datetime
from typing import Optional

from PIL import Image, ImageOps
from PIL.ExifTags import TAGS, GPSTAGS
from sqlalchemy.orm import Session

from app.config import settings
from app.database import SessionLocal
from app.models.job import BackgroundJob
from app.models.media import Media
from app.storage.s3 import get_object_bytes, get_s3_client
from app.worker_config import is_enabled

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------

def process_after_upload(media_id: str) -> None:
    """
    Download the uploaded file, extract metadata, generate thumbnails,
    and update the Media row. Registered as a FastAPI BackgroundTask.
    Creates its own DB session — the request session is already closed.
    """
    db: Session = SessionLocal()
    try:
        media = db.query(Media).filter(Media.id == media_id).first()
        if not media:
            logger.error("process_after_upload: media %s not found", media_id)
            return

        data = get_object_bytes(media.object_key)

        if media.content_type.startswith("image/"):
            _process_image(media, data, db)
        elif media.content_type.startswith("video/"):
            _process_video(media, data, db)
        else:
            logger.info(
                "process_after_upload: unsupported content_type %s for media %s — skipping",
                media.content_type,
                media_id,
            )
    except Exception:
        logger.exception("process_after_upload failed for media %s", media_id)
    finally:
        db.close()


def enqueue_jobs(
    media_id: str,
    content_type: str,
    has_hash: bool,
    db: Session,
) -> None:
    """
    Insert background_jobs rows for ML workers based on worker_config.json.
    Geocoding is NOT enqueued here — _process_image/_process_video handle it
    after confirming GPS data is present in the EXIF.
    """
    is_image = content_type.startswith("image/")
    is_video = content_type.startswith("video/")

    job_types: list[str] = []

    if not has_hash:
        job_types.append("deduplication")
    if is_enabled("object_detection") and (is_image or is_video):
        job_types.append("object_detection")
    if is_enabled("face_detection") and is_image:
        job_types.append("face_grouping")
    if is_enabled("ocr") and is_image:
        job_types.append("ocr")
    if is_enabled("barcode") and is_image:
        job_types.append("barcode")

    for jt in job_types:
        db.add(BackgroundJob(media_id=media_id, type=jt, status="pending"))
    db.commit()


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _thumb_key(object_key: str) -> str:
    """
    Replace the filename portion of *object_key* with 'thumb.jpg'.
    e.g. '42/uuid/photo.jpg' -> '42/uuid/thumb.jpg'
    """
    prefix = object_key.rsplit("/", 1)[0]
    return f"{prefix}/thumb.jpg"


def _preview_key(object_key: str) -> str:
    """Replace the filename portion with 'preview.mp4'."""
    prefix = object_key.rsplit("/", 1)[0]
    return f"{prefix}/preview.mp4"


_GPS_IFD_TAG = 34853  # PIL numeric tag ID for the GPSInfo sub-IFD


def _extract_exif(img: Image.Image) -> dict:
    """
    Return a clean, JSON-serialisable dict of EXIF tags.
    Binary values are skipped; IFDRational values are converted to float.
    GPSInfo is decoded into a nested dict keyed by GPS tag names.

    Uses the public getexif() API (works for JPEG, WebP, PNG with EXIF chunks,
    HEIC) rather than the JPEG-only private _getexif().  GPSInfo is fetched via
    get_ifd() so it works even when getexif() returns a raw integer offset for
    that tag instead of the decoded sub-dict.
    """
    result: dict = {}
    try:
        exif_obj = img.getexif()
        if not exif_obj:
            return result
        for tag_id, val in exif_obj.items():
            tag = TAGS.get(tag_id, str(tag_id))
            if tag_id == _GPS_IFD_TAG or tag == "GPSInfo":
                gps_ifd = exif_obj.get_ifd(_GPS_IFD_TAG)
                gps: dict = {}
                for gps_id, gps_val in gps_ifd.items():
                    gps_tag = GPSTAGS.get(gps_id, str(gps_id))
                    if hasattr(gps_val, "numerator"):
                        gps[gps_tag] = float(gps_val)
                    elif isinstance(gps_val, tuple):
                        gps[gps_tag] = [
                            float(v) if hasattr(v, "numerator") else v
                            for v in gps_val
                        ]
                    elif isinstance(gps_val, (str, int, float)):
                        gps[gps_tag] = gps_val
                if gps:
                    result["GPSInfo"] = gps
            elif isinstance(val, bytes):
                pass  # skip binary blobs
            elif hasattr(val, "numerator"):
                result[tag] = float(val)
            elif isinstance(val, (str, int, float)):
                result[tag] = val
            elif isinstance(val, tuple):
                result[tag] = [
                    float(v) if hasattr(v, "numerator") else v
                    for v in val
                    if isinstance(v, (int, float)) or hasattr(v, "numerator")
                ]
    except Exception:
        pass  # EXIF extraction is best-effort
    return result


def _parse_exif_datetime(raw: str) -> Optional[datetime]:
    """Try both common EXIF date formats; return None on failure."""
    for fmt in ("%Y:%m:%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S"):
        try:
            return datetime.strptime(raw, fmt)
        except ValueError:
            continue
    return None


def _process_image(media: Media, data: bytes, db: Session) -> None:
    """Extract EXIF, generate a thumbnail, upload it, and update the DB row."""
    try:
        img = Image.open(io.BytesIO(data))
        # Extract EXIF from the original image before exif_transpose, because
        # exif_transpose() returns a new image object that drops the raw EXIF
        # data in many Pillow versions.
        exif = _extract_exif(img)
        img = ImageOps.exif_transpose(img)

        width, height = img.size

        # Honour client-supplied taken_at; only fill from EXIF when missing
        taken_at: Optional[datetime] = media.taken_at
        if taken_at is None:
            raw_dt = exif.get("DateTimeOriginal")
            if raw_dt and isinstance(raw_dt, str):
                taken_at = _parse_exif_datetime(raw_dt)

        # Generate thumbnail
        thumb_img = img.copy()
        thumb_img.thumbnail((600, 600), Image.Resampling.LANCZOS)
        if thumb_img.mode != "RGB":
            thumb_img = thumb_img.convert("RGB")
        thumb_buf = io.BytesIO()
        thumb_img.save(thumb_buf, format="JPEG", quality=85)
        thumb_bytes = thumb_buf.getvalue()

        # Upload thumbnail
        thumb_key = _thumb_key(media.object_key)
        client = get_s3_client()
        client.put_object(
            Bucket=settings.storage_bucket_name,
            Key=thumb_key,
            Body=thumb_bytes,
            ContentType="image/jpeg",
        )

        # Persist updates
        media.thumbnail_object_key = thumb_key
        media.width = width
        media.height = height
        media.aspect_ratio = width / height if height else None
        media.exif_data = exif if exif else None
        if taken_at is not None:
            media.taken_at = taken_at
        db.commit()

        # Enqueue geocoding if GPS data is present
        if "GPSInfo" in exif and exif["GPSInfo"]:
            db.add(BackgroundJob(media_id=media.id, type="location_geocode", status="pending"))
            db.commit()

    except Exception:
        logger.exception("_process_image failed for media %s", media.id)
        # Roll back any partial state so the session remains usable
        try:
            db.rollback()
        except Exception:
            pass


def _process_video(media: Media, data: bytes, db: Session) -> None:
    """
    Probe video metadata, extract a thumbnail frame (and optional 5s preview
    clip), upload them to S3, and update the DB row.

    Requires ffmpeg-python and a working ffmpeg binary. If ffmpeg is
    unavailable the function logs a warning and returns without failing the
    overall upload.
    """
    try:
        import ffmpeg  # type: ignore[import]
    except ImportError:
        logger.warning("ffmpeg-python not installed — skipping video thumbnail for media %s", media.id)
        return

    # Determine a sensible suffix so ffmpeg can detect the container format
    suffix = "." + media.content_type.split("/")[-1] if "/" in media.content_type else ".mp4"
    tmp_path: Optional[str] = None
    thumb_tmp: Optional[str] = None
    preview_tmp: Optional[str] = None

    try:
        # Write source file to a temp path
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as fh:
            fh.write(data)
            tmp_path = fh.name

        # Probe
        try:
            probe = ffmpeg.probe(tmp_path)
        except ffmpeg.Error as exc:
            logger.warning(
                "ffmpeg probe failed for media %s: %s",
                media.id,
                exc.stderr.decode(errors="replace") if exc.stderr else str(exc),
            )
            return

        # Extract video stream info
        video_stream = next(
            (s for s in probe.get("streams", []) if s.get("codec_type") == "video"),
            None,
        )
        width: Optional[int] = None
        height: Optional[int] = None
        if video_stream:
            width = video_stream.get("width")
            height = video_stream.get("height")

        duration: float = 0.0
        try:
            duration = float(probe.get("format", {}).get("duration", 0) or 0)
        except (TypeError, ValueError):
            duration = 0.0

        seek_pos = min(1.0, duration / 2) if duration > 0 else 0.0

        # Extract thumbnail frame
        thumb_tmp = tmp_path + "_thumb.jpg"
        try:
            (
                ffmpeg.input(tmp_path, ss=seek_pos)
                .output(thumb_tmp, vframes=1, format="image2", vcodec="mjpeg")
                .overwrite_output()
                .run(quiet=True)
            )
        except ffmpeg.Error as exc:
            logger.warning(
                "ffmpeg thumbnail extraction failed for media %s: %s",
                media.id,
                exc.stderr.decode(errors="replace") if exc.stderr else str(exc),
            )
            thumb_tmp = None

        if thumb_tmp and os.path.exists(thumb_tmp):
            with open(thumb_tmp, "rb") as fh:
                thumb_bytes = fh.read()

            thumb_key = _thumb_key(media.object_key)
            client = get_s3_client()
            client.put_object(
                Bucket=settings.storage_bucket_name,
                Key=thumb_key,
                Body=thumb_bytes,
                ContentType="image/jpeg",
            )
            media.thumbnail_object_key = thumb_key

        # Optional 5-second preview clip (only for longer videos)
        if duration > 10:
            preview_tmp = tmp_path + "_preview.mp4"
            try:
                (
                    ffmpeg.input(tmp_path, ss=seek_pos, t=5)
                    .output(
                        preview_tmp,
                        vcodec="libx264",
                        crf=28,
                        preset="veryfast",
                        vf="scale=480:-2",
                        an=None,
                        movflags="faststart",
                    )
                    .overwrite_output()
                    .run(quiet=True)
                )
            except ffmpeg.Error as exc:
                logger.warning(
                    "ffmpeg preview generation failed for media %s: %s",
                    media.id,
                    exc.stderr.decode(errors="replace") if exc.stderr else str(exc),
                )
                preview_tmp = None

            if preview_tmp and os.path.exists(preview_tmp):
                with open(preview_tmp, "rb") as fh:
                    preview_bytes = fh.read()

                preview_key = _preview_key(media.object_key)
                client = get_s3_client()
                client.put_object(
                    Bucket=settings.storage_bucket_name,
                    Key=preview_key,
                    Body=preview_bytes,
                    ContentType="video/mp4",
                )
                media.preview_object_key = preview_key

        # Extract taken_at from video metadata (creation_time tag)
        taken_at: Optional[datetime] = media.taken_at
        if taken_at is None:
            raw_ct = probe.get("format", {}).get("tags", {}).get("creation_time")
            if raw_ct and isinstance(raw_ct, str):
                try:
                    # Strip trailing 'Z' for fromisoformat compatibility on Python < 3.11
                    taken_at = datetime.fromisoformat(raw_ct.rstrip("Z"))
                except ValueError:
                    pass

        # Persist updates
        if width is not None:
            media.width = width
        if height is not None:
            media.height = height
        if width and height and height > 0:
            media.aspect_ratio = width / height
        if duration > 0:
            media.duration_seconds = duration
        if taken_at is not None:
            media.taken_at = taken_at
        db.commit()

        # Enqueue geocoding if GPS info is embedded (rare for video but possible)
        # Video geocoding is handled by the location_geocode worker from format tags
        # if the creation_time suggests a GPS-tagged format; omitted here as it's not
        # standard in video EXIF the way it is for images.

    except Exception:
        logger.exception("_process_video failed for media %s", media.id)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        for path in (tmp_path, thumb_tmp, preview_tmp):
            if path and os.path.exists(path):
                try:
                    os.unlink(path)
                except OSError:
                    pass
