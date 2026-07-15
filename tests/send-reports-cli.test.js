'use strict';
// Unit tests for the scheduled CLI's pure decision core. decideSends() is the
// gate that decides WHO a scheduled run mails — it must be testable without
// booting the app, touching SMTP, or resolving real site data.
const test = require('node:test');
const assert = require('node:assert');
const cli = require('../tools/reports/send-reports');
const { decideSends } = cli;

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
