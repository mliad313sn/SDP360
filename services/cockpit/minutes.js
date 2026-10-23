'use strict';
// Step 8 — the automatic MINUTES of a meeting: one self-contained HTML document (inline styles, no script, every
// value escaped) used as is for the screen, the PDF (services/reportRender.js) and the e-mail (services/mailer.js).
// It quotes the agenda frozen at the start, the time spent on each point, the notes, the decisions and the actions.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const RAG = { green: 'Dans l’objectif', amber: 'À surveiller', red: 'Hors objectif' };
const SOURCE = { incident: 'incident', metric: 'indicateur', issue: 'problème', rfi: 'demande', project: 'projet', decision: 'décision', free: '—' };
const fmt = (v, unit) => (v == null ? '—' : (Math.round(Number(v) * 10) / 10).toLocaleString('fr-FR') + (unit === '%' ? ' %' : ''));
const hm = (iso) => (iso ? iso.slice(11, 16) : '—');
const mins = (a, b) => (a && b ? Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60000)) : null);

const CSS = 'body{font-family:Segoe UI,Arial,sans-serif;color:#2A2A2A;font-size:14px;line-height:1.5;max-width:820px;margin:24px auto;padding:0 16px}' +
  'h1{font-size:22px;margin:0 0 4px}h2{font-size:16px;margin:22px 0 6px;border-bottom:1px solid #E2E5EA;padding-bottom:4px}' +
  'table{border-collapse:collapse;width:100%;font-size:13px;margin:6px 0}th,td{text-align:left;padding:5px 7px;border-bottom:1px solid #E2E5EA;vertical-align:top}' +
  'th{color:#666;font-weight:600;font-size:12px}.meta{color:#666}.note{white-space:pre-wrap;background:#F4F5F7;padding:8px 10px;border-radius:6px}';

function sectionFigures(s) {
  const d = s.data || {};
  if (d.error) return `<p class="meta">${esc(d.error)}</p>`;
  if (s.kind === 'kpi') {
    return '<table><tr><th>Indicateur</th><th>Valeur</th><th>Mois précédent</th><th>État</th></tr>' + (d.items || []).map(it =>
      `<tr><td>${esc((it.label && (it.label.fr || it.label.en)) || it.key)}</td><td>${esc(fmt(it.value, it.unit))}</td><td>${esc(fmt(it.prev, it.unit))}</td><td>${esc(it.rag ? RAG[it.rag] : (it.value == null ? 'Non mesuré' : 'Sans cible'))}</td></tr>`).join('') + '</table>';
  }
  if (s.kind === 'incidents') {
    if (!d.open) return '<p>Aucun incident majeur en cours.</p>';
    return '<ul>' + d.items.map(i => `<li>${esc(i.title)} — ${esc(i.site)}${i.age_hours != null ? ` · ouvert depuis ${esc(i.age_hours)} h` : ''}${i.rca_done ? ' · analyse de cause rédigée' : ''}</li>`).join('') + '</ul>';
  }
  if (s.kind === 'decisions') {
    if (!d.pending) return '<p>Aucune décision en attente.</p>';
    const k = { council: 'Escalade', cab: 'Changement', late: 'Actions en retard' };
    return '<ul>' + d.items.map(i => `<li>${esc(k[i.kind] || i.kind)} : ${esc(i.title)}${i.site ? ' — ' + esc(i.site) : ''}${i.age_days != null ? ` · ${esc(i.age_days)} j` : ''}</li>`).join('') + '</ul>';
  }
  if (s.kind === 'actions') {
    return `<p>${esc(d.total || 0)} action(s) en retard, dont ${esc(d.over30 || 0)} de plus de 30 jours.</p>` +
      (d.oldest && d.oldest.length ? '<ul>' + d.oldest.map(a => `<li>${esc(a.title)} — ${esc(a.site_name)} · ${esc(a.days_late)} j</li>`).join('') + '</ul>' : '');
  }
  return '';
}
function sectionOwn(s) {
  if (s.error) return `<p class="meta">${esc(s.error)}</p>`;
  if (s.kind === 'followup') return s.actions && s.actions.length ? '<ul>' + s.actions.map(a => `<li>${esc(a.title)} — ${esc(a.owner || 'sans responsable')}${a.due_date ? ' · échéance ' + esc(a.due_date) : ''}${a.late ? ' · en retard' : ''}</li>`).join('') + '</ul>' : '<p>Aucune action ouverte.</p>';
  if (s.kind === 'rfis') return s.rfis && s.rfis.length ? '<ul>' + s.rfis.map(r => `<li>${esc(r.title)} — ${esc(r.status)}${r.score != null ? ' · score ' + esc(r.score) : ''}</li>`).join('') + '</ul>' : '<p>Aucune demande en attente.</p>';
  if (s.kind === 'portfolio') return s.nodes && s.nodes.length ? '<ul>' + s.nodes.map(n => `<li>${esc(n.title)} (${esc(n.kind)}) — ${esc(n.status === 'late' ? 'en retard' : 'à risque')}${n.due_date ? ' · échéance ' + esc(n.due_date) : ''}</li>`).join('') + '</ul>' : '<p>Aucun jalon en retard ou à risque.</p>';
  if (s.kind === 'topic') return s.text ? `<p>${esc(s.text)}</p>` : '';
  return '';
}

