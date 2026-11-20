// PORTFOLIO LOT 4 — decision agenda + management alerts page (public/portfolio-decisions.html). Data:
// GET /api/governance/portfolio/decision-agenda (404 while ppm_decision_agenda_enabled = '0') and
// GET /api/governance/portfolio/alerts (404 while ppm_alert_actions_enabled = '0'). The committee records a decision
// about a project, its outcome, and promotes an alert to a commitment. Every value escaped; unknown shows "—", never 0.
// EN / FR from the shell. No inline handler (strict CSP page). Every rule shown here is PROPOSED, not approved policy.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  let lang = 'en';
  try { lang = (window.__shell && window.__shell.shellLang && window.__shell.shellLang()) || 'en'; } catch (_) { lang = 'en'; }
  if (lang === 'fr') document.documentElement.lang = 'fr';
  const TT = {
    en: { title: 'Portfolio decisions & alerts', intro: 'Projects that need a management decision, with their decision records, and the management alerts on the portfolio you can read. Rules, severities and recommended actions are PROPOSED, not approved policy. Nothing on this page sends a message.',
      agenda: 'Decision agenda', alerts: 'Management alerts', project: 'Project', site: 'Site', required: 'Decision required', decisions: 'Decisions', next: 'Next due', none: 'None recorded', notRecorded: 'required, not recorded', overdue: 'overdue',
      addDecision: 'Add decision', title_: 'Decision', authority: 'Authority', due: 'Due date', owner: 'Owner', outcome: 'Outcome', decidedAt: 'Decision date', save: 'Save', kind: 'Alert', severity: 'Severity', trigger: 'Trigger', action: 'Recommended action', status: 'Status',
      promote: 'Assign (create commitment)', promoted: 'Commitment', open: 'Open', off: 'Not enabled.', unknown: 'unknown', intakeOff: 'Unknown: the intake register is not enabled.', moneyHidden: 'Unfunded alerts are shown to amount readers only.',
      summary: (s) => `${s.projects} project(s) · ${s.open_decisions} open decision(s) · ${s.overdue_decisions} overdue · ${s.not_recorded} required but not recorded`, done: 'Saved.', failed: 'Failed: ', unknownKinds: 'Not computed: ',
      kinds: { critical_risk: 'Critical risk', high_risk: 'High risk', unfunded: 'Unfunded', decision_bottleneck: 'Decision bottleneck', missing_delivery_lead: 'Missing delivery lead', schedule_error: 'Schedule error' } },
    fr: { title: 'Décisions & alertes du portefeuille', intro: 'Projets qui demandent une décision de direction, avec leurs décisions enregistrées, et les alertes de pilotage sur le portefeuille que vous pouvez lire. Règles, sévérités et actions recommandées sont PROPOSÉES, non approuvées. Cette page n’envoie aucun message.',
      agenda: 'Agenda des décisions', alerts: 'Alertes de pilotage', project: 'Projet', site: 'Site', required: 'Décision requise', decisions: 'Décisions', next: 'Prochaine échéance', none: 'Aucune enregistrée', notRecorded: 'requise, non enregistrée', overdue: 'en retard',
      addDecision: 'Ajouter une décision', title_: 'Décision', authority: 'Autorité', due: 'Échéance', owner: 'Responsable', outcome: 'Résultat', decidedAt: 'Date de décision', save: 'Enregistrer', kind: 'Alerte', severity: 'Sévérité', trigger: 'Déclencheur', action: 'Action recommandée', status: 'Statut',
      promote: 'Assigner (créer un engagement)', promoted: 'Engagement', open: 'Ouverte', off: 'Non activé.', unknown: 'inconnu', intakeOff: 'Inconnu : le registre d’intake n’est pas activé.', moneyHidden: 'Les alertes « non financé » sont réservées aux lecteurs des montants.',
      summary: (s) => `${s.projects} projet(s) · ${s.open_decisions} décision(s) ouverte(s) · ${s.overdue_decisions} en retard · ${s.not_recorded} requise(s) non enregistrée(s)`, done: 'Enregistré.', failed: 'Échec : ', unknownKinds: 'Non calculé : ',
      kinds: { critical_risk: 'Risque critique', high_risk: 'Risque élevé', unfunded: 'Non financé', decision_bottleneck: 'Décision en attente', missing_delivery_lead: 'Responsable de livraison manquant', schedule_error: 'Erreur de planning' } },
  };
  const T = TT[lang === 'fr' ? 'fr' : 'en'];
  const d = (v) => (v == null || v === '' ? '—' : esc(v));
  $('pdTitle').textContent = T.title; $('pdIntro').textContent = T.intro; $('pdAgendaH').textContent = T.agenda; $('pdAlertsH').textContent = T.alerts;
  const say = (m) => { $('pdMeta').textContent = m; };

  async function api(path, opts) {
    const r = await fetch(path, Object.assign({ credentials: 'same-origin', headers: { 'Content-Type': 'application/json' } }, opts || {}));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return j;
  }
  const field = (name, label, type, extra) => `<label class="pd-sr" for="${esc(name)}">${esc(label)}</label><input id="${esc(name)}" name="${esc(name)}" type="${type || 'text'}" placeholder="${esc(label)}" ${extra || ''}>`;

  function drawAgenda(j) {
    $('pdAgendaCard').hidden = false;
    if (j.unknown_reason) { $('pdAgendaSum').textContent = T.intakeOff; $('pdAgenda').innerHTML = ''; return; }
    $('pdAgendaSum').textContent = T.summary(j.summary);
    const outcomes = j.outcomes || [];
    const rows = j.rows.map((r) => {
      const decs = r.decisions.length ? r.decisions.map((x) => `<div><strong>${d(x.ref)}</strong> ${d(x.title)} · ${esc(T.authority)}: ${d(x.authority)} · ${esc(T.due)}: ${d(x.due_date)}${x.overdue ? ` <span class="pd-tag pd-crit">${esc(T.overdue)}</span>` : ''} · ${d(x.status)} · ${esc(T.outcome)}: ${d(x.outcome)} ${x.decided_at ? '(' + esc(x.decided_at) + ')' : ''}${
        j.can_record ? `<form class="pd-form" data-rec="${esc(x.id)}"><label class="pd-sr" for="oc${esc(x.id)}">${esc(T.outcome)}</label><select id="oc${esc(x.id)}" name="outcome"><option value="">—</option>${outcomes.map((o) => `<option value="${esc(o)}"${o === x.outcome ? ' selected' : ''}>${esc(o)}</option>`).join('')}</select>${field('da' + x.id, T.decidedAt, 'date', 'data-k="decided_at"')}<button class="pd-btn" type="submit">${esc(T.save)}</button></form>` : ''}</div>`).join('')
        : `<em>${esc(T.none)}</em>`;
      const add = j.can_record ? `<form class="pd-form" data-add="${esc(r.project_id)}">${field('dt' + r.project_id, T.title_, 'text', 'required data-k="title"')}${field('au' + r.project_id, T.authority, 'text', 'data-k="authority"')}${field('du' + r.project_id, T.due, 'date', 'data-k="due_date"')}<button class="pd-btn" type="submit">${esc(T.addDecision)}</button></form>` : '';
      return `<tr><th scope="row">${d(r.ref)} ${d(r.name)}</th><td>${d(r.site)}</td><td>${d(r.decision_required)}${r.not_recorded ? ` <span class="pd-tag pd-crit">${esc(T.notRecorded)}</span>` : ''}</td><td>${decs}${add}</td><td>${d(r.next_due)}</td></tr>`;
    }).join('');
    $('pdAgenda').innerHTML = `<table class="pd-table"><thead><tr><th scope="col">${esc(T.project)}</th><th scope="col">${esc(T.site)}</th><th scope="col">${esc(T.required)}</th><th scope="col">${esc(T.decisions)}</th><th scope="col">${esc(T.next)}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  function drawAlerts(j) {
    $('pdAlertsCard').hidden = false;
    const unk = Object.entries(j.coverage || {}).filter(([, v]) => v).map(([k, v]) => `${T.kinds[k] || k} (${v})`);
    $('pdAlertsNote').textContent = (unk.length ? T.unknownKinds + unk.join(', ') + '. ' : '') + (j.money_hidden ? T.moneyHidden : '');
    const rows = j.items.map((a) => {
      const sev = a.severity === 'critical' ? 'pd-crit' : a.severity === 'high' ? 'pd-high' : '';
      const act = a.commitment ? `<a href="commitments.html?id=${esc(a.commitment.id)}">${esc(T.promoted)} #${esc(a.commitment.id)}</a> · ${d(a.commitment.status)}`
        : j.can_promote ? `<form class="pd-form" data-promote="${esc(a.key)}">${field('ow' + a.key.replace(/[^a-z0-9]/gi, '_'), T.owner, 'text', 'required data-k="owner"')}${field('dd' + a.key.replace(/[^a-z0-9]/gi, '_'), T.due, 'date', 'data-k="due_date"')}<button class="pd-btn" type="submit">${esc(T.promote)}</button></form>` : esc(T.open);
      return `<tr><td>${esc(T.kinds[a.kind] || a.kind)}</td><td><span class="pd-tag ${sev}">${d(a.severity)}</span></td><th scope="row">${d(a.project_key)}</th><td>${d(a.message)}</td><td>${d(a.recommended_action && a.recommended_action[lang === 'fr' ? 'fr' : 'en'])}</td><td>${act}</td></tr>`;
    }).join('');
    $('pdAlerts').innerHTML = `<table class="pd-table"><thead><tr><th scope="col">${esc(T.kind)}</th><th scope="col">${esc(T.severity)}</th><th scope="col">${esc(T.project)}</th><th scope="col">${esc(T.trigger)}</th><th scope="col">${esc(T.action)}</th><th scope="col">${esc(T.status)}</th></tr></thead><tbody>${rows}</tbody></table>`;
  }

  const vals = (form) => { const o = {}; form.querySelectorAll('[data-k]').forEach((i) => { if (i.value !== '') o[i.getAttribute('data-k')] = i.value; }); const s = form.querySelector('select[name="outcome"]'); if (s) o.outcome = s.value; return o; };
  document.addEventListener('submit', async (ev) => {
    const f = ev.target; if (!f || !f.matches || !f.matches('form.pd-form')) return;
    ev.preventDefault();
    try {
      if (f.dataset.add) await api('/api/governance/portfolio/project/' + encodeURIComponent(f.dataset.add) + '/decisions', { method: 'POST', body: JSON.stringify(vals(f)) });
      else if (f.dataset.rec) await api('/api/governance/portfolio/decisions/' + encodeURIComponent(f.dataset.rec) + '/record', { method: 'PUT', body: JSON.stringify(vals(f)) });
      else if (f.dataset.promote) await api('/api/governance/portfolio/alerts/promote', { method: 'POST', body: JSON.stringify(Object.assign({ key: f.dataset.promote }, vals(f))) });
      say(T.done); load();
    } catch (e) { say(T.failed + e.message); }
  });

  async function load() {
    let any = false;
    try { drawAgenda(await api('/api/governance/portfolio/decision-agenda')); any = true; } catch (e) { $('pdAgendaCard').hidden = true; if (e.status !== 404) say(T.failed + e.message); }
    try { drawAlerts(await api('/api/governance/portfolio/alerts')); any = true; } catch (e) { $('pdAlertsCard').hidden = true; if (e.status !== 404) say(T.failed + e.message); }
    if (!any) say(T.off);
  }
  load();
}());
