'use strict';
// P11-F-01 (AI qualification panel, data seat) — a month with no survey figure must not print CSAT "0 %",
// "80.0pp below target", "AVG SURVEY SCORE 0.0%" or "Last known CSAT was 0%" on slide 7 of the Group IT deck.
// The browser sends null; render.py used to default it to 0 because CSAT sat in neither null list.
// A MEASURED 0 % (responses exist, nobody satisfied) must still print 0 %. Also pins the browser side of the
// inverse bug: public/executive-report.html must not turn a measured 0 into null with `||`.
const { test, after } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');

const ROOT = path.join(__dirname, '..');
const RENDER = path.join(ROOT, 'tools', 'exec-pptx', 'render.py');
const FIXTURE = path.join(ROOT, 'tools', 'exec-pptx', 'fixtures', 'kpis-may-qa.json');

function findPython() {
  for (const bin of ['python3', 'python', 'py']) {
    try { const r = spawnSync(bin, ['-c', 'import matplotlib, pptx, PIL'], { encoding: 'utf8' }); if (r && r.status === 0) return bin; } catch (_) { /* next */ }
  }
  return null;
}
const PY = findPython();
const skip = PY ? false : 'python with matplotlib + python-pptx + pillow not available';

let staged = null, stagedTmp = null;
after(() => { if (stagedTmp) fs.rmSync(stagedTmp, { recursive: true, force: true }); });
function renderer() {
  if (staged) return staged;
  const assets = path.join(ROOT, 'public', 'brand', 'exec-pptx');
  if (fs.existsSync(path.join(assets, 'em_banner.jpg')) && fs.existsSync(path.join(assets, 'left_corner.png'))) return (staged = RENDER);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-csat-')); stagedTmp = tmp;
  const toolDir = path.join(tmp, 'tools', 'exec-pptx'); const assetDir = path.join(tmp, 'public', 'brand', 'exec-pptx');
  fs.mkdirSync(toolDir, { recursive: true }); fs.mkdirSync(assetDir, { recursive: true });
  for (const f of fs.readdirSync(path.dirname(RENDER)).filter((x) => x.endsWith('.py'))) fs.copyFileSync(path.join(path.dirname(RENDER), f), path.join(toolDir, f));
  const mk = spawnSync(PY, ['-c', ['import sys', 'from PIL import Image', "Image.new('RGB', (1600, 200), (31, 61, 92)).save(sys.argv[1], 'JPEG')", "Image.new('RGBA', (200, 200), (232, 119, 34, 255)).save(sys.argv[2], 'PNG')"].join('\n'),
    path.join(assetDir, 'em_banner.jpg'), path.join(assetDir, 'left_corner.png')], { encoding: 'utf8' });
  assert.strictEqual(mk.status, 0, 'placeholder images: ' + mk.stderr);
  return (staged = path.join(toolDir, 'render.py'));
}

async function slide7Text(patch) {
  const K = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  delete K.csat; Object.assign(K, patch);
  if (K.commentary) delete K.commentary.csat;
  const r = spawnSync(PY, [renderer()], { input: JSON.stringify(K), cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual(r.status, 0, 'render.py failed: ' + (r.stderr ? r.stderr.toString().slice(0, 800) : ''));
  const zip = await JSZip.loadAsync(r.stdout);
  for (const name of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) {
    const xml = await zip.file(name).async('string');
    if (/CSAT \(% SATISFIED\)/i.test(xml)) return [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' | ');
  }
  throw new Error('slide 7 (CSAT) not found');
}

test('no survey figure (nulls) → em dash, no below-target verdict, no "Last known CSAT 0%"', { skip }, async () => {
  const t = await slide7Text({ csat_pct: null, csat_avg_score: null, nps_proxy: null, csat_total_responses: 0, csat_satisfied: 0, csat_neutral: 0, csat_dissatisfied: 0, csat_no_rating: 0 });
  assert.ok(!/\b0%/.test(t), 'no "0%" figure: ' + t);
  assert.ok(!t.includes('below target'), 'no below-target verdict');
  assert.ok(!t.includes('0.0%'), 'no AVG SURVEY SCORE 0.0%');
  assert.ok(!t.includes('Last known CSAT'), 'no "Last known CSAT" sentence');
  assert.ok(t.includes('—'), 'em dash shown');
  assert.ok(t.includes('not measured'), 'says not measured');
});

test('absent keys behave like nulls (older payloads)', { skip }, async () => {
  const t = await slide7Text({ csat_pct: undefined, csat_avg_score: undefined, nps_proxy: undefined, csat_total_responses: 0 });
  assert.ok(!t.includes('below target')); assert.ok(!t.includes('0.0%'));
});

test('a MEASURED 0 % with responses still prints 0 % and its verdict', { skip }, async () => {
  const t = await slide7Text({ csat_pct: 0, csat_avg_score: 20, nps_proxy: null, csat_total_responses: 12, csat_satisfied: 0, csat_dissatisfied: 12 });
  assert.ok(t.includes('0%'), 'measured 0 shown: ' + t);
  assert.ok(t.includes('80.0pp below target'), 'verdict on a measured figure');
  assert.ok(t.includes('20.0%'), 'measured average shown');
});

test('a measured CSAT still renders as before', { skip }, async () => {
  const t = await slide7Text({ csat_pct: 89.4, csat_avg_score: 82.6, nps_proxy: 85, csat_total_responses: 175, csat_satisfied: 144 });
  assert.ok(t.includes('89.4%')); assert.ok(t.includes('above target')); assert.ok(t.includes('+85'));
});

test('browser payload keeps a measured 0 (no `|| null` on survey KPIs)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'public', 'executive-report.html'), 'utf8').replace(/\r\n/g, '\n');
  for (const k of ['csatPct', 'nps', 'prevCsatPct', 'prevNps']) {
    assert.ok(!new RegExp(`csat\\.${k}\\s*\\|\\|\\s*null`).test(src), `csat.${k} || null turns a measured 0 into "not measured"`);
  }
  assert.match(src, /csat_pct:\s+csat\.csatPct \?\? null/);
});
