'use strict';
// E-U01 — Usability scoring tool (audit U-01 / U-08 prep).
//
//   node tools/pilot/usability-score.js --sheet=FILLED.csv [--sus=SUS-ANSWERS.csv] [--format=md|json]
//
// Reads a FILLED copy of docs/ops/pilot/T1-T8-SHEET.csv (or T9-T12-SHEET.csv) and, optionally, the SUS
// answers (docs/ops/pilot/SUS-ANSWERS.csv layout) and prints, per task x role: completion rate, median time,
// errors, help given; per participant: the SUS score, and the mean / median per role.
//
// Rules (the reason this tool exists):
//   * a blank cell is UNKNOWN — it is never counted as 0, never as a failure, never as a success;
//   * a sheet whose columns differ from a known template is REFUSED (a shifted column would silently
//     score the wrong thing);
//   * a SUS questionnaire with an unanswered item is "incomplete": no score, not 0 (SUS-FORM.md).
// No participant data lives in the repository: the filled sheets stay with the facilitator.
// Pure helpers are exported for tests; the CLI only reads files and prints.

const fs = require('fs');

const T1_T8_HEADER = ['session_id', 'participant_code', 'role', 'site', 'date', 'device', 'network_type',
  'signal_bars', 'task', 'task_description', 'success_criterion', 'completion', 'time_seconds', 'errors',
  'clicks_or_keystrokes', 'help_given', 'comment'];
// T9-T12 (dataviz tasks, E-V10) adds what the participant answered and whether it matched the fixture data.
const T9_T12_HEADER = [...T1_T8_HEADER.slice(0, 11), 'answer_given', 'answer_correct', ...T1_T8_HEADER.slice(11)];
const SUS_HEADER = ['participant_code', 'role', 'q1', 'q2', 'q3', 'q4', 'q5', 'q6', 'q7', 'q8', 'q9', 'q10'];
const KNOWN_TASK_HEADERS = { 'T1-T8': T1_T8_HEADER, 'T9-T12': T9_T12_HEADER };

const UNKNOWN = 'UNKNOWN';

