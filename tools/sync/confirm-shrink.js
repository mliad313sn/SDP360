'use strict';
// P11 r3 F-14 / N-02r — operator confirmation of a GENUINE shrink of a synced table.
// The truncation guard never lowers its anchor (the last count the source confirmed) on its own: a count below it is
// only recorded as `pending`. When the source really lost rows (purge, archive) and the sync is refused or kept
// below the anchor, the operator confirms the new size here. Dry run by default; --apply writes ONE row of
// sync_truncation_anchors (nothing else). Never run it to "unblock" a sync without checking the source first.
//
//   node tools/sync/confirm-shrink.js --list
//   node tools/sync/confirm-shrink.js --job=requests [--count=N] [--apply]
//     --count defaults to the pending count the guard recorded; PG_URL = the operator's database.
const path = require('path');
const { confirmShrink } = require('../../services/sync/truncationGuard');

async function main(argv, { log = console.log, err = console.error } = {}) {
  const arg = (k) => { const a = argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.slice(k.length + 3) : null; };
  if (!process.env.PG_URL) { try { require('dotenv').config({ quiet: true, path: path.join(__dirname, '..', '..', '.env') }); } catch (_) {} }
  if (!process.env.PG_URL) { err('PG_URL is required'); return 2; }
  const { Client } = require('pg'); const c = new Client({ connectionString: process.env.PG_URL });
  await c.connect();
  try {
    if (argv.includes('--list')) {
      const rows = (await c.query('SELECT guard_key, anchor_count, pending_count, pending_agree, updated_at FROM sync_truncation_anchors ORDER BY guard_key')).rows;
      for (const r of rows) log(`${r.guard_key}: anchor ${r.anchor_count}${r.pending_count == null ? '' : `, pending ${r.pending_count} (seen ${r.pending_agree}×)`} — ${r.updated_at}`);
      return 0;
    }
    const job = arg('job'); if (!job) { err('--job=<guard key> (see --list)'); return 2; }
    const countArg = arg('count');
    if (countArg != null && !/^\d+$/.test(countArg)) { err('--count must be a non-negative integer'); return 2; }
    const row = (await c.query('SELECT anchor_count, pending_count, pending_agree FROM sync_truncation_anchors WHERE guard_key = $1', [job])).rows[0];
    if (!row) { err(`no anchor recorded for ${job}`); return 2; }
    const prev = { anchor: Number(row.anchor_count), pending: row.pending_count == null ? null : Number(row.pending_count), agree: Number(row.pending_agree) || 0 };
    let next; try { next = confirmShrink(prev, countArg == null ? null : Number(countArg)); } catch (e) { err(e.message); return 2; }
    log(`${job}: anchor ${prev.anchor} → ${next.anchor}${argv.includes('--apply') ? '' : '  (dry run — add --apply to write)'}`);
    if (!argv.includes('--apply')) return 0;
    await c.query('UPDATE sync_truncation_anchors SET anchor_count = $2, pending_count = NULL, pending_agree = 0, updated_at = $3 WHERE guard_key = $1',
      [job, next.anchor, new Date().toISOString()]);
    return 0;
  } finally { await c.end(); }
}

if (require.main === module) main(process.argv.slice(2)).then((code) => process.exit(code), (e) => { console.error(e.message); process.exit(2); });
module.exports = { main };
