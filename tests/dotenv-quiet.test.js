'use strict';
// G2-PLATFORM (2026-11-12) — dotenv 17+ prints `◇ injected env (N) from .env` to the console at
// every config() unless `quiet: true`. Every load in the shipped code passes quiet: a scheduled
// CLI's output (Task Scheduler logs, pm2 logs) must carry its own lines, not a banner per run.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
function shippedJs() {
  const out = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', 'tests', 'docs', '.git', 'public', 'e2e-artifacts'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (/\.(c|m)?js$/.test(e.name)) out.push(p);
  } };
  walk(ROOT); return out;
}

test('every dotenv load in the shipped code passes quiet: true', () => {
  const calls = [], loud = [];
  for (const f of shippedJs()) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /require\(['"]dotenv['"]\)\.config\(([^)]*)\)/g; let m;
    while ((m = re.exec(src))) { calls.push(f); if (!/quiet:\s*true/.test(m[1])) loud.push(path.relative(ROOT, f)); }
  }
  assert.ok(calls.length >= 40, `expected the CLI fleet, saw ${calls.length} dotenv loads`);
  assert.deepEqual(loud, [], 'dotenv loads without quiet: true');
});

test('the installed dotenv stays silent with quiet: true and loads the value', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dotenv-quiet-'));
  fs.writeFileSync(path.join(dir, '.env'), 'G2_PROBE=ok\n');
  const code = `require(${JSON.stringify(require.resolve('dotenv'))}).config({ quiet: true, path: ${JSON.stringify(path.join(dir, '.env'))} }); process.stdout.write(process.env.G2_PROBE || 'missing');`;
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8', env: { PATH: process.env.PATH } });
  assert.equal(r.stdout, 'ok');
  assert.equal(r.stderr, '');
});
