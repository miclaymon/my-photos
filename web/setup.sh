#!/usr/bin/env bash
set -euo pipefail

# ─── colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
YEL='\033[0;33m'
GRN='\033[0;32m'
CYN='\033[0;36m'
BLD='\033[1m'
RST='\033[0m'

info()    { echo -e "${CYN}${BLD}  →${RST} $*"; }
success() { echo -e "${GRN}${BLD}  ✓${RST} $*"; }
warn()    { echo -e "${YEL}${BLD}  ⚠${RST} $*"; }
error()   { echo -e "${RED}${BLD}  ✗${RST} $*" >&2; }
header()  { echo -e "\n${BLD}$*${RST}"; }

# Run from the web/ directory
cd "$(dirname "$0")"

# ─── 1. prerequisites ─────────────────────────────────────────────────────────
header "Checking prerequisites…"

if ! command -v node &>/dev/null; then
  error "Node.js is not installed. Install it from https://nodejs.org (v20+ recommended)."
  exit 1
fi

NODE_VERSION=$(node -e "process.stdout.write(process.versions.node)")
NODE_MAJOR=${NODE_VERSION%%.*}
if (( NODE_MAJOR < 20 )); then
  warn "Node.js v${NODE_VERSION} detected. v20+ is recommended."
else
  success "Node.js v${NODE_VERSION}"
fi

if ! command -v npm &>/dev/null; then
  error "npm is not installed."
  exit 1
fi
success "npm $(npm --version)"

# ─── 2. .env file ─────────────────────────────────────────────────────────────
header "Environment configuration…"

if [[ ! -f .env ]]; then
  info "No .env file found — creating one from .env.example…"
  cp .env.example .env

  # Generate a random session password automatically
  if command -v openssl &>/dev/null; then
    SECRET=$(openssl rand -base64 48 | tr -d '\n')
    # Use a delimiter unlikely to appear in the base64 output
    sed -i "s|change-me-to-a-random-32-char-string|${SECRET}|" .env
    success ".env created with a generated NUXT_SESSION_PASSWORD"
  else
    warn ".env created but NUXT_SESSION_PASSWORD was not auto-generated (openssl not found)."
    warn "Edit .env and set a strong random value before running the app."
  fi
else
  success ".env already exists"
fi

# Validate required variables
source .env 2>/dev/null || true

MISSING=()
[[ -z "${NUXT_SESSION_PASSWORD:-}" ]] && MISSING+=("NUXT_SESSION_PASSWORD")
[[ "${NUXT_SESSION_PASSWORD:-}" == "change-me-to-a-random-32-char-string" ]] && MISSING+=("NUXT_SESSION_PASSWORD (still set to placeholder)")

if [[ ${#MISSING[@]} -gt 0 ]]; then
  error "The following required environment variables are missing or unset in .env:"
  for v in "${MISSING[@]}"; do
    error "  • $v"
  done
  exit 1
fi

if [[ ${#NUXT_SESSION_PASSWORD} -lt 32 ]]; then
  error "NUXT_SESSION_PASSWORD must be at least 32 characters."
  exit 1
fi

if [[ -z "${DATA_API_URL:-}" ]]; then
  warn "DATA_API_URL is not set in .env — the web client will not be able to reach the API server."
  warn "Set DATA_API_URL to the FastAPI server URL (e.g. http://localhost:8000) and re-run."
fi
success "Environment variables look good"

# ─── 3. install dependencies ──────────────────────────────────────────────────
header "Installing dependencies…"
npm install
success "Dependencies installed"

# ─── done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GRN}${BLD}  Web client setup complete!${RST}"
echo -e "  Make sure the API server is running: ${CYN}cd ../api && ./start-dev.sh${RST}"
echo -e "  Then run ${CYN}./start-dev.sh${RST} to start the web dev server."
echo ""
