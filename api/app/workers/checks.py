"""Startup dependency checks.

Called once from main.py during lifespan so missing packages are logged
as warnings before a job actually runs and fails mid-flight.
"""
import logging

logger = logging.getLogger(__name__)


def warn_missing_packages() -> None:
    """Inspect worker_config.json and warn about any uninstalled packages."""
    try:
        from app.worker_config import get_provider, is_enabled  # noqa: PLC0415
    except Exception as exc:
        logger.error("Could not load worker_config: %s", exc)
        return

    _check_section("object_detection", get_provider("object_detection"), is_enabled("object_detection"))
    _check_section("face_detection",   get_provider("face_detection"),   is_enabled("face_detection"))
    _check_section("ocr",              get_provider("ocr"),              is_enabled("ocr"))
    _check_section("geocoding",        get_provider("geocoding"),        is_enabled("geocoding"))
    _check_section("barcode",          get_provider("barcode"),          is_enabled("barcode"))


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _try_import(module: str, install_name: str | None = None) -> bool:
    """Attempt to import *module*; log a warning and return False on failure."""
    try:
        __import__(module)
        return True
    except ImportError:
        pkg = install_name or module
        logger.warning(
            "Missing package '%s' — install with: pip install %s",
            module, pkg,
        )
        return False


def _check_section(section: str, provider: str, enabled: bool) -> None:
    if not enabled:
        return

    checkers = {
        "object_detection": _check_object_detection,
        "face_detection":   _check_face_detection,
        "ocr":              _check_ocr,
        "geocoding":        _check_geocoding,
        "barcode":          _check_barcode,
    }
    fn = checkers.get(section)
    if fn:
        fn(provider)


def _check_object_detection(provider: str) -> None:
    _try_import("PIL", "Pillow")
    if provider == "onnxruntime":
        _try_import("onnxruntime")
    elif provider == "ultralytics":
        _try_import("ultralytics")


def _check_face_detection(provider: str) -> None:
    if provider == "insightface":
        _try_import("insightface")
        _try_import("cv2", "opencv-python-headless")
    elif provider == "face_recognition":
        _try_import("face_recognition")


def _check_ocr(provider: str) -> None:
    if provider == "easyocr":
        _try_import("easyocr")
    elif provider == "pytesseract":
        _try_import("pytesseract")
    elif provider == "surya":
        _try_import("surya", "surya-ocr")


def _check_geocoding(provider: str) -> None:
    if provider == "reverse_geocoder":
        _try_import("reverse_geocoder")
    # nominatim uses `requests` which is a hard dep — no check needed


def _check_barcode(provider: str) -> None:
    if provider == "zxing-cpp":
        _try_import("zxingcpp", "zxing-cpp")
    elif provider == "pyzbar":
        _try_import("pyzbar.pyzbar", "pyzbar")
    elif provider == "opencv":
        _try_import("cv2", "opencv-python-headless")
