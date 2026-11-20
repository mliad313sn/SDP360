'use strict';
// PORTFOLIO LOT 4 — the nightly tool with the management kinds: only with ppm_alert_actions_enabled = '1'; armed off
// (ppm_alerts_enabled = '0') it records and sends nothing; a cleared alert never closes the commitment it was promoted
// to (the tool has no commitment store at all); 'unfunded' is never notified (owners may not read amounts).
const test = require('node:test');
const assert = require('node:assert');
const CLI = require('../tools/governance/ppm-alerts');

function fakes(cfg = {}, project = {}) {
  const state = new Map(); const notes = []; const firings = []; const mails = [];
  const pf = { projects: [{ id: 1, key: 'P1', name: 'Link', site_id: 4, owner: 'Jane Doe', stage: 'in_progress', status: 'active', start_date: '2027-01-01', end_date: '2027-06-30',
    risk_exposure: 'critical', budget_status: 'not_budgeted', decision_required: 'no', delivery_lead: 'Team', ...project }], tasks: [], milestones: [] };
  const deps = {
    config: { ppm_alerts_enabled: '0', ppm_alert_actions_enabled: '0', alert_external_enabled: '0', notifications_stop: '0', ...cfg },
    store: { portfolio: async () => pf, listDecisions: async () => [], alertStates: async () => [...state.values()].map((s) => ({ ...s })), saveAlertState: async (s) => { state.set(s.item_key, { ...state.get(s.item_key), ...s }); } },
    eng: { notify: async (n) => { notes.push(n); }, recordFiring: async (f) => { firings.push(f); } },
    listUsers: async () => [{ id: 2, username: 'cio', email: 'cio@example.test', roles: ['committee-member'] }],
    isCommittee: (u) => (u.roles || []).includes('committee-member'),
    buildMailer: () => ({ send: async (m) => { mails.push(m); return { ok: true }; } }),
    now: () => new Date('2027-02-15T05:40:00Z'),
  };
  return { deps, pf, state, notes, firings, mails };
}
const quiet = () => {};

test('switch off: the nightly list is today\'s (no management kind)', async () => {
  const f = fakes();
  const r = await CLI.run({ deps: f.deps, log: quiet });
  assert.equal(r.would_notify.length, 0);
});

test('switch on, armed off: management kinds are previewed, nothing recorded or sent; unfunded never notified', async () => {
  const f = fakes({ ppm_alert_actions_enabled: '1' });
  const r = await CLI.run({ deps: f.deps, log: quiet });
  assert.deepStrictEqual(r.would_notify.map((x) => x.kind), ['critical_risk']);
  assert.equal(f.notes.length + f.firings.length + f.mails.length + f.state.size, 0);
});

test('armed: in-app only; a cleared alert stamps cleared_at and keeps the commitment link (never closes anything)', async () => {
  const f = fakes({ ppm_alert_actions_enabled: '1', ppm_alerts_enabled: '1' });
  await CLI.run({ deps: f.deps, log: quiet });
  assert.equal(f.mails.length, 0, 'alert_external_enabled = 0 → no e-mail');
  assert.deepStrictEqual(f.firings[0].rule.channels, ['inapp']);
  const key = 'critical_risk:project:1';
  f.state.set(key, { ...f.state.get(key), commitment_uid: 'c-uid-1' });
  f.pf.projects[0].risk_exposure = 'low';
  const r2 = await CLI.run({ deps: f.deps, log: quiet });
  assert.equal(r2.cleared, 1);
  assert.ok(f.state.get(key).cleared_at, 'cleared');
  assert.equal(f.state.get(key).commitment_uid, 'c-uid-1', 'the commitment link survives; the commitment is a human close');
  assert.ok(!('commitments' in f.deps), 'the tool has no commitment store');
});
