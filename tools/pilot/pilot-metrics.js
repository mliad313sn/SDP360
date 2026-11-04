'use strict';
// B-02 — Pilot measurement kit, READ-ONLY collector.
//
//   node tools/pilot/pilot-metrics.js --from=2026-11-02 --to=2026-11-29 [--site=Hounde] [--format=md|csv|both] [--out=DIR]
//
// Reads data the platform already records (system_log, audit_log, weekly_reports, md_*, insp_*,
// action_items, field_outbox, sync_runs) and prints a per site × persona × ISO week report.
// Nothing is written to the database: the session is switched to READ ONLY before the first
// query, so any statement that would change data is refused by PostgreSQL itself.
//
// No user name, full name or e-mail is ever SELECTed: users are read as (id, role, site) and the
// per-user section carries an HMAC pseudonym keyed by PILOT_PSEUDONYM_KEY from .env.
//
// .env FIRST: only server.js loads dotenv; a standalone CLI must read PG_URL itself.
if (require.main === module) require('dotenv').config({ path: require('path').join(__dirname, '..', '..', '.env') });

const fs = require('fs');
const path = require('path');
const P = require('../../services/pilotMetrics');

function parseArgs(argv) {
  const o = { from: null, to: null, site: null, format: 'md', out: null };
  for (const a of argv || []) {
    const m = /^--([a-z]+)=(.*)$/.exec(a);
    if (m && m[1] in o) o[m[1]] = m[2];
  }
  return o;
}
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
function validate(o) {
  const errs = [];
  if (!DAY_RE.test(o.from || '')) errs.push('--from=YYYY-MM-DD is required');
  if (!DAY_RE.test(o.to || '')) errs.push('--to=YYYY-MM-DD is required');
  if (!errs.length && o.from > o.to) errs.push('--from is after --to');
  if (!['md', 'csv', 'both'].includes(o.format)) errs.push('--format must be md, csv or both');
  return errs;
}

// A table that does not exist yet (older database, module never booted) is "no data", not a crash.
async function q(client, sql, params, missing, name) {
  try { return (await client.query(sql, params)).rows; }
  catch (e) { if (e && e.code === '42P01') { missing.push(name); return []; } throw e; }
}

/** Run every read. The window is applied in SQL coarsely and exactly in the pure module. */
async function collect(client, { from, to }) {
  const missing = [];
  // TEXT columns compare text-to-text (substr), TIMESTAMPTZ via to_char — never `text <= date`.
  const users = await q(client, `SELECT u.id, u.role, s.name AS site FROM users u LEFT JOIN sites s ON s.id = u.site_id`, [], missing, 'users');
  const sys = await q(client, `SELECT actor_id AS user_id, category, action, ts FROM system_log
                               WHERE actor_id IS NOT NULL AND substr(ts,1,10) BETWEEN $1 AND $2`, [from, to], missing, 'system_log');
  const aud = await q(client, `SELECT user_id, action, created_at AS ts FROM audit_log
                               WHERE user_id IS NOT NULL AND to_char(created_at,'YYYY-MM-DD') BETWEEN $1 AND $2`, [from, to], missing, 'audit_log');
  const events = [
    ...sys.filter((r) => P.isBusinessEvent(r.category, r.action)).map((r) => ({ user_id: r.user_id, ts: r.ts })),
    ...aud.filter((r) => r.action).map((r) => ({ user_id: r.user_id, ts: r.ts })),
  ];
  const reports = await q(client, `SELECT s.name AS site, wr.submitted_by AS user_id, wr.created_at, wr.submitted_at
                                   FROM weekly_reports wr JOIN sites s ON s.id = wr.site_id
                                   WHERE wr.submitted_at IS NOT NULL AND substr(wr.submitted_at,1,10) BETWEEN $1 AND $2`, [from, to], missing, 'weekly_reports');
  const pvActions = await q(client, `SELECT m.site_code AS site, m.created_by AS user_id, m.submitted_at, a.created_at AS action_created_at
                                     FROM md_meetings m JOIN md_actions a ON a.meeting_id = m.id
                                     WHERE m.submitted_at IS NOT NULL AND substr(m.submitted_at,1,10) BETWEEN $1 AND $2`, [from, to], missing, 'md_meetings');
  const md = await q(client, `SELECT m.site_code AS site, m.created_by AS user_id, a.created_at, a.closed_at,
                                     (SELECT MIN(u.created_at) FROM md_action_updates u WHERE u.action_id = a.id AND u.status_change IN ('resolved','closed')) AS upd_closed
                              FROM md_actions a JOIN md_meetings m ON m.id = a.meeting_id
                              WHERE a.status IN ('resolved','closed')`, [], missing, 'md_actions');
  const insp = await q(client, `SELECT i.site_code AS site, i.created_by AS user_id, a.created_at, a.closed_at
                                FROM insp_actions a JOIN insp_inspections i ON i.id = a.inspection_id
                                WHERE a.status = 'Closed' AND a.closed_at IS NOT NULL`, [], missing, 'insp_actions');
  const ai = await q(client, `SELECT COALESCE(ai.lineage, ai.uid) AS grp, ai.status, ai.status_changed_at, wr.created_at AS report_created_at,
                                     wr.created_by AS user_id, s.name AS site, w.start_date
                              FROM action_items ai JOIN weekly_reports wr ON wr.id = ai.report_id
                              JOIN sites s ON s.id = wr.site_id LEFT JOIN weeks w ON w.id = wr.week_id
                              WHERE ai.source IS NULL`, [], missing, 'action_items');
  const closures = [
    ...md.map((r) => ({ source: 'meetings', site: r.site, user_id: r.user_id, created_at: r.created_at, closed_at: r.closed_at || r.upd_closed })),
    ...insp.map((r) => ({ source: 'inspection', site: r.site, user_id: r.user_id, created_at: r.created_at, closed_at: r.closed_at })),
    ...reportActionClosures(ai),
  ];
  const field = await q(client, `SELECT user_id, status, received_at FROM field_outbox
                                 WHERE substr(received_at,1,10) BETWEEN $1 AND $2`, [from, to], missing, 'field_outbox');
  const syncRows = await q(client, `SELECT job, MAX(COALESCE(finished_at, started_at)) AS last_ok FROM sync_runs WHERE status = 'ok' GROUP BY job`, [], missing, 'sync_runs');
  const lastOk = {}; for (const r of syncRows) lastOk[r.job] = r.last_ok;
  const sites = await q(client, `SELECT s.name, c.code FROM sites s LEFT JOIN site_module_codes c ON c.site_id = s.id`, [], missing, 'sites');
  return { users, events, reports, pvActions, closures, field, lastOk, sites, missing: [...new Set(missing)] };
}

