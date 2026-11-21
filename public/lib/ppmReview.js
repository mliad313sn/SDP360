/* PORTFOLIO LOT 5 — the review panel of the Gates tab on public/project.html (switch ppm_review_workflow_enabled; the
 * panel stays hidden while it is off). Shows the review requester, the assigned reviewers per step, the information
 * requests (with their answers) and the returns for correction, and offers the actions the server allows this user:
 * assign a reviewer (committee), request information (committee / assigned reviewer), answer (owner / committee),
 * return for correction (committee), apply the PROPOSED six-step review checklist (committee). The server is the
 * enforcement point (self-approval, provenance, roles); a refusal is shown with its code. Texts: own EN/FR table,
 * language = the page language (I18nText). No inline script, tokens only (existing .panel / .btn / .muted classes).
 */
(function (root) {
  'use strict';
  var S = {
    en: { title: 'Review workflow', proposed: 'Review steps and role mapping are proposed, not approved policy. A recorded decision is a session identity, not a legal signature.',
      requester: 'Submitted for review by', unknown: 'not recorded — the committee must return the project and it must be submitted again before any decision',
      reviewers: 'Assigned reviewers', none: 'None yet.', requests: 'Information requests', open: 'open', answered: 'answered', returns: 'Returns for correction',
      step: 'Step', user_id: 'Reviewer user id', reviewer: 'Reviewer', pick: '— choose a person —', confirm_template: 'Apply the proposed review checklist to this project?', assign: 'Assign reviewer', question: 'Question (10 characters or more)', ask: 'Request information',
      answer: 'Answer', respond: 'Send answer', reason: 'Reason (10 characters or more)', ret: 'Return for correction', template: 'Apply the proposed review checklist',
      done: 'Saved.', confirm_return: 'Return this project for correction?', step_general: 'General', unavailable: 'Review workflow unavailable.' },
    fr: { title: 'Circuit de revue', proposed: 'Les étapes de revue et la correspondance des rôles sont proposées, pas une politique approuvée. Une décision enregistrée est une identité de session, pas une signature légale.',
      requester: 'Soumis à la revue par', unknown: 'non enregistré — le comité doit renvoyer le projet et il doit être soumis à nouveau avant toute décision',
      reviewers: 'Réviseurs désignés', none: 'Aucun pour l’instant.', requests: 'Demandes d’information', open: 'ouverte', answered: 'répondue', returns: 'Renvois pour correction',
      step: 'Étape', user_id: 'Identifiant du réviseur', reviewer: 'Réviseur', pick: '— choisir une personne —', confirm_template: 'Appliquer la liste de revue proposée à ce projet ?', assign: 'Désigner le réviseur', question: 'Question (10 caractères ou plus)', ask: 'Demander une information',
      answer: 'Réponse', respond: 'Envoyer la réponse', reason: 'Motif (10 caractères ou plus)', ret: 'Renvoyer pour correction', template: 'Appliquer la liste de revue proposée',
      done: 'Enregistré.', confirm_return: 'Renvoyer ce projet pour correction ?', step_general: 'Général', unavailable: 'Circuit de revue indisponible.' },
  };
  var lang = function () { try { return root.I18nText && root.I18nText.lang && root.I18nText.lang() === 'fr' ? 'fr' : 'en'; } catch (_) { return 'en'; } };
  var t = function (k) { var l = S[lang()]; return l[k] != null ? l[k] : S.en[k]; };
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function stepLabel(R, k) { if (k === 'general') return t('step_general'); var s = (R.steps || []).filter(function (x) { return x.key === k; })[0]; return s ? (lang() === 'fr' ? s.label_fr : s.label) : k; }
  function stepSelect(R, id) { return '<select id="' + id + '">' + ['general'].concat((R.steps || []).map(function (s) { return s.key; })).map(function (k) { return '<option value="' + esc(k) + '">' + esc(stepLabel(R, k)) + '</option>'; }).join('') + '</select>'; }

  // P11 r5 F-19 — the committee picks a person by name (the server sends the eligible accounts); a raw id input
  // remains only when the list is absent
  function reviewerControl(R) {
    if (!Array.isArray(R.candidates)) return '<label>' + esc(t('user_id')) + ' <input id="rv-as-user" type="number" min="1"></label>';
    return '<label>' + esc(t('reviewer')) + ' <select id="rv-as-user"><option value="">' + esc(t('pick')) + '</option>' + R.candidates.map(function (c) {
      return '<option value="' + esc(c.id) + '">' + esc(c.name) + (c.role ? ' (' + esc(c.role) + ')' : '') + '</option>'; }).join('') + '</select></label>';
  }

  function render(ctx, host, R) {
    var who = R.requester ? (esc(R.requester.name || '—') + (R.requester.known ? '' : ' (' + esc(t('unknown')) + ')')) : esc(t('unknown'));
    var h = '<h2>' + esc(t('title')) + '</h2><p class="muted">' + esc(t('proposed')) + '</p><p>' + esc(t('requester')) + ' : ' + who + '</p>';
    h += '<h3>' + esc(t('reviewers')) + '</h3>' + (R.reviewers.length ? '<ul>' + R.reviewers.map(function (r) { return '<li>' + esc(stepLabel(R, r.step)) + ' — ' + esc(r.name || ('#' + r.user_id)) + '</li>'; }).join('') + '</ul>' : '<p class="muted">' + esc(t('none')) + '</p>');
    h += '<h3>' + esc(t('requests')) + '</h3>' + (R.requests.length ? '<ul>' + R.requests.map(function (q) {
      var ans = q.answer != null ? '<div class="muted">' + esc(t('answer')) + ' : ' + esc(q.answer) + ' — ' + esc(q.answered_by || '') + '</div>'
        : (R.can_respond ? '<div class="bar ppm-form-line"><label>' + esc(t('answer')) + ' <input id="rv-ans-' + q.id + '" maxlength="4000"></label> <button type="button" class="btn" data-rv="respond" data-req="' + q.id + '">' + esc(t('respond')) + '</button></div>' : '');
      return '<li>' + esc(stepLabel(R, q.step)) + ' — ' + esc(q.question) + ' <small class="muted">(' + esc(q.by || '') + ', ' + esc(q.answer != null ? t('answered') : t('open')) + ')</small>' + ans + '</li>'; }).join('') + '</ul>' : '<p class="muted">' + esc(t('none')) + '</p>');
    if (R.returns.length) h += '<h3>' + esc(t('returns')) + '</h3><ul>' + R.returns.map(function (r) { return '<li>' + esc(String(r.at || '').slice(0, 10)) + ' — ' + esc(r.reason) + ' <small class="muted">(' + esc(r.by || '') + ')</small></li>'; }).join('') + '</ul>';
    if (R.can_assign) h += '<div class="bar ppm-form-line"><label>' + esc(t('step')) + ' ' + stepSelect(R, 'rv-as-step') + '</label> ' + reviewerControl(R) + ' <button type="button" class="btn" data-rv="assign">' + esc(t('assign')) + '</button></div>';
    if (R.can_request) h += '<div class="bar ppm-form-line"><label>' + esc(t('step')) + ' ' + stepSelect(R, 'rv-q-step') + '</label> <label>' + esc(t('question')) + ' <input id="rv-q-text" maxlength="2000"></label> <button type="button" class="btn" data-rv="ask">' + esc(t('ask')) + '</button></div>';
    if (R.can_return) h += '<div class="bar ppm-form-line"><label>' + esc(t('reason')) + ' <input id="rv-ret-reason" maxlength="2000"></label> <button type="button" class="btn" data-rv="return">' + esc(t('ret')) + '</button> <button type="button" class="btn" data-rv="template">' + esc(t('template')) + '</button></div>';
    host.innerHTML = h;
  }

  function mount(ctx) {
    var host = ctx.$('review-panel'); if (!host || !ctx.V()) return;
    var pid = ctx.V().project.id, base = '/api/governance/portfolio/project/' + encodeURIComponent(pid) + '/review';
    var load = function () { return ctx.api(base).then(function (R) { host.hidden = false; render(ctx, host, R); }).catch(function (e) { if (e && e.status === 404) { host.hidden = true; return; } host.hidden = false; host.textContent = t('unavailable'); }); };
    var post = function (path, body) { return ctx.api(base + path, { method: 'POST', body: JSON.stringify(body) }).then(function () { ctx.msg(t('done')); return path === '/return' ? ctx.reload() : load(); }).catch(ctx.fail); };
    if (!host.__rvBound) {
      host.__rvBound = true;
      host.addEventListener('click', function (ev) {
        var b = ev.target.closest && ev.target.closest('button[data-rv]'); if (!b) return;
        var a = b.getAttribute('data-rv'), v = function (id) { var el = ctx.$(id); return el ? el.value.trim() : ''; };
        if (a === 'assign') { if (!v('rv-as-user')) return; post('/assign', { step: v('rv-as-step'), user_id: Number(v('rv-as-user')) }); }
        else if (a === 'ask') post('/request-info', { step: v('rv-q-step'), question: v('rv-q-text') });
        else if (a === 'respond') post('/respond', { request_id: Number(b.getAttribute('data-req')), answer: v('rv-ans-' + b.getAttribute('data-req')) });
        else if (a === 'return') { if (root.confirm && !root.confirm(t('confirm_return'))) return; post('/return', { reason: v('rv-ret-reason') }); }
        else if (a === 'template') { if (root.confirm && !root.confirm(t('confirm_template'))) return; post('/apply-template', {}); }
      });
    }
    load();
  }

  root.PpmReview = { mount: mount, STRINGS: S };
})(typeof window !== 'undefined' ? window : globalThis);
