'use strict';
// P04 (PPM certification) — ONE place that turns a project's rows into the scheduling engine's input, so that every
// view of a project (the W2 /schedule route, the project page plan, the W3 summary cards / RAG slip / DCMA, the
// scheduled project report) reads the SAME engine dates. Before this module only routes/ppmEngine.js applied the
// project / task / resource calendars and the stored levelling delays; the other views scheduled on the default
// Mon–Fri calendar, so the dashboard did not reconcile to the engine once ppm_calendars_enabled was on (T10).
//
// Switches off (= today): the input is the raw task rows + anchor / deadline, exactly what those views used before.
const CAL = require('./calendars');

const on = (c, k) => String((c || {})[k]) === '1';
/** The engine switches the input depends on (same derivation as routes/ppmEngine.js). */
function engineSwitches(c) {
  return { calendars: on(c, 'ppm_calendars_enabled'), resources: on(c, 'ppm_resources_enabled'), leveling: on(c, 'ppm_leveling_enabled') && on(c, 'ppm_resources_enabled') };
}

/**
 * PURE. The engine tasks and options of one project.
 * @param {{d:{project:object, tasks:Array}, s:{calendars:boolean, resources:boolean, leveling:boolean}, tf?:object,
 *          assignments?:Array, resources?:Array, pe?:{calendar_id:number|null}, ctx?:object, statusDate?:string|null,
 *          clearExisting?:boolean, levelingDelays?:object|null}} x
 * @returns {{engineTasks:Array, opts:object, ec:object, hpd:number}}
 */
function buildEngineInput(x) {
  const d = x.d, s = x.s || {}, tf = x.tf || {};
  const tasks = d.tasks || [];
  const ctx = x.ctx || { calendars: [], exceptions: [], siteHolidays: [] };
  const pe = x.pe || { calendar_id: null };
  const ec = CAL.engineCalendars({ tasks, projectCalendarId: s.calendars ? pe.calendar_id : null, taskFields: s.calendars ? tf : {}, assignments: s.calendars ? (x.assignments || []) : [], resources: s.calendars ? (x.resources || []) : [], calendarsCtx: ctx });
  const hpd = ec.hours_per_day || 8;
  const engineTasks = tasks.map((t) => ({ ...t, calendar_id: ec.effective[t.id] && ec.effective[t.id].calendar_id != null ? ec.effective[t.id].calendar_id : null,
    leveling_delay_days: s.leveling && !x.clearExisting ? (tf[t.id] ? tf[t.id].leveling_delay_days : null) : null, priority: tf[t.id] ? tf[t.id].priority : null }));
  const opts = { anchor: d.project.start_date || null, deadline: d.project.finish_deadline || null, calendar: ec.calendar, calendars: ec.calendars, statusDate: x.statusDate || null, hoursPerDay: hpd };
  if (x.levelingDelays) opts.levelingDelays = x.levelingDelays;
  return { engineTasks, opts, ec, hpd };
}

/**
 * Reads what the input needs (only when a switch is on) and builds it. `S` = an engine store
 * (services/ppm/engineStore.makeEngineStore). Switches off → no read, the raw rows and today's options.
 * @returns {Promise<{engineTasks:Array, opts:object, calendar:object|null, ec:object|null, tf:object, assignments:Array, resources:Array, pe:object, ctx:object, hpd:number}>}
 */
async function loadEngineInput({ S, d, cfg, s: sIn = null, statusDate = null, money = false }) {
  const s = sIn || engineSwitches(cfg);
  const tasks = d.tasks || [];
  if (!s.calendars && !s.resources) {
    return { engineTasks: tasks, opts: { anchor: d.project.start_date || null, deadline: d.project.finish_deadline || null, ...(statusDate ? { statusDate } : {}) }, calendar: null, ec: null, tf: {}, assignments: [], resources: [], rates: [], pe: { calendar_id: null }, ctx: { calendars: [], exceptions: [], siteHolidays: [] }, hpd: 8, s };
  }
  const tids = tasks.map((t) => t.id);
  const tf = await S.taskFieldsFor(tids);
  const assignments = s.resources ? await S.assignmentsFor(tids) : [];
  const resources = s.resources ? await S.resourcesByIds(assignments.map((a) => a.resource_id)) : [];
  const rates = s.resources && money ? await S.ratesFor(resources.map((r) => r.id)) : [];
  const pe = s.calendars ? await S.projectEngine(d.project.id) : { calendar_id: null };
  const ctx = s.calendars ? await S.calendarsCtx() : { calendars: [], exceptions: [], siteHolidays: [] };
  const b = buildEngineInput({ d, s, tf, assignments, resources, pe, ctx, statusDate });
  return { ...b, calendar: b.ec.calendar, tf, assignments, resources, rates, pe, ctx, s };
}

module.exports = { buildEngineInput, loadEngineInput, engineSwitches };
