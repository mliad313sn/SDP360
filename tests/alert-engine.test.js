'use strict';
// Step 9 — pure alert evaluation: streak, cooldown, null never breaches, rag_in, disabled rules, fan-out.
const { test } = require('node:test');
const assert = require('node:assert');
const { evaluate, fanOut, describe, OPERATORS } = require('../services/alertEngine');

const rule = { key: 'sla.red', name: 'SLA red', metric: 'helpdesk.resolution_sla_pct', op: 'lt', threshold: 80, streak: 2, cooldown_min: 60, channels: ['inapp', 'email'], recipients: { users: [1, 2], emails: ['x@y.z'] } };
const read = (value, extra) => ({ rule_key: 'sla.red', site_id: 3, site: 'Hounde', value, unit: '%', rag: 'RED', window: { label: '2026-09' }, ...extra });
const t0 = new Date('2026-10-19T10:00:00Z');

test('streak: fires only after N consecutive breaches, a good reading resets the count', () => {
  let r = evaluate([rule], [read(70)], {}, { now: t0 });
  assert.equal(r.firings.length, 0); assert.equal(r.state['sla.red|3'].breaches, 1);
  r = evaluate([rule], [read(90)], r.state, { now: t0 }); assert.equal(r.state['sla.red|3'].breaches, 0);
  r = evaluate([rule], [read(70)], r.state, { now: t0 }); r = evaluate([rule], [read(71)], r.state, { now: t0 });
  assert.equal(r.firings.length, 1); assert.equal(r.firings[0].key, 'sla.red|3'); assert.match(r.firings[0].message, /SLA red: helpdesk.resolution_sla_pct = 71 % \(2026-09\) at Hounde — lt 80/);
});

test('cooldown: quiet while inside the window, fires again after it', () => {
  const st = { 'sla.red|3': { breaches: 5, last_fired_at: t0.toISOString() } };
  assert.equal(evaluate([rule], [read(60)], st, { now: new Date(t0.getTime() + 30 * 60000) }).firings.length, 0);
  assert.equal(evaluate([rule], [read(60)], st, { now: new Date(t0.getTime() + 61 * 60000) }).firings.length, 1);
});

test('null never breaches and never resets a streak; NA rag never matches rag_in; disabled rule skipped', () => {
  const st = { 'sla.red|3': { breaches: 1, last_fired_at: null } };
  const r = evaluate([rule], [read(null)], st, { now: t0 });
  assert.equal(r.firings.length, 0); assert.equal(r.state['sla.red|3'].breaches, 1, 'not measured ≠ 0 → untouched');
  const ragRule = { key: 'trk.red', metric: 'tracker.site_score_pct', op: 'rag_in', threshold: 'RED, AMBER' };
  assert.equal(evaluate([ragRule], [{ rule_key: 'trk.red', site_id: 1, value: null, rag: 'NA' }], {}, { now: t0 }).firings.length, 0);
  assert.equal(evaluate([ragRule], [{ rule_key: 'trk.red', site_id: 1, value: 50, rag: 'amber' }], {}, { now: t0 }).firings.length, 1);
  assert.equal(evaluate([{ ...rule, enabled: false, streak: 1 }], [read(10)], {}, { now: t0 }).firings.length, 0);
  assert.equal(evaluate([{ ...rule, op: 'nope', streak: 1 }], [read(10)], {}, { now: t0 }).firings.length, 0, 'unknown operator never fires');
  assert.deepEqual(OPERATORS, ['gt', 'gte', 'lt', 'lte', 'eq', 'rag_in']);
});

test('fleet scope keys on "fleet"; fanOut groups by channel and recipient; describe prints — for null', () => {
  const r = evaluate([{ ...rule, streak: 1, scope: 'fleet' }], [{ rule_key: 'sla.red', site_id: null, value: 50, unit: '%' }], {}, { now: t0 });
  assert.equal(r.firings[0].key, 'sla.red|fleet'); assert.match(r.firings[0].message, /at fleet/);
  const fo = fanOut([r.firings[0], { ...r.firings[0], rule: { ...rule, channels: ['teams', 'webhook'] } }]);
  assert.deepEqual([...fo.inapp.keys()], [1, 2]); assert.equal(fo.email.get('x@y.z').length, 1); assert.equal(fo.teams.length, 1); assert.equal(fo.webhook.length, 1);
  assert.match(describe(rule, { value: null, site: 'X' }), /= —/);
});
