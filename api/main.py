import logging
import logging.handlers
import os
import threading
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.database import engine, Base
from app.middleware import LoopbackChunkMiddleware
from app.routes import auth, library, media, albums, subjects, storage, admin
from app.app_config import get_cache_config
from app.dependencies import get_current_user


# ── Logging setup ─────────────────────────────────────────────────────────────
# Write to both stdout (uvicorn already does this) and a rotating file so logs
# are available for debugging without having to watch the terminal.

_LOG_DIR  = os.path.join(os.path.dirname(__file__), "logs")
_LOG_FILE = os.path.join(_LOG_DIR, "api.log")

os.makedirs(_LOG_DIR, exist_ok=True)

_file_handler = logging.handlers.RotatingFileHandler(
    _LOG_FILE,
    maxBytes=10 * 1024 * 1024,   # 10 MB per file
    backupCount=5,
    encoding="utf-8",
)
_file_handler.setFormatter(logging.Formatter(
    "%(asctime)s  %(levelname)-8s  %(name)s  %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
))
_file_handler.setLevel(logging.DEBUG)

# Attach to the root logger so every module's logger writes here
logging.getLogger().addHandler(_file_handler)
logging.getLogger().setLevel(logging.DEBUG)

logger = logging.getLogger(__name__)


def _start_job_runner() -> threading.Thread:
    """Launch the background job runner in a daemon thread.

    Using a daemon thread means it is automatically killed when the main process
    (uvicorn worker) exits — no manual cleanup needed. On uvicorn --reload the
    old worker process is killed, so the old thread dies, and the new worker
    starts a fresh thread.
    """
    from app.workers.runner import run_loop, _runner_cfg

    def _target() -> None:
        # Limit PyTorch CPU threads inside the runner thread so ML workers
        # don't saturate all cores.  The main request-handling threads are
        # unaffected because torch.set_num_threads() is per-thread in PyTorch.
        cfg = _runner_cfg()
        n_threads = int(cfg.get("torch_cpu_threads", 0))
        if n_threads > 0:
            try:
                import torch  # noqa: PLC0415
                torch.set_num_threads(n_threads)
                logger.info("PyTorch threads limited to %d in job runner", n_threads)
            except ImportError:
                pass  # torch not installed; ML workers that need it will handle this

        try:
            run_loop()
        except Exception:
            logger.exception("Background job runner exited unexpectedly")

    t = threading.Thread(target=_target, name="job-runner", daemon=True)
    t.start()
    logger.info("Background job runner started (thread: %s)", t.name)
    return t


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Warn about missing optional packages before any jobs run
    from app.workers.checks import warn_missing_packages
    warn_missing_packages()

    _start_job_runner()
    yield


app = FastAPI(
    title="My Photos API",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Added AFTER CORSMiddleware: Starlette stacks middleware so the last add_middleware
# call becomes the outermost layer (first to see requests, last to see responses).
# Response flow: app → CORS (adds headers) → LoopbackChunk (re-chunks) → uvicorn.
app.add_middleware(LoopbackChunkMiddleware)

app.include_router(auth.router,     prefix="/api/v1/auth",     tags=["auth"])
app.include_router(library.router,  prefix="/api/v1/library",  tags=["library"])
app.include_router(media.router,    prefix="/api/v1/media",    tags=["media"])
app.include_router(albums.router,   prefix="/api/v1/albums",   tags=["albums"])
app.include_router(subjects.router, prefix="/api/v1/subjects", tags=["subjects"])
app.include_router(storage.router,  prefix="/api/v1/storage",  tags=["storage"])
app.include_router(admin.router,    prefix="/api/v1/admin",    tags=["admin"])


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/v1/app-config/client")
def client_app_config(current_user=Depends(get_current_user)):
    """Public subset of config.json that the web client needs (no admin required)."""
    try:
        cache = get_cache_config()
        level = cache.get("level", "high")
        return {
            "cache_level": level,
            "preload_hints": level == "extreme",
        }
    except Exception:
        return {"cache_level": "high", "preload_hints": False}
