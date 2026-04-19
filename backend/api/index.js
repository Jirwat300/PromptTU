const express = require('express');
const cors = require('cors');
const supabase = require('../src/supabaseClient');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

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

/* ==========================================================================
 * POP TU — faculty leaderboard
 * --------------------------------------------------------------------------
 *   GET  /api/ranking/scores           → { scores: {id: count}, top: [...] }
 *   POST /api/ranking/pop  {faculty_id, delta}
 *                                       → { count }   // new total for faculty
 *
 * Writes go through an atomic RPC `increment_faculty_score(fid, delta)`
 * (see backend/supabase/schema.sql).
 * ========================================================================== */

// Valid faculty ids — matches FACULTIES in frontend/src/poptu.jsx
const POPTU_FACULTY_IDS = new Set([
  'team_phromtham', 'team_dao', 'team_diw', 'team_rangsit', 'team_lampang', 'team_thaprachan',
  'team_pattaya',
  'law', 'comm', 'polsci', 'econ', 'soc', 'anthro', 'arts', 'journ', 'sci',
  'eng', 'arch', 'fine', 'med', 'allied', 'dent', 'nurse', 'pub', 'pharm', 'learn',
  'puey', 'glob', 'cicm', 'inter', 'siit',
]);

// Server-side rate-limit to keep one IP from hammering the RPC.
// Map<ip, { windowStart:number, delta:number }>  — window = 1 s
const popBuckets = new Map();
const POP_MAX_DELTA_PER_SEC = 30;     // generous — honest taps can reach ~20/s
const POP_MAX_DELTA_PER_CALL = 50;    // client batches every ~800 ms

function takePopBudget(ip, delta) {
  const now = Date.now();
  const bucket = popBuckets.get(ip);
  if (!bucket || now - bucket.windowStart > 1000) {
    popBuckets.set(ip, { windowStart: now, delta });
    return delta <= POP_MAX_DELTA_PER_SEC ? delta : POP_MAX_DELTA_PER_SEC;
  }
  const remaining = POP_MAX_DELTA_PER_SEC - bucket.delta;
  if (remaining <= 0) return 0;
  const allowed = Math.min(delta, remaining);
  bucket.delta += allowed;
  return allowed;
}

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

    res.set('Cache-Control', 'no-store');
    return res.json({ status: 'success', scores, top });
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
    if (!supabase) {
      return res.status(500).json({ status: 'error', message: 'Supabase client not initialized' });
    }

    // Simple per-IP rate limit
    const ip = (req.headers['x-forwarded-for'] || '').toString().split(',')[0].trim()
            || req.ip || req.socket?.remoteAddress || 'unknown';
    const allowed = takePopBudget(ip, d);
    if (allowed <= 0) {
      return res.status(429).json({ status: 'error', message: 'slow down' });
    }

    const { data, error } = await supabase.rpc('increment_faculty_score', {
      fid: faculty_id,
      delta: allowed,
    });

    if (error) {
      console.error('[ranking] rpc error:', error.message);
      return res.status(500).json({ status: 'error', message: error.message });
    }

    return res.json({ status: 'success', count: Number(data) || 0, applied: allowed });
  } catch (err) {
    console.error('[ranking] pop error:', err);
    return res.status(500).json({ status: 'error', message: 'Internal server error' });
  }
});

// Export app for Vercel Serverless
module.exports = app;
