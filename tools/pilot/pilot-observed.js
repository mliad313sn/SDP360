'use strict';
// F-PRODUCT-08 — aggregates the sheets a person fills during the pilot (offline; no database, no network).
//
//   node tools/pilot/pilot-observed.js --sheets=DIR [--format=md|csv|both] [--out=DIR]
//
// DIR holds any of: T1-T8-SHEET.csv · WEEKLY-REPORT-STOPWATCH.csv · SUS-SHEET.csv (templates: docs/ops/pilot/).
// A sheet that is absent is reported "not measured". Empty cell = not measured (never 0); fewer than 3 measured
// lines = "insufficient sample". The tool writes no target and no verdict. Sheets and outputs holding real site
// data are operational records: keep them on the server or the team share, not in git.
const fs = require('fs');
const path = require('path');
const P = require('../../services/pilotObserved');

const SHEETS = { tasks: 'T1-T8-SHEET.csv', stopwatch: 'WEEKLY-REPORT-STOPWATCH.csv', sus: 'SUS-SHEET.csv' };
const REQUIRED = { tasks: ['participant_code', 'task', 'completion', 'time_seconds', 'errors'], stopwatch: ['participant_code', 'phase', 'active_minutes'], sus: ['participant_code', ...Array.from({ length: 10 }, (_, i) => 'q' + (i + 1))] };

function parseArgs(argv) {
  const o = { sheets: null, format: 'md', out: null };
  for (const a of argv || []) { const m = /^--(sheets|format|out)=(.*)$/.exec(a); if (m) o[m[1]] = m[2]; }
  return o;
}
function validate(o) {
  const e = [];
  if (!o.sheets) e.push('--sheets=DIR is required (the folder holding the filled sheets)');
  else if (!fs.existsSync(o.sheets) || !fs.statSync(o.sheets).isDirectory()) e.push(`--sheets: ${o.sheets} is not a folder`);
  if (!['md', 'csv', 'both'].includes(o.format)) e.push('--format must be md, csv or both');
  return e;
}
/** Read one sheet: null when the file is absent; throws when a required column is missing (a wrong file is not "0"). */
function readSheet(dir, kind) {
  const f = path.join(dir, SHEETS[kind]);
  if (!fs.existsSync(f)) return null;
  const text = fs.readFileSync(f, 'utf8');
  const head = (text.replace(/^﻿/, '').split(/\r?\n/)[0] || '').split(',').map((h) => h.trim().toLowerCase());
  const missing = REQUIRED[kind].filter((c) => !head.includes(c));
  if (missing.length) throw new Error(`${SHEETS[kind]}: missing column(s) ${missing.join(', ')}`);
  return P.parseCsv(text);
}

function run({ argv = process.argv.slice(2), now = new Date(), write = (s) => process.stdout.write(s), error = (s) => process.stderr.write(s) } = {}) {
  const o = parseArgs(argv);
  const errs = validate(o);
  if (errs.length) { for (const e of errs) error(e + '\n'); return { ok: false, errors: errs }; }
  let sheets;
  try { sheets = { tasks: readSheet(o.sheets, 'tasks'), stopwatch: readSheet(o.sheets, 'stopwatch'), sus: readSheet(o.sheets, 'sus') }; }
  catch (e) { error(e.message + '\n'); return { ok: false, errors: [e.message] }; }
  const rep = P.buildReport({ ...sheets, generatedAt: now.toISOString() });
  const md = P.toMarkdown(rep), csv = P.toCsv(rep);
  if (o.out) {
    fs.mkdirSync(o.out, { recursive: true });
    const base = `pilot-observed_${now.toISOString().slice(0, 10)}`;
    if (o.format !== 'csv') fs.writeFileSync(path.join(o.out, base + '.md'), md);
    if (o.format !== 'md') fs.writeFileSync(path.join(o.out, base + '.csv'), csv);
    write(`written to ${o.out}\n`);
  } else {
    if (o.format !== 'csv') write(md + '\n');
    if (o.format !== 'md') write(csv);
  }
  return { ok: true, report: rep, markdown: md, csv };
}

module.exports = { SHEETS, parseArgs, validate, readSheet, run };

if (require.main === module) { const r = run(); if (!r.ok) process.exitCode = 1; }
