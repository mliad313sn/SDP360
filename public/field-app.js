/* Step 10 — the FIELD APP (field.html): works without network. Everything typed is kept on the phone (IndexedDB) and
 * put in an OUTBOX; the outbox is sent when the network is back (automatically, or on demand in low-bandwidth mode).
 *  - Inspections: the same checklist as the full form; photos compressed on the phone (≤ 300 KB, ≤ 150 KB in
 *    low-bandwidth mode) and sent in resumable chunks; the inspection itself is an idempotent PUT; a conflict
 *    (changed elsewhere since) is shown, never overwritten silently.
 *  - Tracker entries for the person's own units (the regular entries API).
 *  - Quick actions on a finding (open an SDP ticket): queued for a coordinator while SDP write is off.
 * No inline script (strict CSP). window.__authToken is the session token string (auth.js). */
(function () {
  'use strict';
  var S = window.SdpApi, esc = S.esc;
  var $ = function (id) { return document.getElementById(id); };
  var VERSION = (function () { var s = document.currentScript && document.currentScript.src; var m = s && s.match(/[?&]v=([^&]+)/); return m ? m[1] : 'dev'; })();
  var boot = null, settings = { lowbw: false }, current = null, syncing = false;
  var STATUS_CLASS = { ok: 'fd-ok', minor: 'fd-minor', major: 'fd-bad', critical: 'fd-bad', na: 'fd-na' };

  function msg(t, err) { var m = $('fd-msg'); m.textContent = t || ''; m.className = 'fd-msg' + (err ? ' fd-err' : ''); }
  function uuid() { return (crypto.randomUUID ? crypto.randomUUID() : (Date.now().toString(16) + Math.random().toString(16).slice(2))).replace(/[^A-Za-z0-9-]/g, ''); }
  var today = function () { return new Date().toISOString().slice(0, 10); };

  // ── IndexedDB ────────────────────────────────────────────────────────
  var dbp = null;
  function db() {
    if (!dbp) dbp = new Promise(function (ok, ko) {
      var r = indexedDB.open('sdp-field', 1);
      r.onupgradeneeded = function () { var d = r.result; ['kv', 'drafts', 'outbox', 'photos'].forEach(function (n) { if (!d.objectStoreNames.contains(n)) d.createObjectStore(n, { keyPath: 'id' }); }); };
      r.onsuccess = function () { ok(r.result); }; r.onerror = function () { ko(r.error); };
    });
    return dbp;
  }
  function tx(store, mode, fn) {
    return db().then(function (d) { return new Promise(function (ok, ko) {
      var t = d.transaction(store, mode), s = t.objectStore(store), out = fn(s);
      // A request's result is undefined when the key is absent: answer undefined, never the request object itself.
      t.oncomplete = function () { ok(out instanceof IDBRequest ? out.result : out); }; t.onerror = function () { ko(t.error); };
    }); });
  }
  var put = function (store, v) { return tx(store, 'readwrite', function (s) { s.put(v); }); };
  var del = function (store, id) { return tx(store, 'readwrite', function (s) { s.delete(id); }); };
  var getOne = function (store, id) { return tx(store, 'readonly', function (s) { return s.get(id); }); };
  var all = function (store) { return tx(store, 'readonly', function (s) { return s.getAll(); }); };

  // ── Coordinator: ticket requests of the site, done by hand in SDP while SDP write is off ──
  function renderSite() {
    if (!navigator.onLine) { $('fd-site').innerHTML = '<li>Cette liste demande le réseau.</li>'; return; }
    S.api('GET', '/api/field/quick-actions?status=pending_manual').then(function (r) {
      $('fd-site-n').textContent = r.actions.length + ' à traiter';
      $('fd-site').innerHTML = r.actions.length ? r.actions.map(function (a) {
        var p = a.payload || {};
        return '<li><b>' + esc(p.subject || a.label || a.kind) + '</b><small>' + esc((p.site || '') + ' · ' + a.username + ' · ' + String(a.created_at).slice(0, 16).replace('T', ' ')) +
          (p.ticket_id ? ' · ticket ' + esc(p.ticket_id) : '') + (a.result ? ' — ' + esc(a.result) : '') + '</small>' + (p.description ? '<span>' + esc(p.description) + '</span>' : '') +
          '<div class="fd-tools"><label class="fd-sr" for="fs-' + esc(a.id) + '">Numéro du ticket créé</label><input id="fs-' + esc(a.id) + '" maxlength="200" placeholder="Numéro du ticket ou remarque">' +
          '<button class="fd-btn" type="button" data-done="' + esc(a.id) + '">Marquer faite</button></div></li>';
      }).join('') : '<li>Aucune demande en attente.</li>';
    }).catch(function (e) { msg(e.message, true); });
  }
  $('fd-site').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-done]'); if (!b) return;
    var id = b.getAttribute('data-done'), note = (document.getElementById('fs-' + id) || {}).value || '';
    b.disabled = true;
    S.api('POST', '/api/field/quick-actions/' + encodeURIComponent(id) + '/done', { note: note })
      .then(function () { msg('Demande marquée faite.'); renderSite(); }, function (err) { b.disabled = false; msg(err.message, true); });
  });

  // ── Network state, stamp, counters ───────────────────────────────────
  function netState() {
    var on = navigator.onLine;
    $('fd-net').textContent = on ? 'En ligne' : 'Hors ligne';
    $('fd-net').className = 'fd-net ' + (on ? 'fd-on' : 'fd-off');
  }
  function stamp() {
    if (!boot) { $('fd-stamp').textContent = 'Aucune donnée sur ce téléphone : connectez-vous une première fois au réseau.'; return; }
    var age = (Date.now() - Date.parse(boot.generated_at)) / 3600000;
    $('fd-stamp').textContent = 'Listes et trackers à jour au ' + boot.generated_at.slice(0, 16).replace('T', ' ') + ' (UTC)' + (age > 24 ? ' — plus d’un jour : rechargez-les dès que possible.' : '.');
    $('fd-stamp').className = 'fd-stamp' + (age > 24 ? ' fd-late' : '');
  }
  function counts() {
    return Promise.all([all('outbox'), all('drafts')]).then(function (r) {
      var pending = r[0].filter(function (o) { return o.state !== 'done'; });
      $('fd-count').textContent = pending.length ? '(' + pending.length + ')' : '';
      $('fd-queue-n').textContent = pending.length ? pending.length + ' envoi(s) en attente' : 'rien en attente';
      $('fd-drafts-n').textContent = r[1].length + ' sur ce téléphone';
      $('fd-trackers-n').textContent = boot ? boot.trackers.length + ' tracker(s)' : '—';
      $('fd-site-tile').hidden = !(boot && boot.user.coordinator);
    });
  }

  // ── Bootstrap (what the phone keeps for offline work) ────────────────
  function loadBoot(force) {
    return getOne('kv', 'bootstrap').then(function (b) {
      boot = b ? b.value : null;
      if (!navigator.onLine || (boot && !force && Date.now() - Date.parse(boot.generated_at) < 3600000)) return;
      return S.api('GET', '/api/field/bootstrap').then(function (fresh) { boot = fresh; return put('kv', { id: 'bootstrap', value: fresh }); })
        .catch(function (e) { if (!boot) msg(e.message, true); });
    }).then(function () { stamp(); counts(); });
  }

  // ── Views ────────────────────────────────────────────────────────────
  var VIEWS = ['home', 'drafts', 'insp', 'trackers', 'queue', 'site', 'settings'];
  function route() {
    var h = (location.hash || '#home').slice(1), parts = h.split('/'), v = parts[0] === 'inspection' ? 'insp' : parts[0];
    if (VIEWS.indexOf(v) < 0) v = 'home';
    VIEWS.forEach(function (x) { $('v-' + x).hidden = x !== v; });
    msg('');
    if (v === 'drafts') renderDrafts();
    if (v === 'insp') openInspection(parts[1]);
    if (v === 'trackers') renderTrackers();
    if (v === 'queue') renderQueue();
    if (v === 'site') renderSite();
    if (v === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', route);

  // ── Inspections ──────────────────────────────────────────────────────
  var opt = function (v, t, sel) { return '<option value="' + esc(v) + '"' + (sel ? ' selected' : '') + '>' + esc(t) + '</option>'; };
  function siteLabel(s) { return (s.name_fr || s.name_en || s.code) + ' (' + s.code + ')'; }
  function mySites() {
    if (!boot) return [];
    return boot.inspection.sites.filter(function (s) { return boot.user.all_sites || boot.user.sites.indexOf(s.code) >= 0; });
  }
  $('fd-new-insp').addEventListener('click', function () {
    if (!boot) { msg('Connectez-vous une fois au réseau pour charger la liste de contrôle.', true); return; }
    var sites = mySites();
    var d = { id: 'FLD-' + uuid().slice(0, 20), created_at: new Date().toISOString(), synced: false, base_updated_at: null,
      state: { meta: { f_date: today(), f_type: 'Routine', f_site: sites[0] ? siteLabel(sites[0]) : '', f_inspector: boot.user.name, f_area: '', f_loc: '' }, items: {}, actions: [], status: 'draft' } };
    d.state.meta.f_id = d.id;
    put('drafts', d).then(function () { location.hash = '#inspection/' + d.id; });
  });
  function renderDrafts() {
    all('drafts').then(function (list) {
      list.sort(function (a, b) { return String(b.created_at).localeCompare(String(a.created_at)); });
      $('fd-drafts').innerHTML = list.length ? list.map(function (d) {
        var m = d.state.meta, n = Object.keys(d.state.items).length;
        var st = d.conflict ? '<span class="fd-state-err">conflit à régler</span>' : d.synced ? '<span class="fd-state-ok">envoyée</span>' : '<span class="fd-state-wait">sur ce téléphone</span>';
        return '<li><a href="#inspection/' + esc(d.id) + '"><b>' + esc(m.f_site || 'Sans site') + ' — ' + esc(m.f_date) + '</b></a><small>' + n + ' point(s) renseigné(s) · ' + (d.state.status === 'submitted' ? 'soumise' : 'brouillon') + ' · ' + st + '</small></li>';
      }).join('') : '<li>Aucune inspection sur ce téléphone.</li>';
    });
  }
  function openInspection(id) {
    getOne('drafts', id).then(function (d) {
      if (!d || !boot) { location.hash = '#drafts'; return; }
      current = d;
      var m = d.state.meta, L = boot.inspection;
      $('fd-insp-h').textContent = 'Inspection ' + (d.state.status === 'submitted' ? '(soumise)' : '');
      $('fi-site').innerHTML = mySites().map(function (s) { return opt(siteLabel(s), siteLabel(s), siteLabel(s) === m.f_site); }).join('');
      $('fi-date').value = m.f_date || today();
      $('fi-type').innerHTML = L.types.map(function (t) { return opt(t.code, t.label_fr || t.code, t.code === m.f_type); }).join('');
      $('fi-area').innerHTML = opt('', '—') + L.areas.map(function (a) { var n = a.name_fr || a.name_en; return opt(n, n, n === m.f_area); }).join('');
      $('fi-loc').value = m.f_loc || ''; $('fi-inspector').value = m.f_inspector || '';
      renderChecklist(); renderActions();
    });
  }
  function readMeta() {
    var m = current.state.meta;
    m.f_site = $('fi-site').value; m.f_date = $('fi-date').value; m.f_type = $('fi-type').value; m.f_area = $('fi-area').value;
    m.f_loc = $('fi-loc').value; m.f_inspector = $('fi-inspector').value; m.f_label = (m.f_site || '') + ' — ' + (m.f_date || '');
  }
  $('fd-insp-form').addEventListener('change', function () { readMeta(); saveLocal(); });
  function saveLocal() { current.synced = false; return put('drafts', current).then(counts); }

  function renderChecklist() {
    var L = boot.inspection, items = current.state.items;
    $('fd-cats').innerHTML = L.categories.map(function (c) {
      var done = c.items.filter(function (_, i) { return items[c.id + '__' + i] && items[c.id + '__' + i].status; }).length;
      return '<details class="fd-cat"><summary>' + esc(c.name_fr || c.name_en) + ' <small>' + done + ' / ' + c.items.length + '</small></summary>' +
        c.items.map(function (it, i) {
          var key = c.id + '__' + i, v = items[key] || {};
          return '<div class="fd-item" data-key="' + esc(key) + '"><div class="fd-item-t">' + esc(it.fr || it.l) + '</div>' +
            '<div class="fd-st" role="group" aria-label="État">' + L.statuses.map(function (s) {
              return '<button type="button" class="' + (STATUS_CLASS[s.code] || '') + '" data-st="' + esc(s.code) + '" aria-pressed="' + (v.status === s.code) + '">' + esc(s.label_fr || s.code) + '</button>';
            }).join('') + '</div>' +
            '<label class="fd-sr" for="n-' + esc(key) + '">Remarque</label><textarea class="fd-note" id="n-' + esc(key) + '" rows="2" placeholder="Remarque">' + esc(v.notes || '') + '</textarea>' +
            '<div class="fd-tools"><label class="fd-btn fd-photo">Photo<input type="file" accept="image/*" capture="environment" data-photo="' + esc(key) + '"></label>' +
            (window.SpeechRecognition || window.webkitSpeechRecognition ? '<button type="button" class="fd-btn" data-voice="' + esc(key) + '">Dicter</button>' : '') +
            ((STATUS_CLASS[v.status] === 'fd-bad' || v.status === 'minor') ? '<button type="button" class="fd-btn" data-ticket="' + esc(key) + '">Ouvrir un ticket</button>' : '') + '</div>' +
            '<div class="fd-thumbs" id="t-' + esc(key) + '"></div></div>';
        }).join('') + '</details>';
    }).join('');
    Object.keys(items).forEach(function (k) { renderThumbs(k); });
  }
  function renderThumbs(key) {
    var box = document.getElementById('t-' + key), photos = (current.state.items[key] || {}).photos || [];
    if (!box) return;
    if (!photos.length) { box.innerHTML = ''; return; }
    if (settings.lowbw) { box.innerHTML = '<span>' + photos.length + ' photo(s)</span>'; return; }
    Promise.all(photos.map(function (p) { return p.local ? getOne('photos', p.local) : Promise.resolve(null); })).then(function (rows) {
      box.innerHTML = photos.map(function (p, i) { return rows[i] && rows[i].blob ? '<img alt="Photo ' + (i + 1) + '" data-i="' + i + '">' : '<span>photo ' + (i + 1) + ' (envoyée)</span>'; }).join('');
      box.querySelectorAll('img').forEach(function (img) { var r = rows[Number(img.getAttribute('data-i'))]; img.src = URL.createObjectURL(r.blob); });
    });
  }
  $('fd-cats').addEventListener('click', function (e) {
    var st = e.target.closest && e.target.closest('[data-st]'), voice = e.target.closest && e.target.closest('[data-voice]'), tk = e.target.closest && e.target.closest('[data-ticket]');
    if (st) {
      var key = st.closest('.fd-item').getAttribute('data-key'), it = current.state.items[key] || (current.state.items[key] = {});
      it.status = it.status === st.getAttribute('data-st') ? null : st.getAttribute('data-st');
      if (!it.status && !it.notes && !(it.photos || []).length) delete current.state.items[key];
      saveLocal().then(function () { var open = st.closest('details'); renderChecklist(); var d2 = document.querySelector('[data-key="' + key + '"]'); if (d2) d2.closest('details').open = true; else if (open) open.open = true; });
    }
    if (voice) dictate(voice.getAttribute('data-voice'));
    if (tk) quickTicket(tk.getAttribute('data-ticket'));
  });
  $('fd-cats').addEventListener('change', function (e) {
    var el = e.target;
    if (el.classList.contains('fd-note')) {
      var key = el.closest('.fd-item').getAttribute('data-key'), it = current.state.items[key] || (current.state.items[key] = {});
      it.notes = el.value; saveLocal();
    }
    if (el.getAttribute('data-photo')) addPhoto(el.getAttribute('data-photo'), el.files && el.files[0], el);
  });

  // Photos: compressed on the phone until they fit the limit (JPEG, longest side 1600 px, 1024 in low bandwidth).
  function compress(file) {
    var maxKB = settings.lowbw ? (boot.limits.low_bandwidth_photo_kb || 150) : (boot.limits.photo_kb || 300), maxSide = settings.lowbw ? 1024 : 1600;
    return (window.createImageBitmap ? createImageBitmap(file) : new Promise(function (ok, ko) { var img = new Image(); img.onload = function () { ok(img); }; img.onerror = ko; img.src = URL.createObjectURL(file); }))
      .then(function (bmp) {
        var w = bmp.width, h = bmp.height, k = Math.min(1, maxSide / Math.max(w, h));
        function attempt(scale, q) {
          var c = document.createElement('canvas'); c.width = Math.round(w * scale); c.height = Math.round(h * scale);
          c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
          return new Promise(function (ok) { c.toBlob(ok, 'image/jpeg', q); }).then(function (b) {
            if (b.size <= maxKB * 1024) return b;
            if (q > 0.45) return attempt(scale, q - 0.1);
            if (scale > 0.2) return attempt(scale * 0.8, 0.7);
            throw new Error('photo impossible à réduire sous ' + maxKB + ' Ko');
          });
        }
        return attempt(k, 0.82);
      });
  }
  function addPhoto(key, file, input) {
    if (!file) return;
    msg('Réduction de la photo…');
    compress(file).then(function (blob) {
      var pid = 'P' + uuid(); var it = current.state.items[key] || (current.state.items[key] = {});
      it.photos = it.photos || [];
      it.photos.push({ local: pid, upload: pid, ts: new Date().toISOString(), sizeKB: Math.round(blob.size / 1024) });
      return put('photos', { id: pid, blob: blob, mime: 'image/jpeg', size: blob.size, uploaded: false }).then(saveLocal).then(function () {
        renderThumbs(key); msg('Photo ajoutée (' + Math.round(blob.size / 1024) + ' Ko).'); input.value = '';
      });
    }).catch(function (e) { msg(e.message, true); });
  }
  // Voice: dictation into the finding's note (French), when the phone offers it.
  function dictate(key) {
    var R = window.SpeechRecognition || window.webkitSpeechRecognition; if (!R) return;
    var r = new R(); r.lang = 'fr-FR'; r.interimResults = false; r.maxAlternatives = 1;
    msg('Parlez…');
    r.onresult = function (ev) {
      var t = ev.results[0][0].transcript, ta = document.getElementById('n-' + key);
      ta.value = (ta.value ? ta.value + ' ' : '') + t;
      var it = current.state.items[key] || (current.state.items[key] = {}); it.notes = ta.value; saveLocal(); msg('Dictée ajoutée.');
    };
    r.onerror = function () { msg('La dictée n’a pas fonctionné (elle demande souvent le réseau).', true); };
    r.start();
  }
  function quickTicket(key) {
    var cat = key.split('__')[0], ix = Number(key.split('__')[1]);
    var c = boot.inspection.categories.find(function (x) { return x.id === cat; }), item = c && c.items[ix];
    var site = (current.state.meta.f_site.match(/\(([A-Z]{2,4})\)/) || [])[1] || '';
    var it = current.state.items[key] || {};
    enqueue({ kind: 'quick', label: 'Ticket : ' + (item ? (item.fr || item.l) : key), payload: { id: 'Q' + uuid(), kind: 'sdp_ticket', site: site,
      subject: '[Inspection ' + site + '] ' + (item ? (item.fr || item.l) : key), description: (it.notes || '') + '\nInspection ' + current.id + ', point ' + key, inspection_id: current.id, finding_key: key } })
      .then(function () { msg('Demande de ticket mise dans la file d’envoi.'); });
  }

  // Corrective actions
  function renderActions() {
    var a = current.state.actions || [];
    $('fd-actions').innerHTML = a.length ? a.map(function (x, i) { return '<li><b>' + esc(x.desc) + '</b><small>' + esc(x.owner || 'sans responsable') + (x.due ? ' · ' + esc(x.due) : '') + ' · ' + esc(x.priority) + '</small><button class="fd-btn fd-danger" type="button" data-del-act="' + i + '">Retirer</button></li>'; }).join('') : '<li>Aucune action.</li>';
  }
  $('fd-action-form').addEventListener('submit', function (e) {
    e.preventDefault();
    current.state.actions = current.state.actions || [];
    current.state.actions.push({ desc: $('fa-desc').value, owner: $('fa-owner').value, due: $('fa-due').value || null, priority: $('fa-prio').value, status: 'Open' });
    $('fa-desc').value = ''; $('fa-owner').value = ''; $('fa-due').value = '';
    saveLocal().then(renderActions);
  });
  $('fd-actions').addEventListener('click', function (e) { var b = e.target.closest && e.target.closest('[data-del-act]'); if (b) { current.state.actions.splice(Number(b.getAttribute('data-del-act')), 1); saveLocal().then(renderActions); } });

  function queueInspection(status) {
    readMeta();
    if (!current.state.meta.f_site) { msg('Choisissez le site.', true); return; }
    current.state.status = status;
    saveLocal().then(function () {
      return all('outbox').then(function (ops) {   // one pending send per inspection: the latest state wins
        var mine = ops.filter(function (o) { return o.kind === 'inspection' && o.ref === current.id && o.state !== 'done'; });
        return Promise.all(mine.map(function (o) { return del('outbox', o.id); }));
      });
    }).then(function () {
      return enqueue({ kind: 'inspection', ref: current.id, label: 'Inspection ' + current.state.meta.f_label + (status === 'submitted' ? ' (soumise)' : '') });
    }).then(function () { msg(status === 'submitted' ? 'Inspection soumise : elle part dès que le réseau le permet.' : 'Enregistrée sur le téléphone ; elle part dès que le réseau le permet.'); });
  }
  $('fd-insp-save').addEventListener('click', function () { queueInspection(current.state.status === 'submitted' ? 'submitted' : 'draft'); });
  $('fd-insp-submit').addEventListener('click', function () { queueInspection('submitted'); });
  $('fd-insp-drop').addEventListener('click', function () {
    if (!current) return;
    var photos = [].concat.apply([], Object.values(current.state.items).map(function (i) { return (i.photos || []).filter(function (p) { return p.local; }).map(function (p) { return p.local; }); }));
    Promise.all(photos.map(function (p) { return del('photos', p); })).then(function () { return del('drafts', current.id); }).then(function () { location.hash = '#drafts'; counts(); });
  });

  // ── Trackers ─────────────────────────────────────────────────────────
  function renderTrackers() {
    if (!boot || !boot.trackers.length) { $('fd-trackers').innerHTML = '<p class="fd-help">Aucun tracker ouvert à votre saisie cette année.</p>'; return; }
    var mo = new Date().getUTCMonth() + 1;
    $('fd-trackers').innerHTML = boot.trackers.map(function (t, ti) {
      var def = t.definition, title = S.label(def.title);
      return '<details class="fd-cat fd-tr"><summary>' + esc(title) + '</summary><div class="fd-item">' +
        '<label>Unité <select data-tu="' + ti + '">' + def.units.map(function (u) { return opt(u.code, u.name || u.code); }).join('') + '</select></label>' +
        '<label>Mois <select data-tm="' + ti + '">' + [mo, mo - 1].filter(function (m) { return m >= 1; }).map(function (m) { return opt(m, 'Mois ' + m, m === mo); }).join('') + '</select></label>' +
        '<div data-tbody="' + ti + '"></div><button class="fd-btn fd-primary" type="button" data-tsave="' + ti + '">Mettre dans la file d’envoi</button></div></details>';
    }).join('');
    boot.trackers.forEach(function (_, ti) { renderTrackerRows(ti); });
  }
  function renderTrackerRows(ti) {
    var t = boot.trackers[ti], def = t.definition, unit = document.querySelector('[data-tu="' + ti + '"]').value, mo = Number(document.querySelector('[data-tm="' + ti + '"]').value);
    var locked = t.locks.indexOf(mo) >= 0, vals = (t.values[unit] || {});
    document.querySelector('[data-tbody="' + ti + '"]').innerHTML = locked ? '<p class="fd-help">Ce mois est clos : la saisie est fermée.</p>' : '<table><tbody>' +
      def.items.filter(function (it) { var tg = def.targets[unit] && def.targets[unit][it.code]; return tg && tg.active && !it.source && mo >= it.start && mo <= it.end; }).map(function (it) {
        var v = (vals[it.code] || [])[mo - 1];
        return '<tr><th scope="row">' + esc(S.label(it.name)) + '</th><td><label class="fd-sr" for="tv-' + ti + '-' + esc(it.code) + '">valeur</label><input id="tv-' + ti + '-' + esc(it.code) + '" inputmode="decimal" data-item="' + esc(it.code) + '" value="' + (v ? esc(v) : '') + '"></td></tr>';
      }).join('') + '</tbody></table>';
  }
  $('fd-trackers').addEventListener('change', function (e) { var a = e.target.getAttribute('data-tu') || e.target.getAttribute('data-tm'); if (a != null) renderTrackerRows(Number(a)); });
  $('fd-trackers').addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-tsave]'); if (!b) return;
    var ti = Number(b.getAttribute('data-tsave')), t = boot.trackers[ti], unit = document.querySelector('[data-tu="' + ti + '"]').value, mo = Number(document.querySelector('[data-tm="' + ti + '"]').value);
    var cells = [];
    document.querySelectorAll('[data-tbody="' + ti + '"] input').forEach(function (i) {
      if (i.value.trim() === '') return;
      var v = Number(i.value.replace(',', '.'));
      if (isFinite(v)) cells.push({ unit: unit, item: i.getAttribute('data-item'), month: mo, value: v });
    });
    if (!cells.length) { msg('Aucune valeur saisie.', true); return; }
    enqueue({ kind: 'tracker', label: S.label(t.definition.title) + ' — ' + unit + ', mois ' + mo, payload: { tracker: t.id, year: t.definition.year, cells: cells } })
      .then(function () { cells.forEach(function (c) { (t.values[unit] = t.values[unit] || {})[c.item] = (t.values[unit][c.item] || new Array(12).fill(0)); t.values[unit][c.item][mo - 1] = c.value; }); return put('kv', { id: 'bootstrap', value: boot }); })
      .then(function () { msg(cells.length + ' valeur(s) dans la file d’envoi.'); });
  });

  // ── Outbox and synchronisation ───────────────────────────────────────
  function enqueue(op) {
    op.id = op.id || 'O' + Date.now() + '-' + uuid().slice(0, 6);
    op.created_at = new Date().toISOString(); op.state = 'pending'; op.attempts = 0;
    return put('outbox', op).then(counts).then(function () { if (navigator.onLine && !settings.lowbw) sync(); });
  }
  function renderQueue() {
    all('outbox').then(function (ops) {
      ops.sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
      var LBL = { pending: ['fd-state-wait', 'en attente du réseau'], done: ['fd-state-ok', 'envoyé'], failed: ['fd-state-err', 'refusé'], conflict: ['fd-state-err', 'conflit'] };
      $('fd-queue').innerHTML = ops.length ? ops.map(function (o) {
        var l = LBL[o.state] || LBL.pending;
        return '<li><b>' + esc(o.label) + '</b><small>' + esc(o.created_at.slice(0, 16).replace('T', ' ')) + ' · <span class="' + l[0] + '">' + l[1] + '</span>' + (o.attempts ? ' · ' + o.attempts + ' essai(s)' : '') + (o.error ? ' — ' + esc(o.error) : '') + '</small>' +
          (o.state === 'conflict' ? '<div class="fd-tools"><button class="fd-btn" type="button" data-force="' + esc(o.id) + '">Garder ma version</button><button class="fd-btn fd-danger" type="button" data-drop="' + esc(o.id) + '">Abandonner ma version</button></div>' : '') +
          (o.state === 'failed' || o.state === 'done' ? '<button class="fd-btn" type="button" data-drop="' + esc(o.id) + '">Retirer de la liste</button>' : '') + '</li>';
      }).join('') : '<li>La file est vide.</li>';
    });
  }
  $('fd-queue').addEventListener('click', function (e) {
    var f = e.target.closest && e.target.closest('[data-force]'), d = e.target.closest && e.target.closest('[data-drop]');
    if (f) getOne('outbox', f.getAttribute('data-force')).then(function (o) { o.force = true; o.state = 'pending'; o.error = null; return put('outbox', o); }).then(function () { renderQueue(); sync(); });
    if (d) getOne('outbox', d.getAttribute('data-drop')).then(function (o) {
      var then = o.kind === 'inspection' && o.state === 'conflict' ? getOne('drafts', o.ref).then(function (dr) { if (dr) { dr.conflict = false; return put('drafts', dr); } }) : Promise.resolve();
      return then.then(function () { return del('outbox', o.id); });
    }).then(function () { renderQueue(); counts(); });
  });

  function upload(photo) {
    var chunkSize = (boot.limits.chunk_kb || 32) * 1024, n = Math.ceil(photo.size / chunkSize);
    var base = '/api/field/uploads/' + encodeURIComponent(photo.id);
    return S.api('POST', '/api/field/uploads', { id: photo.id, mime: photo.mime, size: photo.size, chunks: n })
      .then(function () { return S.api('GET', base); })
      .then(function (st) {
        if (st.status !== 'open') return;
        var missing = []; for (var i = 0; i < n; i++) if (st.received.indexOf(i) < 0) missing.push(i);
        return missing.reduce(function (p, i) {
          return p.then(function () { return blobB64(photo.blob.slice(i * chunkSize, (i + 1) * chunkSize)); }).then(function (b64) { return S.api('PUT', base + '/chunks/' + i, { data: b64 }); });
        }, Promise.resolve()).then(function () { return S.api('POST', base + '/complete', {}); });
      })
      .then(function () { photo.uploaded = true; return put('photos', photo); });
  }
  function blobB64(b) { return new Promise(function (ok, ko) { var r = new FileReader(); r.onload = function () { ok(String(r.result).split(',')[1] || ''); }; r.onerror = ko; r.readAsDataURL(b); }); }

  function sendInspection(op) {
    return getOne('drafts', op.ref).then(function (d) {
      if (!d) return { done: true };
      var photoIds = [].concat.apply([], Object.values(d.state.items).map(function (i) { return (i.photos || []).filter(function (p) { return p.local && p.upload; }).map(function (p) { return p.local; }); }));
      var bytes = 0;
      return photoIds.reduce(function (p, pid) { return p.then(function () { return getOne('photos', pid).then(function (ph) { if (ph && !ph.uploaded) { bytes += ph.size; return upload(ph); } }); }); }, Promise.resolve())
        .then(function () {
          var state = JSON.parse(JSON.stringify(d.state));
          Object.values(state.items).forEach(function (i) { (i.photos || []).forEach(function (p) { delete p.local; }); });
          return fetch('/api/field/inspections/' + encodeURIComponent(d.id), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'x-report-token': window.__authToken || '' },
            body: JSON.stringify({ state: state, base_updated_at: d.base_updated_at, force: !!op.force }) });
        })
        .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { r: r, j: j }; }); })
        .then(function (x) {
          if (x.r.status === 409 && x.j.server_updated_at !== undefined) { d.conflict = true; return put('drafts', d).then(function () { return { conflict: x.j.error }; }); }
          if (!x.r.ok) return { error: x.j.error || ('HTTP ' + x.r.status), retry: x.r.status >= 500 || x.r.status === 409 };
          // Stored photos come back as references, in the order sent: keep them, free the phone.
          var stored = x.j.stored_photos || {};
          var frees = [];
          Object.keys(d.state.items).forEach(function (k) {
            var it = d.state.items[k], refs = stored[k] || [];
            (it.photos || []).forEach(function (p, idx) { if (refs[idx]) { if (p.local) frees.push(p.local); it.photos[idx] = { __blob: refs[idx].__blob, mime: refs[idx].mime, sizeBytes: refs[idx].sizeBytes, caption: p.caption || '' }; } });
          });
          d.synced = true; d.conflict = false; d.base_updated_at = x.j.updated_at;
          return put('drafts', d).then(function () { return Promise.all(frees.map(function (f) { return del('photos', f); })); }).then(function () { return { done: true, bytes: bytes, photos: photoIds.length }; });
        });
    });
  }
  function sendOp(op) {
    if (op.kind === 'inspection') return sendInspection(op);
    var call = op.kind === 'tracker' ? S.api('POST', '/api/trackers/' + encodeURIComponent(op.payload.tracker) + '/entries', { year: op.payload.year, cells: op.payload.cells })
      : S.api('POST', '/api/field/quick-actions', op.payload);
    return call.then(function (j) { return { done: true, note: j.refused && j.refused.length ? j.refused.length + ' valeur(s) refusée(s)' : null }; })
      .catch(function (e) { return { error: e.message, retry: !e.status || e.status >= 500 }; });
  }
  function sync() {
    if (syncing || !navigator.onLine) return Promise.resolve();
    syncing = true; $('fd-sync').disabled = true;
    var report = [];
    return all('outbox').then(function (ops) {
      ops = ops.filter(function (o) { return o.state === 'pending'; }).sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); });
      return ops.reduce(function (p, op) {
        return p.then(function () {
          var t0 = Date.now();
          return sendOp(op).catch(function (e) { return { error: e.message, retry: true }; }).then(function (r) {
            op.attempts = (op.attempts || 0) + 1;
            if (r.done) { op.state = 'done'; op.error = r.note || null; op.sent_at = new Date().toISOString(); }
            else if (r.conflict) { op.state = 'conflict'; op.error = r.conflict; }
            else { op.state = r.retry ? 'pending' : 'failed'; op.error = r.error; }
            report.push({ kind: op.kind, ok: !!r.done, duration_ms: Date.now() - t0, bytes: r.bytes || 0, photos: r.photos || 0, queued_ms: Date.now() - Date.parse(op.created_at) });
            return put('outbox', op);
          });
        });
      }, Promise.resolve());
    }).then(function () {
      if (report.length) S.api('POST', '/api/field/sync-report', { ops: report, low_bandwidth: settings.lowbw, online_type: (navigator.connection && navigator.connection.effectiveType) || '' }).catch(function () {});
      var ok = report.filter(function (r) { return r.ok; }).length;
      if (report.length) msg(ok + ' envoi(s) réussi(s)' + (report.length > ok ? ', ' + (report.length - ok) + ' à reprendre' : '') + '.');
    }).finally(function () { syncing = false; $('fd-sync').disabled = false; counts(); if (!$('v-queue').hidden) renderQueue(); });
  }
  $('fd-sync').addEventListener('click', function () { if (!navigator.onLine) { msg('Pas de réseau : tout reste sur le téléphone.', true); return; } loadBoot(true).then(sync); });
  window.addEventListener('online', function () { netState(); if (!settings.lowbw) loadBoot().then(sync); });
  window.addEventListener('offline', netState);

  // ── Settings ─────────────────────────────────────────────────────────
  function renderSettings() {
    $('fd-lowbw').checked = !!settings.lowbw;
    if (navigator.storage && navigator.storage.estimate) navigator.storage.estimate().then(function (s) { $('fd-storage').textContent = 'Espace utilisé sur ce téléphone : ' + Math.round((s.usage || 0) / 1048576) + ' Mo.'; });
  }
  $('fd-lowbw').addEventListener('change', function () { settings.lowbw = this.checked; put('kv', { id: 'settings', value: settings }); msg(settings.lowbw ? 'Mode bas débit : photos de 150 Ko au plus, envoi seulement sur « Synchroniser ».' : 'Mode normal.'); });
  $('fd-refresh').addEventListener('click', function () { if (!navigator.onLine) { msg('Pas de réseau.', true); return; } loadBoot(true).then(function () { msg('Listes rechargées.'); }); });
  $('fd-wipe').addEventListener('click', function () {
    all('outbox').then(function (ops) {
      var pending = ops.filter(function (o) { return o.state === 'pending' || o.state === 'conflict'; }).length;
      if (pending && !$('fd-wipe').getAttribute('data-confirm')) { $('fd-wipe').setAttribute('data-confirm', '1'); msg(pending + ' envoi(s) ne sont pas partis. Appuyez de nouveau pour tout effacer quand même.', true); return; }
      return Promise.all(['drafts', 'outbox', 'photos', 'kv'].map(function (s) { return tx(s, 'readwrite', function (st) { st.clear(); }); })).then(function () { boot = null; $('fd-wipe').removeAttribute('data-confirm'); msg('Données du téléphone effacées.'); stamp(); counts(); });
    });
  });

  // ── Start ────────────────────────────────────────────────────────────
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js?v=' + encodeURIComponent(VERSION), { scope: '/' }).catch(function () {});
  netState();
  getOne('kv', 'settings').then(function (s) { if (s && s.value) settings = s.value; }).then(function () { return loadBoot(false); }).then(function () { route(); if (navigator.onLine && !settings.lowbw) sync(); })
    .catch(function (e) { msg('Stockage du téléphone indisponible : ' + e.message, true); });
})();
