/* Step 6 — dashboard viewer (dashboard.html, direction.html). No inline script: the strict CSP applies.
 * With an id (data-dashboard-id or ?id=) it renders that dashboard; without one it lists the dashboards
 * this person may open (and the composer link for authors). */
(function () {
  'use strict';
  var root = document.getElementById('db-root');
  var R = window.DashboardRender;
  var tok = function () { return window.__authToken || ''; };
  var LANG_KEY = 'dash_lang';
  var lang = 'fr';
  try { lang = localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'fr'; } catch (_) {}
  var params = new URLSearchParams(location.search);
  var id = root.getAttribute('data-dashboard-id') || params.get('id') || '';
  var state = { site: params.get('site') || '', month: params.get('month') || '' };

  function api(path) {
    return fetch(path, { headers: { 'x-report-token': tok() } }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
        return j;
      });
    });
  }
  function esc(s) { return R.esc(s); }
  function stateBox(title, text) {
    root.innerHTML = '<div class="db-state"><h1>' + esc(title) + '</h1><p class="db-note">' + esc(text) + '</p></div>';
  }

  function toolbar(payload) {
    var c = payload.context || {};
    var opts = (c.group_allowed ? '<option value="">' + (lang === 'fr' ? 'Ensemble du groupe' : 'Whole group') + '</option>' : '') +
      (c.site_choices || []).map(function (s) {
        var sel = c.site && c.site.code === s.code ? ' selected' : '';
        return '<option value="' + esc(s.code) + '"' + sel + '>' + esc(s.name) + '</option>';
      }).join('');
    var siteSel = (c.site_choices || []).length > (c.group_allowed ? 0 : 1)
      ? '<label for="db-site">' + (lang === 'fr' ? 'Périmètre' : 'Scope') + '<select id="db-site">' + opts + '</select></label>' : '';
    return '<div class="db-toolbar">' + siteSel +
      '<label for="db-month">' + (lang === 'fr' ? 'Mois' : 'Month') + '<input id="db-month" type="month" value="' + esc(c.month || '') + '"></label>' +
      '<span class="db-grow"></span>' +
      '<button class="db-btn" id="db-lang" type="button" aria-label="Language">' + (lang === 'fr' ? 'EN' : 'FR') + '</button>' +
      '<button class="db-btn" id="db-refresh" type="button">' + (lang === 'fr' ? 'Actualiser' : 'Refresh') + '</button></div>';
  }

  function wire() {
    var s = document.getElementById('db-site'), m = document.getElementById('db-month');
    if (s) s.addEventListener('change', function () { state.site = s.value; load(); });
    if (m) m.addEventListener('change', function () { state.month = m.value; load(); });
    document.getElementById('db-lang').addEventListener('click', function () {
      lang = lang === 'fr' ? 'en' : 'fr';
      try { localStorage.setItem(LANG_KEY, lang); } catch (_) {}
      document.documentElement.lang = lang; load();
    });
    document.getElementById('db-refresh').addEventListener('click', load);
  }

  function load() {
    var q = new URLSearchParams();
    if (state.site) q.set('site', state.site);
    if (state.month) q.set('month', state.month);
    api('/api/dashboards/' + encodeURIComponent(id) + '/data' + (q.toString() ? '?' + q : '')).then(function (p) {
      root.innerHTML = toolbar(p) + R.render(p.definition, p, { lang: lang });
      document.title = (p.definition.title[lang] || p.definition.title.fr) + ' · Endeavour Mining IT';
      wire();
    }).catch(function (e) {
      if (e.status === 403) stateBox(lang === 'fr' ? 'Accès réservé' : 'Restricted', e.message);
      else if (e.status === 404) stateBox(lang === 'fr' ? 'Tableau introuvable' : 'Dashboard not found', e.message);
      else stateBox(lang === 'fr' ? 'Le tableau n’a pas pu se charger' : 'The dashboard could not load',
        (lang === 'fr' ? 'Réessayez dans une minute ; si cela persiste, signalez-le à l’équipe IT Ops. ' : 'Try again in a minute. ') + e.message);
    });
  }

  function list() {
    api('/api/dashboards').then(function (j) {
      var cards = j.dashboards.filter(function (d) { return d.visible; }).map(function (d) {
        var href = d.id === 'direction' ? 'direction.html' : 'dashboard.html?id=' + encodeURIComponent(d.id);
        return '<a class="db-card" href="' + href + '"><b>' + esc(d.title.fr || d.id) + '</b><span class="db-note">' + esc(d.description || '') +
          '</span><span class="db-badge">v' + esc(d.published_version) + (d.kind === 'system' ? ' · système' : '') + '</span></a>';
      }).join('');
      root.innerHTML = '<header class="db-head"><div><div class="db-eyebrow">Tableaux de bord</div><h1>Tableaux publiés</h1>' +
        '<p class="db-desc">Les tableaux que votre rôle permet d’ouvrir. Chaque chiffre vient du dictionnaire des indicateurs et porte la date de ses données.</p></div>' +
        (j.author ? '<div><a class="db-btn db-primary" href="dashboard-composer.html">Composer un tableau</a></div>' : '') + '</header>' +
        (cards ? '<div class="db-cards">' + cards + '</div>' : '<div class="db-state"><h1>Aucun tableau publié pour votre rôle</h1><p class="db-note">Les tableaux publiés pour vous apparaîtront ici.</p></div>');
    }).catch(function (e) { stateBox('Les tableaux n’ont pas pu se charger', e.message); });
  }

  document.documentElement.lang = lang;
  if (id) load(); else list();
})();
