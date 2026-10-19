'use strict';
// Weekly site report — composes the e-mail body + the PDF-ready document from
// what services/weeklyReportData.js loaded.
//
// PURE: no DB, no network, no reports-db/assets-db require. Input in, strings out.
//
// TWO OUTPUTS, TWO RENDERERS (same contract as coordinator.js):
//   htmlBody — read in Outlook. Table-based layout, inline styles ONLY, no
//              <script>, no external stylesheet, no remote images. Outlook's
//              renderer (Word) drops flexbox/grid/CSS custom properties — do not
//              "modernise" this markup.
//   fullHtml — the admin preview pane / PDF. Wraps htmlBody VERBATIM so the two
//              can never drift apart. Zero external requests.
//
// ORDER IS DELIBERATE: the coordinator's AUTHORED report leads, the assets block
// follows. The e-mail is titled "Rapport hebdomadaire" and it is their work — a
// CMDB reminder must never be the first thing they read. A test pins the order.
//
// USER-FACING COPY IS FRENCH — the site coordinators are francophone. Accents in
// HAND-WRITTEN raw markup use entities (&eacute;); accents in text passed through
// tiles/card/escapeHtml are literal characters, because escapeHtml would turn
// the `&` of an entity into `&amp;`.
//
// EVERY authored field (KPI names, lights, action tasks, owner names) is
// untrusted user input and MUST go through escapeHtml. The helper is deliberately
// NOT called `esc` — CLAUDE.md records a real bug where a local `esc` that did
// not actually escape created false safety in review. If you add a field, escape it.

const {
  RAG_COLORS,
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
  bulletList,
} = require('./_primitives');

// ── status_color → RAG key ───────────────────────────────────────────────────
//
// THE TRAP: infra_kpis.status_color stores `green | orange | red | none`
// (reports-db.js:90) while RAG_COLORS is keyed `green | amber | red`. The UI
// LABELS orange as "Amber" (public/reports.html:2358) but STORES 'orange', so a
// naive RAG_COLORS[status_color] returns undefined for every warning KPI — the
// most common non-green state — and prints the string "undefined" into the mail.
//
// Map explicitly, and return null (not a colour) for 'none' and for anything
// unrecognised: an unknown value must render unstyled, never as a wrong colour.
const STATUS_RAG = { green: 'green', orange: 'amber', red: 'red' };
function statusColor(statusColorValue) {
  const key = STATUS_RAG[String(statusColorValue || '').trim().toLowerCase()];
  return key ? RAG_COLORS[key] : null;
}

// ── trend ────────────────────────────────────────────────────────────────────
// `stable` and `no_change` are two spellings of the same thing (reports-db.js:91).
const TRENDS = {
  up:        { mark: '&#9650;', label: 'en hausse' },
  down:      { mark: '&#9660;', label: 'en baisse' },
  stable:    { mark: '&#9644;', label: 'stable' },
  no_change: { mark: '&#9644;', label: 'stable' },
};
function trendHtml(trend) {
  const t = TRENDS[String(trend || '').trim().toLowerCase()];
  if (!t) return `<span style="color:${MUTED};">&mdash;</span>`;
  return `<span style="color:${MUTED};white-space:nowrap;">${t.mark} ${t.label}</span>`;
}

/** emptyNote's twin for copy we wrote ourselves — takes PRE-BUILT markup. */
function staticNote(html) {
  return `<div style="font-family:${FONT};font-size:12px;color:${MUTED};font-style:italic;line-height:1.5;">${html}</div>`;
}

// ── colour presentation (2026-09-18) ────────────────────────────────────────
//
// The two blocks presented in the meeting — « Assistance aux utilisateurs » and
// « Parc informatique » — get a full coloured header band, tinted KPI tiles and
// tinted note boxes. Local constants on purpose: _primitives.js is shared with
// the MONTHLY e-mail, which is pinned byte-for-byte by two goldens.
//
// Helpdesk = the house NAVY band with a TEAL rule; Parc = violet (#7C3AED, the
// same violet the dashboard already uses for its On-hold / 1st-response tiles),
// so the two blocks can never be confused on a projected screen.
const PARC = '#7C3AED';
const PARC_TINT = '#F5F3FF';
const HD_TINT = '#F1F5F9';
// Attention pill for « non renseigné »: amber family, but NOT the RAG amber hex —
// a missing note is a reminder, not a KPI verdict.
const ATTN_BG = '#FEF3C7';
const ATTN_BORDER = '#FCD34D';
const ATTN_FG = '#B45309';

