/**
 * meetings-pptx.js — Server-side Meetings module PPTX generators
 *
 * Two entry points:
 *   generatePvPptx(meeting, lookups)        → Buffer (single PV deck)
 *   generateProgressPptx(progress, lookups) → Buffer (since-last-meeting deck)
 *
 * Canvas: 13.33" × 7.5" (LAYOUT_WIDE). Every table / panel uses x=0.3, w=12.73.
 * Text + tables only — no combo charts — so the deck opens cleanly in both
 * PowerPoint and LibreOffice (no `fixComboChartAxes` round-trip needed).
 *
 * Mirrors the pattern + palette used by inspection-pptx.js so the look-and-feel
 * matches across the module's exported decks.
 */
'use strict';

const PptxGenJS = require('pptxgenjs');

// ── Brand palette (mirrors the C object used in inspection-pptx.js) ─────────
const C = {
  blue:      '145FAE',
  green:     '1B9A3A',
  red:       'D90038',
  orange:    'EF631A',
  amber:     'D97706',
  purple:    '7C3AED',
  slate:     '3A4A60',
  darkGrey:  '333333',
  midGrey:   '666666',
  lightGrey: 'F5F5F5',
  white:     'FFFFFF',
  bg:        'FFFFFF',
  tableHead: '3A4A60',
};

// Map severities + statuses to palette accent colors.
const SEV_COLOR = { HIGH: C.red, MEDIUM: C.amber, LOW: C.blue };
const STATUS_COLOR = {
  open:      C.amber,
  in_progress: C.blue,
  blocked:   C.red,
  resolved:  C.green,
  cancelled: C.midGrey,
  on_track:  C.green,
  at_risk:   C.amber,
  done:      C.green,
  draft:     C.midGrey,
  submitted: C.amber,
  signed:    C.green,
  closed:    C.slate,
};

// ── Shared layout helpers ───────────────────────────────────────────────────
function addTitle(slide, title, subtitle) {
  slide.addText(title, {
    x: 0.3, y: 0.18, w: 12.73, h: 0.34,
    fontSize: 18, bold: true, color: C.slate, fontFace: 'Calibri',
    valign: 'middle',
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.3, y: 0.50, w: 12.73, h: 0.20,
      fontSize: 10, color: C.midGrey, fontFace: 'Calibri',
      valign: 'middle',
    });
  }
}

// KPI strip — identical signature to inspection-pptx.js so the visual
// language matches across exports.
function kpiStrip(slide, tiles, opts) {
  const o      = opts || {};
  const yTop   = o.y || 0.78;
  const tileH  = o.tileH || 0.50;
  const gap    = o.gap || 0.06;
  const left   = 0.3;
  const totalW = 12.73;
  const tileW  = (totalW - (tiles.length - 1) * gap) / tiles.length;

  tiles.forEach((t, i) => {
    const x = left + i * (tileW + gap);
    slide.addShape('rect', { x, y: yTop, w: tileW, h: tileH, fill: { color: C.white }, line: { color: 'DDDDDD', pt: 0.5 } });
    slide.addShape('rect', { x, y: yTop, w: 0.06,  h: tileH, fill: { color: t.accent }, line: { color: t.accent, pt: 0 } });
    slide.addText(t.label, {
      x: x + 0.10, y: yTop + 0.03, w: tileW - 0.15, h: 0.14,
      fontSize: 8, bold: true, color: '111111', fontFace: 'Calibri', valign: 'middle',
    });
    slide.addText(String(t.value == null ? '—' : t.value), {
      x: x + 0.10, y: yTop + 0.17, w: tileW - 0.15, h: 0.22,
      fontSize: 18, bold: true, color: t.accent, fontFace: 'Calibri', valign: 'middle',
    });
    if (t.sub) {
      slide.addText(t.sub, {
        x: x + 0.10, y: yTop + 0.38, w: tileW - 0.15, h: 0.10,
        fontSize: 7.5, color: C.midGrey, fontFace: 'Calibri', valign: 'middle',
      });
    }
  });
}

function fmtDate(iso) {
  if (!iso) return '—';
  return String(iso).slice(0, 10);
}

// ── Lookups helper — resolve a code to its EN label safely ──────────────────
function _lookupLabel(lookups, table, code, fallback) {
  if (!code) return fallback || '—';
  const rows = (lookups && lookups[table]) || [];
  const hit  = rows.find(r => r.code === code);
  return hit ? (hit.name_en || hit.name_fr || code) : (fallback || code);
}

