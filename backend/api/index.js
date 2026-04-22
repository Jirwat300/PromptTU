const express = require('express');
const cors = require('cors');
const path = require('path');
const supabase = require('../src/supabaseClient');
const {
  takePopBudget,
  listBannedIps,
  POP_MAX_DELTA_PER_CALL,
  POP_MAX_DELTA_PER_SEC,
  POP_MAX_DELTA_PER_MIN,
  POP_BLOCK_SECONDS,
  POP_VIOLATIONS_TO_BLOCK,
  POP_VIOLATION_WINDOW_SEC,
} = require('../src/popRateLimit');
const {
  isTurnstileEnabled,
  getTurnstileMode,
  verifyTurnstileToken,
} = require('../src/turnstileVerify');
const {
  isSessionTokenEnabled,
  getSessionTokenMode,
  issueSessionToken,
  verifySessionToken,
} = require('../src/sessionToken');
const {
  enqueuePop,
  flushPendingToDb,
  getPendingMap,
  isWriteBehindEnabled,
} = require('../src/popWriteBehind');

const POPTU_FACULTIES = require(path.join(__dirname, '../data/poptu-faculties.json'));
const POPTU_FACULTY_IDS = new Set(POPTU_FACULTIES.map((f) => f.id));
// Hot-path Redis frugality knobs. Values in ms.
//   SCORES_CACHE_TTL_MS: how long Supabase scores stay cached in memory between
//     polls. Longer = fewer DB + pending reads; users see shared ranking refresh
//     on that cadence (optimistic updates still feel live for self-clicks).
//   SCORES_FLUSH_INTERVAL_MS: minimum gap between opportunistic write-behind
//     flushes kicked off from the /scores cache-miss path. Longer = smaller
//     flush amortised over more POPs = fewer Redis commands.
//   POP_FLUSH_HINT_MS: when any pop POST comes in and the last flush was more
//     than this long ago, we fire a non-blocking flush so pending can't sit in
//     Redis forever on low-traffic Vercel Hobby plans that can't run minute
//     crons.
const SCORES_CACHE_TTL_MS = 5000;
const SCORES_FLUSH_INTERVAL_MS = 30_000;
const POP_FLUSH_HINT_MS = 30_000;
let lastScoresFlushAttemptMs = 0;
let lastPopFlushHintMs = 0;
let scoresCache = { at: 0, payload: null };

const app = express();
app.disable('x-powered-by');

// Behind Vercel (or when TRUST_PROXY=1): use Express-resolved client IP for rate limits.
const trustProxy =
  process.env.VERCEL === '1' || process.env.TRUST_PROXY === '1';
app.set('trust proxy', trustProxy ? 1 : false);

// Middleware — set CORS_ORIGINS (comma-separated) for cross-origin browser callers.
// To avoid accidental production lockouts, CORS is permissive by default unless CORS_ENFORCE=1.
// Local `vercel dev` often sets VERCEL: if the UI is on another port, set CORS_ORIGINS (e.g. http://localhost:5173).
const isProdLike =
  process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const corsEnforce = (process.env.CORS_ENFORCE || '').trim() === '1';
const corsMiddleware =
  corsOrigins.length > 0
    ? cors({ origin: corsOrigins })
    : (isProdLike && corsEnforce)
      ? cors({ origin: false })
      : cors();
app.use(corsMiddleware);
app.use(express.json({ limit: '16kb' }));
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'DENY');
  res.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

