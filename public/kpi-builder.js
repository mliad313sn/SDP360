/* C-31 — KPI policy builder page. Talks only to /api/kpi-policies/*; the server is the enforcement point (roles,
 * author ≠ adopter, immutable adopted versions, validation). The form builds the definition from blocks — the JSON
 * is only shown (Advanced), never required. */
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
    const j = await r.json().catch(() => ({})); if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.errors = j.errors; throw e; } return j;
  }
  let lang = 'en';
  try { lang = localStorage.getItem('sdp_lang') || 'en'; } catch (_) {}
  const L = {
    en: { enforcedOn: 'Screens follow the adopted policy (kpi_policy_enforced = 1).', enforcedOff: 'Screens compute as today (kpi_policy_enforced = 0): this page stores and compares only.',
      version: 'Version', status: 'Status', title: 'Title', from: 'In force from', to: 'until', origin: 'Origin', imported: 'imported from current code — not adopted', committee: 'committee',
      open: 'Open', none: 'Nothing here.', saved: 'Draft saved.', created: 'New draft created — edit it, then propose it.', proposed: 'Proposed — another committee member can now adopt it.',
      decided: 'Decision recorded.', valid: 'Definition valid.', invalid: 'Not valid:', addBlock: '+ block', remove: 'Remove', values: 'values, comma separated', readonly: 'Read-only: this version is not a draft (create a new draft to change it).',
      site: 'Site', baseline: 'Baseline', proposedCol: 'Proposed', delta: 'Δ', ragChanged: 'RAG changed', changed: 'sites changed', unknown: 'UNKNOWN', mayAdopt: 'You may adopt this version.',
      noAdopt: 'You may not adopt:', members: 'Committee members who may decide:', diffVs: 'Changes vs', noDiff: 'No difference.', inForce: 'adopted version in force (or today’s code)',
      event: 'Event', at: 'When', by: 'By', decision: 'Decision', ref: 'Reference', sample: 'sample', real: 'real data', fleet: 'Fleet', n: 'n', value: 'Value' },
    fr: { enforcedOn: 'Les écrans suivent la politique adoptée (kpi_policy_enforced = 1).', enforcedOff: 'Les écrans calculent comme aujourd’hui (kpi_policy_enforced = 0) : cette page enregistre et compare seulement.',
      version: 'Version', status: 'Statut', title: 'Titre', from: 'En vigueur du', to: 'au', origin: 'Origine', imported: 'importée du code actuel — non adoptée', committee: 'comité',
      open: 'Ouvrir', none: 'Rien ici.', saved: 'Brouillon enregistré.', created: 'Nouveau brouillon créé — modifiez-le puis proposez-le.', proposed: 'Proposée — un autre membre du comité peut maintenant l’adopter.',
      decided: 'Décision enregistrée.', valid: 'Définition valide.', invalid: 'Non valide :', addBlock: '+ bloc', remove: 'Retirer', values: 'valeurs séparées par des virgules', readonly: 'Lecture seule : cette version n’est pas un brouillon (créez un nouveau brouillon pour la modifier).',
      site: 'Site', baseline: 'Référence', proposedCol: 'Proposée', delta: 'Δ', ragChanged: 'RAG modifié', changed: 'sites modifiés', unknown: 'INCONNU', mayAdopt: 'Vous pouvez adopter cette version.',
      noAdopt: 'Vous ne pouvez pas adopter :', members: 'Membres du comité qui peuvent décider :', diffVs: 'Changements par rapport à', noDiff: 'Aucune différence.', inForce: 'version adoptée en vigueur (ou code actuel)',
      event: 'Événement', at: 'Quand', by: 'Par', decision: 'Décision', ref: 'Référence', sample: 'exemple', real: 'données réelles', fleet: 'Flotte', n: 'n', value: 'Valeur' },
  };
  const t = () => L[lang === 'fr' ? 'fr' : 'en'];
  const msg = (x, ok) => { $('kbMsg').className = 'kb-msg ' + (ok ? 'kb-ok' : 'kb-err'); $('kbMsg').textContent = !ok && lang === 'fr' && window.ErrorText ? window.ErrorText.fr(x) : x; };
  let cat = null, list = null, current = null, canEdit = false, isAdminTier = false;

  // ── form ⇄ definition ────────────────────────────────────────────────────────────────────────────────────
  function opts(sel, values, cur) { $(sel).innerHTML = values.map((v) => '<option value="' + esc(v) + '"' + (String(v) === String(cur) ? ' selected' : '') + '>' + esc(v) + '</option>').join(''); }
  function blockRow(b, ds) {
    const d = cat.datasets[ds] || { fields: [], special: [] };
    const kinds = Object.keys(cat.blocks).filter((k) => !['is_closed', 'sla_met', 'sla_missed'].includes(k) || d.special.includes(k));
    const p = (cat.blocks[b.block] || { params: [] }).params;
    let h = '<div class="kb-block"><select data-k="block">' + kinds.map((k) => '<option value="' + k + '"' + (k === b.block ? ' selected' : '') + '>' + esc(lang === 'fr' ? cat.blocks[k].fr : cat.blocks[k].en) + '</option>').join('') + '</select>';
    if (p.includes('field')) h += '<select data-k="field">' + d.fields.map((f) => '<option' + (f === b.field ? ' selected' : '') + '>' + esc(f) + '</option>').join('') + '</select>';
    if (p.includes('values')) h += '<input data-k="values" size="28" placeholder="' + esc(t().values) + '" value="' + esc((b.values || []).join(', ')) + '">';
    if (p.includes('rule')) h += '<select data-k="rule">' + cat.sla_rules.map((r) => '<option' + (r === b.rule ? ' selected' : '') + '>' + r + '</option>').join('') + '</select>';
    if (p.includes('cancelled_never_missed')) h += '<label class="kb-muted"><input type="checkbox" data-k="cancelled_never_missed"' + (b.cancelled_never_missed !== false ? ' checked' : '') + '> cancelled never missed</label>';
    return h + '<button type="button" data-rm="1">' + esc(t().remove) + '</button></div>';
  }
  function renderBlocks(id, blocks, ds) { $(id).innerHTML = (blocks || []).map((b) => blockRow(b, ds)).join('') + '<button type="button" data-add="1">' + esc(t().addBlock) + '</button>'; }
  function readBlocks(id) {
    return [...$(id).querySelectorAll('.kb-block')].map((row) => {
      const g = (k) => row.querySelector('[data-k="' + k + '"]'); const b = { block: g('block').value }; const p = (cat.blocks[b.block] || { params: [] }).params;
      if (p.includes('field') && g('field')) b.field = g('field').value;
      if (p.includes('values') && g('values')) b.values = g('values').value.split(',').map((x) => x.trim()).filter(Boolean);
      if (p.includes('rule') && g('rule')) b.rule = g('rule').value;
      if (p.includes('cancelled_never_missed') && g('cancelled_never_missed')) b.cancelled_never_missed = g('cancelled_never_missed').checked;
      return b;
    });
  }
  const num = (v) => (v === '' || v == null ? null : Number(v));
  const pair = (s) => { const m = String(s || '').split('/').map((x) => x.trim()).filter(Boolean); return m.length === 2 ? { green: Number(m[0]), amber: Number(m[1]) } : null; };
  function formDef() {
    const agg = $('kbAgg').value; const d = { schema: 1, dataset: $('kbDataset').value, aggregation: agg };
    if (agg === 'ratio') { d.denominator = readBlocks('kbDen'); d.numerator = readBlocks('kbNum'); } else { d.filters = readBlocks('kbFil'); }
    if (['mean', 'median', 'percentile'].includes(agg)) d.value_field = $('kbValueField').value;
    if (agg === 'percentile') d.percentile = num($('kbPct').value);
    d.window = { kind: $('kbWin').value }; if (d.window.kind === 'rolling') d.window.n = num($('kbWinN').value);
    d.unit = $('kbUnit').value; d.direction = $('kbDir').value; d.rounding = num($('kbRound').value); d.min_sample = num($('kbMin').value);
    const g = num($('kbGreen').value), a = num($('kbAmber').value);
    if (g != null || a != null) {
      d.rag = { green: g, amber: a }; const bsc = {}; const mi = pair($('kbMine').value), of = pair($('kbOffice').value);
      if (mi) bsc.mine = mi; if (of) bsc.office = of; if (Object.keys(bsc).length) d.rag.by_site_class = bsc;
    } else d.rag = null;
    d.target = { link: $('kbTarget').value }; d.null_handling = 'unknown';
    return d;
  }
  function fillForm(p) {
    const d = (p && p.definition) || {};
    $('kbTitle').value = p ? p.title : ''; opts('kbDataset', Object.keys(cat.datasets), d.dataset || 'helpdesk_tickets'); opts('kbAgg', cat.aggregations, d.aggregation || 'ratio');
    opts('kbValueField', cat.datasets[d.dataset || 'helpdesk_tickets'].value_fields, d.value_field); $('kbPct').value = d.percentile || '';
    opts('kbWin', cat.window_kinds, (d.window || {}).kind || 'month'); $('kbWinN').value = (d.window || {}).n || '';
    opts('kbUnit', cat.units, d.unit || '%'); opts('kbDir', cat.directions, d.direction || 'higher_is_better');
    $('kbRound').value = d.rounding != null ? d.rounding : 1; $('kbMin').value = d.min_sample != null ? d.min_sample : 0;
    $('kbTarget').value = (d.target || {}).link || 'none';
    $('kbGreen').value = d.rag ? d.rag.green : ''; $('kbAmber').value = d.rag ? d.rag.amber : '';
    const bsc = (d.rag && d.rag.by_site_class) || {};
    $('kbMine').value = bsc.mine ? bsc.mine.green + ' / ' + bsc.mine.amber : ''; $('kbOffice').value = bsc.office ? bsc.office.green + ' / ' + bsc.office.amber : '';
    $('kbFrom').value = p && p.effective_from ? p.effective_from : ''; $('kbOwner').value = p && p.owner ? p.owner : ''; $('kbRationale').value = p && p.rationale ? p.rationale : '';
    renderBlocks('kbDen', d.denominator, d.dataset || 'helpdesk_tickets'); renderBlocks('kbNum', d.numerator, d.dataset || 'helpdesk_tickets'); renderBlocks('kbFil', d.filters, d.dataset || 'helpdesk_tickets');
    const editable = canEdit && p && p.status === 'draft';
    for (const el of $('kbEditor').querySelectorAll('input, select, textarea, [data-add], [data-rm]')) if (!['kbSample'].includes(el.id)) el.disabled = !editable;
    $('kbSave').disabled = !editable; $('kbPropose').disabled = !editable; $('kbNew').disabled = !canEdit || !p; $('kbPreview').disabled = !canEdit;
    $('kbEdTitle').textContent = p ? 'v' + p.version + ' · ' + p.status + (editable ? '' : ' — ' + t().readonly) : '';
    validate();
  }

  let vTimer = null;
  function validate() {
    const d = formDef(); $('kbJson').textContent = JSON.stringify(d, null, 2);
    clearTimeout(vTimer);
    vTimer = setTimeout(async () => {
      try {
        const r = await api('POST', '/api/kpi-policies/validate', { definition: d });
        $('kbValid').className = 'kb-msg ' + (r.valid ? 'kb-ok' : 'kb-err');
        $('kbValid').textContent = r.valid ? t().valid : t().invalid + ' ' + r.errors.map((e) => e.path + ' — ' + (lang === 'fr' ? e.fr : e.en)).join(' · ');
      } catch (e) { $('kbValid').textContent = e.message; }
    }, 250);
  }

  // ── lists, detail, history ───────────────────────────────────────────────────────────────────────────────
  const pill = (s) => '<span class="kb-pill kb-' + esc(s) + '">' + esc(s === 'UNKNOWN' ? t().unknown : s) + '</span>';
  function renderList() {
    const m = $('kbMetric').value; const rows = list.policies.filter((p) => p.metric_key === m);
    $('kbList').innerHTML = rows.length ? '<table><thead><tr><th>' + esc(t().version) + '</th><th>' + esc(t().status) + '</th><th>' + esc(t().title) + '</th><th>' + esc(t().from) + '</th><th>' + esc(t().origin) + '</th><th></th></tr></thead><tbody>' +
      rows.map((p) => '<tr class="' + (current && current.id === p.id ? 'kb-sel' : '') + '"><td>v' + p.version + '</td><td>' + pill(p.status) + '</td><td>' + esc(p.title) + '</td><td>' + esc(p.effective_from || '—') + (p.effective_to ? ' ' + esc(t().to) + ' ' + esc(p.effective_to) : '') +
        '</td><td>' + esc(p.origin === 'imported_from_code' ? t().imported : t().committee) + '</td><td><button type="button" data-open="' + p.id + '">' + esc(t().open) + '</button></td></tr>').join('') + '</tbody></table>' : '<p class="kb-muted">' + esc(t().none) + '</p>';
    $('kbAgainst').innerHTML = '<option value="">' + esc(t().inForce) + '</option>' + rows.map((p) => '<option value="' + p.id + '">v' + p.version + ' · ' + esc(p.status) + '</option>').join('');
  }
  async function open(id) {
    const r = await api('GET', '/api/kpi-policies/' + id); current = r.policy; fillForm(current); renderList();
    $('kbRule').textContent = r.adoption_rule;
    $('kbMembers').textContent = r.committee ? t().members + ' ' + (r.committee.map((x) => x.full_name).join(', ') || '—') : '';
    $('kbMayAdopt').className = 'kb-msg ' + (r.may_adopt.ok ? 'kb-ok' : 'kb-err'); $('kbMayAdopt').textContent = r.may_adopt.ok ? t().mayAdopt : t().noAdopt + ' ' + r.may_adopt.reason;
    $('kbAdopt').disabled = !r.may_adopt.ok; $('kbReject').disabled = !canEdit || current.status !== 'proposed'; $('kbRetire').disabled = !canEdit || current.status !== 'adopted';
    $('kbHistory').innerHTML = '<table><thead><tr><th>' + esc(t().event) + '</th><th>' + esc(t().at) + '</th><th>' + esc(t().by) + '</th></tr></thead><tbody>' + r.history.events.map((e) => '<tr><td>' + esc(e.action) + '</td><td>' + esc(String(e.at).slice(0, 16)) + '</td><td>' + esc(e.actor_id == null ? '—' : '#' + e.actor_id) + '</td></tr>').join('') + '</tbody></table>' +
      (r.history.decisions.length ? '<h3>' + esc(t().decision) + '</h3><table><tbody>' + r.history.decisions.map((d) => '<tr><td>' + esc(d.decision) + '</td><td>' + esc(String(d.decided_at).slice(0, 16)) + '</td><td>#' + esc(d.decided_by) + '</td><td>' + esc(t().ref) + ': ' + esc(d.committee_ref) + '</td><td>' + esc(d.minutes || '') + '</td></tr>').join('') + '</tbody></table>' : '');
    const prev = list.policies.filter((p) => p.metric_key === current.metric_key && p.version < current.version).pop();
    if (prev) {
      const d = await api('GET', '/api/kpi-policies/' + current.id + '/diff?against=' + prev.id);
      $('kbDiff').innerHTML = '<h3>' + esc(t().diffVs) + ' v' + prev.version + '</h3>' + (d.changes.length ? '<table><tbody>' + d.changes.map((c) => '<tr><td>' + esc(c.path) + '</td><td><code>' + esc(JSON.stringify(c.from)) + '</code></td><td>→</td><td><code>' + esc(JSON.stringify(c.to)) + '</code></td></tr>').join('') + '</tbody></table>' : '<p class="kb-muted">' + esc(t().noDiff) + '</p>');
    } else $('kbDiff').innerHTML = '';
  }
  async function load(keepId) {
    list = await api('GET', '/api/kpi-policies'); canEdit = !!list.can_edit;
    $('kbEnforced').textContent = list.enforced ? t().enforcedOn : t().enforcedOff;
    const keys = [...new Set(list.policies.map((p) => p.metric_key).concat(list.metrics.map((m) => m.key)))];
    const cur = $('kbMetric').value || (current && current.metric_key) || 'helpdesk.resolution_sla_pct';
    $('kbMetric').innerHTML = keys.map((k) => { const m = list.metrics.find((x) => x.key === k); const n = list.policies.filter((p) => p.metric_key === k).length;
      return '<option value="' + esc(k) + '"' + (k === cur ? ' selected' : '') + '>' + esc(k) + (m ? ' — ' + esc(lang === 'fr' ? m.name_fr : m.name) : '') + (n ? ' (' + n + ')' : '') + '</option>'; }).join('');
    renderList();
    const id = keepId || (list.policies.find((p) => p.metric_key === $('kbMetric').value) || {}).id;
    if (id) await open(id); else { current = null; fillForm({ status: 'draft', title: '', definition: {} }); }
  }

  function resultTable(r) {
    const rows = r.sites || [];
    return '<p class="kb-muted">' + esc(r.source === 'sample' ? t().sample : t().real) + (r.window ? ' · ' + esc(r.window.from) + ' → ' + esc(r.window.to) : '') + '</p>' +
      (r.result ? '<p>' + esc(t().value) + ': <b>' + esc(r.result.value == null ? t().unknown : r.result.value) + '</b> ' + pill(r.result.rag || '—') + ' · ' + esc(t().n) + ' ' + esc(r.result.n) + '</p>' : '') +
      (r.fleet ? '<p>' + esc(t().fleet) + ': <b>' + esc(r.fleet.value == null ? t().unknown : r.fleet.value) + '</b> ' + pill(r.fleet.rag || '—') + ' · n ' + esc(r.fleet.n) + '</p>' : '') +
      (rows.length ? '<table><tbody>' + rows.map((s) => '<tr><td>' + esc(s.site) + '</td><td>' + esc(s.value == null ? t().unknown : s.value) + '</td><td>' + pill(s.rag || '—') + '</td><td>n ' + esc(s.n) + '</td></tr>').join('') + '</tbody></table>' : '');
  }

  // ── events ───────────────────────────────────────────────────────────────────────────────────────────────
  function applyLang() { document.body.classList.toggle('lang-fr', lang === 'fr'); document.documentElement.lang = lang; $('kbLang').value = lang === 'fr' ? 'fr' : 'en'; }
  $('kbLang').addEventListener('change', () => { lang = $('kbLang').value; try { localStorage.setItem('sdp_lang', lang); } catch (_) {} applyLang(); if (list) { renderList(); if (current) open(current.id).catch((e) => msg(e.message)); } });
  $('kbMetric').addEventListener('change', () => { current = null; load().catch((e) => msg(e.message)); });
  $('kbList').addEventListener('click', (ev) => { const id = ev.target.getAttribute('data-open'); if (id) open(id).catch((e) => msg(e.message)); });
  $('kbEditor').addEventListener('input', () => validate());
  $('kbEditor').addEventListener('change', (ev) => {
    if (ev.target.id === 'kbDataset' || ev.target.getAttribute('data-k') === 'block' || ev.target.id === 'kbAgg') {
      const d = formDef(); if (ev.target.id === 'kbDataset') { d.denominator = []; d.numerator = []; d.filters = []; }
      opts('kbValueField', cat.datasets[d.dataset].value_fields, d.value_field);
      renderBlocks('kbDen', d.denominator, d.dataset); renderBlocks('kbNum', d.numerator, d.dataset); renderBlocks('kbFil', d.filters, d.dataset);
    }
    validate();
  });
  $('kbEditor').addEventListener('click', (ev) => {
    if (ev.target.getAttribute('data-rm')) { ev.target.closest('.kb-block').remove(); validate(); }
    if (ev.target.getAttribute('data-add')) { const box = ev.target.closest('.kb-blocks'); ev.target.insertAdjacentHTML('beforebegin', blockRow({ block: 'field_in', values: [] }, $('kbDataset').value)); void box; validate(); }
  });
  $('kbNew').addEventListener('click', async () => {
    try { const r = await api('POST', '/api/kpi-policies', { metric_key: $('kbMetric').value, title: (current ? current.title : 'Draft') + ' (draft)', definition: formDef(), owner: $('kbOwner').value, rationale: $('kbRationale').value });
      msg(t().created, true); await load(r.id); } catch (e) { msg(e.message); }
  });
  $('kbSave').addEventListener('click', async () => {
    try { await api('PUT', '/api/kpi-policies/' + current.id, { title: $('kbTitle').value, definition: formDef(), effective_from: $('kbFrom').value || null, owner: $('kbOwner').value, rationale: $('kbRationale').value });
      msg(t().saved, true); await load(current.id); } catch (e) { msg(e.message); }
  });
  $('kbPropose').addEventListener('click', async () => { try { await api('POST', '/api/kpi-policies/' + current.id + '/propose'); msg(t().proposed, true); await load(current.id); } catch (e) { msg(e.message); } });
  $('kbPreview').addEventListener('click', async () => { try { $('kbPreviewOut').innerHTML = resultTable(await api('POST', '/api/kpi-policies/preview', { definition: formDef(), as_of: $('kbAsOf').value || undefined })); } catch (e) { msg(e.message); } });
  $('kbPreviewSample').addEventListener('click', async () => {
    try { const rows = JSON.parse($('kbSample').value || '[]'); $('kbPreviewOut').innerHTML = resultTable(await api('POST', '/api/kpi-policies/preview', { definition: formDef(), sample_rows: rows })); } catch (e) { msg(e.message); }
  });
  $('kbShadow').addEventListener('click', async () => {
    try {
      const body = current && current.status !== 'draft' ? { policy_id: current.id } : { definition: formDef(), metric_key: $('kbMetric').value };
      if ($('kbAgainst').value) body.against = Number($('kbAgainst').value); if ($('kbAsOf').value) body.as_of = $('kbAsOf').value;
      const r = await api('POST', '/api/kpi-policies/shadow', body);
      $('kbShadowOut').innerHTML = '<p class="kb-muted">' + esc(r.baseline) + ' → ' + esc(r.proposed) + ' · ' + esc(r.window.from) + ' → ' + esc(r.window.to) + ' · ' + r.changed + ' ' + esc(t().changed) + '</p>' +
        '<table><thead><tr><th>' + esc(t().site) + '</th><th>' + esc(t().baseline) + '</th><th>' + esc(t().proposedCol) + '</th><th>' + esc(t().delta) + '</th><th>' + esc(t().ragChanged) + '</th></tr></thead><tbody>' +
        r.sites.map((s) => '<tr><td>' + esc(s.site) + '</td><td>' + esc(s.baseline.value == null ? t().unknown : s.baseline.value) + ' ' + (s.baseline.rag ? pill(s.baseline.rag) : '') + ' <span class="kb-muted">n ' + esc(s.baseline.n) + '</span></td><td>' +
          esc(s.proposed.value == null ? t().unknown : s.proposed.value) + ' ' + (s.proposed.rag ? pill(s.proposed.rag) : '') + ' <span class="kb-muted">n ' + esc(s.proposed.n) + '</span></td><td>' + esc(s.delta == null ? '—' : s.delta) + '</td><td>' + (s.rag_changed ? '●' : '') + '</td></tr>').join('') + '</tbody></table>';
    } catch (e) { msg(e.message); }
  });
  async function decide(decision) {
    try { await api('POST', '/api/kpi-policies/' + current.id + '/decide', { decision, committee_ref: $('kbRef').value, minutes: $('kbMinutes').value, effective_from: $('kbDecFrom').value || undefined });
      msg(t().decided, true); await load(current.id); } catch (e) { msg(e.message); }
  }
  $('kbAdopt').addEventListener('click', () => decide('adopt'));
  $('kbReject').addEventListener('click', () => decide('reject'));
  $('kbRetire').addEventListener('click', () => decide('retire'));

  applyLang();
  try { isAdminTier = typeof window.__userHasRole === 'function' && (window.__userHasRole('admin') || window.__userHasRole('kpi-committee')); } catch (_) {}
  $('kbAdvanced').hidden = !isAdminTier;
  api('GET', '/api/kpi-policies/catalogue').then((r) => { cat = r.catalogue; return load(); }).catch((e) => msg(e.message));
})();
