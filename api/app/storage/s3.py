"""
S3-compatible storage helpers.

Presigned URL generation uses a pure-Python AWS Signature V4 implementation
so it involves no network calls and no boto3 credential-resolution overhead.
boto3 is kept only for actual data operations (get, put, delete, list).
"""
import hashlib
import hmac
from datetime import datetime, timezone
from functools import lru_cache
from urllib.parse import quote, urlparse

import boto3
from botocore.client import Config

from app.config import settings


# ---------------------------------------------------------------------------
# boto3 client — used for real S3 operations only (get/put/delete/list)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def get_s3_client():
    return boto3.client(
        "s3",
        endpoint_url=settings.storage_endpoint,
        aws_access_key_id=settings.storage_access_key_id,
        aws_secret_access_key=settings.storage_secret_access_key,
        region_name=settings.storage_region,
        config=Config(
            signature_version="s3v4",
            connect_timeout=5,
            read_timeout=30,
            retries={"max_attempts": 1},
        ),
    )


# ---------------------------------------------------------------------------
# Pure-Python AWS Signature V4 presigned URL generator
# No network calls — pure HMAC-SHA256 math.
# ---------------------------------------------------------------------------

def _hmac_sha256(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _presign_url(
    http_method: str,
    object_key: str,
    expires_in: int,
    content_type: str | None = None,
    stable: bool = False,
) -> str:
    """Build a path-style presigned URL using AWS Signature Version 4.

    When stable=True the timestamp is snapped to the current UTC hour so all
    calls within the same hour produce an identical URL.  The browser can then
    disk-cache the response across page loads because the URL never changes
    within the hour.  expires_in should be at least 2× the window (2 hours)
    so URLs remain valid even when generated near the end of a window.
    """
    endpoint   = settings.storage_endpoint.rstrip("/")
    bucket     = settings.storage_bucket_name
    access_key = settings.storage_access_key_id
    secret_key = settings.storage_secret_access_key
    region     = settings.storage_region or "us-east-1"

    host = urlparse(endpoint).netloc

    now = datetime.now(timezone.utc)
    if stable:
        # Snap to the start of the current UTC hour
        now = now.replace(minute=0, second=0, microsecond=0)
    datestamp  = now.strftime("%Y%m%d")
    amz_date   = now.strftime("%Y%m%dT%H%M%SZ")
    scope      = f"{datestamp}/{region}/s3/aws4_request"
    credential = f"{access_key}/{scope}"

    # Path-style URL: /<bucket>/<key>
    canonical_uri = "/" + bucket + "/" + quote(object_key, safe="/-._~")

    # Signed headers: always include host; include content-type for PUT uploads
    if content_type:
        signed_headers    = "content-type;host"
        canonical_headers = f"content-type:{content_type}\nhost:{host}\n"
    else:
        signed_headers    = "host"
        canonical_headers = f"host:{host}\n"

    # Query string params (must be sorted and percent-encoded)
    raw_params = [
        ("X-Amz-Algorithm",    "AWS4-HMAC-SHA256"),
        ("X-Amz-Credential",   credential),
        ("X-Amz-Date",         amz_date),
        ("X-Amz-Expires",      str(expires_in)),
        ("X-Amz-SignedHeaders", signed_headers),
    ]
    canonical_qs = "&".join(
        f"{quote(k, safe='')}={quote(v, safe='')}"
        for k, v in sorted(raw_params)
    )

    canonical_request = "\n".join([
        http_method,
        canonical_uri,
        canonical_qs,
        canonical_headers,
        signed_headers,
        "UNSIGNED-PAYLOAD",
    ])

    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256",
        amz_date,
        scope,
        hashlib.sha256(canonical_request.encode("utf-8")).hexdigest(),
    ])

    # Derive the signing key
    k_date    = _hmac_sha256(f"AWS4{secret_key}".encode("utf-8"), datestamp)
    k_region  = _hmac_sha256(k_date,    region)
    k_service = _hmac_sha256(k_region,  "s3")
    k_signing = _hmac_sha256(k_service, "aws4_request")

    signature = hmac.new(k_signing, string_to_sign.encode("utf-8"), hashlib.sha256).hexdigest()

    return f"{endpoint}{canonical_uri}?{canonical_qs}&X-Amz-Signature={signature}"


# ---------------------------------------------------------------------------
# Public presigned URL helpers
# ---------------------------------------------------------------------------

def generate_presigned_upload_url(object_key: str, content_type: str, expires_in: int = 3600) -> str:
    return _presign_url("PUT", object_key, expires_in, content_type=content_type)


def generate_presigned_download_url(object_key: str, expires_in: int = 7200) -> str:
    # stable=True snaps the timestamp to the hour boundary so repeated calls
    # produce the same URL → browser disk-cache hits on every page reload.
    # Default expiry is 2 h so URLs generated at :59 are still valid next hour.
    return _presign_url("GET", object_key, expires_in, stable=True)


# ---------------------------------------------------------------------------
# Actual S3 data operations (use boto3)
# ---------------------------------------------------------------------------

def get_object_bytes(object_key: str, byte_range: str | None = None) -> bytes:
    """Download object bytes from storage. Use byte_range for partial reads, e.g. 'bytes=0-65535'."""
    client = get_s3_client()
    kwargs: dict = {"Bucket": settings.storage_bucket_name, "Key": object_key}
    if byte_range:
        kwargs["Range"] = byte_range
    response = client.get_object(**kwargs)
    return response["Body"].read()


def put_object_bytes(object_key: str, data: bytes, content_type: str = "application/octet-stream") -> None:
    """Upload raw bytes to storage."""
    client = get_s3_client()
    client.put_object(
        Bucket=settings.storage_bucket_name,
        Key=object_key,
        Body=data,
        ContentType=content_type,
    )


def delete_object(object_key: str) -> None:
    client = get_s3_client()
    client.delete_object(Bucket=settings.storage_bucket_name, Key=object_key)
