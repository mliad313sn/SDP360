'use strict';
// P08 §4 — reconciliation against the SOURCE: count-and-sum per group, the owner's export vs what SDP360 stored.
// The DATA is the owner's (an export from ServiceDesk Plus / Analytics, AssetExplorer, Meraki); this tool and the
// comparison sheet are the deliverable. Read-only: one SELECT per run, nothing written to the database.
//
//   node tools/kpi/reconcile-source.js --source=sdp_requests --export=requests.csv [--out=sheet.csv] [--tolerance=0]
//   node tools/kpi/reconcile-source.js --list                 the sources, their keys and the export columns read
//
// Database: PG_URL from the environment (the operator's box). Production data never leaves it; the sheet holds
// group labels and counts/sums only (no ticket subject, no person).
// An export row whose key cannot be read (unparsable date, empty group) is COUNTED as "unreadable", never dropped.
const fs = require('fs');
const path = require('path');

const MON = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
/** 'YYYY-MM' from an ISO date, 'DD Mon YYYY…', 'Mon DD, YYYY…' or 'DD/MM/YYYY' (day-first, the Zoho EU export); null otherwise. */
function monthOf(v) {
  const s = String(v == null ? '' : v).trim(); if (!s) return null;
  let m = /^(\d{4})-(\d{2})/.exec(s); if (m) return `${m[1]}-${m[2]}`;
  m = /^(\d{1,2})[ -]([A-Za-z]{3})[a-z]*[ -,]+(\d{4})/.exec(s); if (m && MON[m[2].toLowerCase()]) return `${m[3]}-${String(MON[m[2].toLowerCase()]).padStart(2, '0')}`;
  m = /^([A-Za-z]{3})[a-z]* (\d{1,2}),? (\d{4})/.exec(s); if (m && MON[m[1].toLowerCase()]) return `${m[3]}-${String(MON[m[1].toLowerCase()]).padStart(2, '0')}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(s); if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}`;
  return null;
}
const num = (v) => { if (v == null || String(v).trim() === '' || /^n\/?a$/i.test(String(v).trim())) return null; const n = Number(String(v).replace(/[\s,$%]/g, '')); return Number.isFinite(n) ? n : null; };
const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();

// Each source: the export columns read, the group key of an export row, the summed column, and ONE SELECT
// returning { key, n, s } per group from the stored table (same grouping).
const SOURCES = {
  sdp_requests: {
    label: 'ServiceDesk Plus requests (request_records) — count per month × support group, sum of reopen count',
    columns: ['Created Time', 'Group', 'Reopen Count'],
    key: (r) => { const m = monthOf(r['Created Time']); const g = norm(r['Group']); return m && g ? `${m} | ${g}` : null; },
    sum: (r) => num(r['Reopen Count']),
    sql: "SELECT substr(created_time,1,7) || ' | ' || LOWER(TRIM(tech_group)) AS key, COUNT(*) AS n, SUM(COALESCE(reopen_count,0)) AS s FROM request_records WHERE tech_group IS NOT NULL AND TRIM(tech_group) <> '' GROUP BY 1",
  },
  sdp_changes: {
    label: 'ServiceDesk Plus changes (change_records) — count per month × change group',
    columns: ['Created Time', 'Group'],
    key: (r) => { const m = monthOf(r['Created Time']); const g = norm(r['Group']); return m && g ? `${m} | ${g}` : null; },
    sum: () => null,
    sql: "SELECT substr(created_time,1,7) || ' | ' || LOWER(TRIM(group_name)) AS key, COUNT(*) AS n, NULL AS s FROM change_records WHERE group_name IS NOT NULL AND TRIM(group_name) <> '' GROUP BY 1",
  },
  assets: {
    label: 'AssetExplorer assets (assets) — count per site, sum of purchase cost (raw source currency, no conversion)',
    columns: ['Site', 'Purchase Cost($)'],
    key: (r) => { const s = norm(r.Site); return s || null; },
    sum: (r) => num(r['Purchase Cost($)']),
    sql: "SELECT LOWER(TRIM(site)) AS key, COUNT(*) AS n, SUM(CASE WHEN TRIM(COALESCE(purchase_cost,'')) ~ '^[0-9][0-9,]*(\\.[0-9]+)?$' THEN CAST(REPLACE(purchase_cost, ',', '') AS NUMERIC) END) AS s FROM assets WHERE site IS NOT NULL AND TRIM(site) <> '' GROUP BY 1",
  },
  meraki_wan: {
    label: 'Meraki WAN weekly snapshots (wan_link_snapshots) — count of weekly rows per network × uplink, sum of % Time Up (compare to the Meraki Summary Report)',
    columns: ['Network', 'Uplink', '% Time Up'],
    key: (r) => { const n = norm(r.Network); const u = norm(r.Uplink); return n && u ? `${n} | ${u}` : null; },
    sum: (r) => num(r['% Time Up']),
    // site name stands in for the Meraki network name: the operator maps them in the export (site_module_codes module=meraki)
    sql: "SELECT LOWER(TRIM(COALESCE(c.code, s.name))) || ' | ' || LOWER(w.uplink) AS key, COUNT(*) AS n, SUM(w.availability_pct) AS s FROM wan_link_snapshots w JOIN sites s ON s.id = w.site_id LEFT JOIN site_module_codes c ON c.site_id = w.site_id AND c.module = 'meraki' WHERE w.period_type = 'week' AND COALESCE(w.sub_site,'') = '' GROUP BY 1",
  },
};

