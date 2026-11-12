/* R1-PROFILES (REBUILD-SPEC R2) — workspace-settings.html. Reads /api/workspace/me, lets the person choose a
 * profile among those their roles allow, reorder / hide destinations, pick a density and a default site,
 * saves to /api/workspace/prefs and re-reads. Rendering uses textContent only (no innerHTML of server text).
 * Presentation only: the server re-checks everything and nothing here changes a right. */
(function () {
  'use strict';
  var lang = 'en';
  try { lang = (window.__shell && window.__shell.shellLang && window.__shell.shellLang()) || 'en'; } catch (_) { lang = 'en'; }
  if (lang === 'fr') { document.documentElement.lang = 'fr'; document.body.classList.add('lang-fr'); }
  var L = {
    en: { title: 'Workspace settings', intro: 'These choices change what you see first. They never change what you are allowed to open: every page keeps its own access rules.',
      loading: 'Loading…', ready: 'Profile in use: ', fallback: ' (your saved profile is no longer allowed for your roles — the default is used)',
      profile: 'Profile', profileHelp: 'Only the profiles your roles allow are offered.', cards: 'Destinations',
      cardsHelp: 'Move a destination up or down, or hide it. Hidden destinations stay reachable from the menu.',
      up: 'Up', down: 'Down', hide: 'Hide', show: 'Show', hiddenTag: ' (hidden)', density: 'Density', comfortable: 'Comfortable', compact: 'Compact',
      site: 'Default site', siteHelp: 'Only your own sites are listed.', noSite: 'No default site', save: 'Save',
      reset: 'Back to my role defaults', home: 'Return to Home', saved: 'Saved and re-read from the server.', resetDone: 'Back to your role defaults.',
      off: 'Workspace settings are not switched on.', err: 'Could not load or save: ' },
    fr: { title: 'Paramètres de l’espace de travail', intro: 'Ces choix changent ce que vous voyez en premier. Ils ne changent jamais ce que vous avez le droit d’ouvrir : chaque page garde ses propres règles d’accès.',
      loading: 'Chargement…', ready: 'Profil utilisé : ', fallback: ' (le profil enregistré n’est plus autorisé pour vos rôles — le profil par défaut est utilisé)',
      profile: 'Profil', profileHelp: 'Seuls les profils autorisés par vos rôles sont proposés.', cards: 'Destinations',
      cardsHelp: 'Déplacez une destination vers le haut ou le bas, ou masquez-la. Une destination masquée reste accessible depuis le menu.',
      up: 'Monter', down: 'Descendre', hide: 'Masquer', show: 'Afficher', hiddenTag: ' (masquée)', density: 'Densité', comfortable: 'Confortable', compact: 'Compacte',
      site: 'Site par défaut', siteHelp: 'Seuls vos propres sites sont listés.', noSite: 'Aucun site par défaut', save: 'Enregistrer',
      reset: 'Revenir aux valeurs de mon rôle', home: 'Retour à l’accueil', saved: 'Enregistré et relu depuis le serveur.', resetDone: 'Retour aux valeurs de votre rôle.',
      off: 'Les paramètres de l’espace de travail ne sont pas activés.', err: 'Chargement ou enregistrement impossible : ' },
  }[lang === 'fr' ? 'fr' : 'en'];
  var $ = function (id) { return document.getElementById(id); };
  var text = function (id, v) { var e = $(id); if (e) e.textContent = v; };
  [['wsTitle', L.title], ['wsIntro', L.intro], ['wsProfileLegend', L.profile], ['wsProfileHelp', L.profileHelp], ['wsCardsTitle', L.cards],
   ['wsCardsHelp', L.cardsHelp], ['wsDensityLegend', L.density], ['wsDensComfortable', L.comfortable], ['wsDensCompact', L.compact],
   ['wsSiteLegend', L.site], ['wsSiteHelp', L.siteHelp], ['wsSave', L.save], ['wsReset', L.reset], ['wsHome', L.home]].forEach(function (p) { text(p[0], p[1]); });
  document.title = L.title + ' — Endeavour Mining IT';

  var state = { order: [], hidden: [] , labels: {} };
  var status = function (m) { text('wsStatus', m); };

  function renderCards() {
    var ul = $('wsCards'); ul.textContent = '';
    state.order.forEach(function (id, i) {
      var li = document.createElement('li');
      var name = document.createElement('span'); name.className = 'ws-name';
      var hid = state.hidden.indexOf(id) !== -1;
      name.textContent = (state.labels[id] || id) + (hid ? L.hiddenTag : '');
      li.appendChild(name);
      function btn(label, fn, disabled) {
        var b = document.createElement('button'); b.type = 'button'; b.textContent = label;
        b.setAttribute('aria-label', label + ' — ' + (state.labels[id] || id)); b.disabled = !!disabled;
        b.addEventListener('click', fn); li.appendChild(b);
      }
      btn(L.up, function () { var o = state.order; o.splice(i - 1, 0, o.splice(i, 1)[0]); renderCards(); }, i === 0);
      btn(L.down, function () { var o = state.order; o.splice(i + 1, 0, o.splice(i, 1)[0]); renderCards(); }, i === state.order.length - 1);
      btn(hid ? L.show : L.hide, function () {
        if (hid) state.hidden = state.hidden.filter(function (x) { return x !== id; }); else state.hidden.push(id);
        renderCards();
      });
      ul.appendChild(li);
    });
  }

  function fill(me) {
    var sel = $('wsProfile'); sel.textContent = '';
    me.eligible.forEach(function (id) {
      var o = document.createElement('option'); o.value = id; o.textContent = (me.profile_labels && me.profile_labels[id]) || id;
      if (id === me.profile) o.selected = true; sel.appendChild(o);
    });
    state.labels = {}; (me.destinations || []).forEach(function (d) { state.labels[d.id] = d.label; });
    state.order = (me.destinations || []).map(function (d) { return d.id; });
    state.hidden = (me.destinations || []).filter(function (d) { return d.hidden; }).map(function (d) { return d.id; });
    renderCards();
    Array.prototype.forEach.call(document.querySelectorAll('input[name="density"]'), function (r) { r.checked = r.value === me.density; });
    var site = $('wsSite'); site.textContent = '';
    var none = document.createElement('option'); none.value = ''; none.textContent = L.noSite; site.appendChild(none);
    (me.sites || []).forEach(function (s) {
      var o = document.createElement('option'); o.value = String(s.id); o.textContent = s.name;
      if (me.default_site_id === s.id) o.selected = true; site.appendChild(o);
    });
    status(L.ready + ((me.profile_labels && me.profile_labels[me.profile]) || me.profile) + (me.reason === 'not_allowed_fallback' ? L.fallback : ''));
    $('wsForm').hidden = false;
  }

  function api(method, url, body) {
    return fetch(url, { method: method, credentials: 'same-origin', headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' }, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; } return j; }); });
  }
  function load(after) {
    return api('GET', '/api/workspace/me?lang=' + (lang === 'fr' ? 'fr' : 'en')).then(function (me) { fill(me); if (after) status(after); })
      .catch(function (e) { status(e.status === 404 ? L.off : L.err + e.message); });
  }

  $('wsForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    // a profile change starts from that profile's own order (the stored order belongs to the previous one)
    var chosen = $('wsProfile').value;
    var d = document.querySelector('input[name="density"]:checked');
    var body = { profile: chosen, card_order: state.order, cards_hidden: state.hidden, density: d ? d.value : null, default_site_id: $('wsSite').value || null };
    api('PUT', '/api/workspace/prefs', body).then(function () { return load(L.saved); }).catch(function (e) { status(L.err + e.message); });
  });
  $('wsProfile').addEventListener('change', function () {
    var W = window.WorkspaceProfiles;
    var p = W && W.PROFILES.find(function (x) { return x.id === $('wsProfile').value; });
    if (!p) return;
    // preview the new profile's own order, filtered by the same role rule the server applies on save and read
    var u = window.__authUser || {};
    var ctx = { roles: Array.isArray(u.roles) ? u.roles : [], has: window.__userHasRole || function () { return false; } };
    state.order = p.destinations.filter(function (id) { return W.mayOpen(id, ctx); });
    state.order.forEach(function (id) { if (!state.labels[id]) state.labels[id] = W.DESTINATIONS[id][lang === 'fr' ? 'fr' : 'en']; });
    state.hidden = [];
    renderCards();
  });
  $('wsReset').addEventListener('click', function () {
    api('DELETE', '/api/workspace/prefs').then(function () { return load(L.resetDone); }).catch(function (e) { status(L.err + e.message); });
  });
  status(L.loading);
  load();
})();
