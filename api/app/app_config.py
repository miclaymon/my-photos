"""
Application runtime configuration loader.

Reads and writes api/config.json. Config is re-read from disk at most every
30 seconds so route handlers can call get_cache_config() on every request
without triggering file I/O on each call.

Usage:
    from app.app_config import get_config, get_cache_config, update_config
"""
import json
import time
from pathlib import Path
from typing import Any

_CONFIG_PATH = Path(__file__).parent.parent / "config.json"

# Keys that should never be written back
_COMMENT_KEYS = {"_comment", "_level_options", "_level_note"}

# In-memory TTL cache so hot paths don't hit disk on every request
_cache: dict = {}
_cache_time: float = 0.0
_CACHE_TTL = 30.0  # seconds between disk re-reads


def get_config() -> dict[str, Any]:
    """Return the full config dict, re-read from disk at most every 30 s."""
    global _cache, _cache_time
    now = time.monotonic()
    if _cache and (now - _cache_time) < _CACHE_TTL:
        return _cache
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        _cache = json.load(f)
    _cache_time = now
    return _cache


def get_section(section: str) -> dict[str, Any]:
    cfg = get_config()
    if section not in cfg:
        raise KeyError(f"Unknown config section: {section!r}")
    return cfg[section]


def get_cache_config() -> dict[str, Any]:
    try:
        return get_section("cache")
    except KeyError:
        return {}


def update_config(patch: dict[str, Any]) -> dict[str, Any]:
    """Merge *patch* into the on-disk config and write it back atomically.

    Only provided keys are updated; annotation keys (_comment, _level_options,
    _level_note) are preserved and cannot be changed via this function.
    Returns the updated full config.
    """
    cfg = get_config()
    for section, values in patch.items():
        if section not in cfg:
            raise ValueError(f"Unknown section: {section!r}")
        if not isinstance(values, dict):
            raise ValueError(f"Section value must be a dict, got {type(values).__name__}")
        for key, val in values.items():
            if key in _COMMENT_KEYS:
                continue
            cfg[section][key] = val

    tmp = _CONFIG_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    tmp.replace(_CONFIG_PATH)

    # Refresh the in-memory cache immediately so the next call returns the new values
    global _cache, _cache_time
    _cache = cfg
    _cache_time = time.monotonic()
    return cfg
