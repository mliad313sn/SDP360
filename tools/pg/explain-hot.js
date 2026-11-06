#!/usr/bin/env node
'use strict';
// E-A05 (audit A-05, preparation) — EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) of the hot readers on a
// DISPOSABLE database with synthetic volumes. Measures plans; creates NO index (index ideas go to
// docs/ai-decisions/ADR-E-A05-index-proposals.md as proposals). DBA validation on real volumes is a
// human gate — synthetic rows have a different distribution from production.
//
//   PG_ADMIN_URL=postgres://<role with CREATEDB>@host/db node tools/pg/explain-hot.js [--rows 100000] [--out file.md] [--keep]
//   node tools/pg/explain-hot.js --db-url=postgres://…/sdp_test_xyz   (reuse an existing throwaway database)
//
// Guard: the target database name must start with `sdp_test_` (the script creates `sdp_test_explain_<stamp>`
// itself). Any other name — `sdp_dashboard`, `postgres`, a restored copy — is REFUSED before connecting.
// The queries mirror the SQL of the named reader in reports-db.js / services/fieldStore.js (same WHERE,
// same GROUP BY); they are copies for measurement, so a reader change must be mirrored here.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const THROWAWAY = /^sdp_test_[a-z0-9_]+$/;

/** Pure guard: only a database whose name starts with sdp_test_ is acceptable. */
function assertThrowaway(url) {
  let name;
  try { name = decodeURIComponent(new URL(url).pathname.replace(/^\//, '')); } catch (_) { throw new Error('refused: not a PostgreSQL URL'); }
  if (!THROWAWAY.test(name)) throw new Error(`refused: database "${name}" is not a throwaway database (name must start with sdp_test_)`);
  return name;
}

/** Walk a FORMAT JSON plan tree and summarise it: node types, sequential scans on large relations, totals. */
function summarisePlan(explainJson, { bigRows = 10000 } = {}) {
  const root = Array.isArray(explainJson) ? explainJson[0] : explainJson;
  const plan = root && (root.Plan || root['Plan']);
  if (!plan) throw new Error('not an EXPLAIN (FORMAT JSON) result');
  const nodes = []; const seqScans = [];
  (function walk(n) {
    nodes.push(n['Node Type']);
    if (n['Node Type'] === 'Seq Scan') {
      const scanned = (Number(n['Actual Rows']) || 0) * (Number(n['Actual Loops']) || 1) + (Number(n['Rows Removed by Filter']) || 0) * (Number(n['Actual Loops']) || 1);
      if (scanned > bigRows) seqScans.push({ relation: n['Relation Name'], rows_scanned: scanned, rows_kept: (Number(n['Actual Rows']) || 0) * (Number(n['Actual Loops']) || 1) });
    }
    for (const c of n.Plans || []) walk(c);
  })(plan);
  return {
    top_node: plan['Node Type'],
    node_types: [...new Set(nodes)],
    rows: Number(plan['Actual Rows']) || 0,
    execution_ms: root['Execution Time'] != null ? Number(root['Execution Time']) : null,
    planning_ms: root['Planning Time'] != null ? Number(root['Planning Time']) : null,
    shared_hit: Number(plan['Shared Hit Blocks']) || 0,
    shared_read: Number(plan['Shared Read Blocks']) || 0,
    seq_scans_over_threshold: seqScans,
  };
}

// The hot readers, as SQL with their bind values on the synthetic data.
const HOT = [
  { key: 'ageing_by_site', mirrors: 'reports-db._getAgeingBySiteDBPg', sql: `
    SELECT site, SUM(CASE WHEN age_days <= 30 THEN 1 ELSE 0 END) AS d0, COUNT(*) AS total FROM (
      SELECT site, TRUNC(EXTRACT(EPOCH FROM (now() - created_time::timestamptz)) / 86400)::integer AS age_days
      FROM request_records WHERE pending_status = 1
        AND LOWER(TRIM(COALESCE(request_status,''))) NOT IN ('closed','resolved','confirmed resolution','confirm resolution','cancelled')
        AND site IS NOT NULL AND TRIM(site) != '' AND LOWER(TRIM(site)) NOT IN ('-no value-','-no value','no value','(blank)')
        AND created_time IS NOT NULL) q
    GROUP BY site HAVING COUNT(*) > 0 ORDER BY total DESC, site COLLATE "C" ASC`, params: [] },
  { key: 'ageing_by_group', mirrors: 'reports-db._getAgeingByGroupDBPg', sql: `
    SELECT tech_group AS grp, COUNT(*) AS total, SUM(CASE WHEN frt_ok = 1 THEN 1 ELSE 0 END) * 100.0 / NULLIF(COUNT(*),0) AS sla_pct FROM (
      SELECT tech_group, TRUNC(EXTRACT(EPOCH FROM (now() - created_time::timestamptz)) / 86400)::integer AS age_days,
             CASE WHEN LOWER(TRIM(COALESCE(first_response_overdue,''))) IN ('true','yes','1') THEN 0 ELSE 1 END AS frt_ok
      FROM request_records WHERE pending_status = 1
        AND LOWER(TRIM(COALESCE(request_status,''))) NOT IN ('closed','resolved','confirmed resolution','confirm resolution','cancelled')
        AND tech_group IS NOT NULL AND TRIM(tech_group) != '' AND created_time IS NOT NULL) q
    GROUP BY grp HAVING COUNT(*) > 0 ORDER BY total DESC, tech_group COLLATE "C" ASC`, params: [] },
  { key: 'calendar_monthly_helpdesk', mirrors: 'reports-db._getCalendarMonthlyHelpdeskPg (one of its 9 counts, UTC calendar)', sql: `
    SELECT COUNT(*) AS n FROM request_records
    WHERE tech_group IN ($1, $2) AND created_time::date >= $3::date AND created_time::date <= $4::date AND pending_status = 0`, params: ['Hounde IT Agents', 'Mana IT Agents', '2025-02-01', '2025-02-28'] },
  { key: 'site_helpdesk_window', mirrors: 'reports-db._getSiteHelpdeskWindowPg', sql: `
    SELECT pending_status, overdue_status, request_type, template, category, sub_category, created_time, resolved_time, completed_time
    FROM request_records WHERE tech_group IN ($1) AND substr(created_time,1,10) BETWEEN $2 AND $3`, params: ['Hounde IT Agents', '2025-02-01', '2025-02-28'] },
  { key: 'report_list_filtered', mirrors: 'reports-db._listReportsPg (site + year)', sql: `
    SELECT wr.id, wr.status, wr.updated_at, wr.submitted_at, w.label AS week_label, w.year, w.week_number, w.start_date, w.end_date, s.name AS site_name, s.zoho_group
    FROM weekly_reports wr JOIN weeks w ON w.id = wr.week_id JOIN sites s ON s.id = wr.site_id
    WHERE 1=1 AND wr.site_id = $1 AND w.year = $2 ORDER BY w.year DESC, w.week_number DESC`, params: [1, 2025] },
  { key: 'field_outbox_by_status', mirrors: 'services/fieldStore.outboxStats', sql: `
    SELECT status, COUNT(*) AS n FROM field_outbox WHERE received_at >= $1 GROUP BY status`, params: ['2025-01-08T00:00:00.000Z'] },
  { key: 'system_log_list', mirrors: 'reports-db.listSystemLog (category filter, first page)', sql: `
    SELECT * FROM system_log WHERE category = $1 ORDER BY ts DESC, id DESC LIMIT 50 OFFSET 0`, params: ['auth'] },
];

async function q(Client, url, sql, params) { const c = new Client({ connectionString: url }); await c.connect(); try { return await c.query(sql, params); } finally { await c.end(); } }

async function seed(Client, url, rows) {
  const run = (sql, p) => q(Client, url, sql, p);
  await run(`INSERT INTO sites (name, zoho_group) SELECT n, g FROM (VALUES ('Hounde','Hounde IT Agents'),('Mana','Mana IT Agents'),('Sabodala','Sabodala IT Agents'),('Ity','Ity IT Agents'),('Lafigue','Lafigue IT Agents'),('Ouagadougou','Ouaga IT Agents')) v(n,g) ON CONFLICT (name) DO NOTHING`);
  await run(`INSERT INTO request_records (request_id, display_id, subject, request_status, pending_status, overdue_status, first_response_overdue, site, tech_group, request_type, created_time, resolved_time, responded_time)
    SELECT 'R' || g, 'D' || g, 'Ticket ' || g, (ARRAY['Open','Closed','Resolved','On Hold','Cancelled'])[1 + g % 5], CASE WHEN g % 5 IN (0, 3) THEN 1 ELSE 0 END, (g % 7 = 0)::int,
           CASE WHEN g % 11 = 0 THEN 'true' ELSE 'false' END,
           (ARRAY['HOUNDE','MANA','Sabodala','ITY','LAFIGUE','Ouagadougou'])[1 + g % 6],
           (ARRAY['Hounde IT Agents','Mana IT Agents','Sabodala IT Agents','Ity IT Agents','Lafigue IT Agents','Ouaga IT Agents'])[1 + g % 6],
           CASE WHEN g % 9 = 0 THEN 'Incident' ELSE 'Service Request' END,
           to_char(timestamp '2025-01-01' + (g * 5 || ' minutes')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'),
           CASE WHEN g % 5 IN (0, 3) THEN NULL ELSE to_char(timestamp '2025-01-01' + ((g * 5 + 300) || ' minutes')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"') END,
           to_char(timestamp '2025-01-01' + ((g * 5 + 20) || ' minutes')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"')
    FROM generate_series(1, $1) g`, [rows]);
  await run(`INSERT INTO weeks (year, week_number, start_date, end_date, label)
    SELECT 2023 + y, w, to_char(date '2023-01-02' + ((y * 52 + w - 1) * 7), 'YYYY-MM-DD'), to_char(date '2023-01-02' + ((y * 52 + w - 1) * 7 + 6), 'YYYY-MM-DD'), 'W' || w || ' ' || (2023 + y)
    FROM generate_series(0, 3) y, generate_series(1, 52) w ON CONFLICT DO NOTHING`);
  await run(`INSERT INTO weekly_reports (site_id, week_id, status) SELECT s.id, w.id, 'submitted' FROM sites s CROSS JOIN weeks w ON CONFLICT DO NOTHING`);
  await run(`INSERT INTO field_outbox (uuid, user_id, kind, payload_hash, status, received_at)
    SELECT 'u' || g, 1 + g % 40, 'inspection', md5(g::text), (ARRAY['received','applying','applied','rejected','failed'])[1 + g % 5],
           to_char(timestamp '2025-01-01' + (g || ' minutes')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"')
    FROM generate_series(1, $1) g`, [Math.round(rows / 5)]);
  await run(`INSERT INTO system_log (ts, category, action, actor, risk)
    SELECT to_char(timestamp '2025-01-01' + (g || ' minutes')::interval, 'YYYY-MM-DD"T"HH24:MI:SS.000"Z"'), (ARRAY['auth','report','config','field','identity'])[1 + g % 5], 'a' || (g % 30), 'user' || (g % 50), (g % 97 = 0)::int
    FROM generate_series(1, $1) g`, [rows]);
  await run('ANALYZE');
}

async function explainAll(Client, url) {
  const out = [];
  for (const h of HOT) {
    const r = await q(Client, url, `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${h.sql}`, h.params);
    out.push(Object.assign({ key: h.key, mirrors: h.mirrors }, summarisePlan(r.rows[0]['QUERY PLAN'])));
  }
  return out;
}

function renderMarkdown(results, meta) {
  const L = ['# EXPLAIN on synthetic volumes — observation (E-A05)', '',
    '> **Disposable database, synthetic rows.** Generated by `tools/pg/explain-hot.js`. Plans on synthetic data do not',
    '> predict production plans (different value distribution, cache, hardware). No index was created; proposals live in',
    '> `docs/ai-decisions/ADR-E-A05-index-proposals.md`. Validation on real volumes is a DBA decision.', '',
    `- Generated: ${meta.at} · server: ${meta.server} · commit: ${meta.commit}`,
    `- Volumes: ${meta.rows} tickets · ${Math.round(meta.rows / 5)} field outbox rows · ${meta.rows} system_log rows · ${meta.reports} weekly reports`,
    '- "Seq scans > 10k" lists sequential scans that read more than 10 000 rows (kept + removed by filter).', '',
    '| Reader | Mirrors | Top node | Rows | Exec (ms) | Plan (ms) | Buffers hit/read | Seq scans > 10k rows |',
    '|---|---|---|---|---|---|---|---|'];
  for (const r of results) L.push(`| ${r.key} | \`${r.mirrors}\` | ${r.top_node} | ${r.rows} | ${r.execution_ms == null ? '—' : r.execution_ms.toFixed(1)} | ${r.planning_ms == null ? '—' : r.planning_ms.toFixed(1)} | ${r.shared_hit}/${r.shared_read} | ${r.seq_scans_over_threshold.map((s) => `${s.relation} (${s.rows_scanned} scanned, ${s.rows_kept} kept)`).join('; ') || 'none'} |`);
  L.push('', 'Node types per reader:', '');
  for (const r of results) L.push(`- **${r.key}**: ${r.node_types.join(' → ')}`);
  return L.join('\n') + '\n';
}

async function main() {
  const { Client } = require('pg');
  const arg = (f, d) => { const a = process.argv.find((x) => x.startsWith(f + '=')); if (a) return a.slice(f.length + 1); const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : d; };
  const rows = Math.max(1000, Number(arg('--rows', '100000')) || 100000);
  const given = arg('--db-url', '');
  let url; let created = null; const admin = process.env.PG_ADMIN_URL;
  if (given) { assertThrowaway(given); url = given; }
  else {
    if (!admin) { console.error('PG_ADMIN_URL (a role with CREATEDB on a disposable cluster) or --db-url=<sdp_test_… database> is required'); process.exit(2); }
    created = `sdp_test_explain_${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}`;
    const u = new URL(admin); u.pathname = '/' + created; url = u.toString();
    assertThrowaway(url);
    await q(Client, admin, `CREATE DATABASE ${created}`);
  }
  try {
    const mig = spawnSync(process.execPath, [path.join(ROOT, 'db', 'migrate.js')], { env: { ...process.env, PG_URL: url }, encoding: 'utf8' });
    if (mig.status !== 0) throw new Error('migrations failed: ' + String(mig.stderr).slice(-300));
    await seed(Client, url, rows);
    const results = await explainAll(Client, url);
    const server = (await q(Client, url, 'SELECT version() AS v')).rows[0].v.split(' on ')[0];
    const reports = Number((await q(Client, url, 'SELECT count(*)::int AS n FROM weekly_reports')).rows[0].n);
    let commit = 'UNKNOWN'; try { commit = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT, encoding: 'utf8' }).stdout.trim() || 'UNKNOWN'; } catch (_) { /* no git */ }
    const md = renderMarkdown(results, { at: new Date().toISOString(), server, commit, rows, reports });
    const out = arg('--out', '');
    if (out) fs.writeFileSync(path.resolve(ROOT, out), md);
    process.stdout.write(md);
  } finally {
    if (created && !process.argv.includes('--keep')) await q(Client, admin, `DROP DATABASE IF EXISTS ${created}`).catch(() => {});
  }
}

module.exports = { assertThrowaway, summarisePlan, renderMarkdown, HOT };
if (require.main === module) main().catch((e) => { console.error('[explain-hot] ' + e.message); process.exit(1); });
