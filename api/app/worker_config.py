"""
Worker configuration loader.

Reads and writes api/worker_config.json. All worker scripts and admin routes
use this module to discover which provider is active for each service.

Usage:
    from app.worker_config import get_config, update_config, get_provider

    cfg = get_config()
    ocr_provider = get_provider("ocr")   # e.g. "pytesseract"
"""
import json
import os
from pathlib import Path
from typing import Any

# worker_config.json lives next to main.py at the api/ root
_CONFIG_PATH = Path(__file__).parent.parent / "worker_config.json"

# Keys that should never be written back (annotation-only)
_COMMENT_KEYS = {"_comment", "_provider_options"}


def get_config() -> dict[str, Any]:
    """Return the full config dict (parsed from disk each call — intentionally not cached)."""
    with open(_CONFIG_PATH, encoding="utf-8") as f:
        return json.load(f)


def get_section(section: str) -> dict[str, Any]:
    """Return a single section (e.g. 'ocr', 'face_detection')."""
    cfg = get_config()
    if section not in cfg:
        raise KeyError(f"Unknown config section: {section!r}")
    return cfg[section]


def get_provider(section: str) -> str:
    """Shortcut: return the active provider name for a section."""
    return get_section(section).get("provider", "disabled")


def update_config(patch: dict[str, Any]) -> dict[str, Any]:
    """
    Merge *patch* into the on-disk config and write it back.

    *patch* mirrors the config structure — only provided keys are updated.
    Comment/annotation keys (_comment, _provider_options) are preserved and
    cannot be changed via this function.

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
                continue  # never overwrite annotation keys
            cfg[section][key] = val

    # Write atomically (write to .tmp, then rename)
    tmp = _CONFIG_PATH.with_suffix(".json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cfg, f, indent=2)
        f.write("\n")
    tmp.replace(_CONFIG_PATH)

    return cfg


def is_enabled(section: str) -> bool:
    """Return True if the section's provider is not 'disabled'."""
    return get_provider(section) != "disabled"
