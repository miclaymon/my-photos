"""Barcode and QR code detection worker.

Providers:
  zxing-cpp — comprehensive, reads QR, EAN, Code128, DataMatrix, PDF417, etc.
  pyzbar    — lightweight, reads QR + common 1D barcodes via libzbar
  opencv    — built-in OpenCV QR detector (QR only)

Results are stored in media.exif_data under the key 'barcodes' as a list of
{'format': str, 'data': str} dicts. The exif_data dict is merged (existing keys
are preserved).
"""
import io
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.media import Media
from app.storage.s3 import get_object_bytes
from app.worker_config import get_provider, get_section, is_enabled

logger = logging.getLogger(__name__)


def run(media_id: str, db: Session) -> None:
    if not is_enabled("barcode"):
        logger.debug("Barcode detection disabled, skipping media %s", media_id)
        return

    media = db.query(Media).filter(Media.id == media_id).first()
    if media is None:
        logger.warning("Media %s not found", media_id)
        return

    # Idempotency: skip if barcodes key already present in exif_data
    if media.exif_data and "barcodes" in media.exif_data:
        logger.debug("Media %s already has barcode results, skipping", media_id)
        return

    if not (media.content_type or "").startswith("image/"):
        logger.debug("Media %s is not an image (%s), skipping barcode detection", media_id, media.content_type)
        return

    img_bytes = get_object_bytes(media.object_key)
    provider = get_provider("barcode")

    if provider == "zxing-cpp":
        barcodes = _run_zxing(img_bytes)
    elif provider == "pyzbar":
        barcodes = _run_pyzbar(img_bytes)
    elif provider == "opencv":
        barcodes = _run_opencv(img_bytes)
    else:
        logger.warning("Unknown barcode provider: %s", provider)
        return

    # Merge into existing exif_data (create dict if None)
    exif = dict(media.exif_data) if media.exif_data else {}
    exif["barcodes"] = barcodes
    media.exif_data = exif

    db.commit()

    if barcodes:
        logger.info("Media %s: found %d barcode(s) via %s", media_id, len(barcodes), provider)
    else:
        logger.debug("Media %s: no barcodes detected via %s", media_id, provider)


# ─── Provider implementations ──────────────────────────────────────────────────

def _run_zxing(img_bytes: bytes) -> list[dict]:
    """Decode barcodes using zxing-cpp (comprehensive format support)."""
    try:
        import zxingcpp  # noqa: PLC0415
        from PIL import Image  # noqa: PLC0415

        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        iw, ih = img.size
        results = zxingcpp.read_barcodes(img)
        out = []
        for r in results:
            bbox = None
            try:
                pos = r.position
                xs = [pos.top_left.x, pos.top_right.x, pos.bottom_right.x, pos.bottom_left.x]
                ys = [pos.top_left.y, pos.top_right.y, pos.bottom_right.y, pos.bottom_left.y]
                bbox = {
                    "x": min(xs) / iw,
                    "y": min(ys) / ih,
                    "w": (max(xs) - min(xs)) / iw,
                    "h": (max(ys) - min(ys)) / ih,
                }
            except Exception:
                pass
            out.append({"format": str(r.format), "data": r.text, "bounding_box": bbox})
        return out
    except ImportError:
        logger.warning("zxing-cpp not installed; cannot decode barcodes")
        return []
    except Exception as exc:
        logger.warning("zxing-cpp decoding failed: %s", exc)
        return []


def _run_pyzbar(img_bytes: bytes) -> list[dict]:
    """Decode barcodes using pyzbar (requires libzbar system library)."""
    try:
        from pyzbar import pyzbar  # noqa: PLC0415
        from PIL import Image  # noqa: PLC0415

        img = Image.open(io.BytesIO(img_bytes))
        iw, ih = img.size
        decoded = pyzbar.decode(img)
        out = []
        for d in decoded:
            bbox = None
            try:
                r = d.rect
                bbox = {"x": r.left / iw, "y": r.top / ih, "w": r.width / iw, "h": r.height / ih}
            except Exception:
                pass
            out.append({"format": d.type, "data": d.data.decode("utf-8", errors="replace"), "bounding_box": bbox})
        return out
    except ImportError:
        logger.warning("pyzbar not installed; cannot decode barcodes")
        return []
    except Exception as exc:
        logger.warning("pyzbar decoding failed: %s", exc)
        return []


def _run_opencv(img_bytes: bytes) -> list[dict]:
    """Decode QR codes using OpenCV's built-in QR detector (QR only)."""
    try:
        import cv2  # noqa: PLC0415
        import numpy as np  # noqa: PLC0415

        nparr = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return []

        ih, iw = img.shape[:2]
        qr = cv2.QRCodeDetector()
        data, _, _ = qr.detectAndDecode(img)
        if not data:
            return []

        bbox = None
        try:
            ok, pts = qr.detect(img)
            if ok and pts is not None:
                pts = pts[0]
                xs, ys = pts[:, 0], pts[:, 1]
                bbox = {
                    "x": float(xs.min()) / iw,
                    "y": float(ys.min()) / ih,
                    "w": float(xs.max() - xs.min()) / iw,
                    "h": float(ys.max() - ys.min()) / ih,
                }
        except Exception:
            pass
        return [{"format": "QR_CODE", "data": data, "bounding_box": bbox}]
    except ImportError:
        logger.warning("opencv-python not installed; cannot decode barcodes")
        return []
    except Exception as exc:
        logger.warning("OpenCV QR detection failed: %s", exc)
        return []
