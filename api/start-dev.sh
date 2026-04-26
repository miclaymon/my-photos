#!/usr/bin/env bash
set -euo pipefail

# ─── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
YEL='\033[0;33m'
GRN='\033[0;32m'
CYN='\033[0;36m'
BLD='\033[1m'
RST='\033[0m'

error() { echo -e "${RED}${BLD}  ✗${RST} $*" >&2; }
warn()  { echo -e "${YEL}${BLD}  ⚠${RST} $*"; }
info()  { echo -e "${CYN}${BLD}  →${RST} $*"; }

# Run from the api/ directory
cd "$(dirname "$0")"

# ─── sanity checks ────────────────────────────────────────────────────────────
if [[ ! -d .venv ]]; then
  error ".venv not found. Run ./setup.sh first."
  exit 1
fi

if [[ ! -f .env ]]; then
  error ".env not found. Run ./setup.sh first."
  exit 1
fi

# shellcheck disable=SC1091
source .venv/bin/activate
# shellcheck disable=SC1091
source .env 2>/dev/null || true

if [[ -z "${DATABASE_URL:-}" || "${DATABASE_URL}" == *"change-me"* ]]; then
  error "DATABASE_URL is not configured in .env. Run ./setup.sh first."
  exit 1
fi

if [[ -z "${SECRET_KEY:-}" || "${SECRET_KEY}" == "change-me-to-a-random-secret" ]]; then
  error "SECRET_KEY is not configured in .env. Run ./setup.sh first."
  exit 1
fi

# ─── apply any pending migrations before starting ─────────────────────────────
info "Applying any pending migrations…"
python -m alembic upgrade head

# ─── start ────────────────────────────────────────────────────────────────────
HOST="${API_HOST:-127.0.0.1}"
PORT="${API_PORT:-8000}"

info "Starting FastAPI dev server on http://${HOST}:${PORT} …"
info "API docs available at http://${HOST}:${PORT}/docs"
echo ""
uvicorn main:app --host "$HOST" --port "$PORT" --reload
