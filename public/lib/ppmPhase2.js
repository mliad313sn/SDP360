/* PORTFOLIO LOT 6 — the Dependencies / Resources / Documents tabs of public/project.html (each tab exists only while
 * its switch is on: ppm_structured_dependencies_enabled, ppm_resource_demand_enabled (+ effort scoring panel while
 * ppm_effort_scoring_enabled), ppm_documents_enabled). Data: /api/governance/ppm/project/:id/{dependencies,
 * risk-exposure, demand, effort, documents} (routes/governancePortfolioPhase2.js). The server decides who may write
 * (plan-write rule) — a refused write shows the server's message. Unknown shows "—", never 0. Every value escaped.
 * No inline script / handler, no raw colour (lib/ppmPhase2.css uses _tokens.css). Language = the page language.
 */
(function (root) {
  'use strict';
  var S = {
    en: { deps: 'Dependencies', deps_sub: 'What this project waits for: another project, or an external item (procurement, power, HSE approval…). Owner, status, target date and criticality for each. Flags and categories are proposed, not approved policy.',
      on_project: 'On project', external: 'External category', description: 'Description', owner: 'Owner', status: 'Status', target: 'Target date', criticality: 'Criticality', flags: 'Checks', source: 'Source',
      legacy: 'old list (not yet converted)', add: 'Add', save: 'Save', remove: 'Remove', none: 'None recorded.', dependents: 'Projects waiting for this one', loop: 'This project is part of a dependency loop.',
      risks: 'Risk exposure', risks_sub: 'Exposure level = probability × impact on the risk register (proposed mapping: 1–2 low, 3–4 medium, 6 high, 9 critical). Residual = after mitigation.',
      risk: 'Risk', exposure: 'Exposure', residual: 'Residual', rp: 'Residual probability (1–3)', ri: 'Residual impact (1–3)', due: 'Due date', overdue: 'overdue', project_level: 'Project exposure',
      demand: 'Resource demand', demand_sub: 'One line per skill. FTE are numbers only (0.5 = half a person); a category belongs in the delivery effort field.', skill: 'Skill', avg: 'Average FTE', peak: 'Peak FTE',
      start: 'Start (YYYY-MM)', finish: 'Finish (YYYY-MM)', sourcing: 'Internal / external', internal: 'Internal', external_s: 'External', load: 'Monthly load', month: 'Month', capacity: 'Capacity FTE', util: 'Utilisation', cap_unknown: 'Capacity not configured: no colour is given (unknown, not green).',
      effort: 'Delivery effort score', effort_sub: 'Seven factors scored 1 (low) to 5 (high). The score suggests a band; the declared delivery effort is never changed automatically. Weights and bands are proposed.',
      score: 'Score', band: 'Suggested band', declared: 'Declared', mismatch: 'differs from the declared band', not_scored: 'not scored until the seven factors are answered',
      technical_complexity: 'Technical complexity', integration_complexity: 'Integration complexity', procurement_complexity: 'Procurement complexity', site_impact: 'Site impact', stakeholder_count: 'Stakeholder count', cross_site_coverage: 'Cross-site coverage', change_impact: 'Change impact',
      docs: 'Documents', docs_sub: 'Business case, quotation, design… PDF, image, Word, Excel or PowerPoint, 10 MB at most. A second file with the same type and title becomes a new version. Quotations, budget approvals and purchase requests can be opened by amount readers only.',
      type: 'Type', title_: 'Title', version: 'Version', file: 'File', uploaded: 'Uploaded', download: 'Download', restricted: 'restricted (amounts)', upload: 'Upload', latest: 'latest', saved: 'Saved.', removed: 'Removed.', confirm_remove: 'Remove this item? It stays in the history.' },
    fr: { deps: 'Dépendances', deps_sub: 'Ce que ce projet attend : un autre projet, ou un élément externe (achats, énergie, validation HSE…). Responsable, statut, date cible et criticité pour chacune. Les contrôles et catégories sont proposés, pas une politique approuvée.',
      on_project: 'Sur le projet', external: 'Catégorie externe', description: 'Description', owner: 'Responsable', status: 'Statut', target: 'Date cible', criticality: 'Criticité', flags: 'Contrôles', source: 'Origine',
      legacy: 'ancienne liste (pas encore convertie)', add: 'Ajouter', save: 'Enregistrer', remove: 'Retirer', none: 'Aucune saisie.', dependents: 'Projets qui attendent celui-ci', loop: 'Ce projet fait partie d’une boucle de dépendances.',
      risks: 'Exposition aux risques', risks_sub: 'Niveau d’exposition = probabilité × impact du registre des risques (correspondance proposée : 1–2 faible, 3–4 moyen, 6 élevé, 9 critique). Résiduel = après atténuation.',
      risk: 'Risque', exposure: 'Exposition', residual: 'Résiduel', rp: 'Probabilité résiduelle (1–3)', ri: 'Impact résiduel (1–3)', due: 'Échéance', overdue: 'en retard', project_level: 'Exposition du projet',
      demand: 'Besoin en ressources', demand_sub: 'Une ligne par compétence. Les ETP sont des nombres (0,5 = une demi-personne) ; une catégorie va dans le champ effort de réalisation.', skill: 'Compétence', avg: 'ETP moyen', peak: 'ETP de pointe',
      start: 'Début (AAAA-MM)', finish: 'Fin (AAAA-MM)', sourcing: 'Interne / externe', internal: 'Interne', external_s: 'Externe', load: 'Charge mensuelle', month: 'Mois', capacity: 'Capacité ETP', util: 'Utilisation', cap_unknown: 'Capacité non configurée : aucune couleur n’est donnée (inconnu, pas vert).',
      effort: 'Score d’effort de réalisation', effort_sub: 'Sept facteurs notés de 1 (faible) à 5 (élevé). Le score suggère une tranche ; l’effort déclaré n’est jamais modifié automatiquement. Pondérations et tranches proposées.',
      score: 'Score', band: 'Tranche suggérée', declared: 'Déclaré', mismatch: 'diffère de la tranche déclarée', not_scored: 'pas de score tant que les sept facteurs ne sont pas renseignés',
      technical_complexity: 'Complexité technique', integration_complexity: 'Complexité d’intégration', procurement_complexity: 'Complexité des achats', site_impact: 'Impact sur le site', stakeholder_count: 'Nombre de parties prenantes', cross_site_coverage: 'Couverture multi-sites', change_impact: 'Impact du changement',
      docs: 'Documents', docs_sub: 'Justification, devis, conception… PDF, image, Word, Excel ou PowerPoint, 10 Mo au plus. Un second fichier de même type et même titre devient une nouvelle version. Devis, approbations budgétaires et demandes d’achat ne s’ouvrent que pour les lecteurs autorisés aux montants.',
      type: 'Type', title_: 'Titre', version: 'Version', file: 'Fichier', uploaded: 'Déposé', download: 'Télécharger', restricted: 'restreint (montants)', upload: 'Déposer', latest: 'dernière', saved: 'Enregistré.', removed: 'Retiré.', confirm_remove: 'Retirer cet élément ? Il reste dans l’historique.' },
  };
  var lang = function () { try { return root.I18nText && root.I18nText.lang && root.I18nText.lang() === 'fr' ? 'fr' : 'en'; } catch (_) { return 'en'; } };
  var t = function (k) { var l = S[lang()]; return l[k] != null ? l[k] : (S.en[k] != null ? S.en[k] : k); };
  var dash = function (v) { return v == null || v === '' ? '—' : v; };
  var base = function (x) { return '/api/governance/ppm/project/' + encodeURIComponent(x.pid); };
  var field = function (id, label, input) { return '<label class="p2-field" for="' + id + '"><span>' + label + '</span>' + input + '</label>'; };
  var opts = function (list, cur, esc, blank) { return (blank ? '<option value="">—</option>' : '') + list.map(function (v) { return '<option value="' + esc(v) + '"' + (String(cur) === String(v) ? ' selected' : '') + '>' + esc(v) + '</option>'; }).join(''); };
  function err(x, e) { x.msg((e && e.message) || 'Error', 'err'); }
  function on(el, ev, fn) { if (el) el.addEventListener(ev, fn); }

  // ---- Dependencies & risk exposure ----------------------------------------------------------------------------
  function mountDeps(x) {
    var host = x.$('p2-deps'); if (!host) return; var esc = x.esc;
    Promise.all([x.api(base(x) + '/dependencies'), x.api(base(x) + '/risk-exposure').catch(function () { return null; })]).then(function (r) {
      var d = r[0], rx = r[1];
      var rows = (d.items || []).map(function (i) {
        var target = i.predecessor_project_id != null ? (i.predecessor_readable ? esc(i.predecessor_label) : '#' + esc(i.predecessor_project_id)) : esc(i.external_category);
        return '<tr><td>' + target + '</td><td>' + esc(dash(i.description)) + '</td><td>' + esc(dash(i.owner)) + '</td><td>' + esc(i.status) + '</td><td>' + esc(dash(i.target_date)) + '</td><td>' + esc(dash(i.criticality)) + '</td><td>' + esc(i.flags.join(', ') || '—') + '</td><td>' + (i.source === 'legacy' ? esc(t('legacy')) : '') + '</td><td>' + (i.id != null ? '<button type="button" class="p2-btn" data-del-dep="' + esc(i.id) + '">' + esc(t('remove')) + '</button>' : '') + '</td></tr>';
      }).join('');
      var form = '<form id="p2-dep-form" class="p2-form">' + field('p2-dep-pred', esc(t('on_project')), '<select id="p2-dep-pred"><option value="">—</option>' + (d.projects || []).map(function (p) { return '<option value="' + esc(p.id) + '">' + esc(p.label) + '</option>'; }).join('') + '</select>') +
        field('p2-dep-ext', esc(t('external')), '<select id="p2-dep-ext">' + opts(d.categories || [], '', esc, true) + '</select>') + field('p2-dep-desc', esc(t('description')), '<input id="p2-dep-desc" maxlength="2000">') +
        field('p2-dep-owner', esc(t('owner')), '<input id="p2-dep-owner" maxlength="120">') + field('p2-dep-status', esc(t('status')), '<select id="p2-dep-status">' + opts(d.statuses || [], 'open', esc) + '</select>') +
        field('p2-dep-date', esc(t('target')), '<input id="p2-dep-date" type="date">') + field('p2-dep-crit', esc(t('criticality')), '<select id="p2-dep-crit">' + opts(d.criticality || [], '', esc, true) + '</select>') +
        '<button type="submit" class="p2-btn">' + esc(t('add')) + '</button></form>';
      var deps = '<h2>' + esc(t('deps')) + '</h2><p class="p2-note">' + esc(t('deps_sub')) + '</p>' + (d.in_cycle ? '<p class="p2-warn" role="alert">' + esc(t('loop')) + '</p>' : '') +
        (rows ? '<table class="p2-table"><caption class="p2-sr">' + esc(t('deps')) + '</caption><thead><tr><th scope="col">' + [t('on_project') + ' / ' + t('external'), t('description'), t('owner'), t('status'), t('target'), t('criticality'), t('flags'), t('source'), ''].map(esc).join('</th><th scope="col">') + '</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="p2-note">' + esc(t('none')) + '</p>') + form +
        ((d.dependents || []).length ? '<h3>' + esc(t('dependents')) + '</h3><ul>' + d.dependents.map(function (p) { return '<li>' + esc(p.label || ('#' + p.project_id)) + ' — ' + esc(p.status) + '</li>'; }).join('') + '</ul>' : '');
      var risks = '';
      if (rx) {
        var rr = (rx.items || []).filter(function (i) { return i.kind !== 'assumption'; }).map(function (i) {
          return '<tr><td>' + esc(i.title) + '</td><td>' + esc(dash(i.exposure)) + '</td><td>' + esc(dash(i.residual_exposure)) + '</td><td>' + esc(dash(i.due_date)) + (i.overdue ? ' <strong>' + esc(t('overdue')) + '</strong>' : '') + '</td><td>' + esc(i.status) +
            '</td><td><label class="p2-sr" for="p2-rp-' + esc(i.id) + '">' + esc(t('rp')) + '</label><select id="p2-rp-' + esc(i.id) + '">' + opts([1, 2, 3], i.residual_probability, esc, true) + '</select> <label class="p2-sr" for="p2-ri-' + esc(i.id) + '">' + esc(t('ri')) + '</label><select id="p2-ri-' + esc(i.id) + '">' + opts([1, 2, 3], i.residual_impact, esc, true) + '</select> <label class="p2-sr" for="p2-rd-' + esc(i.id) + '">' + esc(t('due')) + '</label><input type="date" id="p2-rd-' + esc(i.id) + '" value="' + esc(i.due_date || '') + '"> <button type="button" class="p2-btn" data-res="' + esc(i.id) + '">' + esc(t('save')) + '</button></td></tr>';
        }).join('');
        risks = '<h2>' + esc(t('risks')) + '</h2><p class="p2-note">' + esc(t('risks_sub')) + '</p><p>' + esc(t('project_level')) + ': <strong>' + esc(dash(rx.level)) + '</strong> · ' + esc(rx.open) + ' open · ' + esc(rx.overdue) + ' ' + esc(t('overdue')) + '</p>' +
          (rr ? '<table class="p2-table"><caption class="p2-sr">' + esc(t('risks')) + '</caption><thead><tr><th scope="col">' + [t('risk'), t('exposure'), t('residual'), t('due'), t('status'), t('residual')].map(esc).join('</th><th scope="col">') + '</th></tr></thead><tbody>' + rr + '</tbody></table>' : '<p class="p2-note">' + esc(t('none')) + '</p>');
      }
      host.innerHTML = '<div class="p2-panel">' + deps + risks + '</div>';
      on(x.$('p2-dep-form'), 'submit', function (ev) {
        ev.preventDefault();
        var b = { predecessor_project_id: x.$('p2-dep-pred').value || null, external_category: x.$('p2-dep-ext').value || null, description: x.$('p2-dep-desc').value, owner: x.$('p2-dep-owner').value, status: x.$('p2-dep-status').value, target_date: x.$('p2-dep-date').value || null, criticality: x.$('p2-dep-crit').value || null };
        x.api(base(x) + '/dependencies', { method: 'POST', body: JSON.stringify(b) }).then(function () { x.msg(t('saved')); mountDeps(x); }).catch(function (e) { err(x, e); });
      });
      host.querySelectorAll('[data-del-dep]').forEach(function (btn) { on(btn, 'click', function () { if (!root.confirm(t('confirm_remove'))) return; x.api(base(x) + '/dependencies/' + encodeURIComponent(btn.getAttribute('data-del-dep')), { method: 'DELETE' }).then(function () { x.msg(t('removed')); mountDeps(x); }).catch(function (e) { err(x, e); }); }); });
      host.querySelectorAll('[data-res]').forEach(function (btn) { on(btn, 'click', function () { var id = btn.getAttribute('data-res'); x.api(base(x) + '/risks/' + encodeURIComponent(id) + '/residual', { method: 'PUT', body: JSON.stringify({ residual_probability: x.$('p2-rp-' + id).value || null, residual_impact: x.$('p2-ri-' + id).value || null, due_date: x.$('p2-rd-' + id).value || null }) }).then(function () { x.msg(t('saved')); mountDeps(x); }).catch(function (e) { err(x, e); }); }); });
    }).catch(function (e) { err(x, e); });
  }

  // ---- Resources: demand lines + monthly load (+ effort score) ---------------------------------------------------------
  function mountDemand(x, feat) {
    var host = x.$('p2-demand'); if (!host) return; var esc = x.esc;
    Promise.all([x.api(base(x) + '/demand'), feat && feat.effort_scoring ? x.api(base(x) + '/effort').catch(function () { return null; }) : Promise.resolve(null)]).then(function (r) {
      var d = r[0], ef = r[1];
      var rows = (d.lines || []).map(function (l) { return '<tr><td>' + esc(l.skill) + '</td><td class="p2-num">' + esc(dash(l.avg_fte)) + '</td><td class="p2-num">' + esc(dash(l.peak_fte)) + '</td><td>' + esc(dash(l.start_month)) + '</td><td>' + esc(dash(l.finish_month)) + '</td><td>' + esc(dash(l.sourcing)) + '</td><td>' + esc(dash(l.owner)) + '</td><td><button type="button" class="p2-btn" data-del-dem="' + esc(l.id) + '">' + esc(t('remove')) + '</button></td></tr>'; }).join('');
      var cells = ((d.load && d.load.cells) || []).map(function (c) { return '<tr><td>' + esc(c.skill) + '</td><td>' + esc(c.month) + '</td><td class="p2-num">' + esc(c.avg_fte) + '</td><td class="p2-num">' + esc(dash(c.capacity_fte)) + '</td><td class="p2-num">' + esc(c.utilisation_pct == null ? '—' : c.utilisation_pct + ' %') + '</td><td><span class="p2-rag p2-' + esc(c.rag) + '">' + esc(c.rag) + '</span></td></tr>'; }).join('');
      var form = '<form id="p2-dem-form" class="p2-form">' + field('p2-dem-skill', esc(t('skill')), '<input id="p2-dem-skill" maxlength="120" required>') + field('p2-dem-avg', esc(t('avg')), '<input id="p2-dem-avg" type="number" min="0" max="100" step="0.1" inputmode="decimal">') +
        field('p2-dem-peak', esc(t('peak')), '<input id="p2-dem-peak" type="number" min="0" max="100" step="0.1" inputmode="decimal">') + field('p2-dem-start', esc(t('start')), '<input id="p2-dem-start" type="month">') + field('p2-dem-finish', esc(t('finish')), '<input id="p2-dem-finish" type="month">') +
        field('p2-dem-src', esc(t('sourcing')), '<select id="p2-dem-src"><option value="">—</option><option value="internal">' + esc(t('internal')) + '</option><option value="external">' + esc(t('external_s')) + '</option></select>') + field('p2-dem-owner', esc(t('owner')), '<input id="p2-dem-owner" maxlength="120">') +
        '<button type="submit" class="p2-btn">' + esc(t('add')) + '</button></form>';
      var html = '<h2>' + esc(t('demand')) + '</h2><p class="p2-note">' + esc(t('demand_sub')) + '</p>' +
        (rows ? '<table class="p2-table"><caption class="p2-sr">' + esc(t('demand')) + '</caption><thead><tr><th scope="col">' + [t('skill'), t('avg'), t('peak'), t('start'), t('finish'), t('sourcing'), t('owner'), ''].map(esc).join('</th><th scope="col">') + '</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="p2-note">' + esc(t('none')) + '</p>') + form +
        '<h3>' + esc(t('load')) + '</h3>' + (d.capacity_configured ? '' : '<p class="p2-note">' + esc(t('cap_unknown')) + '</p>') +
        (cells ? '<table class="p2-table"><caption class="p2-sr">' + esc(t('load')) + '</caption><thead><tr><th scope="col">' + [t('skill'), t('month'), t('avg'), t('capacity'), t('util'), 'RAG'].map(esc).join('</th><th scope="col">') + '</th></tr></thead><tbody>' + cells + '</tbody></table>' : '');
      if (ef) {
        html += '<h2>' + esc(t('effort')) + '</h2><p class="p2-note">' + esc(t('effort_sub')) + '</p><p>' + esc(t('score')) + ': <strong>' + esc(ef.score == null ? '—' : ef.score) + '</strong> · ' + esc(t('band')) + ': <strong>' + esc(dash(ef.band)) + '</strong> · ' + esc(t('declared')) + ': ' + esc(dash(ef.declared)) + (ef.mismatch ? ' — <strong>' + esc(t('mismatch')) + '</strong>' : '') + (ef.score == null ? ' <span class="p2-note">(' + esc(t('not_scored')) + ')</span>' : '') + '</p>' +
          '<form id="p2-eff-form" class="p2-form">' + (ef.factor_keys || []).map(function (k) { return field('p2-eff-' + k, esc(t(k)), '<select id="p2-eff-' + k + '">' + opts([1, 2, 3, 4, 5], ef.factors && ef.factors[k], esc, true) + '</select>'); }).join('') + '<button type="submit" class="p2-btn">' + esc(t('save')) + '</button></form>';
      }
      host.innerHTML = '<div class="p2-panel">' + html + '</div>';
      on(x.$('p2-dem-form'), 'submit', function (ev) {
        ev.preventDefault();
        var b = { skill: x.$('p2-dem-skill').value, avg_fte: x.$('p2-dem-avg').value === '' ? null : Number(x.$('p2-dem-avg').value), peak_fte: x.$('p2-dem-peak').value === '' ? null : Number(x.$('p2-dem-peak').value), start_month: x.$('p2-dem-start').value || null, finish_month: x.$('p2-dem-finish').value || null, sourcing: x.$('p2-dem-src').value || null, owner: x.$('p2-dem-owner').value };
        x.api(base(x) + '/demand', { method: 'POST', body: JSON.stringify(b) }).then(function () { x.msg(t('saved')); mountDemand(x, feat); }).catch(function (e) { err(x, e); });
      });
      on(x.$('p2-eff-form'), 'submit', function (ev) {
        ev.preventDefault(); var f = {}; (ef.factor_keys || []).forEach(function (k) { var v = x.$('p2-eff-' + k).value; f[k] = v === '' ? null : Number(v); });
        x.api(base(x) + '/effort', { method: 'PUT', body: JSON.stringify({ factors: f }) }).then(function () { x.msg(t('saved')); mountDemand(x, feat); }).catch(function (e) { err(x, e); });
      });
      host.querySelectorAll('[data-del-dem]').forEach(function (btn) { on(btn, 'click', function () { if (!root.confirm(t('confirm_remove'))) return; x.api(base(x) + '/demand/' + encodeURIComponent(btn.getAttribute('data-del-dem')), { method: 'DELETE' }).then(function () { x.msg(t('removed')); mountDemand(x, feat); }).catch(function (e) { err(x, e); }); }); });
    }).catch(function (e) { err(x, e); });
  }

  // ---- Documents ---------------------------------------------------------------------------------------------------
  function mountDocs(x) {
    var host = x.$('p2-docs'); if (!host) return; var esc = x.esc;
    x.api(base(x) + '/documents').then(function (d) {
      var rows = (d.documents || []).map(function (r) {
        return '<tr><td>' + esc(r.doc_type) + '</td><td>' + esc(r.title) + '</td><td>v' + esc(r.version) + (r.latest ? ' <small>(' + esc(t('latest')) + ')</small>' : '') + '</td><td class="p2-num">' + esc(Math.ceil(r.size_bytes / 1024)) + ' KB</td><td>' + esc(dash(r.uploaded_by_name)) + ' · ' + esc(dash((r.uploaded_at || '').slice(0, 10))) + '</td><td>' +
          (r.download ? '<a class="p2-btn" href="' + esc(base(x) + '/documents/' + encodeURIComponent(r.id) + '/download') + '">' + esc(t('download')) + '</a>' : esc(t('restricted'))) + ' <button type="button" class="p2-btn" data-del-doc="' + esc(r.id) + '">' + esc(t('remove')) + '</button></td></tr>';
      }).join('');
      host.innerHTML = '<div class="p2-panel"><h2>' + esc(t('docs')) + '</h2><p class="p2-note">' + esc(t('docs_sub')) + '</p>' +
        (rows ? '<table class="p2-table"><caption class="p2-sr">' + esc(t('docs')) + '</caption><thead><tr><th scope="col">' + [t('type'), t('title_'), t('version'), t('file'), t('uploaded'), ''].map(esc).join('</th><th scope="col">') + '</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p class="p2-note">' + esc(t('none')) + '</p>') +
        '<form id="p2-doc-form" class="p2-form">' + field('p2-doc-type', esc(t('type')), '<select id="p2-doc-type" required>' + opts(d.types || [], '', esc, true) + '</select>') + field('p2-doc-title', esc(t('title_')), '<input id="p2-doc-title" minlength="3" maxlength="200" required>') +
        field('p2-doc-file', esc(t('file')), '<input id="p2-doc-file" type="file" required accept="' + esc((d.mimes || []).join(',')) + '">') + '<button type="submit" class="p2-btn">' + esc(t('upload')) + '</button></form></div>';
      on(x.$('p2-doc-form'), 'submit', function (ev) {
        ev.preventDefault(); var f = x.$('p2-doc-file').files && x.$('p2-doc-file').files[0]; if (!f) return;
        var q = '?doc_type=' + encodeURIComponent(x.$('p2-doc-type').value) + '&title=' + encodeURIComponent(x.$('p2-doc-title').value);
        x.api(base(x) + '/documents' + q, { method: 'POST', headers: { 'content-type': f.type || 'application/octet-stream' }, body: f }).then(function () { x.msg(t('saved')); mountDocs(x); }).catch(function (e) { err(x, e); });
      });
      host.querySelectorAll('[data-del-doc]').forEach(function (btn) { on(btn, 'click', function () { if (!root.confirm(t('confirm_remove'))) return; x.api(base(x) + '/documents/' + encodeURIComponent(btn.getAttribute('data-del-doc')), { method: 'DELETE' }).then(function () { x.msg(t('removed')); mountDocs(x); }).catch(function (e) { err(x, e); }); }); });
    }).catch(function (e) { err(x, e); });
  }

  root.PpmPhase2 = { mountDeps: mountDeps, mountDemand: mountDemand, mountDocs: mountDocs, S: S };
  if (typeof module === 'object' && module.exports) module.exports = root.PpmPhase2;
})(typeof window !== 'undefined' ? window : globalThis);
