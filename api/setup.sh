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

# Run from the api/ directory
cd "$(dirname "$0")"

# ─── 1. prerequisites ─────────────────────────────────────────────────────────
header "Checking prerequisites…"

if ! command -v python3 &>/dev/null; then
  error "Python 3 is not installed. Install Python 3.11+ and re-run."
  exit 1
fi

PY_VERSION=$(python3 -c "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')")
PY_MAJOR=$(python3 -c "import sys; print(sys.version_info.major)")
PY_MINOR=$(python3 -c "import sys; print(sys.version_info.minor)")
if (( PY_MAJOR < 3 || (PY_MAJOR == 3 && PY_MINOR < 11) )); then
  error "Python ${PY_VERSION} detected. Python 3.11+ is required."
  exit 1
fi
success "Python ${PY_VERSION}"

if ! command -v psql &>/dev/null; then
  warn "psql not found. The setup script will still run, but you cannot verify the DB connection from the command line."
fi

# ─── 2. virtual environment ───────────────────────────────────────────────────
header "Setting up Python virtual environment…"

if [[ ! -d .venv ]]; then
  info "Creating .venv…"
  python3 -m venv .venv
  success ".venv created"
else
  success ".venv already exists"
fi

# Activate
# shellcheck disable=SC1091
source .venv/bin/activate
success "Virtual environment activated"

# ─── 3. install dependencies ──────────────────────────────────────────────────
header "Installing dependencies…"
pip install --quiet --upgrade pip
pip install --quiet -r requirements.txt
success "Dependencies installed"

# ─── 4. database + .env + migrations + admin account ─────────────────────────
header "Database setup…"

if [[ -f .env ]]; then
  success ".env already exists — skipping interactive setup"
  info "Running any pending migrations…"
  python -m alembic upgrade head
  success "Migrations applied"
else
  info "Running interactive setup (creates .env, database, migrations, admin account)…"
  python scripts/setup_db.py
fi

# ─── done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GRN}${BLD}  Setup complete!${RST}"
echo -e "  Run ${CYN}./start-dev.sh${RST} to start the API server."
echo ""
