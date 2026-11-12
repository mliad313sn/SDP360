'use strict';
// E-P06 (audit P-06) — RACI per project and project templates. PURE: no DB, no clock.
//   validateRaci(rows, taskIds)  every task that has letters carries EXACTLY one A; letters R/A/C/I only; the task
//                                must belong to the project; a person is non-empty text. → [] when valid.
//   matrix(rows, tasks)          task × person table (letters joined) for the page and the CSV.
//   raciCsv(m)                   CSV (formula-injection guarded: a cell starting = + - @ is prefixed with ').
//   templateFromProject(d)       the STRUCTURE only: task names, WBS codes, parent links, durations, milestone names.
//                                No owner, no date, no allocation, no effort, no money, no RACI people.
//   planFromTemplate(structure)  the rows to create, parents first (ref → new id mapping done by the store).
const LETTERS = ['R', 'A', 'C', 'I'];

function validateRaci(rows, taskIds) {
  const known = new Set((taskIds || []).map(Number)), errors = [], byTask = new Map();
  (rows || []).forEach((r, i) => {
    const t = Number(r && r.task_id), letter = String((r && r.letter) || '').toUpperCase(), person = String((r && r.person) || '').trim();
    if (!known.has(t)) { errors.push({ row: i, task_id: t, code: 'UNKNOWN_TASK', error: 'the task is not in this project' }); return; }
    if (!LETTERS.includes(letter)) { errors.push({ row: i, task_id: t, code: 'BAD_LETTER', error: 'letter must be R, A, C or I' }); return; }
    if (!person) { errors.push({ row: i, task_id: t, code: 'NO_PERSON', error: 'a person is required' }); return; }
    if (!byTask.has(t)) byTask.set(t, []);
    byTask.get(t).push(letter);
  });
  for (const [t, ls] of byTask) {
    const a = ls.filter((l) => l === 'A').length;
    if (a === 0) errors.push({ task_id: t, code: 'NO_ACCOUNTABLE', error: 'a task with a RACI needs exactly one A (accountable)' });
    if (a > 1) errors.push({ task_id: t, code: 'MULTIPLE_ACCOUNTABLE', error: 'only one person is accountable (A) for a task' });
  }
  return errors;
}

function normalise(rows) {
  const seen = new Set(), out = [];
  for (const r of rows || []) {
    const x = { task_id: Number(r.task_id), person: String(r.person || '').trim().slice(0, 120), letter: String(r.letter || '').toUpperCase() };
    const k = `${x.task_id}|${x.person.toLowerCase()}|${x.letter}`;
    if (!seen.has(k)) { seen.add(k); out.push(x); }
  }
  return out;
}

function matrix(rows, tasks) {
  const people = [...new Set((rows || []).map((r) => r.person))].sort((a, b) => a.localeCompare(b));
  const list = (tasks || []).map((t) => {
    const cells = {};
    for (const p of people) { const ls = (rows || []).filter((r) => Number(r.task_id) === Number(t.id) && r.person === p).map((r) => r.letter); cells[p] = LETTERS.filter((l) => ls.includes(l)).join(''); }
    const a = (rows || []).filter((r) => Number(r.task_id) === Number(t.id) && r.letter === 'A').length;
    return { id: Number(t.id), label: [t.wbs_code, t.name].filter((v) => v != null && v !== '').join(' '), cells, accountable: a };
  });
  return { people, tasks: list };
}

const csvCell = (v) => { let s = v == null ? '' : String(v); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
function raciCsv(m) {
  const head = ['Task', ...m.people].map(csvCell).join(',');
  return [head, ...m.tasks.map((t) => [t.label, ...m.people.map((p) => t.cells[p])].map(csvCell).join(','))].join('\r\n') + '\r\n';
}

function templateFromProject(d) {
  const tasks = (d && d.tasks) || [];
  const ref = new Map(tasks.map((t, i) => [Number(t.id), 't' + (i + 1)]));
  return {
    tasks: tasks.map((t) => ({ ref: ref.get(Number(t.id)), parent_ref: t.parent_id != null && ref.has(Number(t.parent_id)) ? ref.get(Number(t.parent_id)) : null, wbs_code: t.wbs_code || null, name: String(t.name || '').slice(0, 300), duration_days: t.duration_days == null ? null : Number(t.duration_days) })),
    milestones: ((d && d.milestones) || []).map((m) => ({ name: String(m.name || '').slice(0, 300) })),
  };
}

function planFromTemplate(structure) {
  const st = structure || {}, tasks = Array.isArray(st.tasks) ? st.tasks : [], refs = new Set(tasks.map((t) => t.ref));
  const out = [], done = new Set();
  let guard = 0;
  while (out.length < tasks.length && guard++ <= tasks.length) {
    for (const t of tasks) if (!done.has(t.ref) && (!t.parent_ref || !refs.has(t.parent_ref) || done.has(t.parent_ref))) { out.push({ ref: t.ref, parent_ref: refs.has(t.parent_ref) ? t.parent_ref : null, wbs_code: t.wbs_code || null, name: String(t.name || ''), duration_days: t.duration_days == null ? null : Number(t.duration_days) }); done.add(t.ref); }
  }
  return { tasks: out, milestones: (Array.isArray(st.milestones) ? st.milestones : []).map((m) => ({ name: String(m.name || '') })) };
}

module.exports = { LETTERS, validateRaci, normalise, matrix, raciCsv, templateFromProject, planFromTemplate };