const popPostOrigins = (
  process.env.POP_POST_ORIGINS || process.env.CORS_ORIGINS || ''
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function isAllowedPopOrigin(req) {
  if (!isProdLike || popPostOrigins.length === 0) return true;
  const origin = (req.get('origin') || '').trim();
  if (origin && popPostOrigins.includes(origin)) return true;
  const referer = (req.get('referer') || '').trim();
  if (!referer) return false;
  try {
    return popPostOrigins.includes(new URL(referer).origin);
  } catch {
    return false;
  }
}

function isPopOriginEnforced() {
  return (process.env.POP_ORIGIN_ENFORCE || '').trim() === '1';
}

function isAnalyticsOriginEnforced() {
  const raw = (process.env.ANALYTICS_ORIGIN_ENFORCE || (isProdLike ? '1' : '')).trim();
  return raw === '1';
}

function isAllowedAnalyticsOrigin(req) {
  if (!isProdLike || popPostOrigins.length === 0) return true;
  const origin = (req.get('origin') || '').trim();
  if (origin && popPostOrigins.includes(origin)) return true;
  const referer = (req.get('referer') || '').trim();
  if (!referer) return false;
  try {
    return popPostOrigins.includes(new URL(referer).origin);
  } catch {
    return false;
  }
}

function getClientRateMode() {
  const raw = (process.env.POP_CLIENT_RATE_MODE || 'monitor').trim().toLowerCase();
  if (raw === 'off' || raw === 'monitor' || raw === 'enforce') return raw;
  return 'monitor';
}

function getClientCpsMax() {
  const raw = Number(process.env.POP_CLIENT_CPS_MAX || 30);
  if (!Number.isFinite(raw)) return 30;
  return Math.min(80, Math.max(8, raw));
}

function getClientRateMinSamples() {
  const raw = Number(process.env.POP_CLIENT_RATE_MIN_SAMPLES || 6);
  if (!Number.isFinite(raw)) return 6;
  return Math.min(20, Math.max(2, Math.floor(raw)));
}

// Admin-controlled "freeze list": comma-separated faculty ids that should
// reject any POST /api/ranking/pop. Use when a specific faculty is being
// abused and you want to lock its score in place without taking the whole
// leaderboard offline. Toggle via Vercel env (POP_FROZEN_FACULTIES=soc,eng)
// then redeploy — no code change required.
function getFrozenFaculties() {
  const raw = (process.env.POP_FROZEN_FACULTIES || '').trim();
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean),
  );
}

const ANALYTICS_EVENT_TYPE_RE = /^[a-z0-9][a-z0-9_.:-]{0,63}$/i;
const ANALYTICS_RATE_WINDOW_MS = 60 * 1000;
const ANALYTICS_RATE_MAX = 60;
const analyticsIpBuckets = new Map();

function clampText(v, maxLen) {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s.slice(0, maxLen);
}

