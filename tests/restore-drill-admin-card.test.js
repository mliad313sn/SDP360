'use strict';
// E11 — the "Last restore drill" admin card is live only when wired on the four admin surfaces
// (CLAUDE.md pitfall) and its route (routes/health.js) is super_admin-only; plus the registry
// carries the monthly job and the backup job runs at the documented hour.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../public/reports.html'), 'utf8').replace(/\r\n/g, '\n');

test('the card exists and is wired on the four admin surfaces (+ loader)', () => {
  assert.match(src, /<div class="card admin-panel" id="ap-restore-drill" data-panel="restore-drill">/);
  for (const id of ['rd-status', 'rd-counts']) assert.ok(src.includes(`id="${id}"`), id);
  assert.match(src, /'restore-drill':'ap-restore-drill'/, '_ADMIN_PANEL_IDS');
  assert.match(src, /'backups','restore-drill','sso'[^\]]*\]\.includes\(sub\)/, 'deep-link allowlist');
  assert.match(src, /id="admin-rail-restore-drill" style="display:none"/, 'rail hidden by default');
  assert.match(src, /getElementById\('admin-rail-restore-drill'\)[\s\S]{0,120}isSuperAdmin \? '' : 'none'/, 'rail shown for super_admin');
  assert.match(src, /name === 'restore-drill' \|\| name === 'asset-reminders'[^)]*\) && currentUser\?\.role !== 'super_admin'/, 'super_admin guard');
  assert.match(src, /if \(name === 'restore-drill' && typeof loadRestoreDrillCard === 'function'\) loadRestoreDrillCard\(\);/);
  assert.ok(src.includes("'/api/health/restore-drill'"));
});

test('every inline <script> of reports.html still compiles', () => {
  const re = /<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(src))) { assert.doesNotThrow(() => new Function(m[1])); n++; }
  assert.ok(n >= 1);
});

test('GET /api/health/restore-drill: super_admin only, returns the newest restore_drill row (or null)', async () => {
  const express = require('express');
  const fetch = require('./_http-fetch');
  let rows = [];
  const rdb = {
    userHasRole: (u, r) => !!u && (u.roles || []).includes(r),
    listSystemLog: async (f, o) => { assert.deepEqual(f, { category: 'ops', action: 'restore_drill' }); assert.equal(o.limit, 1); return { rows, total: rows.length }; },
    getSyncStatus: async () => [],
  };
  const app = express();
  app.use(require('../routes/health')({ express, checkZohoViewSchema: async () => [], getRdb: () => rdb,
    requireReportSession: (req, res, next) => { req.reportUser = { id: 1, username: 'x', roles: [req.headers['x-role']] }; next(); } }));
  const srv = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  const url = `http://127.0.0.1:${srv.address().port}/api/health/restore-drill`;
  try {
    assert.equal((await fetch(url, { headers: { 'x-role': 'admin' } })).status, 403);
    let r = await fetch(url, { headers: { 'x-role': 'super_admin' } });
    assert.equal(r.status, 200); assert.deepEqual(await r.json(), { last: null });
    rows = [{ ts: '2026-10-21T04:00:09.000Z', target: '2026-10-21', risk: 0, details: JSON.stringify({ ok: true, counts: { users: { live: 3, restored: 3, status: 'ok' } }, dump: 'a.sql.gz.enc', encrypted: true }) }];
    r = await fetch(url, { headers: { 'x-role': 'super_admin' } });
    const body = await r.json();
    assert.deepEqual([body.last.ok, body.last.date, body.last.details.counts.users.status], [true, '2026-10-21', 'ok']);
  } finally { srv.close(); }
});

test('job registry: db.backup at 03:00 (as docs/ops/EXPLOITATION.md says), db.restore_drill monthly on the 1st at 04:00, optional + freshness declared', () => {
  const { buildJobs, FRESHNESS_HOURS, OPTIONAL } = require('../services/sync/jobs');
  const jobs = buildJobs({ sync: {}, assets: {}, fetchView: () => {}, tools: {} });
  const bk = jobs.find((j) => j.name === 'db.backup'); const dr = jobs.find((j) => j.name === 'db.restore_drill');
  assert.equal(bk.cron, '0 3 * * *');
  assert.equal(dr.cron, '0 4 1 * *');
  assert.ok(OPTIONAL.has('db.restore_drill') && dr.optional);
  assert.equal(FRESHNESS_HOURS['db.restore_drill'], dr.freshnessHours);
  assert.ok(dr.freshnessHours >= 24 * 31, 'a monthly job must not read stale after 30 days');
  const doc = fs.readFileSync(path.join(__dirname, '../docs/ops/EXPLOITATION.md'), 'utf8');
  assert.match(doc, /db\.backup`? \(03:00/, 'the operations manual announces the same hour');
  assert.match(doc, /restore-drill/);
  assert.ok(require('../services/reportConfig').DEFAULTS.backup_offsite_path === '', 'backup_offsite_path is a declared config key');
});
