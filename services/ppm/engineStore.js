'use strict';
// W2-ENGINE — store of the W2 scheduling data (migration 105): calendars + exceptions, project / task engine fields
// (calendar, priority, levelling delay), the resource pool, rate tables A–E, assignments, baseline slots, and the
// MSPDI import into an empty project. Same db handle shape as services/governanceStore (prepare(sql).get/all/run,
// runTransaction). Every write leaves a hash-chained ppm_events row through the governance store's ppmEvent. The
// routes (routes/ppmEngine.js) decide the switches and the access rules; the store checks the data.
const RES = require('./resources');
const SLOTS = require('./baselineSlots');
const CAL = require('./calendars');

const num = (v) => { if (v == null || v === '') return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const str = (v, n = 300) => (v == null || String(v).trim() === '' ? null : String(v).trim().slice(0, n));
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const invalid = (msg, reason) => Object.assign(new Error(msg), { code: 'INVALID', status: 400, ...(reason ? { reason } : {}) });
const notFound = (msg) => Object.assign(new Error(msg), { code: 'NOT_FOUND', status: 404 });
const day = (v, k) => { if (v == null || v === '') return null; const d = String(v).slice(0, 10); if (!ISO.test(d) || Number.isNaN(Date.parse(d + 'T00:00:00Z'))) throw invalid(`${k} must be YYYY-MM-DD`, 'BAD_DATE'); return d; };
const uid = (u) => (u && u.id != null ? Number(u.id) : null);

function makeEngineStore(db, gov, { now = () => new Date().toISOString() } = {}) {
  if (!db || !gov) throw new Error('engine store needs a db handle and the governance store');
  const P = (sql) => db.prepare(sql);
  const tx = (fn) => (typeof db.runTransaction === 'function' ? db.runTransaction(fn) : fn());
  const ids = (xs) => [...new Set((xs || []).map(Number).filter(Number.isInteger))];
  const inList = (xs) => xs.map(() => '?').join(',');
  const insertId = async (sql, args) => { const r = await P(sql + ' RETURNING id').get(...args); return Number(r.id); };
  const event = (pid, action, field, oldV, newV, user, note) => gov.ppmEvent({ entity: 'project', entity_id: Number(pid), action, field, old_value: oldV, new_value: newV, note }, user);

  // ---- calendars ------------------------------------------------------------------------------------------------
  const calRow = (r) => r && { id: Number(r.id), name: r.name, site_id: r.site_id == null ? null : Number(r.site_id), base_calendar_id: r.base_calendar_id == null ? null : Number(r.base_calendar_id), workdays: CAL.parseDays(r.workdays), hours_per_day: num(r.hours_per_day), use_site_holidays: Number(r.use_site_holidays) === 0 ? 0 : 1, updated_at: r.updated_at || r.created_at || null };
  const excRow = (r) => ({ id: Number(r.id), calendar_id: Number(r.calendar_id), day_from: r.day_from, day_to: r.day_to, working: Number(r.working) === 1, label: r.label || null });
  async function listCalendars() {
    const cals = (await P(`SELECT * FROM ppm_calendars WHERE removed_at IS NULL ORDER BY name, id`).all()).map(calRow);
    const exc = (await P(`SELECT * FROM ppm_calendar_exceptions ORDER BY calendar_id, day_from, id`).all()).map(excRow);
    return cals.map((c) => ({ ...c, exceptions: exc.filter((e) => e.calendar_id === c.id) }));
  }
  async function siteHolidays() {
    return (await P(`SELECT site_id, day, kind, label FROM site_calendar WHERE removed_at IS NULL ORDER BY day`).all()).map((r) => ({ site_id: r.site_id == null ? null : Number(r.site_id), day: r.day, kind: r.kind, label: r.label || null }));
  }
  /** Everything calendars.resolveCalendar needs. */
  async function calendarsCtx() {
    const cals = await listCalendars();
    return { calendars: cals, exceptions: cals.flatMap((c) => c.exceptions), siteHolidays: await siteHolidays() };
  }
  async function saveCalendar(body, { user } = {}) {
    const b = body || {};
    const name = str(b.name, 120); if (!name) throw invalid('a calendar needs a name', 'NAME_REQUIRED');
    const workdays = b.workdays == null || b.workdays === '' ? null : CAL.parseDays(b.workdays);
    if (b.workdays != null && b.workdays !== '' && !workdays) throw invalid('workdays must list ISO weekdays 1..7 (7 = Sunday)', 'BAD_WORKDAYS');
    const hpd = num(b.hours_per_day);
    if (b.hours_per_day != null && b.hours_per_day !== '' && !(hpd > 0 && hpd <= 24)) throw invalid('hours_per_day must be 0 < h ≤ 24', 'BAD_HOURS');
    const base = b.base_calendar_id == null || b.base_calendar_id === '' ? null : Number(b.base_calendar_id);
    const site = b.site_id == null || b.site_id === '' ? null : Number(b.site_id);
    const ush = b.use_site_holidays === 0 || b.use_site_holidays === '0' || b.use_site_holidays === false ? 0 : 1;
    const id = b.id ? Number(b.id) : null;
    if (base != null) {
      const all = await listCalendars();
      if (!all.some((c) => c.id === base)) throw invalid('base calendar not found', 'BAD_BASE');
      // a base chain must never loop back to this calendar
      for (let c = all.find((x) => x.id === base), seen = 0; c && seen < 100; c = all.find((x) => x.id === c.base_calendar_id), seen++) if (id != null && c.id === id) throw invalid('a calendar cannot be based on itself (directly or through its base)', 'BASE_LOOP');
    }
    return tx(async () => {
      if (id) {
        const before = calRow(await P(`SELECT * FROM ppm_calendars WHERE id=? AND removed_at IS NULL`).get(id));
        if (!before) throw notFound('calendar not found');
        await P(`UPDATE ppm_calendars SET name=?, site_id=?, base_calendar_id=?, workdays=?, hours_per_day=?, use_site_holidays=?, updated_at=? WHERE id=?`).run(name, site, base, workdays ? JSON.stringify(workdays) : null, hpd, ush, now(), id);
        await gov.ppmEvent({ entity: 'calendar', entity_id: id, action: 'calendar_edit', old_value: JSON.stringify(before), new_value: JSON.stringify({ name, site_id: site, base_calendar_id: base, workdays, hours_per_day: hpd, use_site_holidays: ush }) }, user);
        return id;
      }
      const nid = await insertId(`INSERT INTO ppm_calendars (name, site_id, base_calendar_id, workdays, hours_per_day, use_site_holidays, created_by, created_at) VALUES (?,?,?,?,?,?,?,?)`, [name, site, base, workdays ? JSON.stringify(workdays) : null, hpd, ush, uid(user), now()]);
      await gov.ppmEvent({ entity: 'calendar', entity_id: nid, action: 'calendar_created', new_value: name }, user);
      return nid;
    });
  }
  async function addException(calendarId, body, { user } = {}) {
    const b = body || {};
    const cid = Number(calendarId);
    if (!(await P(`SELECT id FROM ppm_calendars WHERE id=? AND removed_at IS NULL`).get(cid))) throw notFound('calendar not found');
    const from = day(b.day_from, 'day_from'), to = day(b.day_to == null || b.day_to === '' ? b.day_from : b.day_to, 'day_to');
    if (!from) throw invalid('day_from is required', 'BAD_DATE');
    if (to < from) throw invalid('day_to is before day_from', 'BAD_RANGE');
    if (!CAL.expandRange(from, to).length) throw invalid(`an exception spans at most ${CAL.MAX_RANGE_DAYS} days`, 'BAD_RANGE');
    const working = b.working === true || b.working === 1 || b.working === '1' ? 1 : 0;
    const id = await insertId(`INSERT INTO ppm_calendar_exceptions (calendar_id, day_from, day_to, working, label, created_by, created_at) VALUES (?,?,?,?,?,?,?)`, [cid, from, to, working, str(b.label, 200), uid(user), now()]);
    await gov.ppmEvent({ entity: 'calendar', entity_id: cid, action: 'calendar_exception_added', new_value: `${from}..${to} ${working ? 'working' : 'non-working'}` }, user);
    return id;
  }
  async function removeException(calendarId, excId, { user } = {}) {
    const r = await P(`SELECT * FROM ppm_calendar_exceptions WHERE id=? AND calendar_id=?`).get(Number(excId), Number(calendarId));
    if (!r) throw notFound('exception not found');
    await P(`DELETE FROM ppm_calendar_exceptions WHERE id=?`).run(Number(excId));
    await gov.ppmEvent({ entity: 'calendar', entity_id: Number(calendarId), action: 'calendar_exception_removed', old_value: `${r.day_from}..${r.day_to} ${Number(r.working) ? 'working' : 'non-working'}` }, user);
  }

  // ---- project / task engine fields ------------------------------------------------------------------------------
  async function projectEngine(projectId) {
    const r = await P(`SELECT * FROM ppm_project_engine WHERE project_id=?`).get(Number(projectId));
    return { project_id: Number(projectId), calendar_id: r && r.calendar_id != null ? Number(r.calendar_id) : null };
  }
  async function setProjectCalendar(projectId, calendarId, { user } = {}) {
    const pid = Number(projectId), cid = calendarId == null || calendarId === '' ? null : Number(calendarId);
    if (cid != null && !(await P(`SELECT id FROM ppm_calendars WHERE id=? AND removed_at IS NULL`).get(cid))) throw invalid('calendar not found', 'BAD_CALENDAR');
    const before = await projectEngine(pid);
    await tx(async () => {
      if (await P(`SELECT project_id FROM ppm_project_engine WHERE project_id=?`).get(pid)) await P(`UPDATE ppm_project_engine SET calendar_id=?, updated_by=?, updated_at=? WHERE project_id=?`).run(cid, uid(user), now(), pid);
      else await P(`INSERT INTO ppm_project_engine (project_id, calendar_id, updated_by, updated_at) VALUES (?,?,?,?)`).run(pid, cid, uid(user), now());
      await event(pid, 'project_calendar', 'calendar_id', before.calendar_id, cid, user);
    });
    return projectEngine(pid);
  }
  const tfRow = (r) => ({ task_id: Number(r.task_id), calendar_id: r.calendar_id == null ? null : Number(r.calendar_id), priority: r.priority == null ? null : Number(r.priority), ignore_resource_calendar: r.ignore_resource_calendar == null ? null : Number(r.ignore_resource_calendar), leveling_delay_days: r.leveling_delay_days == null ? null : Number(r.leveling_delay_days) });
  async function taskFieldsFor(taskIds) {
    const t = ids(taskIds); if (!t.length) return {};
    const out = {};
    for (const r of await P(`SELECT * FROM ppm_task_engine WHERE task_id IN (${inList(t)})`).all(...t)) out[Number(r.task_id)] = tfRow(r);
    return out;
  }
  async function _upsertTaskEngine(taskId, patch, user) {
    const tid = Number(taskId);
    const cur = await P(`SELECT * FROM ppm_task_engine WHERE task_id=?`).get(tid);
    const v = { ...(cur ? tfRow(cur) : { calendar_id: null, priority: null, ignore_resource_calendar: null, leveling_delay_days: null }), ...patch };
    if (cur) await P(`UPDATE ppm_task_engine SET calendar_id=?, priority=?, ignore_resource_calendar=?, leveling_delay_days=?, updated_by=?, updated_at=? WHERE task_id=?`).run(v.calendar_id, v.priority, v.ignore_resource_calendar, v.leveling_delay_days, uid(user), now(), tid);
    else await P(`INSERT INTO ppm_task_engine (task_id, calendar_id, priority, ignore_resource_calendar, leveling_delay_days, updated_by, updated_at) VALUES (?,?,?,?,?,?,?)`).run(tid, v.calendar_id, v.priority, v.ignore_resource_calendar, v.leveling_delay_days, uid(user), now());
    return v;
  }
  /** body: { calendar_id?, priority?, ignore_resource_calendar? } — the levelling delay is written ONLY by applyLeveling. */
  async function saveTaskFields(taskId, projectId, body, { user } = {}) {
    const b = body || {}, patch = {};
    if (b.calendar_id !== undefined) { const c = b.calendar_id == null || b.calendar_id === '' ? null : Number(b.calendar_id); if (c != null && !(await P(`SELECT id FROM ppm_calendars WHERE id=? AND removed_at IS NULL`).get(c))) throw invalid('calendar not found', 'BAD_CALENDAR'); patch.calendar_id = c; }
    if (b.priority !== undefined) { const p = b.priority == null || b.priority === '' ? null : Number(b.priority); if (p != null && !(Number.isInteger(p) && p >= 0 && p <= 1000)) throw invalid('priority must be an integer 0..1000 (1000 = do not level)', 'BAD_PRIORITY'); patch.priority = p; }
    if (b.ignore_resource_calendar !== undefined) patch.ignore_resource_calendar = b.ignore_resource_calendar == null || b.ignore_resource_calendar === '' ? null : (b.ignore_resource_calendar === true || Number(b.ignore_resource_calendar) === 1 ? 1 : 0);
    if (b.leveling_delay_days !== undefined) throw invalid('the levelling delay is set by applying a levelling proposal, not by a field edit', 'LEVELING_BY_PROPOSAL');
    return tx(async () => {
      const before = (await taskFieldsFor([taskId]))[Number(taskId)] || null;
      const v = await _upsertTaskEngine(taskId, patch, user);
      await event(projectId, 'task_engine_edit', `task:${taskId}`, before ? JSON.stringify(before) : null, JSON.stringify(v), user);
      return (await taskFieldsFor([taskId]))[Number(taskId)];
    });
  }
  /** Writes the delays of an APPLIED levelling proposal (or clears them with {}, clear=true). */
  async function applyLevelingDelays(projectId, delays, { user, clear = false, note } = {}) {
    const pid = Number(projectId);
    const live = new Set((await P(`SELECT id FROM portfolio_tasks WHERE project_id=? AND deleted_at IS NULL`).all(pid)).map((r) => Number(r.id)));
    const entries = Object.entries(delays || {}).map(([k, v]) => [Number(k), Number(v)]);
    if (entries.some(([k, v]) => !live.has(k) || !(Number.isInteger(v) && v >= 0))) throw invalid('a delay targets a task outside this project or is not a whole number of working days', 'BAD_DELAY');
    return tx(async () => {
      if (clear) {
        const n = (await P(`SELECT COUNT(*) AS n FROM ppm_task_engine e JOIN portfolio_tasks t ON t.id = e.task_id WHERE t.project_id=? AND e.leveling_delay_days IS NOT NULL`).get(pid)).n;
        await P(`UPDATE ppm_task_engine SET leveling_delay_days=NULL, updated_by=?, updated_at=? WHERE task_id IN (SELECT id FROM portfolio_tasks WHERE project_id=?)`).run(uid(user), now(), pid);
        await event(pid, 'leveling_cleared', 'leveling_delay_days', Number(n), 0, user, note);
        return { cleared: Number(n) };
      }
      for (const [tid, v] of entries) await _upsertTaskEngine(tid, { leveling_delay_days: v > 0 ? v : null }, user);
      await event(pid, 'leveling_applied', 'leveling_delay_days', null, JSON.stringify(Object.fromEntries(entries)), user, note);
      return { applied: entries.length };
    });
  }

  // ---- resources, rates, assignments -----------------------------------------------------------------------------
  const resRow = (r) => r && { id: Number(r.id), name: r.name, kind: r.kind, user_id: r.user_id == null ? null : Number(r.user_id), site_id: r.site_id == null ? null : Number(r.site_id), generic: Number(r.generic) === 1, max_units_pct: num(r.max_units_pct), calendar_id: r.calendar_id == null ? null : Number(r.calendar_id), material_label: r.material_label || null, active: Number(r.active) !== 0 };
  const rateRow = (r) => ({ id: Number(r.id), resource_id: Number(r.resource_id), rate_table: r.rate_table, effective_from: r.effective_from, standard_rate: num(r.standard_rate), overtime_rate: num(r.overtime_rate), cost_per_use: num(r.cost_per_use), currency: r.currency });
  async function listResources({ includeInactive = false } = {}) {
    return (await P(`SELECT * FROM ppm_resources ${includeInactive ? '' : 'WHERE active = 1 '}ORDER BY name, id`).all()).map(resRow);
  }
  async function resourcesByIds(rids) { const r = ids(rids); if (!r.length) return []; return (await P(`SELECT * FROM ppm_resources WHERE id IN (${inList(r)})`).all(...r)).map(resRow); }
  async function ratesFor(resourceIds) { const r = ids(resourceIds); if (!r.length) return []; return (await P(`SELECT * FROM ppm_resource_rates WHERE resource_id IN (${inList(r)}) ORDER BY resource_id, rate_table, effective_from`).all(...r)).map(rateRow); }
  async function saveResource(body, { user } = {}) {
    const b = body || {};
    const name = str(b.name, 160); if (!name) throw invalid('a resource needs a name', 'NAME_REQUIRED');
    const kind = b.kind == null || b.kind === '' ? 'work' : String(b.kind);
    if (!RES.RESOURCE_KINDS.includes(kind)) throw invalid('kind must be work | material | cost', 'BAD_KIND');
    const mu = num(b.max_units_pct);
    if (b.max_units_pct != null && b.max_units_pct !== '' && !(mu > 0 && mu <= 10000)) throw invalid('max_units_pct must be > 0 (100 = one full-time person)', 'BAD_UNITS');
    const cal = b.calendar_id == null || b.calendar_id === '' ? null : Number(b.calendar_id);
    if (cal != null && !(await P(`SELECT id FROM ppm_calendars WHERE id=? AND removed_at IS NULL`).get(cal))) throw invalid('calendar not found', 'BAD_CALENDAR');
    const vals = [name, kind, b.user_id == null || b.user_id === '' ? null : Number(b.user_id), b.site_id == null || b.site_id === '' ? null : Number(b.site_id), b.generic ? 1 : 0, mu, cal, str(b.material_label, 40), b.active === false || b.active === 0 || b.active === '0' ? 0 : 1];
    return tx(async () => {
      if (b.id) {
        const before = resRow(await P(`SELECT * FROM ppm_resources WHERE id=?`).get(Number(b.id)));
        if (!before) throw notFound('resource not found');
        await P(`UPDATE ppm_resources SET name=?, kind=?, user_id=?, site_id=?, generic=?, max_units_pct=?, calendar_id=?, material_label=?, active=?, updated_at=? WHERE id=?`).run(...vals, now(), Number(b.id));
        await gov.ppmEvent({ entity: 'resource', entity_id: Number(b.id), action: 'resource_edit', old_value: JSON.stringify(before), new_value: JSON.stringify(resRow(await P(`SELECT * FROM ppm_resources WHERE id=?`).get(Number(b.id)))) }, user);
        return Number(b.id);
      }
      const id = await insertId(`INSERT INTO ppm_resources (name, kind, user_id, site_id, generic, max_units_pct, calendar_id, material_label, active, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [...vals, uid(user), now()]);
      await gov.ppmEvent({ entity: 'resource', entity_id: id, action: 'resource_created', new_value: `${name} (${kind})` }, user);
      return id;
    });
  }
  /** A rate row is a money write (committee): a new row per table × effective date; an existing (table, date) is replaced. */
  async function saveRate(resourceId, body, { user } = {}) {
    const b = body || {}, rid = Number(resourceId);
    const r = resRow(await P(`SELECT * FROM ppm_resources WHERE id=?`).get(rid)); if (!r) throw notFound('resource not found');
    if (r.kind === 'cost') throw invalid('a cost resource has no rate table (its amount is entered on the assignment)', 'COST_NO_RATE');
    const table = String(b.rate_table || 'A').toUpperCase();
    if (!RES.RATE_TABLES.includes(table)) throw invalid('rate_table must be A | B | C | D | E', 'BAD_TABLE');
    const from = day(b.effective_from, 'effective_from') || '1984-01-01';
    const cur = b.currency == null || b.currency === '' ? null : String(b.currency).toUpperCase();
    if (!cur || !/^[A-Z]{3}$/.test(cur)) throw invalid('a rate needs its ISO currency (never defaulted)', 'CURRENCY_REQUIRED');
    const vals = {};
    for (const k of ['standard_rate', 'overtime_rate', 'cost_per_use']) { const v = num(b[k]); if (b[k] != null && b[k] !== '' && !(v >= 0)) throw invalid(`${k} must be a number ≥ 0 (leave empty when unknown)`, 'BAD_AMOUNT'); vals[k] = v; }
    return tx(async () => {
      const ex = await P(`SELECT * FROM ppm_resource_rates WHERE resource_id=? AND rate_table=? AND effective_from=?`).get(rid, table, from);
      if (ex) await P(`UPDATE ppm_resource_rates SET standard_rate=?, overtime_rate=?, cost_per_use=?, currency=? WHERE id=?`).run(vals.standard_rate, vals.overtime_rate, vals.cost_per_use, cur, Number(ex.id));
      else await P(`INSERT INTO ppm_resource_rates (resource_id, rate_table, effective_from, standard_rate, overtime_rate, cost_per_use, currency, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(rid, table, from, vals.standard_rate, vals.overtime_rate, vals.cost_per_use, cur, uid(user), now());
      await gov.ppmEvent({ entity: 'resource', entity_id: rid, action: 'resource_rate', field: `${table}@${from}`, old_value: ex ? JSON.stringify(rateRow(ex)) : null, new_value: JSON.stringify({ ...vals, currency: cur }), currency: cur, note: 'not certified' }, user);
      return (await ratesFor([rid])).filter((x) => x.rate_table === table && x.effective_from === from)[0];
    });
  }
  const asgRow = (r) => ({ id: Number(r.id), task_id: Number(r.task_id), resource_id: Number(r.resource_id), units_pct: num(r.units_pct), work_hours: num(r.work_hours), contour: r.contour, rate_table: r.rate_table, cost_amount: num(r.cost_amount), cost_currency: r.cost_currency || null });
  async function assignmentsFor(taskIds) { const t = ids(taskIds); if (!t.length) return []; return (await P(`SELECT * FROM ppm_assignments WHERE task_id IN (${inList(t)}) ORDER BY task_id, resource_id`).all(...t)).map(asgRow); }
  function normaliseAssignment(a, resById) {
    const rid = Number(a && a.resource_id); const r = resById.get(rid);
    if (!r || !r.active) throw invalid('an assignment names an unknown or inactive resource', 'BAD_RESOURCE');
    const units = num(a.units_pct), work = num(a.work_hours), cost = num(a.cost_amount);
    if (a.units_pct != null && a.units_pct !== '' && !(units >= 0 && units <= 10000)) throw invalid('units_pct must be 0..10000', 'BAD_UNITS');
    if (a.work_hours != null && a.work_hours !== '' && !(work >= 0)) throw invalid('work_hours must be ≥ 0 (leave empty = units × duration)', 'BAD_WORK');
    const contour = a.contour == null || a.contour === '' ? 'flat' : String(a.contour);
    if (!RES.CONTOUR_NAMES.includes(contour)) throw invalid('contour must be ' + RES.CONTOUR_NAMES.join(' | '), 'BAD_CONTOUR');
    const table = String(a.rate_table || 'A').toUpperCase(); if (!RES.RATE_TABLES.includes(table)) throw invalid('rate_table must be A–E', 'BAD_TABLE');
    const cc = a.cost_currency == null || a.cost_currency === '' ? null : String(a.cost_currency).toUpperCase();
    if (cost != null && r.kind !== 'cost') throw invalid('a cost amount belongs to a cost resource only', 'COST_ON_WORK');
    if (cost != null && !(cost >= 0)) throw invalid('cost_amount must be ≥ 0', 'BAD_AMOUNT');
    if (cost != null && (!cc || !/^[A-Z]{3}$/.test(cc))) throw invalid('a cost amount needs its ISO currency (never defaulted)', 'CURRENCY_REQUIRED');
    return { resource_id: rid, units_pct: units, work_hours: work, contour, rate_table: table, cost_amount: cost, cost_currency: cost == null ? null : cc };
  }
  /** Replace the assignment set of one task. `withMoney` false keeps the stored cost amounts (a non-money writer). */
  async function replaceTaskAssignments(taskId, projectId, list, { user, withMoney = false } = {}) {
    const tid = Number(taskId);
    const resById = new Map((await listResources({ includeInactive: true })).map((r) => [r.id, r]));
    const before = await assignmentsFor([tid]);
    const prevCost = new Map(before.map((a) => [a.resource_id, a]));
    const rows = (Array.isArray(list) ? list : []).map((a) => {
      const n = normaliseAssignment(withMoney ? a : { ...a, cost_amount: undefined, cost_currency: undefined }, resById);
      if (!withMoney && prevCost.has(n.resource_id)) { n.cost_amount = prevCost.get(n.resource_id).cost_amount; n.cost_currency = prevCost.get(n.resource_id).cost_currency; }
      return n;
    });
    if (new Set(rows.map((r) => r.resource_id)).size !== rows.length) throw invalid('a resource is assigned twice to the task', 'DUPLICATE_RESOURCE');
    return tx(async () => {
      const keep = rows.map((r) => r.resource_id);
      if (keep.length) await P(`DELETE FROM ppm_assignments WHERE task_id=? AND resource_id NOT IN (${inList(keep)})`).run(tid, ...keep);
      else await P(`DELETE FROM ppm_assignments WHERE task_id=?`).run(tid);
      for (const r of rows) {
        const ex = before.find((x) => x.resource_id === r.resource_id);
        if (ex) await P(`UPDATE ppm_assignments SET units_pct=?, work_hours=?, contour=?, rate_table=?, cost_amount=?, cost_currency=?, updated_at=? WHERE id=?`).run(r.units_pct, r.work_hours, r.contour, r.rate_table, r.cost_amount, r.cost_currency, now(), ex.id);
        else await P(`INSERT INTO ppm_assignments (task_id, resource_id, units_pct, work_hours, contour, rate_table, cost_amount, cost_currency, created_by, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(tid, r.resource_id, r.units_pct, r.work_hours, r.contour, r.rate_table, r.cost_amount, r.cost_currency, uid(user), now());
      }
      const fmt = (xs) => JSON.stringify(xs.map((a) => ({ r: a.resource_id, u: a.units_pct, w: a.work_hours, c: a.contour, t: a.rate_table })));
      await event(projectId, 'task_assignments', `task:${tid}`, fmt(before), fmt(rows), user);
      return assignmentsFor([tid]);
    });
  }

  // ---- baseline slots ----------------------------------------------------------------------------------------------
  const slotRow = (r) => { let p = null; try { p = JSON.parse(r.payload_json); } catch (_) { p = null; } return { id: Number(r.id), project_id: Number(r.project_id), kind: r.kind, slot: Number(r.slot), name: SLOTS.slotName(r.kind, r.slot), saved_at: r.saved_at, saved_by: r.saved_by == null ? null : Number(r.saved_by), saved_by_name: r.saved_by_name || null, reason: r.reason || null, payload: p }; };
  async function listSlots(projectId) { return (await P(`SELECT * FROM ppm_baseline_slots WHERE project_id=? ORDER BY kind, slot`).all(Number(projectId))).map(slotRow); }
  async function saveSlot(projectId, kind, slot, payload, { user, reason } = {}) {
    const prob = SLOTS.slotProblem(kind, slot); if (prob) throw invalid(prob, 'BAD_SLOT');
    const pid = Number(projectId);
    return tx(async () => {
      if (await P(`SELECT id FROM ppm_baseline_slots WHERE project_id=? AND kind=? AND slot=?`).get(pid, kind, Number(slot))) throw Object.assign(new Error(`${SLOTS.slotName(kind, slot)} is already saved — a saved slot is immutable; use another slot`), { code: 'CONFLICT', status: 409, reason: 'SLOT_TAKEN' });
      await P(`INSERT INTO ppm_baseline_slots (project_id, kind, slot, saved_at, saved_by, saved_by_name, reason, payload_json) VALUES (?,?,?,?,?,?,?,?)`).run(pid, kind, Number(slot), now(), uid(user), user ? String(user.full_name || user.username || '') : null, str(reason, 2000), JSON.stringify(payload));
      await event(pid, 'baseline_slot_saved', SLOTS.slotName(kind, slot), null, `${(payload.tasks || []).length} tasks`, user, str(reason, 2000));
      return (await listSlots(pid)).find((s) => s.kind === kind && s.slot === Number(slot));
    });
  }

  // ---- MSPDI import (into an EMPTY project, one transaction) -------------------------------------------------------
  /**
   * @param {number} projectId  an existing project without live tasks
   * @param {object} model      services/ppm/mspdi normalised model
   * @param {{user, allocUnspecified?}} opts
   * @returns {{tasks, links, calendars, resources_created, resources_reused, rates, assignments, slots, warnings}}
   */
  async function importModel(projectId, model, { user, allocUnspecified, source = 'mspdi' } = {}) {
    const pid = Number(projectId);
    if ((await P(`SELECT COUNT(*) AS n FROM portfolio_tasks WHERE project_id=? AND deleted_at IS NULL`).get(pid)).n > 0) throw Object.assign(new Error('an MSPDI import goes into a project without tasks (create an empty project first)'), { code: 'CONFLICT', status: 409, reason: 'PROJECT_NOT_EMPTY' });
    const warnings = [];
    return tx(async () => {
      const calMap = new Map();   // file uid → calendar id (created, names prefixed by the project key-less file name)
      const pending = [...model.calendars];
      for (let guard = 0; pending.length && guard < 1000; guard++) {
        const c = pending.shift();
        if (c.base_uid != null && !calMap.has(c.base_uid) && model.calendars.some((x) => x.uid === c.base_uid)) { pending.push(c); continue; }
        const id = await saveCalendar({ name: (c.name || `Calendar ${c.uid}`).slice(0, 120), workdays: c.workdays.length ? c.workdays : null, base_calendar_id: c.base_uid != null ? calMap.get(c.base_uid) ?? null : null, use_site_holidays: 0 }, { user });
        for (const e of c.exceptions) await addException(id, { day_from: e.from, day_to: e.to, working: e.working, label: e.name }, { user });
        calMap.set(c.uid, id);
      }
      if (model.calendar_uid != null && calMap.has(model.calendar_uid)) await setProjectCalendar(pid, calMap.get(model.calendar_uid), { user });
      // tasks: parents first (outline order), then links in a second pass (depends_on needs the new ids)
      const idOf = new Map(); const stack = [];
      for (const [i, t] of model.tasks.entries()) {
        while (stack.length && stack[stack.length - 1].level >= t.outline_level) stack.pop();
        const parent = stack.length ? idOf.get(stack[stack.length - 1].uid) : null;
        const body = { project_id: pid, parent_id: parent, name: t.name || `Task ${t.uid}`, wbs_code: t.wbs, sort_order: i, duration_days: t.summary ? null : t.milestone ? 0 : t.duration_days,
          schedule_mode: t.manual ? 'manual' : 'auto', start_date: t.manual ? t.start : null, end_date: t.manual ? t.finish : null,
          constraint_type: t.constraint_type, constraint_date: t.constraint_date, deadline: t.deadline, progress_pct: t.percent_complete, effort_hours: t.work_hours };
        const id = await gov.upsertPortfolio('task', body, { user, allocUnspecified });
        idOf.set(t.uid, id); stack.push({ uid: t.uid, level: t.outline_level });
      }
      let links = 0;
      for (const t of model.tasks) {
        const preds = t.predecessors.filter((p) => idOf.has(p.uid));
        if (preds.length !== t.predecessors.length) warnings.push({ code: 'LINK_UNKNOWN_TASK', task_uid: t.uid });
        if (preds.length) {
          await gov.upsertPortfolio('task', { id: idOf.get(t.uid), depends_on: preds.map((p) => idOf.get(p.uid)), dependency_links: preds.map((p) => ({ id: idOf.get(p.uid), type: p.type, lag: p.lag, lag_unit: p.lag_unit })) }, { user, allocUnspecified });
          links += preds.length;
        }
        const f = {};
        if (t.calendar_uid != null && calMap.has(t.calendar_uid)) f.calendar_id = calMap.get(t.calendar_uid);
        if (t.priority != null && t.priority !== 500) f.priority = t.priority;
        if (t.leveling_delay_days > 0) f.leveling_delay_days = Math.round(t.leveling_delay_days);
        if (Object.keys(f).length) await _upsertTaskEngine(idOf.get(t.uid), f, user);
      }
      // resources: reuse an active pool resource with the same name and kind, else create it (+ its rate rows)
      const pool = await listResources(); const resMap = new Map(); let created = 0, reused = 0, rates = 0;
      for (const r of model.resources) {
        const hit = pool.find((x) => x.name === r.name && x.kind === r.type);
        if (hit) { resMap.set(r.uid, hit.id); reused++; continue; }
        const id = await saveResource({ name: r.name || `Resource ${r.uid}`, kind: r.type, generic: r.generic, max_units_pct: r.max_units_pct, calendar_id: r.calendar_uid != null ? calMap.get(r.calendar_uid) ?? null : null, material_label: r.material_label }, { user });
        resMap.set(r.uid, id); created++;
        for (const q of r.rates) {
          if (!model.currency_code) { warnings.push({ code: 'RATE_NO_CURRENCY', resource_uid: r.uid }); continue; }
          await saveRate(id, { rate_table: q.table, effective_from: q.from, standard_rate: q.standard_rate, overtime_rate: q.overtime_rate, cost_per_use: q.cost_per_use, currency: model.currency_code }, { user });
          rates++;
        }
      }
      const byTask = new Map();
      for (const a of model.assignments) {
        if (!idOf.has(a.task_uid) || !resMap.has(a.resource_uid)) { warnings.push({ code: 'ASSIGNMENT_UNKNOWN', uid: a.uid }); continue; }
        const tid = idOf.get(a.task_uid);
        if (!byTask.has(tid)) byTask.set(tid, []);
        byTask.get(tid).push({ resource_id: resMap.get(a.resource_uid), units_pct: a.units_pct, work_hours: a.work_hours, contour: a.contour, rate_table: a.rate_table, cost_amount: a.cost, cost_currency: a.cost == null ? null : model.currency_code });
      }
      let assignments = 0;
      for (const [tid, list] of byTask) { await replaceTaskAssignments(tid, pid, list, { user, withMoney: true }); assignments += list.length; }
      // baselines of the file → baseline slots (one slot per baseline number), the file's dates kept as they are
      let slots = 0;
      for (let n = 0; n <= 10; n++) {
        const rows = model.tasks.filter((t) => t.baselines.some((b) => b.number === n));
        if (!rows.length) continue;
        const tasks = rows.map((t) => { const b = t.baselines.find((x) => x.number === n); return { id: idOf.get(t.uid), name: t.name, wbs_code: t.wbs, summary: t.summary, start: b.start, finish: b.finish, duration_days: b.duration_days, work_hours: b.work_hours, cost: b.cost == null || !model.currency_code ? null : { [model.currency_code]: b.cost } }; });
        await saveSlot(pid, 'baseline', n, { kind: 'baseline', source, project: { start: null, finish: null }, tasks }, { user, reason: `imported from an ${source.toUpperCase()} file` });
        slots++;
      }
      await event(pid, `${source}_imported`, 'tasks', null, `${model.tasks.length} tasks · ${links} links · ${created} new resources · ${assignments} assignments · ${slots} baseline slots`, user);
      return { tasks: model.tasks.length, links, calendars: calMap.size, resources_created: created, resources_reused: reused, rates, assignments, slots, task_ids: Object.fromEntries(idOf), warnings };
    });
  }

  return { listCalendars, siteHolidays, calendarsCtx, saveCalendar, addException, removeException, projectEngine, setProjectCalendar, taskFieldsFor, saveTaskFields, applyLevelingDelays,
    listResources, resourcesByIds, ratesFor, saveResource, saveRate, assignmentsFor, replaceTaskAssignments, listSlots, saveSlot, importModel };
}

module.exports = { makeEngineStore };
