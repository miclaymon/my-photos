"""SQLite-backed response cache for gallery list endpoints.

Single shared connection with WAL mode.  All writes are serialised through
_lock; reads can race safely because SQLite WAL allows concurrent readers.
"""
import hashlib
import json
import sqlite3
import threading
import time
from typing import Optional

_conn: Optional[sqlite3.Connection] = None
_lock = threading.Lock()

_MEDIA_TTL    = 5  * 60   # 5 min  — gallery item list
_TIMELINE_TTL = 10 * 60   # 10 min — per-month bucket counts


def _get_conn(db_path: str) -> sqlite3.Connection:
    global _conn
    if _conn is None:
        with _lock:
            if _conn is None:
                c = sqlite3.connect(db_path, check_same_thread=False)
                c.execute("PRAGMA journal_mode=WAL")
                c.execute("""
                    CREATE TABLE IF NOT EXISTS response_cache (
                        key        TEXT    PRIMARY KEY,
                        library_id TEXT    NOT NULL,
                        path       TEXT    NOT NULL DEFAULT '',
                        body       TEXT    NOT NULL,
                        cached_at  REAL    NOT NULL,
                        ttl        INTEGER NOT NULL
                    )
                """)
                # Add path column to existing DBs that were created before this column existed
                try:
                    c.execute("ALTER TABLE response_cache ADD COLUMN path TEXT NOT NULL DEFAULT ''")
                except sqlite3.OperationalError:
                    pass  # Column already exists
                c.commit()
                _conn = c
    return _conn


def make_key(user_id: str, path: str, params: dict) -> str:
    """Deterministic SHA-256 key from (user, path, sorted query params)."""
    qs = "&".join(f"{k}={v}" for k, v in sorted(params.items()) if v is not None)
    return hashlib.sha256(f"{user_id}:{path}?{qs}".encode()).hexdigest()


def get(db_path: str, key: str) -> Optional[dict]:
    conn = _get_conn(db_path)
    row = conn.execute(
        "SELECT body, cached_at, ttl FROM response_cache WHERE key = ?", (key,)
    ).fetchone()
    if row is None:
        return None
    body, cached_at, ttl = row
    if time.time() - cached_at > ttl:
        with _lock:
            conn.execute("DELETE FROM response_cache WHERE key = ?", (key,))
            conn.commit()
        return None
    return json.loads(body)


def set(db_path: str, key: str, library_id: str, data: dict, ttl: int, path: str = "") -> None:  # noqa: A001
    conn = _get_conn(db_path)
    with _lock:
        conn.execute(
            "INSERT OR REPLACE INTO response_cache "
            "(key, library_id, path, body, cached_at, ttl) VALUES (?, ?, ?, ?, ?, ?)",
            (key, library_id, path, json.dumps(data), time.time(), ttl),
        )
        conn.commit()


def invalidate_library(db_path: str, library_id: str) -> None:
    conn = _get_conn(db_path)
    with _lock:
        conn.execute("DELETE FROM response_cache WHERE library_id = ?", (library_id,))
        conn.commit()


def invalidate_key(db_path: str, key: str) -> None:
    conn = _get_conn(db_path)
    with _lock:
        conn.execute("DELETE FROM response_cache WHERE key = ?", (key,))
        conn.commit()


def clear_all(db_path: str) -> int:
    conn = _get_conn(db_path)
    with _lock:
        cur = conn.execute("DELETE FROM response_cache")
        conn.commit()
        return cur.rowcount


def list_entries(db_path: str) -> list[dict]:
    """Return metadata for all cache rows (no body — just stats for the admin UI)."""
    conn = _get_conn(db_path)
    now = time.time()
    rows = conn.execute(
        "SELECT key, library_id, path, cached_at, ttl, length(body) FROM response_cache ORDER BY cached_at DESC"
    ).fetchall()
    result = []
    for key, library_id, path, cached_at, ttl, body_len in rows:
        age = now - cached_at
        result.append({
            "key":           key,
            "library_id":    library_id,
            "path":          path,
            "cached_at":     cached_at,
            "ttl":           ttl,
            "age_seconds":   round(age),
            "ttl_remaining": max(0, round(ttl - age)),
            "body_bytes":    body_len,
            "expired":       age > ttl,
        })
    return result


MEDIA_TTL    = _MEDIA_TTL
TIMELINE_TTL = _TIMELINE_TTL
