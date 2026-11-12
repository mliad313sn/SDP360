/* R2-WB-06 (REBUILD-SPEC R5) — "Publier dans le portefeuille" on the Roadmap Manager page (French-authored page).
   UMD: the HTML builders are PURE (required by tests); mount() does the fetches. Shown only while report_config
   roadmap_publication_enabled = '1' (GET /api/governance/ppm/features → roadmap_publication); '0' = nothing rendered.
   Nothing here is automatic: every write is a button pressed by the super_admin, behind a confirmation with a note.
     steps(state)                 — the 4 steps and whether each is done / available
     planHtml(plan, dups, esc)    — what the dry run would publish + the duplicates it would refuse
     stateHtml(st, esc)           — current state: migrated? parity verdict, read-only? last publication
   Flow: Simulation (dry run) → Publier (apply; refused on duplicates unless "les écarter" is ticked) → parité affichée
   → Archiver (Roadmap Manager en lecture seule, geste séparé et enregistré). Annulation = suppression réversible. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RoadmapPublish = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var VERDICT = { not_migrated: 'non publiée', in_parity: 'en parité', drift: 'écarts constatés', no_roadmap: 'aucune roadmap' };
  function steps(st) {
    var s = st || {};
    return [
      { key: 'dry_run', label: '1. Simuler', done: !!s.dryRun, available: !s.migrated },
      { key: 'apply', label: '2. Publier', done: !!s.migrated, available: !!s.dryRun && !s.migrated },
      { key: 'parity', label: '3. Vérifier la parité', done: s.migrated && s.parity === 'in_parity', available: !!s.migrated },
      { key: 'archive', label: '4. Archiver (lecture seule)', done: !!s.readOnly, available: !!s.migrated && !s.readOnly }
    ];
  }
  function planHtml(plan, dups, esc) {
    var p = plan || {}; var objs = p.objectives || [];
    var nDel = objs.reduce(function (a, o) { return a + ((o.deliverables || []).length); }, 0);
    var h = '<p><b>' + esc(String(objs.length)) + '</b> objectif(s) et <b>' + esc(String(nDel)) + '</b> livrable(s) seraient publiés sous le programme <code>' + esc((p.programme && p.programme.key) || '') + '</code>. Rien n’a été écrit.</p>';
    h += '<ul>' + objs.map(function (o) { return '<li>' + esc(o.name) + ' <span class="muted">(' + esc(String((o.deliverables || []).length)) + ' livrable(s))</span></li>'; }).join('') + '</ul>';
    if (p.exists) h += '<p role="alert"><b>Déjà publiée.</b> Annulez la publication avant de recommencer.</p>';
    if (dups && dups.count) {
      h += '<div role="alert"><p><b>' + esc(String(dups.count)) + ' doublon(s)</b> — la publication sera refusée tant qu’ils ne sont pas écartés :</p><ul>' +
        (dups.objectives || []).map(function (d) { return '<li>Objectif <code>' + esc(d.key) + '</code> — ' + (d.reason === 'exists' ? 'existe déjà dans le portefeuille' : 'répété dans la roadmap') + '</li>'; }).join('') +
        (dups.deliverables || []).map(function (d) { return '<li>Livrable « ' + esc(d.name) + ' » — déjà présent plus haut</li>'; }).join('') + '</ul>' +
        '<label><input type="checkbox" id="rp-skip"> Écarter ces doublons de la publication</label></div>';
    } else if (dups) h += '<p>Aucun doublon.</p>';
    return h;
  }
  function stateHtml(st, esc) {
    var s = st || {};
    return '<p>Publication : <b>' + (s.migrated ? 'faite' : 'non faite') + '</b> · parité : <b>' + esc(VERDICT[s.parity] || s.parity || '—') + '</b> · Roadmap Manager : <b>' + (s.read_only ? 'lecture seule' : 'modifiable') + '</b>' +
      (s.published ? ' · archivée le ' + esc(String(s.published.at || '').slice(0, 10)) + ' par ' + esc(s.published.actor || '—') : '') + '</p>';
  }
  function mount(host, deps) {
    if (!host || typeof fetch !== 'function') return;
    var H = deps.headers, esc = deps.esc, ask = deps.ask, toast = deps.toast || function () {};
    var S = { dryRun: false, migrated: false, readOnly: false, parity: null, plan: null, dups: null };
    var j = function (r) { return r.json().catch(function () { return {}; }).then(function (b) { if (!r.ok) throw new Error(b.error || ('HTTP ' + r.status)); return b; }); };
    var post = function (u, body) { return fetch(u, { method: 'POST', headers: H(true), body: JSON.stringify(body || {}) }).then(j); };
    function render() {
      var st = steps(S);
      host.innerHTML = '<h3>Publier dans le portefeuille</h3>' + stateHtml({ migrated: S.migrated, parity: S.parity, read_only: S.readOnly, published: S.published }, esc) +
        '<ol class="rp-steps">' + st.map(function (x) { return '<li>' + esc(x.label) + (x.done ? ' ✓' : '') + '</li>'; }).join('') + '</ol>' +
        '<div class="rp-actions">' +
        '<button type="button" class="rm-btn" data-rp="dry"' + (st[0].available ? '' : ' disabled') + '>Simuler</button> ' +
        '<button type="button" class="rm-btn primary" data-rp="apply"' + (st[1].available ? '' : ' disabled') + '>Publier…</button> ' +
        '<button type="button" class="rm-btn" data-rp="archive"' + (st[3].available ? '' : ' disabled') + '>Archiver (lecture seule)…</button> ' +
        '<button type="button" class="rm-btn" data-rp="rbdry"' + (S.migrated ? '' : ' disabled') + '>Annuler la publication…</button></div>' +
        '<div id="rp-out" aria-live="polite">' + (S.plan ? planHtml(S.plan, S.dups, esc) : '') + '</div>';
    }
    function refresh() { return fetch('/api/governance/roadmap-publication', { headers: H(false) }).then(j).then(function (b) { S.migrated = b.migrated; S.readOnly = b.read_only; S.parity = b.parity; S.published = b.published; render(); }); }
    function fail(e) { toast('⚠ ' + (e && e.message || e)); }
    host.addEventListener('click', function (ev) {
      var b = ev.target.closest && ev.target.closest('[data-rp]'); if (!b || b.disabled) return;
      var a = b.getAttribute('data-rp');
      if (a === 'dry') post('/api/governance/roadmap-migration', {}).then(function (r) { S.dryRun = true; S.plan = r.plan; S.dups = r.duplicates || null; render(); }).catch(fail);
      if (a === 'apply') {
        var skip = !!(host.querySelector('#rp-skip') || {}).checked;
        ask({ title: 'Publier la roadmap dans le portefeuille ?', label: 'Confirmez en tapant PUBLIER', min: 7, lang: 'fr' }).then(function (v) {
          if (v == null) return; if (String(v).trim().toUpperCase() !== 'PUBLIER') return toast('Publication non confirmée');
          return post('/api/governance/roadmap-migration?apply=1' + (skip ? '&skip_duplicates=1' : ''), {}).then(function () { S.plan = null; toast('Publiée — vérifiez la parité avant d’archiver'); return refresh(); });
        }).catch(fail);
      }
      if (a === 'archive') {
        ask({ title: 'Passer Roadmap Manager en lecture seule ?', label: 'Parité actuelle : ' + (VERDICT[S.parity] || S.parity) + '. Confirmez en tapant ARCHIVER', min: 8, lang: 'fr' }).then(function (v) {
          if (v == null) return; if (String(v).trim().toUpperCase() !== 'ARCHIVER') return toast('Archivage non confirmé');
          return post('/api/governance/roadmap-migration/archive', { confirm: true }).then(function () { toast('Roadmap Manager en lecture seule'); return refresh(); });
        }).catch(fail);
      }
      if (a === 'rbdry') {
        post('/api/governance/roadmap-migration/rollback', {}).then(function (r) {
          var p = r.plan; return ask({ title: 'Annuler la publication ?', label: p.objectives + ' objectif(s), ' + p.projects + ' projet(s) et ' + p.deliverables + ' livrable(s) seront supprimés de façon réversible (corbeille). Motif :', min: 10, lang: 'fr', multiline: true });
        }).then(function (reason) {
          if (reason == null) return;
          return post('/api/governance/roadmap-migration/rollback?apply=1', { reason: reason }).then(function () { S.dryRun = false; toast('Publication annulée (réversible)'); return refresh(); });
        }).catch(fail);
      }
    });
    fetch('/api/governance/ppm/features', { headers: H(false) }).then(function (r) { return r.ok ? r.json() : null; }).then(function (f) {
      if (!f || !f.roadmap_publication) return; host.hidden = false; return refresh();
    }).catch(function () {});
  }
  return { VERDICT: VERDICT, steps: steps, planHtml: planHtml, stateHtml: stateHtml, mount: mount };
}));
