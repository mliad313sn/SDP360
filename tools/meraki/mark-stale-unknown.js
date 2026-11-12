'use strict';
// A-25 — label the HISTORIC stale-closed WAN outages "unknown" (pending review).
//
//   node tools/meraki/mark-stale-unknown.js                 # SIMULATION — lists the rows, writes nothing
//   node tools/meraki/mark-stale-unknown.js --apply         # writes a JSON backup of the keys, then labels them
//   node tools/meraki/mark-stale-unknown.js --restore=data/wan-stale-backups/stale-unknown-<stamp>.json
//
// Who: wan_outages rows with source = 'stale_open' AND attribution IS NULL — closed by the
// poller's 24 h stale-open guard before it started labelling them. The SLA engine already
// excludes them from credits (it counts attribution 'isp' only); the label makes the exclusion
// visible as pending_review on /api/analytics/wan/sla/summary. Nothing else changes: no
// timestamp, duration or source is touched, and a row a human has since attributed is never
// overwritten (each UPDATE is guarded on the attribution it expects).
// Run --apply in production only after a pg_dump restore point (owner step, never the agent).
//
// .env FIRST: only server.js loads dotenv; a standalone run needs PG_URL.
const path = require('path');
const fs = require('fs');
if (require.main === module) require('dotenv').config({ quiet: true, path: path.join(__dirname, '..', '..', '.env') });

const LABEL = 'unknown';
const REASON = 'stale_open — not reviewed';

async function main(opts = {}) {
  const rdb = opts.rdb || require('../../reports-db');
  const log = opts.log || console.log;
  const backupDir = opts.backupDir || path.join(__dirname, '..', '..', 'data', 'wan-stale-backups');

  if (opts.restore) {
    const keys = JSON.parse(fs.readFileSync(opts.restore, 'utf8')).keys || [];
    let restored = 0;
    for (const k of keys) restored += await rdb.setWanOutageAttribution(k, null, null, LABEL);
    log(`[mark-stale-unknown] restored ${restored}/${keys.length} row(s) to attribution NULL from ${opts.restore}`);
    return { restore: true, restored, total: keys.length };
  }

  const rows = (await rdb.listUnlabelledStaleOutages()) || [];
  for (const r of rows) log(`  site_id=${r.site_id} sub_site=${r.sub_site || ''} uplink=${r.uplink} detected_start=${r.detected_start}`);
  if (!opts.apply) {
    log(`[mark-stale-unknown] SIMULATION — ${rows.length} stale_open row(s) with no attribution would be labelled "${LABEL}". Re-run with --apply.`);
    return { apply: false, candidates: rows.length };
  }
  fs.mkdirSync(backupDir, { recursive: true });
  const backup = path.join(backupDir, `stale-unknown-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  const keys = rows.map(r => ({ site_id: r.site_id, sub_site: r.sub_site || '', uplink: r.uplink, detected_start: r.detected_start }));
  fs.writeFileSync(backup, JSON.stringify({ written_at: new Date().toISOString(), label: LABEL, keys }, null, 2));
  let updated = 0;
  for (const k of keys) updated += await rdb.setWanOutageAttribution(k, LABEL, REASON, null);
  log(`[mark-stale-unknown] labelled ${updated}/${keys.length} row(s) "${LABEL}". Backup: ${backup} (undo with --restore=<file>)`);
  return { apply: true, candidates: rows.length, updated, backup };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const restoreArg = args.find(a => a.startsWith('--restore='));
  (async () => {
    if (!process.env.PG_URL) { console.error('PG_URL missing from .env — cannot read wan_outages.'); return 1; }
    const rdb = require('../../reports-db');
    await rdb.initPgReports();
    await main({ rdb, apply: args.includes('--apply'), restore: restoreArg ? restoreArg.slice('--restore='.length) : null });
    return 0;
  })().then(c => process.exit(c)).catch(e => { console.error('[mark-stale-unknown] fatal:', e.message); process.exit(1); });
}

module.exports = { main, LABEL, REASON };
