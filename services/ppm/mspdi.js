'use strict';
// W2-ENGINE — MSPDI (Microsoft Project XML, the "Project Data Interchange" schema) import / export (PURE: no I/O).
// A FILE format, not a connector: nothing here talks to MS Project or to any external tool (boundary rule: external
// PPM connectors are optional extras; the native tool never depends on them).
//
//   toXml(model)    → an MSPDI XML string (deterministic: same model ⇒ same bytes)
//   fromXml(xml)    → the model (tolerant parser: comments, CDATA, namespaces, entities; no DTD, no external entity)
//   normalizeModel  → the canonical form of a model (defaults filled) — round-trip contract:
//                     normalizeModel(fromXml(toXml(m))) deep-equals normalizeModel(m), and toXml is a fixed point.
//
// Model (all dates YYYY-MM-DD; the time of day is 08:00 for a start, 17:00 for a finish, minutes_per_day = 480):
//   { name, start_date, finish_date, minutes_per_day, currency_code, calendar_uid,
//     calendars:  [{ uid, name, is_base, base_uid, workdays:[ISO 1..7], exceptions:[{from, to, working, name}] }],
//     tasks:      [{ uid, id, name, wbs, outline_level, start, finish, duration_days, milestone, summary, manual,
//                    constraint_type, constraint_date, deadline, priority, percent_complete, calendar_uid, work_hours,
//                    leveling_delay_days, predecessors:[{uid, type, lag, lag_unit}],
//                    baselines:[{number, start, finish, duration_days, work_hours, cost}] }],
//     resources:  [{ uid, id, name, type: work|material|cost, max_units_pct, calendar_uid, material_label, generic,
//                    rates:[{ table, from, standard_rate, overtime_rate, cost_per_use }] }],
//     assignments:[{ uid, task_uid, resource_uid, units_pct, work_hours, contour, rate_table, cost }] }
// Codes (MSPDI): link Type 0 FF · 1 FS · 2 SF · 3 SS; LagFormat 7 days · 8 elapsed days · 19 percent; LinkLag in tenths
// of a minute (days × minutes_per_day × 10; elapsed × 1440 × 10; percent × 10 — the percent encoding is OUR reading
// of the schema, to be confirmed on a file saved by MS Project); ConstraintType 0 ASAP · 1 ALAP · 2 MSO · 3 MFO ·
// 4 SNET · 5 SNLT · 6 FNET · 7 FNLT; WorkContour 0 flat · 1 back · 2 front · 3 double peak · 4 early · 5 late · 6 bell ·
// 7 turtle; Resource Type 0 material · 1 work · 2 cost; RateTable 0..4 = A..E; WeekDay DayType 1 = Sunday … 7 = Saturday.
// Not carried (documented in docs/ppm/W2-ENGINE-CONTRACT.md): interim plans (MS-Project keeps them as custom
// Start1-10 / Finish1-10 fields), timephased data blocks, split tasks, one currency per file (MSPDI has one).

const LINK_CODE = { FF: 0, FS: 1, SF: 2, SS: 3 };
const LINK_OF = ['FF', 'FS', 'SF', 'SS'];
const CONSTRAINT_CODE = { ASAP: 0, ALAP: 1, MSO: 2, MFO: 3, SNET: 4, SNLT: 5, FNET: 6, FNLT: 7 };
const CONSTRAINT_OF = ['ASAP', 'ALAP', 'MSO', 'MFO', 'SNET', 'SNLT', 'FNET', 'FNLT'];
const CONTOUR_OF = ['flat', 'back_loaded', 'front_loaded', 'double_peak', 'early_peak', 'late_peak', 'bell', 'turtle'];
const RES_TYPE_CODE = { material: 0, work: 1, cost: 2 };
const RES_TYPE_OF = ['material', 'work', 'cost'];
const LAG_FMT = { d: 7, ed: 8, '%': 19 };
const RATE_TABLES = ['A', 'B', 'C', 'D', 'E'];
const DEFAULT_RATE_FROM = '1984-01-01';
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// ---- XML writer -------------------------------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
function el(name, value) { return value == null || value === '' ? '' : `<${name}>${esc(value)}</${name}>`; }
const fmtNum = (n) => { if (n == null) return null; const x = Math.round(Number(n) * 10000) / 10000; return Number.isInteger(x) ? String(x) : String(x); };
const durOf = (minutes) => { const m = Math.round(minutes); return `PT${Math.floor(m / 60)}H${m % 60}M0S`; };
const startDT = (d) => (d ? `${d}T08:00:00` : null);
const finishDT = (d) => (d ? `${d}T17:00:00` : null);
const bool = (b) => (b ? '1' : '0');

