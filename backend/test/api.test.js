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
    delete process.env.TRUST_PROXY;
    delete process.env.POP_POST_ORIGINS;
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_VERIFY_URL;
    delete process.env.TURNSTILE_MODE;
    delete process.env.TURNXSTILE_MODE;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_ANON_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
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

  test('GET /api/admin/analytics without key returns 401', async () => {
    const app = loadApp();
    const res = await request(app).get('/api/admin/analytics');
    assert.equal(res.status, 401);
  });

  test('production without CORS_ORIGINS does not allow cross-origin', async () => {
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

  test('TRUST_PROXY=1 enables trust proxy', async () => {
    process.env.TRUST_PROXY = '1';
    unloadApp();
    const app = loadApp();
    assert.equal(app.get('trust proxy'), 1);
  });

  test('production rejects pop when origin is not allowlisted', async () => {
    process.env.NODE_ENV = 'production';
    process.env.POP_POST_ORIGINS = 'https://prompttu.vercel.app';
    unloadApp();
    const app = loadApp();
    const res = await request(app)
      .post('/api/ranking/pop')
      .set('Origin', 'https://evil.example')
      .send({ faculty_id: 'law', delta: 1 });
    assert.equal(res.status, 403);
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
