/* Adoption Lot B (items 11 + 16) — two optional Home blocks, both behind report_config switches (default '0').
 *
 *   ui_home_group_variant   a person with NO site (executive, PMO, finance, a site-less admin…) used to read
 *                           "no site — use the site action register". With the switch on, Home shows a group card:
 *                           · worst sites      — the Vue Groupe grid (GET /api/site-awareness/fleet), only for the
 *                                                roles that route serves (executive, super_admin); others don't
 *                                                get the line at all (no call, no dead link)
 *                           · late projects    — GET /api/governance/portfolio (what the person already reads on
 *                                                the portfolio page): projects flagged late or slipped by the server
 *                           · decisions due    — GET /api/governance/overview (open / overdue, same counts as the
 *                                                cockpit)
 *   ui_home_freshness_strip the admin tier sees one line per data source: last successful collection, state; a
 *                           source never collected says "jamais synchronisé" in amber (GET /api/connector-health).
 *
 * Every figure comes from an existing route; this file only orders and labels them. A call that fails, or answers
 * nothing usable, reads "— not measured" — never 0, never green. PURE helpers + a small mount (fetch injected in
 * tests). UMD: window.HomeGroup in the browser, module.exports in Node. */
(function (root) {
  'use strict';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var T = {
    en: { group: 'Across the group', worst: 'Sites needing attention', late: 'Late or slipped projects', dec: 'Decisions',
      nm: '— not measured', noAlert: 'no site in red or amber', noLate: 'no late project', open: 'open', overdue: 'overdue',
      red: 'red', amber: 'amber', more: '+ {n} more', fresh: 'Data sources', never: 'never synced', last: 'last collection',
      groupNote: 'You have no site of your own: this card shows the group. Each line opens the page that explains it.',
      freshNote: 'Last successful collection per source. A source that never collected has no figure anywhere.',
      states: { ok: 'up to date', partial: 'partial', stale: 'late', error: 'error', not_configured: 'not configured', disarmed: 'disarmed', unknown: 'unknown' } },
    fr: { group: 'À l\'échelle du groupe', worst: 'Sites à surveiller', late: 'Projets en retard ou décalés', dec: 'Décisions',
      nm: '— non mesuré', noAlert: 'aucun site en rouge ni en orange', noLate: 'aucun projet en retard', open: 'ouvertes', overdue: 'en retard',
      red: 'rouge', amber: 'orange', more: '+ {n} autre(s)', fresh: 'Sources de données', never: 'jamais synchronisé', last: 'dernière collecte',
      groupNote: 'Vous n\'avez pas de site en propre : cette carte montre le groupe. Chaque ligne ouvre la page qui l\'explique.',
      freshNote: 'Dernière collecte réussie par source. Une source jamais collectée n\'a de chiffre nulle part.',
      states: { ok: 'à jour', partial: 'partielle', stale: 'en retard', error: 'erreur', not_configured: 'non configurée', disarmed: 'désarmée', unknown: 'inconnu' } },
  };
  function L(lang) { return T[lang === 'fr' ? 'fr' : 'en']; }

  /** Which blocks this person gets. has = hierarchical role check; policy = window.__uiPolicy; noSite = /api/me/work
   *  returned no site for them. The worst-sites line follows GET /api/site-awareness/fleet (executive / super_admin). */
  function blocksFor(has, policy, noSite) {
    var h = typeof has === 'function' ? has : function () { return false; };
    var p = policy || {};
    var group = p.home_group_variant === '1' && noSite === true;
    return { group: group, worst: group && !!h('executive'), freshness: p.home_freshness_strip === '1' && !!h('admin') };
  }

  var RAG_RANK = { red: 2, amber: 1 };
  /** Worst sites of the Vue Groupe answer: red before amber, then the most red cells; green / na are never listed.
   *  null = not measured (no answer, or no site has a measured colour). */
  function worstSites(fleet, n) {
    var rows = fleet && Array.isArray(fleet.sites) ? fleet.sites : null;
    if (!rows) return null;
    var measured = rows.filter(function (r) { return r && r.overall_rag && r.overall_rag !== 'na'; });
    if (!measured.length) return null;
    var reds = function (r) { var c = r.cells || {}; return Object.keys(c).filter(function (k) { return c[k] && c[k].rag === 'red'; }).length; };
    var alert = measured.filter(function (r) { return RAG_RANK[r.overall_rag]; })
      .sort(function (a, b) { return (RAG_RANK[b.overall_rag] - RAG_RANK[a.overall_rag]) || (reds(b) - reds(a)) || String(a.site_name || '').localeCompare(String(b.site_name || '')); });
    return { total: alert.length, items: alert.slice(0, n || 3).map(function (r) { return { site_id: r.site_id, name: r.site_name || ('#' + r.site_id), rag: r.overall_rag, red_cells: reds(r) }; }) };
  }

  /** Late projects of the portfolio answer: the server's own flags (gantt `late` / `slip_days`, the same rule as the
   *  portfolio summary's late_projects). null = not measured. */
  function lateProjects(pf, n) {
    var g = pf && Array.isArray(pf.gantt) ? pf.gantt : null;
    if (!g) return null;
    var late = g.filter(function (p) { return p && (p.late === true || (typeof p.slip_days === 'number' && p.slip_days > 0)); });
    // P11 r5 F-17: lateness is not measurable without an end date — count the open projects that have none
    var open = g.filter(function (p) { return p && ['done', 'cancelled'].indexOf(String(p.status || '').toLowerCase()) < 0; });
    var undated = open.filter(function (p) { return !(p.end || p.end_date) && late.indexOf(p) < 0; }).length;
    return { total: late.length, open: open.length, undated: undated, items: late.slice(0, n || 5).map(function (p) { return { id: p.id, key: p.key || '', name: p.name || '', late: p.late === true, slip_days: typeof p.slip_days === 'number' ? p.slip_days : null }; }) };
  }

  function decisions(ov) {
    if (!ov || typeof ov.decisions_open !== 'number') return null;
    return { open: ov.decisions_open, overdue: typeof ov.decisions_overdue === 'number' ? ov.decisions_overdue : null };
  }

  var fill = function (s, o) { return s.replace(/\{(\w+)\}/g, function (_, k) { return o[k]; }); };
  function row(label, href, value) {
    return '<li><span class="hm-k">' + (href ? '<a href="' + esc(href) + '">' + esc(label) + '</a>' : esc(label)) + '</span><span class="hm-v">' + value + '</span></li>';
  }
  function nm(t) { return '<span class="hm-nm">' + esc(t.nm) + '</span>'; }

  // P11 r5 F-17 — "no late project" only for projects that can be late: every open project undated = not measured.
  var UNDATED = { en: { none: '— not measured: no end date recorded ({n})', some: '{n} without end date — not measured' },
    fr: { none: '— non mesuré : aucune date de fin saisie ({n})', some: '{n} sans date de fin — non mesuré(s)' } };
  function lateNone(lp, lang, t) {
    var u = UNDATED[lang === 'fr' ? 'fr' : 'en'];
    if (lp.undated && lp.undated >= lp.open) return '<span class="hm-nm">' + esc(fill(u.none, { n: lp.undated })) + '</span>';
    return esc(t.noLate) + (lp.undated ? ' <span class="hm-muted">(' + esc(fill(u.some, { n: lp.undated })) + ')</span>' : '');
  }

  /** d = { worst (undefined = line not offered), late, decisions } */
  function groupHtml(d, lang) {
    var t = L(lang);
    var parts = [];
    if (d.worst !== undefined) {
      var w = d.worst;
      var v = !w ? nm(t) : (w.total === 0 ? esc(t.noAlert)
        : '<b>' + w.total + '</b><ul class="hm-pv">' + w.items.map(function (s) { return '<li>' + esc(s.name) + ' <span class="hm-muted">' + esc(s.rag === 'red' ? t.red : t.amber) + '</span></li>'; }).join('') + '</ul>');
      parts.push(row(t.worst, 'site-awareness.html', v));
    }
    var lp = d.late;
    parts.push(row(t.late, 'portfolio.html', !lp ? nm(t) : (lp.total === 0 ? lateNone(lp, lang, t)
      : '<b class="hm-late">' + lp.total + '</b><ul class="hm-pv">' + lp.items.map(function (p) { return '<li>' + esc(p.key ? p.key + ' — ' + p.name : p.name) + (p.slip_days ? ' <span class="hm-muted">+' + p.slip_days + ' j</span>' : '') + '</li>'; }).join('') + (lp.total > lp.items.length ? '<li class="hm-muted">' + esc(fill(t.more, { n: lp.total - lp.items.length })) + '</li>' : '') + '</ul>')));
    var dc = d.decisions;
    parts.push(row(t.dec, 'cockpit.html', !dc ? nm(t) : dc.open + ' ' + esc(t.open) + (dc.overdue == null ? '' : ' · ' + (dc.overdue > 0 ? '<span class="hm-late">' + dc.overdue + ' ' + esc(t.overdue) + '</span>' : dc.overdue + ' ' + esc(t.overdue)))));
    return '<section class="hm-card" id="hmGroup" aria-labelledby="hm-group-h"><h2 id="hm-group-h">' + esc(t.group) + '</h2><p class="hm-muted">' + esc(t.groupNote) + '</p><ul class="hm-blocks">' + parts.join('') + '</ul></section>';
  }

  /** health = GET /api/connector-health answer (or null). Never synced = no last_success → amber "never synced". */
  function freshnessHtml(health, lang) {
    var t = L(lang);
    var list = health && Array.isArray(health.connectors) ? health.connectors : null;
    var body = !list ? '<p>' + nm(t) + '</p>' : '<ul class="hm-blocks">' + list.map(function (c) {
      var st = t.states[c.state] || c.state_label || c.state || '';
      var when = c.last_success ? esc(t.last) + ' ' + esc(String(c.last_success).slice(0, 16).replace('T', ' ')) : '<span class="hm-fresh-never">' + esc(t.never) + '</span>';
      return '<li><span class="hm-k">' + esc(c.name || c.id) + '</span><span class="hm-v">' + when + ' · <span class="hm-muted">' + esc(st) + '</span></span></li>';
    }).join('') + '</ul>';
    return '<section class="hm-card" id="hmFresh" aria-labelledby="hm-fresh-h"><h2 id="hm-fresh-h"><a href="connector-health.html">' + esc(t.fresh) + '</a></h2><p class="hm-muted">' + esc(t.freshNote) + '</p>' + body + '</section>';
  }

  /** Browser glue. opts = { has, policy, noSite, lang, fetchJson(url) → {status, json} } → { group, fresh } html. */
  function compose(opts) {
    var o = opts || {};
    var b = blocksFor(o.has, o.policy, o.noSite);
    var get = function (url) { return Promise.resolve().then(function () { return o.fetchJson(url); }).then(function (r) { return r && r.status >= 200 && r.status < 300 ? r.json : null; }, function () { return null; }); };
    var jobs = [
      b.group ? get('/api/governance/portfolio') : null,
      b.group ? get('/api/governance/overview') : null,
      b.worst ? get('/api/site-awareness/fleet') : null,
      b.freshness ? get('/api/connector-health') : null,
    ];
    return Promise.all(jobs).then(function (r) {
      var out = { group: '', fresh: '' };
      if (b.group) out.group = groupHtml({ worst: b.worst ? worstSites(r[2], 3) : undefined, late: lateProjects(r[0], 5), decisions: decisions(r[1]) }, o.lang);
      if (b.freshness) out.fresh = freshnessHtml(r[3], o.lang);
      return out;
    });
  }

  var api = { blocksFor: blocksFor, worstSites: worstSites, lateProjects: lateProjects, decisions: decisions, groupHtml: groupHtml, freshnessHtml: freshnessHtml, compose: compose };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.HomeGroup = api;
})(typeof self !== 'undefined' ? self : this);
