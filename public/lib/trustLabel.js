/* trustLabel.js — B-03 trust label on KPI tiles: certification state, source, formula, DATA date.
 *
 * Any element carrying data-metric-key="<registry key>" gets a compact, focusable label:
 *   « Non certifié · <source> · <formule> · données au <date> »   (visible: state + data date;
 *   full text in title + aria-label, reachable with the keyboard: tabindex=0, role=note).
 * The facts come from GET /api/metrics/registry (read ONCE per page). Nothing here changes a
 * metric definition: the label only says what the registry already says.
 *
 *   TrustLabel.init({ registry: true|false, dataDate, lang })   read the registry, decorate, watch
 *   TrustLabel.setDataDate(v)                                    page-level data date (epoch ms / ISO / 'YYYY-MM-DD HH:MM:SS' UTC)
 *   TrustLabel.apply(root)                                       (re)decorate a subtree
 *   TrustLabel.format(meta, dataDate, lang) → { short, full }    pure — unit-tested
 *   TrustLabel.dataAsOf(dataDate, lang)    → 'Data as of …' | 'Data date unknown'
 *
 * Rules: a null date is « date inconnue », never the browser clock. A key the registry does not
 * hold is « absent du dictionnaire des indicateurs » (still not certified). When the registry
 * could not be read the state is « certification non lue », never « certifié ».
 * A tile may override the page date with data-metric-asof="…".
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TrustLabel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var STR = {
    fr: { certified: 'Certifié', notCertified: 'Non certifié', unread: 'Certification non lue',
          asOf: 'données au', unknownDate: 'date inconnue', noSource: 'source non renseignée',
          noFormula: 'formule non renseignée', notInRegistry: 'absent du dictionnaire des indicateurs',
          footAsOf: 'Données au', footUnknown: 'Date des données inconnue' },
    en: { certified: 'Certified', notCertified: 'Not certified', unread: 'Certification not read',
          asOf: 'data as of', unknownDate: 'date unknown', noSource: 'source not recorded',
          noFormula: 'formula not recorded', notInRegistry: 'not in the metric dictionary',
          footAsOf: 'Data as of', footUnknown: 'Data date unknown' },
  };
  var MON = { fr: ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'],
              en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] };

  function L(lang) { return lang === 'fr' ? 'fr' : 'en'; }

  // epoch ms | Date | ISO | 'YYYY-MM-DD HH:MM:SS' (sync_metadata, UTC without a zone) → Date | null.
  // 0, '' and garbage are null: "no date" must never become 1970 or the browser clock.
  function parseDate(v) {
    if (v == null || v === '' || v === 0) return null;
    if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
    if (typeof v === 'number') return isFinite(v) && v > 0 ? new Date(v) : null;
    var s = String(v).trim();
    if (!s) return null;
    if (/^\d+$/.test(s)) { var n = Number(s); return n > 0 ? new Date(n) : null; }
    if (/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d(:\d\d(\.\d+)?)?$/.test(s)) s = s.replace(' ', 'T') + 'Z';
    else if (/^\d{4}-\d\d-\d\d$/.test(s)) s = s + 'T00:00:00Z';
    var d = new Date(s);
    return isNaN(d.getTime()) ? null : d;
  }
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  // Explicit UTC formatting: the same text on every screen, whatever the browser's time zone.
  function fmtDate(d, lang) {
    var l = L(lang);
    return pad(d.getUTCDate()) + ' ' + MON[l][d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ' +
      pad(d.getUTCHours()) + ':' + pad(d.getUTCMinutes()) + ' UTC';
  }
  function asOfText(dataDate, lang) {
    var t = STR[L(lang)], d = parseDate(dataDate);
    return d ? t.asOf + ' ' + fmtDate(d, lang) : t.unknownDate;
  }
  function isCertified(meta) {
    return !!(meta && meta.approved_at && !/^not\s+certified/i.test(String(meta.certification || '')));
  }
  // meta: a registry row, null (key absent from the registry) or undefined (registry not read).
  function format(meta, dataDate, lang) {
    var t = STR[L(lang)];
    var when = asOfText(dataDate, lang);
    var state, parts;
    if (meta === undefined) { state = t.unread; parts = [state, when]; }
    else if (meta === null) { state = t.notCertified; parts = [state, t.notInRegistry, when]; }
    else {
      state = isCertified(meta) ? t.certified : t.notCertified;
      parts = [state, meta.source || meta.module || t.noSource, meta.formula || t.noFormula, when];
      if (!isCertified(meta) && meta.certification) parts.splice(1, 0, String(meta.certification));
    }
    return { state: state, short: state + ' · ' + when, full: parts.join(' · ') };
  }
  function dataAsOf(dataDate, lang) {
    var t = STR[L(lang)], d = parseDate(dataDate);
    return d ? t.footAsOf + ' ' + fmtDate(d, lang) : t.footUnknown;
  }

  // ── Browser side ───────────────────────────────────────────────────────────────────
  var state = { registry: undefined, dataDate: null, lang: null, observer: null, loading: null };

  function currentLang() {
    if (state.lang) return state.lang;
    try { if (typeof window !== 'undefined' && window.I18nText && window.I18nText.lang) return window.I18nText.lang(); } catch (_) {}
    try { var s = localStorage.getItem('sdp_lang'); if (s === 'fr' || s === 'en') return s; } catch (_) {}
    try { return /^fr/i.test((navigator && navigator.language) || '') ? 'fr' : 'en'; } catch (_) { return 'en'; }
  }
  function metaFor(key) {
    if (state.registry === undefined) return undefined;
    return Object.prototype.hasOwnProperty.call(state.registry, key) ? state.registry[key] : null;
  }
  function labelOf(el) {
    var kids = el.children || [];
    for (var i = 0; i < kids.length; i++) if (kids[i].getAttribute && kids[i].getAttribute('data-trust-label') === '1') return kids[i];
    return null;
  }
  function decorateOne(doc, el) {
    var key = el.getAttribute('data-metric-key');
    if (!key) return;
    var own = el.getAttribute('data-metric-asof');
    var f = format(metaFor(key), own != null && own !== '' ? own : state.dataDate, currentLang());
    var lab = labelOf(el);
    if (!lab) {
      lab = doc.createElement('span');
      lab.setAttribute('data-trust-label', '1');
      lab.className = 'trust-label';
      lab.setAttribute('tabindex', '0');
      lab.setAttribute('role', 'note');
      if (lab.style) {
        lab.style.display = 'block'; lab.style.marginTop = '4px'; lab.style.fontSize = '10px';
        lab.style.lineHeight = '1.3'; lab.style.fontWeight = '600'; lab.style.color = '#6B7280';
        lab.style.cursor = 'help'; lab.style.whiteSpace = 'normal';
      }
      el.appendChild(lab);
    }
    // Write only on change: the MutationObserver below must not loop on our own edits.
    if (lab.textContent !== f.short) lab.textContent = f.short;
    if (lab.getAttribute('title') !== f.full) lab.setAttribute('title', f.full);
    if (lab.getAttribute('aria-label') !== f.full) lab.setAttribute('aria-label', f.full);
    lab.setAttribute('data-trust-state', f.state);
  }
  function apply(rootEl) {
    var doc = typeof document !== 'undefined' ? document : null;
    var r = rootEl || doc;
    if (!r || !r.querySelectorAll) return 0;
    var d = (r.ownerDocument || doc || r);
    var list = Array.prototype.slice.call(r.querySelectorAll('[data-metric-key]'));
    if (r.getAttribute && r.getAttribute('data-metric-key')) list.unshift(r);
    list.forEach(function (el) { decorateOne(d, el); });
    return list.length;
  }
  function setDataDate(v) { state.dataDate = v == null ? null : v; apply(); }
  function authHeaders() {
    var h = { Accept: 'application/json' };
    try { if (window.__ak) h['X-Dash-Key'] = window.__ak; } catch (_) {}
    try { if (window.__authToken) h['x-report-token'] = window.__authToken; } catch (_) {}
    return h;
  }
  function loadRegistry(url) {
    if (state.loading) return state.loading;
    state.loading = fetch(url || '/api/metrics/registry', { credentials: 'same-origin', headers: authHeaders() })
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        var map = {};
        (j && Array.isArray(j.metrics) ? j.metrics : []).forEach(function (m) { if (m && m.key) map[m.key] = m; });
        state.registry = map;
      })
      .catch(function () { state.registry = undefined; /* « certification non lue », never « certifié » */ });
    return state.loading;
  }
  function init(opts) {
    opts = opts || {};
    if (opts.lang) state.lang = opts.lang;
    if (opts.dataDate !== undefined) state.dataDate = opts.dataDate;
    // registry:false — a page without a session (exec-view): every key is reported as absent
    // from the dictionary, which is the truth for its fleet figures; nothing is fetched.
    if (opts.registry === false) state.registry = {};
    var done = opts.registry === false ? Promise.resolve() : loadRegistry(opts.registryUrl);
    if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined' && !state.observer && document.body) {
      // Pages re-render tiles with innerHTML: re-decorate once per burst of mutations (one
      // querySelectorAll on the document), not once per added node — index.html re-renders big tables.
      var pending = false;
      state.observer = new MutationObserver(function (ms) {
        if (pending) return;
        for (var i = 0; i < ms.length; i++) {
          var added = ms[i].addedNodes || [];
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (n.nodeType === 1 && n.getAttribute('data-trust-label') !== '1') {
              pending = true; setTimeout(function () { pending = false; apply(); }, 0); return;
            }
          }
        }
      });
      state.observer.observe(document.body, { childList: true, subtree: true });
    }
    try { if (window.I18nText && window.I18nText.onChange) window.I18nText.onChange(function () { apply(); }); } catch (_) {}
    apply();
    return done.then(function () { apply(); });
  }

  return { init: init, apply: apply, setDataDate: setDataDate, format: format, dataAsOf: dataAsOf,
           parseDate: parseDate, isCertified: isCertified, _state: state };
});
