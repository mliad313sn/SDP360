/* Step 6 (SDP-DASH-2.0, lots 6.3-6.5) — the dashboard RENDERER (UMD: browser + Node tests).
 *
 * render(definition, payload, opts) → HTML string. Pure: no DOM, no fetch. Every value is escaped; the only
 * markup a definition can produce is the restricted Markdown of a text widget (headings, lists, bold, internal
 * links), converted here after escaping. Charts are inline SVG coloured through CSS classes (dashboard.css), so
 * they follow the page tokens. A RAG state is always written in words as well as colour; a value that was not
 * measured prints "—" (never 0).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DashboardRender = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var T = {
    fr: {
      green: "Dans l'objectif", amber: 'À surveiller', red: 'Hors objectif', none: 'Non mesuré',
      vs: 'vs', notMeasured: 'non mesuré', group: 'Ensemble du groupe', site: 'Site', updated: 'Données',
      late: 'en retard', down: 'jamais synchronisé', live: 'saisies en direct', ago: 'il y a', partial: 'semaine en cours',
      empty: 'Rien à signaler.', noData: 'Aucune donnée sur la période.', total: 'Groupe', weight: 'poids',
      overall: 'Avancement global', attainment: 'activités au vert', open: 'ouverts', rcaDone: 'analyse de cause faite',
      rcaTodo: 'analyse de cause à faire', since: 'depuis', days: 'j', hours: 'h', overdue: 'en retard',
      over30: 'de plus de 30 j', council: 'Council', cab: 'CAB', lateKind: 'Retards', oldest: 'Les plus anciennes',
      last: 'Dernière valeur', month: 'mois', week: 'semaine', error: 'Ce bloc n’a pas pu être calculé.', noTarget: 'Sans cible',
    },
    en: {
      green: 'On target', amber: 'Watch', red: 'Off target', none: 'Not measured',
      vs: 'vs', notMeasured: 'not measured', group: 'Whole group', site: 'Site', updated: 'Data',
      late: 'late', down: 'never synchronised', live: 'entered live', ago: '', partial: 'current week',
      empty: 'Nothing to report.', noData: 'No data for the period.', total: 'Group', weight: 'weight',
      overall: 'Overall progress', attainment: 'activities green', open: 'open', rcaDone: 'root cause done',
      rcaTodo: 'root cause to do', since: 'since', days: 'd', hours: 'h', overdue: 'overdue',
      over30: 'over 30 days', council: 'Council', cab: 'CAB', lateKind: 'Late', oldest: 'Oldest',
      last: 'Last value', month: 'month', week: 'week', error: 'This block could not be computed.', noTarget: 'No target',
    },
  };

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function fmt(v, unit, lang) {
    if (v == null || v === '' || !isFinite(Number(v))) return '—';
    var n = Number(v), s;
    s = Number.isInteger(n) ? String(n) : n.toFixed(1);
    if (lang === 'fr') s = s.replace('.', ',');
    if (unit === '%') return s + (lang === 'fr' ? ' %' : '%');
    if (unit === 'pts') return s + ' pts';
    if (unit === 'h') return s + ' h';
    if (unit === 'USD') return s + ' USD';
    return s;
  }
  function ragClass(r) { return r === 'green' || r === 'amber' || r === 'red' ? r : 'none'; }
  function pill(r, t) { var c = ragClass(r); return '<span class="db-pill db-' + c + '">' + esc(t[c]) + '</span>'; }
  function tr(o, lang) { return o ? (o[lang] || o.fr || o.en || '') : ''; }
  function deltaHtml(item, t, lang) {
    if (item.delta == null) return '';
    var d = Number(item.delta), better = item.direction === 'lower' ? d < 0 : item.direction === 'neutral' ? null : d > 0;
    var cls = d === 0 || better === null ? 'flat' : better ? 'up' : 'down';
    var arrow = d > 0 ? '▲ +' : d < 0 ? '▼ ' : '■ ';
    var unit = item.unit === '%' ? ' pt' : '';
    return '<span class="db-delta db-' + cls + '">' + arrow + esc(fmt(Math.abs(d), '', lang)) + unit + '</span>';
  }

  // ── Markdown (restricted) ─────────────────────────────────────────────
  function inline(s) {
    return s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\[([^\]]+)\]\(([a-z0-9][a-z0-9\-_.\/#?=&]*)\)/gi, function (_, txt, href) {
        return /^[a-z][a-z0-9+.-]*:/i.test(href) ? txt : '<a href="' + href + '">' + txt + '</a>';   // internal links only
      });
  }
  function markdown(md) {
    var lines = esc(md || '').split(/\r?\n/), out = [], list = false;
    lines.forEach(function (l) {
      var m;
      if ((m = /^\s*[-*]\s+(.*)$/.exec(l))) { if (!list) { out.push('<ul>'); list = true; } out.push('<li>' + inline(m[1]) + '</li>'); return; }
      if (list) { out.push('</ul>'); list = false; }
      if ((m = /^##\s+(.*)$/.exec(l))) out.push('<h4>' + inline(m[1]) + '</h4>');
      else if ((m = /^#\s+(.*)$/.exec(l))) out.push('<h3>' + inline(m[1]) + '</h3>');
      else if (l.trim()) out.push('<p>' + inline(l) + '</p>');
    });
    if (list) out.push('</ul>');
    return out.join('');
  }

  // ── SVG line chart ────────────────────────────────────────────────────
  function lineChart(series, opts) {
    var W = 320, H = 96, P = 8;
    var all = [];
    series.forEach(function (s) { s.points.forEach(function (p) { if (p.value != null) all.push(Number(p.value)); }); });
    if (!all.length) return '';
    var lo = Math.min.apply(null, all), hi = Math.max.apply(null, all);
    if (opts.unit === '%') { hi = Math.min(100, hi); }
    if (hi === lo) { hi += 1; lo -= 1; }
    var pad = (hi - lo) * 0.15; lo -= pad; hi += pad;
    var n = series[0].points.length;
    var x = function (i) { return P + (n === 1 ? 0 : i * (W - 2 * P) / (n - 1)); };
    var y = function (v) { return H - P - (v - lo) * (H - 2 * P) / (hi - lo); };
    var g = '<line class="db-axis" x1="' + P + '" x2="' + (W - P) + '" y1="' + (H - P) + '" y2="' + (H - P) + '"/>';
    series.forEach(function (s, k) {
      var d = '', run = 0;
      s.points.forEach(function (p, i) {
        if (p.value == null) { run = 0; return; }
        d += (run ? 'L' : 'M') + x(i).toFixed(1) + ',' + y(Number(p.value)).toFixed(1) + ' '; run++;
      });
      g += '<path class="db-line db-s' + (k + 1) + '" d="' + d + '"/>';
      var last = s.points[n - 1];
      if (last && last.value != null) g += '<circle class="db-dot db-s' + (k + 1) + (last.partial ? ' db-partial' : '') + '" cx="' + x(n - 1).toFixed(1) + '" cy="' + y(Number(last.value)).toFixed(1) + '" r="3.5"/>';
    });
    return '<svg class="db-chart" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="none" aria-hidden="true">' + g + '</svg>';
  }

  // ── Widgets ───────────────────────────────────────────────────────────
  var W = {
    kpi: function (w, d, t, lang) {
      return '<div class="db-kpis">' + d.items.map(function (it) {
        var why = it.value == null ? t.noData
          : (it.prev != null ? (fmt(it.prev, it.unit, lang) + ' ' + t.vs + ' ' + esc(d.prev_month)) : '');
        return '<div class="db-kpi db-k-' + ragClass(it.rag) + '"><div class="db-eyebrow">' + esc(tr(it.label, lang)) + '</div>' +
          '<div class="db-big">' + esc(fmt(it.value, it.unit, lang)) + '</div>' +
          (it.policy ? pill(it.rag, t) : '<span class="db-pill db-none">' + esc(t.noTarget) + '</span>') + '<div class="db-why">' + deltaHtml(it, t, lang) + ' ' + esc(why) + '</div></div>';
      }).join('') + '</div>';
    },
    trend: function (w, d, t, lang) {
      var ok = d.series.filter(function (s) { return !s.error; });
      if (!ok.length) return '<p class="db-note">' + esc(d.series[0] && d.series[0].error || t.noData) + '</p>';
      var unit = ok[0].unit, pts = ok[0].points, last = pts[pts.length - 1];
      var legend = ok.map(function (s, k) {
        var lp = s.points[s.points.length - 1];
        return '<span class="db-leg"><i class="db-s' + (k + 1) + '"></i>' + esc(tr(s.label, lang)) + ' <b>' + esc(fmt(lp && lp.value, s.unit, lang)) + '</b></span>';
      }).join('');
      var alt = t.last + ' ' + (last ? esc(last.label) + (last.partial ? ' (' + t.partial + ')' : '') : '');
      return '<div class="db-legend">' + legend + '</div>' + lineChart(ok, { unit: unit }) +
        '<div class="db-axis-labels"><span>' + esc(pts[0] && pts[0].label) + '</span><span>' + esc(alt) + '</span></div>';
    },
    bars: function (w, d, t, lang) {
      if (!d.rows.length) return '<p class="db-note">' + t.noData + '</p>';
      var max = Math.max.apply(null, d.rows.map(function (r) { return r.value == null ? 0 : Number(r.value); }).concat([d.unit === '%' ? 100 : 1]));
      return '<div class="db-bars">' + d.rows.map(function (r) {
        var pct = r.value == null ? 0 : Math.max(0, Math.min(100, 100 * Number(r.value) / max));
        return '<div class="db-bar-row"><span class="db-bar-name">' + esc(r.name) + '</span><span class="db-bar"><i class="db-f-' + ragClass(r.rag) + '" style="width:' + pct.toFixed(1) + '%"></i></span><span class="db-bar-val">' + esc(fmt(r.value, d.unit, lang)) + '</span></div>';
      }).join('') + '</div>';
    },
    table: function (w, d, t, lang, pillsOnly) {
      if (!d.rows.length) return '<p class="db-note">' + t.noData + '</p>';
      var head = '<tr><th scope="col">' + t.site + '</th>' + d.columns.map(function (c) { return '<th scope="col">' + esc(tr(c.label, lang)) + '</th>'; }).join('') + '</tr>';
      var cell = function (c, col) { return pillsOnly ? '<td>' + pill(c.rag, t) + '</td>' : '<td><span class="db-cell db-c-' + ragClass(c.rag) + '">' + esc(fmt(c.value, col.unit, lang)) + '</span></td>'; };
      var body = d.rows.map(function (r) { return '<tr><th scope="row">' + esc(r.name) + '</th>' + r.cells.map(function (c, i) { return cell(c, d.columns[i]); }).join('') + '</tr>'; }).join('');
      var foot = d.total ? '<tfoot><tr><th scope="row">' + t.total + '</th>' + d.total.map(function (c, i) { return cell(c, d.columns[i]); }).join('') + '</tr></tfoot>' : '';
      return '<div class="db-scroll"><table class="db-table"><thead>' + head + '</thead><tbody>' + body + '</tbody>' + foot + '</table></div>';
    },
    'rag-grid': function (w, d, t, lang) { return W.table(w, d, t, lang, true); },
    heatmap: function (w, d, t, lang) {
      if (d.error) return '<p class="db-note">' + esc(d.error) + '</p>';
      if (!d.rows.length) return '<p class="db-note">' + t.noData + '</p>';
      var head = '<tr><th scope="col">' + t.site + '</th>' + d.labels.map(function (l) { return '<th scope="col">' + esc(l) + '</th>'; }).join('') + '</tr>';
      var body = d.rows.map(function (r) {
        return '<tr><th scope="row">' + esc(r.name) + '</th>' + r.cells.map(function (c) { return '<td class="db-heat db-h-' + ragClass(c.rag) + '">' + esc(fmt(c.value, d.unit, lang)) + '</td>'; }).join('') + '</tr>';
      }).join('');
      return '<div class="db-scroll"><table class="db-table db-heatmap"><thead>' + head + '</thead><tbody>' + body + '</tbody></table></div>';
    },
    tracker: function (w, d, t, lang) {
      if (!d.pillars || !d.pillars.length) return '<p class="db-note">' + t.noData + '</p>';
      var top = '<div class="db-tracker-top"><span class="db-big">' + esc(fmt(d.overall, '%', lang)) + '</span><span>' + t.overall +
        (d.overall_delta != null ? ' ' + deltaHtml({ delta: d.overall_delta, direction: 'higher', unit: '%' }, t, lang) : '') +
        (d.attainment != null ? ' · ' + esc(fmt(d.attainment, '%', lang)) + ' ' + t.attainment : '') + '</span></div>';
      return top + '<div class="db-bars">' + d.pillars.map(function (p) {
        var rag = ragClass(p.rag);   // colour computed server-side (kpiRag 'tracker_site')
        return '<div class="db-bar-row"><span class="db-bar-name">' + esc(p.name) + (p.weight != null ? ' <small>' + t.weight + ' ' + esc(p.weight) + ' %</small>' : '') +
          '</span><span class="db-bar"><i class="db-f-' + rag + '" style="width:' + (p.pct || 0) + '%"></i></span><span class="db-bar-val">' + esc(fmt(p.pct, '%', lang)) + ' ' + deltaHtml({ delta: p.delta, direction: 'higher', unit: '%' }, t, lang) + '</span></div>';
      }).join('') + '</div>';
    },
    text: function (w, d) { return '<div class="db-md">' + markdown(d.markdown) + '</div>'; },
    actions: function (w, d, t) {
      if (!d.total) return '<p class="db-note">' + t.empty + '</p>';
      var head = '<p class="db-lead"><b>' + d.total + '</b> ' + t.overdue + ' · <b>' + d.over30 + '</b> ' + t.over30 + '</p>';
      var by = '<ul class="db-list">' + d.by_site.map(function (b) { return '<li><span>' + esc(b.name) + '</span><span><b>' + b.over30 + '</b> / ' + b.overdue + '</span></li>'; }).join('') + '</ul>';
      return head + by;
    },
    events: function (w, d, t) {
      var items = d.items || [];
      if (!items.length) return '<p class="db-note">' + t.empty + '</p>';
      return '<ul class="db-events">' + items.map(function (it) {
        var tag = it.state === 'open' ? 'MI' : it.kind === 'council' ? t.council : it.kind === 'cab' ? t.cab : t.lateKind;
        var age = it.age_hours != null ? (it.age_hours >= 48 ? Math.floor(it.age_hours / 24) + ' ' + t.days : it.age_hours + ' ' + t.hours)
          : it.age_days != null ? it.age_days + ' ' + t.days : '';
        var meta = [it.site, it.detail, it.impact, it.state === 'open' ? (it.rca_done ? t.rcaDone : t.rcaTodo) : null].filter(Boolean).join(' · ');
        return '<li><span class="db-tag db-tag-' + esc(it.kind || 'mi') + '">' + esc(tag) + '</span><div><div class="db-ev-title">' + esc(it.title) + '</div><div class="db-ev-meta">' + esc(meta) + '</div></div><span class="db-ev-age">' + esc(age) + '</span></li>';
      }).join('') + '</ul>';
    },
  };

  function stamp(domains, fresh, t, lang) {
    var parts = [];
    (domains || []).forEach(function (dn) {
      var f = fresh && fresh[dn];
      if (!f || f.status === 'ok' || f.status === 'live') return;
      parts.push('<span class="db-stamp db-' + f.status + '">' + esc(dn) + ' : ' + (f.status === 'late'
        ? t.late + ' (' + esc(f.last_ok_at ? f.last_ok_at.slice(0, 16).replace('T', ' ') : '') + ')' : t.down) + '</span>');
    });
    return parts.join('');
  }

  function widget(w, d, fresh, t, lang) {
    var title = tr(w.title, lang);
    var body;
    if (!d) body = '<p class="db-note">' + t.noData + '</p>';
    else if (d.error) body = '<p class="db-error" role="alert">' + esc(t.error) + ' ' + esc(d.error) + '</p>';
    else body = W[w.type](w, d, t, lang);
    return '<section class="db-w db-type-' + esc(w.type) + '" style="grid-column:span ' + Number(w.span || 12) + '" aria-labelledby="dbw-' + esc(w.id) + '">' +
      '<div class="db-w-head"><h2 id="dbw-' + esc(w.id) + '">' + esc(title) + '</h2>' + stamp(d && d.domains, fresh, t, lang) + '</div>' + body + '</section>';
  }

  function freshnessLine(fresh, t) {
    var hd = fresh && fresh.helpdesk;
    if (!hd || hd.age_minutes == null) return '';
    var age = hd.age_minutes < 90 ? hd.age_minutes + ' min' : Math.round(hd.age_minutes / 60) + ' h';
    return '<span class="db-stamp db-' + esc(hd.status) + '">' + t.updated + ' : ' + (t.ago ? t.ago + ' ' : '') + esc(age) + '</span>';
  }

  /** The whole dashboard. payload = /api/dashboards/:id/data response. */
  function render(definition, payload, opts) {
    var lang = (opts && opts.lang) === 'en' ? 'en' : 'fr', t = T[lang];
    var ctx = payload.context || {}, fresh = payload.freshness || {};
    var scope = ctx.scope === 'site' && ctx.site ? (t.site + ' : ' + ctx.site.name) : t.group;
    var head = '<header class="db-head"><div><div class="db-eyebrow">' + esc(scope) + ' · ' + esc(ctx.month || '') + '</div>' +
      '<h1>' + esc(tr(definition.title, lang)) + '</h1>' + (definition.description ? '<p class="db-desc">' + esc(definition.description) + '</p>' : '') +
      '</div><div class="db-head-stamps">' + freshnessLine(fresh, t) + '</div></header>';
    var grid = '<div class="db-grid db-' + (definition.density === 'compact' ? 'compact' : 'comfort') + '">' +
      definition.widgets.map(function (w) { return widget(w, (payload.widgets || {})[w.id], fresh, t, lang); }).join('') + '</div>';
    return head + grid;
  }

  return { render: render, markdown: markdown, fmt: fmt, esc: esc, T: T, WIDGET_TYPES: Object.keys(W) };
}));
