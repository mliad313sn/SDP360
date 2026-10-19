'use strict';
// Step 8 — PURE minutes (compte rendu) renderer: session + agenda + per-item timestamps +
// decisions + actions → standalone HTML (e-mail body, PDF via services/reportRender). Text is
// escaped; every figure keeps its metric window; nothing is computed here.
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtV = (v, unit) => v == null ? '—' : (unit === '%' ? `${Math.round(v * 10) / 10} %` : String(Math.round(v * 100) / 100));
const dur = (a, b) => (a && b) ? `${Math.max(0, Math.round((new Date(b) - new Date(a)) / 60000))} min` : '';
const RAG = { GREEN: '#27AE60', AMBER: '#E8A100', RED: '#DC2626', NA: '#b6bdc7' };

function renderMinutes({ cadence, session, decisions = [], actions = [], siteName = null, baseUrl = '' } = {}) {
  const ag = session.agenda || { items: [] };
  const stamps = Object.fromEntries((session.items || []).map(i => [i.id, i]));
  const when = session.started_at || session.scheduled_at;
  const row = (cells) => `<tr>${cells.map(c => `<td style="padding:4px 8px;border-bottom:1px solid #e4e8ee;font-size:13px">${c}</td>`).join('')}</tr>`;
  const head = (cells) => `<tr>${cells.map(c => `<th style="text-align:left;padding:4px 8px;background:#f4f6f7;font-size:12px">${c}</th>`).join('')}</tr>`;
  const sections = ag.items.map(it => {
    const st = stamps[it.id] || {};
    let body = '';
    if (it.kind === 'kpis') body = `<table style="border-collapse:collapse;width:100%">${head(['Indicator', 'Value', 'Window', 'RAG'])}${(it.content || []).map(m => row([esc(m.name), fmtV(m.value, m.unit), esc(m.window || ''), `<span style="color:${RAG[m.rag] || RAG.NA};font-weight:700">${esc(m.rag || 'NA')}</span>`])).join('')}</table>`;
    else if (it.kind === 'incidents') body = (it.content || []).length ? `<table style="border-collapse:collapse;width:100%">${head(['Ticket', 'Subject', 'Site', 'Since'])}${it.content.map(x => row([esc(x.id), esc(x.subject), esc(x.site), esc(String(x.since || '').slice(0, 10))])).join('')}</table>` : '<p>No active major incident.</p>';
    else if (it.kind === 'actions') body = `<p>Open: <b>${it.content.open ?? '—'}</b> · overdue: <b>${it.content.overdue ?? '—'}</b></p>` + ((it.content.list || []).length ? `<ul>${it.content.list.map(a => `<li>${esc(a.title || a.task || a.description)} — ${esc(a.owner || '')} ${a.due_date || a.target_date ? '(due ' + esc(a.due_date || a.target_date) + ')' : ''}</li>`).join('')}</ul>` : '');
    else if (it.kind === 'decisions') body = (it.content || []).length ? `<ul>${it.content.map(d => `<li><b>${esc(d.ref)}</b> ${esc(d.title)} — ${esc(d.owner || '')} ${d.due_date ? '(due ' + esc(d.due_date) + ')' : ''} · ${esc(d.status)}</li>`).join('')}</ul>` : '<p>No pending decision.</p>';
    else if (it.kind === 'rfis') body = (it.content || []).length ? `<ul>${it.content.map(r => `<li><b>${esc(r.ref)}</b> ${esc(r.title)} · ${esc(r.kind)} · score ${esc(r.score)} · ${esc(r.status)}</li>`).join('')}</ul>` : '<p>No request to triage.</p>';
    else if (it.kind === 'trackers') body = (it.content || []).length ? `<ul>${it.content.map(t => `<li>${esc(t.name)} — ${t.score == null ? '—' : Math.round(t.score * 1000) / 10 + ' %'} <span style="color:${RAG[t.rag] || RAG.NA}">${esc(t.rag || '')}</span></li>`).join('')}</ul>` : '<p>No tracker.</p>';
    else if (it.kind === 'portfolio') body = (it.content || []).length ? `<table style="border-collapse:collapse;width:100%">${head(['Objective', 'Status', 'Evidence', 'Slip'])}${it.content.map(x => row([esc(x.name), esc(x.status), x.evidence_pct == null ? '—' : x.evidence_pct + ' %', x.slip_days == null ? '—' : x.slip_days + ' d'])).join('')}</table>` : '<p>No objective.</p>';
    else if (it.kind === 'next') body = `<p>Next session: ${esc(it.content && it.content.next_session || 'to be scheduled')}</p>`;
    const notes = st.notes ? `<p style="white-space:pre-wrap;background:#fffbe6;padding:6px 8px;border-radius:6px">${esc(st.notes)}</p>` : '';
    return `<section style="margin:14px 0"><h3 style="margin:0 0 6px;font-size:15px;color:#3A4A60">${esc(it.title)} <small style="color:#6b7785;font-weight:400">${st.started_at ? esc(String(st.started_at).slice(11, 16)) : ''}${st.ended_at ? ' → ' + esc(String(st.ended_at).slice(11, 16)) + ' · ' + dur(st.started_at, st.ended_at) : ''} (planned ${it.minutes} min)</small></h3>${body}${notes}</section>`;
  }).join('');
  const dec = decisions.length ? `<h3 style="font-size:15px;color:#3A4A60">Decisions taken</h3><ul>${decisions.map(d => `<li><b>${esc(d.ref)}</b> ${esc(d.title)}${d.text ? ' — ' + esc(d.text) : ''} · owner ${esc(d.owner || '—')}${d.due_date ? ' · due ' + esc(d.due_date) : ''}</li>`).join('')}</ul>` : '<h3 style="font-size:15px;color:#3A4A60">Decisions taken</h3><p>None.</p>';
  const act = actions.length ? `<h3 style="font-size:15px;color:#3A4A60">Actions</h3><table style="border-collapse:collapse;width:100%">${head(['Action', 'Owner', 'Due', 'Status', 'Source'])}${actions.map(a => row([esc(a.title), esc(a.owner || '—'), esc(a.due_date || '—'), esc(a.status), esc([a.source_kind, a.source_ref, a.decision_ref].filter(Boolean).join(' '))])).join('')}</table>` : '<h3 style="font-size:15px;color:#3A4A60">Actions</h3><p>None.</p>';
  const title = `${cadence ? cadence.name : 'Session'}${siteName ? ' — ' + siteName : ''} — ${String(when || '').slice(0, 10)}`;
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title></head><body style="font-family:Calibri,Arial,sans-serif;color:#1F2A33;max-width:900px;margin:0 auto;padding:16px">
<h1 style="font-size:20px;color:#3A4A60;margin:0">Minutes — ${esc(title)}</h1>
<p style="color:#6b7785;font-size:12.5px">${session.started_at ? 'Started ' + esc(String(session.started_at).replace('T', ' ').slice(0, 16)) : 'Scheduled ' + esc(String(session.scheduled_at || '').replace('T', ' ').slice(0, 16))}${session.closed_at ? ' · closed ' + esc(String(session.closed_at).replace('T', ' ').slice(0, 16)) : ''} · attendees: ${esc((session.attendees || []).join(', ') || '—')} · agenda generated ${esc(String(ag.generated_at || '').slice(0, 16))}</p>
${sections}${dec}${act}
${session.notes ? `<h3 style="font-size:15px;color:#3A4A60">Notes</h3><p style="white-space:pre-wrap">${esc(session.notes)}</p>` : ''}
<p style="color:#6b7785;font-size:11px;margin-top:24px">Generated by the IT OPS cockpit${baseUrl ? ' — ' + esc(baseUrl) + '/cockpit.html?session=' + esc(session.id) : ''}. Figures carry their window; “—” means not measured.</p>
</body></html>`;
}

module.exports = { renderMinutes };
