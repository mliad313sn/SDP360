'use strict';
// KPI Dictionary page (step 3). External file: the page runs under the strict CSP (no inline script).
(function () {
  var tok = function () { return window.__authToken || ''; };
  function api(p) {
    return fetch(p, { headers: { 'x-report-token': tok() } }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status); return r.json();
    });
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  var lang = 'en';
  try { lang = localStorage.getItem('kd_lang') || 'en'; } catch (_) {}
  function setLang(l) {
    lang = l; document.body.classList.toggle('lang-fr', l === 'fr');
    document.querySelectorAll('.kd-lang button').forEach(function (b) { b.classList.toggle('active', b.dataset.lang === l); });
    try { localStorage.setItem('kd_lang', l); } catch (_) {}
    renderDict();
  }
  document.querySelectorAll('.kd-lang button').forEach(function (b) { b.addEventListener('click', function () { setLang(b.dataset.lang); }); });
  document.querySelectorAll('.kd-tab').forEach(function (t) {
    t.addEventListener('click', function () {
      document.querySelectorAll('.kd-tab').forEach(function (x) { x.classList.toggle('active', x === t); });
      document.querySelectorAll('.kd-pane').forEach(function (p) { p.classList.toggle('active', p.id === 'pane-' + t.dataset.pane); });
      if (t.dataset.pane === 'sites') loadSites();
    });
  });

  var METRICS = [];
  function renderDict() {
    var q = (document.getElementById('q').value || '').toLowerCase();
    var dom = document.getElementById('dom').value;
    var rows = METRICS.filter(function (m) {
      if (dom && m.domain !== dom) return false;
      if (!q) return true;
      return [m.key, m.en, m.fr, m.formula, m.source, m.owner].join(' ').toLowerCase().indexOf(q) >= 0;
    });
    document.getElementById('count').textContent = rows.length + ' / ' + METRICS.length;
    document.querySelector('#tblDict tbody').innerHTML = rows.map(function (m) {
      return '<tr><td><strong>' + esc(lang === 'fr' ? m.fr : m.en) + '</strong><br><span class="kd-key">' + esc(m.key) + '</span> ' +
        (m.serve ? '<span class="pill api">API</span>' : '') + '<br><span class="kd-muted">' + esc(m.unit) +
        (m.direction === 'lower' ? ' · ↓' : m.direction === 'higher' ? ' · ↑' : '') + '</span></td>' +
        '<td>' + esc(m.formula) + '</td><td>' + esc(m.window) + '</td><td>' + esc(m.owner) + '</td>' +
        '<td>' + (m.policy ? '<span class="pill">' + esc(m.policy) + '</span>' : '<span class="kd-muted">—</span>') + '</td>' +
        '<td class="kd-muted">' + esc(m.source) + '</td></tr>';
    }).join('');
  }
  document.getElementById('q').addEventListener('input', renderDict);
  document.getElementById('dom').addEventListener('change', renderDict);

  function renderRag() {
    var P = (window.KpiRag && window.KpiRag.POLICIES) || {};
    document.querySelector('#tblRag tbody').innerHTML = Object.keys(P).map(function (k) {
      var p = P[k], g, a, r;
      var pct = function (v) { return p.scale === 1 ? Math.round(v * 100) + ' %' : v; };
      if (p.kind === 'fixed') { g = '≥ ' + pct(p.g); a = '≥ ' + pct(p.a); r = '< ' + pct(p.a); }
      else if (p.kind === 'target') { g = '≥ target'; a = p.ratio === 1 ? '—' : '≥ ' + Math.round(p.ratio * 100) + ' % × target'; r = 'below'; }
      else { g = '≥ target'; a = '≥ target − ' + p.margin; r = 'below'; }
      var used = METRICS.filter(function (m) { return m.policy === k; }).map(function (m) { return esc(m.key); }).join('<br>');
      return '<tr><td><span class="pill">' + esc(k) + '</span></td><td>' + g + '</td><td>' + a + '</td><td>' + r + '</td><td class="kd-key">' + (used || '—') + '</td><td class="kd-muted">' + esc(p.source) + '</td></tr>';
    }).join('');
  }

  var sitesLoaded = false;
  function loadSites() {
    if (sitesLoaded) return; sitesLoaded = true;
    api('/api/registry/sites').then(function (d) {
      var s = d.summary || {};
      document.getElementById('siteKpis').innerHTML = [
        ['Sites', s.sites], ['Flags', s.blocking_issues], ['Sites flagged', s.with_issues],
        ['Several codes', s.several_codes], ['Unmapped asset labels', s.unmapped_asset_labels],
      ].map(function (k) { return '<div class="kd-kpi"><div class="v">' + esc(k[1]) + '</div><div class="l">' + esc(k[0]) + '</div></div>'; }).join('');
      var mods = d.modules || [];
      document.querySelector('#tblSites thead').innerHTML = '<tr><th>Site</th>' + mods.map(function (m) { return '<th>' + esc(m) + '</th>'; }).join('') +
        '<th>Hard-coded</th><th>Asset labels</th><th>Risk register labels</th><th>Flags</th></tr>';
      document.querySelector('#tblSites tbody').innerHTML = (d.sites || []).map(function (r) {
        var hc = r.hard_coded || {};
        var flags = (r.issues || []).map(function (i) { return '<span class="pill ' + (i.info ? 'warn' : 'bad') + '" title="' + esc(i.text) + '">' + esc(i.kind) + '</span>'; }).join(' ');
        return '<tr><td><strong>' + esc(r.name) + '</strong><br><span class="kd-muted">#' + esc(r.site_id) + (r.zoho_group ? ' · ' + esc(r.zoho_group) : '') + '</span></td>' +
          mods.map(function (m) { return '<td class="kd-key">' + esc(r.codes[m] || '—') + '</td>'; }).join('') +
          '<td class="kd-muted">tracker ' + esc(hc.tracker || '—') + '<br>inspection ' + esc(hc.inspection || '—') + '</td>' +
          '<td class="kd-muted">' + esc((r.asset_labels || []).join(', ') || '—') + '</td>' +
          '<td class="kd-muted">' + esc((r.rr_labels || []).join(', ') || '—') + '</td>' +
          '<td>' + (flags || '<span class="pill api">OK</span>') + '<br><span class="kd-muted">' + esc((r.issues || []).filter(function (i) { return !i.info; }).map(function (i) { return i.text; }).join(' ')) + '</span></td></tr>';
      }).join('');
      var u = d.unmapped_asset_labels || [];
      document.getElementById('unmapped').textContent = u.length ? 'Asset labels with no site: ' + u.join(', ') : '';
    }).catch(function (e) {
      sitesLoaded = false;
      document.querySelector('#tblSites tbody').innerHTML = '<tr><td>Could not load the site registry (' + esc(e.message) + ').</td></tr>';
    });
  }

  api('/api/metrics/registry').then(function (d) {
    METRICS = d.metrics || [];
    var doms = [];
    METRICS.forEach(function (m) { if (doms.indexOf(m.domain) < 0) doms.push(m.domain); });
    document.getElementById('dom').insertAdjacentHTML('beforeend', doms.map(function (x) { return '<option value="' + esc(x) + '">' + esc(x) + '</option>'; }).join(''));
    setLang(lang); renderRag();
  }).catch(function (e) {
    document.querySelector('#tblDict tbody').innerHTML = '<tr><td colspan="6">Could not load the dictionary (' + esc(e.message) + ').</td></tr>';
  });

  if (window.__userHasRole && window.__userHasRole('admin')) document.getElementById('tabSites').hidden = false;
})();
