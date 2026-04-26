"""Object detection worker.

Providers:
  onnxruntime  — YOLOv8n ONNX model, ~6MB, CPU-only, fast
  ultralytics  — YOLOv8 via ultralytics package (auto-downloads .pt model)

Video support:
  Videos are sampled at evenly-spaced intervals using ffmpeg. Detections are
  aggregated across all frames: for each class, the highest-confidence
  bounding box from any frame is kept.
"""
import io
import logging
import os
import tempfile
import uuid
from datetime import datetime, timezone
from typing import NamedTuple

from sqlalchemy.orm import Session

from app.models.media import Media, MediaObject
from app.models.subject import Subject
from app.models.library import LibraryMedia
from app.storage.s3 import get_object_bytes
from app.worker_config import get_provider, get_section, is_enabled

logger = logging.getLogger(__name__)

# COCO animal/pet classes that should create Subject rows
PET_CLASSES = {
    "cat", "dog", "bird", "horse", "sheep", "cow",
    "elephant", "bear", "zebra", "giraffe",
}

# COCO 80-class names (index == class id)
COCO_NAMES = [
    "person", "bicycle", "car", "motorcycle", "airplane", "bus", "train", "truck", "boat",
    "traffic light", "fire hydrant", "stop sign", "parking meter", "bench", "bird", "cat",
    "dog", "horse", "sheep", "cow", "elephant", "bear", "zebra", "giraffe", "backpack",
    "umbrella", "handbag", "tie", "suitcase", "frisbee", "skis", "snowboard", "sports ball",
    "kite", "baseball bat", "baseball glove", "skateboard", "surfboard", "tennis racket",
    "bottle", "wine glass", "cup", "fork", "knife", "spoon", "bowl", "banana", "apple",
    "sandwich", "orange", "broccoli", "carrot", "hot dog", "pizza", "donut", "cake", "chair",
    "couch", "potted plant", "bed", "dining table", "toilet", "tv", "laptop", "mouse",
    "remote", "keyboard", "cell phone", "microwave", "oven", "toaster", "sink",
    "refrigerator", "book", "clock", "vase", "scissors", "teddy bear", "hair drier", "toothbrush",
]

# Module-level model caches
_yolo_model = None
_onnx_session = None

MODEL_DIR  = os.path.expanduser("~/.cache/my-photos/models")
MODEL_PATH = os.path.join(MODEL_DIR, "yolov8n.onnx")


# A single detection result from one inference pass
class Detection(NamedTuple):
    cls_name:  str
    confidence: float
    bbox:      dict   # {"x": px, "y": px, "w": px, "h": px} in pixel coords


# ─── Entry point ───────────────────────────────────────────────────────────────

def run(media_id: str, db: Session) -> None:
    if not is_enabled("object_detection"):
        logger.debug("Object detection disabled, skipping media %s", media_id)
        return

    media = db.query(Media).filter(Media.id == media_id).first()
    if media is None:
        logger.warning("Media %s not found", media_id)
        return

    if media.objects_processed_at is not None:
        logger.debug("Media %s already object-detected, skipping", media_id)
        return

    ct = media.content_type or ""
    is_image = ct.startswith("image/")
    is_video = ct.startswith("video/")

    if not (is_image or is_video):
        logger.debug("Media %s is not image/video (%s), skipping", media_id, ct)
        media.objects_processed_at = datetime.now(timezone.utc)
        db.commit()
        return

    provider = get_provider("object_detection")
    cfg      = get_section("object_detection")

    if is_video:
        _run_on_video(media_id, media, db, provider, cfg)
    else:
        img_bytes = get_object_bytes(media.object_key)
        _run_on_image(img_bytes, media_id, media, db, provider, cfg)


# ─── Image path ────────────────────────────────────────────────────────────────

def _run_on_image(img_bytes: bytes, media_id: str, media: Media, db: Session,
                  provider: str, cfg: dict) -> None:
    """Detect objects in a single image and persist results."""
    from PIL import Image  # noqa: PLC0415

    try:
        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
    except Exception as exc:
        logger.warning("Media %s: cannot open image — %s", media_id, exc)
        media.objects_processed_at = datetime.now(timezone.utc)
        db.commit()
        return

    detections = _detect(img, provider, cfg)

    _persist_detections(detections, media_id, media, db, cfg)
    logger.info("Media %s object detection (%s) complete: %d boxes",
                media_id, provider, len(detections))


