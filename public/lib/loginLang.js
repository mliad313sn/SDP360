/* loginLang.js — UX committee a11y-fr F11: the sign-in page in English or French. Default = the shared preference
 * (localStorage sdp_lang), else the browser language. A click writes sdp_lang (the same preference the shell uses).
 * Elements carry data-en / data-fr (text) and data-en-ph / data-fr-ph (placeholder). No inline script. */
(function () {
  'use strict';
  function pick() {
    try { const s = localStorage.getItem('sdp_lang'); if (s === 'fr' || s === 'en') return s; } catch (_) { /* blocked */ }
    try { return /^fr/i.test(navigator.language || '') ? 'fr' : 'en'; } catch (_) { return 'en'; }
  }
  function apply(lang) {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-en]').forEach((el) => { const v = el.getAttribute('data-' + lang); if (v != null) el.textContent = v; });
    document.querySelectorAll('[data-en-ph]').forEach((el) => { const v = el.getAttribute('data-' + lang + '-ph'); if (v != null) el.setAttribute('placeholder', v); });
    document.querySelectorAll('.login-lang [data-lang]').forEach((b) => b.setAttribute('aria-pressed', b.getAttribute('data-lang') === lang ? 'true' : 'false'));
  }
  function boot() {
    apply(pick());
    document.querySelectorAll('.login-lang [data-lang]').forEach((b) => b.addEventListener('click', () => {
      const lang = b.getAttribute('data-lang') === 'fr' ? 'fr' : 'en';
      try { localStorage.setItem('sdp_lang', lang); } catch (_) { /* blocked: this visit only */ }
      apply(lang);
    }));
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
