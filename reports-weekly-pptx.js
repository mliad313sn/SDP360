/**
 * Endeavour Mining — Weekly & Monthly Report PPTX Generator
 * Uses pptxgenjs to build slides matching the report template.
 * Colors: Orange #E87722, Dark Blue #1C3A5E, Light Grey #F2F2F2
 */
'use strict';

const PptxGenJS = require('pptxgenjs');
const { fixComboChartAxes } = require('./pptx-fix-axes');

// Brand palette — sourced from public/brand/brand-tokens.js (single source
// of truth, mirrors public/_tokens.css). `C` is the legacy PPTX palette
// preserved for visual parity with existing slides; `EDV` is the
// brand-aligned palette for new slides. See public/brand/README.md.
const { C, EDV, FONTS } = require('./public/brand/brand-tokens');

// Shared RAG/trend helpers — single source of truth, also used by
// reports-monthly-pptx.js (see reports-pptx-shared.js).
const { statusColor, trendArrow, trendColor, computeTrends, autoStatusColor } = require('./reports-pptx-shared');

// ── SLIDE HELPERS ─────────────────────────────────────────────────
function addTitle(slide, text, subtitle) {
  slide.addText(text, {
    x: 0.3, y: 0.15, w: 9.4, h: 0.55,
    fontSize: 28, bold: true, color: C.orange, fontFace: 'Calibri', align: 'center'
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.3, y: 0.72, w: 9.4, h: 0.3,
      fontSize: 13, color: C.midGrey, fontFace: 'Calibri', align: 'center', italic: true
    });
  }
}

function addSectionBadge(slide, text, x, y, w, fillColor) {
  // Default banner colour is the navy `C.blue`; pass a custom hex (e.g.
  // 'C53030' deep red) for sections like Active Major Incidents that need
  // a different visual emphasis.
  slide.addShape('rect', { x, y, w, h: 0.32, fill: { color: fillColor || C.blue } });
  slide.addText(text, { x, y, w, h: 0.32, fontSize: 11, bold: true, color: C.white, fontFace: 'Calibri', align: 'left', margin: [0,0,0,8] });
}

// ── Shared: render an "Active Major Incidents" block on any slide ──────
//
// Used by slideLights() (weekly) and slideMonthlyLightsV2() (monthly).
//
// Layout decisions (from user feedback):
//   • FULL slide width (12.73") — single row per incident, NOT split
//     into 2 columns. Sites typically have 1-2 active majors at a time
//     so the wide layout reads cleaner and gives the chip columns
//     enough room not to wrap.
//   • Title banner red (#C53030) so it's distinct from the navy Active
//     Changes banner above it.
//   • Column header row navy (#2A5490) — same blue as the changes
//     table, so the two blocks visually rhyme.
//   • Generous column widths for RCA/CA/PIR/LL so the labels never
//     wrap and the ✓/◐/✗ chips have room to breathe.
//
// Inputs:
//   incidents : array shaped like rdb.getActiveMajorIncidentsForSite()
//               (display_id, subject, requester, overdue, due_by_time,
//                rca_status, ca_status, pir_status, ll_status, …)
//   startY    : top edge — caller positions the block based on what's
//               immediately above (typically the changes table).
//   maxRows   : hard cap on rows shown before falling back to "+N more"
//               hint (default 3 — keeps the strip slim under heavy
//               change activity).
// Returns the Y position right below the rendered block.
function addActiveIncidentsBlock(slide, incidents, startY, maxRows) {
  maxRows = maxRows || 3;
  const totalW = 12.73;

  // Title banner — red, full width
  addSectionBadge(slide, '🚨 Active Major Incidents — ServiceDesk Plus (auto)', 0.3, startY, totalW, 'C53030');

  if (!incidents || incidents.length === 0) {
    slide.addText('No active major incidents for this site. ✓', {
      x:0.4, y:startY + 0.35, w:totalW - 0.2, h:0.30,
      fontSize:10, color:'27ae60', fontFace:'Calibri', italic:true
    });
    return startY + 0.72;
  }

  // ── Column widths — full 12.73" slide width ──
  // [#ID, Subject, Owner, Due, RCA, CA, PIR, LL]  =  12.73 total
  //   #ID 0.7  Subject 5.13  Owner 1.8  Due 1.1
  //   RCA 1.0  CA 1.0  PIR 1.0  LL 1.0
  const colW = [0.7, 5.13, 1.8, 1.1, 1.0, 1.0, 1.0, 1.0];

  // Header row — navy (matches the changes table for visual rhyme)
  const HDR_FILL = { color: '2A5490' };
  const hdr = [
    { text: '#ID',     options:{ bold:true, fill:HDR_FILL, color:C.white, fontSize:8, align:'center' } },
    { text: 'Subject', options:{ bold:true, fill:HDR_FILL, color:C.white, fontSize:8 } },
    { text: 'Owner',   options:{ bold:true, fill:HDR_FILL, color:C.white, fontSize:8 } },
    { text: 'Due',     options:{ bold:true, fill:HDR_FILL, color:C.white, fontSize:8, align:'center' } },
    { text: 'RCA',     options:{ bold:true, fill:HDR_FILL, color:C.white, fontSize:8, align:'center' } },
    { text: 'CA',      options:{ bold:true, fill:HDR_FILL, color:C.white, fontSize:8, align:'center' } },
    { text: 'PIR',     options:{ bold:true, fill:HDR_FILL, color:C.white, fontSize:8, align:'center' } },
    { text: 'LL',      options:{ bold:true, fill:HDR_FILL, color:C.white, fontSize:8, align:'center' } },
  ];

  const completenessGlyph = (status) => {
    if (status === 'done')    return { txt: '✓', col: '27ae60' };
    if (status === 'partial') return { txt: '◐', col: 'D97706' };
    return                       { txt: '✗', col: 'DC2626' };
  };
  const fmtDate = d => {
    if (!d) return '—';
    const dt = new Date(d); if (isNaN(dt)) return '—';
    return dt.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' });
  };

  const shown = incidents.slice(0, maxRows);
  const rows = shown.map((i, idx) => {
    const fill    = { color: idx % 2 === 0 ? C.lightGrey : C.white };  // navy zebra (same as changes)
    const dueText = (i.overdue ? '⚠ ' : '') + fmtDate(i.due_by_time);
    const idTxt   = '#' + (i.display_id || i.request_id || '');
    const owner   = i.requester || i.technician || '—';
    const rca = completenessGlyph(i.rca_status);
    const ca  = completenessGlyph(i.ca_status);
    const pir = completenessGlyph(i.pir_status);
    const ll  = completenessGlyph(i.ll_status);
    return [
      { text: idTxt,           options:{ fontSize:8, align:'center', bold:true, fill, color: i.overdue ? C.red : '7a1f1f' } },
      { text: i.subject || '', options:{ fontSize:8, wrap:true, fill, color:C.darkGrey } },
      { text: owner,           options:{ fontSize:8, fill, color:C.darkGrey } },
      { text: dueText,         options:{ fontSize:8, align:'center', bold:i.overdue, fill, color: i.overdue ? C.red : '444444' } },
      { text: rca.txt,         options:{ fontSize:11, align:'center', bold:true, fill, color: rca.col } },
      { text: ca.txt,          options:{ fontSize:11, align:'center', bold:true, fill, color: ca.col  } },
      { text: pir.txt,         options:{ fontSize:11, align:'center', bold:true, fill, color: pir.col } },
      { text: ll.txt,          options:{ fontSize:11, align:'center', bold:true, fill, color: ll.col  } },
    ];
  });

  slide.addTable([hdr, ...rows], {
    x: 0.3, y: startY + 0.32, w: totalW, fontFace:'Calibri',
    border:{ type:'solid', color:'DDDDDD', pt:0.5 },
    rowH: 0.26, colW
  });

  // Y position after table (banner + header row + N data rows)
  let outY = startY + 0.32 + 0.26 * (shown.length + 1);

  // Overflow hint
  if (incidents.length > maxRows) {
    slide.addText(`+ ${incidents.length - maxRows} more not shown — see executive Incident Register for the full list.`, {
      x:0.3, y:outY + 0.02, w:totalW, h:0.22, fontSize:8.5, italic:true, color:C.midGrey, fontFace:'Calibri'
    });
    outY += 0.24;
  }

  // Legend so the reader knows what ✓/◐/✗ mean (compact, single line)
  slide.addText([
    { text: 'RCA/CA/PIR/LL:  ',  options:{ fontSize:8, bold:true, color:C.midGrey } },
    { text: '✓ done  ',          options:{ fontSize:8, color:'27ae60', bold:true } },
    { text: '◐ partial  ',       options:{ fontSize:8, color:'D97706', bold:true } },
    { text: '✗ missing',         options:{ fontSize:8, color:'DC2626', bold:true } },
  ], { x:0.3, y:outY + 0.04, w:totalW, h:0.22, fontFace:'Calibri', valign:'top' });
  return outY + 0.30;
}

