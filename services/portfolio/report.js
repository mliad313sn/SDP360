'use strict';
// Step 8 — the monthly "state of the portfolio" report: one self-contained HTML document (screen, PDF, e-mail).
// Every status, drift, progress and alert comes from services/portfolio/analysis.js; evidence from the KPI dictionary.

const A = require('./analysis');
const { esc } = require('../cockpit/minutes');

const STATUS = { not_started: 'Pas commencé', on_track: 'En bonne voie', at_risk: 'À risque', late: 'En retard', done: 'Terminé', cancelled: 'Annulé' };
const KIND = { programme: 'Programme', objective: 'Objectif', project: 'Projet', milestone: 'Jalon', deliverable: 'Livrable' };
const CSS = 'body{font-family:Segoe UI,Arial,sans-serif;color:#2A2A2A;font-size:14px;line-height:1.5;max-width:900px;margin:24px auto;padding:0 16px}' +
  'h1{font-size:22px;margin:0 0 4px}h2{font-size:17px;margin:24px 0 6px;border-bottom:2px solid #B4510F;padding-bottom:3px}h3{font-size:15px;margin:14px 0 4px}' +
  'table{border-collapse:collapse;width:100%;font-size:13px}th,td{text-align:left;padding:5px 7px;border-bottom:1px solid #E2E5EA;vertical-align:top}th{color:#666;font-size:12px}' +
  '.meta{color:#666}.late{color:#C0002F;font-weight:600}.risk{color:#9A5200;font-weight:600}.ok{color:#157A2E;font-weight:600}';
const cls = (st) => (st === 'late' ? 'late' : st === 'at_risk' ? 'risk' : st === 'done' || st === 'on_track' ? 'ok' : '');
const pct = (x) => (x == null ? '—' : Math.round(x * 100) + ' %');

/**
 * @param x { nodes, evidence: {id: {...}}, month: 'YYYY-MM', today: 'YYYY-MM-DD' }
 */
function render({ nodes, evidence = {}, month, today }) {
  const idx = A.index(nodes);
  const alerts = A.alerts(nodes, today);
  const first = month + '-01', last = new Date(Date.UTC(+month.slice(0, 4), +month.slice(5, 7), 0)).toISOString().slice(0, 10);
  const ms = nodes.filter(n => n.kind === 'milestone');
  const dueThisMonth = ms.filter(n => n.due_date && n.due_date >= first && n.due_date <= last);
  const deliveredThisMonth = ms.filter(n => n.done_date && n.done_date >= first && n.done_date <= last);
  const late = nodes.filter(n => A.effectiveStatus(n, today) === 'late' && n.kind !== 'programme');
  const budget = nodes.filter(n => n.kind === 'project').reduce((s, n) => ({ b: s.b + (n.budget || 0), sp: s.sp + (n.spent || 0) }), { b: 0, sp: 0 });
  let h = `<h1>État du portefeuille — ${esc(month)}</h1><p class="meta">Généré le ${esc(today)} à partir du portefeuille et du dictionnaire des indicateurs.</p>`;
  h += `<p>${dueThisMonth.length} jalon(s) prévus ce mois, ${deliveredThisMonth.length} livré(s) ce mois · ${late.length} élément(s) en retard · ${alerts.length} alerte(s)` +
    (budget.b ? ` · budget des projets ${Math.round(budget.b).toLocaleString('fr-FR')}, dépensé ${Math.round(budget.sp).toLocaleString('fr-FR')} (${Math.round(100 * budget.sp / budget.b)} %)` : '') + '.</p>';
  for (const prog of idx.kids.get('') || []) {
    h += `<h2>${esc(KIND[prog.kind] || prog.kind)} — ${esc(prog.title)}</h2><p class="meta">Avancement : ${pct(A.progressOf(prog, idx))}${prog.owner ? ' · responsable ' + esc(prog.owner) : ''}</p>`;
    const rows = [];
    const walk = (n, depth) => {
      for (const c of idx.kids.get(n.id) || []) {
        if (c.kind === 'deliverable') continue;
        const st = A.effectiveStatus(c, today), ev = evidence[c.id], dr = A.drift(c);
        rows.push(`<tr><td>${'&nbsp;&nbsp;'.repeat(depth)}${esc(KIND[c.kind])} : ${esc(c.title)}</td><td class="${cls(st)}">${esc(STATUS[st] || st)}</td><td>${esc(c.due_date || '—')}${dr ? ` <span class="meta">(${dr > 0 ? '+' : ''}${dr} j)</span>` : ''}</td>` +
          `<td>${c.kind === 'milestone' ? '' : pct(A.progressOf(c, idx))}</td><td>${ev ? (ev.error ? esc(ev.error) : `${esc(ev.metric)} : ${ev.value == null ? 'non mesuré' : esc(ev.value)}${ev.target != null ? ' / cible ' + esc(ev.target) : ''}${ev.met === true ? ' ✓' : ev.met === false ? ' ✗' : ''}`) : '—'}</td></tr>`);
        walk(c, depth + 1);
      }
    };
    walk(prog, 0);
    h += rows.length ? '<table><tr><th>Élément</th><th>État</th><th>Échéance (glissement)</th><th>Avancement</th><th>Preuve</th></tr>' + rows.join('') + '</table>' : '<p class="meta">Aucun élément.</p>';
  }
  h += '<h2>Alertes</h2>' + (alerts.length ? '<ul>' + alerts.map(a => `<li>${esc(a.text)}</li>`).join('') + '</ul>' : '<p>Aucune alerte.</p>');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>État du portefeuille — ${esc(month)}</title><style>${CSS}</style></head><body>${h}</body></html>`;
}

module.exports = { render, STATUS, KIND };