# ─── Video path ────────────────────────────────────────────────────────────────

def _run_on_video(media_id: str, media: Media, db: Session,
                  provider: str, cfg: dict) -> None:
    """Sample frames from a video and aggregate detections across all frames.

    For each detected class, the highest-confidence bounding box from any
    sampled frame is stored. This means the stored bbox coordinates are
    relative to the video frame dimensions — they are useful for identifying
    what's in the video but not for overlaying on the video player.
    """
    num_frames = int(cfg.get("video_frames", 8))

    video_bytes = get_object_bytes(media.object_key)
    frames = _extract_video_frames(video_bytes, num_frames)

    if not frames:
        logger.info("Media %s: no frames extracted from video, marking processed", media_id)
        media.objects_processed_at = datetime.now(timezone.utc)
        db.commit()
        return

    # Aggregate: keep the highest-confidence detection per class across all frames
    best: dict[str, Detection] = {}
    for frame_img in frames:
        for det in _detect(frame_img, provider, cfg):
            existing = best.get(det.cls_name)
            if existing is None or det.confidence > existing.confidence:
                best[det.cls_name] = det

    _persist_detections(list(best.values()), media_id, media, db, cfg)
    logger.info("Media %s video object detection (%s) complete: %d unique classes from %d frames",
                media_id, provider, len(best), len(frames))


def _extract_video_frames(video_bytes: bytes, num_frames: int = 8) -> list:
    """Use ffmpeg to sample *num_frames* evenly-spaced frames from a video.

    Returns a list of PIL Image objects. Returns an empty list if ffmpeg is
    unavailable or the video cannot be probed.
    """
    from PIL import Image  # noqa: PLC0415

    try:
        import ffmpeg  # noqa: PLC0415
    except ImportError:
        logger.warning("ffmpeg-python not installed — skipping video object detection")
        return []

    tmp_path: str | None = None
    frames: list = []

    try:
        # Write video bytes to a temp file so ffmpeg can probe and seek it
        with tempfile.NamedTemporaryFile(suffix=".mp4", delete=False) as fh:
            fh.write(video_bytes)
            tmp_path = fh.name

        try:
            probe = ffmpeg.probe(tmp_path)
        except Exception as exc:
            logger.warning("ffmpeg probe failed for video frame extraction: %s", exc)
            return []

        duration = float(probe.get("format", {}).get("duration", 0) or 0)
        if duration <= 0:
            logger.debug("Video has zero duration, skipping frame extraction")
            return []

        for i in range(num_frames):
            seek_pos = duration * (i + 0.5) / num_frames
            frame_tmp = f"{tmp_path}_frame_{i}.jpg"
            try:
                (
                    ffmpeg.input(tmp_path, ss=seek_pos)
                    .output(frame_tmp, vframes=1, format="image2", vcodec="mjpeg")
                    .overwrite_output()
                    .run(quiet=True)
                )
                if os.path.exists(frame_tmp):
                    img = Image.open(frame_tmp).convert("RGB")
                    img.load()   # force decode before we delete the file
                    frames.append(img)
            except Exception as exc:
                logger.debug("Frame extraction failed at %.1fs: %s", seek_pos, exc)
            finally:
                if os.path.exists(frame_tmp):
                    try:
                        os.unlink(frame_tmp)
                    except OSError:
                        pass

    finally:
        if tmp_path and os.path.exists(tmp_path):
            try:
                os.unlink(tmp_path)
            except OSError:
                pass

    logger.debug("Extracted %d/%d frames from video", len(frames), num_frames)
    return frames


# ─── Provider dispatch ─────────────────────────────────────────────────────────

def _detect(img, provider: str, cfg: dict) -> list[Detection]:
    """Run inference on a single PIL Image. Returns a list of Detection objects."""
    if provider == "ultralytics":
        return _detect_ultralytics(img, cfg)
    if provider == "onnxruntime":
        return _detect_onnxruntime(img, cfg)
    logger.warning("Unknown object detection provider: %s", provider)
    return []


# ─── Ultralytics provider ──────────────────────────────────────────────────────

