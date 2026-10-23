/* Step 7 (SDP-DASH-2.0) — the score engine of the BUSINESS TRACKERS (UMD: Node + browser).
 *
 * One engine for every tracker built in the builder, for its entry screen, its "dry-run" score, its Excel export
 * and its slides: no formula lives anywhere else. It reproduces, formula for formula, the engine of the IT Activity
 * Tracker 2026 (public/activity-tracker/engine.js: score / ss / ps2 / fleetStats) — the migration is accepted only
 * when tools/trackers/compare-legacy.js finds no gap above 0.1 point on every unit × month × group.
 *
 * A tracker = a published DEFINITION (services/trackers/definition.js) + its ENTRIES:
 *   def.units   [{ code, name, active }]        sites, teams… (shared items take the max over ALL units)
 *   def.groups  [{ code, name, weight }]        pillars; weight 0-1, a group without weight counts 0.25
 *   def.items   [{ code, name, group, kpi, weight, start, end, shared }]   start/end = months 1-12
 *   def.targets { unit: { item: { target, active } } }
 *   values      { unit: { item: [12 monthly values] } }   (a missing cell is 0, as in the legacy engine)
 * Colours: the RAG policy named by def.rag_policy in public/lib/kpiRag.js (default tracker_activity) — never a
 * literal threshold here.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./kpiRag'));
  else root.TrackerEngine = factory(root.KpiRag);
}(typeof self !== 'undefined' ? self : this, function (KpiRag) {
  'use strict';

  var KPI_TYPES = ['COUNT', 'PERCENT', 'BOOLEAN', 'MILESTONE', 'CURRENCY', 'RATING'];

  function cell(values, unit, item, m) {
    var u = values && values[unit];
    var row = u && u[item];
    return (row && row[m]) || 0;
  }
  function groupCodes(def) {
    var seen = {}, out = [];
    (def.items || []).forEach(function (it) { if (!seen[it.group]) { seen[it.group] = 1; out.push(it.group); } });
    return out;
  }
  function groupWeights(def) {
    var w = {};
    (def.groups || []).forEach(function (g) { if (g.weight != null && g.weight !== '') w[g.code] = Number(g.weight); });
    return w;
  }
  function targetOf(def, unit, item) { var t = def.targets && def.targets[unit]; return (t && t[item]) || null; }
  function band(def, sc) {
    var c = KpiRag.classify(def.rag_policy || 'tracker_activity', sc);
    return c === 'green' ? 'GREEN' : c === 'amber' ? 'AMBER' : 'RED';
  }
  function r2(x) { return Math.round(x * 100) / 100; }
  function r3(x) { return Math.round(x * 1000) / 1000; }

  /** Effective weight of each item for one unit: group weight × the item's share among the unit's ACTIVE items. */
  function effWeights(def, unit) {
    var PW = groupWeights(def), groups = {};
    def.items.forEach(function (a) {
      var g = groups[a.group] || (groups[a.group] = { activeW: 0 });
      var t = targetOf(def, unit, a.code);
      if (t && t.active) g.activeW += a.weight;
    });
    return def.items.map(function (a) {
      var t = targetOf(def, unit, a.code);
      if (!t || !t.active) return 0;
      var pW = a.group in PW ? PW[a.group] : 0.25, g = groups[a.group];
      return g.activeW > 0 ? pW * (a.weight / g.activeW) : 0;
    });
  }

  /** Every item of one unit at month `mo` (1-12, year to date): YTD value, target, score 0-1, RAG. */
  function score(def, values, unit, mo) {
    var ew = effWeights(def, unit), units = def.units.map(function (u) { return u.code; });
    return def.items.map(function (a, i) {
      var base = { code: a.code, name: a.name, group: a.group, kpi: a.kpi, weight: a.weight, start: a.start, end: a.end, shared: !!a.shared };
      var t = targetOf(def, unit, a.code);
      if (!t || !t.active) return Object.assign(base, { on: false, ya: 0, yt: 0, sc: 'N/A', rg: 'N/A', ew: 0 });
      var ya = 0, m;
      if (a.shared) {
        var mx = 0;
        units.forEach(function (u2) { var sm = 0; for (var m2 = 0; m2 < mo; m2++) sm += cell(values, u2, a.code, m2); mx = Math.max(mx, sm); });
        ya = mx;
      } else {
        for (m = 0; m < mo; m++) ya += cell(values, unit, a.code, m);
      }
      var on = { on: true, ew: ew[i] };
      if (a.kpi === 'BOOLEAN') {
        var b = Math.min(ya, 1);
        return Object.assign(base, on, { ya: r2(ya), yt: 1, sc: b, rg: b >= 1 ? 'GREEN' : b >= 0.5 ? 'AMBER' : (a.end <= mo ? 'RED' : 'AMBER') });
      }
      if (a.kpi === 'PERCENT') {
        var months = Math.min(mo, a.end) - a.start + 1, avg = months > 0 ? ya / months : 0;
        var tp = parseInt(t.target, 10) || 100, sp = Math.min(avg / tp, 1);
        return Object.assign(base, on, { ya: Math.round(avg * 10) / 10, yt: tp, sc: r3(sp), rg: band(def, sp) });
      }
      if (a.kpi === 'MILESTONE') {
        var tm = parseInt(t.target, 10) || 1, phase = Math.min(ya, tm), sm2 = Math.min(phase / tm, 1);
        return Object.assign(base, on, { ya: r2(phase), yt: tm, sc: r3(sm2), rg: sm2 >= 1 ? 'GREEN' : sm2 > 0 ? 'AMBER' : (a.end <= mo ? 'RED' : 'AMBER') });
      }
      if (a.kpi === 'CURRENCY') {
        var tc = parseFloat(t.target) || 0;
        if (tc === 0) return Object.assign(base, on, { ya: ya, yt: 0, sc: 0, rg: 'AMBER' });
        var scc = Math.min(ya / tc, 1);
        return Object.assign(base, on, { ya: r2(ya), yt: tc, sc: r3(scc), rg: band(def, scc) });
      }
      if (a.kpi === 'RATING') {
        var nz = [];
        for (m = a.start - 1; m < Math.min(mo, a.end); m++) { var v = cell(values, unit, a.code, m); if (v > 0) nz.push(v); }
        var ar = nz.length ? nz.reduce(function (s, x) { return s + x; }, 0) / nz.length : 0;
        var tr = parseFloat(t.target) || 4, sr = tr > 0 ? Math.min(ar / tr, 1) : 0;
        var rr = band(def, sr);
        if (rr === 'RED' && nz.length === 0 && a.end > mo) rr = 'AMBER';
        return Object.assign(base, on, { ya: r2(ar), yt: tr, sc: r3(sr), rg: rr });
      }
      // COUNT (default): Σ monthly values vs the annual target pro-rated over the months elapsed in the window.
      if (a.start > mo) return Object.assign(base, on, { ya: ya, yt: 'N/A', sc: 'N/A', rg: 'N/A' });
      var mA = Math.min(mo, a.end) - a.start + 1, tot = a.end - a.start + 1, ann = parseInt(t.target, 10) || 0;
      var yt = ann * (mA / tot), sc = yt > 0 ? Math.min(ya / yt, 1) : 0;
      return Object.assign(base, on, { ya: r2(ya), yt: r2(yt), sc: r3(sc), rg: band(def, sc) });
    });
  }

  function groupScoreFrom(sc, g) {
    var wS = 0, wT = 0;
    sc.forEach(function (s) { if (s.on && s.group === g && typeof s.sc === 'number') { wS += s.sc * s.weight; wT += s.weight; } });
    return wT > 0 ? wS / wT : null;
  }

  /** One unit at month `mo`: RAG counts, weighted overall (0-1) and per-group scores. */
  function unitSummary(def, values, unit, mo) {
    var sc = score(def, values, unit, mo), PW = groupWeights(def), groups = {}, oS = 0, oT = 0;
    groupCodes(def).forEach(function (g) { var v = groupScoreFrom(sc, g); if (v != null) groups[g] = v; });
    Object.keys(groups).forEach(function (g) { var pw = g in PW ? PW[g] : 0.25; oS += pw * groups[g]; oT += pw; });
    var n = function (rg) { return sc.filter(function (s) { return s.rg === rg; }).length; };
    return { active: sc.filter(function (s) { return s.on; }).length, g: n('GREEN'), a: n('AMBER'), r: n('RED'), avg: oT > 0 ? oS / oT : 0, groups: groups, items: sc };
  }

  /** One group of one unit (0 when the unit has no scored item in it — as the legacy ps2). */
  function groupScore(def, values, unit, group, mo) {
    var v = groupScoreFrom(score(def, values, unit, mo), group);
    return v == null ? 0 : v;
  }

  function activeUnits(def) { return def.units.filter(function (u) { return u.active !== false; }).map(function (u) { return u.code; }); }

  /** The whole tracker at month `mo`: mean of the units, best / worst, share of items on target, trend. */
  function fleet(def, values, mo, units) {
    units = units || activeUnits(def);
    if (!units.length) return { avg: 0, best: null, worst: null, attainment: 0, completion: 0, trends: [] };
    var sums = units.map(function (u) { return unitSummary(def, values, u, mo); });
    var scores = sums.map(function (s) { return s.avg; });
    var avg = scores.reduce(function (a, b) { return a + b; }, 0) / scores.length;
    var bi = 0, wi = 0;
    scores.forEach(function (s, i) { if (s > scores[bi]) bi = i; if (s < scores[wi]) wi = i; });
    var scored = 0, green = 0, active = 0, progress = 0;
    sums.forEach(function (s) {
      s.items.forEach(function (a) {
        if (a.on && (a.rg === 'GREEN' || a.rg === 'AMBER' || a.rg === 'RED')) { scored++; if (a.rg === 'GREEN') green++; }
        if (a.on && typeof a.sc === 'number') { active++; if (a.sc > 0) progress++; }
      });
    });
    var trends = [];
    for (var m = 1; m <= mo; m++) {
      var ms = units.map(function (u) { return unitSummary(def, values, u, m).avg; });
      trends.push({ month: m, avg: ms.reduce(function (a, b) { return a + b; }, 0) / ms.length });
    }
    return { avg: avg, best: units[bi], worst: units[wi], attainment: scored ? green / scored : 0, completion: active ? progress / active : 0, trends: trends };
  }

  return { KPI_TYPES: KPI_TYPES, effWeights: effWeights, score: score, unitSummary: unitSummary, groupScore: groupScore, fleet: fleet, activeUnits: activeUnits, groupCodes: groupCodes };
}));
