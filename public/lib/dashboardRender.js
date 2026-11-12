/* SDP Dashboard — Step 6 — pure helpers shared by the dashboard viewer, the composer and the
 * server data route (UMD: browser global `DashboardRender`, Node require). No DOM, no fetch.
 *   gridStyle(layout, columns)      -> inline CSS grid placement
 *   formatValue(value, unit)        -> "92.4 %", "1 204", "3.5 h", "—" for null (null ≠ 0)
 *   ragClass(rag)                   -> 'rag-green' | 'rag-amber' | 'rag-red' | 'rag-na'
 *   windowSeries(kind, n, now)      -> the last n window labels for a trend (oldest first)
 *   widgetDataPlan(widget, def)     -> what the data route must resolve for this widget
 *   summarizeGrid(rows)             -> counts per RAG for a ragGrid header
 *   periodBounds/isPartial/seriesAnchor/evalDate -> C-05 time truth (window-anchored series, partial periods)
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./stateBadge'));
  else root.DashboardRender = factory(root.StateBadge);
})(typeof self !== 'undefined' ? self : this, function (SB) {
  'use strict';
  // E-V03 — the state words come from the shared vocabulary (lib/stateBadge.js, loaded before this file).
  if (!SB) throw new Error('DashboardRender needs lib/stateBadge.js loaded first');

  function gridStyle(layout, columns) {
    var L = layout || {}; var c = columns || 12;
    return 'grid-column:' + ((L.x || 0) + 1) + ' / span ' + Math.min(L.w || 1, c) + ';grid-row:' + ((L.y || 0) + 1) + ' / span ' + (L.h || 1) + ';';
  }

  function formatValue(value, unit) {
    if (value === null || value === undefined || (typeof value === 'number' && isNaN(value))) return '—';
    var n = Number(value);
    if (typeof value !== 'number' && isNaN(n)) return String(value);
    var u = String(unit || '').toLowerCase();
    var s;
    if (u === '%') s = (Math.round(n * 10) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 }) + ' %';
    else if (u === 'hours' || u === 'h') s = (Math.round(n * 10) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 }) + ' h';
    else if (u === 'ms') s = Math.round(n).toLocaleString('en-GB') + ' ms';
    else if (u === 'points' || u === 'pts') s = (Math.round(n * 10) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 }) + ' pts';
    else if (u === 'rank') s = '#' + Math.round(n);
    else if (u === 'usd') s = Math.round(n).toLocaleString('en-GB') + ' USD';
    else s = Number.isInteger(n) ? n.toLocaleString('en-GB') : (Math.round(n * 10) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 });
    return s;
  }

  function ragClass(rag) {
    var r = String(rag || 'NA').toUpperCase();
    return r === 'GREEN' ? 'rag-green' : r === 'AMBER' ? 'rag-amber' : r === 'RED' ? 'rag-red' : 'rag-na';
  }

  /** Coloured dot that does not rely on colour alone: a symbol and an accessible name (design review R1). */
  function ragDot(rag, state) {
    var c = ragClass(rag); var sym = { 'rag-green': '✓', 'rag-amber': '!', 'rag-red': '✕', 'rag-na': '' }[c];
    var name = { 'rag-green': 'green', 'rag-amber': 'amber', 'rag-red': 'red', 'rag-na': SB.aria('not-measured') }[c];
    // a value from a stale source keeps its number but not its colour: say "stale", never "not measured"
    if (state === 'STALE' || state === 'UNKNOWN') { sym = SB.symbol('stale'); name = SB.aria('stale', state === 'UNKNOWN' ? 'never' : null); c = 'rag-na rag-stale'; }
    return '<span class="edv-rag-dot ' + c + '" role="img" aria-label="' + name + '">' + sym + '</span>';
  }
  /** Worst first (red, amber, green), then by value in the bad direction; not measured last. */
  function sortRows(rows, higherIsBetter) {
    var rank = { RED: 0, AMBER: 1, GREEN: 2 };
    return (rows || []).slice().sort(function (a, b) {
      var na = a.value == null, nb = b.value == null; if (na !== nb) return na ? 1 : -1;
      var ra = rank[String(a.rag || '').toUpperCase()], rb = rank[String(b.rag || '').toUpperCase()];
      ra = ra == null ? 3 : ra; rb = rb == null ? 3 : rb; if (ra !== rb) return ra - rb;
      if (na) return String(a.site || '').localeCompare(String(b.site || ''));
      return higherIsBetter === false ? Number(b.value) - Number(a.value) : Number(a.value) - Number(b.value);
    });
  }
  /** "2026-W31" → "W31", "2026-07" → "Jul" (the year is shown once, under the chart). */
  function shortLabel(label) {
    var s = String(label || ''); var w = /^\d{4}-(W\d{2})$/.exec(s); if (w) return w[1];
    var m = /^\d{4}-(\d{2})$/.exec(s); if (m) return ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[1]) - 1] || s;
    return s;
  }

  /** Target and change since the previous window, coloured by whether the move is good (design review R2). */
  function kpiContext(d, opts) {
    if (!d || d.value == null) return '';
    var lowSample = !!(opts && opts.sampleSize && d.low_sample);   // E-K02 — a low sample is never compared
    var parts = [];
    var stale = !!d.freshness && d.freshness !== 'FRESH';
    if (d.target != null) parts.push('<span class="edv-target ' + (stale ? 'rag-na' : ragClass(d.vs_target && d.vs_target.rag)) + '"' + (d.target_from ? ' title="target version from ' + escapeHtml(d.target_from) + '"' : '') + '>target ' + formatValue(d.target, d.unit) + (d.target_source === 'site' ? ' (site)' : '') + '</span>');
    if (lowSample) { /* no delta: the sample is below the adopted minimum — sampleNote says so */ }
    else if (d.previous && d.previous.comparable === false) parts.push('<span class="edv-delta flat">vs ' + escapeHtml(shortLabel(d.previous.label)) + ': not comparable — this period is still running</span>');
    else if (d.previous && d.previous.delta != null) {
      var dl = Number(d.previous.delta), good = dl === 0 ? null : (d.higher_is_better !== false ? dl > 0 : dl < 0);
      var unit = String(d.unit || '').toLowerCase() === '%' ? ' pts' : '';
      parts.push('<span class="edv-delta ' + (stale || good == null ? 'flat' : good ? 'good' : 'bad') + '">' + (dl > 0 ? '▲ +' : dl < 0 ? '▼ ' : '= ') + (dl === 0 ? '' : (Math.round(Math.abs(dl) * 10) / 10).toLocaleString('en-GB', { maximumFractionDigits: 1 })) + unit + ' vs ' + escapeHtml(shortLabel(d.previous.label)) + '</span>');
    }
    return parts.length ? '<div class="edv-kpi-context">' + parts.join(' · ') + '</div>' : '';
  }

  /** Badge under a value whose source is not current (design review #1). */
  function staleBadge(d) {
    if (!d || !d.freshness || d.freshness === 'FRESH') return '';
    var was = d.rag_if_fresh && String(d.rag_if_fresh).toUpperCase() !== 'NA' ? ' · was ' + escapeHtml(String(d.rag_if_fresh).toLowerCase()) + ' when last current' : '';
    return '<div class="edv-stale-badge">' + SB.text('stale', d.freshness === 'UNKNOWN' ? 'never' : null) + was + '</div>';
  }
  /**
   * F-DATA-07 (C18) — the definition of a figure, on the tile: formula, unit, window, denominator, source job and
   * certification text, read from the KPI dictionary (m = /api/metrics/registry row) and this response
   * (d = resolved widget, sources = response.sources). A native <details>: no script, keyboard-operable.
   * Rendered only when ui_kpi_definition_drawer = '1' (the caller decides); '' when the dictionary has no row.
   */
  function definitionDrawer(d, m, sources) {
    if (!d || !m) return '';
    var row = function (k, v) { return '<dt>' + k + '</dt><dd>' + v + '</dd>'; };
    var jobs = (sources || []).filter(function (x) { return x && x.module === m.module; });
    var src = jobs.length ? jobs.map(function (x) { return escapeHtml(x.job) + ' — ' + (x.state === 'UNKNOWN' ? 'never synced' : x.state === 'STALE' ? 'not current' : 'current') + (x.last_success ? ' (last success ' + escapeHtml(String(x.last_success).slice(0, 16).replace('T', ' ')) + ')' : ''); }).join('; ')
      : 'typed into the application — no sync job';
    var b = d.base;
    var den = b && b.n != null ? Number(b.n).toLocaleString('en-GB') + (b.label ? ' ' + escapeHtml(b.label) : '') : (String(m.unit || '') === '%' ? 'not returned by the reader' : 'not a ratio');
    var states = { measured: 'measured', partial: 'partial — period still running or source read in part', not_measured: 'not measured', reader_not_wired: 'reader not wired', error: 'reader error' };
    return '<details class="edv-kpi-def"><summary>Definition</summary><dl>' +
      row('Formula', escapeHtml(m.formula || '—')) +
      row('Unit', escapeHtml(m.unit || '—')) +
      row('Window', escapeHtml((d.window && d.window.label) || '—') + ' (' + escapeHtml(m.window_kind || '—') + ')') +
      row('Denominator', den) +
      row('Data state', escapeHtml(states[d.data_state] || '—')) +
      row('Source', src) +
      row('Owner role', escapeHtml(m.owner_role || 'to be named')) +
      row('Certification', escapeHtml(m.certification || 'not certified')) +
      '</dl></details>';
  }
  /** F-DATA-07 (N8) — "2 of 11 sites": measured sites out of the sites in scope. */
  function fleetCount(f) { return f ? f.n + (f.of != null ? ' of ' + f.of : '') + ' sites' : ''; }

  /** E-V03 — the base population under a KPI value: "n = 142 tickets created", or "base not measured" (never 0). */
  function baseLine(d) {
    var b = d && d.base;
    if (b && b.n != null && isFinite(Number(b.n))) return '<div class="edv-kpi-base">n = ' + Number(b.n).toLocaleString('en-GB') + (b.label ? ' ' + escapeHtml(b.label) : '') + '</div>';
    return '<div class="edv-kpi-base edv-quiet">base not measured</div>';
  }
  /** E-K02 — "n = 142" and, only when an ADOPTED policy's min_sample is not reached, "low sample — not comparable". */
  function sampleNote(d, opts) {
    if (!d) return '';
    var withN = !(opts && opts.withN === false);
    var out = '';
    if (withN && d.n != null && isFinite(Number(d.n))) out += '<div class="edv-sample">n = ' + Number(d.n).toLocaleString('en-GB') + '</div>';
    if (d.low_sample) out += '<div class="edv-sample edv-low-sample" role="note">low sample — not comparable (n = ' + Number(d.n).toLocaleString('en-GB') + ' &lt; ' + escapeHtml(d.min_sample) + ')</div>';
    return out;
  }
  /** A relative link only (no scheme, no //host, no backslash): the action page of a figure. */
  function safeRelativeHref(href) {
    var s = String(href == null ? '' : href).trim();
    if (!s || s.length > 300 || /[\\\s<>"'`]/.test(s) || /^[a-z][a-z0-9+.-]*:/i.test(s) || s.indexOf('//') === 0) return null;
    return s;
  }
  /** E-V03 — "→ act" link to the page where the figure is acted on; '' when the href is not a safe relative URL. */
  function actionLink(href) {
    var h = safeRelativeHref(href); if (!h) return '';
    return '<a class="edv-act" href="' + escapeHtml(h) + '">→ act</a>';
  }
  // ── E-K03 — red figure → linked action (switch dashboard_red_action_links; the page only passes `ctx` when the
  //    server answered GET /api/commitments/metric-links, so with the switch off nothing below is ever rendered) ──
  var RED_METRIC = /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/, RED_WINDOW = /^[A-Za-z0-9_.:-]{1,40}$/;
  /** Source id of a red figure: "<metric>|<site_id>|<window>"; null when one part is missing or malformed. */
  function redActionSourceId(metric, siteId, windowLabel) {
    var m = String(metric == null ? '' : metric), w = String(windowLabel == null ? '' : windowLabel), sid = Number(siteId);
    if (!RED_METRIC.test(m) || !RED_WINDOW.test(w) || siteId == null || siteId === '' || !Number.isInteger(sid) || sid <= 0) return null;
    return m + '|' + sid + '|' + w;
  }
  /** Inverse of redActionSourceId → { metric, site_id, window } | null. */
  function parseRedActionSource(id) {
    var p = String(id == null ? '' : id).split('|'); if (p.length !== 3) return null;
    return redActionSourceId(p[0], p[1], p[2]) === String(id) ? { metric: p[0], site_id: Number(p[1]), window: p[2] } : null;
  }
  /**
   * "Open actions (k)" + "Create action" under a RED cell. '' for any other state (green, amber, grey/UNKNOWN,
   * stale), for a figure without a site, and when ctx is absent (switch off / endpoint unavailable).
   * ctx.links = { sourceId: { count, can_create } } as returned by the server (only sites the viewer may see).
   */
  function redActionHtml(cell, ctx) {
    if (!ctx || !ctx.links || !cell || cell.state !== 'red') return '';
    var sid = redActionSourceId(cell.metric, cell.site_id, cell.window); if (!sid) return '';
    var l = ctx.links[sid]; if (!l) return '';
    var k = Number(l.count) || 0, q = encodeURIComponent(sid), out = [];
    if (k > 0) out.push('<a class="edv-red-act" href="commitments.html?metric=' + q + '">Open actions (' + k + ')</a>');
    if (l.can_create) out.push('<a class="edv-red-act" href="commitments.html?new=1&amp;metric=' + q + '&amp;site_id=' + Number(cell.site_id) + '&amp;title=' + encodeURIComponent(String(cell.title || cell.metric) + ' is red — ' + String(cell.site || '') + ' ' + cell.window) + '">Create action</a>');
    return out.length ? '<div class="edv-red-actions">' + out.join(' · ') + '</div>' : '';
  }

  function pad2(n) { return (n < 10 ? '0' : '') + n; }
  function isoWeek(d) {
    var t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    var day = t.getUTCDay() || 7; t.setUTCDate(t.getUTCDate() + 4 - day);
    var y = t.getUTCFullYear(); var jan1 = new Date(Date.UTC(y, 0, 1));
    return { year: y, week: Math.ceil(((t - jan1) / 86400000 + 1) / 7) };
  }

  /** Window labels understood by the metric registry (`YYYY-Www` for weeks, `YYYY-MM` for months). */
  function windowSeries(kind, n, now) {
    var d = now ? new Date(now) : new Date(); var out = [];
    n = Math.max(1, Math.min(60, n || 13));
    if (kind === 'week' || kind === 'rolling13w') {
      var cur = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
      cur.setUTCDate(cur.getUTCDate() - 7);                     // the previous FULL week = the latest report period
      for (var i = n - 1; i >= 0; i--) { var w = new Date(cur); w.setUTCDate(cur.getUTCDate() - 7 * i); var iw = isoWeek(w); out.push(iw.year + '-W' + pad2(iw.week)); }
      return out;
    }
    var y = d.getUTCFullYear(), m = d.getUTCMonth();
    for (var j = n - 1; j >= 0; j--) { var mm = new Date(Date.UTC(y, m - j, 1)); out.push(mm.getUTCFullYear() + '-' + pad2(mm.getUTCMonth() + 1)); }
    return out;
  }

  // ── C-05 — time truth: period bounds, anchors, partial periods (pure; `now` is injected) ──
  function _ymd(d) { return d.toISOString().slice(0, 10); }
  function _today(now) { return _ymd(now ? new Date(now) : new Date()); }
  /** Calendar bounds of a window label: 'YYYY-Www' (ISO week), 'YYYY-MM', 'YYYY-MM-DD', 'from..to'; null otherwise. */
  function periodBounds(label) {
    var s = String(label || ''), m;
    if ((m = /^(\d{4})-W(\d{2})$/.exec(s))) {
      var jan4 = new Date(Date.UTC(+m[1], 0, 4)); var dow = jan4.getUTCDay() || 7;
      var mon = new Date(jan4); mon.setUTCDate(jan4.getUTCDate() - dow + 1 + (+m[2] - 1) * 7);
      var sun = new Date(mon); sun.setUTCDate(mon.getUTCDate() + 6);
      return { from: _ymd(mon), to: _ymd(sun) };
    }
    if ((m = /^(\d{4})-(\d{2})$/.exec(s))) return { from: m[1] + '-' + m[2] + '-01', to: _ymd(new Date(Date.UTC(+m[1], +m[2], 0))) };
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { from: s, to: s };
    if ((m = /^(\d{4}-\d{2}-\d{2})\.\.(\d{4}-\d{2}-\d{2})$/.exec(s))) return { from: m[1], to: m[2] };
    return null;
  }
  /** A period is partial while it has not ended: its last day is after today. */
  function isPartial(label, now) { var b = periodBounds(label); return !!b && b.to > _today(now); }
  /** Same rule on a resolved window object ({to}); a window ending today (current / rolling) is complete as of today. */
  function windowPartial(win, now) { return !!(win && win.to) && String(win.to).slice(0, 10) > _today(now); }
  /** The day a period is judged on: its last day, or today while it is still running. */
  function evalDate(label, now) { var b = periodBounds(label); var t = _today(now); return b ? (b.to > t ? t : b.to) : t; }
  /**
   * F05 — the date to hand windowSeries so the series ENDS on the selected window (no window → `now`, today's
   * behaviour). windowSeries(week) subtracts a week from its anchor (the previous full week), so a week series
   * gets the anchor + 7 days. A month window under a weekly series ends on the last week that finishes inside it.
   */
  function seriesAnchor(win, kind, now) {
    var b = periodBounds(win); if (!b) return now ? new Date(now) : new Date();
    var end = new Date(b.to + 'T00:00:00Z');
    if (kind === 'week' || kind === 'rolling13w') {
      if (/^\d{4}-\d{2}$/.test(String(win))) end.setUTCDate(end.getUTCDate() - (end.getUTCDay() % 7));
      end.setUTCDate(end.getUTCDate() + 7);
    }
    return end;
  }
  /** "partial · data to 4 Nov" under a tile / chart whose period is still running. */
  function partialNote(d, now) {
    if (!d || !d.partial) return '';
    var t = new Date((now ? _ymd(new Date(now)) : _today()) + 'T00:00:00Z');
    return '<div class="edv-partial" role="note">' + escapeHtml((d.window && d.window.label) || '') + ' is partial · data to ' + t.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }) + '</div>';
  }

  /** Default trend length from the widget's window hint: '13w' → 13 weeks, '6m' → 6 months. */
  function trendLength(w, metricKind) {
    var m = /^(\d+)([wm])$/.exec(String(w && w.window || ''));
    if (m) return { n: +m[1], kind: m[2] === 'w' ? 'week' : 'month' };
    return { n: metricKind === 'month' || metricKind === 'ytd' || metricKind === 'rolling3m' ? 6 : 13, kind: metricKind === 'month' || metricKind === 'ytd' || metricKind === 'rolling3m' ? 'month' : 'week' };
  }

  /** The resolution plan: single value, per-site grid, or a time series. */
  function widgetDataPlan(w, metricKind) {
    if (!w) return null;
    if (w.type === 'kpi') return { mode: 'single', compare: w.compare === 'fleet' };
    if (w.type === 'trend') { var t = trendLength(w, metricKind); return { mode: 'series', n: t.n, kind: t.kind }; }
    if (w.type === 'multiples') { var tm = trendLength(w, metricKind); return { mode: 'multiples', n: tm.n, kind: tm.kind }; }
    if (w.type === 'ragGrid' || w.type === 'heatmap' || w.type === 'bar' || w.type === 'table') return { mode: 'per-site' };
    if (w.type === 'actions') return { mode: 'actions', sources: w.sources || ['meetings', 'inspection', 'report'], onlyOverdue: !!w.onlyOverdue };
    if (w.type === 'trackerRag') return { mode: 'tracker' };
    return { mode: 'none' };
  }

  function summarizeGrid(rows) {
    var c = { GREEN: 0, AMBER: 0, RED: 0, NA: 0 };
    (rows || []).forEach(function (r) { var k = String(r && r.rag || 'NA').toUpperCase(); c[k in c ? k : 'NA']++; });
    return c;
  }

  // F-DATA-12 — the decision a widget supports, as the composer lists it; empty = "not stated", never guessed.
  function decisionText(w) {
    var d = w && typeof w.decision === 'string' ? w.decision.trim() : '';
    return 'decision: ' + (d || 'not stated');
  }
  function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }

  /** Minimal Markdown for the text widget: **bold**, *italic*, line breaks — escaped first. */
  function miniMarkdown(md) {
    var s = escapeHtml(md);
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/\*([^*]+)\*/g, '<em>$1</em>');
    return s.split(/\n{2,}/).map(function (p) { return '<p>' + p.replace(/\n/g, '<br>') + '</p>'; }).join('');
  }

  // ── C-04 (F01) — one distinct body per per-site type ─────────────────────────────────
  // A row's colour is shown only when it was measured AND the source is current: a null value,
  // a stale/unknown source or an unrecognised rag is the grey "unknown" state — never green.
  function rowState(r, d) {
    if (!r || r.value == null) return 'unknown';
    if (r.rag_if_fresh !== undefined || (d && d.freshness && d.freshness !== 'FRESH')) return 'unknown';
    var c = ragClass(r.rag); return c === 'rag-green' ? 'green' : c === 'rag-amber' ? 'amber' : c === 'rag-red' ? 'red' : 'unknown';
  }
  var STATE_WORD = { green: 'Green', amber: 'Amber', red: 'Red', unknown: 'Unknown' };
  var STATE_RAG = { green: 'GREEN', amber: 'AMBER', red: 'RED', unknown: 'NA' };
  function stateDot(st, r, d) { return ragDot(STATE_RAG[st], r && r.value != null && st === 'unknown' && (r.rag_if_fresh !== undefined || (d && d.freshness && d.freshness !== 'FRESH')) ? (d && d.freshness) || 'STALE' : null); }

  function summaryLine(d) {
    var s = d.summary || summarizeGrid(d.rows);
    return '<div class="edv-kpi-sub">' + (s.STALE ? s.STALE + ' stale — colour withheld' : s.GREEN + ' green · ' + s.AMBER + ' amber · ' + s.RED + ' red') + (s.NA ? ' · ' + s.NA + ' not measured' : '') + '</div>';
  }

  /** bar: one labelled bar per site, worst first; the scale is stated (0–100 % or 0–max). */
  function barListHtml(d) {
    var rows = (d && d.rows) || [];
    var pct = String(d.unit) === '%';
    var max = pct ? 100 : Math.max.apply(null, rows.map(function (r) { return r.value == null ? 0 : Number(r.value); }).concat([1]));
    var sorted = sortRows(rows, d.higher_is_better !== false);
    var measured = sorted.filter(function (r) { return r.value != null; }), unmeasured = sorted.filter(function (r) { return r.value == null; });
    var line = function (r) {
      var st = rowState(r, d); var label = r.site + ': ' + formatValue(r.value, d.unit) + (r.value == null ? ' (not measured)' : '');
      return '<div class="edv-ragline" role="listitem" aria-label="' + escapeHtml(label) + '">' + stateDot(st, r, d) + '<span class="edv-bar-site">' + escapeHtml(r.site) + '</span>' +
        (r.value == null ? '<span class="bar bar-none"></span>' : '<span class="bar" aria-hidden="true"><i style="width:' + Math.max(0, Math.min(100, Math.round(100 * Number(r.value) / max))) + '%"></i></span>') +
        '<span class="n">' + formatValue(r.value, d.unit) + '</span></div>';
    };
    return summaryLine(d) +
      '<div class="edv-bar-scale" aria-hidden="true"><span>Site</span><span>bar scale 0 – ' + escapeHtml(formatValue(max, d.unit)) + '</span><span>Value' + (d.unit ? ' (' + escapeHtml(d.unit) + ')' : '') + '</span></div>' +
      '<div role="list" aria-label="' + escapeHtml((d.title || d.metric || 'value') + ' per site') + '">' + measured.map(line).join('') + '</div>' +
      (unmeasured.length ? '<details class="edv-unmeasured"><summary>' + unmeasured.length + ' not measured</summary><div role="list">' + unmeasured.map(line).join('') + '</div></details>' : '');
  }

  var TABLE_COLS = [['site', 'Site'], ['value', 'Value'], ['unit', 'Unit'], ['target', 'Target'], ['state', 'State']];
  var STATE_RANK = { red: 0, amber: 1, green: 2, unknown: 3 };
  /** Sort table rows by a column; not-measured values always last. Pure (the viewer re-renders on click). */
  function sortTableRows(rows, d, col, dir) {
    var k = col || 'state', sgn = dir === 'desc' ? -1 : 1;
    return (rows || []).slice().sort(function (a, b) {
      if (k === 'site') return sgn * String(a.site || '').localeCompare(String(b.site || ''));
      if (k === 'state') { var x = STATE_RANK[rowState(a, d)] - STATE_RANK[rowState(b, d)]; return x ? sgn * x : String(a.site || '').localeCompare(String(b.site || '')); }
      var va = k === 'target' ? a.target : a.value, vb = k === 'target' ? b.target : b.value;
      var na = va == null, nb = vb == null; if (na !== nb) return na ? 1 : -1; if (na) return String(a.site || '').localeCompare(String(b.site || ''));
      return sgn * (Number(va) - Number(vb));
    });
  }
  /** table: a real sortable table (site, value, unit, target, state). Header buttons carry data-sort. */
  function tableHtml(d, sort) {
    sort = sort || {}; var col = sort.col || 'state', dir = sort.dir || 'asc';
    var rows = sortTableRows((d && d.rows) || [], d, col, dir);
    var head = TABLE_COLS.map(function (c) {
      var on = c[0] === col; var aria = on ? (dir === 'desc' ? 'descending' : 'ascending') : 'none';
      return '<th scope="col" aria-sort="' + aria + '"><button type="button" class="edv-sort" data-sort="' + c[0] + '" data-dir="' + (on && dir === 'asc' ? 'desc' : 'asc') + '">' + c[1] + (on ? (dir === 'desc' ? ' ▼' : ' ▲') : '') + '</button></th>';
    }).join('');
    var body = rows.map(function (r) {
      var st = rowState(r, d);
      return '<tr><th scope="row">' + escapeHtml(r.site) + '</th><td class="num">' + formatValue(r.value, d.unit) + '</td><td>' + escapeHtml(d.unit || '') + '</td><td class="num">' + (r.target == null ? '—' : formatValue(r.target, d.unit)) + '</td><td>' + stateDot(st, r, d) + STATE_WORD[st] + '</td></tr>';
    }).join('');
    return (d.notice ? '<div class="edv-widget-notice" role="note">' + escapeHtml(d.notice) + '</div>' : '') + summaryLine(d) +
      '<div class="edv-table-wrap"><table class="edv-data-table" data-sort-col="' + col + '" data-sort-dir="' + dir + '"><caption class="edv-sr">' + escapeHtml((d.title || d.metric || 'value') + ' per site — sorted by ' + col + ' ' + (dir === 'desc' ? 'descending' : 'ascending')) + '</caption><thead><tr>' + head + '</tr></thead><tbody>' +
      (body || '<tr><td colspan="5">No site in scope.</td></tr>') + '</tbody></table></div>';
  }

  /** ragGrid: one cell per site — RAG + value; unknown (null / stale / unrecognised) is grey, never green. */
  function ragGridHtml(d, opts) {
    var rows = sortRows((d && d.rows) || [], d.higher_is_better !== false);
    var ss = !!(opts && opts.sampleSize);   // E-K02 — switch ui_kpi_sample_size; off = byte-identical to before
    var cells = rows.map(function (r) {
      var st = rowState(r, d);
      return '<div class="edv-ragcell edv-ragcell-' + st + '" role="listitem" aria-label="' + escapeHtml(r.site + ': ' + STATE_WORD[st] + ', ' + formatValue(r.value, d.unit)) + '">' + stateDot(st, r, d) +
        '<span class="edv-ragcell-site">' + escapeHtml(r.site) + '</span><span class="edv-ragcell-val">' + formatValue(r.value, d.unit) + '</span>' +
        (ss && r.n != null ? '<span class="edv-ragcell-n">n = ' + Number(r.n).toLocaleString('en-GB') + (r.low_sample ? ' · low sample — not comparable' : '') + '</span>' : '') +
        (opts && opts.redActions ? redActionHtml({ state: st, metric: d.metric, site_id: r.site_id, site: r.site, window: d.window && d.window.label, title: d.title }, opts.redActions) : '') + '</div>';
    }).join('');
    var legend = '<div class="edv-rag-legend" aria-label="Legend">' + ragDot('GREEN') + 'Green ' + ragDot('AMBER') + 'Amber ' + ragDot('RED') + 'Red ' +
      '<span class="edv-rag-dot rag-na" aria-hidden="true"></span>Unknown — not measured, stale or never synced</div>';
    return summaryLine(d) + '<div class="edv-raggrid" role="list">' + (cells || '<div class="edv-kpi-sub">No site in scope.</div>') + '</div>' + legend;
  }

  /** The body of a per-site widget by its declared type (heatmap = retired → table with a notice). */
  function perSiteHtml(type, d, sort, opts) {
    if (type === 'table' || type === 'heatmap') return tableHtml(d, sort);
    if (type === 'ragGrid') return ragGridHtml(d, opts);
    return barListHtml(d);
  }

  /** trackerRag: G/A/R counts + score per site of the caller; NO_DATA said plainly, never zeros. */
  function trackerHtml(d) {
    if (!d || d.state !== 'OK') return '<div class="edv-kpi-sub">No tracker input for ' + escapeHtml(d && d.period || 'this period') + ' — nothing to score yet.</div>' +
      (d && d.untracked && d.untracked.length ? '<div class="edv-asof">Not in the tracker: ' + escapeHtml(d.untracked.join(', ')) + '</div>' : '');
    var f = d.fleet || {}, t = d.totals || { g: 0, a: 0, r: 0 };
    var head = '<div class="edv-kpi-sub">' + t.g + ' green · ' + t.a + ' amber · ' + t.r + ' red activities' + (f.avg_pct != null ? ' · score ' + formatValue(f.avg_pct, '%') + (f.sites > 1 ? ' (mean of ' + f.sites + ' sites)' : '') : '') + '</div>';
    var body = (d.rows || []).map(function (r) {
      return '<tr><th scope="row">' + ragDot(r.rag) + escapeHtml(r.site) + '</th><td class="num">' + r.g + '</td><td class="num">' + r.a + '</td><td class="num">' + r.r + '</td><td class="num">' + formatValue(r.score_pct, '%') + '</td></tr>';
    }).join('');
    return head + '<div class="edv-table-wrap"><table class="edv-data-table"><caption class="edv-sr">Activity tracker per site, year to ' + escapeHtml(d.period || '') + '</caption><thead><tr><th scope="col">Site</th><th scope="col">Green</th><th scope="col">Amber</th><th scope="col">Red</th><th scope="col">Score</th></tr></thead><tbody>' + body + '</tbody></table></div>' +
      '<div class="edv-asof">Year to ' + escapeHtml(d.period || '') + (d.untracked && d.untracked.length ? ' · not in the tracker: ' + escapeHtml(d.untracked.join(', ')) : '') + '</div>';
  }

  /** F13 — the trend as a table (shown when the chart library did not load; also a text alternative). */
  function seriesTableHtml(d) {
    var lines = d && d.lines && d.lines.length ? d.lines : [{ label: (d && (d.title || d.metric)) || 'value', unit: d && d.unit, points: (d && d.points) || [] }];
    var labels = (lines[0].points || []).map(function (p) { return p.label; });
    var hasT = (d && d.target != null) || (lines[0].points || []).some(function (p) { return p.target != null; });
    return '<div class="edv-table-wrap"><table class="edv-data-table edv-series-table"><thead><tr><th scope="col">Period</th>' + lines.map(function (l) { return '<th scope="col">' + escapeHtml(l.label) + '</th>'; }).join('') + (hasT ? '<th scope="col">Target</th>' : '') + '</tr></thead><tbody>' +
      labels.map(function (lab, i) {
        var p0 = (lines[0].points || [])[i] || {}; var tgt = p0.target !== undefined ? p0.target : d.target;
        return '<tr><th scope="row">' + escapeHtml(lab) + (p0.partial ? ' (partial)' : '') + '</th>' + lines.map(function (l) { var p = (l.points || [])[i]; return '<td class="num">' + formatValue(p ? p.value : null, l.unit) + '</td>'; }).join('') +
          (hasT ? '<td class="num"' + (p0.target_from ? ' title="target version from ' + escapeHtml(p0.target_from) + '"' : '') + '>' + (tgt == null ? '—' : formatValue(tgt, d.unit)) + '</td>' : '') + '</tr>';
      }).join('') +
      '</tbody></table></div>';
  }

  // ── E-V09 — small multiples: one panel per metric (own unit, own axis), ONE shared data table ──
  /** ChartTable spec of the shared table: one row per period, one column per panel (each with its unit). */
  function multiplesTableSpec(d) {
    var panels = (d && d.panels) || [];
    var labels = panels.length ? (panels[0].points || []).map(function (p) { return shortLabel(p.label) + (p.partial ? '*' : ''); }) : [];
    return { title: (d && d.title) || 'Small multiples', labelHead: 'Period', labels: labels,
      datasets: panels.map(function (p) { return { label: p.label, unit: p.unit, data: (p.points || []).map(function (x) { return x.value; }) }; }) };
  }
  /** Panels as HTML (a canvas per panel, its own unit in the heading); `tableHtml` = the shared table (caller's). */
  function multiplesHtml(d, tableHtml) {
    var panels = (d && d.panels) || [];
    var body = panels.map(function (p, i) {
      var vals = (p.points || []).filter(function (x) { return x.value != null; });
      var last = vals[vals.length - 1];
      var spoken = p.label + (last ? ': latest ' + formatValue(last.value, p.unit) + ' (' + shortLabel(last.label) + ')' : ': not measured over this period');
      return '<div class="edv-multiple" role="group" aria-label="' + escapeHtml(p.label) + '" data-panel="' + i + '"><h4>' + escapeHtml(p.label) + (p.unit ? ' <small>(' + escapeHtml(p.unit) + ')</small>' : '') + '</h4>' +
        (vals.length ? '<canvas role="img" aria-label="' + escapeHtml(spoken) + '"></canvas>' : '<div class="edv-kpi-sub">' + SB.text('not-measured') + '</div>') + '</div>';
    }).join('');
    return '<div class="edv-multiples">' + body + '</div>' + (tableHtml || '');
  }

  return { redActionSourceId, parseRedActionSource, redActionHtml, multiplesTableSpec, multiplesHtml, sampleNote, gridStyle, formatValue, ragClass, ragDot, kpiContext, staleBadge, baseLine, safeRelativeHref, actionLink, sortRows, shortLabel, windowSeries, trendLength, widgetDataPlan, summarizeGrid, escapeHtml, miniMarkdown, isoWeek,
    rowState, barListHtml, tableHtml, sortTableRows, ragGridHtml, perSiteHtml, trackerHtml, seriesTableHtml,
    periodBounds, isPartial, windowPartial, evalDate, seriesAnchor, partialNote, definitionDrawer, fleetCount, decisionText };
});
