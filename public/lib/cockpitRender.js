/* Step 8 — how one agenda section of a meeting is shown (cadence preview and meeting screen): the figure sections
 * through the dashboard renderer (public/lib/dashboardRender.js), the cockpit sections as plain lists. */
(function (root) {
  'use strict';
  var R = root.DashboardRender, esc = R.esc;
  function sectionHtml(s) {
    if (s.widget) return R.renderWidget(Object.assign({}, s.widget, { title: { fr: s.title } }), s.data || { error: 'Pas de données.' });
    var body = s.error ? '<p class="db-error">' + esc(s.error) + '</p>'
      : s.kind === 'followup' ? (s.actions.length ? '<ul class="ck-list">' + s.actions.map(function (a) { return '<li>' + esc(a.title) + ' — ' + esc(a.owner || 'sans responsable') + (a.late ? ' <span class="ck-late">en retard</span>' : '') + '</li>'; }).join('') + '</ul>' : '<p class="db-note">Aucune action ouverte.</p>')
      : s.kind === 'rfis' ? (s.rfis.length ? '<ul class="ck-list">' + s.rfis.map(function (r) { return '<li>' + esc(r.title) + ' — ' + esc(r.status) + '</li>'; }).join('') + '</ul>' : '<p class="db-note">Aucune demande en attente.</p>')
      : s.kind === 'portfolio' ? (s.nodes.length ? '<ul class="ck-list">' + s.nodes.map(function (n) { return '<li>' + esc(n.title) + ' — <span class="' + (n.status === 'late' ? 'ck-late' : 'ck-risk') + '">' + (n.status === 'late' ? 'en retard' : 'à risque') + '</span></li>'; }).join('') + '</ul>' : '<p class="db-note">Aucun jalon en retard ou à risque.</p>')
      : '<p>' + esc(s.text || '') + '</p>';
    return '<section class="db-w"><h2>' + esc(s.title) + '</h2>' + body + '</section>';
  }
  root.CockpitRender = { section: sectionHtml };
})(typeof self !== 'undefined' ? self : this);
