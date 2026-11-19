#!/usr/bin/env node
'use strict';
// P04 PPM certification — Microsoft Project INTEROPERABILITY KIT for a HUMAN check. Writes three MSPDI files produced by
// SDP360's exporter (services/ppm/mspdi.toXml — the code path of GET /api/governance/ppm/project/:id/mspdi.xml) and,
// next to each, the dates / float / critical flags SDP360's engine computed, so a person can open the file in
// Microsoft Project and compare. The agent CANNOT perform the check and never claims it: the result columns of the
// checklist stay empty until a person fills them.
//
//   node tools/ppm/interop-kit.js [--out=<dir>]     (default docs/agent-execution/P04-interop-kit/files, git-ignored size)
//
// Files (fictitious data):
//   A-small.xml          8 tasks: a summary, FS chain, a 0-day milestone, a constraint (SNET) and a deadline
//   B-1000-tasks.xml     the T1 golden project (tools/ppm/gen-mspdi-golden.js, seed 20261113): 1,000 tasks, 3 calendars,
//                        every link type and lag unit, the 8 constraints, resources, baselines
//   C-calendars-links.xml  28 tasks: FS / SS / FF / SF × lag in working days, elapsed days, % and leads, over a
//                        Mon–Fri calendar with holidays and a 6-day calendar with a working-Sunday exception
// Each file gets <name>.expected.csv: uid, name, start, finish, duration (working days), total float, free float,
// critical — SDP360's numbers, the reference the person compares against what Microsoft Project shows.
const fs = require('fs');
const path = require('path');
const MSPDI = require('../../services/ppm/mspdi');
const ENGINE = require('../../services/ppm/scheduleEngine');
const GOLD = require('./gen-mspdi-golden');

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith('--' + k + '=')); return a ? a.split('=').slice(1).join('=') : d; };
const OUT = path.resolve(arg('out', path.join(__dirname, '../../docs/agent-execution/P04-interop-kit/files')));

const STD = { uid: 1, name: 'Standard (Mon–Fri)', is_base: true, base_uid: null, workdays: [1, 2, 3, 4, 5], exceptions: [{ from: '2027-01-18', to: '2027-01-18', working: false, name: 'Fictitious holiday' }, { from: '2027-02-15', to: '2027-02-19', working: false, name: 'Fictitious shutdown week' }] };
const MINE = { uid: 2, name: 'Mine 6-day', is_base: false, base_uid: 1, workdays: [1, 2, 3, 4, 5, 6], exceptions: [{ from: '2027-01-24', to: '2027-01-24', working: true, name: 'Sunday shift' }] };
const T = (uid, name, x = {}) => ({ uid, id: uid, name, wbs: x.wbs || String(uid), outline_level: x.level || 1, summary: !!x.summary, milestone: !!x.milestone, manual: false, duration_days: x.summary ? null : x.milestone ? 0 : (x.d == null ? 1 : x.d),
  constraint_type: x.ct || 'ASAP', constraint_date: x.cd || null, deadline: x.deadline || null, priority: 500, percent_complete: x.pc || 0, calendar_uid: x.cal || null, work_hours: null, leveling_delay_days: null,
  predecessors: (x.p || []).map((p) => (typeof p === 'number' ? { uid: p, type: 'FS', lag: 0, lag_unit: 'd' } : p)), baselines: [] });

