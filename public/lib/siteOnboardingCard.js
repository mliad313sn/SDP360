// D-02 (AMDEC 2026-11-05, AM-02/AM-03) — read-only onboarding checklist on Admin ▸ Sites. Reads
// GET /api/governance/site-codes (onboarding + fill_plan). Writes nothing: a proposed registry row is applied by
// a super_admin through the existing PUT /api/governance/site-codes/:site (Governance policies ▸ site codes).
(function () {
  'use strict';
  function h(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function render(body, j) {
    var rows = (j.onboarding || []).map(function (r) {
      var c = r.codes || {};
      return '<tr><td><strong>' + h(r.site) + '</strong></td><td>' + h(c.tracker || '—') + ' / ' + h(c.inspection || '—') + ' / ' + h(c.meetings || '—')
        + '</td><td>' + h(r.country || '—') + ' · ' + h(r.business_unit || '—') + '</td><td>' + h(r.currency || '—') + '</td><td>' + h(r.zoho_group || '—')
        + '</td><td>' + (r.coordinator ? h(r.coordinator.name || '') + (r.coordinator.confirmed ? ' ✓' : ' (unconfirmed)') : '—')
        + '</td><td>' + (r.ready ? '<span class="status-active">ready</span>' : '<span style="color:#b45309">' + h(r.missing.join(' · ')) + '</span>') + '</td></tr>';
    }).join('');
    var p = j.fill_plan || { proposed: [], skipped: [] };
    var plan = p.proposed.map(function (x) { return '<li>' + h(x.site) + ' — ' + h(x.module) + ' ' + h(x.code) + '</li>'; }).join('')
      + p.skipped.filter(function (x) { return x.reason !== 'no_hard_code'; }).map(function (x) { return '<li style="color:#991b1b">' + h(x.site) + ' — ' + h(x.module) + ' ' + h(x.code) + ' not proposed (' + h(x.reason.replace('_', ' ')) + ')</li>'; }).join('');
    body.innerHTML = '<p style="font-size:0.82rem;color:#6b7a99;margin:6px 0">Codes = registry, else the hard-coded map (tracker / inspection / meetings). Registry switch: <strong>'
      + (j.enabled ? 'on' : 'off') + '</strong> (a committee decision).</p>'
      + '<table class="user-table"><thead><tr><th>Site</th><th>Codes T / I / M</th><th>Country · business unit</th><th>Currency</th><th>Zoho group</th><th>Coordinator</th><th>Missing</th></tr></thead><tbody>' + rows + '</tbody></table>'
      + '<h4 style="margin:12px 0 4px">Fill the registry from the hard-coded maps — dry run (nothing written)</h4>'
      + (plan ? '<ul style="font-size:0.85rem">' + plan + '</ul>' : '<p style="font-size:0.85rem">Nothing to fill.</p>')
      + '<p style="font-size:0.78rem;color:#6b7a99">Each proposed row is applied by a super_admin, with a reason, through the site-code registry (one row at a time). A shared code is never proposed: the data owner decides which site keeps it.</p>';
  }
  function load(body) {
    body.textContent = 'Loading…';
    fetch('/api/governance/site-codes', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : Promise.reject(new Error('HTTP ' + r.status)); })
      .then(function (j) { render(body, j); }).catch(function (e) { body.textContent = 'Checklist unavailable (' + e.message + ').'; });
  }
  function init() {
    var d = document.getElementById('site-onboarding'); var body = document.getElementById('site-onboarding-body');
    if (!d || !body) return;
    d.addEventListener('toggle', function () { if (d.open) load(body); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
