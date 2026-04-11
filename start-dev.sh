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

# ─── sanity checks ────────────────────────────────────────────────────────────
if [[ ! -d node_modules ]]; then
  error "node_modules not found. Run ./setup.sh first."
  exit 1
fi

if [[ ! -f .env ]]; then
  error ".env not found. Run ./setup.sh first."
  exit 1
fi

source .env 2>/dev/null || true

if [[ -z "${NUXT_SESSION_PASSWORD:-}" || "${NUXT_SESSION_PASSWORD}" == "change-me-to-a-random-32-char-string" ]]; then
  error "NUXT_SESSION_PASSWORD is not set in .env. Run ./setup.sh to configure it."
  exit 1
fi

DB_PATH="${DATABASE_PATH:-./data/photos.db}"
if [[ ! -f "$DB_PATH" ]]; then
  warn "Database not found at ${DB_PATH}. Run ./setup.sh to initialise it."
  warn "Starting anyway — the server will create it on first request."
fi

# ─── start ────────────────────────────────────────────────────────────────────
info "Starting Nuxt dev server…"
npm run dev
