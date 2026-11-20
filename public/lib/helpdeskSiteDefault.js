/* Adoption Lot B (item 22) — the Helpdesk dashboard opens on the person's own site, behind report_config
 * ui_helpdesk_site_default (default '0' = today: All Sites).
 *
 * Who: a site-scoped person (NOT the admin tier — admin / executive / super_admin read the fleet), with at least one
 * site. What: the site filter (#fSite) is preset ONCE, at the first fill of the dropdown, to the ticket-data spelling
 * of the person's primary site — matched through the shared site-alias fold (public/lib/siteAliases.js, the same
 * fold the Helpdesk ranking uses). No match → nothing changes (All Sites); the person can pick All Sites again.
 * Presentation only: the ticket rows are the ones the page already has; no read scope changes.
 * UMD: window.HelpdeskSiteDefault in the browser, module.exports in Node. */
(function (root) {
  'use strict';
  function fold(label, foldKey) {
    var f = typeof foldKey === 'function' ? foldKey : null;
    var raw = String(label == null ? '' : label);
    return f ? f(raw) : raw.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function tokens(label) {
    return String(label == null ? '' : label).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean);
  }
  /** P11 r6 F-21 — does a ticket's Site value belong to the selected site? Same site through the shared alias
   *  fold ('Ouaga' = 'OUAGADOUGOU', 'HGO' = 'Hounde Mine'), else the selected spelling appears as WHOLE words in
   *  the ticket value ('London' in 'London HQ'). Never a raw substring: 'MANA' is not 'MANAGEMENT', 'ITY' is not
   *  'CITY OFFICE'. 'all' (or empty) matches everything. */
  function siteMatches(rowSite, selected, foldKey) {
    if (selected == null || selected === '' || selected === 'all') return true;
    var f = typeof foldKey === 'function' ? foldKey : null;
    if (f && f(String(rowSite == null ? '' : rowSite)) === f(String(selected))) return true;
    var sel = tokens(selected), row = tokens(rowSite);
    if (!sel.length || sel.length > row.length) return false;
    for (var i = 0; i + sel.length <= row.length; i++) {
      var ok = true;
      for (var j = 0; j < sel.length; j++) if (row[i + j] !== sel[j]) { ok = false; break; }
      if (ok) return true;
    }
    return false;
  }
  /** A memoised siteMatches for one selection (the Helpdesk page filters tens of thousands of rows). */
  function matcher(selected, foldKey) {
    if (selected == null || selected === '' || selected === 'all') return function () { return true; };
    var cache = new Map();
    return function (rowSite) {
      var k = String(rowSite == null ? '' : rowSite);
      var v = cache.get(k);
      if (v === undefined) { v = siteMatches(k, selected, foldKey); cache.set(k, v); }
      return v;
    };
  }
  /** options = the dropdown values (strings, 'all' excluded), siteNames = the person's site names in order (primary
   *  first). → { option, spellings }. The first site that matches wins. The page filters with siteMatches (P11 r6
   *  F-21), so the chosen spelling must match every other same-site spelling ('OUAGADOUGOU' and 'Ouaga'). `spellings`
   *  lists them whenever there is more than one, so the page can say (visibly) which spellings the filter covers.
   *  When no spelling covers them all (only without the alias fold), option is null and All Sites stays. */
  function pickResult(options, siteNames, foldKey) {
    var opts = (Array.isArray(options) ? options : []).filter(function (o) { return o && o !== 'all'; });
    var names = Array.isArray(siteNames) ? siteNames : [];
    for (var i = 0; i < names.length; i++) {
      var k = fold(names[i], foldKey);
      if (!k) continue;
      var same = opts.filter(function (o) { return fold(o, foldKey) === k; });
      if (!same.length) continue;
      var cover = same.filter(function (c) { return same.every(function (o) { return siteMatches(o, c, foldKey); }); })
        .sort(function (a, b) { return a.length - b.length || (a < b ? -1 : 1); })[0];
      return { option: cover || null, spellings: same.length > 1 ? same.slice() : [] };
    }
    return { option: null, spellings: [] };
  }
  /** The option to select, or null (see pickResult). */
  function pickOption(options, siteNames, foldKey) { return pickResult(options, siteNames, foldKey).option; }
  /** Does the switch apply to this person? */
  function applies(policy, user, has) {
    var h = typeof has === 'function' ? has : function () { return false; };
    var u = user || {};
    var ids = Array.isArray(u.site_ids) && u.site_ids.length ? u.site_ids : (u.site_id != null ? [u.site_id] : []);
    return !!(policy && policy.helpdesk_site_default === '1') && !h('admin') && ids.length > 0;
  }

  // P11 r6 F-21 — the explanation is visible text next to the selector (a tooltip is invisible on touch and to most
  // keyboard / screen-reader users): a polite live region the selector points to with aria-describedby.
  var NOTE_ALL = 'Your site is written several ways in the tickets — showing All Sites. Pick a spelling to filter.';
  var NOTE_PICKED = 'Showing your site. Every way it is written in the tickets is included:';
  function showNote(selectEl, message, spellings) {
    var doc = selectEl.ownerDocument || root.document;
    if (!doc) return null;
    var note = doc.getElementById('fSiteNote');
    if (!note) {
      note = doc.createElement('span');
      note.id = 'fSiteNote';
      note.className = 'flt-note';
      note.setAttribute('role', 'status');
      note.setAttribute('aria-live', 'polite');
      note.style.fontSize = '12px'; note.style.marginLeft = '6px'; note.style.color = 'var(--color-text-muted)';
      selectEl.insertAdjacentElement('afterend', note);
    }
    var T = root.I18nText && typeof root.I18nText.t === 'function' ? root.I18nText.t : function (x) { return x; };
    note.textContent = '';
    var msg = doc.createElement('span'); msg.textContent = T(message);
    var list = doc.createElement('span'); list.textContent = ' ' + spellings.join(', ');
    note.appendChild(msg); note.appendChild(list);
    selectEl.setAttribute('aria-describedby', 'fSiteNote');
    return note;
  }
  function clearNote(selectEl) {
    var doc = selectEl.ownerDocument || root.document;
    var note = doc && doc.getElementById('fSiteNote');
    if (note && note.parentNode) note.parentNode.removeChild(note);
    selectEl.removeAttribute('aria-describedby');
  }

  var api = { pickOption: pickOption, pickResult: pickResult, applies: applies, siteMatches: siteMatches, matcher: matcher,
    showNote: showNote, clearNote: clearNote, NOTE_ALL: NOTE_ALL, NOTE_PICKED: NOTE_PICKED };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }

  var done = false;
  /** Browser: called by index.html after each dropdown fill; acts once. onApplied() re-runs the page filters. */
  api.apply = function (selectEl, onApplied) {
    if (done || !selectEl) return;
    var u = root.__authUser || {};
    if (!applies(root.__uiPolicy, u, root.__userHasRole)) { done = true; return; }
    var values = Array.prototype.map.call(selectEl.options || [], function (o) { return o.value; });
    if (values.length <= 1) return;   // the ticket rows are not there yet — wait for the next fill
    done = true;
    var h = { 'Accept': 'application/json' };
    try { if (root.__authToken) h['x-report-token'] = root.__authToken; } catch (_) {}
    fetch('/api/reports/sites', { headers: h, credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; }).then(function (sites) {
      if (!Array.isArray(sites)) return;
      var ids = (Array.isArray(u.site_ids) && u.site_ids.length ? u.site_ids : [u.site_id]).map(Number);
      var names = ids.map(function (id) { var s = sites.find(function (x) { return Number(x.id) === id; }); return s ? s.name : null; }).filter(Boolean);
      var SA = root.SiteAliases;
      var res = pickResult(values, names, SA && typeof SA.siteFoldKey === 'function' ? SA.siteFoldKey : null);
      var pick = res.option;
      if (selectEl.value !== 'all') return;   // the person already chose something: never override it
      if (!pick) {
        // F-16: several spellings, none covering the others — All Sites stays, and the page says why
        if (res.spellings.length > 1) {
          showNote(selectEl, NOTE_ALL, res.spellings);
          selectEl.addEventListener('change', function () { clearNote(selectEl); }, { once: true });
        }
        return;
      }
      selectEl.value = pick;
      if (res.spellings.length > 1) {
        showNote(selectEl, NOTE_PICKED, res.spellings);
        selectEl.addEventListener('change', function () { clearNote(selectEl); }, { once: true });
      }
      if (typeof onApplied === 'function') onApplied();
    }).catch(function () { /* All Sites stays */ });
  };
  root.HelpdeskSiteDefault = api;
})(typeof self !== 'undefined' ? self : this);
