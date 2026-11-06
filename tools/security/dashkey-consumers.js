'use strict';
// E-S02 (audit S-02, decision D-15 prep) — READ-ONLY inventory of who still calls the API with the x-dash-key
// alone (no session). Source: system_log action 'dashkey_call' (one row a day per route × source, written by
// services/dashKeyScope.js), plus the scope switch's own rows 'dashkey_scope_would_refuse' / 'dashkey_scope_refused'.
//
//   node tools/security/dashkey-consumers.js [--days=30] [--as-of=YYYY-MM-DD]
//
// Prints markdown for the integration owner: route × source (IP + user-agent) × days seen. The key value is
// never stored in the log, so it can never be printed here. Nothing is written.
const path = require('path');

const ACTIONS = Object.freeze(['dashkey_call', 'dashkey_scope_would_refuse', 'dashkey_scope_refused']);

const minusDays = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
function _details(d) { if (d && typeof d === 'object') return d; try { return JSON.parse(d || '{}') || {}; } catch (_) { return {}; } }

/** Pure: rows {ts, action, target, ip, details} → one line per route × source. */
function summarize(rows) {
  const groups = new Map();
  for (const r of rows || []) {
    if (!ACTIONS.includes(r.action)) continue;
    const ua = String(_details(r.details).user_agent || '(no user-agent)');
    const route = String(r.target || '(unknown route)');
    const ip = String(r.ip || '(no ip)');
    const key = route + '|' + ip + '|' + ua;
    let g = groups.get(key);
    if (!g) { g = { route, ip, user_agent: ua, days: new Set(), would_refuse: 0, refused: 0, first: null, last: null }; groups.set(key, g); }
    const day = String(r.ts || '').slice(0, 10) || null;
    if (r.action === 'dashkey_call' && day) g.days.add(day);
    if (r.action === 'dashkey_scope_would_refuse') g.would_refuse++;
    if (r.action === 'dashkey_scope_refused') g.refused++;
    if (day && (!g.first || day < g.first)) g.first = day;
    if (day && (!g.last || day > g.last)) g.last = day;
  }
  return [...groups.values()]
    .map((g) => ({ route: g.route, ip: g.ip, user_agent: g.user_agent, days_seen: g.days.size, would_refuse: g.would_refuse, refused: g.refused, first: g.first, last: g.last }))
    .sort((a, b) => b.days_seen - a.days_seen || a.route.localeCompare(b.route) || a.ip.localeCompare(b.ip));
}

const _cell = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/\n/g, ' ');

function formatReport({ days, since, asOf, lines }) {
  const L = [`# Dash-key consumers — ${since} → ${asOf} (${days} days)`, '',
    'Source: system_log `dashkey_call` (one row a day per route × source) + the scope switch rows. The key itself is never logged.',
    'Naming each consumer, giving it its own key/quota, and choosing `dashkey_scope_mode=restrict` are decisions of the integration owner and the Security owner — this report decides nothing.', ''];
  if (!lines.length) { L.push('No key-only call recorded in the window.'); return L.join('\n') + '\n'; }
  L.push('| Route | Source IP | User-agent | Days seen | Would refuse (shadow) | Refused (restrict) | First | Last | Consumer (to name) |', '|---|---|---|---|---|---|---|---|---|');
  for (const l of lines) L.push(`| ${_cell(l.route)} | ${_cell(l.ip)} | ${_cell(l.user_agent)} | ${l.days_seen} | ${l.would_refuse} | ${l.refused} | ${l.first || 'UNKNOWN'} | ${l.last || 'UNKNOWN'} |  |`);
  L.push('', `Distinct routes: ${new Set(lines.map((l) => l.route)).size}. Distinct sources: ${new Set(lines.map((l) => l.ip + ' ' + l.user_agent)).size}.`);
  return L.join('\n') + '\n';
}

async function fetchRows(query, since) {
  return query(`SELECT ts, action, target, ip, details FROM system_log
                 WHERE action IN ('dashkey_call','dashkey_scope_would_refuse','dashkey_scope_refused')
                   AND substr(ts, 1, 10) >= $1 ORDER BY ts`, [since]);
}

async function report({ query, days = 30, asOf = new Date().toISOString().slice(0, 10) }) {
  const n = Math.max(1, Math.min(366, Number.parseInt(days, 10) || 30));
  const since = minusDays(asOf, n);
  return formatReport({ days: n, since, asOf, lines: summarize(await fetchRows(query, since)) });
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
    try { process.stdout.write(await report({ query: async (sql, p) => (await c.query(sql, p)).rows, days: arg('days', 30), asOf: arg('as-of', undefined) })); }
    finally { await c.end(); }
  })().catch((e) => { console.error('[dashkey-consumers] ' + e.message); process.exitCode = 1; });
}
