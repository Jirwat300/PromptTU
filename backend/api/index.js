const express = require('express');
const cors = require('cors');
const path = require('path');
const supabase = require('../src/supabaseClient');
const {
  takePopBudget,
  POP_MAX_DELTA_PER_CALL,
} = require('../src/popRateLimit');
const {
  isTurnstileEnabled,
  getTurnstileMode,
  verifyTurnstileToken,
} = require('../src/turnstileVerify');

const POPTU_FACULTIES = require(path.join(__dirname, '../data/poptu-faculties.json'));
const POPTU_FACULTY_IDS = new Set(POPTU_FACULTIES.map((f) => f.id));

const app = express();

// Behind Vercel (or when TRUST_PROXY=1): use Express-resolved client IP for rate limits.
const trustProxy =
  process.env.VERCEL === '1' || process.env.TRUST_PROXY === '1';
app.set('trust proxy', trustProxy ? 1 : false);

// Middleware — set CORS_ORIGINS (comma-separated) for cross-origin browser callers.
// When NODE_ENV=production or VERCEL=1, empty CORS_ORIGINS disables cross-origin (same-origin still works).
// Local `vercel dev` often sets VERCEL: if the UI is on another port, set CORS_ORIGINS (e.g. http://localhost:5173).
const isProdLike =
  process.env.NODE_ENV === 'production' || process.env.VERCEL === '1';
const corsOrigins = (process.env.CORS_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const corsMiddleware =
  corsOrigins.length > 0
    ? cors({ origin: corsOrigins })
    : isProdLike
      ? cors({ origin: false })
      : cors();
app.use(corsMiddleware);
app.use(express.json());

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
    // Check if Supabase client is configured
    res.json({ 
      supabase_configured: !!supabase,
      turnstile_enabled: isTurnstileEnabled(),
      turnstile_mode: isTurnstileEnabled() ? getTurnstileMode() : 'off',
      pop_origin_enforce: isPopOriginEnforced(),
      message: 'Supabase integration ready.' 
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/analytics', async (req, res) => {
  try {
    const { event_type, path, device, referrer, watchtower, metadata, user_id } = req.body;

    if (!event_type) {
      return res.status(400).json({ status: 'error', message: 'event_type is required' });
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
        metadata: metadata || null,
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
    const { data, error } = await supabase
      .from('faculty_scores')
      .select('id, name, emoji, count')
      .order('count', { ascending: false });

    if (error) {
      console.error('[ranking] fetch error:', error.message);
      return res.status(500).json({ status: 'error', message: error.message });
    }

    const scores = {};
    for (const row of data || []) scores[row.id] = Number(row.count) || 0;
    const top = (data || []).slice(0, 3).map((r) => ({
      id: r.id, name: r.name, emoji: r.emoji, score: Number(r.count) || 0,
    }));
    /** Full table for modal — ids / names / emojis from DB (stays in sync if SQL adds rows). */
    const rows = (data || []).map((r) => ({
      id: r.id,
      name: r.name,
      emoji: r.emoji ?? '',
      count: Number(r.count) || 0,
    }));

    res.set('Cache-Control', 'no-store');
    return res.json({ status: 'success', scores, top, rows });
  } catch (err) {
    console.error('[ranking] scores error:', err);
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
    if (!Number.isFinite(d) || d <= 0) {
      return res.status(400).json({ status: 'error', message: 'delta must be a positive integer' });
    }
    if (d > POP_MAX_DELTA_PER_CALL) {
      return res.status(400).json({ status: 'error', message: `delta exceeds ${POP_MAX_DELTA_PER_CALL}` });
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

    const { data, error } = await supabase.rpc('increment_faculty_score', {
      fid: faculty_id,
      delta: budget.allowed,
    });

    if (error) {
      console.error('[ranking] rpc error:', error.message);
      return res.status(500).json({ status: 'error', message: error.message });
    }

    return res.json({ status: 'success', count: Number(data) || 0, applied: budget.allowed });
  } catch (err) {
    console.error('[ranking] pop error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Export app for Vercel Serverless
module.exports = app;
