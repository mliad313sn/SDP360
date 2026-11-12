'use strict';
// F-DATA-06 (N6 / DV-08) — Group IT deck: null stays null.
//   server baseline (services/reportPayload.helpdeskBaseline): a rate or a duration the reader could not compute
//   is null (not 0), a delta against an unmeasured side is null; counts of a measured window stay numbers.
//   render.py (tools/exec-pptx): the keys listed in _null_kpis print "—" with no target tick; a payload without
//   the list renders as before. The full render runs only when python + matplotlib + python-pptx are present.
const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const rp = require('../services/reportPayload');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'exec-pptx');

test('baseline: null SLA / first reply / duration stay null — never 0; counts of the measured month stay numbers', () => {
  const b = rp.helpdeskBaseline({ inbound: 12, closed: 0, close_pct: 0, sla_res_pct: null, sla_reply_pct: null, avg_resolution_d: null, avg_tta_h: null, avg_first_reply_h: null }, null);
  assert.strictEqual(b.total, 12); assert.strictEqual(b.closed, 0);
  assert.strictEqual(b.closure_rate, 0, 'a measured 0 % stays 0');
  for (const k of ['sla_compliance', 'frt_sla', 'avg_res_days', 'time_to_assign_h', 'first_reply_h']) assert.strictEqual(b[k], null, k);
});

test('baseline: site not measured (reader → null) gives no rate at all', () => {
  const b = rp.helpdeskBaseline(null, null);
  for (const k of rp.NULLABLE_KPIS) assert.strictEqual(b[k], null, k);
  for (const k of ['total_delta_pct', 'closed_delta_pct', 'closure_rate_delta_pp', 'sla_compliance_delta_pp', 'frt_sla_delta_pp']) assert.strictEqual(b[k], null, k);
});

test('baseline: a delta needs both sides — null when either is unmeasured, never "x − 0"', () => {
  const cur = { inbound: 50, closed: 40, close_pct: 80, sla_res_pct: 91.5, sla_reply_pct: null };
  const b = rp.helpdeskBaseline(cur, { inbound: 40, closed: 0, close_pct: 0, sla_res_pct: null, sla_reply_pct: 70 });
  assert.strictEqual(b.sla_compliance_delta_pp, null, 'previous SLA unmeasured: was 91.5 − 0 = +91.5 pp');
  assert.strictEqual(b.frt_sla_delta_pp, null, 'current first-reply unmeasured: was 0 − 70 = −70 pp');
  assert.strictEqual(b.closure_rate_delta_pp, 80);
  assert.strictEqual(b.total_delta_pct, 25);
  assert.strictEqual(b.closed_delta_pct, null, 'no % change from a base of 0');
  const both = rp.helpdeskBaseline(cur, { inbound: 40, closed: 30, close_pct: 75, sla_res_pct: 90, sla_reply_pct: 70 });
  assert.strictEqual(both.sla_compliance_delta_pp, 1.5);
});

test('markNullKpis: lists what nobody measured after the browser merge; a browser value removes the key', () => {
  const e = rp.mergeBrowserKpis(rp.helpdeskBaseline(null, null), { sla_res_pct: 88.2 });
  rp.markNullKpis(e);
  assert.deepStrictEqual(e._null_kpis, ['closure_rate', 'frt_sla', 'avg_res_days']);
  const full = rp.markNullKpis({ closure_rate: 1, sla_compliance: 2, frt_sla: 3, avg_res_days: 4 });
  assert.ok(!('_null_kpis' in full));
});

const py = (() => { for (const b of ['python3', 'python']) { const r = spawnSync(b, ['-c', 'print(1)'], { encoding: 'utf8' }); if (r && r.status === 0) return b; } return null; })();