// ── SLIDE 1 — INFRA KPIs ──────────────────────────────────────────
function slideInfraKpis(pptx, report, label, prevKpis) {
  const slide = pptx.addSlide();
  addTitle(slide, `1. Infrastructure KPIs${label ? ' — ' + label : ''}`, null);

  // Auto-compute trend direction from current vs previous week values
  const kpis = computeTrends(report.infra_kpis || [], prevKpis || []);
  const rows = [
    [
      { text: 'Service',  options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'left' } },
      { text: 'KPI',      options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'left' } },
      { text: 'Target',   options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center' } },
      { text: 'Status',   options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center' } },
      { text: 'Trend',    options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center' } },
    ],
    ...(kpis.length ? kpis : [{service:'—', kpi:'—', target:'—', status_value:'—', status_color:'none', trend:'no_change'}]).map((k, i) => {
      const { color: sc, hasColor } = autoStatusColor(k.status_value, k.target, k.status_color);
      const ta = trendArrow(k.trend);
      const tc = trendColor(k.trend);
      const rowFill = i % 2 === 0 ? C.lightGrey : C.white;
      return [
        { text: k.service,           options: { fill: { color: rowFill }, align: 'left', bold: true } },
        { text: k.kpi,               options: { fill: { color: rowFill }, align: 'left' } },
        { text: k.target||'—',       options: { fill: { color: rowFill }, align: 'center' } },
        { text: k.status_value||'—', options: { fill: { color: hasColor ? sc : rowFill }, color: hasColor ? C.white : C.darkGrey, bold: true, align: 'center' } },
        { text: ta,                  options: { fill: { color: rowFill }, color: tc, bold: true, align: 'center', fontSize: 14 } },
      ];
    })
  ];

  slide.addTable(rows, {
    x: 0.5, y: 1.1, w: 9.0, h: 5.4,
    fontFace: 'Calibri', fontSize: 12,
    border: { type: 'solid', color: 'CCCCCC', pt: 0.5 },
    rowH: kpis.length > 0 ? Math.min(0.7, 5.4 / (kpis.length + 1)) : 0.6,
    colW: [1.8, 2.2, 1.2, 1.8, 2.0],
  });
  return slide;
}

// ── SLIDE 2 — HELPDESK METRICS 1/2 ───────────────────────────────
function slideHelpdeskMetrics1(pptx, report) {
  const slide = pptx.addSlide();

  const hd     = report.helpdesk || {};
  const cd     = (hd.chart_data && typeof hd.chart_data === 'object') ? hd.chart_data : {};
  const weeks  = Array.isArray(cd.weeks)  ? cd.weeks
               : Array.isArray(hd.group_metrics) ? hd.group_metrics : [];
  const ageing = Array.isArray(cd.ageing) ? cd.ageing : [];
  const selGrp = hd.selected_group || cd.group || null;
  const top10  = Array.isArray(cd.top10) ? cd.top10 : [];

  // Title only — no subtitle (week/group shown in KPI strip area)
  addTitle(slide, '2. Helpdesk Metrics', null);

  // ── KPI STRIP HELPERS ────────────────────────────────────────────
  const curWk       = weeks.length ? weeks[weeks.length - 1] : null;
  const prevWk      = weeks.length > 1 ? weeks[weeks.length - 2] : null;
  const ageTotalOpen = cd.ageing_total || ageing.reduce((s, v) => s + v, 0);

  const fmtHrs  = h => h != null ? (h >= 24 ? `${Math.round(h/24)}d` : `${h}h`) : '—';
  const fmtDays = d => d != null ? `${d}d` : '—';
  const fmtPct  = p => p != null ? `${p}%` : '—';
  const fmtNum  = n => n != null ? String(n) : '—';

  // Returns a signed delta string, or null if data missing
  const delta = (cur, prev, dec=0) => {
    if (cur == null || prev == null) return null;
    const d = parseFloat((cur - prev).toFixed(dec));
    return d === 0 ? '±0' : (d > 0 ? `+${d}` : `${d}`);
  };

  // Draw one KPI tile
  const tileW = 3.15;
  const tileG = 0.04;
  const tileH = 0.40;
  const tX = i => 0.3 + i * (tileW + tileG);

  const kpiTile = (col, row, label, value, deltaStr, deltaColor, accent) => {
    const x = tX(col);
    const y = row === 0 ? 0.62 : 1.12;   // row gap = 0.10" (was 0.03")
    slide.addShape('rect', { x, y, w: tileW, h: tileH, fill: { color: 'FFFFFF' }, line: { color: 'DDDDDD', pt: 0.5 } });
    slide.addShape('rect', { x, y, w: 0.06, h: tileH, fill: { color: accent }, line: { color: accent, pt: 0 } });
    // Layout (tileH=0.40"): 0.03 gap | label 0.10 | value 0.16 | delta 0.08 | 0.03 gap
    slide.addText(label, {
      x: x+0.1, y: y+0.03, w: tileW-0.15, h: 0.10,
      fontSize: 6.5, bold: true, color: '111111', fontFace: 'Calibri', valign: 'middle'
    });
    slide.addText(String(value ?? '—'), {
      x: x+0.1, y: y+0.13, w: tileW-0.15, h: 0.16,
      fontSize: 14, bold: true, color: C.blue, fontFace: 'Calibri', valign: 'middle'
    });
    if (deltaStr) {
      slide.addText(deltaStr, {
        x: x+0.1, y: y+0.29, w: tileW-0.15, h: 0.08,
        fontSize: 6.5, color: deltaColor || C.midGrey, fontFace: 'Calibri', valign: 'middle'
      });
    }
  };

  // ── ROW 1 — Volume & SLA ────────────────────────────────────────
  // Shorthand: previous week label for context in delta strings
  const pLbl = prevWk?.label || '';
  const prevRef = v => pLbl ? `prev: ${v} (${pLbl})` : `prev: ${v}`;

  // Tile 0: Inbound
  const inbDelta = delta(curWk?.inbound, prevWk?.inbound);
  kpiTile(0, 0, 'INBOUND TICKETS', fmtNum(curWk?.inbound),
    inbDelta ? `${inbDelta}  ·  ${prevRef(fmtNum(prevWk?.inbound))}` : null, C.midGrey, C.blue);

  // Tile 1: Closed (with closure %)
  const clsPct = (curWk?.inbound > 0)
    ? ` (${Math.round(curWk.closed / curWk.inbound * 100)}%)`  : '';
  const clsDelta = delta(curWk?.closed, prevWk?.closed);
  const clsColor = clsDelta ? (parseFloat(clsDelta) >= 0 ? C.green : C.red) : C.midGrey;
  const prevClsPct = (prevWk?.inbound > 0)
    ? ` (${Math.round(prevWk.closed / prevWk.inbound * 100)}%)` : '';
  kpiTile(1, 0, 'CLOSED TICKETS',
    curWk ? `${curWk.closed}${clsPct}` : '—',
    clsDelta ? `${clsDelta}  ·  ${prevRef(`${prevWk?.closed ?? '—'}${prevClsPct}`)}` : null, clsColor, '27AE60');

  // Tile 2: Res. SLA OK %
  const resDelta = delta(curWk?.res_ok_pct, prevWk?.res_ok_pct, 1);
  const resColor = resDelta ? (parseFloat(resDelta) >= 0 ? C.green : C.red) : C.midGrey;
  kpiTile(2, 0, 'RES. SLA OK %', fmtPct(curWk?.res_ok_pct),
    resDelta ? `${resDelta}pt  ·  ${prevRef(fmtPct(prevWk?.res_ok_pct))}` : null, resColor, 'E87722');

  // Tile 3: 1st Reply SLA %
  const frPctDelta = delta(curWk?.fr_ok_pct, prevWk?.fr_ok_pct, 1);
  const frPctColor = frPctDelta ? (parseFloat(frPctDelta) >= 0 ? C.green : C.red) : C.midGrey;
  kpiTile(3, 0, '1ST REPLY SLA %', fmtPct(curWk?.fr_ok_pct),
    frPctDelta ? `${frPctDelta}pt  ·  ${prevRef(fmtPct(prevWk?.fr_ok_pct))}` : null, frPctColor, 'E74C3C');

  // ── ROW 2 — Timing & Status ──────────────────────────────────────
  // Tile 0: Time to Assign
  const ttaDelta = delta(curWk?.avg_tta_hrs, prevWk?.avg_tta_hrs);
  const ttaColor = ttaDelta ? (parseFloat(ttaDelta) <= 0 ? C.green : C.red) : C.midGrey;
  kpiTile(0, 1, 'TIME TO ASSIGN (AVG)', fmtHrs(curWk?.avg_tta_hrs),
    ttaDelta ? `${ttaDelta}h  ·  ${prevRef(fmtHrs(prevWk?.avg_tta_hrs))}` : null, ttaColor, C.blue);

  // Tile 1: Avg First Reply
  const frHDelta = delta(curWk?.avg_fr_hrs, prevWk?.avg_fr_hrs);
  const frHColor = frHDelta ? (parseFloat(frHDelta) <= 0 ? C.green : C.red) : C.midGrey;
  kpiTile(1, 1, 'AVG FIRST REPLY', fmtHrs(curWk?.avg_fr_hrs),
    frHDelta ? `${frHDelta}h  ·  ${prevRef(fmtHrs(prevWk?.avg_fr_hrs))}` : null, frHColor, '27AE60');

  // Tile 2: Avg Resolution Time
  const rtDelta = delta(curWk?.avg_rt_days, prevWk?.avg_rt_days);
  const rtColor = rtDelta ? (parseFloat(rtDelta) <= 0 ? C.green : C.red) : C.midGrey;
  kpiTile(2, 1, 'AVG RESOLUTION TIME', fmtDays(curWk?.avg_rt_days),
    rtDelta ? `${rtDelta}d  ·  ${prevRef(fmtDays(prevWk?.avg_rt_days))}` : null, rtColor, 'E87722');

  // Tile 3: On-Hold / Open Tickets (no delta — dual metric)
  kpiTile(3, 1, 'ON-HOLD / OPEN TICKETS',
    curWk ? `${curWk.on_hold ?? '—'} / ${ageTotalOpen}` : '—',
    null, null, '7C3AED');

  // ── Combo chart: Inbound/Closed bars + Res. SLA% / 1st Reply% lines ──
  if (weeks.length) {
    const wkLabels = weeks.map(w => w.label || '');
    const barData  = [
      { name: 'Inbound', labels: wkLabels, values: weeks.map(w => w.inbound || 0) },
      { name: 'Closed',  labels: wkLabels, values: weeks.map(w => w.closed  || 0) },
    ];
    const lineData = [
      { name: 'Res. SLA%',  labels: wkLabels, values: weeks.map(w => w.res_ok_pct != null ? w.res_ok_pct : 0) },
      { name: '1st Reply%', labels: wkLabels, values: weeks.map(w => w.fr_ok_pct  != null ? w.fr_ok_pct  : 0) },
    ];

    slide.addChart(
      [
        {
          type: pptx.ChartType.bar,
          data: barData,
          options: {
            chartColors:       ['2A5490', '27AE60'],
            showValue:         true,
            dataLabelFontSize: 8,
            dataLabelColor:    'FFFFFF',
            dataLabelPosition: 'inEnd',
            barGrouping:       'clustered',
          },
        },
        {
          type: pptx.ChartType.line,
          data: lineData,
          options: {
            chartColors:        ['E87722', 'E74C3C'],
            secondaryValAxis:   true,
            secondaryCatAxis:   true,
            showValue:          true,
            dataLabelFontSize:  8,
            dataLabelPosition:  'b',
            lineDataSymbol:     'circle',
            lineDataSymbolSize: 6,
          },
        },
      ],
      {
        x: 0.3, y: 1.58, w: 12.73, h: 3.04,
        valAxisMinVal:          0,
        val2AxisMinVal:         0,
        val2AxisMaxVal:         100,
        catAxisLabelFontFace:   'Calibri',
        catAxisLabelFontSize:   9,
        valAxisLabelFontSize:   9,
        val2AxisLabelFontSize:  9,
        showLegend:             true,
        legendFontSize:         9,
        legendPos:              'b',
        fontFace:               'Calibri',
        barGapWidthPct:         60,
      }
    );
  } else {
    slide.addText(
      selGrp ? 'No weekly data — select a group and fetch charts before generating PPTX.'
             : 'No group selected — select a group and fetch charts before generating PPTX.',
      { x: 0.3, y: 1.61, w: 12.73, h: 0.4, fontSize: 9, color: C.midGrey, fontFace: 'Calibri', italic: true }
    );
  }

  // ── Bottom section (y ≈ 4.72) ────────────────────────────────────
  const botY   = 4.72;
  const botH   = 7.38 - botY;   // 2.66" — both columns end at same y
  const rightX = 8.3;
  const rightW = 4.73;

  // ── Ageing bar chart — fills full bottom-left height ─────────────
  if (ageing.length === 5) {
    const ageTot   = cd.ageing_total || ageing.reduce((s, v) => s + v, 0);
    const ageLabels = ['0–7 d', '8–14 d', '15–30 d', '31–60 d', '60+ d'];
    const ageColors = ['27AE60', '65A30D', 'D97706', 'DC2626', '7C3AED'];
    slide.addChart(pptx.ChartType.bar, [{
      name:   `Open Tickets (${ageTot} total)`,
      labels: ageLabels,
      values: ageing,
    }], {
      x: 0.3, y: botY, w: 7.8, h: botH,
      chartColors:          ageColors,
      showValue:            true,
      dataLabelFontSize:    10,
      dataLabelColor:       '333333',
      dataLabelPosition:    'outEnd',
      barGrouping:          'clustered',
      barDir:               'col',
      catAxisLabelFontSize: 9,
      catAxisLabelFontFace: 'Calibri',
      valAxisHidden:        true,
      showLegend:           true,
      legendFontSize:       8,
      legendPos:            'b',
      fontFace:             'Calibri',
    });
  }

  // ── SLA Violations panel (top of right column) ───────────────────
  const slaY      = botY;
  const slaRowH   = 0.20;
  const maxViolRows = 4;
  const showViol  = top10.slice(0, maxViolRows);
  const slaH      = 0.27 + slaRowH + showViol.length * slaRowH;   // header bar + col header + rows

  // Red header bar
  slide.addShape('rect', { x: rightX, y: slaY, w: rightW, h: 0.27, fill: { color: 'E74C3C' }, line: { color: 'E74C3C', pt: 0 } });
  slide.addText('⚠  Top SLA Violations — Current Week', {
    x: rightX+0.08, y: slaY+0.03, w: rightW-0.1, h: 0.22,
    fontSize: 7.5, bold: true, color: 'FFFFFF', fontFace: 'Calibri'
  });

  if (top10.length === 0) {
    // No violations — green success box
    slide.addShape('rect', { x: rightX, y: slaY+0.27, w: rightW, h: slaRowH * maxViolRows + slaRowH, fill: { color: 'F0FFF4' }, line: { color: 'CCCCCC', pt: 0.5 } });
    slide.addText('✓  No SLA violations this week', {
      x: rightX+0.1, y: slaY+0.27, w: rightW-0.2, h: slaRowH * maxViolRows + slaRowH,
      fontSize: 8.5, bold: true, color: '27AE60', fontFace: 'Calibri', align: 'center', valign: 'middle'
    });
  } else {
    // Column header
    slide.addShape('rect', { x: rightX, y: slaY+0.27, w: rightW, h: slaRowH, fill: { color: C.tableHead }, line: { color: C.tableHead, pt: 0 } });
    slide.addText('Category', { x: rightX+0.05, y: slaY+0.27, w: rightW*0.62, h: slaRowH, fontSize: 7, bold: true, color: 'FFFFFF', fontFace: 'Calibri', valign: 'middle' });
    slide.addText('Violated', { x: rightX+rightW*0.62, y: slaY+0.27, w: rightW*0.38, h: slaRowH, fontSize: 7, bold: true, color: 'FFFFFF', fontFace: 'Calibri', valign: 'middle', align: 'center' });

    // Data rows
    showViol.forEach((v, i) => {
      const ry       = slaY + 0.27 + slaRowH + i * slaRowH;
      const rowColor = i % 2 === 0 ? 'FFF5F5' : 'FFFFFF';
      slide.addShape('rect', { x: rightX, y: ry, w: rightW, h: slaRowH, fill: { color: rowColor }, line: { color: 'EEEEEE', pt: 0.3 } });
      slide.addText(v.category, { x: rightX+0.05, y: ry, w: rightW*0.60, h: slaRowH, fontSize: 6.5, color: '333333', fontFace: 'Calibri', valign: 'middle' });
      slide.addText(`${v.violations} (${v.pct}%)`, { x: rightX+rightW*0.60, y: ry, w: rightW*0.40, h: slaRowH, fontSize: 6.5, bold: true, color: 'E74C3C', fontFace: 'Calibri', valign: 'middle', align: 'center' });
    });
  }

  // ── Team panel ───────────────────────────────────────────────────
  const teamY = slaY + slaH + 0.07;
  const teamH = 0.73;
  slide.addShape('rect', { x: rightX, y: teamY, w: rightW, h: teamH, fill: { color: C.lightGrey }, line: { color: 'CCCCCC', pt: 0.5 } });
  slide.addText('Team', { x: rightX+0.1, y: teamY+0.04, w: rightW-0.2, h: 0.20, fontSize: 9, bold: true, color: C.blue, fontFace: 'Calibri' });
  if (hd.techs_on_duty) {
    slide.addText(`On duty: ${hd.techs_on_duty}`, {
      x: rightX+0.1, y: teamY+0.26, w: rightW-0.2, h: 0.24,
      fontSize: 8, color: C.darkGrey, fontFace: 'Calibri', wrap: true
    });
  }
  if (hd.tech_on_break) {
    slide.addText(`On leave: ${hd.tech_on_break}`, {
      x: rightX+0.1, y: teamY+0.50, w: rightW-0.2, h: 0.20,
      fontSize: 8, color: C.orange, fontFace: 'Calibri', wrap: true, bold: true
    });
  }

  // ── Comments box — fills remaining space to bottom ───────────────
  const cmtY = teamY + teamH + 0.07;
  const cmtH = 7.38 - cmtY;
  if (cmtH > 0.3) {
    slide.addShape('rect', { x: rightX, y: cmtY, w: rightW, h: 0.24, fill: { color: C.orange } });
    slide.addText('Comments', { x: rightX+0.1, y: cmtY+0.02, w: rightW-0.2, h: 0.20, fontSize: 9, bold: true, color: C.white, fontFace: 'Calibri' });
    slide.addShape('rect', { x: rightX, y: cmtY+0.24, w: rightW, h: cmtH-0.24, fill: { color: C.lightGrey }, line: { color: 'CCCCCC', pt: 0.5 } });
    slide.addText(hd.comments_metrics || '—', {
      x: rightX+0.1, y: cmtY+0.28, w: rightW-0.2, h: cmtH-0.32,
      fontSize: 8, color: C.darkGrey, fontFace: 'Calibri', valign: 'top', wrap: true
    });
  }

  return slide;
}

// ── SLIDE 3 — LOW LIGHTS / HIGH LIGHTS ───────────────────────────
function slideLights(pptx, report, openChanges) {
  const slide = pptx.addSlide();
  addTitle(slide, '3. Low Lights / High Lights', null);

  const lights = report.lights || [];
  const low    = lights.filter(l => l.type === 'low_light');
  const high   = lights.filter(l => l.type === 'high_light');

  // ── Goal banner (full width) ─────────────────────────────────────
  // Active Major Incidents now have their own dedicated slide
  // (slideActiveIncidents below) — no longer fights for space here.
  const totalW  = 12.73;
  const halfW   = (totalW - 0.1) / 2;   // 6.315" each panel
  const panelX2 = 0.3 + halfW + 0.1;    // x of right panel ≈ 6.715"
  const changeY = 4.5;
  const panelH  = changeY - 0.1 - 2.0;  // ≈ 2.4"

  addSectionBadge(slide, 'Goal:', 0.3, 1.0, totalW);
  slide.addShape('rect', { x:0.3, y:1.32, w:totalW, h:0.35, fill:{color:C.lightGrey}, line:{color:'CCCCCC',pt:0.5} });
  slide.addText('Leverage insights from issues and incidents, consolidate successes and achievements, and implement changes effectively to strengthen resilience and drive IT operational excellence.',
    { x:0.4, y:1.35, w:totalW-0.2, h:0.3, fontSize:9, color:C.midGrey, fontFace:'Calibri', italic:true });

  // ── Issues | Successes (full width, equal to Changes) ────────────
  slide.addShape('rect', { x:0.3,      y:1.72, w:halfW, h:0.28, fill:{color:C.blue} });
  slide.addText('Issues & Incidents',      { x:0.3,      y:1.72, w:halfW, h:0.28, fontSize:10, bold:true, color:C.white, fontFace:'Calibri', margin:[0,0,0,8] });
  slide.addShape('rect', { x:panelX2, y:1.72, w:halfW, h:0.28, fill:{color:C.blue} });
  slide.addText('Successes & Achievements', { x:panelX2, y:1.72, w:halfW, h:0.28, fontSize:10, bold:true, color:C.white, fontFace:'Calibri', margin:[0,0,0,8] });

  // Content areas
  slide.addShape('rect', { x:0.3,      y:2.0, w:halfW, h:panelH, fill:{color:C.lightGrey}, line:{color:'CCCCCC',pt:0.5} });
  slide.addShape('rect', { x:panelX2, y:2.0, w:halfW, h:panelH, fill:{color:C.lightGrey}, line:{color:'CCCCCC',pt:0.5} });

  const bulleted = (items, x, y, w, h, color) => {
    const txt = items.length ? items.map(i => `• ${i.content}`).join('\n') : '—';
    slide.addText(txt, { x, y, w, h, fontSize:10, color: color||C.darkGrey, fontFace:'Calibri', valign:'top', wrap:true, margin:[4,4,4,10] });
  };
  bulleted(low,  0.3,     2.0, halfW, panelH, C.darkGrey);
  bulleted(high, panelX2, 2.0, halfW, panelH, '2D9C4A');

  // Changes section — auto-pulled from ServiceDesk Plus (not manually entered)
  const changes = openChanges || report.openChanges || [];
  addSectionBadge(slide, 'Active Changes — ServiceDesk Plus (auto)', 0.3, changeY, 12.73);

  const today = new Date(); today.setHours(0,0,0,0);
  const stageColor = s => {
    if (['Implementation','Review','Release','UAT'].includes(s)) return C.orange;
    if (s === 'CAB Evaluation') return C.red;
    return '555555';
  };
  const riskColor = r => ({ High: C.red, Medium: C.orange, Low: '27ae60' }[r] || '888888');
  const fmtDate = d => {
    if (!d) return '—';
    const dt = new Date(d); if (isNaN(dt)) return '—';
    return dt.toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'2-digit' });
  };
  const buildChangeCol = (items, x, w) => {
    if (!items.length) return;
    // colW: CH-ID | Subject | Risk | Owner | Due Date | Stage
    // Total w ≈ 4.65": [0.68, 1.22, 0.52, 1.0, 0.75, 0.78] – adjusted per half
    const subjectW = w - 3.73;
    const colW = [0.68, subjectW, 0.52, 1.0, 0.75, 0.78];
    const hdr = [
      { text:'CH-ID',    options:{ bold:true, fill:{color:'2A5490'}, color:C.white, fontSize:7.5, align:'center' } },
      { text:'Subject',  options:{ bold:true, fill:{color:'2A5490'}, color:C.white, fontSize:7.5 } },
      { text:'Risk',     options:{ bold:true, fill:{color:'2A5490'}, color:C.white, fontSize:7.5, align:'center' } },
      { text:'Requester', options:{ bold:true, fill:{color:'2A5490'}, color:C.white, fontSize:7.5 } },
      { text:'Due Date', options:{ bold:true, fill:{color:'2A5490'}, color:C.white, fontSize:7.5, align:'center' } },
      { text:'Stage / Status', options:{ bold:true, fill:{color:'2A5490'}, color:C.white, fontSize:7.5, align:'center' } },
    ];
    const rows = items.map((c, i) => {
      const fill      = { color: i % 2 === 0 ? C.lightGrey : C.white };
      const overdue   = c.scheduled_end && new Date(c.scheduled_end) < today;
      const dueText   = (overdue ? '⚠ ' : '') + fmtDate(c.scheduled_end);
      const chId      = (c.emergency ? '⚡ ' : '') + `CH-${c.display_id}`;
      const stageText = c.stage_status || c.stage || '';
      return [
        { text: chId,             options:{ fontSize:7.5, align:'center', bold:true, fill, color: c.emergency ? C.red : '2d3a5e' } },
        { text: c.subject || '',  options:{ fontSize:7.5, wrap:true, fill, color:C.darkGrey } },
        { text: c.risk    || '—', options:{ fontSize:7.5, align:'center', bold:true, fill, color: riskColor(c.risk) } },
        { text: c.requester || '—', options:{ fontSize:7.5, fill, color:C.darkGrey } },
        { text: dueText,          options:{ fontSize:7.5, align:'center', bold:overdue, fill, color: overdue ? C.red : '444444' } },
        { text: stageText,        options:{ fontSize:7.5, wrap:true, align:'center', bold:true, fill, color: stageColor(c.stage) } },
      ];
    });
    slide.addTable([hdr, ...rows], {
      x, y: changeY + 0.3, w, fontFace:'Calibri',
      border:{ type:'solid', color:'DDDDDD', pt:0.5 },
      rowH:0.27, colW
    });
  };

  if (changes.length === 0) {
    slide.addText('No open changes for this site.', {
      x:0.4, y:changeY+0.35, w:12.53, h:0.35, fontSize:10, color:C.midGrey, fontFace:'Calibri', italic:true });
  } else {
    const half = Math.ceil(changes.length / 2);
    buildChangeCol(changes.slice(0, half), 0.3,  6.3);
    buildChangeCol(changes.slice(half),    6.73, 6.3);
  }

  return slide;
}

