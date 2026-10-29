'use strict';
// G16 — engagement alerts: e-mail / Teams / webhook stay OFF until alert_external_enabled='1', and
// notifications_stop='1' halts them at once. In-app notifications are unaffected.
const test = require('node:test');
const assert = require('node:assert');
const { evaluateAlerts } = require('../services/engagementJobs');
const { DEFAULTS } = require('../services/reportConfig');

const rule = { key: 'r1', name: 'R1', metric: 'm.x', op: 'lt', threshold: 80, streak: 1, cooldown_min: 0, scope: 'fleet', channels: ['inapp', 'email', 'teams', 'webhook'], recipients: { users: [1], emails: ['ops@example.org'] } };
function harness(cfg) {
  const calls = { notify: 0, mail: 0, post: 0 };
  const store = { listRules: async () => [rule], loadState: async () => ({}), saveState: async () => {}, recordFiring: async () => {}, notify: async () => { calls.notify++; } };
  const registry = { get: () => ({ reader: 'x.fleet', unit: '%' }), resolve: async () => ({ value: 50, rag: 'RED' }) };
  const rdb = { listSites: async () => [], listUsers: async () => [{ id: 1, active: 1, email: 'u@example.org' }] };
  const mailer = { send: async () => { calls.mail++; return { ok: true }; } };
  const post = async () => { calls.post++; };
  const run = () => evaluateAlerts({ store, registry, deps: {}, rdb, mailer, post, cfg: { engagement_teams_url: 'https://x.webhook.office.com/a', engagement_webhook_url: 'https://hooks.example.org/b', ...cfg } });
  return { calls, run };
}

test('defaults keep outbound alerts disarmed', () => {
  assert.strictEqual(DEFAULTS.alert_external_enabled, '0');
  assert.strictEqual(DEFAULTS.notifications_stop, '0');
});

test('not armed: in-app only, even with SMTP and Teams/webhook URLs configured', async () => {
  const h = harness({});
  const r = await h.run();
  assert.strictEqual(r.firings, 1);
  assert.deepStrictEqual([h.calls.notify, h.calls.mail, h.calls.post], [1, 0, 0]);
});

test('armed: e-mail, Teams and webhook go out', async () => {
  const h = harness({ alert_external_enabled: '1' });
  await h.run();
  assert.deepStrictEqual([h.calls.mail, h.calls.post], [1, 2]);
});

test('STOP switch wins over the arm flag', async () => {
  const h = harness({ alert_external_enabled: '1', notifications_stop: '1' });
  await h.run();
  assert.deepStrictEqual([h.calls.notify, h.calls.mail, h.calls.post], [1, 0, 0]);
});