// SLA targets: the helpdesk row carries NO per-site target, so the ORG standard
// is used — the same thresholds Analyze Lite applies (public/analyze-lite.js:40):
// resolution ≥ 90 % green, ≥ 85 % amber; first reply ≥ 80 % green (org FRT
// target), ≥ 70 % amber; below → red. The target is printed on the tile.
const SLA_TARGETS = {
  res_ok_pct: { good: 90, warn: 85 },
  fr_ok_pct:  { good: 80, warn: 70 },
};

/** A finite number — rejecting null/'' BEFORE coercion (`+null === 0`). */
function finite(v) {
  return v != null && v !== '' && Number.isFinite(+v);
}

function slaRag(value, key) {
  if (!finite(value)) return null;
  const t = SLA_TARGETS[key];
  const v = +value;
  if (v >= t.good) return RAG_COLORS.green;
  if (v >= t.warn) return RAG_COLORS.amber;
  return RAG_COLORS.red;
}

/**
 * A card with a FULL coloured header band (vs card()'s 4px rule). `rule` adds a
 * thin second stripe under the band. Title is escaped here; bodyHtml is markup.
 */
function bandCard(title, bodyHtml, accent, rule) {
  const ruleRow = rule
    ? `<tr><td style="background:${rule};height:3px;line-height:3px;font-size:0;">&nbsp;</td></tr>\n`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background:#FFFFFF;border:1px solid ${BORDER};border-radius:6px;margin:0 0 14px 0;">
<tr><td style="background:${accent};padding:10px 16px;border-radius:6px 6px 0 0;">
<div style="font-family:${FONT};font-size:13px;font-weight:bold;color:#FFFFFF;letter-spacing:0.8px;text-transform:uppercase;">${escapeHtml(title)}</div>
</td></tr>
${ruleRow}<tr><td style="padding:14px 16px 16px 16px;">
${bodyHtml}
</td></tr></table>`;
}

/**
 * Tinted KPI tiles, `perRow` per row. items = [{label, valueHtml, color, sub}]:
 * `label` is escaped here; `valueHtml` / `sub` are PRE-BUILT markup (callers
 * escape anything untrusted). `color` paints the value; `accent` the left edge.
 */
function tiles(items, { tint, accent, perRow = 4 }) {
  const cells = arr(items);
  if (!cells.length) return '';
  const w = Math.floor(100 / perRow);
  const rows = [];
  for (let i = 0; i < cells.length; i += perRow) rows.push(cells.slice(i, i + perRow));
  const html = rows.map((row) => {
    const tds = row.map((it) => `<td width="${w}%" style="width:${w}%;padding:0 6px 8px 0;vertical-align:top;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;"><tr>
<td style="background:${tint};border-left:4px solid ${it.edge || accent};padding:8px 10px;vertical-align:top;">
<div style="font-family:${FONT};font-size:20px;font-weight:bold;color:${it.color};line-height:1.2;">${it.valueHtml}</div>
<div style="font-family:${FONT};font-size:11px;color:${INK};line-height:1.35;padding-top:3px;">${escapeHtml(it.label)}</div>
${it.sub ? `<div style="font-family:${FONT};font-size:10px;color:${MUTED};line-height:1.35;padding-top:2px;">${it.sub}</div>` : ''}
</td></tr></table>
</td>`).join('');
    const pad = row.length < perRow
      ? new Array(perRow - row.length).fill(`<td width="${w}%" style="width:${w}%;">&nbsp;</td>`).join('')
      : '';
    return `<tr>${tds}${pad}</tr>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${html}</table>`;
}

/** A light tinted box with a coloured left edge — for authored notes. */
function noteBox(titleHtml, bodyHtml, tint, edge) {
  return `<div style="background:${tint};border-left:3px solid ${edge};padding:8px 10px;margin-top:8px;font-family:${FONT};">
<div style="font-size:11px;font-weight:bold;color:${NAVY};letter-spacing:0.6px;text-transform:uppercase;padding-bottom:3px;">${titleHtml}</div>
<div style="font-size:13px;color:${INK};line-height:1.55;">${bodyHtml}</div>
</div>`;
}

// ── sections ─────────────────────────────────────────────────────────────────

function header(data) {
  const r = obj(data.report);
  const w = obj(data.week);
  const site = escapeHtml(r.site_name || data.site_code || 'Site');
  const label = escapeHtml(w.label || r.week_label || '');
  const from = w.start || r.start_date;
  const to = w.end || r.end_date;
  const range = from && to
    ? `<div style="font-family:${FONT};font-size:12px;color:#94A3B8;padding-top:2px;">${escapeHtml(from)} &rarr; ${escapeHtml(to)}</div>`
    : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background:${NAVY};border-radius:6px;margin:0 0 14px 0;">
<tr><td style="padding:16px 16px 14px 16px;">
<div style="font-family:${FONT};font-size:11px;color:#94A3B8;letter-spacing:1px;text-transform:uppercase;padding-bottom:4px;">Rapport hebdomadaire IT</div>
<div style="font-family:${FONT};font-size:22px;font-weight:bold;color:#FFFFFF;line-height:1.25;">${site}</div>
<div style="font-family:${FONT};font-size:13px;color:#CBD5E1;padding-top:3px;">${label}</div>
${range}
</td></tr>
<tr><td style="background:${TEAL};height:4px;line-height:4px;font-size:0;border-radius:0 0 6px 6px;">&nbsp;</td></tr>
</table>`;
}

