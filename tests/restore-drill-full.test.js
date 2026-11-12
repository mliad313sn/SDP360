'use strict';
// F-ARCH-05 — full-service restore drill: files + keys + timing. Pure steps first (a missing key is a
// FAILED step, an empty recovery-time target is UNKNOWN and never "met", a blob mismatch fails), then
// the real drill on PostgreSQL with a file store, its backup copy and an encrypted config secret.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'); const os = require('os'); const path = require('path');
const D = require('../services/restoreDrill');
const RC = require('../services/reportConfig');

test('switches ship at today\'s behaviour: restore_drill_full = 0, restore_rto_minutes empty', () => {
  assert.equal(RC.DEFAULTS.restore_drill_full, '0');
  assert.equal(RC.DEFAULTS.restore_rto_minutes, '');
});

test('missing key → failed step; a key that is set but not exercised is UNKNOWN, never ok', () => {
  assert.equal(D.backupKeyStep({ keySet: false, encrypted: false, opened: true }).status, 'failed');
  assert.equal(D.backupKeyStep({ keySet: true, encrypted: false, opened: true }).status, 'unknown');
  assert.equal(D.backupKeyStep({ keySet: true, encrypted: true, opened: false }).status, 'failed');
  assert.equal(D.backupKeyStep({ keySet: true, encrypted: true, opened: true }).status, 'ok');
  assert.equal(D.configKeyStep({ keySet: false, boxes: 2, opened: 0 }).status, 'failed');
  assert.equal(D.configKeyStep({ keySet: true, boxes: null }).status, 'unknown');
  assert.equal(D.configKeyStep({ keySet: true, boxes: 0, opened: 0 }).status, 'unknown', 'nothing to decrypt proves nothing');
  assert.equal(D.configKeyStep({ keySet: true, boxes: 2, opened: 1 }).status, 'failed', 'wrong key');
  assert.equal(D.configKeyStep({ keySet: true, boxes: 2, opened: 2 }).status, 'ok');
});

test('empty RTO → UNKNOWN (never "met"); a set target is met or exceeded on the measured duration', () => {
  for (const v of ['', '  ', null, undefined, 'abc', '0', '-5']) {
    const s = D.rtoStep(1000, v);
    assert.equal(s.status, 'unknown', `target ${JSON.stringify(v)}`);
    assert.equal(s.target_minutes, null);
    assert.ok(!/within|met/i.test(s.detail));
  }
  assert.equal(D.rtoStep(59000, '1').status, 'ok');
  assert.equal(D.rtoStep(61000, '1').status, 'failed');
  assert.equal(D.rtoStep(null, '30').status, 'unknown', 'no measured duration is not a pass');
});

test('blob mismatch → failed (and the run verdict is not ok); no backup copy → UNKNOWN', () => {
  const live = [{ ref: 'inspection/A/p1.jpg', sha256: 'aa', size: 3 }, { ref: 'field/u1/x.png', sha256: 'bb', size: 4 }];
  const same = D.compareBlobs(live, { 'inspection/A/p1.jpg': { sha256: 'aa', size: 3 }, 'field/u1/x.png': { sha256: 'bb', size: 4 } });
  assert.deepEqual([same.status, same.checked], ['ok', 2]);
  const diff = D.compareBlobs(live, { 'inspection/A/p1.jpg': { sha256: 'ZZ', size: 3 } });
  assert.equal(diff.status, 'failed');
  assert.deepEqual([diff.different, diff.missing], [['inspection/A/p1.jpg'], ['field/u1/x.png']]);
  assert.equal(D.compareBlobs(live, null).status, 'unknown');
  assert.equal(D.compareBlobs(null, {}).status, 'unknown');
  assert.equal(D.compareBlobs([], {}).status, 'ok', 'an empty store measured against a copy is a measured match');
  assert.equal(D.compareUploadRefs(['field/u1/x.png'], {}).status, 'failed');
  assert.equal(D.compareUploadRefs(['field/u1/x.png'], { 'field/u1/x.png': {} }).status, 'ok');
  assert.equal(D.compareUploadRefs(null, {}).status, 'unknown');
  assert.equal(D.compareUploadRefs(['a'], null).status, 'unknown');

  const v = D.fullVerdict([{ id: 'database', status: 'ok' }, diff]);
  assert.deepEqual([v.ok, v.complete, v.failed], [false, false, ['blobs']]);
  const u = D.fullVerdict([{ id: 'database', status: 'ok' }, D.rtoStep(10, '')]);
  assert.deepEqual([u.ok, u.complete, u.unknown], [true, false, ['rto']]);
  assert.equal(D.fullVerdict([{ id: 'database', status: 'ok' }]).complete, true);
  assert.equal(D.sampleEvenly([...Array(1000).keys()], 10).length, 10);
  assert.deepEqual(D.sampleEvenly([1, 2, 3], 10), [1, 2, 3]);
});

