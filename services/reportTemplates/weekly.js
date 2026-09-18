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
// kpiGrid/card/escapeHtml are literal characters, because escapeHtml would turn
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
  kpiGrid,
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

function helpdeskSection(helpdesk) {
  const h = obj(helpdesk);

  // getReport() sets `helpdesk` to {} when the row is absent (reports-db.js:2046).
  // Say so — a blank card reads as a rendering bug.
  if (!Object.keys(h).length) {
    return card('Assistance aux utilisateurs', staticNote('Aucune donn&eacute;e d&rsquo;assistance n&rsquo;a &eacute;t&eacute; saisie pour cette semaine.'), NAVY);
  }

  // chart_data / group_metrics / all_groups are chart payloads, not e-mail
  // content — deliberately not rendered.
  const cells = [];
  for (const t of TIMINGS) {
    const v = h[t.key];
    if (v === null || v === undefined || v === '') continue;
    const prev = h[`${t.key}_prev`];
    const value = (prev === null || prev === undefined || prev === '')
      ? String(num(v))
      : `${num(v)} (préc. ${num(prev)})`;
    cells.push({ label: t.label, value });
  }
  const kpis = cells.length ? kpiGrid(cells) : staticNote('Aucun d&eacute;lai mesur&eacute; cette semaine.');

  const commentBlock = (title, text) => (text
    ? `<div style="font-family:${FONT};font-size:11px;font-weight:bold;color:${NAVY};letter-spacing:0.6px;text-transform:uppercase;padding:10px 0 4px 0;">${title}</div>
<div style="font-family:${FONT};font-size:13px;color:${INK};line-height:1.55;">${escapeHtml(text)}</div>`
    : '');

  const staff = [
    h.techs_on_duty ? `Techniciens de garde&nbsp;: ${escapeHtml(h.techs_on_duty)}` : '',
    h.tech_on_break ? `En cong&eacute;&nbsp;: ${escapeHtml(h.tech_on_break)}` : '',
  ].filter(Boolean).join(' &middot; ');
  const staffBlock = staff ? `<div style="padding-top:10px;">${staticNote(staff)}</div>` : '';

  return card(
    'Assistance aux utilisateurs',
    `${kpis}${commentBlock('Commentaire &mdash; volumes', h.comments_metrics)}${commentBlock('Commentaire &mdash; SLA', h.comments_sla)}${staffBlock}`,
    NAVY,
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
  no_asset_tag:         'Sans &eacute;tiquette',
  lifecycle_exception:  'Exception de cycle de vie',
};

// Asset engagement (2026-09-18): the coordinator's own "Parc informatique" tab,
// counts FROZEN at submission (never live). Empty note on an applicable site =
// « non renseigné » on purpose — visible for the meeting, never hidden.
// kpiGrid escapes its labels → literal accents here, not entities.
const REVIEW_KPIS = [
  ['new', 'Nouveau matériel (semaine)'],
  ['unassigned', 'En service sans utilisateur ni département'],
  ['no_cost', 'Sans coût d’achat'],
  ['no_date', 'Sans date d’acquisition'],
];
// A frozen count that is null / not-a-number must read "—", never a fabricated
// 0 — a real 0 is a measurement ("nothing new this week"), a null is "we don't
// know" (e.g. the assets layer was down at submission). num()'s default of 0
// would collapse that distinction, so this checks Number.isFinite itself.
function reviewCountText(v) {
  return Number.isFinite(+v) ? String(+v) : '—';
}
function assetReviewBlock(review) {
  const rv = review && typeof review === 'object' ? review : null;
  if (!rv || rv.applicable === false || rv.applicable === 0) return '';
  const c = rv.counts && typeof rv.counts === 'object' ? rv.counts : null;
  const counts = c
    ? kpiGrid(REVIEW_KPIS.map(([k, label]) => ({ label, value: reviewCountText(c[k]) })))
    : staticNote('Compteurs non disponibles au moment de la soumission.');
  // Notes come from multi-line textareas — escapeHtml neutralises markup but
  // does not touch line breaks, so the styling must preserve them explicitly.
  const note = (v) => {
    const s = String(v == null ? '' : v).trim();
    return s
      ? `<span style="white-space:pre-line;">${escapeHtml(s)}</span>`
      : `<em style="color:${MUTED};">non renseign&eacute;</em>`;
  };
  return `<div style="padding-top:12px;">
${staticNote('Suivi du parc d&eacute;clar&eacute; par le coordinateur &mdash; compteurs fig&eacute;s &agrave; la soumission.')}
<div style="padding-top:6px;">${counts}</div>
<div style="font-family:${FONT};font-size:13px;color:${INK};line-height:1.5;padding-top:4px;"><strong>Trait&eacute; cette semaine&nbsp;:</strong> ${note(rv.handled_note)}</div>
<div style="font-family:${FONT};font-size:13px;color:${INK};line-height:1.5;padding-top:4px;"><strong>Plan / blocages&nbsp;:</strong> ${note(rv.plan_note)}</div>
</div>`;
}

/**
 * The CMDB nudge — AFTER the authored report, never before it.
 *
 * `assets === null` means the site has no AP label at all, so the caller omits
 * the whole block: zeros there would read as a clean site rather than an
 * unmeasured one. `effort` carries {effort_score, rank} only — there is
 * deliberately no delta (a ~30-day lookback barely moves week to week).
 */
function assetsSection(assets, baseUrl, labels, review) {
  const a = obj(assets);
  const hygiene = obj(a.hygiene);
  const effort = a.effort === null || a.effort === undefined ? null : obj(a.effort);

  // A count the reader cannot act on is a count nobody works. When a public
  // origin is configured, each figure links into the Assets hygiene worklist
  // pre-filtered on this site and kind; without one it stays plain text (see
  // reportConfig.public_base_url — a guessed origin ships dead links).
  //
  // The link needs the AP LABEL, not the site code, because the target's site
  // filter is built from getAssetLookups().sites. A code folding to SEVERAL
  // labels (SGO ← Sabodala + MASSAWA) gets NO link at all: the count is the sum
  // across labels, so linking one of them would open a list smaller than the
  // number promises — a quieter wrong answer than no link.
  const linkable = baseUrl && Array.isArray(labels) && labels.length === 1;
  const countCell = (k) => {
    const v = `<span style="color:${NAVY};font-weight:bold;">${escapeHtml(num(hygiene[k]))}</span>`;
    if (!linkable) return v;
    // Built with a plain '&' and escaped ONCE — escapeHtml turns it into the
    // &amp; an HTML attribute requires. Pre-escaping it here would double-encode.
    const href = `${baseUrl}/assets.html?site=${encodeURIComponent(labels[0])}&kind=${encodeURIComponent(k)}#hygiene`;
    return `<a href="${escapeHtml(href)}" style="color:${NAVY};text-decoration:underline;">${v}</a>`;
  };

  const kinds = Object.keys(hygiene).filter((k) => num(hygiene[k]) > 0);
  const list = kinds.length
    ? bulletList(kinds.map((k) => {
      const label = HYGIENE_LABELS[k] || escapeHtml(String(k).replace(/_/g, ' '));
      return `${label} ${countCell(k)}`;
    }))
    : staticNote('Aucun &eacute;cart de qualit&eacute; de donn&eacute;es &agrave; corriger. Merci&nbsp;!');

  const effortBlock = effort && effort.effort_score !== null && effort.effort_score !== undefined
    ? kpiGrid([
      { label: 'Score de tenue du parc', value: `${num(effort.effort_score)}/100` },
      { label: 'Classement des sites', value: `#${num(effort.rank)}` },
    ])
    : '';

  const intro = staticNote('Qualit&eacute; des donn&eacute;es du parc informatique &mdash; &agrave; corriger dans l&rsquo;inventaire, ind&eacute;pendamment du rapport ci-dessus.');

  return card('Parc informatique', `${effortBlock}${intro}<div style="padding-top:8px;">${list}</div>${assetReviewBlock(review)}`, TEAL);
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
    // …then the CMDB reminder. `null` omits it entirely.
    // base_url is the configured public origin (reportConfig.public_base_url) or
    // '' — absent, the counts render as plain text exactly as before.
    // A frozen review must never vanish just because the live hygiene block is
    // absent (e.g. the asset labels changed after submission) — render it on
    // its own card in that case.
    d.assets
      ? assetsSection(d.assets, d.base_url, d.assets.labels, r.asset_review)
      : (assetReviewBlock(r.asset_review) ? card('Parc informatique', assetReviewBlock(r.asset_review), TEAL) : ''),
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