/** The infrastructure KPI table — service · KPI · cible · valeur (RAG) · tendance. */
function infraSection(kpis) {
  const rows = arr(kpis);
  if (!rows.length) {
    return card('Indicateurs infrastructure', staticNote('Aucun indicateur saisi cette semaine.'), NAVY);
  }

  const th = (label, align = 'left') => `<th align="${align}" style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;text-align:${align};padding:0 6px 6px 0;border-bottom:1px solid ${BORDER};">${label}</th>`;
  const td = (html, align = 'left') => `<td align="${align}" style="font-family:${FONT};font-size:12px;color:${INK};text-align:${align};padding:7px 6px 7px 0;border-bottom:1px solid ${BORDER};vertical-align:top;">${html}</td>`;

  const body = rows.map((raw) => {
    const k = obj(raw);
    const c = statusColor(k.status_color);
    // `none` / unknown → no chip, no colour. Never a colour we guessed at.
    const value = c
      ? `<span style="display:inline-block;font-family:${FONT};font-size:11px;font-weight:bold;color:#FFFFFF;background:${c};border-radius:9px;padding:2px 9px;">${escapeHtml(k.status_value)}</span>`
      : `<span style="color:${INK};">${escapeHtml(k.status_value)}</span>`;
    return `<tr>
${td(`<strong style="color:${NAVY};">${escapeHtml(k.service)}</strong>`)}
${td(escapeHtml(k.kpi))}
${td(escapeHtml(k.target), 'right')}
${td(value, 'right')}
${td(trendHtml(k.trend), 'right')}
</tr>`;
  }).join('');

  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
<tr>${th('Service')}${th('Indicateur')}${th('Cible', 'right')}${th('Valeur', 'right')}${th('Tendance', 'right')}</tr>
${body}
</table>`;

  return card('Indicateurs infrastructure', table, NAVY);
}

// The four timing columns. Each renders ONLY when non-null — a missing timing is
// a timing that was never measured, and printing 0 h would be a measurement.
const TIMINGS = [
  { key: 'time_to_assign',  label: 'Prise en charge (h)' },
  { key: 'first_reply',     label: 'Première réponse (h)' },
  { key: 'resolution_time', label: 'Résolution (h)' },
  { key: 'closing_time',    label: 'Clôture (h)' },
];

const pct = (v) => `${escapeHtml(+v)}&nbsp;%`;

/**
 * The weekly volume/SLA series the coordinator pulled live (same source as the
 * PPTX's KPI strip: chart_data.weeks, else group_metrics). Only real objects —
 * a malformed payload must degrade to "no row", never to a row of zeros.
 */
function helpdeskWeeks(h) {
  const isRow = (w) => w && typeof w === 'object' && !Array.isArray(w);
  const cdWeeks = arr(obj(h.chart_data).weeks).filter(isRow);
  return cdWeeks.length ? cdWeeks : arr(h.group_metrics).filter(isRow);
}

function helpdeskVolumeTiles(h) {
  const weeks = helpdeskWeeks(h);
  const cur = weeks.length ? weeks[weeks.length - 1] : null;
  const prev = weeks.length > 1 ? weeks[weeks.length - 2] : null;
  const KEYS = ['inbound', 'closed', 'res_ok_pct', 'fr_ok_pct'];
  // A week object with no measured field (e.g. {label} only) is not a row.
  if (!cur || !KEYS.some((k) => finite(cur[k]))) return '';

  const prevLbl = prev && prev.label ? `${escapeHtml(prev.label)}&nbsp;: ` : '';
  const prevTxt = (k, fmt) => (prev && finite(prev[k]) ? `pr&eacute;c. ${prevLbl}${fmt(prev[k])}` : '');
  const plain = (v) => escapeHtml(+v);
  const dash = { valueHtml: '—', color: MUTED };

  const countTile = (k, label, extra) => (finite(cur[k])
    ? { label, valueHtml: plain(cur[k]), color: NAVY, sub: [extra, prevTxt(k, plain)].filter(Boolean).join(' &middot; ') }
    : { label, ...dash, sub: prevTxt(k, plain) });

  const slaTile = (k, label) => {
    const t = SLA_TARGETS[k];
    const target = `cible &ge;&nbsp;${t.good}&nbsp;%`;
    const c = slaRag(cur[k], k);
    return c
      ? { label, valueHtml: pct(cur[k]), color: c, edge: c, sub: [target, prevTxt(k, pct)].filter(Boolean).join(' &middot; ') }
      : { label, ...dash, sub: target };
  };

  const closure = finite(cur.inbound) && +cur.inbound > 0 && finite(cur.closed)
    ? `taux ${Math.round((+cur.closed / +cur.inbound) * 100)}&nbsp;%`
    : '';

  return tiles([
    countTile('inbound', 'Tickets reçus'),
    countTile('closed', 'Tickets clôturés', closure),
    slaTile('res_ok_pct', 'SLA de résolution'),
    slaTile('fr_ok_pct', 'SLA 1re réponse'),
  ], { tint: HD_TINT, accent: TEAL });
}

function helpdeskSection(helpdesk) {
  const h = obj(helpdesk);

  // getReport() sets `helpdesk` to {} when the row is absent (reports-db.js:2046).
  // Say so — a blank card reads as a rendering bug.
  if (!Object.keys(h).length) {
    return bandCard('Assistance aux utilisateurs', staticNote('Aucune donn&eacute;e d&rsquo;assistance n&rsquo;a &eacute;t&eacute; saisie pour cette semaine.'), NAVY, TEAL);
  }

  // Volumes + SLA of the report week (last entry of the stored series), SLA
  // coloured against the org target. The rest of the series is chart payload.
  const volume = helpdeskVolumeTiles(h);

  const cells = [];
  for (const t of TIMINGS) {
    const v = h[t.key];
    if (v === null || v === undefined || v === '') continue;
    const prev = h[`${t.key}_prev`];
    cells.push({
      label: t.label,
      valueHtml: escapeHtml(num(v)),
      color: NAVY,
      sub: (prev === null || prev === undefined || prev === '') ? '' : `pr&eacute;c. ${escapeHtml(num(prev))}`,
    });
  }
  const timings = cells.length
    ? tiles(cells, { tint: HD_TINT, accent: NAVY })
    : staticNote('Aucun d&eacute;lai mesur&eacute; cette semaine.');

  const commentBlock = (title, text) => (text
    ? noteBox(title, `<span style="white-space:pre-line;">${escapeHtml(text)}</span>`, HD_TINT, TEAL)
    : '');

  const staff = [
    h.techs_on_duty ? `Techniciens de garde&nbsp;: ${escapeHtml(h.techs_on_duty)}` : '',
    h.tech_on_break ? `En cong&eacute;&nbsp;: ${escapeHtml(h.tech_on_break)}` : '',
  ].filter(Boolean).join(' &middot; ');
  const staffBlock = staff ? `<div style="padding-top:10px;">${staticNote(staff)}</div>` : '';

  return bandCard(
    'Assistance aux utilisateurs',
    `${volume}${timings}${commentBlock('Commentaire &mdash; volumes', h.comments_metrics)}${commentBlock('Commentaire &mdash; SLA', h.comments_sla)}${staffBlock}`,
    NAVY,
    TEAL,
  );
}

// The four lights types, each its own labelled group. Positives first: the
// coordinator's wins should not be buried under the problems.
const LIGHT_GROUPS = [
  { type: 'high_light',         label: 'Points positifs',            color: RAG_COLORS.green },
  { type: 'low_light',          label: 'Points d&rsquo;attention',   color: RAG_COLORS.amber },
  { type: 'change_in_progress', label: 'Changements en cours',       color: TEAL },
  { type: 'change_pending',     label: 'Changements planifi&eacute;s', color: MUTED },
];

function lightsSection(lights) {
  const rows = arr(lights);
  const blocks = LIGHT_GROUPS.map((g) => {
    const items = rows.filter((l) => String(obj(l).type || '').trim().toLowerCase() === g.type);
    if (!items.length) return '';
    return `<div style="font-family:${FONT};font-size:11px;font-weight:bold;color:${g.color};letter-spacing:0.6px;text-transform:uppercase;padding:10px 0 6px 0;">${g.label} (${items.length})</div>`
      + bulletList(items.map((l) => escapeHtml(obj(l).content)));
  }).filter(Boolean).join('');

  // Anything carrying an unrecognised `type` still has to reach the reader.
  const known = new Set(LIGHT_GROUPS.map((g) => g.type));
  const other = rows.filter((l) => !known.has(String(obj(l).type || '').trim().toLowerCase()));
  const otherBlock = other.length
    ? `<div style="font-family:${FONT};font-size:11px;font-weight:bold;color:${MUTED};letter-spacing:0.6px;text-transform:uppercase;padding:10px 0 6px 0;">Autres</div>`
      + bulletList(other.map((l) => escapeHtml(obj(l).content)))
    : '';

  const inner = (blocks + otherBlock) || staticNote('Aucun fait marquant signal&eacute; cette semaine.');
  return card('Faits marquants et changements', inner, NAVY);
}

const PRIORITY_COLOR = { high: RAG_COLORS.red, medium: RAG_COLORS.amber, low: TEAL };
const STATUS_LABEL = { open: 'ouverte', in_progress: 'en cours', closed: 'cl&ocirc;tur&eacute;e' };

function actionsSection(items) {
  const rows = arr(items);
  if (!rows.length) {
    return card('Actions', staticNote('Aucune action ouverte cette semaine.'), TEAL);
  }

  const th = (label, align = 'left') => `<th align="${align}" style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;text-align:${align};padding:0 6px 6px 0;border-bottom:1px solid ${BORDER};">${label}</th>`;
  const td = (html, align = 'left') => `<td align="${align}" style="font-family:${FONT};font-size:12px;color:${INK};text-align:${align};padding:7px 6px 7px 0;border-bottom:1px solid ${BORDER};vertical-align:top;">${html}</td>`;

  const body = rows.map((raw) => {
    const a = obj(raw);
    const pc = PRIORITY_COLOR[String(a.priority || '').trim().toLowerCase()] || MUTED;
    const priority = a.priority
      ? `<span style="display:inline-block;font-family:${FONT};font-size:10px;font-weight:bold;color:#FFFFFF;background:${pc};border-radius:9px;padding:2px 7px;">${escapeHtml(a.priority)}</span>`
      : `<span style="color:${MUTED};">&mdash;</span>`;
    const status = STATUS_LABEL[String(a.status || '').trim().toLowerCase()] || escapeHtml(a.status) || '&mdash;';
    return `<tr>
${td(`<strong style="color:${NAVY};">${escapeHtml(a.task)}</strong>`)}
${td(priority)}
${td(escapeHtml(a.owner))}
${td(escapeHtml(a.due_date), 'right')}
${td(status)}
</tr>`;
  }).join('');

  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
<tr>${th('Action')}${th('Priorit&eacute;')}${th('Responsable')}${th('&Eacute;ch&eacute;ance', 'right')}${th('Statut')}</tr>
${body}
</table>`;

  return card('Actions', table, TEAL);
}

// The hygiene worklist kinds, in the order they are worth acting on. The loader
// already DROPS zero-count kinds (weeklyReportData.js:88) — a block of zeros
// trains the reader to skip the section.
const HYGIENE_LABELS = {
  discovered:           'Actifs d&eacute;couverts &agrave; qualifier',
  never_scanned:        'Jamais scann&eacute;s',
  ghost:                'Fant&ocirc;mes (>90 j sans scan)',
  no_owner:             'Sans propri&eacute;taire',
  no_age:               'Sans date d&rsquo;acquisition',
  no_cost:              'Sans co&ucirc;t',
  no_asset_tag:         'Sans QR code',
  lifecycle_exception:  'Exception de cycle de vie',
};

// Asset engagement (2026-09-18): the coordinator's own "Parc informatique" tab,
// counts FROZEN at submission (never live). Empty note on an applicable site =
// « non renseigné » on purpose — visible for the meeting, never hidden.
// tiles() escapes its labels → literal accents here, not entities.
const REVIEW_KPIS = [
  ['no_tag', 'Sans QR code'],
  ['no_date', 'Sans date d’acquisition'],
  ['no_cost', 'Sans coût d’achat'],
  ['unassigned', 'Non assigné à un utilisateur'],
];
// A frozen count that is null / not-a-number must read "—", never a fabricated
// 0 — a real 0 is a measurement ("nothing new this week"), a null is "we don't
// know" (e.g. the assets layer was down at submission). num()'s default of 0
// would collapse that distinction, so this checks Number.isFinite itself.
//
// THE TRAP (CLAUDE.md: "`+null === 0` passes `Number.isFinite`"): `+null` and
// `+''` both coerce to `0`, so `Number.isFinite(+v)` alone reads null/'' as a
// legitimate zero and prints "0" for data we never measured. Reject null/''
// BEFORE the numeric coercion.
function reviewCountText(v) {
  return (v != null && v !== '' && Number.isFinite(+v)) ? String(+v) : '—';
}
// The server only STOPS recomputing the counts once the report is 'submitted'
// (server.js ~6285) — before that, every PUT recomputes them live. A weekly
// e-mail can legitimately go out for a report that is complete but was never
// submitted (see CLAUDE.md's "weekly_reports.status is FOUR values" pitfall),
// so the wording must reflect what actually happened: "frozen at submission"
// is only true once status IS 'submitted'; otherwise the counts shown are
// whatever was last saved, and saying "frozen" would misstate a still-live
// number as a locked one.
function assetReviewBlock(review, status) {
  const rv = review && typeof review === 'object' ? review : null;
  if (!rv || rv.applicable === false || rv.applicable === 0) return '';
  const c = rv.counts && typeof rv.counts === 'object' ? rv.counts : null;
  // Counters are NEUTRAL (violet tiles, no RAG): the e-mail receives only this
  // report's frozen counts — the previous week's counts are not loaded
  // (weeklyReportData.js), so a trend colour would be invented. A null count is
  // "—" in grey, never a fabricated 0.
  // G-05 — a count without its denominator is unreadable: "non assigné" is 94 % of the
  // production fleet, so 465 says nothing and the weekly move (five machines) is
  // invisible. The share is appended to the LABEL, leaving the frozen number itself
  // untouched. A report frozen before `active_total` existed simply has no share —
  // never an invented one.
  const total = c && Number.isFinite(+c.active_total) && +c.active_total > 0 ? +c.active_total : null;
  const withShare = (label, v) => {
    if (total == null || !(v != null && v !== '' && Number.isFinite(+v))) return label;
    return `${label} — ${Math.round(+v * 100 / total)} % du parc (${total} actifs)`;
  };
  const counts = c
    ? tiles(REVIEW_KPIS.map(([k, label]) => {
      const t = reviewCountText(c[k]);
      return t === '—'
        ? { label, valueHtml: '—', color: MUTED }
        : { label: withShare(label, c[k]), valueHtml: escapeHtml(t), color: NAVY };
    }), { tint: PARC_TINT, accent: PARC })
    : staticNote('Compteurs non disponibles au moment de la soumission.');
  // Notes come from multi-line textareas — escapeHtml neutralises markup but
  // does not touch line breaks, so the styling must preserve them explicitly.
  // An empty note is an amber attention pill: it must be SEEN in the meeting.
  const note = (v) => {
    const s = String(v == null ? '' : v).trim();
    return s
      ? `<span style="white-space:pre-line;">${escapeHtml(s)}</span>`
      : `<span style="display:inline-block;font-family:${FONT};font-size:11px;font-weight:bold;background:${ATTN_BG};border:1px solid ${ATTN_BORDER};color:${ATTN_FG};border-radius:9px;padding:2px 9px;">non renseign&eacute;</span>`;
  };
  const frozenNote = status === 'submitted'
    ? 'Suivi du parc d&eacute;clar&eacute; par le coordinateur &mdash; compteurs fig&eacute;s &agrave; la soumission.'
    : 'Suivi du parc d&eacute;clar&eacute; par le coordinateur &mdash; compteurs au dernier enregistrement.';
  return `<div style="padding-top:12px;">
${staticNote(frozenNote)}
<div style="padding-top:6px;">${counts}</div>
${noteBox('Trait&eacute; cette semaine', note(rv.handled_note), PARC_TINT, PARC)}
${noteBox('Plan / blocages', note(rv.plan_note), PARC_TINT, PARC)}
</div>`;
}

/**
 * The CMDB nudge — AFTER the authored report, never before it.
 *
 * `assets === null` means the site has no AP label at all, so the caller omits
 * the whole block: zeros there would read as a clean site rather than an
 * unmeasured one. `effort` carries {effort_score, rank} only — there is
 * deliberately no delta (a ~30-day lookback barely moves week to week).
 *
 * NO LINK into Assets (2026-09-18): this e-mail is the document presented in
 * the meeting — counts are plain text. The detailed worklists (with links) go
 * to the site's asset manager in the reminder e-mails (assetReminderReport.js).
 */
function assetsSection(assets, review, status) {
  const a = obj(assets);
  const hygiene = obj(a.hygiene);
  const effort = a.effort === null || a.effort === undefined ? null : obj(a.effort);

  const countCell = (k) => `<span style="color:${PARC};font-weight:bold;">${escapeHtml(num(hygiene[k]))}</span>`;

  // When the coordinator's tab counters are present they are THE figures for QR
  // code / date / cost / user (active states only, 2026-09-21). The hygiene kinds
  // that measure the same thing on a different scope (all states) would print a
  // second, different number for the same question — so they are dropped here.
  const reviewHtml = assetReviewBlock(review, status);
  const OVERLAP = new Set(['no_owner', 'no_age', 'no_cost', 'no_asset_tag']);
  const kinds = Object.keys(hygiene).filter((k) => num(hygiene[k]) > 0 && !(reviewHtml && OVERLAP.has(k)));
  const list = kinds.length
    ? bulletList(kinds.map((k) => {
      const label = HYGIENE_LABELS[k] || escapeHtml(String(k).replace(/_/g, ' '));
      return `${label} ${countCell(k)}`;
    }))
    : staticNote('Aucun &eacute;cart de qualit&eacute; de donn&eacute;es &agrave; corriger. Merci&nbsp;!');

  const effortBlock = effort && effort.effort_score !== null && effort.effort_score !== undefined
    ? tiles([
      { label: 'Score de tenue du parc', valueHtml: `${escapeHtml(num(effort.effort_score))}/100`, color: NAVY },
      { label: 'Classement des sites', valueHtml: `#${escapeHtml(num(effort.rank))}`, color: NAVY },
    ], { tint: PARC_TINT, accent: PARC })
    : '';

  if (reviewHtml) {
    // Counters + notes first (what the meeting discusses), then the other
    // data-quality gaps; nothing at all when there are none left.
    const rest = kinds.length
      ? `<div style="padding-top:12px;">${staticNote('Autres &eacute;carts de qualit&eacute; des donn&eacute;es &mdash; &agrave; corriger dans l&rsquo;inventaire.')}<div style="padding-top:8px;">${list}</div></div>`
      : '';
    return bandCard('Parc informatique', `${effortBlock}${reviewHtml}${rest}`, PARC);
  }
  const intro = staticNote('Qualit&eacute; des donn&eacute;es du parc informatique &mdash; &agrave; corriger dans l&rsquo;inventaire, ind&eacute;pendamment du rapport ci-dessus.');

  return bandCard('Parc informatique', `${effortBlock}${intro}<div style="padding-top:8px;">${list}</div>`, PARC);
}

