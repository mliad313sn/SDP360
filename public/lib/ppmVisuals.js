/* C-14 (G22 / F28) — PPM visuals: risk probability × impact matrix and resource pressure per person per week.
   UMD: loaded by project.html and portfolio.html, required by tests/ppm-visuals.test.js. PURE, no I/O, no money.

   riskMatrix(items, opts)
     Open RISKS (kind 'risk' or no kind; status not closed/cancelled/resolved, no closed_at) on the 1..3 × 1..3 scale
     of the RAID register (exposure = P × I, high ≥ 6 — services/portfolioEvidence.riskView). A risk whose probability
     or impact is not an integer 1..3 (null, 0, out of range) is NOT placed in a cell: it is listed in `not_scored`.
     Cell counts always add up: sum(cells.count) + not_scored.length === considered.

   resourcePressure(tasks, opts)
     Per person (owner, trimmed, case-insensitive — same key as services/projectSchedule.resourceConflicts) and per
     week (Monday UTC), the PEAK daily load of the open tasks (status not done/cancelled) that run that week, from
     allocation_pct. Unlike resourceConflicts (which assumes 100 % when the allocation is empty), a task without an
     allocation is NOT guessed: it is counted in `unknown` for every week it runs. effort_hours, when entered, is
     spread evenly over the task's calendar days. A task without owner → `unassigned`; without start/end → `undated`.
     A week with no task has peak_pct null and tasks 0 (nothing booked), never a measured 0 %. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PpmVisuals = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 86400000, SCALE = 3;
  var CLOSED = ['closed', 'cancelled', 'resolved'];

  function score(v) { var x = Number(v); return v != null && v !== '' && Number.isInteger(x) && x >= 1 && x <= SCALE ? x : null; }
  function isOpen(r) { return !r.closed_at && CLOSED.indexOf(String(r.status || 'open').toLowerCase()) < 0; }
  function band(e) { return e >= 6 ? 'high' : e >= 3 ? 'medium' : 'low'; }

  function riskMatrix(items, opts) {
    var o = opts || {}, includeClosed = !!o.includeClosed;
    var cells = [];
    for (var i = SCALE; i >= 1; i--) for (var p = 1; p <= SCALE; p++) cells.push({ probability: p, impact: i, exposure: p * i, band: band(p * i), count: 0, ids: [] });
    var at = function (p, i) { return cells[(SCALE - i) * SCALE + (p - 1)]; };
    var notScored = [], considered = 0;
    (items || []).forEach(function (r) {
      if (!r || (r.kind && r.kind !== 'risk')) return;
      if (!includeClosed && !isOpen(r)) return;
      considered++;
      var p = score(r.probability), i = score(r.impact);
      if (p == null || i == null) { notScored.push(r); return; }
      var c = at(p, i); c.count++; c.ids.push(r.id);
    });
    return { scale: SCALE, cells: cells, not_scored: notScored, considered: considered, scored: considered - notScored.length };
  }

  var toMs = function (d) { return d ? Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') : NaN; };
  var iso = function (ms) { return new Date(ms).toISOString().slice(0, 10); };
  function monday(ms) { var d = new Date(ms).getUTCDay(); return ms - ((d + 6) % 7) * DAY; }

  function resourcePressure(tasks, opts) {
    var o = opts || {}, maxWeeks = o.maxWeeks || 26;
    var todayMs = toMs(o.today || new Date().toISOString());
    var people = new Map(), unassigned = 0, undated = 0, lo = Infinity, hi = -Infinity;
    (tasks || []).forEach(function (t) {
      if (!t || ['done', 'cancelled'].indexOf(t.status) >= 0) return;
      if (!t.owner || !String(t.owner).trim()) { unassigned++; return; }
      var k = String(t.owner).trim().toLowerCase();
      if (!people.has(k)) people.set(k, { owner: String(t.owner).trim(), tasks: [], undated: 0 });
      var s = toMs(t.start_date), e = toMs(t.end_date);
      if (!isFinite(s) || !isFinite(e) || e < s) { people.get(k).undated++; undated++; return; }
      var a = t.allocation_pct == null || t.allocation_pct === '' || !isFinite(Number(t.allocation_pct)) ? null : Number(t.allocation_pct);
      var h = t.effort_hours == null || t.effort_hours === '' || !isFinite(Number(t.effort_hours)) ? null : Number(t.effort_hours);
      people.get(k).tasks.push({ id: t.id, s: s, e: e, pct: a, hours: h });
      lo = Math.min(lo, s); hi = Math.max(hi, e);
    });
    var weeks = [], truncated = false;
    if (isFinite(lo)) {
      var w0 = monday(lo), wEnd = monday(hi), total = Math.round((wEnd - w0) / (7 * DAY)) + 1;
      if (total > maxWeeks) { truncated = true; if (isFinite(todayMs)) w0 = Math.min(Math.max(w0, monday(todayMs) - 4 * 7 * DAY), wEnd - (maxWeeks - 1) * 7 * DAY); }
      for (var w = w0; w <= wEnd && weeks.length < maxWeeks; w += 7 * DAY) weeks.push(w);
    }
    var out = [];
    people.forEach(function (pp) {
      var cells = weeks.map(function (w) {
        var we = w + 6 * DAY, act = pp.tasks.filter(function (x) { return x.s <= we && x.e >= w; });
        if (!act.length) return { week: iso(w), peak_pct: null, unknown: 0, effort_hours: null, tasks: 0, task_ids: [], over: false };
        var known = act.filter(function (x) { return x.pct != null; }), peak = null;
        if (known.length) for (var d = w; d <= we; d += DAY) {
          var load = known.reduce(function (acc, x) { return x.s <= d && d <= x.e ? acc + x.pct : acc; }, 0);
          peak = peak == null ? load : Math.max(peak, load);
        }
        var withH = act.filter(function (x) { return x.hours != null; }), hours = null;
        if (withH.length) hours = Math.round(withH.reduce(function (acc, x) {
          var days = (x.e - x.s) / DAY + 1, ov = (Math.min(x.e, we) - Math.max(x.s, w)) / DAY + 1;
          return acc + x.hours * ov / days;
        }, 0) * 10) / 10;
        return { week: iso(w), peak_pct: peak, unknown: act.length - known.length, effort_hours: hours, tasks: act.length, task_ids: act.map(function (x) { return x.id; }), over: peak != null && peak > 100 };
      });
      var peaks = cells.filter(function (c) { return c.peak_pct != null; }).map(function (c) { return c.peak_pct; });
      out.push({ owner: pp.owner, cells: cells, over_weeks: cells.filter(function (c) { return c.over; }).length,
        max_pct: peaks.length ? Math.max.apply(null, peaks) : null, unknown_tasks: pp.tasks.filter(function (x) { return x.pct == null; }).length, undated: pp.undated });
    });
    out.sort(function (a, b) { return b.over_weeks - a.over_weeks || (b.max_pct || 0) - (a.max_pct || 0) || a.owner.localeCompare(b.owner); });
    return { weeks: weeks.map(iso), people: out, unassigned: unassigned, undated: undated, truncated: truncated };
  }

  /** C-07 (F28) — ONE keyboard model for the PPM diagrams (Gantt bars, timeline rows, risk cells).
   *  Returns the index to focus after `key` from `cur` among `n` items, or -1 (key not handled / focus outside).
   *  Linear by default (arrows ±1, Home/End); with opts.cols, Up/Down jump one row of a grid. Clamped, never wraps. */
  function navIndex(key, cur, n, opts) {
    if (!(n > 0) || cur < 0 || cur >= n) return -1;
    var cols = opts && opts.cols > 0 ? opts.cols : 0;
    var clamp = function (i) { return Math.max(0, Math.min(n - 1, i)); };
    switch (key) {
      case 'ArrowRight': return clamp(cur + 1);
      case 'ArrowLeft': return clamp(cur - 1);
      case 'ArrowDown': return cols ? (cur + cols < n ? cur + cols : cur) : clamp(cur + 1);
      case 'ArrowUp': return cols ? (cur - cols >= 0 ? cur - cols : cur) : clamp(cur - 1);
      case 'Home': return 0;
      case 'End': return n - 1;
      default: return -1;
    }
  }

  // ---- HTML (shared by project.html and portfolio.html). esc = the page's HTML escaper; every value goes through it.
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var short = function (d) { return String(Number(String(d).slice(8, 10))) + ' ' + MON[Number(String(d).slice(5, 7)) - 1]; };
  var BAND_TEXT = { high: 'high', medium: 'medium', low: 'low' };

  /** The P × I grid (buttons with a count) + the same data as a table + the "not scored" list. */
  function riskMatrixHtml(m, esc) {
    if (!m.considered) return '<p class="muted">No open risk.</p>';
    var rows = [];
    for (var i = SCALE; i >= 1; i--) {
      var tds = [];
      for (var p = 1; p <= SCALE; p++) {
        var c = m.cells[(SCALE - i) * SCALE + (p - 1)];
        var lbl = 'Probability ' + p + ', impact ' + i + ', exposure ' + String(c.exposure) + ' (' + BAND_TEXT[c.band] + '): ' + String(c.count) + ' risk' + (c.count === 1 ? '' : 's');
        tds.push('<td class="pim-' + esc(c.band) + '"><button type="button" class="pim-cell" data-cell="' + esc(p + '-' + i) + '" aria-label="' + esc(lbl) + '"' + (c.count ? '' : ' disabled') + '>' + esc(String(c.count)) + '</button></td>');
      }
      rows.push('<tr><th scope="row">Impact ' + esc(String(i)) + '</th>' + tds.join('') + '</tr>');
    }
    var grid = '<table class="pim"><caption>Open risks by probability × impact (count per cell; click a cell to list its risks — Arrow keys move between cells, Enter lists them)</caption><thead><tr><th scope="col"></th>' +
      [1, 2, 3].map(function (x) { return '<th scope="col">Probability ' + esc(String(x)) + '</th>'; }).join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
    var tbl = '<details><summary class="muted">Table view (the same data)</summary><table><thead><tr><th>Probability</th><th>Impact</th><th>Exposure</th><th>Band</th><th>Risks</th></tr></thead><tbody>' +
      m.cells.filter(function (c) { return c.count; }).map(function (c) { return '<tr><td>' + esc(String(c.probability)) + '</td><td>' + esc(String(c.impact)) + '</td><td>' + esc(String(c.exposure)) + '</td><td>' + esc(BAND_TEXT[c.band]) + '</td><td>' + esc(String(c.count)) + '</td></tr>'; }).join('') +
      '</tbody></table></details>';
    var ns = m.not_scored.length ? '<p><b>Not scored</b> (probability or impact missing or outside 1–3, never placed in a cell): ' +
      m.not_scored.map(function (r) { return esc(String(r.title || '')) + ' <small class="muted">#' + esc(String(r.id)) + '</small>'; }).join(' · ') + '</p>' : '<p class="muted">Every open risk is scored.</p>';
    return grid + '<div class="pim-list" aria-live="polite"></div>' + ns + tbl;
  }
  /** The risks of one cell, as a list (the click target of riskMatrixHtml). */
  function cellListHtml(m, items, key, esc) {
    var pi = String(key || '').split('-').map(Number), c = m.cells.filter(function (x) { return x.probability === pi[0] && x.impact === pi[1]; })[0];
    if (!c) return '';
    var byId = {}; (items || []).forEach(function (r) { byId[r.id] = r; });
    return '<p><b>' + esc(['P ', c.probability, ' × I ', c.impact, ' = ', c.exposure].join('')) + '</b> — ' + esc(String(c.count)) + ' risk(s):</p><ul>' +
      c.ids.map(function (id) { var r = byId[id] || {}; return '<li>' + esc(String(r.title || '')) + ' <small class="muted">#' + esc(String(id)) + (r.owner ? ' · ' + esc(String(r.owner)) : '') + '</small></li>'; }).join('') + '</ul>';
  }

  /** Person × week table: peak allocation, unknown allocations, effort hours; over 100 % flagged by text and colour. */
  function pressureHtml(r, esc) {
    if (!r.people.length) return '<p class="muted">No open task with an owner.</p>';
    var cell = function (c) {
      if (!c.tasks) return '<td class="muted" title="no task">·</td>';
      var t = [c.peak_pct == null ? '—' : c.peak_pct + ' %'];
      if (c.unknown) t.push(['+', c.unknown, ' unknown'].join(''));
      if (c.effort_hours != null) t.push(c.effort_hours + ' h');
      return '<td class="' + (c.over ? 'pr-over' : '') + '" title="' + esc('Tasks #' + c.task_ids.join(', #')) + '">' + (c.over ? '<b>▲ over</b> ' : '') + esc(t.join(' · ')) + '</td>';
    };
    var head = '<tr><th scope="col">Person</th>' + r.weeks.map(function (w) { return '<th scope="col">' + esc('wk ' + short(w)) + '</th>'; }).join('') + '<th scope="col">Weeks over 100 %</th><th scope="col">Tasks without allocation</th></tr>';
    var body = r.people.map(function (p) { return '<tr><th scope="row">' + esc(p.owner) + '</th>' + p.cells.map(cell).join('') + '<td>' + esc(String(p.over_weeks)) + '</td><td>' + esc(String(p.unknown_tasks)) + '</td></tr>'; }).join('');
    var list = [];
    r.people.forEach(function (p) { p.cells.forEach(function (c) { if (c.tasks) list.push('<tr><td>' + esc(p.owner) + '</td><td>' + esc(c.week) + '</td><td>' + esc(c.peak_pct == null ? '—' : c.peak_pct + ' %') + '</td><td>' + (c.over ? 'yes' : 'no') + '</td><td>' + esc(String(c.unknown)) + '</td><td>' + esc(c.effort_hours == null ? '—' : c.effort_hours + ' h') + '</td></tr>'); }); });
    var notes = [];
    if (r.unassigned) notes.push(r.unassigned + ' open task(s) without an owner are not counted');
    if (r.undated) notes.push(r.undated + ' open task(s) without start and end dates are not counted');
    if (r.truncated) notes.push(['showing ', r.weeks.length, ' weeks only'].join(''));
    return '<table class="pr"><caption>Peak daily allocation per person and week (Monday start). “+N unknown” = tasks with no allocation, never counted as 0 or 100 %.</caption><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      (notes.length ? '<p class="muted">' + esc(notes.join(' · ')) + '.</p>' : '') +
      '<details><summary class="muted">List view (the same data)</summary><table><thead><tr><th>Person</th><th>Week of</th><th>Peak</th><th>Over 100 %</th><th>Unknown allocations</th><th>Effort</th></tr></thead><tbody>' + list.join('') + '</tbody></table></details>';
  }

  return { navIndex: navIndex, riskMatrix: riskMatrix, resourcePressure: resourcePressure, riskMatrixHtml: riskMatrixHtml, cellListHtml: cellListHtml, pressureHtml: pressureHtml, SCALE: SCALE };
}));