test('kpi_fmt: a listed null prints "—" with no tick; unlisted keys and old payloads print as before', { skip: py ? false : 'python not available' }, () => {
  const code = [
    'import sys, json', `sys.path.insert(0, ${JSON.stringify(TOOL)})`, 'from kpi_fmt import null_kpis, pct_text, num_text, verdict_mark, unknown_kpis',
    "K = {'sla_compliance': None, 'frt_sla': None, 'avg_res_days': None, 'closure_rate': 80.0, '_null_kpis': ['sla_compliance', 'avg_res_days']}",
    "u = unknown_kpis(K); K['_null_set'] = null_kpis(K)",
    "for k, v in {'sla_compliance': 0.0, 'frt_sla': 0.0, 'avg_res_days': 0}.items():\n    if K.get(k) is None: K[k] = v",
    "old = {'sla_compliance': 0.0, 'avg_res_days': 0}; old['_null_set'] = null_kpis(old)",
    "print(json.dumps([pct_text(K, 'sla_compliance', u), verdict_mark(K, 'sla_compliance', False), num_text(K, 'avg_res_days', 'd'), pct_text(K, 'frt_sla', u), pct_text(K, 'closure_rate', u), verdict_mark(K, 'closure_rate', True), pct_text(old, 'sla_compliance', set()), num_text(old, 'avg_res_days', 'd')]))",
  ].join('\n');
  const r = spawnSync(py, ['-c', code], { encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(JSON.parse(r.stdout), ['—', '', '—', '0.0%', '80.0%', '✓', '0.0%', '0d'],
    'frt_sla is None but NOT listed (A-17b flag off): today\'s text; an old payload is untouched');
});

const full = py && spawnSync(py, ['-c', 'import matplotlib, pptx, PIL'], { encoding: 'utf8' }).status === 0;
test('render.py: a payload whose SLA is null shows "—" on the SLA tiles, not "0.0%" and not "100.0%" violations', { skip: full ? false : 'python with matplotlib + python-pptx + PIL not available' }, async () => {
  // staged copy next to placeholder brand images (the real ones are not in the repository)
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'exec-null-'));
  const toolDir = path.join(tmp, 'tools', 'exec-pptx'); const assetDir = path.join(tmp, 'public', 'brand', 'exec-pptx');
  fs.mkdirSync(toolDir, { recursive: true }); fs.mkdirSync(assetDir, { recursive: true });
  for (const f of fs.readdirSync(TOOL).filter((x) => x.endsWith('.py'))) fs.copyFileSync(path.join(TOOL, f), path.join(toolDir, f));
  const mk = spawnSync(py, ['-c', "import sys\nfrom PIL import Image\nImage.new('RGB', (1600, 200), (31, 61, 92)).save(sys.argv[1], 'JPEG')\nImage.new('RGBA', (200, 200), (232, 119, 34, 255)).save(sys.argv[2], 'PNG')", path.join(assetDir, 'em_banner.jpg'), path.join(assetDir, 'left_corner.png')], { encoding: 'utf8' });
  assert.strictEqual(mk.status, 0, mk.stderr);
  const K = JSON.parse(fs.readFileSync(path.join(TOOL, 'fixtures', 'kpis-may.json'), 'utf8'));
  const texts = async (payload) => {
    const r = spawnSync(py, [path.join(toolDir, 'render.py')], { input: JSON.stringify(payload), cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
    assert.strictEqual(r.status, 0, 'render.py: ' + (r.stderr ? r.stderr.toString().slice(-800) : ''));
    const zip = await JSZip.loadAsync(r.stdout); const out = {};
    for (const n of Object.keys(zip.files).filter((x) => /^ppt\/slides\/slide\d+\.xml$/.test(x))) out[n.match(/slide(\d+)/)[1]] = [...(await zip.file(n).async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]);
    return out;
  };
  const nul = { ...K, sla_compliance: null, sla_compliance_delta_pp: null, commentary: { ...(K.commentary || {}), exec: '', sla: '' } };
  rp.markNullKpis(nul);
  assert.ok(nul._null_kpis.includes('sla_compliance'));
  const t = await texts(nul);
  const all = Object.values(t);
  const s3 = all.find((x) => x.includes('SLA COMPLIANCE (RES)')); assert.ok(s3, 'the overview slide carries the SLA tile');
  const i = s3.indexOf('SLA COMPLIANCE (RES)');
  const around = s3.slice(Math.max(0, i - 3), i + 4).join(' | ');
  assert.ok(around.includes('—'), 'em dash next to the SLA tile: ' + around);
  assert.ok(!/(^| )0\.0%/.test(around) && !/[✓⚠]/.test(around), 'no fake 0 % and no target verdict: ' + around);
  const v = s3.indexOf('SLA VIOLATIONS'); assert.ok(!s3.slice(Math.max(0, v - 3), v + 4).includes('100.0%'), 'violations are not 100 % of nothing');
  assert.ok(s3.some((x) => /Resolution SLA\s+not measured/.test(x)), 'the commentary says not measured');
  assert.ok(all.some((sl) => sl.some((x) => /Resolution SLA not measured this period/.test(x))), 'trend slide commentary');
  // the same fixture WITH its SLA keeps a number and a verdict (nothing changed for measured payloads)
  const ok = await texts({ ...K, commentary: { ...(K.commentary || {}), exec: '', sla: '' } });
  const o3 = Object.values(ok).find((x) => x.includes('SLA COMPLIANCE (RES)')); const j = o3.indexOf('SLA COMPLIANCE (RES)');
  assert.ok(/\d%/.test(o3.slice(Math.max(0, j - 3), j + 4).join(' ')) && /[✓⚠]/.test(o3.slice(Math.max(0, j - 3), j + 4).join(' ')));
});
