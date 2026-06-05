/**
 * activity-tracker/engine.js — scoring engine
 *
 * Direct port of the calculation functions from the legacy
 * activity-tracker.html (lines 180-401). Calculation logic is
 * unchanged — every formula, threshold, RAG cutoff, and weight
 * redistribution rule is preserved bit-for-bit. The only change is
 * structural: functions now read from a `D` object passed in, instead
 * of the global `D` variable, so React components can be pure.
 *
 * Exported on the global scope so the JSX components can use them
 * without a module bundler.
 */

(function (global) {
  'use strict';

  // ── Pillar helpers ──────────────────────────────────────────────
  /** Distinct pillar codes in declaration order. */
  function gP(D) {
    return [...new Set((D.activities || []).map(a => a.pillar))];
  }
  /** Short label for a pillar code (e.g. "P1-Network Infrast" → "Network Infra"). */
  function gPS(p) {
    return String(p || '')
      .replace(/^P\d+-/, '')
      .replace('Network Infrast', 'Network Infra')
      .replace('Business Partner', 'Biz Partnering')
      .replace('Manage People', 'People Dev');
  }
  /** Stable colour for a pillar code (assigned by first-seen order). */
  const _pillarColorCache = {};
  function gPC(D, p) {
    if (_pillarColorCache[p]) return _pillarColorCache[p];
    const palette = ['#0d9488', '#7c3aed', '#d97706', '#2563eb', '#6366f1', '#0891b2', '#dc2626', '#65a30d'];
    const ix = gP(D).indexOf(p);
    _pillarColorCache[p] = palette[ix % palette.length] || '#64748b';
    return _pillarColorCache[p];
  }

  // ── Inputs accessor ─────────────────────────────────────────────
  /** Get a single monthly input cell value (yr, site, activity_ix, month_ix). */
  function gi(D, yr, site, ai, mi) {
    return D.inputs?.[yr]?.[site]?.[ai]?.[mi] || 0;
  }
  /** Set a single monthly input cell value (mutates D in place). */
  function si2(D, yr, site, ai, mi, v) {
    if (!D.inputs[yr]) D.inputs[yr] = {};
    if (!D.inputs[yr][site]) D.inputs[yr][site] = [];
    if (!D.inputs[yr][site][ai]) D.inputs[yr][site][ai] = new Array(12).fill(0);
    D.inputs[yr][site][ai][mi] = v;
  }

  // ── Effective weights ──────────────────────────────────────────
  // Pillar allocation (30/35/20/15) × activity's share within its
  // pillar. Inactive activities get 0 weight and their share is
  // redistributed across the remaining active activities in the same
  // pillar.
  function effWeights(D, site) {
    const tg = D.targets[site] || [];
    const PW = D.pillarWeights || {};
    const pillars = {};
    D.activities.forEach((a, i) => {
      const p = a.pillar;
      if (!pillars[p]) pillars[p] = { activeW: 0, totalW: 0 };
      pillars[p].totalW += a.weight;
      if (tg[i]?.active) pillars[p].activeW += a.weight;
    });
    const ew = new Array(D.activities.length).fill(0);
    D.activities.forEach((a, i) => {
      if (!tg[i]?.active) return;
      const p = pillars[a.pillar];
      const pW = a.pillar in PW ? PW[a.pillar] : 0.25;
      if (p.activeW > 0) ew[i] = pW * (a.weight / p.activeW);
    });
    return ew;
  }

  // ── Per-activity scoring (RAG + score + YTD vs target) ─────────
  // Handles 6 KPI types: BOOLEAN, PERCENT, MILESTONE, CURRENCY,
  // RATING, COUNT (default). See the comments inline for the
  // formula each one uses.
  function score(D, site, yr, mo) {
    const tg = D.targets[site] || [];
    const R = [];
    const ew = effWeights(D, site);
    D.activities.forEach((a, i) => {
      const t = tg[i];
      if (!t || !t.active) {
        R.push({ ...a, ix: i, on: false, ya: 0, yt: 0, sc: 'N/A', rg: 'N/A', ew: 0 });
        return;
      }
      // YTD value: shared activities take the fleet max; non-shared take site sum.
      let ya = 0;
      if (a.shared) {
        let mx = 0;
        D.sites.forEach(s2 => {
          let sm = 0;
          for (let m = 0; m < mo; m++) sm += gi(D, yr, s2, i, m);
          mx = Math.max(mx, sm);
        });
        ya = mx;
      } else {
        for (let m = 0; m < mo; m++) ya += gi(D, yr, site, i, m);
      }

      if (a.kpi === 'BOOLEAN') {
        // 0=Not Started, 0.5=In Progress, 1=Done. Capped at 1.
        const sc = Math.min(ya, 1);
        let rg;
        if (sc >= 1) rg = 'GREEN';
        else if (sc >= 0.5) rg = 'AMBER';
        else rg = a.end <= mo ? 'RED' : 'AMBER';
        R.push({ ...a, ix: i, on: true, ya: Math.round(ya * 100) / 100, yt: 1, sc, rg, ew: ew[i] });
      } else if (a.kpi === 'PERCENT') {
        const months = Math.min(mo, a.end) - a.start + 1;
        const avg = months > 0 ? ya / months : 0;
        const tgt = parseInt(t.target) || 100;
        const sc = Math.min(avg / tgt, 1);
        const rg = sc >= 1 ? 'GREEN' : sc >= 0.75 ? 'AMBER' : 'RED';
        R.push({ ...a, ix: i, on: true, ya: Math.round(avg * 10) / 10, yt: tgt, sc: Math.round(sc * 1000) / 1000, rg, ew: ew[i] });
      } else if (a.kpi === 'MILESTONE') {
        const tgt = parseInt(t.target) || 1;
        const phase = Math.min(ya, tgt);
        const sc = Math.min(phase / tgt, 1);
        const rg = sc >= 1 ? 'GREEN' : sc > 0 ? 'AMBER' : (a.end <= mo ? 'RED' : 'AMBER');
        R.push({ ...a, ix: i, on: true, ya: Math.round(phase * 100) / 100, yt: tgt, sc: Math.round(sc * 1000) / 1000, rg, ew: ew[i] });
      } else if (a.kpi === 'CURRENCY') {
        const tgt = parseFloat(t.target) || 0;
        if (tgt === 0) {
          R.push({ ...a, ix: i, on: true, ya, yt: 0, sc: 0, rg: 'AMBER', ew: ew[i] });
        } else {
          const sc = Math.min(ya / tgt, 1);
          const rg = sc >= 1 ? 'GREEN' : sc >= 0.75 ? 'AMBER' : 'RED';
          R.push({ ...a, ix: i, on: true, ya: Math.round(ya * 100) / 100, yt: tgt, sc: Math.round(sc * 1000) / 1000, rg, ew: ew[i] });
        }
      } else if (a.kpi === 'RATING') {
        const nonZeroMonths = [];
        for (let m2 = a.start - 1; m2 < Math.min(mo, a.end); m2++) {
          const v = gi(D, yr, site, i, m2);
          if (v > 0) nonZeroMonths.push(v);
        }
        const avg = nonZeroMonths.length > 0 ? nonZeroMonths.reduce((s, v) => s + v, 0) / nonZeroMonths.length : 0;
        const tgt = parseFloat(t.target) || 4;
        const sc = tgt > 0 ? Math.min(avg / tgt, 1) : 0;
        const rg = sc >= 1 ? 'GREEN' : sc >= 0.75 ? 'AMBER' : (nonZeroMonths.length === 0 && a.end > mo ? 'AMBER' : 'RED');
        R.push({ ...a, ix: i, on: true, ya: Math.round(avg * 100) / 100, yt: tgt, sc: Math.round(sc * 1000) / 1000, rg, ew: ew[i] });
      } else {
        // COUNT (default): sum of monthly values vs pro-rated annual target.
        if (a.start > mo) {
          R.push({ ...a, ix: i, on: true, ya, yt: 'N/A', sc: 'N/A', rg: 'N/A', ew: ew[i] });
        } else {
          const mA = Math.min(mo, a.end) - a.start + 1;
          const tot = a.end - a.start + 1;
          const ann = parseInt(t.target) || 0;
          const yt = ann * (mA / tot);
          const sc = yt > 0 ? Math.min(ya / yt, 1) : 0;
          const rg = sc >= 1 ? 'GREEN' : sc >= 0.75 ? 'AMBER' : 'RED';
          R.push({ ...a, ix: i, on: true, ya: Math.round(ya * 100) / 100, yt: Math.round(yt * 100) / 100, sc: Math.round(sc * 1000) / 1000, rg, ew: ew[i] });
        }
      }
    });
    return R;
  }

  // ── Site summary (g/a/r counts + weighted avg + per-pillar) ────
  function ss(D, site, yr, mo) {
    const sc = score(D, site, yr, mo);
    const g = sc.filter(s => s.rg === 'GREEN').length;
    const a = sc.filter(s => s.rg === 'AMBER').length;
    const r = sc.filter(s => s.rg === 'RED').length;
    const PW = D.pillarWeights || {};
    const pScores = {};
    gP(D).forEach(p => {
      let wS = 0, wT = 0;
      sc.forEach(s => {
        if (s.on && s.pillar === p && typeof s.sc === 'number') {
          wS += s.sc * s.weight;
          wT += s.weight;
        }
      });
      if (wT > 0) pScores[p] = wS / wT;
    });
    let oS = 0, oT = 0;
    Object.keys(pScores).forEach(p => {
      const pw = p in PW ? PW[p] : 0.25;
      oS += pw * pScores[p];
      oT += pw;
    });
    return { active: sc.filter(s => s.on).length, g, a, r, avg: oT > 0 ? oS / oT : 0, sc, pScores };
  }

  // ── Pillar score for one site ──────────────────────────────────
  function ps2(D, site, p, yr, mo) {
    const sc = score(D, site, yr, mo);
    let wS = 0, wT = 0;
    sc.forEach(s => {
      if (s.on && s.pillar === p && typeof s.sc === 'number') {
        wS += s.sc * s.weight;
        wT += s.weight;
      }
    });
    return wT > 0 ? wS / wT : 0;
  }

  // ── Fleet-wide stats ──────────────────────────────────────────
  function fleetStats(D, sites, yr, mo) {
    if (!sites || sites.length === 0) return { avg: 0, stdDev: 0, best: '—', worst: '—', spread: 0, attainment: 0, completion: 0, trends: [] };
    const scores = sites.map(s => ss(D, s, yr, mo).avg);
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
    const variance = scores.reduce((a, b) => a + (b - avg) ** 2, 0) / scores.length;
    const stdDev = Math.sqrt(variance);
    const best = sites.reduce((a, b) => ss(D, a, yr, mo).avg >= ss(D, b, yr, mo).avg ? a : b);
    const worst = sites.reduce((a, b) => ss(D, a, yr, mo).avg <= ss(D, b, yr, mo).avg ? a : b);
    let totalScored = 0, totalGreen = 0;
    sites.forEach(s => {
      const sc = score(D, s, yr, mo);
      sc.forEach(a => {
        if (a.on && ['GREEN', 'AMBER', 'RED'].includes(a.rg)) {
          totalScored++;
          if (a.rg === 'GREEN') totalGreen++;
        }
      });
    });
    const attainment = totalScored > 0 ? totalGreen / totalScored : 0;
    let totalActive = 0, hasProgress = 0;
    sites.forEach(s => {
      const sc = score(D, s, yr, mo);
      sc.forEach(a => {
        if (a.on && typeof a.sc === 'number') {
          totalActive++;
          if (a.sc > 0) hasProgress++;
        }
      });
    });
    const completion = totalActive > 0 ? hasProgress / totalActive : 0;
    const trends = [];
    for (let m = 1; m <= mo; m++) {
      const mScores = sites.map(s => ss(D, s, yr, m).avg);
      trends.push({
        month: m,
        avg: mScores.reduce((a, b) => a + b, 0) / mScores.length,
        scores: Object.fromEntries(sites.map((s, i) => [s, mScores[i]]))
      });
    }
    return { avg, stdDev, best, worst, spread: ss(D, best, yr, mo).avg - ss(D, worst, yr, mo).avg, attainment, completion, trends };
  }

  // ── Executive one-liner summary ──────────────────────────────
  function execSummary(D, sites, yr, mo) {
    const f = fleetStats(D, sites, yr, mo);
    const dir = f.trends.length >= 2
      ? (f.trends[f.trends.length - 1].avg > f.trends[f.trends.length - 2].avg ? 'improving' : 'declining')
      : 'starting';
    const health = f.avg >= 0.7 ? 'strong' : f.avg >= 0.5 ? 'moderate' : 'below expectations';
    return `Fleet performance is ${health} at ${Math.round(f.avg * 100)}% (${dir}). ${Math.round(f.attainment * 100)}% of activities on target, ${Math.round(f.completion * 100)}% showing progress. Spread: ${Math.round(f.spread * 100)}pp (${f.best}→${f.worst}).`;
  }

  // ── Commentary generator (combined + site-specific) ────────────
  // Port of genCom() in the legacy file. Output: array of
  // { cat: 'INFO'|'COMBINED'|'SITE', text: string }.
  function genCom(D, sites, yr, mo) {
    const prev = mo - 1;
    if (prev < 1) return [{ cat: 'INFO', text: 'First month of ' + yr + ' — baseline period, no prior month for comparison.' }];
    const c = [];
    const deltas = sites.map(s => {
      const cu = ss(D, s, yr, mo).avg, pr = ss(D, s, yr, prev).avg;
      return { s, cur: cu, prev: pr, d: cu - pr };
    });
    const f = fleetStats(D, sites, yr, mo);
    const fp = fleetStats(D, sites, yr, prev);
    const fleetDelta = f.avg - fp.avg;
    if (Math.abs(fleetDelta) > 0.01) c.push({
      cat: 'COMBINED',
      text: 'Fleet performance ' + (fleetDelta > 0 ? 'improved' : 'declined') + ' by ' + Math.round(Math.abs(fleetDelta) * 100) + 'pp to ' + Math.round(f.avg * 100) + '% (' + Math.round(fp.avg * 100) + '%→' + Math.round(f.avg * 100) + '%). Target attainment: ' + Math.round(f.attainment * 100) + '%.'
    });
    gP(D).forEach(p => {
      let td = 0;
      sites.forEach(s => { td += ps2(D, s, p, yr, mo) - ps2(D, s, p, yr, prev); });
      const ad = td / sites.length;
      if (Math.abs(ad) > 0.03) {
        const dir = ad > 0 ? 'positive momentum' : 'needs attention';
        c.push({ cat: 'COMBINED', text: gPS(p) + ' (' + Math.round((D.pillarWeights[p] || 0) * 100) + '%): fleet avg ' + (ad > 0 ? '+' : '') + Math.round(ad * 100) + 'pp — ' + dir + '.' });
      }
    });
    D.activities.forEach((a, i) => {
      if (!a.shared) return;
      const cu = score(D, sites[0], yr, mo)[i], pr = score(D, sites[0], yr, prev)[i];
      if (cu?.rg !== pr?.rg) {
        const dir = cu.rg === 'GREEN' ? 'completed' : 'changed to ' + cu.rg;
        c.push({ cat: 'COMBINED', text: 'Shared: "' + a.name + '" ' + dir + ' (fleet-wide impact).' });
      }
    });
    const ar = [];
    D.activities.forEach((a, i) => {
      if (a.shared) return;
      const scored = sites.filter(s => ['GREEN', 'AMBER', 'RED'].includes(score(D, s, yr, mo)[i]?.rg));
      const rd = scored.filter(s => score(D, s, yr, mo)[i]?.rg === 'RED');
      if (scored.length > 0 && rd.length === scored.length) ar.push(a.name);
    });
    if (ar.length) c.push({ cat: 'COMBINED', text: 'Systemic gap: ' + ar.slice(0, 3).join(', ') + ' RED at all sites' + (ar.length > 3 ? ' (+' + (ar.length - 3) + ' more)' : '') + ' — requires coordinated intervention.' });
    const imp = deltas.filter(d => d.d > 0.02).sort((a, b) => b.d - a.d);
    const dec = deltas.filter(d => d.d < -0.02).sort((a, b) => a.d - b.d);
    const stb = deltas.filter(d => Math.abs(d.d) <= 0.02);
    if (imp.length) c.push({ cat: 'SITE', text: 'Improved: ' + imp.map(d => d.s + ' +' + Math.round(d.d * 100) + 'pp (' + Math.round(d.prev * 100) + '%→' + Math.round(d.cur * 100) + '%)').join(', ') + '.' });
    if (dec.length) c.push({ cat: 'SITE', text: 'Declined: ' + dec.map(d => d.s + ' ' + Math.round(d.d * 100) + 'pp').join(', ') + '.' });
    if (stb.length) c.push({ cat: 'SITE', text: 'Stable (±2pp): ' + stb.map(d => d.s + ' ' + Math.round(d.cur * 100) + '%').join(', ') + '.' });
    const siteG = {}, siteR = {};
    sites.forEach(s => {
      const cu = score(D, s, yr, mo), pr = score(D, s, yr, prev);
      cu.forEach((x, i) => {
        if (!D.activities[i]?.shared) {
          if (x.rg === 'GREEN' && pr[i]?.rg !== 'GREEN') { if (!siteG[s]) siteG[s] = []; siteG[s].push(x.name); }
          if (x.rg === 'RED' && pr[i]?.rg !== 'RED') { if (!siteR[s]) siteR[s] = []; siteR[s].push(x.name); }
        }
      });
    });
    Object.entries(siteG).forEach(([s, acts]) => c.push({ cat: 'SITE', text: s + ' newly GREEN: ' + acts.slice(0, 3).join(', ') + (acts.length > 3 ? ' (+' + (acts.length - 3) + ')' : '') + '.' }));
    Object.entries(siteR).forEach(([s, acts]) => c.push({ cat: 'SITE', text: s + ' newly RED: ' + acts.slice(0, 3).join(', ') + (acts.length > 3 ? ' (+' + (acts.length - 3) + ')' : '') + '.' }));
    gP(D).forEach(p => {
      const pD = sites.map(s => ({ s, d: ps2(D, s, p, yr, mo) - ps2(D, s, p, yr, prev) }));
      const best = pD.reduce((a, b) => a.d > b.d ? a : b);
      const worst = pD.reduce((a, b) => a.d < b.d ? a : b);
      if (best.d > 0.1) c.push({ cat: 'SITE', text: best.s + ' standout in ' + gPS(p) + ': +' + Math.round(best.d * 100) + 'pp.' });
      if (worst.d < -0.1) c.push({ cat: 'SITE', text: worst.s + ' dropped in ' + gPS(p) + ': ' + Math.round(worst.d * 100) + 'pp — escalation recommended.' });
    });
    if (!c.length) c.push({ cat: 'INFO', text: 'No significant changes this period.' });
    return c;
  }

  // Expose on global scope so JSX components can import via window.TR
  global.TR = {
    gP, gPS, gPC, gi, si2,
    effWeights, score, ss, ps2,
    fleetStats, execSummary, genCom,
  };
})(window);
