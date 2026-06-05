/**
 * inspection-pptx.js — Server-side IT Inspection PPTX generator
 *
 * Two entry points:
 *   generateInspectionPptx(record, lookups)            → Buffer (single inspection)
 *   generateAggregatePptx({ filters, aggregate, rows }, lookups) → Buffer (rollup)
 *
 * Canvas: 13.33" × 7.5" (LAYOUT_WIDE). Every table / panel uses x=0.3, w=12.73.
 * No combo charts — text + tables only — so the file opens cleanly in
 * PowerPoint and LibreOffice without `fixComboChartAxes`.
 */
'use strict';

const PptxGenJS = require('pptxgenjs');

// ── Brand palette (mirrors the C object used in reports-weekly-pptx.js) ──────
const C = {
  blue:      '145FAE',  // edv-blue
  green:     '1B9A3A',  // edv-green
  red:       'D90038',  // edv-red
  orange:    'EF631A',  // edv-orange (CTA)
  amber:     'D97706',  // color-warning (AA-safe amber text)
  slate:     '3A4A60',  // edv-slate (headers)
  darkGrey:  '333333',
  midGrey:   '666666',
  lightGrey: 'F5F5F5',
  white:     'FFFFFF',
  bg:        'FFFFFF',
  tableHead: '3A4A60',
};

const STATUS_META = {
  ok:       { lbl: 'OK',          color: C.green  },
  minor:    { lbl: 'Minor',       color: 'EAB308' },
  major:    { lbl: 'Major',       color: C.red    },
  critical: { lbl: 'Critical',    color: '7F1D1D' },
  opp:      { lbl: 'Opportunity', color: C.blue   },
  na:       { lbl: 'N/A',         color: C.midGrey },
};

// ── Shared layout helpers ───────────────────────────────────────────────────
function addTitle(slide, title, subtitle) {
  slide.addText(title, {
    x: 0.3, y: 0.18, w: 12.73, h: 0.34,
    fontSize: 18, bold: true, color: C.slate, fontFace: 'Calibri',
    valign: 'middle'
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.3, y: 0.50, w: 12.73, h: 0.20,
      fontSize: 10, color: C.midGrey, fontFace: 'Calibri',
      valign: 'middle'
    });
  }
}

// kpiTile — copied verbatim from CLAUDE.md §kpiTile, parameterised so it
// works for both 4-tile and 6-tile strips on the same canvas.
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
      fontSize: 8, bold: true, color: '111111', fontFace: 'Calibri', valign: 'middle'
    });
    slide.addText(String(t.value == null ? '—' : t.value), {
      x: x + 0.10, y: yTop + 0.17, w: tileW - 0.15, h: 0.22,
      fontSize: 18, bold: true, color: t.accent, fontFace: 'Calibri', valign: 'middle'
    });
    if (t.sub) {
      slide.addText(t.sub, {
        x: x + 0.10, y: yTop + 0.38, w: tileW - 0.15, h: 0.10,
        fontSize: 7.5, color: C.midGrey, fontFace: 'Calibri', valign: 'middle'
      });
    }
  });
}

function fmtDate(iso) {
  if (!iso) return '—';
  return String(iso).slice(0, 10);
}

function stripRagSymbols(s) {
  return String(s || '').replace(/[\u{1F7E2}\u{1F7E1}\u{1F7E0}\u{1F534}\u{1F535}]/gu, '').trim();
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Single-inspection deck (4 slides).
 * @param {object} rec     output of inspectionDb.getInspection(id)
 * @param {object} lookups output of inspectionDb.loadLookups()
 */
async function generateInspectionPptx(rec, lookups) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';   // 13.33" × 7.5"
  pptx.title  = 'IT Inspection ' + (rec.header.id || '');

  _slideCover(pptx, rec, lookups);
  _slideFindings(pptx, rec, lookups);
  _slideActions(pptx, rec);
  _slideSignOff(pptx, rec);

  return pptx.write('nodebuffer');
}

/**
 * Roll-up deck across multiple inspections (4 slides).
 */
