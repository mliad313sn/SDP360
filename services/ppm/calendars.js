'use strict';
// W2-ENGINE — project / task / resource calendars (PURE: no I/O, no clock). Turns stored calendar rows (migration 105:
// ppm_calendars + ppm_calendar_exceptions) and the site holiday calendar (site_calendar, migration 037) into the
// spec services/ppm/scheduleEngine.makeCalendar reads: { workdays, holidays, exceptions, hours_per_day }.
//
// Rules (ADR docs/ai-decisions/ADR-W2-ENGINE-calendars-resources-mspdi.md):
//   - a calendar inherits from its base calendar (work week, hours per day, holidays, exceptions); its own values win;
//   - use_site_holidays = 1 adds the live site_calendar days of its site (and the platform rows, site_id NULL);
//     a calendar without a site takes the platform rows only;
//   - an exception (a day range) overrides the work week AND the holidays (a working Saturday shift, a closure);
//     the calendar's own exceptions override its base's;
//   - a base chain that loops is cut at the loop (the calendar is resolved from what was read before the loop).
// Effective calendar of a task (MS-Project order): its own task calendar, else — unless "ignore resource calendar" —
// the calendar of its PRIMARY work resource (highest units, then lowest id), else the project calendar, else the
// engine default (Mon–Fri). The primary-resource rule is an approximation of MS-Project, which schedules each
// assignment on its own resource calendar (documented in the ADR).

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const DAY = 86400000;
const MAX_RANGE_DAYS = 3660;   // an exception longer than ten years is refused by the store; capped here too
const toMs = (d) => Date.parse(d + 'T00:00:00Z');
const isoOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const parseDays = (v) => {
  let a = v;
  if (typeof a === 'string') { try { a = JSON.parse(a); } catch (_) { a = null; } }
  if (!Array.isArray(a)) return null;
  const out = [...new Set(a.map(Number).filter((x) => Number.isInteger(x) && x >= 1 && x <= 7))].sort((x, y) => x - y);
  return out.length ? out : null;
};
const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

/** Expand an inclusive day range into ISO days (empty when malformed or longer than the cap). */
function expandRange(from, to) {
  if (!ISO.test(String(from || '')) || !ISO.test(String(to || ''))) return [];
  const a = toMs(from), b = toMs(to);
  if (!(b >= a) || (b - a) / DAY > MAX_RANGE_DAYS) return [];
  const out = [];
  for (let t = a; t <= b; t += DAY) out.push(isoOf(t));
  return out;
}

/**
 * @param {number|string} calendarId
 * @param {{calendars:Array<object>, exceptions:Array<object>, siteHolidays:Array<{site_id:number|null, day:string}>}} ctx
 * @returns {null|{id:number, name:string, workdays:number[], holidays:string[], exceptions:Array<{date,working}>, hours_per_day:number|null, chain:number[], loop:boolean}}
 */
