'use strict';
// Asset engagement reminders (2026-09-18) — PURE composer, French, NO amounts.
//   buildAssetRecap({ site, followups, baseUrl, weekLabel, year, week, labels }) → { subject, html, attachments }
//   buildNewAssetAlert({ site, rows, baseUrl, date, labels })                   → { subject, html, attachments: [] }
// Every asset field is untrusted → escapeHtml. Links only when baseUrl is set AND
// the site folds to exactly ONE asset label (a multi-label link would open a
// smaller list than the count promises — same rule as the weekly e-mail).
const { NAVY, TEAL, MUTED, WASH, FONT, escapeHtml, card, kpiGrid } = require('./reportTemplates/_primitives');
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
  ['new', 'Nouveau matériel', 'Nouveau', '#inventory', null],
  ['unassigned', 'En service sans utilisateur ni département', 'Sans affectation', '#inventory', null],
  ['no_cost', 'Sans coût d’achat', 'Sans cout', '#hygiene', 'no_cost'],
  ['no_date', 'Sans date d’acquisition', 'Sans date', '#hygiene', 'no_age'],
];
const COLS = [['asset_name', 'Nom'], ['product_type', 'Type'], ['manufacturer', 'Fabricant'], ['serial_number', 'N° série'],
  ['state', 'État'], ['user_name', 'Utilisateur'], ['department', 'Département'], ['acquisition_date', 'Date d’acquisition']];

function _link(baseUrl, labels, hash, kind) {
  if (!baseUrl || !Array.isArray(labels) || labels.length !== 1) return null;
  return `${baseUrl}/assets.html?site=${encodeURIComponent(labels[0])}${kind ? '&kind=' + encodeURIComponent(kind) : ''}${hash}`;
}
function _table(rows, withSeen) {
  const th = (t) => `<th style="text-align:left;padding:4px 6px;border-bottom:1px solid #E2E5EA;font-family:${FONT};font-size:11px;color:${MUTED};">${escapeHtml(t)}</th>`;
  const td = (t) => `<td style="padding:4px 6px;border-bottom:1px solid #F1F3F6;font-family:${FONT};font-size:12px;">${escapeHtml(t == null || t === '' ? '—' : t)}</td>`;
  const head = COLS.map(c => th(c[1])).join('') + th('Coût renseigné') + (withSeen ? th('Vu le') : '');
  const body = rows.map(r => `<tr>${COLS.map(c => td(r[c[0]])).join('')}${td(r.has_cost ? 'Oui' : 'Non')}${withSeen ? td(r.first_seen_date) : ''}</tr>`).join('');
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
function _shell(subject, inner) {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:${WASH};">
<tr><td align="center" style="padding:16px 10px;"><table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;"><tr><td>
<div style="font-family:${FONT};font-size:18px;font-weight:bold;color:${NAVY};padding:0 2px 12px 2px;">${escapeHtml(subject)}</div>
${inner}
<div style="font-family:${FONT};font-size:11px;color:${MUTED};padding:4px 2px;">Endeavour Mining &middot; IT Operations &middot; message automatique du SDP Dashboard. Corrigez ces fiches dans l&rsquo;inventaire (AssetExplorer) ; elles disparaissent de cette liste apr&egrave;s la synchronisation nocturne.</div>
</td></tr></table></td></tr></table>`;
}

function buildAssetRecap({ site, followups, baseUrl, weekLabel, year, week, labels } = {}) {
  const f = followups || {};
  const c = f.counts || {};
  const subject = `Suivi du parc informatique - ${site} - ${weekLabel || ''}`.trim();
  const kpis = kpiGrid(LISTS.map(([k, label]) => ({ label, value: countText(c[k]) })));
  const blocks = LISTS.map(([k, label, , hash, kind]) => {
    const rows = Array.isArray(f[k]) ? f[k] : [];
    if (!rows.length) return '';
    const href = _link(baseUrl, labels, hash, kind);
    const cn = countNum(c[k]);
    const more = cn !== null && cn > 20 ? `<div style="font-family:${FONT};font-size:11px;color:${MUTED};padding-top:4px;">20 premi&egrave;res lignes sur ${escapeHtml(countText(c[k]))} &mdash; liste compl&egrave;te en pi&egrave;ce jointe.</div>` : '';
    const link = href ? `<div style="padding-top:6px;"><a href="${escapeHtml(href)}" style="color:${NAVY};font-family:${FONT};font-size:12px;">Voir dans Assets</a></div>` : '';
    return card(`${label} (${countText(c[k])})`, _table(rows.slice(0, 20), k === 'new') + more + link, TEAL);
  }).join('\n');
  const html = _shell(subject, card('Synthèse', kpis, NAVY) + '\n' + blocks);
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
  const subject = `Nouveau matériel détecté - ${site} - ${date}`;
  const href = _link(baseUrl, labels, '#inventory', null);
  const link = href ? `<div style="padding-top:6px;"><a href="${escapeHtml(href)}" style="color:${NAVY};font-family:${FONT};font-size:12px;">Voir dans Assets</a></div>` : '';
  const intro = `<div style="font-family:${FONT};font-size:13px;padding-bottom:8px;">${escapeHtml(list.length)} nouvel(le)(s) &eacute;quipement(s) vu(s) pour la premi&egrave;re fois lors de la synchronisation du ${escapeHtml(date)}. Merci de compl&eacute;ter utilisateur, d&eacute;partement, co&ucirc;t et date d&rsquo;acquisition.</div>`;
  return { subject, html: _shell(subject, card('Nouveau matériel', intro + _table(list, true) + link, TEAL)), attachments: [] };
}

module.exports = { buildAssetRecap, buildNewAssetAlert };