// ── SLIDE 3b — ACTIVE MAJOR INCIDENTS (dedicated) ────────────────
// Always its own slide regardless of incident count, so:
//   • the section is consistently visible across every site in the
//     all-sites summary deck (no more "missing on Lafigue/ITY"),
//   • heavy-change weeks can't squeeze incidents off the slide,
//   • zero-incident sites still get a clean confirmation slide.
// Slide title carries the site name so flipping through a multi-site
// deck stays oriented even when no incidents are present.
function slideActiveIncidents(pptx, report, activeIncidents) {
  const slide = pptx.addSlide();
  const siteLabel = report && report.site_name ? report.site_name + ' — ' : '';
  addTitle(slide, `${siteLabel}Active Major Incidents`, null);
  // 12 rows fit comfortably on a dedicated slide (banner 0.32 +
  // header 0.27 + 12 × 0.40 wrap-aware rows + legend ≈ 5.6"), starting
  // from y=1.0 we end well above the 7.5" footer. Sites with more
  // than 12 open majors get a "+N more" hint at the bottom.
  addActiveIncidentsBlock(slide, activeIncidents || [], 1.0, 12);
  return slide;
}

// ── SLIDE 4 — ACTION ITEMS ────────────────────────────────────────
function slideActionItems(pptx, report) {
  const slide = pptx.addSlide();
  addTitle(slide, '4. Action Items & Follow-ups', null);

  const totalW = 12.73;
  addSectionBadge(slide, 'Goal:', 0.3, 1.0, totalW);
  slide.addShape('rect', { x:0.3, y:1.32, w:totalW, h:0.32, fill:{color:C.lightGrey}, line:{color:'CCCCCC',pt:0.5} });
  slide.addText('Tracking key responsibilities, priorities, and status updates',
    { x:0.3, y:1.32, w:totalW, h:0.32, fontSize:10, color:C.darkGrey, fontFace:'Calibri', bold:true, align:'center' });

  const items = report.action_items || [];
  const rows = [
    [
      { text:'Task',       options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'left' } },
      { text:'Department', options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
      { text:'Priority',   options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
      { text:'Due Date',   options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
      { text:'Owner',      options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
      { text:'Status',     options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
    ],
    ...(items.length ? items : [{ task:'—', department:'—', priority:'—', due_date:'—', owner:'—', status:'open' }]).map((a, i) => {
      const pColor = a.priority==='High'?C.red : a.priority==='Low'?C.green : C.orange;
      const rowFill = i % 2 === 0 ? C.lightGrey : C.white;
      return [
        { text: a.task,                   options:{ fill:{color:rowFill}, align:'left' } },
        { text: a.department || '—',      options:{ fill:{color:rowFill}, align:'center', fontSize:10, color:C.darkGrey } },
        { text: a.priority||'—',          options:{ fill:{color:rowFill}, color:pColor, bold:true, align:'center' } },
        { text: a.due_date||'TBC',        options:{ fill:{color:rowFill}, align:'center' } },
        { text: a.owner||'—',             options:{ fill:{color:rowFill}, align:'center' } },
        { text: a.status||'open',         options:{ fill:{color:rowFill}, align:'center' } },
      ];
    })
  ];

  slide.addTable(rows, {
    x:0.3, y:1.7, w:totalW, h: Math.min(5.2, (items.length+1)*0.55 + 0.1),
    fontFace:'Calibri', fontSize:11,
    border:{type:'solid',color:'CCCCCC',pt:0.5},
    colW:[6.13, 1.4, 1.2, 1.4, 1.4, 1.2],   // Task | Dept | Priority | Due | Owner | Status — sums 12.73
    rowH: 0.5
  });
  return slide;
}

// ── SLIDE — MONTHLY INFRA SUMMARY ────────────────────────────────
function slideMonthlyInfra(pptx, monthlyData, siteName, monthLabel) {
  const slide = pptx.addSlide();
  addTitle(slide, `1b. Infrastructure KPI Monthly Summary — ${monthLabel}`, siteName);

  const { reports, pastMonths } = monthlyData;

  // Compute current month averages per service
  const services = {};
  reports.forEach(r => {
    (r.infra_kpis || []).forEach(k => {
      if (!services[k.service]) services[k.service] = { kpi: k.kpi, target: k.target, values: [], trend: k.trend };
      const v = parseFloat(k.status_value);
      if (!isNaN(v)) services[k.service].values.push(v);
    });
  });

  // Build columns: Service | KPI | Target | Avg This Month | Past months...
  const pastLabels = pastMonths.slice(0,3).map(m => m.label);
  const headerRow = [
    { text:'Service', options:{ bold:true, color:C.white, fill:{color:C.tableHead} } },
    { text:'KPI',     options:{ bold:true, color:C.white, fill:{color:C.tableHead} } },
    { text:'Target',  options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
    { text:`Avg ${monthLabel}`, options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
    ...pastLabels.map(l => ({ text: l, options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } }))
  ];

  const dataRows = Object.keys(services).map((svc, i) => {
    const s       = services[svc];
    const avg     = s.values.length ? (s.values.reduce((a,b)=>a+b,0)/s.values.length).toFixed(2) + '%' : '—';
    const rowFill = i % 2 === 0 ? C.lightGrey : C.white;

    // Past month averages
    const pastCells = pastMonths.slice(0,3).map(pm => {
      const pmVals = (pm.reports||[]).flatMap(r => (r.infra_kpis||[]).filter(k=>k.service===svc).map(k=>parseFloat(k.status_value))).filter(v=>!isNaN(v));
      const pmAvg  = pmVals.length ? (pmVals.reduce((a,b)=>a+b,0)/pmVals.length).toFixed(2)+'%' : '—';
      return { text: pmAvg, options:{ fill:{color:rowFill}, align:'center' } };
    });

    return [
      { text: svc,          options:{ fill:{color:rowFill}, bold:true, align:'left' } },
      { text: s.kpi,        options:{ fill:{color:rowFill}, align:'left' } },
      { text: s.target||'—',options:{ fill:{color:rowFill}, align:'center' } },
      { text: avg,          options:{ fill:{color:rowFill}, align:'center', bold:true } },
      ...pastCells
    ];
  });

  // Service col absorbs extra width so names fit on one line; fixed cols stay proportional
  const fixedSum = 1.8 + 1.0 + 1.4 + pastLabels.length * 1.3;  // KPI + Target + Avg + past months
  const svcW  = 12.73 - fixedSum;
  const colW  = [svcW, 1.8, 1.0, 1.4, ...pastLabels.map(()=>1.3)];
  slide.addTable([headerRow, ...(dataRows.length ? dataRows : [[{text:'No data yet', options:{colspan:4+pastLabels.length}}]])], {
    x: 0.3, y: 1.1, w: 12.73, fontFace:'Calibri', fontSize: 11,
    border:{type:'solid',color:'CCCCCC',pt:0.5}, rowH:0.52, colW
  });
  return slide;
}

// ── TITLE SLIDE ───────────────────────────────────────────────────
function addTitleSlide(pptx, title, subtitle, date) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x:0, y:0, w:10, h:7.5, fill:{color:C.blue} });
  slide.addShape('rect', { x:0, y:3.5, w:10, h:0.08, fill:{color:C.orange} });
  slide.addText('ENDEAVOUR MINING', { x:1, y:1.2, w:8, h:0.5, fontSize:16, bold:true, color:C.orange, fontFace:'Calibri', align:'center', charSpacing:4 });
  slide.addText('IT Department', { x:1, y:1.75, w:8, h:0.35, fontSize:12, color:'CCCCCC', fontFace:'Calibri', align:'center' });
  slide.addText(title,    { x:1, y:2.8, w:8, h:0.7,  fontSize:28, bold:true,  color:C.white, fontFace:'Calibri', align:'center' });
  slide.addText(subtitle, { x:1, y:3.55, w:8, h:0.45, fontSize:16, color:C.orange, fontFace:'Calibri', align:'center' });
  slide.addText(date,     { x:1, y:4.2,  w:8, h:0.35, fontSize:12, color:'AAAAAA', fontFace:'Calibri', align:'center' });
}

// ── GENERATE WEEKLY PPTX ──────────────────────────────────────────
async function generateWeeklyPptx(report, prevReport, openChanges, activeIncidents) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  pptx.title  = `Weekly Report — ${report.site_name} — ${report.week_label}`;

  const dateRange = `${report.start_date} → ${report.end_date}`;

  addTitleSlide(pptx,
    `Weekly IT Report`,
    `${report.site_name} · ${report.week_label}`,
    dateRange
  );

  slideInfraKpis(pptx, report, report.week_label, prevReport ? (prevReport.infra_kpis || []) : []);
  slideHelpdeskMetrics1(pptx, report);
  slideLights(pptx, report, openChanges || []);
  slideActiveIncidents(pptx, report, activeIncidents || []);
  slideActionItems(pptx, report);

  return fixComboChartAxes(await pptx.write({ outputType: 'nodebuffer' }));
}

// ── GENERATE MONTHLY PPTX ─────────────────────────────────────────
async function generateMonthlyPptx(monthlyData, siteName, year, month) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const monthLabel = new Date(year, month-1, 1).toLocaleString('en', { month:'long', year:'numeric' });
  pptx.title = `Monthly IT Report — ${siteName} — ${monthLabel}`;

  addTitleSlide(pptx,
    `Monthly IT Report`,
    `${siteName} · ${monthLabel}`,
    `Summary of ${monthlyData.reports.length} week(s)`
  );

  const { reports, pastMonths } = monthlyData;

  // For each week: full 4 slides — pass previous week's KPIs for auto-trend
  reports.forEach((report, i) => {
    if (!report) return;
    const prevKpis = i > 0 && reports[i-1] ? (reports[i-1].infra_kpis || []) : [];
    slideInfraKpis(pptx, report, `Week ${i+1} — ${report.week_label}`, prevKpis);
    slideHelpdeskMetrics1(pptx, report);
    slideLights(pptx, report, report.openChanges || []);
    slideActiveIncidents(pptx, report, report.activeIncidents || []);
    slideActionItems(pptx, report);
  });

  // Monthly infra summary (averages + past months)
  slideMonthlyInfra(pptx, monthlyData, siteName, monthLabel);

  return fixComboChartAxes(await pptx.write({ outputType: 'nodebuffer' }));
}

