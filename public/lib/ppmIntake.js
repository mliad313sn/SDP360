/* PORTFOLIO LOT 1 — the Intake tab of public/project.html (switch ppm_intake_register_enabled; the tab does not exist
 * while it is off). Sections Identity · Business case · Ownership · Schedule · Budget · Resources, each field with a
 * help button that opens its guidance (definition, why it matters, good example, common mistake, required /
 * recommended / automatic — served by GET /api/governance/intake/catalogue, EN + FR). Saved through the existing
 * PUT /api/governance/portfolio/project (committee only — the page shows the fields read-only to everyone else).
 * Value states: next to a field, "TBC" / "Not applicable" (and "None known" for dependencies and risks) are recorded
 * separately from the value — blank stays unknown ("—"), 0 stays a measured zero.
 * Texts: own EN/FR table (the catalogue carries its own two languages); language = the page language (I18nText).
 * No inline script, no raw colour: tokens of _tokens.css only (lib/ppmIntake.css).
 */
(function (root) {
  'use strict';
  var S = {
    en: { title: 'Project intake', sub: 'The register fields of this project. “—” means unknown, never 0. Priority meanings, risk levels and effort bands are proposed values, not approved policy.',
      identity: 'Identity', business_case: 'Business case', ownership: 'Ownership', schedule: 'Schedule', budget: 'Budget', resources: 'Resources',
      save: 'Save the intake', saved: 'Intake saved.', readonly: 'Read only: the committee maintains the project register.', help: 'Help for', definition: 'Definition', why: 'Why it matters',
      example: 'Good example', mistake: 'Common mistake', level: 'Level', required: 'Required (proposed)', recommended: 'Recommended', automatic: 'Automatic', none: '— not set —',
      state: 'State of the value', st_: 'value', st_tbc: 'TBC', st_na: 'Not applicable', none_known: 'None known', retired: '(retired)', proposed: '(proposed, not approved)',
      current_situation: 'Current situation', impact: 'Business impact', problem: 'Problem', required_outcome: 'Required outcome',
      dependencies: 'Dependencies', risks: 'Risks', duration: 'Calculated duration', days: 'days', not_baselined: 'Schedule not baselined (no valid planned dates)',
      sites_note: 'Primary site and affected sites are set from the portfolio page.', amount_note: 'Amount and currency: the budget fields of the project (shown to the money readers only).',
      warn: 'Check:', unavailable: 'Intake fields unavailable.' },
    fr: { title: 'Fiche projet', sub: 'Les champs du registre pour ce projet. « — » signifie inconnu, jamais 0. Les définitions des priorités, les niveaux de risque et les tranches d’effort sont des valeurs proposées, pas une politique approuvée.',
      identity: 'Identité', business_case: 'Justification', ownership: 'Responsabilités', schedule: 'Planning', budget: 'Budget', resources: 'Ressources',
      save: 'Enregistrer la fiche', saved: 'Fiche enregistrée.', readonly: 'Lecture seule : le comité tient le registre des projets.', help: 'Aide pour', definition: 'Définition', why: 'Pourquoi c’est utile',
      example: 'Bon exemple', mistake: 'Erreur fréquente', level: 'Niveau', required: 'Obligatoire (proposé)', recommended: 'Recommandé', automatic: 'Automatique', none: '— non renseigné —',
      state: 'État de la valeur', st_: 'valeur', st_tbc: 'À confirmer', st_na: 'Sans objet', none_known: 'Aucun connu', retired: '(retiré)', proposed: '(proposé, non approuvé)',
      current_situation: 'Situation actuelle', impact: 'Impact métier', problem: 'Problème', required_outcome: 'Résultat attendu',
      dependencies: 'Dépendances', risks: 'Risques', duration: 'Durée calculée', days: 'jours', not_baselined: 'Planning non établi (pas de dates prévues valides)',
      sites_note: 'Le site principal et les sites concernés se règlent depuis la page portefeuille.', amount_note: 'Montant et devise : les champs budget du projet (visibles des lecteurs autorisés aux montants seulement).',
      warn: 'À vérifier :', unavailable: 'Champs de la fiche indisponibles.' },
  };
  var lang = function () { try { return root.I18nText && root.I18nText.lang && root.I18nText.lang() === 'fr' ? 'fr' : 'en'; } catch (_) { return 'en'; } };
  var t = function (k) { var l = S[lang()]; return l[k] != null ? l[k] : S.en[k]; };
  var LIST = { project_type: 'project_type', priority: 'priority', schedule_confidence: 'schedule_confidence', budget_status: 'budget_status', decision_required: 'decision_required', delivery_effort: 'delivery_effort', risk_exposure: 'risk_exposure' };
  var TEXTAREA = { expected_value: 1, workload_notes: 1 };
  var COLUMN = { business_sponsor: 'sponsor', it_owner: 'owner' };   // spec names → existing columns
  var CAT = null;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function txt(f) { return f[lang()] || f.en; }

  function control(f, p, edit, states) {
    var key = f.key, col = COLUMN[key] || key, id = 'in-' + key, v = p[col], dis = edit ? '' : ' disabled';
    if (key === 'project_ref') return '<output id="' + id + '" class="in-ref">' + esc(v || '—') + '</output>';
    if (key === 'affected_sites') return '<p class="in-note" id="' + id + '">' + esc(t('sites_note')) + '</p>';
    if (key === 'business_need') {
      var bn = v || {};
      return CAT.business_need_parts.map(function (part) { return '<label class="in-sub">' + esc(t(part)) + '<textarea rows="2" data-need="' + part + '"' + dis + '>' + esc(bn[part] || '') + '</textarea></label>'; }).join('');
    }
    var input;
    if (LIST[key]) {
      var vals = (CAT.lookups[LIST[key]] || []).slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
      var opts = '<option value="">' + esc(t('none')) + '</option>' + vals.map(function (o) { return '<option value="' + esc(o.code) + '"' + (o.code === v ? ' selected' : '') + '>' + esc(lang() === 'fr' ? o.label_fr : o.label_en) + (o.proposed ? ' ' + esc(t('proposed')) : '') + '</option>'; }).join('');
      if (v && !vals.some(function (o) { return o.code === v; })) opts += '<option value="' + esc(v) + '" selected>' + esc(v) + ' ' + esc(t('retired')) + '</option>';
      input = '<select id="' + id + '" data-field="' + key + '"' + dis + '>' + opts + '</select>';
    } else if (TEXTAREA[key]) input = '<textarea id="' + id + '" rows="3" data-field="' + key + '"' + dis + '>' + esc(v || '') + '</textarea>';
    else if (key === 'avg_fte' || key === 'peak_fte') input = '<input id="' + id + '" type="number" min="0" step="0.1" data-field="' + key + '" value="' + (v == null ? '' : esc(v)) + '"' + dis + '>';
    else if (key === 'budget_approval_date') input = '<input id="' + id + '" type="date" data-field="' + key + '" value="' + esc(v || '') + '"' + dis + '>';
    else if (key === 'tags') input = '<input id="' + id + '" data-field="tags" value="' + esc((v || []).join(', ')) + '"' + dis + '>';
    else input = '<input id="' + id + '" data-field="' + key + '" value="' + esc(v || '') + '"' + (key === 'indicative_quarter' ? ' placeholder="2027-Q2"' : '') + dis + '>';
    if (CAT.state_fields.indexOf(col) >= 0 && CAT.none_known_only.indexOf(col) < 0) {
      var s = states[col] || '';
      input += '<select class="in-state" data-state="' + col + '" aria-label="' + esc(t('state') + ' — ' + txt(f).label) + '"' + dis + '>' +
        ['', 'tbc', 'na'].map(function (x) { return '<option value="' + x + '"' + (x === s ? ' selected' : '') + '>' + esc(t('st_' + x)) + '</option>'; }).join('') + '</select>';
    }
    return input;
  }

  function fieldHtml(f, p, edit, states) {
    var x = txt(f), hid = 'in-help-' + f.key;
    var head = f.key === 'business_need' ? '<span class="in-label">' + esc(x.label) + '</span>' : '<label class="in-label" for="in-' + esc(f.key) + '">' + esc(x.label) + '</label>';
    return '<div class="in-field">' + head + ' <button type="button" class="in-help-btn" aria-expanded="false" aria-controls="' + hid + '" aria-label="' + esc(t('help') + ' ' + x.label) + '">?</button>' +
      '<div class="in-ctl">' + control(f, p, edit, states) + '</div>' +
      '<div class="in-help" id="' + hid + '" hidden><dl><dt>' + esc(t('definition')) + '</dt><dd>' + esc(x.description) + '</dd><dt>' + esc(t('why')) + '</dt><dd>' + esc(x.why) + '</dd>' +
      '<dt>' + esc(t('example')) + '</dt><dd>' + esc(x.example) + '</dd><dt>' + esc(t('mistake')) + '</dt><dd>' + esc(x.mistake) + '</dd><dt>' + esc(t('level')) + '</dt><dd>' + esc(t(f.level)) + '</dd></dl></div></div>';
  }

  function render(ctx, host) {
    var V = ctx.V(), p = V.project, edit = !!V.committee, states = p.value_states || {};
    var bySec = {}; CAT.fields.forEach(function (f) { (bySec[f.section] = bySec[f.section] || []).push(f); });
    var h = '<h2>' + esc(t('title')) + '</h2><p class="in-note">' + esc(t('sub')) + '</p>' + (edit ? '' : '<p class="in-note">' + esc(t('readonly')) + '</p>');
    CAT.sections.forEach(function (sec) {
      h += '<fieldset class="in-sec"><legend>' + esc(t(sec)) + '</legend>' + (bySec[sec] || []).map(function (f) { return fieldHtml(f, p, edit, states); }).join('');
      if (sec === 'schedule') h += '<p class="in-note">' + esc(t('duration')) + ': ' + (p.planned_duration_days == null ? esc(t('not_baselined')) : esc(p.planned_duration_days + ' ' + t('days'))) + '</p>';
      if (sec === 'budget') h += '<p class="in-note">' + esc(t('amount_note')) + '</p>';
      if (sec === 'resources') h += ['dependencies', 'risks'].map(function (k) { return '<label class="in-check"><input type="checkbox" data-state-none="' + k + '"' + (states[k] === 'none_known' ? ' checked' : '') + (edit ? '' : ' disabled') + '> ' + esc(t(k)) + ' — ' + esc(t('none_known')) + '</label>'; }).join('');
      h += '</fieldset>';
    });
    if (edit) h += '<div class="bar"><button class="btn primary" type="button" id="in-save">' + esc(t('save')) + '</button></div>';
    host.innerHTML = '<div class="panel in-panel">' + h + '</div>';
    host.querySelectorAll('.in-help-btn').forEach(function (b) { b.addEventListener('click', function () { var d = document.getElementById(b.getAttribute('aria-controls')); var open = d.hidden; d.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false'); }); });
    var sv = host.querySelector('#in-save'); if (sv) sv.addEventListener('click', function () { save(ctx, host); });
  }

  function collect(host, p) {
    var body = { id: p.id, version: p.version };
    host.querySelectorAll('[data-field]').forEach(function (el) {
      var k = el.getAttribute('data-field'), col = COLUMN[k] || k, v = el.value;
      if (k === 'tags') body.tags = v.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      else if (k === 'avg_fte' || k === 'peak_fte') body[col] = v === '' ? null : Number(v);
      else body[col] = v === '' ? null : v;
    });
    var need = {}; host.querySelectorAll('[data-need]').forEach(function (el) { need[el.getAttribute('data-need')] = el.value; }); body.business_need = need;
    var states = {}; host.querySelectorAll('[data-state]').forEach(function (el) { var f = el.getAttribute('data-state'); var filled = body[f] != null && body[f] !== '' && !(Array.isArray(body[f]) && !body[f].length); states[f] = el.value && !filled ? el.value : null; });
    host.querySelectorAll('[data-state-none]').forEach(function (el) { states[el.getAttribute('data-state-none')] = el.checked ? 'none_known' : null; });
    body.value_states = states;
    return body;
  }

  function save(ctx, host) {
    var p = ctx.V().project;
    ctx.api('/api/governance/portfolio/project', { method: 'PUT', body: JSON.stringify(collect(host, p)) }).then(function (j) {
      var w = (j.warnings || []).map(function (x) { return x.message; });
      ctx.msg(w.length ? t('saved') + ' ' + t('warn') + ' ' + w.join(' · ') : t('saved'));
      return ctx.reload();
    }).catch(ctx.fail);
  }

  function mount(ctx) {
    var host = ctx.$('intake'); if (!host || !ctx.V()) return;
    var go = function () { render(ctx, host); };
    if (CAT) return go();
    ctx.api('/api/governance/intake/catalogue').then(function (c) { CAT = c; go(); }).catch(function () { host.textContent = t('unavailable'); });
  }

  root.PpmIntake = { mount: mount, collect: collect, STRINGS: S };
})(typeof window !== 'undefined' ? window : globalThis);
