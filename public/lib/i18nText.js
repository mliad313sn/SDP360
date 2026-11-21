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
 * I18N-QUALITY (2026-11-21) — two fixes for French that read as nonsense:
 *  - CONTEXT keys: 'Open@status' is used instead of 'Open' when the text sits in a status place (an <option>, an
 *    element whose class names a status / state / chip / pill / badge / rag, or data-i18n-ctx="status"), so a
 *    status reads « Ouvert » while a button keeps the verb « Ouvrir ». In a status place a bare code
 *    (on_track, HIGH…) with no dictionary entry is labelled through window.SDPLabels (lib/codeLabels.js).
 *  - SENTENCE keys: a block whose sentence is split by inline markup (<strong>, <em>, <b>, <i>) is matched on
 *    its WHOLE text first; the French value may carry the same inline tags (allow-list, built as DOM nodes,
 *    never innerHTML). Fragments translated one by one kept English word order (« le suivi du Suivis du rapport »).
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
  const CTX_SEP = '@';
  const STATUS_CLASS = /(^|[\s_-])(status|state|chip|pill|badge|rag)([\s_-]|$)/i;
  const CODE_RE = /^([a-z][a-z0-9]*(_[a-z0-9]+)+|[a-z]+|[A-Z]{2,})$/;
  // The context of the text: 'status' when it sits in a status place (up to 3 ancestors), else ''.
  function ctxOf(el) {
    for (let i = 0; el && el.nodeType === 1 && i < 3; i++, el = el.parentNode) {
      const c = el.getAttribute && el.getAttribute('data-i18n-ctx'); if (c) return String(c);
      if (el.tagName === 'OPTION') return 'status';
      const cl = typeof el.className === 'string' ? el.className : '';
      if (cl && STATUS_CLASS.test(cl)) return 'status';
    }
    return '';
  }
  function lookup(k, ctx) {
    if (lang === 'fr') {
      if (ctx && own(dict, k + CTX_SEP + ctx)) return dict[k + CTX_SEP + ctx];
      if (own(dict, k)) return dict[k];
      if (ctx === 'status' && CODE_RE.test(k) && root.SDPLabels && root.SDPLabels.label) { const l = root.SDPLabels.label('status', k, 'fr'); if (l && l !== k) return l; }
      return null;
    }
    return own(rev, k) ? rev[k] : null;
  }
  function swap(v, ctx) { const tr = String(v).trim(); if (!tr) return null; const k = norm(tr); const to = lookup(k, ctx); return to == null || to === tr || to === k ? null : String(v).replace(tr, to); }
  // Sentence blocks: an element whose children are text + inline elements holding text only.
  const INLINE = { STRONG: 1, EM: 1, B: 1, I: 1, BR: 1 };
  const TAGS = /<(strong|em|b|i)>([\s\S]*?)<\/\1>|<br\s*\/?>/g;
  const strip = (t) => String(t).replace(/<\/?(strong|em|b|i)>|<br\s*\/?>/g, '');
  function isBlock(node) {
    const kids = node.childNodes || []; let inl = 0, txt = 0;
    for (const c of kids) {
      if (c.nodeType === 3) { if (String(c.nodeValue).trim()) txt++; continue; }
      if (c.nodeType !== 1 || !INLINE[c.tagName]) return false;
      for (const g of (c.childNodes || [])) if (g.nodeType !== 3) return false;
      inl++;
    }
    return inl > 0 && inl + txt > 1;
  }
  function rebuild(node, value) {
    const doc = node.ownerDocument || root.document; if (!doc || !doc.createTextNode) return false;
    const olds = Array.from(node.childNodes).filter((c) => c.nodeType === 1);
    if (!node.__i18nEn) node.__i18nEn = Array.from(node.childNodes).map((c) => c.cloneNode(true));
    const out = []; let last = 0, m, i = 0; TAGS.lastIndex = 0;
    while ((m = TAGS.exec(value))) {
      if (m.index > last) out.push(doc.createTextNode(value.slice(last, m.index)));
      last = m.index + m[0].length;
      if (!m[1]) { out.push(doc.createElement('br')); continue; }
      while (olds[i] && olds[i].tagName === 'BR') i++;
      const tag = m[1].toUpperCase(), old = olds[i++];
      const e = old && old.tagName === tag ? old.cloneNode(false) : doc.createElement(m[1]);
      e.appendChild(doc.createTextNode(m[2])); out.push(e);
    }
    if (last < value.length) out.push(doc.createTextNode(value.slice(last)));
    while (node.firstChild) node.removeChild(node.firstChild);
    out.forEach((c) => node.appendChild(c));
    return true;
  }
  function block(node) {
    if (typeof node.textContent !== 'string' || !isBlock(node)) return false;
    const k = norm(node.textContent.trim()); if (!k) return false;
    if (lang === 'fr') { if (!own(dict, k)) return false; return rebuild(node, String(dict[k])); }
    if (!own(rev, k) || !node.__i18nEn) return false;
    while (node.firstChild) node.removeChild(node.firstChild);
    node.__i18nEn.forEach((c) => node.appendChild(c.cloneNode(true)));
    return true;
  }
  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) { const n = swap(node.nodeValue, ctxOf(node.parentNode)); if (n != null) node.nodeValue = n; return; }
    if (node.nodeType !== 1 || node.tagName === 'SCRIPT' || node.tagName === 'STYLE' || node.tagName === 'TEXTAREA') return;
    const ctx = ctxOf(node);
    for (const a of ATTRS) if (node.hasAttribute && node.hasAttribute(a)) { const n = swap(node.getAttribute(a), ctx); if (n != null) node.setAttribute(a, n); }
    if (node.tagName === 'INPUT' && (node.type === 'button' || node.type === 'submit')) { const n = swap(node.value, ctx); if (n != null) node.value = n; }
    if (block(node)) return;
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
    o = o || {}; dict = o.dict || {}; rev = {}; for (const k of Object.keys(dict)) { const v = strip(dict[k]); const base = k.split(CTX_SEP)[0]; if (!own(rev, v) || base === k) rev[v] = base; } key = o.storageKey || key; scope = o.root || document.body;
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
  root.I18nText = { install, merge, refresh: () => { if (lang === 'fr') walk(scope || document.body); }, t: (s, ctx) => (lang === 'fr' ? (ctx && dict[s + CTX_SEP + ctx] != null ? strip(dict[s + CTX_SEP + ctx]) : dict[s] != null ? strip(dict[s]) : s) : s), lang: () => lang, onChange: (f) => listeners.push(f) };
})(window);
