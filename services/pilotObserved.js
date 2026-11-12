'use strict';
// F-PRODUCT-08 (committee 12 Nov 2026, finding N10 / E09) — observed-evidence aggregator for the pilot: PURE.
//
// The sheets a person fills during the pilot (docs/ops/pilot/): T1-T8-SHEET.csv (observed tasks),
// WEEKLY-REPORT-STOPWATCH.csv (baseline vs pilot, per participant) and SUS-SHEET.csv (the ten SUS answers) were
// summarised by hand. This module turns them into tables. Rules:
//   • an empty cell is "not measured" — it is never read as 0 and never enters a median;
//   • a group with fewer than MIN_SAMPLE measured values shows "insufficient sample", not a number;
//   • stopwatch: only participants observed in BOTH phases are compared; the others are excluded and counted;
//   • SUS: the standard 0–100 formula; a questionnaire with a missing / invalid answer is incomplete (no score);
//   • participant CODES only (P01…): anything else in that column is hidden, never printed;
//   • no target, no threshold, no verdict is written — the decision belongs to people.
// No DB, no file, no clock.
const { neutralize } = require('../public/lib/csvSafe');

const MIN_SAMPLE = 3;
const COMPLETIONS = ['yes', 'with_help', 'no', 'not_run'];
const CODE_RE = /^[A-Za-z]{1,3}\d{1,4}$/;   // P01, S12, OBS3 — never a name

const _t = (v) => String(v == null ? '' : v).trim();
/** A cell → finite number, or null when blank / not a number (blank is NOT 0). */
function num(v) { const s = _t(v).replace(',', '.'); if (s === '') return null; const n = Number(s); return Number.isFinite(n) ? n : null; }
function median(values) {
  const v = (values || []).filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null; const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}
/** Linear-interpolated quantile (same rule as services/pilotMetrics). */
function quantile(values, q) {
  const v = (values || []).filter((x) => typeof x === 'number' && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null; const pos = (v.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return v[lo] + (v[hi] - v[lo]) * (pos - lo);
}
const r1 = (x) => (x == null ? null : Math.round(x * 10) / 10);
/** { n, value } — value only when n ≥ MIN_SAMPLE; otherwise null with insufficient = true (n = 0 → not measured). */
function stat(values, fn = median) {
  const v = (values || []).filter((x) => x != null);
  if (v.length < MIN_SAMPLE) return { n: v.length, value: null, insufficient: v.length > 0 };
  return { n: v.length, value: r1(fn(v)), insufficient: false };
}

/** RFC-4180 CSV → [{header: cell}] (quoted cells, doubled quotes, CRLF, BOM). Fully blank lines are dropped. */
function parseCsv(text) {
  const s = String(text == null ? '' : text).replace(/^\uFEFF/, '');
  const rows = []; let row = [], cell = '', q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  const live = rows.filter((r) => r.some((x) => _t(x) !== ''));
  if (!live.length) return [];
  const head = live[0].map((h) => _t(h).toLowerCase());
  return live.slice(1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? '' : r[i]])));
}

/** Participant code as written, or null when the cell does not look like a code (a name is never carried). */
function codeOf(v) { const s = _t(v); return CODE_RE.test(s) ? s.toUpperCase() : null; }
const _label = (v) => _t(v) || '(not recorded)';

// ── T1–T8 observed tasks ────────────────────────────────────────────────────────────────────────────────────────────
function _taskGroup(rows) {
  const c = { yes: 0, with_help: 0, no: 0, not_run: 0, not_recorded: 0 };
  for (const r of rows) { const k = _t(r.completion).toLowerCase(); if (COMPLETIONS.includes(k)) c[k]++; else c.not_recorded++; }
  const run = rows.filter((r) => ['yes', 'with_help', 'no'].includes(_t(r.completion).toLowerCase()));
  return { n_lines: rows.length, n_run: run.length, ...c,
    time_median_s: stat(run.map((r) => num(r.time_seconds))), time_p75_s: stat(run.map((r) => num(r.time_seconds)), (v) => quantile(v, 0.75)),
    errors_median: stat(run.map((r) => num(r.errors))) };
}
function _by(rows, keyFn) { const m = new Map(); for (const r of rows) { const k = keyFn(r); if (!m.has(k)) m.set(k, []); m.get(k).push(r); } return m; }
/** @param {object[]|null} rows parsed T1-T8 sheet (null = sheet not supplied) */
function summarizeTasks(rows) {
  if (rows == null) return null;
  const live = rows.filter((r) => _t(r.task));
  const tasks = [..._by(live, (r) => _t(r.task).toUpperCase()).entries()].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }));
  const cut = (field) => tasks.flatMap(([task, rs]) => [..._by(rs, (r) => _label(r[field])).entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([g, x]) => ({ task, [field]: g, ..._taskGroup(x) })));
  return { participants: new Set(live.map((r) => codeOf(r.participant_code)).filter(Boolean)).size, hidden_codes: live.filter((r) => _t(r.participant_code) && !codeOf(r.participant_code)).length,
    per_task: tasks.map(([task, rs]) => ({ task, ..._taskGroup(rs) })), per_task_role: cut('role'), per_task_site: cut('site') };
}

