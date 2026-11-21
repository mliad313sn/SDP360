/* W3-GOVERNANCE — project page additions (PPM parity W3), each shown only while its PROPOSED switch is on
   (GET /api/governance/ppm/features; an error = all off = today):
     simplified_view  Simplified ↔ Expert switch (per-user preference, PUT /api/governance/ppm/view-mode). Simplified
                      hides the tabs (their state is kept — Expert brings back the same tab) and shows KPI cards, the
                      phase strip, top risks and next milestones (GET …/project/:id/summary).
     gate_checklist   Gates tab: checklist per target stage — evidence, sign-off (approve / reject with a reason),
                      definition editor for the committee. A sign-off is a recorded approval, not a legal signature.
     raid             RAID tab: the RAID log (dependency kind, response, review date, exposure for money readers).
     dcma             Plan tab: DCMA 14-point check (unmeasurable = "—").
     project_report   Plan tab: printable status report + Excel.
   Always: "Print schedule" — the Gantt printed page by page with its legend (print CSS in lib/ppmGovernanceW3.css). */
(function () {
  'use strict';
  var PID = new URLSearchParams(window.location.search).get('id');
  if (!PID) return;
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var n = function (v, unit) { return v == null || v === '' || (typeof v === 'number' && !isFinite(v)) ? '—' : esc(String(v) + (unit || '')); };
  var base = '/api/governance/ppm/';
  function api(p, o) {
    var headers = o && o.body ? { 'content-type': 'application/json' } : {};
    return fetch(p, Object.assign({ headers: headers }, o || {})).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.code = j.code; throw e; } return j; });
    });
  }
  // PMO UX — the page's message router (drawer → inline under Save; success → toast) when the page provides it
  function say(t, bad) { if (window.__ppmMsg) { window.__ppmMsg(t, bad ? 'errors' : 'ok'); return; } var m = $('msg'); if (m) m.innerHTML = '<div class="' + (bad ? 'errors' : 'ok') + '">' + esc(t) + '</div>'; }
  var L = function (g, c) { return window.PpmLabels ? window.PpmLabels.label(g, c) : (c == null || c === '' ? '—' : String(c).replace(/_/g, ' ')); };
  var UX = function () { return window.PpmUx || null; };
  var PLAIN = {
    GATE_SOD: 'The project owner cannot sign off their own gate.', NOT_AN_APPROVER: 'You are not one of the approvers of this gate.',
    SLOT_TAKEN: 'Every approver slot you could fill is already held by someone else.', REASON_REQUIRED: 'A reason of 10 characters or more is required to reject.',
    BAD_LINK: 'The link must be https://… or an internal /path.', COMMITTEE_ONLY: 'The committee defines a gate checklist.',
    NO_APPROVER: 'Name at least one approver: a gate is never approved automatically.', MONEY_SCOPE: 'Amounts are entered by the admin tier or the finance role.',
    CURRENCY_REQUIRED: 'An amount needs its currency.',
  };
  var failMsg = function (e) { say((e && e.code && PLAIN[e.code]) || (e && e.message) || 'Error', true); };
  var RAGL = function (r) { return r ? '<span class="w3-rag ' + esc(r) + '">' + esc(L('status', r.toUpperCase())) + '</span>' : '<span class="w3-rag">—</span>'; };

  // ---- Simplified ↔ Expert ------------------------------------------------------------------------------------
  function setMode(mode, save) {
    if ($('w3-mode').hasAttribute('data-nf')) return;   // "not found": nothing to summarise
    document.body.classList.toggle('w3-simple', mode === 'simplified');
    $('w3-simple').hidden = mode !== 'simplified';
    var bs = $('w3-mode').querySelectorAll('button');
    for (var i = 0; i < bs.length; i++) bs[i].setAttribute('aria-pressed', String(bs[i].getAttribute('data-mode') === mode));
    if (mode === 'simplified') loadSummary();
    if (save) api(base + 'view-mode', { method: 'PUT', body: JSON.stringify({ mode: mode }) }).catch(failMsg);
  }
  function loadSummary() {
    api(base + 'project/' + PID + '/summary').then(function (s) {
      var c = s.cards || {};
      var burn = s.money_hidden ? '<span class="muted">amounts restricted</span>' : (c.budget_burn && c.budget_burn.length ? c.budget_burn.map(function (b) { return esc(b.currency) + ' ' + n(b.ac) + ' / ' + n(b.pv) + ' (×' + n(b.burn_vs_plan) + ')'; }).join('<br>') : '—');
      var cards = [
        ['RAG', s.rag_enabled ? RAGL(c.rag) + (c.rag_partial ? ' <span class="w3-partial">partial — some open risks have no score</span>' : '') : '<span class="muted">off</span>'],
        ['Schedule complete (work-weighted)', n(c.schedule_complete_pct, ' %')],
        ['Budget burn — actual / planned (non certifié)', s.evm_enabled ? burn : '<span class="muted">earned value off</span>'],
        ['Active risks + issues · high · blocked tasks', n(c.active_risks) + ' · ' + (c.high_risks_partial ? '≥ ' : '') + n(c.high_risks) + ' · ' + n(c.blocked_tasks) + (c.high_risks_partial ? ' <span class="w3-partial"><b>' + n(c.unscored_risks) + '</b> <span>unscored — the high count is a lower bound</span></span>' : '')],
        ['Next milestone', c.next_milestone ? esc(c.next_milestone.name) + '<div class="l">' + esc(c.next_milestone.due_date) + '</div>' : '—'],
        ['Forecast finish (slip, working days)', n(c.forecast_finish) + ' (' + n(c.slip_working_days) + ')'],
      ];
      var strip = (s.phase_strip || []).map(function (p) { return '<div class="ph ' + esc(p.state) + '"><b>' + esc(p.label) + '</b><br>' + esc(L('status', p.state)) + (p.on_hold ? ' · on hold' : '') + (p.pct_complete != null ? ' · ' + n(p.pct_complete, ' %') : '') + (p.health ? ' · ' + RAGL(p.health) : '') + (p.gate ? ' · gate ' + (p.gate.complete ? '✓' : esc(p.gate.refusal || '')) : '') + '</div>'; }).join('');
      var risks = (s.top_risks || []).length ? '<table><tr><th>Kind</th><th>Title</th><th>P × I</th><th>Owner</th></tr>' + s.top_risks.map(function (r) { return '<tr><td>' + esc(L('kind', r.kind)) + '</td><td>' + esc(r.title) + '</td><td>' + n(r.score) + '</td><td>' + n(r.owner) + '</td></tr>'; }).join('') + '</table>' : '<p class="muted">No open risk or issue.</p>';
      var ms = (s.next_milestones || []).length ? '<ul>' + s.next_milestones.map(function (m) { return '<li>' + esc(m.due_date) + ' — ' + esc(m.name) + '</li>'; }).join('') + '</ul>' : '<p class="muted">No upcoming milestone.</p>';
      $('w3-simple').innerHTML = '<div class="w3-cards">' + cards.map(function (x) { return '<div class="w3-card"><div class="l">' + esc(x[0]) + '</div><div class="v">' + x[1] + '</div></div>'; }).join('') + '</div>' +
        '<div class="panel"><h2>Phases</h2><div class="w3-strip">' + strip + '</div><p class="muted">' + esc(s.phase_mapping_status || '') + '</p></div>' +
        '<div class="panel"><h2>Top risks and issues</h2>' + risks + '</div><div class="panel"><h2>Next milestones</h2>' + ms + '</div>' +
        '<p class="muted">Every number comes from the schedule engine, earned value and the RAID register; “—” = not measured, never 0. Expert view keeps the tabs where you left them.</p>';
    }).catch(failMsg);
  }

  // ---- gate checklists -----------------------------------------------------------------------------------------
  function loadGates() {
    api(base + 'project/' + PID + '/gates').then(function (g) {
      var html = (g.gates || []).filter(function (x) { return x.defined; }).map(function (x) {
        var items = x.items.map(function (it) { return '<li>' + (it.satisfied ? '<span class="w3-ok">✓</span>' : '<span class="w3-ko">✗</span>') + ' ' + esc(it.label) + ' <small class="muted">(' + esc(L('kind', it.kind)) + (it.evidence && it.evidence.link ? ' · <a href="' + esc(it.evidence.link) + '" rel="noopener noreferrer" target="_blank">evidence</a>' : '') + (it.evidence && it.evidence.by ? ' · ' + esc(it.evidence.by) : '') + ')</small>' +
          ' <button type="button" class="btn" data-ev="' + esc(x.gate_to) + '" data-item="' + esc(it.key) + '" data-kind="' + esc(it.kind) + '">' + (it.kind === 'check' ? 'Confirm' : 'Add evidence') + '</button></li>'; }).join('');
        var slots = x.slots.map(function (s) { return '<li>' + esc(s.user_id != null ? (s.user_name || 'named approver') : 'role ' + s.role) + ': ' + (s.decision ? '<b class="' + (s.decision === 'approve' ? 'w3-ok' : 'w3-ko') + '">' + esc(L('action', s.decision)) + '</b> by ' + esc(s.by) + ' · ' + esc(s.at) + (s.reason ? ' — ' + esc(s.reason) : '') : '<span class="muted">' + esc(L('status', 'pending')) + '</span>') + '</li>'; }).join('');
        return '<div class="gate"><div><b>Entering ' + esc(L('stage', x.gate_to)) + '</b> · v' + n(x.version) + ' · ' + esc(x.rule === 'quorum' ? 'quorum' : 'all approvers') + (x.quorum ? ' ' + n(x.quorum) : '') + ' · ' + n(x.approved) + ' / ' + n(x.required) + ' sign-off(s) · ' +
          (x.complete ? '<span class="w3-ok">complete</span>' : '<span class="w3-ko">' + esc(x.refusal.error) + '</span>') + '<ul>' + items + '</ul><ul>' + slots + '</ul>' +
          '<button type="button" class="btn primary" data-sign="' + esc(x.gate_to) + '" data-decision="approve">Approve</button> <button type="button" class="btn danger" data-sign="' + esc(x.gate_to) + '" data-decision="reject">Reject</button></div></div>';
      }).join('') || '<p class="muted">No checklist is defined: the gates follow today\'s rules only.</p>';
      $('w3-gates-body').innerHTML = html + '<p class="muted">' + esc(g.note) + '. A complete checklist never moves the stage: the committee still makes the move.</p>';
      $('w3-gate-def').hidden = !g.can_define;
      GDEFS = {}; (g.gates || []).forEach(function (x) { if (x.defined) GDEFS[x.gate_to] = { items: (x.items || []).map(function (it) { return { key: it.key, label: it.label, kind: it.kind }; }), approvers: x.approvers || (x.slots || []).map(function (sl) { return sl.user_id != null ? { user_id: sl.user_id } : { role: sl.role }; }), rule: x.rule, quorum: x.quorum || undefined }; });
      if (g.can_define) loadDef();
    }).catch(failMsg);
  }
  function wireGates() {
    $('w3-gates-body').addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-ev')) {
        var link = b.getAttribute('data-kind') === 'check' ? null : window.prompt('Link to the evidence (https://… or an internal /path)');
        if (b.getAttribute('data-kind') !== 'check' && !link) return;
        api(base + 'project/' + PID + '/gates/' + b.getAttribute('data-ev') + '/evidence', { method: 'POST', body: JSON.stringify({ item_key: b.getAttribute('data-item'), link: link }) }).then(function () { say('Recorded.'); loadGates(); }).catch(failMsg);
      } else if (b.hasAttribute('data-sign')) {
        var d = b.getAttribute('data-decision'), reason = d === 'reject' ? window.prompt('Reason for the rejection (10 characters or more)') : '';
        if (d === 'reject' && reason == null) return;
        api(base + 'project/' + PID + '/gates/' + b.getAttribute('data-sign') + '/signoff', { method: 'POST', body: JSON.stringify({ decision: d, reason: reason || undefined }) }).then(function () { say('Sign-off recorded (server time).'); loadGates(); }).catch(failMsg);
      }
    });
    // PMO UX — the checklist is built row by row (label · kind · remove), approver roles are ticked and the rule is a
    // choice; the builder writes the SAME JSON the server always read. The raw JSON stays for the super administrator.
    $('w3-gd-adv').hidden = !(window.__userHasRole && window.__userHasRole('super_admin'));
    $('w3-gd-gate').addEventListener('change', loadDef);
    $('w3-gd-adv').addEventListener('toggle', function () { if ($('w3-gd-adv').open && BUILDER) $('w3-gd-json').value = JSON.stringify(BUILDER.read(), null, 2); });
    $('w3-gd-save').addEventListener('click', function () {
      var body;
      if ($('w3-gd-adv').open && !$('w3-gd-adv').hidden) { try { body = JSON.parse($('w3-gd-json').value || '{}'); } catch (_) { say('The definition is not valid JSON.', true); return; } }
      else if (BUILDER) { body = BUILDER.read(); if (!body.items.length) { say('Add at least one checklist item.', true); return; } if (!body.approvers.length) { say('Name at least one approver: a gate is never approved automatically.', true); return; } }
      else { try { body = JSON.parse($('w3-gd-json').value || '{}'); } catch (_) { say('The definition is not valid JSON.', true); return; } }
      api(base + 'project/' + PID + '/gates/' + $('w3-gd-gate').value, { method: 'PUT', body: JSON.stringify(body) }).then(function () { say('Checklist saved: earlier sign-offs of this gate no longer count.'); loadGates(); }).catch(failMsg);
    });
  }

  var GDEFS = {}, BUILDER = null;
  function loadDef() {
    var def = GDEFS[$('w3-gd-gate').value] || { items: [], approvers: [{ role: 'committee-member' }], rule: 'all' };
    if (!UX()) { $('w3-gd-json').value = JSON.stringify(def, null, 2); return; }
    if (!BUILDER) BUILDER = UX().checklistBuilder($('w3-gd-builder'), { value: def, labels: { add: '+ Checklist item', approvers: 'Approvers (roles)', role: 'Other role', rule: 'Sign-off rule', all: 'All approvers', quorum: 'Quorum', quorumN: 'Quorum size', label: 'Item label', kind: 'Kind', artifact: 'Document', check: 'Check', remove: 'Remove' } });
    else BUILDER.write(def);
    $('w3-gd-json').value = JSON.stringify(def, null, 2);
  }

  // ---- RAID log ------------------------------------------------------------------------------------------------
  // P11 r9 R9-1 — the form is PRE-FILLED from the stored entry when an entry is edited, and only changed fields are
  // sent (lib/ppmRaidForm.js): an untouched score is never sent as null any more (it used to erase the stored score).
  var raidItems = [], raidOrig = null, raidOrigId = null;
  var RAID_EL = { kind: 'w3-r-kind', title: 'w3-r-title', probability: 'w3-r-p', impact: 'w3-r-i', owner: 'w3-r-owner', status: 'w3-r-status', response: 'w3-r-resp', review_date: 'w3-r-review', probability_pct: 'w3-r-pct', dependency_ref: 'w3-r-dep', mitigation: 'w3-r-mit', impact_amount: 'w3-r-amt', impact_currency: 'w3-r-cur' };
  function raidFill(item) {
    var money = !$('w3-raid-money').hidden;
    raidOrig = item ? window.PpmRaidForm.prefill(item, money) : null; raidOrigId = item ? Number(item.id) : null;
    Object.keys(RAID_EL).forEach(function (k) {
      var e = $(RAID_EL[k]); if (!e) return;
      if (raidOrig && Object.prototype.hasOwnProperty.call(raidOrig, k)) {
        if (e.tagName === 'SELECT' && raidOrig[k] !== '' && !Array.prototype.some.call(e.options, function (o) { return o.value === raidOrig[k]; })) { var o = document.createElement('option'); o.value = raidOrig[k]; o.textContent = raidOrig[k]; e.appendChild(o); }
        e.value = raidOrig[k];
      }
      else if (!item) e.value = k === 'kind' ? 'risk' : k === 'status' ? 'open' : '';
    });
  }
  function loadRaid() {
    api(base + 'project/' + PID + '/raid').then(function (r) {
      raidItems = r.items || [];
      var money = !r.money_hidden;
      var rows = (r.items || []).map(function (i) {
        return '<tr><td>' + esc(L('kind', i.kind)) + '</td><td>' + esc(i.title) + '</td><td class="ppm-num">' + n(i.score) + '</td><td>' + n(i.owner) + '</td><td>' + (window.PpmLabels ? window.PpmLabels.pill('status', i.status, esc) : esc(i.status)) + '</td><td>' + (i.response ? esc(L('response', i.response)) : '—') + '</td><td' + (i.review_overdue ? ' class="w3-ko"' : '') + '>' + n(i.review_date) + '</td><td>' + n(i.probability_pct, ' %') + '</td>' +
          (money ? '<td>' + n(i.impact_amount) + ' ' + esc(i.impact_currency || '') + '</td><td>' + n(i.exposure_amount) + '</td>' : '') + '<td>' + n(i.dependency_ref) + '</td><td>' + (r.can_edit === false ? '' : '<button type="button" class="btn" data-raid-edit="' + esc(i.id) + '">Edit</button>') + '</td></tr>';
      }).join('');
      $('w3-raid-body').innerHTML = (!(r.items || []).length ? '<p class="muted">Nothing recorded yet.</p>' : '') + '<table><thead><tr><th>Kind</th><th>Title</th><th>P × I</th><th>Owner</th><th>Status</th><th>Response</th><th>Review</th><th>Probability</th>' + (money ? '<th>Impact</th><th>Exposure</th>' : '') + '<th>Depends on</th><th><span class="ppm-sr">Actions</span></th></tr></thead><tbody>' + rows + '</tbody></table>' +
        (money ? '<p class="muted">Open exposure per currency (never summed across currencies): ' + ((r.exposure_totals || []).map(function (t) { return esc(t.currency) + ' ' + n(t.exposure_amount); }).join(' · ') || '—') + '</p>' : '<p class="muted">Amounts are shown to the admin tier and the finance role only.</p>') +
        (r.review_overdue ? '<p class="w3-ko">' + n(r.review_overdue) + ' review(s) overdue.</p>' : '');
      $('w3-raid-money').hidden = !money;
    }).catch(failMsg);
  }
  function wireRaid() {
    $('w3-raid-body').addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('button[data-raid-edit]'); if (!b) return;
      var id = Number(b.getAttribute('data-raid-edit'));
      $('w3-r-id').value = String(id);
      var item = raidItems.filter(function (x) { return Number(x.id) === id; })[0] || null;
      raidFill(item); $('w3-r-head').textContent = item ? 'Edit RAID entry — ' + (item.title || '') : 'RAID log entry';
      if (UX()) { UX().formMsg($('w3-r-msg'), ''); UX().openDrawer('w3-raid-drawer', b); }
    });
    $('w3-r-add').addEventListener('click', function () {
      $('w3-r-id').value = ''; raidFill(null); $('w3-r-head').textContent = 'New RAID log entry';
      if (UX()) { UX().formMsg($('w3-r-msg'), ''); UX().openDrawer('w3-raid-drawer', this); }
    });
    $('w3-raid-save').addEventListener('click', function () {
      var money = !$('w3-raid-money').hidden, values = {};
      Object.keys(RAID_EL).forEach(function (k) { var e = $(RAID_EL[k]); values[k] = e ? e.value : ''; });
      var id = $('w3-r-id').value ? Number($('w3-r-id').value) : null;
      // an id typed for an entry this page has not loaded: send only what is filled in (the server keeps the rest)
      var orig = id == null ? null : (raidOrig && raidOrigId === id ? raidOrig : window.PpmRaidForm.prefill({}, money));
      var body = window.PpmRaidForm.buildBody(values, orig, money);
      if (id != null) body.id = id;
      api(base + 'project/' + PID + '/raid', { method: 'PUT', body: JSON.stringify(body) }).then(function (r) {
        say('RAID entry saved.');
        if (r && r.item) { $('w3-r-id').value = String(r.item.id); raidOrig = window.PpmRaidForm.prefill(r.item, money); raidOrigId = Number(r.item.id); }
        loadRaid();
      }).catch(failMsg);
    });
  }

  // ---- DCMA 14 ---------------------------------------------------------------------------------------------------
  function loadDcma() {
    api(base + 'project/' + PID + '/dcma').then(function (d) {
      $('w3-dcma-body').innerHTML = '<p>' + n(d.summary.passed) + ' passed · ' + n(d.summary.failed) + ' failed · ' + n(d.summary.not_measurable) + ' not measurable · status date ' + n(d.status_date) + '</p><table><tr><th>#</th><th>Check</th><th>Metric</th><th>Threshold</th><th>Value</th><th>Result</th></tr>' +
        d.points.map(function (p) { return '<tr><td>' + p.id + '</td><td>' + esc(p.name) + '</td><td>' + esc(p.metric) + '</td><td>' + esc(p.threshold) + '</td><td>' + n(p.value) + (p.of != null && p.count != null ? ' <small class="muted">(' + p.count + ' / ' + p.of + ')</small>' : '') + '</td><td>' + (p.pass == null ? '<span class="w3-na">— ' + esc(p.basis || '') + '</span>' : p.pass ? '<span class="w3-ok">pass</span>' : '<span class="w3-ko">fail</span>') + '</td></tr>'; }).join('') + '</table><p class="muted">' + esc(d.method) + '</p>';
    }).catch(failMsg);
  }

  // ---- paginated schedule print ----------------------------------------------------------------------------------
  function sliceLegacyGantt() {
    var host = $('gantt'), svg = host && !host.hidden ? host.querySelector('svg') : null, out = $('w3-print-pages');
    out.innerHTML = '';
    if (!svg) return false;
    var W = Number(svg.getAttribute('width')), H = Number(svg.getAttribute('height')), TOP = 26, RH = 24, PER = 22;
    if (!(W > 0 && H > TOP)) return false;
    var legend = $('gantt-legend') ? $('gantt-legend').outerHTML : '', pages = Math.max(1, Math.ceil((H - TOP) / (RH * PER))), html = '';
    var src = new XMLSerializer().serializeToString(svg);
    var view = function (y, h) { return src.replace(/<svg([^>]*?)\sviewBox="[^"]*"/, '<svg$1 viewBox="0 ' + y + ' ' + W + ' ' + h + '"').replace(/<svg([^>]*?)\sheight="[^"]*"/, '<svg$1 height="' + h + '"'); };
    for (var i = 0; i < pages; i++) {
      var y = TOP + i * RH * PER, h = Math.min(RH * PER, H - y);
      html += '<div class="w3-print-page">' + legend + view(0, TOP) + view(y, h) + '<div class="w3-pg">Page ' + (i + 1) + ' / ' + pages + '</div></div>';
    }
    out.innerHTML = html;
    return true;
  }
  function expandGanttV2() {
    var split = document.querySelector('#gantt-v2 .g2-split'); if (!split) return;
    var rows = document.querySelectorAll('#gantt-v2 .g2-gin').length ? document.querySelector('#gantt-v2 .g2-gin').style.height : null;
    split.setAttribute('data-w3-h', split.style.height || '');
    if (rows) split.style.height = (parseFloat(rows) + 60) + 'px';
    var tl = split.querySelector('.g2-tl'); if (tl) { tl.scrollTop = 0; tl.dispatchEvent(new Event('scroll')); }
  }
  function restoreGanttV2() { var split = document.querySelector('#gantt-v2 .g2-split'); if (split && split.hasAttribute('data-w3-h')) { split.style.height = split.getAttribute('data-w3-h'); split.removeAttribute('data-w3-h'); } }
  function printSchedule() {
    var tab = $('tab-plan'); if (tab && tab.getAttribute('aria-selected') !== 'true') tab.click();
    if (document.body.classList.contains('w3-simple')) setMode('expert', false);
    document.body.classList.add('w3-print-gantt');
    document.body.classList.toggle('w3-sliced', sliceLegacyGantt());
    expandGanttV2();
    setTimeout(function () { window.print(); }, 150);
  }
  window.addEventListener('afterprint', function () { document.body.classList.remove('w3-print-gantt', 'w3-sliced'); $('w3-print-pages').innerHTML = ''; restoreGanttV2(); });

  // ---- boot --------------------------------------------------------------------------------------------------------
  $('w3-print').addEventListener('click', printSchedule);
  api(base + 'features').then(function (f) {
    if (f.simplified_view) {
      $('w3-mode').hidden = $('w3-mode').hasAttribute('data-nf');   // PMO UX: no view switch on the "not found" card
      $('w3-mode').addEventListener('click', function (ev) { var b = ev.target.closest && ev.target.closest('button[data-mode]'); if (b) setMode(b.getAttribute('data-mode'), true); });
      api(base + 'view-mode').then(function (m) { setMode(m.mode === 'simplified' ? 'simplified' : 'expert', false); }).catch(function () { /* expert = today */ });
    }
    if (f.gate_checklist) { $('w3-gates').hidden = false; wireGates(); loadGates(); }
    if (f.raid) { $('w3-raid').hidden = false; wireRaid(); loadRaid(); }
    if (f.dcma) { $('w3-dcma').hidden = false; loadDcma(); }
    if (f.project_report) { $('w3-report').hidden = false; $('w3-rep-html').href = base + 'project/' + PID + '/report.html'; $('w3-rep-xlsx').href = base + 'project/' + PID + '/report.xlsx'; }
  }).catch(function () { /* every W3 switch off = today */ });
})();
