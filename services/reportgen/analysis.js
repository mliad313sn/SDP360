'use strict';
// Step 9 — the DETERMINISTIC analysis of a report: always available, no AI, no network. It reads the computed figures
// of the sections (services/dashboards/data.js output), extracts the FACTS (the only numbers a commentary may quote,
// also the only input of the AI layer) and writes plain sentences for each commentary section about the figure
// sections placed before it. The tone decides how much is said: direction = what is off target; coordinator and
// technical team = everything, with the actions.

const RAG_FR = { green: 'dans l’objectif', amber: 'à surveiller', red: 'hors objectif' };
const RAG_EN = { green: 'on target', amber: 'to watch', red: 'off target' };
const lbl = (l, lang) => (l && typeof l === 'object' ? (l[lang] || l.fr || l.en || '') : String(l || ''));
const r1 = (v) => (v == null ? null : Math.round(Number(v) * 10) / 10);
function num(v, unit, lang) {
  if (v == null) return lang === 'en' ? 'not measured' : 'non mesuré';
  const s = r1(v).toLocaleString(lang === 'en' ? 'en-GB' : 'fr-FR');
  return unit === '%' ? s + ' %' : s;
}

/** Facts of one widget: [{ section, key, label, value, prev, delta, unit, rag, kind }] — numbers as computed, rounded to 0.1. */
function factsOf(w, data, lang) {
  const out = [], sec = w.id;
  if (!data || data.error) return out;
  if (w.type === 'kpi') for (const it of data.items || []) out.push({ section: sec, kind: 'kpi', key: it.key, label: lbl(it.label, lang), value: r1(it.value), prev: r1(it.prev), delta: r1(it.delta), unit: it.unit || '', rag: it.rag || null });
  if (w.type === 'trend') for (const s of data.series || []) {
    const pts = (s.points || []).filter(p => p.value != null);
    if (pts.length) out.push({ section: sec, kind: 'trend', key: s.key, label: lbl(s.label, lang), value: r1(pts[pts.length - 1].value), prev: r1(pts[0].value), delta: r1(pts[pts.length - 1].value - pts[0].value), unit: s.unit || '', points: pts.length });
  }
  if ((w.type === 'table' || w.type === 'rag-grid') && data.total) (data.columns || []).forEach((c, i) => {
    const t = data.total[i]; if (!t || t.value == null) return;
    const rows = (data.rows || []).map(r => ({ name: r.name, v: r.cells[i] && r.cells[i].value })).filter(r => r.v != null);
    const lowest = rows.sort((a, b) => a.v - b.v)[0];
    out.push({ section: sec, kind: 'table', key: c.key, label: lbl(c.label, lang), value: r1(t.value), unit: c.unit || '', rag: t.rag || null, lowest: lowest ? { name: lowest.name, value: r1(lowest.v) } : null });
  });
  if (w.type === 'events' && w.source === 'incidents') out.push({ section: sec, kind: 'incidents', key: 'incidents.open', label: lang === 'en' ? 'Major incidents in progress' : 'Incidents majeurs en cours', value: data.open || 0, unit: '' });
  if (w.type === 'events' && w.source === 'decisions') out.push({ section: sec, kind: 'decisions', key: 'decisions.pending', label: lang === 'en' ? 'Pending decisions' : 'Décisions en attente', value: data.pending || 0, council: data.council || 0, cab: data.cab || 0, unit: '' });
  if (w.type === 'actions') out.push({ section: sec, kind: 'actions', key: 'actions.overdue', label: lang === 'en' ? 'Overdue actions' : 'Actions en retard', value: data.total || 0, over30: data.over30 || 0, unit: '' });
  if (w.type === 'tracker' && data.overall != null) out.push({ section: sec, kind: 'tracker', key: 'tracker.overall', label: lang === 'en' ? 'IT strategy programmes' : 'Programmes de la stratégie IT', value: data.overall, delta: data.overall_delta, unit: '%' });
  return out;
}

