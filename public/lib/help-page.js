/* User manual (help.html) — language, search, current section in the table of contents, former section anchors.
   No inline handler, no global state beyond window.HelpPage (exposed for tests). */
(function (root) {
  'use strict';

  // Former numbered anchors (#en-18, #fr-12-8 …) → the stable anchors of this manual, so old links still land.
  var FORMER = {
    '1': 'getting-started', '2': 'sign-in', '3': 'helpdesk', '3-1': 'helpdesk', '3-2': 'helpdesk', '3-3': 'helpdesk',
    '3-4': 'helpdesk', '3-5': 'helpdesk-risk-register', '4': 'reports', '4-1': 'reports-weekly', '4-2': 'reports-weekly',
    '4-3': 'reports-weekly', '4-4': 'reports-actions', '4-5': 'reports-submit', '4-6': 'reports-assets', '5': 'reports-pptx',
    '6': 'reports-deck', '7': 'admin', '7-3': 'admin-sessions', '7-4': 'helpdesk-risk-register', '8': 'navigation',
    '9': 'sla', '9-1': 'sla', '9-2': 'sla', '9-3': 'sla', '10': 'tracker', '10-6': 'tracker-closed-months',
    '11': 'inspections', '11-3': 'inspections-save', '11-6': 'inspections-register', '12': 'meetings',
    '12-4': 'meetings-import', '12-5': 'meetings-engagements', '12-8': 'meetings-transfer', '12-9': 'site-actions',
    '13': 'executive', '14': 'reports-deck', '15': 'status-page', '16': 'admin-operations', '17': 'admin-operations',
    '18': 'assets', '18-1': 'assets-inventory', '18-2': 'assets-hygiene', '18-3': 'assets-finance', '18-4': 'assets-hardware',
    '18-5': 'assets-progress', '18-6': 'assets-investment', '18-7': 'assets-reconcile', '19': 'teams-sla', '20': 'kpi',
    '21': 'security', '22': 'admin-operations', '23': 'dashboards', '24': 'tracker-builder', '25': 'portfolio',
    '26': 'report-studio', '27': 'field', '28': 'commitments', '29': 'handoffs', '30': 'policies', '31': 'policy-center'
  };
  function formerTarget(hash) {
    var m = /^#?(en|fr)-([0-9]+(?:-[0-9a-z]+)?)$/.exec(String(hash || ''));
    if (!m) return null;
    var key = m[2], id = FORMER[key] || FORMER[key.split('-')[0]];
    return id ? { lang: m[1], id: id } : null;
  }

  // The application language: the shared preference set by the shell's EN/FR button, else the browser language.
  function pickLang(stored, browser) {
    if (stored === 'fr' || stored === 'en') return stored;
    return /^fr/i.test(browser || '') ? 'fr' : 'en';
  }

  // Normalise for search: lower case, accents removed, spaces collapsed.
  function norm(s) {
    return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();
  }
  function matches(text, query) {
    var q = norm(query); if (!q) return true;
    var t = norm(text);
    return q.split(' ').every(function (w) { return t.indexOf(w) >= 0; });
  }

  var api = { FORMER: FORMER, formerTarget: formerTarget, pickLang: pickLang, norm: norm, matches: matches };
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.HelpPage = api;
  if (typeof document === 'undefined') return;

  var lang = 'en';
  function applyLang(l) {
    lang = l === 'fr' ? 'fr' : 'en';
    document.body.classList.toggle('lang-fr', lang === 'fr');
    document.documentElement.lang = lang;
    var input = document.getElementById('help-q');
    if (input) input.setAttribute('placeholder', lang === 'fr' ? 'ex. hors ligne, PV, quatre yeux' : 'e.g. offline, PV, four-eyes');
  }

  function visibleText(el) {
    // text of the active language only (the hidden language is display:none, so innerText skips it)
    return el.innerText || el.textContent || '';
  }

  function runSearch() {
    var input = document.getElementById('help-q');
    var status = document.getElementById('help-search-status');
    var q = input ? input.value : '';
    var secs = document.querySelectorAll('.hsec');
    var shown = 0;
    secs.forEach(function (sec) { sec.classList.remove('hidden-by-search'); sec.querySelectorAll('.hsub').forEach(function (s) { s.classList.remove('hidden-by-search'); }); });
    if (norm(q)) {
      secs.forEach(function (sec) {
        var title = sec.querySelector('h2');
        if (title && matches(visibleText(title), q)) { shown++; return; }
        var subs = sec.querySelectorAll('.hsub'), anySub = false;
        subs.forEach(function (s) { if (matches(visibleText(s), q)) anySub = true; else s.classList.add('hidden-by-search'); });
        // the section's own text outside its sub-sections
        var own = visibleText(sec);
        subs.forEach(function (s) { own = own.replace(s.innerText || '', ''); });
        if (anySub || matches(own, q)) { shown++; if (!anySub) subs.forEach(function (s) { s.classList.remove('hidden-by-search'); }); }
        else sec.classList.add('hidden-by-search');
      });
    } else shown = secs.length;
    document.querySelectorAll('.help-toc a[href^="#"]').forEach(function (a) {
      var t = document.getElementById(a.getAttribute('href').slice(1));
      var sec = t && (t.classList.contains('hsec') ? t : t.closest('.hsec'));
      var hide = !!(t && (t.classList.contains('hidden-by-search') || (sec && sec.classList.contains('hidden-by-search'))));
      if (a.parentElement) a.parentElement.classList.toggle('hidden-by-search', hide);
    });
    if (status) {
      if (!norm(q)) status.textContent = '';
      else if (lang === 'fr') status.textContent = shown ? shown + ' chapitre(s) correspondent' : 'Aucun résultat — essayez un autre mot';
      else status.textContent = shown ? shown + ' chapter(s) match' : 'No result — try another word';
    }
  }

  function trackCurrent() {
    if (!('IntersectionObserver' in window)) return;
    var links = {};
    document.querySelectorAll('.help-toc a[href^="#"]').forEach(function (a) { links[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        var a = links[e.target.id]; if (!a) return;
        document.querySelectorAll('.help-toc a.is-current').forEach(function (x) { x.classList.remove('is-current'); x.removeAttribute('aria-current'); });
        a.classList.add('is-current'); a.setAttribute('aria-current', 'location');
      });
    }, { rootMargin: '-80px 0px -70% 0px' });
    document.querySelectorAll('.hsec').forEach(function (s) { io.observe(s); });
  }

  function jumpToHash() {
    var t = formerTarget(location.hash);
    if (t) {
      applyLang(t.lang);
      var el = document.getElementById(t.id);
      if (el) { history.replaceState(null, '', '#' + t.id); el.scrollIntoView(); }
    }
  }

  function init() {
    var stored = null;
    try { stored = localStorage.getItem('sdp_lang'); } catch (_) { stored = null; }
    applyLang(pickLang(stored, navigator.language));
    var input = document.getElementById('help-q');
    if (input) {
      input.addEventListener('input', runSearch);
      input.addEventListener('keydown', function (ev) { if (ev.key === 'Escape') { input.value = ''; runSearch(); } });
    }
    jumpToHash();
    window.addEventListener('hashchange', jumpToHash);
    trackCurrent();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})(typeof window !== 'undefined' ? window : globalThis);
