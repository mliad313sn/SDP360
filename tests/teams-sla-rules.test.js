'use strict';
// Teams SLA alerts (2026-10-03) — the PURE half: SDP API v3 request → ticket, rules →
// alerts, group → channel. See docs/superpowers/specs/2026-10-03-teams-sla-alerts-design.md.
const test = require('node:test');
const assert = require('node:assert');
const S = require('../services/teamsSla');

const NOW = Date.parse('2026-10-03T10:00:00Z');
const min = (m) => NOW + m * 60000;
const T = (o = {}) => ({
  id: '1001', display_id: '1001', subject: 'Imprimante', priority: 'High', p: 'P2', group: 'Hounde IT Agents',
  technician: 'Awa', site: 'HOUNDE', status: 'Open', created_ms: min(-60), fr_due_ms: null, res_due_ms: null,
  responded: false, ...o,
});
const kinds = (alerts) => alerts.map(a => a.kind).sort();

test('priorityLabel maps SDP priority names to P1..P4', () => {
  assert.equal(S.priorityLabel('Critical'), 'P1');
  assert.equal(S.priorityLabel('High'), 'P2');
  assert.equal(S.priorityLabel('Medium'), 'P3');
  assert.equal(S.priorityLabel('Normal'), 'P3');
  assert.equal(S.priorityLabel('Low'), 'P4');
  assert.equal(S.priorityLabel(''), 'P3', 'unknown → P3 (the middle threshold)');
});

test('normalizeRequest reads the v3 {value} shapes and tolerates missing fields', () => {
  const t = S.normalizeRequest({
    id: '91000000123', display_id: '4521', subject: 'VPN down',
    status: { name: 'Open' }, priority: { name: 'Critical' }, group: { name: 'Mana IT Agents' },
    technician: { name: 'Jean' }, site: { name: 'MANA' },
    created_time: { value: String(min(-20)) }, first_response_due_by_time: { value: String(min(10)) },
    due_by_time: { value: String(min(100)) }, responded_time: null,
  });
  assert.deepEqual(t, { id: '91000000123', display_id: '4521', subject: 'VPN down', priority: 'Critical', p: 'P1',
    group: 'Mana IT Agents', technician: 'Jean', site: 'MANA', status: 'Open',
    created_ms: min(-20), fr_due_ms: min(10), res_due_ms: min(100), responded: false });
  const bare = S.normalizeRequest({ id: 7 });
  assert.equal(bare.id, '7'); assert.equal(bare.group, ''); assert.equal(bare.fr_due_ms, null);
  assert.equal(S.normalizeRequest({ id: 8, responded_time: { value: '1' } }).responded, true);
  assert.equal(S.normalizeRequest({ id: 9, technician: null }).technician, '');
});

test('fr_soon fires inside the per-priority window, not before', () => {
  const R = S.DEFAULT_RULES;
  assert.deepEqual(kinds(S.evaluate([T({ p: 'P2', fr_due_ms: min(15) })], R, NOW)), ['fr_soon']);
  assert.deepEqual(kinds(S.evaluate([T({ p: 'P2', fr_due_ms: min(25) })], R, NOW)), []);   // P2 window = 20 min
  assert.deepEqual(kinds(S.evaluate([T({ p: 'P4', fr_due_ms: min(200) })], R, NOW)), ['fr_soon']);
  assert.deepEqual(kinds(S.evaluate([T({ p: 'P2', fr_due_ms: min(15), responded: true })], R, NOW)), [], 'already answered');
});

test('fr_breach fires once the deadline passed, only inside the breach window', () => {
  const R = S.DEFAULT_RULES;
  assert.deepEqual(kinds(S.evaluate([T({ fr_due_ms: min(-5) })], R, NOW)), ['fr_breach']);
  assert.deepEqual(kinds(S.evaluate([T({ fr_due_ms: min(-90) })], R, NOW)), [], 'old breach: no flood on the first run');
});

test('res_soon fires at 75 % of the resolution window; res_breach after the deadline', () => {
  const R = S.DEFAULT_RULES;
  // created -60, due +20 → 60/80 = 75 %
  assert.deepEqual(kinds(S.evaluate([T({ created_ms: min(-60), res_due_ms: min(20), responded: true })], R, NOW)), ['res_soon']);
  assert.deepEqual(kinds(S.evaluate([T({ created_ms: min(-60), res_due_ms: min(60), responded: true })], R, NOW)), []);
  assert.deepEqual(kinds(S.evaluate([T({ res_due_ms: min(-10), responded: true })], R, NOW)), ['res_breach']);
});

