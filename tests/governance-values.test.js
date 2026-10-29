'use strict';
// tools/governance/apply-values.js — the committee's values from one reviewed file: simulation by default,
// all-or-nothing validation, the same guardrails as the screens (relaxations become proposals), re-runs idempotent.
const fetch = require('./_http-fetch');
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = _fs.mkdtempSync(_path.join(_os.tmpdir(), 'gov-values-'));
process.env.SDP_TEST_NO_RATE_LIMIT = '1';
process.env.DASH_USER = process.env.DASH_USER || 'gv-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'gv-admin-pass-0000';
process.env.DASHBOARD_API_KEY = process.env.DASHBOARD_API_KEY || 'gv-key';
for (const k of ['ZOHO_CLIENT_ID', 'ZOHO_CLIENT_SECRET', 'ZOHO_REFRESH_TOKEN']) process.env[k] = process.env[k] || 'dummy';
process.env.AI_PROVIDER = 'off';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const http = require('http');
let rdb, hounde; const logs = [];
before(async () => {
  require('../server'); await require('../server').seedStores();
  rdb = require('../reports-db');
  for (let i = 0; i < 60; i++) { if ((await rdb.db.prepare("SELECT 1 FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'kpi_site_targets'").get())) break; await new Promise((r) => setTimeout(r, 100)); }
  hounde = (await rdb.listSites({ includeInactive: true })).find((s) => /hounde/i.test(s.name));
  for (const [u, roles] of [['gv_super', ['super_admin']], ['gv_lead', ['editor']], ['gv_group', ['admin']], ['gv_admin', ['admin']]]) { try { await rdb.createUser({ username: u, full_name: u, password: u + 'pass1234', roles, site_id: u === 'gv_lead' ? hounde.id : undefined }); } catch {} }
});
const run = (file, ...flags) => require('../tools/governance/apply-values.js').main([file, ...flags], { rdb, log: (m) => logs.push(m) });
const write = (o) => { const p = _path.join(process.env.SDP_DATA_DIR, `v-${Math.random()}.json`); _fs.writeFileSync(p, JSON.stringify(o)); return p; };
const good = () => ({ reason: 'Committee meeting 2026-11-05, minutes CM-12', site_groups: [{ site: hounde.name, country: 'BF' }],
  policies: [{ scope: 'global', key: 'handoffs.reason_min', value: 8 }, { scope: `site:${hounde.name}`, key: 'calendar.skip_weekends', value: true }],
  roles: [{ role: 'handoffs.escalation_target', site: hounde.name, person: 'gv_lead', from: '2026-11-01' }],
  matrix: [{ register: 'handoffs', site: null, after_days: 0, role: 'handoffs.escalation_target' }],
  calendar: [{ day: '2026-12-25', label: 'Christmas' }], kpi_targets: [{ metric: 'meetings.overdue_issues', target: 2, from: '2026-11-01' }],
  switches: { handoff_notify_enabled: '0' } });
const count = async (t) => Number((await rdb.db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).n);

test('one wrong row: nothing is written', async () => {
  const bad = good(); bad.roles.push({ role: 'handoffs.escalation_target', site: 'Atlantis', person: 'gv_lead', from: '2026-11-01' });
  const r = await run(write(bad), '--apply', '--as=gv_super');
  assert.equal(r.ok, false); assert.ok(r.errors.some((e) => /Atlantis/.test(e)));
  assert.equal(await count('role_assignments'), 0); assert.equal(await count('kpi_site_targets'), 0);
});

test('simulation by default; apply goes through the guardrails; a second run repeats nothing', async () => {
  const f = write(good());
  const sim = await run(f); assert.equal(sim.applied, false); assert.equal(await count('role_assignments'), 0);
  assert.equal((await run(f, '--apply', '--as=gv_admin')).ok, false, 'a super_admin applies');
  const r = await run(f, '--apply', '--as=gv_super');
  assert.equal(r.ok, true); assert.equal(r.result.roles, 1); assert.equal(r.result.matrix, 1); assert.equal(r.result.calendar, 1); assert.equal(r.result.kpi, 1);
  const pol = Object.fromEntries(r.result.policies.map((p) => [p.key, p.result]));
  assert.equal(pol['handoffs.reason_min'], 'applied', 'tightening applies');
  assert.match(pol['calendar.skip_weekends'], /proposal #\d+/, 'a relaxation is only a proposal');
  assert.equal((await rdb.db.prepare('SELECT country FROM sites WHERE id=?').get(hounde.id)).country, 'BF');
  const again = await run(f, '--apply', '--as=gv_super');
  assert.equal(again.result.roles, 0); assert.equal(again.result.matrix, 0); assert.equal(again.result.calendar, 0);
  assert.equal(await count('role_assignments'), 1);
  assert.ok(Number((await rdb.db.prepare("SELECT COUNT(*) AS n FROM system_log WHERE action='governance_values_applied'").get()).n) >= 2);
});

test('the example file is valid against a seeded database (names aside)', () => {
  const ex = JSON.parse(_fs.readFileSync(_path.join(__dirname, '..', 'tools', 'governance', 'values.example.json'), 'utf8'));
  const { errors } = require('../services/governanceValues').plan(ex, { users: [], sites: [{ id: 1, name: 'Hounde' }], metricKeys: require('../services/metricRegistry').SEED.map((m) => m.key) });
  assert.ok(errors.every((e) => /no active account/.test(e)), errors.join('; '));
});
