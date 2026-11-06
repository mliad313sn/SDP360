'use strict';
// E-F01 — field outbox admin CLI. Same store functions as GET/POST /api/field/admin/outbox.
// DRY RUN by default: it lists unresolved entries and, for a resolution, says what WOULD change; nothing is
// written without --apply. A resolution never applies an entry server-side — mark_rejected ends it,
// release (applying → failed) lets the phone's next send apply it exactly once. A ticket / action is
// released only with --confirm-checked-sdp and a reason of at least 10 characters (check SDP / the module first).
//
//   node tools/field/outbox-admin.js                          # list received / applying / failed + counts
//   node tools/field/outbox-admin.js --status=applying --older-than-min=15 --kind=inspection
//   node tools/field/outbox-admin.js --resolve=<uuid> --action=release --reason="..." [--confirm-checked-sdp] [--apply]
//
// The --apply path also honours report_config field_outbox_resolve_enabled (refused while '0', like the route).
const path = require('path');
if (require.main === module) require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

function parseArgs(argv) {
  const o = {};
  for (const a of argv) { if (!a.startsWith('--')) continue; const eq = a.indexOf('='); if (eq < 0) o[a.slice(2)] = true; else o[a.slice(2, eq)] = a.slice(eq + 1); }
  return o;
}

async function run(argv, { store, loadConfig, logEvent = null, log = console.log, actor = 'cli' } = {}) {
  const a = parseArgs(argv);
  if (!a.resolve) {
    const items = await store.listUnresolved({ status: a.status || null, kind: a.kind || null, since: a.since || null, olderThanMin: a['older-than-min'] || 0 });
    log(`[field-outbox] counts: ${JSON.stringify(await store.outboxStats({ since: a.since || null }))}`);
    for (const it of items) log(`  ${it.uuid} ${it.kind} user=${it.user_id} ${it.status} age=${it.age_min}min${it.applying_for_min != null ? ` applying=${it.applying_for_min}min` : ''}${it.outcome_unknown ? ' OUTCOME-UNKNOWN' : ''}${it.error ? ' · ' + it.error : ''}`);
    return { listed: items.length, items };
  }
  const plan = { uuid: String(a.resolve), action: a.action, reason: typeof a.reason === 'string' ? a.reason : '', confirmCheckedSdp: a['confirm-checked-sdp'] === true, actor };
  const row = await store.getOutbox(plan.uuid);
  if (!row) { log(`[field-outbox] ${plan.uuid}: not found`); return { applied: false, error: 'not_found' }; }
  if (!a.apply) {
    log(`[field-outbox] DRY RUN — would ${plan.action} ${plan.uuid} (${row.kind}, ${row.status}). Re-run with --apply.`);
    return { applied: false, dry_run: true, row: { uuid: row.uuid, kind: row.kind, status: row.status } };
  }
  const cfg = await loadConfig();
  if (String(cfg.field_outbox_resolve_enabled) !== '1') { log('[field-outbox] refused: field_outbox_resolve_enabled is not 1'); return { applied: false, error: 'disabled' }; }
  const out = await store.resolve(plan.uuid, plan);
  if (logEvent) await logEvent({ category: 'field', action: 'field_outbox_resolved', actor, target: out.uuid, risk: 1, details: { resolution: plan.action, reason: plan.reason.trim().slice(0, 500), kind: out.kind, entry_user_id: out.user_id, from: out.from, to: out.to, confirm_checked_sdp: plan.confirmCheckedSdp, via: 'cli' } });
  log(`[field-outbox] ${out.uuid}: ${out.from} → ${out.to}`);
  return { applied: true, ...out };
}

module.exports = { run, parseArgs };

if (require.main === module) {
  (async () => {
    const rdb = require('../../reports-db'); await rdb.initPgReports();
    const store = require('../../services/fieldStore').makeFieldStore({ prepare: (sql) => rdb.pgHandle().prepare(sql) }, { isPg: true });
    const actor = process.env.USERNAME || process.env.USER || 'cli';
    try { await run(process.argv.slice(2), { store, loadConfig: () => require('../../services/reportConfig').getConfig(rdb.db), logEvent: (e) => rdb.logEvent(e), actor }); process.exit(0); }
    catch (e) { console.error('[field-outbox] ' + e.message); process.exit(1); }
  })();
}
