/* F-PRODUCT-01 (gap E07) — ONE allocation contract for the server (services/projectSchedule.js), the pages
   (public/lib/ppmVisuals.js: resourcePressure, capacityBySite) and the exports (services/portfolioDeck.js).
   UMD, PURE, no I/O, no money.

   classify(task) → { state, pct, reason }
     excluded  — the task does not take part in a capacity sum. reason: 'closed' (status done/cancelled),
                 'unassigned' (no owner), 'undated' (no start/end, or end before start).
     unknown   — allocation_pct is null, '', undefined or not a number. NEVER read as 0 % nor as 100 %.
     invalid   — a finite number outside 0..100 (legacy rows: the write path refuses them). Never summed, listed.
     known     — a finite number 0..100. 0 is a booking that adds 0.
   conflicts(tasks) → [{ owner, from, to, peak_pct, task_ids }]
     Per person (owner trimmed, case-insensitive), the runs of days where the sum of the KNOWN allocations of the
     tasks running that day is above 100. Only known tasks above 0 % are listed in task_ids.
   coverage(tasks) → { tasks, known, unknown, invalid, unassigned, undated, closed, invalid_task_ids,
                       possible_conflicts: [{ owner, from, to, known_peak_pct, unknown_task_ids, invalid_task_ids }] }
     tasks = the OPEN tasks (known + unknown + invalid + unassigned + undated). A possible conflict is a run of days
     where a person has at least two tasks running, at least one of them with an unknown or invalid allocation, and
     a known load that is not above 100: it is never counted as a conflict and never shown as "none".
     known_peak_pct is null when no known allocation runs on those days. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AllocationContract = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DAY = 86400000;
  var toMs = function (d) { return d ? Date.parse(String(d).slice(0, 10) + 'T00:00:00Z') : NaN; };
  var iso = function (ms) { return new Date(ms).toISOString().slice(0, 10); };
  var num = function (a, b) { return a - b; };
  function ownerKey(o) { return String(o == null ? '' : o).trim().toLowerCase(); }

  function classify(t) {
    if (!t) return { state: 'excluded', pct: null, reason: 'closed' };
    if (t.status === 'done' || t.status === 'cancelled') return { state: 'excluded', pct: null, reason: 'closed' };
    if (!ownerKey(t.owner)) return { state: 'excluded', pct: null, reason: 'unassigned' };
    var s = toMs(t.start_date), e = toMs(t.end_date);
    if (!isFinite(s) || !isFinite(e) || e < s) return { state: 'excluded', pct: null, reason: 'undated' };
    var a = t.allocation_pct;
    if (a == null || a === '' || typeof a === 'boolean' || !isFinite(Number(a))) return { state: 'unknown', pct: null, reason: null };
    var n = Number(a);
    if (n < 0 || n > 100) return { state: 'invalid', pct: null, reason: null };
    return { state: 'known', pct: n, reason: null };
  }

  /** The tasks that run on dated days, grouped per person, each with its class. */
  function perOwner(tasks) {
    var by = new Map();
    (tasks || []).forEach(function (t) {
      var c = classify(t);
      if (c.state === 'excluded') return;
      var k = ownerKey(t.owner);
      if (!by.has(k)) by.set(k, { owner: String(t.owner).trim(), list: [] });
      by.get(k).list.push({ id: Number(t.id), s: toMs(t.start_date), e: toMs(t.end_date), state: c.state, pct: c.pct });
    });
    return by;
  }
  /** Walk the day segments of one person; fn(from, to, active) for every segment with at least one task. */
  function segments(list, fn) {
    var pts = [];
    list.forEach(function (x) { if (pts.indexOf(x.s) < 0) pts.push(x.s); if (pts.indexOf(x.e + DAY) < 0) pts.push(x.e + DAY); });
    pts.sort(num);
    for (var i = 0; i < pts.length - 1; i++) {
      var at = pts[i];
      var active = list.filter(function (x) { return x.s <= at && at <= x.e; });
      fn(at, pts[i + 1] - DAY, active);
    }
  }

  function conflicts(tasks) {
    var out = [];
    perOwner(tasks).forEach(function (p) {
      var open = null;
      var close = function () { if (open) { out.push(open); open = null; } };
      segments(p.list, function (from, to, active) {
        var known = active.filter(function (x) { return x.state === 'known' && x.pct > 0; });
        var load = known.reduce(function (a, x) { return a + x.pct; }, 0);
        if (load > 100) {
          if (!open) open = { owner: p.owner, from: from, to: to, peak_pct: load, ids: [] };
          open.to = to; open.peak_pct = Math.max(open.peak_pct, load);
          known.forEach(function (x) { if (open.ids.indexOf(x.id) < 0) open.ids.push(x.id); });
        } else close();
      });
      close();
    });
    return out.map(function (c) { return { owner: c.owner, from: iso(c.from), to: iso(c.to), peak_pct: c.peak_pct, task_ids: c.ids.sort(num) }; });
  }

  function coverage(tasks) {
    var r = { tasks: 0, known: 0, unknown: 0, invalid: 0, unassigned: 0, undated: 0, closed: 0, invalid_task_ids: [], possible_conflicts: [] };
    (tasks || []).forEach(function (t) {
      var c = classify(t);
      if (c.state === 'excluded') { r[c.reason]++; if (c.reason !== 'closed') r.tasks++; return; }
      r.tasks++; r[c.state]++;
      if (c.state === 'invalid') r.invalid_task_ids.push(Number(t.id));
    });
    r.invalid_task_ids.sort(num);
    perOwner(tasks).forEach(function (p) {
      var open = null;
      var close = function () { if (open) { r.possible_conflicts.push(open); open = null; } };
      segments(p.list, function (from, to, active) {
        var known = active.filter(function (x) { return x.state === 'known'; });
        var load = known.reduce(function (a, x) { return a + x.pct; }, 0);
        var blind = active.filter(function (x) { return x.state !== 'known'; });
        if (blind.length && active.length >= 2 && load <= 100) {
          if (!open) open = { owner: p.owner, from: from, to: to, known_peak_pct: null, unk: [], inv: [] };
          open.to = to;
          if (known.length) open.known_peak_pct = open.known_peak_pct == null ? load : Math.max(open.known_peak_pct, load);
          blind.forEach(function (x) { var l = x.state === 'unknown' ? open.unk : open.inv; if (l.indexOf(x.id) < 0) l.push(x.id); });
        } else close();
      });
      close();
    });
    r.possible_conflicts = r.possible_conflicts.map(function (c) { return { owner: c.owner, from: iso(c.from), to: iso(c.to), known_peak_pct: c.known_peak_pct, unknown_task_ids: c.unk.sort(num), invalid_task_ids: c.inv.sort(num) }; });
    return r;
  }

  /** One sentence for a tile or a note: never "none" when something is not known. esc is NOT applied (plain numbers). */
  function coverageText(cov, nConflicts) {
    var blind = cov ? cov.unknown + cov.invalid : 0;
    var head = nConflicts ? String(nConflicts) : (blind ? 'none known' : 'none');
    var bits = [];
    if (cov && cov.unknown) bits.push(cov.unknown + ' unknown');
    if (cov && cov.invalid) bits.push(cov.invalid + ' invalid');
    return bits.length ? head + ' · ' + bits.join(' · ') : head;
  }

  return { classify: classify, conflicts: conflicts, coverage: coverage, coverageText: coverageText, ownerKey: ownerKey };
}));
