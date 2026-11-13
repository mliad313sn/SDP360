'use strict';
// W2-ENGINE — deterministic generator of the MSPDI golden project (T1). The golden FILE is not committed (it would be
// over 1 MB): this generator rebuilds it byte-for-byte from a seed, and tests/ppm-mspdi.test.js pins its SHA-256.
//   node tools/ppm/gen-mspdi-golden.js [--tasks=1000] [--out=file.xml]
// The project exercises every carried field: outline levels 1–3 (summaries), FS/SS/FF/SF links with lags in working
// days, elapsed days and % of the predecessor, the 8 constraints, deadlines, manual tasks, 0-day milestones, three
// calendars (Mon–Fri with holidays, a 6-day mine calendar based on it with a working-Saturday exception, a 7-day
// camp calendar), work / material / cost resources with rate tables A–E and effective dates, assignments with the 8
// contours, Baseline + Baseline1..10 on the leaves, levelling delays and priorities. Start / finish of every task are
// the W2 engine's result (so the file is also an end-to-end CPM fixture).
const MSPDI = require('../../services/ppm/mspdi');
const ENGINE = require('../../services/ppm/scheduleEngine');

function prng(seed) {   // mulberry32
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);
const CONSTRAINTS = ['ASAP', 'ALAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO'];
const LINKS = ['FS', 'SS', 'FF', 'SF'];
const CONTOURS = ['flat', 'back_loaded', 'front_loaded', 'double_peak', 'early_peak', 'late_peak', 'bell', 'turtle'];

function generateModel(n = 1000, seed = 20261113) {
  const rnd = prng(seed); const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
  const start = '2027-01-04';   // a Monday
  const calendars = [
    { uid: 1, name: 'Standard (Mon–Fri)', is_base: true, base_uid: null, workdays: [1, 2, 3, 4, 5], exceptions: [{ from: '2027-01-01', to: '2027-01-01', working: false, name: 'New year' }, { from: '2027-04-05', to: '2027-04-05', working: false, name: 'Easter Monday' }, { from: '2027-12-24', to: '2027-12-31', working: false, name: 'Year-end shutdown' }] },
    { uid: 2, name: 'Mine 6-day', is_base: false, base_uid: 1, workdays: [1, 2, 3, 4, 5, 6], exceptions: [{ from: '2027-06-13', to: '2027-06-13', working: true, name: 'Sunday shift' }] },
    { uid: 3, name: 'Camp 7-day', is_base: true, base_uid: null, workdays: [1, 2, 3, 4, 5, 6, 7], exceptions: [] },
  ];
  const tasks = []; const leaves = [];
  let uid = 0, l1 = 0, l2 = 0;
  while (tasks.length < n) {
    // every 25 tasks a level-1 summary, every 5 a level-2 summary, the rest leaves at level 3
    const pos = tasks.length;
    if (pos % 25 === 0) { uid++; l1++; l2 = 0; tasks.push({ uid, id: pos + 1, name: `Phase ${l1}`, wbs: `${l1}`, outline_level: 1, summary: true, predecessors: [], baselines: [] }); continue; }
    if (pos % 5 === 1) { uid++; l2++; tasks.push({ uid, id: pos + 1, name: `Work package ${l1}.${l2}`, wbs: `${l1}.${l2}`, outline_level: 2, summary: true, predecessors: [], baselines: [] }); continue; }
    uid++;
    const milestone = rnd() < 0.05;
    const t = { uid, id: pos + 1, name: `Task ${uid}${uid % 97 === 0 ? ' — Équipement & <vérif>' : ''}`, wbs: `${l1}.${l2}.${pos % 5}`, outline_level: 3, summary: false, milestone,
      duration_days: milestone ? 0 : 1 + Math.floor(rnd() * 9), priority: rnd() < 0.1 ? 1000 : 300 + Math.floor(rnd() * 5) * 100, percent_complete: rnd() < 0.2 ? Math.floor(rnd() * 10) * 10 : null,
      calendar_uid: rnd() < 0.15 ? pick([2, 3]) : null, predecessors: [], baselines: [] };
    if (rnd() < 0.08) { const c = CONSTRAINTS[Math.floor(rnd() * CONSTRAINTS.length)]; t.constraint_type = c; if (c !== 'ASAP' && c !== 'ALAP') t.constraint_date = addDays(start, 10 + Math.floor(rnd() * 300)); }
    if (rnd() < 0.05) t.deadline = addDays(start, 30 + Math.floor(rnd() * 300));
    if (rnd() < 0.02 && !milestone) { t.manual = true; t.start = addDays(start, 7 * Math.floor(rnd() * 40)); t.finish = addDays(t.start, t.duration_days + 1); }
    if (rnd() < 0.03) t.leveling_delay_days = 1 + Math.floor(rnd() * 3);
    if (leaves.length) {
      const k = rnd() < 0.3 ? 2 : 1;
      for (let j = 0; j < k; j++) {
        const p = leaves[Math.max(0, leaves.length - 1 - Math.floor(rnd() * Math.min(12, leaves.length)))];
        if (t.predecessors.some((x) => x.uid === p.uid)) continue;
        const unit = rnd() < 0.15 ? 'ed' : rnd() < 0.15 ? '%' : 'd';
        const lag = unit === '%' ? pick([25, 50, 100]) : Math.floor(rnd() * 5) - 1;
        t.predecessors.push({ uid: p.uid, type: rnd() < 0.7 ? 'FS' : pick(LINKS), lag, lag_unit: unit });
      }
    }
    tasks.push(t); leaves.push(t);
  }
  const resources = [];
  for (let i = 1; i <= 20; i++) {
    const type = i <= 14 ? 'work' : i <= 17 ? 'material' : 'cost';
    const r = { uid: i, id: i, name: `${type === 'work' ? 'Engineer' : type === 'material' ? 'Cable' : 'Travel'} ${i}`, type, generic: i === 14, material_label: type === 'material' ? 'm' : null,
      max_units_pct: type === 'work' ? pick([50, 100, 100, 200]) : null, calendar_uid: type === 'work' && i % 5 === 0 ? 2 : null, rates: [] };
    if (type !== 'cost') for (const tb of ['A', 'B', 'C', 'D', 'E'].slice(0, 1 + (i % 5))) {
      r.rates.push({ table: tb, from: '1984-01-01', standard_rate: 20 + i + tb.charCodeAt(0) - 65, overtime_rate: type === 'work' ? 30 + i : null, cost_per_use: i % 3 === 0 ? 15 : null });
      if (i % 2 === 0) r.rates.push({ table: tb, from: '2027-07-01', standard_rate: 25 + i + tb.charCodeAt(0) - 65, overtime_rate: type === 'work' ? 35 + i : null, cost_per_use: null });
    }
    resources.push(r);
  }
  const assignments = []; let au = 0;
  for (const t of leaves) {
    if (t.milestone || rnd() < 0.3) continue;
    const r = resources[Math.floor(rnd() * 14)];
    assignments.push({ uid: ++au, task_uid: t.uid, resource_uid: r.uid, units_pct: pick([50, 100]), work_hours: rnd() < 0.5 ? null : t.duration_days * 4, contour: pick(CONTOURS), rate_table: pick(['A', 'A', 'B']) });
    if (rnd() < 0.1) assignments.push({ uid: ++au, task_uid: t.uid, resource_uid: 15 + Math.floor(rnd() * 3), units_pct: 10 + Math.floor(rnd() * 90), work_hours: null, contour: 'flat', rate_table: 'A' });
    if (rnd() < 0.05) assignments.push({ uid: ++au, task_uid: t.uid, resource_uid: 18 + Math.floor(rnd() * 3), units_pct: null, work_hours: null, contour: 'flat', rate_table: 'A', cost: 100 + Math.floor(rnd() * 900) });
  }
  return MSPDI.normalizeModel({ name: 'W2 golden project', start_date: start, minutes_per_day: 480, currency_code: 'USD', calendar_uid: 1, calendars, tasks, resources, assignments });
}

