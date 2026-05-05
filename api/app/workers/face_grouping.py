"""Face detection and grouping worker.

Providers:
  insightface      — ArcFace 512-d embeddings, CPU via onnxruntime, excellent accuracy
  face_recognition — dlib 128-d embeddings, CPU-only, simpler install

Algorithm:
  For each detected face in the image:
  1. Compute face embedding
  2. Compare against avg_descriptor of all subjects in the library
  3. Route based on closest match distance:
     - < AUTO_CONFIRM_THRESHOLD : confirmed match, update avg_descriptor
     - < REVIEW_THRESHOLD       : auto match, no review
     - < CLUSTER_THRESHOLD      : match but flag for review
     - >= CLUSTER_THRESHOLD     : new unnamed subject
  4. Require MIN_GAP between best and second-best match for confidence
"""
import io
import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.media import Media
from app.models.subject import Subject, SubjectDetection
from app.models.library import LibraryMedia
from app.storage.s3 import get_object_bytes, put_object_bytes
from app.worker_config import get_provider, get_section, is_enabled

logger = logging.getLogger(__name__)

# Module-level model cache for insightface
_face_app = None


def run(media_id: str, db: Session) -> None:
    if not is_enabled("face_detection"):
        logger.debug("Face detection disabled, skipping media %s", media_id)
        return

    media = db.query(Media).filter(Media.id == media_id).first()
    if media is None:
        logger.warning("Media %s not found", media_id)
        return

    if media.faces_processed_at is not None:
        logger.debug("Media %s already face-processed, skipping", media_id)
        return

    if not (media.content_type or "").startswith("image/"):
        logger.debug("Media %s is not an image (%s), skipping face grouping", media_id, media.content_type)
        media.faces_processed_at = datetime.now(timezone.utc)
        db.commit()
        return

    img_bytes = get_object_bytes(media.object_key)
    cfg = get_section("face_detection")
    provider = get_provider("face_detection")

    library_id = _get_library_id(media_id, db)
    if library_id is None:
        logger.warning("Media %s has no library association, skipping face grouping", media_id)
        media.faces_processed_at = datetime.now(timezone.utc)
        db.commit()
        return

    subjects = _load_subjects(library_id, db)

    if provider == "insightface":
        _run_insightface(img_bytes, media_id, library_id, subjects, cfg, db)
    elif provider == "face_recognition":
        _run_face_recognition(img_bytes, media_id, library_id, subjects, cfg, db)
    else:
        logger.warning("Unknown face detection provider: %s", provider)

    media.faces_processed_at = datetime.now(timezone.utc)
    db.commit()


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _get_library_id(media_id: str, db: Session) -> str | None:
    lm = db.query(LibraryMedia).filter(LibraryMedia.media_id == media_id).first()
    return lm.library_id if lm else None


def _load_subjects(library_id: str, db: Session) -> list:
    return (
        db.query(Subject)
        .filter(
            Subject.library_id == library_id,
            Subject.type == "person",
            Subject.avg_descriptor.isnot(None),
        )
        .all()
    )


def _match_or_create(
    descriptor: list,
    library_id: str,
    subjects: list,
    cfg: dict,
    db: Session,
) -> tuple[str, str, float]:
    """Match a face descriptor against existing subjects or create a new one.

    Returns (subject_id, status, distance).
    Status is one of: 'confirmed', 'auto', 'review_pending'.
    """
    import numpy as np  # noqa: PLC0415

    AUTO_CONFIRM = cfg.get("auto_confirm_threshold", 0.25)
    REVIEW_THRESH = cfg.get("review_threshold", 0.38)
    CLUSTER_THRESH = cfg.get("cluster_threshold", 0.50)
    MIN_GAP = cfg.get("min_gap", 0.05)

    desc = np.array(descriptor, dtype=np.float32)
    desc = desc / (np.linalg.norm(desc) + 1e-6)  # L2 normalise

    distances = []
    for subj in subjects:
        avg = np.array(subj.avg_descriptor, dtype=np.float32)
        avg = avg / (np.linalg.norm(avg) + 1e-6)
        d = float(np.linalg.norm(desc - avg))
        distances.append((d, subj))

    distances.sort(key=lambda x: x[0])

    if distances:
        best_dist, best_subj = distances[0]
        second_dist = distances[1][0] if len(distances) > 1 else float("inf")
        gap = second_dist - best_dist

        if best_dist < CLUSTER_THRESH and gap >= MIN_GAP:
            if best_dist < AUTO_CONFIRM:
                status = "confirmed"
            elif best_dist < REVIEW_THRESH:
                status = "auto"
            else:
                status = "review_pending"
            return best_subj.id, status, best_dist

    # No confident match — create a new unnamed subject
    new_subj = Subject(
        id=str(uuid.uuid4()),
        library_id=library_id,
        type="person",
        hidden=False,
        avg_descriptor=descriptor,  # initial avg is this descriptor
    )
    db.add(new_subj)
    db.flush()
    logger.info("Created new person subject %s in library %s", new_subj.id, library_id)
    return new_subj.id, "auto", float("inf")


