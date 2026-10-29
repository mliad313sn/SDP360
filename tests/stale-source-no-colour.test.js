'use strict';
// G05 — a source outage can never produce a fresh-looking green: the value and its date stay, the colour goes.
const test = require('node:test');
const assert = require('node:assert');
const { degradeStale } = require('../services/publishGate');

const reg = { get: (k) => ({ 'helpdesk.sla': { module: 'helpdesk' }, 'meetings.x': { module: 'meetings' } })[k] };
const def = { widgets: [{ id: 'a', metric: 'helpdesk.sla' }, { id: 'b', metric: 'meetings.x' }, { id: 'c', metric: 'helpdesk.sla' }, { id: 'd' }] };
const fresh = () => ({ a: { mode: 'single', value: 97, rag: 'GREEN', as_of: 't' }, b: { mode: 'single', value: 3, rag: 'AMBER' }, c: { mode: 'per-site', rows: [{ site: 'X', value: 99, rag: 'GREEN' }] }, d: { mode: 'none' } });

test('stale source: value kept, colour withdrawn, reason stated', () => {
  const w = degradeStale(fresh(), def, reg, [{ module: 'helpdesk', state: 'STALE' }]);
  assert.deepStrictEqual([w.a.value, w.a.rag, w.a.rag_if_fresh, w.a.freshness], [97, 'NA', 'GREEN', 'STALE']);
  assert.deepStrictEqual([w.c.rows[0].rag, w.c.rows[0].rag_if_fresh, w.c.freshness], ['NA', 'GREEN', 'STALE']);
  assert.strictEqual(w.b.rag, 'AMBER', 'a fresh module is untouched');
  assert.strictEqual(w.d.freshness, undefined);
});

test('never-synced source is UNKNOWN; all fresh leaves everything as is', () => {
  assert.strictEqual(degradeStale(fresh(), def, reg, [{ module: 'meetings', state: 'UNKNOWN' }]).b.freshness, 'UNKNOWN');
  assert.deepStrictEqual(degradeStale(fresh(), def, reg, [{ module: 'helpdesk', state: 'FRESH' }]), fresh());
});