test('report: FAIL when a full step failed, NOT PROVEN when one is unknown, and no secret value anywhere', () => {
  const cmp = D.compareCounts({ users: 3 }, { users: 3 }, ['users']);
  const steps = [{ id: 'database', label: 'Database row counts', status: 'ok', detail: '1 tables compared' },
    D.backupKeyStep({ keySet: true, encrypted: true, opened: true }), D.configKeyStep({ keySet: true, boxes: 1, opened: 1 }),
    D.compareBlobs([], {}), D.compareUploadRefs([], {}), D.rtoStep(1500, '')];
  const md = D.renderReport({ date: '2026-11-12', comparison: cmp, encrypted: true, full: { steps } });
  assert.match(md, /\*\*Result: PASS\*\*/);
  assert.match(md, /\*\*Full-service result: NOT PROVEN\*\*/);
  assert.match(md, /UNKNOWN \| no recovery-time target is set/);
  assert.ok(!/Full-service result: PASS/.test(md));
  const bad = D.renderReport({ date: '2026-11-12', comparison: cmp, encrypted: true, full: { steps: [...steps.slice(0, 3), D.compareBlobs([{ ref: 'a/b/c.jpg', sha256: 'x', size: 1 }], {})] } });
  assert.match(bad, /\*\*Result: FAIL\*\* — the database matches, but a full-service step failed/);
  assert.match(bad, /blobs — missing: `a\/b\/c\.jpg`/);
  const det = D.logDetails({ date: '2026-11-12', comparison: cmp, full: { steps: [...steps.slice(0, 3), D.compareBlobs([{ ref: 'a/b/c.jpg', sha256: 'x', size: 1 }], {})] } });
  assert.deepEqual([det.ok, det.full.ok, det.full.steps.blobs], [false, false, 'failed']);
  assert.equal(D.logDetails({ date: 'x', comparison: cmp }).full, undefined, 'database-only drill: log row unchanged');
  assert.ok(!D.renderReport({ date: 'x', comparison: cmp }).includes('Full-service'), 'database-only report unchanged');
});

