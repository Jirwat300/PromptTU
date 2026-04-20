/**
 * Per-IP pop budget for POST /api/ranking/pop.
 * Default: in-memory Map (per serverless instance).
 * Optional: set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for shared limits across instances.
 */

const POP_MAX_DELTA_PER_SEC = 12;
const POP_MAX_DELTA_PER_MIN = 120;
const POP_MAX_DELTA_PER_CALL = 50;
const POP_VIOLATIONS_TO_BLOCK = 8;
const POP_VIOLATION_WINDOW_SEC = 60;
const POP_BLOCK_SECONDS = 600;

const popBuckets = new Map();

function hasSharedPopRedisEnv() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL ||
      process.env.KV_REST_API_URL,
  );
}

const prodLike =
  process.env.VERCEL === '1' || process.env.NODE_ENV === 'production';
if (prodLike && !hasSharedPopRedisEnv()) {
  console.warn(
    '[popRateLimit] No UPSTASH_REDIS_REST_URL or KV_REST_API_URL: per-IP limits are per serverless instance only. Set Upstash (or Vercel KV) for consistent limits under load.',
  );
}

/** @type {unknown} */
let upstash = null;

function getUpstash() {
  if (upstash !== null) return upstash || null;
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) {
    upstash = false;
    return null;
  }
  try {
    const { Redis } = require('@upstash/redis');
    // Supports UPSTASH_* and Vercel KV-style KV_REST_API_* env names.
    upstash = Redis.fromEnv();
    return upstash;
  } catch (e) {
    console.warn('[popRateLimit] Upstash init failed, using memory:', e.message);
    upstash = false;
    return null;
  }
}

// Atomic cap across fixed windows: second burst + minute sustained.
const POP_RL_LUA = `
local secKey = KEYS[1]
local minKey = KEYS[2]
local banKey = KEYS[3]
local vioKey = KEYS[4]
local delta = tonumber(ARGV[1])
local secCap = tonumber(ARGV[2])
local minCap = tonumber(ARGV[3])
local secTtl = tonumber(ARGV[4])
local minTtl = tonumber(ARGV[5])
local blockTtl = tonumber(ARGV[6])
local vioLimit = tonumber(ARGV[7])
local vioTtl = tonumber(ARGV[8])
if redis.call('EXISTS', banKey) == 1 then
  local banRemain = tonumber(redis.call('TTL', banKey) or '1')
  if banRemain < 1 then banRemain = 1 end
  return {0, banRemain}
end
local secCur = tonumber(redis.call('GET', secKey) or '0')
local minCur = tonumber(redis.call('GET', minKey) or '0')
local secRemain = secCap - secCur
local minRemain = minCap - minCur
if secRemain <= 0 or minRemain <= 0 then
  local v = tonumber(redis.call('INCR', vioKey) or '0')
  if v == 1 then redis.call('EXPIRE', vioKey, vioTtl) end
  if v >= vioLimit then
    redis.call('SET', banKey, '1', 'EX', blockTtl)
    redis.call('DEL', vioKey)
    return {0, blockTtl}
  end
  local retry = math.max(tonumber(redis.call('TTL', secKey) or '1'), tonumber(redis.call('TTL', minKey) or '1'))
  if retry < 1 then retry = 1 end
  return {0, retry}
end
local allowed = math.min(delta, secRemain, minRemain)
redis.call('INCRBY', secKey, allowed)
redis.call('EXPIRE', secKey, secTtl)
redis.call('INCRBY', minKey, allowed)
redis.call('EXPIRE', minKey, minTtl)
return {allowed, 0}
`;