function small() {
  return { name: 'P04 interop A — small', start_date: '2027-01-04', minutes_per_day: 480, currency_code: 'USD', calendar_uid: 1, calendars: [STD], resources: [], assignments: [],
    tasks: [T(1, 'Phase 1', { summary: true }), T(2, 'Design', { level: 2, wbs: '1.1', d: 3 }), T(3, 'Build', { level: 2, wbs: '1.2', d: 5, p: [2] }), T(4, 'Test', { level: 2, wbs: '1.3', d: 2, p: [3] }),
      T(5, 'Procure licences', { d: 4, ct: 'SNET', cd: '2027-01-11' }), T(6, 'Integrate', { d: 2, p: [4, 5], deadline: '2027-01-22' }), T(7, 'Go-live', { milestone: true, p: [6] }), T(8, 'Hand-over', { d: 1, p: [7] })] };
}
function calLinks() {
  const tasks = []; let uid = 0;
  const L = (type, lag, unit) => ({ type, lag, lag_unit: unit });
  for (const cal of [1, 2]) {
    uid++; tasks.push(T(uid, `Block calendar ${cal}`, { summary: true, wbs: String(cal) })); const head = uid;
    let prev = null;
    for (const [type, lag, unit] of [['FS', 0, 'd'], ['FS', 2, 'd'], ['FS', -1, 'd'], ['SS', 1, 'd'], ['FF', 2, 'd'], ['SF', 3, 'd'], ['FS', 3, 'ed'], ['SS', 50, '%'], ['FF', 0, 'd'], ['FS', 1, 'd'], ['SS', 0, 'd'], ['FS', 10, 'ed'], ['FS', 0, 'd']]) {
      uid++;
      tasks.push(T(uid, `${type} lag ${lag}${unit} (cal ${cal})`, { level: 2, wbs: `${cal}.${uid - head}`, d: 2 + (uid % 4), cal, p: prev ? [{ uid: prev, ...L(type, lag, unit) }] : [] }));
      prev = uid;
    }
  }
  return { name: 'P04 interop C — calendars + all link types', start_date: '2027-01-04', minutes_per_day: 480, currency_code: 'USD', calendar_uid: 1, calendars: [STD, MINE], resources: [], assignments: [], tasks };
}
/** Start / finish of every task = the engine's (what the exporter writes for a scheduled project). */
function scheduled(model) {
  const e = MSPDI.modelToEngine(model);
  const s = ENGINE.schedule(e.tasks, e.opts);
  const by = new Map(s.tasks.map((r) => [r.id, r]));
  const m = { ...model, finish_date: s.project_finish, tasks: model.tasks.map((t) => { const r = by.get(t.uid); return { ...t, start: r.es_date, finish: r.ef_date }; }) };
  return { model: m, schedule: s };
}
function csv(model, s) {
  const by = new Map(s.tasks.map((r) => [r.id, r]));
  const q = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? '"' + String(v).replace(/"/g, '""') + '"' : String(v));
  const rows = [['uid', 'name', 'summary', 'start', 'finish', 'duration_working_days', 'total_float_wd', 'free_float_wd', 'critical']];
  for (const t of model.tasks) { const r = by.get(t.uid); rows.push([t.uid, t.name, r.summary ? 1 : 0, r.es_date, r.ef_date, r.duration_days, r.total_float, r.free_float, r.critical ? 1 : 0]); }
  return rows.map((r) => r.map(q).join(',')).join('\n') + '\n';
}
function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const out = [];
  const g = GOLD.scheduledModel(1000, 20261113);
  const gm = g.model || g;
  for (const [file, built] of [['A-small', scheduled(small())], ['B-1000-tasks', scheduled(gm)], ['C-calendars-links', scheduled(calLinks())]]) {
    const xml = MSPDI.toXml(built.model);
    // round trip on OUR parser before handing the file to a person (T1 contract): the file must re-read identically
    const back = MSPDI.toXml(MSPDI.fromXml(xml));
    if (back !== xml) throw new Error(file + ': the exporter is not a fixed point — do not hand this file out');
    fs.writeFileSync(path.join(OUT, file + '.xml'), xml);
    fs.writeFileSync(path.join(OUT, file + '.expected.csv'), csv(built.model, built.schedule));
    const crit = built.schedule.critical_path.length;
    out.push({ file: file + '.xml', tasks: built.model.tasks.length, calendars: built.model.calendars.length, links: built.schedule.links.length, link_types: [...new Set(built.schedule.links.map((l) => l.type))].sort().join('/'), project_finish: built.schedule.project_finish, critical_leaves: crit, bytes: Buffer.byteLength(xml) });
  }
  console.log(JSON.stringify({ out: OUT, files: out }, null, 1));
}
main();
