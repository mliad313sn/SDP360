// Policy control center page (policy-center.html). No inline script (strict CSP). Language from the shell.
(function () {
  'use strict';
  let lang = 'en';
  try { lang = (window.__shell && window.__shell.shellLang && window.__shell.shellLang()) || localStorage.getItem('sdp_lang') || 'en'; } catch (_) { lang = 'en'; }
  if (lang !== 'fr') lang = 'en';
  const S = {
    en: {
      title: 'Policy control center', search: 'Search', searchPh: 'Search a rule', category: 'Category', risk: 'Risk', all: 'All', high: 'High', medium: 'Medium', low: 'Low',
      onlyDev: 'Only rules that deviate from best practice', exportJson: 'Export JSON', exportCsv: 'Export CSV', requests: 'Changes awaiting a second super_admin',
      importTitle: 'Environment profile', profile: 'Profile', dryRun: 'Dry run', applyPlan: 'Apply this plan',
      intro: 'Every rule the platform applies, in one place. Each rule starts at its best-practice default (today\'s behaviour); change it to fit a site\'s reality, with a reason. Recommendations are proposals until a human approves them. High-risk changes need a second super_admin.',
      importIntro: 'Paste a profile (the JSON export of another environment, or { "profile": { "values": {…}, "sites": { "<site id>": {…} } } }). A dry run shows what would change; nothing is applied until you confirm that exact plan. Secrets are never imported.',
      deviates: 'deviates from best practice', siteDev: 'site values differ', pending: 'awaiting approval', fourEyes: 'second person', secret: 'secret', readOnly: 'read only',
      current: 'Current', def: 'Best-practice default', rec: 'Recommendation (PROPOSED)', noRec: 'No recommendation yet', desc: 'What it does', noDesc: 'No description in the code yet.',
      frMissing: '', owner: 'Owner role (PROPOSED)', consumers: 'Affects (files that read it)', notScanned: 'Not scanned — the key name is too generic.', none: 'none found',
      scope: 'Scope', platform: 'Platform', site: 'Site', value: 'New value', save: 'Save…', reset: 'Reset to recommended…', history: 'History', siteValues: 'Per-site values',
      who: 'Who', when: 'When', from: 'From', to: 'To', why: 'Reason', approver: 'Second person', noHistory: 'No change recorded.', approve: 'Approve…', reject: 'Reject…', cancel: 'Withdraw',
      tokTitle: 'CLI operator token', tokBtn: 'Issue a token for me', tokIntro: 'For tools/ops/activate-switches.js: issue a one-time token (valid 10 minutes) for YOUR account. The tool files four-eyes changes as a request in your name; another super_admin approves them here. Never hand your token to someone else.',
      tokShown: (u, exp) => `Token for ${u}, valid once until ${exp}. It is shown only now. On the server: set SDP_OPERATOR_TOKEN to it, then run the tool with --operator-token=env.`,
      tokOk: 'operator token #{id}: issued by the server to this account (event found)', tokBad: 'operator token #{id}: NOT verifiable — {why}; approval will be refused', tokNoEv: 'no issuance event', tokNoBind: 'not issued by the server', tokAcct: 'belongs to another account',
      noReq: 'Nothing is waiting.', reasonT: 'Why this change?', reasonL: 'Reason (kept in the history)', saved: 'Saved.', pendingMsg: 'Recorded as a request — another super_admin must approve it.',
      unchanged: 'Nothing changed.', managed: 'Changed in', kpiNote: 'KPI RAG policies are changed through the KPI policy builder and adopted by the KPI committee.',
      cov: (c) => `${c.catalogued} rules catalogued (${c.report_config} configuration keys, ${c.governance} governance policies), ${c.excluded} excluded with a reason.`,
      planCols: ['Rule', 'Scope', 'Current', 'Proposed', 'Action'], applied: 'Applied', switchOff: 'The policy center is switched off (policy_center_enabled).',
      catMissing: 'The policy catalogue could not be read on this server: every rule now needs a second super_admin until the file docs/ops/policy-catalogue.json is restored.',
      scopesGlobal: 'Platform only', scopesSite: 'Platform or one site', fourEyesRule: { towards_strict: 'Only a change towards the stricter value is immediate; anything else (a reset to the default included) needs a second super_admin.', second_person_always: 'Every change needs a second super_admin.', governance_store: 'Relaxing this protected rule needs a second super_admin.', kpi_policy_builder: 'Adopted by the KPI committee.' },
    },
    fr: {
      title: 'Centre de contrôle des politiques', search: 'Rechercher', searchPh: 'Rechercher une règle', category: 'Catégorie', risk: 'Risque', all: 'Toutes', high: 'Élevé', medium: 'Moyen', low: 'Faible',
      onlyDev: 'Seulement les règles qui s\'écartent de la bonne pratique', exportJson: 'Exporter JSON', exportCsv: 'Exporter CSV', requests: 'Changements en attente d\'un second super_admin',
      importTitle: 'Profil d\'environnement', profile: 'Profil', dryRun: 'Simulation', applyPlan: 'Appliquer ce plan',
      intro: 'Toutes les règles de la plateforme, au même endroit. Chaque règle part de sa valeur de bonne pratique (le fonctionnement actuel) ; adaptez-la à la réalité d\'un site, avec un motif. Les recommandations restent des propositions tant qu\'un humain ne les a pas approuvées. Un changement à risque élevé exige un second super_admin.',
      importIntro: 'Collez un profil (l\'export JSON d\'un autre environnement, ou { "profile": { "values": {…}, "sites": { "<id du site>": {…} } } }). La simulation montre ce qui changerait ; rien n\'est appliqué avant que vous confirmiez ce plan précis. Les secrets ne sont jamais importés.',
      deviates: 's\'écarte de la bonne pratique', siteDev: 'valeurs de site différentes', pending: 'en attente d\'approbation', fourEyes: 'double contrôle', secret: 'secret', readOnly: 'lecture seule',
      current: 'Valeur actuelle', def: 'Valeur de bonne pratique', rec: 'Recommandation (PROPOSÉE)', noRec: 'Pas encore de recommandation', desc: 'Rôle', noDesc: 'Pas encore de description dans le code.',
      frMissing: '(description disponible en anglais seulement)', owner: 'Rôle responsable (PROPOSÉ)', consumers: 'Concerne (fichiers qui la lisent)', notScanned: 'Non analysé — nom de clé trop générique.', none: 'aucun trouvé',
      scope: 'Portée', platform: 'Plateforme', site: 'Site', value: 'Nouvelle valeur', save: 'Enregistrer…', reset: 'Revenir à la recommandation…', history: 'Historique', siteValues: 'Valeurs par site',
      who: 'Qui', when: 'Quand', from: 'Avant', to: 'Après', why: 'Motif', approver: 'Seconde personne', noHistory: 'Aucun changement enregistré.', approve: 'Approuver…', reject: 'Refuser…', cancel: 'Retirer',
      tokTitle: 'Jeton opérateur pour l\'outil CLI', tokBtn: 'Émettre un jeton pour moi', tokIntro: 'Pour tools/ops/activate-switches.js : émettez un jeton à usage unique (valable 10 minutes) pour VOTRE compte. L\'outil dépose les changements à double contrôle comme une demande à votre nom ; un autre super_admin les approuve ici. Ne confiez jamais votre jeton à quelqu\'un d\'autre.',
      tokShown: (u, exp) => `Jeton pour ${u}, valable une seule fois jusqu'à ${exp}. Il n'est affiché que maintenant. Sur le serveur : placez-le dans SDP_OPERATOR_TOKEN, puis lancez l'outil avec --operator-token=env.`,
      tokOk: 'jeton opérateur #{id} : émis par le serveur pour ce compte (événement trouvé)', tokBad: 'jeton opérateur #{id} : NON vérifiable — {why} ; l\'approbation sera refusée', tokNoEv: 'aucun événement d\'émission', tokNoBind: 'non émis par le serveur', tokAcct: 'appartient à un autre compte',
      noReq: 'Rien en attente.', reasonT: 'Pourquoi ce changement ?', reasonL: 'Motif (conservé dans l\'historique)', saved: 'Enregistré.', pendingMsg: 'Enregistré comme demande — un autre super_admin doit l\'approuver.',
      unchanged: 'Rien n\'a changé.', managed: 'Se modifie dans', kpiNote: 'Les politiques RAG des indicateurs se modifient dans le constructeur de politiques KPI et sont adoptées par le comité KPI.',
      cov: (c) => `${c.catalogued} règles cataloguées (${c.report_config} clés de configuration, ${c.governance} politiques de gouvernance), ${c.excluded} exclues avec un motif.`,
      planCols: ['Règle', 'Portée', 'Actuelle', 'Proposée', 'Action'], applied: 'Appliqué', switchOff: 'Le centre des politiques est désactivé (policy_center_enabled).',
      catMissing: 'Le catalogue des règles est illisible sur ce serveur : toute règle exige désormais un second super_admin jusqu\'à ce que le fichier docs/ops/policy-catalogue.json soit rétabli.',
      scopesGlobal: 'Plateforme seulement', scopesSite: 'Plateforme ou un site', fourEyesRule: { towards_strict: 'Seul un changement vers la valeur la plus stricte est immédiat ; tout autre changement (y compris le retour à la valeur par défaut) exige un second super_admin.', second_person_always: 'Tout changement exige un second super_admin.', governance_store: 'Assouplir cette règle protégée exige un second super_admin.', kpi_policy_builder: 'Adoptée par le comité KPI.' },
    },
  }[lang];
  if (lang === 'fr') document.documentElement.lang = 'fr';
  for (const el of document.querySelectorAll('[data-i18n]')) { const v = S[el.getAttribute('data-i18n')]; if (typeof v === 'string') el.textContent = v; }
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) { const v = S[el.getAttribute('data-i18n-placeholder')]; if (typeof v === 'string') el.placeholder = v; }

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const show = (v) => (v === null || v === undefined ? '—' : v === '' ? '""' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  function hdr(extra) {
    const h = extra || {}; const at = window.__authToken; let tok = null;
    if (typeof at === 'function') { try { tok = at(); } catch (_) { tok = null; } } else if (typeof at === 'string' && at) tok = at;
    try { if (!tok) tok = localStorage.getItem('report_token'); } catch (_) { tok = null; }
    if (tok) h['x-report-token'] = tok;
    return h;
  }
  async function api(method, url, body) {
    const r = await fetch(url, { method, credentials: 'same-origin', headers: hdr(body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return Object.assign(j, { _status: r.status });
  }
  const msg = (x, ok) => { $('pcMsg').className = 'pc-msg ' + (ok ? 'pc-ok' : 'pc-err'); $('pcMsg').textContent = !ok && lang === 'fr' && window.ErrorText ? window.ErrorText.fr(x) : x; };
  const ask = (title) => (window.ReasonDialog ? window.ReasonDialog.ask({ title, label: S.reasonL, min: 5, lang, multiline: true }) : Promise.resolve(null));

  let data = null;
  async function load() {
    try { data = await api('GET', '/api/policy-center/catalogue'); }
    catch (e) { msg(e.status === 404 ? S.switchOff : e.message, false); return; }
    const sel = $('pcCat'); const keep = sel.value;
    sel.innerHTML = `<option value="">${esc(S.all)}</option>` + Object.entries(data.categories).map(([k, c]) => `<option value="${esc(k)}">${esc(c[lang] || c.en)}</option>`).join('');
    sel.value = keep;
    $('pcCoverage').textContent = S.cov(data.coverage);
    if (data.catalogue_missing) msg(S.catMissing, false);   // P11 N-10: fail closed, and say so
    $('pcImportCard').hidden = !data.can_write;
    render(); loadRequests();
  }
  function control(r) {
    const id = 'v-' + r.key.replace(/[^a-z0-9]/gi, '_');
    if (r.allowed) return `<select id="${id}">${r.allowed.map((a) => `<option value="${esc(JSON.stringify(a))}"${JSON.stringify(a) === JSON.stringify(r.current) ? ' selected' : ''}>${esc(show(a))}</option>`).join('')}</select>`;
    const v = typeof r.current === 'object' && r.current !== null ? JSON.stringify(r.current) : (r.current == null ? '' : String(r.current));
    if (r.type === 'json') return `<textarea id="${id}" class="pc-json">${esc(v)}</textarea>`;
    return `<input id="${id}" value="${esc(v)}"${r.min != null ? ` aria-describedby="${id}-h"` : ''}>${r.min != null || r.max != null ? `<span id="${id}-h" class="pc-muted">${r.min != null ? 'min ' + r.min : ''} ${r.max != null ? 'max ' + r.max : ''} ${esc(r.unit || '')}</span>` : ''}`;
  }
  function ruleHtml(r) {
    const tags = [];
    tags.push(`<span class="pc-tag${r.risk === 'high' ? ' high' : ''}">${esc(S.risk)}: ${esc(S[r.risk] || r.risk)}</span>`);
    if (r.deviates) tags.push(`<span class="pc-tag dev">${esc(S.deviates)}</span>`);
    if ((r.site_deviations || []).length) tags.push(`<span class="pc-tag dev">${esc(S.siteDev)} (${r.site_deviations.length})</span>`);
    if (r.pending) tags.push(`<span class="pc-tag pend">${esc(S.pending)} ${esc(r.pending)}</span>`);
    if (r.four_eyes) tags.push(`<span class="pc-tag">${esc(S.fourEyes)}</span>`);
    if (r.secret) tags.push(`<span class="pc-tag">${esc(S.secret)}</span>`);
    const desc = lang === 'fr' ? (r.description_fr || (r.description_en ? r.description_en + ' ' + S.frMissing : null)) : r.description_en;
    const sites = data.sites || [];
    const siteVals = Object.entries(r.site_values || {});
    const canEdit = data.can_write && r.editable;
    const cons = r.consumers === null ? S.notScanned : (r.consumers.length ? r.consumers.map((f) => `<span class="pc-key">${esc(f)}</span>`).join(', ') : S.none);
    return `<details class="pc-rule" data-key="${esc(r.key)}"><summary><strong>${esc(r.title)}</strong> <span class="pc-key">${esc(r.key)}</span> ${tags.join('')}
      <span class="pc-muted"> ${esc(S.current)}: ${esc(r.secret ? (r.secret_set ? '(set)' : '(not set)') : show(r.current))} · ${esc(S.def)}: ${esc(show(r.default))}</span></summary>
      <div class="pc-edit">
        <span class="pc-muted">${esc(S.desc)}</span><span>${esc(desc || S.noDesc)}</span>
        <span class="pc-muted">${esc(S.rec)}</span><span>${r.recommendation ? esc(r.recommendation.text) + (r.recommendation.reference ? ` <span class="pc-muted">(${esc(r.recommendation.reference)})</span>` : '') : esc(S.noRec)}</span>
        <span class="pc-muted">${esc(S.owner)}</span><span>${esc(r.owner_role ? r.owner_role.role : '—')}</span>
        <span class="pc-muted">${esc(S.scope)}</span><span>${esc(r.scopes.includes('site') ? S.scopesSite : S.scopesGlobal)}${r.four_eyes_rule ? ' · ' + esc(S.fourEyesRule[r.four_eyes_rule] || '') : ''}</span>
        <span class="pc-muted">${esc(S.consumers)}</span><span>${cons}</span>
        ${siteVals.length ? `<span class="pc-muted">${esc(S.siteValues)}</span><span>${siteVals.map(([sid, v]) => esc(((sites.find((s) => s.id === Number(sid)) || {}).name || '#' + sid) + ': ' + show(v))).join(' · ')}</span>` : ''}
        ${canEdit ? `<label class="pc-muted" for="v-${esc(r.key.replace(/[^a-z0-9]/gi, '_'))}">${esc(S.value)}</label><span class="pc-bar">${control(r)}
          ${r.scopes.includes('site') ? `<label class="pc-sr" for="s-${esc(r.key.replace(/[^a-z0-9]/gi, '_'))}">${esc(S.scope)}</label><select id="s-${esc(r.key.replace(/[^a-z0-9]/gi, '_'))}"><option value="global">${esc(S.platform)}</option>${sites.map((s) => `<option value="site:${s.id}">${esc(S.site)}: ${esc(s.name)}</option>`).join('')}</select>` : ''}
          <button type="button" data-act="save">${esc(S.save)}</button><button type="button" data-act="reset">${esc(S.reset)}</button></span>` : ''}
        <span class="pc-muted">${esc(S.history)}</span><span><button type="button" data-act="history">${esc(S.history)}</button><span data-role="hist"></span></span>
      </div></details>`;
  }
  function render() {
    const q = $('pcQ').value.trim().toLowerCase(), cat = $('pcCat').value, risk = $('pcRisk').value, dev = $('pcDev').checked;
    const rows = data.rules.filter((r) => (!cat || r.category === cat) && (!risk || r.risk === risk) && (!dev || r.deviates || (r.site_deviations || []).length)
      && (!q || (r.key + ' ' + r.title + ' ' + (r.description_en || '') + ' ' + (r.description_fr || '')).toLowerCase().includes(q)));
    const out = [];
    for (const [k, c] of Object.entries(data.categories)) {
      const list = rows.filter((r) => r.category === k);
      const extra = k === 'kpi' && (!cat || cat === 'kpi') ? data.kpi_policies : [];
      if (!list.length && !extra.length) continue;
      out.push(`<section class="pc-card" aria-labelledby="h-${esc(k)}"><h2 id="h-${esc(k)}">${esc(c[lang] || c.en)} <span class="pc-muted">(${list.length})</span></h2>${list.map(ruleHtml).join('')}
        ${extra.length ? `<p class="pc-muted">${esc(S.kpiNote)} <a href="kpi-builder.html">kpi-builder.html</a></p><p class="pc-muted">${extra.map((x) => `<span class="pc-key">${esc(x.key)}</span>`).join(' · ')}</p>` : ''}</section>`);
    }
    $('pcRules').innerHTML = out.join('');
  }
  function readValue(r, box) {
    const el = box.querySelector('#v-' + r.key.replace(/[^a-z0-9]/gi, '_'));
    if (!el) return undefined;
    if (el.tagName === 'SELECT') { try { return JSON.parse(el.value); } catch (_) { return el.value; } }
    return el.value;
  }
  function outcome(res) { msg(res.status === 'pending' ? S.pendingMsg + ' (' + res.request + ')' : res.status === 'unchanged' ? S.unchanged : S.saved, true); }
  $('pcRules').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-act]'); if (!b) return;
    const box = b.closest('details'); const key = box.getAttribute('data-key'); const r = data.rules.find((x) => x.key === key);
    const sc = box.querySelector('#s-' + key.replace(/[^a-z0-9]/gi, '_')); const scope = sc ? sc.value : 'global';
    try {
      if (b.dataset.act === 'history') {
        const h = await api('GET', '/api/policy-center/rules/' + encodeURIComponent(key) + '/history');
        const rows = h.history.map((x) => `<tr><td>${esc(x.at)}</td><td>${esc(x.scope)}</td><td>${esc(x.who || '—')}</td><td>${esc(x.change || show(x.from))}</td><td>${esc(x.change ? '' : show(x.to))}</td><td>${esc(x.reason || '')}</td><td>${esc(x.second_person || '')}</td></tr>`);
        for (const q of h.requests || []) rows.push(`<tr><td>${esc(q.requested_at)}</td><td>${esc(q.scope)}</td><td>${esc(q.requested_by_name)}</td><td>${esc(show(q.old_value))}</td><td>${esc(show(q.new_value))}</td><td>${esc(q.status + ' — ' + q.reason)}</td><td>${esc(q.decided_by_name || '')}</td></tr>`);
        box.querySelector('[data-role="hist"]').innerHTML = rows.length ? `<table><thead><tr><th>${esc(S.when)}</th><th>${esc(S.scope)}</th><th>${esc(S.who)}</th><th>${esc(S.from)}</th><th>${esc(S.to)}</th><th>${esc(S.why)}</th><th>${esc(S.approver)}</th></tr></thead><tbody>${rows.join('')}</tbody></table>` : ' ' + esc(S.noHistory);
        return;
      }
      const reason = await ask(S.reasonT); if (!reason) return;
      const body = b.dataset.act === 'reset' ? { reset: true, scope, reason } : { value: readValue(r, box), scope, reason };
      outcome(await api('PUT', '/api/policy-center/rules/' + encodeURIComponent(key), body));
      await load();
    } catch (e) { msg(e.message, false); }
  });
  // P11 r7 R7-A1 — the approver sees whether the operator token a CLI request names was really issued by the server
  function tokenNote(t) {
    if (!t) return '';
    const ok = t.issued_event && t.binding_ok && t.account_matches;
    const why = !t.issued_event ? S.tokNoEv : !t.binding_ok ? S.tokNoBind : S.tokAcct;
    const txt = (ok ? S.tokOk : S.tokBad).replace('{id}', String(t.id)).replace('{why}', why);
    return `<div class="pc-muted" data-token-ok="${ok ? '1' : '0'}">${esc(txt)}</div>`;
  }
  async function loadRequests() {
    try {
      const j = await api('GET', '/api/policy-center/requests');
      $('pcReqs').innerHTML = j.requests.length ? `<table><thead><tr><th>${esc(S.when)}</th><th>${esc(S.planCols[0])}</th><th>${esc(S.scope)}</th><th>${esc(S.from)}</th><th>${esc(S.to)}</th><th>${esc(S.who)}</th><th>${esc(S.why)}</th><th></th></tr></thead><tbody>${j.requests.map((q) => `<tr data-id="${esc(q.id)}">
        <td>${esc(q.requested_at)}</td><td class="pc-key">${esc(q.key)}</td><td>${esc(q.scope)}</td><td>${esc(show(q.from))}</td><td>${esc(show(q.to))}</td><td>${esc(q.requested_by)}</td><td>${esc(q.reason)}${tokenNote(q.operator_token)}</td>
        <td>${data.can_write ? (q.mine ? (q.source === 'policy_center' ? `<button type="button" data-req="cancel">${esc(S.cancel)}</button>` : '') : `<button type="button" data-req="approve">${esc(S.approve)}</button> <button type="button" data-req="reject">${esc(S.reject)}</button>`) : ''}</td></tr>`).join('')}</tbody></table>` : `<p class="pc-muted">${esc(S.noReq)}</p>`;
    } catch (e) { $('pcReqs').textContent = e.message; }
  }
  $('pcReqs').addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-req]'); if (!b) return;
    const id = b.closest('tr').getAttribute('data-id'); const act = b.dataset.req;
    try {
      const reason = act === 'cancel' ? '' : await ask(act === 'approve' ? S.approve : S.reject);
      if (act !== 'cancel' && !reason) return;
      await api('POST', `/api/policy-center/requests/${encodeURIComponent(id)}/${act}`, { reason });
      msg(S.saved, true); await load();
    } catch (e) { msg(e.message, false); }
  });
  for (const id of ['pcQ', 'pcCat', 'pcRisk', 'pcDev']) $(id).addEventListener(id === 'pcQ' ? 'input' : 'change', () => data && render());
  function download(name, text, type) { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; document.body.appendChild(a); a.click(); a.remove(); }
  $('pcExportJson').addEventListener('click', async () => { try { const j = await api('GET', '/api/policy-center/export'); delete j._status; download('policy-set.json', JSON.stringify(j, null, 1), 'application/json'); } catch (e) { msg(e.message, false); } });
  $('pcExportCsv').addEventListener('click', async () => {
    try { const r = await fetch('/api/policy-center/export?format=csv', { credentials: 'same-origin', headers: hdr() }); if (!r.ok) throw new Error('HTTP ' + r.status); download('policy-set.csv', await r.text(), 'text/csv'); } catch (e) { msg(e.message, false); }
  });
  $('pcTokBtn').addEventListener('click', async () => {
    try {
      const j = await api('POST', '/api/policy-center/operator-tokens', {});
      const out = $('pcTokOut'); out.hidden = false; out.textContent = S.tokShown(j.username, j.expires_at) + '\n\n' + j.token;
    } catch (e) { msg(e.message, false); }
  });
  let lastPlan = null;
  function profileFromBox() { const j = JSON.parse($('pcProfile').value || '{}'); return j.profile || j; }
  $('pcDry').addEventListener('click', async () => {
    try {
      const profile = profileFromBox();
      const j = await api('POST', '/api/policy-center/import', { profile });
      lastPlan = { profile, plan_hash: j.plan_hash };
      $('pcPlan').innerHTML = `<p class="pc-muted">${esc(Object.entries(j.summary).map(([k, v]) => k + ': ' + v).join(' · '))}</p><table><thead><tr>${S.planCols.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${j.plan.map((r) => `<tr><td class="pc-key">${esc(r.key)}</td><td>${esc(r.scope)}</td><td>${esc(show(r.current))}</td><td>${esc(show(r.proposed))}</td><td>${esc(r.action)}${r.error ? ' — ' + esc(r.error) : ''}</td></tr>`).join('')}</tbody></table>`;
      $('pcApply').disabled = !j.plan.some((r) => ['apply', 'four_eyes', 'governance_check'].includes(r.action));
    } catch (e) { msg(e.message, false); }
  });
  $('pcApply').addEventListener('click', async () => {
    if (!lastPlan) return;
    try {
      const reason = await ask(S.applyPlan); if (!reason) return;
      const j = await api('POST', '/api/policy-center/import', { profile: lastPlan.profile, plan_hash: lastPlan.plan_hash, confirm: true, reason });
      $('pcPlan').innerHTML = `<table><tbody>${j.results.map((r) => `<tr><td class="pc-key">${esc(r.key)}</td><td>${esc(r.scope)}</td><td>${esc(r.status)}${r.request ? ' ' + esc(r.request) : ''}${r.error ? ' — ' + esc(r.error) : ''}</td></tr>`).join('')}</tbody></table>`;
      $('pcApply').disabled = true; lastPlan = null; await load();
    } catch (e) { msg(e.message, false); }
  });
  load();
})();
