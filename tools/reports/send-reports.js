'use strict';
// Scheduled entry point for the reporting suite. Resolves config + the recipient
// directory, decides WHO to mail (decideSends), then hands each sendable site to
// services/sendCoordinator.sendCoordinatorReport — the SAME pipeline the manual
// POST /api/reports/send route calls. Do not re-implement compose/render/mail/log
// here: a scheduled run and a manual click must never disagree about what was sent.
//
// Usage: node tools/reports/send-reports.js --type=coordinator --cadence=weekly [--force]
const reportDirectory = require('../../services/reportDirectory');

// Only the coordinator report exists today. Mirrors server.js's SEND_TYPES gate
// on POST /api/reports/send — the two callers of sendCoordinatorReport must
// refuse the same set, or a schedule can do what the route forbids.
const SUPPORTED_TYPES = ['coordinator'];   // 'finance'/'group' land in sub-projects 3/4
function isSupportedType(type) {
  return SUPPORTED_TYPES.includes(String(type || 'coordinator'));
}

// Pure. The gate that decides who a scheduled run mails, split out from the CLI
// body so it is testable without booting the app or touching SMTP.
//   → { sendable: [siteCode], skipped: [{site, reason}] }
// The confirmed-address rule is DELEGATED to reportDirectory.resolveFromRows so
// this gate cannot drift from the one sendCoordinator/the route enforce. `active`
// is checked here because resolveFromRows does not model it.
function decideSends(recipients, cfg, kind) {
  const rows = recipients || [];
  const neverSendUnconfirmed = (cfg || {}).never_send_unconfirmed === '1';
  const sendable = [];
  const skipped = [];

  for (const r of rows) {
    const site = r.site_code;

    if (Number(r.active) === 0) {
      skipped.push({ site, reason: 'inactive site' });
      continue;
    }

    // Distinguish "no address" from "unconfirmed address": resolveFromRows
    // returns null for both, but they are different operational problems and
    // the operator needs the reason to tell them apart.
    const email = kind === 'fm' ? r.fm_email : r.coordinator_email;
    if (!email) {
      skipped.push({ site, reason: `no ${kind} email on file` });
      continue;
    }

    if (!reportDirectory.resolveFromRows(rows, site, kind, { neverSendUnconfirmed })) {
      skipped.push({ site, reason: `${kind} email is not confirmed` });
      continue;
    }

    sendable.push(site);
  }

  return { sendable, skipped };
}

async function main() {
  const args = Object.fromEntries(process.argv.slice(2).map(a => a.replace(/^--/, '').split('=')));

  // FIRST, before any require/DB/SMTP work: refuse a type we cannot compose.
  // The admin card can enable a finance/group schedule (reportSchedule accepts
  // all three), which creates a Task Scheduler job calling us with
  // --type=finance — and sendCoordinatorReport ALWAYS composes the COORDINATOR
  // report and resolves the COORDINATOR's address. Gating the population on the
  // FM's confirmation flag and then mailing the coordinator's report to the
  // coordinator, logged as report_type='coordinator', is worse than not sending:
  // it is unattended, silent, and looks successful. Refuse instead.
  const type = args.type || 'coordinator';
  if (!isSupportedType(type)) {
    console.log(`[send-reports] type=${type} not implemented yet (sub-projects 3/4) — exiting without sending`);
    return;
  }
  const kind = 'coordinator';   // guaranteed by the guard above

  const reportsDb = require('../../reports-db');
  if ((process.env.REPORTS_BACKEND || 'sqlite').toLowerCase() === 'postgres') await reportsDb.initPgReports();
  const reportConfig = require('../../services/reportConfig');
  const { sendCoordinatorReport } = require('../../services/sendCoordinator');

  const cfg = await reportConfig.getConfig(reportsDb.db);
  const recipients = await reportDirectory.listRecipients(reportsDb.db);
  const cadence = args.cadence || 'weekly';
  // Bare `--force` parses to {force: undefined}, so test for PRESENCE, not truthiness.
  const force = ('force' in args) && args.force !== '0' && args.force !== 'false';

  const now = new Date();
  const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  const { sendable, skipped } = decideSends(recipients, cfg, kind);
  console.log(`[send-reports] type=${type} cadence=${cadence} period=${period} → ${sendable.length}/${recipients.length} site(s) sendable`);
  for (const s of skipped) console.log(`[send-reports] SKIP site=${s.site} reason=${s.reason}`);

  let sent = 0, failed = 0;
  let skippedCount = skipped.length;

  for (const site of sendable) {
    try {
      const res = await sendCoordinatorReport({ db: reportsDb.db, cfg, site, period, force });
      if (res.ok) { sent++; console.log(`[send-reports] SENT site=${site} to=${res.to} pdf=${res.pdf ? 'yes' : 'no'}`); }
      else if (res.skipped) { skippedCount++; console.log(`[send-reports] SKIP site=${site} reason=${res.reason}`); }
    } catch (e) {
      // One site's failure must not abort the run — the remaining sites still
      // deserve their report. sendCoordinator already logged the outcome row.
      failed++;
      console.error(`[send-reports] FAIL site=${site} reason=${e.message}`);
    }
  }

  console.log(`[send-reports] DONE type=${type} period=${period} → sent=${sent} skipped=${skippedCount} failed=${failed}`);
}

// Only run when invoked directly — require()-ing this file (from tests) must NOT
// execute the CLI. Without this guard the IIFE's process.exit(0) kills the test
// runner and the file "passes" having run zero tests.
if (require.main === module) {
  main().then(() => process.exit(0)).catch(e => { console.error('[send-reports] fatal:', e.message); process.exit(1); });
}

module.exports = { decideSends, main, isSupportedType, SUPPORTED_TYPES };
