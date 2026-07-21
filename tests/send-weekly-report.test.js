'use strict';

// The weekly sender. Sibling of send-coordinator-recipients.test.js — same
// discipline, different pipeline.
//
// The two orderings this file exists to pin:
//   • PPTX is built AFTER the dedup + recipient gates, never before. A fleet
//     loop that already sent must not spend 60s/site building decks it discards,
//     so tests 4 and 6 assert generatePptx was called ZERO times.
//   • composeWeekly runs ONCE PER PATH, and on the send path it runs AFTER the
//     PPTX attempt — `pptxFailed` is an INPUT to it (weekly.js:316).

const test = require('node:test');
const assert = require('node:assert');

const { sendWeeklyReport } = require('../services/sendWeeklyReport.js');
const realDirectory = require('../services/reportDirectory.js');

const SITE = 'SGO';
const WEEK = { year: 2026, week: 30 };

const REPORT = {
  id: 42, site_id: 7, status: 'submitted', site_name: 'Sabodala',
  zoho_group: 'Sabodala IT Agents,Massawa IT Agents',
  week_label: 'W30 · 20–26 Jul 2026', start_date: '2026-07-20', end_date: '2026-07-26',
  infra_kpis: [], helpdesk: {}, lights: [], action_items: [],
};

const DATA_OK = {
  ok: true, site_code: SITE, report: REPORT,
  week: { year: 2026, week: 30, label: REPORT.week_label, start: REPORT.start_date, end: REPORT.end_date },
  assets: null,
};

const PPTX_BUF = Buffer.from('PK-fake-deck-bytes');

// One confirmed coordinator row. The REAL resolveFromRows runs over it, so an
// unconfirmed variant genuinely exercises never_send_unconfirmed rather than
// proving a stub returned null.
function rows({ confirmed = 1 } = {}) {
  return [{
    site_code: SITE,
    coordinator_email: 'coord@edv-ops.com',
    coordinator_email_confirmed: confirmed,
    fm_email: 'fm@edv-ops.com', fm_email_confirmed: 1,
    cc_emails: 'cc1@edv-ops.com',
  }];
}

function makeDeps(over = {}) {
  const calls = { compose: [], pptx: [], sent: [], recorded: [], dedup: [], data: [] };

  const deps = {
    async weeklyReportData(args) {
      calls.data.push(args);
      return 'data' in over ? over.data : DATA_OK;
    },
    composeWeekly(data) {
      calls.compose.push(data);
      return { subject: 'SUBJ', htmlBody: '<body-html>', fullHtml: '<full-html>' };
    },
    reportDirectory: {
      async listRecipients() { return 'rows' in over ? over.rows : rows(); },
      resolveFromRows: realDirectory.resolveFromRows,
    },
    reportSentLog: {
      async alreadySentToday(db, type, site, period) {
        calls.dedup.push([type, site, period]);
        return !!over.alreadySent;
      },
      async record(db, row) { calls.recorded.push(row); },
    },
    reportConfig: {
      async getConfig() { return { never_send_unconfirmed: '1', smtp_host: 'x', from: 'y' }; },
    },
    buildMailer() {
      return {
        async send(msg) {
          calls.sent.push(msg);
          return over.sendFails ? { ok: false, error: 'smtp exploded' } : { ok: true, messageId: '<id@x>' };
        },
      };
    },
    async generatePptx(...args) {
      calls.pptx.push(args);
      if (over.pptxThrows) throw new Error('deck render blew up');
      if (over.pptxHangs) return new Promise(() => {});   // never settles
      return PPTX_BUF;
    },
    // The PPTX arg-assembly readers. Injected so the deck path never opens a DB.
    reportsDb: {
      async getPreviousWeekInfraKpis() { return { kpis: [{ service: 'WAN' }] }; },
      async getOpenChangesForSite(groups) { return [{ groups }]; },
      async getActiveMajorIncidentsForSite() { return []; },
    },
    meetingsDb: {
      siteNameToCode() { return 'SGO'; },
      async getSiteMonthlyMeetingSummary() { return { available: true }; },
    },
  };
  return { deps, calls };
}

const run = (deps, extra = {}) =>
  sendWeeklyReport({ db: {}, site: SITE, ...WEEK, deps, ...extra });

// ── 1 · happy path ──────────────────────────────────────────────────────────
test('sends to the confirmed coordinator and logs ok', async () => {
  const { deps, calls } = makeDeps();
  const res = await run(deps);

  assert.equal(res.ok, true);
  assert.equal(res.to, 'coord@edv-ops.com');
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.sent[0].to, 'coord@edv-ops.com');
  assert.deepEqual(calls.sent[0].cc, ['cc1@edv-ops.com']);
  assert.equal(calls.sent[0].subject, 'SUBJ');

  assert.equal(calls.recorded.length, 1);
  assert.equal(calls.recorded[0].report_type, 'weekly_report');
  assert.equal(calls.recorded[0].site_code, SITE);
  assert.equal(calls.recorded[0].period, '2026-W30');
  assert.equal(calls.recorded[0].result, 'ok');
});

