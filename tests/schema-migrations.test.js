'use strict';
// Step 2 (SDP-DASH-2.0) — the schema migrator: pure planning, script discovery, and the static
// rule "the modules change the PostgreSQL schema ONLY through db/migrate.js".
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const M = require('../db/migrate');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

test('checksum ignores line endings', () => {
  assert.equal(M.checksum('a;\r\nb;\r\n'), M.checksum('a;\nb;\n'));
  assert.notEqual(M.checksum('a;'), M.checksum('b;'));
});

test('plan: new → apply, unchanged → skip, edited → reapply', () => {
  const scripts = [{ filename: '001_a.sql', checksum: 'x' }, { filename: '002_b.sql', checksum: 'y' }, { filename: '003_c.sql', checksum: 'z' }];
  const journal = [{ filename: '001_a.sql', checksum: 'x' }, { filename: '002_b.sql', checksum: 'OLD' }];
  assert.deepEqual(M.plan(scripts, journal).map(p => p.action), ['skip', 'reapply', 'apply']);
});

test('every module has numbered scripts, discovered in order', () => {
  for (const m of M.MODULES) {
    const s = M.listScripts(m);
    assert.ok(s.length >= 1, m);
    assert.deepEqual(s.map(x => x.filename), [...s.map(x => x.filename)].sort(), m);
    assert.equal(s[0].filename.slice(0, 3), '001', m);
  }
  assert.ok(M.listScripts('reports').length >= 16);
});

test('no initPg* applies DDL by itself — the migrator is the only path', () => {
  for (const f of ['reports-db.js', 'tracker-db.js', 'meetings-db.js', 'inspection-db.js', 'assets-db.js']) {
    const src = read(f);
    const start = src.indexOf('async function initPg');
    assert.ok(start >= 0, f);
    const body = src.slice(start, src.indexOf('\n}\n', start));
    assert.match(body, /db\/migrate'\)\.migrateModule\(_pg, '/, f + ' calls the migrator');
    assert.doesNotMatch(body, /ALTER TABLE|CREATE TABLE|readFileSync|exec\(SCHEMA\)/, f + ' has no inline DDL');
  }
});

test('assets 002 covers every column sqlite adds through _ADDED_COLS', () => {
  const { _ADDED_COLS } = require('../assets-db');
  const sql = read('db/postgres/assets/002_additive_columns.sql');
  for (const [table, cols] of Object.entries(_ADDED_COLS)) {
    for (const c of cols) assert.match(sql, new RegExp(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${c} TEXT`), `${table}.${c}`);
  }
});

test('every script is written to be re-runnable (idempotent DDL only)', () => {
  for (const m of M.MODULES) {
    for (const s of M.listScripts(m)) {
      const sql = s.sql.replace(/--.*$/gm, '');
      assert.doesNotMatch(sql, /CREATE TABLE (?!IF NOT EXISTS)/i, `${m}/${s.filename}: CREATE TABLE without IF NOT EXISTS`);
      assert.doesNotMatch(sql, /CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/i, `${m}/${s.filename}: CREATE INDEX without IF NOT EXISTS`);
      assert.doesNotMatch(sql, /ADD COLUMN (?!IF NOT EXISTS)/i, `${m}/${s.filename}: ADD COLUMN without IF NOT EXISTS`);
      assert.doesNotMatch(sql, /\bDROP TABLE (?!IF EXISTS)/i, `${m}/${s.filename}: bare DROP TABLE`);
    }
  }
});
