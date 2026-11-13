/* W2-UI — interactive Gantt v2: the PURE half (no DOM, no I/O, no money). UMD: loaded by project.html before
   lib/ganttV2.js, required by tests/ppm-gantt-core.test.js. Everything the screen decides is computed here, so the
   rules are testable without a browser:

   Dates are whole days counted from 1970-01-01 (UTC); a working day follows a calendar spec { workdays:[1..7 ISO],
   holidays:[ISO] } — default Mon–Fri, the same default as services/ppm/scheduleEngine.makeCalendar. An end date is
   INCLUSIVE (a 3-day task Mon→Wed), duration_days counts working days, 0 = milestone (start = end).

   makeCal(spec)                         working-day calendar (isWork / snap / add / count)
   SCALES, ZOOMS, zoom(key, dir)         timescale zoom day → week → month → quarter (pixels per calendar day)
   ticks(scaleKey, fromDay, toDay, opts) minor + major header ticks for the visible span
   rowsFrom(tasks, plan, opts)           one normalised row per task (scheduled dates when the engine has them)
   layout(rows, opts)                    bar / baseline / milestone geometry, O(n) — the virtualised canvas reads it
   visibleWindow(o)                      which rows to render for a scroll position (+ overscan, spacer heights)
   linkPath(layout, link)                SVG path for one FS / SS / FF / SF link
   dragDates(bar, dxPx, scaleKey, mode, cal)   drag (move) or resize → { start_date, end_date, duration_days } on WORKING days
   canLink(tasks, fromId, toId)          link creation rules — same refusal codes as the server (DEP_SELF, DEP_MISSING,
                                         DEP_DUPLICATE, DEPENDS_ON_HIERARCHY, DEP_CYCLE)
   linkPatch(task, fromId, type, lag, opts)   the PUT body fragment that adds a predecessor
   parsePredecessors / formatPredecessors / editCell   inline grid editing (name, duration, start, predecessors, % complete)
   createHistory(limit)                  undo / redo stack of commands { label, forward:[patch], backward:[patch] }
   periods / taskUsage / resourceUsage / resourceGraph / networkLayout   the companion views (read-only)

   null = UNKNOWN, never 0: a task without effort has unknown hours (counted, never summed); a task without allocation
   is counted in `unknown`, never added to a load. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GanttCore = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY_MS = 86400000;
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var LINK_TYPES = ['FS', 'SS', 'FF', 'SF'];

  // ---- days ----------------------------------------------------------------------------------------------
  function toDay(iso) {
    if (iso == null || iso === '') return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return null;
    var t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    var d = new Date(t);
    if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) return null;
    return Math.round(t / DAY_MS);
  }
  function fromDay(d) { return new Date(d * DAY_MS).toISOString().slice(0, 10); }
  function isoWeekday(d) { return ((d % 7) + 7 + 3) % 7 + 1; }   // 1970-01-01 is a Thursday (ISO 4)

  function makeCal(spec) {
    var s = spec || {};
    var wd = Array.isArray(s.workdays) && s.workdays.length ? s.workdays.map(Number).filter(function (x) { return x >= 1 && x <= 7; }) : [1, 2, 3, 4, 5];
    if (!wd.length) wd = [1, 2, 3, 4, 5];
    var wds = {}; wd.forEach(function (x) { wds[x] = 1; });
    var hol = {}; (s.holidays || []).forEach(function (h) { var d = toDay(h); if (d != null) hol[d] = 1; });
    function isWork(d) { return !hol[d] && !!wds[isoWeekday(d)]; }
    function snapForward(d) { var k = 0; while (!isWork(d) && k++ < 400) d++; return d; }
    function snapBack(d) { var k = 0; while (!isWork(d) && k++ < 400) d--; return d; }
    // n working days after (n > 0) or before (n < 0) working day d; d itself snaps forward first
    function add(d, n) {
      d = snapForward(d);
      var step = n < 0 ? -1 : 1, left = Math.abs(n), guard = 0;
      while (left > 0 && guard++ < 200000) { d += step; if (isWork(d)) left--; }
      return d;
    }
    // working days from a to b, both included (0 when b < a)
    function count(a, b) {
      if (a == null || b == null || b < a) return 0;
      var span = b - a + 1;
      if (span > 4000) {   // long spans: whole weeks at once, holidays subtracted
        var weeks = Math.floor(span / 7), n = weeks * wd.length, d;
        for (d = a + weeks * 7; d <= b; d++) if (wds[isoWeekday(d)]) n++;
        Object.keys(hol).forEach(function (h) { h = Number(h); if (h >= a && h <= b && wds[isoWeekday(h)]) n--; });
        return n;
      }
      var c = 0; for (var x = a; x <= b; x++) if (isWork(x)) c++;
      return c;
    }
    return { isWork: isWork, snapForward: snapForward, snapBack: snapBack, add: add, count: count, workdays: wd.slice() };
  }

  // ---- zoom + header ticks ---------------------------------------------------------------------------------
  var SCALES = {
    day: { key: 'day', pxPerDay: 30, minor: 'day', major: 'week' },
    week: { key: 'week', pxPerDay: 10, minor: 'week', major: 'month' },
    month: { key: 'month', pxPerDay: 3, minor: 'month', major: 'quarter' },
    quarter: { key: 'quarter', pxPerDay: 1.1, minor: 'quarter', major: 'year' }
  };
  var ZOOMS = ['day', 'week', 'month', 'quarter'];
  function scaleOf(key) { return SCALES[key] || SCALES.week; }
  // dir +1 = zoom OUT (wider span per pixel), -1 = zoom IN; stays at the ends
  function zoom(key, dir) { var i = ZOOMS.indexOf(key); if (i < 0) i = 1; return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + (dir > 0 ? 1 : -1)))]; }

  function unitStart(unit, d) {
    var dt = new Date(d * DAY_MS), y = dt.getUTCFullYear(), m = dt.getUTCMonth();
    if (unit === 'day') return d;
    if (unit === 'week') return d - (isoWeekday(d) - 1);
    if (unit === 'month') return Math.round(Date.UTC(y, m, 1) / DAY_MS);
    if (unit === 'quarter') return Math.round(Date.UTC(y, m - (m % 3), 1) / DAY_MS);
    return Math.round(Date.UTC(y, 0, 1) / DAY_MS);
  }
  function unitNext(unit, d) {
    var dt = new Date(d * DAY_MS), y = dt.getUTCFullYear(), m = dt.getUTCMonth();
    if (unit === 'day') return d + 1;
    if (unit === 'week') return d + 7;
    if (unit === 'month') return Math.round(Date.UTC(y, m + 1, 1) / DAY_MS);
    if (unit === 'quarter') return Math.round(Date.UTC(y, m + 3, 1) / DAY_MS);
    return Math.round(Date.UTC(y + 1, 0, 1) / DAY_MS);
  }
  function unitLabel(unit, d, months, long) {
    var dt = new Date(d * DAY_MS), mn = (months || MONTHS)[dt.getUTCMonth()];
    if (unit === 'day') return String(dt.getUTCDate());
    if (unit === 'week') return dt.getUTCDate() + ' ' + mn;
    if (unit === 'month') return long ? mn + ' ' + dt.getUTCFullYear() : mn;
    if (unit === 'quarter') return 'Q' + (Math.floor(dt.getUTCMonth() / 3) + 1) + (long ? ' ' + dt.getUTCFullYear() : '');
    return String(dt.getUTCFullYear());
  }
  function ticks(scaleKey, fromDay, toDay, opts) {
    var sc = scaleOf(scaleKey), o = opts || {}, out = { minor: [], major: [] }, guard = 0, d;
    for (d = unitStart(sc.minor, fromDay); d <= toDay && guard++ < 20000; d = unitNext(sc.minor, d)) out.minor.push({ day: d, label: unitLabel(sc.minor, d, o.months, false) });
    guard = 0;
    for (d = unitStart(sc.major, fromDay); d <= toDay && guard++ < 20000; d = unitNext(sc.major, d)) out.major.push({ day: d, label: unitLabel(sc.major, d, o.months, true) });
    return out;
  }

  // ---- rows ---------------------------------------------------------------------------------------------------
  function parseLinks(t) {
    var v = t && t.dependency_links;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
    var m = {};
    (Array.isArray(v) ? v : []).forEach(function (l) {
      if (!l || l.id == null) return;
      var ty = String(l.type || 'FS').toUpperCase();
      m[Number(l.id)] = { type: LINK_TYPES.indexOf(ty) >= 0 ? ty : 'FS', lag: Number.isFinite(Number(l.lag)) ? Math.round(Number(l.lag)) : 0 };
    });
    return m;
  }
  function depsOf(t) {
    var v = t && t.depends_on;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = []; } }
    return (Array.isArray(v) ? v : []).map(Number).filter(Number.isFinite);
  }
  // { id → [ {id, type, lag} ] } — the predecessors of each task, typed when dependency_links says so (FS otherwise)
  function predecessorsOf(t) {
    var links = parseLinks(t), seen = {}, out = [];
    depsOf(t).concat(Object.keys(links).map(Number)).forEach(function (id) {
      if (seen[id]) return; seen[id] = 1;
      var l = links[id] || { type: 'FS', lag: 0 };
      out.push({ id: id, type: l.type, lag: l.lag });
    });
    return out;
  }
  // order: [{t, depth}] (project.html taskOrder) or nothing (tasks as given). ghost(t) → {s, e} baseline dates.
  function rowsFrom(tasks, plan, opts) {
    var o = opts || {}, byPlan = {};
    ((plan && plan.tasks) || []).forEach(function (p) { byPlan[p.id] = p; });
    var order = o.order || (tasks || []).map(function (t) { return { t: t, depth: 0 }; });
    return order.map(function (r) {
      var t = r.t, p = byPlan[t.id] || null;
      var s = p && p.es_date ? p.es_date : (!plan ? t.start_date : null);
      var e = p && p.ef_date ? p.ef_date : (!plan ? t.end_date : null);
      var g = o.ghost ? o.ghost(t) || {} : { s: t.baseline_start, e: t.baseline_end };
      var milestone = !!(p && p.milestone) || t.duration_days === 0;
      return {
        id: Number(t.id), name: [t.wbs_code, t.name].filter(function (x) { return x != null && x !== ''; }).join(' '), depth: r.depth || 0,
        start: s || null, end: e || (milestone ? s : null) || null, milestone: milestone, summary: !!(p && p.summary),
        critical: !!(p && p.critical), computed: !!(p && p.computed && !p.summary), slack: p && p.slack != null ? p.slack : null,
        progress: t.progress_pct == null ? null : Number(t.progress_pct), duration: t.duration_days == null ? null : Number(t.duration_days),
        baselineStart: g.s || null, baselineEnd: g.e || null, owner: t.owner || null, status: t.status || null,
        preds: predecessorsOf(t), version: t.version == null ? null : t.version
      };
    });
  }

  // ---- layout ---------------------------------------------------------------------------------------------------
  // rows → geometry. opts: { scale, rowH, today, padDays }. Bars span [start, end+1) in calendar days.
  function layout(rows, opts) {
    var o = opts || {}, sc = scaleOf(o.scale), rowH = o.rowH || 26, pad = o.padDays == null ? 7 : o.padDays;
    var lo = Infinity, hi = -Infinity, i, r, d;
    var td = toDay(o.today);
    var spans = new Array(rows.length);
    for (i = 0; i < rows.length; i++) {
      r = rows[i];
      var s = toDay(r.start), e = toDay(r.end), bs = toDay(r.baselineStart), be = toDay(r.baselineEnd);
      if (s != null && e == null) e = s;
      if (s != null && e < s) e = s;
      spans[i] = { s: s, e: e, bs: bs, be: be != null && bs != null && be < bs ? bs : be };
      for (var k = 0, a = [s, e, bs, be]; k < 4; k++) { d = a[k]; if (d != null) { if (d < lo) lo = d; if (d > hi) hi = d; } }
    }
    if (td != null) { lo = Math.min(lo, td); hi = Math.max(hi, td); }
    if (!isFinite(lo)) { lo = td != null ? td : 0; hi = lo + 30; }
    var origin = unitStart(sc.minor, lo - pad), endDay = hi + pad + 1, ppd = sc.pxPerDay;
    var X = function (day) { return (day - origin) * ppd; };
    var bars = new Array(rows.length), index = {};
    for (i = 0; i < rows.length; i++) {
      r = rows[i]; var sp = spans[i], y = i * rowH;
      var b = { id: r.id, i: i, y: y, x0: null, x1: null, milestone: r.milestone, critical: r.critical, computed: r.computed, summary: r.summary, baseline: null, progressW: null };
      if (sp.s != null) {
        b.x0 = X(sp.s);
        b.x1 = r.milestone ? b.x0 : X(sp.e + 1);
        if (r.progress != null && !r.milestone) b.progressW = Math.max(0, (b.x1 - b.x0) * Math.min(100, Math.max(0, r.progress)) / 100);
      }
      if (sp.bs != null && sp.be != null) b.baseline = { x0: X(sp.bs), x1: X(sp.be + 1) };
      bars[i] = b; index[r.id] = i;
    }
    return { origin: origin, endDay: endDay, pxPerDay: ppd, scale: sc.key, rowH: rowH, width: Math.max(1, X(endDay)), height: rows.length * rowH, bars: bars, index: index, todayX: td == null ? null : X(td) + ppd / 2, dayToX: X, xToDay: function (x) { return origin + Math.floor(x / ppd); } };
  }

  // { scrollTop, viewport, rowH, count, overscan } → rows [start, end) to render + spacer heights
  function visibleWindow(o) {
    var rowH = o.rowH || 26, count = Math.max(0, o.count || 0), over = o.overscan == null ? 8 : o.overscan;
    var first = Math.floor(Math.max(0, o.scrollTop || 0) / rowH);
    var n = Math.ceil(Math.max(0, o.viewport || 0) / rowH) + 1;
    var start = Math.max(0, Math.min(count, first - over)), end = Math.max(start, Math.min(count, first + n + over));
    return { start: start, end: end, top: start * rowH, bottom: (count - end) * rowH };
  }

  // one link (predecessor → successor) as an orthogonal SVG path; null when a side is not drawn
  function linkPath(L, link) {
    var a = L.bars[L.index[link.from]], z = L.bars[L.index[link.to]];
    if (!a || !z || a.x0 == null || z.x0 == null) return null;
    var ty = link.type || 'FS', h = L.rowH / 2;
    var ax = ty === 'SS' || ty === 'SF' ? a.x0 : a.x1, zx = ty === 'FF' || ty === 'SF' ? z.x1 : z.x0;
    var ay = a.y + h, zy = z.y + h, out = ty === 'SS' || ty === 'SF' ? -6 : 6, into = ty === 'FF' || ty === 'SF' ? 6 : -6;
    var mx = out > 0 ? Math.max(ax + out, zx + into) : Math.min(ax + out, zx + into);
    return 'M' + r1(ax) + ',' + r1(ay) + ' H' + r1(mx) + ' V' + r1(zy) + ' H' + r1(zx);
  }
  function r1(v) { return Math.round(v * 10) / 10; }
  function links(rows) {
    var out = [];
    rows.forEach(function (r) { r.preds.forEach(function (p) { out.push({ from: p.id, to: r.id, type: p.type, lag: p.lag }); }); });
    return out;
  }

  // ---- drag / resize → working-day dates ------------------------------------------------------------------
  // bar { start, end, milestone }; mode 'move' keeps the duration in working days, 'resize' moves the end.
  // The calendar-day delta of the pointer snaps to a working day (forward when moving right, back when left).
  function dragDates(bar, dxPx, scaleKey, mode, cal) {
    var c = cal || makeCal(), s = toDay(bar && bar.start), e = toDay(bar && bar.end);
    if (s == null) return null;
    if (e == null || e < s) e = s;
    var delta = Math.round((dxPx || 0) / scaleOf(scaleKey).pxPerDay);
    if (!delta) return null;
    var snap = function (d) { return delta > 0 ? c.snapForward(d) : c.snapBack(d); };
    if (mode === 'resize') {
      if (bar.milestone) return null;
      var ne = snap(e + delta);
      if (ne < s) ne = c.snapForward(s);
      if (ne === e) return null;
      return { start_date: fromDay(s), end_date: fromDay(ne), duration_days: Math.max(1, c.count(s, ne)) };
    }
    var dur = bar.milestone ? 0 : Math.max(1, c.count(s, e));
    var ns = snap(s + delta);
    if (ns === s) return null;
    var nend = dur === 0 ? ns : c.add(ns, dur - 1);
    return { start_date: fromDay(ns), end_date: fromDay(nend), duration_days: dur };
  }

  // ---- links: creation rules (mirror of services/projectSchedule.dependencyProblem + the hierarchy check) ---
  function canLink(tasks, fromId, toId) {
    fromId = Number(fromId); toId = Number(toId);
    var by = {}; (tasks || []).forEach(function (t) { by[Number(t.id)] = t; });
    if (fromId === toId) return { ok: false, code: 'DEP_SELF' };
    if (!by[fromId] || !by[toId]) return { ok: false, code: 'DEP_MISSING' };
    if (predecessorsOf(by[toId]).some(function (p) { return p.id === fromId; })) return { ok: false, code: 'DEP_DUPLICATE' };
    var ancestor = function (a, b) {   // is a an ancestor of b?
      var cur = by[b], guard = 0;
      while (cur && cur.parent_id != null && guard++ < 10000) { if (Number(cur.parent_id) === a) return true; cur = by[Number(cur.parent_id)]; }
      return false;
    };
    if (ancestor(fromId, toId) || ancestor(toId, fromId)) return { ok: false, code: 'DEPENDS_ON_HIERARCHY' };
    // toId will depend on fromId: a loop exists when fromId already (transitively) depends on toId
    var seen = {}, stack = [fromId];
    while (stack.length) {
      var x = stack.pop(); if (seen[x]) continue; seen[x] = 1;
      if (x === toId) return { ok: false, code: 'DEP_CYCLE' };
      var t = by[x]; if (t) predecessorsOf(t).forEach(function (p) { stack.push(p.id); });
    }
    return { ok: true };
  }
  // typed = the server accepts dependency_links (switch ppm_schedule_engine_v2_ui); untyped only adds an FS link
  function linkPatch(task, fromId, type, lag, opts) {
    var typed = !!(opts && opts.typed), ty = String(type || 'FS').toUpperCase(), lg = Math.round(Number(lag) || 0);
    if (LINK_TYPES.indexOf(ty) < 0) return null;
    if (!typed && (ty !== 'FS' || lg)) return null;
    var patch = { depends_on: depsOf(task).concat([Number(fromId)]) };
    if (typed) {
      var cur = parseLinks(task), arr = Object.keys(cur).map(function (k) { return { id: Number(k), type: cur[k].type, lag: cur[k].lag }; });
      if (ty !== 'FS' || lg) arr.push({ id: Number(fromId), type: ty, lag: lg });
      if (ty !== 'FS' || lg || arr.length) patch.dependency_links = arr;
    }
    return patch;
  }

  // ---- inline grid editing ----------------------------------------------------------------------------------
  // "12, 13SS+2, #14 FF-1" → [{id, type, lag}]; without typed links only plain ids (FS, no lag) are accepted
  function parsePredecessors(text, opts) {
    var typed = !!(opts && opts.typed), items = [], bad = [];
    String(text == null ? '' : text).split(/[,;]/).map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (x) {
      var m = /^#?(\d+)\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+)?\s*d?$/i.exec(x);
      if (!m) { bad.push(x); return; }
      var ty = (m[2] || 'FS').toUpperCase(), lag = m[3] ? Number(m[3].replace(/\s/g, '')) : 0;
      if (!typed && (ty !== 'FS' || lag)) { bad.push(x); return; }
      items.push({ id: Number(m[1]), type: ty, lag: lag });
    });
    return { items: items, bad: bad };
  }
  function formatPredecessors(task) {
    return predecessorsOf(task).map(function (p) { return p.id + (p.type !== 'FS' || p.lag ? p.type + (p.lag ? (p.lag > 0 ? '+' : '') + p.lag : '') : ''); }).join(', ');
  }
  var EDITABLE = ['name', 'duration', 'start', 'predecessors', 'progress'];
  // field + raw text → { patch } (the PUT fields that change) or { error: CODE }. opts { cal, typed, tasks }
  function editCell(task, field, raw, opts) {
    var o = opts || {}, c = o.cal || makeCal(), v = raw == null ? '' : String(raw).trim();
    var dur = task.duration_days == null ? null : Number(task.duration_days);
    if (field === 'name') {
      if (!v) return { error: 'NAME_REQUIRED' };
      return v === task.name ? { patch: null } : { patch: { name: v.slice(0, 300) } };
    }
    if (field === 'progress') {
      if (v === '') return { patch: task.progress_pct == null ? null : { progress_pct: null } };
      var p = Number(v.replace('%', ''));
      if (!Number.isFinite(p) || p < 0 || p > 100) return { error: 'PROGRESS_INVALID' };
      return { patch: Number(task.progress_pct) === p && task.progress_pct != null ? null : { progress_pct: p } };
    }
    if (field === 'duration') {
      if (v === '') return { patch: dur == null ? null : { duration_days: null } };
      var n = Number(v.replace(/\s*d$/i, ''));
      if (!Number.isInteger(n) || n < 0 || n > 10000) return { error: 'DURATION_INVALID' };
      if (n === dur) return { patch: null };
      var out = { duration_days: n }, s = toDay(task.start_date);
      if (s != null) out.end_date = fromDay(n === 0 ? c.snapForward(s) : c.add(s, n - 1));
      return { patch: out };
    }
    if (field === 'start') {
      if (v === '') return { patch: task.start_date ? { start_date: null } : null };
      var d = toDay(v); if (d == null) return { error: 'DATE_INVALID' };
      var ns = c.snapForward(d), st = { start_date: fromDay(ns) };
      if (st.start_date === task.start_date) return { patch: null };
      if (dur != null) st.end_date = fromDay(dur === 0 ? ns : c.add(ns, dur - 1));
      else { var e = toDay(task.end_date); if (e != null && e < ns) st.end_date = st.start_date; }
      return { patch: st };
    }
    if (field === 'predecessors') {
      var pr = parsePredecessors(v, { typed: o.typed });
      if (pr.bad.length) return { error: 'PRED_INVALID', bad: pr.bad };
      var ids = {}, dup = false;
      pr.items.forEach(function (x) { if (ids[x.id]) dup = true; ids[x.id] = 1; });
      if (dup) return { error: 'DEP_DUPLICATE' };
      if (pr.items.some(function (x) { return x.id === Number(task.id); })) return { error: 'DEP_SELF' };
      if (o.tasks) {
        var others = o.tasks.filter(function (t) { return Number(t.id) !== Number(task.id); });
        var probe = others.concat([Object.assign({}, task, { depends_on: [], dependency_links: [] })]);
        for (var i = 0; i < pr.items.length; i++) {
          var chk = canLink(probe, pr.items[i].id, task.id);
          if (!chk.ok && chk.code !== 'DEP_DUPLICATE') return { error: chk.code };
        }
      }
      var patch = { depends_on: pr.items.map(function (x) { return x.id; }) };
      if (o.typed) patch.dependency_links = pr.items.filter(function (x) { return x.type !== 'FS' || x.lag; });
      if (formatPredecessors(Object.assign({}, task, patch)) === formatPredecessors(task)) return { patch: null };
      return { patch: patch };
    }
    return { error: 'FIELD_NOT_EDITABLE' };
  }
  // the fields of `task` that a patch would change, as they are now (the undo half of a command)
  function inverseOf(task, patch) {
    var back = {};
    Object.keys(patch || {}).forEach(function (k) {
      var v = task[k];
      if (k === 'depends_on') v = depsOf(task);
      else if (k === 'dependency_links') { var m = parseLinks(task); v = Object.keys(m).map(function (id) { return { id: Number(id), type: m[id].type, lag: m[id].lag }; }); }
      back[k] = v === undefined ? null : v;
    });
    return back;
  }

  // ---- undo / redo -------------------------------------------------------------------------------------------
  function createHistory(limit) {
    var max = limit || 50, undoS = [], redoS = [];
    return {
      push: function (cmd) { if (!cmd) return; undoS.push(cmd); if (undoS.length > max) undoS.shift(); redoS.length = 0; },
      undo: function () { var c = undoS.pop(); if (c) redoS.push(c); return c || null; },
      redo: function () { var c = redoS.pop(); if (c) undoS.push(c); return c || null; },
      // a command whose replay failed (409, 403…) is dropped from both stacks — the screen reloads the truth
      drop: function (cmd) { [undoS, redoS].forEach(function (s) { var i = s.indexOf(cmd); if (i >= 0) s.splice(i, 1); }); },
      canUndo: function () { return undoS.length > 0; }, canRedo: function () { return redoS.length > 0; },
      peekUndo: function () { return undoS[undoS.length - 1] || null; }, peekRedo: function () { return redoS[redoS.length - 1] || null; },
      clear: function () { undoS.length = 0; redoS.length = 0; }, size: function () { return { undo: undoS.length, redo: redoS.length }; }
    };
  }
  function command(label, task, patch) { return { label: label, forward: [{ id: Number(task.id), fields: patch }], backward: [{ id: Number(task.id), fields: inverseOf(task, patch) }] }; }

  // ---- companion views ---------------------------------------------------------------------------------------
  function periods(unit, fromIso, toIso, opts) {
    var a = toDay(fromIso), b = toDay(toIso), out = [], guard = 0;
    if (a == null || b == null || b < a) return out;
    for (var d = unitStart(unit, a); d <= b && guard++ < 2000; d = unitNext(unit, d)) out.push({ from: d, to: unitNext(unit, d) - 1, label: unitLabel(unit, d, opts && opts.months, unit !== 'day') });
    return out;
  }
  function spanOf(r) { var s = toDay(r.start), e = toDay(r.end); if (s == null) return null; if (e == null || e < s) e = s; return { s: s, e: e }; }
  // Task Usage: effort_hours spread evenly over the working days of the scheduled bar; unknown effort → null cells
  function taskUsage(rows, tasks, opts) {
    var o = opts || {}, c = o.cal || makeCal(), by = {}; (tasks || []).forEach(function (t) { by[Number(t.id)] = t; });
    var ps = o.periods || [];
    return rows.filter(function (r) { return !r.summary; }).map(function (r) {
      var t = by[r.id] || {}, sp = spanOf(r), eff = t.effort_hours == null ? null : Number(t.effort_hours);
      var wd = sp ? Math.max(1, c.count(sp.s, sp.e)) : 0;
      var cells = ps.map(function (p) {
        if (!sp || sp.e < p.from || sp.s > p.to) return 0;
        if (eff == null || !Number.isFinite(eff)) return null;
        return Math.round(eff * c.count(Math.max(sp.s, p.from), Math.min(sp.e, p.to)) / wd * 10) / 10;
      });
      return { id: r.id, name: r.name, owner: r.owner, total: eff == null || !Number.isFinite(eff) ? null : eff, unknown: eff == null || !Number.isFinite(eff), undated: !sp, cells: cells };
    });
  }
  var ownerKey = function (o) { return o == null || String(o).trim() === '' ? '' : String(o).trim().toLowerCase(); };
  // Resource Usage: known hours per owner and period (sum of taskUsage); tasks with unknown effort are COUNTED
  function resourceUsage(rows, tasks, opts) {
    var tu = taskUsage(rows, tasks, opts), groups = {}, order = [];
    tu.forEach(function (u) {
      var k = ownerKey(u.owner);
      if (!groups[k]) { groups[k] = { owner: k ? String(u.owner).trim() : null, unassigned: !k, cells: u.cells.map(function () { return 0; }), unknown_tasks: 0, tasks: [] }; order.push(k); }
      var g = groups[k]; g.tasks.push(u.id);
      if (u.unknown && !u.undated) g.unknown_tasks++;
      u.cells.forEach(function (v, i) { if (v != null) g.cells[i] = Math.round((g.cells[i] + v) * 10) / 10; });
    });
    return order.sort(function (a, b) { return (a === '') - (b === '') || a.localeCompare(b); }).map(function (k) { return groups[k]; });
  }
  // Resource Graph: per owner and period the PEAK daily allocation (sum of allocation_pct of tasks running that
  // working day). A task without allocation is counted in unknown, never added; over = peak > 100.
  function resourceGraph(rows, tasks, opts) {
    var o = opts || {}, c = o.cal || makeCal(), ps = o.periods || [], by = {}, groups = {}, order = [];
    (tasks || []).forEach(function (t) { by[Number(t.id)] = t; });
    rows.forEach(function (r) {
      if (r.summary) return;
      var t = by[r.id] || {}, sp = spanOf(r), k = ownerKey(t.owner);
      if (!sp || ['done', 'cancelled'].indexOf(t.status) >= 0) return;
      if (!groups[k]) { groups[k] = { owner: k ? String(t.owner).trim() : null, unassigned: !k, items: [] }; order.push(k); }
      groups[k].items.push({ sp: sp, a: t.allocation_pct == null || !Number.isFinite(Number(t.allocation_pct)) ? null : Number(t.allocation_pct) });
    });
    return order.sort(function (a, b) { return (a === '') - (b === '') || a.localeCompare(b); }).map(function (k) {
      var g = groups[k];
      var cells = ps.map(function (p) {
        var peak = null, unknown = 0, any = false;
        g.items.forEach(function (it) { if (it.sp.e >= p.from && it.sp.s <= p.to && it.a == null) unknown++; });
        // events per day keep this O(items × days-in-period) bounded to the period's working days
        for (var d = p.from; d <= p.to; d++) {
          if (!c.isWork(d)) continue;
          var sum = 0, has = false;
          for (var i = 0; i < g.items.length; i++) { var it = g.items[i]; if (it.sp.s <= d && it.sp.e >= d && it.a != null) { sum += it.a; has = true; } }
          if (has) { any = true; if (peak == null || sum > peak) peak = sum; }
        }
        return { peak_pct: any ? peak : null, over: any && peak > 100, unknown: unknown };
      });
      return { owner: g.owner, unassigned: g.unassigned, cells: cells };
    });
  }
  // Network diagram: column = longest chain of predecessors (rank), row = order inside the column. Rows with a
  // missing predecessor id ignore it; a cycle (should not reach the page) leaves the remaining nodes in column 0.
  function networkLayout(rows, opts) {
    var o = opts || {}, W = o.nodeW || 170, H = o.nodeH || 54, GX = o.gapX || 40, GY = o.gapY || 16;
    var ids = {}, indeg = {}, succ = {}, rank = {};
    rows.forEach(function (r) { ids[r.id] = r; indeg[r.id] = 0; succ[r.id] = []; rank[r.id] = 0; });
    var edges = [];
    rows.forEach(function (r) { r.preds.forEach(function (p) { if (ids[p.id] && p.id !== r.id) { edges.push({ from: p.id, to: r.id, type: p.type, lag: p.lag }); succ[p.id].push(r.id); indeg[r.id]++; } }); });
    var q = rows.filter(function (r) { return indeg[r.id] === 0; }).map(function (r) { return r.id; }), qi = 0;
    while (qi < q.length) { var x = q[qi++]; succ[x].forEach(function (y) { rank[y] = Math.max(rank[y], rank[x] + 1); if (--indeg[y] === 0) q.push(y); }); }
    var cols = {}, nodes = [];
    rows.forEach(function (r) { var cidx = rank[r.id]; var row = (cols[cidx] = (cols[cidx] || 0) + 1) - 1; nodes.push({ id: r.id, name: r.name, critical: r.critical, milestone: r.milestone, start: r.start, end: r.end, col: cidx, row: row, x: cidx * (W + GX), y: row * (H + GY), w: W, h: H }); });
    var maxCol = 0, maxRow = 0; nodes.forEach(function (n) { maxCol = Math.max(maxCol, n.col); maxRow = Math.max(maxRow, n.row); });
    return { nodes: nodes, edges: edges, width: (maxCol + 1) * (W + GX), height: (maxRow + 1) * (H + GY), cyclic: qi < rows.length };
  }

  return {
    DAY_MS: DAY_MS, MONTHS: MONTHS, LINK_TYPES: LINK_TYPES, SCALES: SCALES, ZOOMS: ZOOMS, EDITABLE: EDITABLE,
    toDay: toDay, fromDay: fromDay, isoWeekday: isoWeekday, makeCal: makeCal, zoom: zoom, scaleOf: scaleOf, ticks: ticks,
    predecessorsOf: predecessorsOf, rowsFrom: rowsFrom, layout: layout, visibleWindow: visibleWindow, linkPath: linkPath, links: links,
    dragDates: dragDates, canLink: canLink, linkPatch: linkPatch, parsePredecessors: parsePredecessors, formatPredecessors: formatPredecessors,
    editCell: editCell, inverseOf: inverseOf, createHistory: createHistory, command: command,
    periods: periods, taskUsage: taskUsage, resourceUsage: resourceUsage, resourceGraph: resourceGraph, networkLayout: networkLayout
  };
}));
