#!/usr/bin/env bash
# Adds frontend (VITE_*) env vars to the currently-linked Vercel project.
# Usage:
#   1. cp scripts/.env.setup.example scripts/.env.setup   (fill in values)
#   2. cd into your frontend repo root (or monorepo root)
#   3. vercel link                                        (pick the FRONTEND project)
#   4. bash <path-to-this-repo>/scripts/vercel-env-frontend.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.setup"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} not found."
  echo "       Run: cp scripts/.env.setup.example scripts/.env.setup"
  echo "       Then edit it and fill in BACKEND_URL and TURNSTILE_SITE_KEY."
  exit 1
fi

# shellcheck source=/dev/null
source "${ENV_FILE}"

if [[ -z "${BACKEND_URL:-}" ]]; then
  echo "ERROR: BACKEND_URL is empty in ${ENV_FILE}"
  exit 1
fi
if [[ -z "${TURNSTILE_SITE_KEY:-}" ]]; then
  echo "ERROR: TURNSTILE_SITE_KEY is empty in ${ENV_FILE}"
  exit 1
fi

if ! command -v vercel >/dev/null 2>&1; then
  echo "ERROR: vercel CLI not installed. Run: npm i -g vercel"
  exit 1
fi

if [[ ! -d .vercel ]]; then
  echo "ERROR: current directory is not linked to a Vercel project."
  echo "       Run: vercel link   (pick the FRONTEND project)"
  exit 1
fi

upsert() {
  local key="$1" value="$2" target="$3"
  vercel env rm "${key}" "${target}" -y >/dev/null 2>&1 || true
  printf '%s' "${value}" | vercel env add "${key}" "${target}" >/dev/null
  echo "  set ${key} [${target}]"
}

echo "==> Frontend (VITE_*) env"
upsert VITE_API_URL            "${BACKEND_URL}"        production
upsert VITE_API_URL            "${BACKEND_URL}"        preview
upsert VITE_TURNSTILE_SITE_KEY "${TURNSTILE_SITE_KEY}" production
upsert VITE_TURNSTILE_SITE_KEY "${TURNSTILE_SITE_KEY}" preview

cat <<NOTE

DONE.

IMPORTANT: Vite only reads VITE_* variables at BUILD time — they are
baked into the bundle. You MUST redeploy after changing them:

  vercel --prod

NOTE
