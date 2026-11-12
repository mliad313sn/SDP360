'use strict';
// P4 / B9 — the shared prefill rule (public/lib/infraPrefill.js): a typed or saved value is NEVER overwritten,
// a measurable row with no snapshot is "unknown" (never 0), and a claimed automatic source is only kept when the
// value still equals the snapshot (server-side verification at save time).
const test = require('node:test');
const assert = require('node:assert');
const P = require('../public/lib/infraPrefill');

const fills = [
  { match: 'wan1', sub_site: '', value: '99.9%', source: 'meraki', data_through: '2026-11-07' },
  { match: 'lan', sub_site: '', value: '98%', source: 'opmanager', data_through: '2026-11-08' },
];

test('planFill: typed value kept, empty measurable row filled, no snapshot = unknown, Backup = none', () => {
  const plan = P.planFill([
    { service: 'WAN1', value: '97%' },        // typed → keep
    { service: 'WAN1 backup link', value: '' }, // family wan1 → fill
    { service: 'WLAN', value: '' },           // no wifi fill → unknown
    { service: 'Backup', value: '' },         // no source → none
    { service: 'LAN', value: '  ' },          // whitespace = empty → fill
  ], fills, []);
  assert.deepStrictEqual(plan.map((p) => p.action), ['keep', 'fill', 'unknown', 'none', 'fill']);
  assert.strictEqual(plan[1].fill.value, '99.9%');
  assert.strictEqual(plan[2].connector, 'opmanager');
  assert.strictEqual(plan[0].connector, 'meraki');
});

test('planFill: a fill with a blank value is not a fill (absent measure stays unknown, never 0)', () => {
  const plan = P.planFill([{ service: 'Servers', value: '' }], [{ match: 'servers', sub_site: '', value: '', source: 'opmanager' }], []);
  assert.strictEqual(plan[0].action, 'unknown');
});

test('verifySources: matching auto value kept with its data-through; a forged or edited value becomes manual', () => {
  const out = P.verifySources([
    { service: 'WAN1', status_value: '99.9 %', value_source: 'meraki', value_data_through: 'forged' },
    { service: 'LAN', status_value: '99%', value_source: 'opmanager' },    // edited after prefill
    { service: 'WLAN', status_value: '97%', value_source: 'meraki' },      // no snapshot at all
    { service: 'Radio', status_value: '100%', value_source: 'manual' },
    { service: 'WAN2', status_value: '', value_source: 'meraki' },          // empty → nothing
    { service: 'Backup', status_value: '100%' },                            // old client → not recorded
  ], fills, []);
  assert.deepStrictEqual(out.map((r) => r.value_source), ['meraki', 'manual', 'manual', 'manual', null, null]);
  assert.strictEqual(out[0].value_data_through, '2026-11-07', 'data-through comes from the snapshot, not the client');
  assert.strictEqual(out[1].value_data_through, null);
});

test('provenance badge: auto shows source and date, manual says manuel, measurable empty is "— inconnu" never 0', () => {
  assert.match(P.provenance({ status_value: '99%', value_source: 'meraki', value_data_through: '2026-11-07' }).text, /^Meraki · 2026-11-07$/);
  assert.strictEqual(P.provenance({ status_value: '99%', value_source: 'manual' }).text, 'manuel');
  const u = P.provenance({ status_value: '', measurable: true });
  assert.strictEqual(u.kind, 'unknown'); assert.doesNotMatch(u.text, /0/);
  assert.strictEqual(P.provenance({ status_value: '', measurable: false }).kind, 'none');
});