/** Pure: compare the export groups with the stored groups. tolerance = allowed |Δ count| (and |Δ sum| as a fraction). */
function compare(exportRows, dbRows, spec, { tolerance = 0, sumTolerancePct = 0.5 } = {}) {
  const src = new Map(); let unreadable = 0;
  for (const r of exportRows || []) {
    const k = spec.key(r); if (!k) { unreadable++; continue; }
    const g = src.get(k) || { n: 0, s: null }; g.n++; const v = spec.sum(r); if (v != null) g.s = (g.s == null ? 0 : g.s) + v; src.set(k, g);
  }
  const db = new Map((dbRows || []).map((r) => [String(r.key), { n: Number(r.n), s: r.s == null ? null : Number(r.s) }]));
  const keys = [...new Set([...src.keys(), ...db.keys()])].sort();
  const rows = keys.map((k) => {
    const a = src.get(k) || null, b = db.get(k) || null;
    const dn = a && b ? b.n - a.n : null;
    const ds = a && b && a.s != null && b.s != null ? Math.round((b.s - a.s) * 100) / 100 : null;
    let status = 'match';
    if (!a) status = 'only_in_sdp360'; else if (!b) status = 'missing_in_sdp360';
    else if (Math.abs(dn) > tolerance) status = 'count_differs';
    else if (ds != null && Math.abs(ds) > Math.abs(a.s) * sumTolerancePct / 100) status = 'sum_differs';
    else if ((a.s == null) !== (b.s == null)) status = 'sum_unknown_one_side';
    return { key: k, source_count: a ? a.n : null, sdp360_count: b ? b.n : null, delta_count: dn, source_sum: a ? a.s : null, sdp360_sum: b ? b.s : null, delta_sum: ds, status };
  });
  const totals = { groups: rows.length, match: rows.filter((r) => r.status === 'match').length, source_rows: (exportRows || []).length, unreadable_export_rows: unreadable,
    source_count: rows.reduce((t, r) => t + (r.source_count || 0), 0), sdp360_count: rows.reduce((t, r) => t + (r.sdp360_count || 0), 0) };
  return { rows, totals, verdict: rows.every((r) => r.status === 'match') && !unreadable ? 'RECONCILED' : 'DIFFERENCES — owner review' };
}

function parseCsv(text) {
  const out = []; let row = [], cell = '', q = false;
  const t = String(text).replace(/^﻿/, '');
  for (let i = 0; i < t.length; i++) { const c = t[i];
    if (q) { if (c === '"' && t[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell.replace(/\r$/, '')); out.push(row); row = []; cell = ''; } else cell += c; }
  if (cell !== '' || row.length) { row.push(cell.replace(/\r$/, '')); out.push(row); }
  const head = (out.shift() || []).map((h) => h.trim());
  return out.filter((r) => r.some((x) => x !== '')).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const csvCell = (v) => { const s = require('../../public/lib/csvSafe').neutralize(v == null ? '' : String(v)); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
function sheet(result) {
  const head = ['key', 'source_count', 'sdp360_count', 'delta_count', 'source_sum', 'sdp360_sum', 'delta_sum', 'status'];
  return '﻿' + [head, ...result.rows.map((r) => head.map((h) => r[h]))].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

async function main(argv) {
  const arg = (k) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
  if (argv.includes('--list')) { for (const [k, s] of Object.entries(SOURCES)) console.log(`${k}: ${s.label}\n  export columns: ${s.columns.join(', ')}`); return 0; }
  const spec = SOURCES[arg('source')]; if (!spec) { console.error('--source= one of ' + Object.keys(SOURCES).join(', ')); return 2; }
  const file = arg('export'); if (!file || !fs.existsSync(file)) { console.error('--export=<the owner\'s source export, CSV>'); return 2; }
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  const missing = spec.columns.filter((c) => rows.length && !(c in rows[0]));
  if (missing.length) { console.error(`export is missing column(s): ${missing.join(', ')}`); return 2; }
  if (!process.env.PG_URL) { console.error('PG_URL is required (the operator\'s database, read-only use)'); return 2; }
  const { Client } = require('pg'); const c = new Client({ connectionString: process.env.PG_URL });
  await c.connect();
  let db; try { await c.query('SET TRANSACTION READ ONLY').catch(() => {}); db = (await c.query(spec.sql)).rows; } finally { await c.end(); }
  const r = compare(rows, db, spec, { tolerance: Number(arg('tolerance') || 0) });
  const out = arg('out'); if (out) fs.writeFileSync(path.resolve(out), sheet(r));
  console.log(JSON.stringify({ source: arg('source'), verdict: r.verdict, totals: r.totals, sheet: out || '(use --out= to write the comparison sheet)' }, null, 1));
  return r.verdict === 'RECONCILED' ? 0 : 1;
}

if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(2); });
module.exports = { SOURCES, compare, monthOf, parseCsv, sheet, main };
