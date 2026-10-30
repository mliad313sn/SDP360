'use strict';
// G16 — every alert rule has a severity (unknown → warning, invalid refused); the firing carries it to every
// outbound channel; a dry run returns the audience and the blocking reason and saves or sends NOTHING.
const test = require('node:test');
const assert = require('node:assert');
const { evaluate, severityOf, SEVERITIES } = require('../services/alertEngine');
const { evaluateAlerts, teamsCard } = require('../services/engagementJobs');
const { SEED_RULES } = require('../services/alertRulesSeed');

test('severity: three levels, unknown or missing reads as warning', () => {
  assert.deepStrictEqual(SEVERITIES, ['info', 'warning', 'critical']);
  assert.strictEqual(severityOf({}), 'warning');
  assert.strictEqual(severityOf({ severity: 'bogus' }), 'warning');
  assert.strictEqual(severityOf({ severity: 'critical' }), 'critical');
  const r = evaluate([{ key: 'k', metric: 'm', op: 'lt', threshold: 5, severity: 'critical' }], [{ rule_key: 'k', site_id: null, value: 1 }], {}, { now: new Date('2026-10-29T10:00:00Z') });
  assert.strictEqual(r.firings[0].severity, 'critical');
});

test('every seeded rule declares a valid severity', () => {
  for (const r of SEED_RULES) assert.ok(SEVERITIES.includes(r.severity), r.key);
  assert.ok(SEED_RULES.some((r) => r.severity === 'critical'));
});

test('the Teams card names the severity', () => {
  const card = teamsCard({ severity: 'critical', rule: { key: 'x', name: 'Major incident' }, message: 'm' });
  assert.match(card.attachments[0].content.body[0].text, /^CRITICAL · Major incident/);
});

const rule = { key: 'r1', name: 'R1', severity: 'critical', metric: 'm.x', op: 'lt', threshold: 80, streak: 1, cooldown_min: 0, scope: 'fleet', channels: ['inapp', 'email', 'teams'], recipients: { roles: ['admin'], emails: ['ops@example.org'] } };
function harness(cfg = {}, { mailer = true } = {}) {
  const calls = { save: 0, record: 0, notify: 0, mail: 0, post: 0 };
  const store = { listRules: async () => [rule], loadState: async () => ({}), saveState: async () => { calls.save++; }, recordFiring: async () => { calls.record++; }, notify: async () => { calls.notify++; } };
  const registry = { get: () => ({ reader: 'x.fleet', unit: '%' }), resolve: async () => ({ value: 50, rag: 'RED' }) };
  const users = [{ id: 1, active: 1, username: 'ana', full_name: 'Ana A', role: 'admin', roles: ['admin'], email: 'ana@example.org' }, { id: 2, active: 1, username: 'bo', role: 'viewer', roles: ['viewer'], email: 'bo@example.org' }];
  const rdb = { listSites: async () => [], listUsers: async () => users, userHasRole: (u, r) => (u.roles || []).includes(r) };
  const m = mailer ? { send: async () => { calls.mail++; return { ok: true }; } } : null;
  const post = async () => { calls.post++; };
  return { calls, run: (o = {}) => evaluateAlerts({ store, registry, deps: {}, rdb, mailer: m, post, cfg: { engagement_teams_url: 'https://x.webhook.office.com/a', ...cfg }, ...o }) };
}

test('dry run: who would be told, nothing saved, nothing sent', async () => {
  const h = harness({ alert_external_enabled: '1' });
  const r = await h.run({ dryRun: true });
  assert.strictEqual(r.dry_run, true);
  assert.strictEqual(r.firings, 1);
  assert.deepStrictEqual([h.calls.save, h.calls.record, h.calls.notify, h.calls.mail, h.calls.post], [0, 0, 0, 0, 0]);
  const p = r.preview[0];
  assert.strictEqual(p.severity, 'critical');
  assert.strictEqual(p.external_blocked, null);
  assert.ok(p.email_recipients.includes('ops@example.org'));
  assert.ok(!JSON.stringify(r).includes('webhook.office.com'), 'a Teams URL is a secret and never appears');
});

