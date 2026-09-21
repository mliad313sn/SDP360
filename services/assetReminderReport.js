'use strict';
// Asset engagement reminders (2026-09-18) — PURE composer, French, NO amounts.
//   buildAssetRecap({ site, followups, baseUrl, weekLabel, year, week, labels }) → { subject, html, attachments }
//   buildNewAssetAlert({ site, rows, baseUrl, date, labels })                   → { subject, html, attachments: [] }
// Every asset field is untrusted → escapeHtml. Links only when baseUrl is set AND
// the site folds to exactly ONE asset label (a multi-label link would open a
// smaller list than the count promises — same rule as the weekly e-mail).
const { NAVY, TEAL, INK, MUTED, BORDER, WASH, FONT, escapeHtml } = require('./reportTemplates/_primitives');
const tableExcel = require('./tableExcel');

// num(v) coerces via `+v` — `+null === 0`, so a genuinely unmeasured count
// (null/undefined/'') would render as a false "0". countText/countNum treat
// that case as "—" instead, while a REAL 0 still renders as "0".
function countNum(v) {
  return (v != null && v !== '' && Number.isFinite(+v)) ? +v : null;
}
function countText(v) {
  const n = countNum(v);
  return n === null ? '—' : String(n);
}

const LISTS = [
  ['no_tag', 'Sans QR code', 'Sans QR code', '#hygiene', 'no_asset_tag'],
  ['no_date', 'Sans date d’acquisition', 'Sans date', '#hygiene', 'no_age'],
  ['no_cost', 'Sans coût d’achat', 'Sans cout', '#hygiene', 'no_cost'],
  ['unassigned', 'Non assigné à un utilisateur', 'Sans utilisateur', '#inventory', null],
];

// ── colour presentation (2026-09-18) ─────────────────────────────────────────
// Same visual language as the weekly e-mail's « Parc informatique » block
// (services/reportTemplates/weekly.js): violet header band, tinted count tiles,
// one accent per list, coloured title bars, zebra rows. Local constants — the
// shared _primitives.js is pinned by the monthly goldens.
const PARC = '#7C3AED';
const ZEBRA = '#F8FAFC';
// accent + tint per list: new = teal (good news to qualify), unassigned = amber,
// no cost = violet, no date = red.
const LIST_STYLE = {
  new:        { accent: '#0D9488', tint: '#F0FDFA' },
  no_tag:     { accent: '#0D9488', tint: '#F0FDFA' },   // same teal as the daily new-hardware alert
  unassigned: { accent: '#D97706', tint: '#FFFBEB' },
  no_cost:    { accent: '#7C3AED', tint: '#F5F3FF' },
  no_date:    { accent: '#DC2626', tint: '#FEF2F2' },
};

/** A coloured count tile (table-based). A null count is a grey "—" on a neutral tint. */
function _tile(label, value, accent, tint) {
  const isNull = value === '—';
  const c = isNull ? MUTED : accent;
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr>
<td style="background:${isNull ? '#F1F5F9' : tint};border-left:4px solid ${c};padding:8px 10px;vertical-align:top;">
<div style="font-family:${FONT};font-size:22px;font-weight:bold;color:${c};line-height:1.2;">${escapeHtml(value)}</div>
<div style="font-family:${FONT};font-size:11px;color:${INK};line-height:1.35;padding-top:3px;">${escapeHtml(label)}</div>
</td></tr></table>`;
}
function _tileRow(cells) {
  const w = Math.floor(100 / Math.max(cells.length, 1));
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;margin:0 0 14px 0;"><tr>${
    cells.map((c) => `<td width="${w}%" style="width:${w}%;padding:0 6px 0 0;vertical-align:top;">${c}</td>`).join('')}</tr></table>`;
}
/** A white section with a full coloured title bar. Title escaped here. */
function _section(title, bodyHtml, accent) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background:#FFFFFF;border:1px solid ${BORDER};border-radius:6px;margin:0 0 14px 0;">
<tr><td style="background:${accent};padding:8px 14px;border-radius:6px 6px 0 0;">
<div style="font-family:${FONT};font-size:12px;font-weight:bold;color:#FFFFFF;letter-spacing:0.6px;">${escapeHtml(title)}</div>
</td></tr>
<tr><td style="padding:10px 12px 12px 12px;">
${bodyHtml}
</td></tr></table>`;
}
/** The violet header band that opens both e-mails. */
function _band(title, subtitle) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;margin:0 0 14px 0;">
<tr><td style="background:${PARC};padding:14px 16px;border-radius:6px;">
<div style="font-family:${FONT};font-size:18px;font-weight:bold;color:#FFFFFF;line-height:1.25;">${escapeHtml(title)}</div>
<div style="font-family:${FONT};font-size:12px;color:#EDE9FE;padding-top:3px;">${subtitle}</div>
</td></tr></table>`;
}

const COLS = [['asset_name', 'Nom'], ['product_type', 'Type'], ['manufacturer', 'Fabricant'], ['serial_number', 'N° série'],
  ['state', 'État'], ['user_name', 'Utilisateur'], ['department', 'Département'], ['acquisition_date', 'Date d’acquisition']];

