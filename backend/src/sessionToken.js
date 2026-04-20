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

// Default ON — the anti-rotation benefit is the whole point; togglable
// in case a user's NAT rotates IPs mid-session and they'd rather log-
// monitor first. Set `POP_SESSION_BIND_IP=0` to disable.
function isIpBindingEnabled() {
  const raw = (process.env.POP_SESSION_BIND_IP || '1').trim().toLowerCase();
  return !(raw === '0' || raw === 'false' || raw === 'off');
}

/**
 * Strip IPv4-mapped IPv6 (`::ffff:1.2.3.4`) and IPv6 zone suffixes (`fe80::1%eth0`)
 * so the same client doesn't look like two IPs across request paths.
 * @param {string} ip
 */
function normalizeIp(ip) {
  if (!ip || typeof ip !== 'string') return '';
  let s = ip.trim().toLowerCase();
  if (s.startsWith('::ffff:')) s = s.slice(7);
  const pct = s.indexOf('%');
  if (pct >= 0) s = s.slice(0, pct);
  return s;
}

function hashIp(ip, secret) {
  const norm = normalizeIp(ip);
  if (!norm) return '';
  return crypto
    .createHmac('sha256', secret)
    .update(`iph:${norm}`)
    .digest('base64')
    .replace(/[^A-Za-z0-9]/g, '')
    .slice(0, 16);
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

/**
 * @param {{ ip?: string | null }} [opts]
 */
function issueSessionToken(opts = {}) {
  const secret = getSessionSecret();
  if (!secret) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  const ttlSec = getSessionTtlSec();
  const exp = nowSec + ttlSec;
  /** @type {{sid:string,iat:number,exp:number,iph?:string}} */
  const payload = {
    sid: crypto.randomBytes(12).toString('hex'),
    iat: nowSec,
    exp,
  };

  // Bind the token to the issuing IP (hashed) so a stolen/shared token
  // can't be replayed from a rotating proxy pool.
  if (isIpBindingEnabled() && opts.ip) {
    const iph = hashIp(opts.ip, secret);
    if (iph) payload.iph = iph;
  }

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
 * @param {{ ip?: string | null }} [opts]
 * @returns {{ ok: boolean, code?: string }}
 */
function verifySessionToken(token, opts = {}) {
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

  // Optional IP binding: only enforced when BOTH the token was issued with
  // an IP hash AND binding is still enabled server-side. Legacy tokens
  // without `iph` still pass so rotating the env flag doesn't brick live
  // sessions.
  if (payload?.iph && isIpBindingEnabled()) {
    if (!opts.ip) return { ok: false, code: 'missing-ip-context' };
    const got = hashIp(opts.ip, secret);
    const a = Buffer.from(String(payload.iph));
    const b = Buffer.from(got);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return { ok: false, code: 'ip-mismatch' };
    }
  }

  return { ok: true };
}

module.exports = {
  getSessionTokenMode,
  isSessionTokenEnabled,
  issueSessionToken,
  verifySessionToken,
};
