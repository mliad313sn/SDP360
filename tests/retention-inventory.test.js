'use strict';
// E-S06 — the retention inventory is generated from code: --check fails when stale, every soft-deletable table
// (services/softDelete.TABLES) appears, every cited source exists, and owner / legal duration stay UNKNOWN.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const inv = require('../tools/security/retention-inventory');
const sd = require('../services/softDelete');

const ROOT = path.join(__dirname, '..');
const TOOL = path.join(ROOT, 'tools', 'security', 'retention-inventory.js');

test('the committed RETENTION-INVENTORY.md matches the code', () => {
  assert.equal(fs.readFileSync(inv.OUT, 'utf8').replace(/\r\n/g, '\n'), inv.render(), 'run: node tools/security/retention-inventory.js');
});

test('every soft-deletable table appears; every cited source file exists', () => {
  const md = inv.render();
  for (const t of Object.keys(sd.TABLES)) assert.ok(md.includes('`' + t + '`'), t);
  for (const r of inv.rows()) assert.ok(fs.existsSync(path.join(ROOT, r.source)), r.source);
});

test('owner and legal duration are UNKNOWN on every row — nothing invented', () => {
  const lines = inv.render().split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Object') && !l.startsWith('|---'));
  assert.equal(lines.length, inv.rows().length);
  for (const l of lines) assert.match(l, /\| UNKNOWN \| UNKNOWN \|$/);
});

test('--check exits 1 when the file is stale, 0 when fresh', () => {
  const orig = fs.readFileSync(inv.OUT, 'utf8');
  try {
    fs.writeFileSync(inv.OUT, orig + '\nstale\n');
    assert.throws(() => execFileSync(process.execPath, [TOOL, '--check'], { stdio: 'pipe', env: { PATH: process.env.PATH } }));
  } finally { fs.writeFileSync(inv.OUT, orig); }
  execFileSync(process.execPath, [TOOL, '--check'], { stdio: 'pipe', env: { PATH: process.env.PATH } });
});