function resolveCalendar(calendarId, ctx) {
  const byId = new Map((ctx.calendars || []).filter((c) => c && !c.removed_at).map((c) => [Number(c.id), c]));
  const start = byId.get(Number(calendarId));
  if (!start) return null;
  const chain = []; let loop = false;
  for (let c = start; c; c = c.base_calendar_id == null ? null : byId.get(Number(c.base_calendar_id))) {
    if (chain.includes(Number(c.id))) { loop = true; break; }
    chain.push(Number(c.id));
  }
  // own values first: the first calendar of the chain that states a value wins
  let workdays = null, hpd = null;
  for (const id of chain) {
    const c = byId.get(id);
    if (workdays == null) workdays = parseDays(c.workdays);
    if (hpd == null) hpd = num(c.hours_per_day);
  }
  const holidays = new Set();
  for (const id of chain) {
    const c = byId.get(id);
    if (Number(c.use_site_holidays) === 0) continue;
    for (const h of ctx.siteHolidays || []) {
      if (!h || h.removed_at || !ISO.test(String(h.day || ''))) continue;
      if (h.site_id == null || (c.site_id != null && Number(h.site_id) === Number(c.site_id))) holidays.add(String(h.day));
    }
  }
  // exceptions: base first, then each nearer calendar overrides (so the calendar's own exceptions are applied last)
  const exc = new Map();
  for (const id of [...chain].reverse()) {
    for (const e of (ctx.exceptions || []).filter((x) => Number(x.calendar_id) === id).sort((x, y) => String(x.day_from).localeCompare(String(y.day_from)) || Number(x.id) - Number(y.id))) {
      for (const d of expandRange(e.day_from, e.day_to)) exc.set(d, Number(e.working) === 1);
    }
  }
  return {
    id: Number(start.id), name: String(start.name || ''), workdays: workdays || [1, 2, 3, 4, 5], hours_per_day: hpd,
    holidays: [...holidays].sort(), exceptions: [...exc.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([date, working]) => ({ date, working })),
    chain, loop,
  };
}

/** The engine spec of a resolved calendar (what scheduleEngine.makeCalendar reads). */
const specOf = (r) => (r ? { workdays: r.workdays, holidays: r.holidays, exceptions: r.exceptions } : null);

/**
 * Effective calendar per task + the engine options.
 * @param {{tasks:Array, projectCalendarId?:number|null, taskFields?:Object<number,{calendar_id,ignore_resource_calendar}>,
 *          assignments?:Array<{task_id,resource_id,units_pct}>, resources?:Array<{id,kind,calendar_id}>, calendarsCtx:object}} p
 * @returns {{calendar:object|null, calendars:Object<string,object>, effective:Object<number,{calendar_id:number|null, source:string}>, resolved:Object<string,object>, hours_per_day:number|null}}
 */
function engineCalendars(p) {
  const resolved = {};
  const get = (id) => { if (id == null) return null; const k = String(Number(id)); if (!(k in resolved)) resolved[k] = resolveCalendar(id, p.calendarsCtx || {}); return resolved[k]; };
  const proj = get(p.projectCalendarId);
  const resById = new Map((p.resources || []).map((r) => [Number(r.id), r]));
  const byTask = new Map();
  for (const a of p.assignments || []) {
    const r = resById.get(Number(a.resource_id));
    if (!r || (r.kind || 'work') !== 'work') continue;
    if (!byTask.has(Number(a.task_id))) byTask.set(Number(a.task_id), []);
    byTask.get(Number(a.task_id)).push({ a, r });
  }
  const effective = {};
  for (const t of p.tasks || []) {
    const id = Number(t.id), f = (p.taskFields || {})[id] || {};
    if (f.calendar_id != null && get(f.calendar_id)) { effective[id] = { calendar_id: Number(f.calendar_id), source: 'task' }; continue; }
    if (Number(f.ignore_resource_calendar) !== 1) {
      const xs = (byTask.get(id) || []).slice().sort((x, y) => (num(y.a.units_pct) ?? 100) - (num(x.a.units_pct) ?? 100) || Number(x.r.id) - Number(y.r.id));
      const primary = xs.find((x) => x.r.calendar_id != null && get(x.r.calendar_id));
      if (primary) { effective[id] = { calendar_id: Number(primary.r.calendar_id), source: 'resource', resource_id: Number(primary.r.id) }; continue; }
    }
    effective[id] = proj ? { calendar_id: proj.id, source: 'project' } : { calendar_id: null, source: 'default' };
  }
  const calendars = {};
  for (const [k, r] of Object.entries(resolved)) if (r) calendars[k] = specOf(r);
  return { calendar: specOf(proj), calendars, effective, resolved, hours_per_day: proj ? proj.hours_per_day : null };
}

module.exports = { resolveCalendar, engineCalendars, specOf, expandRange, parseDays, MAX_RANGE_DAYS };
