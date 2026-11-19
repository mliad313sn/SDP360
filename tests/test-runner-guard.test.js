'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { parseEvents, summarize, check } = require('../tools/test/guard');

const A = path.resolve('/x/a.test.js'), B = path.resolve('/x/b.test.js');
const ev = (file, ok = true, kind = 'test') => ({ file, ok, kind });

test('parseEvents ignores blank and torn lines', () => {
  assert.strictEqual(parseEvents('{"ok":true,"file":"/a"}\n\n{"ok":tr\n').length, 1);
});

test('summarize counts tests, not suites, and failures', () => {
  const s = summarize([ev(A), ev(A, false), ev(B, true, 'suite')]);
  assert.strictEqual(s.tests, 2);
  assert.strictEqual(s.failed, 1);
  assert.strictEqual(s.files.size, 2);
});

test('check names a test file that reported nothing', () => {
  const r = check({ expectedFiles: [A, B], events: [ev(A)], minTests: 1 });
  assert.strictEqual(r.ok, false);
  assert.deepStrictEqual(r.missing, [B]);
  assert.match(r.problems[0], /b\.test\.js/);
});

test('check fails under the floor, passes at it, fails without a floor', () => {
  assert.strictEqual(check({ expectedFiles: [A], events: [ev(A)], minTests: 2 }).ok, false);
  assert.strictEqual(check({ expectedFiles: [A], events: [ev(A), ev(A)], minTests: 2 }).ok, true);
  assert.strictEqual(check({ expectedFiles: [A], events: [ev(A)], minTests: NaN }).ok, false);
});

// Consolidation P0-C — per-file census against tests/.suite-manifest.json.
const { census, checkManifest, skipReport, buildManifest } = require('../tools/test/guard');
const evs = (file, n, skip) => Array.from({ length: n }, () => ({ file, ok: true, kind: 'test', skip: skip || null }));

test('census counts tests and skip reasons per file', () => {
  const c = census([...evs(A, 2), ...evs(A, 1, 'no pg'), ...evs(B, 1)]);
  assert.deepStrictEqual(c['a.test.js'], { tests: 3, skipped: 1, reasons: { 'no pg': 1 } });
  assert.strictEqual(c['b.test.js'].tests, 1);
});

test('checkManifest flags a file that silently lost tests', () => {
  const p = checkManifest({ manifest: { files: { 'a.test.js': 5, 'b.test.js': 1 } }, census: census([...evs(A, 3), ...evs(B, 1)]), expectedFiles: [A, B] });
  assert.strictEqual(p.length, 1); assert.match(p[0], /a\.test\.js reported 3 tests, manifest expects at least 5/);
});

test('checkManifest flags a deleted file and an unreviewed new file', () => {
  const p = checkManifest({ manifest: { files: { 'gone.test.js': 2, 'a.test.js': 1 } }, census: census([...evs(A, 1), ...evs(B, 1)]), expectedFiles: [A, B] });
  assert.ok(p.some((x) => /gone\.test\.js .*no longer exists/.test(x)));
  assert.ok(p.some((x) => /b\.test\.js is not in/.test(x)));
});

test('more tests than recorded is fine; buildManifest totals; skipReport groups by reason', () => {
  assert.deepStrictEqual(checkManifest({ manifest: { files: { 'a.test.js': 1 } }, census: census(evs(A, 4)), expectedFiles: [A] }), []);
  const m = buildManifest(census([...evs(A, 2), ...evs(B, 3)]));
  assert.strictEqual(m.total, 5); assert.deepStrictEqual(m.files, { 'a.test.js': 2, 'b.test.js': 3 });
  assert.deepStrictEqual(skipReport(census([...evs(A, 2, 'no pg'), ...evs(B, 1, 'no pg')]))[0], ['no pg', { tests: 3, files: ['a.test.js', 'b.test.js'] }]);
});

