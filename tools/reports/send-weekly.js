'use strict';
// Scheduled entry point for the PER-COORDINATOR WEEKLY report email (Task 5).
// Mirrors the SCAFFOLDING of tools/reports/send-scoreboard.js — tolerant arg
// parse, a pure decision gate split out for testing, gate-FIRST, a require.main
// guard, and a fully-injectable core so the tests need no real DB and no SMTP.
//
// It owns only three things: the arm gate, the PERIOD, and the per-site loop.
// Everything else — recipients, dedup, the deck, composition, mail, the sent-log
// row — belongs to services/sendWeeklyReport.js, which the manual HTTP route
// (Task 6) will call too. Do not re-implement any of it here: a scheduled run
// and a manual click must never disagree about what was sent.
//
// SAFETY: armed-OFF by default. NOTHING is gathered, composed, mailed, or
// logged unless weekly_report_send_enabled === '1'. A disarmed run returns
// before it reads the directory.
//
// Usage: node tools/reports/send-weekly.js --type=weekly_report --cadence=weekly
//        [--year=2026 --week=28] [--preview] [--force]

// The PURE gate. The ARM FLAG ALONE governs — there is NO recipients config
// list (recipients come from the coordinator directory). Default OFF.
function decideWeeklySend(cfg) {
  return String((cfg || {}).weekly_report_send_enabled) === '1';
}

// The ONE place this CLI formats the period. ZERO-PADDED, matching
// sendWeeklyReport.weekPeriod — '2026-W3' and '2026-W03' are different strings
// to alreadySentToday, and a mix of the two silently defeats dedup for weeks 1-9.
function weekPeriod(year, week) {
  return `${year}-W${String(week).padStart(2, '0')}`;
}

// The CLI core. Every I/O boundary is an injectable dep, falling back to the
// real module when absent — so the tests drive it with stubs and no real DB/SMTP.
async function main(deps = {}) {
  const args = deps.args ||
    Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));

  // Bare `--preview` / `--force` parse to {flag: undefined} — test for PRESENCE.
  // A truthiness test would read a bare `--preview` as "not previewing" and mail
  // a live run to every coordinator.
  const preview = deps.preview !== undefined ? deps.preview : ('preview' in args);
  const force = deps.force !== undefined
    ? deps.force
    : (('force' in args) && args.force !== '0' && args.force !== 'false');
  const cadence = deps.cadence || args.cadence || 'weekly';

  // reports-db is required LAZILY — requiring it opens a real database
  // connection as a side effect, so a disarmed run with an injected cfg must
  // never reach it.
  let rdb = deps.reportsDb;
  let db = deps.db;
  let cfg = deps.cfg;
  async function bootRdb() {
    if (!rdb) {
      rdb = require('../../reports-db');
      if ((process.env.REPORTS_BACKEND || 'sqlite').toLowerCase() === 'postgres') await rdb.initPgReports();
    }
    if (!db) db = rdb.db;
    return rdb;
  }
  if (!cfg) {
    await bootRdb();
    cfg = await require('../../services/reportConfig').getConfig(db);
  }

  // GATE — a disarmed SEND must not gather, compose, mail, or log anything. A
  // PREVIEW is exempt: it composes a dry-run (never mails/logs) so an admin can
  // check the report before arming. The per-site sender enforces preview-vs-send.
  if (!preview && !decideWeeklySend(cfg)) {
    console.log(`[send-weekly] cadence=${cadence} → not sending (reason=disabled)`);
    return { sent: 0, reason: 'disabled' };
  }

  // ── the period ────────────────────────────────────────────────────────────
  // The report period is the week just ENDED — reports-db.getPreviousWeek()
  // (exported, pure, no DB). Note getISOWeek is module-private and NOT
  // exported; requiring it yields undefined and throws at run time.
  // Explicit --year / --week override, per field, for a deliberate re-send.
  let year = deps.year !== undefined ? deps.year : args.year;
  let week = deps.week !== undefined ? deps.week : args.week;
  if (year === undefined || year === '' || week === undefined || week === '') {
    const getPreviousWeek = deps.getPreviousWeek || (await bootRdb()).getPreviousWeek;
    const prev = getPreviousWeek() || {};
    if (year === undefined || year === '') year = prev.year;
    if (week === undefined || week === '') week = prev.week;
  }
  year = parseInt(year, 10);
  week = parseInt(week, 10);
  if (!Number.isFinite(year) || !Number.isFinite(week)) {
    throw new Error(`could not resolve the report week (year=${year}, week=${week})`);
  }
  const period = weekPeriod(year, week);

  // ── the per-site loop ─────────────────────────────────────────────────────
  await bootRdb();   // no-op when db was injected
  const listRecipients = deps.listRecipients || require('../../services/reportDirectory').listRecipients;
  const sendWeekly = deps.sendWeeklyReport || require('../../services/sendWeeklyReport').sendWeeklyReport;

  // Every directory site is ATTEMPTED. The "why not" decisions — inactive site,
  // no report, never submitted, unconfirmed recipient, already sent today —
  // all belong to the sender and its loader, which word each one for the
  // Service Desk Manager. Filtering any of them here would give the same
  // condition two different explanations depending on the caller.
  const rows = (await listRecipients(db)) || [];
  const sites = rows.map(r => r && r.site_code).filter(Boolean);

  console.log(`[send-weekly] cadence=${cadence} period=${period} → ${sites.length} site(s) in the directory${preview ? ' preview=1' : ''}${force ? ' force=1' : ''}`);

  let sent = 0, skipped = 0, failed = 0;
  const skips = [];
  const previews = [];

  for (const site of sites) {
    try {
      const res = await sendWeekly({ db, cfg, site, year, week, force, preview });

      if (res && res.preview) {
        previews.push({ site, subject: res.subject });
        console.log(`[send-weekly] PREVIEW site=${site} subject=${res.subject}`);
      } else if (res && res.ok) {
        sent++;
        console.log(`[send-weekly] SENT site=${site} to=${res.to} pptx=${res.pptx ? 'yes' : 'no'}`);
      } else {
        // Log the sender's reason VERBATIM — it is the loader's own
        // operator-facing wording, and the SDM reads exactly these lines to
        // know which coordinators never submitted.
        const reason = (res && res.reason) || 'unknown outcome';
        skipped++;
        skips.push({ site, reason });
        console.log(`[send-weekly] SKIP site=${site} reason=${reason}`);
      }
    } catch (e) {
      // One site's failure must not abort the run — the remaining sites still
      // deserve their report. sendWeeklyReport already logged the outcome row.
      failed++;
      console.error(`[send-weekly] FAIL site=${site} reason=${e.message}`);
    }
  }

  if (preview) {
    console.log(`[send-weekly] PREVIEW DONE period=${period} → composed=${previews.length} skipped=${skipped} failed=${failed} — nothing sent`);
    return { previewed: true, sent: 0, period, previews, skipped, failed, skips };
  }

  console.log(`[send-weekly] DONE cadence=${cadence} period=${period} → sent=${sent} skipped=${skipped} failed=${failed}`);
  return { sent, skipped, failed, period, skips };
}

// require()-ing this file (from tests) must NOT execute the CLI. Without this
// guard the call's process.exit(0) kills the test runner and the file "passes"
// having run zero tests.
if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error('[send-weekly] fatal:', e.message); process.exit(1); });
}

module.exports = { decideWeeklySend, main };
