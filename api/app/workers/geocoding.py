"""Location geocoding worker.

Reads GPS coordinates from media.exif_data and resolves them to a
human-readable location label (e.g. "Houston, Texas").

Primary: reverse_geocoder (offline, instant, city/country granularity)
Fallback: Nominatim (online, better labels, 1 req/s rate limit per ToS)
"""
import logging
import time
from datetime import datetime, timezone

import requests
from sqlalchemy.orm import Session

from app.models.media import Media
from app.worker_config import get_provider, get_section, is_enabled

logger = logging.getLogger(__name__)

NOMINATIM_URL = "https://nominatim.openstreetmap.org/reverse"


def run(media_id: str, db: Session) -> None:
    if not is_enabled("geocoding"):
        logger.debug("Geocoding disabled, skipping media %s", media_id)
        return

    media = db.query(Media).filter(Media.id == media_id).first()
    if media is None:
        logger.warning("Media %s not found", media_id)
        return

    if media.location_processed_at is not None:
        logger.debug("Media %s already geocoded, skipping", media_id)
        return

    if not media.exif_data:
        logger.debug("Media %s has no exif_data, skipping geocoding", media_id)
        media.location_processed_at = datetime.now(timezone.utc)
        db.commit()
        return

    gps = media.exif_data.get("GPSInfo")
    if not gps:
        logger.debug("Media %s has no GPSInfo, skipping geocoding", media_id)
        media.location_processed_at = datetime.now(timezone.utc)
        db.commit()
        return

    lat, lon = _parse_gps(gps)
    if lat is None or lon is None:
        logger.debug("Media %s: could not parse GPS coordinates", media_id)
        media.location_processed_at = datetime.now(timezone.utc)
        db.commit()
        return

    label = _geocode(lat, lon)
    if label:
        media.location_label = label
        logger.info("Media %s geocoded to: %s", media_id, label)
    else:
        logger.debug("Media %s: geocoding returned no result", media_id)

    media.location_processed_at = datetime.now(timezone.utc)
    db.commit()


def _parse_gps(gps: dict) -> tuple[float | None, float | None]:
    """Parse GPS coordinates from exif GPSInfo dict.

    Handles two formats:
    - DMS: GPSLatitude = [degrees, minutes, seconds] (list of floats)
    - Decimal: GPSLatitude = float (already decimal degrees)
    """
    try:
        raw_lat = gps.get("GPSLatitude")
        raw_lon = gps.get("GPSLongitude")
        lat_ref = gps.get("GPSLatitudeRef", "N")
        lon_ref = gps.get("GPSLongitudeRef", "E")

        if raw_lat is None or raw_lon is None:
            return None, None

        # DMS format: list of [degrees, minutes, seconds]
        if isinstance(raw_lat, (list, tuple)):
            lat = raw_lat[0] + raw_lat[1] / 60.0 + raw_lat[2] / 3600.0
        else:
            lat = float(raw_lat)

        if isinstance(raw_lon, (list, tuple)):
            lon = raw_lon[0] + raw_lon[1] / 60.0 + raw_lon[2] / 3600.0
        else:
            lon = float(raw_lon)

        if str(lat_ref).upper() == "S":
            lat = -lat
        if str(lon_ref).upper() == "W":
            lon = -lon

        # Sanity check
        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            return None, None

        return lat, lon
    except Exception as exc:
        logger.warning("Failed to parse GPS data: %s", exc)
        return None, None


def _geocode(lat: float, lon: float) -> str | None:
    """Resolve (lat, lon) to a human-readable label using the configured provider."""
    cfg = get_section("geocoding")
    provider = get_provider("geocoding")

    if provider == "reverse_geocoder":
        label = _reverse_geocoder(lat, lon)
        # Optionally fall back to Nominatim if reverse_geocoder result is poor
        if not label and cfg.get("nominatim_fallback", True):
            label = _nominatim(lat, lon, cfg)
        return label

    if provider == "nominatim":
        return _nominatim(lat, lon, cfg)

    logger.warning("Unknown geocoding provider: %s", provider)
    return None


def _reverse_geocoder(lat: float, lon: float) -> str | None:
    """Offline reverse geocoding via the reverse_geocoder package."""
    try:
        import reverse_geocoder as rg  # noqa: PLC0415 — import inside function intentional

        results = rg.search((lat, lon), verbose=False)
        if not results:
            return None

        r = results[0]
        city = r.get("name", "")
        state = r.get("admin1", "")   # state / province
        country = r.get("cc", "")

        if city and state:
            return f"{city}, {state}"
        if city and country:
            return f"{city}, {country}"
        return None
    except ImportError:
        logger.warning("reverse_geocoder package not installed; skipping offline geocoding")
        return None
    except Exception as exc:
        logger.warning("reverse_geocoder failed: %s", exc)
        return None


def _nominatim(lat: float, lon: float, cfg: dict) -> str | None:
    """Online reverse geocoding via Nominatim (respect 1 req/s ToS rate limit)."""
    rate_limit = cfg.get("nominatim_rate_limit_seconds", 1.0)
    user_agent = cfg.get("nominatim_user_agent", "my-photos/1.0")

    time.sleep(rate_limit)
    try:
        resp = requests.get(
            NOMINATIM_URL,
            params={"lat": lat, "lon": lon, "format": "json", "zoom": 10},
            headers={"Accept-Language": "en", "User-Agent": user_agent},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
        addr = data.get("address", {})
        city = (
            addr.get("city")
            or addr.get("town")
            or addr.get("village")
            or addr.get("county")
        )
        state = addr.get("state")
        if city and state:
            return f"{city}, {state}"
        return data.get("display_name")
    except Exception as exc:
        logger.warning("Nominatim request failed: %s", exc)
        return None