function normalizeMetadata(v) {
  if (v == null) return null;
  if (typeof v !== 'object') return null;
  try {
    const raw = JSON.stringify(v);
    if (!raw || raw.length > 2000) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isAnalyticsRateLimited(ip) {
  const now = Date.now();
  const prev = analyticsIpBuckets.get(ip);
  if (!prev || now - prev.startedAt >= ANALYTICS_RATE_WINDOW_MS) {
    analyticsIpBuckets.set(ip, { startedAt: now, count: 1 });
    return false;
  }
  prev.count += 1;
  if (prev.count > ANALYTICS_RATE_MAX) return true;
  if (analyticsIpBuckets.size > 5000) {
    for (const [k, bucket] of analyticsIpBuckets.entries()) {
      if (now - bucket.startedAt >= ANALYTICS_RATE_WINDOW_MS) analyticsIpBuckets.delete(k);
    }
  }
  return false;
}

function shouldAllowInternalFlush(req) {
  if (req.get('x-vercel-cron') === '1') return true;
  const expected = (process.env.POP_FLUSH_INTERNAL_KEY || '').trim();
  if (!expected) return false;
  const got = (req.get('x-internal-key') || '').trim();
  return got === expected;
}

function invalidateScoresCache() {
  scoresCache = { at: 0, payload: null };
}

/**
 * Validate client click timing stats from the batch payload.
 * Returns null when payload is missing/insufficient, or a verdict when available.
 * @param {{delta:number, firstMs?:unknown, lastMs?:unknown}} input
 * @returns {{ok:boolean, code?:string, cps?:number} | null}
 */
function validateClientClickRate(input) {
  const mode = getClientRateMode();
  if (mode === 'off') return null;
  const first = Number(input.firstMs);
  const last = Number(input.lastMs);
  const count = Number(input.delta);
  const minSamples = getClientRateMinSamples();
  if (!Number.isFinite(first) || !Number.isFinite(last) || !Number.isFinite(count) || count < minSamples) {
    return null;
  }
  if (last < first) return { ok: false, code: 'bad-window' };

  const now = Date.now();
  const skewMs = 5 * 60 * 1000;
  if (Math.abs(now - last) > skewMs) return { ok: false, code: 'clock-skew' };

  const durationMs = Math.max(1, last - first);
  const cps = (count * 1000) / durationMs;
  const capWithGrace = getClientCpsMax() * 1.15;
  if (cps > capWithGrace) {
    return { ok: false, code: 'too-fast', cps };
  }
  return { ok: true, cps };
}

// Routes
app.get('/api', (req, res) => {
  res.json({ 
    status: 'success', 
    message: 'PromptTU Backend is running successfully on Vercel!',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', async (req, res) => {
  try {
    const sessionBindIp = (process.env.POP_SESSION_BIND_IP || '1').trim().toLowerCase();
    res.json({
      supabase_configured: !!supabase,
      turnstile_enabled: isTurnstileEnabled(),
      turnstile_mode: isTurnstileEnabled() ? getTurnstileMode() : 'off',
      session_token_enabled: isSessionTokenEnabled(),
      session_token_mode: isSessionTokenEnabled() ? getSessionTokenMode() : 'off',
      session_bind_ip: !(sessionBindIp === '0' || sessionBindIp === 'false' || sessionBindIp === 'off'),
      write_behind_enabled: isWriteBehindEnabled(),
      scores_cache_ttl_ms: SCORES_CACHE_TTL_MS,
      scores_flush_interval_ms: SCORES_FLUSH_INTERVAL_MS,
      pop_flush_hint_ms: POP_FLUSH_HINT_MS,
      client_rate_mode: getClientRateMode(),
      client_cps_max: getClientCpsMax(),
      cors_enforce: corsEnforce,
      pop_origin_enforce: isPopOriginEnforced(),
      frozen_faculties: [...getFrozenFaculties()],
      message: 'Supabase integration ready.'
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/analytics', async (req, res) => {
  try {
    if (!isAllowedAnalyticsOrigin(req)) {
      if (isAnalyticsOriginEnforced()) {
        return res.status(403).json({ status: 'error', message: 'forbidden origin' });
      }
      res.set('X-Analytics-Origin-Result', 'failed-soft');
    } else {
      res.set('X-Analytics-Origin-Result', 'passed');
    }

    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (isAnalyticsRateLimited(ip)) {
      res.set('Retry-After', '60');
      return res.status(429).json({ status: 'error', message: 'too many analytics requests' });
    }

    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const event_type = clampText(body.event_type, 64);
    const path = clampText(body.path, 300);
    const device = clampText(body.device, 256);
    const referrer = clampText(body.referrer, 300);
    const watchtower = clampText(body.watchtower, 120);
    const user_id = clampText(body.user_id, 120);
    const metadata = normalizeMetadata(body.metadata);

    if (!event_type) {
      return res.status(400).json({ status: 'error', message: 'event_type is required' });
    }
    if (!ANALYTICS_EVENT_TYPE_RE.test(event_type)) {
      return res.status(400).json({ status: 'error', message: 'invalid event_type' });
    }

    if (!supabase) {
      return res.status(500).json({ status: 'error', message: 'Supabase client is not initialized' });
    }

    const { data, error } = await supabase
      .from('analytics_events')
      .insert([{
        event_type,
        path: path || null,
        device: device || null,
        referrer: referrer || null,
        watchtower: watchtower || null,
        metadata,
        user_id: user_id || null
      }])
      .select();

    if (error) {
      console.error('Supabase Error:', error.message);
      return res.status(500).json({ status: 'error', message: error.message });
    }

    return res.status(201).json({ status: 'success', data });

  } catch (error) {
    console.error('Analytics Error:', error);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/** Admin traffic API: env ADMIN_ANALYTICS_SECRET overrides; default matches product password (rotate via env in prod). */
function assertAdmin(req, res) {
  const secret = (process.env.ADMIN_ANALYTICS_SECRET || 'guyakdie').trim();
  const bearer = req.get('authorization');
  const fromBearer =
    bearer && /^Bearer\s+/i.test(bearer) ? bearer.replace(/^Bearer\s+/i, '').trim() : '';
  const key = (req.get('x-admin-key') || fromBearer || '').trim();
  if (key !== secret) {
    res.status(401).json({ status: 'error', message: 'Unauthorized' });
    return false;
  }
  return true;
}

/** Read analytics_events (service role). Requires header `x-admin-key` or `Authorization: Bearer` = ADMIN_ANALYTICS_SECRET. */
app.get('/api/admin/analytics', async (req, res) => {
  try {
    if (!assertAdmin(req, res)) return;
    if (!supabase) {
      return res.status(500).json({ status: 'error', message: 'Supabase client is not initialized' });
    }

    const limit = Math.min(2000, Math.max(1, parseInt(String(req.query.limit || '300'), 10) || 300));
    const offset = Math.max(0, parseInt(String(req.query.offset || '0'), 10) || 0);

    const { count, error: countErr } = await supabase
      .from('analytics_events')
      .select('*', { count: 'exact', head: true });

    if (countErr) {
      console.error('[admin/analytics] count:', countErr.message);
      return res.status(500).json({ status: 'error', message: countErr.message });
    }

    let byEventType = [];
    const { data: summaryRows, error: sumErr } = await supabase.rpc('admin_analytics_event_counts');
    if (!sumErr && Array.isArray(summaryRows)) {
      byEventType = summaryRows;
    }

    const to = offset + limit - 1;
    const { data: events, error: evErr } = await supabase
      .from('analytics_events')
      .select('id, created_at, event_type, path, device, referrer, watchtower, metadata, user_id')
      .order('created_at', { ascending: false })
      .range(offset, to);

    if (evErr) {
      console.error('[admin/analytics] list:', evErr.message);
      return res.status(500).json({ status: 'error', message: evErr.message });
    }

    res.set('Cache-Control', 'no-store');
    return res.json({
      status: 'success',
      total: count ?? 0,
      by_event_type: byEventType,
      events: events || [],
    });
  } catch (err) {
    console.error('[admin/analytics]', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/**
 * Admin abuse dashboard feed: current scores + pending queue + banned IPs +
 * rate-limit thresholds. Client polls this every few seconds and computes
 * per-faculty velocity (delta / interval) locally.
 */
app.get('/api/admin/pop-abuse', async (req, res) => {
  try {
    if (!assertAdmin(req, res)) return;
    if (!supabase) {
      return res.status(500).json({ status: 'error', message: 'Supabase client is not initialized' });
    }

    const { data, error } = await supabase
      .from('faculty_scores')
      .select('id, name, emoji, count, updated_at')
      .order('count', { ascending: false });

    if (error) {
      console.error('[admin/pop-abuse] fetch scores:', error.message);
      return res.status(500).json({ status: 'error', message: error.message });
    }

    const pending = await getPendingMap().catch(() => ({}));
    const banned = await listBannedIps({ limit: 100 }).catch(() => []);

    const faculties = (data || []).map((r) => ({
      id: r.id,
      name: r.name,
      emoji: r.emoji ?? '',
      count: Number(r.count) || 0,
      updated_at: r.updated_at || null,
      pending: pending[r.id] || 0,
    }));

    res.set('Cache-Control', 'no-store');
    return res.json({
      status: 'success',
      now: new Date().toISOString(),
      faculties,
      banned_ips: banned,
      limits: {
        per_sec: POP_MAX_DELTA_PER_SEC,
        per_min: POP_MAX_DELTA_PER_MIN,
        per_call: POP_MAX_DELTA_PER_CALL,
        block_sec: POP_BLOCK_SECONDS,
        violations_to_block: POP_VIOLATIONS_TO_BLOCK,
        violation_window_sec: POP_VIOLATION_WINDOW_SEC,
      },
      write_behind_enabled: isWriteBehindEnabled(),
    });
  } catch (err) {
    console.error('[admin/pop-abuse]', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

/* ==========================================================================
 * POP TU — faculty leaderboard
 * --------------------------------------------------------------------------
 *   GET  /api/ranking/scores           → { scores, top, rows }  // rows = full table from DB for modal
 *   POST /api/ranking/pop  {faculty_id, delta}
 *                                       → { count }   // new total for faculty
 *
 * Writes go through an atomic RPC `increment_faculty_score(fid, delta)`
 * (see backend/supabase/schema.sql).
 *
 * Optional: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN (or KV_REST_*)
 * for shared per-IP rate limits across serverless instances (see src/popRateLimit.js).
 * ========================================================================== */

// Valid faculty ids — same list as backend/data/poptu-faculties.json (frontend imports that file too).

app.get('/api/ranking/scores', async (req, res) => {
  try {
    if (!supabase) {
      return res.status(500).json({ status: 'error', message: 'Supabase client not initialized' });
    }
    const now = Date.now();
    if (scoresCache.payload && now - scoresCache.at < SCORES_CACHE_TTL_MS) {
      return res.json(scoresCache.payload);
    }
    if (isWriteBehindEnabled() && now - lastScoresFlushAttemptMs >= SCORES_FLUSH_INTERVAL_MS) {
      lastScoresFlushAttemptMs = now;
      try {
        await flushPendingToDb(supabase);
      } catch (err) {
        console.warn('[ranking] opportunistic flush failed:', err && err.message ? err.message : err);
      }
    }

    const { data, error } = await supabase
      .from('faculty_scores')
      .select('id, name, emoji, count')
      .order('count', { ascending: false });

    if (error) {
      console.error('[ranking] fetch error:', error.message);
      return res.status(500).json({ status: 'error', message: error.message });
    }

    const pending = await getPendingMap();
    const mergedRows = (data || []).map((r) => ({
      ...r,
      count: (Number(r.count) || 0) + (pending[r.id] || 0),
    }));

    const scores = {};
    for (const row of mergedRows) scores[row.id] = Number(row.count) || 0;
    const top = mergedRows.slice(0, 3).map((r) => ({
      id: r.id, name: r.name, emoji: r.emoji, score: Number(r.count) || 0,
    }));
    /** Full table for modal — ids / names / emojis from DB (stays in sync if SQL adds rows). */
    const rows = mergedRows.map((r) => ({
      id: r.id,
      name: r.name,
      emoji: r.emoji ?? '',
      count: Number(r.count) || 0,
    }));

    const payload = { status: 'success', scores, top, rows };
    scoresCache = { at: now, payload };
    res.set('Cache-Control', 'no-store');
    return res.json(payload);
  } catch (err) {
    console.error('[ranking] scores error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

app.post('/api/internal/flush-pop', async (req, res) => {
  try {
    if (!shouldAllowInternalFlush(req)) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized' });
    }
    const summary = await flushPendingToDb(supabase);
    if (summary.flushed > 0) invalidateScoresCache();
    return res.json({ status: 'success', ...summary });
  } catch (err) {
    console.error('[ranking] flush-pop error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

app.get('/api/ranking/session', async (req, res) => {
  try {
    if (!isSessionTokenEnabled()) {
      return res.json({ status: 'success', enabled: false });
    }
    const ip = req.ip || req.socket?.remoteAddress || '';
    const issued = issueSessionToken({ ip });
    if (!issued?.token) {
      return res.status(500).json({ status: 'error', message: 'failed to issue session token' });
    }
    res.set('Cache-Control', 'no-store');
    return res.json({
      status: 'success',
      enabled: true,
      token: issued.token,
      expires_at: issued.expiresAt,
      ttl_sec: issued.ttlSec,
    });
  } catch (err) {
    console.error('[ranking] session error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

app.post('/api/ranking/pop', async (req, res) => {
  try {
    const { faculty_id, delta } = req.body || {};
    const d = Math.floor(Number(delta));

    if (!faculty_id || !POPTU_FACULTY_IDS.has(faculty_id)) {
      return res.status(400).json({ status: 'error', message: 'invalid faculty_id' });
    }
    // Reject frozen faculties before any DB / rate-limit work so a sustained
    // abuse attempt costs us nothing and the client gets a clear signal.
    const frozen = getFrozenFaculties();
    if (frozen.has(String(faculty_id).toLowerCase())) {
      res.set('X-Faculty-Frozen', '1');
      return res.status(403).json({ status: 'error', message: 'faculty is frozen' });
    }
    if (!Number.isFinite(d) || d <= 0) {
      return res.status(400).json({ status: 'error', message: 'delta must be a positive integer' });
    }
    if (d > POP_MAX_DELTA_PER_CALL) {
      return res.status(400).json({ status: 'error', message: `delta exceeds ${POP_MAX_DELTA_PER_CALL}` });
    }

    const clientRate = validateClientClickRate({
      delta: d,
      firstMs: req.body?.client_first_click_ms,
      lastMs: req.body?.client_last_click_ms,
    });
    if (clientRate && !clientRate.ok) {
      res.set('X-Client-Rate-Result', `failed:${clientRate.code || 'unknown'}`);
      if (getClientRateMode() === 'enforce') {
        return res.status(429).json({ status: 'error', message: 'too fast' });
      }
    } else if (clientRate && clientRate.ok) {
      res.set('X-Client-Rate-Result', 'passed');
    } else {
      res.set('X-Client-Rate-Result', 'unavailable');
    }

    if (!isAllowedPopOrigin(req)) {
      if (isPopOriginEnforced()) {
        return res.status(403).json({ status: 'error', message: 'forbidden origin' });
      }
      res.set('X-Pop-Origin-Result', 'failed-soft');
    } else {
      res.set('X-Pop-Origin-Result', 'passed');
    }

    // Per-IP rate limit (req.ip respects trust proxy when VERCEL / TRUST_PROXY is set)
    const ip = req.ip || req.socket?.remoteAddress || 'unknown';
    if (isSessionTokenEnabled()) {
      const mode = getSessionTokenMode();
      const sessionToken =
        typeof req.body?.session_token === 'string' ? req.body.session_token.trim() : '';
      const verdict = verifySessionToken(sessionToken, { ip });
      if (!verdict.ok) {
        if (mode === 'enforce') {
          return res.status(403).json({ status: 'error', message: 'invalid session token' });
        }
        res.set('X-Session-Token-Result', `failed:${verdict.code || 'unknown'}`);
      } else {
        res.set('X-Session-Token-Result', 'passed');
      }
    }

    if (isTurnstileEnabled()) {
      // TURNSTILE_MODE=monitor (default): accept request, annotate result in X-Turnstile-Result.
      // TURNSTILE_MODE=enforce: reject missing/failed token (except verify transport outage).
      const mode = getTurnstileMode();
      const turnstileToken =
        typeof req.body?.turnstile_token === 'string' ? req.body.turnstile_token.trim() : '';
      if (!turnstileToken) {
        if (mode === 'enforce') {
          return res.status(403).json({ status: 'error', message: 'captcha required' });
        }
        res.set('X-Turnstile-Result', 'missing');
      }
      if (turnstileToken) {
        const verdict = await verifyTurnstileToken({
          token: turnstileToken,
          remoteIp: ip,
        });
        if (!verdict.ok) {
          const isTransportFailure =
            verdict.errorCodes.includes('verify-request-failed')
            || verdict.errorCodes.includes('verify-http-error');
          if (mode === 'enforce' && !isTransportFailure) {
            return res.status(403).json({ status: 'error', message: 'captcha failed' });
          }
          const errs = verdict.errorCodes.length > 0 ? verdict.errorCodes.join(',') : 'unknown';
          res.set('X-Turnstile-Result', isTransportFailure ? `soft-fail:${errs}` : `failed:${errs}`);
        } else {
          res.set('X-Turnstile-Result', 'passed');
        }
      }
    }

    const budget = await takePopBudget(ip, d);
    if (budget.allowed <= 0) {
      res.set('Retry-After', String(Math.max(1, Math.floor(budget.retryAfterSec || 1))));
      return res.status(429).json({ status: 'error', message: 'slow down' });
    }
    if (!supabase) {
      return res.status(500).json({ status: 'error', message: 'Supabase client not initialized' });
    }

    if (isWriteBehindEnabled()) {
      const queued = await enqueuePop(faculty_id, budget.allowed);
      if (queued.queued) {
        invalidateScoresCache();
        // Keep pending from sitting in Redis forever when nobody is polling
        // /scores (which is what normally triggers flushes). Fire-and-forget so
        // the caller still gets a sub-second response; the flush holds its own
        // Redis lock so parallel invocations collapse safely.
        const now = Date.now();
        if (now - lastPopFlushHintMs >= POP_FLUSH_HINT_MS) {
          lastPopFlushHintMs = now;
          setImmediate(() => {
            flushPendingToDb(supabase)
              .then((summary) => {
                if (summary?.flushed > 0) invalidateScoresCache();
              })
              .catch((err) => {
                console.warn(
                  '[ranking] background flush failed:',
                  err && err.message ? err.message : err,
                );
              });
          });
        }
        return res.json({
          status: 'success',
          queued: true,
          applied: budget.allowed,
        });
      }
    }

    const { data, error } = await supabase.rpc('increment_faculty_score', {
      fid: faculty_id,
      delta: budget.allowed,
    });

    if (error) {
      console.error('[ranking] rpc error:', error.message);
      return res.status(500).json({ status: 'error', message: error.message });
    }

    invalidateScoresCache();
    return res.json({ status: 'success', count: Number(data) || 0, applied: budget.allowed });
  } catch (err) {
    console.error('[ranking] pop error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Export app for Vercel Serverless
module.exports = app;
