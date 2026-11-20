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
   *  first). → the option to select, or null. The first site that matches wins; within a site, the first option. */
  function pickOption(options, siteNames, foldKey) {
    var opts = (Array.isArray(options) ? options : []).filter(function (o) { return o && o !== 'all'; });
    var names = Array.isArray(siteNames) ? siteNames : [];
    for (var i = 0; i < names.length; i++) {
      var k = fold(names[i], foldKey);
      if (!k) continue;
      for (var j = 0; j < opts.length; j++) if (fold(opts[j], foldKey) === k) return opts[j];
    }
    return null;
  }
  /** Does the switch apply to this person? */
  function applies(policy, user, has) {
    var h = typeof has === 'function' ? has : function () { return false; };
    var u = user || {};
    var ids = Array.isArray(u.site_ids) && u.site_ids.length ? u.site_ids : (u.site_id != null ? [u.site_id] : []);
    return !!(policy && policy.helpdesk_site_default === '1') && !h('admin') && ids.length > 0;
  }

  var api = { pickOption: pickOption, applies: applies };
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
      var pick = pickOption(values, names, SA && typeof SA.siteFoldKey === 'function' ? SA.siteFoldKey : null);
      if (!pick || selectEl.value !== 'all') return;   // the person already chose something: never override it
      selectEl.value = pick;
      if (typeof onApplied === 'function') onApplied();
    }).catch(function () { /* All Sites stays */ });
  };
  root.HelpdeskSiteDefault = api;
})(typeof self !== 'undefined' ? self : this);