def _set_representative_if_missing(subject_id: str, detection_id: int, db: Session) -> None:
    """Set representative_detection_id on a subject if it doesn't have one yet."""
    subj = db.query(Subject).filter(Subject.id == subject_id).first()
    if subj and subj.representative_detection_id is None:
        subj.representative_detection_id = detection_id


def _update_avg_descriptor(subject_id: str, db: Session) -> None:
    """Recompute avg_descriptor from all confirmed detections for this subject."""
    import numpy as np  # noqa: PLC0415

    confirmed = (
        db.query(SubjectDetection)
        .filter(
            SubjectDetection.subject_id == subject_id,
            SubjectDetection.status == "confirmed",
            SubjectDetection.descriptor.isnot(None),
        )
        .all()
    )
    if not confirmed:
        return

    descs = [np.array(d.descriptor, dtype=np.float32) for d in confirmed if d.descriptor]
    if not descs:
        return

    avg = np.mean(descs, axis=0).tolist()
    db.query(Subject).filter(Subject.id == subject_id).update({Subject.avg_descriptor: avg})


# ─── Face crop helper ─────────────────────────────────────────────────────────

def _save_face_crop(
    img_bytes: bytes,
    media_id: str,
    detection_id: int,
    bbox: dict,
) -> str | None:
    """Crop the face region (with padding), encode as WebP, upload to S3.

    Returns the S3 object key, or None if the crop fails.
    bbox is fractional {x, y, w, h} in 0-1 range.
    """
    try:
        from PIL import Image  # noqa: PLC0415
        import io              # noqa: PLC0415

        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        iw, ih = img.size

        # Convert fractional bbox to pixel coords
        fx, fy, fw, fh = bbox["x"], bbox["y"], bbox["w"], bbox["h"]
        x1 = fx * iw
        y1 = fy * ih
        x2 = (fx + fw) * iw
        y2 = (fy + fh) * ih

        # Apply 25% padding around the detected face
        pad_x = (x2 - x1) * 0.25
        pad_y = (y2 - y1) * 0.25
        x1 = max(0,  int(x1 - pad_x))
        y1 = max(0,  int(y1 - pad_y))
        x2 = min(iw, int(x2 + pad_x))
        y2 = min(ih, int(y2 + pad_y))

        if x2 <= x1 or y2 <= y1:
            return None

        crop = img.crop((x1, y1, x2, y2))

        # Resize so the largest dimension is at most 256px
        max_dim = 256
        cw, ch = crop.size
        if cw > max_dim or ch > max_dim:
            scale = max_dim / max(cw, ch)
            crop = crop.resize((max(1, int(cw * scale)), max(1, int(ch * scale))), Image.LANCZOS)

        buf = io.BytesIO()
        crop.save(buf, format="WEBP", quality=85)

        # Re-compress at lower quality if the crop exceeds 8 KB
        if buf.tell() > 8192:
            buf = io.BytesIO()
            crop.save(buf, format="WEBP", quality=65, method=6)

        buf.seek(0)
        object_key = f"{media_id}/faces/{detection_id}/face.webp"
        put_object_bytes(object_key, buf.read(), content_type="image/webp")
        return object_key

    except Exception:
        logger.exception("Failed to save face crop for detection %s", detection_id)
        return None


# ─── insightface provider ──────────────────────────────────────────────────────

