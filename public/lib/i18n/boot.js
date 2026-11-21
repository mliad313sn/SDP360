/* A-09a — guarded install of a page's French dictionary (one external script, so it also runs on pages
 * without a CSP nonce such as activity-tracker.html). Usage, at the END of <body>, after lib/i18nText.js,
 * lib/i18n/common.fr.js and the page dictionary:
 *   <script src="lib/i18n/boot.js" data-dict="I18N_FR_SITE_ACTIONS" data-root="optional-element-id"></script>
 * INERT unless the UI policy switches the page dictionaries on (report_config ui_i18n_pages = '1', delivered as
 * window.__uiPolicy.i18n_pages by public/auth.js). Off = the page stays exactly as authored (English).
 * When it installs, it marks <html data-i18n="on"> so the shell may mirror the language in <html lang>.
 */
(function (root) {
  'use strict';
  const me = root.document && root.document.currentScript;
  function install(dictName, rootId) {
    const pol = root.__uiPolicy;
    if (!(pol && pol.i18n_pages === '1')) return false;           // ui_i18n_pages switch (today: '0')
    const I = root.I18nText; if (!I) return false;
    const scope = (rootId && root.document.getElementById(rootId)) || root.document.body;
    I.install({ dict: I.merge(root.I18N_FR_COMMON, root.I18N_FR_LOOKUPS, root[dictName]), storageKey: 'ui_lang', root: scope });
    root.document.documentElement.dataset.i18n = 'on';
    loadShared();
    return true;
  }
  // I18N-QUALITY — the shared formatter (lib/format.js) and code labels (lib/codeLabels.js) follow the page into
  // French. Loaded only when the dictionaries install (an English page keeps its English formats), with the same
  // ?v= as this script so a deploy refreshes them; a re-walk once the labels arrive picks up raw codes on screen.
  function loadShared() {
    const d = root.document; if (!d || !d.createElement || !d.head) return;
    const v = (me && me.src && /[?&]v=([^&]+)/.exec(me.src) || [])[1];
    const add = (file, glob, done) => {
      if (root[glob]) { if (done) done(); return; }
      const s = d.createElement('script'); s.src = 'lib/' + file + (v ? '?v=' + v : ''); s.async = false;
      if (done) s.onload = done; d.head.appendChild(s);
    };
    add('format.js', 'SDPFormat');
    add('codeLabels.js', 'SDPLabels', () => { try { if (root.I18nText && root.I18nText.refresh) root.I18nText.refresh(); } catch (_) { /* best effort */ } });
  }
  root.I18nBoot = { install, loadShared };
  if (me && me.dataset && me.dataset.dict) {
    try { install(me.dataset.dict, me.dataset.root); } catch (e) { try { console.warn('[i18n] install failed:', e && e.message); } catch (_) {} }
  }
})(window);
