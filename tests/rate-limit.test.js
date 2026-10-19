'use strict';
const { test } = require('node:test');
const assert = require('node:assert');
const { decide, memoryStore, persistentLimiter } = require('../services/rateLimit');

test('decide: allows up to max, then 429 with a Retry-After that counts down the window', () => {
  assert.deepEqual(decide({ start: 0, count: 10 }, { max: 10, windowMs: 60000, now: 1000 }), { allowed: true });
  assert.deepEqual(decide({ start: 0, count: 11 }, { max: 10, windowMs: 60000, now: 1000 }), { allowed: false, retryAfterSec: 59 });
});

test('persistentLimiter: uses the store, survives a "restart" (new limiter, same store), falls back to memory when the store throws', async () => {
  const hits = new Map();
  const store = { rateLimitBump: async (scope, key, now, windowMs) => { const k = scope + key; const e = hits.get(k); if (!e || now - e.start > windowMs) { hits.set(k, { start: now, count: 1 }); return hits.get(k); } e.count++; return e; } };
  let t = 1000;
  const mk = () => persistentLimiter({ windowMs: 60000, max: 2, scope: 'login', store: () => store, now: () => t, log: () => {} });
  const res = () => { const r = { status: (c) => { r.code = c; return r; }, json: () => r, setHeader: () => {} }; return r; };
  const req = { ip: '10.0.0.1' };
  let lim = mk(); let nexts = 0;
  await lim(req, res(), () => nexts++); await lim(req, res(), () => nexts++);
  lim = mk();                                            // process restart — the store remembers
  const r3 = res(); await lim(req, r3, () => nexts++);
  assert.equal(nexts, 2); assert.equal(r3.code, 429);
  const broken = persistentLimiter({ windowMs: 60000, max: 1, scope: 'x', store: () => ({ rateLimitBump: async () => { throw new Error('db'); } }), now: () => t, log: () => {} });
  let n2 = 0; await broken(req, res(), () => n2++); const r5 = res(); await broken(req, r5, () => n2++);
  assert.equal(n2, 1); assert.equal(r5.code, 429, 'memory fallback still limits');
});
