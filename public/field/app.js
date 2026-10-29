/* Step 10 — field PWA. Offline-first: bootstrap cached in IndexedDB, every write queued as an
   ENVELOPE {uuid, kind, payload} and PUT to /api/field/outbox/:uuid when online — exactly once on the
   server (idempotent on uuid), deleted here on any terminal answer (applied / rejected / 409). Photos are
   compressed on the device (≤ 300 KB) and uploaded in 64 KB chunks before the inspection envelope.
   No framework, no inline handlers. */
(function () {
  'use strict';
  var FT = window.FT || function (s) { return s; };
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  // E5: the session is the httpOnly report_token cookie (sent by the browser); only the cached
  // profile is readable here. An expired cookie answers 401 and sends the user to login.
  var profile = null; try { profile = localStorage.getItem('report_user'); } catch (_) { profile = null; }
  if (!profile) { location.href = '../login.html?next=' + encodeURIComponent('/field/index.html'); return; }
  // G19 — every queued entry carries its author; a phone shared by two people never sends one person's entry
  // under the other's session
  var me = ''; try { me = String((JSON.parse(profile) || {}).username || ''); } catch (_) { me = ''; }
  var STALE_DAYS = 3, OLD_DAYS = 14;
  var ageDays = function (iso) { var t = Date.parse(iso || ''); return isFinite(t) ? Math.floor((Date.now() - t) / 864e5) : null; };
  var H = function (extra) { return Object.assign({}, extra || {}); };
  function api(path, o) {
    o = o || {};
    return fetch(path, { method: o.method || 'GET', credentials: 'same-origin', headers: H(o.body ? { 'content-type': 'application/json' } : {}), body: o.body ? JSON.stringify(o.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return { error: 'HTTP ' + r.status + ' (not JSON — proxy or network page)' }; }).then(function (j) { j.__status = r.status; j.__stale = r.headers.get('x-field-cache') === 'stale'; return j; }); });
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
  // G19 — swap an entry for its copy in ONE transaction: never a moment where neither exists
  var obSwap = function (oldId, e) { return tx('outbox', 'readwrite', function (s) { s.put(e); s.delete(oldId); }); };

  // ── state / UI helpers ─────────────────────────────────────────────────────────────
  var B = null, site = null, lowbw = false, draftPhotos = [];
  function msg(text, cls) { var m = $('msg'); if (!text) { m.className = 'status hidden'; m.textContent = ''; return; } m.className = 'status ' + (cls || ''); m.textContent = text; }
  function setNet() { var n = $('net'); var on = navigator.onLine; n.textContent = on ? FT('Online') : FT('Offline'); n.className = 'net ' + (on ? 'on' : 'off'); }
  function show(view) { document.querySelectorAll('.view').forEach(function (v) { v.classList.add('hidden'); }); $('v-' + view).classList.remove('hidden'); document.querySelectorAll('nav.tabs button').forEach(function (b) { if (b.dataset.view === view) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }); if (view === 'dash') loadDash(); }
  function opt(sel, items, val, lab) { var s = $(sel); s.innerHTML = ''; (items || []).forEach(function (it) { var o = document.createElement('option'); o.value = val(it); o.textContent = lab(it); s.appendChild(o); }); }
  function curSite() { return (B && B.sites || []).find(function (s) { return String(s.id) === String($('site').value); }) || null; }

  // ── bootstrap (network first, cache fallback) ─────────────────────────────────────
  function bootstrap() {
    return api('/api/field/bootstrap').then(function (j) {
      // a cached answer from the service worker may belong to the previous user of this phone: refuse it
      if (j.ok && j.__stale && !(j.user && j.user.username === me)) throw new Error('cached data of another user');
      if (j.ok) { B = j; kvSet('bootstrap:' + me, j); kvSet('bootstrap_at:' + me, new Date().toISOString()); return B; }
      if (j.__status === 401) { location.href = '../login.html?next=' + encodeURIComponent('/field/index.html'); throw new Error('login'); }
      throw new Error(j.error || 'bootstrap failed');
    }).catch(function (e) { return kvGet('bootstrap:' + me).then(function (c) { if (!c) throw e; B = c; msg(FT('Working from cached data (offline).'), ''); return B; }); });
  }
  function renderHome() {
    opt('site', B.sites, function (s) { return s.id; }, function (s) { return s.name; });
    if (site) $('site').value = site;
    site = $('site').value;
    kvGet('bootstrap_at:' + me).then(function (at) { var d = ageDays(at); $('asof').textContent = FT('Data as of') + ' ' + (at ? new Date(at).toLocaleString() : '—') + (B.__stale ? ' ' + FT('(cached)') : '') + (d != null && d >= STALE_DAYS ? ' — ' + FT('cached data is') + ' ' + d + ' ' + FT('days old, sync when you can') : ''); $('asof').classList.toggle('warn', d != null && d >= STALE_DAYS); });
    var s = curSite(), acts = (B.actions || []).filter(function (a) { return !s || a.site === s.inspection_code; });
    var overdue = acts.filter(function (a) { return a.due_date && a.due_date < new Date().toISOString().slice(0, 10); }).length;
    $('tiles').innerHTML = '<div class="tile"><div class="n">' + acts.length + '</div><div class="l">' + FT('open actions') + '</div></div><div class="tile"><div class="n">' + overdue + '</div><div class="l">' + FT('overdue') + '</div></div><div class="tile"><div class="n">' + (B.trackers || []).length + '</div><div class="l">' + FT('trackers to fill') + '</div></div>';
    renderOutbox(); renderInspect(); renderTracker(); renderActions();
    $('ticket-off').classList.toggle('hidden', !!(B.features && B.features.ticket)); $('k-send').disabled = !(B.features && B.features.ticket);
  }
  // G19 — explicit states on the phone. Only 'applied' / 'duplicate' answers remove an entry; a refusal or a
  // conflict is KEPT and shown, and only the user discards it (with a confirmation) — no silent data loss.
  var STATE_LABEL = { pending: 'waiting', failed: 'will retry', rejected: 'refused', conflict: 'conflict', applied_before: 'already applied (earlier version)', other_user: 'other user', unknown_author: 'unknown author — review' };
  var STATE_PILL = { pending: 'slate', failed: 'amber', rejected: 'red', conflict: 'red', applied_before: 'amber', other_user: 'slate', unknown_author: 'amber' };
  function stateOf(e) {
    if (!e.user) return 'unknown_author';                          // queued before authors were recorded: review, never auto-send
    if (me && e.user !== me) return 'other_user';
    return e.state || 'pending';
  }
  function renderOutbox() {
    obAll().then(function (items) {
      $('queue').textContent = String(items.length);
      var stuck = items.filter(function (e) { var st = stateOf(e); return st === 'rejected' || st === 'conflict'; }).length;
      $('queue').className = 'pill ' + (stuck ? 'red' : 'slate');
      $('outbox-list').innerHTML = items.length ? items.map(function (e) {
        var st = stateOf(e), d = ageDays(e.client_ts);
        // a refused entry can be sent again (nothing was written); a conflict whose original was applied, or an
        // entry of unknown author, can only be discarded — re-sending would apply it a second time
        var again = (st === 'rejected' || st === 'conflict' || st === 'unknown_author') ? ' <button type="button" data-ob-again="' + esc(e.uuid) + '">' + FT(st === 'unknown_author' ? 'Send as me' : 'Send again') + '</button>' : '';
        var drop = (st === 'rejected' || st === 'conflict' || st === 'applied_before' || st === 'unknown_author') ? ' <button type="button" class="danger" data-ob-drop="' + esc(e.uuid) + '">' + FT('Discard') + '</button>' : '';
        var acts = again + drop + (st === 'rejected' ? ' <span class="muted">' + FT('(sending it unchanged will be refused again)') + '</span>' : '');
        return '<div class="item"><span class="pill ' + STATE_PILL[st] + '">' + esc(FT(STATE_LABEL[st])) + '</span> <span class="pill slate">' + esc(e.kind) + '</span> ' + esc(e.label || '') +
          ' <span class="muted">' + esc(e.client_ts) + (d != null && d >= OLD_DAYS ? ' · ' + FT('waiting for') + ' ' + d + ' ' + FT('days') : '') + (st === 'other_user' ? ' · ' + FT('sign in as') + ' ' + esc(e.user) + ' ' + FT('to send it') : '') + (e.last_error ? ' · ' + esc(e.last_error) : '') + '</span>' + acts + '</div>';
      }).join('') : FT('Nothing queued.');
    });
  }

  // ── outbox: queue + flush ─────────────────────────────────────────────────────────
  function queue(kind, payload, label, uploads) {
    var env = { uuid: uuid(), kind: kind, payload: payload, client_ts: new Date().toISOString(), device: navigator.userAgent.slice(0, 100), label: label, uploads: uploads || [], user: me, state: 'pending' };
    return obPut(env).then(function () { renderOutbox(); msg(FT('Queued — it will sync when online.'), 'ok'); if (navigator.onLine) flush(); });
  }
  var flushing = false;
  function flush() {
    if (flushing || !navigator.onLine) return Promise.resolve();
    flushing = true;
    return obAll().then(function (items) {
      items = items.filter(function (e) { var st = stateOf(e); return st === 'pending' || st === 'failed'; });
      items.sort(function (a, b) { return a.client_ts < b.client_ts ? -1 : 1; });
      return items.reduce(function (p, e) { return p.then(function (stop) { return stop ? stop : sendOne(e).catch(function (err) { return entryError(e, err); }); }); }, Promise.resolve());
    }).catch(function (e) { msg(FT('Sync problem: ') + e.message, 'err'); }).then(function () { flushing = false; renderOutbox(); });
  }
  // G19 — one failing entry never blocks the others: a 401 stops the sync (sign in again), a refusal of a photo
  // upload marks this entry refused, anything else (network, a proxy HTML page) marks it 'failed' and moves on
  function entryError(e, err) {
    if (err && err.status === 401) { msg(FT('Session expired — sign in again. Nothing was lost: your entries are kept on this phone.'), 'err'); return true; }
    e.state = err && err.status >= 400 && err.status < 500 ? 'rejected' : 'failed';
    e.last_error = String((err && err.message) || err || 'error').slice(0, 300);
    return obPut(e).then(function () {});
  }
  function sendOne(e) {
    return uploadPhotos(e).then(function () {
      return api('/api/field/outbox/' + e.uuid, { method: 'PUT', body: { kind: e.kind, payload: e.payload, client_ts: e.client_ts, device: e.device } });
    }).then(function (j) {
      if (j.__status === 503 && j.offline) return true;                             // still offline: keep, stop
      if (j.__status === 401) { msg(FT('Session expired — sign in again. Nothing was lost: your entries are kept on this phone.'), 'err'); return true; }
      if (j.__status === 409 && j.in_progress) return;                               // being applied elsewhere: retry next sync
      if (j.__status >= 500) { e.state = 'failed'; e.last_error = j.error || 'server error'; return obPut(e).then(function () {}); }
      if (j.ok || (j.duplicate && j.status === 'applied')) { msg(FT('Synced: ') + (e.label || e.kind), 'ok'); return obDel(e.uuid).then(function () {}); }
      // refused or conflicting: kept on the phone with the reason, until the user decides
      e.state = j.__status === 409 ? (j.status === 'applied' ? 'applied_before' : 'conflict') : 'rejected';
      e.last_error = String((j.result && j.result.error) || j.error || j.status || 'refused').slice(0, 300);
      msg(FT('Refused: ') + (e.label || e.kind) + ' — ' + e.last_error, 'err');
      return obPut(e).then(function () {});
    });
  }
  // Photos: each draft photo {b64, mime, size, name, upload_id?} is uploaded in chunks; once done the
  // inspection payload references {upload_id} (server turns it into a blob ref).
  function upErr(j) { var er = new Error(FT('Photo upload: ') + (j.error || ('HTTP ' + j.__status))); er.status = j.__status; return er; }
  function uploadPhotos(e) {
    if (!e.uploads || !e.uploads.length) return Promise.resolve();
    return e.uploads.reduce(function (p, ph) {
      return p.then(function () {
        if (ph.done) return;
        var start = ph.upload_id ? api('/api/field/uploads/' + ph.upload_id).then(function (j) { if (!j.ok) throw upErr(j); return j.upload; })
          : api('/api/field/uploads', { method: 'POST', body: { owner_id: e.payload.meta.f_id, name: ph.name, mime: ph.mime, size: ph.size } }).then(function (j) { if (!j.ok) throw upErr(j); ph.upload_id = j.upload.id; return obPut(e).then(function () { return j.upload; }); });
        return start.then(function (up) {
          var cb = up.chunk_bytes, bin = atob(ph.b64), missing = up.missing || [];
          return missing.reduce(function (q, idx) { return q.then(function () { var part = bin.slice(idx * cb, (idx + 1) * cb); return api('/api/field/uploads/' + up.id + '/chunks/' + idx, { method: 'PUT', body: { data: btoa(part) } }).then(function (j) { if (!j.ok) throw upErr(j); }); }); }, Promise.resolve())
            .then(function () { return api('/api/field/uploads/' + up.id + '/complete', { method: 'POST' }); })
            .then(function (j) { if (!j.ok && !j.duplicate) throw upErr(j); ph.done = true; ph.b64 = null; (e.payload.items[ph.item] = e.payload.items[ph.item] || { photos: [] }).photos = (e.payload.items[ph.item].photos || []).map(function (x) { return x.upload_ref === ph.ref ? { upload_id: up.id, caption: x.caption || '' } : x; }); return obPut(e); });
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
    $('i-items').innerHTML = cat ? cat.items.map(function (it, i) { return '<div class="ci"><span>' + esc(it.l) + '</span><div class="seg" role="group" aria-label="' + esc(it.l) + '">' + STATUS.map(function (s) { return '<button type="button" data-ix="' + i + '" data-st="' + s + '" aria-pressed="false">' + esc(FT(s)) + '</button>'; }).join('') + '</div></div>'; }).join('') : '';
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
  // G19 — a second tap while an entry is being queued does nothing (no duplicate entry from a double tap)
  var busy = false;
  function once(btn, fn) { return function () { if (busy) return; busy = true; if (btn) btn.disabled = true; Promise.resolve().then(fn).catch(function (e) { msg(e.message, 'err'); }).then(function () { busy = false; if (btn) btn.disabled = false; }); }; }
  function queueInspection() {
    var s = curSite(); if (!s || !s.inspection_code) return msg(FT('Pick a site with an inspection code first.'), 'err');
    var cat = $('i-cat').value, items = {}, n = 0;
    document.querySelectorAll('#i-items button[aria-pressed="true"]').forEach(function (b) { items[cat + '__' + b.dataset.ix] = { status: b.dataset.st, notes: '' }; n++; });
    if (!n && !draftPhotos.length) return msg(FT('Mark at least one item or add a photo.'), 'err');
    var d = new Date(), id = 'EM-IT-' + d.toISOString().slice(0, 10).replace(/-/g, '') + '-' + Math.floor(Math.random() * 9000 + 1000);
    var firstKey = Object.keys(items)[0] || (cat + '__0'); items[firstKey] = items[firstKey] || { status: 'ok', notes: '' };
    items[firstKey].photos = draftPhotos.map(function (p) { return { upload_ref: p.ref, caption: '' }; });
    var uploads = draftPhotos.map(function (p) { return { ref: p.ref, b64: p.b64, mime: p.mime, size: p.size, name: p.name, item: firstKey }; });
    var meta = { f_id: id, f_site: s.name + ' (' + s.inspection_code + ')', f_date: d.toISOString().slice(0, 10), f_time: d.toTimeString().slice(0, 5), f_area: $('i-area').value, f_inspector: $('i-insp').value || (B.user && B.user.name) || '', f_type: 'routine', f_obs: $('i-notes').value || '', f_label: 'Field quick capture' };
    return queue('inspection', { meta: meta, items: items, actions: [], status: 'submitted' }, 'Inspection ' + id + ' · ' + s.name, uploads).then(resetInspect);
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
    opt('t-slot', slots.filter(function (s) { return (t.closed || []).indexOf(s) < 0; }), function (s) { return s; }, function (s) { return FT('Period') + ' ' + s; });
    var items = []; (t.definition.groups || []).forEach(function (g) { (g.items || []).forEach(function (it) { items.push(it); }); });
    $('t-items').innerHTML = items.map(function (it) { return '<label>' + esc(it.name || it.code) + ' <input data-item="' + esc(it.code) + '" inputmode="decimal"></label>'; }).join('');
  }
  function queueTracker() {
    var t = curTracker(); if (!t) return;
    var cells = []; document.querySelectorAll('#t-items input').forEach(function (i) { if (i.value !== '') cells.push({ unit: $('t-unit').value, item: i.dataset.item, slot: Number($('t-slot').value), value: Number(i.value) }); });
    if (!cells.length) return msg(FT('Enter at least one value.'), 'err');
    return queue('tracker', { key: t.key, cells: cells }, t.title + ' · ' + $('t-unit').value + ' · P' + $('t-slot').value).then(function () { document.querySelectorAll('#t-items input').forEach(function (i) { i.value = ''; }); });
  }

  // ── actions + ticket ─────────────────────────────────────────────────────────────
  var TRANSFER = ['demand', 'helpdesk_ticket', 'cancelled'];
  function renderActions() {
    var s = curSite(), acts = (B.actions || []).filter(function (a) { return !s || a.site === s.inspection_code; });
    $('a-list').innerHTML = acts.length ? acts.map(function (a, i) {
      var closeVal = a.source === 'inspection' ? 'Closed' : 'closed';
      return '<div class="item"><div><span class="pill ' + (a.due_date && a.due_date < new Date().toISOString().slice(0, 10) ? 'red' : 'slate') + '">' + esc(a.source) + '</span> ' + esc(a.description) + ' <span class="muted">' + esc(a.owner || '') + ' · ' + FT('due') + ' ' + esc(a.due_date || '—') + ' · ' + esc(a.status) + '</span></div><div class="row"><button type="button" data-a="' + i + '" data-st="' + closeVal + '">' + FT('Close') + '</button><button type="button" data-a="' + i + '" data-st="helpdesk_ticket">' + FT('→ Ticket') + '</button><button type="button" data-a="' + i + '" data-st="demand">' + FT('→ Demand') + '</button><button type="button" data-a="' + i + '" data-st="cancelled" class="danger">' + FT('Cancel') + '</button></div></div>';
    }).join('') : FT('No open action for this site.');
    $('a-list').querySelectorAll('button').forEach(function (b) { b.addEventListener('click', function () { actionChange(acts[Number(b.dataset.a)], b.dataset.st); }); });
  }
  function ask(needTicket) {
    return new Promise(function (res) { var d = $('dlg'); $('dlg-note').value = ''; $('dlg-ticket').value = ''; $('dlg-ticket-l').classList.toggle('hidden', !needTicket); d.returnValue = ''; d.onclose = function () { res(d.returnValue === 'ok' ? { note: $('dlg-note').value.trim(), ticket: $('dlg-ticket').value.replace(/\D/g, '') } : null); }; d.showModal(); });
  }
  function actionChange(a, st) {
    var p = TRANSFER.indexOf(st) >= 0 ? ask(st === 'helpdesk_ticket') : Promise.resolve({ note: '', ticket: '' });
    p.then(function (j) {
      if (!j) return; if (TRANSFER.indexOf(st) >= 0 && !j.note) return msg(FT('A justification is required for this status.'), 'err');
      if (st === 'helpdesk_ticket' && !j.ticket) return msg(FT('The SDP ticket number is required.'), 'err');
      var payload = { source: a.source, id: a.id, status_change: st, body: j.note || 'Closed from the field app' };
      if (j.ticket) payload.helpdesk_ticket = j.ticket;
      if (busy) return; busy = true;
      return queue('action', payload, (a.source === 'inspection' ? 'Inspection' : 'Meeting') + ' action #' + a.id + ' → ' + st)
        .then(function () { B.actions = (B.actions || []).filter(function (x) { return x !== a; }); renderActions(); })
        .catch(function (err) { msg(FT('Could not queue: ') + err.message, 'err'); })
        .then(function () { busy = false; });
    });
  }
  function queueTicket() {
    var s = curSite(), subj = $('k-subject').value.trim(); if (!subj) return msg(FT('Subject required.'), 'err');
    return queue('ticket', { subject: subj, description: $('k-desc').value, site: s ? s.name : null }, 'Ticket: ' + subj).then(function () { $('k-subject').value = ''; $('k-desc').value = ''; });
  }

  // ── field dashboard (published `field-site`, data from the dashboards API) ───────
  function loadDash() {
    var s = curSite(); if (!s) return;
    api('/api/dashboards/field-site/data?site=' + encodeURIComponent(s.id)).then(function (j) {
      if (!j.ok) { $('d-widgets').textContent = j.error || FT('unavailable'); return; }
      var html = '', asOf = null;
      Object.keys(j.widgets || {}).forEach(function (k) { var w = j.widgets[k]; if (w.as_of && (!asOf || w.as_of > asOf)) asOf = w.as_of; var v = w.value == null ? '—' : (w.display || w.value); html += '<div class="tile"><div class="n">' + esc(v) + (w.unit ? '<small> ' + esc(w.unit) + '</small>' : '') + '</div><div class="l">' + esc(w.title || k) + (w.rag ? ' <span class="pill ' + esc(String(w.rag).toLowerCase()) + '">' + esc(w.rag) + '</span>' : '') + '</div></div>'; });
      $('d-widgets').innerHTML = (html || FT('No widget')) + '<div class="asof">' + FT('Data as of') + ' ' + (asOf ? new Date(asOf).toLocaleString() : FT('— (not measured)')) + (j.__stale ? ' · ' + FT('cached') : '') + '</div>';
    }).catch(function (e) { $('d-widgets').textContent = FT('Offline') + ' — ' + e.message; });
  }

  // ── wiring ───────────────────────────────────────────────────────────────────────
  document.querySelectorAll('nav.tabs button').forEach(function (b) { b.addEventListener('click', function () { show(b.dataset.view); }); });
  $('site').addEventListener('change', function () { site = $('site').value; kvSet('site', site); renderHome(); });
  $('sync').addEventListener('click', function () { msg(''); bootstrap().then(renderHome).then(flush).catch(function (e) { msg(e.message, 'err'); }); });
  $('lowbw').addEventListener('change', function () { lowbw = $('lowbw').checked; document.body.classList.toggle('lowbw', lowbw); kvSet('lowbw', lowbw); });
  $('i-cat').addEventListener('change', renderItems);
  $('i-items').addEventListener('click', function (ev) { var b = ev.target.closest('button[data-ix]'); if (!b) return; b.parentNode.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', 'false'); }); b.setAttribute('aria-pressed', 'true'); });
  $('i-photo').addEventListener('change', function () { var f = $('i-photo').files[0]; if (!f) return; compress(f, (B.limits && B.limits.photo_max_bytes) || 300 * 1024).then(function (p) { p.ref = uuid(); draftPhotos.push(p); var img = document.createElement('img'); img.alt = 'photo ' + draftPhotos.length; img.src = 'data:image/jpeg;base64,' + p.b64; $('i-photos').appendChild(img); msg(FT('Photo added') + ' (' + Math.round(p.size / 1024) + ' KB).', 'ok'); }).catch(function (e) { msg(e.message, 'err'); }); });
  $('i-save').addEventListener('click', once($('i-save'), queueInspection)); $('i-reset').addEventListener('click', resetInspect);
  $('t-key').addEventListener('change', renderTrackerUnits); $('t-save').addEventListener('click', once($('t-save'), queueTracker));
  $('k-send').addEventListener('click', once($('k-send'), queueTicket));
  // refused / conflicting entries: "Send again" re-queues a copy under a new id (the server keeps the refusal of the
  // old one); "Discard" removes it only after a confirmation that names it
  $('outbox-list').addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var id = b.getAttribute('data-ob-again') || b.getAttribute('data-ob-drop'); if (!id) return;
    obAll().then(function (items) {
      var e = items.find(function (x) { return x.uuid === id; }); if (!e) return;
      if (b.hasAttribute('data-ob-drop')) { if (!window.confirm(FT('Discard this entry for good?') + '\n' + (e.label || e.kind))) return; return obDel(id).then(renderOutbox); }
      if (stateOf(e) === 'applied_before') return;
      var copy = Object.assign({}, e, { uuid: uuid(), state: 'pending', last_error: null, resent_from: e.uuid, user: me });
      return obSwap(id, copy).then(function () { renderOutbox(); flush(); });
    });
  });
  window.addEventListener('online', function () { setNet(); flush(); }); window.addEventListener('offline', setNet); setNet();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(function () { /* app still works without it */ });

  // drop the pre-G19 cache that was not keyed by user (it could show one person's sites to the next)
  tx('kv', 'readwrite', function (st) { st.delete('bootstrap'); st.delete('bootstrap_at'); }).catch(function () {});
  Promise.all([kvGet('site'), kvGet('lowbw')]).then(function (r) { site = r[0] || null; lowbw = !!r[1]; $('lowbw').checked = lowbw; document.body.classList.toggle('lowbw', lowbw); return bootstrap(); })
    .then(renderHome).then(flush).catch(function (e) { msg(e.message, 'err'); });
})();