// ── GENERATE WEEKLY ALL-SITES SUMMARY PPTX ───────────────────────
async function generateWeeklySummaryPptx(summaryData) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const { week_label, start_date, end_date, reports } = summaryData;
  pptx.title = `Weekly IT Summary — All Sites — ${week_label}`;
  const dateRange = `${start_date} → ${end_date}`;

  // Cover slide
  addTitleSlide(pptx,
    `Weekly IT Summary`,
    `All Sites · ${week_label}`,
    dateRange
  );

  if (!reports || reports.length === 0) {
    const slide = pptx.addSlide();
    slide.addText('No submitted reports found for this week.', {
      x: 2, y: 3.3, w: 6, h: 0.5,
      fontSize: 16, color: C.midGrey, align: 'center', fontFace: 'Calibri', italic: true
    });
    return fixComboChartAxes(await pptx.write({ outputType: 'nodebuffer' }));
  }

  reports.forEach(report => {
    if (!report) return;

    // Site divider slide
    const div = pptx.addSlide();
    div.addShape('rect', { x:0, y:0, w:10, h:7.5, fill:{ color:C.blue } });
    div.addShape('rect', { x:0, y:3.45, w:10, h:0.1, fill:{ color:C.orange } });
    div.addText('ENDEAVOUR MINING', {
      x:1, y:1.2, w:8, h:0.5,
      fontSize:14, bold:true, color:C.orange, fontFace:'Calibri', align:'center', charSpacing:4
    });
    div.addText('IT Department', {
      x:1, y:1.72, w:8, h:0.3,
      fontSize:11, color:'CCCCCC', fontFace:'Calibri', align:'center'
    });
    div.addText(report.site_name || 'Unknown Site', {
      x:1, y:2.65, w:8, h:0.8,
      fontSize:30, bold:true, color:C.white, fontFace:'Calibri', align:'center'
    });
    div.addText(week_label, {
      x:1, y:3.6, w:8, h:0.45,
      fontSize:16, color:C.orange, fontFace:'Calibri', align:'center'
    });
    div.addText(dateRange, {
      x:1, y:4.1, w:8, h:0.35,
      fontSize:12, color:'AAAAAA', fontFace:'Calibri', align:'center'
    });

    // 5 content slides per site (Lights + dedicated Incidents slide)
    slideInfraKpis(pptx, report, `${report.site_name} — ${week_label}`);
    slideHelpdeskMetrics1(pptx, report);
    slideLights(pptx, report, report.openChanges || []);
    slideActiveIncidents(pptx, report, report.activeIncidents || []);
    slideActionItems(pptx, report);
  });

  return fixComboChartAxes(await pptx.write({ outputType: 'nodebuffer' }));
}

