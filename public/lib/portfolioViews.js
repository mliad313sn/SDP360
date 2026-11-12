/* R2-WB-05 (REBUILD-SPEC R5) — portfolio views: Timeline · List · Board, the choice kept in the URL (?view=).
   UMD, PURE (no DOM write here): loaded by portfolio.html, required by tests. Shown only while report_config
   portfolio_views_enabled = '1' (GET /api/governance/ppm/features → portfolio_views); '0' = today's single timeline.
   The board is READ-ONLY: a card is a link to the project page, moving a card is not a stage move (stage moves stay
   on the gated project page). Every field goes through the page's escaper (esc).
     VIEWS, SCHEMA          — the three views and the URL schema for lib/urlFilters.js
     viewOf(search)         — the view named in the query string, else 'timeline' (an unknown value is ignored)
     navHtml(current, esc)  — the view switch: three links, exactly ONE aria-current="page"
     boardHtml(gantt, stages, esc) — one column per stage (stages from GET /api/governance/portfolio), a project
                              without a stage is in 'proposal' (the page's convention); cards keyboard-reachable links */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PortfolioViews = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VIEWS = [['timeline', 'Timeline'], ['list', 'List'], ['board', 'Board']];
  var SCHEMA = { view: { type: 'enum', values: ['timeline', 'list', 'board'], def: 'timeline' } };
  function viewOf(search) {
    var m = /(?:^|[?&])view=([^&]*)/.exec(String(search || ''));
    var v = m ? decodeURIComponent(m[1]) : '';
    return ['timeline', 'list', 'board'].indexOf(v) >= 0 ? v : 'timeline';
  }
  function navHtml(current, esc) {
    var cur = ['timeline', 'list', 'board'].indexOf(current) >= 0 ? current : 'timeline';
    return VIEWS.map(function (v) {
      return '<a class="btn pf-view' + (v[0] === cur ? ' primary' : '') + '" href="?view=' + esc(v[0]) + '" data-view="' + esc(v[0]) + '"' + (v[0] === cur ? ' aria-current="page"' : '') + '>' + esc(v[1]) + '</a>';
    }).join(' ');
  }
  function boardHtml(gantt, stages, esc) {
    var st = (stages && stages.length ? stages : ['proposal']).slice();
    var by = {}; st.forEach(function (s) { by[s] = []; });
    var other = [];
    (gantt || []).forEach(function (g) { var s = g.stage || 'proposal'; if (by[s]) by[s].push(g); else other.push(g); });
    var card = function (g) {
      return '<li class="pf-card"><a href="project.html?id=' + encodeURIComponent(String(g.id)) + '"><b>' + esc(g.key) + '</b> ' + esc(g.name) + '</a>' +
        '<div class="muted">' + (g.status ? '<span class="pill ' + esc(g.status) + '">' + esc(g.status) + '</span> ' : '') + (g.progress_pct == null ? '—' : esc(String(g.progress_pct) + ' %')) +
        (g.slip_days ? ' · +' + esc(String(g.slip_days)) + ' d' : '') + (g.late ? ' · late' : '') + '</div></li>';
    };
    var col = function (name, list) {
      return '<section class="pf-col" aria-label="' + esc(String(name).replace(/_/g, ' ') + ' (' + list.length + ')') + '"><h3>' + esc(String(name).replace(/_/g, ' ')) + ' <span class="muted">' + esc(String(list.length)) + '</span></h3>' +
        (list.length ? '<ul>' + list.map(card).join('') + '</ul>' : '<p class="muted">—</p>') + '</section>';
    };
    return '<div class="pf-board">' + st.map(function (s) { return col(s, by[s]); }).join('') + (other.length ? col('other', other) : '') + '</div>' +
      '<p class="muted">Read-only: a stage changes on the project page, through its gate.</p>';
  }
  return { VIEWS: VIEWS, SCHEMA: SCHEMA, viewOf: viewOf, navHtml: navHtml, boardHtml: boardHtml };
}));
