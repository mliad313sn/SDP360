'use strict';
// W4-CONNECTORS — Primavera P6 XER import / export (PURE: no I/O, no network). A FILE format, not a connector: nothing
// here talks to Primavera. It maps the XER tables onto the SAME plan model as services/ppm/mspdi.js, so an XER import
// reuses the MSPDI import path (engineStore.importModel: empty project, dry run by default, apply = committee).
//
//   fromXer(text)          → { model, warnings }   the model is services/ppm/mspdi normalizeModel() output
//   toXer(model, opts)     → { xer, warnings }     deterministic (same model ⇒ same bytes)
//   parseTables(text)      → { header, tables: { NAME: { fields, rows:[{field: value}] } } }
//
// Tables carried: PROJECT, CALENDAR (work week + exceptions from clndr_data), PROJWBS (→ summary tasks, outline),
// TASK (activities), TASKPRED (links), CURRTYPE (one currency). NOT carried (warned on export, ignored on import):
// resources and assignments (RSRC / TASKRSRC), baselines, user-defined fields, activity codes, secondary constraints,
// expected finish, steps, notebooks. Round-trip contract (tests/ppm-xer.test.js): fromXer(toXer(fromXer(x))) deep-equals
// fromXer(x) and toXer is a fixed point after one pass. Uids are re-numbered in outline order on import.
// Mapping choices (ADR docs/ai-decisions/ADR-w4-ppm-connectors.md):
//   · a WBS element is a SUMMARY task; an activity's task_code goes into the model's `wbs` field (the code shown in P6);
//   · durations / lags are hours in XER and days in the model: hours ÷ the calendar's day_hr_cnt (default 8);
//   · constraints CS_MSO→MSO, CS_MEO→MFO, CS_MSOA→SNET, CS_MSOB→SNLT, CS_MEOA→FNET, CS_MEOB→FNLT, CS_ALAP→ALAP;
//     the mandatory ones (CS_MANDSTART / CS_MANDFIN) become MSO / MFO with a warning;
//   · priority PT_Lowest 100 · PT_Low 300 · PT_Normal 500 · PT_High 700 · PT_Top 900;
//   · within a WBS element the activities come first (by task_id), then the child elements (by seq_num, wbs_id).
const MSPDI = require('./mspdi');