test('G01 checkSkips: an unlisted skip reason or more skips than allowed fails; listed skips pass', () => {
  const { checkSkips } = require('../tools/test/guard');
  const cs = { 'a.test.js': { tests: 3, skipped: 2, reasons: { 'no prod-snapshot': 2 } }, 'b.test.js': { tests: 1, skipped: 1, reasons: { 'new reason': 1 } } };
  const allow = { reasons: { 'no prod-snapshot': { max: 2, owner: 'x' } } };
  const p = checkSkips(cs, allow);
  assert.strictEqual(p.length, 1); assert.match(p[0], /unlisted reason "new reason"/);
  assert.match(checkSkips(cs, { reasons: { 'no prod-snapshot': { max: 1 }, 'new reason': { max: 1 } } })[0], /permits 1/);
  assert.deepStrictEqual(checkSkips({ 'a.test.js': cs['a.test.js'] }, allow), []);
});
test('G01: every allow-listed skip names an owner', () => {
  const allow = require('./.skip-allowlist.json');
  for (const [r, a] of Object.entries(allow.reasons)) { assert.ok(a.owner && a.owner.length > 5, r); assert.ok(Number.isInteger(a.max) && a.max >= 0, r); }   // E-Q01: max 0 = the reason is documented (dev boxes) but no skip is allowed in a guarded run
});

// P11 AUD-3 — a failing test marked `todo` used to pass the run: node exits 0, the reporter wrote ok:false with
// skip:null, and the guard saw no problem. A todo now counts like a skip ("todo: <reason>") against the allow-list.
test('AUD-3: a todo is counted like a skip and an unlisted todo fails the guard', () => {
  const { checkSkips, census: cen } = require('../tools/test/guard');
  const events = [{ file: A, ok: true, kind: 'test', skip: null }, { file: A, ok: false, kind: 'test', skip: null, todo: 'later' }];
  const cs = cen(events);
  assert.deepStrictEqual(cs['a.test.js'], { tests: 2, skipped: 1, reasons: { 'todo: later': 1 } });
  const p = checkSkips(cs, { reasons: {} });
  assert.strictEqual(p.length, 1); assert.match(p[0], /unlisted reason "todo: later"/);
  assert.deepStrictEqual(checkSkips(cs, { reasons: { 'todo: later': { max: 1, owner: 'qa lead' } } }), []);
  // an allow-listed todo is not a failure; any other ok:false is, even if the process exit code said 0
  assert.strictEqual(check({ expectedFiles: [A], events, minTests: 1 }).ok, true);
  const r = check({ expectedFiles: [A], events: [{ file: A, ok: false, kind: 'test' }], minTests: 1 });
  assert.strictEqual(r.ok, false); assert.match(r.problems.join(' '), /1 test\(s\) failed/);
});

test('AUD-3: the file reporter carries the todo reason of a failing todo (reviewer repro)', () => {
  const fs = require('fs'), os = require('os');
  const { spawnSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aud3-'));
  try {
    const f = path.join(dir, 'todo.test.js'), out = path.join(dir, 'ev.jsonl');
    fs.writeFileSync(f, "const test=require('node:test');const assert=require('node:assert');test('parked',{todo:'later'},()=>{assert.strictEqual(1,2);});\n");
    const env = { ...process.env }; delete env.NODE_OPTIONS; delete env.NODE_TEST_CONTEXT;
    const r = spawnSync(process.execPath, ['--test', '--test-reporter=' + path.resolve(__dirname, '../tools/test/file-reporter.mjs'), '--test-reporter-destination=' + out, f], { env, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, 'node itself exits 0 on a failing todo — the guard must catch it');
    const { parseEvents: pe, census: cen, checkSkips } = require('../tools/test/guard');
    const evts = pe(fs.readFileSync(out, 'utf8'));
    assert.ok(evts.some((e) => e.todo === 'later'), 'reporter records the todo reason');
    assert.match(checkSkips(cen(evts), { reasons: {} }).join(' '), /todo: later/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
