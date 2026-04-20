'use strict';

const { strict: assert } = require('node:assert');
const { test, describe, afterEach } = require('node:test');
const request = require('supertest');

const INDEX = require.resolve('../api/index.js');
const SUPABASE_CLIENT = require.resolve('../src/supabaseClient.js');

function loadApp() {
  return require('../api/index.js');
}

function unloadApp() {
  delete require.cache[INDEX];
  delete require.cache[SUPABASE_CLIENT];
}

describe('API', () => {
  const originalFetch = global.fetch

  afterEach(() => {
    delete process.env.NODE_ENV;
    delete process.env.VERCEL;
    delete process.env.CORS_ORIGINS;
    delete process.env.CORS_ENFORCE;
    delete process.env.TRUST_PROXY;
    delete process.env.POP_POST_ORIGINS;
    delete process.env.POP_ORIGIN_ENFORCE;
    delete process.env.POP_CLIENT_RATE_MODE;
    delete process.env.POP_CLIENT_CPS_MAX;
    delete process.env.POP_WRITE_BEHIND;
    delete process.env.POP_FLUSH_INTERNAL_KEY;
    delete process.env.ANALYTICS_ORIGIN_ENFORCE;
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_VERIFY_URL;
    delete process.env.TURNSTILE_MODE;
    delete process.env.TURNXSTILE_MODE;
    delete process.env.POP_SESSION_SECRET;
    delete process.env.POP_SESSION_MODE;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;
    global.fetch = originalFetch;
    unloadApp();
  });

  test('GET /api responds', async () => {
    const app = loadApp();
    const res = await request(app).get('/api');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
  });

  test('POST /api/ranking/pop rejects unknown faculty', async () => {
    const app = loadApp();
    const res = await request(app)
      .post('/api/ranking/pop')
      .send({ faculty_id: 'not_a_faculty', delta: 1 });
    assert.equal(res.status, 400);
  });

  test('POST /api/ranking/pop rejects non-positive delta', async () => {
    const app = loadApp();
    const res = await request(app)
      .post('/api/ranking/pop')
      .send({ faculty_id: 'law', delta: 0 });
    assert.equal(res.status, 400);
  });

  test('POST /api/analytics requires event_type', async () => {
    const app = loadApp();
    const res = await request(app).post('/api/analytics').send({});
    assert.equal(res.status, 400);
  });

  test('POST /api/analytics rejects malformed event_type', async () => {
    const app = loadApp();
    const res = await request(app)
      .post('/api/analytics')
      .send({ event_type: 'bad event type' });
    assert.equal(res.status, 400);
  });

  test('POST /api/analytics rate limits repeated requests by IP', async () => {
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    unloadApp();
    const app = loadApp();
    let last = null;
    for (let i = 0; i < 80; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/api/analytics')
        .set('X-Forwarded-For', '198.51.100.77')
        .send({ event_type: `ping_${i}` });
      last = res;
      if (res.status === 429) break;
    }
    assert.ok(last);
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers['retry-after']) >= 1);
  });

  test('GET /api/admin/analytics without key returns 401', async () => {
    const app = loadApp();
    const res = await request(app).get('/api/admin/analytics');
    assert.equal(res.status, 401);
  });

  test('POST /api/internal/flush-pop requires auth', async () => {
    const app = loadApp();
    const res = await request(app).post('/api/internal/flush-pop');
    assert.equal(res.status, 401);
  });

  test('POST /api/internal/flush-pop allows vercel cron header', async () => {
    const app = loadApp();
    const res = await request(app)
      .post('/api/internal/flush-pop')
      .set('x-vercel-cron', '1');
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'success');
  });

  test('GET /api/ranking/session returns disabled when secret is unset', async () => {
    const app = loadApp();
    const res = await request(app).get('/api/ranking/session');
    assert.equal(res.status, 200);
    assert.equal(res.body.enabled, false);
  });

  test('production without CORS_ORIGINS blocks cross-origin by default', async () => {
    process.env.NODE_ENV = 'production';
    delete process.env.CORS_ORIGINS;
    delete process.env.VERCEL;
    unloadApp();
    const app = loadApp();
    const res = await request(app)
      .get('/api')
      .set('Origin', 'https://evil.example');
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  test('production CORS blocks cross-origin when CORS_ENFORCE=1', async () => {
    process.env.NODE_ENV = 'production';
    process.env.CORS_ENFORCE = '1';
    delete process.env.CORS_ORIGINS;
    unloadApp();
    const app = loadApp();
    const res = await request(app)
      .get('/api')
      .set('Origin', 'https://evil.example');
    assert.equal(res.status, 200);
    assert.equal(res.headers['access-control-allow-origin'], undefined);
  });

  test('TRUST_PROXY=1 enables trust proxy', async () => {
    process.env.TRUST_PROXY = '1';
    unloadApp();
    const app = loadApp();
    assert.equal(app.get('trust proxy'), 1);
  });

  test('production enforces pop origin only when POP_ORIGIN_ENFORCE=1', async () => {
    process.env.NODE_ENV = 'production';
    process.env.POP_POST_ORIGINS = 'https://prompttu.vercel.app';
    process.env.POP_ORIGIN_ENFORCE = '1';
    unloadApp();
    const app = loadApp();
    const res = await request(app)
      .post('/api/ranking/pop')
      .set('Origin', 'https://evil.example')
      .send({ faculty_id: 'law', delta: 1 });
    assert.equal(res.status, 403);
  });

  test('production soft-allows pop when origin mismatches and enforce is off', async () => {
    process.env.NODE_ENV = 'production';
    process.env.POP_POST_ORIGINS = 'https://prompttu.vercel.app';
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    process.env.TRUST_PROXY = '1';
    unloadApp();
    const app = loadApp();
    const res = await request(app)
      .post('/api/ranking/pop')
      .set('Origin', 'https://evil.example')
      .set('X-Forwarded-For', `198.51.100.${Math.floor(Math.random() * 200) + 1}`)
      .send({ faculty_id: 'law', delta: 1 });
    assert.equal(res.status, 500);
    assert.equal(res.headers['x-pop-origin-result'], 'failed-soft');
  });

  test('client click timestamp check rejects impossible speed in enforce mode', async () => {
    process.env.POP_CLIENT_RATE_MODE = 'enforce';
    process.env.POP_CLIENT_CPS_MAX = '20';
    process.env.TRUST_PROXY = '1';
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    unloadApp();
    const app = loadApp();
    const res = await request(app)
      .post('/api/ranking/pop')
      .set('X-Forwarded-For', `198.51.100.${Math.floor(Math.random() * 200) + 1}`)
      .send({
        faculty_id: 'law',
        delta: 10,
        client_first_click_ms: Date.now() - 30,
        client_last_click_ms: Date.now(),
      });
    assert.equal(res.status, 429);
    assert.equal(res.body.message, 'too fast');
  });

  test('client click timestamp check monitor mode does not block', async () => {
    process.env.POP_CLIENT_RATE_MODE = 'monitor';
    process.env.POP_CLIENT_CPS_MAX = '20';
    process.env.TRUST_PROXY = '1';
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    unloadApp();
    const app = loadApp();
    const res = await request(app)
      .post('/api/ranking/pop')
      .set('X-Forwarded-For', `198.51.100.${Math.floor(Math.random() * 200) + 1}`)
      .send({
        faculty_id: 'law',
        delta: 10,
        client_first_click_ms: Date.now() - 30,
        client_last_click_ms: Date.now(),
      });
    assert.equal(res.status, 500);
    assert.ok(String(res.headers['x-client-rate-result'] || '').startsWith('failed:too-fast'));
  });

  test('429 response includes Retry-After header', async () => {
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    unloadApp();
    const app = loadApp();
    const fid = 'law';
    let last = null;
    for (let i = 0; i < 10; i++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await request(app)
        .post('/api/ranking/pop')
        .send({ faculty_id: fid, delta: 50 });
      last = res;
      if (res.status === 429) break;
    }
    assert.ok(last);
    assert.equal(last.status, 429);
    assert.ok(Number(last.headers['retry-after']) >= 1);
  });

  test('ranking/pop requires turnstile token when secret is configured', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    process.env.TURNSTILE_MODE = 'enforce';
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    unloadApp();
    const app = loadApp();
    const res = await request(app)
      .post('/api/ranking/pop')
      .send({ faculty_id: 'law', delta: 1 });
    assert.equal(res.status, 403);
    assert.equal(res.body.message, 'captcha required');
  });

  test('ranking/pop rejects invalid turnstile token', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    process.env.TURNSTILE_MODE = 'enforce';
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    global.fetch = async () => ({
      ok: true,
      json: async () => ({ success: false }),
    });
    unloadApp();
    const app = loadApp();
    const res = await request(app)
      .post('/api/ranking/pop')
      .send({ faculty_id: 'law', delta: 1, turnstile_token: 'bad-token' });
    assert.equal(res.status, 403);
    assert.equal(res.body.message, 'captcha failed');
  });

  test('ranking/pop defaults to monitor mode when TURNSTILE_MODE is unset', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    process.env.TRUST_PROXY = '1';
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    unloadApp();
    const app = loadApp();
    const res = await request(app)
      .post('/api/ranking/pop')
      .set('X-Forwarded-For', `198.51.100.${Math.floor(Math.random() * 200) + 1}`)
      .send({ faculty_id: 'law', delta: 1 });
    assert.equal(res.status, 500);
    assert.equal(res.headers['x-turnstile-result'], 'missing');
  });

  test('ranking/pop enforce mode soft-fails when turnstile verify transport is down', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    process.env.TURNSTILE_MODE = 'enforce';
    process.env.TRUST_PROXY = '1';
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    global.fetch = async () => {
      throw new Error('network down');
    };
    unloadApp();
    const app = loadApp();
    const res = await request(app)
      .post('/api/ranking/pop')
      .set('X-Forwarded-For', `198.51.100.${Math.floor(Math.random() * 200) + 1}`)
      .send({ faculty_id: 'law', delta: 1, turnstile_token: 'token' });
    assert.equal(res.status, 500);
    assert.ok(String(res.headers['x-turnstile-result'] || '').startsWith('soft-fail:'));
  });

  test('ranking/pop monitor mode does not block missing token', async () => {
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    process.env.TURNSTILE_MODE = 'monitor';
    process.env.TRUST_PROXY = '1';
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    unloadApp();
    const app = loadApp();
    const res = await request(app)
      .post('/api/ranking/pop')
      .set('X-Forwarded-For', `198.51.100.${Math.floor(Math.random() * 200) + 1}`)
      .send({ faculty_id: 'law', delta: 1 });
    assert.equal(res.status, 500);
    assert.equal(res.headers['x-turnstile-result'], 'missing');
  });

  test('session token enforce mode rejects pop without token', async () => {
    process.env.POP_SESSION_SECRET = 'session-secret';
    process.env.POP_SESSION_MODE = 'enforce';
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    unloadApp();
    const app = loadApp();
    const res = await request(app)
      .post('/api/ranking/pop')
      .send({ faculty_id: 'law', delta: 1 });
    assert.equal(res.status, 403);
    assert.equal(res.body.message, 'invalid session token');
  });

  test('session token enforce mode accepts valid token', async () => {
    process.env.POP_SESSION_SECRET = 'session-secret';
    process.env.POP_SESSION_MODE = 'enforce';
    process.env.TRUST_PROXY = '1';
    process.env.SUPABASE_URL = '';
    process.env.SUPABASE_ANON_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = '';
    unloadApp();
    const app = loadApp();

    const issued = await request(app).get('/api/ranking/session');
    assert.equal(issued.status, 200);
    assert.equal(issued.body.enabled, true);
    assert.ok(typeof issued.body.token === 'string' && issued.body.token.length > 0);

    const res = await request(app)
      .post('/api/ranking/pop')
      .set('X-Forwarded-For', `198.51.100.${Math.floor(Math.random() * 200) + 1}`)
      .send({ faculty_id: 'law', delta: 1, session_token: issued.body.token });
    assert.equal(res.status, 500);
    assert.equal(res.headers['x-session-token-result'], 'passed');
  });

  test('health accepts near-miss turnstile mode env names', async () => {
    process.env.TURNXSTILE_MODE = 'enforce';
    process.env.TURNSTILE_SECRET_KEY = 'secret';
    unloadApp();
    const app = loadApp();
    const res = await request(app).get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.body.turnstile_mode, 'enforce');
  });
});
