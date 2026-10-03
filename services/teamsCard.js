'use strict';
// Teams SLA alerts (2026-10-03) — PURE: one card per SDP group, posted to the group's
// channel through a Teams "Workflows" webhook (the payload shape that flow expects:
// {type:'message', attachments:[{contentType: adaptive card, content}]}). French text.

const SECTIONS = [
  ['fr_breach',  '🔴 1re réponse dépassée',     'Attention'],
  ['res_breach', '🔴 Résolution dépassée',      'Attention'],
  ['fr_soon',    '🟠 1re réponse bientôt due',  'Warning'],
  ['res_soon',   '🟡 Résolution bientôt due',   'Warning'],
  ['unassigned', '⚪ Non assigné',              'Default'],
];

/** API base …/app/<portal>/api/v3 → UI link …/app/<portal>/ui/requests/<id>/details */
function ticketUrl(apiBaseUrl, id) {
  const base = String(apiBaseUrl || '').replace(/\/+$/, '').replace(/\/api\/v3$/, '');
  return `${base}/ui/requests/${encodeURIComponent(String(id))}/details`;
}

function _dur(m) {
  const a = Math.abs(Math.round(m));
  if (a <= 90) return `${a} min`;
  return `${Math.floor(a / 60)} h ${String(a % 60).padStart(2, '0')}`;
}
// Markdown inside a TextBlock: brackets/parentheses in a subject would break the link syntax.
const _safe = (s) => String(s == null ? '' : s).replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')')).replace(/[*_`]/g, ' ').trim();

function _when(a) {
  if (a.kind === 'unassigned') return `sans technicien depuis ${_dur(a.minutes)}`;
  if (a.minutes == null) return '';
  return a.minutes < 0 ? `dépassé de ${_dur(a.minutes)}` : `reste ${_dur(a.minutes)}`;
}

function buildGroupCard(group, alerts, opts = {}) {
  const max = opts.maxTickets || 15;
  const body = [
    { type: 'TextBlock', size: 'Medium', weight: 'Bolder', wrap: true, text: `⏰ SLA — ${_safe(group)}` },
    { type: 'TextBlock', isSubtle: true, spacing: 'None', wrap: true,
      text: `${alerts.length} ticket(s) demandent votre attention` },
  ];
  let shown = 0;
  for (const [kind, title, color] of SECTIONS) {
    const list = alerts.filter(a => a.kind === kind);
    if (!list.length || shown >= max) continue;
    body.push({ type: 'TextBlock', weight: 'Bolder', color, spacing: 'Medium', wrap: true, text: `${title} (${list.length})` });
    for (const a of list) {
      if (shown >= max) break;
      const who = a.technician ? ` · ${_safe(a.technician)}` : '';
      body.push({ type: 'TextBlock', spacing: 'Small', wrap: true,
        text: `[#${_safe(a.display_id)}](${ticketUrl(opts.apiBaseUrl, a.request_id)}) **${a.p}** · ${_safe(a.subject)}${who} — ${_when(a)}` });
      shown++;
    }
  }
  if (alerts.length > shown) body.push({ type: 'TextBlock', isSubtle: true, wrap: true, text: `+ ${alerts.length - shown} autres` });
  return {
    type: 'message',
    attachments: [{
      contentType: 'application/vnd.microsoft.card.adaptive',
      contentUrl: null,
      content: { $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4', body, msteams: { width: 'Full' } },
    }],
  };
}

module.exports = { buildGroupCard, ticketUrl, SECTIONS };