def _get_yolo(cfg: dict):
    global _yolo_model
    if _yolo_model is None:
        from ultralytics import YOLO  # noqa: PLC0415

        model_name = cfg.get("model", "yolov8n") + ".pt"
        _yolo_model = YOLO(model_name)  # auto-downloads to ~/.cache/ultralytics
    return _yolo_model


def _detect_ultralytics(img, cfg: dict) -> list[Detection]:
    MIN_CONF = cfg.get("confidence_threshold", 0.35)
    NMS_IOU  = cfg.get("nms_iou_threshold", 0.45)

    model   = _get_yolo(cfg)
    results = model(img, conf=MIN_CONF, iou=NMS_IOU, verbose=False)[0]

    out = []
    for box in results.boxes:
        cls_id   = int(box.cls[0])
        cls_name = results.names[cls_id]
        conf     = float(box.conf[0])
        x1, y1, x2, y2 = box.xyxy[0].tolist()
        out.append(Detection(cls_name, conf, {"x": x1, "y": y1, "w": x2 - x1, "h": y2 - y1}))
    return out


# ─── ONNX Runtime provider ─────────────────────────────────────────────────────

def _get_onnx_session():
    global _onnx_session
    if _onnx_session is None:
        import onnxruntime as ort  # noqa: PLC0415

        os.makedirs(MODEL_DIR, exist_ok=True)
        if not os.path.exists(MODEL_PATH):
            _export_onnx_model()
        _onnx_session = ort.InferenceSession(MODEL_PATH, providers=["CPUExecutionProvider"])
    return _onnx_session


def _export_onnx_model() -> None:
    """Use the ultralytics package to download YOLOv8n and export it to ONNX.

    ultralytics is only needed once for this export step. After the file is
    cached at MODEL_PATH, onnxruntime handles all inference without PyTorch.
    """
    import shutil  # noqa: PLC0415

    try:
        from ultralytics import YOLO  # noqa: PLC0415
    except ImportError:
        raise RuntimeError(
            "ultralytics package is required to set up the ONNX model on first run. "
            "Install it with:  pip install ultralytics"
        )

    logger.info("Exporting YOLOv8n ONNX model to %s (one-time setup)…", MODEL_PATH)
    orig_dir = os.getcwd()
    tmp_dir  = tempfile.mkdtemp()
    try:
        os.chdir(tmp_dir)
        model     = YOLO("yolov8n.pt")
        onnx_path = model.export(format="onnx", imgsz=640, simplify=True)
        shutil.copy(str(onnx_path), MODEL_PATH)
    finally:
        os.chdir(orig_dir)
        import shutil as _shutil  # noqa: PLC0415
        _shutil.rmtree(tmp_dir, ignore_errors=True)

    logger.info("YOLOv8n ONNX model ready at %s", MODEL_PATH)


def _preprocess(img, size: int = 640):
    """Letterbox resize to size×size. Returns (float32 NCHW tensor, ratio, pad_x, pad_y)."""
    from PIL import Image  # noqa: PLC0415
    import numpy as np    # noqa: PLC0415

    orig_w, orig_h = img.size
    ratio  = min(size / orig_w, size / orig_h)
    new_w  = int(orig_w * ratio)
    new_h  = int(orig_h * ratio)
    resized = img.resize((new_w, new_h), Image.Resampling.BILINEAR)
    padded  = Image.new("RGB", (size, size), (114, 114, 114))
    pad_x   = (size - new_w) // 2
    pad_y   = (size - new_h) // 2
    padded.paste(resized, (pad_x, pad_y))
    arr = np.array(padded, dtype=np.float32) / 255.0
    return arr.transpose(2, 0, 1)[None], ratio, pad_x, pad_y


def _postprocess(output, ratio: float, pad_x: int, pad_y: int,
                 orig_w: int, orig_h: int, conf_thresh: float):
    """Parse YOLOv8 ONNX output [1, 84, 8400]. Returns list of (cls_id, conf, x1, y1, x2, y2)."""
    import numpy as np  # noqa: PLC0415

    pred        = output[0][0]    # [84, 8400]
    boxes_xywh  = pred[:4].T     # [8400, 4]  cx, cy, w, h
    class_scores = pred[4:].T    # [8400, 80]

    results = []
    for i in range(len(boxes_xywh)):
        scores = class_scores[i]
        cls_id = int(np.argmax(scores))
        conf   = float(scores[cls_id])
        if conf < conf_thresh:
            continue
        cx, cy, w, h = boxes_xywh[i]
        x1 = (cx - w / 2 - pad_x) / ratio
        y1 = (cy - h / 2 - pad_y) / ratio
        x2 = (cx + w / 2 - pad_x) / ratio
        y2 = (cy + h / 2 - pad_y) / ratio
        x1, y1 = max(0.0, x1), max(0.0, y1)
        x2, y2 = min(float(orig_w), x2), min(float(orig_h), y2)
        results.append((cls_id, conf, x1, y1, x2, y2))
    return results


