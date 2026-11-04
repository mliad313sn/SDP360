'use strict';
// C-18 — the nightly access.grant_expiry job: registered as an internal optional job, self-skips while
// access_grant_expiry_job = '0' (today), and when armed runs the store's expiry pass (ends expired grants,
// activates approved requests whose day has come).
const { test } = require('node:test');
const assert = require('node:assert');
const jobs = require('../services/sync/jobs');
const { DEFAULTS } = require('../services/reportConfig');

test('registered, optional, freshness declared; default switch keeps today (off)', () => {
  const list = jobs.buildJobs({ tools: {} });
  const j = list.find((x) => x.name === 'access.grant_expiry');
  assert.ok(j); assert.equal(j.cron, '50 3 * * *');
  assert.ok(jobs.OPTIONAL.has('access.grant_expiry')); assert.equal(jobs.FRESHNESS_HOURS['access.grant_expiry'], 30);
  assert.equal(DEFAULTS.access_grant_expiry_job, '0'); assert.equal(DEFAULTS.access_require_approval, '0');
});

test('skips while access_grant_expiry_job is 0; runs the store pass when 1', async () => {
  let ran = 0;
  const accessStore = { runExpiry: async () => { ran++; return { activated: 1, expired: 2, rows: 3 }; } };
  assert.deepEqual(await jobs.accessGrantExpiryRun({ cfg: { access_grant_expiry_job: '0' }, accessStore }), { skipped: true, reason: 'access_grant_expiry_job is 0' });
  assert.equal(ran, 0);
  assert.deepEqual(await jobs.accessGrantExpiryRun({ cfg: { access_grant_expiry_job: '1' }, accessStore }), { activated: 1, expired: 2, rows: 3 });
});

test('armed on PostgreSQL: an elapsed grant ends and its role is removed, a role held before stays', async () => {
  const rdb = require('../reports-db');
  const H = rdb.pgHandle();
  await rdb.createUser({ username: 'exp_user', full_name: 'Exp User', password: 'exp_user_pw_0000', roles: ['viewer', 'audit-viewer', 'report-author'] });
  const id = Number((await H.prepare('SELECT id FROM users WHERE username=?').get('exp_user')).id);
  const r = await H.prepare(`INSERT INTO access_requests (subject_user_id, requested_by, roles, valid_from, valid_to, justification, status, created_at)
    VALUES (?, ?, ?, '2026-01-01', '2026-01-31', 'old access, now elapsed', 'ACTIVE', '2026-01-01') RETURNING id`).get(id, id, ['report-author', 'audit-viewer']);
  await H.prepare(`INSERT INTO access_grants (user_id, role, request_id, valid_from, valid_to, held_before, created_at) VALUES (?, 'report-author', ?, '2026-01-01', '2026-01-31', false, '2026-01-01'), (?, 'audit-viewer', ?, '2026-01-01', '2026-01-31', true, '2026-01-01')`).run(id, r.id, id, r.id);
  const out = await jobs.accessGrantExpiryRun({ rdb, cfg: { access_grant_expiry_job: '1' } });
  assert.ok(out.expired >= 1);
  const u = (await rdb.listUsers()).find((x) => Number(x.id) === id);
  assert.ok(!u.roles.includes('report-author')); assert.ok(u.roles.includes('audit-viewer') && u.roles.includes('viewer'));
  assert.equal((await H.prepare('SELECT status FROM access_requests WHERE id = ?').get(r.id)).status, 'EXPIRED');
});
