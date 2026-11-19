'use strict';
// P04 PPM certification — the two HUMAN-check kits produce honest material: the interop files re-read identically on our
// parser, the witness comparison puts tool-of-record and SDP360 values side by side and leaves the PMO columns EMPTY,
// and the witness loader refuses a production host. Fictitious data, no server, no DB.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const W = require('../tools/ppm/witness-load');
const MSPDI = require('../services/ppm/mspdi');

test('interop kit: three MSPDI files, each a fixed point of our exporter, with the expected-values sheet', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p04-kit-'));
  try {
    const out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '../tools/ppm/interop-kit.js'), '--out=' + dir], { encoding: 'utf8' }));
    assert.deepStrictEqual(out.files.map((f) => f.file), ['A-small.xml', 'B-1000-tasks.xml', 'C-calendars-links.xml']);
    const B = out.files[1], C = out.files[2];
    assert.equal(B.tasks, 1000); assert.equal(B.link_types, 'FF/FS/SF/SS'); assert.equal(C.link_types, 'FF/FS/SF/SS'); assert.ok(C.calendars >= 2);
    for (const f of out.files) {
      const xml = fs.readFileSync(path.join(dir, f.file), 'utf8');
      assert.equal(MSPDI.toXml(MSPDI.fromXml(xml)), xml, f.file + ' re-reads byte-identical');
      const csv = fs.readFileSync(path.join(dir, f.file.replace('.xml', '.expected.csv')), 'utf8').trim().split('\n');
      assert.equal(csv.length, f.tasks + 1, 'one row per task + header');
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('witness comparison: side by side, deltas in days, unknown stays empty, PMO columns empty', () => {
  const model = { name: 'w', start_date: '2027-01-04', calendars: [], resources: [], assignments: [],
    tasks: [{ uid: 1, id: 1, name: 'A', outline_level: 1, duration_days: 3, start: '2027-01-04', finish: '2027-01-06', percent_complete: 50, predecessors: [], baselines: [] },
      { uid: 2, id: 2, name: 'B', outline_level: 1, duration_days: 2, start: '2027-01-11', finish: '2027-01-12', predecessors: [{ uid: 1, type: 'FS', lag: 0, lag_unit: 'd' }], baselines: [] }] };
  const rows = W.comparisonRows(model, W.engineOf(model));
  // SDP360: A Mon 04 → Wed 06 (same); B follows A → Thu 07 → Fri 08 (the file says 11 → 12: 4 days earlier)
  assert.deepStrictEqual(rows.map((r) => [r.sdp_start, r.sdp_finish, r.delta_start_days, r.delta_finish_days, r.same_dates]), [['2027-01-04', '2027-01-06', 0, 0, 1], ['2027-01-07', '2027-01-08', -4, -4, 0]]);
  assert.ok(rows.every((r) => r.pmo_verdict === '' && r.pmo_comment === ''), 'never pre-filled');
  assert.deepStrictEqual(W.summaryOf(rows), { tasks: 2, leaves: 2, compared: 2, same_dates: 1, max_abs_finish_delta_days: 4, not_compared: 0 });
  const none = W.comparisonRows(model, null);
  assert.ok(none.every((r) => r.sdp_start === null && r.delta_finish_days === null && r.same_dates === 0), 'no schedule → unknown, never 0');
  assert.match(W.toCsv(rows).split('\n')[0], /pmo_verdict,pmo_comment$/);
});

test('witness loader refuses a production host and a missing confirmation', () => {
  assert.ok(W.PROD_HOSTS.includes('itops-dashboard.edv-ops.com'));
  const f = path.join(os.tmpdir(), 'p04-w-' + process.pid + '.xml');
  fs.writeFileSync(f, MSPDI.toXml({ name: 'w', start_date: '2027-01-04', tasks: [], calendars: [], resources: [], assignments: [] }));
  try {
    const r = (args, env) => { try { execFileSync(process.execPath, [path.join(__dirname, '../tools/ppm/witness-load.js'), '--file=' + f, ...args], { encoding: 'utf8', env: { ...process.env, ...env }, stdio: 'pipe', cwd: os.tmpdir() }); return { code: 0 }; } catch (e) { return { code: e.status, err: String(e.stderr) }; } };
    assert.match(r(['--base=https://itops-dashboard.edv-ops.com', '--project-id=1', '--i-confirm-test-instance'], { SDP_WITNESS_TOKEN: 'x' }).err, /production host/);
    assert.match(r(['--base=http://127.0.0.1:9', '--project-id=1'], { SDP_WITNESS_TOKEN: 'x' }).err, /i-confirm-test-instance/);
    assert.match(r(['--base=http://127.0.0.1:9', '--project-id=1', '--i-confirm-test-instance'], { SDP_WITNESS_TOKEN: '' }).err, /SDP_WITNESS_TOKEN/);
  } finally { fs.rmSync(f, { force: true }); for (const x of fs.readdirSync(os.tmpdir()).filter((n) => n.startsWith('p04-w-'))) fs.rmSync(path.join(os.tmpdir(), x), { force: true }); }
});