// ── 2 · force ───────────────────────────────────────────────────────────────
test('force:true logs result "resent", not "ok"', async () => {
  const { deps, calls } = makeDeps();
  const res = await run(deps, { force: true });
  assert.equal(res.ok, true);
  assert.equal(calls.recorded[0].result, 'resent');
});

// ── 3 · unconfirmed ─────────────────────────────────────────────────────────
test('unconfirmed coordinator → skipped, mailer never called', async () => {
  const { deps, calls } = makeDeps({ rows: rows({ confirmed: 0 }) });
  const res = await run(deps);

  assert.equal(res.skipped, true);
  assert.match(res.reason, /no confirmed recipient/i);
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.recorded.length, 0);
});

// ── 4 · dedup short-circuits BEFORE the deck ────────────────────────────────
test('already sent today → skipped, no mail, and NO pptx was built', async () => {
  const { deps, calls } = makeDeps({ alreadySent: true });
  const res = await run(deps);

  assert.equal(res.skipped, true);
  assert.match(res.reason, /already sent/i);
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.recorded.length, 0);
  // The whole point of ordering PPTX after dedup: an already-sent fleet run
  // must cost nothing. ~13 sites × 60s is ~13 minutes of wasted rendering.
  assert.equal(calls.pptx.length, 0, 'pptx must not be built for a deduped send');
});

// ── 5 · loader refusal propagates verbatim ──────────────────────────────────
test('loader {ok:false} → its reason propagates verbatim, nothing sent or logged', async () => {
  const reason = 'report for site "SGO" 2026-W30 is not finished (status: draft)';
  const { deps, calls } = makeDeps({ data: { ok: false, reason } });
  const res = await run(deps);

  assert.equal(res.skipped, true);
  assert.equal(res.reason, reason);          // verbatim — not reworded
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.recorded.length, 0);
  assert.equal(calls.pptx.length, 0);
});

// ── 6 · preview ─────────────────────────────────────────────────────────────
test('preview → {preview, subject, html}, no mail, no log, no pptx', async () => {
  const { deps, calls } = makeDeps();
  const res = await run(deps, { preview: true });

  assert.equal(res.preview, true);
  assert.equal(res.subject, 'SUBJ');
  assert.equal(res.html, '<full-html>');
  assert.equal(calls.sent.length, 0);
  assert.equal(calls.recorded.length, 0);
  assert.equal(calls.pptx.length, 0, 'a preview must never build a deck');
  // Composed exactly once, and told the deck did not fail.
  assert.equal(calls.compose.length, 1);
  assert.equal(calls.compose[0].pptxFailed, false);
});

// ── 7 · deck failure must not cost the coordinator their report ─────────────
test('pptx throws → e-mail STILL sends, composeWeekly sees pptxFailed:true, no attachment', async () => {
  const { deps, calls } = makeDeps({ pptxThrows: true });
  const res = await run(deps);

  assert.equal(res.ok, true);
  assert.equal(res.pptx, false);
  // All three, deliberately: "the mailer was called" alone would also pass for
  // an implementation that never attempts the deck at all.
  assert.equal(calls.pptx.length, 1, 'the deck must actually have been attempted');
  assert.equal(calls.sent.length, 1);
  assert.equal(calls.compose.length, 1);
  assert.equal(calls.compose[0].pptxFailed, true);
  assert.deepEqual(calls.sent[0].attachments, []);
  assert.equal(calls.recorded[0].result, 'ok');
});

// ── 8 · deck success ────────────────────────────────────────────────────────
test('pptx succeeds → attached, with the stub buffer verbatim', async () => {
  const { deps, calls } = makeDeps();
  const res = await run(deps);

  assert.equal(res.pptx, true);
  assert.equal(calls.compose[0].pptxFailed, false);
  const att = calls.sent[0].attachments;
  assert.equal(att.length, 1);
  assert.equal(att[0].filename, 'Weekly-Report-SGO-2026-W30.pptx');
  // Identity, not merely "non-empty" — a wrong-buffer bug survives a length check.
  assert.ok(att[0].content.equals(PPTX_BUF), 'the attached bytes must be the generated deck');
});

// ── 8b · a hung deck must not hang the send ─────────────────────────────────
// The timeout is the difference between "one site ships html-only" and "the
// whole fleet run wedges on one bad deck". Driven at 20ms via the injectable
// cap so the real 60s value stays honest without a 60s test.
test('pptx exceeding the timeout → degrades to html-only, send still completes', async () => {
  const { deps, calls } = makeDeps({ pptxHangs: true });
  const res = await run(deps, { pptxTimeoutMs: 20 });

  assert.equal(res.ok, true);
  assert.equal(res.pptx, false);
  assert.equal(calls.sent.length, 1);
  assert.deepEqual(calls.sent[0].attachments, []);
  assert.equal(calls.compose[0].pptxFailed, true);
  assert.equal(calls.recorded[0].result, 'ok');
});

// ── 9 · zero-padded period ──────────────────────────────────────────────────
test('week 3 → period "2026-W03", never "2026-W3"', async () => {
  const { deps, calls } = makeDeps();
  await sendWeeklyReport({ db: {}, site: SITE, year: 2026, week: 3, deps });

  assert.equal(calls.recorded[0].period, '2026-W03');
  assert.deepEqual(calls.dedup[0], ['weekly_report', SITE, '2026-W03']);
});
