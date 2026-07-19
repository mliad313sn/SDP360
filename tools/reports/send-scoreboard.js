'use strict';
// Scheduled entry point for the PER-COORDINATOR operational scoreboard email
// (site-scoreboard, Task 4). Mirrors the SCAFFOLDING of tools/reports/send-hygiene.js
// — tolerant arg parse, a pure decision gate split out for testing, gate-FIRST,
// a require.main guard, and a fully-injectable core so the tests need no real DB
// and no SMTP — but NOT its recipient model.
//
// Hygiene is a GROUP sender (one config list, site_code='GROUP'). The scoreboard
// is PER-COORDINATOR: gather the board ONCE, then loop the sites and mail EACH
// site's confirmed coordinator a board with THEIR site highlighted. An unconfirmed
// coordinator (resolveRecipient → null) is skipped. Per-(period, site) dedup.
//
// SAFETY: armed-OFF by default. NOTHING is composed, mailed, or logged unless
// scoreboard_send_enabled === '1'. A disarmed run returns before it gathers.
//
// Usage: node tools/reports/send-scoreboard.js --type=scoreboard --cadence=monthly [--preview] [--force]

// The PURE gate. The ARM FLAG ALONE governs — there is NO recipients config list
// (recipients come from the coordinator directory). Default OFF.
function decideScoreboardSend(cfg) {
  return String((cfg || {}).scoreboard_send_enabled) === '1';
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

  // Resolve db + cfg. When both are injected (tests) we boot nothing.
  let db = deps.db;
  let cfg = deps.cfg;
  let rdb = deps.reportsDb;
  if (!db || !cfg) {
    rdb = rdb || require('../../reports-db');
    if ((process.env.REPORTS_BACKEND || 'sqlite').toLowerCase() === 'postgres') await rdb.initPgReports();
    if (!db) db = rdb.db;
    if (!cfg) cfg = await require('../../services/reportConfig').getConfig(db);
  }

  const now = deps.now || new Date();
  const period = `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;

  // GATE FIRST — a disarmed run must not gather, compose, mail, or log anything.
  if (!decideScoreboardSend(cfg)) {
    console.log(`[send-scoreboard] cadence=${cadence} period=${period} → not sending (reason=disabled)`);
    return { sent: 0, reason: 'disabled' };
  }

  // Gather the board ONCE. asOf = last day of the report month.
  const month = { year: now.getFullYear(), m: now.getMonth() + 1 };
  const lastDay = new Date(month.year, month.m, 0).getDate();
  const asOf = deps.asOf || `${period}-${pad2(lastDay)}`;

  const buildSiteScoreboard = deps.buildSiteScoreboard || require('../../services/siteScoreboard').buildSiteScoreboard;
  let sd;
  if (deps.loadScoreboardData) {
    sd = await deps.loadScoreboardData({ month, asOf });
  } else {
    const rdb2 = rdb || require('../../reports-db');
    const sbDeps = {
      listSiteModuleCodes: rdb2.listSiteModuleCodes,
      getCalendarMonthlyHelpdesk: rdb2.getCalendarMonthlyHelpdesk,
      getMeetingsInsights: (a) => require('../../meetings-db').insights(a),
      getInspectionAggregate: (a) => require('../../inspection-db').aggregate(a),
      getEffortLeaderboard: require('../../assets-db').getEffortLeaderboard,
    };
    sd = await require('../../services/scoreboardData').loadScoreboardData({ month, asOf, deps: sbDeps });
  }
  const scoreboard = buildSiteScoreboard(sd.perSite, { prev: sd.prev });

  // Per-coordinator boundaries — all injectable.
  const resolveRecipient = deps.resolveRecipient || require('../../services/reportDirectory').resolveRecipient;
  const alreadySentToday = deps.alreadySentToday || require('../../services/reportSentLog').alreadySentToday;
  const record = deps.record || require('../../services/reportSentLog').record;
  const buildScoreboardDigest = deps.buildScoreboardDigest || require('../../services/siteScoreboardReport').buildScoreboardDigest;
  const mailerSend = deps.mailerSend || (msg => require('../../services/mailer').buildMailer(cfg).send(msg));

  const previews = [];
  let sent = 0;
  let skipped = 0;
  for (const row of scoreboard.rows) {
    const siteCode = row.code;

    // Confirmed coordinator only — null means unconfirmed / none on file → skip
    // (honours never_send_unconfirmed). Await for the pg-Promise row set.
    const rcpt = await resolveRecipient(db, siteCode, 'coordinator');
    if (!rcpt || !rcpt.to) { skipped++; continue; }

    // Per-(period, site) dedup — one board per coordinator per period per day.
    if (!force && await alreadySentToday(db, 'scoreboard', siteCode, period)) { skipped++; continue; }

    const { subject, html } = buildScoreboardDigest(scoreboard, { period, highlightSite: siteCode });

    if (preview) { previews.push({ site: siteCode, to: rcpt.to, subject }); continue; }

    const res = await mailerSend({ to: rcpt.to, cc: rcpt.cc, subject, html });
    await record(db, {
      report_type: 'scoreboard', site_code: siteCode, period,
      recipients: rcpt.to, result: res && res.ok ? 'ok' : 'fail',
    });
    if (res && res.ok) sent++;
  }

  if (preview) {
    console.log(`[send-scoreboard] PREVIEW period=${period} → ${previews.length} site(s): ${previews.map(p => p.site + '→' + p.to).join(', ')} — not sending`);
    return { previewed: true, sent: 0, previews };
  }

  console.log(`[send-scoreboard] DONE period=${period} → sent=${sent} skipped=${skipped}`);
  return { sent, skipped };
}

// require()-ing this file (from tests) must NOT execute the CLI.
if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error('[send-scoreboard] fatal:', e.message); process.exit(1); });
}

module.exports = { decideScoreboardSend, main };
