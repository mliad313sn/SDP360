'use strict';
// Step 7 — source bindings resolve items through the KPI dictionary, per unit × slot; null = skipped, never 0.
const { test } = require('node:test');
const assert = require('node:assert');
const { slotWindow, boundItems, resolveBindings } = require('../services/trackerSources');
const { createRegistry, SEED } = require('../services/metricRegistry');
const Exp = require('../services/trackerExport');

const def = { key: 'b', name: 'B', period: { kind: 'monthly', start: '2026', count: 12 }, units: [{ code: 'HGO' }, { code: 'ZZZ' }], ragPolicy: 'tracker-activity',
  groups: [{ code: 'G1', name: 'g', weight: 1, items: [{ code: 'I1', name: 'Inspections', kpiType: 'COUNT', weight: 1, target: 12, start: 1, end: 12, source: { metric: 'inspection.count' } }, { code: 'I2', name: 'manual', kpiType: 'COUNT', weight: 1, target: 1, start: 1, end: 12 }] }] };

test('slotWindow maps slots to registry windows per kind', () => {
  assert.equal(slotWindow(def, 3, 'month'), '2026-03');
  assert.equal(slotWindow(def, 3, 'rolling3m'), '2026-03-31');
  assert.equal(slotWindow(def, 3, 'week'), null);
  assert.equal(slotWindow({ period: { kind: 'weekly', start: '2026', count: 52 } }, 5, 'week'), '2026-W05');
  assert.equal(slotWindow({ period: { kind: 'quarterly', start: '2026', count: 4 } }, 2, 'month'), '2026-06');
  assert.deepEqual(boundItems(def), [{ item: 'I1', metric: 'inspection.count' }]);
});

test('resolveBindings: cells for measured slots, skipped for null, error for unmapped unit', async () => {
  const reg = createRegistry(SEED);
  const calls = [];
  const idb = { aggregate: async ({ from }) => { calls.push(from); return from.startsWith('2026-01') ? { counts: { total: 4 }, findingStatus: [] } : { counts: { total: null }, findingStatus: [] }; } };
  const deps = { codeFor: async () => ({ inspection_code: 'HGO' }), idb };
  const r = await resolveBindings({ def, registry: reg, deps, unitSite: async (u) => u === 'HGO' ? 5 : null, slots: [1, 2] });
  assert.deepEqual(r.cells, [{ unit: 'HGO', item: 'I1', slot: 1, value: 4, note: 'inspection.count @ 2026-01' }]);
  assert.equal(r.skipped, 1 + 2, 'null February + 2 slots of the unmapped unit');
  assert.equal(r.errors[0].error, 'unit not mapped to a site');
});

test('export: workbook round-trips through the import parser; pptx builds', async () => {
  const result = { units: { HGO: { score: 0.5, rag: 'AMBER', groups: { G1: { score: 0.5 } }, items: { I1: { value: 4, attainment: 0.4, rag: 'RED', target: 12 }, I2: { value: 1, attainment: 1, rag: 'GREEN', target: 1 } } }, ZZZ: { score: null, rag: 'NA', groups: {}, items: {} } }, fleet: { mean: 0.5, best: 'HGO', worst: 'HGO', attainment: 0 }, currentPeriod: 2, version: 1 };
  const buf = Exp.buildWorkbook(def, result, { HGO: { I1: [4], I2: [1, 0, 1] } });
  const p = Exp.parseEntriesWorkbook(buf, def);
  assert.deepEqual(p.errors, []);
  assert.deepEqual(p.cells.filter(c => c.unit === 'HGO').map(c => [c.item, c.slot, c.value]), [['I1', 1, 4], ['I2', 1, 1], ['I2', 2, 0], ['I2', 3, 1]]);
  const pptx = await Exp.buildPptx(def, result); assert.ok(Buffer.isBuffer(pptx) && pptx.length > 10000);
});