test('unassigned fires after 30 min without a technician, for tickets younger than 24 h', () => {
  const R = S.DEFAULT_RULES;
  assert.deepEqual(kinds(S.evaluate([T({ technician: '', created_ms: min(-31) })], R, NOW)), ['unassigned']);
  assert.deepEqual(kinds(S.evaluate([T({ technician: '', created_ms: min(-10) })], R, NOW)), []);
  assert.deepEqual(kinds(S.evaluate([T({ technician: '', created_ms: min(-60 * 30) })], R, NOW)), []);
});

test('a paused (on hold) ticket raises nothing; a disabled kind raises nothing', () => {
  assert.deepEqual(S.evaluate([T({ status: 'On Hold', fr_due_ms: min(5) })], S.DEFAULT_RULES, NOW), []);
  const R = S.parseRules(JSON.stringify({ kinds: { fr_soon: false } }));
  assert.deepEqual(S.evaluate([T({ fr_due_ms: min(5) })], R, NOW), []);
  assert.equal(R.kinds.res_soon, true, 'other kinds keep their default');
});

test('an alert carries what the card needs', () => {
  const [a] = S.evaluate([T({ fr_due_ms: min(12) })], S.DEFAULT_RULES, NOW);
  assert.equal(a.kind, 'fr_soon'); assert.equal(a.request_id, '1001'); assert.equal(a.group, 'Hounde IT Agents');
  assert.equal(a.minutes, 12, 'minutes left (positive) or overdue (negative)');
});

test('parseRules tolerates garbage and keeps defaults', () => {
  assert.deepEqual(S.parseRules('not json'), S.DEFAULT_RULES);
  assert.deepEqual(S.parseRules(''), S.DEFAULT_RULES);
  const r = S.parseRules('{"fr_soon_minutes":{"P1":5},"res_soon_pct":80}');
  assert.equal(r.fr_soon_minutes.P1, 5); assert.equal(r.fr_soon_minutes.P2, 20); assert.equal(r.res_soon_pct, 80);
});

test('channels: parse + resolve by group (case-insensitive) with a "*" fallback', () => {
  const ch = S.parseChannels(JSON.stringify([{ group: 'Hounde IT Agents', url: 'https://a' }, { group: '*', url: 'https://z' }, { group: '', url: 'x' }]));
  assert.equal(ch.length, 2);
  assert.equal(S.resolveChannel('hounde it agents ', ch), 'https://a');
  assert.equal(S.resolveChannel('Mana IT Agents', ch), 'https://z');
  assert.equal(S.resolveChannel('Mana IT Agents', ch.slice(0, 1)), null);
  assert.deepEqual(S.parseChannels('garbage'), []);
});

test('a finished ticket (resolved / closed / cancelled / completed) never alerts, whatever the filter returned', () => {
  for (const status of ['Resolved', 'Closed', 'Cancelled', 'Completed', 'Confirm Resolution']) {
    assert.deepEqual(S.evaluate([T({ status, fr_due_ms: min(5), technician: '' , created_ms: min(-40) })], S.DEFAULT_RULES, NOW), [], status);
  }
});

test('max_ticket_age_days: older tickets are ignored (0 = no limit)', () => {
  assert.equal(S.DEFAULT_RULES.max_ticket_age_days, 30);
  const old = T({ created_ms: NOW - 40 * 86400000, fr_due_ms: min(5) });
  assert.deepEqual(S.evaluate([old], S.DEFAULT_RULES, NOW), []);
  assert.deepEqual(kinds(S.evaluate([old], S.parseRules({ max_ticket_age_days: 0 }), NOW)), ['fr_soon']);
  assert.deepEqual(kinds(S.evaluate([old], S.parseRules({ max_ticket_age_days: 60 }), NOW)), ['fr_soon']);
  assert.equal(S.createdAfterMs(S.DEFAULT_RULES, NOW), NOW - 30 * 86400000);
  assert.equal(S.createdAfterMs(S.parseRules({ max_ticket_age_days: 0 }), NOW), null);
});
