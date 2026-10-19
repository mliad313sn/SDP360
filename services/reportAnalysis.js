'use strict';
// Step 9 — PURE, always-on deterministic analysis of a resolved widget set (services/dashboardData).
// It never invents a figure: every sentence quotes a value that exists in `widgets`, with its
// window and as_of. Bilingual (en / fr), tone per audience (site / executive / council). The AI
// layer (services/aiCommentary) only rephrases THIS output + the canonical figures.

const TONE = {
  site:      { en: 'operational', fr: 'opérationnel' },
  executive: { en: 'business', fr: 'direction' },
  council:   { en: 'governance', fr: 'gouvernance' },
};

const fmt = (v, unit) => (v == null ? '—' : unit === '%' ? `${Math.round(Number(v) * 10) / 10} %` : `${Math.round(Number(v) * 100) / 100}${unit && unit !== 'count' ? ' ' + unit : ''}`);

/** Direction of a series: last value vs mean of the previous points (±2 dead band for %, 10 % relative otherwise). */
function trendDirection(points, unit) {
  const vals = (points || []).map(p => p.value).filter(v => v != null).map(Number);
  if (vals.length < 3) return { dir: 'flat', last: vals.length ? vals[vals.length - 1] : null, base: null, n: vals.length };
  const last = vals[vals.length - 1]; const prev = vals.slice(0, -1); const base = prev.reduce((a, b) => a + b, 0) / prev.length;
  const band = unit === '%' ? 2 : Math.max(Math.abs(base) * 0.1, 1e-9);
  return { dir: last - base > band ? 'up' : base - last > band ? 'down' : 'flat', last, base: Math.round(base * 10) / 10, n: vals.length };
}

/**
 * @param {object} o { widgets (resolved), def (dashboard definition), audience, lang:'en'|'fr', siteName, window, registry? (get(key) → {higher_is_better}) }
 * @returns {{findings:[], headline, bullets:[], figures:[], coverage:{measured,total}}}
 */
function analyse(o) {
  const lang = o.lang === 'fr' ? 'fr' : 'en'; const widgets = o.widgets || {}; const reg = o.registry;
  const hib = (key) => { const m = reg && reg.get ? reg.get(key) : null; return !m || m.higher_is_better !== false; };
  const figures = [], findings = []; let measured = 0, total = 0;
  for (const [id, w] of Object.entries(widgets)) {
    if (w.mode === 'single') {
      total++; if (w.value != null) measured++;
      figures.push({ id, metric: w.metric, title: w.title, value: w.value, unit: w.unit, rag: w.rag, window: w.window && w.window.label, as_of: w.as_of, fleet: w.fleet ? w.fleet.mean : null });
      if (w.value == null) findings.push({ kind: 'unmeasured', id, title: w.title, metric: w.metric });
      else if (w.rag === 'RED' || w.rag === 'AMBER') findings.push({ kind: w.rag.toLowerCase(), id, title: w.title, metric: w.metric, value: w.value, unit: w.unit, window: w.window && w.window.label });
      if (w.fleet && w.value != null && w.fleet.mean != null) { const gap = Number(w.value) - Number(w.fleet.mean); if (Math.abs(gap) >= (w.unit === '%' ? 5 : Math.abs(w.fleet.mean) * 0.2)) findings.push({ kind: (gap > 0) === hib(w.metric) ? 'above_fleet' : 'below_fleet', id, title: w.title, metric: w.metric, value: w.value, fleet: w.fleet.mean, unit: w.unit, gap: Math.round(gap * 10) / 10 }); }
    } else if (w.mode === 'series') {
      const t = trendDirection(w.points, w.unit);
      figures.push({ id, metric: w.metric, title: w.title, series: (w.points || []).map(p => ({ label: p.label, value: p.value })), unit: w.unit, trend: t.dir });
      if (t.dir !== 'flat') findings.push({ kind: (t.dir === 'up') === hib(w.metric) ? 'improving' : 'worsening', id, title: w.title, metric: w.metric, last: t.last, base: t.base, unit: w.unit, n: t.n });
    } else if (w.mode === 'per-site') {
      const rows = (w.rows || []).filter(r => r.value != null);
      figures.push({ id, metric: w.metric, title: w.title, unit: w.unit, rows: (w.rows || []).map(r => ({ site: r.site, value: r.value, rag: r.rag })) });
      const reds = (w.rows || []).filter(r => r.rag === 'RED');
      if (reds.length) findings.push({ kind: 'sites_red', id, title: w.title, metric: w.metric, sites: reds.map(r => r.site), n: reds.length, of: (w.rows || []).length });
      if (rows.length >= 2) { const sorted = rows.slice().sort((a, b) => a.value - b.value); const worst = hib(w.metric) ? sorted[0] : sorted[sorted.length - 1]; const best = hib(w.metric) ? sorted[sorted.length - 1] : sorted[0]; findings.push({ kind: 'spread', id, title: w.title, metric: w.metric, best: best.site, best_value: best.value, worst: worst.site, worst_value: worst.value, unit: w.unit }); }
    } else if (w.mode === 'actions') {
      figures.push({ id, title: w.title, open: w.totals && w.totals.open, overdue: (w.items || []).filter(i => i.overdue).length });
      const od = (w.items || []).filter(i => i.overdue).length; if (od) findings.push({ kind: 'overdue_actions', id, title: w.title, n: od, oldest: Math.max(0, ...(w.items || []).map(i => Number(i.age_days) || 0)) });
    }
  }
  const order = { red: 0, sites_red: 1, worsening: 2, overdue_actions: 3, below_fleet: 4, amber: 5, spread: 6, above_fleet: 7, improving: 8, unmeasured: 9 };
  findings.sort((a, b) => (order[a.kind] ?? 9) - (order[b.kind] ?? 9));
  const bullets = findings.map(f => sentence(f, lang, o.audience)).filter(Boolean);
  return { lang, audience: o.audience || 'site', tone: (TONE[o.audience] || TONE.site)[lang], site: o.siteName || null, window: o.window || null, headline: headline(findings, lang, o.siteName, measured, total), bullets, findings, figures, coverage: { measured, total } };
}