const MAX_ROWS = 200000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const CSTR_IN = { CS_MSO: 'MSO', CS_MEO: 'MFO', CS_MSOA: 'SNET', CS_MSOB: 'SNLT', CS_MEOA: 'FNET', CS_MEOB: 'FNLT', CS_ALAP: 'ALAP', CS_MANDSTART: 'MSO', CS_MANDFIN: 'MFO' };
const CSTR_OUT = { MSO: 'CS_MSO', MFO: 'CS_MEO', SNET: 'CS_MSOA', SNLT: 'CS_MSOB', FNET: 'CS_MEOA', FNLT: 'CS_MEOB', ALAP: 'CS_ALAP' };
const PRIO_IN = { PT_Lowest: 100, PT_Low: 300, PT_Normal: 500, PT_High: 700, PT_Top: 900 };
const PRIO_OUT = (p) => (p >= 800 ? 'PT_Top' : p >= 600 ? 'PT_High' : p > 400 ? 'PT_Normal' : p > 200 ? 'PT_Low' : 'PT_Lowest');
const LINK_IN = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' };
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const num = (v) => { if (v == null || String(v).trim() === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const dateOf = (v) => { const d = String(v || '').trim().slice(0, 10); return ISO.test(d) ? d : null; };
const invalid = (msg) => Object.assign(new Error(msg), { code: 'INVALID', status: 400, reason: 'XER_PARSE' });

// ---- table layer -------------------------------------------------------------------------------------------------
function parseTables(text) {
  const src = String(text == null ? '' : text).replace(/^﻿/, '');
  if (!/^ERMHDR\t/.test(src)) throw invalid('not an XER file (the first line must start with ERMHDR)');
  const tables = {}; let header = null, cur = null, rows = 0;
  for (const line of src.split(/\r?\n/)) {
    if (!line) continue;
    const parts = line.split('\t');
    switch (parts[0]) {
      case 'ERMHDR': header = parts.slice(1); break;
      case '%T': cur = { name: parts[1], fields: [], rows: [] }; tables[parts[1]] = cur; break;
      case '%F': if (!cur) throw invalid('%F before any %T'); cur.fields = parts.slice(1); break;
      case '%R': {
        if (!cur || !cur.fields.length) throw invalid('%R before the %F of its table');
        if (++rows > MAX_ROWS) throw invalid(`too many rows (more than ${MAX_ROWS})`);
        const row = {}; cur.fields.forEach((f, i) => { row[f] = parts[i + 1] == null ? '' : parts[i + 1]; }); cur.rows.push(row); break;
      }
      case '%E': return { header, tables };
      default: break;   // unknown line kinds are ignored (tolerant reader)
    }
  }
  return { header, tables };
}
const rowsOf = (t, name) => (t[name] ? t[name].rows : []);

// ---- clndr_data (nested "(0||name(attrs)(children))" nodes) -----------------------------------------------------
function parseClndr(data) {
  const s = String(data || '').replace(/\x7f/g, ' ');
  let i = 0;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  function node(depth) {
    if (depth > 20) throw invalid('calendar data nested too deep');
    ws(); if (s[i] !== '(') return null; i++;
    const a = s.indexOf('(', i); if (a < 0) return null;
    const head = s.slice(i, a).trim(); const b = s.indexOf(')', a); if (b < 0) return null;
    const attrs = s.slice(a + 1, b); i = b + 1; ws();
    const children = [];
    if (s[i] === '(') { i++; for (;;) { ws(); if (s[i] === ')') { i++; break; } if (i >= s.length) break; const c = node(depth + 1); if (!c) break; children.push(c); } }
    ws(); if (s[i] === ')') i++;
    return { name: head.split('||').pop().trim(), attrs, children };
  }
  return node(0);
}
const findNode = (n, name) => { if (!n) return null; if (n.name === name) return n; for (const c of n.children) { const r = findNode(c, name); if (r) return r; } return null; };
const serialToDate = (n) => new Date(Date.UTC(1899, 11, 30) + Number(n) * 86400000).toISOString().slice(0, 10);
const dateToSerial = (d) => Math.round((Date.parse(d + 'T00:00:00Z') - Date.UTC(1899, 11, 30)) / 86400000);
const nextDay = (d) => new Date(Date.parse(d + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10);

function calendarFromRow(r, warnings) {
  let tree = null; try { tree = parseClndr(r.clndr_data); } catch (e) { warnings.push({ code: 'CALENDAR_DATA', clndr_id: r.clndr_id, message: e.message }); }
  const dow = findNode(tree, 'DaysOfWeek');
  const workdays = dow ? dow.children.filter((c) => c.children.length > 0).map((c) => Number(c.name)).filter((d) => d >= 1 && d <= 7).map((d) => (d === 1 ? 7 : d - 1)) : [1, 2, 3, 4, 5];
  const exc = findNode(tree, 'Exceptions');
  const days = [];
  for (const c of exc ? exc.children : []) { const m = /d\|(\d+)/.exec(c.attrs); if (m) days.push({ date: serialToDate(m[1]), working: c.children.length > 0 }); }
  days.sort((a, b) => a.date.localeCompare(b.date));
  const exceptions = [];
  for (const d of days) { const last = exceptions[exceptions.length - 1]; if (last && last.working === d.working && nextDay(last.to) === d.date) last.to = d.date; else exceptions.push({ from: d.date, to: d.date, working: d.working, name: null }); }
  const base = num(r.base_clndr_id);
  return { uid: Number(r.clndr_id), name: r.clndr_name || null, is_base: base == null, base_uid: base, workdays, exceptions, hours_per_day: num(r.day_hr_cnt) };
}

// ---- XER → model --------------------------------------------------------------------------------------------------
function fromXer(text) {
  const { tables } = parseTables(text);
  const warnings = [];
  const projects = rowsOf(tables, 'PROJECT');
  if (!projects.length) throw invalid('the XER file has no PROJECT table');
  if (projects.length > 1) warnings.push({ code: 'MULTI_PROJECT', message: `the file holds ${projects.length} projects; only the first (${projects[0].proj_short_name || projects[0].proj_id}) is read` });
  const proj = projects[0], projId = String(proj.proj_id);
  const cals = rowsOf(tables, 'CALENDAR').map((r) => calendarFromRow(r, warnings));
  const calById = new Map(cals.map((c) => [c.uid, c]));
  const projCal = num(proj.clndr_id) != null && calById.has(num(proj.clndr_id)) ? num(proj.clndr_id) : (cals.find((c, i) => (rowsOf(tables, 'CALENDAR')[i].default_flag || '') === 'Y') || {}).uid;
  const projHpd = (projCal != null && calById.get(projCal) && calById.get(projCal).hours_per_day) || 8;
  const lens = [...new Set(cals.map((c) => c.hours_per_day).filter((h) => h != null))];
  if (lens.length > 1) warnings.push({ code: 'CALENDAR_DAY_LENGTH', message: `calendars have different day lengths (${lens.join(', ')} h): each activity's hours are converted with its own calendar; the plan model keeps one day length (${projHpd} h) on export` });
  const hpdOf = (cid) => { const c = cid == null ? null : calById.get(cid); return (c && c.hours_per_day) || projHpd; };
  const wbsRows = rowsOf(tables, 'PROJWBS').filter((w) => String(w.proj_id) === projId);
  const projNode = wbsRows.find((w) => w.proj_node_flag === 'Y');
  const wbs = wbsRows.filter((w) => w !== projNode);
  const wbsIds = new Set(wbs.map((w) => String(w.wbs_id)));
  const acts = rowsOf(tables, 'TASK').filter((t) => String(t.proj_id) === projId);
  const parentKey = (pid) => (pid != null && wbsIds.has(String(pid)) ? String(pid) : '');
  const kidsW = new Map(), kidsT = new Map();
  for (const w of wbs) { const k = parentKey(w.parent_wbs_id); if (!kidsW.has(k)) kidsW.set(k, []); kidsW.get(k).push(w); }
  for (const t of acts) { const k = parentKey(t.wbs_id); if (!kidsT.has(k)) kidsT.set(k, []); kidsT.get(k).push(t); }
  for (const l of kidsW.values()) l.sort((a, b) => (num(a.seq_num) ?? 0) - (num(b.seq_num) ?? 0) || Number(a.wbs_id) - Number(b.wbs_id));
  for (const l of kidsT.values()) l.sort((a, b) => Number(a.task_id) - Number(b.task_id));
  const tasks = []; const uidOfTask = new Map(); let seq = 0; const seen = new Set();
  const walk = (key, level) => {
    for (const t of kidsT.get(key) || []) {
      const uid = ++seq; uidOfTask.set(String(t.task_id), uid);
      const cid = num(t.clndr_id) != null && calById.has(num(t.clndr_id)) ? num(t.clndr_id) : null;
      const hpd = hpdOf(cid ?? projCal);
      const milestone = t.task_type === 'TT_Mile' || t.task_type === 'TT_FinMile';
      let ct = t.cstr_type ? CSTR_IN[t.cstr_type] : null;
      if (t.cstr_type && !ct) warnings.push({ code: 'CONSTRAINT_UNKNOWN', task_code: t.task_code, value: t.cstr_type });
      if (t.cstr_type === 'CS_MANDSTART' || t.cstr_type === 'CS_MANDFIN') warnings.push({ code: 'CONSTRAINT_MANDATORY', task_code: t.task_code, message: 'a mandatory constraint is read as a hard Must-Start/Finish-On' });
      if (t.cstr_type2) warnings.push({ code: 'SECONDARY_CONSTRAINT', task_code: t.task_code, message: 'secondary constraints are not carried' });
      if (t.task_type === 'TT_LOE' || t.task_type === 'TT_WBS') warnings.push({ code: 'TASK_TYPE', task_code: t.task_code, value: t.task_type, message: 'read as an ordinary activity' });
      const drtn = num(t.target_drtn_hr_cnt);
      let pct = num(t.phys_complete_pct); if (pct == null && t.status_code === 'TK_Complete') pct = 100;
      const start = dateOf(t.target_start_date || t.early_start_date);
      const finish = dateOf(t.target_end_date || t.early_end_date);
      tasks.push({ uid, id: uid, name: t.task_name || null, wbs: t.task_code || null, outline_level: level, start: milestone && t.task_type === 'TT_FinMile' ? finish : start, finish: milestone && t.task_type === 'TT_Mile' ? start : finish,
        duration_days: milestone ? 0 : drtn == null ? null : r2(drtn / hpd), milestone, summary: false, manual: false,
        constraint_type: ct, constraint_date: ct && ct !== 'ALAP' ? dateOf(t.cstr_date) : null, deadline: null,
        priority: PRIO_IN[t.priority_type] != null ? PRIO_IN[t.priority_type] : 500, percent_complete: pct, calendar_uid: cid, work_hours: null, leveling_delay_days: 0, predecessors: [], baselines: [] });
    }
    for (const w of kidsW.get(key) || []) {
      if (seen.has(String(w.wbs_id))) continue; seen.add(String(w.wbs_id));
      const uid = ++seq;
      tasks.push({ uid, id: uid, name: w.wbs_name || null, wbs: w.wbs_short_name || null, outline_level: level, start: null, finish: null, duration_days: null, milestone: false, summary: true, manual: false,
        constraint_type: null, constraint_date: null, deadline: null, priority: 500, percent_complete: null, calendar_uid: null, work_hours: null, leveling_delay_days: 0, predecessors: [], baselines: [] });
      walk(String(w.wbs_id), level + 1);
    }
  };
  walk('', 1);
  if (wbs.length > seen.size) warnings.push({ code: 'WBS_ORPHAN', count: wbs.length - seen.size, message: 'WBS elements in a parent cycle were skipped' });
  const byUid = new Map(tasks.map((t) => [t.uid, t]));
  for (const p of rowsOf(tables, 'TASKPRED')) {
    const to = uidOfTask.get(String(p.task_id)), from = uidOfTask.get(String(p.pred_task_id));
    if (to == null || from == null) { warnings.push({ code: 'LINK_OUTSIDE_PROJECT', task_pred_id: p.task_pred_id }); continue; }
    const t = byUid.get(to);
    t.predecessors.push({ uid: from, type: LINK_IN[p.pred_type] || 'FS', lag: r2((num(p.lag_hr_cnt) || 0) / hpdOf(t.calendar_uid ?? projCal)), lag_unit: 'd' });
  }
  for (const t of tasks) t.predecessors.sort((a, b) => a.uid - b.uid);
  if (rowsOf(tables, 'TASKRSRC').length || rowsOf(tables, 'RSRC').length) warnings.push({ code: 'RESOURCES_NOT_CARRIED', message: 'resources and assignments (RSRC / TASKRSRC) are not imported from XER — use MSPDI for them' });
  const curr = rowsOf(tables, 'CURRTYPE')[0];
  const model = MSPDI.normalizeModel({
    name: (projNode && projNode.wbs_name) || proj.proj_short_name || null, start_date: dateOf(proj.plan_start_date), finish_date: dateOf(proj.scd_end_date),
    minutes_per_day: Math.round(projHpd * 60), currency_code: curr ? curr.curr_short_name || null : null, calendar_uid: projCal == null ? null : projCal,
    calendars: cals.map(({ hours_per_day: _h, ...c }) => c), tasks, resources: [], assignments: [],
  });
  return { model, warnings };
}

// ---- model → XER --------------------------------------------------------------------------------------------------
const cell = (v) => (v == null ? '' : String(v).replace(/[\t\r\n]+/g, ' '));
function table(name, fields, rows) {
  const L = [`%T\t${name}`, `%F\t${fields.join('\t')}`];
  for (const r of rows) L.push(`%R\t${fields.map((f) => cell(r[f])).join('\t')}`);
  return L;
}
function clndrData(c) {
  const day = (d) => { const iso = d === 1 ? 7 : d - 1; return c.workdays.includes(iso) ? `(0||${d}()((0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())))` : `(0||${d}()())`; };
  const exc = [];
  let k = 0;
  for (const e of c.exceptions) for (let d = e.from; d <= e.to; d = nextDay(d)) exc.push(`(0||${k++}(d|${dateToSerial(d)})(${e.working ? '(0||0(s|08:00|f|12:00)())(0||1(s|13:00|f|17:00)())' : ''}))`);
  return `(0||CalendarData()((0||DaysOfWeek()(${[1, 2, 3, 4, 5, 6, 7].map(day).join('')}))(0||Exceptions()(${exc.join('')}))))`;
}

function toXer(model, opts = {}) {
  const m = MSPDI.normalizeModel(model);
  const warnings = [];
  const hpd = m.minutes_per_day / 60;
  const projId = 1;
  const isSummary = (i) => m.tasks[i].summary || (i + 1 < m.tasks.length && m.tasks[i + 1].outline_level > m.tasks[i].outline_level);
  const maxUid = m.tasks.reduce((a, t) => Math.max(a, t.uid), 0);
  const rootWbs = maxUid + 1;
  const wbsRows = [{ wbs_id: rootWbs, proj_id: projId, obs_id: '', seq_num: 0, proj_node_flag: 'Y', status_code: 'WS_Open', wbs_short_name: (m.name || 'PROJECT').slice(0, 40), wbs_name: m.name || 'Project', parent_wbs_id: '' }];
  const taskRows = [], predRows = [];
  const summaryUids = new Set();
  const stack = []; const seqOf = new Map();
  m.tasks.forEach((t, i) => {
    while (stack.length && stack[stack.length - 1].level >= t.outline_level) stack.pop();
    const parentWbs = stack.length ? stack[stack.length - 1].uid : rootWbs;
    if (isSummary(i)) {
      summaryUids.add(t.uid);
      const s = (seqOf.get(parentWbs) || 0) + 1; seqOf.set(parentWbs, s);
      wbsRows.push({ wbs_id: t.uid, proj_id: projId, obs_id: '', seq_num: s, proj_node_flag: 'N', status_code: 'WS_Open', wbs_short_name: t.wbs || `W${t.uid}`, wbs_name: t.name || `WBS ${t.uid}`, parent_wbs_id: parentWbs });
      if (t.predecessors.length) warnings.push({ code: 'SUMMARY_LINK_DROPPED', uid: t.uid, message: 'P6 has no links on WBS elements' });
      stack.push({ uid: t.uid, level: t.outline_level });
      return;
    }
    if (t.manual) warnings.push({ code: 'MANUAL_AS_AUTO', uid: t.uid, message: 'a manually scheduled task is written with a Start-On constraint at its start date' });
    if (t.deadline) warnings.push({ code: 'DEADLINE_DROPPED', uid: t.uid });
    if (t.work_hours != null) warnings.push({ code: 'WORK_DROPPED', uid: t.uid });
    const ct = t.manual && !t.constraint_type && t.start ? 'MSO' : t.constraint_type;
    const cd = t.manual && !t.constraint_type && t.start ? t.start : t.constraint_date;
    const type = t.milestone ? (ct === 'MFO' || ct === 'FNET' || ct === 'FNLT' ? 'TT_FinMile' : 'TT_Mile') : 'TT_Task';
    const pct = t.percent_complete;
    taskRows.push({ task_id: t.uid, proj_id: projId, wbs_id: parentWbs, clndr_id: t.calendar_uid == null ? (m.calendar_uid == null ? '' : m.calendar_uid) : t.calendar_uid,
      task_code: t.wbs || `A${t.uid}`, task_name: t.name || `Task ${t.uid}`, task_type: type, status_code: pct >= 100 ? 'TK_Complete' : pct > 0 ? 'TK_Active' : 'TK_NotStart',
      complete_pct_type: 'CP_Phys', phys_complete_pct: pct == null ? '' : pct, duration_type: 'DT_FixedDUR2',
      target_drtn_hr_cnt: t.milestone ? 0 : t.duration_days == null ? '' : r2(t.duration_days * hpd), target_start_date: t.start ? `${t.start} 08:00` : '', target_end_date: t.finish ? `${t.finish} ${t.milestone ? '08:00' : '17:00'}` : '',
      cstr_type: ct ? CSTR_OUT[ct] || '' : '', cstr_date: ct && ct !== 'ALAP' && cd ? `${cd} ${/^F/.test(ct) || ct === 'MFO' ? '17:00' : '08:00'}` : '', priority_type: PRIO_OUT(t.priority) });
  });
  let predId = 0;
  for (const t of m.tasks) {
    if (summaryUids.has(t.uid)) continue;
    for (const p of t.predecessors) {
      if (summaryUids.has(p.uid)) { warnings.push({ code: 'LINK_TO_SUMMARY_DROPPED', from: p.uid, to: t.uid }); continue; }
      if (p.lag_unit === '%') { warnings.push({ code: 'LAG_PERCENT_DROPPED', from: p.uid, to: t.uid }); }
      else if (p.lag_unit === 'ed') warnings.push({ code: 'LAG_ELAPSED_AS_WORK', from: p.uid, to: t.uid, message: 'an elapsed lag is written in working hours (P6 lag calendar is project-wide)' });
      predRows.push({ task_pred_id: ++predId, task_id: t.uid, pred_task_id: p.uid, proj_id: projId, pred_proj_id: projId, pred_type: `PR_${p.type}`, lag_hr_cnt: p.lag_unit === '%' ? 0 : r2(p.lag * hpd) });
    }
  }
  if (m.resources.length || m.assignments.length) warnings.push({ code: 'RESOURCES_NOT_CARRIED', message: 'resources and assignments are not written to XER — use MSPDI for them' });
  if (m.tasks.some((t) => t.baselines.length)) warnings.push({ code: 'BASELINES_NOT_CARRIED' });
  const calRows = m.calendars.map((c) => ({ clndr_id: c.uid, default_flag: c.uid === m.calendar_uid ? 'Y' : 'N', clndr_name: c.name || `Calendar ${c.uid}`, proj_id: '', base_clndr_id: c.base_uid == null ? '' : c.base_uid,
    clndr_type: 'CA_Base', day_hr_cnt: hpd, week_hr_cnt: r2(hpd * Math.max(1, c.workdays.length)), clndr_data: clndrData(c) }));
  const exportDate = opts.exportDate || m.start_date || '2000-01-01';
  const L = [['ERMHDR', '19.12', exportDate, 'Project', 'sdp360', 'sdp360', 'dbxDatabaseNoName', 'Project Management', m.currency_code || ''].join('\t')];
  if (m.currency_code) L.push(...table('CURRTYPE', ['curr_id', 'decimal_digit_cnt', 'curr_symbol', 'curr_short_name', 'curr_type'], [{ curr_id: 1, decimal_digit_cnt: 2, curr_symbol: m.currency_code, curr_short_name: m.currency_code, curr_type: m.currency_code }]));
  L.push(...table('PROJECT', ['proj_id', 'proj_short_name', 'clndr_id', 'plan_start_date', 'scd_end_date'], [{ proj_id: projId, proj_short_name: (m.name || 'PROJECT').slice(0, 40), clndr_id: m.calendar_uid == null ? '' : m.calendar_uid, plan_start_date: m.start_date ? `${m.start_date} 08:00` : '', scd_end_date: m.finish_date ? `${m.finish_date} 17:00` : '' }]));
  L.push(...table('CALENDAR', ['clndr_id', 'default_flag', 'clndr_name', 'proj_id', 'base_clndr_id', 'clndr_type', 'day_hr_cnt', 'week_hr_cnt', 'clndr_data'], calRows));
  L.push(...table('PROJWBS', ['wbs_id', 'proj_id', 'obs_id', 'seq_num', 'proj_node_flag', 'status_code', 'wbs_short_name', 'wbs_name', 'parent_wbs_id'], wbsRows));
  L.push(...table('TASK', ['task_id', 'proj_id', 'wbs_id', 'clndr_id', 'task_code', 'task_name', 'task_type', 'status_code', 'complete_pct_type', 'phys_complete_pct', 'duration_type', 'target_drtn_hr_cnt', 'target_start_date', 'target_end_date', 'cstr_type', 'cstr_date', 'priority_type'], taskRows));
  L.push(...table('TASKPRED', ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt'], predRows));
  L.push('%E');
  return { xer: L.join('\r\n') + '\r\n', warnings };
}

module.exports = { fromXer, toXer, parseTables, parseClndr, CSTR_IN, CSTR_OUT, MAX_ROWS };