test('dry run says why outbound is blocked and which configuration is missing', async () => {
  const off = await harness({}).run({ dryRun: true });
  assert.strictEqual(off.preview[0].external_blocked, 'alert_external_enabled is off');
  const stop = await harness({ alert_external_enabled: '1', notifications_stop: '1' }).run({ dryRun: true });
  assert.strictEqual(stop.preview[0].external_blocked, 'notifications_stop');
  const noSmtp = await harness({ alert_external_enabled: '1', engagement_teams_url: '' }, { mailer: false }).run({ dryRun: true });
  assert.ok(noSmtp.preview[0].problems.includes('email: SMTP not configured'));
  assert.ok(noSmtp.preview[0].problems.includes('teams: no channel configured'));
});

test('a real run carries the severity into the e-mail subject', async () => {
  const subjects = [];
  const store = { listRules: async () => [rule], loadState: async () => ({}), saveState: async () => {}, recordFiring: async () => {}, notify: async () => {} };
  await evaluateAlerts({ store, registry: { get: () => ({ reader: 'x.fleet', unit: '%' }), resolve: async () => ({ value: 50 }) }, deps: {}, rdb: { listSites: async () => [], listUsers: async () => [] }, mailer: { send: async (m) => { subjects.push(m.subject); return { ok: true }; } }, post: async () => {}, cfg: { alert_external_enabled: '1' } });
  assert.deepStrictEqual(subjects, ['[Alert · critical] R1']);
});

test('dry run without SMTP does not count e-mail recipients as reached', async () => {
  const r = await harness({ alert_external_enabled: '1' }, { mailer: false }).run({ dryRun: true });
  const p = r.preview[0];
  assert.strictEqual(p.would_reach, p.inapp_recipients.length);
});

test('dry run lists a rule in cool-down instead of hiding it', async () => {
  const now = new Date('2026-10-29T10:00:00Z');
  const store = { listRules: async () => [{ ...rule, cooldown_min: 1440 }], loadState: async () => ({ 'r1|fleet': { breaches: 3, last_fired_at: '2026-10-29T09:00:00Z' } }), saveState: async () => { throw new Error('no save in a dry run'); }, recordFiring: async () => { throw new Error('no record'); }, notify: async () => { throw new Error('no notify'); } };
  const r = await evaluateAlerts({ store, registry: { get: () => ({ reader: 'x.fleet', unit: '%' }), resolve: async () => ({ value: 50 }) }, deps: {}, rdb: { listSites: async () => [], listUsers: async () => [] }, cfg: {}, now, dryRun: true });
  assert.strictEqual(r.firings, 0, 'a real run would stay quiet');
  assert.strictEqual(r.breaching, 1);
  assert.strictEqual(r.preview[0].in_cooldown, true);
  assert.strictEqual(r.preview[0].would_reach, 0);
});

test('seeded WAN rules are operational (warning), never labelled as the contract; one notice per metric window', () => {
  for (const k of ['wan.wan1.availability', 'wan.wan2.availability']) {
    const r = SEED_RULES.find((x) => x.key === k);
    assert.ok(r, k); assert.strictEqual(r.severity, 'warning'); assert.match(r.name, /not the contract/); assert.strictEqual(r.cooldown_min, 10080);
  }
  assert.strictEqual(SEED_RULES.find((x) => x.key === 'helpdesk.major_incident').cooldown_min, 10080, 'weekly count → 7 days');
  assert.strictEqual(SEED_RULES.find((x) => x.key === 'inspection.critical').cooldown_min, 43200, 'monthly count → 30 days');
});

test('migration 041 corrects the seeded rules only in the run that adds the column', () => {
  const sql = require('fs').readFileSync(require('path').join(__dirname, '..', 'db', 'postgres', 'reports', '041_alert_severity.sql'), 'utf8');
  const block = sql.slice(sql.indexOf('IF NOT EXISTS'), sql.indexOf('END IF'));
  const updates = (sql.match(/UPDATE alert_rules/g) || []).length;
  assert.ok(updates >= 1);
  assert.strictEqual((block.match(/UPDATE alert_rules/g) || []).length, updates, 'every UPDATE sits inside the one-time block');
});
