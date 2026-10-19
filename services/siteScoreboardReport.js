'use strict';

/**
 * services/siteScoreboardReport.js — PURE coordinator-scoreboard email composer.
 *
 * Renders the FULL operational leaderboard (rank · site · global · 4 dims · Δ)
 * as an HTML table, with the recipient coordinator's own site highlighted, a
 * "où se situe votre site" line, and a method + coverage note. Plain FR. NO
 * money, NO '$' glyph (the 4 dims are 0-100 scores, not amounts). No DB, no I/O.
 *
 * @param {{rows:Array, fleet_avg:number|null, most_improved:object|null, needs_attention:object|null}} scoreboard
 *        the result of services/siteScoreboard.buildSiteScoreboard(...)
 * @param {{period:string, highlightSite:string}} opts
 * @returns {{subject:string, html:string}}
 */

const FR_MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet',
  'août', 'septembre', 'octobre', 'novembre', 'décembre'];

function monthLabel(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(period || ''));
  if (!m) return String(period || '');
  const idx = Number(m[2]) - 1;
  return (FR_MONTHS[idx] ? FR_MONTHS[idx] + ' ' : '') + m[1];
}

// RAG → background colour (soft), for both the global pill and the dim cells.
const RAG_BG = { green: '#e6f4ea', amber: '#fef3d6', red: '#fde3e1' };
const RAG_FG = { green: '#1b7a3d', amber: '#8a5b00', red: '#a01f1a' };

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function ragOf(v) { return v == null ? null : require('./kpiRag').rag(v, 'site-composite').toLowerCase(); }

function dimCell(v) {
  if (v == null) return '<td style="text-align:center;color:#94a3b8">—</td>';
  const rag = ragOf(v);
  return `<td style="text-align:center;background:${RAG_BG[rag]};color:${RAG_FG[rag]};font-weight:600">${v}</td>`;
}

function deltaStr(d) {
  if (d == null) return '—';
  if (d > 0) return '▲ +' + d;
  if (d < 0) return '▼ ' + d; // d already negative
  return '±0';
}

function buildScoreboardDigest(scoreboard, { period, highlightSite } = {}) {
  const sb = scoreboard || {};
  const rows = sb.rows || [];
  const monthTxt = monthLabel(period);
  const subject = `Scoreboard opérationnel — ${monthTxt} (${period})`;

  const bodyRows = rows.map((r) => {
    const you = r.code === highlightSite;
    const rank = r.rank == null ? '—' : String(r.rank);
    const applicable = r.applicable && r.score != null;
    const scoreCell = applicable
      ? `<td style="text-align:center;font-weight:700;background:${RAG_BG[r.rag]};color:${RAG_FG[r.rag]}">${r.score}</td>`
      : '<td style="text-align:center;color:#94a3b8;font-style:italic">non applicable</td>';
    const d = r.dims || {};
    const dimVal = (k) => (d[k] && d[k].value != null ? d[k].value : null);
    const nameCell = you
      ? `<td data-you="1" style="font-weight:700"><span style="background:#1E293B;color:#fff;border-radius:3px;padding:1px 6px;font-size:0.72rem;margin-right:6px">votre site</span>${esc(r.name)}</td>`
      : `<td>${esc(r.name)}</td>`;
    const rowStyle = you ? ' style="background:#eef2ff"' : '';
    return `<tr${rowStyle}>
      <td style="text-align:center;color:#64748b">${rank}</td>
      ${nameCell}
      ${scoreCell}
      ${dimCell(dimVal('helpdesk'))}
      ${dimCell(dimVal('inspections'))}
      ${dimCell(dimVal('meetings'))}
      ${dimCell(dimVal('assets'))}
      <td style="text-align:center">${deltaStr(r.delta)}</td>
    </tr>`;
  }).join('\n');

  const fleet = sb.fleet_avg == null ? '—' : sb.fleet_avg;
  const improved = sb.most_improved ? esc(sb.most_improved.name) : '—';
  const attention = sb.needs_attention ? esc(sb.needs_attention.name) : '—';
  const yourRow = rows.find((r) => r.code === highlightSite);
  const yourLine = yourRow
    ? (yourRow.applicable && yourRow.score != null
      ? `Où se situe votre site : <strong>${esc(yourRow.name)}</strong> — score global <strong>${yourRow.score}</strong>${yourRow.rank ? ` (rang ${yourRow.rank})` : ''}.`
      : `Où se situe votre site : <strong>${esc(yourRow.name)}</strong> — <em>non applicable</em> ce mois (données insuffisantes).`)
    : '';

  const html = `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="font-family:Arial,Helvetica,sans-serif;color:#1f2937;font-size:14px">
  <h2 style="color:#1E293B;margin:0 0 4px">Scoreboard opérationnel des sites</h2>
  <div style="color:#64748b;margin-bottom:12px">${esc(monthTxt)}</div>

  <p>${yourLine}</p>

  <table cellspacing="0" cellpadding="6" style="border-collapse:collapse;width:100%;font-size:13px">
    <thead>
      <tr style="background:#1E293B;color:#fff">
        <th style="text-align:center">Rang</th>
        <th style="text-align:left">Site</th>
        <th style="text-align:center">Global</th>
        <th style="text-align:center">Helpdesk</th>
        <th style="text-align:center">Inspections</th>
        <th style="text-align:center">Réunions</th>
        <th style="text-align:center">Actifs</th>
        <th style="text-align:center">Δ</th>
      </tr>
    </thead>
    <tbody>
${bodyRows}
    </tbody>
  </table>

  <div style="margin-top:12px;color:#475569">
    Moyenne de la flotte : <strong>${fleet}</strong> ·
    Plus forte progression : <strong>${improved}</strong> ·
    À surveiller : <strong>${attention}</strong>
  </div>

  <p style="margin-top:16px;color:#64748b;font-size:12px;line-height:1.5">
    <strong>Méthode.</strong> Le score global est une moyenne pondérée de 4 dimensions —
    <em>helpdesk 40&nbsp;% · inspections 20&nbsp;% · réunions 20&nbsp;% · actifs 20&nbsp;%</em> —
    renormalisée sur les seules dimensions mesurées (couverture). Une dimension sans donnée
    affiche «&nbsp;—&nbsp;» et n'est pas comptée ; un site sans aucune donnée est
    <em>non applicable</em>. Vert ≥ 75, ambre ≥ 55, rouge &lt; 55. Fenêtre : mois courant.
  </p>
</body></html>`;

  return { subject, html };
}

module.exports = { buildScoreboardDigest };
