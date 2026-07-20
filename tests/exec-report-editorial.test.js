'use strict';
// Task 0 — the server-side store for the Group IT deck builder's monthly analysis.
// One table (exec_report_editorial), two grains discriminated by `scope`:
//   'ops'                          → the Operations Summary (month-level)
//   'commentary:<site>:<grp>'      → the Analyze/commentary fields (month + filter)
// reports-db opens data/reports.db AT REQUIRE TIME, so SDP_DATA_DIR must point at a
// throwaway dir BEFORE the require. Backend pinned to sqlite (the dev .env sets pg).
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'exec-report-ed-'));
process.env.REPORTS_BACKEND = 'sqlite';
// reports-db refuses to boot a fresh DB without a seed admin.
process.env.DASH_USER = process.env.DASH_USER || 'exec-ed-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'exec-ed-pass-0000';

const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const rdb = require('../reports-db');

// Raw handle onto the SAME file reports-db opened — only used by the
// defensive-parse test, which must write a payload the setter would never write.
const raw = () => new Database(_path.join(process.env.SDP_DATA_DIR, 'reports.db'));

test('absent (period, scope) → null (not a throw, not {})', () => {
  const got = rdb.getExecReportEditorial('2026-07', 'ops');
  assert.strictEqual(got, null, 'an unset key reads back as null');
});

test('set then get round-trips the SAME object through JSON', () => {
  const payload = { goal: 'x', progress: 'a\nb' };
  rdb.setExecReportEditorial('2026-07', 'ops', payload, 'admin');
  assert.deepStrictEqual(rdb.getExecReportEditorial('2026-07', 'ops'), payload);
});

test('a second set for the same (period, scope) OVERWRITES — one row only', () => {
  rdb.setExecReportEditorial('2026-09', 'ops', { goal: 'first' }, 'admin');
  rdb.setExecReportEditorial('2026-09', 'ops', { goal: 'second', extra: 1 }, 'admin2');
  assert.deepStrictEqual(rdb.getExecReportEditorial('2026-09', 'ops'), { goal: 'second', extra: 1 });
  const db = raw();
  const n = db.prepare("SELECT COUNT(*) c FROM exec_report_editorial WHERE period=? AND scope=?")
    .get('2026-09', 'ops').c;
  db.close();
  assert.strictEqual(n, 1, 'upsert keeps exactly one row for the pair');
});

test('scopes are independent within one period', () => {
  rdb.setExecReportEditorial('2026-10', 'ops', { goal: 'ops-goal' }, 'admin');
  rdb.setExecReportEditorial('2026-10', 'commentary:MANA:Operations', { 'f-exec': 'mana text' }, 'admin');
  assert.deepStrictEqual(rdb.getExecReportEditorial('2026-10', 'ops'), { goal: 'ops-goal' });
  assert.deepStrictEqual(rdb.getExecReportEditorial('2026-10', 'commentary:MANA:Operations'),
    { 'f-exec': 'mana text' });
  // A third, unrelated filter combination is still absent.
  assert.strictEqual(rdb.getExecReportEditorial('2026-10', 'commentary:HGO:Operations'), null);
});

test('periods are independent within one scope', () => {
  rdb.setExecReportEditorial('2026-11', 'ops', { goal: 'nov' }, 'admin');
  rdb.setExecReportEditorial('2026-12', 'ops', { goal: 'dec' }, 'admin');
  assert.deepStrictEqual(rdb.getExecReportEditorial('2026-11', 'ops'), { goal: 'nov' });
  assert.deepStrictEqual(rdb.getExecReportEditorial('2026-12', 'ops'), { goal: 'dec' });
});

test('accents, newlines, quotes and an apostrophe round-trip byte-identically', () => {
  const payload = { note: "Houndé — l'accès \"OK\"\nligne2" };
  rdb.setExecReportEditorial('2027-01', 'ops', payload, 'admin');
  const got = rdb.getExecReportEditorial('2027-01', 'ops');
  assert.deepStrictEqual(got, payload);
  assert.strictEqual(got.note, "Houndé — l'accès \"OK\"\nligne2");
});

test('garbage stored payload_json → null, NOT a throw', () => {
  rdb.setExecReportEditorial('2027-02', 'ops', { goal: 'good' }, 'admin');
  const db = raw();
  db.prepare("UPDATE exec_report_editorial SET payload_json=? WHERE period=? AND scope=?")
    .run('{not json at all', '2027-02', 'ops');
  db.close();
  assert.strictEqual(rdb.getExecReportEditorial('2027-02', 'ops'), null);
});
