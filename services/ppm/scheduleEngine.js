'use strict';
// W1-ENGINE — the native PPM scheduling engine. PURE: no I/O, no clock, no database. Every date is an ISO day
// 'YYYY-MM-DD'; internally a day is an integer (days since 1970-01-01, UTC) and a duration is counted in WORKING
// days of the task's calendar (ADR docs/ai-decisions/ADR-W1-ENGINE-schedule-engine.md).
//
//   makeCalendar(spec)        working-day arithmetic. spec = { workdays:[1..7 ISO, 7 = Sunday], holidays:[ISO],
//                             exceptions:[{date, working}], elapsed } — default Mon–Fri, no holiday; elapsed = 24/7.
//   schedule(tasks, opts)     forward / backward pass on DATES: early / late start-finish, total float, free float,
//                             NEGATIVE float (deadline, must-finish constraints), critical (float <= threshold) and
//                             near-critical, links FS/SS/FF/SF with lag/lead in working days, manual vs auto mode,
//                             8 constraints (ASAP/ALAP/SNET/SNLT/FNET/FNLT/MSO/MFO), summary tasks rolled up from
//                             their children, 0-day milestones. Null when the network has a dependency cycle.
//   recalc(task, changed)     task types fixed_units / fixed_duration / fixed_work × effort-driven: W = D × U × h/day.
//   rollupProgress(leaves)    work-weighted % complete (unknown child % ⇒ null, never 0).
//
// Data contract per task (all optional except id): depends_on [ids], dependency_links [{id, type, lag}],
// parent_id, start_date, end_date, duration_days, actual_start, actual_end, schedule_mode ('auto' | 'manual'),
// constraint_type, constraint_date, deadline, effort_hours, allocation_pct, task_type, effort_driven,
// progress_pct, calendar_id, elapsed. Absent fields = today's behaviour. On an AUTO task an entered start date
// acts as start-no-earlier-than (SNET) unless a constraint is stated; on a MANUAL task the entered dates stay.

