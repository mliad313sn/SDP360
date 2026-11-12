'use strict';
// A-05 — repair the meetings status vocabulary: md_actions.status / md_issues.status 'closed'
// (any case, any surrounding spaces) → 'resolved'. 'closed' was never a seeded md_statuses code:
// the field app sent it for meetings actions until field-v3, and the editors then showed such a
// row as "Open" (first option), one unrelated edit away from silently reopening it. The server
// now normalises at the door (statusTransfer.normalizeMeetingStatus); this tool fixes the rows
// written BEFORE that.
//
//   node tools/pg/normalize-action-status.js                     → dry run: counts + up to 50 samples
//   node tools/pg/normalize-action-status.js --apply             → one transaction, backup FIRST
//   node tools/pg/normalize-action-status.js --restore=<file>    → put the original codes back
//
// Rules: only rows whose lower(trim(status)) = 'closed' are touched; closed_at is kept (filled
// from updated_at when it was empty — the row IS done); one md_action_updates / md_issue_updates
// audit row per changed row; history rows (status_change 'closed') are NEVER rewritten.
// Backup: <SDP_DATA_DIR or data>/status-backups/normalize-action-status_<stamp>.json
// Reads PG_URL from the environment (or .env in the app root).
const path = require('path');
const fs = require('fs');
if (require.main === module) require('dotenv').config({ quiet: true, path: path.join(__dirname, '..', '..', '.env') });
const { Client } = require('pg');

const BODY = 'Status code normalised closed→resolved (tools/pg/normalize-action-status.js)';
const AUTHOR = 'normalize-action-status';
const TABLES = [
  { table: 'md_actions', audit: 'md_action_updates', fk: 'action_id', label: 'description' },
  { table: 'md_issues',  audit: 'md_issue_updates',  fk: 'issue_id',  label: 'title' },
];
const IS_CLOSED = `lower(trim(x.status)) = 'closed'`;

function defaultBackupDir() {
  return path.join(process.env.SDP_DATA_DIR || path.join(__dirname, '..', '..', 'data'), 'status-backups');
}

async function _scan(c, log) {
  const counts = {}, rows = {};
  for (const t of TABLES) {
    const r = await c.query(`
      SELECT x.id, x.status, x.closed_at, m.reference, m.site_code
      FROM ${t.table} x LEFT JOIN md_meetings m ON m.id = x.meeting_id
      WHERE ${IS_CLOSED} ORDER BY x.id`);
    counts[t.table] = r.rows.length;
    rows[t.table] = r.rows;
    log(`${t.table.padEnd(10)} ${r.rows.length} row(s) with status 'closed'`);
    for (const s of r.rows.slice(0, 50)) {
      log(`  #${s.id}  ${s.reference || '—'}  ${s.site_code || '—'}  status=${JSON.stringify(s.status)}  closed_at=${s.closed_at || '—'}`);
    }
    if (r.rows.length > 50) log(`  … and ${r.rows.length - 50} more`);
  }
  return { counts, rows };
}

async function _apply(c, rows, backupDir, log) {
  const backup = { tool: 'normalize-action-status', created_at: new Date().toISOString(), rows: [] };
  for (const t of TABLES) for (const r of rows[t.table]) backup.rows.push({ table: t.table, id: r.id, old_status: r.status, old_closed_at: r.closed_at });
  if (!backup.rows.length) { log('Nothing to change.'); return { changed: 0, backupFile: null }; }
  fs.mkdirSync(backupDir, { recursive: true });
  const backupFile = path.join(backupDir, `normalize-action-status_${backup.created_at.replace(/[:.]/g, '-')}.json`);
  fs.writeFileSync(backupFile, JSON.stringify(backup, null, 2));   // BEFORE any update
  log(`Backup written: ${backupFile}`);
  let changed = 0;
  await c.query('BEGIN');
  try {
    for (const t of TABLES) {
      const u = await c.query(`
        UPDATE ${t.table} x
           SET status = 'resolved',
               closed_at = COALESCE(NULLIF(x.closed_at, ''),
                                    to_char(COALESCE(x.updated_at, now()), 'YYYY-MM-DD HH24:MI:SS'))
         WHERE ${IS_CLOSED}
         RETURNING x.id`);
      for (const r of u.rows) {
        await c.query(`INSERT INTO ${t.audit} (${t.fk}, author_name, body, status_change) VALUES ($1, $2, $3, 'resolved')`, [r.id, AUTHOR, BODY]);
      }
      changed += u.rowCount;
    }
    await c.query('COMMIT');
  } catch (e) { try { await c.query('ROLLBACK'); } catch {} throw e; }
  log(`Changed ${changed} row(s). Rollback: --restore=${backupFile}`);
  return { changed, backupFile };
}

async function _restore(c, file, log) {
  const bk = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!bk || !Array.isArray(bk.rows)) throw new Error('not a normalize-action-status backup: ' + file);
  const allowed = new Set(TABLES.map(t => t.table));
  let restored = 0;
  await c.query('BEGIN');
  try {
    for (const r of bk.rows) {
      if (!allowed.has(r.table)) throw new Error('unexpected table in backup: ' + r.table);
      // Only rows still sitting on the value this tool wrote — a row edited since is left alone.
      const u = await c.query(`UPDATE ${r.table} SET status = $1, closed_at = $2 WHERE id = $3 AND status = 'resolved'`, [r.old_status, r.old_closed_at, r.id]);
      restored += u.rowCount;
    }
    await c.query('COMMIT');
  } catch (e) { try { await c.query('ROLLBACK'); } catch {} throw e; }
  log(`Restored ${restored} of ${bk.rows.length} row(s) from ${file} (audit rows kept as history).`);
  return restored;
}

async function run(opts = {}) {
  const log = (opts.log || console.log).bind(opts.log ? opts : console);
  const url = opts.url || process.env.PG_URL;
  if (!url) throw new Error('PG_URL not set');
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    if (opts.restore) return { restored: await _restore(c, opts.restore, log) };
    const { counts, rows } = await _scan(c, log);
    if (!opts.apply) {
      log('Dry run — nothing changed. Re-run with --apply (after a restore point) to rewrite these rows.');
      return { applied: false, counts, changed: 0 };
    }
    const r = await _apply(c, rows, opts.backupDir || defaultBackupDir(), log);
    return { applied: true, counts, ...r };
  } finally { await c.end(); }
}

module.exports = { run, BODY };

if (require.main === module) {
  const argv = process.argv.slice(2);
  const rest = argv.find(a => a.startsWith('--restore='));
  run({ apply: argv.includes('--apply'), restore: rest ? rest.slice('--restore='.length) : null })
    .then(() => process.exit(0))
    .catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}