// ═══════════════════════════════════════════════════════════════════
// ── MONTHLY FORMAT (v1.9.0) — MOVED TO reports-monthly-pptx.js ──
// ── All generateMonthlyPptxV2 / generateAllSitesMonthlyPptx      ──
// ── functions have been extracted to reports-monthly-pptx.js     ──
// ── for clean separation of weekly vs monthly generation logic.  ──
// ═══════════════════════════════════════════════════════════════════

// ── MONTHLY SLIDE 2 — LAST WEEK INFRA KPIs ───────────────────────
function slideMonthlyLastWeekInfra(pptx, lastReport, monthLabel) {
  const slide = pptx.addSlide();
  const wkLabel = lastReport ? lastReport.week_label || '' : '';
  addTitle(slide, `2. Infrastructure KPIs — Last Week of ${monthLabel}`, wkLabel);

  const kpis = lastReport ? (lastReport.infra_kpis || []) : [];
  const rows = [
    [
      { text: 'Service',  options: { bold:true, color:C.white, fill:{color:C.tableHead}, align:'left' } },
      { text: 'KPI',      options: { bold:true, color:C.white, fill:{color:C.tableHead}, align:'left' } },
      { text: 'Target',   options: { bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
      { text: 'Status',   options: { bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
      { text: 'Trend',    options: { bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
    ],
    ...(kpis.length ? kpis : [{ service:'No data', kpi:'—', target:'—', status_value:'—', status_color:'none', trend:'no_change' }]).map((k, i) => {
      const { color: sc, hasColor } = autoStatusColor(k.status_value, k.target, k.status_color);
      const rowFill = i % 2 === 0 ? C.lightGrey : C.white;
      return [
        { text: k.service,           options: { fill:{color:rowFill}, align:'left', bold:true } },
        { text: k.kpi,               options: { fill:{color:rowFill}, align:'left' } },
        { text: k.target||'—',       options: { fill:{color:rowFill}, align:'center' } },
        { text: k.status_value||'—', options: { fill:{color:hasColor?sc:rowFill}, color:hasColor?C.white:C.darkGrey, bold:true, align:'center' } },
        { text: trendArrow(k.trend), options: { fill:{color:rowFill}, color:hasColor?sc:trendColor(k.trend), bold:true, align:'center', fontSize:14 } },
      ];
    })
  ];
  slide.addTable(rows, {
    x:0.5, y:1.1, w:9.0, h:5.4,
    fontFace:'Calibri', fontSize:12,
    border:{type:'solid',color:'CCCCCC',pt:0.5},
    rowH: kpis.length > 0 ? Math.min(0.7, 5.4/(kpis.length+1)) : 0.6,
    colW:[1.8, 2.2, 1.2, 1.8, 2.0],
  });
  return slide;
}

// ── MONTHLY SLIDE 3 — INFRA TREND (6 months) ────────────────────
function slideMonthlyInfraTrend(pptx, monthlyData, siteName, monthLabel) {
  const slide = pptx.addSlide();
  addTitle(slide, `3. Infrastructure KPI Trend — ${monthLabel}`, siteName);

  const { reports, pastMonths } = monthlyData;

  // Collect unique services from current month reports
  const serviceOrder = [];
  const servicesMeta = {};
  reports.forEach(r => {
    (r.infra_kpis || []).forEach(k => {
      if (!servicesMeta[k.service]) {
        serviceOrder.push(k.service);
        servicesMeta[k.service] = { kpi: k.kpi, target: k.target };
      }
    });
  });

  // Build month columns: current + up to 5 past months (most recent first → display chronological)
  const allMonths = [
    { label: monthLabel, reports: reports },
    ...pastMonths.slice(0, 5).map(pm => ({ label: pm.label, reports: pm.reports }))
  ].reverse(); // chronological: oldest → newest

  const headerRow = [
    { text:'Service',  options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'left' } },
    { text:'KPI',      options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'left' } },
    { text:'Target',   options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center' } },
    ...allMonths.map(m => ({ text: m.label, options:{ bold:true, color:C.white, fill:{color:C.tableHead}, align:'center', fontSize:9 } }))
  ];

  const dataRows = serviceOrder.map((svc, i) => {
    const meta     = servicesMeta[svc];
    const rowFill  = i % 2 === 0 ? C.lightGrey : C.white;
    const monthCells = allMonths.map(m => {
      const vals = (m.reports||[]).flatMap(r =>
        (r.infra_kpis||[]).filter(k=>k.service===svc).map(k=>parseFloat(k.status_value))
      ).filter(v => !isNaN(v));
      const avg = vals.length ? (vals.reduce((a,b)=>a+b,0)/vals.length).toFixed(1) : '—';
      const isLast = m.label === monthLabel;
      return { text: avg==='—'?'—':`${avg}%`, options:{ fill:{color:isLast?'E8F4FD':rowFill}, align:'center', bold:isLast, fontSize:10 } };
    });
    return [
      { text: svc,             options:{ fill:{color:rowFill}, bold:true, align:'left', fontSize:10 } },
      { text: meta.kpi||'—',   options:{ fill:{color:rowFill}, align:'left', fontSize:9 } },
      { text: meta.target||'—',options:{ fill:{color:rowFill}, align:'center', fontSize:9 } },
      ...monthCells
    ];
  });

  const nMonths  = allMonths.length;
  const kpiW     = 1.8;
  const tgtW     = 0.9;
  const monthW   = Math.min(1.3, (12.73 - kpiW - tgtW - 0) / nMonths);  // service col computed below
  // Give remaining space to Service so names fit on one line
  const svcW     = 12.73 - kpiW - tgtW - (nMonths * monthW);
  const fixedW   = [svcW, kpiW, tgtW];
  const colW     = [...fixedW, ...Array(nMonths).fill(monthW)];

  if (dataRows.length === 0) {
    slide.addText('No infrastructure data available for this month.', {
      x:0.5, y:3.5, w:9, h:0.5, fontSize:13, color:C.midGrey, align:'center', fontFace:'Calibri', italic:true
    });
  } else {
    slide.addTable([headerRow, ...dataRows], {
      x:0.3, y:1.1, w:12.73, fontFace:'Calibri', fontSize:10,
      border:{type:'solid',color:'CCCCCC',pt:0.5},
      rowH: Math.min(0.65, 6.0/(dataRows.length+1)),
      colW
    });
  }
  return slide;
}

// ── MONTHLY SLIDE 4 — HELPDESK METRICS (aggregated for month) ────
function slideMonthlyHelpdesk(pptx, monthlyData, siteName, monthLabel) {
  const slide = pptx.addSlide();
  // Title only — no subtitle (month shown in KPI tiles)
  addTitle(slide, `4. Helpdesk Metrics — ${monthLabel}`, null);

  const { reports } = monthlyData;

  // ── Build ageing, top10 SLA violations, and last-week timing from last report ──
  let lastAgeing=[], lastAgeTotal=0, lastTop10=[], lastCurWk=null, lastPrevWk=null;
  for (const r of (reports||[])) {
    const cd = ((r.helpdesk||{}).chart_data && typeof (r.helpdesk||{}).chart_data==='object')
               ? (r.helpdesk||{}).chart_data : {};
    if (Array.isArray(cd.ageing) && cd.ageing.length===5) {
      lastAgeing   = cd.ageing;
      lastAgeTotal = cd.ageing_total || cd.ageing.reduce((s,v)=>s+v,0);
    }
    if (Array.isArray(cd.top10)) lastTop10 = cd.top10;
    const wks = Array.isArray(cd.weeks) ? cd.weeks
              : Array.isArray((r.helpdesk||{}).group_metrics) ? (r.helpdesk||{}).group_metrics : [];
    if (wks.length) {
      lastCurWk  = wks[wks.length-1];
      lastPrevWk = wks.length > 1 ? wks[wks.length-2] : null;
    }
  }
  const ageTotalOpen = lastAgeTotal || lastAgeing.reduce((s,v)=>s+v,0);

  // ── 6-month history ──────────────────────────────────────────────
  const h6         = Array.isArray(monthlyData.history6m) ? monthlyData.history6m : [];
  const mLabels    = h6.map(m=>m.label);
  const inboundArr = h6.map(m=>m.inbound       !=null?m.inbound      :0);
  const closedArr  = h6.map(m=>m.closed        !=null?m.closed       :0);
  const resArr     = h6.map(m=>m.res_sla_pct   !=null?m.res_sla_pct  :0);
  const frArr      = h6.map(m=>m.reply_sla_pct !=null?m.reply_sla_pct:0);

  // ── Current month KPIs ───────────────────────────────────────────
  const calHd         = monthlyData.calendar_hd;
  const calHasData    = calHd && calHd.source==='calendar' && calHd.inbound!=null && calHd.inbound>0;
  const calSyncNeeded = calHd && calHd.source==='calendar' && (calHd.inbound==null || calHd.inbound===0);

  let mIn, mCl, mPct, mRes, mFr;
  if (calHasData) {
    mIn  = calHd.inbound;
    mCl  = calHd.closed;
    mPct = calHd.close_pct    !=null ? Math.round(calHd.close_pct)     : (mIn>0?Math.round(mCl/mIn*100):0);
    mRes = calHd.sla_res_pct  !=null ? Math.round(calHd.sla_res_pct)   : null;
    mFr  = calHd.sla_reply_pct!=null ? Math.round(calHd.sla_reply_pct) : null;
  } else {
    const last = h6.length ? h6[h6.length-1] : {};
    mIn=last.inbound||0; mCl=last.closed||0;
    mPct=mIn>0?Math.round(mCl/mIn*100):0;
    mRes=last.res_sla_pct||null; mFr=last.reply_sla_pct||null;
  }

  // Previous month entry (second-to-last in history)
  const prevH6 = h6.length>=2 ? h6[h6.length-2] : null;

  // ── KPI STRIP HELPERS ────────────────────────────────────────────
  const fmtHrs  = h=>h!=null?(h>=24?`${Math.round(h/24)}d`:`${h}h`):'—';
  const fmtDays = d=>d!=null?`${d}d`:'—';
  const fmtPct  = p=>p!=null?`${p}%`:'—';
  const fmtNum  = n=>n!=null?String(n):'—';

  const delta = (cur,prev,dec=0)=>{
    if(cur==null||prev==null) return null;
    const d=parseFloat((cur-prev).toFixed(dec));
    return d===0?'±0':(d>0?`+${d}`:`${d}`);
  };

  const tileW=3.15; const tileG=0.04; const tileH=0.40;
  const tX=i=>0.3+i*(tileW+tileG);

  const kpiTile=(col,row,label,value,deltaStr,deltaColor,accent)=>{
    const x=tX(col);
    const y=row===0?0.62:1.12;
    slide.addShape('rect',{x,y,w:tileW,h:tileH,fill:{color:'FFFFFF'},line:{color:'DDDDDD',pt:0.5}});
    slide.addShape('rect',{x,y,w:0.06,h:tileH,fill:{color:accent},line:{color:accent,pt:0}});
    // Layout (tileH=0.40"): 0.03 gap | label 0.10 | value 0.16 | delta 0.08 | 0.03 gap
    slide.addText(label,{x:x+0.1,y:y+0.03,w:tileW-0.15,h:0.10,fontSize:6.5,bold:true,color:'111111',fontFace:'Calibri',valign:'middle'});
    slide.addText(String(value??'—'),{x:x+0.1,y:y+0.13,w:tileW-0.15,h:0.16,fontSize:14,bold:true,color:C.blue,fontFace:'Calibri',valign:'middle'});
    if(deltaStr){
      slide.addText(deltaStr,{x:x+0.1,y:y+0.29,w:tileW-0.15,h:0.08,fontSize:6.5,color:deltaColor||C.midGrey,fontFace:'Calibri',valign:'middle'});
    }
  };

  // Delta helpers: month-vs-month reference label (used for both Row 1 and Row 2)
  const pMLabel  = prevH6?.label||'';
  const prevMRef = v=>pMLabel?`prev: ${v} (${pMLabel})`:`prev: ${v}`;

  // Previous-month calendar data — used for Row 2 timing deltas (month-over-month)
  const prevCalHd = monthlyData.prev_calendar_hd;

  // ── ROW 1 — Monthly Volume & SLA ────────────────────────────────
  const sync = calSyncNeeded;

  // Tile 0: Inbound (month total)
  const inbDelta=delta(mIn,prevH6?.inbound);
  kpiTile(0,0,'INBOUND TICKETS',sync?'—sync':fmtNum(mIn),
    (!sync&&inbDelta)?`${inbDelta}  ·  ${prevMRef(fmtNum(prevH6?.inbound))}`:null,
    C.midGrey,C.blue);

  // Tile 1: Closed (month total + closure %)
  const clsPctStr = mIn>0?` (${mPct}%)`:'';
  const clsDelta  = delta(mCl,prevH6?.closed);
  const clsColor  = clsDelta?(parseFloat(clsDelta)>=0?C.green:C.red):C.midGrey;
  const prevMPct  = prevH6?.inbound>0?Math.round((prevH6.closed/prevH6.inbound)*100):null;
  const prevClsStr= prevMPct!=null?` (${prevMPct}%)`:'';
  kpiTile(1,0,'CLOSED TICKETS',sync?'—sync':(mCl!=null?`${mCl}${clsPctStr}`:'—'),
    (!sync&&clsDelta)?`${clsDelta}  ·  ${prevMRef(`${prevH6?.closed??'—'}${prevClsStr}`)}`:null,
    clsColor,'27AE60');

  // Tile 2: Res. SLA OK %
  const resDelta=delta(mRes,prevH6?.res_sla_pct,1);
  const resColor=resDelta?(parseFloat(resDelta)>=0?C.green:C.red):C.midGrey;
  kpiTile(2,0,'RES. SLA OK %',sync?'—sync':fmtPct(mRes),
    (!sync&&resDelta)?`${resDelta}pt  ·  ${prevMRef(fmtPct(prevH6?.res_sla_pct))}`:null,
    resColor,'E87722');

  // Tile 3: 1st Reply SLA %
  const frDelta=delta(mFr,prevH6?.reply_sla_pct,1);
  const frColor=frDelta?(parseFloat(frDelta)>=0?C.green:C.red):C.midGrey;
  kpiTile(3,0,'1ST REPLY SLA %',sync?'—sync':fmtPct(mFr),
    (!sync&&frDelta)?`${frDelta}pt  ·  ${prevMRef(fmtPct(prevH6?.reply_sla_pct))}`:null,
    frColor,'E74C3C');

  // ── ROW 2 — Monthly Timing & Status ─────────────────────────────
  // Source: calendar_hd timing (day 1→end of month, same formula as Row 1).
  // Fallback to last-week-of-month weekly data when calendar timing is absent.
  const ttaCur  = calHasData && calHd.avg_tta_h         != null ? calHd.avg_tta_h         : lastCurWk?.avg_tta_hrs;
  const ttaPrev = prevCalHd  && prevCalHd.avg_tta_h     != null ? prevCalHd.avg_tta_h     : lastPrevWk?.avg_tta_hrs;
  const ttaDelta=delta(ttaCur,ttaPrev);
  const ttaColor=ttaDelta?(parseFloat(ttaDelta)<=0?C.green:C.red):C.midGrey;
  kpiTile(0,1,'TIME TO ASSIGN (AVG)',fmtHrs(ttaCur),
    ttaDelta?`${ttaDelta}h  ·  ${prevMRef(fmtHrs(ttaPrev))}`:null,ttaColor,C.blue);

  const frHCur  = calHasData && calHd.avg_first_reply_h != null ? calHd.avg_first_reply_h : lastCurWk?.avg_fr_hrs;
  const frHPrev = prevCalHd  && prevCalHd.avg_first_reply_h != null ? prevCalHd.avg_first_reply_h : lastPrevWk?.avg_fr_hrs;
  const frHDelta=delta(frHCur,frHPrev);
  const frHColor=frHDelta?(parseFloat(frHDelta)<=0?C.green:C.red):C.midGrey;
  kpiTile(1,1,'AVG FIRST REPLY',fmtHrs(frHCur),
    frHDelta?`${frHDelta}h  ·  ${prevMRef(fmtHrs(frHPrev))}`:null,frHColor,'27AE60');

  const rtCur   = calHasData && calHd.avg_resolution_d  != null ? calHd.avg_resolution_d  : lastCurWk?.avg_rt_days;
  const rtPrev  = prevCalHd  && prevCalHd.avg_resolution_d != null ? prevCalHd.avg_resolution_d : lastPrevWk?.avg_rt_days;
  const rtDelta=delta(rtCur,rtPrev);
  const rtColor=rtDelta?(parseFloat(rtDelta)<=0?C.green:C.red):C.midGrey;
  kpiTile(2,1,'AVG RESOLUTION TIME',fmtDays(rtCur),
    rtDelta?`${rtDelta}d  ·  ${prevMRef(fmtDays(rtPrev))}`:null,rtColor,'E87722');

  kpiTile(3,1,'ON-HOLD / OPEN TICKETS',
    lastCurWk?`${lastCurWk.on_hold??'—'} / ${ageTotalOpen}`:'—',
    null,null,'7C3AED');

  // ── Combo chart (6-month bars + SLA% lines) ──────────────────────
  if (mLabels.length) {
    const barData  = [
      { name:'Inbound', labels:mLabels, values:inboundArr },
      { name:'Closed',  labels:mLabels, values:closedArr  },
    ];
    const lineData = [
      { name:'Res. SLA%',  labels:mLabels, values:resArr },
      { name:'1st Reply%', labels:mLabels, values:frArr  },
    ];
    slide.addChart(
      [
        { type:pptx.ChartType.bar,  data:barData,  options:{ chartColors:['2A5490','27AE60'], showValue:true, dataLabelFontSize:8, dataLabelColor:'FFFFFF', dataLabelPosition:'inEnd', barGrouping:'clustered' } },
        { type:pptx.ChartType.line, data:lineData, options:{ chartColors:['E87722','E74C3C'], secondaryValAxis:true, secondaryCatAxis:true, showValue:true, dataLabelFontSize:8, dataLabelPosition:'b', lineDataSymbol:'circle', lineDataSymbolSize:6 } },
      ],
      { x:0.3, y:1.58, w:12.73, h:3.04,
        valAxisMinVal:0, val2AxisMinVal:0, val2AxisMaxVal:100,
        catAxisLabelFontFace:'Calibri', catAxisLabelFontSize:9,
        valAxisLabelFontSize:9, val2AxisLabelFontSize:9,
        showLegend:true, legendFontSize:9, legendPos:'b',
        fontFace:'Calibri', barGapWidthPct:60 }
    );
  } else {
    slide.addText('No monthly data available.',{x:0.3,y:1.61,w:12.73,h:0.4,fontSize:9,color:C.midGrey,fontFace:'Calibri',italic:true});
  }

  // ── Bottom section ───────────────────────────────────────────────
  const botY  = 4.72;
  const botH  = 7.38-botY;   // 2.66" — both columns end at same y
  const rightX = 8.3;
  const rightW = 4.73;

  // ── Ageing bar chart — fills full bottom-left height ─────────────
  if (lastAgeing.length===5) {
    const ageLabels=['0–7 d','8–14 d','15–30 d','31–60 d','60+ d'];
    const ageColors=['27AE60','65A30D','D97706','DC2626','7C3AED'];
    slide.addChart(pptx.ChartType.bar,[{name:`Open Tickets (${ageTotalOpen} total)`,labels:ageLabels,values:lastAgeing}],{
      x:0.3, y:botY, w:7.8, h:botH,
      chartColors:ageColors, showValue:true, dataLabelFontSize:10, dataLabelColor:'333333',
      dataLabelPosition:'outEnd', barGrouping:'clustered', barDir:'col',
      catAxisLabelFontSize:9, catAxisLabelFontFace:'Calibri',
      valAxisHidden:true, showLegend:true, legendFontSize:8, legendPos:'b', fontFace:'Calibri',
    });
  }

  // ── SLA Violations panel — full month from request_records ───────
  // Use monthly_top10 (calendar query) instead of last-week chart_data.top10
  const monthTop10 = Array.isArray(monthlyData.monthly_top10) ? monthlyData.monthly_top10 : lastTop10;
  const slaY     = botY;
  const slaRowH  = 0.20;
  const maxViolRows = 4;
  const showViol = monthTop10.slice(0, maxViolRows);
  const slaH     = 0.27 + slaRowH + showViol.length*slaRowH;

  // Red header bar
  slide.addShape('rect',{x:rightX,y:slaY,w:rightW,h:0.27,fill:{color:'E74C3C'},line:{color:'E74C3C',pt:0}});
  slide.addText(`⚠  Top SLA Violations — ${monthLabel}`,{
    x:rightX+0.08,y:slaY+0.03,w:rightW-0.1,h:0.22,
    fontSize:7.5,bold:true,color:'FFFFFF',fontFace:'Calibri'
  });

  if (monthTop10.length===0) {
    slide.addShape('rect',{x:rightX,y:slaY+0.27,w:rightW,h:slaRowH*maxViolRows+slaRowH,fill:{color:'F0FFF4'},line:{color:'CCCCCC',pt:0.5}});
    slide.addText('✓  No SLA violations this month',{
      x:rightX+0.1,y:slaY+0.27,w:rightW-0.2,h:slaRowH*maxViolRows+slaRowH,
      fontSize:8.5,bold:true,color:'27AE60',fontFace:'Calibri',align:'center',valign:'middle'
    });
  } else {
    // Column header
    slide.addShape('rect',{x:rightX,y:slaY+0.27,w:rightW,h:slaRowH,fill:{color:C.tableHead},line:{color:C.tableHead,pt:0}});
    slide.addText('Category',{x:rightX+0.05,y:slaY+0.27,w:rightW*0.62,h:slaRowH,fontSize:7,bold:true,color:'FFFFFF',fontFace:'Calibri',valign:'middle'});
    slide.addText('Violated', {x:rightX+rightW*0.62,y:slaY+0.27,w:rightW*0.38,h:slaRowH,fontSize:7,bold:true,color:'FFFFFF',fontFace:'Calibri',valign:'middle',align:'center'});
    // Data rows
    showViol.forEach((v,i)=>{
      const ry=slaY+0.27+slaRowH+i*slaRowH;
      const rowColor=i%2===0?'FFF5F5':'FFFFFF';
      slide.addShape('rect',{x:rightX,y:ry,w:rightW,h:slaRowH,fill:{color:rowColor},line:{color:'EEEEEE',pt:0.3}});
      slide.addText(v.category,{x:rightX+0.05,y:ry,w:rightW*0.60,h:slaRowH,fontSize:6.5,color:'333333',fontFace:'Calibri',valign:'middle'});
      slide.addText(`${v.violations} (${v.pct}%)`,{x:rightX+rightW*0.60,y:ry,w:rightW*0.40,h:slaRowH,fontSize:6.5,bold:true,color:'E74C3C',fontFace:'Calibri',valign:'middle',align:'center'});
    });
  }

  // ── Monthly comment — same structure as weekly auto-fill, using calendar data ──
  const trendM = (cur, prev, loBetter) => {
    if (cur==null||prev==null) return '';
    const diff = cur-prev;
    if (Math.abs(diff)<0.5) return ' (stable)';
    const better = loBetter ? diff<0 : diff>0;
    const arrow  = diff>0?'↑':'↓';
    return ` (${arrow} ${diff>0?'+':''}${Math.round(diff)} vs ${pMLabel||'prev month'} — ${better?'improvement':'degradation'})`;
  };
  const pTrendM = (cur, prev, loBetter) => {
    if (cur==null||prev==null) return '';
    const diff = Math.round((cur-prev)*10)/10;
    if (diff===0) return ' (stable)';
    const better = loBetter ? diff<0 : diff>0;
    return ` (${diff>0?'↑':'↓'} ${diff>0?'+':''}${diff}pt — ${better?'improvement':'degradation'})`;
  };
  const ageBuckets = ['0–7d','8–14d','15–30d','31–60d','60+d'];
  const ageTxtM = lastAgeing.length
    ? lastAgeing.map((n,i)=>n>0?`${n} ticket${n>1?'s':''} ${ageBuckets[i]}`:null).filter(Boolean).join(', ')||'no open tickets'
    : null;

  const cmtLines = [];
  if (calHasData) {
    cmtLines.push(`${monthLabel} — ${siteName}`);
    const prevCl = prevH6?.closed ?? null;
    const prevIn = prevH6?.inbound ?? null;
    const prevRef = (prevIn!=null&&pMLabel) ? ` vs ${prevIn} inbound / ${prevCl} closed (${pMLabel})` : '';
    cmtLines.push(`• Volume: ${mIn} inbound tickets, ${mCl} closed (${mPct}% closure rate)${prevRef}.`);
    if (calHd.avg_tta_h!=null)
      cmtLines.push(`• Time to Assign: avg ${calHd.avg_tta_h}h${trendM(calHd.avg_tta_h,prevCalHd?.avg_tta_h,true)}.`);
    if (calHd.avg_first_reply_h!=null)
      cmtLines.push(`• First Reply: avg ${calHd.avg_first_reply_h}h${trendM(calHd.avg_first_reply_h,prevCalHd?.avg_first_reply_h,true)}.`);
    if (calHd.avg_resolution_d!=null)
      cmtLines.push(`• Resolution Time: avg ${calHd.avg_resolution_d}d${trendM(calHd.avg_resolution_d,prevCalHd?.avg_resolution_d,true)}.`);
    if (mRes!=null)
      cmtLines.push(`• Resolution SLA: ${mRes}%${pTrendM(mRes,prevH6?.res_sla_pct,false)}.`);
    if (mFr!=null)
      cmtLines.push(`• 1st Reply SLA: ${mFr}%${pTrendM(mFr,prevH6?.reply_sla_pct,false)}.`);
    if (ageTotalOpen>0)
      cmtLines.push(`• Open tickets: ${ageTotalOpen} total${ageTxtM?' — '+ageTxtM:''}.`);
    if (monthTop10.length) {
      const top3 = monthTop10.slice(0,3);
      cmtLines.push(`• Top SLA violation categor${top3.length>1?'ies':'y'}: ${top3.map(e=>`${e.category} (${e.violations}, ${e.pct}%)`).join('; ')}.`);
    } else {
      cmtLines.push(`• No SLA violations recorded this month.`);
    }
  } else {
    // Fallback: last weekly report's comment if no calendar data
    const lastRptFb = reports&&reports.length?reports[reports.length-1]:null;
    const hdFb = lastRptFb?(lastRptFb.helpdesk||{}):{};
    cmtLines.push(hdFb.comments_metrics||'—');
  }
  const monthlyCommentTxt = cmtLines.join('\n');

  const cmtY = slaY+slaH+0.07;
  const cmtH = 7.38-cmtY;
  if (cmtH>0.3) {
    slide.addShape('rect',{x:rightX,y:cmtY,w:rightW,h:0.24,fill:{color:C.orange}});
    slide.addText('Comments',{x:rightX+0.1,y:cmtY+0.02,w:rightW-0.2,h:0.20,fontSize:9,bold:true,color:C.white,fontFace:'Calibri'});
    slide.addShape('rect',{x:rightX,y:cmtY+0.24,w:rightW,h:cmtH-0.24,fill:{color:C.lightGrey},line:{color:'CCCCCC',pt:0.5}});
    slide.addText(monthlyCommentTxt,{x:rightX+0.1,y:cmtY+0.28,w:rightW-0.2,h:cmtH-0.32,fontSize:8,color:C.darkGrey,fontFace:'Calibri',valign:'top',wrap:true});
  }

  return slide;
}

// ── MONTHLY SLIDE 5 — MERGED LIGHTS/HIGHLIGHTS ───────────────────
function slideMonthlyLightsV2(pptx, editedLights, monthLabel) {
  const slide = pptx.addSlide();
  addTitle(slide, `5. Low Lights / High Lights — ${monthLabel}`, 'All Weeks Combined');

  // ── Goal banner (full width) ─────────────────────────────────────
  const totalW  = 12.73;
  const mlHalfW = (totalW - 0.1) / 2;   // 6.315" each panel
  const mlPanX2 = 0.3 + mlHalfW + 0.1;  // x of right panel ≈ 6.715"
  const mlChgY  = 4.5;
  const mlPanH  = mlChgY - 0.15 - 2.0;  // ≈ 2.35" content height

  addSectionBadge(slide, 'Goal:', 0.3, 1.0, totalW);
  slide.addShape('rect',{x:0.3,y:1.32,w:totalW,h:0.32,fill:{color:C.lightGrey},line:{color:'CCCCCC',pt:0.5}});
  slide.addText('Consolidated issues, incidents, and achievements across all weeks of the month.',
    {x:0.4,y:1.35,w:totalW-0.2,h:0.28,fontSize:9,color:C.midGrey,fontFace:'Calibri',italic:true});

  const lights = editedLights || [];
  const low    = lights.filter(l=>l.type==='low_light');
  const high   = lights.filter(l=>l.type==='high_light');
  const inProg = lights.filter(l=>l.type==='change_in_progress');
  const pending= lights.filter(l=>l.type==='change_pending');

  // ── Issues & Successes tables (full width, equal height to Changes) ─
  const buildTable = (items, title, x, y, w, panH) => {
    slide.addShape('rect',{x,y,w,h:0.26,fill:{color:C.blue}});
    slide.addText(title,{x:x+0.05,y:y+0.03,w:w-0.1,h:0.22,fontSize:9,bold:true,color:C.white,fontFace:'Calibri'});
    if (!items.length) {
      slide.addShape('rect',{x,y:y+0.26,w,h:panH,fill:{color:C.lightGrey},line:{color:'CCCCCC',pt:0.5}});
      slide.addText('—',{x:x+0.1,y:y+0.3,w:w-0.2,h:0.3,fontSize:9,color:C.midGrey,fontFace:'Calibri',italic:true});
      return;
    }
    const rowH = Math.min(0.38, (panH - 0.05) / (items.length + 1));
    const tRows = items.map((l,i)=>[
      {text:l.week_label||'',  options:{fontSize:8,align:'center',color:'555555',fill:{color:i%2===0?C.lightGrey:C.white}}},
      {text:l.content||'',     options:{fontSize:9,color:C.darkGrey,wrap:true,fill:{color:i%2===0?C.lightGrey:C.white}}},
    ]);
    slide.addTable([
      [{text:'Week',options:{bold:true,fill:{color:'2A5490'},color:C.white,fontSize:8,align:'center'}},
       {text:'Item',options:{bold:true,fill:{color:'2A5490'},color:C.white,fontSize:8}}],
      ...tRows
    ],{x,y:y+0.26,w,fontFace:'Calibri',border:{type:'solid',color:'DDDDDD',pt:0.5},rowH,colW:[1.2,w-1.2]});
  };

  buildTable(low,  '🔴 Issues & Incidents',       0.3,     1.68, mlHalfW, mlPanH);
  buildTable(high, '🟢 Successes & Achievements', mlPanX2, 1.68, mlHalfW, mlPanH);

  // ── Changes In Progress & Pending (full width) ───────────────────
  addSectionBadge(slide, 'Changes In Progress & Pending', 0.3, mlChgY, totalW);
  const changes = [...inProg.map(l=>({...l,prefix:'In Progress:'})), ...pending.map(l=>({...l,prefix:'Pending:'}))];
  if (changes.length) {
    const chHdr = [
      {text:'Week',   options:{bold:true,fill:{color:'2A5490'},color:C.white,fontSize:8,align:'center'}},
      {text:'Status', options:{bold:true,fill:{color:'2A5490'},color:C.white,fontSize:8,align:'center'}},
      {text:'Change', options:{bold:true,fill:{color:'2A5490'},color:C.white,fontSize:8}},
    ];
    const chRows = changes.map((l,i)=>[
      {text:l.week_label||'', options:{fontSize:8,align:'center',fill:{color:i%2===0?C.lightGrey:C.white}}},
      {text:l.prefix,         options:{fontSize:8,align:'center',color:l.type==='change_in_progress'?'E87722':'555555',bold:true,fill:{color:i%2===0?C.lightGrey:C.white}}},
      {text:l.content||'',    options:{fontSize:9,color:C.darkGrey,wrap:true,fill:{color:i%2===0?C.lightGrey:C.white}}},
    ]);
    slide.addTable([chHdr,...chRows],{
      x:0.3, y:mlChgY+0.3, w:totalW, fontFace:'Calibri',
      border:{type:'solid',color:'DDDDDD',pt:0.5},
      rowH:0.32, colW:[1.2,1.4,totalW-2.6]
    });
  } else {
    slide.addText('No changes recorded this month.',
      {x:0.4,y:mlChgY+0.35,w:totalW-0.2,h:0.4,fontSize:10,color:C.midGrey,fontFace:'Calibri',italic:true});
  }
  return slide;
}

// ── MONTHLY SLIDE 6 — MERGED ACTION ITEMS ────────────────────────
function slideMonthlyActionsV2(pptx, editedActions, monthLabel) {
  const slide = pptx.addSlide();
  // CLAUDE.md compliance: never pass a subtitle to addTitle (was previously 'All Weeks Combined')
  addTitle(slide, `6. Actions & Follow-ups — ${monthLabel}`, null);

  const totalW = 12.73;
  addSectionBadge(slide, 'Goal:', 0.3, 1.0, totalW);
  slide.addShape('rect',{x:0.3,y:1.32,w:totalW,h:0.28,fill:{color:C.lightGrey},line:{color:'CCCCCC',pt:0.5}});
  slide.addText('Tracking key responsibilities, priorities, and status updates across all weeks',
    {x:0.3,y:1.32,w:totalW,h:0.28,fontSize:10,color:C.darkGrey,fontFace:'Calibri',bold:true,align:'center'});

  // Sort: open / in_progress first, closed / completed / cancelled last
  const _actOrder = s => ['open','in_progress'].includes((s||'open').toLowerCase()) ? 0 : 1;
  const items = (editedActions || []).slice().sort((a, b) => _actOrder(a.status) - _actOrder(b.status));

  const rows = [
    [
      {text:'Week',       options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:9}},
      {text:'Task',       options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'left',fontSize:9}},
      {text:'Department', options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:9}},
      {text:'Priority',   options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:9}},
      {text:'Due Date',   options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:9}},
      {text:'Owner',      options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:9}},
      {text:'Status',     options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:9}},
    ],
    ...(items.length ? items : [{ week_label:'—', task:'—', department:'—', priority:'—', due_date:'—', owner:'—', status:'—' }]).map((a,i) => {
      const pColor = a.priority==='High'?C.red:a.priority==='Low'?C.green:C.orange;
      const rowFill = i%2===0?C.lightGrey:C.white;
      return [
        {text:a.week_label||'',           options:{fill:{color:rowFill},align:'center',fontSize:9,color:'555555'}},
        {text:a.task||'—',                options:{fill:{color:rowFill},align:'left',fontSize:9}},
        {text:a.department||'—',          options:{fill:{color:rowFill},align:'center',fontSize:8,color:C.darkGrey}},
        {text:a.priority||'—',            options:{fill:{color:rowFill},color:pColor,bold:true,align:'center',fontSize:9}},
        {text:a.due_date||'TBC',          options:{fill:{color:rowFill},align:'center',fontSize:9}},
        {text:a.owner||'—',               options:{fill:{color:rowFill},align:'center',fontSize:9}},
        {text:a.status||'open',           options:{fill:{color:rowFill},align:'center',fontSize:9}},
      ];
    })
  ];

  const rowH   = Math.min(0.5, 5.5/(items.length+1));
  slide.addTable(rows, {
    x:0.3, y:1.65, w:totalW, h:Math.min(5.5,(items.length+1)*rowH+0.1),
    fontFace:'Calibri', fontSize:10,
    border:{type:'solid',color:'CCCCCC',pt:0.5},
    colW:[1.2, 5.53, 1.4, 1.0, 1.1, 1.3, 1.2],   // Week | Task | Dept | Priority | Due | Owner | Status — sums 12.73
    rowH
  });
  return slide;
}