async function generateAggregatePptx(payload, lookups) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title  = 'IT Inspections — Group Roll-up';

  _slideAggCover(pptx, payload, lookups);
  _slideAggList(pptx, payload, lookups);
  _slideAggFindings(pptx, payload);
  _slideAggMonthly(pptx, payload);

  return pptx.write('nodebuffer');
}

// ── Slide 1 — Cover + KPI strip ─────────────────────────────────────────────
function _slideCover(pptx, rec, lookups) {
  const slide = pptx.addSlide();
  const h = rec.header;

  addTitle(
    slide,
    'IT Site Inspection — ' + (h.site_code || '—') + ' · ' + (h.area_text || h.area_code || '—'),
    h.id + '  ·  ' + fmtDate(h.inspection_date) + (h.inspection_time ? ' ' + h.inspection_time : '') +
      '  ·  ' + (h.inspection_type || 'Routine')
  );

  // Status counts from the findings rows
  const counts = { ok: 0, minor: 0, major: 0, critical: 0, opp: 0, na: 0 };
  (rec.findings || []).forEach(f => {
    if (f.status && counts[f.status] != null) counts[f.status]++;
  });

  kpiStrip(slide, [
    { label: 'OK',          value: counts.ok,        accent: C.green,  sub: 'compliant'    },
    { label: 'MINOR',       value: counts.minor,     accent: 'EAB308', sub: 'mineurs'      },
    { label: 'MAJOR',       value: counts.major,     accent: C.red,    sub: 'majeurs'      },
    { label: 'CRITICAL',    value: counts.critical,  accent: '7F1D1D', sub: 'critiques'    },
    { label: 'OPPORTUNITY', value: counts.opp,       accent: C.blue,   sub: 'opportunités' },
    { label: 'N/A',         value: counts.na,        accent: C.midGrey, sub: 'non concerné' },
  ], { y: 0.85 });

  // Identification block (2 cards) — site / area / inspector + risk / impact / counts
  const cardY = 1.60;
  const cardH = 1.50;

  // Card 1 — context
  slide.addShape('rect', { x: 0.3, y: cardY, w: 6.30, h: cardH, fill: { color: C.lightGrey }, line: { color: 'DDDDDD', pt: 0.5 } });
  slide.addText('CONTEXT', { x: 0.45, y: cardY + 0.06, w: 6.00, h: 0.20, fontSize: 9, bold: true, color: C.slate });
  const ctxRows = [
    ['Site',      h.site_code || '—'],
    ['Area',      h.area_text || h.area_code || '—'],
    ['Location',  h.specific_location || '—'],
    ['Inspector', h.inspector_name + (h.inspector_role ? ' (' + h.inspector_role + ')' : '')],
    ['Witness',   h.accompanied_by || '—'],
  ];
  ctxRows.forEach((r, ix) => {
    const ry = cardY + 0.30 + ix * 0.22;
    slide.addText(r[0], { x: 0.45, y: ry, w: 1.40, h: 0.20, fontSize: 9,  color: C.midGrey, bold: true });
    slide.addText(String(r[1] || '—'), { x: 1.90, y: ry, w: 4.60, h: 0.20, fontSize: 10, color: C.darkGrey });
  });

  // Card 2 — risk
  slide.addShape('rect', { x: 6.73, y: cardY, w: 6.30, h: cardH, fill: { color: C.lightGrey }, line: { color: 'DDDDDD', pt: 0.5 } });
  slide.addText('RISK & SCOPE', { x: 6.88, y: cardY + 0.06, w: 6.00, h: 0.20, fontSize: 9, bold: true, color: C.slate });
  const riskColor = /critical/i.test(h.overall_risk || '') ? C.red
                  : /high/i.test(h.overall_risk || '')      ? C.amber
                  : /moderate/i.test(h.overall_risk || '')  ? C.amber
                  : /low/i.test(h.overall_risk || '')       ? C.green
                  : C.midGrey;
  const riskRows = [
    ['Risk',     stripRagSymbols(h.overall_risk)       || '—', riskColor],
    ['Impact',   stripRagSymbols(h.operational_impact) || '—', C.darkGrey],
    ['Type',     h.inspection_type || 'Routine',                C.darkGrey],
    ['Weather',  h.weather         || '—',                       C.darkGrey],
    ['Last insp.', fmtDate(h.last_inspection_date) || '—',       C.darkGrey],
  ];
  riskRows.forEach((r, ix) => {
    const ry = cardY + 0.30 + ix * 0.22;
    slide.addText(r[0], { x: 6.88, y: ry, w: 1.40, h: 0.20, fontSize: 9,  color: C.midGrey, bold: true });
    slide.addText(String(r[1] || '—'), { x: 8.33, y: ry, w: 4.60, h: 0.20, fontSize: 10, color: r[2], bold: ix === 0 });
  });

  // Scope
  if (h.scope) {
    slide.addText('Scope & Objectives', { x: 0.3, y: 3.20, w: 12.73, h: 0.25, fontSize: 10, bold: true, color: C.slate });
    slide.addText(h.scope, {
      x: 0.3, y: 3.48, w: 12.73, h: 1.40,
      fontSize: 10, color: C.darkGrey,
      shrinkText: true, valign: 'top', wrap: true,
      fill: { color: C.lightGrey }, margin: 8
    });
  }

  // Footer
  slide.addText('Generated ' + new Date().toISOString().slice(0, 10) + '  ·  Endeavour Mining IT', {
    x: 0.3, y: 7.20, w: 12.73, h: 0.18, fontSize: 8, color: C.midGrey, italic: true
  });
}

