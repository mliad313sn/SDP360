'use strict';
// P08 §4 — count-and-sum reconciliation tool: pure comparison on a FICTITIOUS export, and every source SELECT
// executed against the throwaway PostgreSQL test database (read-only use) so the sheet works on the real schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const R = require('../tools/kpi/reconcile-source');

test('monthOf reads the Zoho export date shapes and refuses the rest (never guessed)', () => {
  assert.equal(R.monthOf('2026-06-04T10:00:00Z'), '2026-06');
  assert.equal(R.monthOf('04 Jun 2026 10:00 AM'), '2026-06');
  assert.equal(R.monthOf('Jun 4, 2026 10:00 AM'), '2026-06');
  assert.equal(R.monthOf('04/06/2026'), '2026-06');
  assert.equal(R.monthOf('yesterday'), null);
  assert.equal(R.monthOf(''), null);
});

test('compare: match, count difference, missing on each side, unreadable rows counted (FIXTURE)', () => {
  const exp = [
    { 'Created Time': '2026-06-01', Group: 'FX Agents', 'Reopen Count': '1' },
    { 'Created Time': '2026-06-02', Group: 'FX Agents', 'Reopen Count': '0' },
    { 'Created Time': '2026-06-03', Group: 'FX Other', 'Reopen Count': '' },
    { 'Created Time': '2026-07-01', Group: 'FX Agents', 'Reopen Count': '2' },
    { 'Created Time': 'not a date', Group: 'FX Agents', 'Reopen Count': '0' },
  ];
  const db = [{ key: '2026-06 | fx agents', n: 2, s: 1 }, { key: '2026-06 | fx other', n: 2, s: 0 }, { key: '2026-08 | fx agents', n: 4, s: 0 }];
  const r = R.compare(exp, db, R.SOURCES.sdp_requests);
  const by = Object.fromEntries(r.rows.map((x) => [x.key, x.status]));
  assert.equal(by['2026-06 | fx agents'], 'match');
  assert.equal(by['2026-06 | fx other'], 'count_differs');
  assert.equal(by['2026-07 | fx agents'], 'missing_in_sdp360');
  assert.equal(by['2026-08 | fx agents'], 'only_in_sdp360');
  assert.equal(r.totals.unreadable_export_rows, 1);
  assert.match(r.verdict, /DIFFERENCES/);
  // an empty sum cell is unknown on that side, not 0
  assert.equal(r.rows.find((x) => x.key === '2026-06 | fx other').source_sum, null);
  const csv = R.sheet(r);
  assert.ok(csv.startsWith('﻿key,source_count,sdp360_count,delta_count,source_sum,sdp360_sum,delta_sum,status\r\n'));
});

test('a clean export reconciles', () => {
  const r = R.compare([{ Site: 'FX Mine', 'Purchase Cost($)': '1,000.00' }, { Site: 'fx mine', 'Purchase Cost($)': '500' }], [{ key: 'fx mine', n: 2, s: 1500 }], R.SOURCES.assets);
  assert.equal(r.verdict, 'RECONCILED');
});

test('every source SELECT runs on the PostgreSQL schema and the CLI writes the sheet', async () => {
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.PG_URL }); await c.connect();
  try {
    await c.query("INSERT INTO request_records (request_id, created_time, tech_group, reopen_count) VALUES ('fx-1','2026-06-01T10:00:00Z','FX Agents',1),('fx-2','2026-06-02T10:00:00Z','FX Agents',0)");
    for (const [k, s] of Object.entries(R.SOURCES)) { const rows = (await c.query(s.sql)).rows; assert.ok(Array.isArray(rows), k); }
  } finally { await c.end(); }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'p08-rec-'));
  try {
    fs.writeFileSync(path.join(dir, 'exp.csv'), 'Created Time,Group,Reopen Count\r\n04 Jun 2026 10:00 AM,FX Agents,1\r\n05 Jun 2026 11:00 AM,FX Agents,0\r\n');
    const log = console.log; let printed = ''; console.log = (s) => { printed += s; };
    let code; try { code = await R.main(['--source=sdp_requests', `--export=${path.join(dir, 'exp.csv')}`, `--out=${path.join(dir, 'sheet.csv')}`]); } finally { console.log = log; }
    assert.equal(code, 0, printed);
    assert.match(fs.readFileSync(path.join(dir, 'sheet.csv'), 'utf8'), /2026-06 \| fx agents,2,2,0,1,1,0,match/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