// ── MONTHLY SLIDE 7 — ANNUAL OBJECTIVES ──────────────────────────
function slideAnnualObjectives(pptx, objectives, siteName, year) {
  const slide = pptx.addSlide();
  addTitle(slide, `7. Annual IT Objectives — ${year}`, siteName);

  addSectionBadge(slide, 'IT Department Strategic Goals', 0.3, 1.0, 12.73);

  const items = objectives || [];
  const statusIcon = (s) => {
    switch ((s||'').toLowerCase()) {
      case 'achieved':  return '✅';
      case 'deferred':  return '⏸';
      default:          return '🔄';
    }
  };
  const statusColor2 = (s) => {
    switch ((s||'').toLowerCase()) {
      case 'achieved':  return '27AE60';
      case 'deferred':  return '888888';
      default:          return '1C3A5E';
    }
  };

  const rows = [
    [
      {text:'#',          options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:10}},
      {text:'Objective',  options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'left',fontSize:10}},
      {text:'Target',     options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:10}},
      {text:'Status',     options:{bold:true,color:C.white,fill:{color:C.tableHead},align:'center',fontSize:10}},
    ],
    ...(items.length ? items : [{ objective:'No objectives defined yet.', target:'—', status:'in_progress' }]).map((o,i) => {
      const rowFill = i%2===0?C.lightGrey:C.white;
      return [
        {text:String(i+1), options:{fill:{color:rowFill},align:'center',bold:true,fontSize:11,color:C.blue}},
        {text:o.objective,  options:{fill:{color:rowFill},align:'left',fontSize:10}},
        {text:o.target||'—',options:{fill:{color:rowFill},align:'center',fontSize:10}},
        {text:`${statusIcon(o.status)} ${o.status||'in_progress'}`.replace('_',' '),
          options:{fill:{color:rowFill},align:'center',fontSize:10,bold:true,color:statusColor2(o.status)}},
      ];
    })
  ];

  const rowH = items.length > 0 ? Math.min(0.7, 5.8/(items.length+1)) : 0.65;
  slide.addTable(rows, {
    x:0.3, y:1.35, w:12.73, h:Math.min(5.8,(items.length+1)*rowH+0.1),
    fontFace:'Calibri', fontSize:11,
    border:{type:'solid',color:'CCCCCC',pt:0.5},
    colW:[0.4, 9.83, 1.3, 1.2],
    rowH
  });
  return slide;
}