// ──────────────────────────────────────────────────────────────────────────
// PV PPTX — 4 slides
//   1. Cover (header + KPI strip + 3 priorities + attendees)
//   2. Issues (sorted by severity)
//   3. Actions
//   4. Projects + Sign-off + Next meeting
// ──────────────────────────────────────────────────────────────────────────
async function generatePvPptx(meeting, lookups) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title  = 'PV ' + (meeting.reference || meeting.id || '');

  _slidePvCover(pptx, meeting, lookups);
  _slidePvIssues(pptx, meeting, lookups);
  _slidePvActions(pptx, meeting);
  _slidePvProjectsAndSignoff(pptx, meeting, lookups);

  return pptx.write('nodebuffer');
}

function _slidePvCover(pptx, m, lookups) {
  const slide = pptx.addSlide();
  const deptLabel = _lookupLabel(lookups, 'departments',      m.department, m.department);
  const stLabel   = _lookupLabel(lookups, 'meeting_statuses', m.status,     m.status);

  addTitle(
    slide,
    'PV · ' + (m.site_code || '—') + ' · ' + deptLabel,
    'Reference: ' + (m.reference || '—') + '   ·   Meeting date: ' + fmtDate(m.meeting_date) + '   ·   Status: ' + stLabel
  );

  // KPI strip — 4 tiles summarising the PV's child counts.
  const issueCount  = (m.issues  || []).length;
  const highCount   = (m.issues  || []).filter(i => i.severity === 'HIGH').length;
  const escCount    = (m.issues  || []).filter(i => i.escalate == 1 || i.escalate === true).length;
  const actCount    = (m.actions || []).length;

  kpiStrip(slide, [
    { label: 'ISSUES',     value: issueCount, accent: C.blue,   sub: 'Total raised' },
    { label: 'HIGH SEV.',  value: highCount,  accent: C.red,    sub: 'Production-impact' },
    { label: 'ESCALATED',  value: escCount,   accent: C.purple, sub: 'To Council' },
    { label: 'ACTIONS',    value: actCount,   accent: C.green,  sub: 'IT commitments' },
  ]);

  // Priorities panel (3 priorities, one row each, left-aligned).
  const priY = 1.50;
  slide.addText('Three priorities of the department', {
    x: 0.3, y: priY, w: 12.73, h: 0.24,
    fontSize: 11, bold: true, color: C.slate, fontFace: 'Calibri',
  });
  const pris = [m.priority_1, m.priority_2, m.priority_3];
  pris.forEach((p, i) => {
    slide.addShape('rect', {
      x: 0.3, y: priY + 0.30 + i * 0.50, w: 0.30, h: 0.42,
      fill: { color: C.orange }, line: { color: C.orange, pt: 0 },
    });
    slide.addText(String(i + 1), {
      x: 0.3, y: priY + 0.30 + i * 0.50, w: 0.30, h: 0.42,
      fontSize: 16, bold: true, color: C.white, align: 'center', valign: 'middle', fontFace: 'Calibri',
    });
    slide.addText(p || '(not recorded)', {
      x: 0.66, y: priY + 0.30 + i * 0.50, w: 12.37, h: 0.42,
      fontSize: 10, color: p ? C.darkGrey : C.midGrey, italic: !p,
      fontFace: 'Calibri', valign: 'middle',
    });
  });

  // Attendees panel — 2-column block at the bottom.
  const attY = 4.45;
  slide.addText('Attendees · Présents', {
    x: 0.3, y: attY, w: 12.73, h: 0.24,
    fontSize: 11, bold: true, color: C.slate, fontFace: 'Calibri',
  });
  const leftCol  = 'Dept. head:  ' + (m.department_head     || '—')
                 + '\nTitle:       ' + (m.department_head_title || '—');
  const rightCol = 'Site IT lead: ' + (m.site_it_lead || '—')
                 + '\nOther attendees: ' + (m.other_attendees || '—');
  slide.addText(leftCol, {
    x: 0.3, y: attY + 0.30, w: 6.30, h: 1.20,
    fontSize: 10, color: C.darkGrey, fontFace: 'Calibri', valign: 'top',
  });
  slide.addText(rightCol, {
    x: 6.73, y: attY + 0.30, w: 6.30, h: 1.20,
    fontSize: 10, color: C.darkGrey, fontFace: 'Calibri', valign: 'top',
  });

  // Footer
  slide.addText(`Generated ${fmtDate(new Date().toISOString())} · Endeavour Mining IT × Mines operating system`, {
    x: 0.3, y: 7.18, w: 12.73, h: 0.20,
    fontSize: 7.5, color: C.midGrey, italic: true, fontFace: 'Calibri',
  });
}

