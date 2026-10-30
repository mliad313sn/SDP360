'use strict';
// SDP360 — Tracker Definition schema, validator and generic scorer.
//
// A *tracker definition* is the data a site manager or committee member edits in the Phase 2
// self-service Tracker Builder. It replaces the hard-coded shape of tracker-init.json
// (one programme, fixed 12-month year, pillars matching /^P\d+-/, KPI types as an if/else chain).
// Nothing here knows about Express or a database: validate(def) → { ok, errors }, and
// score(def, inputs, ctx) → per-unit / per-group / overall results using services/kpiRag.js.
//
// Shape (JSON):
// {
//   key: 'it-activity-2027', name: 'IT Activity Tracker 2027', version: 1,
//   period: { kind: 'monthly' | 'weekly' | 'quarterly', start: '2027-01', count: 12 },
//   units:  [{ code: 'SGO', name: 'Sabodala' }, ...],              // sites / teams / circuits
//   ragPolicy: 'tracker-activity' | { green, amber },
//   groups: [{ code: 'P1', name: 'Network Infra', weight: 0.30,
//              items: [{ code: 'P1-01', name: 'Backup test', kpiType: 'COUNT', weight: 0.1,
//                        target: 12, start: 1, end: 12, shared: false,
//                        source: { module: 'inspection', metric: 'count' } | null }] }]
// }

const KpiRag = require('./kpiRag');

const PERIOD_KINDS = { monthly: 12, weekly: 53, quarterly: 4 };
const CODE_RE = /^[A-Z0-9][A-Z0-9_-]{0,31}$/i;

function validate(def) {
  const errors = [];
  const E = (path, msg) => errors.push({ path, msg });
  if (!def || typeof def !== 'object') return { ok: false, errors: [{ path: '', msg: 'definition must be an object' }] };

  if (!def.key || !CODE_RE.test(def.key)) E('key', 'key is required: letters, digits, - or _ (max 32)');
  if (!def.name || typeof def.name !== 'string') E('name', 'name is required');
  if (def.version != null && !(Number.isInteger(def.version) && def.version >= 1)) E('version', 'version must be a positive integer');

  const p = def.period || {};
  if (!PERIOD_KINDS[p.kind]) E('period.kind', `kind must be one of ${Object.keys(PERIOD_KINDS).join(', ')}`);
  if (!(Number.isInteger(p.count) && p.count >= 1 && p.count <= (PERIOD_KINDS[p.kind] || 53)))
    E('period.count', 'count must be an integer between 1 and the number of periods in a year');
  // eslint-disable-next-line security/detect-unsafe-regex -- reviewed (consolidation 2026-10-28): anchored, fixed-width optional groups
  if (p.start != null && !/^\d{4}(-\d{2})?(-W\d{2})?$/.test(String(p.start))) E('period.start', 'start must look like 2027, 2027-01 or 2027-W01');

  if (!Array.isArray(def.units) || !def.units.length) E('units', 'at least one unit (site/team) is required');
  else {
    const seen = new Set();
    def.units.forEach((u, i) => {
      if (!u || !CODE_RE.test(u.code || '')) E(`units[${i}].code`, 'unit code is required');
      else if (seen.has(u.code.toUpperCase())) E(`units[${i}].code`, `duplicate unit code ${u.code}`);
      seen.add(String(u.code).toUpperCase());
    });
  }

  if (def.ragPolicy != null) {
    if (typeof def.ragPolicy === 'string') { if (!KpiRag.POLICIES[def.ragPolicy]) E('ragPolicy', `unknown RAG policy ${def.ragPolicy}`); }
    else if (!(def.ragPolicy.green > def.ragPolicy.amber)) E('ragPolicy', 'green threshold must exceed amber');
  }

  if (!Array.isArray(def.groups) || !def.groups.length) E('groups', 'at least one group (pillar) is required');
  else {
    const gcodes = new Set();
    let wsum = 0;
    def.groups.forEach((g, gi) => {
      const gp = `groups[${gi}]`;
      if (!g || !CODE_RE.test(g.code || '')) E(`${gp}.code`, 'group code is required');
      else if (gcodes.has(g.code)) E(`${gp}.code`, `duplicate group code ${g.code}`);
      gcodes.add(g && g.code);
      if (!(Number(g && g.weight) > 0)) E(`${gp}.weight`, 'group weight must be > 0');
      else wsum += Number(g.weight);
      if (!Array.isArray(g && g.items) || !g.items.length) { E(`${gp}.items`, 'a group needs at least one item'); return; }
      const icodes = new Set();
      g.items.forEach((it, ii) => {
        const ip = `${gp}.items[${ii}]`;
        if (!it || !CODE_RE.test(it.code || '')) E(`${ip}.code`, 'item code is required');
        else if (icodes.has(it.code)) E(`${ip}.code`, `duplicate item code ${it.code}`);
        icodes.add(it && it.code);
        if (!it || !it.name) E(`${ip}.name`, 'item name is required');
        if (!it || !KpiRag.KPI_TYPES[it.kpiType]) E(`${ip}.kpiType`, `kpiType must be one of ${Object.keys(KpiRag.KPI_TYPES).join(', ')}`);
        if (!(Number(it && it.weight) > 0)) E(`${ip}.weight`, 'item weight must be > 0');
        const n = p.count || 12;
        const s = it && it.start != null ? it.start : 1, e = it && it.end != null ? it.end : n;
        if (!(Number.isInteger(s) && s >= 1 && s <= n)) E(`${ip}.start`, `start must be between 1 and ${n}`);
        if (!(Number.isInteger(e) && e >= s && e <= n)) E(`${ip}.end`, `end must be between start and ${n}`);
        if (it && it.target != null && it.target !== '' && !Number.isFinite(Number(it.target))) E(`${ip}.target`, 'target must be numeric');
        if (it && it.source != null) {
          if (typeof it.source !== 'object' || !it.source.metric) E(`${ip}.source`, 'source needs { metric } (a KPI dictionary key)');
        }
      });
    });
    if (gcodes.size && Math.abs(wsum - 1) > 0.001) E('groups', `group weights must sum to 1 (got ${wsum.toFixed(3)})`);
  }
  return { ok: errors.length === 0, errors };
}

