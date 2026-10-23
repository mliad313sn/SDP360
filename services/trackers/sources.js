'use strict';
// Step 7 — items LINKED to a dictionary key (meetings, inspections, tickets…): their monthly value is computed by the
// metrics dispatch (services/metrics/dispatch.js — the same reader as every screen, never a second formula) and
// written as entries with source 'metric'. Units must be mapped to a site (`site_id`). A month not measured stays
// absent (0 for the engine), never a guessed value.

const dispatch = require('../metrics/dispatch');

/**
 * Cells to write for the linked items of a definition, months start..min(end, uptoMonth).
 * deps: { metrics (liveDeps), sites [{site_id, code, name}], targets }
 */
async function computeLinkedCells(def, uptoMonth, deps) {
  const cells = [];
  const linked = def.items.filter(it => it.source && it.source.metric);
  if (!linked.length) return { cells, skipped: [] };
  const skipped = [];
  for (const u of def.units) {
    if (!u.site_id) { skipped.push(`${u.code}: no site`); continue; }
    const site = (deps.sites || []).find(s => s.site_id === u.site_id);
    if (!site) { skipped.push(`${u.code}: site ${u.site_id} inactive or unknown`); continue; }
    for (const it of linked) {
      for (let m = it.start; m <= Math.min(it.end, uptoMonth); m++) {
        const month = `${def.year}-${String(m).padStart(2, '0')}`;
        const r = await dispatch.computeMetric(it.source.metric, { site, window: dispatch.resolveWindow({ month }), targets: deps.targets }, deps.metrics);
        if (r && r.status === 200 && r.value != null) cells.push({ unit: u.code, item: it.code, month: m, value: Number(r.value) });
      }
    }
  }
  return { cells, skipped };
}

module.exports = { computeLinkedCells };