// ── GENERATE MONTHLY PPTX V2 (7-slide structure) ─────────────────
async function generateMonthlyPptxV2(monthlyData, siteName, year, month, edits, objectives) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const monthLabel = new Date(year, month-1, 1).toLocaleString('en', { month:'long', year:'numeric' });
  pptx.title = `Monthly IT Report — ${siteName} — ${monthLabel}`;

  const { reports } = monthlyData;
  const lastReport  = reports && reports.length ? reports[reports.length - 1] : null;
  const editedLights  = edits ? edits.edited_lights  : null;
  const editedActions = edits ? edits.edited_actions : null;

  // Slide 1: Cover
  addTitleSlide(pptx, 'Monthly IT Report', `${siteName} · ${monthLabel}`,
    `${reports ? reports.length : 0} week(s) of data`);

  // Slide 2: Last Week Infra KPIs
  slideMonthlyLastWeekInfra(pptx, lastReport, monthLabel);

  // Slide 3: Monthly Infra Trend
  slideMonthlyInfraTrend(pptx, monthlyData, siteName, monthLabel);

  // Slide 4: Monthly Helpdesk Metrics
  slideMonthlyHelpdesk(pptx, monthlyData, siteName, monthLabel);

  // Slide 5: Merged Lights
  slideMonthlyLightsV2(pptx, editedLights, monthLabel);

  // Slide 6: Merged Actions
  slideMonthlyActionsV2(pptx, editedActions, monthLabel);

  // Slide 7: Annual Objectives
  slideAnnualObjectives(pptx, objectives, siteName, year);

  return fixComboChartAxes(await pptx.write({ outputType: 'nodebuffer' }));
}

