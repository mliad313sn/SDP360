'use strict';
// Step 2 — the backup job: plan/prune are pure; runBackup spawns the dump tool (stubbed here).
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const { runBackup, planBackup, prune } = require('../services/backup');

test('planBackup names the file by UTC stamp; prune keeps the newest N', () => {
  const { file } = planBackup({ dir: '/b', now: new Date('2026-10-19T02:00:00Z') });
  assert.equal(path.basename(file), 'sdp_dashboard_20261019T020000Z.sql');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  for (const d of ['01', '02', '03', '04']) fs.writeFileSync(path.join(dir, `sdp_dashboard_202610${d}T020000Z.sql`), 'x');
  fs.writeFileSync(path.join(dir, 'other.sql'), 'x');
  const gone = prune(dir, { keep: 2 });
  assert.deepEqual(gone, ['sdp_dashboard_20261001T020000Z.sql', 'sdp_dashboard_20261002T020000Z.sql']);
  assert.equal(fs.readdirSync(dir).length, 3);
});

test('runBackup: skips without PG_URL, fails loudly on a bad exit or a tiny file, succeeds and prunes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bk-'));
  assert.deepEqual((await runBackup({ dir, env: {} })).skipped, true);
  await assert.rejects(() => runBackup({ dir, env: { PG_URL: 'x' }, spawn: () => ({ status: 1, stderr: 'pg_dump: boom' }) }), /pg_dump failed/);
  await assert.rejects(() => runBackup({ dir, env: { PG_URL: 'x' }, spawn: (c, a) => { fs.writeFileSync(a[1], 'tiny'); return { status: 0 }; } }), /suspiciously small/);
  // E11: a real dump ends with pg_dump's trailer — the stub writes one (a size-only payload is now refused, see backup-encrypt.test.js).
  const DUMP = 'x'.repeat(5000) + '\n-- PostgreSQL database dump complete\n';
  const out = await runBackup({ dir, keep: 1, env: { PG_URL: 'x' }, spawn: (c, a) => { fs.writeFileSync(a[1], DUMP); return { status: 0 }; }, log: () => {} });
  assert.ok(out.bytes >= 5000);
  assert.ok(out.file.endsWith('.sql.gz'), 'stored gzip-compressed');
  assert.equal(fs.readdirSync(dir).filter((n) => n.startsWith('sdp_dashboard_')).length, 1);
});
