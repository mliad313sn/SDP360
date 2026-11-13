/* B3 (P7a) — "My projects" default on the portfolio page (report_config portfolio_my_projects_default; the server
   sends my_projects = { ids, can_see_all } only while it is '1'). UMD, PURE (no DOM write): loaded by
   portfolio.html, required by tests. PRESENTATION ONLY: it narrows what the page draws from the data the server
   already returned for this reader — it never reveals a project the API did not send and grants nothing.
     choice(search, mp)     'mine' (default) or 'all' — 'all' only when mp.can_see_all (admin tier, committee, finance)
     filterView(v, ids)     the view with every project-keyed list narrowed to ids (programmes, objectives, money and
                            summary rows are left as sent: the totals still cover every project the reader may read) */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PortfolioMine = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  function choice(search, mp) {
    if (!mp) return 'all';
    var m = /(?:^|[?&])show=([^&]*)/.exec(String(search || ''));
    var want = m ? decodeURIComponent(m[1]) : 'mine';
    return want === 'all' && mp.can_see_all ? 'all' : 'mine';
  }
  function filterView(v, ids) {
    if (!v) return v;
    var keep = {}; (ids || []).forEach(function (i) { keep[Number(i)] = 1; });
    var byP = function (list) { return (list || []).filter(function (x) { return keep[Number(x.project_id)]; }); };
    var out = {};
    Object.keys(v).forEach(function (k) { out[k] = v[k]; });
    out.projects = (v.projects || []).filter(function (p) { return keep[Number(p.id)]; });
    out.gantt = (v.gantt || []).filter(function (g) { return keep[Number(g.id)]; });
    ['tasks', 'risks', 'milestones', 'deliverables', 'benefits', 'plans', 'project_sites'].forEach(function (k) { if (v[k]) out[k] = byP(v[k]); });
    out.mine_only = true;
    return out;
  }
  return { choice: choice, filterView: filterView };
}));
