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

  // applicable:false — no number, no RAG, no dims, no moves. The hero states the
  // absence and the window it looked in, and nothing else. Both hero columns are
  // rewritten because the '/100' and the two <h3> headings are STATIC markup in
  // site-report.html: leaving them and blanking the values would render a grey
  // '—/100' under a "Score dimensions" heading — exactly the false verdict this
  // removes.
  function renderScoreNA(score) {
    var hero = el('heroSection');
    if (hero) hero.className = 'card hero';

    // The intro is STATIC markup, so two of its parts would survive into a
    // report that has none of what they describe. Drop both — the same rule the
    // email applies in intro()/ragLegend() (reportTemplates/coordinator.js):
    //   · the "start with the two moves" pointer — there are no moves;
    //   · the RAG legend — no score chip, no dims, so no colours to decode.
    // The rest of the intro still helps: it says what the score would measure.
    ['introMovesEn', 'introMovesFr'].forEach(function (id) {
      var s = el(id);
      if (s) s.style.display = 'none';
    });
    var legends = document.querySelectorAll('.intro-legend');
    for (var i = 0; i < legends.length; i++) legends[i].style.display = 'none';

    var sv = el('scoreVal');
    var numBlock = sv && sv.parentNode && sv.parentNode.parentNode;   // .hero-score
    if (numBlock) numBlock.style.display = 'none';

    var w = (score && score.window) || {};
    var side = el('dimsGrid') && el('dimsGrid').parentNode;           // .hero-side
    if (side) {
      side.innerHTML =
        '<h3 style="margin:0">Score non applicable — aucune donnée sur la fenêtre</h3>' +
        (w.from && w.to
          ? '<div style="font-size:.78rem;color:var(--color-text-muted,#7B7B7B);margin-top:8px;line-height:1.5">' +
            'Fenêtre : ' + esc(w.from) + ' → ' + esc(w.to) +
            ' — aucune réunion, inspection ou action mesurée sur cette période.</div>'
          : '');
    }
  }

  function renderScore(score) {
    score = score || {};

    // No data over the window → claim NO verdict. Not a grey '—/100', and no
    // empty dims/moves lists: both still read as a measurement. The score's two
    // inverted dims (overdue/findings) meant an unmeasured site scored RED 33.
    // Keys on applicable === false: the engine always sets the field, so a block
    // that merely lacks it is a legacy shape and keeps its previous rendering.
    if (score.applicable === false) { renderScoreNA(score); return; }

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

    // The score measures a 3-MONTH ROLLING window, which is NOT the report
    // period. This line may only speak for the SCORE: it used to end "Every
    // other section covers the report period only", which is false for four
    // blocks — the meetings backlog counters carry no date filter at all, both
    // overdue-action lists run over the whole history up to today, and the
    // asset-parc figures are today's snapshot. Each section now states its own
    // window; this line points at them.
    var grid = el('dimsGrid');
    var w = score.window || {};
    var win = ensureEl('scoreWindow', grid && grid.parentNode, 'div');
    if (win) {
      win.style.cssText = 'font-size:.72rem;color:var(--color-text-muted,#7B7B7B);margin:-4px 0 10px';
      win.textContent = w.from && w.to
        ? 'Scored over the 3 months ' + w.from + ' → ' + w.to + ' — a rolling window, not the report period. Each section below states the window its own figures cover.'
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

  // ── Window labelling ─────────────────────────────────────────
  // This page mixes THREE grains and used to say so nowhere near the numbers:
  // the report month (helpdesk / changes / technicians / inspections run / PVs
  // held / issues resolved+new), the whole history (open issues, HIGH open,
  // escalations — no date filter at all — plus BOTH overdue-action lists, which
  // stop at today), and today (the asset parc). Unlabelled, six pairs of those
  // read as contradictions. Same copy as the email: one product, one wording —
  // keep services/reportTemplates/coordinator.js in step.
  //
  // The note node is created on first render so this ships without an edit to
  // site-report.html, exactly like the score hero's window line above.
  function setWindowNote(id, hostId, text) {
    var host = el(hostId);
    var sec = host && host.closest ? host.closest('section') : null;
    if (!sec) return;
    var e = el(id);
    if (!e) {
      e = document.createElement('div');
      e.id = id;
      e.className = 'win-note';
      e.style.cssText = 'font-size:.68rem;font-style:italic;color:var(--color-text-muted,#7B7B7B);margin:-4px 0 11px;line-height:1.45';
      var title = sec.querySelector('.section-title');
      if (title && title.nextSibling) sec.insertBefore(e, title.nextSibling);
      else sec.insertBefore(e, sec.firstChild);
    }
    e.textContent = text;   // textContent, not innerHTML — the label carries no markup
  }

  function subHead(text) {
    return '<div style="font-size:.68rem;font-weight:700;letter-spacing:.06em;text-transform:uppercase;' +
      'color:var(--color-text-muted,#7B7B7B);margin:2px 0 8px">' + esc(text) + '</div>';
  }

  // The report's as-of date: the SCORE window's end, i.e. _asOfFor(period) — the
  // last day of the report month, or today for an MTD send. Never a live clock,
  // so the page and the emailed PDF of the same report agree.
  function windowCtx(data) {
    var w = ((data || {}).score || {}).window || {};
    var p = (data || {}).period || {};
    return {
      period: p.label || 'le mois du rapport',
      history: w.to ? "tout l'historique, au " + w.to : "tout l'historique, à ce jour"
    };
  }

  function renderMeetings(m, ctx) {
    m = m || {};
    ctx = ctx || {};
    // THREE windows in this one section. `Departments with a PV / target` — NOT
    // `PVs held / target`: the target is Engagement #1, three DISTINCT
    // DEPARTMENTS, so five PVs of the same department used to read "5 / 3 —
    // target met". The PV volume keeps its own tile so nothing is lost.
    var host = el('mtgKpis');
    host.className = '';                     // wraps two grids now, is not one itself
    host.innerHTML =
      subHead('Ce mois-ci — ' + ctx.period) +
      '<div class="kpis">' + [
        kpi('Departments with a PV / target', n(m.depts_with_pv) + ' / ' + n(m.pvs_target),
          n(m.depts_with_pv) < n(m.pvs_target) ? 'warn' : ''),
        kpi('PVs held', n(m.pvs_held)),
        kpi('Issues resolved', n(m.resolved)),
        kpi('New issues', n(m.new))
      ].join('') + '</div>' +
      subHead("Encours — cumul depuis l'origine, toutes périodes confondues") +
      '<div class="kpis" style="margin-top:2px">' + [
        kpi('Open issues', n(m.open_issues)),
        kpi('HIGH open', n(m.high_open), n(m.high_open) > 0 ? 'bad' : ''),
        kpi('Escalations open', n(m.escalations), n(m.escalations) > 0 ? 'warn' : '')
      ].join('') + '</div>';

    setWindowNote('mtgWindow', 'mtgKpis',
      'Trois fenêtres dans cette section — chaque bloc indique la sienne. Période du rapport : ' +
      ctx.period + ' · actions en retard : ' + ctx.history + '.');

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

  function renderInspection(i, ctx) {
    i = i || {};
    ctx = ctx || {};
    el('inspKpis').innerHTML = [
      kpi('Inspections done', n(i.inspections_done)),
      kpi('Critical / major findings', n(i.findings_critical_major), n(i.findings_critical_major) > 0 ? 'bad' : ''),
      kpi('Overall risk', i.overall_risk || '—')
    ].join('');
    // Inspections run + findings are month-scoped (siteReportDeps passes
    // _monthBounds); the overdue list below them is not.
    setWindowNote('inspWindow', 'inspKpis',
      'Période : ' + ctx.period + ' · actions en retard : ' + ctx.history + '.');
    el('inspActions').innerHTML = renderActionList(i.overdue_actions, 'due_date');
  }

  var hdChart = null;
  function renderHelpdesk(h, ctx) {
    h = h || {};
    ctx = ctx || {};
    el('hdKpis').innerHTML = [
      kpi('Created', n(h.created)),
      kpi('Resolved', n(h.resolved)),
      kpi('Backlog', n(h.backlog), n(h.backlog) > 0 ? 'warn' : ''),
      kpi('SLA overdue', n(h.sla_overdue), n(h.sla_overdue) > 0 ? 'bad' : ''),
      kpi('Major incidents', n(h.major_incidents), n(h.major_incidents) > 0 ? 'bad' : '')
    ].join('');

    setWindowNote('hdWindow', 'hdKpis',
      'Période : ' + ctx.period + ' · « Open major incidents » ci-dessous : état actuel, hors période.');

    // The incidents still RUNNING — a different population from the tile above,
    // which counts the ones raised this period. Labelled, so the two never read
    // as a contradiction when they disagree.
    var mis = Array.isArray(h.major_incidents_open) ? h.major_incidents_open : [];
    var miBox = ensureEl('hdMiList', el('hdKpis') && el('hdKpis').parentNode, 'div');
    if (miBox) {
      miBox.style.cssText = 'margin-top:14px';
      miBox.innerHTML = mis.length
        ? '<div class="card panel"><h2>Open major incidents (' + mis.length + ') — still running now</h2>' +
          mis.map(function (mi) {
            mi = mi || {};
            var bits = [mi.status, mi.downtime ? mi.downtime + ' down' : '',
              mi.created_time ? 'opened ' + String(mi.created_time).slice(0, 10) : ''].filter(Boolean);
            return '<div class="oa-row"><span>' +
              '<strong>' + esc(mi.display_id || '—') + '</strong> ' + esc(mi.subject || '—') +
              (mi.overdue ? ' <span class="alert-chip">late</span>' : '') + '</span>' +
              '<span class="oa-meta">' + esc(bits.join(' · ')) + '</span></div>';
          }).join('') + '</div>'
        : '';
    }

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

  // Creates the Changes section on first render, right after Helpdesk, so the
  // block ships without an edit to site-report.html — same reasoning as the
  // score hero's window line above.
  function ensureChangesSection() {
    var host = el('chgKpis');
    if (host) return host;
    var hd = el('hdKpis');
    var after = hd && hd.closest ? hd.closest('section') : null;
    if (!after || !after.parentNode) return null;
    var sec = document.createElement('section');
    sec.className = 'section';
    sec.id = 'chgSection';
    sec.innerHTML =
      '<div class="section-title">Changes</div>' +
      '<div class="kpis" id="chgKpis"></div>' +
      '<div id="chgNote" class="muted" style="margin-top:10px;font-size:.72rem;line-height:1.5"></div>';
    after.parentNode.insertBefore(sec, after.nextSibling);
    return el('chgKpis');
  }

  // PLAIN WORDS — this page is read by site coordinators. No "RFC", no "CAB".
  function renderChanges(c, ctx) {
    c = c || {};
    ctx = ctx || {};
    var host = ensureChangesSection();
    if (!host) return;
    setWindowNote('chgWindow', 'chgKpis', 'Période : ' + ctx.period + '.');

    // null → '—'. NOT n(success_pct): n(null) is 0, which would state a verdict
    // ("0% succeeded") for a site with nothing to judge. A real 0 still prints 0%.
    var hasPct = c.success_pct !== null && c.success_pct !== undefined;
    var pct = hasPct ? n(c.success_pct) + '%' : '—';
    var pctCls = !hasPct ? '' : n(c.success_pct) < 75 ? 'bad' : n(c.success_pct) < 90 ? 'warn' : '';

    host.innerHTML = [
      kpi('Changes', n(c.total)),
      kpi('Successful', n(c.successful)),
      kpi('Failed', n(c.failed), n(c.failed) > 0 ? 'bad' : ''),
      kpi('Emergency', n(c.emergency), n(c.emergency) > 0 ? 'warn' : ''),
      kpi('Success rate', pct, pctCls)
    ].join('');

    var backedOut = n((c.buckets || {}).backed_out);
    var note = el('chgNote');
    if (note) {
      note.textContent = [
        hasPct
          ? 'Success rate is ' + n(c.successful) + ' of the ' + n(c.executed) + ' change(s) actually carried out this month.'
          : 'No change was carried out this month — there is no success rate to report.',
        backedOut ? backedOut + ' change(s) were backed out — counted under Failed.' : '',
        n(c.pending) ? n(c.pending) + ' change(s) are still in progress.' : ''
      ].filter(Boolean).join(' ');
    }
  }

  function renderTechnicians(techs, ctx) {
    var list = Array.isArray(techs) ? techs : [];
    setWindowNote('techWindow', 'techArea', 'Période : ' + ((ctx || {}).period || '') + '.');
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
        // null → '—'. NOT n(avg_resolution_h): n(null) is 0, which states "0h"
        // — the best possible resolution time — for a technician who closed
        // nothing (reports-db.js:1896 returns null there on purpose). `== null`
        // covers undefined too; `||` would also swallow a genuine measured 0h.
        var avg = t.avg_resolution_h == null ? '—' : n(t.avg_resolution_h);
        return '<tr>' +
          '<td>' + esc(t.name || '—') + '</td>' +
          '<td class="num">' + n(t.assigned) + '</td>' +
          '<td class="num">' + n(t.resolved) + '</td>' +
          '<td class="num">' + avg + '</td>' +
          '<td class="num">' + n(t.reopened) + '</td>' +
          '<td class="num">' + n(t.current_load) + '</td>' +
          '<td>' + alertHtml + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table>';
  }

  // An EMPTY list has two meanings that must not share a sentence. _recommend
  // (services/siteReport.js) only pushes on a POSITIVE signal, so a site with no
  // data produces the same empty list as a site measured and found clean — and
  // the reassuring line then contradicted the hero's "Score non applicable —
  // aucune donnée sur la fenêtre" further up the very same page.
  function renderRecommended(recs, score) {
    var list = Array.isArray(recs) ? recs : [];
    var unscored = !!score && score.applicable === false;
    el('recList').innerHTML = list.length
      ? list.map(function (r) {
          return '<li><span class="rec-kind">' + esc(r.kind || 'note') + '</span>' +
            '<span>' + esc(r.text || '') + '</span></li>';
        }).join('')
      : unscored
        ? '<li><span class="rec-kind">n/a</span><span>Aucune donnée sur la période — rien à recommander.</span></li>'
        : '<li><span class="rec-kind">ok</span><span>No recommended actions — nothing flagged this period.</span></li>';
  }

  // ── Main render ──────────────────────────────────────────────
  function render(data) {
    body().className = '';
    // One window context, built once and handed to every section — same shape
    // and same copy as composeCoordinator's `ctx`.
    var ctx = windowCtx(data);
    renderHeader(data);
    renderScore(data.score);
    renderMeetings(data.meetings, ctx);
    renderInspection(data.inspection, ctx);
    renderHelpdesk(data.helpdesk, ctx);
    renderChanges(data.changes, ctx);
    renderTechnicians(data.technicians, ctx);
    renderRecommended(data.recommended, data.score);
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
