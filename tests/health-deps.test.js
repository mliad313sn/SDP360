'use strict';
// E-Q07 — pure composition of dependency health: unknown is never green.
const test = require('node:test');
const assert = require('node:assert');
const HD = require('../services/healthDeps');
const NOW = Date.parse('2026-11-06T12:00:00Z');

test('nothing read → every item unknown, overall never ok', () => {
  const r = HD.compose({ freshness: { 'zoho.requests': 3 } }, NOW);
  for (const [k, v] of Object.entries(r.items)) if (k !== 'postgres') assert.notEqual(v.status, 'ok', k);
  assert.equal(r.items.postgres.status, 'unknown');
  assert.equal(r.sync_jobs[0].status, 'unknown');
  assert.notEqual(r.overall, 'ok');
});

test('a job past its freshness window is stale; inside is ok; never-run is unknown', () => {
  const j = HD.syncJobs([{ job: 'a', last_ok: '2026-11-06T11:00:00Z' }, { job: 'b', last_ok: '2026-11-05T00:00:00Z' }], { a: 3, b: 3, c: 3 }, NOW);
  assert.deepEqual(j.map((x) => x.status), ['ok', 'stale', 'unknown']);
});

test('zoho token: never refreshed unknown, expired stale, failed down, valid ok — the token never appears', () => {
  assert.equal(HD.zohoToken({ accessToken: false }, NOW).status, 'unknown');
  assert.equal(HD.zohoToken({ accessToken: true, expiresAt: NOW - 1 }, NOW).status, 'stale');
  assert.equal(HD.zohoToken({ accessToken: false, lastRefreshError: true }, NOW).status, 'down');
  const ok = HD.zohoToken({ accessToken: 'tok-secret', expiresAt: NOW + 60000 }, NOW);
  assert.equal(ok.status, 'ok'); assert.ok(!JSON.stringify(ok).includes('tok-secret'));
});

test('smtp is never probed → unknown even when configured; restore drill and disk', () => {
  assert.deepEqual(HD.smtp({ smtp_host: 'mail' }), { status: 'unknown', configured: true, note: 'never probed by the health check' });
  assert.equal(HD.restoreDrill(null, 792, NOW).status, 'unknown');
  assert.equal(HD.restoreDrill({ ts: '2026-11-01T00:00:00Z', ok: true }, 792, NOW).status, 'ok');
  assert.equal(HD.restoreDrill({ ts: '2026-11-01T00:00:00Z', ok: false }, 792, NOW).status, 'down');
  assert.equal(HD.disk(null).status, 'unknown');
  assert.equal(HD.disk({ free_bytes: 50, total_bytes: 100 }).status, 'ok');
});
