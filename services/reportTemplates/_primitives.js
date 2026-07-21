'use strict';
// Shared e-mail primitives for the report templates.
//
// Extracted VERBATIM from services/reportTemplates/coordinator.js so a second
// composer (weekly) can reuse the exact same markup. Every renderer here is
// Outlook-safe: table-based layout, inline styles ONLY, no <script>, no
// external stylesheet, no remote images. Outlook's renderer (Word) drops
// flexbox/grid/CSS custom properties — do not "modernise" this markup.
//
// EVERY free-text field passed in is untrusted Zoho/user input and MUST go
// through escapeHtml. The helper is deliberately NOT called `esc` — CLAUDE.md
// records a real bug where a local `esc` that did not actually escape created
// false safety in review. If you add a field, escape it.

// EDV brand. Red is #DC2626 (Tailwind red-600), NOT the brand #D90038 — see
// CLAUDE.md: the brand red is too heavy for filled surfaces.
const RAG_COLORS = { green: '#16A34A', amber: '#D97706', red: '#DC2626' };

// The SCORE's RAG palette is the user's own dashboard palette, so the score in
// this email reads as the same score they see on screen. Their red is
// `var(--color-accent)` — a CSS custom property, which Outlook's Word renderer
// does NOT resolve (it would paint nothing), so the email uses the source's
// literal REDT fallback instead. All three take a white foreground.
//
// RAG_COLORS and SCORE_RAG stay SEPARATE on purpose: their reds differ
// (#DC2626 vs #c2280f). Merging them into one palette changes the email.
const SCORE_RAG = { green: '#2f7d4f', amber: '#d99a2b', red: '#c2280f' };

const NAVY = '#1E293B';
const TEAL = '#0D9488';
const INK = '#334155';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';
const WASH = '#F8FAFC';
const FONT = "Arial,'Helvetica Neue',Helvetica,sans-serif";

// Declared AFTER MUTED — it reads it as the fallback.
const scoreRagColor = (rag) => SCORE_RAG[String(rag || '').toLowerCase()] || MUTED;

function escapeHtml(value) {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- total-by-construction accessors: a missing block must never throw -------
const obj = (v) => (v && typeof v === 'object' ? v : {});
const arr = (v) => (Array.isArray(v) ? v : []);
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

/** A titled card with a coloured top rule. `bodyHtml` is pre-escaped markup. */
function card(title, bodyHtml, accent = TEAL) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background:#FFFFFF;border:1px solid ${BORDER};border-radius:6px;margin:0 0 14px 0;">
<tr><td style="background:${accent};height:4px;line-height:4px;font-size:0;border-radius:6px 6px 0 0;">&nbsp;</td></tr>
<tr><td style="padding:14px 16px 16px 16px;">
<div style="font-family:${FONT};font-size:12px;font-weight:bold;color:${NAVY};letter-spacing:0.8px;text-transform:uppercase;padding-bottom:10px;">${escapeHtml(title)}</div>
${bodyHtml}
</td></tr></table>`;
}

/** KPI cells, 3 per row. `items` = [{label, value}] — both are escaped here. */
function kpiGrid(items) {
  const cells = arr(items);
  if (!cells.length) return '';
  const rows = [];
  for (let i = 0; i < cells.length; i += 3) rows.push(cells.slice(i, i + 3));
  const html = rows.map((row) => {
    const tds = row.map((it) => `<td width="33%" style="width:33%;padding:4px 8px 10px 0;vertical-align:top;">
<div style="font-family:${FONT};font-size:18px;font-weight:bold;color:${NAVY};line-height:1.2;">${escapeHtml(it.value)}</div>
<div style="font-family:${FONT};font-size:11px;color:${MUTED};line-height:1.4;padding-top:2px;">${escapeHtml(it.label)}</div>
</td>`).join('');
    const pad = row.length < 3
      ? new Array(3 - row.length).fill('<td width="33%" style="width:33%;">&nbsp;</td>').join('')
      : '';
    return `<tr>${tds}${pad}</tr>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${html}</table>`;
}

/** A bulleted list of pre-escaped markup strings. */
function bulletList(items, color = INK) {
  const rows = arr(items).filter(Boolean);
  if (!rows.length) return '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
${rows.map((html) => `<tr>
<td width="12" style="width:12px;vertical-align:top;padding:3px 6px 3px 0;font-family:${FONT};font-size:13px;color:${TEAL};line-height:1.5;">&bull;</td>
<td style="vertical-align:top;padding:3px 0;font-family:${FONT};font-size:13px;color:${color};line-height:1.5;">${html}</td>
</tr>`).join('')}
</table>`;
}

function emptyNote(text) {
  return `<div style="font-family:${FONT};font-size:12px;color:${MUTED};font-style:italic;">${escapeHtml(text)}</div>`;
}

function chip(text, color) {
  return `<span style="display:inline-block;font-family:${FONT};font-size:10px;font-weight:bold;color:#FFFFFF;background:${color};border-radius:9px;padding:2px 7px;margin:0 3px 2px 0;">${escapeHtml(text)}</span>`;
}

module.exports = {
  RAG_COLORS,
  SCORE_RAG,
  scoreRagColor,
  NAVY,
  TEAL,
  INK,
  MUTED,
  BORDER,
  WASH,
  FONT,
  escapeHtml,
  obj,
  arr,
  num,
  card,
  kpiGrid,
  bulletList,
  emptyNote,
  chip,
};