// ── Slide 2 — Critical & Major findings ─────────────────────────────────────
function _slideFindings(pptx, rec, lookups) {
  const slide = pptx.addSlide();
  addTitle(slide, 'Critical & Major Findings', 'Items flagged as Critical, Major, Minor or Opportunity (OK and N/A omitted)');

  const rank = { critical: 0, major: 1, minor: 2, opp: 3 };
  const issues = (rec.findings || [])
    .filter(f => rank[f.status] != null && (f.notes || f.status === 'critical' || f.status === 'major'))
    .sort((a, b) => (rank[a.status] - rank[b.status]) || String(a.item_code).localeCompare(b.item_code));

  if (issues.length === 0) {
    slide.addText('No critical or major findings recorded.', {
      x: 0.3, y: 1.20, w: 12.73, h: 0.40,
      fontSize: 12, italic: true, color: C.green, align: 'left', valign: 'middle'
    });
    return;
  }

  const headerRow = [
    { text: 'Status',  options: { bold: true, color: C.white, fill: { color: C.tableHead }, valign: 'middle' } },
    { text: 'Code',    options: { bold: true, color: C.white, fill: { color: C.tableHead }, valign: 'middle' } },
    { text: 'Item',    options: { bold: true, color: C.white, fill: { color: C.tableHead }, valign: 'middle' } },
    { text: 'Notes',   options: { bold: true, color: C.white, fill: { color: C.tableHead }, valign: 'middle' } },
  ];

  const tableRows = [headerRow].concat(issues.slice(0, 22).map(f => {
    const meta = STATUS_META[f.status] || STATUS_META.minor;
    return [
      { text: meta.lbl,                 options: { color: meta.color, bold: true, valign: 'top' } },
      { text: f.item_code || '',        options: { color: C.midGrey, valign: 'top' } },
      { text: f.item_text_en || '',     options: { color: C.darkGrey, valign: 'top' } },
      { text: f.notes || '',            options: { color: C.darkGrey, valign: 'top' } },
    ];
  }));

  // Dynamic last column — code + status fit in fixed widths, item column at
  // a reasonable share, notes absorbs the rest (canonical pattern).
  const wStatus = 1.10;
  const wCode   = 1.30;
  const wItem   = 5.20;
  const wNotes  = 12.73 - (wStatus + wCode + wItem);

  slide.addTable(tableRows, {
    x: 0.3, y: 0.78, w: 12.73,
    colW: [wStatus, wCode, wItem, wNotes],
    fontSize: 9, fontFace: 'Calibri',
    border: { type: 'solid', color: 'EEEEEE', pt: 0.5 },
    rowH: 0.28,
    autoPage: false
  });

  if (issues.length > 22) {
    slide.addText(`+ ${issues.length - 22} more — see attached spreadsheet for full list`, {
      x: 0.3, y: 7.10, w: 12.73, h: 0.20,
      fontSize: 8.5, italic: true, color: C.midGrey
    });
  }
}

