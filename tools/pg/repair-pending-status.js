'use strict';
// One-time data repair (2026-08-03): after the PG cutover, request_records.pending_status
// was left at 1 (open) for legacy CLOSED tickets, so the ageing chart counted ~6000
// closed tickets as open >60d. This recomputes pending_status from the authoritative
// Request Status for those rows. See CLAUDE.md 2026-08-03 + tests/pending-status-derivation.
//
// Run ON THE PROD SERVER from C:\Apps\SDP-Dashboard (where `pg` + `.env` live):
//     node tools\pg\repair-pending-status.js            (DRY RUN — just reports the count)
//     node tools\pg\repair-pending-status.js --apply     (performs the UPDATE, in a tx)
//
// Reads PG_URL from the environment or from the app's .env. Touches ONLY request_records,
// ONLY rows that are marked open (pending_status=1) but whose status is terminal.
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

const CLOSED = ['closed', 'resolved', 'confirmed resolution', 'confirm resolution', 'cancelled'];
const APPLY = process.argv.includes('--apply');

// PG_URL from env, else parse it out of ./.env (no dotenv dependency).
function pgUrl() {
  if (process.env.PG_URL) return process.env.PG_URL;
  try {
    const envPath = path.join(__dirname, '..', '..', '.env');
    const line = fs.readFileSync(envPath, 'utf8').split(/\r?\n/).find(l => /^\s*PG_URL\s*=/.test(l));
    if (line) return line.replace(/^\s*PG_URL\s*=\s*/, '').replace(/^["']|["']$/g, '').trim();
  } catch (_) { /* fall through */ }
  return null;
}

const WHERE = `pending_status = 1
  AND lower(trim(coalesce(request_status,''))) IN (${CLOSED.map((_, i) => '$' + (i + 1)).join(', ')})`;

(async () => {
  const url = pgUrl();
  if (!url) { console.error('✖ PG_URL not found (env or .env). Aborting.'); process.exit(1); }
  const c = new Client({ connectionString: url });
  await c.connect();
  try {
    const before = (await c.query(`SELECT COUNT(*)::int AS n FROM request_records WHERE ${WHERE}`, CLOSED)).rows[0].n;
    console.log(`Rows marked open (pending_status=1) but CLOSED by status: ${before}`);
    if (before === 0) { console.log('✓ Nothing to repair.'); return; }
    if (!APPLY) {
      console.log('\nDRY RUN — no changes made. Re-run with  --apply  to fix them:');
      console.log('  node tools\\pg\\repair-pending-status.js --apply');
      return;
    }
    await c.query('BEGIN');
    const res = await c.query(`UPDATE request_records SET pending_status = 0 WHERE ${WHERE}`, CLOSED);
    await c.query('COMMIT');
    const after = (await c.query(`SELECT COUNT(*)::int AS n FROM request_records WHERE ${WHERE}`, CLOSED)).rows[0].n;
    console.log(`✓ Repaired ${res.rowCount} row(s). Remaining corrupt: ${after} (should be 0).`);
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) {}
    console.error('✖ Repair failed (rolled back):', e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
