'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { parseActionsCsv } = require('../public/lib/parse-actions-csv.js');

const DEPTS = ['Mining', 'Technical Service', 'General Manager'];

test('rejects file with missing required column', () => {
  const res = parseActionsCsv('priority,owner\nHigh,Bob', DEPTS);
  assert.equal(res.fatal, true);
  assert.match(res.error, /missing required column/i);
});

test('strips UTF-8 BOM at start of file', () => {
  const csv = '﻿task,department,priority,due_date,owner,status\n"Test","Mining","High","2026-05-01","Bob","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.fatal, false);
  assert.equal(res.ok.length, 1);
  assert.equal(res.ok[0].task, 'Test');
});

test('parses canonical English headers', () => {
  const csv = 'task,department,priority,due_date,owner,status,comment\n"T1","Mining","High","2026-05-01","Bob","open","ok"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 1);
  assert.deepEqual(res.ok[0], {
    task: 'T1', department: 'Mining', priority: 'High',
    due_date: '2026-05-01', owner: 'Bob', status: 'open', comment: 'ok'
  });
});

test('accepts French header synonyms', () => {
  const csv = 'Tâche,Département,Priorité,Échéance,Responsable,Statut\n"T1","Mining","Haute","2026-05-01","Bob","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 1);
  assert.equal(res.ok[0].priority, 'High');
});

test('normalizes priority variants (case + abbreviation + French)', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T1","Mining","HIGH","","Bob","open"\n"T2","Mining","Moyenne","","Bob","open"\n"T3","Mining","L","","Bob","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 3);
  assert.deepEqual(res.ok.map(r => r.priority), ['High', 'Medium', 'Low']);
});

test('rejects unknown department, keeps good rows', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T1","Mining","High","","","open"\n"T2","Logistics","High","","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 1);
  assert.equal(res.ok[0].task, 'T1');
  assert.equal(res.errors.length, 1);
  assert.equal(res.errors[0].row, 3);  // 1-indexed CSV file row, header is row 1
  assert.match(res.errors[0].reason, /Logistics/);
});

test('rejects ambiguous date 04/05/2026', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T1","Mining","High","04/05/2026","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 0);
  assert.match(res.errors[0].reason, /ambiguous/i);
});

test('accepts unambiguous DMY when first slot > 12', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T1","Mining","High","31/05/2026","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 1);
  assert.equal(res.ok[0].due_date, '2026-05-31');
});

test('accepts unambiguous MDY when second slot > 12', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T1","Mining","High","05/31/2026","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 1);
  assert.equal(res.ok[0].due_date, '2026-05-31');
});

test('accepts ISO YYYY-MM-DD dates', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T1","Mining","High","2026-05-31","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok[0].due_date, '2026-05-31');
});

test('skips rows with empty task', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"","Mining","High","","","open"\n"Real","Mining","High","","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 1);
  assert.equal(res.errors.length, 1);
  assert.match(res.errors[0].reason, /empty task/i);
});

test('quoted commas inside fields are preserved', () => {
  const csv = 'task,department,priority,due_date,owner,status,comment\n"Replace UPS, then test","Mining","High","","","open","Includes commas, yes"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok[0].task, 'Replace UPS, then test');
  assert.equal(res.ok[0].comment, 'Includes commas, yes');
});

test('escaped double quotes inside fields work', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"He said ""hello""","Mining","High","","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok[0].task, 'He said "hello"');
});

test('truncates owner > 100 chars and comment > 2000 chars', () => {
  const owner = 'A'.repeat(150);
  const comment = 'B'.repeat(2500);
  const csv = `task,department,priority,due_date,owner,status,comment\n"T","Mining","H","","${owner}","open","${comment}"`;
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok[0].owner.length, 100);
  assert.equal(res.ok[0].comment.length, 2000);
});

test('case-insensitive department matching, normalizes to canonical casing', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T","mining","High","","","open"\n"T2","TECHNICAL service","High","","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 2);
  assert.equal(res.ok[0].department, 'Mining');
  assert.equal(res.ok[1].department, 'Technical Service');
});

test('rejects file with > 5000 data rows', () => {
  const rows = Array.from({ length: 5001 }, (_, i) => `"T${i}","Mining","High","","","open"`).join('\n');
  const csv = 'task,department,priority,due_date,owner,status\n' + rows;
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.fatal, true);
  assert.match(res.error, /5000|too many/i);
});

test('accepts department list as plain strings or {name} objects', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T","Mining","High","","","open"';
  const fromObjects = parseActionsCsv(csv, [{ name: 'Mining' }, { name: 'Technical Service' }]);
  assert.equal(fromObjects.ok.length, 1);
  assert.equal(fromObjects.ok[0].department, 'Mining');
});

test('normalizes status variants', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T1","Mining","High","","","Open"\n"T2","Mining","High","","","In Progress"\n"T3","Mining","High","","","En cours"\n"T4","Mining","High","","","CANCELLED"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok.length, 4);
  assert.deepEqual(res.ok.map(r => r.status), ['open', 'in_progress', 'in_progress', 'cancelled']);
});

test('empty due_date stays null, not parsed as ambiguous', () => {
  const csv = 'task,department,priority,due_date,owner,status\n"T","Mining","High","","","open"';
  const res = parseActionsCsv(csv, DEPTS);
  assert.equal(res.ok[0].due_date, null);
});
