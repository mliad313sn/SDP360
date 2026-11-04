/* Exact-text translation layer for pages written in English (committee review 2026-10-28, field P0-2).
 *   I18nText.install({ dict: { 'English text': 'texte français', … }, storageKey, toggle: { en: el, fr: el }, root })
 *   I18nText.t('English text') → the text in the current language
 *   I18nText.lang() → 'en' | 'fr'
 * Every text node (and placeholder / title / aria-label) whose trimmed value is a dictionary key is
 * swapped, including content rendered later (MutationObserver). Data never matches a key by accident in
 * practice because keys are UI phrases; values typed by users are rendered from the API, not from here.
 * Language: saved choice, else the UI-policy first-visit default (window.__uiPolicy.lang_default, A-09a —
 * report_config ui_lang_default, empty today), else the browser language (fr* → French). A language taken
 * from the policy default is applied but NOT saved, so flipping the default back takes effect on next load.
 * Text changed in place (React re-render → characterData) is translated too; a node whose value is already
 * a dictionary VALUE is left alone, which is what stops the observer from looping on its own writes.
 */
(function (root) {
  'use strict';
  let lang = 'en', dict = {}, rev = {}, key = 'ui_lang', obs = null, scope = null; const listeners = [];
  const ATTRS = ['placeholder', 'title', 'aria-label'];
  // G18 — one language preference for the whole application ('sdp_lang'); the page key is still written so an
  // older page keeps working. A choice made on one page is the choice on the next.
  const SHARED = 'sdp_lang';
  const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  // Keys are matched on the trimmed text with inner whitespace collapsed (markup wraps long sentences).
  const norm = (t) => t.replace(/\s+/g, ' ');
  function swap(v) { const tr = String(v).trim(); if (!tr) return null; const k = norm(tr); const m = lang === 'fr' ? dict : rev; const to = own(m, k) ? m[k] : null; return to == null || to === tr || to === k ? null : String(v).replace(tr, to); }
  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) { const n = swap(node.nodeValue); if (n != null) node.nodeValue = n; return; }
    if (node.nodeType !== 1 || node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'TEXTAREA') return;
    for (const a of ATTRS) if (node.hasAttribute && node.hasAttribute(a)) { const n = swap(node.getAttribute(a)); if (n != null) node.setAttribute(a, n); }
    if (node.tagName === 'INPUT' && (node.type === 'button' || node.type === 'submit')) { const n = swap(node.value); if (n != null) node.value = n; }
    for (const c of Array.from(node.childNodes)) walk(c);
  }
  // At install the page is authored in English: no reverse walk in English (it could turn a French fragment the
  // page already shows into its English key). A live toggle back to English (cockpit) still walks.
  function apply(initial) { document.documentElement.lang = lang; if (!(initial && lang === 'en')) walk(scope || document.body); listeners.forEach((f) => { try { f(lang); } catch (_) {} }); }
  function policyDefault() { try { const p = root.__uiPolicy; const d = p && p.lang_default; return d === 'fr' || d === 'en' ? d : null; } catch (_) { return null; } }
  function set(l, toggle, keep, initial) {
    lang = l === 'fr' ? 'fr' : 'en';
    if (keep !== false) { try { localStorage.setItem(key, lang); localStorage.setItem(SHARED, lang); } catch (_) {} }
    if (toggle) { if (toggle.en) toggle.en.setAttribute('aria-pressed', String(lang === 'en')); if (toggle.fr) toggle.fr.setAttribute('aria-pressed', String(lang === 'fr')); }
    apply(initial);
  }
  function install(o) {
    o = o || {}; dict = o.dict || {}; rev = {}; for (const k of Object.keys(dict)) rev[dict[k]] = k; key = o.storageKey || key; scope = o.root || document.body;
    let saved = null; try { saved = localStorage.getItem(SHARED) || localStorage.getItem(key); } catch (_) {}
    const pol = saved ? null : policyDefault();
    lang = saved || pol || (/^fr/i.test(navigator.language || '') ? 'fr' : 'en');
    if (o.toggle) { if (o.toggle.en) o.toggle.en.addEventListener('click', () => set('en', o.toggle)); if (o.toggle.fr) o.toggle.fr.addEventListener('click', () => set('fr', o.toggle)); }
    if (obs) obs.disconnect();
    obs = new MutationObserver((ms) => {
      if (lang === 'en') return;
      for (const m of ms) {
        if (m.type === 'characterData') { const t = m.target; if (t && !own(rev, norm(String(t.nodeValue).trim()))) walk(t); continue; }
        for (const n of (m.addedNodes || [])) walk(n);
      }
    });
    obs.observe(scope, { childList: true, subtree: true, characterData: true });
    set(lang, o.toggle, !pol, true);
  }
  function merge() { const out = {}; for (const d of arguments) if (d && typeof d === 'object') Object.assign(out, d); return out; }
  root.I18nText = { install, merge, t: (s) => (lang === 'fr' && dict[s] != null ? dict[s] : s), lang: () => lang, onChange: (f) => listeners.push(f) };
})(window);
