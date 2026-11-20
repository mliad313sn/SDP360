/* PORTFOLIO LOT 1 — "Portfolio reference lists" panel on public/portfolio.html (spec §19). Shown only to the admin
 * tier while report_config ppm_intake_register_enabled = '1' (GET /api/governance/intake/lookups answers 404 / 403
 * otherwise and the panel stays hidden). Per list: rename (EN + FR), colour (brand token), default, order (up /
 * down), retire / restore — a value is never physically deleted; a locked list (project status, decision, schedule
 * confidence) mirrors codes the application reads: relabel / recolour / reorder only. New values: code + labels.
 * Values marked proposed encode business policy nobody approved yet. Own EN/FR texts, tokens only (lib/ppmIntake.css).
 */
(function (root) {
  'use strict';
  var S = {
    en: { title: 'Portfolio reference lists', sub: 'Values used by the project intake fields. A value is retired, never deleted: projects that carry it keep it. Values marked “proposed” encode business policy that is not approved.',
      project_type: 'Project types', priority: 'Priorities', budget_status: 'Budget statuses', project_status: 'Project statuses', decision_required: 'Decision values', delivery_effort: 'Delivery effort', risk_exposure: 'Risk exposure', schedule_confidence: 'Schedule confidence',
      code: 'Code', label_en: 'English label', label_fr: 'French label', color: 'Colour', def: 'Default', used: 'Projects', state: 'State', actions: 'Actions', active: 'active', retired: 'retired', proposed: 'proposed',
      save: 'Save', retire: 'Retire', restore: 'Restore', up: 'Move up', down: 'Move down', add: 'Add a value', locked: 'Locked list: rename, recolour or reorder only.', saved: 'Saved.', none: '—' },
    fr: { title: 'Listes de référence du portefeuille', sub: 'Valeurs utilisées par les champs de la fiche projet. Une valeur est retirée, jamais supprimée : les projets qui la portent la gardent. Les valeurs marquées « proposé » traduisent une politique métier non approuvée.',
      project_type: 'Types de projet', priority: 'Priorités', budget_status: 'Statuts du budget', project_status: 'Statuts de projet', decision_required: 'Valeurs de décision', delivery_effort: 'Effort de réalisation', risk_exposure: 'Exposition au risque', schedule_confidence: 'Confiance dans le planning',
      code: 'Code', label_en: 'Libellé anglais', label_fr: 'Libellé français', color: 'Couleur', def: 'Par défaut', used: 'Projets', state: 'État', actions: 'Actions', active: 'actif', retired: 'retiré', proposed: 'proposé',
      save: 'Enregistrer', retire: 'Retirer', restore: 'Rétablir', up: 'Monter', down: 'Descendre', add: 'Ajouter une valeur', locked: 'Liste verrouillée : renommer, recolorer ou réordonner seulement.', saved: 'Enregistré.', none: '—' },
  };
  var lang = function () { try { return root.I18nText && root.I18nText.lang && root.I18nText.lang() === 'fr' ? 'fr' : 'en'; } catch (_) { return 'en'; } };
  var t = function (k) { var l = S[lang()]; return l[k] != null ? l[k] : S.en[k]; };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(p, o) {
    return fetch(p, Object.assign({ headers: o && o.body ? { 'content-type': 'application/json' } : {} }, o || {})).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) { var e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; } return j; });
    });
  }
  var host = null, DATA = null;

  function colorSel(v, dis) { return '<select data-k="color"' + dis + ' aria-label="' + esc(t('color')) + '"><option value="">' + esc(t('none')) + '</option>' + DATA.colors.map(function (c) { return '<option value="' + c + '"' + (c === v ? ' selected' : '') + '>' + c + '</option>'; }).join('') + '</select>'; }
  function rowHtml(d, v, i, n) {
    return '<tr data-domain="' + esc(d) + '" data-code="' + esc(v.code) + '"><td><code>' + esc(v.code) + '</code>' + (v.proposed ? ' <span class="in-note">(' + esc(t('proposed')) + ')</span>' : '') + '</td>' +
      '<td><input data-k="label_en" value="' + esc(v.label_en) + '" aria-label="' + esc(t('label_en')) + '"></td><td><input data-k="label_fr" value="' + esc(v.label_fr) + '" aria-label="' + esc(t('label_fr')) + '"></td>' +
      '<td>' + colorSel(v.color, '') + '</td><td><input type="checkbox" data-k="is_default"' + (v.is_default ? ' checked' : '') + (v.active ? '' : ' disabled') + ' aria-label="' + esc(t('def')) + '"></td>' +
      '<td>' + esc(v.referenced_by) + '</td><td>' + esc(v.active ? t('active') : t('retired')) + '</td><td class="in-actions">' +
      '<button type="button" class="btn" data-op="save">' + esc(t('save')) + '</button> ' +
      '<button type="button" class="btn" data-op="up"' + (i === 0 ? ' disabled' : '') + ' aria-label="' + esc(t('up') + ' ' + v.code) + '">↑</button>' +
      '<button type="button" class="btn" data-op="down"' + (i === n - 1 ? ' disabled' : '') + ' aria-label="' + esc(t('down') + ' ' + v.code) + '">↓</button> ' +
      (DATA.locked.indexOf(d) >= 0 ? '' : '<button type="button" class="btn" data-op="' + (v.active ? 'retire' : 'restore') + '">' + esc(t(v.active ? 'retire' : 'restore')) + '</button>') + '</td></tr>';
  }
  function render() {
    var h = '<div class="panel in-panel"><h2>' + esc(t('title')) + '</h2><p class="in-note">' + esc(t('sub')) + '</p>';
    DATA.domains.forEach(function (d) {
      var vals = (DATA.lookups[d] || []).slice().sort(function (a, b) { return a.sort_order - b.sort_order; });
      h += '<details><summary>' + esc(t(d)) + ' (' + vals.length + ')</summary>' + (DATA.locked.indexOf(d) >= 0 ? '<p class="in-note">' + esc(t('locked')) + '</p>' : '') +
        '<div class="scroll"><table><thead><tr><th>' + esc(t('code')) + '</th><th>' + esc(t('label_en')) + '</th><th>' + esc(t('label_fr')) + '</th><th>' + esc(t('color')) + '</th><th>' + esc(t('def')) + '</th><th>' + esc(t('used')) + '</th><th>' + esc(t('state')) + '</th><th>' + esc(t('actions')) + '</th></tr></thead><tbody>' +
        vals.map(function (v, i) { return rowHtml(d, v, i, vals.length); }).join('') + '</tbody></table></div>' +
        (DATA.locked.indexOf(d) >= 0 ? '' : '<div class="row" data-add="' + esc(d) + '"><label>' + esc(t('code')) + ' <input data-k="code" pattern="[a-z0-9][a-z0-9_]{0,39}"></label><label>' + esc(t('label_en')) + ' <input data-k="label_en"></label><label>' + esc(t('label_fr')) + ' <input data-k="label_fr"></label><label>' + esc(t('color')) + ' ' + colorSel('', '') + '</label><div class="bar"><button type="button" class="btn" data-op="add">' + esc(t('add')) + '</button></div></div>') + '</details>';
    });
    host.innerHTML = h + '<div id="intake-admin-msg" role="status" aria-live="polite" class="in-note"></div></div>';
  }
  function say(m) { var el = document.getElementById('intake-admin-msg'); if (el) el.textContent = m; }
  function reload() { return api('/api/governance/intake/lookups').then(function (j) { DATA = j; host.hidden = false; render(); }); }
  function onClick(ev) {
    var b = ev.target.closest && ev.target.closest('[data-op]'); if (!b) return;
    var op = b.getAttribute('data-op'), tr = b.closest('tr'), add = b.closest('[data-add]');
    var get = function (scope, k) { var el = scope.querySelector('[data-k="' + k + '"]'); return el ? (el.type === 'checkbox' ? (el.checked ? 1 : 0) : el.value) : undefined; };
    var p;
    if (op === 'add') { var d = add.getAttribute('data-add'); p = api('/api/governance/intake/lookups/' + encodeURIComponent(d), { method: 'PUT', body: JSON.stringify({ code: get(add, 'code'), label_en: get(add, 'label_en'), label_fr: get(add, 'label_fr'), color: get(add, 'color') || null }) }); }
    else {
      var dom = tr.getAttribute('data-domain'), code = tr.getAttribute('data-code'), base = '/api/governance/intake/lookups/' + encodeURIComponent(dom);
      if (op === 'save') p = api(base, { method: 'PUT', body: JSON.stringify({ code: code, label_en: get(tr, 'label_en'), label_fr: get(tr, 'label_fr'), color: get(tr, 'color') || null, is_default: get(tr, 'is_default') }) });
      else if (op === 'retire' || op === 'restore') p = api(base + '/' + encodeURIComponent(code) + '/' + op, { method: 'POST', body: '{}' });
      else {
        var codes = (DATA.lookups[dom] || []).slice().sort(function (a, b2) { return a.sort_order - b2.sort_order; }).map(function (v) { return v.code; });
        var i = codes.indexOf(code), j = op === 'up' ? i - 1 : i + 1; if (j < 0 || j >= codes.length) return;
        codes[i] = codes[j]; codes[j] = code;
        p = api(base + '/order', { method: 'PUT', body: JSON.stringify({ codes: codes }) });
      }
    }
    p.then(reload).then(function () { say(t('saved')); }).catch(function (e) { say(e.message); });
  }
  function mount(id) {
    host = document.getElementById(id); if (!host) return;
    host.addEventListener('click', onClick);
    reload().catch(function () { host.hidden = true; });   // 404 (switch off) / 403 (not admin tier): no panel
  }
  root.PpmIntakeAdmin = { mount: mount, STRINGS: S };
  if (root.document && root.document.currentScript && root.document.currentScript.dataset.mount) mount(root.document.currentScript.dataset.mount);
})(typeof window !== 'undefined' ? window : globalThis);
