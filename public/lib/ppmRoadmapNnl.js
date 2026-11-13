/* PPM parity W4 — portfolio roadmap Now / Next / Later (PURE + a small HTML renderer; UMD for the page and the tests).
 *
 * A pure grouping of the projects the reader may already see (nothing new is read, nothing is written):
 *   now          in delivery: stage in_progress / on_hold / closure, or start ≤ today ≤ end (open end = still running)
 *   next         not started, start within the next `horizonDays` (default 90)
 *   later        start after the horizon
 *   unscheduled  no start date and not in delivery — shown as such, never guessed into a bucket
 *   excluded     closed / cancelled / done projects — counted, not listed
 * A start in the past with an end in the past on an open project is "now" (overdue but still running) and flagged late.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PpmRoadmapNnl = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var DELIVERY = ['in_progress', 'on_hold', 'closure'];
  var CLOSED_STAGE = ['closed', 'cancelled'];
  var CLOSED_STATUS = ['done', 'closed', 'cancelled', 'completed'];
  var day = function (v) { return v ? String(v).slice(0, 10) : null; };
  function addDays(d, n) { var t = Date.parse(d + 'T00:00:00Z'); return isNaN(t) ? null : new Date(t + n * 86400000).toISOString().slice(0, 10); }

  /** opts: { today: 'YYYY-MM-DD', horizonDays: 90 } */
  function group(projects, opts) {
    opts = opts || {};
    var today = day(opts.today) || new Date().toISOString().slice(0, 10);
    var horizon = addDays(today, Number(opts.horizonDays) > 0 ? Number(opts.horizonDays) : 90);
    var out = { now: [], next: [], later: [], unscheduled: [], excluded: 0, today: today, horizon: horizon };
    (projects || []).forEach(function (p) {
      var stage = String(p.stage || '').toLowerCase(), status = String(p.status || '').toLowerCase();
      if (CLOSED_STAGE.indexOf(stage) >= 0 || CLOSED_STATUS.indexOf(status) >= 0) { out.excluded++; return; }
      var s = day(p.start_date), e = day(p.end_date);
      var item = { id: p.id, key: p.key || null, name: p.name || null, stage: p.stage || null, start_date: s, end_date: e, late: false };
      if (DELIVERY.indexOf(stage) >= 0 || (s && s <= today)) { item.late = !!(e && e < today); out.now.push(item); return; }
      if (!s) { out.unscheduled.push(item); return; }
      if (s <= horizon) out.next.push(item); else out.later.push(item);
    });
    var by = function (a, b) { return String(a.start_date || '9999').localeCompare(String(b.start_date || '9999')) || String(a.key || '').localeCompare(String(b.key || '')); };
    ['now', 'next', 'later', 'unscheduled'].forEach(function (k) { out[k].sort(by); });
    return out;
  }
  var LABELS = { now: 'Now', next: 'Next', later: 'Later', unscheduled: 'Not scheduled' };
  function html(g, esc) {
    var link = function (p) { return '<a href="project.html?id=' + encodeURIComponent(p.id) + '">' + esc(p.key || ('#' + p.id)) + '</a>'; };
    var col = function (k) {
      return '<section class="nnl-col" aria-label="' + esc(LABELS[k]) + '"><h3>' + esc(LABELS[k]) + ' <span class="muted">' + g[k].length + '</span></h3><ul>' +
        (g[k].length ? g[k].map(function (p) { return '<li>' + link(p) + ' ' + esc(p.name || '') + ' <span class="muted">' + esc((p.start_date || '—') + ' → ' + (p.end_date || '—')) + '</span>' + (p.late ? ' <span class="pill RED">late</span>' : '') + '</li>'; }).join('') : '<li class="muted">None.</li>') + '</ul></section>';
    };
    return '<div class="nnl">' + ['now', 'next', 'later', 'unscheduled'].map(col).join('') + '</div>' +
      '<p class="muted">Next = starting within the horizon (up to ' + esc(g.horizon || '—') + '). Closed, cancelled and done projects are not listed (' + g.excluded + ').</p>';
  }
  return { group: group, html: html, LABELS: LABELS };
});