/** RFC-4180-ish CSV: quoted fields, doubled quotes, commas and newlines inside quotes, BOM stripped. */
function parseCsv(text) {
  const src = String(text == null ? '' : text).replace(/^﻿/, '');
  const rows = [];
  let row = []; let field = ''; let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"') { if (src[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

function _blank(v) { return v == null || String(v).trim() === ''; }

/** Header check: exact names, exact order. Returns the template name or throws a readable error. */
function checkHeader(header, known) {
  const h = (header || []).map((x) => String(x).trim());
  for (const [name, cols] of Object.entries(known)) {
    if (h.length === cols.length && h.every((x, i) => x === cols[i])) return name;
  }
  const want = Object.entries(known).map(([n, c]) => `${n}: ${c.join(',')}`).join(' | ');
  throw new Error(`columns differ from every known template — refused. Got: ${h.join(',')} ; expected ${want}`);
}

function _rowsToObjects(rows, header) {
  return rows.map((r) => {
    const o = {};
    header.forEach((k, i) => { o[k] = r[i] == null ? '' : String(r[i]).trim(); });
    return o;
  });
}

/** Completion cell → 'yes' | 'help' | 'no' | null (blank / unreadable = UNKNOWN). */
function completionOf(v) {
  if (_blank(v)) return null;
  const s = String(v).trim().toLowerCase();
  if (/^(yes|oui|y|1|done|ok)$/.test(s)) return 'yes';
  if (/^(with help|help|avec aide|aide|helped)$/.test(s)) return 'help';
  if (/^(no|non|n|0|failed|abandoned|abandon)$/.test(s)) return 'no';
  return null;
}
function numberOf(v) {
  if (_blank(v)) return null;
  const n = Number(String(v).trim().replace(',', '.'));
  return Number.isFinite(n) && n >= 0 ? n : null;
}
function boolOf(v) {
  if (_blank(v)) return null;
  const s = String(v).trim().toLowerCase();
  if (/^(yes|oui|y|true|1)$/.test(s)) return true;
  if (/^(no|non|n|false|0)$/.test(s)) return false;
  const n = Number(s);
  if (Number.isFinite(n)) return n > 0;
  return null;
}
function median(xs) {
  const v = (xs || []).filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
function mean(xs) {
  const v = (xs || []).filter((x) => typeof x === 'number' && Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}
function _pct(n, d) { return d > 0 ? Math.round((1000 * n) / d) / 10 : null; }

/** Score the task sheet. Returns { template, groups:[...] } — one group per task x role. */
function scoreTasks(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) throw new Error('empty sheet');
  const template = checkHeader(rows[0], KNOWN_TASK_HEADERS);
  const header = KNOWN_TASK_HEADERS[template];
  const objs = _rowsToObjects(rows.slice(1), header);
  const map = new Map();
  for (const o of objs) {
    const key = `${o.task}\u0000${o.role}`;
    if (!map.has(key)) map.set(key, { task: o.task, role: o.role, rows: [] });
    map.get(key).rows.push(o);
  }
  const groups = [...map.values()].map((g) => {
    const comps = g.rows.map((r) => completionOf(r.completion));
    const known = comps.filter((c) => c != null);
    const times = g.rows.map((r) => numberOf(r.time_seconds));
    const errs = g.rows.map((r) => numberOf(r.errors)).filter((x) => x != null);
    const helps = g.rows.map((r) => boolOf(r.help_given)).filter((x) => x != null);
    const out = {
      task: g.task, role: g.role, rows: g.rows.length,
      completion_known: known.length,
      completion_unknown: comps.length - known.length,
      completed: known.filter((c) => c === 'yes').length,
      completed_with_help: known.filter((c) => c === 'help').length,
      not_completed: known.filter((c) => c === 'no').length,
      // Unassisted completion over KNOWN outcomes only; null when no outcome is known.
      completion_rate_pct: _pct(known.filter((c) => c === 'yes').length, known.length),
      median_time_seconds: median(times),
      time_known: times.filter((x) => x != null).length,
      errors_total: errs.length ? errs.reduce((a, b) => a + b, 0) : null,
      errors_median: median(errs),
      errors_known: errs.length,
      help_given: helps.length ? helps.filter(Boolean).length : null,
      help_known: helps.length,
    };
    if (template === 'T9-T12') {
      const acc = g.rows.map((r) => boolOf(r.answer_correct)).filter((x) => x != null);
      out.accuracy_known = acc.length;
      out.accuracy_pct = _pct(acc.filter(Boolean).length, acc.length);
    }
    return out;
  });
  groups.sort((a, b) => a.task.localeCompare(b.task, 'en', { numeric: true }) || a.role.localeCompare(b.role));
  return { template, groups };
}

/** One questionnaire → { score, incomplete }. Answers 1..5; anything else = unanswered. */
function susScore(answers) {
  const vals = (answers || []).map((a) => {
    const n = numberOf(a);
    return n != null && Number.isInteger(n) && n >= 1 && n <= 5 ? n : null;
  });
  if (vals.length !== 10 || vals.some((v) => v == null)) return { score: null, incomplete: true };
  let sum = 0;
  vals.forEach((v, i) => { sum += i % 2 === 0 ? v - 1 : 5 - v; }); // i=0 is item 1 (odd)
  return { score: sum * 2.5, incomplete: false };
}

function scoreSus(csvText) {
  const rows = parseCsv(csvText);
  if (!rows.length) throw new Error('empty SUS sheet');
  checkHeader(rows[0], { SUS: SUS_HEADER });
  const objs = _rowsToObjects(rows.slice(1), SUS_HEADER);
  const participants = objs.map((o) => {
    const r = susScore(SUS_HEADER.slice(2).map((k) => o[k]));
    return { participant_code: o.participant_code, role: o.role, score: r.score, incomplete: r.incomplete };
  });
  const byRole = new Map();
  for (const p of participants) {
    if (!byRole.has(p.role)) byRole.set(p.role, []);
    byRole.get(p.role).push(p);
  }
  const roles = [...byRole.entries()].map(([role, ps]) => {
    const scores = ps.filter((p) => !p.incomplete).map((p) => p.score);
    return { role, questionnaires: ps.length, complete: scores.length, incomplete: ps.length - scores.length,
      mean: mean(scores), median: median(scores) };
  }).sort((a, b) => a.role.localeCompare(b.role));
  const all = participants.filter((p) => !p.incomplete).map((p) => p.score);
  return { participants, roles, overall: { complete: all.length, mean: mean(all), median: median(all) } };
}

function _f(v, suffix) { return v == null ? UNKNOWN : `${Math.round(v * 10) / 10}${suffix || ''}`; }

function renderMarkdown(tasks, sus) {
  const L = [];
  L.push('# Usability scores (computed from a filled sheet — not a pass/fail verdict)', '');
  if (tasks) {
    L.push(`Template: ${tasks.template}. Blank cells are UNKNOWN and excluded from every rate.`, '');
    const acc = tasks.template === 'T9-T12';
    L.push(`| Task | Role | Rows | Completion (unassisted, of known) | With help | Not done | Outcome unknown | Median time | Errors (total) | Help given${acc ? ' | Accuracy' : ''} |`);
    L.push(`|---|---|---|---|---|---|---|---|---|---${acc ? '|---' : ''}|`);
    for (const g of tasks.groups) {
      L.push(`| ${g.task} | ${g.role} | ${g.rows} | ${_f(g.completion_rate_pct, '%')} (${g.completed}/${g.completion_known}) | ${g.completed_with_help} | ${g.not_completed} | ${g.completion_unknown} | ${_f(g.median_time_seconds, ' s')} | ${_f(g.errors_total)} | ${g.help_given == null ? UNKNOWN : `${g.help_given}/${g.help_known}`}${acc ? ` | ${_f(g.accuracy_pct, '%')} (${g.accuracy_known} known)` : ''} |`);
    }
    L.push('');
  }
  if (sus) {
    L.push('## SUS', '', '| Participant | Role | Score |', '|---|---|---|');
    for (const p of sus.participants) L.push(`| ${p.participant_code} | ${p.role} | ${p.incomplete ? 'incomplete (no score)' : _f(p.score)} |`);
    L.push('', '| Role | Questionnaires | Complete | Mean | Median |', '|---|---|---|---|---|');
    for (const r of sus.roles) L.push(`| ${r.role} | ${r.questionnaires} | ${r.complete} | ${_f(r.mean)} | ${_f(r.median)} |`);
    L.push('', `Overall: ${sus.overall.complete} complete questionnaire(s), mean ${_f(sus.overall.mean)}, median ${_f(sus.overall.median)}.`);
  }
  return L.join('\n') + '\n';
}

function parseArgs(argv) {
  const o = { sheet: null, sus: null, format: 'md' };
  for (const a of argv || []) {
    const m = /^--([a-z]+)=(.*)$/.exec(a);
    if (m && m[1] in o) o[m[1]] = m[2];
  }
  return o;
}

function main(argv) {
  const o = parseArgs(argv);
  if (!o.sheet && !o.sus) throw new Error('usage: --sheet=FILLED.csv [--sus=SUS.csv] [--format=md|json]');
  if (!['md', 'json'].includes(o.format)) throw new Error('--format must be md or json');
  const tasks = o.sheet ? scoreTasks(fs.readFileSync(o.sheet, 'utf8')) : null;
  const sus = o.sus ? scoreSus(fs.readFileSync(o.sus, 'utf8')) : null;
  return o.format === 'json' ? JSON.stringify({ tasks, sus }, null, 2) + '\n' : renderMarkdown(tasks, sus);
}

if (require.main === module) {
  try { process.stdout.write(main(process.argv.slice(2))); }
  catch (e) { process.stderr.write(`usability-score: ${e.message}\n`); process.exitCode = 1; }
}

module.exports = { parseCsv, checkHeader, completionOf, susScore, scoreTasks, scoreSus, renderMarkdown, main,
  median, T1_T8_HEADER, T9_T12_HEADER, SUS_HEADER, UNKNOWN };
