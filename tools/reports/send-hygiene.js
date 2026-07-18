'use strict';
// Scheduled entry point for the CMDB-hygiene digest (Assets sub-project B, Task 4).
// Mirrors tools/reports/send-reports.js: a tolerant arg parse, a pure decision
// gate split out for testing, a require.main guard, and a fully-injectable core so
// the tests need no real DB and no SMTP.
//
// It composes the Group-IT hygiene digest (assetHygieneReport.buildHygieneDigest)
// and mails it to ONE Group-IT distribution list — not per-site. There is no
// coordinator directory here: the recipients are a comma-list in report_config.
//
// SAFETY: this is armed-OFF by default. NOTHING is composed or mailed unless
// hygiene_send_enabled === '1' AND at least one recipient is on file. A disarmed
// run returns before it even loads the summary.
//
// Usage: node tools/reports/send-hygiene.js --type=hygiene --cadence=weekly [--preview] [--force]
//   --type    ignored (the scheduler passes it; only 'hygiene' exists here)
//   --cadence weekly|monthly — carried for logging/parity only
//   --preview compose + log recipients/subject, but DO NOT send
//   --force   send even if a digest was already logged for this period today

// The PURE gate. Decides whether a scheduled run may mail, and to whom. Split out
// so it is testable without booting the app or touching SMTP. Default OFF: an
// empty/unset config is 'disabled'. The arm flag governs — recipients on file do
// NOT enable sending on their own.
//   → { send:false, reason } | { send:true, recipients:[...] }
function decideHygieneSend(cfg) {
  const c = cfg || {};
  if (String(c.hygiene_send_enabled) !== '1') return { send: false, reason: 'disabled' };
  const recipients = String(c.hygiene_recipients || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  if (!recipients.length) return { send: false, reason: 'no recipients' };
  return { send: true, recipients };
}

// Default freshness reader — the R1 mitigation. Reads the `assets_assets` sync
// job's last SUCCESSFUL timestamp from sync_metadata and derives age in whole
// days from `now`. getLastSyncAt is a dual-backend dispatcher (a Promise on
// postgres), so it MUST be awaited — a bare call would attach a Promise and the
// digest would print "Register sync status unknown" in prod only.
async function _defaultLoadSyncAge(rdb, now) {
  const last = await rdb.getLastSyncAt('assets_assets');
  if (!last) return { last_success: null, age_days: null };
  const lastDate = new Date(last);
  const age_days = Number.isNaN(lastDate.getTime())
    ? null
    : Math.floor((now.getTime() - lastDate.getTime()) / 86400000);
  return { last_success: String(last).slice(0, 10), age_days };
}

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
  const cadence = deps.cadence || args.cadence || 'weekly';

  // Resolve db + cfg. When both are injected (tests) we boot nothing — no
  // reports-db, no assets-db, no reportConfig — so a stubbed run is DB-free.
  let db = deps.db;
  let cfg = deps.cfg;
  let rdb = deps.reportsDb;
  if (!db || !cfg) {
    rdb = rdb || require('../../reports-db');
    if ((process.env.REPORTS_BACKEND || 'sqlite').toLowerCase() === 'postgres') await rdb.initPgReports();
    const assetsDb = deps.assetsDb || require('../../assets-db');
    if (assetsDb.ASSETS_BACKEND === 'postgres') await assetsDb.initPgAssets();
    if (!db) db = rdb.db;
    if (!cfg) cfg = await require('../../services/reportConfig').getConfig(db);
  }

  const now = deps.now || new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  // GATE FIRST — a disarmed run must not compose, mail, or log anything.
  const gate = decideHygieneSend(cfg);
  if (!gate.send) {
    console.log(`[send-hygiene] cadence=${cadence} period=${period} → not sending (reason=${gate.reason})`);
    return { sent: 0, reason: gate.reason };
  }
  const recipients = gate.recipients;

  // Dedup: one digest per period per calendar day, unless --force.
  const alreadySentToday = deps.alreadySentToday || require('../../services/reportSentLog').alreadySentToday;
  if (!force && await alreadySentToday(db, 'hygiene', 'GROUP', period)) {
    console.log(`[send-hygiene] already sent today for period=${period} — skipping (use --force to override)`);
    return { sent: 0, skipped: true, reason: 'already sent' };
  }

  // Summary + freshness. loadSummary returns the getHygieneSummary shape; we
  // attach summary.sync (register freshness) only when the summary didn't already
  // carry it — so an injected summary's sync is respected untouched.
  const loadSummary = deps.loadSummary || (() => require('../../assets-db').getHygieneSummary({}));
  const summary = await loadSummary();
  if (summary && summary.sync === undefined) {
    const loadSyncAge = deps.loadSyncAge || _defaultLoadSyncAge;
    summary.sync = await loadSyncAge(rdb || require('../../reports-db'), now);
  }

  // Identity rows for the workbook — one fetch per hygiene kind.
  const kinds = deps.kinds || Object.keys((deps.assetsDb || require('../../assets-db')).HYGIENE_KINDS);
  const loadExceptions = deps.loadExceptions || ((kind) => require('../../assets-db').getHygieneExceptions(kind, {}));
  const exceptionsByKind = {};
  for (const kind of kinds) exceptionsByKind[kind] = await loadExceptions(kind);

  // Task 7 — Finance + Licence snapshots (both injectable so the test stays
  // DB-free; the digest renders them only when present). Resolve the XOF→USD
  // rate from config, falling back to the reportConfig default when unset/≤0.
  let rate = parseFloat(cfg.xof_usd_rate);
  if (!(rate > 0)) rate = parseFloat((deps.reportConfig || require('../../services/reportConfig')).DEFAULTS.xof_usd_rate);
  const loadFinance = deps.loadFinance || ((r) => require('../../assets-db').getFinanceSummary({}, r));
  const loadLicences = deps.loadLicences || (() => require('../../assets-db').getLicenceSummary({}));
  const finance = await loadFinance(rate);
  if (finance && typeof finance === 'object') finance.rate = rate;
  const licences = await loadLicences();

  // Compose (pure — html + xlsx Buffer).
  const buildHygieneDigest = deps.buildHygieneDigest || require('../../services/assetHygieneReport').buildHygieneDigest;
  const { subject, html, attachments } = buildHygieneDigest(summary, { period, prev: null, exceptionsByKind, finance, licences });

  if (preview) {
    console.log(`[send-hygiene] PREVIEW period=${period} to=${recipients.join(',')} subject="${subject}" — not sending`);
    return { previewed: true, sent: 0, recipients, subject };
  }

  // Send, then log the outcome (dedup + audit).
  const mailerSend = deps.mailerSend || (msg => require('../../services/mailer').buildMailer(cfg).send(msg));
  const res = await mailerSend({ to: recipients.join(','), subject, html, attachments });

  const record = deps.record || require('../../services/reportSentLog').record;
  await record(db, {
    report_type: 'hygiene', site_code: 'GROUP', period,
    recipients: recipients.join(','), result: res && res.ok ? 'ok' : 'fail',
  });

  console.log(`[send-hygiene] DONE period=${period} → sent=${res && res.ok ? 1 : 0} to=${recipients.join(',')}`);
  return { sent: res && res.ok ? 1 : 0 };
}

// require()-ing this file (from tests) must NOT execute the CLI — without the
// guard the entrypoint's process.exit() would kill the test runner.
if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error('[send-hygiene] fatal:', e.message); process.exit(1); });
}

module.exports = { decideHygieneSend, main };
