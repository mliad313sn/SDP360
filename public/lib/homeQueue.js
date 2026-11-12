/* SDP360 — R2-QUEUE (REBUILD-SPEC R3) — the progressive action queue "S1" on Home.
 *
 * One queue of the person's AUTHORISED work, read from the existing per-site readers (no new route):
 *   meetings     GET /api/meetings/actions?site=CODE         (meetings read scope — another site = 403)
 *   inspections  GET /api/inspection/actions?site=CODE       (inspection read scope — another site = 403)
 *   report       GET /api/reports/site-actions?site=CODE     (Site Actions register — report follow-ups group)
 *   commitments  GET /api/commitments                        (own sites + where named; 404 while commitments_enabled = '0')
 *   awaiting     the "Awaiting me" block of GET /api/me/work (F1-GOV / F-PRODUCT-07; absent while
 *                mywork_awaiting_me_enabled = '0') — decisions, handoffs, benefits, PVs and commitments that wait for me
 * The site list is the one Home already reads (/api/me/work: the person's own sites, at most 12). Only those codes
 * are requested and a row naming another site is dropped (defence in depth — the server already refuses).
 *
 * Every source loads on its own and carries its own state — available / unknown / stale / partial / denied (plus
 * loading) — each a symbol + a word + an accessible name, never a colour alone. A source that fails never hides
 * another. Limits are stated on the page: 12 sites, 150 items shown; a line without an exact authorised page opens
 * its register (marked "register").
 *
 * UMD: window.HomeQueue in the browser (statusTransfer.js loaded first), module.exports in Node (tests).
 * Pure except mount(), which writes HTML strings (every value escaped) into one container.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./statusTransfer'));
  else root.HomeQueue = factory(root.StatusTransfer);
})(typeof self !== 'undefined' ? self : this, function (StatusTransfer) {
  'use strict';

  var LIMITS = { sites: 12, shown: 150, parallel: 4 };
  var SOURCES = ['meetings', 'inspections', 'report', 'commitments', 'awaiting'];
  var PER_SITE = { meetings: true, inspections: true, report: true };
  var MEETING_DONE = (StatusTransfer && StatusTransfer.DONE) || ['resolved', 'cancelled', 'closed', 'demand', 'helpdesk_ticket'];
  var INSP_DONE = ['closed', 'cancelled'];
  var COMMIT_DONE = ['verified_closed', 'cancelled_with_reason', 'accepted_risk_exception'];
  var AWAIT_PARTS = ['commitments', 'handoffs', 'benefits', 'decisions', 'pvs'];

  var STATES = {
    loading:   { symbol: '…', en: 'Loading…', fr: 'Chargement…' },
    available: { symbol: '✓', en: 'Available', fr: 'Disponible' },
    unknown:   { symbol: '?', en: 'Unknown — could not be read', fr: 'Inconnu — source illisible' },
    stale:     { symbol: '–', en: 'Stale — last read kept', fr: 'Périmé — dernière lecture conservée' },
    partial:   { symbol: '◐', en: 'Partial — some parts missing, total unknown', fr: 'Partiel — des parties manquent, total inconnu' },
    denied:    { symbol: '⊘', en: 'Not allowed', fr: 'Accès refusé' },
  };
  var L = {
    en: { title: 'My queue', sub: 'Your open work across your sites, oldest risk first. Each source loads on its own.',
      src: { meetings: 'Meeting actions', inspections: 'Inspection actions', report: 'Report follow-ups', commitments: 'Commitments', awaiting: 'Awaiting me' },
      aw: { commitments: 'commitment to verify', handoffs: 'handoff to accept', benefits: 'benefit to verify', decisions: 'decision due', pvs: 'PV to sign' },
      retry: 'Try again', late: 'late', due: 'due', owner: 'owner', noOwner: 'no owner', register: 'register', empty: 'Nothing open in the sources that answered.',
      limits: 'Limits: up to {s} sites and {n} items are shown. For the full list, open the {reg}.', regLink: 'Site Actions register',
      more: '{shown} of {total} items shown', sitesMore: '{n} more site(s) not read', noCode: 'no site code', off: 'not switched on',
      sitesOk: '{ok} of {all} sites', asOf: 'kept from {t}', items: '{n} item(s)', announce: 'Queue: {n} item(s) loaded' },
    fr: { title: 'Ma file de travail', sub: 'Votre travail ouvert sur vos sites, le plus à risque d\'abord. Chaque source se charge seule.',
      src: { meetings: 'Actions de réunion', inspections: 'Actions d\'inspection', report: 'Suivis de rapport', commitments: 'Engagements', awaiting: 'En attente de moi' },
      aw: { commitments: 'engagement à vérifier', handoffs: 'passation à accepter', benefits: 'bénéfice à vérifier', decisions: 'décision due', pvs: 'PV à signer' },
      retry: 'Réessayer', late: 'en retard', due: 'échéance', owner: 'responsable', noOwner: 'sans responsable', register: 'registre', empty: 'Rien d\'ouvert dans les sources qui ont répondu.',
      limits: 'Limites : {s} sites et {n} éléments au plus sont affichés. Pour la liste complète, ouvrez le {reg}.', regLink: 'registre des actions du site',
      more: '{shown} éléments affichés sur {total}', sitesMore: '{n} autre(s) site(s) non lu(s)', noCode: 'pas de code de site', off: 'non activé',
      sitesOk: '{ok} sites sur {all}', asOf: 'conservé depuis {t}', items: '{n} élément(s)', announce: 'File : {n} élément(s) chargé(s)' },
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fill(s, o) { return String(s).replace(/\{(\w+)\}/g, function (_, k) { return o[k] == null ? '' : o[k]; }); }
  function day(v) { return v ? String(v).slice(0, 10) : null; }
  function low(v) { return String(v == null ? '' : v).trim().toLowerCase(); }
  var CODE_RE = /^[A-Za-z0-9_-]{1,16}$/;
  function enc(v) { return encodeURIComponent(String(v)); }
  function register(source, code) {
    var q = code && CODE_RE.test(code) ? '?site=' + enc(code) : '';
    if (source === 'meetings') return 'meetings-actions.html' + q;
    if (source === 'inspections') return 'inspection-actions.html' + q;
    if (source === 'commitments') return 'commitments.html';
    return 'site-actions.html' + q;
  }
  function line(o, asOf) {
    var due = day(o.due_date);
    return { source: o.source, sub: o.sub || null, site_code: o.site_code || null, title: o.title || '—', owner: o.owner || null,
      due_date: due, overdue: o.overdue != null ? !!o.overdue : !!(due && asOf && due < asOf), status: o.status || null,
      href: o.href, deep: !!o.deep };
  }
  // A row whose own site code differs from the one requested is never shown (the server already scopes; this is the belt).
  function sameSite(row, code) { return !row || row.site_code == null || low(row.site_code) === low(code); }

  function fromMeetings(json, code, asOf) {
    var rows = json && Array.isArray(json.rows) ? json.rows : [];
    return rows.filter(function (a) { return a && sameSite(a, code) && MEETING_DONE.indexOf(low(a.status)) === -1; }).map(function (a) {
      var mid = a.meeting_id != null ? a.meeting_id : a.meeting_id_ref;
      var deep = mid != null && /^\d+$/.test(String(mid));
      return line({ source: 'meetings', site_code: code, title: a.description, owner: a.owner_it || a.owner_email, due_date: a.target_date, status: a.status,
        href: deep ? 'meeting.html?id=' + enc(mid) : register('meetings', code), deep: deep }, asOf);
    });
  }
  function fromInspections(json, code, asOf) {
    var rows = json && Array.isArray(json.rows) ? json.rows : [];
    return rows.filter(function (a) { return a && sameSite(a, code) && INSP_DONE.indexOf(low(a.status)) === -1; }).map(function (a) {
      var deep = a.inspection_id != null && /^[A-Za-z0-9_-]{1,64}$/.test(String(a.inspection_id));
      return line({ source: 'inspections', site_code: code, title: a.description, owner: a.owner, due_date: a.due_date, status: a.status,
        href: deep ? 'inspection.html?id=' + enc(a.inspection_id) : register('inspections', code), deep: deep }, asOf);
    });
  }
  function fromReport(json, code, asOf) {
    var g = json && json.groups && json.groups.report;
    var items = g && Array.isArray(g.items) ? g.items : [];
    return items.map(function (it) {
      var url = it && it.close && it.close.url;
      var deep = /^reports\.html\?report=\d+$/.test(String(url || ''));
      return line({ source: 'report', site_code: code, title: it.title, owner: it.owner, due_date: it.due_date, status: it.status, overdue: it.overdue,
        href: deep ? url : register('report', code), deep: deep }, asOf);
    });
  }
  // Commitments: only the person's own sites are listed on Home (the "Awaiting me" source carries the ones they
  // must verify elsewhere). siteIds = ids of the sites Home shows.
  function fromCommitments(json, siteIds, codeById, asOf) {
    var rows = json && Array.isArray(json.commitments) ? json.commitments : [];
    var ids = (siteIds || []).map(Number);
    return rows.filter(function (c) { return c && c.site_id != null && ids.indexOf(Number(c.site_id)) !== -1 && COMMIT_DONE.indexOf(c.status) === -1; }).map(function (c) {
      var deep = /^\d+$/.test(String(c.id));
      return line({ source: 'commitments', site_code: codeById[Number(c.site_id)] || null, title: c.title, owner: c.accountable_owner || c.execution_owners,
        due_date: c.due_date, status: c.status, href: deep ? 'commitments.html?id=' + enc(c.id) : register('commitments'), deep: deep }, asOf);
    });
  }
  var AW_REG = { commitments: 'commitments.html', handoffs: 'handoffs.html', benefits: 'portfolio.html', decisions: 'cockpit.html', pvs: 'meetings-unsigned.html' };
  var SAFE_LINK = /^[a-z-]+\.html(?:[?#][A-Za-z0-9_=&%#.-]*)?$/i;
  function fromAwaiting(aw, asOf) {
    var out = [], missing = 0;
    AWAIT_PARTS.forEach(function (k) {
      var b = aw && aw[k];
      if (!b) { missing++; return; }
      (b.items || []).forEach(function (x) {
        var deep = SAFE_LINK.test(String(x.link || ''));
        out.push(line({ source: 'awaiting', sub: k, title: x.ref && x.title ? x.ref + ' — ' + x.title : (x.ref || x.title || x.id), owner: null,
          due_date: x.due_date, overdue: x.overdue, href: deep ? x.link : AW_REG[k], deep: deep }, asOf));
      });
    });
    return { items: out, missing: missing, parts: AWAIT_PARTS.length };
  }

  /** The state of a per-site source from its unit results [{ status: 'ok'|'denied'|'off'|'error'|'nocode' }]. */
  function siteSourceState(units) {
    var n = units.length;
    var ok = units.filter(function (u) { return u.status === 'ok'; }).length;
    var denied = units.filter(function (u) { return u.status === 'denied'; }).length;
    var off = units.filter(function (u) { return u.status === 'off'; }).length;
    if (!n) return { state: 'unknown', reason: 'nocode' };
    if (off === n) return { state: 'unknown', reason: 'off' };
    if (ok === n) return { state: 'available' };
    if (denied === n) return { state: 'denied' };
    if (ok === 0) return { state: 'unknown', reason: units.every(function (u) { return u.status === 'nocode'; }) ? 'nocode' : null };
    return { state: 'partial', ok: ok, all: n };
  }

  /** Sort: late first, then by due date (no date last), then source order; cut at LIMITS.shown. */
  function merge(bySource) {
    var all = [];
    SOURCES.forEach(function (s) { (bySource[s] || []).forEach(function (x) { all.push(x); }); });
    all.sort(function (a, b) {
      return (b.overdue === true) - (a.overdue === true)
        || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999'))
        || SOURCES.indexOf(a.source) - SOURCES.indexOf(b.source)
        || String(a.title).localeCompare(String(b.title));
    });
    return { total: all.length, items: all.slice(0, LIMITS.shown) };
  }

  /**
   * opts: { sites: [{site_id, code, name}] (from /api/me/work), truncated (sites not shown), awaiting (me/work
   *   awaiting_me, undefined = switched off, null = not measured), asOf, lang, fetchJson(url) → Promise<{status, json}>,
   *   onChange(), now() }
   */
  function createQueue(opts) {
    var o = opts || {};
    // sites === null: the site list itself could not be read (Home's /api/me/work failed) → per-site sources are unknown
    var sites = o.sites == null ? null : o.sites.slice(0, LIMITS.sites);
    var awaitingNow = o.awaiting, truncated = Number(o.truncated) || 0;
    var asOf = day(o.asOf) || new Date().toISOString().slice(0, 10);
    var lang = o.lang === 'fr' ? 'fr' : 'en';
    var now = o.now || function () { return new Date(); };
    var codeById = {};
    function index() { codeById = {}; (sites || []).forEach(function (s) { codeById[Number(s.site_id)] = s.code || null; }); }
    index();
    var st = {};
    SOURCES.forEach(function (s) { st[s] = { state: 'loading', items: [], detail: null, loadedAt: null }; });
    var requested = [];

    function call(url) {
      requested.push(url);
      return Promise.resolve().then(function () { return o.fetchJson(url); }).then(function (r) {
        var code = r && r.status;
        if (code >= 200 && code < 300) return { status: 'ok', json: r.json };
        if (code === 403 || code === 401) return { status: 'denied' };
        if (code === 404) return { status: 'off' };
        return { status: 'error' };
      }, function () { return { status: 'error' }; });
    }
    function settle(source, res) {
      var prev = st[source];
      var hadData = prev.loadedAt != null && (prev.state === 'available' || prev.state === 'partial' || prev.state === 'stale');
      if ((res.state === 'unknown' || res.state === 'denied') && hadData && res.reason !== 'off') {
        // a refresh failed: the last good read stays on screen, labelled stale with its time
        st[source] = { state: 'stale', items: prev.items, detail: fill(L[lang].asOf, { t: prev.loadedAt }), loadedAt: prev.loadedAt };
      } else {
        var detail = null;
        if (res.state === 'partial') detail = fill(L[lang].sitesOk, { ok: res.ok, all: res.all });
        else if (res.reason === 'off') detail = L[lang].off;
        else if (res.reason === 'nocode') detail = L[lang].noCode;
        else if (res.detail) detail = res.detail;
        var t = now(); var hm = ('0' + t.getHours()).slice(-2) + ':' + ('0' + t.getMinutes()).slice(-2);
        st[source] = { state: res.state, items: res.items || [], detail: detail, loadedAt: res.state === 'available' || res.state === 'partial' ? hm : prev.loadedAt };
      }
      if (typeof o.onChange === 'function') o.onChange(source);
    }

    // a tiny pool so 12 sites × 3 sources never open 36 requests at once
    var queue = [], active = 0;
    function run(task) {
      return new Promise(function (resolve) {
        queue.push(function () { return task().then(resolve, function () { resolve({ status: 'error' }); }); });
        pump();
      });
    }
    function pump() {
      while (active < LIMITS.parallel && queue.length) {
        active++;
        queue.shift()().then(function () { active--; pump(); });
      }
    }

    function loadSiteSource(source) {
      if (sites == null) { settle(source, { state: 'unknown' }); return Promise.resolve(); }
      var withCode = sites.filter(function (s) { return s.code && CODE_RE.test(s.code); });
      if (!withCode.length) { settle(source, { state: 'unknown', reason: 'nocode' }); return Promise.resolve(); }
      var url = { meetings: '/api/meetings/actions?site=', inspections: '/api/inspection/actions?site=', report: '/api/reports/site-actions?site=' }[source];
      var conv = { meetings: fromMeetings, inspections: fromInspections, report: fromReport }[source];
      var units = [], items = [];
      // sites without a code cannot be read for this source → they make it partial, never zero
      sites.forEach(function (s) { if (!(s.code && CODE_RE.test(s.code))) units.push({ status: 'nocode' }); });
      return Promise.all(withCode.map(function (s) {
        return run(function () { return call(url + enc(s.code)); }).then(function (r) {
          units.push({ status: r.status });
          if (r.status === 'ok') items = items.concat(conv(r.json, s.code, asOf));
        });
      })).then(function () { var k = siteSourceState(units); k.items = items; settle(source, k); });
    }
    function loadCommitments() {
      if (sites == null) { settle('commitments', { state: 'unknown' }); return Promise.resolve(); }
      return run(function () { return call('/api/commitments'); }).then(function (r) {
        if (r.status === 'ok') settle('commitments', { state: 'available', items: fromCommitments(r.json, sites.map(function (s) { return s.site_id; }), codeById, asOf) });
        else if (r.status === 'off') settle('commitments', { state: 'unknown', reason: 'off' });
        else settle('commitments', { state: r.status === 'denied' ? 'denied' : 'unknown' });
      });
    }
    function loadAwaiting(aw) {
      if (aw === undefined) { settle('awaiting', { state: 'unknown', reason: 'off' }); return Promise.resolve(); }
      if (aw === null) { settle('awaiting', { state: 'unknown' }); return Promise.resolve(); }
      var r = fromAwaiting(aw, asOf);
      if (r.missing === r.parts) settle('awaiting', { state: 'unknown' });
      else if (r.missing) settle('awaiting', { state: 'partial', ok: r.parts - r.missing, all: r.parts, items: r.items });
      else settle('awaiting', { state: 'available', items: r.items });
      return Promise.resolve();
    }
    // Re-read /api/me/work (the only reader of the site list and of the "Awaiting me" block). On success the site
    // list and the block are replaced; on failure they keep their last value.
    function refreshWork() {
      if (typeof o.reloadWork !== 'function') return Promise.resolve(false);
      return Promise.resolve().then(o.reloadWork).then(function (j) {
        if (!j) return false;
        sites = Array.isArray(j.sites) ? j.sites.slice(0, LIMITS.sites) : sites; truncated = Number(j.truncated) || 0; index();
        awaitingNow = j.awaiting_me; return true;
      }, function () { return false; });
    }
    function load(source) {
      if (source === 'awaiting') return refreshWork().then(function (ok) { return loadAwaiting(ok ? awaitingNow : null); });
      var before = sites == null ? refreshWork() : Promise.resolve(true);
      return before.then(function () {
        if (PER_SITE[source]) return loadSiteSource(source);
        if (source === 'commitments') return loadCommitments();
      });
    }
    function loadAll() {
      return Promise.all(SOURCES.map(function (s) { return s === 'awaiting' ? loadAwaiting(awaitingNow) : (PER_SITE[s] ? loadSiteSource(s) : loadCommitments()); }));
    }
    function view() {
      var by = {};
      SOURCES.forEach(function (s) { by[s] = st[s].items; });
      var m = merge(by);
      return { states: SOURCES.map(function (s) { return { source: s, state: st[s].state, detail: st[s].detail, count: st[s].items.length }; }),
        items: m.items, total: m.total, truncatedSites: truncated, sites: sites || [] };
    }
    return { load: load, loadAll: loadAll, view: view, state: st, requested: requested };
  }

  function stateHtml(key, lang, detail) {
    var s = STATES[key]; var txt = s[lang === 'fr' ? 'fr' : 'en'];
    return '<span class="hq-state hq-state-' + key + '" role="img" aria-label="' + esc(txt + (detail ? ': ' + detail : '')) + '">'
      + '<span aria-hidden="true">' + s.symbol + '</span> ' + esc(txt) + (detail ? ' — ' + esc(detail) : '') + '</span>';
  }

  /** HTML of the whole queue card for a view(). */
  function renderHtml(v, lang) {
    var T = L[lang === 'fr' ? 'fr' : 'en'];
    var single = v.sites.length === 1 && v.sites[0].code ? v.sites[0].code : null;
    var reg = register('report', single);
    var srcRows = v.states.map(function (s) {
      var retry = s.state === 'available' || s.state === 'loading' ? ''
        : ' <button type="button" class="hq-retry" data-source="' + esc(s.source) + '">' + esc(T.retry) + '<span class="hq-sr"> — ' + esc(T.src[s.source]) + '</span></button>';
      var count = s.state === 'available' || s.state === 'partial' || s.state === 'stale' ? ' <span class="hq-count">' + esc(fill(T.items, { n: s.count })) + '</span>' : '';
      return '<li data-source="' + esc(s.source) + '"><span class="hq-src">' + esc(T.src[s.source]) + '</span> ' + stateHtml(s.state, lang, s.detail) + count + retry + '</li>';
    }).join('');
    var items = v.items.map(function (x) {
      var what = x.source === 'awaiting' && x.sub ? T.src.awaiting + ' · ' + T.aw[x.sub] : T.src[x.source];
      var meta = [what, x.site_code, x.owner ? T.owner + ' ' + x.owner : (x.source === 'awaiting' ? null : T.noOwner), x.due_date ? T.due + ' ' + x.due_date : null]
        .filter(Boolean).map(esc).join(' · ');
      return '<li class="hq-item"><a href="' + esc(x.href) + '">' + esc(x.title) + '</a>' + (x.deep ? '' : ' <span class="hq-reg">(' + esc(T.register) + ')</span>')
        + (x.overdue ? ' <span class="hq-late"><span aria-hidden="true">⚠ </span>' + esc(T.late) + '</span>' : '')
        + '<div class="hq-meta">' + meta + '</div></li>';
    }).join('');
    var loadingAny = v.states.some(function (s) { return s.state === 'loading'; });
    var notes = [];
    if (v.total > v.items.length) notes.push(fill(T.more, { shown: v.items.length, total: v.total }));
    if (v.truncatedSites) notes.push(fill(T.sitesMore, { n: v.truncatedSites }));
    return '<section class="hm-card hq" aria-labelledby="hq-h" aria-busy="' + (loadingAny ? 'true' : 'false') + '">'
      + '<h2 id="hq-h">' + esc(T.title) + '</h2><p class="hm-muted">' + esc(T.sub) + '</p>'
      + '<ul class="hq-sources" aria-label="' + esc(T.title) + '">' + srcRows + '</ul>'
      + (items ? '<ol class="hq-list">' + items + '</ol>' : (loadingAny ? '' : '<p class="hm-muted">' + esc(T.empty) + '</p>'))
      + (notes.length ? '<p class="hq-note">' + esc(notes.join(' · ')) + '</p>' : '')
      + '<p class="hm-muted hq-limits">' + fill(esc(T.limits), { s: LIMITS.sites, n: LIMITS.shown, reg: '<a href="' + esc(reg) + '">' + esc(T.regLink) + '</a>' }) + '</p>'
      + '</section>';
  }

  /** Browser: mount the queue into `el` and start loading. Returns the controller. */
  function mount(el, opts) {
    var o = opts || {};
    var lang = o.lang === 'fr' ? 'fr' : 'en';
    var live = null;
    var q;
    function paint() {
      if (!el) return;
      var focusSrc = null;
      try { var a = document.activeElement; if (a && a.classList && a.classList.contains('hq-retry')) focusSrc = a.getAttribute('data-source'); } catch (_) { focusSrc = null; }
      el.innerHTML = renderHtml(q.view(), lang);
      if (focusSrc) { try { var h = el.querySelector('[data-source="' + focusSrc + '"] .hq-retry') || el.querySelector('#hq-h'); if (h) { if (!h.classList.contains('hq-retry')) h.setAttribute('tabindex', '-1'); h.focus(); } } catch (_) { /* focus is best-effort */ } }
    }
    q = createQueue(Object.assign({}, o, { onChange: paint }));
    paint();
    if (el && el.addEventListener) {
      el.addEventListener('click', function (ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest('.hq-retry') : null;
        if (!b) return;
        b.disabled = true;
        q.load(b.getAttribute('data-source'));
      });
    }
    q.loadAll().then(function () {
      try {
        live = live || document.getElementById(o.liveId || 'hmMsg');
        if (live && o.announce !== false) live.textContent = fill(L[lang].announce, { n: q.view().total });
      } catch (_) { /* no live region */ }
    });
    return q;
  }

  return { LIMITS: LIMITS, SOURCES: SOURCES, STATES: STATES, L: L, fromMeetings: fromMeetings, fromInspections: fromInspections,
    fromReport: fromReport, fromCommitments: fromCommitments, fromAwaiting: fromAwaiting, siteSourceState: siteSourceState,
    merge: merge, createQueue: createQueue, renderHtml: renderHtml, stateHtml: stateHtml, mount: mount, register: register };
});
