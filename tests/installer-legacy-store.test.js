'use strict';
// A-01 — Setup must refuse an update of a 1.x installation whose data still lives in SQLite, BEFORE any
// change on disk. Driven by the *_BACKEND flags (unset on a 1.x tree = sqlite); the .db files are only
// evidence: a frozen archive whose module is on PostgreSQL is a warning, never a refusal (the production case).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const SCRIPT = path.join(ROOT, 'tools', 'installer-v2', 'post-install.js');
process.argv.push('--dir', fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-legacy-load-')));
const pi = require(SCRIPT);

function tree({ version = '1.11.0', files = [] } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-legacy-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'x', version }));
  for (const f of files) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), 'SQLite format 3'); }
  return dir;
}
const ALL_PG = { TRACKER_BACKEND: 'postgres', MEETINGS_BACKEND: 'postgres', INSPECTION_BACKEND: 'postgres', REPORTS_BACKEND: 'postgres', ASSETS_BACKEND: 'postgres' };

test('isLegacyTree: 1.x / 0.x versions are legacy, 2.x is not, no package.json is not', () => {
  assert.strictEqual(pi.isLegacyTree(tree({ version: '1.11.0' })), true);
  assert.strictEqual(pi.isLegacyTree(tree({ version: '0.9.0' })), true);
  assert.strictEqual(pi.isLegacyTree(tree({ version: '2.0.0-alpha.14' })), false);
  assert.strictEqual(pi.isLegacyTree(fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-empty-'))), false);
});

test('1.x tree, no *_BACKEND, data/assets.db present: refused, names ASSETS and the file', () => {
  const dir = tree({ files: ['data/assets.db'] });
  const r = pi.legacyStoreProblems({ env: { ...ALL_PG, ASSETS_BACKEND: undefined }, dir, legacy: true });
  assert.strictEqual(r.refuse.length, 1);
  assert.match(r.refuse[0], /ASSETS/);
  assert.match(r.refuse[0], /ASSETS_BACKEND=unset, 1\.x default sqlite/);
  assert.ok(r.refuse[0].includes(path.join(dir, 'data', 'assets.db')), 'the file is named');
});

test('1.x tree, all five on postgres, frozen tracker/meetings/reports.db: no refusal, one warning per archive', () => {
  const dir = tree({ files: ['data/tracker.db', 'data/meetings.db', 'data/reports.db'] });
  const r = pi.legacyStoreProblems({ env: ALL_PG, dir, legacy: true });
  assert.deepStrictEqual(r.refuse, []);
  assert.strictEqual(r.warn.length, 3);
  for (const n of ['tracker.db', 'meetings.db', 'reports.db']) assert.ok(r.warn.some((w) => w.includes(n) && /frozen archive/.test(w)), n);
});

test('1.x tree, ASSETS_BACKEND unset and no assets.db: still refused (unset means sqlite on 1.x)', () => {
  const dir = tree();
  const r = pi.legacyStoreProblems({ env: { TRACKER_BACKEND: 'postgres', MEETINGS_BACKEND: 'postgres', INSPECTION_BACKEND: 'postgres', REPORTS_BACKEND: 'postgres' }, dir, legacy: true });
  assert.strictEqual(r.refuse.length, 1);
  assert.match(r.refuse[0], /^ASSETS still reads SQLite/);
});

test('2.x tree with no *_BACKEND: no refusal (2.0 defaults to postgres)', () => {
  const dir = tree({ version: '2.0.0-alpha.14' });
  const r = pi.legacyStoreProblems({ env: {}, dir, legacy: pi.isLegacyTree(dir) });
  assert.deepStrictEqual(r, { refuse: [], warn: [] });
});

test('TRACKER_BACKEND=SQLite (any case) on a 2.x tree: refused', () => {
  const dir = tree({ version: '2.0.0' });
  const r = pi.legacyStoreProblems({ env: { TRACKER_BACKEND: 'SQLite' }, dir, legacy: false });
  assert.strictEqual(r.refuse.length, 1);
  assert.match(r.refuse[0], /TRACKER still reads SQLite \(TRACKER_BACKEND=SQLite\)/);
});

test('SDP_DATA_DIR outside the app folder is honoured; a root-level legacy tracker.db is detected', () => {
  const dir = tree();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-datadir-'));
  fs.writeFileSync(path.join(data, 'assets.db'), 'x');
  fs.writeFileSync(path.join(dir, 'tracker.db'), 'x');
  fs.mkdirSync(path.join(dir, 'data')); fs.writeFileSync(path.join(dir, 'data', 'reports.db'), 'x');   // not the data dir: ignored
  const r = pi.legacyStoreProblems({ env: { ...ALL_PG, SDP_DATA_DIR: data }, dir, legacy: true });
  assert.deepStrictEqual(r.refuse, []);
  assert.ok(r.warn.some((w) => w.includes(path.join(data, 'assets.db'))));
  assert.ok(r.warn.some((w) => w.includes(path.join(dir, 'tracker.db'))));
  assert.ok(!r.warn.some((w) => w.includes('reports.db')), 'data/ under the app folder is not the data dir here');
});

test('exists is injectable and the file contents are never read', () => {
  const seen = [];
  const r = pi.legacyStoreProblems({ env: {}, dir: '/nowhere', legacy: true, exists: (f) => { seen.push(f); return f.endsWith('assets.db'); } });
  assert.strictEqual(r.refuse.length, 5);
  assert.ok(seen.length >= 8);
});

test('main(): the preflight runs before swapNodeModules and before the sdp-manager update', () => {
  const src = fs.readFileSync(SCRIPT, 'utf8').replace(/\r\n/g, '\n');
  const main = src.slice(src.indexOf('async function main()'));
  const pre = main.indexOf('preflight(envFile)');
  assert.ok(pre > 0, 'preflight(envFile) is called in main()');
  assert.ok(pre < main.indexOf('swapNodeModules(staged)'));
  assert.ok(pre < main.indexOf("mgr, 'update'"));
});

function runPreflight(dir, extra = []) {
  const env = { ...process.env }; delete env.NODE_OPTIONS;
  return spawnSync(process.execPath, [SCRIPT, '--preflight-only', '--dir', dir, '--mode', 'update', ...extra], { encoding: 'utf8', env });
}

test('a refusal leaves .env byte-identical, exits 1, writes setup-last.json ok:false, never touches the service', () => {
  const dir = tree({ files: ['data/assets.db'] });
  const envText = 'PG_URL=postgres://u:secret@h/db\r\nTRACKER_BACKEND=postgres\r\nREPORTS_BACKEND=postgres\r\n';
  fs.writeFileSync(path.join(dir, '.env'), envText);
  const r = runPreflight(dir);
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.strictEqual(fs.readFileSync(path.join(dir, '.env'), 'utf8'), envText);
  const last = JSON.parse(fs.readFileSync(path.join(dir, 'logs', 'setup-last.json'), 'utf8'));
  assert.strictEqual(last.ok, false);
  assert.match(last.error, /ASSETS still reads SQLite/);
  assert.match(last.error, /Nothing was changed\. See docs\/UPGRADE-1x-to-2\.0\.md/);
  assert.match(r.stdout, /nothing was changed/i);
  assert.doesNotMatch(r.stdout, /restart|rolling back|pm2|secret/i);
  assert.ok(!fs.existsSync(path.join(dir, '.rollback')), 'no rollback folder created');
  assert.deepStrictEqual(fs.readdirSync(dir).sort(), ['.env', 'data', 'logs', 'package.json']);
});

test('--ignore-legacy-store turns the refusal into a logged override (exit 0)', () => {
  const dir = tree({ files: ['data/assets.db'] });
  fs.writeFileSync(path.join(dir, '.env'), 'PG_URL=postgres://x\r\n');
  const r = runPreflight(dir, ['--ignore-legacy-store']);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /legacy store check overridden by the operator/);
  assert.match(r.stdout, /ASSETS still reads SQLite/);
});

test('a server already on PostgreSQL with frozen archives passes the preflight (exit 0, warnings logged)', () => {
  const dir = tree({ files: ['data/tracker.db', 'data/assets.db'] });
  fs.writeFileSync(path.join(dir, '.env'), Object.entries(ALL_PG).map(([k, v]) => `${k}=${v}`).join('\r\n') + '\r\n');
  const r = runPreflight(dir);
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /tracker\.db is a frozen archive/);
  assert.ok(!fs.existsSync(path.join(dir, 'logs', 'setup-last.json')));
});

test('.iss: RunPostInstall runs post-install --preflight-only before InstallEmbeddedPg; /IGNORELEGACYSTORE maps to --ignore-legacy-store', () => {
  const iss = fs.readFileSync(path.join(ROOT, 'tools/installer-v2/SDP-Dashboard.iss'), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const code = iss.slice(iss.indexOf('[Code]'));
  const run = code.slice(code.indexOf('procedure RunPostInstall;'));
  const body = run.slice(0, run.indexOf('\nend;\n'));
  const pre = body.indexOf('--preflight-only');
  assert.ok(pre > 0, '--preflight-only is passed in RunPostInstall');
  assert.ok(pre < body.indexOf('InstallEmbeddedPg;'), 'preflight before InstallEmbeddedPg');
  assert.match(body, /if not IsNew then/);
  assert.match(body, /Param\('IGNORELEGACYSTORE', '0'\) = '1'/);
  assert.ok((body.match(/--ignore-legacy-store/g) || []).length >= 2, 'mapped on both Exec calls');
});
