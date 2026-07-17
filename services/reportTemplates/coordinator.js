'use strict';
// Coordinator site report — composes the email body + the PDF-ready document
// from the §4 site-report contract (see services/siteReport.js).
//
// TWO OUTPUTS, TWO RENDERERS:
//   htmlBody — read in Outlook. Table-based layout, inline styles ONLY, no
//              <script>, no external stylesheet, no remote images. Outlook's
//              renderer (Word) drops flexbox/grid/<style> — do not "modernise"
//              this markup.
//   fullHtml — rendered to PDF by headless Chrome. Wraps htmlBody verbatim in a
//              real document; MAY carry a <style> block, but still makes zero
//              external requests (no CDN, no web fonts, no remote images).
//
// EVERY free-text field here (ticket subjects, PV descriptions, owner names,
// categories) is untrusted Zoho/user input and MUST go through escapeHtml.
// The helper is deliberately NOT called `esc` — CLAUDE.md records a real bug
// where a local `esc` that did not actually escape created false safety in
// review. If you add a field, escape it.

// EDV brand. Red is #DC2626 (Tailwind red-600), NOT the brand #D90038 — see
// CLAUDE.md: the brand red is too heavy for filled surfaces.
const RAG_COLORS = { green: '#16A34A', amber: '#D97706', red: '#DC2626' };

// The SCORE's RAG palette is the user's own dashboard palette, so the score in
// this email reads as the same score they see on screen. Their red is
// `var(--color-accent)` — a CSS custom property, which Outlook's Word renderer
// does NOT resolve (it would paint nothing), so the email uses the source's
// literal REDT fallback instead. All three take a white foreground.
const SCORE_RAG = { green: '#2f7d4f', amber: '#d99a2b', red: '#c2280f' };
const scoreRagColor = (rag) => SCORE_RAG[String(rag || '').toLowerCase()] || MUTED;
// A dim's 0/1/2 rating → its colour. 2 green · 1 amber · 0 red.
const ptsColor = (pts) => (pts >= 2 ? SCORE_RAG.green : pts >= 1 ? SCORE_RAG.amber : SCORE_RAG.red);
const NAVY = '#1E293B';
const TEAL = '#0D9488';
const INK = '#334155';
const MUTED = '#64748B';
const BORDER = '#E2E8F0';
const WASH = '#F8FAFC';
const FONT = "Arial,'Helvetica Neue',Helvetica,sans-serif";

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

// --- sections ---------------------------------------------------------------

/** The six sbDims: `label · disp` + a 0/1/2 rating chip, with the tip beneath. */
function dimsGrid(dims) {
  const cells = arr(dims);
  if (!cells.length) return '';
  const rows = [];
  for (let i = 0; i < cells.length; i += 3) rows.push(cells.slice(i, i + 3));
  const html = rows.map((row) => {
    const tds = row.map((raw) => {
      const d = obj(raw);
      const c = ptsColor(num(d.pts));
      return `<td width="33%" style="width:33%;padding:0 6px 8px 0;vertical-align:top;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background:#FFFFFF;border:1px solid ${BORDER};border-left:3px solid ${c};border-radius:4px;">
<tr><td style="padding:7px 9px;">
<div style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(d.label)}</div>
<div style="font-family:${FONT};font-size:15px;font-weight:bold;color:${NAVY};line-height:1.3;padding-top:2px;">${escapeHtml(d.disp)}
<span style="display:inline-block;font-size:9px;font-weight:bold;color:#FFFFFF;background:${c};border-radius:8px;padding:1px 6px;vertical-align:middle;">${escapeHtml(num(d.pts))}/2</span></div>
<div style="font-family:${FONT};font-size:10px;color:${MUTED};line-height:1.4;padding-top:3px;">${escapeHtml(d.tip)}</div>
</td></tr></table></td>`;
    }).join('');
    const pad = row.length < 3
      ? new Array(3 - row.length).fill('<td width="33%" style="width:33%;">&nbsp;</td>').join('')
      : '';
    return `<tr>${tds}${pad}</tr>`;
  }).join('');
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">${html}</table>`;
}

