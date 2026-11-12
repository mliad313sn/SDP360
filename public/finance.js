/* A1 + B8 — Finance certification, dated FX rates, display currency, Pronto actuals FILE import.
 * Talks only to /api/finance/*; the server is the enforcement point (roles, money rule, separation of duties,
 * switches). Every value is written with textContent — never innerHTML with data. */
(function () {
  'use strict';
  function hdr(extra) {
    const h = extra || {}; const at = window.__authToken; let tok = null;
    if (typeof at === 'function') { try { tok = at(); } catch (_) {} } else if (typeof at === 'string' && at) tok = at;
    if (!tok) { try { tok = localStorage.getItem('report_token'); } catch (_) {} }
    if (tok) h['x-report-token'] = tok;
    return h;
  }
  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: hdr(body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; e.errors = j.errors; throw e; }
    return j;
  }
  const $ = (id) => document.getElementById(id);
  const role = (r) => { try { return typeof window.__userHasRole === 'function' && window.__userHasRole(r); } catch (_) { return false; } };
  const msg = (t, ok) => { const m = $('fnMsg'); m.textContent = t || ''; m.className = 'fn-msg ' + (ok ? 'fn-ok' : 'fn-err'); };
  const td = (tr, v, cls) => { const c = document.createElement('td'); c.textContent = v == null || v === '' ? '—' : String(v); if (cls) c.className = cls; tr.appendChild(c); return c; };
  const btn = (label, fn) => { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); return b; };
  const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('fr-FR', { maximumFractionDigits: 2 }));
  const month = () => new Date().toISOString().slice(0, 7);
  const day = () => new Date().toISOString().slice(0, 10);

  // ── certification ──
  let lastStatus = null;
  async function status() {
    const q = new URLSearchParams({ scope: $('fnScope').value, scope_key: $('fnKey').value.trim(), period: $('fnPeriod').value.trim() });
    try {
      const s = await api('GET', '/api/finance/status?' + q);
      lastStatus = s;
      $('fnBadge').textContent = s.certified ? 'Certifié' : 'Non certifié';
      $('fnBadgeDetail').textContent = s.badge.label + (s.found ? '' : ' (introuvable)');
      $('fnCertify').hidden = !s.can_certify || !s.found;
    } catch (e) { msg(e.message); }
  }
  async function certify() {
    try {
      await api('POST', '/api/finance/certifications', { scope: $('fnScope').value, scope_key: $('fnKey').value.trim(), period: $('fnPeriod').value.trim(),
        evidence: $('fnEvidence').value, source: $('fnSource').value, evidence_link: $('fnLink').value.trim() || undefined });
      msg('Chiffre certifié.', true); await status(); await register();
    } catch (e) { msg(e.message); }
  }
  async function register() {
    const j = await api('GET', '/api/finance/certifications');
    const sel = $('fnScope');
    if (!sel.options.length) for (const s of j.scopes) { const o = document.createElement('option'); o.value = s; o.textContent = s; sel.appendChild(o); }
    const tb = $('fnReg'); tb.textContent = '';
    for (const c of j.certifications) {
      const tr = document.createElement('tr');
      td(tr, c.id); td(tr, c.scope); td(tr, c.scope_key); td(tr, c.period); td(tr, c.status);
      td(tr, c.current_state === 'verified' ? 'Certifié' : c.current_state === 'stale' ? 'Non certifié — chiffres modifiés' : c.status === 'verified' ? c.current_state : '—');
      td(tr, c.certified_by_name); td(tr, String(c.certified_at || '').slice(0, 16).replace('T', ' ')); td(tr, c.source);
      const a = td(tr, '');
      a.textContent = '';
      if (c.status === 'verified' && j.can_certify) a.appendChild(btn('Révoquer', async () => {
        const reason = window.prompt('Motif de la révocation ?'); if (!reason) return;
        try { await api('POST', `/api/finance/certifications/${c.id}/revoke`, { reason }); msg('Certification révoquée.', true); await register(); } catch (e) { msg(e.message); }
      }));
      if (c.status === 'revoked') a.textContent = 'révoquée : ' + (c.revoke_reason || '');
      tb.appendChild(tr);
    }
  }

  // ── FX ──
  async function rates() {
    const j = await api('GET', '/api/finance/fx-rates');
    $('fnRateForm').hidden = !j.can_edit;
    const tb = $('fnRates'); tb.textContent = '';
    for (const r of j.rates) {
      const tr = document.createElement('tr');
      td(tr, r.id); td(tr, r.currency); td(tr, r.effective_from); td(tr, r.rate, 'fn-num'); td(tr, r.source); td(tr, r.entered_by_name);
      td(tr, r.retired_at ? String(r.retired_at).slice(0, 10) + ' — ' + (r.retire_reason || '') : '');
      const a = td(tr, ''); a.textContent = '';
      if (j.can_edit && !r.retired_at) a.appendChild(btn('Retirer', async () => {
        const reason = window.prompt('Motif du retrait ?'); if (!reason) return;
        try { await api('POST', `/api/finance/fx-rates/${r.id}/retire`, { reason }); await rates(); } catch (e) { msg(e.message); }
      }));
      tb.appendChild(tr);
    }
  }
  async function addRate() {
    try { await api('POST', '/api/finance/fx-rates', { currency: $('fnRateCur').value, effective_from: $('fnRateFrom').value.trim(), rate: $('fnRateVal').value.trim().replace(',', '.'), source: $('fnRateSrc').value }); msg('Taux ajouté.', true); await rates(); } catch (e) { msg(e.message); }
  }
  async function convert() {
    const q = new URLSearchParams({ amount: $('fnCvAmt').value.trim().replace(',', '.'), from: $('fnCvFrom').value, to: $('fnCvTo').value, date: $('fnCvDate').value.trim() || day() });
    try {
      const c = (await api('GET', '/api/finance/convert?' + q)).conversion;
      $('fnCvOut').textContent = c.value == null ? 'Inconnu — aucun taux pour : ' + c.missing.join(', ') : fmt(c.value) + ' ' + c.to + ' · ' + c.basis;
    } catch (e) { msg(e.message); }
  }
  async function prefs(save) {
    try {
      const j = save ? await api('PUT', '/api/finance/prefs', { display_currency: $('fnPref').value || null }) : await api('GET', '/api/finance/prefs');
      if (!save) $('fnPref').value = j.display_currency || '';
      $('fnPrefOut').textContent = 'Devise affichée : ' + j.effective + (j.site_currency ? ' (devise du site : ' + j.site_currency + ')' : '') + ' — présentation seulement, aucun montant n’est converti en base.';
    } catch (e) { msg(e.message); }
  }

  // ── actuals import ──
  const FIELDS = ['project_key', 'period', 'currency', 'amount'];
  const LABEL = { project_key: 'Code projet', period: 'Période', currency: 'Devise', amount: 'Montant' };
  let file = null, headers = [];
  function readFile() {
    return new Promise((ok, ko) => {
      const f = $('fnFile').files[0]; if (!f) return ko(new Error('Choisissez un fichier.'));
      const r = new FileReader(); r.onload = () => { const s = String(r.result); ok({ filename: f.name, content_base64: s.slice(s.indexOf(',') + 1) }); }; r.onerror = () => ko(new Error('Lecture du fichier impossible.')); r.readAsDataURL(f);
    });
  }
  function drawMapping(selected) {
    const box = $('fnMap'); box.textContent = '';
    for (const f of FIELDS) {
      const l = document.createElement('label'); l.textContent = LABEL[f] + ' ';
      const s = document.createElement('select'); s.id = 'fnMap_' + f;
      const o0 = document.createElement('option'); o0.value = ''; o0.textContent = '(colonne)'; s.appendChild(o0);
      for (const h of headers) { const o = document.createElement('option'); o.value = h; o.textContent = h; s.appendChild(o); }
      if (selected && selected[f]) s.value = selected[f];
      l.appendChild(s); box.appendChild(l);
    }
  }
  const mapping = () => ({ columns: Object.fromEntries(FIELDS.map((f) => [f, ($('fnMap_' + f) || {}).value || ''])), date_format: $('fnDateFmt').value });
  async function templates() {
    const j = await api('GET', '/api/finance/actuals/templates');
    const sel = $('fnTpl'); while (sel.options.length > 1) sel.remove(1);
    for (const t of j.templates) { const o = document.createElement('option'); o.value = t.name; o.textContent = t.name; o.dataset.map = JSON.stringify(t.mapping); sel.appendChild(o); }
  }
  function drawDry(j) {
    const out = $('fnDryOut'); out.textContent = '';
    const p = document.createElement('p'); p.className = 'fn-muted';
    const rc = j.reconciliation;
    p.textContent = `${j.file.rows_total} ligne(s) · ${j.rows_ok} valide(s) · ${j.errors.length} erreur(s)` + (rc ? ` · à écrire : ${rc.summary.to_write} (nouveaux ${rc.summary.new}, modifiés ${rc.summary.changed}, identiques ${rc.summary.unchanged})` : '') + (j.already_imported ? ` · ce fichier a déjà été importé (lot #${j.already_imported.batch_id})` : '');
    out.appendChild(p);
    if (j.errors.length) {
      const t = document.createElement('table'); t.setAttribute('aria-label', 'Erreurs par ligne');
      for (const e of j.errors.slice(0, 200)) { const tr = document.createElement('tr'); td(tr, 'ligne ' + e.row); td(tr, e.field); td(tr, e.error); t.appendChild(tr); }
      out.appendChild(t);
    }
    if (rc) {
      const t = document.createElement('table'); t.setAttribute('aria-label', 'Rapprochement');
      const h = document.createElement('tr'); for (const x of ['Projet', 'Mois', 'Devise', 'Lignes', 'Budget', 'Réel existant', 'Importé', 'Écart', 'Statut']) { const th = document.createElement('th'); th.scope = 'col'; th.textContent = x; h.appendChild(th); } t.appendChild(h);
      for (const l of rc.lines) { const tr = document.createElement('tr'); td(tr, l.project_key); td(tr, l.period); td(tr, l.currency); td(tr, l.lines, 'fn-num'); td(tr, fmt(l.baseline), 'fn-num'); td(tr, fmt(l.existing_actual), 'fn-num'); td(tr, fmt(l.imported), 'fn-num'); td(tr, fmt(l.delta), 'fn-num'); td(tr, l.status); t.appendChild(tr); }
      out.appendChild(t);
      const tot = document.createElement('p'); tot.className = 'fn-muted';
      tot.textContent = 'Totaux par devise (jamais additionnés entre devises) : ' + rc.totals.map((x) => `${x.currency} importé ${fmt(x.imported)}`).join(' · ');
      out.appendChild(tot);
    }
    $('fnCommitRow').hidden = !rc;
  }
  async function dry() {
    try {
      file = await readFile();
      const tplName = $('fnTpl').value;
      const body = { ...file, ...(headers.length ? { mapping: mapping() } : tplName ? { template: tplName } : {}) };
      const j = await api('POST', '/api/finance/actuals/dry-run', body);
      headers = j.file.headers;
      if (j.needs_mapping) { drawMapping(null); msg('Associez les colonnes puis relancez la simulation.', true); return; }
      if (!$('fnMap_amount')) drawMapping(j.mapping && j.mapping.columns);
      drawDry(j); msg('Simulation terminée — rien n’a été écrit.', true);
    } catch (e) { msg(e.message); }
  }
  async function commit() {
    try {
      const j = await api('POST', '/api/finance/actuals/commit', { ...file, mapping: mapping(), reason: $('fnReason').value, skip_errors: $('fnSkip').checked });
      msg(`Import validé (lot #${j.batch.id}, ${j.batch.rows_written} période(s) écrite(s)) — non certifié.`, true); $('fnCommitRow').hidden = true; await batches();
    } catch (e) { msg(e.message); }
  }
  async function batches() {
    const j = await api('GET', '/api/finance/actuals/batches');
    const tb = $('fnBatches'); tb.textContent = '';
    for (const b of j.batches) {
      const tr = document.createElement('tr'); td(tr, b.id); td(tr, b.filename); td(tr, b.rows_total, 'fn-num'); td(tr, b.rows_written, 'fn-num'); td(tr, b.committed_by_name); td(tr, String(b.committed_at).slice(0, 16).replace('T', ' '));
      const c = td(tr, ''); c.textContent = ''; const a = document.createElement('a'); a.href = `/api/finance/actuals/batches/${b.id}/export.xlsx`; a.textContent = 'Excel'; c.appendChild(a);
      tb.appendChild(tr);
    }
  }

  async function boot() {
    $('fnPeriod').value = month(); $('fnCvDate').value = day();
    let any = false;
    try { await register(); $('fnCertCard').hidden = false; any = true; } catch (e) { if (e.status !== 404 && e.status !== 403) msg(e.message); }
    try { await rates(); await prefs(false); $('fnFxCard').hidden = false; any = true; } catch (e) { if (e.status !== 404 && e.status !== 403) msg(e.message); }
    if (role('admin')) { try { await templates(); await batches(); $('fnImpCard').hidden = false; any = true; } catch (e) { if (e.status !== 404) msg(e.message); } }
    if (!any) msg('Ces fonctions ne sont pas activées (finance_certification_enabled / actuals_import_enabled) ou votre rôle ne les permet pas.');
    $('fnStatusBtn').addEventListener('click', status); $('fnCertifyBtn').addEventListener('click', certify);
    $('fnRateAdd').addEventListener('click', addRate); $('fnCvBtn').addEventListener('click', convert); $('fnPrefSave').addEventListener('click', () => prefs(true));
    $('fnDry').addEventListener('click', dry); $('fnCommit').addEventListener('click', commit);
    $('fnFile').addEventListener('change', () => { headers = []; $('fnMap').textContent = ''; $('fnDryOut').textContent = ''; $('fnCommitRow').hidden = true; });
    $('fnTpl').addEventListener('change', () => { const o = $('fnTpl').selectedOptions[0]; if (o && o.dataset.map) { const m = JSON.parse(o.dataset.map); $('fnDateFmt').value = m.date_format || 'ISO'; if (headers.length) drawMapping(m.columns); } });
    $('fnTplSave').addEventListener('click', async () => { try { await api('PUT', '/api/finance/actuals/templates', { name: $('fnTplName').value, mapping: mapping() }); msg('Modèle enregistré.', true); await templates(); } catch (e) { msg(e.message); } });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