def _get_face_app():
    global _face_app
    if _face_app is None:
        import insightface  # noqa: PLC0415, F401
        from insightface.app import FaceAnalysis  # noqa: PLC0415

        _face_app = FaceAnalysis(
            name="buffalo_sc",           # small model, CPU-friendly
            providers=["CPUExecutionProvider"],
        )
        _face_app.prepare(ctx_id=0, det_size=(640, 640))
    return _face_app


def _run_insightface(
    img_bytes: bytes,
    media_id: str,
    library_id: str,
    subjects: list,
    cfg: dict,
    db: Session,
) -> None:
    import cv2  # noqa: PLC0415
    import numpy as np  # noqa: PLC0415

    app = _get_face_app()
    nparr = np.frombuffer(img_bytes, np.uint8)
    img_bgr = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
    if img_bgr is None:
        logger.warning("Media %s: could not decode image for face detection", media_id)
        return

    faces = app.get(img_bgr)
    media_w = img_bgr.shape[1]
    media_h = img_bgr.shape[0]

    logger.info("Media %s: insightface detected %d face(s)", media_id, len(faces))

    for face in faces:
        if face.det_score < 0.5:
            continue

        descriptor = face.embedding.tolist()  # 512-d ArcFace embedding

        x1, y1, x2, y2 = face.bbox.tolist()
        bbox = {
            "x": max(0.0, x1 / media_w),
            "y": max(0.0, y1 / media_h),
            "w": min(1.0, (x2 - x1) / media_w),
            "h": min(1.0, (y2 - y1) / media_h),
        }

        subject_id, status, distance = _match_or_create(descriptor, library_id, subjects, cfg, db)
        review_needed = status == "review_pending"

        detection = SubjectDetection(
            media_id=media_id,
            subject_id=subject_id,
            bounding_box=bbox,
            descriptor=descriptor,
            confidence=float(face.det_score),
            match_distance=distance if distance != float("inf") else None,
            review_needed=review_needed,
            status=status,
        )
        db.add(detection)
        db.flush()  # get detection.id

        # Crop and upload face thumbnail
        face_crop_key = _save_face_crop(img_bytes, media_id, detection.id, bbox)
        if face_crop_key:
            detection.face_crop_key = face_crop_key

        # Use this detection as the subject's representative if none is set yet
        _set_representative_if_missing(subject_id, detection.id, db)

        if status == "confirmed":
            _update_avg_descriptor(subject_id, db)

        # Reload so subsequent faces in this image see updated averages
        subjects = _load_subjects(library_id, db)


# ─── face_recognition provider ────────────────────────────────────────────────

def _run_face_recognition(
    img_bytes: bytes,
    media_id: str,
    library_id: str,
    subjects: list,
    cfg: dict,
    db: Session,
) -> None:
    import face_recognition  # noqa: PLC0415

    img = face_recognition.load_image_file(io.BytesIO(img_bytes))
    locations = face_recognition.face_locations(img, model="hog")
    encodings = face_recognition.face_encodings(img, locations)

    media_h, media_w = img.shape[:2]
    logger.info("Media %s: face_recognition detected %d face(s)", media_id, len(encodings))

    for (top, right, bottom, left), encoding in zip(locations, encodings):
        descriptor = encoding.tolist()  # 128-d dlib embedding
        bbox = {
            "x": left / media_w,
            "y": top / media_h,
            "w": (right - left) / media_w,
            "h": (bottom - top) / media_h,
        }

        subject_id, status, distance = _match_or_create(descriptor, library_id, subjects, cfg, db)
        review_needed = status == "review_pending"

        detection = SubjectDetection(
            media_id=media_id,
            subject_id=subject_id,
            bounding_box=bbox,
            descriptor=descriptor,
            confidence=1.0,   # face_recognition does not expose a detection score
            match_distance=distance if distance != float("inf") else None,
            review_needed=review_needed,
            status=status,
        )
        db.add(detection)
        db.flush()  # get detection.id

        # Crop and upload face thumbnail
        face_crop_key = _save_face_crop(img_bytes, media_id, detection.id, bbox)
        if face_crop_key:
            detection.face_crop_key = face_crop_key

        # Use this detection as the subject's representative if none is set yet
        _set_representative_if_missing(subject_id, detection.id, db)

        if status == "confirmed":
            _update_avg_descriptor(subject_id, db)

        subjects = _load_subjects(library_id, db)