// Effective weight of an item = group weight × (item weight ÷ Σ item weights of ACTIVE items in
// the group) — identical to engine.js L79-97 so a migrated tracker scores the same.
function effectiveWeights(def, activeOf = () => true) {
  const out = {};
  for (const g of def.groups) {
    const active = g.items.filter((it) => activeOf(it));
    const sum = active.reduce((a, it) => a + Number(it.weight), 0) || 1;
    for (const it of g.items) out[it.code] = activeOf(it) ? Number(g.weight) * (Number(it.weight) / sum) : 0;
  }
  return out;
}

/**
 * Score one tracker.
 * @param {object} def        validated definition
 * @param {object} inputs     { [unitCode]: { [itemCode]: number[] } } values per period slot (1-based → index 0)
 * @param {object} [ctx]
 * @param {number} [ctx.currentPeriod]  1-based period reached (default: period.count)
 * @param {object} [ctx.targets]        { [unitCode]: { [itemCode]: { target, active } } } overrides
 * @returns {{ units: object, fleet: object }}
 */
function score(def, inputs = {}, ctx = {}) {
  const n = def.period.count;
  const cur = Math.min(n, Math.max(1, ctx.currentPeriod || n));
  const policy = def.ragPolicy || 'tracker-activity';
  const targets = ctx.targets || {};
  const tgtOf = (u, it) => (targets[u] && targets[u][it.code]) || { target: it.target, active: true };

  // shared items: the best unit total counts for every unit (engine.js L119-130)
  const sharedValue = {};
  for (const g of def.groups) for (const it of g.items) if (it.shared) {
    let best = 0;
    for (const u of def.units) {
      const v = KpiRag.aggregate(((inputs[u.code] || {})[it.code] || []).slice(0, cur), it.kpiType);
      if (v > best) best = v;
    }
    sharedValue[it.code] = best;
  }

  const units = {};
  for (const u of def.units) {
    const w = effectiveWeights(def, (it) => tgtOf(u.code, it).active !== false);
    const groups = {};
    const items = {};
    // Unit score = Σ group weight × group score ÷ Σ group weight over groups that HAVE a score
    // (legacy tracker-pptx.ss: a group with no scorable item is dropped, not counted as 0).
    let gTotalAll = 0, gWAll = 0;
    for (const g of def.groups) {
      let gTotal = 0, gW = 0;
      for (const it of g.items) {
        const t = tgtOf(u.code, it);
        if (t.active === false) { items[it.code] = { value: null, attainment: null, rag: 'NA', weight: 0 }; continue; }
        const series = ((inputs[u.code] || {})[it.code] || []).slice(0, cur);
        const start = it.start || 1, end = it.end || n;
        const value = it.shared ? sharedValue[it.code] : KpiRag.aggregate(series, it.kpiType);
        const elapsed = Math.max(0, Math.min(cur, end) - start + 1);
        let att = KpiRag.attainment(value, t.target, it.kpiType, { elapsed, span: end - start + 1 });
        // legacy: a COUNT with a zero/absent target still scores 0 once started (never N/A)
        if (att == null && it.kpiType === 'COUNT' && elapsed > 0 && (t.target == null || Number(t.target) === 0)) att = 0;
        const capped = att == null ? null : Math.min(1, att);
        let colour = KpiRag.rag(att, policy);
        if (att != null && att < (typeof policy === 'string' ? KpiRag.POLICIES[policy].amber : policy.amber) && cur <= end && it.kpiType !== 'COUNT') colour = 'AMBER'; // not yet overdue
        items[it.code] = { value, target: t.target, attainment: att, rag: colour, weight: w[it.code] };
        if (capped != null) { gTotal += capped * Number(it.weight); gW += Number(it.weight); }
      }
      const gs = gW ? gTotal / gW : null;
      groups[g.code] = { score: gs, weight: Number(g.weight) };
      if (gs != null) { gTotalAll += gs * Number(g.weight); gWAll += Number(g.weight); }
    }
    const s = gWAll ? gTotalAll / gWAll : null;
    units[u.code] = { score: s, rag: KpiRag.rag(s, 'tracker-executive'), groups, items };
  }

  const scores = Object.values(units).map((x) => x.score).filter((x) => x != null);
  const mean = scores.length ? scores.reduce((a, b) => a + b, 0) / scores.length : null;
  const sd = scores.length ? Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / scores.length) : null;
  const ranked = Object.entries(units).filter(([, v]) => v.score != null).sort((a, b) => b[1].score - a[1].score);
  const fleet = {
    mean, sd,
    best: ranked.length ? ranked[0][0] : null,
    worst: ranked.length ? ranked[ranked.length - 1][0] : null,
    attainment: Object.values(units).length ? Object.values(units).filter((x) => x.rag === 'GREEN').length / Object.values(units).length : null,
  };
  return { units, fleet };
}

