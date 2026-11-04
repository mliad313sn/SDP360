'use strict';

// Python exec-pptx renderer smoke test (audit 5.5).
// Feeds the canonical fixture (tools/exec-pptx/fixtures/kpis-may.json) to
// render.py over stdin (its real contract — server.js does the same) and
// asserts a non-empty, valid .pptx comes back on stdout.
//
// SKIPS GRACEFULLY when python / matplotlib / python-pptx aren't installed,
// so the suite stays green on machines without the Python toolchain.

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs   = require('fs');
const path = require('path');
const JSZip = require('jszip');

const ROOT    = path.join(__dirname, '..');
const RENDER  = path.join(ROOT, 'tools', 'exec-pptx', 'render.py');
const FIXTURE = path.join(ROOT, 'tools', 'exec-pptx', 'fixtures', 'kpis-may.json');

// Find a python that can import the renderer's deps; null => skip.
function findPython() {
  for (const bin of ['python', 'python3', 'py']) {
    try {
      const r = spawnSync(bin, ['-c', 'import matplotlib, pptx'], { encoding: 'utf8' });
      if (r && r.status === 0) return bin;
    } catch (_) { /* try next */ }
  }
  return null;
}
const PY = findPython();
const skip = PY ? false : 'python with matplotlib + python-pptx not available';

test('render.py turns the May fixture into a non-empty, valid PPTX', { skip }, async () => {
  assert.ok(fs.existsSync(RENDER),  'render.py missing');
  assert.ok(fs.existsSync(FIXTURE), 'fixture missing');
  const input = fs.readFileSync(FIXTURE);
  const r = spawnSync(PY, [RENDER], { input, cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  assert.strictEqual(r.status, 0,
    'render.py exited non-zero. stderr: ' + (r.stderr ? r.stderr.toString().slice(0, 800) : '(none)'));
  const buf = r.stdout;
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0, 'render.py produced no stdout');
  assert.strictEqual(buf.slice(0, 2).toString('latin1'), 'PK', 'stdout is not a .pptx zip');
  const zip  = await JSZip.loadAsync(buf);
  const pres = zip.file('ppt/presentation.xml');
  assert.ok(pres, 'missing ppt/presentation.xml');
  assert.match(await pres.async('string'), /sldId/, 'presentation.xml has no slides');
});

// A-17b — unknown verdict KPIs print an em dash only when the payload asks for it
// (_unknown_as_dash, exec_payload_zero_policy=browser_wins); the default path formats
// exactly as before (f"{v:.1f}%"). The helper is pure Python (no matplotlib / pptx), so
// this runs wherever a python3 exists.
function findPlainPython() {
  for (const bin of ['python3', 'python', 'py']) {
    try { const r = spawnSync(bin, ['-c', 'print(1)'], { encoding: 'utf8' }); if (r && r.status === 0) return bin; } catch (_) { /* next */ }
  }
  return null;
}
const PLAIN = findPlainPython();
test('kpi_fmt: em dash for unknown KPIs only under _unknown_as_dash; default prints 0.0% as today',
  { skip: PLAIN ? false : 'no python interpreter' }, () => {
    const code = [
      'import json, sys',
      `sys.path.insert(0, ${JSON.stringify(path.join(ROOT, 'tools', 'exec-pptx'))})`,
      'from kpi_fmt import unknown_kpis, pct_text',
      "K = {'fcr_rate': None, 'sla_compliance': 91.24, 'frt_sla': None}",
      'U = unknown_kpis(K)',
      "K.update({'fcr_rate': 0.0, 'frt_sla': 0.0})",
      "out = {'unknown': sorted(U),",
      "  'default_fcr': pct_text(K, 'fcr_rate', U), 'default_sla0': pct_text(K, 'sla_compliance', U, '.0f'),",
      "  'default_sla': pct_text(K, 'sla_compliance', U)}",
      "K['_unknown_as_dash'] = True",
      "out.update({'dash_fcr': pct_text(K, 'fcr_rate', U), 'dash_frt': pct_text(K, 'frt_sla', U),",
      "  'dash_sla': pct_text(K, 'sla_compliance', U)})",
      'print(json.dumps(out))',
    ].join('\n');
    const r = spawnSync(PLAIN, ['-c', code], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
    const o = JSON.parse(r.stdout);
    assert.deepStrictEqual(o.unknown, ['fcr_rate', 'frt_sla']);
    assert.strictEqual(o.default_fcr, '0.0%');
    assert.strictEqual(o.default_sla, '91.2%');
    assert.strictEqual(o.default_sla0, '91%');
    assert.strictEqual(o.dash_fcr, '—');
    assert.strictEqual(o.dash_frt, '—');
    assert.strictEqual(o.dash_sla, '91.2%', 'a known value still prints');
  });
