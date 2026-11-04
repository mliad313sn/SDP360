'use strict';
// A-27 — tools/governance/ppm-alerts.js (catalogue A11): armed off, dedup, clearing, outbound gates.
// In-memory fakes for the stores (the pure finder is covered by tests/ppm-alerts.test.js; the store by the smoke).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const CLI = require('../tools/governance/ppm-alerts');

function fakes({ cfg = {}, day = '2027-02-15', tasks } = {}) {
  const state = new Map(); const notes = []; const firings = []; const mails = [];
  const pf = { projects: [{ id: 1, key: 'P1', name: 'Link', site_id: 4, owner: 'Jane Doe', stage: 'in_progress', status: 'active', baseline_end: '2027-03-31', end_date: '2027-03-31' }],
    tasks: tasks || [{ id: 7, project_id: 1, name: 'Survey', owner: 'Jane Doe', status: 'todo', end_date: '2027-02-01' }], milestones: [] };
  const users = [{ id: 1, username: 'jdoe', full_name: 'Jane Doe', email: 'jane@example.test', roles: ['viewer'] }, { id: 2, username: 'cio', email: 'cio@example.test', roles: ['committee-member'] }, { id: 3, username: 'other', roles: ['viewer'] }, { id: 4, username: 'gone', roles: ['admin'], active: 0 }];
  let now = new Date(day + 'T05:40:00Z');
  const deps = {
    config: { ppm_alerts_enabled: '0', ppm_alert_blocked_days: '5', ppm_alert_slip_days: '10', alert_external_enabled: '0', notifications_stop: '0', ...cfg },
    store: { portfolio: async () => pf, alertStates: async () => [...state.values()].map((s) => ({ ...s })), saveAlertState: async (s) => { state.set(s.item_key, { ...state.get(s.item_key), ...s }); } },
    eng: { notify: async (n) => { notes.push(n); }, recordFiring: async (f) => { firings.push(f); } },
    listUsers: async () => users,
    isCommittee: (u) => (u.roles || []).some((r) => ['admin', 'committee-member', 'super_admin', 'executive'].includes(r)),
    buildMailer: () => ({ send: async (m) => { mails.push(m); return { ok: true }; } }),
    now: () => now,
  };
  return { deps, pf, state, notes, firings, mails, setNow: (d) => { now = new Date(d + 'T05:40:00Z'); } };
}
const quiet = () => {};

test('disarmed: prints the would-notify list, records nothing', async () => {
  const f = fakes(); const lines = [];
  const r = await CLI.run({ deps: f.deps, log: (l) => lines.push(l) });
  assert.strictEqual(r.dry_run, true);
  assert.deepStrictEqual(r.would_notify.map((x) => [x.key, x.recipients]), [['task_overdue:task:7', ['jdoe', 'cio']]], 'owner by full name + committee; inactive admin excluded');
  assert.ok(lines.join('\n').includes('task_overdue:task:7'));
  assert.strictEqual(f.notes.length + f.firings.length + f.state.size, 0);
  // --dry-run on an armed configuration records nothing either
  const g = fakes({ cfg: { ppm_alerts_enabled: '1' } });
  assert.strictEqual((await CLI.run({ deps: g.deps, dryRun: true, log: quiet })).dry_run, true);
  assert.strictEqual(g.firings.length, 0);
});

test('armed: notifies once, the same day again records no new firing; a vanished item is cleared', async () => {
  const f = fakes({ cfg: { ppm_alerts_enabled: '1' } });
  const r1 = await CLI.run({ deps: f.deps, log: quiet });
  assert.deepStrictEqual([r1.firings, r1.notified], [1, 2]);
  assert.strictEqual(f.firings[0].rule.key, 'ppm.task_overdue'); assert.strictEqual(f.firings[0].reading.site_id, 4);
  assert.deepStrictEqual(f.firings[0].rule.channels, ['inapp']);
  const r2 = await CLI.run({ deps: f.deps, log: quiet });
  assert.deepStrictEqual([r2.firings, r2.notified], [0, 0], 'no re-notify the same day');
  f.setNow('2027-02-21'); assert.strictEqual((await CLI.run({ deps: f.deps, log: quiet })).firings, 0, 'still inside 7 days');
  f.setNow('2027-02-22'); assert.strictEqual((await CLI.run({ deps: f.deps, log: quiet })).firings, 1, 'after 7 days it is re-notified');
  f.pf.tasks[0].status = 'done';
  const r3 = await CLI.run({ deps: f.deps, log: quiet });
  assert.strictEqual(r3.cleared, 1); assert.ok(f.state.get('task_overdue:task:7').cleared_at);
});

test('external channels stay blocked unless alert_external_enabled = 1 and notifications_stop != 1', async () => {
  for (const [ext, stop, expect] of [['0', '0', 0], ['1', '1', 0], ['1', '0', 1]]) {
    const f = fakes({ cfg: { ppm_alerts_enabled: '1', alert_external_enabled: ext, notifications_stop: stop } });
    await CLI.run({ deps: f.deps, log: quiet });
    assert.strictEqual(f.mails.length, expect, `ext=${ext} stop=${stop}`);
  }
});

test('the CLI loads .env before any db module and is guarded by require.main', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'governance', 'ppm-alerts.js'), 'utf8');
  const env = src.indexOf("require('dotenv')"), db = src.search(/require\('\.\.\/\.\.\/(reports-db|services|routes)/);
  assert.ok(env > 0 && db > env, 'dotenv first');
  assert.match(src, /if \(require\.main === module\) require\('dotenv'\)/);
  assert.match(src, /if \(require\.main === module\) \{/);
});
