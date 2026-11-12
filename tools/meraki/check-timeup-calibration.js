'use strict';
// Standalone runs must read the app's .env BEFORE any *-db module loads (backend + PG_URL are
// picked at require time). In-process calls and tests skip this.
if (require.main === module) require('dotenv').config({ quiet: true, path: require('path').join(__dirname, '..', '..', '.env') });
// A-18b — WAN "% Time Up" calibration check (owner-run).
//
// The "% Time Up" of WAN Health counts a Meraki loss sample as DOWN when its loss is ≥
// wan_timeup_loss_pct. The default '100' is the plain loss<100 rule; the 2026-09-04 calibration
// against Meraki's Summary Report says 5 (tools/meraki/calibration/2026-09-04-timeup-calibration-result.md).
// The default is deliberately NOT changed in code (that would silently move production figures
// wherever the key was never saved); this tool shows where an instance stands and, only on
// request, stores the value.
//
//   node tools/meraki/check-timeup-calibration.js             # dry-run: prints stored/effective/calibrated
//   node tools/meraki/check-timeup-calibration.js --apply=5   # stores wan_timeup_loss_pct = "5"
//   node tools/meraki/check-timeup-calibration.js --apply=100 # rollback to the uncalibrated rule
//
// The new value applies at the next sync-wan run (nightly, or POST /api/analytics/wan/sync).

function parseApply(argv) {
  const a = (argv || []).find(x => /^--apply(=|$)/.test(String(x)));
  if (a == null) return null;
  const raw = String(a).split('=')[1];
  const n = Number(raw);
  if (raw == null || raw.trim() === '' || !Number.isFinite(n) || n <= 0 || n > 100) {
    throw new Error(`--apply needs a loss threshold in ]0, 100] (got "${raw == null ? '' : raw}")`);
  }
  return String(n);
}

async function main({ rdb, argv = [], log = console.log } = {}) {
  const reportConfig = require('../../services/reportConfig');
  const { timeupCalibration } = require('../../services/merakiWanQuality');
  const apply = parseApply(argv);                        // throws before anything is written
  const read = async () => {
    const cfg = (await reportConfig.getConfig(rdb.db)) || {};   // Promise on PostgreSQL — await
    const stored = cfg.wan_timeup_loss_pct == null ? '' : String(cfg.wan_timeup_loss_pct);
    const c = timeupCalibration(stored);
    return { stored, effective: c.timeup_effective_pct, calibrated: c.timeup_calibrated };
  };
  const before = await read();
  const out = { ...before, default: reportConfig.DEFAULTS.wan_timeup_loss_pct, applied: false };
  log(`[timeup-calibration] stored="${before.stored}" effective=${before.effective} calibrated=${before.calibrated} (default "${out.default}", calibrated value 5)`);
  if (apply == null) {
    log('[timeup-calibration] dry-run: nothing written. Re-run with --apply=5 to store the calibrated value.');
    return out;
  }
  await reportConfig.setConfig(rdb.db, { wan_timeup_loss_pct: apply }, 'calibration-tool');
  const after = await read();
  log(`[timeup-calibration] applied: stored="${after.stored}" effective=${after.effective} calibrated=${after.calibrated} — takes effect at the next sync-wan run.`);
  return { ...after, default: out.default, applied: true, previous: before.stored };
}

if (require.main === module) {
  (async () => {
    const rdb = require('../../reports-db');
    await rdb.initPgReports();
    await main({ rdb, argv: process.argv.slice(2) });
    return 0;
  })().then(c => process.exit(c)).catch(e => { console.error('[timeup-calibration] fatal:', e.message); process.exit(1); });
}

module.exports = { main, parseApply };
