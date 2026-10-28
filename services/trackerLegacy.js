'use strict';
// Step 7 — migration of the inherited IT Activity Tracker (tracker-init.json shape, loaded as
// the `D` object by tracker-db.loadTracker) into the generic engine, and the PARALLEL-RUN
// comparison that must read ±0.1 pt before the cut-over (doc 08 §9.8 acceptance).
//
// Pure: no DB. `importLegacy(D, year)` → { definition, entries, targets }; `compare(D, year,
// scoreFn, legacyScore)` → per site × month rows + CSV.

const Defs = require('./trackerDefinitions');

function itemCode(groupIdx, a, i) { return `P${groupIdx + 1}-${String(a.num ?? a.id ?? (i + 1)).padStart(2, '0')}`; }

/** D (legacy) + year → definition + entry cells + per-unit targets ready for trackerStore. */
function importLegacy(D, year, opts = {}) {
  const definition = Defs.fromLegacyInit(D, year, opts);
  const pillars = Object.keys(D.pillarWeights || {});
  const codeOf = new Map(); // activity index → item code
  D.activities.forEach((a, i) => { const gi = pillars.indexOf(a.pillar); if (gi >= 0) codeOf.set(i, itemCode(gi, a, i)); });
  const units = definition.units.map(u => u.code);
  const entries = [], targets = [];
  const inputs = (D.inputs || {})[year] || (D.inputs || {})[String(year)] || {};
  for (const u of units) {
    const tg = (D.targets || {})[u] || [];
    D.activities.forEach((a, i) => {
      const code = codeOf.get(i); if (!code) return;
      const t = tg[i] || {};
      // eslint-disable-next-line security/detect-unsafe-regex -- reviewed (consolidation 2026-10-28): anchored, \d+ and \.\d+ disjoint, linear
      const num = t.target != null && /^-?\d+(\.\d+)?$/.test(String(t.target).trim()) ? Number(t.target) : null;
      targets.push({ unit: u, item: code, target: num, active: t.active !== false && t.active !== 0 });
      const months = (inputs[u] || [])[i] || [];
      for (let m = 0; m < 12; m++) { const v = months[m]; if (v != null && Number(v) !== 0) entries.push({ unit: u, item: code, slot: m + 1, value: Number(v) }); }
    });
  }
  return { definition, entries, targets, codeOf: Object.fromEntries(codeOf) };
}

/** Build the engine inputs/targets from importLegacy output (shape used by trackerDefinitions.score). */
function toEngine(imp) {
  const inputs = {}, targets = {};
  for (const e of imp.entries) (((inputs[e.unit] || (inputs[e.unit] = {}))[e.item]) || (inputs[e.unit][e.item] = []))[e.slot - 1] = e.value;
  for (const t of imp.targets) (targets[t.unit] || (targets[t.unit] = {}))[t.item] = { target: t.target, active: t.active };
  return { inputs, targets };
}

/**
 * Parallel run: engine score vs legacy `ss(D, site, year, month).avg` for every active site × month 1..upToMonth.
 * @returns {{ rows: Array<{site, month, legacy_pct, engine_pct, delta_pt, ok}>, maxDelta, ok, csv }}
 */
function compare(D, year, legacyScore, { upToMonth = 12, tolerance = 0.1 } = {}) {
  const imp = importLegacy(D, year);
  const { inputs, targets } = toEngine(imp);
  const rows = [];
  for (const u of imp.definition.units) for (let mo = 1; mo <= upToMonth; mo++) {
    const leg = legacyScore.ss(D, u.code, Number(year), mo);
    const eng = Defs.score(imp.definition, inputs, { currentPeriod: mo, targets });
    const lp = leg.active ? Math.round(leg.avg * 1000) / 10 : null;
    const es = eng.units[u.code] && eng.units[u.code].score;
    const ep = es == null ? null : Math.round(es * 1000) / 10;
    const delta = lp == null || ep == null ? (lp == null && ep == null ? 0 : null) : Math.round(Math.abs(lp - ep) * 100) / 100;
    rows.push({ site: u.code, month: mo, legacy_pct: lp, engine_pct: ep, legacy_g: leg.g, engine_g: Object.values(eng.units[u.code].items).filter(i => i.rag === 'GREEN').length, delta_pt: delta, ok: delta != null && delta <= tolerance });
  }
  const deltas = rows.map(r => r.delta_pt).filter(d => d != null);
  const maxDelta = deltas.length ? Math.max(...deltas) : 0;
  const csv = ['site,month,legacy_pct,engine_pct,legacy_green,engine_green,delta_pt,ok']
    .concat(rows.map(r => [r.site, r.month, r.legacy_pct ?? '', r.engine_pct ?? '', r.legacy_g, r.engine_g, r.delta_pt ?? '', r.ok ? 'yes' : 'no'].map(require('../public/lib/csvSafe').neutralize).join(','))).join('\n');
  return { rows, maxDelta, ok: rows.every(r => r.ok), tolerance, csv, definition: imp.definition };
}

module.exports = { importLegacy, toEngine, compare, itemCode };
