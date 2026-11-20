'use strict';
// P11 F-02 — the server fallback tracker block (services/reportPayload, used when the browser sends no `tracker`)
// turned "no data" into 0 / red: a month with no input scored every activity red, an empty fleet period was 0 %,
// avg_score fell back to `|| 0`. It also read loadTracker() without await (a Promise on PostgreSQL), so in production
// it always threw and returned the all-zero default. Contract now: no input = not measured (null), a stored value
// (including a stored 0) is measured; a site with nothing measured is left out; averages over nothing are null.
const { test } = require('node:test');
const assert = require('node:assert');
const rp = require('../services/reportPayload');

const ACTS = [{ name: 'A1', pillar: 'P1', weight: 1, kpi: 'COUNT', start: 1, end: 12 }, { name: 'A2', pillar: 'P2', weight: 1, kpi: 'COUNT', start: 1, end: 12 }];
function D(inputs) {
  return {
    activities: ACTS, activeSites: ['HGO', 'MGO'], siteNames: { HGO: 'Hounde', MGO: 'Mana' }, pillarWeights: { P1: 0.5, P2: 0.5 },
    targets: { HGO: [{ active: 1, target: 1 }, { active: 1, target: 1 }], MGO: [{ active: 1, target: 1 }, { active: 1, target: 1 }] },
    inputs,
  };
}
const months = (m, v) => { const a = new Array(12).fill(null); a[m - 1] = v; return a; };
const asyncDb = (d) => ({ loadTracker: async () => d });   // PostgreSQL: loadTracker returns a Promise

test('F-02: a month with no input is unknown — no red, no 0 %, avg_score null', async () => {
  const out = await rp.serverTracker({ year: 2026, month: 6 }, { trackerDb: asyncDb(D({})) });
  assert.strictEqual(out.avg_score, null);
  assert.strictEqual(out.avg_delta_pp, null);
  assert.deepEqual([out.green, out.amber, out.red], [0, 0, 0], 'nothing measured, nothing counted red');
  assert.deepEqual(out.sites, []);
  assert.ok(out.trends.fleet.every((v) => v === null), `fleet ${JSON.stringify(out.trends.fleet)}`);
  assert.deepEqual(out.pillars, {});
});

test('F-02: loadTracker is awaited and a measured month is scored; an unmeasured site and month stay null', async () => {
  const inputs = { 2026: { HGO: [months(6, 1), months(6, 0)] } };   // HGO June: A1 green, A2 a STORED 0 → red; MGO nothing
  const out = await rp.serverTracker({ year: 2026, month: 6 }, { trackerDb: asyncDb(D(inputs)) });
  assert.deepEqual(out.sites.map((s) => s.code), ['HGO'], 'MGO has no input: left out, not scored 0');
  assert.strictEqual(out.sites[0].score, 50);
  assert.strictEqual(out.sites[0].delta_pp, null, 'May not measured: no delta');
  assert.deepEqual([out.green, out.red], [1, 1], 'a stored 0 is a measurement');
  assert.strictEqual(out.avg_score, 50);
  assert.strictEqual(out.avg_delta_pp, null);
  assert.strictEqual(out.trends.fleet[4], null, 'May: nobody measured');
  assert.strictEqual(out.trends.sites.MGO[5], null);
  assert.strictEqual(out.pillars.P1.score, 100);
});

test('F-02: build() awaits the fallback (no browser tracker block)', async () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'services', 'reportPayload.js'), 'utf8');
  assert.match(src, /browserPayload\.tracker \|\| await _tracker\(/);
});