/** The model with every task's start / finish computed by the W2 engine, and Baseline + Baseline1..10 on the leaves. */
function scheduledModel(n = 1000, seed = 20261113) {
  const m = generateModel(n, seed);
  const { tasks, opts } = MSPDI.modelToEngine(m);
  const res = ENGINE.schedule(tasks, opts);
  if (!res) throw new Error('golden network has a cycle');
  const rows = new Map(res.tasks.map((r) => [r.id, r]));
  for (const t of m.tasks) {
    const r = rows.get(t.uid);
    t.start = r.es_date; t.finish = r.ef_date;
    if (t.summary) t.duration_days = r.duration_days;
    if (!t.summary) for (let b = 0; b <= 10; b++) if (b === 0 || t.uid % (b + 1) === 0) t.baselines.push({ number: b, start: r.es_date, finish: r.ef_date, duration_days: t.duration_days, work_hours: t.milestone ? 0 : t.duration_days * 8, cost: b === 0 ? t.duration_days * 100 : null });
  }
  m.finish_date = res.project_finish;
  return { model: MSPDI.normalizeModel(m), schedule: res };
}

module.exports = { generateModel, scheduledModel, prng };

if (require.main === module) {
  const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith(`--${k}=`)); return a ? a.split('=')[1] : d; };
  const { model } = scheduledModel(Number(arg('tasks', 1000)));
  const xml = MSPDI.toXml(model);
  const out = arg('out', null);
  if (out) { require('fs').writeFileSync(out, xml); console.log(`wrote ${out} (${xml.length} bytes, ${model.tasks.length} tasks)`); }
  else process.stdout.write(xml);
}
