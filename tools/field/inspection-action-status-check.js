'use strict';
// P11 r2 F-5 — READ-ONLY check of stored inspection corrective-action statuses. Before the fix the field app could
// store 'demand', 'helpdesk_ticket' or a lowercase 'cancelled' on an inspection action. Since the fix every write path
// refuses them and the open / overdue counts compare case-insensitively, but rows written earlier stay as they are.
// This tool LISTS them (id, inspection, site, status, the canonical status it maps to, or "needs a decision") and
// writes NOTHING: a demand / helpdesk_ticket row has no inspection equivalent, so its owner decides (close or cancel
// it in the Inspection Actions register, which records the change in the audit thread).
//
//   node tools/field/inspection-action-status-check.js          # human-readable list + counts
//   node tools/field/inspection-action-status-check.js --json   # machine-readable
const path = require('path');
if (require.main === module) require('dotenv').config({ quiet: true, path: path.join(__dirname, '..', '..', '.env') });

function classify(rows, normalize) {
  const out = [];
  for (const r of rows || []) {
    const canon = normalize(r.status);
    if (canon === r.status) continue;                          // already canonical
    out.push({ id: r.id, inspection_id: r.inspection_id, site_code: r.site_code, status: r.status,
      maps_to: canon || null, needs_decision: !canon });
  }
  return out;
}

async function run(argv, { db, normalize, log = console.log } = {}) {
  const rows = await db.prepare(`SELECT a.id, a.inspection_id, i.site_code, a.status
      FROM insp_actions a JOIN insp_inspections i ON i.id = a.inspection_id
     WHERE i.deleted_at IS NULL AND a.status IS NOT NULL
       AND a.status NOT IN ('Open','In Progress','Closed','Cancelled') ORDER BY a.id`).all();
  const bad = classify(rows, normalize);
  if (argv.includes('--json')) log(JSON.stringify({ count: bad.length, rows: bad }));
  else {
    log(`[insp-action-status] DRY RUN (read-only) — ${bad.length} action(s) outside Open / In Progress / Closed / Cancelled`);
    for (const b of bad) log(`  #${b.id} ${b.inspection_id} ${b.site_code} "${b.status}" → ${b.maps_to || 'needs a decision (close or cancel it in the register)'}`);
  }
  return { count: bad.length, rows: bad };
}

module.exports = { run, classify };

if (require.main === module) {
  (async () => {
    const idb = require('../../inspection-db');
    if (idb.initPgInspection) await idb.initPgInspection();
    await run(process.argv.slice(2), { db: idb.pgHandle ? idb.pgHandle() : idb.getDB(), normalize: idb.normalizeActionStatus });
    process.exit(0);
  })().catch((e) => { console.error('[insp-action-status] failed:', e.message); process.exit(1); });
}
