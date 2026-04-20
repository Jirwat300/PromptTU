'use strict';

const { strict: assert } = require('node:assert');
const { test } = require('node:test');

const {
  takePopBudget,
  POP_MAX_DELTA_PER_SEC,
  POP_MAX_DELTA_PER_MIN,
} = require('../src/popRateLimit');

test('takePopBudget caps a single request at second burst limit', async () => {
  const ip = `test-single-${Date.now()}-${Math.random()}`;
  const budget = await takePopBudget(ip, POP_MAX_DELTA_PER_SEC + 999);
  assert.equal(budget.allowed, POP_MAX_DELTA_PER_SEC);
  assert.equal(budget.retryAfterSec, 0);
});

test('takePopBudget never exceeds minute limit on a single request', async () => {
  const ip = `test-minute-${Date.now()}-${Math.random()}`;
  const budget = await takePopBudget(ip, POP_MAX_DELTA_PER_MIN + 999);
  assert.ok(budget.allowed <= POP_MAX_DELTA_PER_SEC);
  assert.ok(budget.allowed <= POP_MAX_DELTA_PER_MIN);
});

test('takePopBudget returns retryAfterSec when blocked by burst limit', async () => {
  const ip = `test-retry-${Date.now()}-${Math.random()}`;
  const first = await takePopBudget(ip, POP_MAX_DELTA_PER_SEC);
  assert.equal(first.allowed, POP_MAX_DELTA_PER_SEC);

  const second = await takePopBudget(ip, 1);
  assert.equal(second.allowed, 0);
  assert.ok(second.retryAfterSec >= 1);
});
