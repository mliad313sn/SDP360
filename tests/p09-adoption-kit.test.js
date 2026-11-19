'use strict';
// P09 — the adoption kit stays in step with its sources: the page inventory (INVENTORY.json + profiles + French
// coverage lists) and the per-profile training sheets (help.html + profile task list) are regenerated, never edited.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { spawnSync } = require('child_process');
const ROOT = path.join(__dirname, '..');
const run = (f) => spawnSync(process.execPath, [path.join(ROOT, 'tools/agent', f), '--check'], { cwd: ROOT, encoding: 'utf8' });

test('docs/agent-execution/P09-PAGE-INVENTORY.md is up to date (node tools/agent/p09-page-inventory.js)', () => {
  const r = run('p09-page-inventory.js'); assert.equal(r.status, 0, r.stderr);
});
test('docs/ops/pilot/training/*.md are up to date (node tools/agent/p09-training.js), one per profile, no result pre-filled', () => {
  const r = run('p09-training.js'); assert.equal(r.status, 0, r.stderr);
  const { PROFILE_TASKS } = require('./e2e/fixtures/profile-tasks');
  const WP = require('../public/lib/workspaceProfiles');
  assert.deepEqual(PROFILE_TASKS.map((p) => p.id).sort(), WP.PROFILES.map((p) => p.id).sort(), 'one task list per profile');
  for (const p of PROFILE_TASKS) assert.equal(p.tasks.length, 3, p.id);
});