// ── GENERATE ALL-SITES MONTHLY PPTX ──────────────────────────────
async function generateAllSitesMonthlyPptx(allSiteData, year, month) {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  const monthLabel = new Date(year, month-1, 1).toLocaleString('en', { month:'long', year:'numeric' });
  pptx.title = `Monthly IT Report — All Sites — ${monthLabel}`;

  // Master cover
  addTitleSlide(pptx, 'Monthly IT Report', `All Sites · ${monthLabel}`,
    `${allSiteData.length} sites with submitted data`);

  for (const { site, monthlyData, edits, objectives } of allSiteData) {
    const { reports } = monthlyData;
    const lastReport  = reports && reports.length ? reports[reports.length-1] : null;

    // Site divider slide
    const div = pptx.addSlide();
    div.addShape('rect',{x:0,y:0,w:10,h:7.5,fill:{color:C.blue}});
    div.addShape('rect',{x:0,y:3.5,w:10,h:0.08,fill:{color:C.orange}});
    div.addText('ENDEAVOUR MINING',{x:1,y:1.2,w:8,h:0.5,fontSize:16,bold:true,color:C.orange,fontFace:'Calibri',align:'center',charSpacing:4});
    div.addText('IT Department',{x:1,y:1.75,w:8,h:0.35,fontSize:12,color:'CCCCCC',fontFace:'Calibri',align:'center'});
    div.addText(site.name,{x:1,y:2.65,w:8,h:0.8,fontSize:30,bold:true,color:C.white,fontFace:'Calibri',align:'center'});
    div.addText(monthLabel,{x:1,y:3.6,w:8,h:0.45,fontSize:16,color:C.orange,fontFace:'Calibri',align:'center'});

    const editedLights  = edits ? edits.edited_lights  : null;
    const editedActions = edits ? edits.edited_actions : null;

    slideMonthlyLastWeekInfra(pptx, lastReport, monthLabel);
    slideMonthlyInfraTrend(pptx, monthlyData, site.name, monthLabel);
    slideMonthlyHelpdesk(pptx, monthlyData, site.name, monthLabel);
    slideMonthlyLightsV2(pptx, editedLights, monthLabel);
    slideMonthlyActionsV2(pptx, editedActions, monthLabel);
    slideAnnualObjectives(pptx, objectives, site.name, year);
  }

  return fixComboChartAxes(await pptx.write({ outputType: 'nodebuffer' }));
}

module.exports = {
  generateWeeklyPptx, generateMonthlyPptx, generateWeeklySummaryPptx,
  generateMonthlyPptxV2, generateAllSitesMonthlyPptx
};
