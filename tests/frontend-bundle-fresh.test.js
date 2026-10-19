'use strict';
// Step 5 — the committed esbuild bundle must match its source (the server serves dist/, not App.jsx).
const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

test('npm run build:check — public/activity-tracker/dist is up to date', () => {
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'build', 'build-frontend.js'), '--check'], { encoding: 'utf8' });
  assert.equal(r.status, 0, (r.stdout + r.stderr).trim());
});
