'use strict';

const PENDING_HASH_KEY = 'poptu:pop:pending';
const FLUSH_LOCK_KEY = 'poptu:pop:flush:lock';
const FLUSH_LOCK_TTL_SEC = 15;
const RPC_STEP_MAX = 100;

/** @type {import('@upstash/redis').Redis | null | false} */
let redisClient = null;

// Support both Upstash-native (`UPSTASH_REDIS_REST_*`) and Vercel KV-style
// (`KV_REST_API_*`) env names. Vercel's Upstash marketplace integration
// injects the `KV_*` set by default, which would otherwise look "missing"
// to us and silently disable write-behind.
function resolveRedisEnv() {
  const url = (
    process.env.UPSTASH_REDIS_REST_URL ||
    process.env.KV_REST_API_URL ||
    ''
  ).trim();
  const token = (
    process.env.UPSTASH_REDIS_REST_TOKEN ||
    process.env.KV_REST_API_TOKEN ||
    ''
  ).trim();
  return { url, token };
}

function hasRedisEnv() {
  const { url, token } = resolveRedisEnv();
  return Boolean(url && token);
}

function isWriteBehindEnabled() {
  const raw = (process.env.POP_WRITE_BEHIND || '1').trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off') return false;
  return hasRedisEnv();
}

function getRedisClient() {
  if (redisClient !== null) return redisClient || null;
  const { url, token } = resolveRedisEnv();
  if (!url || !token) {
    redisClient = false;
    return null;
  }
  try {
    const { Redis } = require('@upstash/redis');
    // Construct explicitly instead of Redis.fromEnv() since fromEnv only
    // recognises UPSTASH_REDIS_REST_* names.
    redisClient = new Redis({ url, token });
    return redisClient;
  } catch (err) {
    console.warn('[writeBehind] Redis init failed:', err && err.message ? err.message : err);
    redisClient = false;
    return null;
  }
}

function normalizePositiveInt(v) {
  const n = Math.floor(Number(v));
  if (!Number.isFinite(n) || n <= 0) return 0;
  return n;
}

async function enqueuePop(fid, delta) {
  if (!isWriteBehindEnabled()) return { queued: false, reason: 'disabled' };
  const redis = getRedisClient();
  if (!redis) return { queued: false, reason: 'no-redis' };
  const d = normalizePositiveInt(delta);
  if (d <= 0) return { queued: false, reason: 'invalid-delta' };
  const n = await redis.hincrby(PENDING_HASH_KEY, fid, d);
  return { queued: true, pending_for_faculty: Number(n) || d };
}

async function getPendingMap() {
  if (!isWriteBehindEnabled()) return {};
  const redis = getRedisClient();
  if (!redis) return {};
  const raw = (await redis.hgetall(PENDING_HASH_KEY)) || {};
  const out = {};
  for (const [fid, v] of Object.entries(raw)) {
    const n = normalizePositiveInt(v);
    if (n > 0) out[fid] = n;
  }
  return out;
}

async function acquireFlushLock(redis) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const ok = await redis.set(FLUSH_LOCK_KEY, token, { nx: true, ex: FLUSH_LOCK_TTL_SEC });
  if (!ok) return null;
  return token;
}

async function releaseFlushLock(redis, token) {
  try {
    const cur = await redis.get(FLUSH_LOCK_KEY);
    if (String(cur || '') === token) {
      await redis.del(FLUSH_LOCK_KEY);
    }
  } catch {
    // lock has short TTL; safe to ignore release errors
  }
}

async function applyFacultyDelta(supabase, fid, total) {
  let remaining = normalizePositiveInt(total);
  let applied = 0;
  while (remaining > 0) {
    const step = Math.min(remaining, RPC_STEP_MAX);
    const { error } = await supabase.rpc('increment_faculty_score', {
      fid,
      delta: step,
    });
    if (error) {
      throw new Error(error.message || 'increment_faculty_score failed');
    }
    remaining -= step;
    applied += step;
  }
  return applied;
}

async function flushPendingToDb(supabase) {
  const summary = {
    flushed: 0,
    faculties: 0,
    errors: [],
    skipped: false,
    reason: '',
  };
  if (!isWriteBehindEnabled()) {
    summary.skipped = true;
    summary.reason = 'disabled';
    return summary;
  }
  const redis = getRedisClient();
  if (!redis) {
    summary.skipped = true;
    summary.reason = 'no-redis';
    return summary;
  }
  if (!supabase) {
    summary.skipped = true;
    summary.reason = 'no-supabase';
    return summary;
  }

  const lockToken = await acquireFlushLock(redis);
  if (!lockToken) {
    summary.skipped = true;
    summary.reason = 'locked';
    return summary;
  }

  try {
    const pending = await getPendingMap();
    for (const [fid, total] of Object.entries(pending)) {
      if (total <= 0) continue;
      let applied = 0;
      try {
        applied = await applyFacultyDelta(supabase, fid, total);
      } catch (err) {
        summary.errors.push({
          faculty_id: fid,
          message: err && err.message ? err.message : String(err),
        });
      }
      if (applied > 0) {
        const left = Number(await redis.hincrby(PENDING_HASH_KEY, fid, -applied)) || 0;
        if (left <= 0) {
          await redis.hdel(PENDING_HASH_KEY, fid);
        }
        summary.flushed += applied;
        summary.faculties += 1;
      }
    }
    return summary;
  } finally {
    await releaseFlushLock(redis, lockToken);
  }
}

module.exports = {
  enqueuePop,
  flushPendingToDb,
  getPendingMap,
  isWriteBehindEnabled,
};
