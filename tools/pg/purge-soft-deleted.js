'use strict';
// A-19 — dry-run-first CLI for the soft-delete purge (the same code the softdelete.purge job runs).
//
//   node tools/pg/purge-soft-deleted.js                 # lists what WOULD be purged (default, writes nothing)
//   node tools/pg/purge-soft-deleted.js --apply         # hard-deletes rows stamped deleted longer than the retention
//   node tools/pg/purge-soft-deleted.js --days=45       # override soft_delete_retention_days for this run
//   node tools/pg/purge-soft-deleted.js --module=inspection
//
// The owner reviews the dry-run output on production BEFORE setting soft_delete_purge_enabled = '1'.
// --apply is a manual act and works even while the job is disarmed (it is the operator's decision).
//
// .env FIRST: every *-db module picks its connection at require time.
const path = require('path');
if (require.main === module) require('dotenv').config({ quiet: true, path: path.join(__dirname, '..', '..', '.env') });

function parseArgs(argv) {
  const out = { apply: false, days: null, module: null };
  for (const a of argv) {
    if (a === '--apply') out.apply = true;
    else if (a.startsWith('--days=')) out.days = Number(a.slice(7));
    else if (a.startsWith('--module=')) out.module = a.slice(9);
    else throw new Error(`unknown argument: ${a}`);
  }
  if (out.days != null && !(Number.isFinite(out.days) && out.days > 0)) throw new Error('--days must be a positive number');
  return out;
}

/** Runs the purge; returns the summary. deps lets tests inject cfg / ops. */
async function run(argv, deps = {}) {
  const args = parseArgs(argv);
  const softDelete = require('../../services/softDelete');
  const ops = deps.ops || require('../../services/softDeleteOps');
  const cfg = { ...(deps.cfg || await softDelete.readConfig(deps.rdb || require('../../reports-db'))) };
  if (args.days != null) cfg.soft_delete_retention_days = String(args.days);
  const out = await ops.purge({ apply: args.apply, cfg, modules: args.module ? [args.module] : null });
  if (args.apply) {
    const rdb = deps.rdb || require('../../reports-db');
    for (const [mod, r] of Object.entries(out.modules)) if (r.purged > 0) rdb.logEvent({ category: mod, action: `${mod}_purged`, actor: 'purge-soft-deleted CLI', target: 'cli', details: { purged: r.purged, cutoff: out.cutoff, retention_days: out.retention_days } });
  }
  return out;
}

function format(out) {
  const lines = [`${out.apply ? 'APPLY' : 'DRY RUN'} — retention ${out.retention_days} days, cut-off ${out.cutoff}`];
  for (const [mod, r] of Object.entries(out.modules)) {
    const ids = Array.isArray(r.ids) ? r.ids : [];
    lines.push(`  ${mod}: ${ids.length} row(s) past retention${out.apply ? `, ${r.purged} purged` : ''}${ids.length ? ' — ' + ids.slice(0, 50).join(', ') + (ids.length > 50 ? ' …' : '') : ''}`);
    for (const sk of (r.skipped || [])) lines.push(`    skipped ${sk.id}: ${sk.reason}`);
  }
  if (!out.apply) lines.push('Nothing was deleted. Re-run with --apply to purge.');
  return lines.join('\n');
}

if (require.main === module) {
  (async () => {
    try {
      if (!process.env.PG_URL) throw new Error('PG_URL is not set (.env)');
      await require('../../reports-db').initPgReports();
      await require('../../meetings-db').initPgMeetings();
      await require('../../inspection-db').initPgInspection();
      console.log(format(await run(process.argv.slice(2))));
      process.exit(0);
    } catch (e) { console.error('[purge-soft-deleted]', e.message); process.exit(1); }
  })();
}

module.exports = { parseArgs, run, format };
