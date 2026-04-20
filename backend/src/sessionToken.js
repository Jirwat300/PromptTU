'use strict';

const crypto = require('crypto');

function getSessionSecret() {
  return (process.env.POP_SESSION_SECRET || '').trim();
}

function isSessionTokenEnabled() {
  return getSessionSecret().length > 0;
}

function getSessionTokenMode() {
  const raw = (process.env.POP_SESSION_MODE || 'monitor').trim().toLowerCase();
  if (raw === 'off' || raw === 'monitor' || raw === 'enforce') return raw;
  return 'monitor';
}

function getSessionTtlSec() {
  const n = parseInt(String(process.env.POP_SESSION_TTL_SEC || '900'), 10);
  if (!Number.isFinite(n)) return 900;
  return Math.min(86400, Math.max(60, n));
}

function toBase64Url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function fromBase64Url(s) {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = norm.length % 4 === 0 ? '' : '='.repeat(4 - (norm.length % 4));
  return Buffer.from(norm + pad, 'base64');
}

function signPayloadB64(payloadB64, secret) {
  return toBase64Url(
    crypto
      .createHmac('sha256', secret)
      .update(payloadB64)
      .digest(),
  );
}

function issueSessionToken() {
  const secret = getSessionSecret();
  if (!secret) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = getSessionTtlSec();
  const exp = nowSec + ttlSec;
  const payload = {
    sid: crypto.randomBytes(12).toString('hex'),
    iat: nowSec,
    exp,
  };
  const payloadB64 = toBase64Url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = signPayloadB64(payloadB64, secret);

  return {
    token: `${payloadB64}.${sig}`,
    expiresAt: exp * 1000,
    ttlSec,
  };
}

/**
 * @param {string} token
 * @returns {{ ok: boolean, code?: string }}
 */
function verifySessionToken(token) {
  const secret = getSessionSecret();
  if (!secret) return { ok: true };
  if (!token || typeof token !== 'string') return { ok: false, code: 'missing' };
  const idx = token.lastIndexOf('.');
  if (idx <= 0 || idx >= token.length - 1) return { ok: false, code: 'bad-format' };
  const payloadB64 = token.slice(0, idx);
  const sig = token.slice(idx + 1);
  const expectedSig = signPayloadB64(payloadB64, secret);

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return { ok: false, code: 'bad-signature' };
  }

  let payload = null;
  try {
    payload = JSON.parse(fromBase64Url(payloadB64).toString('utf8'));
  } catch {
    return { ok: false, code: 'bad-payload' };
  }

  const exp = Number(payload?.exp);
  if (!Number.isFinite(exp)) return { ok: false, code: 'bad-exp' };
  if (Math.floor(Date.now() / 1000) >= exp) return { ok: false, code: 'expired' };
  return { ok: true };
}

module.exports = {
  getSessionTokenMode,
  isSessionTokenEnabled,
  issueSessionToken,
  verifySessionToken,
};