function footer(data) {
  const r = obj(data.report);
  const code = data.site_code || r.site_name || '';

  // The helpdesk figures are a SNAPSHOT taken when the coordinator last pulled
  // live data — not a live read at send time. Show when, or a stale week is
  // invisible. fetched_at lives on the helpdesk row (reports-db.js:116).
  const fetched = obj(r.helpdesk).fetched_at;
  const snapshot = fetched
    ? `<div style="padding-top:3px;">Donn&eacute;es d&rsquo;assistance fig&eacute;es au ${escapeHtml(String(fetched).replace('T', ' ').slice(0, 16))}.</div>`
    : '';

  // Task 4 tells us the deck could not be attached. Say it plainly rather than
  // letting the coordinator hunt for a missing attachment.
  const pptxNote = data.pptxFailed
    ? `<div style="padding-top:3px;color:${RAG_COLORS.amber};">La pr&eacute;sentation PowerPoint n&rsquo;a pas pu &ecirc;tre jointe &agrave; ce message. Le contenu ci-dessus est complet&nbsp;; la pr&eacute;sentation reste t&eacute;l&eacute;chargeable depuis le tableau de bord.</div>`
    : '';

  return `<div style="font-family:${FONT};font-size:11px;color:${MUTED};line-height:1.5;padding:4px 2px 8px 2px;">
<div>Endeavour Mining &middot; IT Operations &middot; g&eacute;n&eacute;r&eacute; depuis le SDP Dashboard${code ? ` pour ${escapeHtml(code)}` : ''}.</div>
${snapshot}${pptxNote}
</div>`;
}