function toXml(model) {
  const m = normalizeModel(model);
  const mpd = m.minutes_per_day;
  const L = [];
  const push = (indent, s) => { if (s) L.push(' '.repeat(indent) + s); };
  L.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  L.push('<Project xmlns="http://schemas.microsoft.com/project">');
  push(1, el('SaveVersion', 14));
  push(1, el('Name', m.name));
  push(1, el('ScheduleFromStart', 1));
  push(1, el('StartDate', startDT(m.start_date)));
  push(1, el('FinishDate', finishDT(m.finish_date)));
  push(1, el('CalendarUID', m.calendar_uid == null ? -1 : m.calendar_uid));
  push(1, el('DefaultStartTime', '08:00:00'));
  push(1, el('DefaultFinishTime', '17:00:00'));
  push(1, el('MinutesPerDay', mpd));
  push(1, el('MinutesPerWeek', mpd * 5));
  push(1, el('CurrencyCode', m.currency_code));
  L.push(' <Calendars>');
  for (const c of m.calendars) {
    L.push('  <Calendar>');
    push(3, el('UID', c.uid)); push(3, el('Name', c.name)); push(3, el('IsBaseCalendar', bool(c.is_base)));
    push(3, el('BaseCalendarUID', c.base_uid == null ? -1 : c.base_uid));
    L.push('   <WeekDays>');
    for (let dt = 1; dt <= 7; dt++) {
      const iso = dt === 1 ? 7 : dt - 1, w = c.workdays.includes(iso);
      L.push(`    <WeekDay><DayType>${dt}</DayType><DayWorking>${bool(w)}</DayWorking>${w ? '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>' : ''}</WeekDay>`);
    }
    L.push('   </WeekDays>');
    if (c.exceptions.length) {
      L.push('   <Exceptions>');
      for (const e of c.exceptions) {
        L.push(`    <Exception><EnteredByOccurrences>0</EnteredByOccurrences><TimePeriod><FromDate>${e.from}T00:00:00</FromDate><ToDate>${e.to}T23:59:00</ToDate></TimePeriod><Occurrences>1</Occurrences>${el('Name', e.name)}<Type>1</Type><DayWorking>${bool(e.working)}</DayWorking>${e.working ? '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>12:00:00</ToTime></WorkingTime><WorkingTime><FromTime>13:00:00</FromTime><ToTime>17:00:00</ToTime></WorkingTime></WorkingTimes>' : ''}</Exception>`);
      }
      L.push('   </Exceptions>');
    }
    L.push('  </Calendar>');
  }
  L.push(' </Calendars>');
  L.push(' <Tasks>');
  for (const t of m.tasks) {
    L.push('  <Task>');
    push(3, el('UID', t.uid)); push(3, el('ID', t.id)); push(3, el('Name', t.name)); push(3, el('WBS', t.wbs));
    push(3, el('OutlineLevel', t.outline_level)); push(3, el('Priority', t.priority));
    push(3, el('Start', startDT(t.start))); push(3, el('Finish', t.milestone ? startDT(t.finish) : finishDT(t.finish)));
    if (t.duration_days != null) { push(3, el('Duration', durOf(t.duration_days * mpd))); push(3, el('DurationFormat', 7)); }
    if (t.work_hours != null) push(3, el('Work', durOf(t.work_hours * 60)));
    push(3, el('Milestone', bool(t.milestone))); push(3, el('Summary', bool(t.summary)));
    push(3, el('PercentComplete', t.percent_complete));
    push(3, el('ConstraintType', t.constraint_type == null ? null : CONSTRAINT_CODE[t.constraint_type]));
    push(3, el('CalendarUID', t.calendar_uid == null ? -1 : t.calendar_uid));
    if (t.constraint_date) push(3, el('ConstraintDate', /^F/.test(t.constraint_type) || t.constraint_type === 'MFO' ? finishDT(t.constraint_date) : startDT(t.constraint_date)));
    push(3, el('Deadline', finishDT(t.deadline)));
    if (t.leveling_delay_days) { push(3, el('LevelingDelay', t.leveling_delay_days * mpd * 10)); push(3, el('LevelingDelayFormat', 7)); }
    push(3, el('Manual', bool(t.manual)));
    for (const p of t.predecessors) {
      const lag = p.lag_unit === 'ed' ? p.lag * 1440 * 10 : p.lag_unit === '%' ? Math.round(p.lag * 10) : p.lag * mpd * 10;
      push(3, `<PredecessorLink><PredecessorUID>${p.uid}</PredecessorUID><Type>${LINK_CODE[p.type]}</Type><LinkLag>${lag}</LinkLag><LagFormat>${LAG_FMT[p.lag_unit]}</LagFormat></PredecessorLink>`);
    }
    for (const b of t.baselines) {
      push(3, `<Baseline><Number>${b.number}</Number>${el('Start', startDT(b.start))}${el('Finish', finishDT(b.finish))}${b.duration_days == null ? '' : el('Duration', durOf(b.duration_days * mpd)) + '<DurationFormat>7</DurationFormat>'}${b.work_hours == null ? '' : el('Work', durOf(b.work_hours * 60))}${el('Cost', fmtNum(b.cost))}</Baseline>`);
    }
    L.push('  </Task>');
  }
  L.push(' </Tasks>');
  L.push(' <Resources>');
  for (const r of m.resources) {
    L.push('  <Resource>');
    push(3, el('UID', r.uid)); push(3, el('ID', r.id)); push(3, el('Name', r.name)); push(3, el('Type', RES_TYPE_CODE[r.type]));
    push(3, el('IsGeneric', bool(r.generic))); push(3, el('MaterialLabel', r.material_label));
    push(3, el('MaxUnits', r.max_units_pct == null ? null : fmtNum(r.max_units_pct / 100)));
    push(3, el('CalendarUID', r.calendar_uid == null ? -1 : r.calendar_uid));
    if (r.rates.length) {
      L.push('   <Rates>');
      for (const x of r.rates) {
        L.push(`    <Rate><RatesFrom>${x.from}T00:00:00</RatesFrom><RatesTo>2049-12-31T23:59:00</RatesTo><RateTable>${RATE_TABLES.indexOf(x.table)}</RateTable>${el('StandardRate', fmtNum(x.standard_rate))}${x.standard_rate == null ? '' : '<StandardRateFormat>2</StandardRateFormat>'}${el('OvertimeRate', fmtNum(x.overtime_rate))}${x.overtime_rate == null ? '' : '<OvertimeRateFormat>2</OvertimeRateFormat>'}${el('CostPerUse', fmtNum(x.cost_per_use))}</Rate>`);
      }
      L.push('   </Rates>');
    }
    L.push('  </Resource>');
  }
  L.push(' </Resources>');
  L.push(' <Assignments>');
  for (const a of m.assignments) {
    push(2, `<Assignment>${el('UID', a.uid)}${el('TaskUID', a.task_uid)}${el('ResourceUID', a.resource_uid)}${el('Units', a.units_pct == null ? null : fmtNum(a.units_pct / 100))}${a.work_hours == null ? '' : el('Work', durOf(a.work_hours * 60))}${el('WorkContour', CONTOUR_OF.indexOf(a.contour))}${el('CostRateTable', RATE_TABLES.indexOf(a.rate_table))}${el('Cost', fmtNum(a.cost))}</Assignment>`);
  }
  L.push(' </Assignments>');
  L.push('</Project>');
  return L.join('\n') + '\n';
}

