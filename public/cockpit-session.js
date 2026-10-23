/* Step 8 — one meeting: open it (the agenda is generated and frozen), walk through the points (time-stamped), take
 * notes, record decisions and actions tied to their source, close it (the minutes are written). Chairs act; other
 * readers follow. No inline script (strict CSP). */
(function () {
  'use strict';
  var S = window.SdpApi, esc = S.esc;
  var $ = function (id) { return document.getElementById(id); };
  var st = function (m, e) { S.status($('ss-status'), m, e); };
  var id = decodeURIComponent((location.hash || '').slice(1));
  var data = null, current = 1, noteTimer = null, tick = null, shownSeq = null;
  var STATUS = { planned: 'planifiée', live: 'en cours', closed: 'close' };
  var hm = function (iso) { return iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—'; };

  function load() {
    if (!id) { st('Aucune réunion choisie.', true); return Promise.resolve(); }
    return S.api('GET', '/api/cockpit/sessions/' + encodeURIComponent(id)).then(function (j) {
      data = j;
      var s = j.session, c = j.cadence;
      $('ss-title').textContent = c.title + ' — ' + s.held_on;
      $('ss-meta').textContent = 'Réunion ' + (STATUS[s.status] || s.status) + (s.started_at ? ' · ouverte à ' + hm(s.started_at) : '') + (s.ended_at ? ' · close à ' + hm(s.ended_at) : '') +
        (c.participants && c.participants.length ? ' · ' + c.participants.length + ' participant(s) prévu(s)' : '');
      $('ss-start').hidden = !(j.chair && s.status === 'planned');
      $('ss-close').hidden = !(j.chair && s.status === 'live');
      $('ss-minutes').hidden = s.status !== 'closed';
      $('ss-pv-send').hidden = !j.chair;
      $('ss-sent').textContent = s.minutes_sent_at ? 'Envoyé aux participants le ' + s.minutes_sent_at.slice(0, 16).replace('T', ' ') + ' (UTC).' : '';
      $('ss-body').hidden = s.status === 'planned';
      if (s.status === 'planned') { st(j.chair ? 'L’ordre du jour sera généré avec les chiffres du moment à l’ouverture.' : 'La réunion n’est pas encore ouverte.'); return; }
      renderAgenda(); renderSection();
      clearInterval(tick);
      if (s.status === 'live') tick = setInterval(timer, 1000);
      timer();
    }).catch(function (e) { st(e.message, true); });
  }
  function sections() { return (data.session.agenda && data.session.agenda.sections) || []; }
  function item(seq) { return (data.items || []).find(function (x) { return x.seq === seq; }) || {}; }
  function renderAgenda() {
    $('ss-agenda').innerHTML = sections().map(function (s, i) {
      var it = item(i + 1), state = it.started_at ? (it.ended_at ? 'traité' : 'en cours') : 'à traiter';
      return '<li><button type="button" data-seq="' + (i + 1) + '"' + (current === i + 1 ? ' aria-current="true"' : '') + '><b>' + (i + 1) + '. ' + esc(s.title) + '</b><small>' + (s.minutes ? s.minutes + ' min prévues · ' : '') + state + '</small></button></li>';
    }).join('');
  }
  $('ss-agenda').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-seq]'); if (!b) return;
    flushNotes(); current = Number(b.getAttribute('data-seq')); renderAgenda(); renderSection();
  });
  function renderSection() {
    var s = sections()[current - 1]; if (!s) return;
    $('ss-section').innerHTML = window.CockpitRender.section(s);
    var live = data.session.status === 'live' && data.chair;
    $('ss-live').hidden = !live;
    // The notes box is refilled only when the point changes: a redraw after a decision must not wipe what is being typed.
    if (shownSeq !== current) { $('ss-notes').value = item(current).notes || ''; shownSeq = current; }
    $('ss-notes').readOnly = !live;
    var dec = (data.decisions || []).filter(function (d) { return Number(d.item_seq) === current; });
    var act = (data.actions || []).filter(function (a) { return Number(a.item_seq) === current; });
    var notes = item(current).notes;
    $('ss-recorded').innerHTML = (!live && notes ? '<p class="note">' + esc(notes) + '</p>' : '') +
      (dec.length ? '<h3>Décisions</h3><ul class="ck-list">' + dec.map(function (d) { return '<li>' + esc(d.text) + (d.owner ? ' — ' + esc(d.owner) : '') + '</li>'; }).join('') + '</ul>' : '') +
      (act.length ? '<h3>Actions</h3><ul class="ck-list">' + act.map(function (a) { return '<li>' + esc(a.title) + ' — ' + esc(a.owner || 'sans responsable') + (a.due_date ? ' · ' + esc(a.due_date) : '') + (a.source_kind !== 'free' ? ' · ' + esc(a.source_kind) + ' ' + esc(a.source_ref || '') : '') + '</li>'; }).join('') + '</ul>' : '') ||
      '<p class="db-note">Rien de décidé pour ce point.</p>';
    timer();
  }
  function timer() {
    if (!data) return;
    var s = data.session, it = item(current);
    if (s.status === 'live' && s.started_at) {
      var mins = Math.floor((Date.now() - Date.parse(s.started_at)) / 60000);
      $('ss-timer').textContent = 'Réunion : ' + mins + ' min';
    } else $('ss-timer').textContent = '';
    $('ss-item-time').textContent = it.started_at ? ('Point commencé à ' + hm(it.started_at) + (it.ended_at ? ', terminé à ' + hm(it.ended_at) : ' · ' + Math.floor((Date.now() - Date.parse(it.started_at)) / 60000) + ' min')) : 'Point pas encore commencé.';
  }

  // ── Actions of the chair ─────────────────────────────────────────────
  var base = function () { return '/api/cockpit/sessions/' + encodeURIComponent(id); };
  $('ss-start').addEventListener('click', function () {
    st('Génération de l’ordre du jour…');
    S.api('POST', base() + '/start', {}).then(function () { current = 1; return load(); }).then(function () { st('Réunion ouverte : les chiffres de l’ordre du jour sont figés.'); }).catch(function (e) { st(e.message, true); });
  });
  $('ss-item-start').addEventListener('click', function () {
    S.api('POST', base() + '/items/' + current + '/start', {}).then(function (j) { data.items = j.items; renderAgenda(); timer(); }).catch(function (e) { st(e.message, true); });
  });
  $('ss-item-end').addEventListener('click', function () {
    S.api('POST', base() + '/items/' + current + '/end', {}).then(function (j) { data.items = j.items; renderAgenda(); timer(); }).catch(function (e) { st(e.message, true); });
  });
  function flushNotes() {
    if (!noteTimer) return Promise.resolve();
    clearTimeout(noteTimer); noteTimer = null;
    var seq = current, notes = $('ss-notes').value, it = item(seq);
    it.notes = notes;
    return S.api('PUT', base() + '/items/' + seq + '/notes', { notes: notes }).catch(function (e) { st(e.message, true); });
  }
  $('ss-notes').addEventListener('input', function () { clearTimeout(noteTimer); noteTimer = setTimeout(function () { noteTimer = 1; flushNotes(); }, 800); });
  $('ss-dec-form').addEventListener('submit', function (e) {
    e.preventDefault();
    flushNotes();
    S.api('POST', base() + '/decisions', { item_seq: current, text: $('ss-dec-text').value, owner: $('ss-dec-owner').value }).then(function (j) {
      data.decisions = j.decisions; $('ss-dec-text').value = ''; $('ss-dec-owner').value = ''; renderSection(); st('Décision notée.');
    }).catch(function (e2) { st(e2.message, true); });
  });
  $('ss-act-form').addEventListener('submit', function (e) {
    e.preventDefault();
    flushNotes();
    S.api('POST', base() + '/actions', { item_seq: current, title: $('ss-act-title').value, owner: $('ss-act-owner').value, due_date: $('ss-act-due').value, source_kind: $('ss-act-src').value, source_ref: $('ss-act-ref').value }).then(function (j) {
      data.actions = j.actions; ['ss-act-title', 'ss-act-owner', 'ss-act-due', 'ss-act-ref'].forEach(function (x) { $(x).value = ''; }); $('ss-act-src').value = 'free';
      renderSection(); st('Action notée.');
    }).catch(function (e2) { st(e2.message, true); });
  });
  $('ss-close').addEventListener('click', function () {
    flushNotes().then(function () { return S.api('POST', base() + '/close', {}); }).then(function () { clearInterval(tick); return load(); }).then(function () { st('Réunion close : le procès-verbal est rédigé.'); }).catch(function (e) { st(e.message, true); });
  });
  $('ss-pv-html').addEventListener('click', function () { S.openDocument(base() + '/minutes.html').catch(function (e) { st(e.message, true); }); });
  $('ss-pv-pdf').addEventListener('click', function () { S.download(base() + '/minutes.pdf', 'pv-' + id + '.pdf').catch(function (e) { st(e.message, true); }); });
  $('ss-pv-send').addEventListener('click', function () {
    S.api('POST', base() + '/minutes/send', {}).then(function (j) { st('Procès-verbal envoyé à ' + j.recipients + ' participant(s).'); return load(); }).catch(function (e) { st(e.message, true); });
  });
  $('ss-full').addEventListener('click', function () {
    var el = $('ss-root');
    if (document.fullscreenElement) document.exitFullscreen().catch(function () {});
    else if (el.requestFullscreen) el.requestFullscreen().catch(function () { st('Le plein écran n’est pas disponible ici.', true); });
  });
  window.addEventListener('beforeunload', flushNotes);
  load();
})();
