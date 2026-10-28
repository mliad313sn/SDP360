'use strict';
// Task 0 — validated recipient SELECTION in sendCoordinatorReport.
//
// The rule this file exists to prove: an admin may pick among the addresses
// ALREADY ON that site's directory row AND confirmed. They may never introduce
// a new one, and selecting an unconfirmed row address must NOT bypass
// confirmation. The SERVER is the enforcement point — the client is never
// trusted, so every rejection is asserted to happen BEFORE the mailer and
// BEFORE the sent-log write.
//
// NOTHING HERE MAY TOUCH REAL SMTP OR SPAWN CHROME. Every external edge is
// injected via `deps` (the harness is lifted from reporting-send.smoke.test.js).
// resolveFromRows is deliberately the REAL implementation so the row semantics
// under test are the production ones, not a stub's idea of them.

const { test } = require('node:test');
const assert = require('node:assert');

const { sendCoordinatorReport } = require('../services/sendCoordinator');
const realDirectory = require('../services/reportDirectory');

const SITE = 'MGO';

// The canonical directory row: coordinator confirmed, FM confirmed, two CCs.
function row(over = {}) {
  return {
    site_code: SITE,
    site_name: 'Mana',
    coordinator_name: 'Coord Person',
    coordinator_email: 'coord@x.com',
    coordinator_email_confirmed: 1,
    fm_name: 'FM Person',
    fm_email: 'fm@x.com',
    fm_email_confirmed: 1,
    cc_emails: 'cc1@x.com, cc2@x.com',
    active: 1,
    ...over,
  };
}

// Returns { run, mailed, logged, called } — `run(extra)` drives one send with
// every edge stubbed; the arrays capture what the pipeline actually did.
function harness({ rows = [row()] } = {}) {
  const mailed = [];
  const logged = [];
  const called = [];

  const deps = {
    reportsDb: { getSiteIdByModuleCode: async () => ({ site_id: 1, name: 'Mana', zoho_group: 'G' }) },
    reportDirectory: {
      listRecipients: async () => rows,
      resolveFromRows: realDirectory.resolveFromRows,   // the REAL gate
    },
    siteReportData: async () => ({}),
    composeCoordinator: () => ({ subject: 'subj', htmlBody: 'body', fullHtml: '<html></html>' }),
    renderPdf: async () => { called.push('pdf'); return { ok: false, reason: 'stubbed' }; },
    buildMailer: () => ({
      send: async (msg) => { mailed.push(msg); return { ok: true, messageId: 'stub-id' }; },
    }),
    reportSentLog: {
      alreadySentToday: async () => false,
      record: async (_db, entry) => { logged.push(entry); },
    },
  };

  const run = (extra = {}) => sendCoordinatorReport({
    db: {}, cfg: { never_send_unconfirmed: '1' },
    site: SITE, period: '2026-07', kind: 'weekly',
    deps, ...extra,
  });

  return { run, mailed, logged, called };
}

// ── 1 · the unchanged path (this is what the scheduled CLI does) ─────────────
test('NO recipients → unchanged: coordinator + every CC on the row', async () => {
  const h = harness();
  const out = await h.run();

  assert.equal(out.ok, true, 'the send went through');
  assert.equal(h.mailed.length, 1, 'exactly one message');
  assert.equal(h.mailed[0].to, 'coord@x.com', 'To = the confirmed coordinator');
  assert.deepStrictEqual(h.mailed[0].cc, ['cc1@x.com', 'cc2@x.com'], 'CC = every cc_emails entry');
});

// ── 2-3 · a valid selection ─────────────────────────────────────────────────
test('recipients {to:fm, cc:[cc2]} → mails exactly that', async () => {
  const h = harness();
  const out = await h.run({ recipients: { to: 'fm@x.com', cc: ['cc2@x.com'] } });

  assert.equal(out.ok, true, 'a confirmed FM + one of the CCs is allowed');
  assert.equal(h.mailed.length, 1);
  assert.equal(h.mailed[0].to, 'fm@x.com');
  assert.deepStrictEqual(h.mailed[0].cc, ['cc2@x.com']);
  assert.equal(out.to, 'fm@x.com', 'the result echoes the chosen To');
});

test('recipients {to:coord, cc:[]} → the coordinator with NO cc', async () => {
  const h = harness();
  const out = await h.run({ recipients: { to: 'coord@x.com', cc: [] } });

  assert.equal(out.ok, true);
  assert.equal(h.mailed[0].to, 'coord@x.com');
  assert.deepStrictEqual(h.mailed[0].cc, [], 'an empty cc selection drops every CC');
});