// ── Slide 3 — Corrective actions ────────────────────────────────────────────
function _slideActions(pptx, rec) {
  const slide = pptx.addSlide();
  addTitle(slide, 'Corrective Actions', 'Open and in-progress actions');

  const actions = (rec.actions || []).slice().sort((a, b) => {
    const order = { Critical: 0, High: 1, Medium: 2, Low: 3 };
    return (order[a.priority] || 9) - (order[b.priority] || 9);
  });

  if (actions.length === 0) {
    slide.addText('No corrective actions on file.', {
      x: 0.3, y: 1.20, w: 12.73, h: 0.40,
      fontSize: 12, italic: true, color: C.midGrey
    });
    return;
  }

  const headerRow = [
    { text: 'Priority',    options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Linked',      options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Description', options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Owner',       options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Due',         options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
    { text: 'Status',      options: { bold: true, color: C.white, fill: { color: C.tableHead } } },
  ];

  const pcolor = p =>
    p === 'Critical' ? '7F1D1D' :
    p === 'High'     ? C.red    :
    p === 'Medium'   ? C.amber  :
    p === 'Low'      ? C.blue   : C.midGrey;

  const tableRows = [headerRow].concat(actions.slice(0, 18).map(a => [
    { text: a.priority || 'Medium', options: { color: pcolor(a.priority), bold: true } },
    { text: a.linked_item || '',    options: { color: C.midGrey } },
    { text: a.description || '',    options: { color: C.darkGrey } },
    { text: a.owner || '—',         options: { color: C.darkGrey } },
    { text: fmtDate(a.due_date),    options: { color: C.darkGrey } },
    { text: a.status || 'Open',     options: { color: C.darkGrey, bold: true } },
  ]));

  const wPri = 1.00, wLink = 1.20, wOwner = 1.60, wDue = 1.10, wStatus = 1.10;
  const wDesc = 12.73 - (wPri + wLink + wOwner + wDue + wStatus);

  slide.addTable(tableRows, {
    x: 0.3, y: 0.78, w: 12.73,
    colW: [wPri, wLink, wDesc, wOwner, wDue, wStatus],
    fontSize: 9, fontFace: 'Calibri',
    border: { type: 'solid', color: 'EEEEEE', pt: 0.5 },
    rowH: 0.30,
    autoPage: false
  });

  if (actions.length > 18) {
    slide.addText(`+ ${actions.length - 18} more actions — see full record`, {
      x: 0.3, y: 7.10, w: 12.73, h: 0.20,
      fontSize: 8.5, italic: true, color: C.midGrey
    });
  }
}

// ── Slide 4 — Observations + Signatures ─────────────────────────────────────
function _slideSignOff(pptx, rec) {
  const slide = pptx.addSlide();
  const h = rec.header;
  addTitle(slide, 'Observations & Sign-off', 'Key observations, positive findings and signatures');

  const leftW  = 7.40;
  const rightX = 0.3 + leftW + 0.30;
  const rightW = 12.73 - leftW - 0.30;

  // Key observations
  slide.addShape('rect', { x: 0.3, y: 0.85, w: leftW, h: 3.20, fill: { color: C.lightGrey }, line: { color: 'DDDDDD', pt: 0.5 } });
  slide.addText('KEY OBSERVATIONS', { x: 0.45, y: 0.92, w: leftW - 0.30, h: 0.20, fontSize: 9, bold: true, color: C.slate });
  slide.addText(h.key_observations || '—', {
    x: 0.45, y: 1.18, w: leftW - 0.30, h: 2.80,
    fontSize: 10, color: C.darkGrey, wrap: true, shrinkText: true, valign: 'top'
  });

  // Positive findings
  slide.addShape('rect', { x: 0.3, y: 4.20, w: leftW, h: 2.20, fill: { color: C.lightGrey }, line: { color: 'DDDDDD', pt: 0.5 } });
  slide.addText('POSITIVE FINDINGS', { x: 0.45, y: 4.27, w: leftW - 0.30, h: 0.20, fontSize: 9, bold: true, color: C.green });
  slide.addText(h.positive_findings || '—', {
    x: 0.45, y: 4.53, w: leftW - 0.30, h: 1.80,
    fontSize: 10, color: C.darkGrey, wrap: true, shrinkText: true, valign: 'top'
  });

  // Signatures column
  const sigs = rec.signatures || [];
  const sigByType = {};
  sigs.forEach(s => { sigByType[s.signer_type] = s; });

  const drawSig = (label, sig, yTop, height) => {
    slide.addShape('rect', { x: rightX, y: yTop, w: rightW, h: height,
      fill: { color: C.white }, line: { color: 'DDDDDD', pt: 0.5 }
    });
    slide.addText(label, { x: rightX + 0.15, y: yTop + 0.08, w: rightW - 0.30, h: 0.20, fontSize: 9, bold: true, color: C.slate });
    slide.addText(sig ? (sig.signer_name || '—') : '—', { x: rightX + 0.15, y: yTop + 0.32, w: rightW - 0.30, h: 0.22, fontSize: 11, bold: true, color: C.darkGrey });
    slide.addText(sig ? fmtDate(sig.signer_date) : '', { x: rightX + 0.15, y: yTop + 0.55, w: rightW - 0.30, h: 0.18, fontSize: 9, color: C.midGrey, italic: true });
    if (sig && sig.signature_b64) {
      slide.addImage({
        data: 'data:image/png;base64,' + sig.signature_b64,
        x: rightX + 0.15, y: yTop + 0.80, w: rightW - 0.30, h: height - 0.95,
        sizing: { type: 'contain', w: rightW - 0.30, h: height - 0.95 }
      });
    }
  };

  drawSig('LEAD INSPECTOR',  sigByType.inspector, 0.85, 2.65);
  drawSig('SITE REPRESENTATIVE', sigByType.site,  3.70, 2.70);

  // Distribution
  if (h.distribution) {
    slide.addText('Distribution: ' + h.distribution, {
      x: 0.3, y: 6.60, w: 12.73, h: 0.20,
      fontSize: 9, italic: true, color: C.midGrey
    });
  }

  slide.addText('Endeavour Mining — IT Inspection record ' + (h.id || ''), {
    x: 0.3, y: 7.20, w: 12.73, h: 0.18, fontSize: 8, color: C.midGrey, italic: true
  });
}

// ══════════════════════════════════════════════════════════════════════════
// Aggregate / roll-up slides
// ══════════════════════════════════════════════════════════════════════════

function _slideAggCover(pptx, payload, lookups) {
  const slide = pptx.addSlide();
  const f = payload.filters || {};
  const agg = payload.aggregate || { counts: {} };
  const counts = agg.counts || {};
  const range = (f.from || '—') + '  →  ' + (f.to || '—');

  addTitle(slide, 'IT Inspections — Roll-up Report', `Filter: site=${f.site || 'ALL'}  ·  period ${range}  ·  risk=${f.risk || 'any'}  ·  status=${f.status || 'any'}`);

  kpiStrip(slide, [
    { label: 'INSPECTIONS', value: counts.total           || 0, accent: C.blue,   sub: 'in scope'         },
    { label: 'CRITICAL',    value: counts.critical_count  || 0, accent: '7F1D1D', sub: 'high-risk sites'  },
    { label: 'OPEN ACT.',   value: agg.open_actions       || 0, accent: C.amber,  sub: 'not yet closed'   },
    { label: 'OVERDUE',     value: agg.overdue_actions    || 0, accent: C.red,    sub: 'past due'         },
    { label: 'SUBMITTED',   value: counts.submitted_count || 0, accent: C.green,  sub: 'awaiting review'  },
    { label: 'SITES',       value: counts.sites_covered   || 0, accent: C.slate,  sub: 'distinct sites'   },
  ], { y: 0.85 });

  // Findings status breakdown
  const fs = (agg.findingStatus || []).reduce((m, r) => { m[r.status] = r.n; return m; }, {});
  const rows = [
    ['OK',          fs.ok       || 0, C.green],
    ['Minor',       fs.minor    || 0, 'EAB308'],
    ['Major',       fs.major    || 0, C.red],
    ['Critical',    fs.critical || 0, '7F1D1D'],
    ['Opportunity', fs.opp      || 0, C.blue],
    ['N/A',         fs.na       || 0, C.midGrey],
  ];

  slide.addText('FINDINGS BY STATUS (across all inspections in scope)', {
    x: 0.3, y: 1.62, w: 12.73, h: 0.25, fontSize: 10, bold: true, color: C.slate
  });

  // 6 horizontal cards
  const cardW = (12.73 - 5 * 0.10) / 6;
  rows.forEach(([lbl, n, color], i) => {
    const x = 0.3 + i * (cardW + 0.10);
    slide.addShape('rect', { x, y: 1.95, w: cardW, h: 0.86, fill: { color: C.white }, line: { color: 'DDDDDD', pt: 0.5 } });
    slide.addShape('rect', { x, y: 1.95, w: 0.06,   h: 0.86, fill: { color }, line: { color, pt: 0 } });
    slide.addText(lbl, { x: x + 0.10, y: 2.00, w: cardW - 0.15, h: 0.20, fontSize: 9, bold: true, color: '111111' });
    slide.addText(String(n), { x: x + 0.10, y: 2.22, w: cardW - 0.15, h: 0.45, fontSize: 22, bold: true, color });
  });

  slide.addText(
    'Roll-up generated ' + new Date().toISOString().slice(0, 10) + ' from the live inspection database. ' +
    'Open the dashboard for current numbers — these counts reflect the filter at export time.',
    { x: 0.3, y: 7.05, w: 12.73, h: 0.30, fontSize: 9, italic: true, color: C.midGrey, wrap: true }
  );
}

function _slideAggList(pptx, payload, lookups) {
  const slide = pptx.addSlide();
  const rows  = (payload.rows || []).slice(0, 24);
  addTitle(slide, 'Inspections in scope', `${(payload.rows || []).length} total — top ${rows.length} by date shown`);

  if (rows.length === 0) {
    slide.addText('No inspections match these filters.', {
      x: 0.3, y: 1.20, w: 12.73, h: 0.40, fontSize: 12, italic: true, color: C.midGrey
    });
    return;
  }

  const headerRow = ['ID', 'Date', 'Site', 'Area', 'Inspector', 'Risk', 'Status'].map(t => ({
    text: t, options: { bold: true, color: C.white, fill: { color: C.tableHead } }
  }));

  const riskColor = r => /critical/i.test(r || '') ? C.red
                      : /high/i.test(r || '')       ? C.amber
                      : /moderate/i.test(r || '')   ? C.amber
                      : /low/i.test(r || '')        ? C.green
                      : C.midGrey;

  const body = rows.map(r => [
    { text: r.id || '',                       options: { color: C.darkGrey, bold: true } },
    { text: fmtDate(r.inspection_date),       options: { color: C.darkGrey } },
    { text: r.site_code || '',                options: { color: C.darkGrey } },
    { text: r.area_text || r.area_code || '', options: { color: C.darkGrey } },
    { text: r.inspector_name || '',           options: { color: C.darkGrey } },
    { text: stripRagSymbols(r.overall_risk) || '—', options: { color: riskColor(r.overall_risk), bold: true } },
    { text: r.status || 'draft',              options: { color: C.darkGrey } },
  ]);

  const wId = 1.70, wDate = 1.00, wSite = 0.90, wInsp = 2.20, wRisk = 1.10, wStatus = 1.00;
  const wArea = 12.73 - (wId + wDate + wSite + wInsp + wRisk + wStatus);

  slide.addTable([headerRow].concat(body), {
    x: 0.3, y: 0.78, w: 12.73,
    colW: [wId, wDate, wSite, wArea, wInsp, wRisk, wStatus],
    fontSize: 9, fontFace: 'Calibri',
    border: { type: 'solid', color: 'EEEEEE', pt: 0.5 },
    rowH: 0.26,
    autoPage: false
  });
}

function _slideAggFindings(pptx, payload) {
  const slide = pptx.addSlide();
  const fs = (payload.aggregate && payload.aggregate.findingStatus) || [];
  addTitle(slide, 'Findings — distribution', 'Aggregate per status across all inspections in scope');

  if (fs.length === 0) {
    slide.addText('No findings recorded yet.', {
      x: 0.3, y: 1.20, w: 12.73, h: 0.40, fontSize: 12, italic: true, color: C.midGrey
    });
    return;
  }

  const total = fs.reduce((s, r) => s + r.n, 0) || 1;

  // Bar chart manually (no Chart.js) — one rectangle per status, h proportional to count.
  const xStart = 0.5;
  const widthEach = 1.6;
  const gap = 0.30;
  const yBase  = 4.80;
  const maxH   = 3.50;

  fs.forEach((r, i) => {
    const meta = STATUS_META[r.status] || STATUS_META.minor;
    const h    = Math.max(0.15, (r.n / total) * maxH);
    const x    = xStart + i * (widthEach + gap);
    const y    = yBase - h;
    slide.addShape('rect', {
      x, y, w: widthEach, h,
      fill: { color: meta.color }, line: { color: meta.color, pt: 0 }
    });
    slide.addText(String(r.n), { x, y: y - 0.30, w: widthEach, h: 0.28, fontSize: 14, bold: true, color: meta.color, align: 'center' });
    slide.addText(meta.lbl,    { x, y: yBase + 0.05, w: widthEach, h: 0.22, fontSize: 10, color: C.darkGrey, align: 'center' });
    slide.addText(Math.round(100 * r.n / total) + '%', {
      x, y: yBase + 0.30, w: widthEach, h: 0.20, fontSize: 9, color: C.midGrey, align: 'center'
    });
  });

  slide.addText(`Total findings: ${total}`, {
    x: 0.3, y: 0.78, w: 12.73, h: 0.25, fontSize: 11, bold: true, color: C.slate
  });
}

function _slideAggMonthly(pptx, payload) {
  const slide = pptx.addSlide();
  const monthly = (payload.aggregate && payload.aggregate.monthly) || [];
  addTitle(slide, 'Inspections per month', monthly.length ? `${monthly.length} months in scope` : 'No data yet');

  if (monthly.length === 0) {
    slide.addText('No inspections logged in the selected period.', {
      x: 0.3, y: 1.20, w: 12.73, h: 0.40, fontSize: 12, italic: true, color: C.midGrey
    });
    return;
  }

  const max = Math.max.apply(null, monthly.map(m => m.n)) || 1;
  const xStart   = 0.5;
  const yBase    = 5.50;
  const maxH     = 4.00;
  const widthEach = Math.min(0.8, (12.33 / monthly.length) - 0.15);
  const gap       = 0.15;

  monthly.forEach((m, i) => {
    const h = Math.max(0.15, (m.n / max) * maxH);
    const x = xStart + i * (widthEach + gap);
    const y = yBase - h;
    slide.addShape('rect', { x, y, w: widthEach, h, fill: { color: C.orange }, line: { color: C.orange, pt: 0 } });
    slide.addText(String(m.n), { x, y: y - 0.30, w: widthEach, h: 0.28, fontSize: 11, bold: true, color: C.darkGrey, align: 'center' });
    slide.addText(m.ym,        { x, y: yBase + 0.10, w: widthEach, h: 0.25, fontSize: 8, color: C.midGrey, align: 'center' });
  });
}

module.exports = { generateInspectionPptx, generateAggregatePptx };