function takePopBudgetMemory(ip, delta) {
  const now = Date.now();
  const bucket = popBuckets.get(ip);
  if (!bucket) {
    const allowed = Math.min(delta, POP_MAX_DELTA_PER_SEC, POP_MAX_DELTA_PER_MIN);
    popBuckets.set(ip, {
      secWindowStart: now,
      secDelta: allowed,
      minWindowStart: now,
      minDelta: allowed,
      vioWindowStart: now,
      violations: 0,
      blockedUntil: 0,
    });
    return { allowed, retryAfterSec: 0 };
  }

  if (bucket.blockedUntil > now) {
    return {
      allowed: 0,
      retryAfterSec: Math.max(1, Math.ceil((bucket.blockedUntil - now) / 1000)),
    };
  }

  if (now - bucket.secWindowStart > 1000) {
    bucket.secWindowStart = now;
    bucket.secDelta = 0;
  }
  if (now - bucket.minWindowStart > 60000) {
    bucket.minWindowStart = now;
    bucket.minDelta = 0;
  }

  const secRemaining = POP_MAX_DELTA_PER_SEC - bucket.secDelta;
  const minRemaining = POP_MAX_DELTA_PER_MIN - bucket.minDelta;
  const remaining = Math.min(secRemaining, minRemaining);
  if (now - bucket.vioWindowStart > POP_VIOLATION_WINDOW_SEC * 1000) {
    bucket.vioWindowStart = now;
    bucket.violations = 0;
  }
  if (remaining <= 0) {
    bucket.violations += 1;
    if (bucket.violations >= POP_VIOLATIONS_TO_BLOCK) {
      bucket.violations = 0;
      bucket.vioWindowStart = now;
      bucket.blockedUntil = now + POP_BLOCK_SECONDS * 1000;
      return { allowed: 0, retryAfterSec: POP_BLOCK_SECONDS };
    }
    const secRetry = Math.max(1, Math.ceil((1000 - (now - bucket.secWindowStart)) / 1000));
    const minRetry = Math.max(1, Math.ceil((60000 - (now - bucket.minWindowStart)) / 1000));
    return { allowed: 0, retryAfterSec: Math.max(secRetry, minRetry) };
  }
  const allowed = Math.min(delta, remaining);
  bucket.secDelta += allowed;
  bucket.minDelta += allowed;
  return { allowed, retryAfterSec: 0 };
}

/**
 * @param {string} ip
 * @param {number} delta
 * @returns {Promise<number>}
 */
async function takePopBudget(ip, delta) {
  const r = getUpstash();
  if (!r) {
    return takePopBudgetMemory(ip, delta);
  }
  const sec = Math.floor(Date.now() / 1000);
  const min = Math.floor(Date.now() / 60_000);
  const secKey = `poptu:pop:sec:${ip}:${sec}`;
  const minKey = `poptu:pop:min:${ip}:${min}`;
  const banKey = `poptu:pop:ban:${ip}`;
  const vioKey = `poptu:pop:vio:${ip}`;
  try {
    const raw = await r.eval(POP_RL_LUA, [secKey, minKey, banKey, vioKey], [
      String(delta),
      String(POP_MAX_DELTA_PER_SEC),
      String(POP_MAX_DELTA_PER_MIN),
      '3',
      '65',
      String(POP_BLOCK_SECONDS),
      String(POP_VIOLATIONS_TO_BLOCK),
      String(POP_VIOLATION_WINDOW_SEC),
    ]);
    const arr = Array.isArray(raw) ? raw : [raw, 0];
    const allowed = Number(arr[0]);
    const retryAfterSec = Number(arr[1]);
    return {
      allowed: Number.isFinite(allowed) ? allowed : 0,
      retryAfterSec: Number.isFinite(retryAfterSec) ? Math.max(0, retryAfterSec) : 0,
    };
  } catch (e) {
    console.warn('[popRateLimit] Upstash eval failed, falling back to memory:', e.message);
    return takePopBudgetMemory(ip, delta);
  }
}

module.exports = {
  takePopBudget,
  POP_MAX_DELTA_PER_SEC,
  POP_MAX_DELTA_PER_MIN,
  POP_MAX_DELTA_PER_CALL,
  POP_BLOCK_SECONDS,
};