// ── weekly-report stopwatch: paired baseline vs pilot per participant ───────────────────────────────────────────────
function summarizeStopwatch(rows) {
  if (rows == null) return null;
  const filled = rows.filter((r) => num(r.active_minutes) != null && ['baseline', 'pilot'].includes(_t(r.phase).toLowerCase()));
  const hidden = filled.filter((r) => !codeOf(r.participant_code)).length;
  const byP = _by(filled.filter((r) => codeOf(r.participant_code)), (r) => codeOf(r.participant_code));
  const pairs = []; const unpaired = [];
  for (const [code, rs] of [...byP.entries()].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true }))) {
    const ph = (p) => rs.filter((r) => _t(r.phase).toLowerCase() === p);
    const b = ph('baseline'), p = ph('pilot');
    if (!b.length || !p.length) { unpaired.push({ participant_code: code, phase_present: b.length ? 'baseline' : 'pilot', n: rs.length }); continue; }
    const m = (x, f) => median(x.map((r) => num(r[f])));
    const row = { participant_code: code, role: _label(rs[0].role), site: _label(rs[0].site), n_baseline: b.length, n_pilot: p.length,
      baseline_minutes: r1(m(b, 'active_minutes')), pilot_minutes: r1(m(p, 'active_minutes')),
      baseline_reentries: r1(m(b, 'data_re_entered_count')), pilot_reentries: r1(m(p, 'data_re_entered_count')) };
    row.delta_minutes = r1(row.pilot_minutes - row.baseline_minutes);
    pairs.push(row);
  }
  const both = (f1, f2) => pairs.filter((x) => x[f1] != null && x[f2] != null);
  const re = both('baseline_reentries', 'pilot_reentries');
  return { n_rows: rows.length, n_filled: filled.length, not_measured_rows: rows.length - filled.length, hidden_codes: hidden,
    n_pairs: pairs.length, excluded_unpaired: unpaired.length, unpaired, pairs,
    paired: { baseline_minutes: stat(pairs.map((x) => x.baseline_minutes)), pilot_minutes: stat(pairs.map((x) => x.pilot_minutes)), delta_minutes: stat(pairs.map((x) => x.delta_minutes)),
      baseline_reentries: stat(re.map((x) => x.baseline_reentries)), pilot_reentries: stat(re.map((x) => x.pilot_reentries)) } };
}

// ── SUS ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
/** Standard SUS: odd items answer − 1, even items 5 − answer, sum × 2.5. null when an answer is missing or not 1..5. */
function susScore(answers) {
  if (!Array.isArray(answers) || answers.length !== 10) return null;
  let sum = 0;
  for (let i = 0; i < 10; i++) { const a = num(answers[i]); if (a == null || !Number.isInteger(a) || a < 1 || a > 5) return null; sum += i % 2 === 0 ? a - 1 : 5 - a; }
  return sum * 2.5;
}
function summarizeSus(rows) {
  if (rows == null) return null;
  const live = rows.filter((r) => _t(r.participant_code) || Array.from({ length: 10 }, (_, i) => r['q' + (i + 1)]).some((x) => _t(x) !== ''));
  let hidden = 0;
  const per = live.map((r, i) => { const code = codeOf(r.participant_code); if (!code) hidden++;
    const score = susScore(Array.from({ length: 10 }, (_, k) => r['q' + (k + 1)]));
    return { participant_code: code || `(hidden ${i + 1})`, role: _label(r.role), site: _label(r.site), score, complete: score != null }; });
  const done = per.filter((x) => x.complete);
  const byRole = [..._by(done, (x) => x.role).entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([role, xs]) => ({ role, ...stat(xs.map((x) => x.score)) }));
  return { n: per.length, n_complete: done.length, n_incomplete: per.length - done.length, hidden_codes: hidden, participants: per, median: stat(done.map((x) => x.score)), per_role: byRole };
}

