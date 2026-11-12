/* F-UX-06 — one `page_viewed` usage fact for a page that has no shared shell mount (it-review, site-report):
 *   <script src="lib/pageView.js" data-page="it-review"></script>
 * Same server rules as the shell's report (one row per user × page × day, user id + role tier only). Silent on
 * any failure: telemetry never breaks a page. */
(function () {
  'use strict';
  var me = document.currentScript;
  var page = me && me.getAttribute('data-page');
  if (!page || typeof fetch !== 'function') return;
  try {
    fetch('/api/ux/page-view', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ page: page }) }).catch(function () { /* silent */ });
  } catch (_) { /* silent */ }
})();
