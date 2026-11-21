// PORTFOLIO LOT 6 — portfolio-level Phase 2 page (public/portfolio-phase2.html): monthly resource load vs capacity,
// risk exposure by project, cross-project dependencies (loops, flags), effort scores, and the read-only scenario.
// Each block appears only when its route answers (its switch is on; 404 = hidden). Over the portfolio the reader may
// already read; no amount anywhere. Unknown shows "—", never 0 / green. EN / FR from the shell. No inline handler.
(function () {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dash = (v) => (v == null || v === '' ? '—' : v);
  let lang = 'en';
  try { lang = (window.__shell && window.__shell.shellLang && window.__shell.shellLang()) || 'en'; } catch (_) { lang = 'en'; }
  if (lang === 'fr') document.documentElement.lang = 'fr';
  const TX = {
    en: { title: 'Portfolio capacity and scenarios', intro: 'Resource load against capacity, risk exposure, dependencies between projects, effort scores and a read-only what-if. Thresholds, levels and weights are proposed, not approved policy.',
      cap: 'Monthly resource load', risk: 'Risk exposure by project', deps: 'Dependencies between projects', eff: 'Delivery effort scores', scen: 'Scenario (read-only what-if)',
      skill: 'Skill', month: 'Month', avg: 'Average FTE', capacity: 'Capacity FTE', util: 'Utilisation', projects: 'Projects', cap_unknown: 'Capacity not configured: no colour is given (unknown, not green).', over: 'over capacity',
      project: 'Project', level: 'Exposure', open: 'Open', overdue: 'Overdue', declared: 'Declared', loops: 'Loops', none: 'None.', flagged: 'Flagged dependencies', partial: 'includes a project you cannot see', view_partial: 'Partial view: some projects with demand are outside what you can read, and capacity is group-wide, so no capacity colour is shown.',
      score: 'Score', band: 'Suggested band', mismatch: 'differs', shift: 'Shift (months)', exclude: 'Leave out', run: 'Run the scenario', baseline: 'Baseline', scenario: 'Scenario', delta: 'Change',
      conflicts: 'Dependency conflicts', over_cells: 'Over-capacity months', ro: 'Nothing is saved: the projects, dates and demand stay as they are.', nothing: 'No Phase 2 view is switched on for this portfolio.' },
    fr: { title: 'Capacité du portefeuille et scénarios', intro: 'Charge en ressources face à la capacité, exposition aux risques, dépendances entre projets, scores d’effort et une simulation en lecture seule. Seuils, niveaux et pondérations sont proposés, pas une politique approuvée.',
      cap: 'Charge mensuelle en ressources', risk: 'Exposition aux risques par projet', deps: 'Dépendances entre projets', eff: 'Scores d’effort de réalisation', scen: 'Scénario (simulation en lecture seule)',
      skill: 'Compétence', month: 'Mois', avg: 'ETP moyen', capacity: 'Capacité ETP', util: 'Utilisation', projects: 'Projets', cap_unknown: 'Capacité non configurée : aucune couleur n’est donnée (inconnu, pas vert).', over: 'au-delà de la capacité',
      project: 'Projet', level: 'Exposition', open: 'Ouverts', overdue: 'En retard', declared: 'Déclaré', loops: 'Boucles', none: 'Aucune.', flagged: 'Dépendances signalées', partial: 'inclut un projet que vous ne voyez pas', view_partial: 'Vue partielle : des projets avec une demande sont hors de votre périmètre et la capacité est celle du groupe, donc aucune couleur de capacité n’est donnée.',
      score: 'Score', band: 'Tranche suggérée', mismatch: 'diffère', shift: 'Décalage (mois)', exclude: 'Écarter', run: 'Lancer le scénario', baseline: 'Référence', scenario: 'Scénario', delta: 'Écart',
      conflicts: 'Conflits de dépendances', over_cells: 'Mois au-delà de la capacité', ro: 'Rien n’est enregistré : projets, dates et besoins restent inchangés.', nothing: 'Aucune vue de la phase 2 n’est activée pour ce portefeuille.' },
  };
  const T = TX[lang === 'fr' ? 'fr' : 'en'];
  // PMO UX — exposure levels and bands read as labels (lib/ppmLabels.js); the back link follows the page language
  const FL = lang === 'fr' ? 'fr' : 'en';
  const lab = (g, c) => (c == null || c === '' ? '—' : window.PpmLabels ? window.PpmLabels.label(g, c, FL) : String(c));
  const back = document.getElementById('p2Back'); if (back) back.textContent = FL === 'fr' ? '← Portefeuille' : '← Portfolio';
  $('p2Title').textContent = T.title; $('p2Intro').textContent = T.intro;
  [['p2CapH', 'cap'], ['p2RiskH', 'risk'], ['p2DepsH', 'deps'], ['p2EffH', 'eff'], ['p2ScenH', 'scen']].forEach(([id, k]) => { $(id).textContent = T[k]; });
  async function api(path, o) {
    const r = await fetch(path, Object.assign({ credentials: 'same-origin' }, o || {}));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || ('HTTP ' + r.status)); e.status = r.status; throw e; }
    return j;
  }
  const table = (cap, heads, rows) => `<div class="p2-scroll" tabindex="0" role="region" aria-label="${esc(cap)}"><table class="p2-table"><caption class="p2-sr">${esc(cap)}</caption><thead><tr>${heads.map((h) => `<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;
  const names = {};
  let shown = 0;
  const show = (id) => { $(id).hidden = false; shown += 1; };

  async function cap() {
    const d = await api('/api/governance/ppm/portfolio/capacity'); show('p2Cap');
    const rows = (d.cells || []).map((c) => `<tr><td>${esc(c.skill)}</td><td>${esc(c.month)}</td><td class="p2-num">${esc(c.avg_fte)}</td><td class="p2-num">${esc(dash(c.capacity_fte))}</td><td class="p2-num">${esc(c.utilisation_pct == null ? '—' : c.utilisation_pct + ' %')}</td><td><span class="p2-rag p2-${esc(c.rag)}">${esc(lab('capacity', c.rag))}</span></td><td>${esc(c.projects.length)}</td></tr>`);
    $('p2CapBody').innerHTML = (d.capacity_configured ? '' : `<p class="p2-note">${esc(T.cap_unknown)}</p>`) + (d.view_partial ? `<p class="p2-note">${esc(T.view_partial)}</p>` : '') + `<p>${esc(d.over)} ${esc(T.over)}</p>` + (rows.length ? table(T.cap, [T.skill, T.month, T.avg, T.capacity, T.util, 'RAG', T.projects], rows) : `<p class="p2-note">${esc(T.none)}</p>`);
  }
  async function risk() {
    const d = await api('/api/governance/ppm/portfolio/risk-exposure'); show('p2Risk');
    (d.rows || []).forEach((r) => { names[r.project_id] = `${r.key || ''} — ${r.name || ''}`; });
    const tot = Object.entries(d.totals || {}).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ');
    const rows = (d.rows || []).map((r) => `<tr><td><a href="project.html?id=${encodeURIComponent(r.project_id)}#p2deps">${esc(names[r.project_id])}</a></td><td>${esc(lab('severity', r.level))}</td><td class="p2-num">${esc(r.open)}</td><td class="p2-num">${esc(r.overdue)}</td><td>${esc(dash(r.declared))}</td></tr>`);
    $('p2RiskBody').innerHTML = `<p>${tot}</p><p class="p2-note">${esc(d.mapping && d.mapping.rule)}</p>` + table(T.risk, [T.project, T.level, T.open, T.overdue, T.declared], rows);
  }
  async function deps() {
    const d = await api('/api/governance/ppm/portfolio/dependencies'); show('p2Deps');
    const loops = (d.cycles || []).map((c) => `<li>${c.projects.map((id) => esc(names[id] || '#' + id)).join(' → ')}${c.partial ? ` <em>(${esc(T.partial)})</em>` : ''}</li>`).join('');
    const flags = Object.entries(d.by_code || {}).map(([k, v]) => `${esc(k)}: ${esc(v)}`).join(' · ');
    $('p2DepsBody').innerHTML = `<h3>${esc(T.loops)}</h3>${loops ? `<ul>${loops}</ul>` : `<p class="p2-note">${esc(T.none)}</p>`}<h3>${esc(T.flagged)}: ${esc(d.flagged)}</h3><p class="p2-note">${flags || esc(T.none)}</p>`;
  }
  async function eff() {
    const d = await api('/api/governance/ppm/portfolio/effort'); show('p2Eff');
    (d.rows || []).forEach((r) => { names[r.project_id] = names[r.project_id] || `${r.key || ''} — ${r.name || ''}`; });
    const rows = (d.rows || []).map((r) => `<tr><td>${esc(names[r.project_id])}</td><td class="p2-num">${esc(dash(r.score))}</td><td>${esc(lab('band', r.band))}</td><td>${esc(lab('band', r.declared))}${r.mismatch ? ` — <strong>${esc(T.mismatch)}</strong>` : ''}</td></tr>`);
    $('p2EffBody').innerHTML = `<p class="p2-note">${esc(d.weights_status)}</p>` + table(T.eff, [T.project, T.score, T.band, T.declared], rows);
  }
  async function scen() {
    await api('/api/governance/ppm/portfolio/scenario', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); show('p2Scen');
    const ids = Object.keys(names);
    const rows = ids.map((id) => `<tr><td>${esc(names[id])}</td><td><label class="p2-sr" for="sc-m-${esc(id)}">${esc(T.shift)}</label><input id="sc-m-${esc(id)}" type="number" min="-24" max="24" step="1" value="0"></td><td><label class="p2-sr" for="sc-x-${esc(id)}">${esc(T.exclude)}</label><input id="sc-x-${esc(id)}" type="checkbox"></td></tr>`);
    $('p2ScenBody').innerHTML = `<p class="p2-note">${esc(T.ro)}</p>` + (rows.length ? table(T.scen, [T.project, T.shift, T.exclude], rows) : '') + `<p><button type="button" class="p2-btn" id="scRun">${esc(T.run)}</button></p><div id="scOut" role="status" aria-live="polite"></div>`;
    $('scRun').addEventListener('click', async () => {
      const shifts = []; const exclude = [];
      for (const id of ids) { const m = Number($('sc-m-' + id).value); if (Number.isInteger(m) && m !== 0) shifts.push({ project_id: Number(id), months: m }); if ($('sc-x-' + id).checked) exclude.push(Number(id)); }
      try {
        const r = await api('/api/governance/ppm/portfolio/scenario', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ shifts, exclude }) });
        $('scOut').innerHTML = table(T.scen, ['', T.baseline, T.scenario, T.delta], [
          `<tr><th scope="row">${esc(T.over_cells)}</th><td class="p2-num">${esc(r.baseline.over_capacity_cells)}</td><td class="p2-num">${esc(r.scenario.over_capacity_cells)}</td><td class="p2-num">${esc(r.delta.over_capacity_cells)}</td></tr>`,
          `<tr><th scope="row">${esc(T.conflicts)}</th><td class="p2-num">${esc(r.baseline.dependency_conflicts)}</td><td class="p2-num">${esc(r.scenario.dependency_conflicts)}</td><td class="p2-num">${esc(r.delta.dependency_conflicts)}</td></tr>`]);
      } catch (e) { $('scOut').textContent = e.message; }
    });
  }
  (async () => {
    for (const f of [cap, risk, deps, eff, scen]) { try { await f(); } catch (e) { if (e.status !== 404) $('p2Meta').textContent = e.message; } }
    if (!shown) $('p2Meta').textContent = T.nothing;
  })();
})();