function _link(baseUrl, labels, hash, kind) {
  if (!baseUrl || !Array.isArray(labels) || labels.length !== 1) return null;
  return `${baseUrl}/assets.html?site=${encodeURIComponent(labels[0])}${kind ? '&kind=' + encodeURIComponent(kind) : ''}${hash}`;
}
function _table(rows, withSeen, accent = TEAL) {
  const th = (t) => `<th style="text-align:left;padding:5px 6px;background:${accent};color:#FFFFFF;font-family:${FONT};font-size:11px;font-weight:bold;">${escapeHtml(t)}</th>`;
  const td = (t) => `<td style="padding:4px 6px;border-bottom:1px solid #F1F3F6;font-family:${FONT};font-size:12px;color:${INK};">${escapeHtml(t == null || t === '' ? '—' : t)}</td>`;
  const head = COLS.map(c => th(c[1])).join('') + th('Coût renseigné') + (withSeen ? th('Vu le') : '');
  const body = rows.map((r, i) => `<tr style="background:${i % 2 ? ZEBRA : '#FFFFFF'};">${COLS.map(c => td(r[c[0]])).join('')}${td(r.has_cost ? 'Oui' : 'Non')}${withSeen ? td(r.first_seen_date) : ''}</tr>`).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr>${head}</tr>${body}</table>`;
}
function _xlsxRows(rows, withSeen) {
  return (rows || []).map(r => {
    const o = {};
    for (const [k, h] of COLS) o[h] = r[k] == null ? '' : r[k];
    o['Coût renseigné'] = r.has_cost ? 'Oui' : 'Non';
    if (withSeen) o['Vu le'] = r.first_seen_date || '';
    return o;
  });
}
function _shell(inner) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${WASH};">
<tr><td align="center" style="padding:16px 10px;"><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;"><tr><td>
${inner}
<div style="font-family:${FONT};font-size:11px;color:${MUTED};padding:4px 2px;">Endeavour Mining &middot; IT Operations &middot; message automatique du SDP Dashboard. Corrigez ces fiches dans l&rsquo;inventaire (AssetExplorer) ; elles disparaissent de cette liste apr&egrave;s la synchronisation nocturne.</div>
</td></tr></table></td></tr></table>`;
}
const _linkHtml = (href, accent) => (href
  ? `<div style="padding-top:8px;"><a href="${escapeHtml(href)}" style="color:${accent};font-weight:bold;font-family:${FONT};font-size:12px;">Voir dans Assets</a></div>`
  : '');

function buildAssetRecap({ site, followups, baseUrl, weekLabel, year, week, labels } = {}) {
  const f = followups || {};
  const c = f.counts || {};
  const subject = `Suivi du parc informatique - ${site} - ${weekLabel || ''}`.trim();
  const kpis = _tileRow(LISTS.map(([k, label]) => _tile(label, countText(c[k]), LIST_STYLE[k].accent, LIST_STYLE[k].tint)));
  const blocks = LISTS.map(([k, label, , hash, kind]) => {
    const rows = Array.isArray(f[k]) ? f[k] : [];
    if (!rows.length) return '';
    const { accent } = LIST_STYLE[k];
    const href = _link(baseUrl, labels, hash, kind);
    const cn = countNum(c[k]);
    const more = cn !== null && cn > 20 ? `<div style="font-family:${FONT};font-size:11px;color:${MUTED};padding-top:4px;">20 premi&egrave;res lignes sur ${escapeHtml(countText(c[k]))} &mdash; liste compl&egrave;te en pi&egrave;ce jointe.</div>` : '';
    return _section(`${label} (${countText(c[k])})`, _table(rows.slice(0, 20), k === 'new', accent) + more + _linkHtml(href, accent), accent);
  }).join('\n');
  const sub = `${escapeHtml(site)}${weekLabel ? ` &middot; ${escapeHtml(weekLabel)}` : ''}`;
  const html = _shell(_band('Suivi du parc informatique', sub) + kpis + '\n' + blocks);
  const sheets = LISTS.filter(([k]) => Array.isArray(f[k]) && f[k].length)
    .map(([k, , sheet]) => ({ name: sheet, rows: _xlsxRows(f[k], k === 'new') }));
  // Filename: sanitise the site code (never trust it verbatim into a header/attachment
  // name) and fall back to a clean name when year/week aren't both supplied — a
  // '-undefined-Wundefined.xlsx' tail would look broken to the recipient.
  const siteSlug = String(site || '').replace(/[^A-Za-z0-9_-]/g, '_');
  const filename = (year != null && week != null)
    ? `assets-suivi-${siteSlug}-${year}-W${String(week).padStart(2, '0')}.xlsx`
    : `assets-suivi-${siteSlug}.xlsx`;
  return { subject, html, attachments: [{ filename, content: tableExcel.buildWorkbook(sheets) }] };
}

function buildNewAssetAlert({ site, rows, baseUrl, date, labels } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const subject = `Nouveau matériel sans QR code - ${site} - ${date}`;
  const href = _link(baseUrl, labels, '#inventory', null);
  const nw = LIST_STYLE.new;
  const intro = `<div style="font-family:${FONT};font-size:13px;color:${INK};padding-bottom:8px;">${escapeHtml(list.length)} nouvel(le)(s) &eacute;quipement(s) vu(s) pour la premi&egrave;re fois lors de la synchronisation du ${escapeHtml(date)} et sans QR code. Merci de les &eacute;tiqueter et de compl&eacute;ter utilisateur, co&ucirc;t et date d&rsquo;acquisition.</div>`;
  const tile = _tileRow([_tile('Nouveau sans QR code', String(list.length), nw.accent, nw.tint), '&nbsp;', '&nbsp;']);
  const sub = `${escapeHtml(site)} &middot; ${escapeHtml(date)}`;
  const html = _shell(_band('Nouveau matériel sans QR code', sub) + tile
    + _section(`Nouveau matériel sans QR code (${list.length})`, intro + _table(list, true, nw.accent) + _linkHtml(href, nw.accent), nw.accent));
  return { subject, html, attachments: [] };
}

module.exports = { buildAssetRecap, buildNewAssetAlert };