const DAY = 86400000;
const toDay = (v) => {
  if (v == null || v === '') return null;
  const ms = Date.parse(String(v).slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(ms) ? Math.round(ms / DAY) : null;
};
const isoOf = (d) => (d == null || !Number.isFinite(d) ? null : new Date(d * DAY).toISOString().slice(0, 10));
const isoWeekday = (d) => (((d % 7) + 7 + 3) % 7) + 1;   // day 0 = Thursday 1970-01-01 → 4
const numOrNull = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

const LINK_TYPES = Object.freeze(['FS', 'SS', 'FF', 'SF']);
const CONSTRAINTS = Object.freeze(['ASAP', 'ALAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO']);
const MODES = Object.freeze(['auto', 'manual']);
const TASK_TYPES = Object.freeze(['fixed_units', 'fixed_duration', 'fixed_work']);
const MAX_DAY = 400000;   // year 3065: a guard against a calendar without any working day

// ---- calendars ------------------------------------------------------------------------------------------------
const _calCache = new Map();
function _calKey(spec) { return JSON.stringify(spec || null); }
/**
 * @param {{workdays?:number[], holidays?:string[], exceptions?:Array<{date:string, working:boolean}>, elapsed?:boolean}} [spec]
 * @returns {{key, elapsed, workdays, isWork(d), ord(d), dayOf(k), finishOf(k), countBetween(a,b)}}
 *   ord(d)      = number of working days strictly before day d (a "boundary": the start of day d)
 *   dayOf(k)    = the k-th working day (start boundary of that day)
 *   finishOf(k) = the boundary just after working day k−1 (end of the (k−1)-th working day)
 */
function makeCalendar(spec) {
  const key = _calKey(spec);
  if (_calCache.has(key)) return _calCache.get(key);
  const s = spec || {};
  const elapsed = !!s.elapsed;
  let wd = elapsed ? [1, 2, 3, 4, 5, 6, 7] : (Array.isArray(s.workdays) && s.workdays.length ? s.workdays.map(Number).filter((x) => x >= 1 && x <= 7) : [1, 2, 3, 4, 5]);
  const exc = new Map();
  if (!elapsed) for (const e of s.exceptions || []) { const d = toDay(e && e.date); if (d != null) exc.set(d, !!e.working); }
  if (!wd.length && ![...exc.values()].some(Boolean)) wd = [1, 2, 3, 4, 5];   // a calendar with no working day cannot schedule
  const wds = new Set(wd);
  const hol = new Set();
  if (!elapsed) for (const h of s.holidays || []) { const d = toDay(h); if (d != null) hol.add(d); }
  const isWork = (d) => (exc.has(d) ? exc.get(d) : !hol.has(d) && wds.has(isoWeekday(d)));
  const ordA = [0]; const idx = [];
  let built = 0;   // ordA covers days [0, built]
  const grow = (target) => {
    if (target > MAX_DAY) throw Object.assign(new Error('schedule beyond the supported range (year 3065)'), { code: 'SCHEDULE_RANGE' });
    for (; built < target; built++) { const w = isWork(built); if (w) idx.push(built); ordA.push(ordA[built] + (w ? 1 : 0)); }
  };
  const ord = (d) => { if (d <= 0) return 0; if (d > built) grow(d + 4096); return ordA[d]; };
  const dayOf = (k) => {
    if (k < 0) k = 0;
    while (idx.length <= k) grow(built + 4096);
    return idx[k];
  };
  const finishOf = (k) => (k <= 0 ? dayOf(0) : dayOf(k - 1) + 1);
  const cal = { key, elapsed, workdays: [...wds].sort(), isWork, ord, dayOf, finishOf, countBetween: (a, b) => ord(b + 1) - ord(a) };
  if (_calCache.size > 64) _calCache.delete(_calCache.keys().next().value);
  _calCache.set(key, cal);
  return cal;
}
const ELAPSED = { elapsed: true };

// ---- task types (W = D × U × h/day) --------------------------------------------------------------------------
/**
 * B2 — recompute the third value of a task after one of duration / work / units changed. units = allocation_pct / 100
 * (the total units of the task's assignment). changed:
 *   'duration' | 'work' | 'units'  the field the user edited on the single assignment;
 *   'resources'                    the assignment set changed (allocation_pct now holds the NEW total units).
 * Rules (MS-Project semantics; effort-driven only matters when the assignment set changes; fixed work is always
 * effort-driven):
 *   fixed_units    duration→work   work→duration   units→duration   resources: effort-driven → duration, else → work
 *   fixed_duration duration→work   work→units      units→work       resources: effort-driven → units = W/D, else → work
 *   fixed_work     duration→units  work→duration   units→duration   resources: → duration
 * A missing input (null) leaves the task unchanged with a `problem`. Returns a NEW object.
 */
function recalc(task, changed, { hoursPerDay = 8 } = {}) {
  const t = { ...task };
  const type = TASK_TYPES.includes(t.task_type) ? t.task_type : 'fixed_units';
  const ed = type === 'fixed_work' ? true : t.effort_driven == null ? true : !!Number(t.effort_driven) || t.effort_driven === true;
  const D = numOrNull(t.duration_days), W = numOrNull(t.effort_hours), Up = numOrNull(t.allocation_pct);
  const U = Up == null ? null : Up / 100;
  const r2 = (x) => Math.round(x * 100) / 100;
  const setW = () => (D != null && U != null ? (t.effort_hours = r2(D * U * hoursPerDay), 'effort_hours') : null);
  const setD = () => (W != null && U != null && U > 0 ? (t.duration_days = r2(W / (U * hoursPerDay)), 'duration_days') : null);
  const setU = () => (W != null && D != null && D > 0 ? (t.allocation_pct = r2((W / (D * hoursPerDay)) * 100), 'allocation_pct') : null);
  const rule = {
    fixed_units: { duration: setW, work: setD, units: setD, resources: ed ? setD : setW },
    fixed_duration: { duration: setW, work: setU, units: setW, resources: ed ? setU : setW },
    fixed_work: { duration: setU, work: setD, units: setD, resources: setD },
  }[type][changed];
  if (!rule) return { ...t, problem: 'unknown changed field ' + changed };
  const out = rule();
  return out ? { ...t, recomputed: out } : { ...t, problem: 'a value needed to keep W = D × U is unknown' };
}
/** W = D × U × h/day holds (within 0.01 h). Null when a value is unknown. */
function workInvariant(t, { hoursPerDay = 8 } = {}) {
  const D = numOrNull(t.duration_days), W = numOrNull(t.effort_hours), U = numOrNull(t.allocation_pct);
  if (D == null || W == null || U == null) return null;
  return Math.abs(W - D * (U / 100) * hoursPerDay) < 0.011;
}

// ---- progress rollup -----------------------------------------------------------------------------------------
/**
 * A5 — % complete of a summary from its leaves: Σ work × % / Σ work. A leaf whose % is unknown makes the summary
 * unknown (null, never 0). When some work is unknown (or all work is 0) the weight falls back to the duration;
 * when that is unknown too the result is null. basis says which weight was used.
 */
function rollupProgress(leaves) {
  const L = leaves || [];
  if (!L.length) return { progress_pct: null, basis: null };
  if (L.some((x) => numOrNull(x.progress_pct) == null)) return { progress_pct: null, basis: 'unknown_child' };
  const r1 = (x) => Math.round(x * 10) / 10;
  const by = (wf, basis) => {
    const ws = L.map(wf);
    if (ws.some((w) => w == null || w < 0)) return null;
    const sum = ws.reduce((a, b) => a + b, 0);
    if (!(sum > 0)) return null;
    return { progress_pct: r1(L.reduce((a, x, i) => a + ws[i] * Number(x.progress_pct), 0) / sum), basis };
  };
  return by((x) => numOrNull(x.effort_hours), 'work') || by((x) => numOrNull(x._duration), 'duration') || { progress_pct: null, basis: 'unknown_weight' };
}

// ---- the schedule --------------------------------------------------------------------------------------------
function _parseLinks(t) {
  let v = t.dependency_links;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
  const m = new Map();
  for (const l of Array.isArray(v) ? v : []) {
    if (!l || l.id == null) continue;
    const type = LINK_TYPES.includes(String(l.type || 'FS').toUpperCase()) ? String(l.type || 'FS').toUpperCase() : 'FS';
    const lag = numOrNull(l.lag);
    m.set(Number(l.id), { type, lag: lag == null ? 0 : Math.round(lag) });
  }
  return m;
}
function _deps(t) {
  let v = t.depends_on;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = []; } }
  return (Array.isArray(v) ? v : []).map(Number).filter(Number.isFinite);
}

