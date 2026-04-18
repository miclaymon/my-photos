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
success "Environment variables look good"

# ─── 3. install dependencies ──────────────────────────────────────────────────
header "Installing dependencies…"
npm install
success "Dependencies installed"

# ─── 4. database ──────────────────────────────────────────────────────────────
header "Setting up database…"

DB_PATH="${DATABASE_PATH:-./data/photos.db}"
DB_DIR=$(dirname "$DB_PATH")
mkdir -p "$DB_DIR"

info "Generating migrations from schema…"
npm run db:generate

info "Applying migrations…"
npm run db:migrate
success "Database ready at ${DB_PATH}"

# ─── 5. seed first user ───────────────────────────────────────────────────────
header "First user account…"

# Check if any user already exists
USER_COUNT=$(node -e "
  const Database = require('better-sqlite3');
  try {
    const db = new Database('${DB_PATH}', { readonly: true });
    const row = db.prepare('SELECT COUNT(*) as n FROM users').get();
    process.stdout.write(String(row.n));
    db.close();
  } catch { process.stdout.write('0'); }
" 2>/dev/null || echo "0")

if [[ "$USER_COUNT" -gt 0 ]]; then
  success "User account already exists — skipping seed"
elif [[ ! -t 0 ]]; then
  # stdin is not a terminal (piped/non-interactive) — skip interactive prompt
  warn "No users found and stdin is not a terminal."
  warn "Run  npm run db:seed -- <email> <password>  to create a user."
else
  echo ""
  echo -e "  ${BLD}No users found. Create an admin account:${RST}"
  SEED_EMAIL=""
  SEED_PASS=""
  read -rp "  Email:    " SEED_EMAIL || true
  read -rsp "  Password: " SEED_PASS || true
  echo ""

  if [[ -z "$SEED_EMAIL" || -z "$SEED_PASS" ]]; then
    warn "Email or password was empty — skipping user creation."
    warn "Run  npm run db:seed -- <email> <password>  to create a user later."
  else
    npm run db:seed -- "$SEED_EMAIL" "$SEED_PASS"
    success "User created: ${SEED_EMAIL}"
  fi
fi

# ─── done ─────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GRN}${BLD}  Setup complete!${RST}"
echo -e "  Run ${CYN}./start-dev.sh${RST} to start the development server."
echo ""
