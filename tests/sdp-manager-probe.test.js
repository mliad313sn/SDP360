'use strict';
// P11 F-02 — the manager / installer health probe hit /api/auth/config, which answers 200 while the
// database is down (/ready answers 503). restore then printed "service answers" and update skipped its
// auto-rollback. The probe must ask /ready (unauthenticated, DB-backed) and treat 503 as not healthy.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const mgr = require('../tools/sdp-manager');

const ROOT = path.join(__dirname, '..');
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8').replace(/\r\n/g, '\n');

// A server whose database is gone: the auth config still answers, readiness does not.
const dbDown = async (url) => ({ ok: !url.endsWith('/ready'), status: url.endsWith('/ready') ? 503 : 200 });

test('probeHealth reports NOT ok when /ready is 503 even though /api/auth/config answers 200', async () => {
  const h = await mgr.probeHealth('http://x', {}, { timeoutMs: 50, intervalMs: 10, fetchImpl: dbDown });
  assert.equal(h.ok, false);
  assert.match(h.reason, /503/);
});

test('probeHealth is ok when /ready answers 200, and asks /ready', async () => {
  const seen = [];
  const h = await mgr.probeHealth('http://x', {}, { timeoutMs: 50, intervalMs: 10,
    fetchImpl: async (u) => { seen.push(u); return { ok: true, status: 200 }; } });
  assert.equal(h.ok, true);
  assert.deepStrictEqual(seen, ['http://x/ready']);
});

test('no installer / manager script probes /api/auth/config for health any more', () => {
  for (const f of ['tools/sdp-manager.js', 'tools/installer/Install-SDP.ps1', 'tools/installer/Setup.bat']) {
    assert.ok(!/\/api\/auth\/config/.test(read(f)), `${f} must probe /ready, not /api/auth/config`);
    assert.ok(/\/ready/.test(read(f)), `${f} probes /ready`);
  }
});
