'use strict';
// P4 / B9 — weekly report submission nudges: never fire unarmed, never without a deadline policy, deduped per
// site × week × kind, only to the site's coordinators, never for a submitted report.
const test = require('node:test');
const assert = require('node:assert');
const N = require('../services/weeklyReportNudges');

const weeks = [{ id: 10, label: 'W45 2026', end_date: '2026-11-08' }, { id: 11, label: 'W46 2026', end_date: '2026-11-15' }];
const sites = [{ id: 1, name: 'Hounde' }, { id: 2, name: 'Mana' }, { id: 3, name: 'Ity' }, { id: 4, name: 'Closed', active: 0 }];
const users = [{ id: 7, role: 'editor', roles: ['editor'], site_id: 1, active: 1 }, { id: 8, role: 'editor', roles: ['editor'], site_id: 2, active: 1 }];
const reports = [{ id: 100, site_id: 1, week_id: 10, status: 'ready' }, { id: 101, site_id: 2, week_id: 10, status: 'submitted' }];

test('buildNudges: last ENDED week, submitted skipped, inactive skipped, no deadline = off', () => {
  assert.deepStrictEqual(N.buildNudges({ now: new Date('2026-11-10T08:00:00Z'), dueDays: '', weeks, sites, reports, users }), { items: [], off: true });
  const r = N.buildNudges({ now: new Date('2026-11-10T08:00:00Z'), dueDays: '2', weeks, sites, reports, users });
  assert.strictEqual(r.week.id, 10); assert.strictEqual(r.week.due, '2026-11-10');
  assert.deepStrictEqual(r.items.map((i) => [i.key, i.userIds]), [['WR:1:10:due_soon', [7]], ['WR:3:10:due_soon', []]]);
  assert.match(r.items[0].body, /complete but not submitted/);
  assert.strictEqual(r.items[0].link, 'reports.html?report=100');
  const late = N.buildNudges({ now: new Date('2026-11-11T08:00:00Z'), dueDays: '2', weeks, sites, reports, users });
  assert.strictEqual(late.items[0].key, 'WR:1:10:overdue');
});

function harness(cfg) {
  const log = []; const seen = new Set();
  const store = { notify: async (n) => { log.push(n); seen.add(n.sourceRef); } };
  const read = async () => ({ weeks, sites, reports, users });
  return { log, run: (now) => N.runWeeklyNudges({ cfg, read, store, sent: async (k) => seen.has(k), now: new Date(now) }) };
}

test('runWeeklyNudges never fires unarmed (default) nor while notifications_stop, nor without due days', async () => {
  for (const cfg of [{}, { weekly_report_nudges_enabled: '0', weekly_report_due_days: '2' }, { weekly_report_nudges_enabled: '1', weekly_report_due_days: '2', notifications_stop: '1' }, { weekly_report_nudges_enabled: '1', weekly_report_due_days: '' }]) {
    const h = harness(cfg); const r = await h.run('2026-11-10T08:00:00Z');
    assert.ok(r.skipped, JSON.stringify(cfg)); assert.strictEqual(h.log.length, 0);
  }
  assert.strictEqual(require('../services/reportConfig').DEFAULTS.weekly_report_nudges_enabled, '0');
});

test('armed: one nudge per kind per site and week, coordinator-only, deduped across runs', async () => {
  const h = harness({ weekly_report_nudges_enabled: '1', weekly_report_due_days: '2' });
  assert.deepStrictEqual(await h.run('2026-11-10T08:00:00Z'), { items: 2, notified: 1, already: 0, nobody: 1 });
  assert.deepStrictEqual(await h.run('2026-11-10T18:00:00Z'), { items: 2, notified: 0, already: 1, nobody: 1 }, 'second run same day sends nothing');
  assert.deepStrictEqual(await h.run('2026-11-11T08:00:00Z'), { items: 2, notified: 1, already: 0, nobody: 1 }, 'overdue is a different kind');
  await h.run('2026-11-12T08:00:00Z');
  assert.deepStrictEqual(h.log.map((n) => [n.userId, n.sourceKind, n.sourceRef]), [[7, 'weekly_report_nudge', 'WR:1:10:due_soon'], [7, 'weekly_report_nudge', 'WR:1:10:overdue']]);
});

test('the job is registered, optional, behind the engagement binding', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'services', 'sync', 'jobs.js'), 'utf8');
  assert.match(src, /name: 'engagement\.weekly_report_nudges'.*optional: true/);
  assert.ok(typeof require('../services/engagementJobs').bindJobs({ stores: () => ({}) }).weeklyNudges === 'function');
});
