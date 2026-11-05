/* C-20 — duty coverage page: site × day/shift grid (read-only) + roster editor / CSV import for the admin tier of
 * the site. Talks only to /api/duty/*; the server is the enforcement point (site scope, validation, idempotency). */
(function () {
  'use strict';
  function hdr(extra) {
    const h = extra || {}; const at = window.__authToken; let tok = null;
    if (typeof at === 'function') { try { tok = at(); } catch (_) {} } else if (typeof at === 'string' && at) tok = at;
    if (!tok) { try { tok = localStorage.getItem('report_token'); } catch (_) {} }
    if (tok) h['x-report-token'] = tok;
    return h;
  }
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const $ = (id) => document.getElementById(id);
  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: hdr(body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j;
  }
  let lang = 'en';
  try { lang = localStorage.getItem('sdp_lang') || 'en'; } catch (_) {}
  const L = {
    en: { covered: 'covered', gap: 'gap', unknown: 'unknown', not_required: 'not required', family: 'Duty family', policy: 'Policy', day: 'Day',
      shift: 'Shift', user: 'User', from: 'Start', to: 'End', source: 'Source', none: 'Nothing here.', remove: 'Remove', added: 'Shift added.', done: 'Done.',
      line: 'Line', error: 'Error', ok: 'rows ready', imported: 'inserted', already: 'already on the roster', site_default: 'default', site: 'site', allSites: 'All my sites',
      reasons: { inactive_holder: 'holder inactive / not on this site', partial: 'partly covered', no_one: 'nobody rostered' }, entered: 'roster entered' },
    fr: { covered: 'couvert', gap: 'trou', unknown: 'inconnu', not_required: 'non requis', family: 'Famille d\'astreinte', policy: 'Règle', day: 'Jour',
      shift: 'Poste', user: 'Utilisateur', from: 'Début', to: 'Fin', source: 'Source', none: 'Rien ici.', remove: 'Retirer', added: 'Poste ajouté.', done: 'Fait.',
      line: 'Ligne', error: 'Erreur', ok: 'lignes prêtes', imported: 'ajoutées', already: 'déjà au planning', site_default: 'par défaut', site: 'site', allSites: 'Tous mes sites',
      reasons: { inactive_holder: 'titulaire inactif / hors du site', partial: 'couvert en partie', no_one: 'personne au planning' }, entered: 'planning saisi' },
  };
  const t = () => L[lang === 'fr' ? 'fr' : 'en'];
  const msg = (x, ok) => { $('cvMsg').className = 'cv-msg ' + (ok ? 'cv-ok' : 'cv-err'); $('cvMsg').textContent = !ok && lang === 'fr' && window.ErrorText ? window.ErrorText.fr(x) : x; };
  let data = null, sitesLoaded = false;

  function grid(d) {
    if (!d.rows.length) return '<p class="cv-muted">' + esc(t().none) + '</p>';
    return d.rows.map((r) => {
      const days = [...new Set(r.slots.map((s) => s.day))];
      const cells = days.map((day) => '<td>' + r.slots.filter((s) => s.day === day).map((s) =>
        '<span class="cv-s cv-' + esc(s.status) + '" title="' + esc(s.label + ' · ' + t()[s.status] + (s.reason ? ' · ' + (t().reasons[s.reason] || s.reason) : '') + (s.people.length ? ' · #' + s.people.join(', #') : '')) + '">' +
        esc(s.label) + ' ' + esc(t()[s.status]) + '</span>').join('<br>') + '</td>').join('');
      return '<h3>' + esc(r.site) + ' · ' + esc(r.family) + '</h3><p class="cv-muted">' + esc(t().policy) + ': ' + esc(r.policy.mode) + ', ' + esc(r.policy.min_people) +
        ' (' + esc(r.policy.source === 'site' ? t().site : t().site_default) + ') · ' + esc(t().entered) + ': ' + esc(r.data_from ? r.data_from.slice(0, 16) + ' → ' + r.data_to.slice(0, 16) : '—') + '</p>' +
        '<table><thead><tr>' + days.map((x) => '<th>' + esc(x) + '</th>').join('') + '</tr></thead><tbody><tr>' + cells + '</tr></tbody></table>';
    }).join('');
  }

  async function load() {
    const site = $('cvSite').value; const from = $('cvFrom').value; const days = $('cvDays').value;
    data = await api('GET', '/api/duty/coverage?' + new URLSearchParams({ ...(site ? { site } : {}), ...(from ? { from } : {}), days }));
    if (!sitesLoaded) {
      const seen = [...new Map(data.rows.map((r) => [r.site_id, r.site])).entries()];
      $('cvSite').innerHTML = '<option value="">' + esc(t().allSites) + '</option>' + seen.map(([id, n]) => '<option value="' + id + '">' + esc(n) + '</option>').join('');
      const fams = data.families.map((f) => '<option value="' + esc(f.key) + '">' + esc(lang === 'fr' ? f.title_fr : f.title_en) + '</option>').join('');
      $('cvFam').innerHTML = fams; $('cvPFam').innerHTML = fams; sitesLoaded = true;
    }
    const s = data.summary;
    $('cvSummary').textContent = [['covered', s.covered], ['gap', s.gap], ['unknown', s.unknown], ['not_required', s.not_required]].map(([k, n]) => t()[k] + ': ' + n).join(' · ');
    $('cvGrid').innerHTML = grid(data);
    const editSite = Number($('cvSite').value);
    const canEdit = editSite && data.can_edit_sites.includes(editSite);
    $('cvEditor').hidden = !canEdit;
    if (canEdit) await loadShifts(editSite);
  }
  async function loadShifts(site) {
    const r = await api('GET', '/api/duty/shifts?' + new URLSearchParams({ site, from: $('cvFrom').value || new Date().toISOString().slice(0, 10) }));
    $('cvShifts').innerHTML = r.shifts.length ? '<table><thead><tr><th>' + [t().family, t().user, t().from, t().to, t().source, ''].map(esc).join('</th><th>') + '</th></tr></thead><tbody>' +
      r.shifts.map((x) => '<tr><td>' + esc(x.family) + '</td><td>#' + esc(x.user_id) + '</td><td>' + esc(x.starts_at.slice(0, 16)) + '</td><td>' + esc(x.ends_at.slice(0, 16)) + '</td><td>' + esc(x.source) +
        '</td><td><button type="button" data-rm="' + x.id + '">' + esc(t().remove) + '</button></td></tr>').join('') + '</tbody></table>' : '<p class="cv-muted">' + esc(t().none) + '</p>';
  }
  async function importCsv(apply) {
    const r = await api('POST', '/api/duty/import' + (apply ? '?apply=1' : ''), { csv: $('cvCsv').value });
    if (apply) { msg(r.inserted + ' ' + t().imported + ', ' + r.already + ' ' + t().already, true); return load(); }
    $('cvImport').innerHTML = '<p>' + r.rows.length + ' ' + esc(t().ok) + '</p>' + (r.errors.length ? '<table><thead><tr><th>' + esc(t().line) + '</th><th>' + esc(t().error) + '</th></tr></thead><tbody>' +
      r.errors.map((e) => '<tr><td>' + esc(e.line) + '</td><td class="cv-err">' + esc(e.error) + '</td></tr>').join('') + '</tbody></table>' : '');
  }

  const run = (p) => p.catch((e) => msg(e.message, false));
  function applyLang() { document.body.classList.toggle('lang-fr', lang === 'fr'); document.documentElement.lang = lang; $('cvLang').value = lang === 'fr' ? 'fr' : 'en'; }
  $('cvLang').addEventListener('change', () => { lang = $('cvLang').value; try { localStorage.setItem('sdp_lang', lang); } catch (_) {} applyLang(); if (data) $('cvGrid').innerHTML = grid(data); });
  $('cvLoad').addEventListener('click', () => run(load()));
  $('cvShiftForm').addEventListener('submit', (e) => { e.preventDefault(); run(api('POST', '/api/duty/shifts', { site_id: Number($('cvSite').value), family: $('cvFam').value, user_id: Number($('cvUser').value), starts_at: $('cvStart').value, ends_at: $('cvEnd').value }).then(() => { msg(t().added, true); return load(); })); });
  $('cvShifts').addEventListener('click', (e) => { const id = e.target.closest('[data-rm]'); if (id) run(api('DELETE', '/api/duty/shifts/' + id.dataset.rm).then(() => { msg(t().done, true); return load(); })); });
  $('cvFile').addEventListener('change', () => { const f = $('cvFile').files[0]; if (f) f.text().then((x) => { $('cvCsv').value = x; }); });
  $('cvPreview').addEventListener('click', () => run(importCsv(false)));
  $('cvApply').addEventListener('click', () => run(importCsv(true)));
  $('cvPolicyForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const [bs, be] = String($('cvPBiz').value).split('-').map((x) => x.trim());
    run(api('PUT', '/api/duty/policy', { site_id: Number($('cvSite').value), family: $('cvPFam').value, mode: $('cvPMode').value, min_people: Number($('cvPMin').value), shift_hours: Number($('cvPHours').value), business_start: bs, business_end: be })
      .then(() => { msg(t().done, true); return load(); }));
  });
  $('cvFrom').value = new Date().toISOString().slice(0, 10);
  $('cvSite').innerHTML = '<option value="">' + esc(t().allSites) + '</option>';
  applyLang(); run(load());
})();
