/**
 * Per-IP pop budget for POST /api/ranking/pop.
 * Default: in-memory Map (per serverless instance).
 * Optional: set UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN for shared limits across instances.
 */

const POP_MAX_DELTA_PER_SEC = 30;
const POP_MAX_DELTA_PER_CALL = 50;

const popBuckets = new Map();

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

// Atomic cap per calendar second (key includes epoch second → fixed window).
const POP_RL_LUA = `
local k = KEYS[1]
local delta = tonumber(ARGV[1])
local cap = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
local cur = tonumber(redis.call('GET', k) or '0')
local remaining = cap - cur
if remaining <= 0 then return 0 end
local allowed = math.min(delta, remaining)
redis.call('INCRBY', k, allowed)
redis.call('EXPIRE', k, ttl)
return allowed
`;

function takePopBudgetMemory(ip, delta) {
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
  const key = `poptu:pop:${ip}:${sec}`;
  try {
    const raw = await r.eval(POP_RL_LUA, [key], [
      String(delta),
      String(POP_MAX_DELTA_PER_SEC),
      '3',
    ]);
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    console.warn('[popRateLimit] Upstash eval failed, falling back to memory:', e.message);
    return takePopBudgetMemory(ip, delta);
  }
}

module.exports = {
  takePopBudget,
  POP_MAX_DELTA_PER_SEC,
  POP_MAX_DELTA_PER_CALL,
};
