// ADR-006 — Governance policies ▸ Roles, deputies and escalation. Renders into #gpRoles.
// Reads GET /api/governance/roles; writes go through the guarded API (super_admin for roles and the
// matrix, admin tier for deputies). Every write asks a reason with ReasonDialog (no prompt()).
(function () {
  'use strict';
  const root = document.getElementById('gpRoles'); if (!root) return;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function hdr(extra) {
    const h = extra || {}; const at = window.__authToken; let tok = null;
    if (typeof at === 'function') { try { tok = at(); } catch (_) {} } else if (typeof at === 'string' && at) tok = at;
    if (!tok) tok = localStorage.getItem('report_token');
    if (tok) h['x-report-token'] = tok;
    return h;
  }
  async function api(method, url, body) {
    const r = await fetch(url, { method, headers: hdr(body ? { 'content-type': 'application/json' } : {}), body: body ? JSON.stringify(body) : undefined });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j;
  }
  const lang = () => (document.body.classList.contains('lang-fr') ? 'fr' : 'en');
  const L = {
    en: { title: 'Roles, deputies and escalation', intro: 'Who receives escalations and who stands in for an absent colleague — set here, no code change. Empty = nobody named (escalations are recorded without a target). Every change is kept in an append-only, hash-chained history.',
      roles: 'Role holders', deputies: 'Deputies (absences)', matrix: 'Escalation matrix', gaps: 'Gaps — nobody would be reached', role: 'Role', scope: 'Scope', person: 'Person', from: 'From', to: 'To', platform: 'Platform', end: 'End', revoke: 'Revoke', retire: 'Retire', add: 'Add',
      absent: 'Absent person', deputy: 'Deputy', register: 'Register', severity: 'Severity', after: 'After (days overdue)', reason: 'Reason (kept in the history)', none: '—', noGap: 'No gap.', open: 'open-ended', saved: 'Saved.',
      kind: { role: 'required role without a holder', matrix: 'escalation rule reaches nobody' },
      kpi: 'KPI targets per site', kpiIntro: 'The number a site is held to for a KPI (site value, else platform value). The KPI definitions stay decisions D-01..D-03.', metric: 'KPI', target: 'Target', cal: 'Working calendar (holidays, shutdowns)', calIntro: 'Days listed here do not count in the overdue rules (handoff escalation, escalation levels, missed sessions). Weekends: policy calendar.skip_weekends.', day: 'Day', label: 'Name', remove: 'Remove', holiday: 'holiday', shutdown: 'shutdown' },
    fr: { title: 'Rôles, suppléants et escalade', intro: 'Qui reçoit les remontées et qui remplace un collègue absent — réglé ici, sans code. Vide = personne de désigné (les remontées sont enregistrées sans destinataire). Chaque changement est conservé dans un historique en ajout seul et chaîné.',
      roles: 'Titulaires des rôles', deputies: 'Suppléants (absences)', matrix: 'Matrice d\'escalade', gaps: 'Lacunes — personne ne serait joint', role: 'Rôle', scope: 'Portée', person: 'Personne', from: 'Du', to: 'Au', platform: 'Plateforme', end: 'Terminer', revoke: 'Révoquer', retire: 'Retirer', add: 'Ajouter',
      absent: 'Personne absente', deputy: 'Suppléant', register: 'Registre', severity: 'Gravité', after: 'Après (jours de retard)', reason: 'Motif (conservé dans l\'historique)', none: '—', noGap: 'Aucune lacune.', open: 'sans fin', saved: 'Enregistré.',
      kind: { role: 'rôle requis sans titulaire', matrix: 'règle d\'escalade qui ne joint personne' },
      kpi: 'Cibles d\'indicateurs par site', kpiIntro: 'La valeur visée pour un indicateur (valeur du site, sinon de la plateforme). Les définitions restent les décisions D-01 à D-03.', metric: 'Indicateur', target: 'Cible', cal: 'Calendrier ouvré (fériés, arrêts)', calIntro: 'Les jours listés ne comptent pas dans les règles de retard (escalade des demandes, niveaux d\'escalade, séances manquées). Week-ends : règle calendar.skip_weekends.', day: 'Jour', label: 'Nom', remove: 'Retirer', holiday: 'férié', shutdown: 'arrêt' },
  };
  const T = () => L[lang()];
  let d = null;
  const nameOf = (id) => { const p = (d.people || []).find((x) => x.id === Number(id)); return p ? p.name : '#' + id; };
  const siteOf = (id) => (id == null ? T().platform : ((d.sites || []).find((s) => s.id === Number(id)) || {}).name || 'site ' + id);
  const roleLabel = (k) => (d.roles[k] ? `${d.roles[k][lang()]} <span class="gp-key">${esc(k)}</span>` : esc(k));
  const opts = (list, sel) => list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(sel) ? ' selected' : ''}>${esc(l)}</option>`).join('');
  const siteOpts = () => [['', T().platform], ...d.sites.map((s) => [s.id, s.name])];
  const peopleOpts = () => d.people.map((p) => [p.id, p.name]);
  const today = () => new Date().toISOString().slice(0, 10);
  const say = (m, ok) => { const el = document.getElementById('gpRolesMsg'); el.className = 'gp-msg ' + (ok ? 'gp-ok' : 'gp-err'); el.textContent = !ok && lang() === 'fr' && window.ErrorText ? window.ErrorText.fr(m) : m; };

  function render() {
    const t = T(); const live = (r) => !r.ended_at && !r.revoked_at && !r.retired_at && (!(r.effective_to || r.end_date) || String(r.effective_to || r.end_date) >= today());
    const W = d.can_write_roles, WD = d.can_write_deputies;
    root.innerHTML = `<h2>${t.title}</h2><p class="gp-muted">${t.intro}</p><div class="gp-msg" id="gpRolesMsg" role="status" aria-live="polite"></div>
      <h3>${t.gaps}</h3>${d.gaps.length ? `<table><tbody>${d.gaps.map((g) => `<tr><td>${esc(g.site)}</td><td>${roleLabel(g.role)}</td><td class="gp-muted">${t.kind[g.kind]}</td></tr>`).join('')}</tbody></table>` : `<p class="gp-muted">${t.noGap}</p>`}
      <h3>${t.roles}</h3><table><thead><tr><th>${t.role}</th><th>${t.scope}</th><th>${t.person}</th><th>${t.from}</th><th>${t.to}</th><th></th></tr></thead><tbody>
      ${d.assignments.filter(live).map((a) => `<tr><td>${roleLabel(a.role)}</td><td>${esc(siteOf(a.site_id))}</td><td>${esc(nameOf(a.user_id))}</td><td>${esc(a.effective_from)}</td><td>${esc(a.effective_to || t.open)}</td><td>${W ? `<button type="button" data-act="end" data-id="${a.id}">${t.end}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="6" class="gp-muted">${t.none}</td></tr>`}
      ${W ? `<tr><td><select id="raRole" aria-label="${t.role}">${opts(Object.keys(d.roles).map((k) => [k, d.roles[k][lang()]]))}</select></td><td><select id="raSite" aria-label="${t.scope}">${opts(siteOpts())}</select></td><td><select id="raUser" aria-label="${t.person}">${opts(peopleOpts())}</select></td><td><input id="raFrom" type="date" value="${today()}" aria-label="${t.from}"></td><td><input id="raTo" type="date" aria-label="${t.to}"></td><td><button type="button" data-act="assign">${t.add}</button></td></tr>` : ''}
      </tbody></table>
      <h3>${t.deputies}</h3><table><thead><tr><th>${t.absent}</th><th>${t.deputy}</th><th>${t.from}</th><th>${t.to}</th><th>${t.reason}</th><th></th></tr></thead><tbody>
      ${d.deputies.filter(live).map((x) => `<tr><td>${esc(nameOf(x.user_id))}</td><td>${esc(nameOf(x.deputy_id))}</td><td>${esc(x.start_date)}</td><td>${esc(x.end_date)}</td><td class="gp-src">${esc(x.reason)}</td><td>${WD ? `<button type="button" data-act="revoke" data-id="${x.id}">${t.revoke}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="6" class="gp-muted">${t.none}</td></tr>`}
      ${WD ? `<tr><td><select id="dpUser" aria-label="${t.absent}">${opts(peopleOpts())}</select></td><td><select id="dpDep" aria-label="${t.deputy}">${opts(peopleOpts())}</select></td><td><input id="dpFrom" type="date" value="${today()}" aria-label="${t.from}"></td><td><input id="dpTo" type="date" aria-label="${t.to}"></td><td class="gp-muted">≤ ${d.deputy_max_days} j</td><td><button type="button" data-act="deputy">${t.add}</button></td></tr>` : ''}
      </tbody></table>
      <h3>${t.matrix}</h3><table><thead><tr><th>${t.register}</th><th>${t.severity}</th><th>${t.scope}</th><th>${t.after}</th><th>${t.role}</th><th></th></tr></thead><tbody>
      ${d.matrix.filter((m) => !m.retired_at).map((m) => `<tr><td>${esc(m.register)}</td><td>${esc(m.severity)}</td><td>${esc(siteOf(m.site_id))}</td><td>${Number(m.after_days)}</td><td>${roleLabel(m.role)}</td><td>${W ? `<button type="button" data-act="retire" data-id="${m.id}">${t.retire}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="6" class="gp-muted">${t.none}</td></tr>`}
      ${W ? `<tr><td><select id="mxReg" aria-label="${t.register}">${opts(Object.keys(d.registers).map((r) => [r, r]))}</select></td><td><select id="mxSev" aria-label="${t.severity}">${opts(d.registers.commitments.map((s) => [s, s]))}</select></td><td><select id="mxSite" aria-label="${t.scope}">${opts(siteOpts())}</select></td><td><input id="mxAfter" type="number" min="0" max="365" value="0" aria-label="${t.after}"></td><td><select id="mxRole" aria-label="${t.role}">${opts(Object.keys(d.roles).filter((k) => /escalation/.test(k)).map((k) => [k, d.roles[k][lang()]]))}</select></td><td><button type="button" data-act="matrix">${t.add}</button></td></tr>` : ''}
      </tbody></table>
      <h3>${t.kpi}</h3><p class="gp-muted">${t.kpiIntro}</p><table><thead><tr><th>${t.metric}</th><th>${t.scope}</th><th>${t.target}</th><th>${t.from}</th><th></th></tr></thead><tbody>
      ${kt.map((x) => `<tr><td class="gp-key">${esc(x.metric_key)}</td><td>${esc(siteOf(x.site_id))}</td><td>${esc(x.target)}</td><td>${esc(x.effective_from)}</td><td>${W ? `<button type="button" data-act="kpiend" data-id="${x.id}">${t.end}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="5" class="gp-muted">${t.none}</td></tr>`}
      ${W && keys.length ? `<tr><td><select id="ktKey" aria-label="${t.metric}">${opts(keys.map((k) => [k.key, `${k.key} — ${lang() === 'fr' && k.name_fr ? k.name_fr : k.name}`]))}</select></td><td><select id="ktSite" aria-label="${t.scope}">${opts(siteOpts())}</select></td><td><input id="ktVal" type="number" step="any" aria-label="${t.target}"></td><td><input id="ktFrom" type="date" value="${today()}" aria-label="${t.from}"></td><td><button type="button" data-act="kpiset">${t.add}</button></td></tr>` : ''}
      </tbody></table>
      <h3>${t.cal}</h3><p class="gp-muted">${t.calIntro}</p><table><thead><tr><th>${t.day}</th><th>${t.scope}</th><th>${t.label}</th><th></th></tr></thead><tbody>
      ${(d.calendar || []).map((c) => `<tr><td>${esc(c.day)}</td><td>${esc(siteOf(c.site_id))}</td><td>${esc(c.label)} <span class="gp-src">${esc(t[c.kind] || c.kind)}</span></td><td>${WD ? `<button type="button" data-act="calremove" data-id="${c.id}">${t.remove}</button>` : ''}</td></tr>`).join('') || `<tr><td colspan="4" class="gp-muted">${t.none}</td></tr>`}
      ${WD ? `<tr><td><input id="clDay" type="date" aria-label="${t.day}"></td><td><select id="clSite" aria-label="${t.scope}">${opts(siteOpts())}</select></td><td><input id="clLabel" aria-label="${t.label}" placeholder="${t.label}"> <select id="clKind" aria-label="kind">${opts([['holiday', t.holiday], ['shutdown', t.shutdown]])}</select></td><td><button type="button" data-act="caladd">${t.add}</button></td></tr>` : ''}
      </tbody></table>`;
  }
  let kt = [], keys = [];
  async function load() {
    try {
      d = await api('GET', '/api/governance/roles');
      try { kt = (await api('GET', '/api/metrics/targets')).targets || []; keys = (await api('GET', '/api/metrics/registry')).metrics || []; } catch (_) { kt = []; keys = []; }
      render();
    }
    catch (e) { root.innerHTML = `<p class="gp-err">${esc(e.message)}</p>`; }
  }
  const val = (id) => { const el = document.getElementById(id); return el ? el.value : ''; };
  root.addEventListener('click', async (ev) => {
    const b = ev.target.closest('button[data-act]'); if (!b) return;
    const act = b.dataset.act, t = T();
    const reason = act === 'caladd' ? '' : await window.ReasonDialog.ask({ title: b.textContent, label: t.reason, min: 5, lang: lang() }); if (reason == null) return;
    try {
      if (act === 'assign') await api('POST', '/api/governance/roles/assignments', { role: val('raRole'), site_id: val('raSite') || null, user_id: Number(val('raUser')), effective_from: val('raFrom'), effective_to: val('raTo') || null, reason });
      else if (act === 'deputy') await api('POST', '/api/governance/roles/deputies', { user_id: Number(val('dpUser')), deputy_id: Number(val('dpDep')), start_date: val('dpFrom'), end_date: val('dpTo'), reason });
      else if (act === 'matrix') await api('POST', '/api/governance/roles/matrix', { register: val('mxReg'), severity: val('mxReg') === 'handoffs' ? '*' : val('mxSev'), site_id: val('mxSite') || null, after_days: Number(val('mxAfter') || 0), role: val('mxRole'), reason });
      else if (act === 'kpiset') await api('POST', '/api/metrics/targets', { metric_key: val('ktKey'), site_id: val('ktSite') || null, target: val('ktVal'), effective_from: val('ktFrom'), reason });
      else if (act === 'kpiend') await api('POST', `/api/metrics/targets/${encodeURIComponent(b.dataset.id)}/end`, { reason });
      else if (act === 'caladd') await api('POST', '/api/governance/roles/calendar', { day: val('clDay'), site_id: val('clSite') || null, label: val('clLabel'), kind: val('clKind') });
      else if (act === 'calremove') await api('POST', `/api/governance/roles/calendar/${encodeURIComponent(b.dataset.id)}/remove`, { reason });
      else if (act === 'end') await api('POST', `/api/governance/roles/assignments/${encodeURIComponent(b.dataset.id)}/end`, { reason });
      else if (act === 'revoke') await api('POST', `/api/governance/roles/deputies/${encodeURIComponent(b.dataset.id)}/revoke`, { reason });
      else if (act === 'retire') await api('POST', `/api/governance/roles/matrix/${encodeURIComponent(b.dataset.id)}/retire`, { reason });
      await load(); say(t.saved, true);
    } catch (e) { say(e.message); }
  });
  const langSel = document.getElementById('gpLang'); if (langSel) langSel.addEventListener('change', () => { if (d) render(); });
  load();
})();