function scoreHero(score) {
  const s = obj(score);

  // No data over the window → claim NO verdict. Not a grey "—/100" and not an
  // empty six-row dims table: both of those still read as a measurement. The
  // score's two inverted dims (overdue/findings) mean an unmeasured site used to
  // score RED 33, which is what this replaces.
  //
  // Keys on `applicable === false` specifically: the engine always sets the
  // field, so a block that simply lacks it is a legacy/degraded shape and keeps
  // its previous rendering rather than silently becoming "non applicable".
  if (s.applicable === false) {
    const nw = obj(s.window);
    const span = nw.from && nw.to
      ? `<div style="font-family:${FONT};font-size:11px;color:${MUTED};line-height:1.5;padding-top:6px;">Fen&ecirc;tre&nbsp;: ${escapeHtml(nw.from)} &rarr; ${escapeHtml(nw.to)} &mdash; aucune r&eacute;union, inspection ou action mesur&eacute;e sur cette p&eacute;riode.</div>`
      : '';
    const body = `<div style="font-family:${FONT};font-size:16px;font-weight:bold;color:${NAVY};line-height:1.4;">Score non applicable &mdash; aucune donn&eacute;e sur la fen&ecirc;tre</div>${span}`;
    return card('Site score', body, MUTED);
  }

  const value = num(s.score);
  const rag = String(s.rag || '').toLowerCase();
  const color = scoreRagColor(rag);

  const trend = s.trend_pts === null || s.trend_pts === undefined
    ? `<span style="color:${MUTED};">no prior window</span>`
    : (() => {
      const t = num(s.trend_pts);
      const c = t > 0 ? SCORE_RAG.green : t < 0 ? SCORE_RAG.red : MUTED;
      const mark = t > 0 ? '&#9650;' : t < 0 ? '&#9660;' : '&#9644;';
      const sign = t > 0 ? '+' : '';
      return `<span style="color:${c};font-weight:bold;">${mark} ${sign}${escapeHtml(t)} pts</span> <span style="color:${MUTED};">vs the previous 3 months</span>`;
    })();

  // The score measures a 3-MONTH ROLLING window; every other block in this
  // report is the report month. Say so, or the two read as a contradiction.
  const w = obj(s.window);
  const windowLine = w.from && w.to
    ? `<div style="font-family:${FONT};font-size:11px;color:${MUTED};line-height:1.5;padding-bottom:8px;">Scored over the 3 months ${escapeHtml(w.from)} &rarr; ${escapeHtml(w.to)} &mdash; a rolling window. Every other section below covers the report period only.</div>`
    : '';

  // `gain` arrives ALREADY formatted ('+17 pts' / 'sustain') — render verbatim.
  const moves = arr(s.moves).map((raw) => {
    const m = obj(raw);
    return `<span style="color:${INK};">${escapeHtml(m.text)}</span> <span style="display:inline-block;font-size:11px;font-weight:bold;color:${SCORE_RAG.green};white-space:nowrap;">${escapeHtml(m.gain)}</span>`;
  });

  const movesBlock = moves.length
    ? `<div style="font-family:${FONT};font-size:11px;font-weight:bold;color:${NAVY};letter-spacing:0.6px;text-transform:uppercase;padding:4px 0 6px 0;">Two moves that lift the score most</div>${bulletList(moves)}`
    : emptyNote('No scoring gaps to close this period.');

  const body = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
<tr>
<td width="130" style="width:130px;vertical-align:top;padding:0 14px 12px 0;">
<div style="font-family:${FONT};font-size:40px;font-weight:bold;color:${color};line-height:1;">${escapeHtml(value)}<span style="font-size:16px;color:${MUTED};font-weight:normal;">/100</span></div>
<div style="font-family:${FONT};font-size:12px;color:${MUTED};padding-top:3px;">${escapeHtml(num(s.points))} / 12 pts</div>
<div style="padding-top:8px;"><span style="display:inline-block;font-family:${FONT};font-size:11px;font-weight:bold;color:#FFFFFF;background:${color};border-radius:10px;padding:3px 12px;text-transform:uppercase;letter-spacing:0.5px;">${escapeHtml(rag || 'n/a')}</span></div>
</td>
<td style="vertical-align:top;padding:0 0 12px 0;">
<div style="font-family:${FONT};font-size:13px;line-height:1.5;padding-bottom:6px;">${trend}</div>
${windowLine}
${dimsGrid(s.dims)}
${movesBlock}
</td>
</tr></table>`;

  return card('Site score', body, color);
}

function meetingsSection(meetings) {
  const m = obj(meetings);
  const kpis = kpiGrid([
    { label: 'PVs held / target', value: `${num(m.pvs_held)} / ${num(m.pvs_target)}` },
    { label: 'Open issues', value: num(m.open_issues) },
    { label: 'HIGH open', value: num(m.high_open) },
    { label: 'Resolved', value: num(m.resolved) },
    { label: 'New', value: num(m.new) },
    { label: 'Escalations', value: num(m.escalations) },
  ]);

  const depts = arr(m.departments);
  const deptBlock = depts.length
    ? `<div style="font-family:${FONT};font-size:11px;font-weight:bold;color:${NAVY};letter-spacing:0.6px;text-transform:uppercase;padding:10px 0 6px 0;">Departments</div>${bulletList(depts.map((d) => {
      const st = String(obj(d).status || '').toLowerCase();
      const c = st === 'on_track' ? RAG_COLORS.green : st === 'blocked' ? RAG_COLORS.red : RAG_COLORS.amber;
      return `${escapeHtml(obj(d).department)} &mdash; <span style="color:${c};font-weight:bold;">${escapeHtml(obj(d).status)}</span>`;
    }))}`
    : '';

  const overdue = arr(m.overdue_actions);
  const overdueBlock = overdue.length
    ? `<div style="font-family:${FONT};font-size:11px;font-weight:bold;color:${RAG_COLORS.red};letter-spacing:0.6px;text-transform:uppercase;padding:10px 0 6px 0;">Overdue actions (${overdue.length})</div>${bulletList(overdue.map((a) => {
      const it = obj(a);
      return `${escapeHtml(it.description)} <span style="color:${MUTED};">&mdash; ${escapeHtml(it.owner)}, due ${escapeHtml(it.target_date || it.due_date)}</span>`;
    }), INK)}`
    : '';

  return card('Meetings', `${kpis}${deptBlock}${overdueBlock}`, NAVY);
}

function inspectionSection(inspection) {
  const i = obj(inspection);
  const risk = String(i.overall_risk || '—');
  const riskColor = /critical|major/i.test(risk) ? RAG_COLORS.red
    : /minor|moderate/i.test(risk) ? RAG_COLORS.amber
      : /ok|none|low/i.test(risk) ? RAG_COLORS.green : MUTED;

  const kpis = kpiGrid([
    { label: 'Inspections done', value: num(i.inspections_done) },
    { label: 'Critical / major findings', value: num(i.findings_critical_major) },
  ]);
  const riskLine = `<div style="font-family:${FONT};font-size:13px;color:${INK};padding:4px 0 0 0;">Overall risk: <span style="color:${riskColor};font-weight:bold;">${escapeHtml(risk)}</span></div>`;

  const overdue = arr(i.overdue_actions);
  const overdueBlock = overdue.length
    ? `<div style="font-family:${FONT};font-size:11px;font-weight:bold;color:${RAG_COLORS.red};letter-spacing:0.6px;text-transform:uppercase;padding:10px 0 6px 0;">Overdue actions (${overdue.length})</div>${bulletList(overdue.map((a) => {
      const it = obj(a);
      return `${escapeHtml(it.description)} <span style="color:${MUTED};">&mdash; ${escapeHtml(it.owner)}, due ${escapeHtml(it.due_date || it.target_date)}</span>`;
    }))}`
    : '';

  return card('Inspection', `${kpis}${riskLine}${overdueBlock}`, NAVY);
}

function helpdeskSection(helpdesk) {
  const h = obj(helpdesk);
  const kpis = kpiGrid([
    { label: 'Created', value: num(h.created) },
    { label: 'Resolved', value: num(h.resolved) },
    { label: 'Backlog', value: num(h.backlog) },
    { label: 'SLA overdue', value: num(h.sla_overdue) },
    { label: 'Major incidents', value: num(h.major_incidents) },
  ]);

  // The incidents still RUNNING — a different population from the KPI tile above,
  // which counts the ones raised this month. Labelled so the two never read as a
  // contradiction when they disagree (an incident opened in May and still open
  // appears here and not there).
  const mis = arr(h.major_incidents_open);
  const miBlock = mis.length
    ? `<div style="font-family:${FONT};font-size:11px;font-weight:bold;color:${RAG_COLORS.red};letter-spacing:0.6px;text-transform:uppercase;padding:10px 0 6px 0;">Open major incidents (${mis.length}) &mdash; still running now</div>${bulletList(mis.map((raw) => {
      const mi = obj(raw);
      const bits = [mi.status && escapeHtml(mi.status), mi.downtime && `${escapeHtml(mi.downtime)} down`, mi.created_time && `opened ${escapeHtml(String(mi.created_time).slice(0, 10))}`].filter(Boolean).join(' &middot; ');
      const late = mi.overdue ? chip('late', RAG_COLORS.red) : '';
      return `<strong style="color:${NAVY};">${escapeHtml(mi.display_id)}</strong> ${escapeHtml(mi.subject)} ${late}<span style="color:${MUTED};"> &mdash; ${bits}</span>`;
    }))}`
    : '';

  const cats = arr(h.top_categories);
  const catBlock = cats.length
    ? `<div style="font-family:${FONT};font-size:11px;font-weight:bold;color:${NAVY};letter-spacing:0.6px;text-transform:uppercase;padding:10px 0 6px 0;">Top categories</div>${bulletList(cats.map((c) => {
      const it = obj(c);
      return `${escapeHtml(it.category || it.label)} <span style="color:${MUTED};">(${escapeHtml(num(it.count))})</span>`;
    }))}`
    : '';

  const rec = arr(h.recurring);
  const recBlock = rec.length
    ? `<div style="font-family:${FONT};font-size:11px;font-weight:bold;color:${NAVY};letter-spacing:0.6px;text-transform:uppercase;padding:10px 0 6px 0;">Recurring</div>${bulletList(rec.map((r) => {
      const it = obj(r);
      return `${escapeHtml(it.label || it.category)} <span style="color:${MUTED};">(${escapeHtml(num(it.count))}&times;)</span>`;
    }))}`
    : '';

  return card('Helpdesk', `${kpis}${miBlock}${catBlock}${recBlock}`, NAVY);
}

/**
 * Planned + emergency work carried out on the site's systems this month.
 *
 * PLAIN WORDS ONLY — this email is read by site coordinators, not by ITSM staff.
 * "Changes", "Emergency", "Backed out". Never "RFC", never "CAB"; a test asserts it.
 *
 * `success_pct === null` means nothing was actually carried out — there is no rate
 * to state, so it renders '—'. It must NEVER print "0%": that is a verdict, and a
 * site with nothing to judge has not earned one. A genuine 0 (everything failed)
 * IS a measurement and does print 0%.
 */
function changesSection(changes) {
  const c = obj(changes);
  const pct = c.success_pct === null || c.success_pct === undefined ? '—' : `${num(c.success_pct)}%`;

  const kpis = kpiGrid([
    { label: 'Changes', value: num(c.total) },
    { label: 'Successful', value: num(c.successful) },
    { label: 'Failed', value: num(c.failed) },
    { label: 'Emergency', value: num(c.emergency) },
    { label: 'Success rate', value: pct },
  ]);

  // The counts next to the rate, not the rate alone: on a thin month the
  // percentage is computed over a handful of changes and a single failure reads
  // as "50%". Say what it is measured over.
  const backedOut = num(obj(c.buckets).backed_out);
  const notes = [
    c.success_pct === null || c.success_pct === undefined
      ? 'No change was carried out this month — there is no success rate to report.'
      : `Success rate is ${num(c.successful)} of the ${num(c.executed)} change(s) actually carried out this month.`,
    backedOut ? `${backedOut} change(s) were backed out — counted under Failed.` : '',
    num(c.pending) ? `${num(c.pending)} change(s) are still in progress.` : '',
  ].filter(Boolean).join(' ');

  return card('Changes', `${kpis}${emptyNote(notes)}`, NAVY);
}

function techniciansSection(technicians) {
  const techs = arr(technicians);
  if (!techs.length) return card('Technicians', emptyNote('No technician activity this period.'), NAVY);

  const th = (label, align = 'left') => `<th align="${align}" style="font-family:${FONT};font-size:10px;font-weight:bold;color:${MUTED};text-transform:uppercase;letter-spacing:0.5px;text-align:${align};padding:0 6px 6px 0;border-bottom:1px solid ${BORDER};">${escapeHtml(label)}</th>`;
  const td = (html, align = 'left') => `<td align="${align}" style="font-family:${FONT};font-size:12px;color:${INK};text-align:${align};padding:7px 6px 7px 0;border-bottom:1px solid ${BORDER};vertical-align:top;">${html}</td>`;

  const rows = techs.map((t) => {
    const it = obj(t);
    const alerts = arr(it.alerts).map((a) => chip(String(a).replace(/_/g, ' '), RAG_COLORS.amber)).join('') || `<span style="color:${MUTED};font-family:${FONT};font-size:11px;">&mdash;</span>`;
    return `<tr>
${td(`<strong style="color:${NAVY};">${escapeHtml(it.name)}</strong>`)}
${td(escapeHtml(num(it.assigned)), 'right')}
${td(escapeHtml(num(it.resolved)), 'right')}
${td(`${escapeHtml(num(it.avg_resolution_h))}h`, 'right')}
${td(escapeHtml(num(it.reopened)), 'right')}
${td(escapeHtml(num(it.current_load)), 'right')}
${td(alerts)}
</tr>`;
  }).join('');

  const table = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">
<tr>${th('Technician')}${th('Assigned', 'right')}${th('Resolved', 'right')}${th('Avg res.', 'right')}${th('Reopened', 'right')}${th('Load', 'right')}${th('Alerts')}</tr>
${rows}
</table>`;

  return card('Technicians', table, NAVY);
}