/**
 * @param x { cadence, session, items, decisions, actions, siteName }
 */
function render(x) {
  const { cadence, session, items = [], decisions = [], actions = [] } = x;
  const agenda = (session.agenda && session.agenda.sections) || [];
  const dur = mins(session.started_at, session.ended_at);
  let body = `<h1>${esc(cadence.title)} — ${esc(session.held_on)}</h1>` +
    `<p class="meta">Procès-verbal généré automatiquement · ${esc(x.siteName || (session.agenda && session.agenda.site ? session.agenda.site.name : 'ensemble du groupe'))} · ` +
    `début ${esc(hm(session.started_at))}, fin ${esc(hm(session.ended_at))}${dur != null ? ` (${dur} min)` : ''} · chiffres arrêtés au début de la réunion (${esc((session.agenda && session.agenda.generated_at || '').slice(0, 16).replace('T', ' '))} UTC)</p>`;
  if (cadence.participants && cadence.participants.length) body += `<p><b>Participants prévus :</b> ${cadence.participants.map(p => esc(p.name) + (p.role ? ' (' + esc(p.role) + ')' : '')).join(', ')}</p>`;
  agenda.forEach((s, i) => {
    const it = items.find(x2 => x2.seq === i + 1) || {};
    const spent = mins(it.started_at, it.ended_at);
    body += `<h2>${i + 1}. ${esc(s.title)}${spent != null ? ` <span class="meta">— ${spent} min${s.minutes ? ' / ' + s.minutes + ' prévues' : ''}</span>` : (it.started_at ? '' : ' <span class="meta">— non traité</span>')}</h2>`;
    body += s.widget ? sectionFigures(s) : sectionOwn(s);
    if (it.notes) body += `<div class="note">${esc(it.notes)}</div>`;
    const dec = decisions.filter(d => Number(d.item_seq) === i + 1);
    if (dec.length) body += '<p><b>Décisions</b></p><ul>' + dec.map(d => `<li>${esc(d.text)}${d.owner ? ' — ' + esc(d.owner) : ''}</li>`).join('') + '</ul>';
    const act = actions.filter(a => Number(a.item_seq) === i + 1);
    if (act.length) body += '<p><b>Actions</b></p><ul>' + act.map(a => `<li>${esc(a.title)} — ${esc(a.owner || 'sans responsable')}${a.due_date ? ' · échéance ' + esc(a.due_date) : ''}${a.source_kind && a.source_kind !== 'free' ? ' · rattachée à : ' + esc(SOURCE[a.source_kind] || a.source_kind) + (a.source_ref ? ' ' + esc(a.source_ref) : '') : ''}</li>`).join('') + '</ul>';
  });
  body += '<h2>Récapitulatif des actions</h2>' + (actions.length
    ? '<table><tr><th>Action</th><th>Responsable</th><th>Échéance</th><th>Rattachée à</th></tr>' + actions.map(a => `<tr><td>${esc(a.title)}</td><td>${esc(a.owner || '—')}</td><td>${esc(a.due_date || '—')}</td><td>${esc(a.source_kind && a.source_kind !== 'free' ? (SOURCE[a.source_kind] || a.source_kind) + (a.source_ref ? ' ' + a.source_ref : '') : '—')}</td></tr>`).join('') + '</table>'
    : '<p>Aucune action décidée.</p>');
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>${esc(cadence.title)} — ${esc(session.held_on)}</title><style>${CSS}</style></head><body>${body}</body></html>`;
}

module.exports = { render, esc };