// Convert the inherited tracker-init.json (+ year) into a definition so the legacy programme
// can be managed by the builder without re-keying 31 activities.
function fromLegacyInit(init, year, opts = {}) {
  const pillars = Object.keys(init.pillarWeights || init.pillar_weights || {});
  const acts = init.activities || [];
  const groups = pillars.map((pname, i) => ({
    code: `P${i + 1}`, name: pname, weight: Number((init.pillarWeights || init.pillar_weights)[pname]),
    items: acts.filter((a) => a.pillar === pname).map((a) => ({
      code: `P${i + 1}-${String(a.num ?? a.id).padStart(2, '0')}`, name: a.name,
      kpiType: KpiRag.KPI_TYPES[a.kpi] ? a.kpi : 'COUNT', weight: Number(a.weight) || 1,
      start: a.start || 1, end: a.end || 12, shared: !!a.shared, target: null, source: null,
    })),
  }));
  // tracker-init.json carries sites as a string array with siteNames / siteColors maps;
  // accept [{code,name,color}] objects as well.
  const sites = (init.sites || []).map((s) => typeof s === 'string'
    ? { code: s, name: (init.siteNames || {})[s] || s, color: (init.siteColors || {})[s] }
    : s);
  const active = new Set(init.activeSites || init.active_sites || sites.map((s) => s.code));
  return {
    key: opts.key || `it-activity-${year}`, name: opts.name || `IT Activity Tracker ${year}`, version: 1,
    period: { kind: 'monthly', start: String(year), count: 12 },
    units: sites.filter((s) => active.has(s.code)).map((s) => ({ code: s.code, name: s.name, colour: s.color || s.colour })),
    ragPolicy: 'tracker-activity',
    groups,
  };
}

module.exports = { validate, score, effectiveWeights, fromLegacyInit, PERIOD_KINDS };