function headline(findings, lang, site, measured, total) {
  const reds = findings.filter(f => f.kind === 'red' || f.kind === 'sites_red').length, worse = findings.filter(f => f.kind === 'worsening').length;
  const who = site || (lang === 'fr' ? 'le périmètre' : 'the scope');
  if (!total) return lang === 'fr' ? `Aucun indicateur mesuré pour ${who}.` : `No indicator measured for ${who}.`;
  if (!reds && !worse) return lang === 'fr' ? `${who} : ${measured}/${total} indicateurs mesurés, aucun en rouge, aucune dégradation.` : `${who}: ${measured}/${total} indicators measured, none red, no worsening trend.`;
  return lang === 'fr' ? `${who} : ${reds} indicateur(s) en rouge et ${worse} tendance(s) en dégradation sur ${measured}/${total} mesurés.` : `${who}: ${reds} red indicator(s) and ${worse} worsening trend(s) across ${measured}/${total} measured.`;
}

function sentence(f, lang, audience) {
  const fr = lang === 'fr'; const u = f.unit; const w = f.window ? (fr ? ` (${f.window})` : ` (${f.window})`) : '';
  switch (f.kind) {
    case 'red': return fr ? `${f.title} est en rouge à ${fmt(f.value, u)}${w}.` : `${f.title} is red at ${fmt(f.value, u)}${w}.`;
    case 'amber': return fr ? `${f.title} est en orange à ${fmt(f.value, u)}${w}.` : `${f.title} is amber at ${fmt(f.value, u)}${w}.`;
    case 'sites_red': return fr ? `${f.title} : ${f.n} site(s) sur ${f.of} en rouge (${f.sites.join(', ')}).` : `${f.title}: ${f.n} of ${f.of} sites red (${f.sites.join(', ')}).`;
    case 'worsening': return fr ? `${f.title} se dégrade : ${fmt(f.last, u)} contre une base de ${fmt(f.base, u)} sur ${f.n} points.` : `${f.title} is worsening: ${fmt(f.last, u)} against a base of ${fmt(f.base, u)} over ${f.n} points.`;
    case 'improving': return fr ? `${f.title} s'améliore : ${fmt(f.last, u)} contre ${fmt(f.base, u)}.` : `${f.title} is improving: ${fmt(f.last, u)} against ${fmt(f.base, u)}.`;
    case 'below_fleet': return fr ? `${f.title} à ${fmt(f.value, u)} est en retrait de la moyenne flotte (${fmt(f.fleet, u)}).` : `${f.title} at ${fmt(f.value, u)} trails the fleet mean (${fmt(f.fleet, u)}).`;
    case 'above_fleet': return fr ? `${f.title} à ${fmt(f.value, u)} dépasse la moyenne flotte (${fmt(f.fleet, u)}).` : `${f.title} at ${fmt(f.value, u)} beats the fleet mean (${fmt(f.fleet, u)}).`;
    case 'spread': return audience === 'executive' || audience === 'council' ? (fr ? `${f.title} : de ${fmt(f.worst_value, u)} (${f.worst}) à ${fmt(f.best_value, u)} (${f.best}).` : `${f.title}: from ${fmt(f.worst_value, u)} (${f.worst}) to ${fmt(f.best_value, u)} (${f.best}).`) : null;
    case 'overdue_actions': return fr ? `${f.n} action(s) en retard, la plus ancienne depuis ${f.oldest} jours.` : `${f.n} overdue action(s), the oldest for ${f.oldest} days.`;
    case 'unmeasured': return fr ? `${f.title} : non mesuré (—).` : `${f.title}: not measured (—).`;
    default: return null;
  }
}

/** Flat list of every number the analysis is allowed to quote — the anti-hallucination allow-list. */
function canonicalNumbers(figures) {
  const out = new Set();
  const add = (v) => { if (v == null || !Number.isFinite(Number(v))) return; const n = Number(v); out.add(String(n)); out.add(String(Math.round(n))); out.add(String(Math.round(n * 10) / 10)); out.add(n.toFixed(1)); };
  for (const f of figures || []) { add(f.value); add(f.fleet); add(f.open); add(f.overdue); for (const p of f.series || []) add(p.value); for (const r of f.rows || []) add(r.value); }
  return out;
}

module.exports = { analyse, trendDirection, canonicalNumbers, TONE, fmt };
