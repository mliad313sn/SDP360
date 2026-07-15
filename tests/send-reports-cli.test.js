'use strict';
// Unit tests for the scheduled CLI's pure decision core. decideSends() is the
// gate that decides WHO a scheduled run mails — it must be testable without
// booting the app, touching SMTP, or resolving real site data.
const test = require('node:test');
const assert = require('node:assert');
const cli = require('../tools/reports/send-reports');
const { decideSends, isSupportedType } = cli;

const SAFE = { never_send_unconfirmed: '1' };   // the prod default

const row = (over = {}) => ({
  site_code: 'HGO', coordinator_email: 'jean@edv-ops.com', coordinator_email_confirmed: 1,
  fm_email: 'marie@edv-ops.com', fm_email_confirmed: 1, cc_emails: '', active: 1, ...over,
});

// Regression: the CLI body MUST be behind `if (require.main === module)`. When it
// was a bare top-level IIFE, require()-ing it ran the CLI and its process.exit(0)
// killed the runner — this file reported "tests 1 / pass 1" having executed NONE
// of its assertions. A green run meant nothing. This test, plus the fact that
// every test below it reports, is the proof the guard is in place.
test('requiring the CLI is side-effect-free and exports its decision core', () => {
  assert.strictEqual(typeof cli.decideSends, 'function');
  assert.strictEqual(typeof cli.main, 'function', 'main is exported, not auto-invoked');
});

// ── the type guard ───────────────────────────────────────────────────────────
// Regression: main() used to do `kind = args.type === 'finance' ? 'fm' : 'coordinator'`
// and then call sendCoordinatorReport — which hardcodes REPORT_TYPE='coordinator'
// and re-resolves the recipient itself. So `--type=finance` gated the population
// on the FM's confirmation flag, then mailed the COORDINATOR report to the
// COORDINATOR, logged as report_type='coordinator'. Reachable: reports.html lets
// an admin enable a Finance schedule, and reportSchedule builds the task as
// `--type=${report_type}`. These tests pin the refusal.
test('isSupportedType accepts only coordinator — finance/group are not implemented', () => {
  assert.strictEqual(isSupportedType('coordinator'), true);
  assert.strictEqual(isSupportedType(undefined), true, 'no --type defaults to coordinator');
  assert.strictEqual(isSupportedType('finance'), false, 'sub-project 4 — must not send today');
  assert.strictEqual(isSupportedType('group'), false, 'sub-project 3 — must not send today');
  assert.strictEqual(isSupportedType('bogus'), false);
});

// The strongest proof available without SMTP: the guard sits ABOVE every require
// in main(), so a refused run cannot have composed, resolved, mailed or logged
// anything — it never even loaded reports-db. Asserting the module stayed out of
// require.cache is that proof: reaching ANY send code is impossible without it.
test('main() --type=finance returns without sending — no DB/mailer is even loaded', async () => {
  const dbPath = require.resolve('../reports-db');
  assert.ok(!require.cache[dbPath], 'precondition: reports-db not yet loaded by this file');

  const argv = process.argv;
  const log = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  try {
    process.argv = ['node', 'send-reports.js', '--type=finance', '--cadence=weekly'];
    await cli.main();
  } finally {
    process.argv = argv;
    console.log = log;
  }

  assert.ok(!require.cache[dbPath],
    'a refused run must not load reports-db — if it did, it reached the send pipeline');
  assert.ok(lines.some(l => /not implemented yet/i.test(l)), `expected a refusal log, got: ${JSON.stringify(lines)}`);
  assert.ok(!lines.some(l => /SENT/.test(l)), 'nothing was sent');
});

test('main() --type=group is refused the same way', async () => {
  const argv = process.argv;
  const log = console.log;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  try {
    process.argv = ['node', 'send-reports.js', '--type=group'];
    await cli.main();
  } finally {
    process.argv = argv;
    console.log = log;
  }
  assert.ok(lines.some(l => /type=group not implemented yet/i.test(l)));
  assert.ok(!require.cache[require.resolve('../reports-db')], 'no DB loaded');
});

test('confirmed + active → sendable', () => {
  const out = decideSends([row()], SAFE, 'coordinator');
  assert.deepStrictEqual(out.sendable, ['HGO']);
  assert.deepStrictEqual(out.skipped, []);
});

test('unconfirmed email → skipped with a reason', () => {
  const out = decideSends([row({ coordinator_email_confirmed: 0 })], SAFE, 'coordinator');
  assert.deepStrictEqual(out.sendable, []);
  assert.strictEqual(out.skipped.length, 1);
  assert.strictEqual(out.skipped[0].site, 'HGO');
  assert.match(out.skipped[0].reason, /confirm/i, 'reason names the unconfirmed-address rule');
});

test('active=0 → skipped even when the address is confirmed', () => {
  const out = decideSends([row({ active: 0 })], SAFE, 'coordinator');
  assert.deepStrictEqual(out.sendable, []);
  assert.strictEqual(out.skipped.length, 1);
  assert.match(out.skipped[0].reason, /inactive/i, 'reason names the inactive rule');
});

test('no address at all → skipped', () => {
  const out = decideSends([row({ coordinator_email: '', coordinator_email_confirmed: 0 })], SAFE, 'coordinator');
  assert.deepStrictEqual(out.sendable, []);
  assert.strictEqual(out.skipped.length, 1);
});

test("never_send_unconfirmed='0' → an unconfirmed but PRESENT address becomes sendable", () => {
  const cfg = { never_send_unconfirmed: '0' };
  const out = decideSends([row({ coordinator_email_confirmed: 0 })], cfg, 'coordinator');
  assert.deepStrictEqual(out.sendable, ['HGO'], 'safety off → an unconfirmed address is allowed');
  assert.deepStrictEqual(out.skipped, []);
});

test("never_send_unconfirmed='0' still skips a row with NO address", () => {
  const out = decideSends([row({ coordinator_email: '', coordinator_email_confirmed: 0 })], { never_send_unconfirmed: '0' }, 'coordinator');
  assert.deepStrictEqual(out.sendable, [], 'safety off is not permission to mail nobody');
  assert.strictEqual(out.skipped.length, 1);
});

test("kind is honoured — fm resolves the fm_* columns, not the coordinator's", () => {
  const rows = [row({ fm_email_confirmed: 0 })];
  assert.deepStrictEqual(decideSends(rows, SAFE, 'coordinator').sendable, ['HGO']);
  assert.deepStrictEqual(decideSends(rows, SAFE, 'fm').sendable, [], 'fm unconfirmed → fm run skips it');
});

test('mixed set partitions cleanly and preserves every site exactly once', () => {
  const rows = [
    row({ site_code: 'HGO' }),
    row({ site_code: 'MGO', coordinator_email_confirmed: 0 }),
    row({ site_code: 'SGO', active: 0 }),
  ];
  const out = decideSends(rows, SAFE, 'coordinator');
  assert.deepStrictEqual(out.sendable, ['HGO']);
  assert.deepStrictEqual(out.skipped.map(s => s.site).sort(), ['MGO', 'SGO']);
});

test('empty directory → empty partition, no throw', () => {
  assert.deepStrictEqual(decideSends([], SAFE, 'coordinator'), { sendable: [], skipped: [] });
  assert.deepStrictEqual(decideSends(null, SAFE, 'coordinator'), { sendable: [], skipped: [] });
});
