'use strict';
// A-24 — canonical figures of a weekly report and their SHA-256, captured at every submission.
// The hash is INTEGRITY evidence (did the figures change after submission?), never an approval.
const test = require('node:test');
const assert = require('node:assert');
const { canonicalFigures, figuresHash } = require('../services/reportFigures');

function sample() {
  return {
    id: 7, site_id: 3, status: 'submitted', updated_at: '2026-10-01T10:00:00Z',
    helpdesk: { id: 1, report_id: 7, time_to_assign: 1.5, first_reply: 2, comments_sla: 'ok',
      chart_data: { weeks: [{ label: 'W40', inbound: 12 }], top10: [] }, fetched_at: '2026-10-01T09:00:00Z',
      updated_at: '2026-10-01T09:00:00Z' },
    infra_kpis: [
      { id: 10, report_id: 7, service: 'WAN1', kpi: 'Availability', target: '98%', status_value: '99.1%', status_color: 'green', trend: 'stable', sort_order: 0 },
      { id: 11, report_id: 7, service: 'LAN', kpi: 'Availability', target: '99%', status_value: '97%', status_color: 'orange', trend: 'down', sort_order: 1 },
      { id: 12, report_id: 7, service: 'Servers', kpi: 'Availability', target: '99%', status_value: '100%', status_color: 'green', trend: 'up', sort_order: 2 },
    ],
    lights: [
      { id: 20, report_id: 7, type: 'highlight', content: 'Fibre restored', sort_order: 0 },
      { id: 21, report_id: 7, type: 'lowlight', content: 'UPS failure', sort_order: 0 },
    ],
    action_items: [
      { id: 30, report_id: 7, uid: 'u-1', task: 'Replace UPS', priority: 'High', due_date: '2026-10-10', owner: 'A', status: 'open', department: 'IT', comment: null, sort_order: 0 },
    ],
  };
}

test('figuresHash is a 64-char hex SHA-256', () => {
  assert.match(figuresHash(sample()), /^[0-9a-f]{64}$/);
});

test('canonicalFigures is order-independent (shuffled infra rows → same hash)', () => {
  const a = sample();
  const b = sample();
  b.infra_kpis = [b.infra_kpis[2], b.infra_kpis[0], b.infra_kpis[1]].map((k, i) => ({ ...k, sort_order: i, id: 100 + i }));
  b.lights = b.lights.slice().reverse();
  assert.strictEqual(figuresHash(a), figuresHash(b));
  assert.deepStrictEqual(canonicalFigures(a), canonicalFigures(b));
});

test('changing one infra value changes the hash', () => {
  const a = sample();
  const b = sample();
  b.infra_kpis[1].status_value = '96%';
  assert.notStrictEqual(figuresHash(a), figuresHash(b));
});

test('a helpdesk figure or an action item change changes the hash', () => {
  const a = sample();
  const b = sample(); b.helpdesk.first_reply = 3;
  const c = sample(); c.action_items[0].status = 'closed';
  assert.notStrictEqual(figuresHash(a), figuresHash(b));
  assert.notStrictEqual(figuresHash(a), figuresHash(c));
});

test('non-figure fields (updated_at, ids, status, fetched_at, key order) do not change the hash', () => {
  const a = sample();
  const b = sample();
  b.updated_at = '2027-01-01T00:00:00Z';
  b.status = 'draft';
  b.id = 99;
  b.helpdesk.updated_at = '2027-01-01T00:00:00Z';
  b.helpdesk.fetched_at = '2027-01-01T00:00:00Z';
  b.helpdesk.id = 42;
  b.helpdesk = Object.fromEntries(Object.entries(b.helpdesk).reverse());
  b.infra_kpis = b.infra_kpis.map((k) => ({ ...k, id: k.id + 1000 }));
  assert.strictEqual(figuresHash(a), figuresHash(b));
});

test('an empty / unauthored report still hashes (no throw), and differs from a filled one', () => {
  const empty = { helpdesk: {}, infra_kpis: [], lights: [], action_items: [] };
  assert.match(figuresHash(empty), /^[0-9a-f]{64}$/);
  assert.match(figuresHash(null), /^[0-9a-f]{64}$/);
  assert.notStrictEqual(figuresHash(empty), figuresHash(sample()));
});
