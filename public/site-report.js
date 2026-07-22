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
      code: (data || {}).site_code || SITE || '',
      period: p.label || 'le mois du rapport',
      history: w.to ? "tout l'historique, au " + w.to : "tout l'historique, à ce jour"
    };
  }

  // ── "What do I do about this?" callouts ──────────────────────
  // The single most common reason a figure on this report is wrong is that the
  // WORK WAS DONE and never recorded. Reading that as a performance problem
  // wastes the coordinator's month and quietly lowers the site's score, because
  // `overdue` is one of the six scored dimensions. So each block that can be
  // stale says, in place, exactly where to go and what to click.
  function howTo(title, body) {
    return '<div style="margin-top:12px;background:var(--color-warning-bg,#FEF3C7);' +
      'border:1px solid #f0dca4;border-left:4px solid var(--color-warning,#D97706);' +
      'border-radius:9px;padding:10px 13px;font-size:.8rem;line-height:1.55;color:var(--edv-slate,#3A4A60)">' +
      '<strong>' + esc(title) + '</strong><br>' + body + '</div>';
  }
  function actionLink(href, label) {
    return '<a href="' + esc(href) + '" style="color:var(--edv-blue,#145FAE);font-weight:700">' + esc(label) + ' →</a>';
  }
  // The two registers close an action even when its parent PV / inspection is
  // already submitted or closed — an action outlives the meeting that raised it —
  // so "the PV is signed, I can't touch it any more" is not a reason to leave a
  // done action open. Both writes are audited (who / when / transition).
  function overdueHowTo(register, code) {
    var href = register + '.html?site=' + encodeURIComponent(code || '') + '&overdue=1';
    return howTo('Déjà fait sur le terrain, mais toujours en retard ici ?',
      'Une action reste comptée en retard tant qu’elle n’est pas clôturée dans le système — et « en retard » est l’une des six dimensions notées, donc cela pèse sur le score du site.<br>' +
      '<strong>1.</strong> Ouvrez le registre : ' + actionLink(href, 'Registre des actions (filtré sur ce site)') + '<br>' +
      '<strong>2.</strong> Sur la ligne concernée, passez le statut à <em>Terminé / Résolu</em>. La clôture est horodatée et tracée à votre nom.<br>' +
      '<strong>3.</strong> Si l’action n’est PAS faite : convenez d’une nouvelle échéance réaliste avec le responsable et corrigez la date, plutôt que de la laisser courir.<br>' +
      '<span style="color:#8a6d1f">Le PV signé ou clôturé ne bloque pas : une action se ferme après la réunion qui l’a créée.</span>');
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

    // The how-to rides only when there IS something overdue: on a clean site it
    // would be a permanent block of instructions nobody needs, and readers who
    // learn to skip a box skip it on the week it matters.
    var mOverdue = Array.isArray(m.overdue_actions) ? m.overdue_actions : [];
    el('mtgActions').innerHTML = renderActionList(m.overdue_actions, 'target_date') +
      (mOverdue.length ? overdueHowTo('meetings-actions', ctx.code) : '');
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
    var iOverdue = Array.isArray(i.overdue_actions) ? i.overdue_actions : [];
    el('inspActions').innerHTML = renderActionList(i.overdue_actions, 'due_date') +
      (iOverdue.length ? overdueHowTo('inspection-actions', ctx.code) : '');
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
      '<div id="chgNote" class="muted" style="margin-top:10px;font-size:.72rem;line-height:1.5"></div>' +
      '<div id="chgOpen"></div>';
    after.parentNode.insertBefore(sec, after.nextSibling);
    return el('chgKpis');
  }

  // Deep link into ServiceDesk Plus, where the status actually gets changed.
  //
  // VERIFIED against a live change (CHG 164 → CHANGEID=212627000012820152), not
  // inferred. Changes do NOT follow the requests route
  // (/app/itdesk/ui/requests/<id>/details, dashboard-shared.js:260) — they use
  // the older .cc handler with the id as a QUERY parameter. Assuming the two
  // were siblings produced a dead link, so do not "tidy" this back into the
  // requests shape.
  //
  // `CHANGEID` is our `change_id` column (the long internal id), NOT display_id
  // — 164 is what the human sees, 212627000012820152 is what the URL needs.
  //
  // The trailing tab params are kept exactly as SDP itself emits them. Deriving
  // the tab from the change's stage would mean guessing tab names, which is the
  // mistake this comment exists to prevent; a change opened on a tab that is not
  // its current stage is a small annoyance, a wrong tab name is a broken link.
  var SDP_CHANGE_URL_BASE = 'https://oneitsupport.endeavourmining.com/app/itdesk/ChangeDetails.cc?CHANGEID=';
  var SDP_CHANGE_URL_TAIL = '&selectTab=implementation&subTab=details';
  function sdpChangeUrl(changeId) { return SDP_CHANGE_URL_BASE + encodeURIComponent(changeId) + SDP_CHANGE_URL_TAIL; }

  // The table is a preview, capped so the report stays readable; the CSV export
  // always carries EVERY row. Never silently truncate without saying so.
  var OPEN_CHG_PREVIEW = 25;

  // Client-side CSV — no new route needed, the rows are already in the payload.
  // UTF-8 BOM + CRLF + quote-escaped, same recipe as the Assets drill export, so
  // Excel opens accented names correctly on a French Windows.
  function downloadCsv(filename, columns, rows) {
    var esc2 = function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; };
    var lines = [columns.map(function (col) { return esc2(col[0]); }).join(',')];
    rows.forEach(function (r) { lines.push(columns.map(function (col) { return esc2(r[col[1]]); }).join(',')); });
    var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  }

  // The whole reason this block exists: the month tiles above can read 0/0/0 for
  // a site that is carrying changes open since last year. A monthly figure alone
  // lets stalled work stay invisible indefinitely.
  function renderOpenChanges(oc, ctx) {
    var host = el('chgOpen');
    if (!host) return;
    // null = the site could not be resolved (no group). Not "nothing open".
    if (!oc) { host.innerHTML = ''; return; }

    var rows = Array.isArray(oc.rows) ? oc.rows : [];
    if (!n(oc.total)) {
      host.innerHTML = '<div class="muted" style="margin-top:12px;font-size:.78rem">' +
        'Aucun changement en cours pour ce site — rien à faire avancer. 🎉</div>';
      return;
    }

    var stages = Array.isArray(oc.by_stage) ? oc.by_stage : [];
    var pipeline = stages.map(function (s) {
      return '<span style="display:inline-block;background:#fff;border:1px solid var(--color-border,#E2E5EA);' +
        'border-radius:20px;padding:3px 11px;margin:0 6px 6px 0;font-size:.78rem">' +
        esc(s.stage) + ' <strong style="color:var(--edv-slate,#3A4A60)">' + n(s.n) + '</strong></span>';
    }).join('');

    var shown = rows.slice(0, OPEN_CHG_PREVIEW);
    var table = '<table class="tbl"><thead><tr>' +
      '<th>Réf</th><th>Sujet</th><th>Étape · statut</th><th>Fin prévue</th><th class="num">Âge</th>' +
      '</tr></thead><tbody>' +
      shown.map(function (r) {
        var ref = r.change_id
          ? '<a href="' + esc(sdpChangeUrl(r.change_id)) + '" target="_blank" rel="noopener" ' +
            'style="color:var(--edv-blue,#145FAE);font-weight:700">' + esc(r.display_id || r.change_id) + ' ↗</a>'
          : esc(r.display_id || '—');
        return '<tr>' +
          '<td>' + ref + (r.emergency ? ' <span class="alert-chip">urgence</span>' : '') + '</td>' +
          '<td>' + esc(r.subject || '—') + '</td>' +
          '<td>' + esc(r.stage) + ' · ' + esc(r.status) + '</td>' +
          '<td>' + (r.scheduled_end
            ? esc(r.scheduled_end) + (r.overdue ? ' <span class="alert-chip">dépassée</span>' : '')
            : '<span class="muted">non planifiée</span>') + '</td>' +
          '<td class="num">' + (r.age_days == null ? '—' : n(r.age_days) + ' j') + '</td>' +
          '</tr>';
      }).join('') + '</tbody></table>';

    host.innerHTML =
      subHead('En cours — état actuel, hors période du rapport') +
      '<div class="kpis" style="margin-bottom:12px">' + [
        kpi('Changements ouverts', n(oc.total)),
        kpi('Fin prévue dépassée', n(oc.overdue), n(oc.overdue) > 0 ? 'bad' : ''),
        kpi('Sans date de fin', n(oc.no_planned_end), n(oc.no_planned_end) > 0 ? 'warn' : ''),
        kpi('Le plus ancien', oc.oldest_days == null ? '—' : n(oc.oldest_days) + ' j',
          n(oc.oldest_days) > 180 ? 'bad' : n(oc.oldest_days) > 90 ? 'warn' : '')
      ].join('') + '</div>' +
      '<div style="margin-bottom:10px">' + pipeline + '</div>' +
      '<div class="card panel"><h2>Changements à faire avancer</h2>' + table +
        (rows.length > shown.length
          ? '<div class="muted" style="margin-top:8px;font-size:.74rem">' +
            shown.length + ' des ' + rows.length + ' changements ouverts affichés (les plus en retard d’abord) — l’export CSV les contient tous.</div>'
          : '') +
        '<div style="margin-top:12px"><button type="button" id="chgCsvBtn" class="sr-refresh" ' +
          'style="background:var(--edv-orange,#EF631A);border:none">⬇ Exporter la liste (CSV)</button></div>' +
        howTo('Changement déjà réalisé, mais toujours ouvert ici ?',
          'Un changement reste « en cours » tant que son statut n’a pas bougé dans SDP — c’est ce qui laisse des demandes ouvertes depuis plus d’un an.<br>' +
          '<strong>En <em>Implementation</em> et le travail est fait</strong> : passez-le en <em>Completed</em> dans SDP (cliquez la référence ci-dessus), ou demandez au change manager de le faire.<br>' +
          '<strong>En <em>Close · In Progress</em></strong> : il ne manque plus que la clôture finale.<br>' +
          '<strong>Une fois complété</strong> : poussez-le au stade <em>Review</em> pour qu’il passe au prochain comité de revue des changements (CAB) — sans cela il n’y entre jamais.<br>' +
          '<strong>Fin prévue dépassée ou non planifiée</strong> : convenez d’une date réaliste avec l’équipe et corrigez-la, plutôt que de la laisser courir.<br>' +
          '<span style="color:#8a6d1f">Exportez la liste et passez-la en revue avec votre équipe : c’est le point d’avancement à tenir chaque mois.</span>') +
      '</div>';

    var btn = el('chgCsvBtn');
    if (btn) btn.addEventListener('click', function () {
      downloadCsv('Changements-ouverts_' + (ctx.code || 'site') + '.csv', [
        ['Reference', 'display_id'], ['Sujet', 'subject'], ['Etape', 'stage'], ['Statut', 'status'],
        ['Risque', 'risk'], ['Urgence', 'emergency'], ['Change manager', 'manager'], ['Demandeur', 'requester'],
        ['Fin prevue', 'scheduled_end'], ['Fin depassee', 'overdue'], ['Cree le', 'created_time'], ['Age (jours)', 'age_days'],
      ], rows);
    });
  }

  // PLAIN WORDS — this page is read by site coordinators. No "RFC"; "CAB" appears
  // once, in the open-changes how-to, spelled out as "comité de revue des
  // changements (CAB)" because the instruction IS to get the change into that
  // committee and there is no other name for it. The coordinator EMAIL keeps the
  // stricter rule (tests/report-template-coordinator.test.js:185 asserts it).
  // Stage names stay in English on purpose: they are the literal values shown in
  // SDP, and translating them would send the reader looking for a status that
  // does not exist in the tool they are about to open.
  function renderChanges(c, oc, ctx) {
    c = c || {};
    ctx = ctx || {};
    var host = ensureChangesSection();
    if (!host) return;
    // TWO windows in this section now, so the label may no longer claim only one:
    // the tiles are the report month, the "En cours" block below is current state.
    setWindowNote('chgWindow', 'chgKpis',
      'Période : ' + ctx.period + ' · « En cours » ci-dessous : état actuel, hors période.');

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

    renderOpenChanges(oc, ctx);
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

  // ── IT assets — compliance ───────────────────────────────────
  // The point of this block is ACTION, not information: every count links
  // straight into the Assets module's hygiene worklist, pre-filtered on this
  // site and that kind, where the per-asset list and the Excel export already
  // live. A count with no way through is a count nobody works.
  //
  // Labels mirror HYGIENE_KINDS (assets-db.js) and the Assets tab they link to —
  // deliberately English even though the sub-heads are French, so the coordinator
  // lands on the same words they just clicked.
  var HYG_LABEL = {
    discovered:          'Discovered — never brought into inventory',
    never_scanned:       'Never successfully scanned',
    ghost:               'Ghost — was healthy, stale > 90 days',
    lifecycle_exception: 'In repair / expired / lost',
    no_owner:            'No owner',
    no_age:              'No acquisition date',
    no_cost:             'No cost data',
    no_asset_tag:        'No asset tag / QR'
  };
  var HYG_GROUPS = [
    { title: 'À traiter — sur le matériel',      kinds: ['discovered', 'never_scanned', 'ghost', 'lifecycle_exception'] },
    { title: 'À compléter — sur la fiche',       kinds: ['no_owner', 'no_age', 'no_cost', 'no_asset_tag'] }
  ];

  function hygHref(label, kind) {
    return 'assets.html?site=' + encodeURIComponent(label) + '&kind=' + encodeURIComponent(kind) + '#hygiene';
  }

  // One site code can fold SEVERAL AP labels (SGO ← Sabodala + MASSAWA), and the
  // Assets filter is a single-select. So the count is the SUM across labels and
  // the link is only on the number when there is exactly one label; otherwise
  // each label gets its own link. Linking a multi-label site to just the first
  // label would show a smaller list than the number promises.
  function hygCell(count, labels, kind) {
    var num = '<strong>' + esc(count) + '</strong>';
    if (labels.length === 1) {
      return '<a href="' + esc(hygHref(labels[0], kind)) + '" style="color:var(--edv-blue,#145FAE);font-weight:800">' + num + ' →</a>';
    }
    return num + ' <span style="font-size:.74rem">' + labels.map(function (l) {
      return '<a href="' + esc(hygHref(l, kind)) + '" style="color:var(--edv-blue,#145FAE)">' + esc(l) + '</a>';
    }).join(' · ') + '</span>';
  }

  function ensureAssetsSection() {
    var host = el('astBody');
    if (host) return host;
    var rec = el('recList');
    var before = rec && rec.closest ? rec.closest('section') : null;
    if (!before || !before.parentNode) return null;
    var sec = document.createElement('section');
    sec.className = 'section';
    sec.id = 'astSection';
    sec.innerHTML =
      '<div class="section-title">IT assets — compliance</div>' +
      '<div id="astKpis"></div>' +
      '<div class="card panel" style="margin-top:14px" id="astPanel">' +
        '<h2>Assets not in compliance</h2><div id="astBody"></div></div>';
    before.parentNode.insertBefore(sec, before);
    return el('astBody');
  }

  function renderAssets(hyg, effort) {
    // Neither measured → no section at all. A code that maps to no AP label gets
    // null from the binder, and rendering zeros would read as a spotless parc
    // rather than an unmeasured one — the same rule the weekly e-mail applies.
    if (!hyg && !effort) return;
    var host = ensureAssetsSection();
    if (!host) return;

    var kpis = el('astKpis');
    if (kpis) {
      kpis.innerHTML = effort
        ? '<div class="kpis">' + [
            kpi('Tenue du parc', n(effort.score) + ' / 100', n(effort.score) < 55 ? 'bad' : n(effort.score) < 75 ? 'warn' : ''),
            kpi('Rang', effort.rank ? effort.rank + (effort.of ? ' / ' + effort.of : '') : '—'),
            kpi('Δ 30 jours', effort.delta == null ? '—' : (effort.delta > 0 ? '+' : '') + n(effort.delta),
              effort.delta != null && effort.delta < 0 ? 'bad' : '')
          ].join('') + '</div>'
        : '';
    }

    // The parc is a LIVE snapshot: `assets` is DELETE+INSERT full-replaced every
    // night and only the composite effort score is historised, so there is no
    // per-kind state for the report month to look back at. Said plainly rather
    // than implied by an unlabelled block sitting among month-scoped ones.
    setWindowNote('astWindow', 'astKpis',
      "État du parc AUJOURD'HUI, pas celui du mois du rapport — l'inventaire est remplacé chaque nuit " +
      "et seul le score de tenue est historisé.");

    var byKind = (hyg && hyg.by_kind) || {};
    var labels = (hyg && Array.isArray(hyg.labels) ? hyg.labels : []).filter(Boolean);
    var kinds = Object.keys(byKind);
    if (!hyg) {
      host.innerHTML = '<div class="muted">Aucun inventaire rattaché à ce site — rien à contrôler ici.</div>';
      return;
    }
    if (!kinds.length) {
      host.innerHTML = '<div class="muted">Aucune non-conformité — inventaire complet et à jour. 🎉</div>';
      return;
    }

    // Grouped, then ANY leftover kind under "Autres". A kind the reader gains
    // later must never be silently dropped: dropping a non-conformity is the
    // exact failure this block exists to prevent.
    var placed = {};
    var groups = HYG_GROUPS.map(function (g) {
      var rows = g.kinds.filter(function (k) { return byKind[k] > 0; });
      rows.forEach(function (k) { placed[k] = 1; });
      return { title: g.title, kinds: rows };
    });
    var rest = kinds.filter(function (k) { return !placed[k]; });
    if (rest.length) groups.push({ title: 'Autres', kinds: rest });

    host.innerHTML = groups.filter(function (g) { return g.kinds.length; }).map(function (g) {
      return subHead(g.title) +
        '<table class="tbl" style="margin-bottom:14px"><tbody>' +
        g.kinds.map(function (k) {
          return '<tr><td>' + esc(HYG_LABEL[k] || k) + '</td>' +
            '<td class="num">' + hygCell(n(byKind[k]), labels, k) + '</td></tr>';
        }).join('') + '</tbody></table>';
    }).join('') +
      '<div class="muted" style="font-size:.72rem;line-height:1.5">' +
      'Chaque ligne ouvre la liste des machines concernées dans le module Assets (filtre site déjà appliqué), ' +
      'avec export Excel.</div>' +
      // The parc block CANNOT point at a button on this dashboard: the assets
      // module is a read-only mirror of ManageEngine AssetExplorer, replaced
      // wholesale every night at 04:30. Sending a coordinator here to "close"
      // an item would waste their time and teach them the report lies. The fix
      // is always upstream, and the delay before it shows is real — say both.
      howTo('Déjà corrigé, mais toujours listé ici ?',
        'Le parc n’est <strong>pas modifiable depuis ce tableau de bord</strong> : il est recopié chaque nuit (04h30) depuis <strong>ManageEngine AssetExplorer</strong>. ' +
        'Une correction faite aujourd’hui apparaît donc <strong>au rapport du lendemain</strong>, pas immédiatement.<br>' +
        '<strong>Fiche incomplète</strong> (propriétaire, date d’acquisition, coût, étiquette) : ouvrez l’actif dans AssetExplorer et renseignez le champ manquant. Utilisez l’export Excel ci-dessus comme liste de travail.<br>' +
        '<strong>Jamais scanné / fantôme (&gt;90 j)</strong> : la machine n’a pas remonté d’audit. Vérifiez que l’agent tourne et relancez un scan. Si le poste n’existe plus, passez-le en <em>Disposed</em> dans AssetExplorer — sinon il restera compté indéfiniment.<br>' +
        '<strong>En réparation / expiré / perdu</strong> : si le matériel est revenu en service, changez son état dans AssetExplorer ; sinon confirmez la sortie d’inventaire.<br>' +
        '<strong>Découvert</strong> : l’actif a été détecté sur le réseau mais jamais qualifié — affectez-lui un site, un état et un propriétaire.');
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
    renderChanges(data.changes, data.openChanges, ctx);
    renderTechnicians(data.technicians, ctx);
    renderAssets(data.assetHygiene, data.assetEffort);
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
