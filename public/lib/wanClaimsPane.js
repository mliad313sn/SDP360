// P8 / goal B1 — WAN ▸ Réclamations (SLA credit claims) pane logic. Loaded by wan.html; initialised lazily by the
// tab controller through window.__wanClaimsInit. Every figure comes from /api/analytics/wan/sla/claims*: the server
// decides the perimeter, masks amounts for non-money readers and refuses illegal moves — this file only renders.
(function () {
  'use strict';
  var BASE = '/api/analytics/wan/sla/claims';
  var NEXT = { due: ['claimed', 'written_off'], claimed: ['credited', 'disputed', 'written_off'], disputed: ['claimed', 'credited', 'written_off'], credited: [], written_off: [] };
  var REOPEN = { credited: ['disputed'], written_off: ['due', 'claimed'] };
  var LABEL = { due: 'Due', claimed: 'Claimed', credited: 'Credited', disputed: 'Disputed', written_off: 'Written off' };
  var status = null;
  function $(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function money(v, cur) { return v == null ? '—' : Number(v).toLocaleString() + ' ' + esc(cur || ''); }
  function num(v) { return v == null ? '—' : String(v); }
  function msg(t) { var m = $('cl-msg'); if (m) m.textContent = t || ''; }
  function api(method, path, body) {
    var o = { method: method, headers: {} };
    if (body !== undefined) { o.headers['content-type'] = 'application/json'; o.body = JSON.stringify(body); }
    return fetch(path, o).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; e.body = j; throw e; } return j; });
    });
  }
  function quarters() {
    var d = new Date(), y = d.getUTCFullYear(), q = Math.floor(d.getUTCMonth() / 3) + 1, out = [];
    for (var i = 0; i < 6; i++) { out.push(y + '-Q' + q); q--; if (q === 0) { q = 4; y--; } }
    return out;
  }
  function lastMonth() { var d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0'); }

  function renderReady(s) {
    var t = s.teams_sla_alerts || {}, n = s.operator_notification || {};
    $('cl-ready').innerHTML = '<b>Teams SLA alerts:</b> ' + (t.armed ? 'armed' : 'not armed') + ' · SDP Cloud token: ' + (t.token_present ? 'present' : 'missing')
      + ' · channels: ' + (t.channels_configured ? 'configured' : 'none') + ' · last run: ' + esc(t.last_run || '—')
      + '<br><b>Operator e-mail for claims:</b> ' + (n.armed ? 'armed' : 'not armed (dry run only)') + (n.stopped ? ' · STOP is on' : '') + ' · second-person approval required';
  }
  function loadCircuits() {
    return api('GET', '/api/analytics/wan/sla/summary?month=' + lastMonth()).then(function (d) {
      var sel = $('cl-new-circuit'); sel.innerHTML = '';
      (d.circuits || []).forEach(function (c) {
        var o = document.createElement('option');
        o.value = c.site_id + '|' + (c.sub_site || '') + '|' + c.uplink;
        o.textContent = (c.site_name || c.site_id) + (c.sub_site ? ' / ' + c.sub_site : '') + ' · ' + c.uplink + ' · ' + (c.isp || '');
        sel.appendChild(o);
      });
    }).catch(function () { /* no circuits → nothing to open */ });
  }
  function loadValue() {
    if (!status.can_read_money) { $('cl-value-panel').style.display = 'none'; return; }
    api('GET', BASE + '/value?quarter=' + encodeURIComponent($('cl-quarter').value)).then(function (v) {
      var rows = [];
      (v.quarters || []).forEach(function (q) {
        Object.keys(q.currencies).forEach(function (cur) {
          var c = q.currencies[cur];
          rows.push('<tr><td>' + esc(q.quarter) + '</td><td>' + esc(cur) + '</td><td class="sl-num">' + money(c.due) + '</td><td class="sl-num">' + money(c.claimed) + '</td><td class="sl-num">' + money(c.recovered)
            + '</td><td class="sl-num">' + money(c.written_off) + '</td><td class="sl-num">' + num(q.aging.open_claims) + '</td><td class="sl-num">' + num(q.aging.median_days_since_due) + '</td></tr>');
        });
        $('cl-value-note').textContent = q.usd_indicative ? ('Indicative USD (not certified): due ' + q.usd_indicative.due + ' · claimed ' + q.usd_indicative.claimed + ' · recovered ' + q.usd_indicative.recovered)
          : 'No USD total: a currency has no rate or an amount is unknown (' + q.unknown_amounts + ' unknown).';
      });
      $('cl-value').innerHTML = rows.join('') || '<tr><td colspan="8" class="sl-muted">No claim this quarter.</td></tr>';
      $('cl-value-panel').style.display = '';
    }).catch(function () { $('cl-value-panel').style.display = 'none'; });
  }
  function loadList() {
    var q = '?quarter=' + encodeURIComponent($('cl-quarter').value) + ($('cl-status').value ? '&status=' + encodeURIComponent($('cl-status').value) : '');
    api('GET', BASE + q).then(function (d) {
      var rows = (d.claims || []).map(function (c) {
        var ev = BASE + '/' + c.id + '/evidence';
        return '<tr><td>' + c.id + '</td><td>' + esc(c.site_name || c.site_id) + (c.sub_site ? ' / ' + esc(c.sub_site) : '') + ' · ' + esc(c.uplink) + '</td><td>' + esc(c.isp || '—') + ' · ' + esc(c.circuit_id || '—')
          + '</td><td>' + esc(c.period) + '</td><td><span class="sl-pill ' + (c.status === 'credited' ? 'sl-ok' : c.status === 'disputed' ? 'sl-bad' : 'sl-neu') + '">' + esc(LABEL[c.status] || c.status) + '</span>'
          + (c.stale ? ' <span class="sl-pill sl-bad" title="outages or contract changed after the freeze">Stale</span>' : '') + '</td><td>' + esc(c.owner_name || '—')
          + '</td><td class="sl-num">' + money(c.due_amount, c.currency) + '</td><td class="sl-num">' + money(c.claimed_amount, c.currency) + '</td><td class="sl-num">' + money(c.credited_amount, c.currency)
          + '</td><td class="sl-num">' + num(c.days_since_due) + '</td><td class="sl-num">' + num(c.days_since_claimed)
          + '</td><td><a href="' + ev + '.csv">CSV</a> · <a href="' + ev + '.html">Print</a> · <a href="' + ev + '.pdf">PDF</a></td><td><button class="sl-btn" type="button" data-open="' + c.id + '">Open</button></td></tr>';
      });
      $('cl-rows').innerHTML = rows.join('') || '<tr><td colspan="13" class="sl-muted">No claim for this filter.</td></tr>';
    }).catch(function (e) { msg('Could not load the claims: ' + e.message); });
  }
  function openDetail(id) {
    api('GET', BASE + '/' + id).then(function (d) {
      var c = d.claim, p = $('cl-detail');
      var moves = (NEXT[c.status] || []).map(function (s) { return '<option value="' + s + '">' + LABEL[s] + '</option>'; })
        .concat((REOPEN[c.status] || []).map(function (s) { return '<option value="reopen:' + s + '">Reopen → ' + LABEL[s] + '</option>'; }));
      var html = '<h2>Claim #' + c.id + ' — ' + esc(c.site_name || c.site_id) + ' ' + esc(c.uplink) + ' · ' + esc(c.period) + '</h2>'
        + '<p class="sl-note">Frozen ' + esc(c.frozen_at) + ' · availability ' + num(c.availability_pct) + ' % · credit tier ' + num(c.due_credit_pct) + ' % · hash ' + esc(String(c.evidence_hash).slice(0, 16)) + '…' + (c.money_hidden ? ' · amounts restricted' : '') + '</p>';
      if (status.can_write && moves.length) {
        html += '<div style="display:flex;gap:8px;flex-wrap:wrap;align-items:flex-end;margin:8px 0">'
          + '<label class="sl-muted" for="cl-to" style="font-size:12px">Move to</label><select id="cl-to">' + moves.join('') + '</select>'
          + '<label class="sl-muted" for="cl-motive" style="font-size:12px">Motive (required)</label><input type="text" id="cl-motive" maxlength="1000" size="40">'
          + '<label class="sl-muted" for="cl-amount" style="font-size:12px">Amount (' + esc(c.currency || 'no currency') + ')</label><input type="number" id="cl-amount" min="0" step="0.01" placeholder="claimed / credited">'
          + '<button class="sl-btn" type="button" id="cl-move">Apply</button></div>';
      }
      if (status.can_write && (c.status === 'claimed' || c.status === 'disputed')) {
        html += '<div style="margin:8px 0"><b>Operator e-mail</b> (state: ' + esc(c.notify_state) + ') '
          + '<button class="sl-btn" type="button" data-notify="preview">Preview (dry run)</button> <button class="sl-btn" type="button" data-notify="request">Request</button> '
          + '<button class="sl-btn" type="button" data-notify="approve">Approve (another person)</button> <button class="sl-btn" type="button" data-notify="send">Send</button><pre id="cl-preview" class="sl-note" style="white-space:pre-wrap"></pre></div>';
      }
      html += '<h3>Trail</h3><ul>' + (d.events || []).map(function (e) {
        return '<li>' + esc(e.at) + ' · ' + esc(e.actor_name || 'system') + ' · ' + esc(e.action) + (e.to_status ? ' → ' + esc(e.to_status) : '') + (e.motive ? ' — ' + esc(e.motive) : '') + '</li>';
      }).join('') + '</ul>';
      p.innerHTML = html; p.style.display = ''; p.dataset.id = c.id;
      p.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }).catch(function (e) { msg('Could not open the claim: ' + e.message); });
  }
  function onDetailClick(e) {
    var p = $('cl-detail'), id = p.dataset.id;
    if (e.target.id === 'cl-move') {
      var v = $('cl-to').value, reopen = v.indexOf('reopen:') === 0, to = reopen ? v.slice(7) : v, amt = $('cl-amount').value;
      var body = { to: to, motive: $('cl-motive').value, reopen: reopen };
      if (amt !== '') { if (to === 'credited') body.credited_amount = amt; else body.claimed_amount = amt; }
      api('POST', BASE + '/' + id + '/transition', body).then(function () { msg('Claim #' + id + ' moved to ' + LABEL[to] + '.'); refresh(); openDetail(id); })
        .catch(function (er) { msg('Refused: ' + er.message); });
      return;
    }
    var step = e.target.getAttribute && e.target.getAttribute('data-notify');
    if (!step) return;
    api('POST', BASE + '/' + id + '/notify/' + step).then(function (r) {
      if (step === 'preview') { $('cl-preview').textContent = 'To: ' + (r.message.to || '— (no operator e-mail on the circuit)') + '\nSubject: ' + r.message.subject + '\nWould send now: ' + (r.gate.ok ? 'yes' : 'no — ' + r.gate.message); return; }
      msg(step === 'send' ? 'E-mail sent to ' + r.to + '.' : 'Notification ' + step + 'ed.'); openDetail(id);
    }).catch(function (er) { msg('Refused: ' + er.message); });
  }
  function refresh() { loadList(); loadValue(); }

  window.__wanClaimsInit = function () {
    var qs = $('cl-quarter'); qs.innerHTML = quarters().map(function (q) { return '<option>' + q + '</option>'; }).join('');
    $('cl-new-period').value = lastMonth();
    api('GET', BASE + '/status').then(function (s) {
      status = s; renderReady(s);
      if (s.can_write) { $('cl-new-panel').style.display = ''; loadCircuits(); }
      refresh();
    }).catch(function () { msg('SLA credit claims are switched off.'); });
    qs.addEventListener('change', refresh);
    $('cl-status').addEventListener('change', loadList);
    $('cl-rows').addEventListener('click', function (e) { var id = e.target.getAttribute && e.target.getAttribute('data-open'); if (id) openDetail(id); });
    $('cl-detail').addEventListener('click', onDetailClick);
    $('cl-new-btn').addEventListener('click', function () {
      var parts = $('cl-new-circuit').value.split('|');
      if (parts.length !== 3) { msg('Pick a circuit first.'); return; }
      api('POST', BASE, { site_id: Number(parts[0]), sub_site: parts[1], uplink: parts[2], period: $('cl-new-period').value, owner_name: $('cl-new-owner').value })
        .then(function (r) { msg('Claim #' + r.claim.id + ' opened.'); refresh(); }).catch(function (er) { msg('Refused: ' + er.message); });
    });
  };
})();