// ── PostgreSQL: the full drill end to end ──────────────────────────────────────────────────
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
test('PG: --full proves files + both keys; a tampered copy, a wrong config key or an exceeded target FAIL; default stays database-only', async (t) => {
  const ctx = await provisionTestDb();
  if (!ctx || ctx.schema) { t.skip(ctx ? 'needs a throwaway DATABASE (PG_ADMIN_URL with CREATEDB) to dump cleanly' : 'PostgreSQL unreachable'); return; }
  const { Client } = require('pg');
  const secrets = require('../services/configSecrets');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'drillfull-'));
  const CFG = 'drill-test-config-passphrase-2026', BK = 'drill-test-backup-passphrase-2026';
  const SECRET = 'smtp-password-that-must-never-be-printed';
  try {
    const blobRoot = path.join(tmp, 'live', 'blobs'), copy = path.join(tmp, 'copy', 'blobs');
    for (const root of [blobRoot, copy]) {
      fs.mkdirSync(path.join(root, 'inspection', 'EM-1'), { recursive: true }); fs.mkdirSync(path.join(root, 'field', 'u7'), { recursive: true });
      fs.writeFileSync(path.join(root, 'inspection', 'EM-1', 'net-04-0.jpg'), 'photo-bytes');
      fs.writeFileSync(path.join(root, 'field', 'u7', '1-abc.jpg'), 'upload-bytes');
    }
    const c = new Client({ connectionString: ctx.url }); await c.connect();
    await c.query('CREATE TABLE users (id serial primary key, name text); CREATE TABLE report_config (key text primary key, value text); CREATE TABLE field_uploads (id serial primary key, status text, ref text)');
    await c.query("INSERT INTO users (name) VALUES ('a'), ('b')");
    await c.query('INSERT INTO report_config (key, value) VALUES ($1, $2)', ['smtp_pass', secrets.encryptValue(SECRET, secrets.keyFrom(CFG), { keyName: 'smtp_pass' })]);
    await c.query("INSERT INTO field_uploads (status, ref) VALUES ('done', 'field/u7/1-abc.jpg'), ('open', NULL)");
    await c.end();

    const drill = require('../tools/pg/restore-drill');
    const env = { ...process.env, PG_URL: ctx.url, PG_ADMIN_URL: ctx.adminUrl, SDP_BACKUP_KEY: BK, SDP_CONFIG_KEY: CFG };
    delete env.SDP_BLOB_BACKUP_DIR;
    const base = { env, dir: tmp, logEvent: () => {}, log: () => {}, actor: 'test', blobRoot };
    const lines = [];

    // default (switch absent/0): database-only, exactly as before
    const plain = await drill.run({ ...base, reportDir: path.join(tmp, 'r0'), backupFirst: true });
    assert.equal(plain.ok, true); assert.equal(plain.full, undefined);
    assert.ok(!fs.readFileSync(plain.reportFile, 'utf8').includes('Full-service'));

    // full, everything provided, no RTO target → ok but NOT complete (rto unknown)
    const out = await drill.run({ ...base, reportDir: path.join(tmp, 'r1'), full: true, blobBackup: copy, log: (m) => lines.push(m) });
    const st = Object.fromEntries(out.full.steps.map((s) => [s.id, s.status]));
    assert.deepEqual(st, { database: 'ok', backup_key: 'ok', config_key: 'ok', blobs: 'ok', field_uploads: 'ok', rto: 'unknown' });
    assert.deepEqual([out.full.ok, out.full.complete], [true, false]);
    const md = fs.readFileSync(out.reportFile, 'utf8');
    assert.match(md, /Full-service result: NOT PROVEN/);
    assert.ok(![md, lines.join('\n'), JSON.stringify(out)].some((x) => x.includes(SECRET) || x.includes(CFG) || x.includes(BK)), 'no secret or key in the report, the log or the result');

    // the switch drives the monthly job (run() with no explicit `full`)
    const lc = new Client({ connectionString: ctx.url }); await lc.connect();
    await lc.query("INSERT INTO report_config (key, value) VALUES ('restore_drill_full', '1'), ('restore_rto_minutes', '60')"); await lc.end();
    const viaSwitch = await drill.run({ ...base, reportDir: path.join(tmp, 'r2'), blobBackup: copy, backupFirst: true });
    assert.deepEqual([viaSwitch.full.ok, viaSwitch.full.complete], [true, true], 'all six steps exercised with a target set');
    assert.match(fs.readFileSync(viaSwitch.reportFile, 'utf8'), /Full-service result: PASS/);

    // no backup copy → UNKNOWN, not a failure and not a pass
    const noCopy = await drill.run({ ...base, reportDir: path.join(tmp, 'r3'), full: true });
    assert.deepEqual([noCopy.full.ok, noCopy.full.complete], [true, false]);
    assert.ok(noCopy.full.unknown.includes('blobs') && noCopy.full.unknown.includes('field_uploads'));

    // tampered copy → FAIL (rejects → CLI exit 1)
    fs.writeFileSync(path.join(copy, 'inspection', 'EM-1', 'net-04-0.jpg'), 'tampered!!!');
    await assert.rejects(() => drill.run({ ...base, reportDir: path.join(tmp, 'r4'), full: true, blobBackup: copy }),
      (e) => /full-service step\(s\) blobs failed/.test(e.message) && e.result.ok === false && e.transient === false);
    fs.writeFileSync(path.join(copy, 'inspection', 'EM-1', 'net-04-0.jpg'), 'photo-bytes');

    // a completed upload whose file is not in the copy → FAIL
    fs.rmSync(path.join(copy, 'field', 'u7', '1-abc.jpg'));
    await assert.rejects(() => drill.run({ ...base, reportDir: path.join(tmp, 'r5'), full: true, blobBackup: copy }), /blobs, field_uploads failed/);
    fs.writeFileSync(path.join(copy, 'field', 'u7', '1-abc.jpg'), 'upload-bytes');

    // wrong / missing config key → FAIL
    await assert.rejects(() => drill.run({ ...base, env: { ...env, SDP_CONFIG_KEY: 'another-passphrase-of-enough-length' }, reportDir: path.join(tmp, 'r6'), full: true, blobBackup: copy }), /config_key failed/);
    const noKey = { ...env }; delete noKey.SDP_CONFIG_KEY;
    await assert.rejects(() => drill.run({ ...base, env: noKey, reportDir: path.join(tmp, 'r7'), full: true, blobBackup: copy }), /config_key failed/);

    // a target that cannot be met → FAIL
    const targets = [out.target.name];
    await assert.rejects(() => drill.run({ ...base, reportDir: path.join(tmp, 'r8'), full: true, blobBackup: copy, rtoMinutes: '0.000001' }),
      (e) => { targets.push(e.result.target.name); return /rto failed/.test(e.message); });

    const a = new Client({ connectionString: ctx.adminUrl }); await a.connect();
    const left = await a.query('SELECT datname FROM pg_database WHERE datname = ANY($1)', [targets]); await a.end();
    assert.equal(targets.length, 2); assert.equal(left.rows.length, 0, 'the disposable targets were dropped, including after a failed run');
  } finally { await dropTestDb(ctx); fs.rmSync(tmp, { recursive: true, force: true }); }
});
