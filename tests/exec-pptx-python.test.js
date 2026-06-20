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
