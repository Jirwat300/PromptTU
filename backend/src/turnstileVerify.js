'use strict';

const TURNSTILE_VERIFY_URL =
  process.env.TURNSTILE_VERIFY_URL ||
  'https://challenges.cloudflare.com/turnstile/v0/siteverify';

function getSecret() {
  const s = process.env.TURNSTILE_SECRET_KEY || '';
  return s.trim();
}

function isTurnstileEnabled() {
  return getSecret().length > 0;
}

function readTurnstileModeEnvRaw() {
  if (typeof process.env.TURNSTILE_MODE === 'string') {
    return process.env.TURNSTILE_MODE;
  }
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v !== 'string') continue;
    if (!v.trim()) continue;
    // Accept near-miss env names like TUR...TILE_MODE to avoid rollout lockouts.
    if (/^TURN.*TILE_MODE$/i.test(k)) {
      return v;
    }
  }
  return '';
}

function getTurnstileMode() {
  // Default to monitor to avoid accidental score lockouts during rollout.
  const raw = (readTurnstileModeEnvRaw() || 'monitor')
    .trim()
    .toLowerCase();
  if (raw === 'off' || raw === 'monitor' || raw === 'enforce') return raw;
  return 'monitor';
}

/**
 * @param {{ token: string, remoteIp?: string }} input
 * @returns {Promise<{ ok: boolean, errorCodes: string[] }>}
 */
async function verifyTurnstileToken(input) {
  const secret = getSecret();
  if (!secret) return { ok: true, errorCodes: [] };
  const token = (input?.token || '').trim();
  if (!token) return { ok: false, errorCodes: ['missing-input-response'] };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    const body = new URLSearchParams();
    body.set('secret', secret);
    body.set('response', token);
    if (input?.remoteIp) body.set('remoteip', String(input.remoteIp));

    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: controller.signal,
    });
    if (!res.ok) return { ok: false, errorCodes: ['verify-http-error'] };
    const json = await res.json().catch(() => null);
    const ok = Boolean(json && json.success === true);
    const errorCodes = Array.isArray(json?.['error-codes'])
      ? json['error-codes'].map((v) => String(v))
      : [];
    return { ok, errorCodes };
  } catch (err) {
    console.warn('[turnstile] verify failed:', err && err.message ? err.message : err);
    return { ok: false, errorCodes: ['verify-request-failed'] };
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = {
  isTurnstileEnabled,
  getTurnstileMode,
  verifyTurnstileToken,
};
