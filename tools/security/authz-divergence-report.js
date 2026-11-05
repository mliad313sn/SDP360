'use strict';
// E-S01 (audit S-04) — READ-ONLY summary of the capability evaluator's log (system_log category 'authz').
//
//   node tools/security/authz-divergence-report.js [--days=14] [--as-of=YYYY-MM-DD]
//
// Groups shadow divergences (authz_shadow_divergence) and enforce refusals (authz_enforce_denied) by
// capability and route, prints markdown. It is the input to decision R6: "two weeks of shadow without an
// unexplained divergence" before a capability enters authz_enforce_caps. No user name, id or IP is printed
// — only counts of DISTINCT actors. Nothing is written.
const path = require('path');

const ACTIONS = Object.freeze(['authz_shadow_divergence', 'authz_enforce_denied']);

const minusDays = (day, n) => {
  const d = new Date(day + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
};

function _details(d) {
  if (d && typeof d === 'object') return d;
  try { return JSON.parse(d || '{}') || {}; } catch (_) { return {}; }
}

/** Pure: rows of {ts, action, actor_id, target, details} → grouped lines. */
function summarize(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    if (!ACTIONS.includes(r.action)) continue;
    const det = _details(r.details);
    const route = String(det.route || '(unknown route)');
    const cap = String(r.target || 'uncatalogued');
    const key = `${r.action}|${cap}|${route}`;
    let g = groups.get(key);
    if (!g) {
      g = { action: r.action, capability: cap, route, count: 0, actors: new Set(), reasons: new Map(), first: null, last: null };
      groups.set(key, g);
    }
    g.count++;
    if (r.actor_id != null) g.actors.add(String(r.actor_id));
    const rc = String(det.reason_code || '-');
    g.reasons.set(rc, (g.reasons.get(rc) || 0) + 1);
    const day = String(r.ts || '').slice(0, 10) || null;
    if (day && (!g.first || day < g.first)) g.first = day;
    if (day && (!g.last || day > g.last)) g.last = day;
  }
  return [...groups.values()]
    .map((g) => ({ action: g.action, capability: g.capability, route: g.route, count: g.count, distinct_actors: g.actors.size,
      reasons: [...g.reasons.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ×${v}`).join(', '),
      first: g.first, last: g.last }))
    .sort((a, b) => b.count - a.count || a.capability.localeCompare(b.capability) || a.route.localeCompare(b.route));
}

const _cell = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|');

/** Pure: markdown report. */
function formatReport({ days, since, asOf, lines }) {
  const L = [];
  L.push(`# Capability evaluator log — ${since} → ${asOf} (${days} days)`, '');
  L.push('Source: system_log category `authz`. Counts only; no user names, ids or addresses.', '');
  for (const action of ACTIONS) {
    const part = lines.filter((l) => l.action === action);
    const title = action === 'authz_shadow_divergence' ? 'Shadow divergences (catalogue ≠ legacy guard)' : 'Enforce refusals (authz_enforce_caps)';
    L.push(`## ${title}`, '');
    if (!part.length) { L.push('None in the window.', ''); continue; }
    L.push('| Capability | Route | Rows | Distinct accounts | Reasons | First | Last |', '|---|---|---|---|---|---|---|');
    for (const l of part) L.push(`| ${_cell(l.capability)} | ${_cell(l.route)} | ${l.count} | ${l.distinct_actors} | ${_cell(l.reasons)} | ${l.first || 'UNKNOWN'} | ${l.last || 'UNKNOWN'} |`);
    L.push('');
  }
  const div = lines.filter((l) => l.action === 'authz_shadow_divergence').reduce((n, l) => n + l.count, 0);
  L.push(`Total shadow divergences: ${div}. Whether each one is explained is a decision of the Security owner (R6) — this report does not decide it.`);
  return L.join('\n') + '\n';
}

/** query(sql, params) → rows. */
async function fetchRows(query, since) {
  return query(`SELECT ts, action, actor_id, target, details FROM system_log
                 WHERE category = 'authz' AND action IN ('authz_shadow_divergence','authz_enforce_denied')
                   AND substr(ts, 1, 10) >= $1 ORDER BY ts`, [since]);
}

async function report({ query, days = 14, asOf = new Date().toISOString().slice(0, 10) }) {
  const n = Math.max(1, Math.min(366, Number.parseInt(days, 10) || 14));
  const since = minusDays(asOf, n);
  const rows = await fetchRows(query, since);
  return formatReport({ days: n, since, asOf, lines: summarize(rows) });
}

module.exports = { ACTIONS, summarize, formatReport, fetchRows, report };

if (require.main === module) {
  require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });
  const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
  (async () => {
    if (!process.env.PG_URL) { console.error('PG_URL missing from .env — nothing to read.'); process.exitCode = 1; return; }
    const { Client } = require('pg');
    const c = new Client({ connectionString: process.env.PG_URL });
    await c.connect();
    try {
      process.stdout.write(await report({ query: async (sql, p) => (await c.query(sql, p)).rows, days: arg('days', 14), asOf: arg('as-of', undefined) }));
    } finally { await c.end(); }
  })().catch((e) => { console.error('[authz-divergence-report] ' + e.message); process.exitCode = 1; });
}
