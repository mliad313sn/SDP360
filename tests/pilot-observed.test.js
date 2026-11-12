'use strict';
// F-PRODUCT-08 — observed-evidence aggregator (services/pilotObserved + tools/pilot/pilot-observed): blank cells are not
// 0, unpaired stopwatch rows are excluded and counted, the SUS formula, n < 3 = insufficient sample, CSV injection.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const P = require('../services/pilotObserved');
const cli = require('../tools/pilot/pilot-observed');

const T_HEAD = 'session_id,participant_code,role,site,date,device,network_type,signal_bars,task,task_description,success_criterion,completion,time_seconds,errors,clicks_or_keystrokes,help_given,comment';
const t = (code, role, site, task, completion, time, errors) => `S01,${code},${role},${site},,,,,${task},"desc, with a comma",crit,${completion},${time},${errors},,,`;
const TASKS = [T_HEAD,
  t('P01', 'Coordinator', 'HGO', 'T1', 'yes', '60', '0'), t('P02', 'Coordinator', 'HGO', 'T1', 'yes', '100', '2'), t('P03', 'Coordinator', 'MGO', 'T1', 'with_help', '200', ''),
  t('P04', 'Technician', 'MGO', 'T1', 'no', '', '4'), t('P05', 'Technician', 'MGO', 'T1', 'not_run', '', ''), t('P06', 'Technician', 'MGO', 'T1', '', '', ''),
  t('P01', 'Coordinator', 'HGO', 'T2', 'yes', '30', '0'), t('P02', 'Coordinator', 'HGO', 'T2', 'yes', '', ''), t('Jane Doe', 'Coordinator', 'HGO', 'T2', 'yes', '50', '1')].join('\r\n');

test('parseCsv: quoted commas, doubled quotes, BOM, CRLF, blank lines', () => {
  const rows = P.parseCsv('﻿a,b,c\r\n1,"x, ""y""",\r\n\r\n,,\r\n2,z,3\n');
  assert.deepEqual(rows, [{ a: '1', b: 'x, "y"', c: '' }, { a: '2', b: 'z', c: '3' }]);
  assert.strictEqual(P.num(''), null); assert.strictEqual(P.num('  '), null); assert.strictEqual(P.num('0'), 0); assert.strictEqual(P.num('abc'), null); assert.strictEqual(P.num('1,5'), 1.5);
});

test('tasks: completion counts, a blank cell is not 0, medians only on measured lines, n < 3 = insufficient sample', () => {
  const r = P.summarizeTasks(P.parseCsv(TASKS));
  const t1 = r.per_task.find((x) => x.task === 'T1');
  assert.deepEqual([t1.n_lines, t1.n_run, t1.yes, t1.with_help, t1.no, t1.not_run, t1.not_recorded], [6, 4, 2, 1, 1, 1, 1]);
  assert.deepEqual(t1.time_median_s, { n: 3, value: 100, insufficient: false }, 'the "no" run without a time does not count as 0 s');
  assert.equal(t1.time_p75_s.value, 150);
  assert.deepEqual(t1.errors_median, { n: 3, value: 2, insufficient: false }, 'errors 0, 2, 4 — the blank is not a 0');
  const t2 = r.per_task.find((x) => x.task === 'T2');
  assert.deepEqual(t2.time_median_s, { n: 2, value: null, insufficient: true }); assert.equal(t2.yes, 3);
  const coord = r.per_task_role.find((x) => x.task === 'T1' && x.role === 'Coordinator');
  assert.equal(coord.n_run, 3); assert.equal(coord.time_median_s.value, 100);
  const tech = r.per_task_role.find((x) => x.task === 'T1' && x.role === 'Technician');
  assert.deepEqual(tech.time_median_s, { n: 0, value: null, insufficient: false }, 'nothing measured: not measured, not 0');
  assert.equal(r.per_task_site.find((x) => x.task === 'T1' && x.site === 'HGO').n_run, 2);
  assert.equal(r.participants, 6); assert.equal(r.hidden_codes, 1, 'a name in the participant column is counted, never carried');
  assert.strictEqual(P.summarizeTasks(null), null);
});

