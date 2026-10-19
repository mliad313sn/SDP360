'use strict';
// Step 7 — SOURCE BINDINGS: an item whose definition carries `source: { metric: '<registry key>' }`
// is filled automatically from the KPI dictionary (services/metricRegistry) — one resolve per
// unit × slot, written as entries with source 'sync:<module>'. Manual cells are never
// overwritten by a null reading (a missing reading is "not measured", not 0).
//
// Unit code → canonical site: the definition unit code is looked up in site_module_codes for
// the modules tracker / meetings / inspection, then by site name (services/siteResolve).

const { resolveWindow } = require('./metricRegistry');

/** Slot → window label the registry understands for the metric's window kind. */
function slotWindow(def, slot, windowKind) {
  const start = String(def.period.start || new Date().getUTCFullYear());
  const year = Number(start.slice(0, 4));
  const kind = def.period.kind;
  if (kind === 'monthly') {
    const m0 = (/^\d{4}-(\d{2})$/.test(start) ? Number(start.slice(5, 7)) - 1 : 0) + slot - 1;
    const ym = `${year + Math.floor(m0 / 12)}-${String((m0 % 12) + 1).padStart(2, '0')}`;
    if (windowKind === 'week' || windowKind === 'rolling13w') return null; // weekly metric on a monthly tracker: not bindable
    if (windowKind === 'rolling3m' || windowKind === 'current') { const b = resolveWindow('month', ym); return b.to; }
    return ym;
  }
  if (kind === 'weekly') {
    const w = `${year}-W${String(slot).padStart(2, '0')}`;
    if (windowKind === 'week') return w;
    if (windowKind === 'rolling3m' || windowKind === 'rolling13w' || windowKind === 'current') return resolveWindow('week', w).to;
    return resolveWindow('week', w).from.slice(0, 7); // month containing the week
  }
  // quarterly → last month of the quarter
  const m = slot * 3; const ym = `${year}-${String(m).padStart(2, '0')}`;
  if (windowKind === 'week' || windowKind === 'rolling13w') return null;
  return windowKind === 'month' || windowKind === 'ytd' ? ym : resolveWindow('month', ym).to;
}

/** Items with a metric binding: [{ item, metric }]. */
function boundItems(def) {
  const out = [];
  for (const g of def.groups || []) for (const it of g.items || []) if (it.source && it.source.metric) out.push({ item: it.code, metric: it.source.metric });
  return out;
}

/**
 * Resolve every bound cell. Returns { cells, skipped, errors } — the caller persists with
 * trackerStore.saveEntries(..., { source: 'sync:registry', lockClosed:false }).
 * @param {object} o  { def, registry, deps, unitSite: async (unitCode) → siteId|null, slots: number[] (default: all up to current) , now }
 */
async function resolveBindings({ def, registry, deps, unitSite, slots = null, now = new Date() }) {
  const items = boundItems(def);
  const cells = [], errors = [];
  let skipped = 0;
  if (!items.length) return { cells, skipped, errors };
  const n = def.period.count;
  const slotList = slots || Array.from({ length: n }, (_, i) => i + 1);
  for (const u of def.units) {
    const site = await unitSite(u.code);
    if (site == null) { skipped += items.length * slotList.length; errors.push({ unit: u.code, error: 'unit not mapped to a site' }); continue; }
    for (const b of items) {
      const m = registry.get(b.metric);
      if (!m) { errors.push({ unit: u.code, item: b.item, error: `unknown metric ${b.metric}` }); continue; }
      for (const slot of slotList) {
        const win = slotWindow(def, slot, m.window_kind);
        if (win == null) { skipped++; continue; }
        const r = await registry.resolve(b.metric, { site, window: win, deps, now });
        if (!r || r.error) { errors.push({ unit: u.code, item: b.item, slot, error: r ? r.error : 'no result' }); continue; }
        if (r.value == null) { skipped++; continue; }
        cells.push({ unit: u.code, item: b.item, slot, value: r.value, note: `${b.metric} @ ${r.window.label}` });
      }
    }
  }
  return { cells, skipped, errors };
}

module.exports = { slotWindow, boundItems, resolveBindings };
