/* site-report.js — live site scoreboard.
 * Fetches GET /api/reports/site-data?site=…&year=…&month=… (session cookie)
 * and renders it. Dependency-free besides Chart.js (loaded via CDN, defer).
 * Renders cleanly with all-zero data; never throws on missing fields.
 */
(function () {
  'use strict';

  // ── Query params ─────────────────────────────────────────────
  var qs = new URLSearchParams(location.search);
  var SITE = (qs.get('site') || '').trim();
  var YEAR = qs.get('year');
  var MONTH = qs.get('month');
  var KIND = qs.get('kind');

  // ── Helpers ──────────────────────────────────────────────────
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function el(id) { return document.getElementById(id); }
  function isNum(v) { return typeof v === 'number' && isFinite(v); }
  function n(v) { return isNum(v) ? v : (isNum(+v) ? +v : 0); }
  function body() { return document.body; }

  function statusChip(status) {
    var s = String(status || '').toLowerCase();
    var known = { on_track: 1, signed: 1, blocked: 1, no_pv: 1 };
    var cls = known[s] ? 'st-' + s : 'st-default';
    var label = String(status || '—').replace(/_/g, ' ');
    return '<span class="chip ' + cls + '">' + esc(label) + '</span>';
  }

  // ── Renderers ────────────────────────────────────────────────
  function renderHeader(data) {
    el('siteName').textContent = (data.site_name || data.site_code || SITE || 'Site Report');
    var p = data.period || {};
    var lbl = p.label || (p.year && p.month ? p.year + '-' + String(p.month).padStart(2, '0') : '');
    var kind = p.kind ? (p.kind.charAt(0).toUpperCase() + p.kind.slice(1)) : '';
    el('periodLabel').innerHTML = (kind ? esc(kind) + ' · ' : '') + '<strong>' + esc(lbl || '—') + '</strong>';
  }

  // The score's RAG palette — the user's own dashboard colours, so this page and
  // their dashboard read as the same score. --color-accent is THEIR token; this
  // page's _tokens.css does not define it, so the source's literal red rides
  // along as the fallback rather than resolving to nothing.
  var SCORE_RAG = { green: '#2f7d4f', amber: '#d99a2b', red: 'var(--color-accent, #c2280f)' };
  // A dim's 0/1/2 rating → its colour. 2 green · 1 amber · 0 red.
  function ptsColor(pts) { return pts >= 2 ? SCORE_RAG.green : pts >= 1 ? SCORE_RAG.amber : SCORE_RAG.red; }

  // Creates the node on first render if the static markup doesn't carry it, so
  // the score hero can state its window without an edit to site-report.html.
  function ensureEl(id, parent, tag, className) {
    var e = el(id);
    if (!e && parent) {
      e = document.createElement(tag || 'div');
      e.id = id;
      if (className) e.className = className;
      parent.appendChild(e);
    }
    return e;
  }

  function renderScore(score) {
    score = score || {};
    // rag is UPPERCASE on the wire ('GREEN'|'AMBER'|'RED'); the stylesheet's
    // classes are lowercase. Fold before matching — a strict compare against
    // the lowercase literals silently painted every site amber.
    var rag = String(score.rag || '').toLowerCase();
    if (rag !== 'green' && rag !== 'amber' && rag !== 'red') rag = 'amber';
    var color = SCORE_RAG[rag];

    var hero = el('heroSection');
    hero.className = 'card hero rag-' + rag;

    var sv = el('scoreVal');
    sv.textContent = n(score.score);
    sv.style.color = color;

    // points (n/12) — the raw sbDims total behind the 0-100 score.
    var pts = ensureEl('scorePoints', sv.parentNode && sv.parentNode.parentNode, 'div');
    if (pts) {
      pts.style.cssText = 'font-size:.8rem;font-weight:700;color:var(--color-text-muted,#7B7B7B);margin-top:4px';
      pts.textContent = n(score.points) + ' / 12 pts';
    }

    var chip = el('scoreChip');
    chip.className = 'score-chip chip-' + rag;
    chip.style.background = color;
    chip.style.color = '#fff';
    chip.textContent = rag === 'green' ? 'On track' : rag === 'red' ? 'Off track' : 'At risk';

    var t = el('scoreTrend');
    if (score.trend_pts == null) {
      t.className = 'score-trend trend-flat';
      t.textContent = 'No prior window';
    } else {
      var tp = n(score.trend_pts);
      var cls = tp > 0 ? 'trend-good' : tp < 0 ? 'trend-bad' : 'trend-flat';
      var arrow = tp > 0 ? '▲' : tp < 0 ? '▼' : '·';
      t.className = 'score-trend ' + cls;
      t.textContent = arrow + ' ' + (tp > 0 ? '+' : '') + tp + ' pts vs the previous 3 months';
    }

    // The score measures a 3-MONTH ROLLING window; every other section on this
    // page is the report month. Unlabelled, the two read as a contradiction.
    var grid = el('dimsGrid');
    var w = score.window || {};
    var win = ensureEl('scoreWindow', grid && grid.parentNode, 'div');
    if (win) {
      win.style.cssText = 'font-size:.72rem;color:var(--color-text-muted,#7B7B7B);margin:-4px 0 10px';
      win.textContent = w.from && w.to
        ? 'Scored over the 3 months ' + w.from + ' → ' + w.to + ' — a rolling window. Every other section covers the report period only.'
        : '';
      if (grid && win.nextSibling !== grid) grid.parentNode.insertBefore(win, grid);
    }

    var dims = Array.isArray(score.dims) ? score.dims : [];
    grid.innerHTML = dims.length
      ? dims.map(function (d) {
          d = d || {};
          var c = ptsColor(n(d.pts));
          return '<div class="dim" style="border-left:3px solid ' + c + '" title="' + esc(d.tip) + '">' +
            '<div class="dim-label">' + esc(d.label) + '</div>' +
            '<div class="dim-val">' + esc(d.disp) + ' ' +
              '<span style="display:inline-block;font-size:.6rem;font-weight:800;color:#fff;background:' + c +
              ';border-radius:8px;padding:1px 6px;vertical-align:middle">' + n(d.pts) + '/2</span></div>' +
            '<div style="font-size:.62rem;color:var(--color-text-muted,#7B7B7B);margin-top:3px;line-height:1.35">' + esc(d.tip) + '</div>' +
          '</div>';
        }).join('')
      : '<div class="muted">No score dimensions for this period.</div>';

    // `gain` arrives ALREADY formatted ('+17 pts' / 'sustain') — render verbatim.
    var moves = Array.isArray(score.moves) ? score.moves : [];
    el('movesList').innerHTML = moves.length
      ? moves.map(function (m) {
          m = m || {};
          return '<li><span>' + esc(m.text) + '</span>' +
            '<span class="move-gain">' + esc(m.gain) + '</span></li>';
        }).join('')
      : '<li><span>No score gaps — this site is at full marks.</span></li>';
  }

  function kpi(label, val, cls) {
    return '<div class="kpi"><div class="kpi-label">' + esc(label) + '</div>' +
      '<div class="kpi-val' + (cls ? ' ' + cls : '') + '">' + esc(val) + '</div></div>';
  }

  function renderMeetings(m) {
    m = m || {};
    el('mtgKpis').innerHTML = [
      kpi('PVs held', n(m.pvs_held) + ' / ' + n(m.pvs_target)),
      kpi('Open issues', n(m.open_issues)),
      kpi('HIGH open', n(m.high_open), n(m.high_open) > 0 ? 'bad' : ''),
      kpi('Resolved / New', n(m.resolved) + ' / ' + n(m.new)),
      kpi('Escalations', n(m.escalations), n(m.escalations) > 0 ? 'warn' : '')
    ].join('');

    var depts = Array.isArray(m.departments) ? m.departments : [];
    el('mtgDepts').innerHTML = depts.length
      ? '<table class="tbl"><thead><tr><th>Department</th><th>Status</th><th>Last PV</th></tr></thead><tbody>' +
        depts.map(function (d) {
          return '<tr><td>' + esc(d.department || '—') + '</td>' +
            '<td>' + statusChip(d.status) + '</td>' +
            '<td>' + esc(d.last_pv || '—') + '</td></tr>';
        }).join('') + '</tbody></table>'
      : '<div class="muted">No departments on record for this period.</div>';

    el('mtgActions').innerHTML = renderActionList(m.overdue_actions, 'target_date');
  }

  function renderActionList(actions, dateKey) {
    var list = Array.isArray(actions) ? actions : [];
    if (!list.length) return '<div class="muted">No overdue actions.</div>';
    return list.map(function (a) {
      var meta = [];
      if (a.owner) meta.push(esc(a.owner));
      if (a[dateKey]) meta.push('due ' + esc(a[dateKey]));
      return '<div class="oa-row"><span>' + esc(a.description || '—') + '</span>' +
        '<span class="oa-meta">' + meta.join(' · ') + '</span></div>';
    }).join('');
  }

  function renderInspection(i) {
    i = i || {};
    el('inspKpis').innerHTML = [
      kpi('Inspections done', n(i.inspections_done)),
      kpi('Critical / major findings', n(i.findings_critical_major), n(i.findings_critical_major) > 0 ? 'bad' : ''),
      kpi('Overall risk', i.overall_risk || '—')
    ].join('');
    el('inspActions').innerHTML = renderActionList(i.overdue_actions, 'due_date');
  }

  var hdChart = null;
  function renderHelpdesk(h) {
    h = h || {};
    el('hdKpis').innerHTML = [
      kpi('Created', n(h.created)),
      kpi('Resolved', n(h.resolved)),
      kpi('Backlog', n(h.backlog), n(h.backlog) > 0 ? 'warn' : ''),
      kpi('SLA overdue', n(h.sla_overdue), n(h.sla_overdue) > 0 ? 'bad' : ''),
      kpi('Major incidents', n(h.major_incidents), n(h.major_incidents) > 0 ? 'bad' : '')
    ].join('');

    var cats = Array.isArray(h.top_categories) ? h.top_categories.filter(function (c) { return c && c.category; }) : [];
    var canvas = el('hdChart');
    var emptyMsg = el('hdChartEmpty');
    if (hdChart) { hdChart.destroy(); hdChart = null; }

    if (!cats.length || typeof Chart === 'undefined') {
      canvas.style.display = 'none';
      emptyMsg.style.display = '';
      if (typeof Chart === 'undefined' && cats.length) emptyMsg.textContent = 'Chart library unavailable.';
      return;
    }
    canvas.style.display = '';
    emptyMsg.style.display = 'none';
    hdChart = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: cats.map(function (c) { return c.category; }),
        datasets: [{
          label: 'Tickets',
          data: cats.map(function (c) { return n(c.count); }),
          backgroundColor: '#145FAE',
          borderRadius: 4,
          maxBarThickness: 34
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, ticks: { precision: 0 } },
          y: { ticks: { autoSkip: false } }
        }
      }
    });
  }

  function renderTechnicians(techs) {
    var list = Array.isArray(techs) ? techs : [];
    if (!list.length) {
      el('techArea').innerHTML = '<div class="muted">No technician activity for this period.</div>';
      return;
    }
    el('techArea').innerHTML =
      '<table class="tbl"><thead><tr>' +
      '<th>Name</th><th class="num">Assigned</th><th class="num">Resolved</th>' +
      '<th class="num">Avg res (h)</th><th class="num">Reopened</th><th class="num">Load</th><th>Alerts</th>' +
      '</tr></thead><tbody>' +
      list.map(function (t) {
        var alerts = Array.isArray(t.alerts) ? t.alerts : [];
        var alertHtml = alerts.length
          ? alerts.map(function (a) { return '<span class="alert-chip">' + esc(String(a).replace(/_/g, ' ')) + '</span>'; }).join('')
          : '<span class="muted">—</span>';
        return '<tr>' +
          '<td>' + esc(t.name || '—') + '</td>' +
          '<td class="num">' + n(t.assigned) + '</td>' +
          '<td class="num">' + n(t.resolved) + '</td>' +
          '<td class="num">' + n(t.avg_resolution_h) + '</td>' +
          '<td class="num">' + n(t.reopened) + '</td>' +
          '<td class="num">' + n(t.current_load) + '</td>' +
          '<td>' + alertHtml + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table>';
  }

  function renderRecommended(recs) {
    var list = Array.isArray(recs) ? recs : [];
    el('recList').innerHTML = list.length
      ? list.map(function (r) {
          return '<li><span class="rec-kind">' + esc(r.kind || 'note') + '</span>' +
            '<span>' + esc(r.text || '') + '</span></li>';
        }).join('')
      : '<li><span class="rec-kind">ok</span><span>No recommended actions — nothing flagged this period.</span></li>';
  }

  // ── Main render ──────────────────────────────────────────────
  function render(data) {
    body().className = '';
    renderHeader(data);
    renderScore(data.score);
    renderMeetings(data.meetings);
    renderInspection(data.inspection);
    renderHelpdesk(data.helpdesk);
    renderTechnicians(data.technicians);
    renderRecommended(data.recommended);
  }

  function showEmpty() { body().className = 'state-empty'; }
  function showError(msg) {
    body().className = 'state-error';
    if (msg) el('errorMsg').textContent = msg;
  }

  // ── Fetch ────────────────────────────────────────────────────
  var inFlight = false;
  function load() {
    if (inFlight) return;
    // No site (or consolidated 'all') → empty state, no fetch.
    if (!SITE || SITE.toLowerCase() === 'all') { showEmpty(); return; }

    inFlight = true;
    var url = '/api/reports/site-data?site=' + encodeURIComponent(SITE);
    if (YEAR) url += '&year=' + encodeURIComponent(YEAR);
    if (MONTH) url += '&month=' + encodeURIComponent(MONTH);
    if (KIND) url += '&kind=' + encodeURIComponent(KIND);

    fetch(url, { credentials: 'same-origin', headers: { 'Accept': 'application/json' }, cache: 'no-store' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (data) {
        if (!data || data.error) throw new Error((data && data.error) || 'unavailable');
        if (data.consolidated || data.site_code === 'all') { showEmpty(); return; }
        render(data);
      })
      .catch(function (e) {
        showError('Could not load this site report' + (e && e.message ? ' (' + e.message + ')' : '') + '.');
      })
      .then(function () { inFlight = false; });
  }

  // ── Wire up ──────────────────────────────────────────────────
  function ready(fn) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn);
    else fn();
  }
  ready(function () {
    var rb = el('refreshBtn'); if (rb) rb.addEventListener('click', load);
    var er = el('errorRetry'); if (er) er.addEventListener('click', load);
    load();
  });
})();
