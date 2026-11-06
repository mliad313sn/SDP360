'use strict';
// E-A04 — the performance baseline is pure aggregation over e2e artefacts: nearest-rank percentiles,
// an empty list stays null (never 0), failed journeys are not timing samples, and no threshold is ever
// written (every Budget cell is UNKNOWN). Fixture artefacts only — no browser.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const pb = require('../tools/test/perf-baseline');

const art = (journey, run, ms, pages, status = 'passed') => ({ journey, __run: run, status, started_at: '2026-11-05T10:00:00.000Z', finished_at: new Date(Date.parse('2026-11-05T10:00:00.000Z') + ms).toISOString(), pages });
const pg = (p, dcl, load, bytes) => ({ path: p, dom_content_loaded_ms: dcl, load_ms: load, transfer_bytes: bytes });

test('percentile: nearest rank; empty → null, never 0', () => {
  assert.equal(pb.percentile([], 50), null);
  assert.equal(pb.percentile([null, undefined], 95), null);
  assert.equal(pb.percentile([5], 95), 5);
  assert.equal(pb.percentile([1, 2, 3, 4], 50), 2);
  assert.equal(pb.percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 95), 100);
  assert.equal(pb.percentile([3, 1, 2], 50), 2, 'sorted before ranking');
});

test('aggregate: per page and per journey over several runs; failed journeys skipped', () => {
  const agg = pb.aggregate([
    art('T1', 1, 4000, [pg('/a.html', 100, 150, 2048), pg('/b.html', 200, 250, 4096)]),
    art('T1', 2, 6000, [pg('/a.html', 120, 170, 2048)]),
    art('T2', 1, 9000, [pg('/a.html', 300, 400, 1024)], 'failed'),
  ]);
  assert.equal(agg.runs, 2);
  assert.deepEqual(agg.pages['/a.html'].dcl_ms, { n: 2, p50: 100, p95: 120 });
  assert.deepEqual(agg.pages['/b.html'].load_ms, { n: 1, p50: 250, p95: 250 });
  assert.deepEqual(agg.journeys.T1.duration_ms, { n: 2, p50: 4000, p95: 6000 });
  assert.ok(!agg.journeys.T2, 'a failed journey is not a sample');
  for (const s of [...Object.values(agg.pages), ...Object.values(agg.journeys)]) assert.equal(s.budget, 'UNKNOWN — to be approved');
});

test('markdown: carries machine, commit, run count, the observation statement and no numeric budget', () => {
  const md = pb.renderMarkdown(pb.aggregate([art('T1', 1, 1000, [pg('/a.html', 10, 20, 3000)])]), { commit: 'abc1234', node: 'v22', cpu: 'Test CPU × 2', memory_gb: 4, generated_at: 'X' });
  assert.match(md, /throwaway database, synthetic data — observation, not a budget/i);
  assert.match(md, /Commit: abc1234/); assert.match(md, /Test CPU × 2/); assert.match(md, /Runs: 1/);
  for (const row of md.split('\n').filter((l) => l.startsWith('| `') || /^\| T1 /.test(l))) assert.match(row, /UNKNOWN — to be approved \|$/);
});

test('loadArtefacts + main: reads run<i>-*.json only, writes the report, never throws on an empty dir', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'perf-baseline-'));
  fs.writeFileSync(path.join(d, 'summary.json'), '{}');
  fs.writeFileSync(path.join(d, 'run1-T1.json'), JSON.stringify(art('T1', 0, 500, [pg('/x.html', 5, 6, 7)])));
  fs.writeFileSync(path.join(d, 'run2-T1.json'), JSON.stringify(art('T1', 0, 700, [pg('/x.html', 8, 9, 7)])));
  const arts = pb.loadArtefacts(d);
  assert.deepEqual(arts.map((a) => a.__run), [1, 2]);
  const out = path.join(d, 'PERF.md');
  const agg = pb.main([`--dir=${d}`, `--out=${out}`]);
  assert.equal(agg.runs, 2); assert.ok(fs.readFileSync(out, 'utf8').includes('`/x.html` | 2 | 5 | 8 |'));
  const empty = pb.aggregate(pb.loadArtefacts(path.join(d, 'missing')));
  assert.deepEqual([empty.runs, Object.keys(empty.pages).length], [0, 0]);
});
