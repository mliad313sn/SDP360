'use strict';
// Step 7 — the migration acceptance test of the tracker 2026: the LEGACY engine (public/activity-tracker/engine.js,
// loaded as the browser loads it) and the NEW engine (public/lib/trackerEngine.js) score the same data; every unit ×
// month × group, every unit overall, every item (score + colour) and the fleet are compared. The study's criterion
// is "no gap above 0.1 point" (0.001 on the 0-1 scale); colours must be identical.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Engine = require('../../public/lib/trackerEngine');
const { fromLegacy } = require('./legacyImport');

function legacyEngine() {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'public', 'activity-tracker', 'engine.js'), 'utf8');
  const sandbox = { window: {} };
  vm.runInNewContext(src, sandbox, { filename: 'activity-tracker/engine.js' });
  return sandbox.window.TR;
}

/**
 * @returns { months, units, checks, max_gap_points, colour_mismatches, worst: [{where, legacy, next, gap}] }
 */
function compare(D, year, opts = {}) {
  const TR = legacyEngine();
  const { definition, values } = fromLegacy(D, year, opts);
  const Dy = Object.assign({}, D, { sites: D.sites });
  const units = (D.activeSites || D.sites || []).slice();
  const lastMonth = opts.month || 12;
  const pillars = TR.gP(D.byYear && D.byYear[year] ? Object.assign({}, D, D.byYear[year]) : D);
  let checks = 0, maxGap = 0, colours = 0;
  const worst = [];
  const note = (where, a, b) => {
    checks++;
    const gap = Math.abs((Number(a) || 0) - (Number(b) || 0));
    if (gap > maxGap) maxGap = gap;
    if (gap > 0.001) worst.push({ where, legacy: a, next: b, gap });
  };
  for (let mo = 1; mo <= lastMonth; mo++) {
    for (const u of units) {
      const L = TR.ss(Dy, u, year, mo), N = Engine.unitSummary(definition, values, u, mo);
      note(`${u} m${mo} overall`, L.avg, N.avg);
      for (const p of pillars) note(`${u} m${mo} ${p}`, TR.ps2(Dy, u, p, year, mo), Engine.groupScore(definition, values, u, p, mo));
      L.sc.forEach((it, i) => {
        const n = N.items[i];
        if (typeof it.sc === 'number' || typeof n.sc === 'number') note(`${u} m${mo} ${n.code}`, it.sc, n.sc);
        checks++;
        if (it.rg !== n.rg) { colours++; worst.push({ where: `${u} m${mo} ${n.code} colour`, legacy: it.rg, next: n.rg, gap: null }); }
      });
    }
    const Lf = TR.fleetStats(Dy, units, year, mo), Nf = Engine.fleet(definition, values, mo, units);
    note(`fleet m${mo} average`, Lf.avg, Nf.avg);
    note(`fleet m${mo} attainment`, Lf.attainment, Nf.attainment);
    checks++;
    if (Lf.best !== Nf.best || Lf.worst !== Nf.worst) { colours++; worst.push({ where: `fleet m${mo} best/worst`, legacy: `${Lf.best}/${Lf.worst}`, next: `${Nf.best}/${Nf.worst}`, gap: null }); }
  }
  worst.sort((a, b) => (b.gap || 1) - (a.gap || 1));
  return { year, months: lastMonth, units: units.length, items: definition.items.length, checks,
    max_gap_points: Math.round(maxGap * 100 * 10000) / 10000, colour_mismatches: colours, worst: worst.slice(0, 20),
    accepted: maxGap <= 0.001 && colours === 0 };
}

module.exports = { compare, legacyEngine };