test('stopwatch: paired per participant only; unpaired and blank rows are excluded and counted', () => {
  const head = 'week,site,participant_code,role,phase,report_id,started_at,submitted_at,active_minutes,interruptions,data_re_entered_count,data_re_entered_what,same_content_as_previous_week,comment';
  const s = (code, phase, min, re) => `2026-W45,HGO,${code},Coordinator,${phase},,,,${min},,${re},,,`;
  const rows = P.parseCsv([head, s('P01', 'baseline', '40', '6'), s('P01', 'baseline', '50', '8'), s('P01', 'pilot', '20', '1'),
    s('P02', 'baseline', '60', ''), s('P02', 'pilot', '30', ''), s('P03', 'baseline', '30', '4'), s('P03', 'pilot', '35', '0'),
    s('P04', 'baseline', '70', '9'), s('P05', 'pilot', '15', '0'), s('P06', 'baseline', '', ''), s('P06', 'pilot', '', ''), s('Jane Doe', 'baseline', '10', '1')].join('\n'));
  const r = P.summarizeStopwatch(rows);
  assert.equal(r.n_rows, 12); assert.equal(r.n_filled, 10); assert.equal(r.not_measured_rows, 2);
  assert.equal(r.n_pairs, 3); assert.equal(r.excluded_unpaired, 2); assert.equal(r.hidden_codes, 1);
  assert.deepEqual(r.unpaired.map((u) => [u.participant_code, u.phase_present]), [['P04', 'baseline'], ['P05', 'pilot']]);
  assert.deepEqual(r.pairs.map((p) => [p.participant_code, p.baseline_minutes, p.pilot_minutes, p.delta_minutes]), [['P01', 45, 20, -25], ['P02', 60, 30, -30], ['P03', 30, 35, 5]]);
  assert.deepEqual(r.paired.baseline_minutes, { n: 3, value: 45, insufficient: false }); assert.equal(r.paired.pilot_minutes.value, 30); assert.equal(r.paired.delta_minutes.value, -25);
  assert.strictEqual(r.pairs[1].baseline_reentries, null, 'a blank re-entry count is not 0');
  assert.deepEqual(r.paired.baseline_reentries, { n: 2, value: null, insufficient: true }, 'only two participants have both counts');
  assert.ok(!JSON.stringify(r).includes('Jane'));
});

test('SUS: the standard 0–100 formula; an incomplete questionnaire has no score and is not a 0', () => {
  assert.equal(P.susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]), 100); assert.equal(P.susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5]), 0);
  assert.equal(P.susScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), 50); assert.equal(P.susScore(['4', '2', '5', '1', '4', '2', '4', '2', '5', '3']), 80);
  assert.strictEqual(P.susScore([4, 2, 5, 1, 4, 2, 4, 2, 5, '']), null); assert.strictEqual(P.susScore([4, 2, 5, 1, 4, 2, 4, 2, 5, 6]), null); assert.strictEqual(P.susScore([4, 2, 5]), null);
  const head = 'participant_code,role,site,date,q1,q2,q3,q4,q5,q6,q7,q8,q9,q10,comment';
  const rows = P.parseCsv([head, 'P01,Coordinator,HGO,,5,1,5,1,5,1,5,1,5,1,', 'P02,Coordinator,HGO,,3,3,3,3,3,3,3,3,3,3,', 'P03,Coordinator,MGO,,4,2,5,1,4,2,4,2,5,3,',
    'P04,Technician,MGO,,4,2,5,1,4,2,4,2,5,,', 'P05,Technician,MGO,,1,5,1,5,1,5,1,5,1,5,', ',,,,,,,,,,,,,,'].join('\n'));
  const r = P.summarizeSus(rows);
  assert.deepEqual([r.n, r.n_complete, r.n_incomplete], [5, 4, 1]);
  assert.deepEqual(r.participants.map((p) => p.score), [100, 50, 80, null, 0]);
  assert.deepEqual(r.median, { n: 4, value: 65, insufficient: false }, 'the incomplete one is left out, the real 0 stays in');
  assert.deepEqual(r.per_role, [{ role: 'Coordinator', n: 3, value: 80, insufficient: false }, { role: 'Technician', n: 1, value: null, insufficient: true }]);
});