const { spawnSync } = require('node:child_process');
const fs = require('fs'); const os = require('os'); const path = require('path');
const py = (() => { for (const b of ['python3', 'python']) { const r = spawnSync(b, ['-c', 'import matplotlib, pptx, PIL'], { encoding: 'utf8' }); if (r && r.status === 0) return b; } return null; })();
test('render.py: a fallback tracker block with unmeasured months renders "—", never "None%" or a crash', { skip: py ? false : 'python with matplotlib + python-pptx + PIL not available' }, async () => {
  const JSZip = require('jszip');
  const TOOL = path.join(__dirname, '..', 'tools', 'exec-pptx');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'trk-null-'));
  try {
    const toolDir = path.join(tmp, 'tools', 'exec-pptx'); const assetDir = path.join(tmp, 'public', 'brand', 'exec-pptx');
    fs.mkdirSync(toolDir, { recursive: true }); fs.mkdirSync(assetDir, { recursive: true });
    for (const f of fs.readdirSync(TOOL).filter((x) => x.endsWith('.py'))) fs.copyFileSync(path.join(TOOL, f), path.join(toolDir, f));
    const mk = spawnSync(py, ['-c', "import sys\nfrom PIL import Image\nImage.new('RGB', (1600, 200), (31, 61, 92)).save(sys.argv[1], 'JPEG')\nImage.new('RGBA', (200, 200), (232, 119, 34, 255)).save(sys.argv[2], 'PNG')", path.join(assetDir, 'em_banner.jpg'), path.join(assetDir, 'left_corner.png')], { encoding: 'utf8' });
    assert.strictEqual(mk.status, 0, mk.stderr);
    const tracker = await rp.serverTracker({ year: 2026, month: 6 }, { trackerDb: asyncDb(D({ 2026: { HGO: [months(6, 1), months(6, 0)] } })) });
    const K = { ...JSON.parse(fs.readFileSync(path.join(TOOL, 'fixtures', 'kpis-may.json'), 'utf8')), tracker };
    const r = spawnSync(py, [path.join(toolDir, 'render.py')], { input: JSON.stringify(K), cwd: path.join(__dirname, '..'), maxBuffer: 64 * 1024 * 1024 });
    assert.strictEqual(r.status, 0, 'render.py: ' + (r.stderr ? r.stderr.toString().slice(-800) : ''));
    const zip = await JSZip.loadAsync(r.stdout); let all = '';
    for (const n of Object.keys(zip.files).filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x))) all += await zip.file(n).async('string');
    assert.ok(!/None%|Nonepp|NaN%/.test(all), 'no Python None / NaN printed');
    assert.ok(all.includes('— pp'), 'the site card says the previous month was not measured');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

// P11 F-02 round 4 — the fallback uses the engine formula (cumulative vs PRO-RATED target), not one month vs the
// annual target. Reviewer repro (f02.js): COUNT, annual target 12, inputs 1/1/1 Jan–Mar → engine GREEN, 100 %.
test('F-02 r4: fallback == tracker engine on a pro-rated COUNT activity (was red / 0 %)', async () => {
  const Dx = { sites: ['HGO'], activeSites: ['HGO'], pillarWeights: { P1: 1 }, siteNames: {},
    activities: [{ name: 'Monthly backups test', pillar: 'P1', weight: 1, kpi: 'COUNT', start: 1, end: 12 }],
    targets: { HGO: [{ active: true, target: '12' }] }, inputs: { 2026: { HGO: [[1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0]] } } };
  const t = await rp.serverTracker({ year: 2026, month: 3 }, { trackerDb: asyncDb(Dx) });
  const { ss, score } = require('../tracker-pptx');
  const e = ss(Dx, 'HGO', 2026, 3);
  assert.strictEqual(score(Dx, 'HGO', 2026, 3)[0].rg, 'GREEN');
  assert.deepEqual([t.green, t.amber, t.red], [e.g, e.a, e.r]);
  assert.deepEqual([t.green, t.red], [1, 0]);
  assert.strictEqual(t.sites[0].score, Math.round(e.avg * 100));
  assert.strictEqual(t.sites[0].score, 100);
  assert.strictEqual(t.avg_score, 100);
  assert.strictEqual(t.pillars.P1.score, 100);
  assert.strictEqual(t.trends.sites.HGO[5], 100);
  assert.strictEqual(t.trends.sites.HGO[4], 100, 'Feb: 2 of a pro-rated 2 → on track');
});

test('F-02 r4: the fallback carries no second scoring formula (reuses tracker-pptx score / ss)', () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'services', 'reportPayload.js'), 'utf8');
  assert.ok(!/_ragOf/.test(src), 'the month-vs-annual-target rule is gone');
  assert.match(src, /Engine\.ss\(D, siteCode, year, month\)/);
});