// action_items carry no creation time: a group (lineage root) is created when its first report was
// created, and closed at the status_changed_at of its NEWEST row, only when that row is 'closed'.
function reportActionClosures(rows) {
  const g = new Map();
  for (const r of rows || []) {
    if (!r.grp) continue;
    if (!g.has(r.grp)) g.set(r.grp, []);
    g.get(r.grp).push(r);
  }
  const out = [];
  for (const list of g.values()) {
    list.sort((a, b) => String(a.start_date || '').localeCompare(String(b.start_date || '')) || (P.toMs(a.report_created_at) || 0) - (P.toMs(b.report_created_at) || 0));
    const first = list[0], last = list[list.length - 1];
    if (last.status !== 'closed' || !last.status_changed_at) continue;
    out.push({ source: 'report follow-up', site: last.site, user_id: first.user_id, created_at: first.report_created_at, closed_at: last.status_changed_at });
  }
  return out;
}

/** --site → every label that names that site (name + module codes), lower-cased; null = all sites. */
function siteSetFor(site, sites) {
  if (!site) return null;
  const want = String(site).trim().toLowerCase();
  const byName = new Map();
  for (const r of sites || []) {
    const n = String(r.name || '').trim();
    if (!byName.has(n)) byName.set(n, new Set([n.toLowerCase()]));
    if (r.code) byName.get(n).add(String(r.code).trim().toLowerCase());
  }
  for (const labels of byName.values()) if (labels.has(want)) return labels;
  return new Set([want]);
}

async function run({ argv = process.argv.slice(2), env = process.env, client = null, now = new Date(), write = (s) => process.stdout.write(s) } = {}) {
  const o = parseArgs(argv);
  const errs = validate(o);
  if (errs.length) { for (const e of errs) process.stderr.write(e + '\n'); return { ok: false, errors: errs }; }
  let c = client, own = false;
  if (!c) {
    if (!env.PG_URL) { process.stderr.write('PG_URL is not set (.env) — nothing to measure.\n'); return { ok: false, errors: ['PG_URL missing'] }; }
    const { Client } = require('pg'); c = new Client({ connectionString: env.PG_URL }); await c.connect(); own = true;
  }
  try {
    await c.query('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY');
    const d = await collect(c, o);
    const metrics = require('../../services/metricRegistry').SEED.map((m) => ({ key: m.key, module: m.module, status: m.status }));
    const rep = P.buildReport({ from: o.from, to: o.to, siteSet: siteSetFor(o.site, d.sites), users: d.users, events: d.events, reports: d.reports,
      pvActions: d.pvActions, closures: d.closures, field: d.field, metrics, lastOk: d.lastOk, nowMs: now.getTime(),
      generatedAt: now.toISOString(), pseudonymKey: env.PILOT_PSEUDONYM_KEY || null });
    let md = P.toMarkdown(rep);
    if (d.missing.length) md += `\nTables not found in this database (counted as no data): ${d.missing.join(', ')}\n`;
    const csv = P.toCsv(rep);
    if (o.out) {
      fs.mkdirSync(o.out, { recursive: true });
      const base = `pilot-metrics_${o.from}_${o.to}${o.site ? '_' + String(o.site).replace(/[^A-Za-z0-9_-]+/g, '_') : ''}`;
      if (o.format !== 'csv') fs.writeFileSync(path.join(o.out, base + '.md'), md);
      if (o.format !== 'md') fs.writeFileSync(path.join(o.out, base + '.csv'), csv);
      write(`written to ${o.out}\n`);
    } else {
      if (o.format !== 'csv') write(md);
      if (o.format !== 'md') write(csv);
    }
    return { ok: true, report: rep, markdown: md, csv, missing: d.missing };
  } finally { if (own) await c.end(); }
}

module.exports = { parseArgs, validate, collect, reportActionClosures, siteSetFor, run };

if (require.main === module) {
  run().then((r) => { if (!r.ok) process.exitCode = 1; }).catch((e) => { process.stderr.write('pilot-metrics failed: ' + (e && e.message) + '\n'); process.exitCode = 1; });
}