function sentence(f, lang, tone) {
  const en = lang === 'en', RAG = en ? RAG_EN : RAG_FR;
  const d = f.delta == null || f.delta === 0 ? '' : (en ? `, ${f.delta > 0 ? 'up' : 'down'} ${num(Math.abs(f.delta), f.unit === '%' ? '' : f.unit, lang)}${f.unit === '%' ? ' pt' : ''} ${f.kind === 'trend' ? `over ${f.points} periods` : 'on last month'}`
    : `, ${f.delta > 0 ? 'en hausse' : 'en baisse'} de ${num(Math.abs(f.delta), f.unit === '%' ? '' : f.unit, lang)}${f.unit === '%' ? ' point(s)' : ''} ${f.kind === 'trend' ? `sur ${f.points} périodes` : 'par rapport au mois précédent'}`);
  if (f.kind === 'incidents') return f.value ? (en ? `${f.value} major incident(s) in progress.` : `${f.value} incident(s) majeur(s) en cours.`) : (en ? 'No major incident in progress.' : 'Aucun incident majeur en cours.');
  if (f.kind === 'decisions') return f.value ? (en ? `${f.value} decision(s) pending (${f.council} escalation(s), ${f.cab} change(s)).` : `${f.value} décision(s) en attente (${f.council} escalade(s), ${f.cab} changement(s)).`) : (en ? 'No pending decision.' : 'Aucune décision en attente.');
  if (f.kind === 'actions') return f.value ? (en ? `${f.value} overdue action(s), ${f.over30} by more than 30 days.` : `${f.value} action(s) en retard, dont ${f.over30} de plus de 30 jours.`) : (en ? 'No overdue action.' : 'Aucune action en retard.');
  if (f.kind === 'table') return `${f.label} : ${num(f.value, f.unit, lang)}${f.rag ? ` (${RAG[f.rag]})` : ''}` + (f.lowest && tone !== 'direction' ? (en ? `; lowest site: ${f.lowest.name} (${num(f.lowest.value, f.unit, lang)})` : ` ; site le plus bas : ${f.lowest.name} (${num(f.lowest.value, f.unit, lang)})`) : '') + '.';
  return `${f.label} : ${num(f.value, f.unit, lang)}${f.rag ? ` (${RAG[f.rag]})` : ''}${d}.`;
}

/**
 * @param def   validated report template
 * @param data  { widgets: { id: data } } from the dashboard resolver
 * @returns { facts, commentary: { [commentaryId]: [sentences] }, sectionFacts: { [commentaryId]: facts it speaks about } }
 */
function analyse(def, data, { lang, tone } = {}) {
  lang = lang || def.language || 'fr'; tone = tone || def.tone || 'direction';
  const facts = [], commentary = {}, sectionFacts = {};
  let pending = [];
  for (const s of def.sections) {
    if (s.type !== 'commentary') { const f = factsOf(s, (data.widgets || {})[s.id], lang); facts.push(...f); pending.push(...f); continue; }
    sectionFacts[s.id] = pending;
    let use = pending;
    const lines = [];
    if (tone === 'direction') {
      const scored = pending.filter(f => f.rag);
      const off = scored.filter(f => f.rag !== 'green');
      if (scored.length) lines.push(lang === 'en' ? `${scored.length - off.length} of ${scored.length} indicators on target.` : `${scored.length - off.length} indicateur(s) sur ${scored.length} dans l’objectif.`);
      use = pending.filter(f => !f.rag || f.rag !== 'green');
    }
    for (const f of use) lines.push(sentence(f, lang, tone));
    commentary[s.id] = lines.length ? lines : [lang === 'en' ? 'Nothing to report on these figures.' : 'Rien à signaler sur ces chiffres.'];
    pending = [];
  }
  return { facts, commentary, sectionFacts };
}

module.exports = { analyse, factsOf, sentence };