/** The point of the report — the coordinator's "what do I do now". */
function recommendedSection(recommended) {
  const items = arr(recommended);
  const inner = items.length
    ? items.map((r, ix) => {
      const it = obj(r);
      const kind = it.kind ? `<div style="font-family:${FONT};font-size:10px;font-weight:bold;color:${TEAL};text-transform:uppercase;letter-spacing:0.6px;padding-bottom:2px;">${escapeHtml(it.kind)}</div>` : '';
      return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;background:#FFFFFF;border:1px solid ${BORDER};border-left:4px solid ${TEAL};border-radius:4px;margin:0 0 8px 0;">
<tr>
<td width="30" style="width:30px;vertical-align:top;padding:10px 0 10px 10px;font-family:${FONT};font-size:16px;font-weight:bold;color:${TEAL};line-height:1.3;">${ix + 1}.</td>
<td style="vertical-align:top;padding:10px 12px 10px 4px;">${kind}<div style="font-family:${FONT};font-size:14px;font-weight:bold;color:${NAVY};line-height:1.45;">${escapeHtml(it.text)}</div></td>
</tr></table>`;
    }).join('')
    : `<div style="font-family:${FONT};font-size:13px;color:${INK};background:#FFFFFF;border:1px solid ${BORDER};border-radius:4px;padding:12px;">Nothing needs your attention this period.</div>`;

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;border:2px solid ${TEAL};border-radius:6px;margin:0 0 14px 0;">
<tr><td style="background:${TEAL};padding:9px 14px;border-radius:4px 4px 0 0;">
<div style="font-family:${FONT};font-size:13px;font-weight:bold;color:#FFFFFF;letter-spacing:0.8px;text-transform:uppercase;">Recommended actions</div>
</td></tr>
<tr><td style="padding:12px 12px 6px 12px;background:${WASH};border-radius:0 0 4px 4px;">${inner}</td></tr>
</table>`;
}

function header(data) {
  const site = escapeHtml(data.site_name || data.site_code);
  const label = escapeHtml(obj(data.period).label);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background:${NAVY};border-radius:6px;margin:0 0 14px 0;">
<tr><td style="padding:16px 16px 14px 16px;">
<div style="font-family:${FONT};font-size:11px;color:#94A3B8;letter-spacing:1px;text-transform:uppercase;padding-bottom:4px;">Site IT Scorecard</div>
<div style="font-family:${FONT};font-size:22px;font-weight:bold;color:#FFFFFF;line-height:1.25;">${site}</div>
<div style="font-family:${FONT};font-size:13px;color:#CBD5E1;padding-top:3px;">${label}</div>
</td></tr>
<tr><td style="background:${TEAL};height:4px;line-height:4px;font-size:0;border-radius:0 0 6px 6px;">&nbsp;</td></tr>
</table>`;
}

// What this is — bilingual, both languages stacked. An email cannot carry the
// meetings module's EN/FR toggle, so the same stacked copy ships here AND on
// public/site-report.html (#introSection) — one product, one wording. Keep the
// two in step. Deliberately does NOT repeat the rolling-window disclosure:
// scoreHero() already prints it with the real dates.
//
// The "start with the two moves" pointer is CONDITIONAL on the score being
// applicable: a site with no data on the window has no score and no moves
// (see scoreHero's applicable===false branch), so pointing at them would be a
// lie. The explanation itself still helps there — it says what is missing.
function intro(score) {
  const hasMoves = obj(score).applicable !== false;
  const p = `font-family:${FONT};font-size:12px;line-height:1.55;color:${MUTED};margin:0;`;
  const enMoves = hasMoves ? ` <strong style="color:${NAVY};">Start with the two moves</strong> &mdash; the highest-value gaps you can close this month.` : '';
  const frMoves = hasMoves ? ` <strong style="color:${NAVY};">Commencez par les deux actions</strong> &mdash; les &eacute;carts les plus rentables &agrave; combler ce mois-ci.` : '';
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:separate;background:#FFFFFF;border:1px solid ${BORDER};border-radius:6px;margin:0 0 14px 0;">
<tr><td style="padding:14px 16px;">
<p style="${p}"><strong style="color:${NAVY};">What this score measures</strong> &mdash; how well the site keeps up the Group IT operating routine: departmental reviews, issues closed, inspections run, PVs signed. It is <strong>not</strong> a rating of IT service quality: a busy site can score low if it skips its reviews, a quiet one can score well.${enMoves}</p>
<p style="${p}padding-top:10px;margin-top:10px;border-top:1px solid ${BORDER};"><strong style="color:${NAVY};">Ce que mesure cette note</strong> &mdash; la tenue du dispositif IT du Groupe sur le site&nbsp;: r&eacute;unions d&eacute;partementales tenues, probl&egrave;mes cl&ocirc;tur&eacute;s, inspections r&eacute;alis&eacute;es, PV sign&eacute;s. Ce n&rsquo;est <strong>pas</strong> une note sur la qualit&eacute; du service IT&nbsp;: un site tr&egrave;s sollicit&eacute; peut mal noter s&rsquo;il saute ses r&eacute;unions, un site calme peut bien noter.${frMoves}</p>
</td></tr>
</table>`;
}

function footer(data) {
  return `<div style="font-family:${FONT};font-size:11px;color:${MUTED};line-height:1.5;padding:4px 2px 8px 2px;">Endeavour Mining &middot; IT Operations &middot; generated from the SDP Dashboard for ${escapeHtml(data.site_code)}. Reply to this email to reach the IT coordinator.</div>`;
}

function composeCoordinator(data) {
  const d = obj(data);
  const siteName = d.site_name || d.site_code || 'Site';
  const label = obj(d.period).label || '';
  const subject = `Site IT Scorecard — ${siteName} — ${label}`;

  const content = [
    header(d),
    intro(d.score),
    scoreHero(d.score),
    meetingsSection(d.meetings),
    inspectionSection(d.inspection),
    helpdeskSection(d.helpdesk),
    changesSection(d.changes),
    techniciansSection(d.technicians),
    recommendedSection(d.recommended),
    footer(d),
  ].join('\n');

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

  // PDF document. Wraps htmlBody verbatim — the <style> below only adds print
  // geometry, so the PDF and the email never drift apart. No external requests.
  const fullHtml = `<!doctype html>
<html lang="en">
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

module.exports = { composeCoordinator, escapeHtml };
