'use strict';
// Every tools/reports CLI must load .env before any *-db module is required, or a
// standalone prod run (Task Scheduler) reads the frozen SQLite archives (2026-09-21).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');

const dir = path.join(__dirname, '..', 'tools', 'reports');
for (const f of fs.readdirSync(dir).filter(n => n.endsWith('.js'))) {
  test(`${f} loads .env before its first require`, () => {
    const src = fs.readFileSync(path.join(dir, f), 'utf8');
    const dot = src.indexOf("if (require.main === module) require('dotenv').config(");
    assert.ok(dot >= 0, 'guarded dotenv load present');
    const firstReq = src.search(/require\(['"]\.\.\/\.\.\//);
    assert.ok(firstReq === -1 || dot < firstReq, 'dotenv loads before any app module');
  });
}