/** @param {{tasks?:object[]|null, stopwatch?:object[]|null, sus?:object[]|null, generatedAt?:string}} sheets parsed rows; null/undefined = sheet not supplied */
function buildReport(sheets = {}) {
  return { generated_at: sheets.generatedAt || null, min_sample: MIN_SAMPLE,
    tasks: summarizeTasks(sheets.tasks == null ? null : sheets.tasks), stopwatch: summarizeStopwatch(sheets.stopwatch == null ? null : sheets.stopwatch), sus: summarizeSus(sheets.sus == null ? null : sheets.sus),
    note: 'Observed by a person on a small sample. Empty cell = not measured (never 0). No target, threshold or verdict is set here.' };
}

// ── rendering ───────────────────────────────────────────────────────────────────────────────────────────────────────
const NM = 'not measured';
const _s = (st) => (st == null ? NM : st.value != null ? `${st.value} (n=${st.n})` : st.n ? `insufficient sample (n=${st.n})` : NM);
const _mdCell = (v) => String(v == null ? '' : v).replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const _table = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(_mdCell).join(' | ')} |`)].join('\n');
const _taskCells = (g) => [g.n_run, g.yes, g.with_help, g.no, g.not_run, g.not_recorded, _s(g.time_median_s), _s(g.time_p75_s), _s(g.errors_median)];
const TASK_HEAD = ['n run', 'yes', 'with help', 'no', 'not run', 'not recorded', 'median time (s)', 'p75 time (s)', 'median errors'];

function toMarkdown(rep) {
  const L = ['# Pilot — observed evidence (T1–T8, stopwatch, SUS)', '', rep.note, `A value needs at least ${rep.min_sample} measured lines; below that the table says "insufficient sample".`, ''];
  L.push('## Observed tasks (T1–T8)', '');
  if (!rep.tasks) L.push('Sheet not supplied — not measured.', '');
  else {
    L.push(`Participants (codes): ${rep.tasks.participants}${rep.tasks.hidden_codes ? ` — ${rep.tasks.hidden_codes} line(s) whose participant cell is not a code (hidden)` : ''}`, '');
    L.push(_table(['Task', ...TASK_HEAD], rep.tasks.per_task.map((g) => [g.task, ..._taskCells(g)])), '');
    L.push('### Per task and role', '', _table(['Task', 'Role', ...TASK_HEAD], rep.tasks.per_task_role.map((g) => [g.task, g.role, ..._taskCells(g)])), '');
    L.push('### Per task and site', '', _table(['Task', 'Site', ...TASK_HEAD], rep.tasks.per_task_site.map((g) => [g.task, g.site, ..._taskCells(g)])), '');
  }
  L.push('## Weekly report — stopwatch, baseline vs pilot (paired per participant)', '');
  const sw = rep.stopwatch;
  if (!sw) L.push('Sheet not supplied — not measured.', '');
  else {
    L.push(`Lines: ${sw.n_rows} — measured ${sw.n_filled}, not measured ${sw.not_measured_rows}. Participants with both phases: ${sw.n_pairs}. Excluded (one phase only): ${sw.excluded_unpaired}${sw.hidden_codes ? `. Lines whose participant cell is not a code (excluded): ${sw.hidden_codes}` : ''}.`, '');
    L.push(_table(['Measure (median over the paired participants)', 'Baseline', 'Pilot', 'Pilot − baseline'],
      [['Active minutes per report', _s(sw.paired.baseline_minutes), _s(sw.paired.pilot_minutes), _s(sw.paired.delta_minutes)], ['Values re-entered per report', _s(sw.paired.baseline_reentries), _s(sw.paired.pilot_reentries), '']]), '');
    if (sw.pairs.length) L.push(_table(['Participant', 'Role', 'Site', 'Baseline reports', 'Pilot reports', 'Baseline min (median)', 'Pilot min (median)', 'Δ min', 'Baseline re-entries', 'Pilot re-entries'],
      sw.pairs.map((p) => [p.participant_code, p.role, p.site, p.n_baseline, p.n_pilot, p.baseline_minutes, p.pilot_minutes, p.delta_minutes, p.baseline_reentries == null ? NM : p.baseline_reentries, p.pilot_reentries == null ? NM : p.pilot_reentries])), '');
    if (sw.unpaired.length) L.push('Excluded from the comparison: ' + sw.unpaired.map((u) => `${u.participant_code} (${u.phase_present} only)`).join(', '), '');
  }
  L.push('## SUS', '');
  const su = rep.sus;
  if (!su) L.push('Sheet not supplied — not measured.', '');
  else {
    L.push(`Questionnaires: ${su.n} — complete ${su.n_complete}, incomplete ${su.n_incomplete} (no score, not counted as 0)${su.hidden_codes ? `, participant cell not a code: ${su.hidden_codes} (hidden)` : ''}. Median SUS: ${_s(su.median)}.`, '');
    if (su.per_role.length) L.push(_table(['Role', 'Median SUS'], su.per_role.map((r) => [r.role, _s(r)])), '');
    if (su.participants.length) L.push(_table(['Participant', 'Role', 'Site', 'SUS (0–100)'], su.participants.map((p) => [p.participant_code, p.role, p.site, p.complete ? p.score : 'incomplete'])), '');
  }
  return L.join('\n');
}

const _csv = (v) => { const s = neutralize(v == null ? '' : v); return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
const _v = (st) => (st && st.value != null ? st.value : '');
const _n = (st) => (st ? st.n : '');
const _state = (st) => (st == null ? NM : st.value != null ? 'measured' : st.n ? 'insufficient sample' : NM);
/** Long format: section,group_1,group_2,measure,value,n,state — one line per figure; an unmeasured value is an EMPTY cell. */
function toCsv(rep) {
  const out = [['section', 'group_1', 'group_2', 'measure', 'value', 'n', 'state'].join(',')];
  const push = (...c) => out.push(c.map(_csv).join(','));
  const st = (sec, g1, g2, measure, s) => push(sec, g1, g2, measure, _v(s), _n(s), _state(s));
  const count = (sec, g1, g2, measure, n) => push(sec, g1, g2, measure, n, '', 'count');
  if (rep.tasks) {
    const emit = (sec, g1, g2, g) => { for (const k of ['n_run', 'yes', 'with_help', 'no', 'not_run', 'not_recorded']) count(sec, g1, g2, k, g[k]);
      st(sec, g1, g2, 'time_median_s', g.time_median_s); st(sec, g1, g2, 'time_p75_s', g.time_p75_s); st(sec, g1, g2, 'errors_median', g.errors_median); };
    for (const g of rep.tasks.per_task) emit('tasks', g.task, '', g);
    for (const g of rep.tasks.per_task_role) emit('tasks_by_role', g.task, g.role, g);
    for (const g of rep.tasks.per_task_site) emit('tasks_by_site', g.task, g.site, g);
  } else push('tasks', '', '', 'sheet', '', '', NM);
  if (rep.stopwatch) {
    const sw = rep.stopwatch;
    count('stopwatch', '', '', 'pairs', sw.n_pairs); count('stopwatch', '', '', 'excluded_unpaired', sw.excluded_unpaired); count('stopwatch', '', '', 'not_measured_rows', sw.not_measured_rows);
    for (const k of ['baseline_minutes', 'pilot_minutes', 'delta_minutes', 'baseline_reentries', 'pilot_reentries']) st('stopwatch', 'paired', '', k, sw.paired[k]);
    for (const p of sw.pairs) for (const k of ['baseline_minutes', 'pilot_minutes', 'delta_minutes', 'baseline_reentries', 'pilot_reentries']) push('stopwatch_participant', p.participant_code, p.role, k, p[k] == null ? '' : p[k], '', p[k] == null ? NM : 'measured');
  } else push('stopwatch', '', '', 'sheet', '', '', NM);
  if (rep.sus) {
    count('sus', '', '', 'complete', rep.sus.n_complete); count('sus', '', '', 'incomplete', rep.sus.n_incomplete); st('sus', 'all', '', 'median_score', rep.sus.median);
    for (const r of rep.sus.per_role) st('sus_by_role', r.role, '', 'median_score', r);
    for (const p of rep.sus.participants) push('sus_participant', p.participant_code, p.role, 'score', p.complete ? p.score : '', '', p.complete ? 'measured' : 'incomplete');
  } else push('sus', '', '', 'sheet', '', '', NM);
  return out.join('\r\n') + '\r\n';
}

module.exports = { MIN_SAMPLE, COMPLETIONS, parseCsv, num, median, quantile, stat, codeOf, susScore, summarizeTasks, summarizeStopwatch, summarizeSus, buildReport, toMarkdown, toCsv };