// ── compose ──────────────────────────────────────────────────────────────────

function composeWeekly(data) {
  const d = obj(data);
  const r = obj(d.report);
  const w = obj(d.week);

  // The site CODE, not the name: `sites` has no code column (reports-db.js:30)
  // and getReport() returns only `site_name`, so the sender passes back the code
  // it called the loader with. Fall back to the name rather than printing nothing.
  const code = d.site_code || r.site_name || 'Site';
  const label = w.label || r.week_label || '';
  const from = w.start || r.start_date;
  const to = w.end || r.end_date;

  // "Weekly" with no dates is the exact ambiguity this feature removes — the
  // range is part of the subject, not buried in the body. ASCII-safe glyphs only:
  // subject encoding varies by client far more than body encoding does.
  const range = from && to ? ` (${from} - ${to})` : '';
  const subject = `Rapport hebdomadaire IT - ${code}${label ? ` - ${label}` : ''}${range}`;

  const content = [
    header(d),
    // THEIR WORK FIRST.
    infraSection(r.infra_kpis),
    helpdeskSection(r.helpdesk),
    lightsSection(r.lights),
    actionsSection(r.action_items),
    // …then the CMDB reminder. `null` omits it entirely. d.base_url is
    // deliberately IGNORED here: the meeting report carries no Assets link.
    // A frozen review must never vanish just because the live hygiene block is
    // absent (e.g. the asset labels changed after submission) — render it on
    // its own card in that case.
    d.assets
      ? assetsSection(d.assets, r.asset_review, r.status)
      : (assetReviewBlock(r.asset_review, r.status) ? bandCard('Parc informatique', assetReviewBlock(r.asset_review, r.status), PARC) : ''),
    footer(d),
  ].filter(Boolean).join('\n');

  // Outlook-safe shell: centring table + fixed-width inner table.
  const htmlBody = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background:${WASH};margin:0;padding:0;">
<tr><td align="center" style="padding:16px 10px;">
<table role="presentation" width="640" cellpadding="0" cellspacing="0" border="0" style="width:640px;max-width:640px;border-collapse:collapse;text-align:left;">
<tr><td>
${content}
</td></tr>
</table>
</td></tr>
</table>`;

  // Preview / PDF document. Wraps htmlBody VERBATIM — the <style> below only adds
  // print geometry, so the preview and the e-mail never drift apart. No external
  // requests (no CDN, no web fonts, no remote images).
  const fullHtml = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(subject)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  html, body { margin: 0; padding: 0; background: ${WASH}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  table { page-break-inside: avoid; }
</style>
</head>
<body>
${htmlBody}
</body>
</html>`;

  return { subject, htmlBody, fullHtml };
}

module.exports = { composeWeekly };
