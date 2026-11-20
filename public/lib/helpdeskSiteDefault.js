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
  /** options = the dropdown values (strings, 'all' excluded), siteNames = the person's site names in order (primary
   *  first). → { option, spellings }. The first site that matches wins. P11 r5 F-16 — the page filters by an
   *  upper-case SUBSTRING of the selected value, so a site written several ways ('OUAGADOUGOU' and 'Ouaga') is only
   *  fully shown when the chosen spelling is contained in every other one ('Ouaga'). When no spelling covers them all
   *  ('HGO' and 'Hounde Mine'), option is null (All Sites stays) and `spellings` lists them so the page can say why. */
  function pickResult(options, siteNames, foldKey) {
    var opts = (Array.isArray(options) ? options : []).filter(function (o) { return o && o !== 'all'; });
    var names = Array.isArray(siteNames) ? siteNames : [];
    var up = function (v) { return String(v).toUpperCase(); };
    for (var i = 0; i < names.length; i++) {
      var k = fold(names[i], foldKey);
      if (!k) continue;
      var same = opts.filter(function (o) { return fold(o, foldKey) === k; });
      if (!same.length) continue;
      var cover = same.filter(function (c) { return same.every(function (o) { return up(o).indexOf(up(c)) >= 0; }); })
        .sort(function (a, b) { return a.length - b.length || (a < b ? -1 : 1); })[0];
      return { option: cover || null, spellings: cover ? [] : same.slice() };
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

  var api = { pickOption: pickOption, pickResult: pickResult, applies: applies };
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
          var T = root.I18nText && typeof root.I18nText.t === 'function' ? root.I18nText.t : function (x) { return x; };
          selectEl.title = T('Your site is written several ways in the tickets — showing All Sites. Pick a spelling to filter.') + ' (' + res.spellings.join(', ') + ')';
        }
        return;
      }
      selectEl.value = pick;
      if (typeof onApplied === 'function') onApplied();
    }).catch(function () { /* All Sites stays */ });
  };
  root.HelpdeskSiteDefault = api;
})(typeof self !== 'undefined' ? self : this);
