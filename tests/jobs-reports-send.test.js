'use strict';
// E-Q03 (audit X-Q-03) — reports.weekly / reports.monthly, the two scheduled jobs that had no test reference.
// What they really do (services/engagementJobs.js generateScheduledReports): for every report template of the
// cadence whose dashboard is PUBLISHED, generate one run (one per active site for a site template) and notify the
// template's subscribers in-app — only those who may read the run (P11 r2 R2-N1: same rule as the report
// studio — the generated runs are drafts, so authors only; a site account never hears of another site).
// They send no e-mail themselves.
// Stores and the generator are fakes; no database.
const test = require('node:test');
const assert = require('node:assert');
const { createSyncRunner, memoryStore } = require('../services/sync/syncRunner');
const { buildJobs } = require('../services/sync/jobs');
const EJ = require('../services/engagementJobs');
const RG = require('../services/reportGenerator');

const runner = () => createSyncRunner({ store: memoryStore(), sleep: async () => {}, log: () => {} });

test('reports.weekly / reports.monthly: crons, freshness, optional, call engagement.reports with their cadence', async () => {
  const calls = [];
  const engagement = { evaluate: async () => ({}), digest: async () => ({}), publish: async () => ({}), reports: async (c) => { calls.push(c); return { templates: 1, runs: 2, notified: 1, rows: 2 }; } };
  const jobs = buildJobs({ sync: {}, assets: {}, tools: {}, engagement });
  const w = jobs.find((j) => j.name === 'reports.weekly'), m = jobs.find((j) => j.name === 'reports.monthly');
  assert.equal(w.cron, '30 6 * * 1'); assert.equal(w.freshnessHours, 24 * 8); assert.equal(w.optional, true);
  assert.equal(m.cron, '45 6 1 * *'); assert.equal(m.freshnessHours, 24 * 32); assert.equal(m.optional, true);
  const r = runner();
  assert.equal((await r.run(w.job)).rows, 2);
  assert.equal((await r.run(m.job)).rows, 2);
  assert.deepEqual(calls, ['weekly', 'monthly']);
});

test('reports.weekly / reports.monthly without the engagement binding: a recorded skip (F-ARCH-01: status skipped, not ok)', async () => {
  const jobs = buildJobs({ sync: {}, assets: {}, tools: {} });
  for (const n of ['reports.weekly', 'reports.monthly']) {
    const out = await runner().run(jobs.find((j) => j.name === n).job);
    assert.equal(out.status, 'skipped'); assert.equal(out.reason, 'not configured');
  }
});

function fakes() {
  const generated = [], notes = [];
  const reportStore = { listTemplates: async () => [
    { key: 'site-weekly-pack', name: 'Site pack', cadence: 'weekly', audience: 'site', dashboard_key: 'site-weekly' },
    { key: 'group-weekly', name: 'Group pack', cadence: 'weekly', audience: 'group', dashboard_key: 'group' },
    { key: 'draft-weekly', name: 'Draft', cadence: 'weekly', audience: 'group', dashboard_key: 'unpublished' },
    { key: 'monthly-pack', name: 'Monthly', cadence: 'monthly', audience: 'group', dashboard_key: 'group' },
  ] };
  const dashStore = { published: async (k) => (k === 'unpublished' ? null : { definition: { key: k } }) };
  const subs = { 'site-weekly-pack': [{ user_id: 10, site_id: 1 }, { user_id: 11, site_id: null }], 'group-weekly': [{ user_id: 12, site_id: null }, { user_id: 13, site_id: null }], 'monthly-pack': [] };
  const engStore = { subscribersOf: async (kind, key) => { assert.equal(kind, 'report_template'); return subs[key] || []; }, notify: async (n) => { notes.push(n); } };
  // 10 = site-1 viewer (pre-fix subscription), 11 = report author, 12 = report author, 13 = deactivated author
  const users = [{ id: 10, site_id: 1, roles: ['viewer'], active: 1 }, { id: 11, site_id: null, roles: ['report-author'], active: 1 },
    { id: 12, site_id: null, roles: ['admin'], active: 1 }, { id: 13, site_id: null, roles: ['admin'], active: 0 }];
  const rdb = { listSites: async (o) => { assert.deepEqual(o, { includeInactive: false }); return [{ id: 1, name: 'Hounde' }, { id: '2', name: 'Mana' }]; },
    listUsers: async () => users, userHasRole: require('../reports-db').userHasRole };
  return { generated, notes, reportStore, dashStore, engStore, rdb };
}

test('generateScheduledReports weekly: only the cadence\'s templates with a published dashboard; one run per site; only subscribers who may read the draft run', async () => {
  const f = fakes();
  const orig = RG.generateRun;
  RG.generateRun = async (o) => { f.generated.push({ t: o.template.key, site: o.site && o.site.name }); return { id: 'run' + f.generated.length, analysis: { headline: 'h' } }; };
  try {
    const out = await EJ.generateScheduledReports({ cadence: 'weekly', reportStore: f.reportStore, dashStore: f.dashStore, engStore: f.engStore, registry: {}, deps: {}, rdb: f.rdb, aiProvider: 'off', aiCall: null, baseUrl: 'https://dash.test' });
    assert.deepEqual(out, { templates: 3, runs: 3, notified: 3, withheld: 3, rows: 3 });
    assert.deepEqual(f.generated, [{ t: 'site-weekly-pack', site: 'Hounde' }, { t: 'site-weekly-pack', site: 'Mana' }, { t: 'group-weekly', site: undefined }]);
    const who = f.notes.map((n) => [n.userId, n.title]);
    // the site-1 viewer is not told about drafts (not even its own site); the deactivated author is skipped
    assert.deepEqual(who, [[11, 'Site pack — Hounde ready for review'], [11, 'Site pack — Mana ready for review'], [12, 'Group pack ready for review']]);
    assert.ok(f.notes.every((n) => n.kind === 'report' && n.sourceKind === 'report_run' && /^https:\/\/dash\.test\/report-studio\.html\?run=run\d$/.test(n.link)));
  } finally { RG.generateRun = orig; }
});

test('generateScheduledReports monthly: a cadence with no subscriber generates but notifies nobody; no template → nothing', async () => {
  const f = fakes();
  const orig = RG.generateRun;
  RG.generateRun = async (o) => { f.generated.push(o.template.key); return { id: 'r', analysis: null }; };
  try {
    const out = await EJ.generateScheduledReports({ cadence: 'monthly', reportStore: f.reportStore, dashStore: f.dashStore, engStore: f.engStore, registry: {}, deps: {}, rdb: f.rdb, baseUrl: '' });
    assert.deepEqual(out, { templates: 1, runs: 1, notified: 0, withheld: 0, rows: 1 });
    const none = await EJ.generateScheduledReports({ cadence: 'quarterly', reportStore: f.reportStore, dashStore: f.dashStore, engStore: f.engStore, registry: {}, deps: {}, rdb: f.rdb });
    assert.deepEqual(none, { templates: 0, runs: 0, notified: 0, withheld: 0, rows: 0 });
  } finally { RG.generateRun = orig; }
});