test('report: an absent sheet is "not measured"; no target or verdict is written; CSV cells are neutralised', () => {
  const rep = P.buildReport({ tasks: P.parseCsv([T_HEAD, 'S01,P01,"=HYPERLINK(""http://evil"")",@site,,,,,T1,d,c,yes,10,0,,,'].join('\n')) });
  assert.strictEqual(rep.stopwatch, null); assert.strictEqual(rep.sus, null);
  const md = P.toMarkdown(rep);
  assert.match(md, /## Weekly report[^\n]*\n\nSheet not supplied — not measured\./); assert.match(md, /## SUS\n\nSheet not supplied — not measured\./);
  assert.match(md, /insufficient sample \(n=1\)/);
  assert.match(md, /No target, threshold or verdict is set here/);
  assert.doesNotMatch(md.replace(rep.note, '') + P.toCsv(rep), /\b(target|threshold met|pass(ed)?|fail(ed)?|verdict:|success rate)\b/i);
  const csv = P.toCsv(rep);
  const lines = csv.split('\r\n').filter(Boolean);
  assert.ok(lines.every((l) => !/^[=+\-@]/.test(l) && !/,[=@]/.test(l) && !/,"[=@]/.test(l)), 'no cell starts with a formula character');
  assert.ok(csv.includes('"\'=HYPERLINK(""http://evil"")"') && csv.includes(",'@site,"));
  assert.match(csv, /^tasks,T1,,time_median_s,,1,insufficient sample$/m, 'an unmeasured value is an empty cell, never 0');
  assert.match(csv, /^stopwatch,,,sheet,,,not measured$/m);
});

test('cli: --sheets=DIR reads the three sheets, writes md + csv next to each other, refuses a wrong file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pilot-obs-')); const out = path.join(dir, 'out');
  fs.writeFileSync(path.join(dir, cli.SHEETS.tasks), TASKS);
  fs.writeFileSync(path.join(dir, cli.SHEETS.sus), 'participant_code,role,site,date,q1,q2,q3,q4,q5,q6,q7,q8,q9,q10,comment\nP01,Coordinator,HGO,,5,1,5,1,5,1,5,1,5,1,\n');
  let txt = ''; const errs = [];
  const r = cli.run({ argv: [`--sheets=${dir}`, '--format=both', `--out=${out}`], now: new Date('2026-11-12T10:00:00Z'), write: (s) => { txt += s; }, error: (s) => errs.push(s) });
  assert.equal(r.ok, true); assert.match(txt, /written to/);
  assert.deepEqual(fs.readdirSync(out).sort(), ['pilot-observed_2026-11-12.csv', 'pilot-observed_2026-11-12.md']);
  assert.strictEqual(r.report.stopwatch, null); assert.equal(r.report.sus.participants[0].score, 100); assert.equal(r.report.tasks.per_task.length, 2);
  // stdout mode
  txt = ''; assert.equal(cli.run({ argv: [`--sheets=${dir}`], write: (s) => { txt += s; }, error: () => {} }).ok, true); assert.match(txt, /^# Pilot — observed evidence/);
  // errors: missing folder, wrong columns (a wrong file is refused, not read as zeros)
  assert.equal(cli.run({ argv: [], write: () => {}, error: (s) => errs.push(s) }).ok, false);
  assert.equal(cli.run({ argv: ['--sheets=' + path.join(dir, 'nope')], write: () => {}, error: () => {} }).ok, false);
  fs.writeFileSync(path.join(dir, cli.SHEETS.stopwatch), 'week,site,participant\n2026-W45,HGO,P01\n');
  const bad = cli.run({ argv: [`--sheets=${dir}`], write: () => {}, error: (s) => errs.push(s) });
  assert.equal(bad.ok, false); assert.match(bad.errors[0], /WEEKLY-REPORT-STOPWATCH\.csv: missing column\(s\) participant_code, phase, active_minutes/);
  // the committed templates parse with the columns the tool needs
  const tpl = path.join(__dirname, '..', 'docs', 'ops', 'pilot');
  for (const k of ['tasks', 'stopwatch', 'sus']) assert.ok(Array.isArray(cli.readSheet(tpl, k)), k);
  const empty = P.buildReport({ tasks: cli.readSheet(tpl, 'tasks'), stopwatch: cli.readSheet(tpl, 'stopwatch'), sus: cli.readSheet(tpl, 'sus') });
  assert.equal(empty.stopwatch.n_pairs, 0); assert.strictEqual(empty.sus.median.value, null); assert.ok(empty.tasks.per_task.every((g) => g.n_run === 0 && g.time_median_s.value === null));
});