// ── 4-6 · the rejections — the whole point of the feature ───────────────────
test('a To that is NOT on the row → skipped, nothing mailed, nothing logged', async () => {
  const h = harness();
  const out = await h.run({ recipients: { to: 'someone@else.com' } });

  assert.equal(out.skipped, true, 'a foreign address must be refused');
  assert.match(out.reason || '', /not a confirmed recipient/i, 'the reason names the rule');
  assert.match(out.reason || '', /someone@else\.com/, 'the reason names the offending address');
  assert.equal(h.mailed.length, 0, 'NOTHING was mailed');
  assert.equal(h.logged.length, 0, 'NOTHING was logged');
  assert.deepStrictEqual(h.called, [], 'refused BEFORE the pdf/mail/log stages');
});

test('an UNCONFIRMED address ON the row → skipped (selection cannot bypass confirmation)', async () => {
  const h = harness({ rows: [row({ fm_email_confirmed: 0 })] });
  const out = await h.run({ recipients: { to: 'fm@x.com' } });

  assert.equal(out.skipped, true, 'present-but-unconfirmed is still refused');
  assert.match(out.reason || '', /not a confirmed recipient/i);
  assert.equal(h.mailed.length, 0, 'NOTHING was mailed');
  assert.equal(h.logged.length, 0, 'NOTHING was logged');
});

test('a CC that is not on the row → skipped, nothing mailed', async () => {
  const h = harness();
  const out = await h.run({ recipients: { to: 'coord@x.com', cc: ['nope@else.com'] } });

  assert.equal(out.skipped, true, 'a bad CC poisons the whole selection');
  assert.match(out.reason || '', /nope@else\.com/, 'the reason names the offending CC');
  assert.equal(h.mailed.length, 0, 'NOTHING was mailed');
  assert.equal(h.logged.length, 0, 'NOTHING was logged');
});

test('a missing To → skipped', async () => {
  const h = harness();
  const out = await h.run({ recipients: { cc: ['cc1@x.com'] } });

  assert.equal(out.skipped, true, 'a selection with no To is refused');
  assert.equal(h.mailed.length, 0);
  assert.equal(h.logged.length, 0);
});

// ── 7 · a deliberate re-send is traceable ───────────────────────────────────
// DEVIATION from the plan's literal wording (`result:'sent'` without force):
// alreadySentToday() filters `result='ok'` (reportSentLog.js:35,39). Writing
// 'sent' would make EVERY row invisible to dedup — the "already sent today"
// skip would never fire again on either the manual OR the scheduled path. So
// the normal result stays 'ok' (byte-identical to today) and only the forced
// re-send is tagged 'resent'.
test('force → result "resent"; no force → result "ok" (dedup-visible)', async () => {
  const a = harness();
  await a.run();
  assert.equal(a.logged.length, 1);
  assert.equal(a.logged[0].result, 'ok', 'a normal send stays dedup-visible');

  const b = harness();
  await b.run({ force: true });
  assert.equal(b.logged.length, 1);
  assert.equal(b.logged[0].result, 'resent', 'a deliberate re-send is traceable in the log');
});

test('a forced re-send still dedups a later send the same day', async () => {
  // 'resent' must also count for alreadySentToday, or a force-first send would
  // leave the period looking un-sent.
  const os = require('os'), fs = require('fs'), path = require('path');
  process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR
    || fs.mkdtempSync(path.join(os.tmpdir(), 'send-rcpt-'));
  const db = await require('./_pg-fresh').fresh(['report_sent_log']);
  const log = require('../services/reportSentLog');
  (await log.record(db, { report_type: 'coordinator', site_code: SITE, period: '2026-07', recipients: 'a@b.c', result: 'resent' }));
  assert.equal((await log.alreadySentToday(db, 'coordinator', SITE, '2026-07')), true,
    'a "resent" row must count for dedup');
});

// ── 8 · tolerance ───────────────────────────────────────────────────────────
test('the allowed-set match is case- and whitespace-tolerant', async () => {
  const h = harness();
  const out = await h.run({ recipients: { to: '  COORD@X.COM ', cc: [' CC1@X.com'] } });

  assert.equal(out.ok, true, 'casing/padding must not refuse a legitimate address');
  assert.equal(h.mailed.length, 1, 'and it was actually mailed');
});
