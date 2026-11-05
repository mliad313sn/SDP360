// D-01 (AMDEC 2026-11-05, AM-01) — page banner: when report_config site_code_shared_block is on and the
// account's code for this module is used by two active sites, say so before the user types anything (the
// save is refused with the same reason). Silent when the switch is off, for the admin tier, or on any error.
(function () {
  'use strict';
  var me = document.currentScript; var mod = me && me.getAttribute('data-module');
  function show(list) {
    var s = list[0]; var el = document.createElement('div');
    el.className = 'site-code-banner'; el.setAttribute('role', 'alert');
    el.style.cssText = 'margin:8px 16px;padding:10px 14px;border:1px solid #dc2626;border-left-width:4px;background:#fef2f2;color:#7f1d1d;border-radius:6px;font-size:14px';
    el.textContent = 'Saving is blocked: your ' + mod + ' code ' + s.code + ' is used by two active sites (' + s.sites.join(', ')
      + '). A super_admin must give the code to one site (Admin ▸ Sites ▸ onboarding checklist).';
    var anchor = document.getElementById('__shell');
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(el, anchor.nextSibling); else document.body.insertBefore(el, document.body.firstChild);
  }
  function run() {
    if (!mod || typeof fetch !== 'function') return;
    fetch('/api/governance/site-codes/mine', { credentials: 'same-origin' }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j && j.block && j.shared && (j.shared[mod] || []).length) show(j.shared[mod]); }).catch(function () {});
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
