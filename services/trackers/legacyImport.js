'use strict';
// Step 7 — import of the IT Activity Tracker (tracker-db `loadTracker()` object D) into a business-tracker definition
// + its entries, for ONE year. Pure: no database. The structure used is the year's own (D.byYear[year], ADR-001
// phase 4) when the server provides it, else D. The definition reproduces the legacy scoring EXACTLY when read by
// public/lib/trackerEngine.js — tools/trackers/compare-legacy.js and tests/trackers-engine.test.js prove it.

function yearView(D, year) {
  const yd = D && D.byYear && D.byYear[year];
  if (!yd || !yd.activities) return D;
  return Object.assign({}, D, { activities: yd.activities, targets: yd.targets || D.targets, pillarWeights: yd.pillarWeights || D.pillarWeights });
}

function itemCode(a, used) {
  let base = String(a.code || ('A' + (a.num || a.id || used.size + 1))).replace(/[^A-Za-z0-9 _&.()/-]/g, '').slice(0, 44) || 'A';
  let c = base, k = 2;
  while (used.has(c)) c = base + '-' + (k++);
  used.add(c);
  return c;
}

/**
 * @param D       the loadTracker() object
 * @param year    e.g. 2026
 * @param opts    { id, title, siteIdOf(code) → site_id|null }
 * @returns { definition, values }  — values[unit][itemCode] = [12 numbers]
 */
function fromLegacy(D, year, opts = {}) {
  const V = yearView(D, year);
  const acts = V.activities || [];
  const used = new Set();
  const codes = acts.map(a => itemCode(a, used));
  const sites = (V.sites || []).slice();
  const active = new Set(V.activeSites || sites);
  const PW = V.pillarWeights || {};
  const pillars = [...new Set(acts.map(a => a.pillar))];

  const definition = {
    id: opts.id || `it-activity-${year}`,
    title: opts.title || { fr: `Tracker des activités informatiques ${year}`, en: `IT Activity Tracker ${year}` },
    description: `Imported from the IT Activity Tracker (${year}).`,
    year,
    units: sites.map(s => {
      const u = { code: s, name: (V.siteNames && V.siteNames[s]) || s, active: active.has(s) };
      const sid = opts.siteIdOf ? opts.siteIdOf(s) : null;
      if (sid) u.site_id = sid;
      return u;
    }),
    // A pillar without weight keeps the legacy default (0.25) through the engine; it is written explicitly here.
    groups: pillars.map(p => ({ code: String(p), name: String(p).replace(/^P\d+-/, ''), weight: p in PW ? Number(PW[p]) : 0.25 })),
    items: acts.map((a, i) => ({
      code: codes[i], name: String(a.name || codes[i]), group: String(a.pillar), kpi: String(a.kpi || 'COUNT').toUpperCase(),
      weight: Number(a.weight) || 0, start: Number(a.start) || 1, end: Number(a.end) || 12, shared: !!a.shared,
    })),
    targets: {},
    audience: { roles: ['any'], site_scope: 'all' },
    entry: { roles: ['tracker-editor', 'tracker-admin'], own_unit_only: true },
    rag_policy: 'tracker_activity',
  };
  const values = {};
  for (const s of sites) {
    const tg = (V.targets && V.targets[s]) || [];
    definition.targets[s] = {};
    acts.forEach((a, i) => {
      const t = tg[i];
      definition.targets[s][codes[i]] = { target: t && t.target != null ? String(t.target) : '0', active: !!(t && t.active) };
    });
    const rows = (D.inputs && D.inputs[year] && D.inputs[year][s]) || [];
    values[s] = {};
    acts.forEach((a, i) => {
      const r = rows[i] || [];
      values[s][codes[i]] = Array.from({ length: 12 }, (_, m) => Number(r[m]) || 0);
    });
  }
  return { definition, values };
}

module.exports = { fromLegacy, yearView };