/**
 * @param {Array<object>} tasks
 * @param {{anchor?:string|null, calendar?:object, calendars?:Object<string,object>, deadline?:string|null,
 *          statusDate?:string|null, nearCriticalDays?:number|null, criticalThreshold?:number, hoursPerDay?:number}} [opts]
 * @returns {null|object}  null when the dependency network has a cycle
 */
function schedule(tasks, opts = {}) {
  const list = (tasks || []).filter((t) => t && t.id != null);
  const warnings = [];
  const warn = (code, task_id, message) => warnings.push({ code, task_id: task_id == null ? null : Number(task_id), message });
  const hpd = Number(opts.hoursPerDay) > 0 ? Number(opts.hoursPerDay) : 8;
  const projCal = makeCalendar(opts.calendar || null);
  const N = list.length;
  const ids = list.map((t) => Number(t.id));
  const pos = new Map(ids.map((id, i) => [id, i]));

  // hierarchy (a parent outside the list, or a parent loop, makes the task top-level)
  const parent = new Array(N).fill(-1);
  for (let i = 0; i < N; i++) { const p = list[i].parent_id; if (p != null && pos.has(Number(p)) && Number(p) !== ids[i]) parent[i] = pos.get(Number(p)); }
  for (let i = 0; i < N; i++) {
    const seen = new Set([i]); let c = parent[i];
    while (c >= 0) { if (seen.has(c)) { warn('PARENT_CYCLE', ids[i], 'the parent chain loops: the task is scheduled as top-level'); parent[i] = -1; break; } seen.add(c); c = parent[c]; }
  }
  const children = Array.from({ length: N }, () => []);
  for (let i = 0; i < N; i++) if (parent[i] >= 0) children[parent[i]].push(i);
  const isSummary = (i) => children[i].length > 0;
  const depth = new Array(N).fill(-1);
  const depthOf = (i) => { if (depth[i] >= 0) return depth[i]; let d = 0, c = parent[i]; while (c >= 0) { d++; c = parent[c]; } depth[i] = d; return d; };
  const isAncestor = (a, b) => { let c = parent[b]; while (c >= 0) { if (c === a) return true; c = parent[c]; } return false; };

  // per-task calendar, mode, duration
  const cals = new Array(N); const D = new Array(N); const assumed = new Array(N).fill(false); const milestone = new Array(N).fill(false);
  const durSource = new Array(N);
  const mode = new Array(N);
  for (let i = 0; i < N; i++) {
    const t = list[i];
    const cspec = t.elapsed ? ELAPSED : (t.calendar_id != null && opts.calendars && opts.calendars[t.calendar_id]) || opts.calendar || null;
    cals[i] = makeCalendar(cspec);
    mode[i] = MODES.includes(t.schedule_mode) ? t.schedule_mode : 'auto';
    const dd = numOrNull(t.duration_days);
    const s = toDay(t.start_date), e = toDay(t.end_date);
    if (dd != null && dd === 0) { D[i] = 0; milestone[i] = true; durSource[i] = 'duration'; }
    else if (dd != null && dd > 0) { D[i] = Math.ceil(dd); durSource[i] = 'duration'; }
    else if (s != null && e != null && e >= s) { D[i] = Math.max(1, cals[i].countBetween(s, e)); durSource[i] = 'dates'; }
    else if (TASK_TYPES.includes(t.task_type) && numOrNull(t.effort_hours) != null && numOrNull(t.allocation_pct) > 0) {
      D[i] = Math.max(1, Math.ceil(Number(t.effort_hours) / (hpd * Number(t.allocation_pct) / 100))); durSource[i] = 'work';
    } else { D[i] = 1; assumed[i] = true; durSource[i] = null; }
  }

  // links (a link between a task and its own ancestor / descendant is ignored: the hierarchy already orders them)
  const links = [];
  for (let i = 0; i < N; i++) {
    const spec = _parseLinks(list[i]);
    const seen = new Set();
    for (const d of _deps(list[i])) {
      if (!pos.has(d) || d === ids[i] || seen.has(d)) continue; seen.add(d);
      const p = pos.get(d);
      if (isAncestor(p, i) || isAncestor(i, p)) { warn('LINK_HIERARCHY_IGNORED', ids[i], `the link with #${d} joins a task and its own summary: ignored`); continue; }
      const s = spec.get(d) || { type: 'FS', lag: 0 };
      links.push({ from: p, to: i, type: s.type, lag: s.lag });
    }
  }

  // graph: leaf → one node; summary → an IN node (receives its links, constrains its children) and an OUT node
  // (rolls its children up, feeds its successors)
  const nIn = new Array(N).fill(-1), nOut = new Array(N).fill(-1), nLeaf = new Array(N).fill(-1);
  const nodes = [];
  for (let i = 0; i < N; i++) {
    if (isSummary(i)) { nIn[i] = nodes.length; nodes.push({ k: 'in', t: i }); nOut[i] = nodes.length; nodes.push({ k: 'out', t: i }); }
    else { nLeaf[i] = nodes.length; nodes.push({ k: 'leaf', t: i }); }
  }
  const V = nodes.length;
  const outE = Array.from({ length: V }, () => []); const inE = Array.from({ length: V }, () => []);
  const edge = (a, b, kind, link) => { const e = { a, b, kind, link }; outE[a].push(e); inE[b].push(e); };
  const head = (i) => (nIn[i] >= 0 ? nIn[i] : nLeaf[i]);   // where a link INTO task i lands
  const tail = (i) => (nOut[i] >= 0 ? nOut[i] : nLeaf[i]);  // where a link FROM task i leaves
  for (let i = 0; i < N; i++) if (parent[i] >= 0) { edge(nIn[parent[i]], head(i), 'down'); edge(tail(i), nOut[parent[i]], 'up'); }
  for (const l of links) edge(tail(l.from), head(l.to), 'link', l);
  // Kahn, deterministic (input order), O(V + E)
  const indeg = inE.map((x) => x.length);
  const order = []; const q = []; let qh = 0;
  for (let v = 0; v < V; v++) if (indeg[v] === 0) q.push(v);
  while (qh < q.length) { const v = q[qh++]; order.push(v); for (const e of outE[v]) if (--indeg[e.b] === 0) q.push(e.b); }
  if (order.length !== V) return null;

  // anchor = project start, else earliest entered start, else synthetic (dates are then not reported)
  let anchorDay = toDay(opts.anchor);
  if (anchorDay == null) { const ss = list.map((t) => toDay(t.start_date)).filter((x) => x != null); if (ss.length) anchorDay = Math.min(...ss); }
  const datesKnown = anchorDay != null;
  if (!datesKnown) anchorDay = toDay('2001-01-01');   // a Monday: relative working days only
  const statusDay = toDay(opts.statusDate);

  // node state (absolute day boundaries): s = start boundary, f = finish boundary (exclusive)
  const S = new Array(V).fill(null), F = new Array(V).fill(null);
  const inStart = new Array(V).fill(-Infinity), inFinish = new Array(V).fill(-Infinity);   // IN-node bounds for children
  const kind = new Array(N).fill('start');     // milestone display: sits at the end of a day ('finish') or its start
  const driver = new Array(N).fill(null);
  const fixed = new Array(N).fill(false);
  const alapFix = new Map();                   // second pass: ALAP tasks pinned at their late start (ordinal)

  const linkReq = (l, toCal, Dto) => {         // the ordinal (in toCal) the successor's START must reach
    const p = tail(l.from);
    if (l.type === 'FS') return toCal.ord(F[p]) + l.lag;
    if (l.type === 'SS') return toCal.ord(S[p]) + l.lag;
    if (l.type === 'FF') return toCal.ord(F[p]) + l.lag - Dto;
    return toCal.ord(S[p]) + l.lag - Dto;      // SF
  };
  const constraintOf = (t) => {
    const ct = CONSTRAINTS.includes(String(t.constraint_type || '').toUpperCase()) ? String(t.constraint_type).toUpperCase() : null;
    const cd = toDay(t.constraint_date);
    if (ct && ct !== 'ASAP' && ct !== 'ALAP' && cd == null) return { type: 'ASAP', day: null, invalid: true };
    return { type: ct, day: cd };
  };

  function forward() {
    for (const v of order) {
      const nd = nodes[v], i = nd.t, t = list[i];
      if (nd.k === 'in') {
        let st = -Infinity, fi = -Infinity;
        for (const e of inE[v]) {
          if (e.kind === 'down') { st = Math.max(st, inStart[e.a]); fi = Math.max(fi, inFinish[e.a]); continue; }
          const l = e.link, p = tail(l.from), o = (l.type === 'FS' || l.type === 'FF') ? projCal.ord(F[p]) + l.lag : projCal.ord(S[p]) + l.lag;
          if (l.type === 'FS' || l.type === 'SS') st = Math.max(st, projCal.dayOf(o)); else fi = Math.max(fi, projCal.finishOf(o));
        }
        if (mode[i] === 'auto') {
          const c = constraintOf(t);
          const sn = c.type === 'SNET' || c.type === 'MSO' ? c.day : c.type == null ? toDay(t.start_date) : null;
          if (sn != null) st = Math.max(st, sn);
        }
        inStart[v] = st; inFinish[v] = fi;
        continue;
      }
      if (nd.k === 'out') {
        let s = Infinity, f = -Infinity;
        for (const e of inE[v]) if (e.kind === 'up') { s = Math.min(s, S[e.a]); f = Math.max(f, F[e.a]); }
        S[v] = s; F[v] = f;
        continue;
      }
      // leaf
      const cal = cals[i], d = D[i];
      const as = toDay(t.actual_start), ae = toDay(t.actual_end);
      const es = toDay(t.start_date), ee = toDay(t.end_date);
      let sO; let k = 'start'; let drv = null;
      // the requirement the network puts on the start (used for auto scheduling and to flag violations)
      let req = -Infinity, reqDrv = null, reqKind = 'start';
      const bump = (o, why, kd) => { if (o > req) { req = o; reqDrv = why; reqKind = kd; } };
      for (const e of inE[v]) {
        if (e.kind === 'down') {
          if (inStart[e.a] > -Infinity) bump(cal.ord(inStart[e.a]), { type: 'summary', id: ids[nodes[e.a].t] }, 'start');
          if (inFinish[e.a] > -Infinity) bump(cal.ord(inFinish[e.a]) - d, { type: 'summary', id: ids[nodes[e.a].t] }, 'finish');
          continue;
        }
        const l = e.link;
        bump(linkReq(l, cal, d), { type: 'link', from: ids[l.from], link_type: l.type, lag: l.lag }, l.type === 'FS' || l.type === 'FF' ? 'finish' : 'start');
      }
      if (as != null || ae != null) {
        fixed[i] = true;
        const sDay = as != null ? as : cal.dayOf(cal.ord(ae + 1) - d);
        S[v] = sDay; F[v] = ae != null ? ae + 1 : (d > 0 ? cal.finishOf(cal.ord(sDay) + d) : sDay);
        driver[i] = { type: 'actual' };
      } else if (mode[i] === 'manual' && es != null) {
        fixed[i] = true;
        S[v] = es; F[v] = ee != null && ee >= es ? ee + 1 : (d > 0 ? cal.finishOf(cal.ord(es) + d) : es);
        driver[i] = { type: 'manual' };
      } else if (alapFix.has(i)) {
        sO = alapFix.get(i); drv = { type: 'constraint', constraint: 'ALAP' };
      } else {
        if (mode[i] === 'manual') warn('MANUAL_NO_DATES', ids[i], 'a manual task without a start date is scheduled automatically');
        const c = constraintOf(t);
        if (c.invalid) warn('CONSTRAINT_NO_DATE', ids[i], `constraint ${String(t.constraint_type).toUpperCase()} has no date: ignored`);
        let o = cal.ord(anchorDay); drv = { type: 'project_start' };
        if (statusDay != null && !(numOrNull(t.progress_pct) > 0)) { const so = cal.ord(statusDay); if (so > o) { o = so; drv = { type: 'status_date' }; } }
        const take = (x, why, kd) => { if (x > o) { o = x; drv = why; k = kd; } };
        if (c.type == null && es != null) take(cal.ord(es), { type: 'entered_start' }, 'start');
        if (c.type === 'SNET') take(cal.ord(c.day), { type: 'constraint', constraint: 'SNET' }, 'start');
        if (c.type === 'FNET') take(cal.ord(c.day + 1) - d, { type: 'constraint', constraint: 'FNET' }, 'finish');
        if (req > o) { o = req; drv = reqDrv; k = reqKind; }
        if (c.type === 'MSO') { o = cal.ord(c.day); drv = { type: 'constraint', constraint: 'MSO' }; k = 'start'; }
        if (c.type === 'MFO') { o = cal.ord(c.day + 1) - d; drv = { type: 'constraint', constraint: 'MFO' }; k = 'finish'; }
        sO = o;
      }
      if (!fixed[i]) {
        kind[i] = k; driver[i] = drv;
        if (d > 0) { S[v] = cal.dayOf(sO); F[v] = cal.finishOf(sO + d); }
        else { S[v] = F[v] = k === 'finish' ? cal.finishOf(sO) : cal.dayOf(sO); }
      }
      if (req > -Infinity && cal.ord(S[v]) < req && (fixed[i] || ['MSO', 'MFO'].includes(constraintOf(t).type) || alapFix.has(i))) {
        warn('LINK_VIOLATED', ids[i], `the task starts ${req - cal.ord(S[v])} working day(s) before its predecessors allow`);
      }
    }
  }

  // ---- backward pass ----
  const LS = new Array(V).fill(null), LF = new Array(V).fill(null);
  const capF = new Array(V).fill(Infinity), capS = new Array(V).fill(Infinity);
  const lsMin = new Array(V).fill(Infinity), lfMax = new Array(V).fill(-Infinity);
  let termAbs, projFinish;
  function backward() {
    capF.fill(Infinity); capS.fill(Infinity); lsMin.fill(Infinity); lfMax.fill(-Infinity);
    projFinish = -Infinity;
    for (let i = 0; i < N; i++) if (nLeaf[i] >= 0) projFinish = Math.max(projFinish, F[nLeaf[i]]);
    if (!Number.isFinite(projFinish)) projFinish = anchorDay;
    const dl = toDay(opts.deadline);
    termAbs = dl != null ? Math.min(projFinish, dl + 1) : projFinish;
    const pushLinks = (v, cal, lsO, lfO) => {   // v finalised: push bounds onto its link predecessors
      for (const e of inE[v]) {
        if (e.kind !== 'link') continue;
        const l = e.link, p = tail(l.from);
        if (l.type === 'FS') capF[p] = Math.min(capF[p], cal.dayOf(lsO - l.lag));
        else if (l.type === 'SS') capS[p] = Math.min(capS[p], cal.dayOf(lsO - l.lag));
        else if (l.type === 'FF') capF[p] = Math.min(capF[p], cal.dayOf(lfO - l.lag));
        else capS[p] = Math.min(capS[p], cal.dayOf(lfO - l.lag));
      }
    };
    for (let x = order.length - 1; x >= 0; x--) {
      const v = order[x], nd = nodes[v], i = nd.t, t = list[i];
      if (nd.k === 'out') {
        let lf = Math.min(termAbs, capF[v]);
        const dli = toDay(t.deadline); if (dli != null) lf = Math.min(lf, dli + 1);
        LF[v] = lf; LS[v] = capS[v];
        for (const e of inE[v]) if (e.kind === 'up') { capF[e.a] = Math.min(capF[e.a], lf); if (S[e.a] === S[v]) capS[e.a] = Math.min(capS[e.a], capS[v]); }
        continue;
      }
      if (nd.k === 'in') {
        LS[v] = lsMin[v]; LF[v] = lfMax[v];
        pushLinks(v, projCal, projCal.ord(LS[v]), projCal.ord(LF[v]));
        for (const e of inE[v]) if (e.kind === 'down') { lsMin[e.a] = Math.min(lsMin[e.a], LS[v]); lfMax[e.a] = Math.max(lfMax[e.a], LF[v]); }
        continue;
      }
      const cal = cals[i], d = D[i];
      const c = constraintOf(t);
      let lfO = cal.ord(termAbs);
      if (capF[v] < Infinity) lfO = Math.min(lfO, cal.ord(capF[v]));
      if (capS[v] < Infinity) lfO = Math.min(lfO, cal.ord(capS[v]) + d);
      const dli = toDay(t.deadline); if (dli != null) lfO = Math.min(lfO, cal.ord(dli + 1));
      if (!fixed[i] || mode[i] === 'manual') {
        if (c.type === 'FNLT' || c.type === 'MFO') lfO = Math.min(lfO, cal.ord(c.day + 1));
        if (c.type === 'SNLT' || c.type === 'MSO') lfO = Math.min(lfO, cal.ord(c.day) + d);
      }
      const lsO = lfO - d;
      LS[v] = d > 0 || kind[i] === 'start' ? cal.dayOf(lsO) : cal.finishOf(lsO);
      LF[v] = d > 0 ? cal.finishOf(lfO) : LS[v];
      pushLinks(v, cal, lsO, lfO);
      for (const e of inE[v]) if (e.kind === 'down') { lsMin[e.a] = Math.min(lsMin[e.a], LS[v]); lfMax[e.a] = Math.max(lfMax[e.a], LF[v]); }
    }
  }

  forward(); backward();
  // ALAP: pin each ALAP task at its late start, then schedule again so its successors follow it
  for (let i = 0; i < N; i++) {
    if (nLeaf[i] < 0 || fixed[i] || constraintOf(list[i]).type !== 'ALAP') continue;
    const v = nLeaf[i], cal = cals[i];
    if (cal.ord(LS[v]) > cal.ord(S[v])) alapFix.set(i, cal.ord(LS[v]));
  }
  if (alapFix.size) { forward(); backward(); }

  // ---- floats, critical, free float ----
  const thr = Number.isFinite(Number(opts.criticalThreshold)) ? Number(opts.criticalThreshold) : 0;
  const near = numOrNull(opts.nearCriticalDays);
  const TF = new Array(N).fill(null), FF = new Array(N).fill(null);
  for (let i = 0; i < N; i++) {
    const v = nLeaf[i]; if (v < 0) continue;
    const cal = cals[i];
    TF[i] = cal.ord(LS[v]) - cal.ord(S[v]);
  }
  const succReq = (l, p) => {   // free room between predecessor p (task index) and the successor of link l
    const to = l.to, vt = head(to), cal = nIn[to] >= 0 ? projCal : cals[to];
    const sO = cal.ord(S[vt] != null ? S[vt] : S[nOut[to]]), fO = cal.ord(F[vt] != null ? F[vt] : F[nOut[to]]);
    const pv = tail(p);
    if (l.type === 'FS') return sO - l.lag - cal.ord(F[pv]);
    if (l.type === 'SS') return sO - l.lag - cal.ord(S[pv]);
    if (l.type === 'FF') return fO - l.lag - cal.ord(F[pv]);
    return fO - l.lag - cal.ord(S[pv]);
  };
  const outLinks = Array.from({ length: N }, () => []);
  for (const l of links) outLinks[l.from].push(l);
  for (let i = 0; i < N; i++) {
    const v = nLeaf[i]; if (v < 0) continue;
    let ff = Infinity, any = false;
    for (let a = i; a >= 0; a = parent[a]) {   // its own links, then the links of the summaries it finishes
      for (const l of outLinks[a]) { any = true; const r = a === i ? succReq(l, i) : succReq({ ...l, from: i }, i); ff = Math.min(ff, r); }
    }
    if (!any) ff = cals[i].ord(termAbs) - cals[i].ord(F[v]);
    FF[i] = Math.min(ff, TF[i]);
  }
  // summaries: float = min of their leaves; dates = their OUT node; late = IN/OUT late
  const leavesOf = new Array(N);
  const collect = (i) => { if (leavesOf[i]) return leavesOf[i]; const r = isSummary(i) ? children[i].flatMap(collect) : [i]; leavesOf[i] = r; return r; };
  for (let i = 0; i < N; i++) if (isSummary(i)) { const lv = collect(i); TF[i] = Math.min(...lv.map((j) => TF[j])); FF[i] = null; }

  // ---- output ----
  const a0 = projCal.ord(anchorDay);
  const out = [];
  const crit = [];
  for (let i = 0; i < N; i++) {
    const t = list[i], sum = isSummary(i);
    const vS = sum ? nOut[i] : nLeaf[i], vL = sum ? nIn[i] : nLeaf[i];
    const s = S[vS], f = F[vS];
    const dispS = !sum && D[i] === 0 && kind[i] === 'finish' ? s - 1 : s;
    const dispF = !sum && D[i] === 0 ? dispS : f - 1;
    const lsDisp = !sum && D[i] === 0 && kind[i] === 'finish' ? LS[vL] - 1 : LS[sum ? nIn[i] : vL];
    const lfDisp = sum ? LF[nOut[i]] - 1 : D[i] === 0 ? lsDisp : LF[vL] - 1;
    const critical = TF[i] != null && TF[i] <= thr;
    if (critical && !sum) crit.push(i);
    const es = projCal.ord(s) - a0, ef = projCal.ord(f) - a0;
    const enteredS = toDay(t.start_date), enteredE = toDay(t.end_date);
    const row = {
      id: ids[i], summary: sum, parent_id: parent[i] >= 0 ? ids[parent[i]] : null, depth: depthOf(i),
      mode: mode[i], milestone: !sum && milestone[i],
      duration_days: sum ? projCal.ord(f) - projCal.ord(s) : assumed[i] ? null : D[i], assumed_duration: !sum && assumed[i], duration_source: sum ? 'rollup' : durSource[i],
      es, ef, es_date: datesKnown ? isoOf(dispS) : null, ef_date: datesKnown ? isoOf(dispF) : null,
      ls_date: datesKnown ? isoOf(lsDisp) : null, lf_date: datesKnown ? isoOf(lfDisp) : null,
      total_float: TF[i], free_float: FF[i], critical, near_critical: !critical && near != null && TF[i] != null && TF[i] <= near,
      negative_float: TF[i] != null && TF[i] < 0,
      computed: sum || fixed[i] ? !!sum : !(enteredS != null && enteredE != null && isoOf(dispS) === isoOf(enteredS) && isoOf(dispF) === isoOf(enteredE)),
      driver: sum ? { type: 'rollup' } : driver[i],
    };
    if (sum) {
      const lv = collect(i).map((j) => ({ ...list[j], _duration: assumed[j] ? null : D[j] }));
      const works = lv.map((x) => numOrNull(x.effort_hours));
      const known = works.filter((w) => w != null);
      const rp = rollupProgress(lv);
      row.rollup = { work_hours: known.length === works.length ? known.reduce((a, b) => a + b, 0) : null, work_known: known.length, work_leaves: works.length, progress_pct: rp.progress_pct, progress_basis: rp.basis };
      const own = numOrNull(t.effort_hours);
      if (own != null && row.rollup.work_hours != null && Math.abs(own - row.rollup.work_hours) > 0.01) {
        warn('WBS_100_RULE', ids[i], `the children's work (${row.rollup.work_hours} h) does not add up to this summary's work (${own} h)`);
      }
      const od = numOrNull(t.duration_days);
      if (od != null && od !== row.duration_days) warn('SUMMARY_DURATION_IGNORED', ids[i], `a summary task takes its dates from its children; the entered ${od} d is not used`);
    }
    out.push(row);
  }
  crit.sort((x, y) => S[nLeaf[x]] - S[nLeaf[y]] || ids[x] - ids[y]);
  if (!datesKnown) for (const r of out) { r.es_date = r.ef_date = r.ls_date = r.lf_date = null; }
  return {
    anchor: datesKnown ? isoOf(anchorDay) : null,
    calendar: { workdays: projCal.workdays, elapsed: projCal.elapsed },
    project_finish: datesKnown ? isoOf(projFinish - 1) : null,
    deadline: opts.deadline ? String(opts.deadline).slice(0, 10) : null,
    length_days: projCal.ord(projFinish) - a0,
    critical_path: crit.map((i) => ids[i]),
    warnings,
    tasks: out,
  };
}

module.exports = { schedule, makeCalendar, recalc, workInvariant, rollupProgress, toDay, isoOf, LINK_TYPES, CONSTRAINTS, MODES, TASK_TYPES };
