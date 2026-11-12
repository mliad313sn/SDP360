'use strict';
// E-R07 — sober alerting: noise metrics per rule (read rate is a READ rate, null when nothing was notified),
// digest grouping by rule (switch), quiet window that defers non-critical firings and never a critical one.
const { test } = require('node:test');
const assert = require('node:assert');
const A = require('../services/alertEngine');
const { evaluateAlerts, sendDigest } = require('../services/engagementJobs');
const { DEFAULTS } = require('../services/reportConfig');

test('switches ship at today\'s behaviour', () => { assert.equal(DEFAULTS.alert_group_by_rule, '0'); assert.equal(DEFAULTS.alert_quiet_hours, ''); });

test('noise: fired, sites, multi-site, read rate and median time to read; null when nothing notified or read', () => {
  const m = A.noiseMetrics({
    firings: [{ rule_key: 'sla', site_id: 1 }, { rule_key: 'sla', site_id: 2 }, { rule_key: 'sla', site_id: 1 }, { rule_key: 'wan', site_id: null }],
    notifications: [
      { source_kind: 'alert_rule', source_ref: 'sla|1', created_at: '2026-11-01T08:00:00Z', read_at: '2026-11-01T08:30:00Z' },
      { source_kind: 'alert_rule', source_ref: 'sla|2', created_at: '2026-11-01T08:00:00Z', read_at: '2026-11-01T09:30:00Z' },
      { source_kind: 'alert_rule', source_ref: 'sla|1', created_at: '2026-11-02T08:00:00Z', read_at: null },
    ] });
  const sla = m.find((r) => r.rule === 'sla'), wan = m.find((r) => r.rule === 'wan');
  assert.deepEqual([sla.fired, sla.sites, sla.multi_site, sla.notified, sla.read, sla.read_rate_pct, sla.median_minutes_to_read], [3, 2, true, 3, 2, 66.7, 60]);
  assert.deepEqual([wan.fired, wan.multi_site, wan.notified, wan.read_rate_pct, wan.median_minutes_to_read], [1, false, 0, null, null]);
  assert.deepEqual(A.noiseMetrics({}), []);
});

test('quiet window: parse, wrap across midnight, critical never deferred', () => {
  assert.equal(A.parseQuiet(''), null); assert.equal(A.parseQuiet('nonsense'), null); assert.equal(A.parseQuiet('25:00-06:00'), null);
  assert.ok(A.inQuiet(new Date('2026-11-06T23:10:00Z'), '22:00-06:00')); assert.ok(A.inQuiet(new Date('2026-11-06T05:59:00Z'), '22:00-06:00'));
  assert.ok(!A.inQuiet(new Date('2026-11-06T06:00:00Z'), '22:00-06:00'));
  const fs = [{ rule: { severity: 'critical' } }, { rule: { severity: 'warning' } }, { rule: {} }];
  const p = A.partitionQuiet(fs, { now: new Date('2026-11-06T23:00:00Z'), quiet: '22:00-06:00' });
  assert.equal(p.now.length, 1); assert.equal(p.now[0].rule.severity, 'critical'); assert.equal(p.deferred.length, 2);
  assert.equal(A.partitionQuiet(fs, { now: new Date('2026-11-06T12:00:00Z'), quiet: '22:00-06:00' }).deferred.length, 0);
  assert.equal(A.partitionQuiet(fs, { now: new Date('2026-11-06T23:00:00Z'), quiet: '' }).deferred.length, 0);
});

test('grouping: one rule over several sites becomes one line listing the sites; other notices untouched', () => {
  const items = [
    { source_kind: 'alert_rule', source_ref: 'sla|1', title: 'SLA low', body: 'SLA low: m = 50 % at Hounde — lt 80' },
    { source_kind: 'alert_rule', source_ref: 'sla|2', title: 'SLA low', body: 'SLA low: m = 40 % at Mana — lt 80' },
    { source_kind: 'commitment', title: 'A03 — to verify', body: 'x' },
    { source_kind: 'alert_rule', source_ref: 'wan|1', title: 'WAN', body: 'WAN: at Hounde — lt 97' },
  ];
  const g = A.groupDigestItems(items);
  assert.equal(g.length, 3); assert.match(g[0].body, /2 firings · 2 site\(s\): Hounde, Mana/); assert.equal(g[1].title, 'A03 — to verify'); assert.equal(g[2].body, items[3].body);
});

const rule = (sev) => ({ key: 'r-' + sev, name: sev, metric: 'm.x', op: 'lt', threshold: 80, streak: 1, cooldown_min: 60, scope: 'fleet', severity: sev, channels: ['inapp'], recipients: { users: [1] } });
function harness(cfg, now) {
  const saved = []; const calls = { notify: 0, firings: 0 };
  const store = { listRules: async () => [rule('warning'), rule('critical')], loadState: async () => ({}), saveState: async (s) => saved.push(s), recordFiring: async () => { calls.firings++; }, notify: async () => { calls.notify++; } };
  const registry = { get: () => ({ reader: 'x.fleet', unit: '%' }), resolve: async () => ({ value: 50, rag: 'RED' }) };
  const rdb = { listSites: async () => [], listUsers: async () => [{ id: 1, active: 1 }] };
  return { calls, saved, run: () => evaluateAlerts({ store, registry, deps: {}, rdb, cfg, now }) };
}
test('evaluateAlerts: quiet hours defer the warning (state kept for later), the critical still notifies', async () => {
  const h = harness({ alert_quiet_hours: '22:00-06:00' }, new Date('2026-11-06T23:00:00Z'));
  const r = await h.run();
  assert.deepEqual([r.firings, r.deferred, h.calls.notify, h.calls.firings], [1, 1, 1, 1]);
  assert.equal(h.saved[0]['r-warning|fleet'].last_fired_at, null, 'deferred firing is not marked fired → fires after the window');
  assert.ok(h.saved[0]['r-critical|fleet'].last_fired_at);
  const off = harness({}, new Date('2026-11-06T23:00:00Z')); assert.equal((await off.run()).firings, 2, 'no window = today');
});

test('sendDigest: grouping only when the switch is on', async () => {
  const items = [{ source_kind: 'alert_rule', source_ref: 'sla|1', title: 'SLA', body: 'x at Hounde — y', created_at: '2026-11-06T07:00' }, { source_kind: 'alert_rule', source_ref: 'sla|2', title: 'SLA', body: 'x at Mana — y', created_at: '2026-11-06T07:00' }];
  const mk = () => { const mails = []; return { mails, args: { store: { digestSubscribers: async () => [1], pullForDigest: async () => items }, rdb: { listUsers: async () => [{ id: 1, email: 'u@example.org' }] }, mailer: { send: async (m) => { mails.push(m); return { ok: true }; } } } }; };
  const a = mk(); await sendDigest(a.args); assert.match(a.mails[0].subject, /\(2\)/);
  const b = mk(); await sendDigest({ ...b.args, groupByRule: true }); assert.match(b.mails[0].subject, /\(1\)/); assert.match(b.mails[0].html, /Hounde, Mana/);
});
