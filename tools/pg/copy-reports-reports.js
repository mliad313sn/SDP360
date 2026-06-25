'use strict';
// One-shot copy of reports.db's REPORT-EDITOR tables → PostgreSQL (Sub-chunk 4C).
// FK order: weeks → weekly_reports → {infra_kpis, helpdesk_data, lights, action_items}
// → monthly_reports, annual_objectives, site_module_codes, infra_kpi_catalog.
// (sites handled by copy-reports-auth.) Idempotent upsert; advances the 9 IDENTITY
// sequences. Applies 001+002+003 schemas first. Model: copy-reports-config.js.
const fs   = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const SCHEMA1 = fs.readFileSync(path.join(__dirname, '../../db/postgres/reports/001_auth.sql'), 'utf8');
const SCHEMA2 = fs.readFileSync(path.join(__dirname, '../../db/postgres/reports/002_config.sql'), 'utf8');
const SCHEMA3 = fs.readFileSync(path.join(__dirname, '../../db/postgres/reports/003_reports.sql'), 'utf8');

// cols mirror the live sqlite report-editor schema (incl. ALTER-added cols).
const TABLES = [
  ['weeks',             ['id', 'year', 'week_number', 'start_date', 'end_date', 'label'], ['id']],
  ['weekly_reports',    ['id', 'site_id', 'week_id', 'status', 'submitted_at', 'submitted_by', 'created_by', 'created_at', 'updated_at'], ['id']],
  ['infra_kpis',        ['id', 'report_id', 'service', 'kpi', 'target', 'status_value', 'status_color', 'trend', 'sort_order'], ['id']],
  ['helpdesk_data',     ['id', 'report_id', 'time_to_assign', 'time_to_assign_prev', 'first_reply', 'first_reply_prev',
                         'resolution_time', 'resolution_time_prev', 'closing_time', 'closing_time_prev',
                         'comments_metrics', 'comments_sla', 'tech_on_break', 'techs_on_duty', 'sla_violations',
                         'group_metrics', 'all_groups', 'selected_group', 'chart_data', 'fetched_at', 'updated_at'], ['id']],
  ['lights',            ['id', 'report_id', 'type', 'content', 'sort_order'], ['id']],
  ['action_items',      ['id', 'report_id', 'task', 'priority', 'due_date', 'owner', 'status', 'sort_order', 'department', 'comment'], ['id']],
  ['monthly_reports',   ['id', 'site_id', 'year', 'month', 'edited_lights', 'edited_actions', 'notes', 'status', 'updated_at'], ['id']],
  ['annual_objectives', ['id', 'site_id', 'year', 'objective', 'target', 'status', 'sort_order', 'updated_at'], ['id']],
  ['site_module_codes', ['site_id', 'module', 'code', 'updated_at'], ['site_id', 'module']],
  ['infra_kpi_catalog', ['id', 'service', 'kpi', 'target_default', 'display_order', 'active', 'created_at'], ['id']],
];
// IDENTITY tables whose sequences must advance past copied ids (NOT site_module_codes).
const IDENTITY_TABLES = ['weeks', 'weekly_reports', 'infra_kpis', 'helpdesk_data', 'lights',
  'action_items', 'monthly_reports', 'annual_objectives', 'infra_kpi_catalog'];

function _upsertSql(table, cols, pk) {
  const ph = cols.map(() => '?').join(', ');
  const setCols = cols.filter(c => !pk.includes(c));
  const conflict = setCols.length
    ? `ON CONFLICT (${pk.join(',')}) DO UPDATE SET ${setCols.map(c => `${c}=EXCLUDED.${c}`).join(', ')}`
    : `ON CONFLICT (${pk.join(',')}) DO NOTHING`;
  return `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph}) ${conflict}`;
}

async function copyReportsReports(sqlitePath, pg) {
  const sdb = new Database(sqlitePath, { readonly: true, fileMustExist: true });
  const counts = {};
  try {
    await pg.exec(SCHEMA1);
    await pg.exec(SCHEMA2);
    await pg.exec(SCHEMA3);
    await pg.runTransaction(async () => {
      for (const [table, cols, pk] of TABLES) {
        let rows = [];
        try { rows = sdb.prepare(`SELECT ${cols.join(', ')} FROM ${table}`).all(); }
        catch (_) { rows = []; }
        const ins = pg.prepare(_upsertSql(table, cols, pk));
        for (const r of rows) await ins.run(...cols.map(c => r[c]));
        counts[table] = rows.length;
      }
      for (const t of IDENTITY_TABLES) {
        await pg.exec(`SELECT setval(pg_get_serial_sequence('${t}','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM ${t}), 1))`);
      }
    });
  } finally { sdb.close(); }
  return counts;
}

module.exports = { copyReportsReports, _upsertSql, TABLES, IDENTITY_TABLES };

if (require.main === module) {
  (async () => {
    const { makePgDb } = require('../../services/pgDb');
    const url = process.env.PG_URL || process.env.DATABASE_URL;
    if (!url) { console.error('Set PG_URL or DATABASE_URL'); process.exit(2); }
    const src = process.argv[2] || path.join(__dirname, '../../data/reports.db');
    if (!fs.existsSync(src)) { console.error('reports.db not found at ' + src); process.exit(2); }
    const pg = makePgDb(url); await pg.connect();
    try { console.log('[copy-reports-reports] copied', JSON.stringify(await copyReportsReports(src, pg))); }
    finally { await pg.close(); }
  })().catch(e => { console.error(e); process.exit(1); });
}
