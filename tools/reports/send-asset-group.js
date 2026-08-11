'use strict';
// Scheduled entry point for the "Assets — Groupe" management digest (Assets reports
// integration, Task 3). Mirrors the SCAFFOLDING of tools/reports/send-hygiene.js —
// tolerant arg parse, a pure decision gate split out for testing, gate-FIRST, a
// require.main guard, and a fully-injectable core so the tests need no real DB and
// no SMTP.
//
// Like hygiene it is a GROUP sender (one config recipients-list, site_code='GROUP')
// — NOT per-coordinator. It composes services/assetGroupReport.buildAssetGroupDigest
// from two already-computed readers (effort leaderboard + investment forecast) and
// mails ONE management distribution list.
//
// SAFETY: armed-OFF by default. NOTHING is gathered, composed, mailed, or logged
// unless asset_group_send_enabled === '1' AND at least one recipient is on file. A
// disarmed run returns before it gathers.
//
// Usage: node tools/reports/send-asset-group.js --type=asset_group --cadence=monthly [--preview] [--force]

// The PURE gate. Decides whether a scheduled run may mail, and to whom. Split out so
// it is testable without booting the app or touching SMTP. Default OFF: an empty/unset
// config is 'disabled'. The arm flag governs — recipients on file do NOT enable
// sending on their own.
//   → { send:false, reason } | { send:true, recipients:[...] }
function decideAssetGroupSend(cfg) {
  const c = cfg || {};
  if (String(c.asset_group_send_enabled) !== '1') return { send: false, reason: 'disabled' };
  const recipients = String(c.asset_group_recipients || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (!recipients.length) return { send: false, reason: 'no recipients' };
  return { send: true, recipients };
}

const pad2 = n => String(n).padStart(2, '0');

// The CLI core. Every I/O boundary is an injectable dep, falling back to the real
// module when absent — so the tests drive it with stubs and no real DB/SMTP.
async function main(deps = {}) {
  const args = deps.args ||
    Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));

  // Bare `--preview` / `--force` parse to {flag: undefined} — test for PRESENCE.
  const preview = deps.preview !== undefined ? deps.preview : ('preview' in args);
  const force = deps.force !== undefined
    ? deps.force
    : (('force' in args) && args.force !== '0' && args.force !== 'false');
  const cadence = deps.cadence || args.cadence || 'monthly';

  // Resolve db + cfg + assetsDb. When db+cfg are injected (tests) we boot nothing —
  // no reports-db, no assets-db, no reportConfig — so a stubbed run is DB-free.
  const assetsDb = deps.assetsDb || require('../../assets-db');
  let db = deps.db;
  let cfg = deps.cfg;
  let rdb = deps.reportsDb;
  if (!db || !cfg) {
    rdb = rdb || require('../../reports-db');
    if ((process.env.REPORTS_BACKEND || 'sqlite').toLowerCase() === 'postgres') await rdb.initPgReports();
    if (assetsDb.ASSETS_BACKEND === 'postgres') await assetsDb.initPgAssets();
    if (!db) db = rdb.db;
    if (!cfg) cfg = await require('../../services/reportConfig').getConfig(db);
  }

  const now = deps.now || new Date();
  const period = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;

  // GATE — a disarmed / no-recipient SEND must not gather, compose, mail, or log.
  // A PREVIEW is exempt: it composes a dry-run (never mails/logs) so an admin can
  // check the digest before arming.
  const gate = decideAssetGroupSend(cfg);
  if (!preview && !gate.send) {
    console.log(`[send-asset-group] cadence=${cadence} period=${period} → not sending (reason=${gate.reason})`);
    return { sent: 0, reason: gate.reason };
  }
  // Recipients ride in the gate when armed; a disarmed preview resolves them from
  // config directly (empty is fine — a preview never sends).
  const recipients = gate.recipients || String((cfg || {}).asset_group_recipients || '')
    .split(',').map(s => s.trim()).filter(Boolean);

  // Dedup: one digest per period per calendar day, unless --force. Skipped for a
  // preview (a preview must never be blocked by a prior send).
  const alreadySentToday = deps.alreadySentToday || require('../../services/reportSentLog').alreadySentToday;
  if (!preview && !force && await alreadySentToday(db, 'asset_group', 'GROUP', period)) {
    console.log(`[send-asset-group] already sent today for period=${period} — skipping (use --force to override)`);
    return { sent: 0, skipped: true, reason: 'already sent' };
  }

  // asOf = last day of the report month (mirrors send-scoreboard).
  const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const asOf = deps.asOf || `${period}-${pad2(lastDay)}`;

  // Resolve the THREE config values here — server.js's _assetUsdRate /
  // _assetUpliftPct / _deprecConfig helpers are private to server.js, unreachable.
  const reportConfig = deps.reportConfig || require('../../services/reportConfig');
  let rate = parseFloat(cfg.xof_usd_rate);
  if (!(rate > 0)) rate = parseFloat(reportConfig.DEFAULTS.xof_usd_rate);   // never 1
  // uplift is stored as a PERCENT ('3'); the forecast wants a FRACTION (mirror
  // server.js _assetUpliftPct: divide by 100, clamp ≥0).
  const upRaw = cfg.asset_replacement_uplift_pct != null
    ? cfg.asset_replacement_uplift_pct : reportConfig.DEFAULTS.asset_replacement_uplift_pct;
  const upPct = Number(upRaw) / 100;
  const upliftPct = Number.isFinite(upPct) && upPct >= 0 ? upPct : 0;
  // Depreciation policy — parseDepreciationConfig takes the raw JSON STRING and
  // falls back to DEFAULT_DEPRECIATION_CONFIG on garbage/absent. Required by the
  // hardware forecast for per-type useful life.
  const deprecConfig = require('../../services/depreciation').parseDepreciationConfig(cfg.asset_depreciation_config);

  // Gather (fleet-wide filters {} — coverage lives INSIDE forecast.hardware/software).
  const leaderboard = await assetsDb.getEffortLeaderboard({ asOf });
  const forecast = await assetsDb.getInvestmentForecast({}, {
    config: deprecConfig, rate, upliftPct, horizonYears: 5, asOf,
  });

  // Compose (pure — subject + html).
  const fmtUsd = deps.fmtUsd || require('../../services/money').fmtUsd;
  const buildAssetGroupDigest = deps.buildAssetGroupDigest || require('../../services/assetGroupReport').buildAssetGroupDigest;
  const { subject, html } = buildAssetGroupDigest({ leaderboard, forecast, period, fmtUsd });

  if (preview) {
    console.log(`[send-asset-group] PREVIEW period=${period} to=${recipients.join(',')} subject="${subject}" — not sending`);
    return { preview: true, subject, html };
  }

  // Send, then log the outcome (dedup + audit).
  const mailerSend = deps.mailerSend || (msg => require('../../services/mailer').buildMailer(cfg).send(msg));
  const res = await mailerSend({ to: recipients.join(','), subject, html });

  const record = deps.record || require('../../services/reportSentLog').record;
  await record(db, {
    report_type: 'asset_group', site_code: 'GROUP', period,
    recipients: recipients.join(','),
    result: res && res.ok ? (force ? 'resent' : 'ok') : 'fail',
  });

  console.log(`[send-asset-group] DONE period=${period} → sent=${res && res.ok ? 1 : 0} to=${recipients.join(',')}`);
  return { sent: res && res.ok ? 1 : 0 };
}

// require()-ing this file (from tests) must NOT execute the CLI — without the guard
// the entrypoint's process.exit() would kill the test runner.
if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error('[send-asset-group] fatal:', e.message); process.exit(1); });
}

module.exports = { decideAssetGroupSend, main };
