"""OCR worker — extracts text from images.

Providers:
  pytesseract — system Tesseract, lightweight, good for clean text
  easyocr     — neural network, better for complex layouts/mixed languages
"""
import io
import logging
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.media import Media, MediaOcr
from app.worker_config import get_provider, get_section, is_enabled
from app.storage.s3 import get_object_bytes

logger = logging.getLogger(__name__)

# Module-level cache for easyocr reader (expensive to load)
_easyocr_reader = None


def run(media_id: str, db: Session) -> None:
    if not is_enabled("ocr"):
        logger.debug("OCR disabled, skipping media %s", media_id)
        return

    media = db.query(Media).filter(Media.id == media_id).first()
    if media is None:
        logger.warning("Media %s not found", media_id)
        return

    if media.ocr_processed_at is not None:
        logger.debug("Media %s already OCR-processed, skipping", media_id)
        return

    if not (media.content_type or "").startswith("image/"):
        logger.debug("Media %s is not an image (%s), skipping OCR", media_id, media.content_type)
        media.ocr_processed_at = datetime.now(timezone.utc)
        db.commit()
        return

    img_bytes = get_object_bytes(media.object_key)
    provider = get_provider("ocr")
    cfg = get_section("ocr")

    if provider == "pytesseract":
        from PIL import Image  # noqa: PLC0415

        img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
        _run_pytesseract(img, media_id, media, db, cfg)
    elif provider == "easyocr":
        _run_easyocr(img_bytes, media_id, media, db, cfg)
    else:
        logger.warning("Unknown OCR provider: %s", provider)
        media.ocr_processed_at = datetime.now(timezone.utc)
        db.commit()


# easyocr uses 2-letter ISO codes ("en"), tesseract uses 3-letter ("eng").
# This map lets both providers share the same config key.
_EASYOCR_TO_TESSERACT = {
    "en": "eng", "fr": "fra", "de": "deu", "es": "spa",
    "it": "ita", "pt": "por", "zh": "chi_sim", "ja": "jpn", "ko": "kor",
}


def _run_pytesseract(img, media_id: str, media: Media, db: Session, cfg: dict) -> None:
    import pytesseract  # noqa: PLC0415

    raw_lang = cfg.get("language", "eng")
    lang = _EASYOCR_TO_TESSERACT.get(raw_lang, raw_lang)   # "en" → "eng" etc.
    data = pytesseract.image_to_data(
        img,
        lang=lang,
        output_type=pytesseract.Output.DICT,
    )

    # Filter to words with confidence > 30
    words = [
        w
        for w, c in zip(data["text"], data["conf"])
        if isinstance(c, (int, float)) and c > 30 and w.strip()
    ]
    text = " ".join(words)

    positive_confs = [c for c in data["conf"] if isinstance(c, (int, float)) and c > 0]
    avg_conf = sum(positive_confs) / max(1, len(positive_confs))

    _upsert_ocr(media_id, media, text, avg_conf, db)


def _run_easyocr(img_bytes: bytes, media_id: str, media: Media, db: Session, cfg: dict) -> None:
    global _easyocr_reader

    lang = cfg.get("language", "en")

    if _easyocr_reader is None:
        import easyocr  # noqa: PLC0415

        _easyocr_reader = easyocr.Reader([lang], gpu=False)

    results = _easyocr_reader.readtext(img_bytes)  # accepts raw bytes
    text = " ".join(r[1] for r in results)
    # easyocr returns np.float64 — cast to plain Python float so PostgreSQL
    # doesn't reject it with "schema 'np' does not exist"
    avg_conf = float(sum(float(r[2]) for r in results) / max(1, len(results)))

    _upsert_ocr(media_id, media, text, avg_conf, db)


def _upsert_ocr(media_id: str, media: Media, text: str, avg_conf: float, db: Session) -> None:
    """Insert or update the MediaOcr row, then stamp the media record."""
    from sqlalchemy.dialects.postgresql import insert as pg_insert  # noqa: PLC0415

    stmt = (
        pg_insert(MediaOcr.__table__)
        .values(media_id=media_id, text=text, confidence=avg_conf)
        .on_conflict_do_update(
            index_elements=["media_id"],
            set_={"text": text, "confidence": avg_conf},
        )
    )
    db.execute(stmt)

    media.text = text
    media.ocr_processed_at = datetime.now(timezone.utc)
    db.commit()
    logger.info("Media %s OCR complete: %d words, avg_conf=%.1f", media_id, len(text.split()), avg_conf)
