'use strict';
// SDP360 — pure logic behind public/analytics.html (goal C-01, findings F03 F04 F07 F08 F09 F11 F12).
//
// WHY a separate file: the page's arithmetic and colour decisions were inline and untestable, and
// four of them were wrong on edge cases — a backlog ratio divided by open_count while guarding on
// total (NaN / Infinity when nothing is open), a null KPI painted RED, an 'Unknown' change risk
// painted GREEN, CAB approval colours assigned by array POSITION, API labels written through
// innerHTML unescaped, a filter change dropped while a load was in flight, and API errors that left
// the previous figures on screen. Everything here is side-effect free (or takes its DOM as an
// argument) so tests can drive it with adversarial fixtures.
//
// UMD-style export, same pattern as public/lib/kpiRag.js: browser global `AnalyticsLogic`,
// CommonJS module in Node.

(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AnalyticsLogic = factory();
}(typeof self !== 'undefined' ? self : this, function () {

  function _num(v) {
    if (v === null || v === undefined || v === '' || typeof v === 'boolean') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  // F03 — share of a part in a whole, rounded to a whole percent. The denominator is the one the
  // ratio is expressed against (backlog "% of open" → open_count). No denominator, a zero/negative
  // denominator, or a non-numeric part → null ("—"), never NaN / Infinity / a fake 0 %.
  function ratioPct(part, whole) {
    const p = _num(part), w = _num(whole);
    if (p === null || w === null || w <= 0) return null;
    return Math.round(p / w * 100);
  }

  // G03 — display formatters: null / '' / non-finite → '—' (never "NaN", "Infinity", or "NaN%").
  function fmtNum(n, decimals) {
    const x = _num(n);
    if (x === null) return '—';
    const d = decimals || 0;
    return x.toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d });
  }
  function fmtPct(n) { return _num(n) === null ? '—' : fmtNum(n, 1) + '%'; }

  // F04 — RAG class for a "higher is better" KPI. `null` / non-finite → 'na' (neutral), never red.
  // `amber == null` means the KPI has no red tier (below green is amber), as the page always had
  // for CAB compliance and survey response rate. Thresholds are the page's existing ones.
  function ragClass(v, green, amber) {
    const x = _num(v);
    if (x === null) return 'na';
    if (x >= green) return 'green';
    if (amber === null || amber === undefined) return 'amber';
    return x >= amber ? 'amber' : 'red';
  }
  function kpiCardClass(v, green, amber) { return 'kpi ' + ragClass(v, green, amber); }

  // Sub-line colour for a "lower is better" figure (bad above `limit`). null → '' (no colour);
  // previously `(v||0) > 10 ? 'bad' : 'good'` showed a missing figure in green.
  function overLimitClass(v, limit) {
    const x = _num(v);
    if (x === null) return '';
    return x > limit ? 'bad' : 'good';
  }

  function _key(label) {
    return String(label == null ? '' : label).trim().toLowerCase().replace(/\s+/g, ' ');
  }

  // F07 — change risk → semantic colour key. Explicit table; anything else ('Unknown', '', null,
  // a new SDP label) is 'neutral' — never green.
  const RISK_COLOUR = { 'low': 'green', 'medium': 'amber', 'high': 'red', 'very high': 'red' };
  function riskColourKey(label) { return RISK_COLOUR[_key(label)] || 'neutral'; }

  // F08 — CAB approval status → semantic colour key, by NAME, never by array position.
  const APPROVAL_COLOUR = {
    'approved': 'green',
    'rejected': 'red', 'denied': 'red',
    'pending': 'amber', 'pending approval': 'amber', 'awaiting approval': 'amber',
  };
  function approvalColourKey(status) { return APPROVAL_COLOUR[_key(status)] || 'neutral'; }

  // Resolve colour keys against a palette ({green, amber, red, slate}); neutral → slate.
  function colourFor(key, palette) {
    const p = palette || {};
    if (key === 'green') return p.green;
    if (key === 'amber') return p.amber;
    if (key === 'red')   return p.red;
    return p.slate;
  }

  // F09 — HTML escaping for every API value written through innerHTML.
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  // Label/count mini table (technician, CAB rule type). Every interpolated value is escaped;
  // `fmt` formats the count (the page's number formatter).
  function miniTableHtml(rows, labelKey, labelHead, countHead, fmt) {
    const f = typeof fmt === 'function' ? fmt : (n => String(n == null ? '—' : n));
    return '<table class="mini-table"><thead><tr><th>' + esc(labelHead) + '</th><th class="num">' + esc(countHead) +
      '</th></tr></thead><tbody>' +
      (rows || []).map(r => {
        const label = r && r[labelKey] != null && r[labelKey] !== '' ? r[labelKey] : '—';
        return '<tr><td>' + esc(label) + '</td><td class="num">' + esc(f(r && r.count)) + '</td></tr>';
      }).join('') + '</tbody></table>';
  }

  // F12 — fetch wrapper that refuses a non-2xx response instead of rendering its error body.
  async function fetchJson(fetchFn, url) {
    const r = await fetchFn(url);
    if (!r || !r.ok) {
      const err = new Error('HTTP ' + (r ? r.status : 'no response') + ' for ' + url);
      err.status = r ? r.status : 0;
      throw err;
    }
    return r.json();
  }

  // F11 — load coordinator. `run(gen, isCurrent)` performs one full load; loaders must check
  // `isCurrent()` after every await and before touching the DOM. A trigger while a load is in
  // flight does NOT get dropped: it invalidates the running generation (its late responses are
  // ignored) and queues exactly one re-run that starts as soon as the current one settles.
  function createLoadCoordinator(run) {
    let gen = 0, loading = false, pending = false;
    const state = { get gen() { return gen; }, get loading() { return loading; }, get pending() { return pending; } };
    async function trigger() {
      if (loading) { gen += 1; pending = true; return; }
      loading = true;
      try {
        do {
          pending = false;
          gen += 1;
          const mine = gen;
          try { await run(mine, () => mine === gen); } catch (_e) { /* loaders report their own errors */ }
        } while (pending);
      } finally {
        loading = false;
      }
    }
    return { trigger, state };
  }

  // F12 — put a section into an explicit error state: values blanked ("—"), card colour neutral
  // with an `error` class, freshness badge "Error", and one inline Retry button wired to `onRetry`
  // (event listener, no inline handler). `doc` is a document-like object (getElementById,
  // createElement); everything is null-safe so a missing node never throws.
  function renderSectionError(doc, cfg) {
    const c = cfg || {};
    (c.valueIds || []).forEach(id => {
      const el = doc.getElementById(id);
      if (!el) return;
      el.textContent = '—';
      if (el.classList) el.classList.remove('loading');
      const card = el.closest ? el.closest('.kpi') : null;
      if (card) card.className = 'kpi na error';
    });
    (c.subIds || []).forEach(id => { const el = doc.getElementById(id); if (el) el.textContent = ''; });
    if (c.freshId) {
      const b = doc.getElementById(c.freshId);
      if (b) { b.textContent = 'Error'; b.className = 'freshness-badge error'; }
    }
    if (c.hostId) {
      const host = doc.getElementById(c.hostId);
      if (host) {
        host.textContent = '';
        const msg = doc.createElement('span');
        msg.className = 'section-error-msg';
        msg.textContent = 'Could not load' + (c.status ? ' (HTTP ' + c.status + ')' : '') + ' — figures withheld. ';
        const btn = doc.createElement('button');
        btn.type = 'button';
        btn.className = 'btn-retry';
        btn.textContent = 'Retry';
        if (typeof c.onRetry === 'function' && btn.addEventListener) btn.addEventListener('click', c.onRetry);
        host.appendChild(msg);
        host.appendChild(btn);
        host.hidden = false;
      }
    }
  }
  function clearSectionError(doc, hostId) {
    const host = hostId && doc.getElementById(hostId);
    if (host) { host.textContent = ''; host.hidden = true; }
  }

  return {
    fmtNum, fmtPct, ratioPct, ragClass, kpiCardClass, overLimitClass,
    riskColourKey, approvalColourKey, colourFor, RISK_COLOUR, APPROVAL_COLOUR,
    esc, miniTableHtml, fetchJson, createLoadCoordinator, renderSectionError, clearSectionError,
  };
}));