def _detect_onnxruntime(img, cfg: dict) -> list[Detection]:
    import numpy as np  # noqa: PLC0415

    MIN_CONF = cfg.get("confidence_threshold", 0.35)
    NMS_IOU  = cfg.get("nms_iou_threshold", 0.45)

    session    = _get_onnx_session()
    orig_w, orig_h = img.size

    input_tensor, ratio, pad_x, pad_y = _preprocess(img)
    input_name = session.get_inputs()[0].name
    raw_output = session.run(None, {input_name: input_tensor})

    raw_dets = _postprocess(raw_output, ratio, pad_x, pad_y, orig_w, orig_h, MIN_CONF)
    raw_dets = _nms(raw_dets, NMS_IOU)

    out = []
    for cls_id, conf, x1, y1, x2, y2 in raw_dets:
        cls_name = COCO_NAMES[cls_id] if cls_id < len(COCO_NAMES) else str(cls_id)
        bbox = {"x": float(x1), "y": float(y1), "w": float(x2 - x1), "h": float(y2 - y1)}
        out.append(Detection(cls_name, conf, bbox))
    return out


def _nms(detections: list, iou_thresh: float) -> list:
    """Greedy NMS. detections = list of (cls_id, conf, x1, y1, x2, y2)."""
    if not detections:
        return []

    detections = sorted(detections, key=lambda d: d[1], reverse=True)
    kept = []
    for det in detections:
        _, _, x1, y1, x2, y2 = det
        suppress = False
        for _, _, kx1, ky1, kx2, ky2 in kept:
            ix1   = max(x1, kx1);  iy1  = max(y1, ky1)
            ix2   = min(x2, kx2);  iy2  = min(y2, ky2)
            inter = max(0.0, ix2 - ix1) * max(0.0, iy2 - iy1)
            union = (x2 - x1) * (y2 - y1) + (kx2 - kx1) * (ky2 - ky1) - inter
            if union > 0 and inter / union > iou_thresh:
                suppress = True
                break
        if not suppress:
            kept.append(det)
    return kept


# ─── DB persistence ────────────────────────────────────────────────────────────

def _persist_detections(detections: list[Detection], media_id: str,
                        media: Media, db: Session, cfg: dict) -> None:
    """Write detections to DB, create pet subjects, and stamp processed_at."""
    PET_THRESHOLD = cfg.get("pet_confidence_threshold", 0.65)

    db.query(MediaObject).filter(MediaObject.media_id == media_id).delete()

    for det in detections:
        db.add(MediaObject(
            media_id=media_id,
            class_name=det.cls_name,
            confidence=det.confidence,
            bounding_box=det.bbox,
        ))
        if det.cls_name in PET_CLASSES and det.confidence >= PET_THRESHOLD:
            _upsert_pet_subject(media_id, det.cls_name, db)

    media.objects_processed_at = datetime.now(timezone.utc)
    db.commit()


# ─── Pet subject upsert ────────────────────────────────────────────────────────

def _upsert_pet_subject(media_id: str, cls_name: str, db: Session) -> None:
    """Find or create a Subject row for this pet class in the same library as the media."""
    lm = db.query(LibraryMedia).filter(LibraryMedia.media_id == media_id).first()
    if not lm:
        return
    library_id = lm.library_id

    subject = (
        db.query(Subject)
        .filter(
            Subject.library_id == library_id,
            Subject.type == "pet",
            Subject.pet_class.contains([cls_name]),
        )
        .first()
    )

    if not subject:
        subject = Subject(
            id=str(uuid.uuid4()),
            library_id=library_id,
            type="pet",
            pet_class=[cls_name],
            hidden=False,
        )
        db.add(subject)
        db.flush()
        logger.info("Created new pet subject for class=%s in library=%s", cls_name, library_id)
