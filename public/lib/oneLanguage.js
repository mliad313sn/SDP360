/* One language at a time on a page written with doubled labels ("Cancel · Annuler", "Area / Zone",
 * <span class="fr">/ Référence</span>) — VISUAL POLISH 2, field seat F16.
 * The page markup is NOT rewritten: this pass shows the half that matches the interface language (the shell's
 * shared preference 'sdp_lang', else <html lang>), and keeps the original text so nothing is lost.
 * DATA RULE: an <option> without a value attribute uses its TEXT as the stored value — its original text is
 * pinned as `value` before the label changes, so what is saved and reloaded is byte-identical to before.
 * <datalist> options are never touched (their value is what the user types and stores).
 * Scope: only inside the root given to OneLanguage.install(root) (default document.body), only on the element
 * kinds listed in LEAF / ATTR_SEL. A text such as "0 / 0" (no letters on a side) is never split. */
(function (root) {
  'use strict';
  var LEAF = 'select option, button, .label, #installHint, label, .fw-title';
  var ATTRS = ['title', 'placeholder', 'data-sheet-title', 'aria-label'];
  var KEEP = { 'Mine Operations Centre / Dispatch': 1 };   // not a translation pair
  function lang() {
    try { var s = root.localStorage && root.localStorage.getItem('sdp_lang'); if (s === 'fr' || s === 'en') return s; } catch (_) { /* private mode */ }
    try { return /^fr/i.test(root.document.documentElement.lang || '') ? 'fr' : 'en'; } catch (_) { return 'en'; }
  }
  var hasWord = function (t) { return /[A-Za-zÀ-ÿ]{2}/.test(t); };
  // "EN · FR" / "EN / FR" → [en, fr]; four parts "A / B / C / D" → ["A / B", "C / D"]; anything else → null
  function split(text) {
    var t = String(text == null ? '' : text), trimmed = t.trim();
    if (!trimmed || KEEP[trimmed]) return null;
    var m = /^([^A-Za-zÀ-ÿ0-9—]+\s)([\s\S]*)$/.exec(trimmed);   // a leading symbol ("✓ ", "🔍 ") stays on both halves
    var lead = m ? m[1] : '', body = m ? m[2] : trimmed;
    var dashes = /^—\s([\s\S]*)\s—$/.exec(body), wrap = dashes ? ['— ', ' —'] : ['', ''];
    if (dashes) body = dashes[1];
    var sep = body.indexOf(' · ') >= 0 ? ' · ' : ' / ';
    var parts = body.split(sep);
    var pair = parts.length === 2 ? parts : (parts.length === 4 ? [parts[0] + sep + parts[1], parts[2] + sep + parts[3]] : null);
    if (!pair || !hasWord(pair[0]) || !hasWord(pair[1])) return null;
    return [lead + wrap[0] + pair[0].trim() + wrap[1], lead + wrap[0] + pair[1].trim() + wrap[1]];
  }
  function pick(text, l) { var p = split(text); return p ? p[l === 'fr' ? 1 : 0] : null; }
  function leaf(el, l) {
    if (el.tagName === 'OPTION' && el.parentNode && el.parentNode.tagName === 'DATALIST') return;
    // only the element's own single text node (a label keeps its <span class="req">* etc.)
    var nodes = [].filter.call(el.childNodes, function (n) { return n.nodeType === 3 && n.nodeValue.trim(); });
    if (nodes.length !== 1) return;
    var n = nodes[0], cur = n.nodeValue, orig = n.__olOrig;
    if (orig != null && n.__olSet === cur) cur = orig;            // already ours: re-pick from the original
    var to = pick(cur, l); if (to == null) return;
    if (el.tagName === 'OPTION' && !el.hasAttribute('value')) el.setAttribute('value', cur.trim());
    var out = cur.replace(cur.trim(), to);
    n.__olOrig = cur; n.__olSet = out;
    if (n.nodeValue !== out) n.nodeValue = out;
  }
  function attrs(el, l) {
    ATTRS.forEach(function (a) {
      if (!el.hasAttribute || !el.hasAttribute(a)) return;
      var key = '__ol_' + a, cur = el.getAttribute(a);
      if (el[key] && el[key].set === cur) cur = el[key].orig;
      var to = pick(cur, l); if (to == null) return;
      el[key] = { orig: cur, set: to }; if (el.getAttribute(a) !== to) el.setAttribute(a, to);
    });
  }
  // <label>English <span class="fr">/ Français</span></label> and "Title · <em>Titre</em>": mark both halves, CSS hides one
  function halves(scope) {
    [].forEach.call(scope.querySelectorAll('span.fr, .section-title > em'), function (fr) {
      if (fr.__olDone) return; fr.__olDone = true;
      fr.classList.add('ol-fr');
      var t = fr.firstChild; if (t && t.nodeType === 3) t.nodeValue = t.nodeValue.replace(/^\s*[\/·]\s*/, '');
      var p = fr.parentNode, doc = fr.ownerDocument;
      [].slice.call(p.childNodes).forEach(function (n) {
        if (n.nodeType !== 3 || !n.nodeValue.trim()) return;
        var s = doc.createElement('span'); s.className = 'ol-en'; s.textContent = n.nodeValue.replace(/\s*·\s*$/, ' ');
        p.replaceChild(s, n);
      });
    });
    // two-line tiles "Camera<br>Appareil"
    [].forEach.call(scope.querySelectorAll('.text'), function (el) {
      if (el.__olDone || el.childNodes.length !== 3 || el.childNodes[1].tagName !== 'BR') return; el.__olDone = true;
      var doc = el.ownerDocument, en = doc.createElement('span'), fr = doc.createElement('span');
      en.className = 'ol-en'; fr.className = 'ol-fr'; en.textContent = el.childNodes[0].nodeValue; fr.textContent = el.childNodes[2].nodeValue;
      el.textContent = ''; el.appendChild(en); el.appendChild(fr);
    });
  }
  function apply(scope) {
    var l = lang(), doc = root.document; scope = scope || doc.body; if (!scope || !scope.querySelectorAll) return;
    doc.documentElement.classList.toggle('ol-lang-fr', l === 'fr'); doc.documentElement.classList.toggle('ol-lang-en', l !== 'fr');
    halves(scope);
    [].forEach.call(scope.querySelectorAll(LEAF), function (el) { leaf(el, l); });
    [].forEach.call(scope.querySelectorAll('[title],[placeholder],[data-sheet-title],[aria-label]'), function (el) { attrs(el, l); });
  }
  function install(scope) {
    var doc = root.document; scope = scope || doc.body;
    try {
      var st = doc.createElement('style');
      var nonceEl = doc.querySelector('style[nonce],script[nonce]'); if (nonceEl && nonceEl.nonce) st.nonce = nonceEl.nonce;
      // the French half takes the look of the label it replaces (it was styled as a lighter aside)
      st.textContent = '.ol-lang-fr .ol-en,.ol-lang-en .ol-fr{display:none !important}' +
        '.ol-lang-fr .ol-fr{font:inherit !important;color:inherit !important;text-transform:inherit !important;letter-spacing:inherit !important;font-style:normal !important}';
      doc.head.appendChild(st);
    } catch (_) { /* no DOM */ }
    apply(scope);
    var pending = false;
    try {
      new root.MutationObserver(function () { if (pending) return; pending = true; root.setTimeout(function () { pending = false; apply(scope); }, 60); })
        .observe(scope, { childList: true, subtree: true, characterData: true });
    } catch (_) { /* old browser: one pass only */ }
  }
  var api = { install: install, apply: apply, split: split, pick: pick, lang: lang };
  // <script src="lib/oneLanguage.js" data-auto> installs itself on the body once the DOM is ready (no inline script)
  try {
    var cs = root.document && root.document.currentScript;
    if (cs && cs.hasAttribute('data-auto')) {
      if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', function () { install(); }); else install();
    }
  } catch (_) { /* no DOM */ }
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OneLanguage = api;
})(typeof window !== 'undefined' ? window : globalThis);
