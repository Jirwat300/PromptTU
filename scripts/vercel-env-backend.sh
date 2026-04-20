#!/usr/bin/env bash
# Adds all backend env vars to the currently-linked Vercel project.
# Usage:
#   1. cp scripts/.env.setup.example scripts/.env.setup   (fill in values)
#   2. cd into your backend repo root (or wherever you want to link)
#   3. vercel link                                        (pick the BACKEND project)
#   4. bash <path-to-this-repo>/scripts/vercel-env-backend.sh
#
# This script is IDEMPOTENT: it removes any existing value for each key before
# re-adding, so running twice is safe.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${SCRIPT_DIR}/.env.setup"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "ERROR: ${ENV_FILE} not found."
  echo "       Run: cp scripts/.env.setup.example scripts/.env.setup"
  echo "       Then edit it and fill in FRONTEND_ORIGIN."
  exit 1
fi

# shellcheck source=/dev/null
source "${ENV_FILE}"

if [[ -z "${FRONTEND_ORIGIN:-}" ]]; then
  echo "ERROR: FRONTEND_ORIGIN is empty in ${ENV_FILE}"
  exit 1
fi

if ! command -v vercel >/dev/null 2>&1; then
  echo "ERROR: vercel CLI not installed. Run: npm i -g vercel"
  exit 1
fi

if [[ ! -d .vercel ]]; then
  echo "ERROR: current directory is not linked to a Vercel project."
  echo "       Run: vercel link   (pick the BACKEND project)"
  exit 1
fi

if ! command -v openssl >/dev/null 2>&1; then
  echo "ERROR: openssl required to generate secrets."
  exit 1
fi

SESSION_SECRET="$(openssl rand -hex 32)"
ADMIN_SECRET="$(openssl rand -hex 32)"
FLUSH_KEY="$(openssl rand -hex 32)"

# Upsert helper: remove then add (works on all Vercel CLI versions).
upsert() {
  local key="$1" value="$2" target="$3"
  vercel env rm "${key}" "${target}" -y >/dev/null 2>&1 || true
  printf '%s' "${value}" | vercel env add "${key}" "${target}" >/dev/null
  echo "  set ${key} [${target}]"
}

echo "==> CORS + origin (production only)"
upsert CORS_ENFORCE        "1"                  production
upsert CORS_ORIGINS        "${FRONTEND_ORIGIN}" production
upsert POP_POST_ORIGINS    "${FRONTEND_ORIGIN}" production
upsert POP_ORIGIN_ENFORCE  "1"                  production
upsert ANALYTICS_ORIGIN_ENFORCE "1"             production

echo "==> Session token (HMAC)"
upsert POP_SESSION_SECRET "${SESSION_SECRET}" production
upsert POP_SESSION_SECRET "${SESSION_SECRET}" preview
upsert POP_SESSION_TTL_SEC "900" production
upsert POP_SESSION_TTL_SEC "900" preview
upsert POP_SESSION_MODE "enforce" production
upsert POP_SESSION_MODE "monitor" preview

echo "==> Client click-rate validation"
upsert POP_CLIENT_RATE_MODE "enforce" production
upsert POP_CLIENT_RATE_MODE "monitor" preview
upsert POP_CLIENT_CPS_MAX "12" production
upsert POP_CLIENT_CPS_MAX "12" preview
upsert POP_CLIENT_RATE_MIN_SAMPLES "4" production
upsert POP_CLIENT_RATE_MIN_SAMPLES "4" preview

echo "==> Turnstile mode (secret key you already added manually)"
upsert TURNSTILE_MODE "enforce" production
upsert TURNSTILE_MODE "monitor" preview

echo "==> Admin + write-behind"
upsert ADMIN_ANALYTICS_SECRET "${ADMIN_SECRET}" production
upsert ADMIN_ANALYTICS_SECRET "${ADMIN_SECRET}" preview
upsert POP_WRITE_BEHIND "1" production
upsert POP_WRITE_BEHIND "1" preview
upsert POP_FLUSH_INTERNAL_KEY "${FLUSH_KEY}" production
upsert POP_FLUSH_INTERNAL_KEY "${FLUSH_KEY}" preview

cat <<SECRETS

================================================================
DONE. Generated secrets (save to a password manager — Vercel will
only show them masked after this):
================================================================
POP_SESSION_SECRET      = ${SESSION_SECRET}
ADMIN_ANALYTICS_SECRET  = ${ADMIN_SECRET}
POP_FLUSH_INTERNAL_KEY  = ${FLUSH_KEY}
================================================================

Next manual steps (CLI cannot do these):
  1) Vercel Dashboard -> Storage -> Create KV or Upstash Redis
     -> Connect to this backend project. Vercel will auto-inject:
        KV_REST_API_URL / KV_REST_API_TOKEN (or UPSTASH_* equivalents).
  2) Cloudflare Turnstile -> your widget -> Settings ->
     Hostname management: add ${FRONTEND_ORIGIN#https://}
     (also add *.vercel.app if you want preview deployments to pass).
  3) Redeploy: vercel --prod
  4) Verify: curl ${BACKEND_URL:-https://<backend>.vercel.app}/api/health
SECRETS