// ---- XML parser (subset sufficient for MSPDI; never resolves a DTD or an external entity) -------------------------
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const unesc = (s) => s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m0, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] != null ? ENT[e] : m0));
function parseXml(xml) {
  const s = String(xml || '');
  const root = { name: '#root', children: [], text: '' };
  const stack = [root];
  let i = 0;
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    const top = stack[stack.length - 1];
    if (lt < 0) { top.text += unesc(s.slice(i)); break; }
    if (lt > i) top.text += unesc(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt); if (e < 0) throw parseError('unterminated comment'); i = e + 3; continue; }
    if (s.startsWith('<![CDATA[', lt)) { const e = s.indexOf(']]>', lt); if (e < 0) throw parseError('unterminated CDATA'); top.text += s.slice(lt + 9, e); i = e + 3; continue; }
    if (s.startsWith('<?', lt)) { const e = s.indexOf('?>', lt); if (e < 0) throw parseError('unterminated declaration'); i = e + 2; continue; }
    if (s.startsWith('<!', lt)) { throw parseError('a DOCTYPE / DTD is not accepted in an MSPDI file'); }
    const gt = s.indexOf('>', lt);
    if (gt < 0) throw parseError('unterminated tag');
    let body = s.slice(lt + 1, gt);
    if (body[0] === '/') {
      const nm = body.slice(1).trim().replace(/^.*:/, '');
      const open = stack.pop();
      if (!open || open.name !== nm) throw parseError(`mismatched closing tag </${nm}>`);
      i = gt + 1; continue;
    }
    const selfClose = body.endsWith('/');
    if (selfClose) body = body.slice(0, -1);
    const nm = body.trim().split(/\s+/)[0].replace(/^.*:/, '');
    const node = { name: nm, children: [], text: '' };
    top.children.push(node);
    if (!selfClose) stack.push(node);
    i = gt + 1;
  }
  if (stack.length !== 1) throw parseError(`unclosed element <${stack[stack.length - 1].name}>`);
  return root;
}
const parseError = (msg) => Object.assign(new Error('MSPDI: ' + msg), { code: 'INVALID', reason: 'MSPDI_PARSE' });
const kid = (n, name) => (n ? n.children.find((c) => c.name === name) : null);
const kids = (n, name) => (n ? n.children.filter((c) => c.name === name) : []);
const txt = (n, name) => { const k = kid(n, name); return k ? k.text.trim() : null; };
const int = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const dateOf = (v) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
/** A finish at 00:00 means the end of the previous day (some tools write it that way). */
const finishOf = (v) => {
  const d = dateOf(v); if (!d) return null;
  if (/T00:00(:00)?$/.test(v)) return new Date(Date.parse(d + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
  return d;
};
const minutesOfDur = (v) => { const m = /^-?PT(\d+)H(\d+)M(\d+(?:\.\d+)?)S$/.exec(String(v || '')); return m ? Number(m[1]) * 60 + Number(m[2]) + Math.round(Number(m[3]) / 60) : null; };
const r2 = (x) => Math.round(x * 100) / 100;

function fromXml(xml) {
  const root = parseXml(xml);
  const P = kid(root, 'Project');
  if (!P) throw parseError('no <Project> element');
  const mpd = int(txt(P, 'MinutesPerDay')) || 480;
  const uidOrNull = (v) => { const n = int(v); return n == null || n < 0 ? null : n; };
  const calendars = kids(kid(P, 'Calendars'), 'Calendar').map((c) => {
    const workdays = [];
    for (const w of kids(kid(c, 'WeekDays'), 'WeekDay')) { const dt = int(txt(w, 'DayType')); if (dt >= 1 && dt <= 7 && txt(w, 'DayWorking') === '1') workdays.push(dt === 1 ? 7 : dt - 1); }
    const exceptions = kids(kid(c, 'Exceptions'), 'Exception').map((e) => { const tp = kid(e, 'TimePeriod'); return { from: dateOf(txt(tp, 'FromDate')), to: dateOf(txt(tp, 'ToDate')), working: txt(e, 'DayWorking') === '1', name: txt(e, 'Name') }; }).filter((e) => e.from && e.to);
    return { uid: int(txt(c, 'UID')), name: txt(c, 'Name'), is_base: txt(c, 'IsBaseCalendar') === '1', base_uid: uidOrNull(txt(c, 'BaseCalendarUID')), workdays: workdays.sort((a, b) => a - b), exceptions };
  });
  const tasks = kids(kid(P, 'Tasks'), 'Task').filter((t) => txt(t, 'IsNull') !== '1').map((t) => {
    const durMin = minutesOfDur(txt(t, 'Duration')), workMin = minutesOfDur(txt(t, 'Work'));
    const ct = int(txt(t, 'ConstraintType'));
    const milestone = txt(t, 'Milestone') === '1';
    return {
      uid: int(txt(t, 'UID')), id: int(txt(t, 'ID')), name: txt(t, 'Name'), wbs: txt(t, 'WBS'), outline_level: int(txt(t, 'OutlineLevel')),
      start: dateOf(txt(t, 'Start')), finish: milestone ? dateOf(txt(t, 'Finish')) : finishOf(txt(t, 'Finish')),
      duration_days: durMin == null ? null : r2(durMin / mpd), milestone, summary: txt(t, 'Summary') === '1', manual: txt(t, 'Manual') === '1',
      constraint_type: ct == null ? null : CONSTRAINT_OF[ct] || null, constraint_date: dateOf(txt(t, 'ConstraintDate')), deadline: dateOf(txt(t, 'Deadline')),
      priority: int(txt(t, 'Priority')), percent_complete: int(txt(t, 'PercentComplete')), calendar_uid: uidOrNull(txt(t, 'CalendarUID')),
      work_hours: workMin == null ? null : r2(workMin / 60),
      leveling_delay_days: int(txt(t, 'LevelingDelay')) ? r2(int(txt(t, 'LevelingDelay')) / (mpd * 10)) : 0,
      predecessors: kids(t, 'PredecessorLink').map((l) => {
        const fmt = int(txt(l, 'LagFormat')), raw = int(txt(l, 'LinkLag')) || 0;
        const unit = fmt === 8 ? 'ed' : fmt === 19 || fmt === 20 ? '%' : 'd';
        return { uid: int(txt(l, 'PredecessorUID')), type: LINK_OF[int(txt(l, 'Type'))] || 'FS', lag: unit === 'ed' ? r2(raw / 14400) : unit === '%' ? r2(raw / 10) : r2(raw / (mpd * 10)), lag_unit: unit };
      }),
      baselines: kids(t, 'Baseline').map((b) => { const dm = minutesOfDur(txt(b, 'Duration')), wm = minutesOfDur(txt(b, 'Work')); const c = txt(b, 'Cost'); return { number: int(txt(b, 'Number')), start: dateOf(txt(b, 'Start')), finish: finishOf(txt(b, 'Finish')), duration_days: dm == null ? null : r2(dm / mpd), work_hours: wm == null ? null : r2(wm / 60), cost: c == null ? null : Number(c) }; }),
    };
  });
  const resources = kids(kid(P, 'Resources'), 'Resource').filter((r) => int(txt(r, 'UID')) !== 0 || txt(r, 'Name')).map((r) => {
    const mu = txt(r, 'MaxUnits');
    return {
      uid: int(txt(r, 'UID')), id: int(txt(r, 'ID')), name: txt(r, 'Name'), type: RES_TYPE_OF[int(txt(r, 'Type'))] || 'work', generic: txt(r, 'IsGeneric') === '1',
      material_label: txt(r, 'MaterialLabel'), max_units_pct: mu == null ? null : r2(Number(mu) * 100), calendar_uid: uidOrNull(txt(r, 'CalendarUID')),
      rates: kids(kid(r, 'Rates'), 'Rate').map((x) => { const n = (k) => { const v = txt(x, k); return v == null ? null : Number(v); }; return { table: RATE_TABLES[int(txt(x, 'RateTable')) || 0], from: dateOf(txt(x, 'RatesFrom')) || DEFAULT_RATE_FROM, standard_rate: n('StandardRate'), overtime_rate: n('OvertimeRate'), cost_per_use: n('CostPerUse') }; }),
    };
  });
  const assignments = kids(kid(P, 'Assignments'), 'Assignment').map((a) => {
    const wm = minutesOfDur(txt(a, 'Work')), u = txt(a, 'Units'), c = txt(a, 'Cost');
    return { uid: int(txt(a, 'UID')), task_uid: int(txt(a, 'TaskUID')), resource_uid: int(txt(a, 'ResourceUID')), units_pct: u == null ? null : r2(Number(u) * 100), work_hours: wm == null ? null : r2(wm / 60), contour: CONTOUR_OF[int(txt(a, 'WorkContour')) || 0], rate_table: RATE_TABLES[int(txt(a, 'CostRateTable')) || 0], cost: c == null ? null : Number(c) };
  }).filter((a) => a.task_uid != null && a.resource_uid != null && a.resource_uid >= 0);
  return normalizeModel({
    name: txt(P, 'Name'), start_date: dateOf(txt(P, 'StartDate')), finish_date: finishOf(txt(P, 'FinishDate')), minutes_per_day: mpd,
    currency_code: txt(P, 'CurrencyCode'), calendar_uid: uidOrNull(txt(P, 'CalendarUID')), calendars, tasks, resources, assignments,
  });
}

// ---- canonical form --------------------------------------------------------------------------------------------
const nn = (v) => (v == null || v === '' ? null : v);
const nnum = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : r2(Number(v)));
function normalizeModel(m) {
  const x = m || {};
  return {
    name: nn(x.name), start_date: nn(x.start_date), finish_date: nn(x.finish_date), minutes_per_day: Number(x.minutes_per_day) > 0 ? Number(x.minutes_per_day) : 480,
    currency_code: nn(x.currency_code), calendar_uid: x.calendar_uid == null ? null : Number(x.calendar_uid),
    calendars: (x.calendars || []).map((c) => ({ uid: Number(c.uid), name: nn(c.name), is_base: !!c.is_base, base_uid: c.base_uid == null ? null : Number(c.base_uid),
      workdays: [...new Set((c.workdays || []).map(Number))].sort((a, b) => a - b),
      exceptions: (c.exceptions || []).filter((e) => e && ISO.test(String(e.from)) && ISO.test(String(e.to))).map((e) => ({ from: e.from, to: e.to, working: !!e.working, name: nn(e.name) })) })),
    tasks: (x.tasks || []).map((t) => ({
      uid: Number(t.uid), id: t.id == null ? null : Number(t.id), name: nn(t.name), wbs: nn(t.wbs), outline_level: t.outline_level == null ? 1 : Number(t.outline_level),
      start: nn(t.start), finish: nn(t.finish), duration_days: nnum(t.duration_days), milestone: !!t.milestone, summary: !!t.summary, manual: !!t.manual,
      constraint_type: CONSTRAINT_CODE[String(t.constraint_type || '').toUpperCase()] != null ? String(t.constraint_type).toUpperCase() : null,
      constraint_date: nn(t.constraint_date), deadline: nn(t.deadline), priority: t.priority == null ? 500 : Number(t.priority),
      percent_complete: t.percent_complete == null ? null : Number(t.percent_complete), calendar_uid: t.calendar_uid == null ? null : Number(t.calendar_uid),
      work_hours: nnum(t.work_hours), leveling_delay_days: Number(t.leveling_delay_days) > 0 ? r2(Number(t.leveling_delay_days)) : 0,
      predecessors: (t.predecessors || []).map((p) => ({ uid: Number(p.uid), type: LINK_CODE[String(p.type || 'FS').toUpperCase()] != null ? String(p.type || 'FS').toUpperCase() : 'FS', lag: nnum(p.lag) || 0, lag_unit: LAG_FMT[p.lag_unit] ? p.lag_unit : 'd' })),
      baselines: (t.baselines || []).map((b) => ({ number: Number(b.number), start: nn(b.start), finish: nn(b.finish), duration_days: nnum(b.duration_days), work_hours: nnum(b.work_hours), cost: nnum(b.cost) })).sort((a, b) => a.number - b.number),
    })),
    resources: (x.resources || []).map((r) => ({ uid: Number(r.uid), id: r.id == null ? null : Number(r.id), name: nn(r.name), type: RES_TYPE_CODE[r.type] != null ? r.type : 'work', generic: !!r.generic,
      material_label: nn(r.material_label), max_units_pct: nnum(r.max_units_pct), calendar_uid: r.calendar_uid == null ? null : Number(r.calendar_uid),
      rates: (r.rates || []).map((q) => ({ table: RATE_TABLES.includes(q.table) ? q.table : 'A', from: q.from || DEFAULT_RATE_FROM, standard_rate: nnum(q.standard_rate), overtime_rate: nnum(q.overtime_rate), cost_per_use: nnum(q.cost_per_use) }))
        .sort((a, b) => a.table.localeCompare(b.table) || a.from.localeCompare(b.from)) })),
    assignments: (x.assignments || []).map((a) => ({ uid: Number(a.uid), task_uid: Number(a.task_uid), resource_uid: Number(a.resource_uid), units_pct: nnum(a.units_pct), work_hours: nnum(a.work_hours),
      contour: CONTOUR_OF.includes(a.contour) ? a.contour : 'flat', rate_table: RATE_TABLES.includes(a.rate_table) ? a.rate_table : 'A', cost: nnum(a.cost) })),
  };
}

/**
 * The model as engine input (services/ppm/scheduleEngine.schedule): hierarchy from the outline levels, typed links
 * with lag units, constraints, deadlines, calendars (by uid), manual tasks keep their dates; an AUTO task's file
 * dates are NOT passed (the engine recomputes them; passing them would act as start-no-earlier-than).
 */
function modelToEngine(model) {
  const m = normalizeModel(model);
  const CAL = require('./calendars');
  const calendars = {};
  const byUid = new Map(m.calendars.map((c) => [c.uid, c]));
  for (const c of m.calendars) {
    const chain = []; for (let x = c; x && !chain.includes(x); x = x.base_uid == null ? null : byUid.get(x.base_uid)) chain.push(x);
    const exc = new Map();
    for (const x of [...chain].reverse()) for (const e of x.exceptions) for (const d of CAL.expandRange(e.from, e.to)) exc.set(d, e.working);
    calendars[c.uid] = { workdays: c.workdays.length ? c.workdays : (chain.find((x) => x.workdays.length) || { workdays: [1, 2, 3, 4, 5] }).workdays, holidays: [], exceptions: [...exc].sort((a, b) => a[0].localeCompare(b[0])).map(([date, working]) => ({ date, working })) };
  }
  const stack = [];
  const tasks = m.tasks.map((t) => {
    while (stack.length && stack[stack.length - 1].level >= t.outline_level) stack.pop();
    const parent = stack.length ? stack[stack.length - 1].uid : null;
    stack.push({ uid: t.uid, level: t.outline_level });
    return {
      id: t.uid, name: t.name, wbs_code: t.wbs, parent_id: parent,
      depends_on: t.predecessors.map((p) => p.uid), dependency_links: t.predecessors.map((p) => ({ id: p.uid, type: p.type, lag: p.lag, lag_unit: p.lag_unit })),
      duration_days: t.summary ? null : t.milestone ? 0 : t.duration_days, schedule_mode: t.manual ? 'manual' : 'auto',
      start_date: t.manual ? t.start : null, end_date: t.manual ? t.finish : null,
      constraint_type: t.constraint_type, constraint_date: t.constraint_date, deadline: t.deadline, calendar_id: t.calendar_uid,
      leveling_delay_days: t.leveling_delay_days || null, progress_pct: t.percent_complete, effort_hours: t.work_hours, priority: t.priority,
    };
  });
  return { tasks, opts: { anchor: m.start_date, calendar: m.calendar_uid != null ? calendars[m.calendar_uid] || null : null, calendars } };
}

module.exports = { modelToEngine, toXml, fromXml, parseXml, normalizeModel, LINK_CODE, CONSTRAINT_CODE, CONTOUR_OF, RES_TYPE_CODE, LAG_FMT, DEFAULT_RATE_FROM };