function _slidePvIssues(pptx, m, lookups) {
  const slide = pptx.addSlide();
  addTitle(slide, 'Issues raised', 'Sorted by severity (HIGH first). Escalated items flagged with ↑');

  const issues = (m.issues || []).slice().sort((a, b) => {
    const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
    return ((order[a.severity] || 3) - (order[b.severity] || 3))
        || ((a.ord || 0) - (b.ord || 0));
  });

  if (!issues.length) {
    slide.addText('No issues raised in this meeting.', {
      x: 0.3, y: 1.20, w: 12.73, h: 0.40,
      fontSize: 12, italic: true, color: C.midGrey,
    });
    return;
  }

  const headerRow = [
    { text: 'Sev.',     options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Category', options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Title',    options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Champion', options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Target',   options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Status',   options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
  ];

  const tableRows = [headerRow].concat(issues.slice(0, 18).map(i => {
    const catLabel = _lookupLabel(lookups, 'categories', i.category, i.category);
    const stLabel  = _lookupLabel(lookups, 'statuses',   i.status,   i.status);
    const sev      = i.severity || 'MEDIUM';
    const escMark  = (i.escalate == 1 || i.escalate === true) ? ' ↑' : '';
    return [
      { text: sev + escMark,           options: { color: SEV_COLOR[sev] || C.midGrey, bold: true, valign: 'top' } },
      { text: catLabel,                options: { color: C.midGrey,  valign: 'top' } },
      { text: (i.title || '') + (i.description ? '\n' + i.description : ''),
                                       options: { color: C.darkGrey, valign: 'top' } },
      { text: i.champion || '—',       options: { color: C.darkGrey, valign: 'top' } },
      { text: fmtDate(i.target_date),  options: { color: C.darkGrey, valign: 'top' } },
      { text: stLabel,                 options: { color: STATUS_COLOR[i.status] || C.midGrey, bold: true, valign: 'top' } },
    ];
  }));

  // Column widths sum to 12.73 (cover panel canonical width).
  const wSev = 0.80, wCat = 1.40, wChamp = 1.50, wTgt = 1.00, wSt = 1.00;
  const wTitle = 12.73 - (wSev + wCat + wChamp + wTgt + wSt);

  slide.addTable(tableRows, {
    x: 0.3, y: 0.78, w: 12.73,
    colW: [wSev, wCat, wTitle, wChamp, wTgt, wSt],
    fontSize: 9, fontFace: 'Calibri',
    border: { type: 'solid', color: 'EEEEEE', pt: 0.5 },
    rowH: 0.30,
    autoPage: false,
  });

  if (issues.length > 18) {
    slide.addText(`+ ${issues.length - 18} more issues — see the meeting record online for the full list`, {
      x: 0.3, y: 7.10, w: 12.73, h: 0.20,
      fontSize: 8.5, italic: true, color: C.midGrey,
    });
  }
}

function _slidePvActions(pptx, m) {
  const slide = pptx.addSlide();
  addTitle(slide, 'IT commitments (actions)', 'Open and in-progress actions. Sorted by target date (soonest first).');

  const actions = (m.actions || []).slice().sort((a, b) => {
    const at = a.target_date || '9999-12-31';
    const bt = b.target_date || '9999-12-31';
    return at.localeCompare(bt);
  });

  if (!actions.length) {
    slide.addText('No actions on file for this meeting.', {
      x: 0.3, y: 1.20, w: 12.73, h: 0.40,
      fontSize: 12, italic: true, color: C.midGrey,
    });
    return;
  }

  const headerRow = [
    { text: '#',           options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Description', options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Owner (IT)',  options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Target',      options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Status',      options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
  ];

  const tableRows = [headerRow].concat(actions.slice(0, 20).map((a, ix) => [
    { text: String(ix + 1),          options: { color: C.midGrey,  align: 'center' } },
    { text: a.description || '',     options: { color: C.darkGrey, valign: 'top' } },
    { text: a.owner_it || '—',       options: { color: C.darkGrey, valign: 'top' } },
    { text: fmtDate(a.target_date),  options: { color: C.darkGrey, valign: 'top' } },
    { text: a.status || 'open',      options: { color: STATUS_COLOR[a.status] || C.midGrey, bold: true } },
  ]));

  const wIx = 0.40, wOwner = 2.20, wTgt = 1.00, wSt = 1.10;
  const wDesc = 12.73 - (wIx + wOwner + wTgt + wSt);

  slide.addTable(tableRows, {
    x: 0.3, y: 0.78, w: 12.73,
    colW: [wIx, wDesc, wOwner, wTgt, wSt],
    fontSize: 9, fontFace: 'Calibri',
    border: { type: 'solid', color: 'EEEEEE', pt: 0.5 },
    rowH: 0.32,
    autoPage: false,
  });

  if (actions.length > 20) {
    slide.addText(`+ ${actions.length - 20} more actions`, {
      x: 0.3, y: 7.10, w: 12.73, h: 0.20,
      fontSize: 8.5, italic: true, color: C.midGrey,
    });
  }
}

function _slidePvProjectsAndSignoff(pptx, m, lookups) {
  const slide = pptx.addSlide();
  addTitle(slide, 'Projects · Sign-off · Next meeting', 'Department projects in flight + meeting closure');

  // ── Projects table (left half if any) ──
  const projects = (m.projects || []);
  const halfW    = (12.73 - 0.20) / 2;  // 6.265" each side
  const projX    = 0.3;
  const signX    = 0.3 + halfW + 0.20;

  if (projects.length) {
    slide.addText('Projects · Projets', {
      x: projX, y: 0.78, w: halfW, h: 0.24,
      fontSize: 11, bold: true, color: C.slate,
    });
    const headerRow = [
      { text: 'Name',  options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
      { text: 'Phase', options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
      { text: 'Lead',  options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
      { text: 'St.',   options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    ];
    const tableRows = [headerRow].concat(projects.slice(0, 10).map(p => [
      { text: p.project_name || '', options: { color: C.darkGrey } },
      { text: _lookupLabel(lookups, 'project_phases', p.phase, p.phase || '—'),
                                    options: { color: C.midGrey } },
      { text: p.it_lead || '—',     options: { color: C.darkGrey } },
      { text: p.status || 'on_track',
                                    options: { color: STATUS_COLOR[p.status] || C.midGrey, bold: true } },
    ]));
    slide.addTable(tableRows, {
      x: projX, y: 1.10, w: halfW,
      colW: [halfW * 0.42, halfW * 0.22, halfW * 0.22, halfW * 0.14],
      fontSize: 8.5, fontFace: 'Calibri',
      border: { type: 'solid', color: 'EEEEEE', pt: 0.5 },
      rowH: 0.28,
      autoPage: false,
    });
  } else {
    slide.addText('No projects on this PV.', {
      x: projX, y: 0.78, w: halfW, h: 0.40,
      fontSize: 10, italic: true, color: C.midGrey,
    });
  }

  // ── Sign-off panel (right) ──
  slide.addText('Sign-off · Validation', {
    x: signX, y: 0.78, w: halfW, h: 0.24,
    fontSize: 11, bold: true, color: C.slate,
  });
  const signRows = [
    ['Status',              _lookupLabel(lookups, 'meeting_statuses', m.status, m.status)],
    ['Department head:',    m.department_head || '—'],
    ['  Signed at:',        m.dept_head_signed_at || 'not signed'],
    ['Site IT lead:',       m.site_it_lead || '—'],
    ['  Signed at:',        m.site_it_signed_at || 'not signed'],
    ['Submitted at:',       m.submitted_at || '—'],
  ];
  signRows.forEach((row, i) => {
    slide.addText(row[0], {
      x: signX, y: 1.15 + i * 0.32, w: halfW * 0.45, h: 0.28,
      fontSize: 9.5, bold: true, color: C.slate,
    });
    slide.addText(row[1], {
      x: signX + halfW * 0.45, y: 1.15 + i * 0.32, w: halfW * 0.55, h: 0.28,
      fontSize: 9.5, color: C.darkGrey,
    });
  });

  // ── Next meeting panel (bottom strip) ──
  const nextY = 5.30;
  slide.addShape('rect', {
    x: 0.3, y: nextY, w: 12.73, h: 0.06,
    fill: { color: C.orange }, line: { color: C.orange, pt: 0 },
  });
  slide.addText('Next meeting · Prochaine réunion', {
    x: 0.3, y: nextY + 0.14, w: 12.73, h: 0.30,
    fontSize: 12, bold: true, color: C.slate,
  });
  slide.addText(
    'Date: ' + fmtDate(m.next_meeting_date) + '   ·   Location: ' + (m.next_meeting_location || '—'),
    {
      x: 0.3, y: nextY + 0.54, w: 12.73, h: 0.32,
      fontSize: 11, color: C.darkGrey,
    }
  );

  slide.addText(`Reference: ${m.reference || '—'} — Endeavour Mining IT × Mines operating system`, {
    x: 0.3, y: 7.18, w: 12.73, h: 0.20,
    fontSize: 7.5, color: C.midGrey, italic: true, fontFace: 'Calibri',
  });
}

// ──────────────────────────────────────────────────────────────────────────
// PROGRESS PPTX — 4 slides
//   1. Cover (site, dept, period, KPI summary)
//   2. Standing issues (carried over)
//   3. Resolved since (last meeting → now)
//   4. New since + audit trail tail
// ──────────────────────────────────────────────────────────────────────────
async function generateProgressPptx(progress, lookups) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title  = 'Progress brief · ' + (progress.site || '—') + ' · ' + (progress.department || '—');

  _slideProgCover(pptx, progress, lookups);
  _slideProgStanding(pptx, progress, lookups);
  _slideProgResolved(pptx, progress, lookups);
  _slideProgNewAndAudit(pptx, progress, lookups);

  return pptx.write('nodebuffer');
}

function _slideProgCover(pptx, p, lookups) {
  const slide  = pptx.addSlide();
  const deptLb = _lookupLabel(lookups, 'departments', p.department, p.department);
  const prev   = p.previous || {};
  const cur    = p.current  || {};

  addTitle(
    slide,
    'Since last meeting · ' + (p.site || '—') + ' · ' + deptLb,
    'Previous PV: ' + fmtDate(prev.meeting_date) + '   →   Current PV: ' + fmtDate(cur.meeting_date || p.as_of)
  );

  const sm = p.summary || {};
  kpiStrip(slide, [
    { label: 'STANDING',         value: sm.standing_total       || 0, accent: C.amber,  sub: 'open issues carried over' },
    { label: 'HIGH STANDING',    value: sm.standing_high        || 0, accent: C.red,    sub: 'production-impact' },
    { label: 'RESOLVED SINCE',   value: sm.resolved_total       || 0, accent: C.green,  sub: 'closed since last PV' },
    { label: 'NEW SINCE',        value: sm.new_total            || 0, accent: C.blue,   sub: 'raised since last PV' },
    { label: 'ESCALATED OPEN',   value: sm.escalated_open       || 0, accent: C.purple, sub: 'to IT Council' },
    { label: 'ACTIONS STANDING', value: sm.actions_standing     || 0, accent: C.slate,  sub: 'IT commitments open' },
  ]);

  // Meeting history strip
  const histY = 1.50;
  slide.addText('Recent meeting history (this site × department)', {
    x: 0.3, y: histY, w: 12.73, h: 0.24,
    fontSize: 11, bold: true, color: C.slate,
  });
  const hist = (p.meeting_history || []).slice(0, 6);
  if (!hist.length) {
    slide.addText('No prior meetings on file for this scope.', {
      x: 0.3, y: histY + 0.30, w: 12.73, h: 0.30,
      fontSize: 10, italic: true, color: C.midGrey,
    });
  } else {
    const headerRow = [
      { text: 'Reference', options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
      { text: 'Date',      options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
      { text: 'Status',    options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
      { text: 'Issues',    options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
      { text: 'Actions',   options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    ];
    const tableRows = [headerRow].concat(hist.map(h => [
      { text: h.reference || '',         options: { color: C.darkGrey, fontFace: 'Consolas' } },
      { text: fmtDate(h.meeting_date),   options: { color: C.midGrey  } },
      { text: _lookupLabel(lookups, 'meeting_statuses', h.status, h.status),
                                         options: { color: STATUS_COLOR[h.status] || C.midGrey, bold: true } },
      { text: String(h.issue_count  || 0), options: { color: C.darkGrey, align: 'center' } },
      { text: String(h.action_count || 0), options: { color: C.darkGrey, align: 'center' } },
    ]));
    slide.addTable(tableRows, {
      x: 0.3, y: histY + 0.30, w: 12.73,
      colW: [4.50, 1.60, 2.30, 2.20, 2.13],
      fontSize: 9, fontFace: 'Calibri',
      border: { type: 'solid', color: 'EEEEEE', pt: 0.5 },
      rowH: 0.30,
      autoPage: false,
    });
  }

  slide.addText(`Generated ${fmtDate(new Date().toISOString())} · Pre-brief produced from Meetings module`, {
    x: 0.3, y: 7.18, w: 12.73, h: 0.20,
    fontSize: 7.5, color: C.midGrey, italic: true, fontFace: 'Calibri',
  });
}

function _slideProgStanding(pptx, p, lookups) {
  const slide = pptx.addSlide();
  addTitle(slide, 'Standing issues · Enjeux toujours ouverts',
           'Open issues that did NOT close since the previous meeting. HIGH first, then earliest target.');

  const items = (p.standing || []);
  if (!items.length) {
    slide.addText('No standing issues — everything from the previous meeting is closed.', {
      x: 0.3, y: 1.20, w: 12.73, h: 0.40,
      fontSize: 12, italic: true, color: C.green,
    });
    return;
  }

  _renderIssueTable(slide, items.slice(0, 20), lookups);

  if (items.length > 20) {
    slide.addText(`+ ${items.length - 20} more standing issues`, {
      x: 0.3, y: 7.10, w: 12.73, h: 0.20,
      fontSize: 8.5, italic: true, color: C.midGrey,
    });
  }
}

function _slideProgResolved(pptx, p, lookups) {
  const slide = pptx.addSlide();
  addTitle(slide, 'Resolved since last meeting · Résolu depuis',
           'Issues + actions closed since the previous PV. Wins to report back to the dept.');

  const issues  = (p.resolved          || []);
  const actions = (p.actions_resolved  || []);

  if (!issues.length && !actions.length) {
    slide.addText('Nothing has closed since the previous meeting.', {
      x: 0.3, y: 1.20, w: 12.73, h: 0.40,
      fontSize: 12, italic: true, color: C.midGrey,
    });
    return;
  }

  // Top half = issues, bottom half = actions.
  let curY = 0.78;
  if (issues.length) {
    slide.addText(`Issues closed (${issues.length})`, {
      x: 0.3, y: curY, w: 12.73, h: 0.24,
      fontSize: 11, bold: true, color: C.green,
    });
    curY += 0.32;
    _renderIssueTable(slide, issues.slice(0, 10), lookups, { y: curY, maxRows: 10 });
    curY += 0.30 + 10 * 0.28;
  }
  if (actions.length) {
    slide.addText(`Actions closed (${actions.length})`, {
      x: 0.3, y: curY, w: 12.73, h: 0.24,
      fontSize: 11, bold: true, color: C.green,
    });
    curY += 0.32;
    _renderActionTable(slide, actions.slice(0, 10), { y: curY });
  }
}

function _slideProgNewAndAudit(pptx, p, lookups) {
  const slide = pptx.addSlide();
  addTitle(slide, 'New since last meeting · Nouveaux + journal',
           'Items raised since the previous PV + the last status updates from the audit trail.');

  const news    = (p.new_items     || []);
  const actNew  = (p.actions_new   || []);
  const updates = (p.updates_since || []);

  let curY = 0.78;

  if (news.length) {
    slide.addText(`New issues (${news.length})`, {
      x: 0.3, y: curY, w: 12.73, h: 0.24,
      fontSize: 11, bold: true, color: C.blue,
    });
    curY += 0.32;
    _renderIssueTable(slide, news.slice(0, 8), lookups, { y: curY, maxRows: 8 });
    curY += 0.30 + 8 * 0.28;
  }

  // Audit trail tail (most recent 8 events).
  if (updates.length) {
    slide.addText(`Audit trail · ${updates.length} update${updates.length === 1 ? '' : 's'} since last PV`, {
      x: 0.3, y: curY, w: 12.73, h: 0.24,
      fontSize: 11, bold: true, color: C.slate,
    });
    curY += 0.32;
    const auditRows = [[
      { text: 'When',   options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
      { text: 'Who',    options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
      { text: 'Type',   options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
      { text: 'Detail', options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    ]].concat(updates.slice(0, 8).map(u => [
      { text: fmtDate(u.created_at),   options: { color: C.midGrey  } },
      { text: u.actor || '—',          options: { color: C.darkGrey } },
      { text: (u.kind || '').replace(/_/g, ' '),
                                       options: { color: C.darkGrey, bold: true } },
      { text: u.body || (u.old_value ? `${u.old_value} → ${u.new_value}` : ''),
                                       options: { color: C.darkGrey, valign: 'top' } },
    ]));
    slide.addTable(auditRows, {
      x: 0.3, y: curY, w: 12.73,
      colW: [1.20, 2.00, 1.60, 7.93],
      fontSize: 9, fontFace: 'Calibri',
      border: { type: 'solid', color: 'EEEEEE', pt: 0.5 },
      rowH: 0.28,
      autoPage: false,
    });
  } else if (!news.length) {
    slide.addText('Nothing new since the previous meeting and no audit events.', {
      x: 0.3, y: 1.20, w: 12.73, h: 0.40,
      fontSize: 12, italic: true, color: C.midGrey,
    });
  }
}

// ── Shared row renderers for the progress deck ──────────────────────────────
function _renderIssueTable(slide, items, lookups, opts) {
  opts = opts || {};
  const y       = opts.y || 0.78;
  const maxRows = opts.maxRows || 18;

  const headerRow = [
    { text: 'Sev.',     options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Category', options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Title',    options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Champion', options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Target',   options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Status',   options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
  ];
  const tableRows = [headerRow].concat(items.slice(0, maxRows).map(i => {
    const sev      = i.severity || 'MEDIUM';
    const catLb    = _lookupLabel(lookups, 'categories', i.category, i.category);
    const stLb     = _lookupLabel(lookups, 'statuses',   i.status,   i.status);
    const escMark  = (i.escalate == 1 || i.escalate === true) ? ' ↑' : '';
    return [
      { text: sev + escMark,           options: { color: SEV_COLOR[sev] || C.midGrey, bold: true } },
      { text: catLb,                   options: { color: C.midGrey } },
      { text: i.title || '',           options: { color: C.darkGrey, valign: 'top' } },
      { text: i.champion || '—',       options: { color: C.darkGrey } },
      { text: fmtDate(i.target_date),  options: { color: C.darkGrey } },
      { text: stLb,                    options: { color: STATUS_COLOR[i.status] || C.midGrey, bold: true } },
    ];
  }));
  const wSev = 0.80, wCat = 1.40, wChamp = 1.50, wTgt = 1.00, wSt = 1.00;
  const wTitle = 12.73 - (wSev + wCat + wChamp + wTgt + wSt);

  slide.addTable(tableRows, {
    x: 0.3, y, w: 12.73,
    colW: [wSev, wCat, wTitle, wChamp, wTgt, wSt],
    fontSize: 9, fontFace: 'Calibri',
    border: { type: 'solid', color: 'EEEEEE', pt: 0.5 },
    rowH: 0.28,
    autoPage: false,
  });
}

function _renderActionTable(slide, items, opts) {
  opts = opts || {};
  const y = opts.y || 0.78;
  const headerRow = [
    { text: 'Description', options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Owner',       options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Target',      options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Closed at',   options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
  ];
  const tableRows = [headerRow].concat(items.slice(0, 10).map(a => [
    { text: a.description || '',     options: { color: C.darkGrey, valign: 'top' } },
    { text: a.owner_it || '—',       options: { color: C.darkGrey } },
    { text: fmtDate(a.target_date),  options: { color: C.midGrey  } },
    { text: fmtDate(a.closed_at),    options: { color: C.green, bold: true } },
  ]));
  slide.addTable(tableRows, {
    x: 0.3, y, w: 12.73,
    colW: [8.43, 2.00, 1.10, 1.20],
    fontSize: 9, fontFace: 'Calibri',
    border: { type: 'solid', color: 'EEEEEE', pt: 0.5 },
    rowH: 0.28,
    autoPage: false,
  });
}

module.exports = { generatePvPptx, generateProgressPptx };
