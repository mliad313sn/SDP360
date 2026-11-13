/* C-18 — "My access" screen: My access · Requests · Approvals · Templates · Qualifications (C-19) · Emergency (C-22). Talks only to /api/access/*.
 * The server is the enforcement point (self-approval, deputies, template immutability); this page only shows. */
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
    en: { role: 'Role', site: 'Site', from: 'From', until: 'Until', request: 'Request', status: 'Status', who: 'For', roles: 'Roles', sites: 'Sites', why: 'Justification',
      none: 'Nothing here.', direct: 'Roles held without a grant were given directly by an administrator (no end date).', expiring: 'ends within 14 days',
      approve: 'Approve', reject: 'Reject', review: 'Take for review', revoke: 'Revoke', withdraw: 'Withdraw', publish: 'Publish', retire: 'Retire', newVersion: 'New version',
      reason: 'Reason (kept in the history):', sent: 'Request sent.', done: 'Done.', deputies: 'Deputies', deputyFor: 'stands in for', version: 'version', draft: 'draft', published: 'published',
      holder: 'Person', kind: 'Kind', issuer: 'Issuer', expires: 'Expires', ref: 'Evidence', state: 'State', verify: 'Verify', valid: 'valid', expired: 'expired', unverified: 'not verified', ended: 'ended',
      granted: 'Granted by', due: 'Review due', live: 'in force', overdue: 'review overdue', reviewed: 'reviewed', reviewBtn: 'Record the review', outcome: 'Outcome: type justified or not_justified', notes: 'Review notes (10+ characters):', source: 'Source',
      line: 'Line', account: 'Account', approver: 'Approver', answer: 'Answer', keep: 'Keep', unknownA: 'Unknown', noApprover: 'no eligible approver — UNKNOWN', campaign: 'Campaign', progress: 'Progress',
      open: 'Show lines', close: 'Close', reasonRc: 'Reason (5+ characters):', recorded: 'Recorded (not applied — applying is off).', lastLogin: 'Last sign-in', why2: 'Why',
      loginUnknown: 'No sign-in evidence (UNKNOWN, not counted as idle):', tplUnknown: 'No published access template: the "role no template grants" check is UNKNOWN.' },
    fr: { role: 'Rôle', site: 'Site', from: 'Du', until: 'Au', request: 'Demande', status: 'Statut', who: 'Pour', roles: 'Rôles', sites: 'Sites', why: 'Justification',
      none: 'Rien ici.', direct: 'Les rôles sans attribution ont été donnés directement par un administrateur (sans date de fin).', expiring: 'se termine dans les 14 jours',
      approve: 'Approuver', reject: 'Refuser', review: 'Prendre en revue', revoke: 'Révoquer', withdraw: 'Retirer', publish: 'Publier', retire: 'Retirer le modèle', newVersion: 'Nouvelle version',
      reason: 'Motif (conservé dans l\'historique) :', sent: 'Demande envoyée.', done: 'Fait.', deputies: 'Suppléances', deputyFor: 'remplace', version: 'version', draft: 'brouillon', published: 'publiée',
      holder: 'Personne', kind: 'Type', issuer: 'Émetteur', expires: 'Expire', ref: 'Preuve', state: 'État', verify: 'Vérifier', valid: 'valide', expired: 'expirée', unverified: 'non vérifiée', ended: 'close',
      granted: 'Accordé par', due: 'Revue due le', live: 'en vigueur', overdue: 'revue en retard', reviewed: 'revu', reviewBtn: 'Enregistrer la revue', outcome: 'Conclusion : tapez justified ou not_justified', notes: 'Notes de revue (10 caractères et plus) :', source: 'Origine',
      line: 'Ligne', account: 'Compte', approver: 'Approbateur', answer: 'Réponse', keep: 'Conserver', unknownA: 'Inconnu', noApprover: 'aucun approbateur éligible — INCONNU', campaign: 'Campagne', progress: 'Avancement',
      open: 'Voir les lignes', close: 'Clore', reasonRc: 'Motif (5 caractères et plus) :', recorded: 'Enregistré (non appliqué — l\'application est désactivée).', lastLogin: 'Dernière connexion', why2: 'Pourquoi',
      loginUnknown: 'Aucune preuve de connexion (INCONNU, non compté comme inactif) :', tplUnknown: 'Aucun modèle d\'accès publié : le contrôle « rôle accordé par aucun modèle » est INCONNU.' },
  };
  const t = () => L[lang === 'fr' ? 'fr' : 'en'];
  const msg = (x, ok) => { $('axMsg').className = 'ax-msg ' + (ok ? 'ax-ok' : 'ax-err'); $('axMsg').textContent = !ok && lang === 'fr' && window.ErrorText ? window.ErrorText.fr(x) : x; };
  const list = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean);
  let me = null;

  function table(head, rows) {
    if (!rows.length) return '<p class="ax-muted">' + esc(t().none) + '</p>';
    return '<table><thead><tr>' + head.map((h) => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + rows.join('') + '</tbody></table>';
  }
  function reqRow(r, actions) {
    return '<tr><td>#' + r.id + '</td><td>' + esc(r.subject_user_id) + '</td><td>' + esc((r.roles || []).join(', ')) + '</td><td>' + esc((r.site_ids || []).join(', ')) +
      '</td><td>' + esc(r.valid_from) + ' → ' + esc(r.valid_to) + '</td><td><span class="ax-tag">' + esc(r.status) + '</span></td><td>' + esc(r.justification) + '</td><td>' +
      actions.map((a) => '<button type="button" data-act="' + a + '" data-id="' + r.id + '">' + esc(t()[a === 'revoke' && ['REQUESTED', 'REVIEWING'].includes(r.status) ? 'withdraw' : a]) + '</button> ').join('') + '</td></tr>';
  }
  const reqHead = () => [t().request, t().who, t().roles, t().sites, t().from + ' → ' + t().until, t().status, t().why, ''];

  // A6 (P6) — the hub only shows links; every target page / route keeps its own guard (presentation grants nothing)
  function renderHub(m) {
    const hub = (m && m.hub) || {};
    $('axHubSessionsLink').hidden = !hub.sessions_href; $('axHubSessionsNone').hidden = !!hub.sessions_href;
    if (hub.sessions_href) $('axHubSessionsLink').setAttribute('href', hub.sessions_href);
    if (hub.deputies_href) $('axHubDeputiesLink').setAttribute('href', hub.deputies_href);
    $('axHubEmergencyLink').hidden = !hub.emergency; $('axHubEmergencyNone').hidden = !!hub.emergency;
  }
  document.addEventListener('click', (ev) => { const a = ev.target.closest && ev.target.closest('[data-tab-link]'); if (!a) return; ev.preventDefault();
    const b = document.querySelector('[data-tab="' + a.dataset.tabLink + '"]'); if (b) b.click(); });
  async function load() {
    me = await api('GET', '/api/access/me');
    const soon = new Set((me.expiring_soon || []).map((g) => g.id));
    $('axMe').innerHTML = '<p>' + esc(t().roles) + ': <strong>' + esc((me.user.roles || []).join(', ') || '—') + '</strong></p>' +
      table([t().role + ' / ' + t().site, t().request, t().from, t().until], (me.grants || []).map((g) => '<tr><td>' + esc(g.role || ('site ' + g.site_id)) + '</td><td>#' + g.request_id +
        '</td><td>' + esc(g.valid_from) + '</td><td>' + esc(g.valid_to) + (soon.has(g.id) ? ' <span class="ax-tag">' + esc(t().expiring) + '</span>' : '') + '</td></tr>')) +
      '<p class="ax-muted">' + esc(t().direct) + '</p><h2>' + esc(t().deputies) + '</h2>' +
      table(['', t().from, t().until], (me.deputies || []).map((d) => '<tr><td>' + esc(d.deputy_id) + ' ' + esc(t().deputyFor) + ' ' + esc(d.user_id) + '</td><td>' + esc(d.start_date) + '</td><td>' + esc(d.end_date) + '</td></tr>'));
    renderHub(me);
    $('axReqs').innerHTML = table(reqHead(), (me.requests || []).map((r) => reqRow(r, ['REQUESTED', 'REVIEWING'].includes(r.status) && Number(r.requested_by) === Number(me.user.id) ? ['revoke'] : [])));
    const appr = await api('GET', '/api/access/approvals');
    $('axAppr').innerHTML = table(reqHead(), (appr.requests || []).map((r) => reqRow(r, r.status === 'REQUESTED' ? ['review', 'approve', 'reject'] : ['approve', 'reject'])));
    const tp = await api('GET', '/api/access/templates');
    const sel = $('axTpl'); const keep = sel.value; sel.length = 1;
    for (const x of tp.templates || []) if (x.current && !x.retired_at) sel.add(new Option((lang === 'fr' ? x.title_fr : x.title_en) + ' (v' + x.current.version + ')', x.current.id));
    sel.value = keep;
    $('axTplForm').hidden = !me.can_manage_templates;
    $('axTpls').innerHTML = table(['key', t().version, t().roles, t().status, ''], (tp.templates || []).flatMap((x) => (x.versions || []).map((v) => '<tr><td>' + esc(x.key) + (x.retired_at ? ' <span class="ax-tag">retired</span>' : '') +
      '</td><td>' + v.version + '</td><td>' + esc((v.payload.roles || []).join(', ')) + '</td><td>' + esc(t()[v.status] || v.status) + '</td><td>' +
      (me.can_manage_templates && v.status === 'draft' ? '<button type="button" data-tplact="publish" data-id="' + v.id + '">' + esc(t().publish) + '</button>' : '') +
      (me.can_manage_templates && !x.retired_at ? ' <button type="button" data-tplact="retire" data-id="' + x.id + '">' + esc(t().retire) + '</button>' : '') + '</td></tr>')));
    await loadQuals();
    await loadEmergencies();
    await loadRecert().catch(() => { $('axRcTab').hidden = true; });
  }
  async function loadQuals() {
    const [k, q] = await Promise.all([api('GET', '/api/qualifications/kinds'), api('GET', '/api/qualifications')]);
    const names = {}; for (const x of k.kinds || []) names[x.key] = lang === 'fr' ? x.name_fr : x.name_en;
    const ks = $('axQKind'); const keep = ks.value; ks.length = 0;
    for (const x of k.kinds || []) ks.add(new Option(names[x.key], x.key));
    if (keep) ks.value = keep;
    $('axQualForm').hidden = !q.can_record;
    const mine = Number(me && me.user.id);
    $('axQuals').innerHTML = table([t().holder, t().kind, t().issuer, t().expires, t().ref, t().state, ''], (q.records || []).map((r) => '<tr><td>' + esc(r.user_id) +
      '</td><td>' + esc(names[r.kind] || r.kind) + '</td><td>' + esc(r.issuer) + '</td><td>' + esc(r.expires_on || '—') + '</td><td>' + esc(r.evidence_ref) +
      '</td><td><span class="ax-tag">' + esc(t()[r.state] || r.state) + '</span></td><td>' +
      (q.can_record && r.status === 'recorded' && r.user_id !== mine && r.recorded_by !== mine
        ? '<button type="button" data-qact="verify" data-id="' + r.id + '">' + esc(t().verify) + '</button> <button type="button" data-qact="reject" data-id="' + r.id + '">' + esc(t().reject) + '</button>' : '') +
      (q.can_record && (r.status === 'verified' || r.status === 'recorded') ? ' <button type="button" data-qact="revoke" data-id="' + r.id + '">' + esc(t().revoke) + '</button>' : '') + '</td></tr>'));
  }

  async function loadEmergencies() {
    let r;
    if (!me || !me.emergency_enabled) { $('axEmTab').hidden = true; return; }   // C-23: off, or not a super_admin — no 403/404 request at all
    try { r = await api('GET', '/api/access/emergencies'); } catch (_) { $('axEmTab').hidden = true; return; }   // off, or not a super_admin
    $('axEmTab').hidden = false;
    const mine = Number(me && me.user.id);
    $('axEms').innerHTML = table(['#', t().holder, t().roles, t().sites, t().granted, t().until, t().due, t().state, t().source, ''], (r.emergencies || []).map((e) => '<tr><td>' + e.id +
      '</td><td>' + esc(e.subject_user_id) + '</td><td>' + esc((e.roles || []).join(', ')) + '</td><td>' + esc((e.site_ids || []).join(', ')) + '</td><td>' + esc(e.granted_by) +
      '</td><td>' + esc(e.expires_at) + '</td><td>' + esc(e.review_due) + (e.review_overdue ? ' <span class="ax-tag">' + esc(t().overdue) + '</span>' : '') +
      '</td><td><span class="ax-tag">' + esc(e.live ? t().live : t().ended) + '</span>' + (e.reviewed_at ? ' <span class="ax-tag">' + esc(t().reviewed) + ': ' + esc(e.review_outcome) + '</span>' : '') +
      '</td><td>' + esc(e.source) + '</td><td>' +
      (!e.reviewed_at && e.granted_by !== mine && e.subject_user_id !== mine ? '<button type="button" data-emrev="' + e.id + '">' + esc(t().reviewBtn) + '</button>' : '') + '</td></tr>'));
  }
  // E-S03 — access recertification (tab shown only when access_recert_enabled = '1')
  function rcLineRow(l) {
    const what = l.kind === 'role' ? t().role + ' ' + l.role : t().site + ' ' + l.site_id;
    const btns = l.answer ? '<span class="ax-tag">' + esc(l.answer) + (l.applied_at ? ' ✓' : '') + '</span>'
      : ['keep', 'revoke', 'unknown'].map((a) => '<button type="button" data-rcans="' + a + '" data-id="' + l.id + '">' + esc(a === 'unknown' ? t().unknownA : t()[a]) + '</button>').join(' ');
    return '<tr><td>#' + l.id + '</td><td>' + esc(l.username || l.user_id) + '</td><td>' + esc(what) + '</td><td>' +
      esc(l.approver_user_id == null ? t().noApprover : (l.approver_username || l.approver_user_id)) + '</td><td>' + btns + '</td></tr>';
  }
  async function loadRecert() {
    if (!me || !me.recert_enabled) { $('axRcTab').hidden = true; return; }
    $('axRcTab').hidden = false;
    const mine = await api('GET', '/api/access/recert/mine');
    $('axRcMine').innerHTML = table([t().line, t().account, t().role + ' / ' + t().site, t().approver, t().answer], (mine.lines || []).map(rcLineRow));
    if (!me.can_manage_templates) { $('axRcAdmin').hidden = true; return; }
    $('axRcAdmin').hidden = false;
    const c = await api('GET', '/api/access/recert/campaigns');
    $('axRcCamps').innerHTML = table(['#', t().campaign, t().status, t().progress, ''], (c.campaigns || []).map((x) => '<tr><td>' + x.id + '</td><td>' + esc(x.title) +
      '</td><td><span class="ax-tag">' + esc(x.status) + '</span></td><td>' + x.progress.answered + ' / ' + x.progress.total + ' · ' + esc(t().revoke) + ' ' + x.progress.revoke +
      ' · ' + esc(t().unknownA) + ' ' + x.progress.unknown + '</td><td><button type="button" data-rcopen="' + x.id + '">' + esc(t().open) + '</button>' +
      (x.status === 'open' ? ' <button type="button" data-rcclose="' + x.id + '">' + esc(t().close) + '</button>' : '') + '</td></tr>'));
    const o = await api('GET', '/api/access/recert/orphans');
    $('axRcOrphans').innerHTML = table([t().account, t().lastLogin, t().why2], (o.rows || []).map((r) => '<tr><td>' + esc(r.username) + '</td><td>' +
      esc(r.last_login_known ? r.last_login : 'UNKNOWN') + '</td><td>' + esc(r.reasons.map((x) => x.detail).join(' · ')) + '</td></tr>')) +
      '<p class="ax-muted">' + esc(t().loginUnknown) + ' ' + esc((o.last_login_unknown || []).map((x) => x.username).join(', ') || '—') + '</p>' +
      (o.templates_known ? '' : '<p class="ax-muted">' + esc(t().tplUnknown) + '</p>');
  }
  async function showCampaign(id) {
    const r = await api('GET', '/api/access/recert/campaigns/' + id);
    $('axRcLines').innerHTML = '<h2 class="ax-sub">' + esc(t().campaign) + ' #' + r.campaign.id + ' — ' + esc(r.campaign.title) + '</h2>' +
      table([t().line, t().account, t().role + ' / ' + t().site, t().approver, t().answer], (r.campaign.lines || []).map(rcLineRow));
  }
  document.addEventListener('click', async (ev) => {
    const b0 = ev.target.closest && ev.target.closest('button'); if (!b0 || !(b0.dataset.rcans || b0.dataset.rcopen || b0.dataset.rcclose)) return;
    try {
      if (b0.dataset.rcopen) return await showCampaign(b0.dataset.rcopen);
      if (b0.dataset.rcclose) { await api('POST', '/api/access/recert/campaigns/' + b0.dataset.rcclose + '/close', {}); msg(t().done, true); return await loadRecert(); }
      const reason = window.prompt(t().reasonRc); if (reason == null) return;
      const out = await api('POST', '/api/access/recert/lines/' + b0.dataset.id + '/answer', { answer: b0.dataset.rcans, reason });
      msg(out.recorded_only ? t().recorded : t().done, true); await loadRecert();
    } catch (e) { msg(e.message, false); }
  });
  $('axRcForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const body = { title: $('axRcTitle').value };
      if ($('axRcSite').value.trim()) body.scope_site_id = Number($('axRcSite').value);
      await api('POST', '/api/access/recert/campaigns', body); msg(t().done, true); await loadRecert();
    } catch (e) { msg(e.message, false); }
  });
  document.addEventListener('click', async (ev) => {
    const b = ev.target.closest && ev.target.closest('button'); if (!b) return;
    try {
      if (b.dataset.tab) {
        document.querySelectorAll('[role="tab"]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
        document.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.tab; });
      } else if (b.dataset.act) {
        const needs = b.dataset.act === 'reject' || b.dataset.act === 'revoke';
        const reason = needs || b.dataset.act === 'approve' ? window.prompt(t().reason) : '';
        if (reason == null) return;
        await api('POST', '/api/access/requests/' + b.dataset.id + '/' + b.dataset.act, { reason }); msg(t().done, true); await load();
      } else if (b.dataset.qact) {
        const reason = b.dataset.qact === 'verify' ? '' : window.prompt(t().reason);
        if (reason == null) return;
        await api('POST', '/api/qualifications/' + b.dataset.id + '/' + b.dataset.qact, { reason }); msg(t().done, true); await loadQuals();
      } else if (b.dataset.emrev) {
        const outcome = window.prompt(t().outcome); if (outcome == null) return;
        const notes = window.prompt(t().notes); if (notes == null) return;
        await api('POST', '/api/access/emergencies/' + b.dataset.emrev + '/review', { outcome: outcome.trim(), notes }); msg(t().done, true); await loadEmergencies();
      } else if (b.dataset.tplact) {
        await api('POST', '/api/access/templates/' + (b.dataset.tplact === 'publish' ? 'versions/' + b.dataset.id + '/publish' : b.dataset.id + '/retire'), {}); msg(t().done, true); await load();
      }
    } catch (e) { msg(e.message, false); }
  });
  $('axReqForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const body = { roles: list($('axRoles').value), site_ids: list($('axSites').value).map(Number), valid_from: $('axFrom').value, valid_to: $('axTo').value, justification: $('axWhy').value };
      if ($('axTpl').value) body.template_version_id = Number($('axTpl').value);
      await api('POST', '/api/access/requests', body); msg(t().sent, true); await load();
    } catch (e) { msg(e.message, false); }
  });
  $('axTplForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      const r = await api('POST', '/api/access/templates', { key: $('axTKey').value, title_en: $('axTEn').value, title_fr: $('axTFr').value });
      await api('POST', '/api/access/templates/' + r.id + '/versions', { roles: list($('axTRoles').value) }); msg(t().done, true); await load();
    } catch (e) { msg(e.message, false); }
  });
  $('axQualForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('POST', '/api/qualifications', { user_id: Number($('axQUser').value), kind: $('axQKind').value, issuer: $('axQIssuer').value,
        issued_on: $('axQIssued').value || null, expires_on: $('axQExp').value || null, evidence_ref: $('axQRef').value });
      msg(t().done, true); await loadQuals();
    } catch (e) { msg(e.message, false); }
  });
  $('axEmForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await api('POST', '/api/access/emergencies', { subject_user_id: Number($('axEmUser').value), roles: list($('axEmRoles').value), site_ids: list($('axEmSites').value).map(Number),
        hours: Number($('axEmHours').value), reason: $('axEmWhy').value });
      msg(t().done, true); await loadEmergencies();
    } catch (e) { msg(e.message, false); }
  });
  function applyLang() { document.body.classList.toggle('lang-fr', lang === 'fr'); document.documentElement.lang = lang; $('axLang').value = lang === 'fr' ? 'fr' : 'en'; }
  $('axLang').addEventListener('change', () => { lang = $('axLang').value; try { localStorage.setItem('sdp_lang', lang); } catch (_) {} applyLang(); load().catch((e) => msg(e.message, false)); });
  // Pre-fill from the no-access page: ?role=a|b&page=x.html
  const q = new URLSearchParams(location.search);
  const role = String(q.get('role') || '').replace(/[^\w|-]/g, '').split('|').filter(Boolean);
  const today = new Date().toISOString().slice(0, 10);
  $('axFrom').value = today; $('axTo').value = new Date(Date.now() + 90 * 864e5).toISOString().slice(0, 10);
  if (role.length) {
    $('axRoles').value = role.join(', ');
    const page = String(q.get('page') || '').replace(/[^\w.-]/g, '').slice(0, 80);
    $('axWhy').value = (lang === 'fr' ? 'Accès nécessaire pour la page ' : 'Access needed for the page ') + (page || '?');
    document.querySelector('[data-tab="req"]').click();
  }
  applyLang();
  load().catch((e) => msg(e.message, false));
})();
