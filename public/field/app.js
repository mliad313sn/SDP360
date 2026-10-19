/* Step 10 — field PWA. Offline-first: bootstrap cached in IndexedDB, every write queued as an
   ENVELOPE {uuid, kind, payload} and PUT to /api/field/outbox/:uuid when online — exactly once on the
   server (idempotent on uuid), deleted here on any terminal answer (applied / rejected / 409). Photos are
   compressed on the device (≤ 300 KB) and uploaded in 64 KB chunks before the inspection envelope.
   No framework, no inline handlers. */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var token = null; try { token = localStorage.getItem('report_token'); } catch (_) { token = null; }
  if (!token) { location.href = '../login.html?next=' + encodeURIComponent('/field/index.html'); return; }
  var H = function (extra) { return Object.assign({ 'x-report-token': token }, extra || {}); };
  function api(path, o) {
    o = o || {};
    return fetch(path, { method: o.method || 'GET', headers: H(o.body ? { 'content-type': 'application/json' } : {}), body: o.body ? JSON.stringify(o.body) : undefined })
      .then(function (r) { return r.json().then(function (j) { j.__status = r.status; j.__stale = r.headers.get('x-field-cache') === 'stale'; return j; }); });
  }
  function uuid() { if (crypto.randomUUID) return crypto.randomUUID(); var b = crypto.getRandomValues(new Uint8Array(16)); b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80; var h = Array.from(b, function (x) { return x.toString(16).padStart(2, '0'); }).join(''); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' + h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20); }

  // ── IndexedDB: outbox + cache ───────────────────────────────────────────────────────
  var DB = null;
  function idb() {
    if (DB) return Promise.resolve(DB);
    return new Promise(function (res, rej) {
      var r = indexedDB.open('field', 1);
      r.onupgradeneeded = function () { var d = r.result; if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'uuid' }); if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv'); };
      r.onsuccess = function () { DB = r.result; res(DB); }; r.onerror = function () { rej(r.error); };
    });
  }
  function tx(store, mode, fn) { return idb().then(function (d) { return new Promise(function (res, rej) { var t = d.transaction(store, mode), s = t.objectStore(store), out = fn(s); t.oncomplete = function () { res(out && out.result !== undefined ? out.result : out); }; t.onerror = function () { rej(t.error); }; }); }); }
  var kvGet = function (k) { return tx('kv', 'readonly', function (s) { return s.get(k); }); };
  var kvSet = function (k, v) { return tx('kv', 'readwrite', function (s) { s.put(v, k); }); };
  var obAll = function () { return tx('outbox', 'readonly', function (s) { return s.getAll(); }); };
  var obPut = function (e) { return tx('outbox', 'readwrite', function (s) { s.put(e); }); };
  var obDel = function (u) { return tx('outbox', 'readwrite', function (s) { s.delete(u); }); };

  // ── state / UI helpers ─────────────────────────────────────────────────────────────
  var B = null, site = null, lowbw = false, draftPhotos = [];
  function msg(text, cls) { var m = $('msg'); if (!text) { m.className = 'status hidden'; m.textContent = ''; return; } m.className = 'status ' + (cls || ''); m.textContent = text; }
  function setNet() { var n = $('net'); var on = navigator.onLine; n.textContent = on ? 'Online' : 'Offline'; n.className = 'net ' + (on ? 'on' : 'off'); }
  function show(view) { document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); }); $('v-' + view).classList.remove('hidden'); document.querySelectorAll('nav.tabs button').forEach(function (b) { if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }); if (view === 'dash') loadDash(); }
  function opt(sel, items, val, lab) { var s = $(sel); s.innerHTML = ''; (items || []).forEach(function (it) { var o = document.createElement('option'); o.value = val(it); o.textContent = lab(it); s.appendChild(o); }); }
  function curSite() { return (B && B.sites || []).find(function (s) { return String(s.id) === String($('site').value); }) || null; }

  // ── bootstrap (network first, cache fallback) ─────────────────────────────────────
  function bootstrap() {
    return api('/api/field/bootstrap').then(function (j) {
      if (j.ok) { B = j; kvSet('bootstrap', j); kvSet('bootstrap_at', new Date().toISOString()); return B; }
      if (j.__status === 401) { location.href = '../login.html?next=' + encodeURIComponent('/field/index.html'); throw new Error('login'); }
      throw new Error(j.error || 'bootstrap failed');
    }).catch(function (e) { return kvGet('bootstrap').then(function (c) { if (!c) throw e; B = c; msg('Working from cached data (offline).', ''); return B; }); });
  }
  function renderHome() {
    opt('site', B.sites, function (s) { return s.id; }, function (s) { return s.name; });
    if (site) $('site').value = site;
    site = $('site').value;
    kvGet('bootstrap_at').then(function (at) { $('asof').textContent = 'Data as of ' + (at ? new Date(at).toLocaleString() : '—') + (B.__stale ? ' (cached)' : ''); });
    var s = curSite(), acts = (B.actions || []).filter(function (a) { return !s || a.site === s.inspection_code; });
    var overdue = acts.filter(function (a) { return a.due_date && a.due_date < new Date().toISOString().slice(0, 10); }).length;
    $('tiles').innerHTML = '<div class="tile"><div class="n">' + acts.length + '</div><div class="l">open actions</div></div><div class="tile"><div class="n">' + overdue + '</div><div class="l">overdue</div></div><div class="tile"><div class="n">' + (B.trackers || []).length + '</div><div class="l">trackers to fill</div></div>';
    renderOutbox(); renderInspect(); renderTracker(); renderActions();
    $('ticket-off').classList.toggle('hidden', !!(B.features && B.features.ticket)); $('k-send').disabled = !(B.features && B.features.ticket);
  }
  function renderOutbox() {
    obAll().then(function (items) {
      $('queue').textContent = String(items.length);
      $('outbox-list').innerHTML = items.length ? items.map(function (e) { return '<div class="item"><span class="pill slate">' + esc(e.kind) + '</span> ' + esc(e.label || '') + ' <span class="muted">' + esc(e.client_ts) + (e.last_error ? ' · ' + esc(e.last_error) : '') + '</span></div>'; }).join('') : 'Nothing queued.';
    });
  }

  // ── outbox: queue + flush ─────────────────────────────────────────────────────────
  function queue(kind, payload, label, uploads) {
    var env = { uuid: uuid(), kind: kind, payload: payload, client_ts: new Date().toISOString(), device: navigator.userAgent.slice(0, 100), label: label, uploads: uploads || [] };
    return obPut(env).then(function () { renderOutbox(); msg('Queued — it will sync when online.', 'ok'); if (navigator.onLine) flush(); });
  }
  var flushing = false;
  function flush() {
    if (flushing || !navigator.onLine) return Promise.resolve();
    flushing = true;
    return obAll().then(function (items) {
      items.sort(function (a, b) { return a.client_ts < b.client_ts ? -1 : 1; });
      return items.reduce(function (p, e) { return p.then(function () { return sendOne(e); }); }, Promise.resolve());
    }).catch(function (e) { msg('Sync problem: ' + e.message, 'err'); }).then(function () { flushing = false; renderOutbox(); });
  }
  function sendOne(e) {
    return uploadPhotos(e).then(function () {
      return api('/api/field/outbox/' + e.uuid, { method: 'PUT', body: { kind: e.kind, payload: e.payload, client_ts: e.client_ts, device: e.device } });
    }).then(function (j) {
      if (j.__status === 503 && j.offline) return;                                  // still offline: keep
      if (j.__status >= 500) { e.last_error = j.error || 'server error'; return obPut(e); }   // retry later
      // terminal: applied, duplicate, rejected (400/403), conflict (409) → drop from the phone
      var fine = j.ok || j.duplicate;
      msg((fine ? 'Synced: ' : 'Refused: ') + (e.label || e.kind) + (fine ? '' : ' — ' + ((j.result && j.result.error) || j.error || j.status)), fine ? 'ok' : 'err');
      return obDel(e.uuid);
    });
  }
  // Photos: each draft photo {b64, mime, size, name, upload_id?} is uploaded in chunks; once done the
  // inspection payload references {upload_id} (server turns it into a blob ref).
  function uploadPhotos(e) {
    if (!e.uploads || !e.uploads.length) return Promise.resolve();
    return e.uploads.reduce(function (p, ph) {
      return p.then(function () {
        if (ph.done) return;
        var start = ph.upload_id ? api('/api/field/uploads/' + ph.upload_id).then(function (j) { return j.upload; })
          : api('/api/field/uploads', { method: 'POST', body: { owner_id: e.payload.meta.f_id, name: ph.name, mime: ph.mime, size: ph.size } }).then(function (j) { if (!j.ok) throw new Error(j.error); ph.upload_id = j.upload.id; return j.upload; });
        return start.then(function (up) {
          var cb = up.chunk_bytes, bin = atob(ph.b64), missing = up.missing || [];
          return missing.reduce(function (q, idx) { return q.then(function () { var part = bin.slice(idx * cb, (idx + 1) * cb); return api('/api/field/uploads/' + up.id + '/chunks/' + idx, { method: 'PUT', body: { data: btoa(part) } }).then(function (j) { if (!j.ok) throw new Error(j.error); }); }); }, Promise.resolve())
            .then(function () { return api('/api/field/uploads/' + up.id + '/complete', { method: 'POST' }); })
            .then(function (j) { if (!j.ok) throw new Error(j.error); ph.done = true; ph.b64 = null; (e.payload.items[ph.item] = e.payload.items[ph.item] || { photos: [] }).photos = (e.payload.items[ph.item].photos || []).map(function (x) { return x.upload_ref === ph.ref ? { upload_id: up.id, caption: x.caption || '' } : x; }); return obPut(e); });
        });
      });
    }, Promise.resolve());
  }

  // ── inspection quick capture ─────────────────────────────────────────────────────
  function renderInspect() {
    var L = B.lookups || {};
    opt('i-area', L.areas || [], function (a) { return a.code; }, function (a) { return a.name_en; });
    opt('i-cat', L.categories || [], function (c) { return c.id; }, function (c) { return c.name_en; });
    renderItems();
  }
  function renderItems() {
    var cat = ((B.lookups || {}).categories || []).find(function (c) { return c.id === $('i-cat').value; });
    var STATUS = ['ok', 'minor', 'major', 'critical', 'na'];
    $('i-items').innerHTML = cat ? cat.items.map(function (it, i) { return '<div class="ci"><span>' + esc(it.l) + '</span><div class="seg" role="group" aria-label="' + esc(it.l) + '">' + STATUS.map(function (s) { return '<button type="button" data-ix="' + i + '" data-st="' + s + '" aria-pressed="false">' + s + '</button>'; }).join('') + '</div></div>'; }).join('') : '';
  }
  function compress(file, cap) {
    return new Promise(function (res, rej) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        URL.revokeObjectURL(url);
        var side = 1280, w = img.width, h = img.height, k = Math.min(1, side / Math.max(w, h)), c = document.createElement('canvas');
        c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        var q = 0.8, out;
        do { out = c.toDataURL('image/jpeg', q); q -= 0.1; } while (out.length * 0.75 > cap && q > 0.3);
        var b64 = out.split(',')[1], size = Math.floor(b64.length * 3 / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
        if (size > cap) return rej(new Error('photo still over ' + Math.round(cap / 1024) + ' KB after compression'));
        res({ b64: b64, mime: 'image/jpeg', size: size, name: (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg' });
      };
      img.onerror = function () { rej(new Error('cannot read image')); }; img.src = url;
    });
  }
  function queueInspection() {
    var s = curSite(); if (!s || !s.inspection_code) return msg('Pick a site with an inspection code first.', 'err');
    var cat = $('i-cat').value, items = {}, n = 0;
    document.querySelectorAll('#i-items button[aria-pressed="true"]').forEach(function (b) { items[cat + '__' + b.dataset.ix] = { status: b.dataset.st, notes: '' }; n++; });
    if (!n && !draftPhotos.length) return msg('Mark at least one item or add a photo.', 'err');
    var d = new Date(), id = 'EM-IT-' + d.toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(Math.random() * 9000 + 1000);
    var firstKey = Object.keys(items)[0] || (cat + '__0'); items[firstKey] = items[firstKey] || { status: 'ok', notes: '' };
    items[firstKey].photos = draftPhotos.map(function (p) { return { upload_ref: p.ref, caption: '' }; });
    var uploads = draftPhotos.map(function (p) { return { ref: p.ref, b64: p.b64, mime: p.mime, size: p.size, name: p.name, item: firstKey }; });
    var meta = { f_id: id, f_site: s.name + ' (' + s.inspection_code + ')', f_date: d.toISOString().slice(0, 10), f_time: d.toTimeString().slice(0, 5), f_area: $('i-area').value, f_inspector: $('i-insp').value || (B.user && B.user.name) || '', f_type: 'routine', f_obs: $('i-notes').value || '', f_label: 'Field quick capture' };
    queue('inspection', { meta: meta, items: items, actions: [], status: 'submitted' }, 'Inspection ' + id + ' · ' + s.name, uploads).then(resetInspect);
  }
  function resetInspect() { draftPhotos = []; $('i-photos').innerHTML = ''; $('i-notes').value = ''; $('i-photo').value = ''; renderItems(); }

  // ── tracker entry ────────────────────────────────────────────────────────────────
  function renderTracker() {
    opt('t-key', B.trackers || [], function (t) { return t.key; }, function (t) { return t.title; });
    renderTrackerUnits();
  }
  function curTracker() { return (B.trackers || []).find(function (t) { return t.key === $('t-key').value; }); }
  function renderTrackerUnits() {
    var t = curTracker(); if (!t) { $('t-items').innerHTML = ''; return; }
    var units = t.definition.units.filter(function (u) { return !Array.isArray(t.writable) || t.writable.indexOf(u.code) >= 0; });
    opt('t-unit', units, function (u) { return u.code; }, function (u) { return u.name || u.code; });
    var slots = []; for (var i = 1; i <= ((t.definition.period && t.definition.period.count) || 12); i++) slots.push(i);
    opt('t-slot', slots.filter(function (s) { return (t.closed || []).indexOf(s) < 0; }), function (s) { return s; }, function (s) { return 'Period ' + s; });
    var items = []; (t.definition.groups || []).forEach(function (g) { (g.items || []).forEach(function (it) { items.push(it); }); });
    $('t-items').innerHTML = items.map(function (it) { return '<label>' + esc(it.name || it.code) + ' <input data-item="' + esc(it.code) + '" inputmode="decimal"></label>'; }).join('');
  }
  function queueTracker() {
    var t = curTracker(); if (!t) return;
    var cells = []; document.querySelectorAll('#t-items input').forEach(function (i) { if (i.value !== '') cells.push({ unit: $('t-unit').value, item: i.dataset.item, slot: Number($('t-slot').value), value: Number(i.value) }); });
    if (!cells.length) return msg('Enter at least one value.', 'err');
    queue('tracker', { key: t.key, cells: cells }, t.title + ' · ' + $('t-unit').value + ' · P' + $('t-slot').value).then(function () { document.querySelectorAll('#t-items input').forEach(function (i) { i.value = ''; }); });
  }

  // ── actions + ticket ─────────────────────────────────────────────────────────────
  var TRANSFER = ['demand', 'helpdesk_ticket', 'cancelled'];
  function renderActions() {
    var s = curSite(), acts = (B.actions || []).filter(function (a) { return !s || a.site === s.inspection_code; });
    $('a-list').innerHTML = acts.length ? acts.map(function (a, i) {
      var closeVal = a.source === 'inspection' ? 'Closed' : 'closed';
      return '<div class="item"><div><span class="pill ' + (a.due_date && a.due_date < new Date().toISOString().slice(0, 10) ? 'red' : 'slate') + '">' + esc(a.source) + '</span> ' + esc(a.description) + ' <span class="muted">' + esc(a.owner || '') + ' · due ' + esc(a.due_date || '—') + ' · ' + esc(a.status) + '</span></div><div class="row"><button type="button" data-a="' + i + '" data-st="' + closeVal + '">Close</button><button type="button" data-a="' + i + '" data-st="helpdesk_ticket">→ Ticket</button><button type="button" data-a="' + i + '" data-st="demand">→ Demand</button><button type="button" data-a="' + i + '" data-st="cancelled" class="danger">Cancel</button></div></div>';
    }).join('') : 'No open action for this site.';
    $('a-list').querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { actionChange(acts[Number(b.dataset.a)], b.dataset.st); }); });
  }
  function ask(needTicket) {
    return new Promise(function (res) { var d = $('dlg'); $('dlg-note').value = ''; $('dlg-ticket').value = ''; $('dlg-ticket-l').classList.toggle('hidden', !needTicket); d.returnValue = ''; d.onclose = function () { res(d.returnValue === 'ok' ? { note: $('dlg-note').value.trim(), ticket: $('dlg-ticket').value.replace(/\D/g, '') } : null); }; d.showModal(); });
  }
  function actionChange(a, st) {
    var p = TRANSFER.indexOf(st) >= 0 ? ask(st === 'helpdesk_ticket') : Promise.resolve({ note: '', ticket: '' });
    p.then(function (j) {
      if (!j) return; if (TRANSFER.indexOf(st) >= 0 && !j.note) return msg('A justification is required for this status.', 'err');
      if (st === 'helpdesk_ticket' && !j.ticket) return msg('The SDP ticket number is required.', 'err');
      var payload = { source: a.source, id: a.id, status_change: st, body: j.note || 'Closed from the field app' };
      if (j.ticket) payload.helpdesk_ticket = j.ticket;
      queue('action', payload, (a.source === 'inspection' ? 'Inspection' : 'Meeting') + ' action #' + a.id + ' → ' + st);
      B.actions = (B.actions || []).filter(function (x) { return x !== a; }); renderActions();
    });
  }
  function queueTicket() {
    var s = curSite(), subj = $('k-subject').value.trim(); if (!subj) return msg('Subject required.', 'err');
    queue('ticket', { subject: subj, description: $('k-desc').value, site: s ? s.name : null }, 'Ticket: ' + subj).then(function () { $('k-subject').value = ''; $('k-desc').value = ''; });
  }

  // ── field dashboard (published `field-site`, data from the dashboards API) ───────
  function loadDash() {
    var s = curSite(); if (!s) return;
    api('/api/dashboards/field-site/data?site=' + encodeURIComponent(s.id)).then(function (j) {
      if (!j.ok) { $('d-widgets').textContent = j.error || 'unavailable'; return; }
      var html = '', asOf = null;
      Object.keys(j.widgets || {}).forEach(function (k) { var w = j.widgets[k]; if (w.as_of && (!asOf || w.as_of > asOf)) asOf = w.as_of; var v = w.value == null ? '—' : (w.display || w.value); html += '<div class="tile"><div class="n">' + esc(v) + (w.unit ? '<small> ' + esc(w.unit) + '</small>' : '') + '</div><div class="l">' + esc(w.title || k) + (w.rag ? ' <span class="pill ' + esc(String(w.rag).toLowerCase()) + '">' + esc(w.rag) + '</span>' : '') + '</div></div>'; });
      $('d-widgets').innerHTML = (html || 'No widget') + '<div class="asof">Data as of ' + (asOf ? new Date(asOf).toLocaleString() : '— (not measured)') + (j.__stale ? ' · cached' : '') + '</div>';
    }).catch(function (e) { $('d-widgets').textContent = 'Offline — ' + e.message; });
  }

  // ── wiring ───────────────────────────────────────────────────────────────────────
  document.querySelectorAll('nav.tabs button').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.view); }); });
  $('site').addEventListener('change', function () { site = $('site').value; kvSet('site', site); renderHome(); });
  $('sync').addEventListener('click', function () { msg(''); bootstrap().then(renderHome).then(flush).catch(function (e) { msg(e.message, 'err'); }); });
  $('lowbw').addEventListener('change', function () { lowbw = $('lowbw').checked; document.body.classList.toggle('lowbw', lowbw); kvSet('lowbw', lowbw); });
  $('i-cat').addEventListener('change', renderItems);
  $('i-items').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-ix]'); if (!b) return; b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); });
  $('i-photo').addEventListener('change', function () { var f = $('i-photo').files[0]; if (!f) return; compress(f, (B.limits && B.limits.photo_max_bytes) || 300 * 1024).then(function (p) { p.ref = uuid(); draftPhotos.push(p); var img = document.createElement('img'); img.alt = 'photo ' + draftPhotos.length; img.src = 'data:image/jpeg;base64,' + p.b64; $('i-photos').appendChild(img); msg('Photo added (' + Math.round(p.size / 1024) + ' KB).', 'ok'); }).catch(function (e) { msg(e.message, 'err'); }); });
  $('i-save').addEventListener('click', queueInspection); $('i-reset').addEventListener('click', resetInspect);
  $('t-key').addEventListener('change', renderTrackerUnits); $('t-save').addEventListener('click', queueTracker);
  $('k-send').addEventListener('click', queueTicket);
  window.addEventListener('online', function () { setNet(); flush(); }); window.addEventListener('offline', setNet); setNet();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { /* app still works without it */ });

  Promise.all([kvGet('site'), kvGet('lowbw')]).then(function (r) { site = r[0] || null; lowbw = !!r[1]; $('lowbw').checked = lowbw; document.body.classList.toggle('lowbw', lowbw); return bootstrap(); })
    .then(renderHome).then(flush).catch(function (e) { msg(e.message, 'err'); });
})();
