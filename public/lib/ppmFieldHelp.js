/* PORTFOLIO LOT 2 — field help + data-quality panel of the project Intake tab (public/project.html, rendered by
 * lib/ppmIntake.js). Shown only while report_config ppm_data_quality_enabled = '1' (the project read then carries a
 * `dq` block and the intake catalogue a `dq_guide`). Shadow: it shows the score, the blocking errors, every check
 * and the spec §4.3 submission checklist — it refuses nothing (the gate is server-side, ppm_dq_gate_enforced).
 * Every item has a help button that opens its field guidance (definition, why it matters, good example, common
 * mistake, required / recommended / automatic). The required set, the blocking checks and the RAG bands are PROPOSED.
 * No inline script, no raw colour: tokens of _tokens.css only (lib/ppmIntake.css). Texts: own EN / FR table.
 */
(function (root) {
  'use strict';
  var S = {
    en: { title: 'Data quality', proposed: 'Proposed rules — the required fields, the blocking checks and the colour bands are not approved policy.',
      score: 'Score', of: 'of', fields: 'required fields complete', unknown: 'Unknown — some fields cannot be read (turn on the intake register).', blocking: 'Blocking errors',
      none_blocking: 'No blocking error.', checks: 'Checks', checklist: 'Submission checklist', done: 'Done', not_done: 'To do', unknown_item: 'Unknown', hidden: 'Not shown (amounts)',
      gate: 'Approval is refused while a blocking error remains.', shadow: 'Shown for information: approval is not blocked.', help: 'Help for', definition: 'Definition', why: 'Why it matters',
      example: 'Good example', mistake: 'Common mistake', level: 'Level', required: 'Required (proposed)', recommended: 'Recommended', automatic: 'Automatic',
      st_complete: 'complete', st_blank: 'empty', st_zero: 'zero', st_tbc: 'to be confirmed', st_na: 'not applicable', st_none_known: 'none known', st_invalid: 'invalid', st_unavailable: 'unknown', st_not_applicable: '—',
      without_budget: 'Budget checks left out (you do not see amounts).',
      business_problem: 'Clear business problem', measurable_value: 'Expected measurable value', business_sponsor: 'Business sponsor', it_owner: 'IT owner', priority: 'Priority',
      planned_dates: 'Planned dates', budget_estimate: 'Budget estimate', budget_status: 'Budget status', dependencies: 'Dependencies', key_risks: 'Key risks',
      decision_requirement: 'Decision requirement', project_status: 'Project status', delivery_effort: 'Delivery effort', resource_requirement: 'Resource requirement',
      risk_exposure: 'Risk exposure', delivery_lead: 'Delivery lead' },
    fr: { title: 'Qualité des données', proposed: 'Règles proposées — les champs obligatoires, les contrôles bloquants et les seuils de couleur ne sont pas une politique approuvée.',
      score: 'Score', of: 'sur', fields: 'champs obligatoires renseignés', unknown: 'Inconnu — certains champs ne sont pas lisibles (activer le registre des projets).', blocking: 'Erreurs bloquantes',
      none_blocking: 'Aucune erreur bloquante.', checks: 'Contrôles', checklist: 'Liste de contrôle avant soumission', done: 'Fait', not_done: 'À faire', unknown_item: 'Inconnu', hidden: 'Non affiché (montants)',
      gate: 'L’approbation est refusée tant qu’une erreur bloquante subsiste.', shadow: 'Affiché pour information : l’approbation n’est pas bloquée.', help: 'Aide pour', definition: 'Définition', why: 'Pourquoi c’est utile',
      example: 'Bon exemple', mistake: 'Erreur fréquente', level: 'Niveau', required: 'Obligatoire (proposé)', recommended: 'Recommandé', automatic: 'Automatique',
      st_complete: 'renseigné', st_blank: 'vide', st_zero: 'zéro', st_tbc: 'à confirmer', st_na: 'sans objet', st_none_known: 'aucun connu', st_invalid: 'invalide', st_unavailable: 'inconnu', st_not_applicable: '—',
      without_budget: 'Contrôles du budget non affichés (vous ne voyez pas les montants).',
      business_problem: 'Problème métier clair', measurable_value: 'Valeur mesurable attendue', business_sponsor: 'Sponsor métier', it_owner: 'Responsable IT', priority: 'Priorité',
      planned_dates: 'Dates prévues', budget_estimate: 'Estimation budgétaire', budget_status: 'Statut du budget', dependencies: 'Dépendances', key_risks: 'Risques clés',
      decision_requirement: 'Décision requise', project_status: 'Statut du projet', delivery_effort: 'Effort de réalisation', resource_requirement: 'Besoin en ressources',
      risk_exposure: 'Exposition au risque', delivery_lead: 'Responsable de la réalisation' },
  };
  var RAG_CLASS = { GREEN: 'dq-green', AMBER: 'dq-amber', RED: 'dq-red', NA: 'dq-na' };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function tr(lang, k) { var l = S[lang] || S.en; return l[k] != null ? l[k] : S.en[k]; }
  var seq = 0;

  /** A help button + its hidden guidance for one catalogue entry (the same layout as the intake fields). */
  function helpButton(entry, lang, label) {
    if (!entry) return '';
    var x = entry[lang] || entry.en, id = 'dq-help-' + (++seq);
    return '<button type="button" class="in-help-btn dq-help-btn" aria-expanded="false" aria-controls="' + id + '" aria-label="' + esc(tr(lang, 'help') + ' ' + (label || x.label)) + '">?</button>' +
      '<div class="in-help" id="' + id + '" hidden><dl><dt>' + esc(tr(lang, 'definition')) + '</dt><dd>' + esc(x.description) + '</dd><dt>' + esc(tr(lang, 'why')) + '</dt><dd>' + esc(x.why) + '</dd>' +
      '<dt>' + esc(tr(lang, 'example')) + '</dt><dd>' + esc(x.example) + '</dd><dt>' + esc(tr(lang, 'mistake')) + '</dt><dd>' + esc(x.mistake) + '</dd><dt>' + esc(tr(lang, 'level')) + '</dt><dd>' + esc(tr(lang, entry.level)) + '</dd></dl></div>';
  }

  /** The data-quality panel: score + RAG, blocking errors, the checks, the §4.3 checklist with help buttons. */
  function panel(dq, guide, lang) {
    if (!dq) return '';
    lang = lang === 'fr' ? 'fr' : 'en';
    var fields = {}; ((guide && guide.fields) || []).forEach(function (f) { fields[f.key] = f; });
    var byCheck = {}; ((guide && guide.fields) || []).forEach(function (f) { (f.dq_checks || []).forEach(function (k) { if (!byCheck[k]) byCheck[k] = f; }); });
    var h = '<section class="dq-panel" aria-labelledby="dq-title"><h3 id="dq-title">' + esc(tr(lang, 'title')) + '</h3><p class="in-note">' + esc(tr(lang, 'proposed')) + '</p>';
    h += '<p class="dq-score"><span class="dq-rag ' + (RAG_CLASS[dq.rag] || 'dq-na') + '">' + esc(dq.rag) + '</span> ' +
      (dq.score == null ? esc(tr(lang, 'unknown')) : esc(tr(lang, 'score')) + ' ' + esc(dq.score) + ' % — ' + esc(dq.completed) + ' ' + esc(tr(lang, 'of')) + ' ' + esc(dq.required) + ' ' + esc(tr(lang, 'fields'))) + '</p>';
    if (dq.scope === 'without_budget') h += '<p class="in-note">' + esc(tr(lang, 'without_budget')) + '</p>';
    h += '<p class="in-note">' + esc(tr(lang, dq.gate_enforced ? 'gate' : 'shadow')) + '</p>';
    h += '<h4>' + esc(tr(lang, 'blocking')) + '</h4>' + (dq.blocking && dq.blocking.length ? '<ul class="dq-blocking">' + dq.blocking.map(function (k) { return '<li>' + esc(k) + ' ' + helpButton(byCheck[k], lang) + '</li>'; }).join('') + '</ul>' : '<p class="in-note">' + esc(tr(lang, 'none_blocking')) + '</p>');
    h += '<h4>' + esc(tr(lang, 'checklist')) + '</h4><ul class="dq-list">' + (dq.checklist || []).map(function (it) {
      var st = it.hidden ? 'hidden' : it.done === true ? 'done' : it.done === false ? 'not_done' : 'unknown_item';
      return '<li class="dq-item dq-' + st + '"><span class="dq-mark">' + esc(tr(lang, st)) + '</span> ' + esc(tr(lang, it.key)) + ' ' + helpButton(fields[it.field], lang, tr(lang, it.key)) + '</li>';
    }).join('') + '</ul>';
    h += '<details class="dq-checks"><summary>' + esc(tr(lang, 'checks')) + '</summary><ul class="dq-list">' + (dq.checks || []).map(function (c) {
      return '<li class="dq-item">' + esc(c.key) + ' — ' + esc(tr(lang, 'st_' + c.state)) + (c.blocking ? ' (' + esc(tr(lang, 'blocking')) + ')' : '') + '</li>';
    }).join('') + '</ul></details></section>';
    return h;
  }

  /** Wire the help buttons inside host (toggle + aria-expanded). */
  function wire(host) {
    if (!host || !host.querySelectorAll) return;
    host.querySelectorAll('.dq-help-btn').forEach(function (b) {
      b.addEventListener('click', function () { var d = document.getElementById(b.getAttribute('aria-controls')); if (!d) return; var open = d.hidden; d.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false'); });
    });
  }

  root.PpmFieldHelp = { panel: panel, helpButton: helpButton, wire: wire, STRINGS: S };
})(typeof window !== 'undefined' ? window : globalThis);
