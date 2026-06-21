/**
 * Endeavour Mining — Monthly Report PPTX Generator  (v1.10.1)
 * Separated from reports-weekly-pptx.js so weekly and monthly generation
 * can be maintained independently.
 *
 * 7-slide structure per site:
 *   1. Cover
 *   2. Last-week Infrastructure KPIs
 *   3. Monthly Infrastructure Trend (6-month comparison)
 *   4. Monthly Helpdesk Metrics  (week-by-week + monthly totals)
 *   5. Merged Low Lights / High Lights  (with Week column)
 *   6. Merged Actions & Follow-ups      (with Week column)
 *   7. Annual IT Objectives
 *
 * Colors: Orange #E87722 · Dark Blue #1C3A5E · Light Grey #F2F2F2
 */
'use strict';

const PptxGenJS = require('pptxgenjs');
const { fixComboChartAxes } = require('./pptx-fix-axes');

// ── COLOR PALETTE ─────────────────────────────────────────────────
// Sourced from public/brand/brand-tokens.js (single source of truth,
// mirrors public/_tokens.css). `C` is the legacy palette preserved for
// visual parity; `EDV` is the brand-aligned palette for new slides.
// See public/brand/README.md.
const { C, EDV, FONTS } = require('./public/brand/brand-tokens');

// ── SHARED HELPERS ────────────────────────────────────────────────
// statusColor / trendArrow / trendColor / computeTrends / autoStatusColor are
// the byte-identical helpers shared with reports-weekly-pptx.js — single
// source of truth in reports-pptx-shared.js. The monthly-only helpers
// (slaColor / pctColor / infraCellColor) stay below.
const { statusColor, trendArrow, trendColor, computeTrends, autoStatusColor } = require('./reports-pptx-shared');

function slaColor(pct) {
  if (pct == null) return C.midGrey;
  return pct >= 90 ? '27AE60' : pct >= 70 ? 'F39C12' : 'E74C3C';
}

function pctColor(pct) {
  if (pct == null) return C.midGrey;
  return pct >= 80 ? '27AE60' : pct >= 50 ? 'F39C12' : 'E74C3C';
}

/**
 * Color a trend-table cell background based on value vs target.
 * Returns a hex color string, or null if no color should be applied.
 */
function infraCellColor(avg, targetStr) {
  if (avg === null) return null;
  const tgt = parseFloat(String(targetStr || '').replace('%', '').trim());
  if (isNaN(tgt) || tgt <= 0) return null;
  const val = parseFloat(avg);
  if (val >= tgt)        return '2D9C4A';   // green
  if (val >= tgt * 0.90) return 'E87722';   // orange
  return 'D0312D';                           // red
}

// Title at top of every content slide
function addTitle(slide, text, subtitle) {
  slide.addText(text, {
    x: 0.3, y: 0.12, w: 9.4, h: 0.5,
    fontSize: 24, bold: true, color: C.orange, fontFace: 'Calibri', align: 'center'
  });
  if (subtitle) {
    slide.addText(subtitle, {
      x: 0.3, y: 0.64, w: 9.4, h: 0.27,
      fontSize: 12, color: C.midGrey, fontFace: 'Calibri', align: 'center', italic: true
    });
  }
}

// Dark badge bar (section label)
function addSectionBadge(slide, text, x, y, w, h, fillColor) {
  // fillColor (hex without `#`) overrides the default navy — used by the
  // Active Major Incidents banner below to render in EDV red instead.
  h = h || 0.3;
  slide.addShape('rect', { x, y, w, h, fill: { color: fillColor || C.blue } });
  slide.addText(text, { x, y, w, h, fontSize: 10, bold: true, color: C.white, fontFace: 'Calibri', align: 'left', margin: [0, 0, 0, 8] });
}

// ── Active Major Incidents block ────────────────────────────────────
// MIRROR of the same-named helper in reports-weekly-pptx.js. The
// project intentionally duplicates slide-rendering helpers between the
// weekly and monthly PPTX generators (see CLAUDE.md "slideMonthly*
// duplication" rule); keep both copies in sync when one is edited.
//
// Layout decisions (from user feedback):
//   • FULL slide width (12.73") — single row per incident.
//   • Title banner red; column header row navy (matches changes).
//   • Generous column widths so RCA/CA/PIR/LL chips don't wrap.
function addActiveIncidentsBlock(slide, incidents, startY, maxRows) {
  maxRows = maxRows || 3;
  const totalW = 12.73;

  addSectionBadge(slide, '🚨 Active Major Incidents — ServiceDesk Plus (auto)', 0.3, startY, totalW, 0.3, 'C53030');

  if (!incidents || incidents.length === 0) {
    slide.addText('No active major incidents for this site. ✓', {
      x:0.4, y:startY + 0.35, w:totalW - 0.2, h:0.30,
      fontSize:10, color:'27ae60', fontFace:'Calibri', italic:true
    });
    return startY + 0.72;
  }

  // Full-width column layout: 12.73"
  const colW = [0.7, 5.13, 1.8, 1.1, 1.0, 1.0, 1.0, 1.0];
  const HDR_FILL = { color: '2A5490' };  // navy — matches changes table
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
    const fill    = { color: idx % 2 === 0 ? C.lightGrey : C.white };
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

  let outY = startY + 0.32 + 0.26 * (shown.length + 1);
  if (incidents.length > maxRows) {
    slide.addText(`+ ${incidents.length - maxRows} more not shown — see executive Incident Register for the full list.`, {
      x:0.3, y:outY + 0.02, w:totalW, h:0.22, fontSize:8.5, italic:true, color:C.midGrey, fontFace:'Calibri'
    });
    outY += 0.24;
  }
  slide.addText([
    { text: 'RCA/CA/PIR/LL:  ',  options:{ fontSize:8, bold:true, color:C.midGrey } },
    { text: '✓ done  ',          options:{ fontSize:8, color:'27ae60', bold:true } },
    { text: '◐ partial  ',       options:{ fontSize:8, color:'D97706', bold:true } },
    { text: '✗ missing',         options:{ fontSize:8, color:'DC2626', bold:true } },
  ], { x:0.3, y:outY + 0.04, w:totalW, h:0.22, fontFace:'Calibri', valign:'top' });
  return outY + 0.30;
}

// ── SLIDE 1 — COVER ───────────────────────────────────────────────
function slideCover(pptx, siteName, monthLabel, weekCount) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: 10, h: 7.5, fill: { color: C.blue } });
  slide.addShape('rect', { x: 0, y: 3.55, w: 10, h: 0.08, fill: { color: C.orange } });

  slide.addText('ENDEAVOUR MINING', {
    x: 1, y: 1.1, w: 8, h: 0.5,
    fontSize: 16, bold: true, color: C.orange, fontFace: 'Calibri', align: 'center', charSpacing: 4
  });
  slide.addText('IT Department', {
    x: 1, y: 1.65, w: 8, h: 0.35,
    fontSize: 12, color: 'CCCCCC', fontFace: 'Calibri', align: 'center'
  });
  slide.addText('Monthly IT Report', {
    x: 1, y: 2.3, w: 8, h: 0.65,
    fontSize: 22, bold: true, color: C.white, fontFace: 'Calibri', align: 'center'
  });
  slide.addText(siteName, {
    x: 1, y: 3.0, w: 8, h: 0.45,
    fontSize: 18, bold: true, color: C.orange, fontFace: 'Calibri', align: 'center'
  });
  slide.addText(monthLabel, {
    x: 1, y: 3.7, w: 8, h: 0.4,
    fontSize: 15, color: C.orange, fontFace: 'Calibri', align: 'center'
  });
  slide.addText(`${weekCount} week(s) of data`, {
    x: 1, y: 4.2, w: 8, h: 0.3,
    fontSize: 11, color: 'AAAAAA', fontFace: 'Calibri', align: 'center', italic: true
  });
}

// ── SLIDE 2 — LAST WEEK INFRA KPIs ───────────────────────────────
function slideMonthlyLastWeekInfra(pptx, lastReport, monthLabel, prevReport) {
  const slide = pptx.addSlide();
  const wkLabel = lastReport ? (lastReport.week_label || '') : '';
  addTitle(slide, `Infrastructure KPIs — Last Week of ${monthLabel}`, wkLabel);

  // Auto-compute trend direction from current vs previous week values (overrides stored trend)
  const rawKpis = lastReport ? (lastReport.infra_kpis || []) : [];
  const prevKpis = prevReport ? (prevReport.infra_kpis || []) : [];
  const kpis = computeTrends(rawKpis, prevKpis);
  const rows = [
    [
      { text: 'Service',  options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'left' } },
      { text: 'KPI',      options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'left' } },
      { text: 'Target',   options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center' } },
      { text: 'Status',   options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center' } },
      { text: 'Trend',    options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center' } },
    ],
    ...(kpis.length
      ? kpis
      : [{ service: 'No data', kpi: '—', target: '—', status_value: '—', status_color: 'none', trend: 'no_change' }]
    ).map((k, i) => {
      // Auto-derive color from numeric value vs target; fall back to stored color
      const { color: sc, hasColor } = autoStatusColor(k.status_value, k.target, k.status_color);
      const rowFill = i % 2 === 0 ? C.lightGrey : C.white;
      return [
        { text: k.service,             options: { fill: { color: rowFill }, align: 'left', bold: true } },
        { text: k.kpi,                 options: { fill: { color: rowFill }, align: 'left' } },
        { text: k.target || '—',       options: { fill: { color: rowFill }, align: 'center' } },
        { text: k.status_value || '—', options: { fill: { color: hasColor ? sc : rowFill }, color: hasColor ? C.white : C.darkGrey, bold: true, align: 'center' } },
        { text: trendArrow(k.trend),   options: { fill: { color: rowFill }, color: k.trend === 'up' ? C.green : k.trend === 'down' ? C.red : C.midGrey, bold: true, align: 'center', fontSize: 14 } },
      ];
    })
  ];

  const rowH = kpis.length > 0 ? Math.min(0.68, 5.6 / (kpis.length + 1)) : 0.6;
  slide.addTable(rows, {
    x: 0.3, y: 1.0, w: 12.73, h: 5.6,
    fontFace: 'Calibri', fontSize: 12,
    border: { type: 'solid', color: 'CCCCCC', pt: 0.5 },
    rowH,
    colW: [5.73, 2.5, 1.0, 2.0, 1.5],
  });
  return slide;
}

// ── SLIDE 3 — INFRA TREND (Jan–Dec full year) ─────────────────────
// yearlyData: array of 12 entries from getYearlySummary(), one per month.
// Each entry: { month (1-12), label ("Jan 2026"), has_data, kpis: [...] }
// reportMonth: 1-indexed month of the report being generated.
function slideMonthlyInfraTrend(pptx, yearlyData, siteName, monthLabel, reportMonth) {
  const slide = pptx.addSlide();
  addTitle(slide, `Infrastructure KPI Trend — ${monthLabel}`, siteName);

  if (!yearlyData || !yearlyData.length) {
    slide.addText('No yearly data available.', {
      x: 0.5, y: 3.5, w: 9, h: 0.5, fontSize: 13, color: C.midGrey, align: 'center', fontFace: 'Calibri', italic: true
    });
    return slide;
  }

  // Collect service names from the month with the most KPI entries
  const serviceRef = yearlyData
    .filter(m => m.has_data && (m.kpis || []).length > 0)
    .reduce((best, m) => ((m.kpis || []).length > (best.kpis || []).length ? m : best), { kpis: [] });

  const serviceOrder = [];
  const servicesMeta = {};
  (serviceRef.kpis || []).forEach(k => {
    if (!servicesMeta[k.service]) {
      serviceOrder.push(k.service);
      servicesMeta[k.service] = { kpi: k.kpi, target: k.target };
    }
  });

  if (!serviceOrder.length) {
    slide.addText('No infrastructure data available for this year.', {
      x: 0.5, y: 3.5, w: 9, h: 0.5, fontSize: 13, color: C.midGrey, align: 'center', fontFace: 'Calibri', italic: true
    });
    return slide;
  }

  // Build kpi lookup by month number → service name
  const byMonth = {};
  yearlyData.forEach(m => {
    byMonth[m.month] = {};
    (m.kpis || []).forEach(k => { byMonth[m.month][k.service] = k; });
  });

  // Header: 3 fixed cols + 12 month cols (abbreviated) + Year Avg
  const headerRow = [
    { text: 'Service', options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'left',   fontSize: 9 } },
    { text: 'KPI',     options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'left',   fontSize: 9 } },
    { text: 'Target',  options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center', fontSize: 9 } },
    ...yearlyData.map(m => {
      const isCur = m.month === reportMonth;
      return {
        text: m.label.substring(0, 3),  // "Jan", "Feb", …
        options: { bold: true, color: isCur ? C.orange : C.white, fill: { color: C.tableHead }, align: 'center', fontSize: 8 }
      };
    }),
    { text: 'YTD Avg', options: { bold: true, color: C.white, fill: { color: C.blue }, align: 'center', fontSize: 8 } }
  ];

  const dataRows = serviceOrder.map((svc, i) => {
    const meta    = servicesMeta[svc];
    const rowFill = i % 2 === 0 ? C.lightGrey : C.white;
    const ytdAvgs = [];  // only non-null, non-zero values for YTD average

    const monthCells = yearlyData.map(m => {
      const kEntry = byMonth[m.month] && byMonth[m.month][svc];
      const raw    = kEntry ? parseFloat(String(kEntry.status_value || '').replace('%', '').trim()) : NaN;
      const hasVal = !isNaN(raw) && raw > 0;  // zero treated as no data (e.g. month not yet started)
      const isCur  = m.month === reportMonth;

      if (hasVal) ytdAvgs.push(raw);

      const display = hasVal ? `${raw.toFixed(1)}%`
                    : (kEntry && kEntry.status_value && kEntry.status_value !== '0' ? kEntry.status_value : '—');

      return {
        text: display,
        options: {
          fill:     { color: rowFill },
          align:    'center',
          bold:     isCur,
          fontSize: 9,
          color:    isCur ? C.blue : C.darkGrey
        }
      };
    });

    // YTD Average — only months with real (> 0) data
    const ytdAvg = ytdAvgs.length ? ytdAvgs.reduce((a, b) => a + b, 0) / ytdAvgs.length : null;
    const yearCell = {
      text: ytdAvg !== null ? `${ytdAvg.toFixed(1)}%` : '—',
      options: {
        fill:     { color: C.highlight },
        align:    'center',
        bold:     true,
        fontSize: 9,
        color:    C.blue
      }
    };

    return [
      { text: svc,                options: { fill: { color: rowFill }, bold: true, align: 'left',   fontSize: 9 } },
      { text: meta.kpi || '—',    options: { fill: { color: rowFill }, align: 'left',   fontSize: 8 } },
      { text: meta.target || '—', options: { fill: { color: rowFill }, align: 'center', fontSize: 8 } },
      ...monthCells,
      yearCell
    ];
  });

  if (dataRows.length === 0) {
    slide.addText('No infrastructure data available for this month.', {
      x: 0.5, y: 3.5, w: 9, h: 0.5, fontSize: 13, color: C.midGrey, align: 'center', fontFace: 'Calibri', italic: true
    });
    return slide;
  }

  // Layout: Service gets extra width so names stay on one line; 12 months × 0.52" + YTD 0.7"
  const mW   = 0.52;
  const ytdW = 0.7;
  const kpiW = 1.1;
  const tgtW = 0.5;
  const svcW = 12.73 - kpiW - tgtW - (12 * mW) - ytdW;  // ≈ 4.19"
  const colW = [svcW, kpiW, tgtW, ...Array(12).fill(mW), ytdW];
  const rowH = Math.min(0.62, 6.0 / (dataRows.length + 1));

  slide.addTable([headerRow, ...dataRows], {
    x: 0.3, y: 1.0, w: 12.73,
    fontFace: 'Calibri', fontSize: 9,
    border: { type: 'solid', color: 'CCCCCC', pt: 0.5 },
    rowH, colW
  });
  return slide;
}

// ── SLIDE 4 — MONTHLY HELPDESK METRICS ───────────────────────────
// Builds a proper week-by-week table by matching chart_data.weeks entries
// to each report's week_label, then summing for monthly totals.
function slideMonthlyHelpdesk(pptx, monthlyData, siteName, monthLabel) {
  const slide = pptx.addSlide();
  // Title only — no subtitle (month shown in KPI tiles)
  addTitle(slide, `Helpdesk Metrics — ${monthLabel}`, null);

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
      lastPrevWk = wks.length>1 ? wks[wks.length-2] : null;
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
    const last=h6.length?h6[h6.length-1]:{};
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
  const botY   = 4.72;
  const botH   = 7.38-botY;   // 2.66" — both columns end at same y
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
  const slaY      = botY;
  const slaRowH   = 0.20;
  const maxViolRows = 4;
  const showViol  = monthTop10.slice(0,maxViolRows);
  const slaH      = 0.27+slaRowH+showViol.length*slaRowH;

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

// ── SLIDE 5 — MERGED LOW LIGHTS / HIGH LIGHTS ────────────────────
function slideMonthlyLightsV2(pptx, editedLights, monthLabel, openChanges) {
  const slide = pptx.addSlide();
  addTitle(slide, `Low Lights / High Lights — ${monthLabel}`, 'All Weeks Combined');

  // Goal banner
  const totalW  = 12.73;
  const halfW   = (totalW - 0.1) / 2;   // 6.315"
  const panelX2 = 0.3 + halfW + 0.1;    // ≈ 6.715"

  addSectionBadge(slide, 'Goal:', 0.3, 1.0, totalW);
  slide.addShape('rect', { x: 0.3, y: 1.3, w: totalW, h: 0.3, fill: { color: C.lightGrey }, line: { color: 'CCCCCC', pt: 0.5 } });
  slide.addText('Consolidated issues, incidents, and achievements across all weeks of the month.',
    { x: 0.4, y: 1.32, w: totalW - 0.2, h: 0.26, fontSize: 9, color: C.midGrey, fontFace: 'Calibri', italic: true });

  const lights = editedLights || [];
  const low    = lights.filter(l => l.type === 'low_light');
  const high   = lights.filter(l => l.type === 'high_light');

  const maxH  = 2.6;

  // Build a two-column table (Issues | Successes)
  const buildPanel = (items, title, x, y, w) => {
    addSectionBadge(slide, title, x, y, w);
    const hdr = [
      { text: 'Week', options: { bold: true, fill: { color: '2A5490' }, color: C.white, fontSize: 8, align: 'center' } },
      { text: 'Item', options: { bold: true, fill: { color: '2A5490' }, color: C.white, fontSize: 8 } },
    ];
    if (!items.length) {
      slide.addShape('rect', { x, y: y + 0.3, w, h: 0.4, fill: { color: C.lightGrey }, line: { color: 'CCCCCC', pt: 0.5 } });
      slide.addText('—', { x: x + 0.1, y: y + 0.34, w: w - 0.2, h: 0.3, fontSize: 9, color: C.midGrey, fontFace: 'Calibri', italic: true });
      return;
    }
    const rowH = Math.min(0.38, maxH / (items.length + 1));
    const tRows = items.map((l, i) => [
      { text: l.week_label || '', options: { fontSize: 8, align: 'center', color: '555555', fill: { color: i % 2 === 0 ? C.lightGrey : C.white } } },
      { text: l.content || '',    options: { fontSize: 9, color: C.darkGrey, wrap: true,      fill: { color: i % 2 === 0 ? C.lightGrey : C.white } } },
    ]);
    slide.addTable([hdr, ...tRows], {
      x, y: y + 0.3, w, fontFace: 'Calibri',
      border: { type: 'solid', color: 'DDDDDD', pt: 0.5 },
      rowH, colW: [1.1, w - 1.1]
    });
  };

  buildPanel(low,  '▼  Issues & Incidents',       0.3,      1.65, halfW);
  buildPanel(high, '▲  Successes & Achievements', panelX2,  1.65, halfW);

  // Changes section — auto-pulled from ServiceDesk Plus (not manually entered)
  const changes = openChanges || [];
  const changeY = 1.65 + maxH + 0.55;
  addSectionBadge(slide, 'Active Changes — ServiceDesk Plus (auto)', 0.3, changeY, 12.73);

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const stageColor = s => {
    if (['Implementation', 'Review', 'Release', 'UAT'].includes(s)) return C.orange;
    if (s === 'CAB Evaluation') return C.red;
    return '555555';
  };
  const riskColor = r => ({ High: C.red, Medium: C.orange, Low: '27ae60' }[r] || '888888');
  const fmtDate = d => {
    if (!d) return '—';
    const dt = new Date(d); if (isNaN(dt)) return '—';
    return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
  };
  const buildChangeCol = (items, x, w) => {
    if (!items.length) return;
    // colW: CH-ID | Subject | Risk | Owner | Due Date | Stage
    const subjectW = w - 3.73;
    const colW = [0.68, subjectW, 0.52, 1.0, 0.75, 0.78];
    const hdr = [
      { text: 'CH-ID',    options: { bold: true, fill: { color: '2A5490' }, color: C.white, fontSize: 7.5, align: 'center' } },
      { text: 'Subject',  options: { bold: true, fill: { color: '2A5490' }, color: C.white, fontSize: 7.5 } },
      { text: 'Risk',     options: { bold: true, fill: { color: '2A5490' }, color: C.white, fontSize: 7.5, align: 'center' } },
      { text: 'Requester', options: { bold: true, fill: { color: '2A5490' }, color: C.white, fontSize: 7.5 } },
      { text: 'Due Date', options: { bold: true, fill: { color: '2A5490' }, color: C.white, fontSize: 7.5, align: 'center' } },
      { text: 'Stage / Status', options: { bold: true, fill: { color: '2A5490' }, color: C.white, fontSize: 7.5, align: 'center' } },
    ];
    const rows = items.map((c, i) => {
      const fill      = { color: i % 2 === 0 ? C.lightGrey : C.white };
      const overdue   = c.scheduled_end && new Date(c.scheduled_end) < today;
      const dueText   = (overdue ? '⚠ ' : '') + fmtDate(c.scheduled_end);
      const chId      = (c.emergency ? '⚡ ' : '') + `CH-${c.display_id}`;
      const stageText = c.stage_status || c.stage || '';
      return [
        { text: chId,             options: { fontSize: 7.5, align: 'center', bold: true, fill, color: c.emergency ? C.red : '2d3a5e' } },
        { text: c.subject || '',  options: { fontSize: 7.5, wrap: true, fill, color: C.darkGrey } },
        { text: c.risk    || '—', options: { fontSize: 7.5, align: 'center', bold: true, fill, color: riskColor(c.risk) } },
        { text: c.requester || '—', options: { fontSize: 7.5, fill, color: C.darkGrey } },
        { text: dueText,          options: { fontSize: 7.5, align: 'center', bold: overdue, fill, color: overdue ? C.red : '444444' } },
        { text: stageText,        options: { fontSize: 7.5, wrap: true, align: 'center', bold: true, fill, color: stageColor(c.stage) } },
      ];
    });
    slide.addTable([hdr, ...rows], {
      x, y: changeY + 0.3, w, fontFace: 'Calibri',
      border: { type: 'solid', color: 'DDDDDD', pt: 0.5 },
      rowH: 0.27, colW
    });
  };

  if (changes.length === 0) {
    slide.addText('No open changes for this site.',
      { x: 0.4, y: changeY + 0.35, w: 12.53, h: 0.35, fontSize: 10, color: C.midGrey, fontFace: 'Calibri', italic: true });
  } else {
    const half = Math.ceil(changes.length / 2);
    buildChangeCol(changes.slice(0, half), 0.3,  6.3);
    buildChangeCol(changes.slice(half),    6.73, 6.3);
  }

  return slide;
}

// ── SLIDE 5b — ACTIVE MAJOR INCIDENTS (dedicated, monthly) ────────
// Mirror of slideActiveIncidents() in reports-weekly-pptx.js. Each
// site / month gets its own slide so the section is consistently
// present and never overlaps the changes table — see the rationale
// comment on the weekly side.
function slideMonthlyActiveIncidents(pptx, monthLabel, activeIncidents, siteName) {
  const slide = pptx.addSlide();
  const prefix = siteName ? `${siteName} — ` : '';
  addTitle(slide, `${prefix}Active Major Incidents — ${monthLabel}`, null);
  addActiveIncidentsBlock(slide, activeIncidents || [], 1.0, 12);
  return slide;
}

// ── SLIDE 6 — MERGED ACTIONS & FOLLOW-UPS ────────────────────────
function slideMonthlyActionsV2(pptx, editedActions, monthLabel) {
  const slide = pptx.addSlide();
  // CLAUDE.md compliance: never pass a subtitle to addTitle (was previously 'All Weeks Combined')
  addTitle(slide, `Actions & Follow-ups — ${monthLabel}`, null);

  const totalW = 12.73;
  addSectionBadge(slide, 'Goal:', 0.3, 1.0, totalW);
  slide.addShape('rect', { x: 0.3, y: 1.3, w: totalW, h: 0.28, fill: { color: C.lightGrey }, line: { color: 'CCCCCC', pt: 0.5 } });
  slide.addText('Tracking key responsibilities, priorities, and status updates across all weeks',
    { x: 0.3, y: 1.3, w: totalW, h: 0.28, fontSize: 10, color: C.darkGrey, fontFace: 'Calibri', bold: true, align: 'center' });

  // Sort: open / in_progress first, closed / completed / cancelled last
  const _actOrder = s => ['open','in_progress'].includes((s||'open').toLowerCase()) ? 0 : 1;
  const items = (editedActions || []).slice().sort((a, b) => _actOrder(a.status) - _actOrder(b.status));

  const hdr = [
    { text: 'Week',       options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center', fontSize: 9 } },
    { text: 'Task',       options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'left',   fontSize: 9 } },
    { text: 'Department', options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center', fontSize: 9 } },
    { text: 'Priority',   options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center', fontSize: 9 } },
    { text: 'Due Date',   options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center', fontSize: 9 } },
    { text: 'Owner',      options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center', fontSize: 9 } },
    { text: 'Status',     options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center', fontSize: 9 } },
  ];

  const pColor = p => p === 'High' ? C.red : p === 'Low' ? C.green : C.orange;

  const dataRows = (items.length
    ? items
    : [{ week_label: '—', task: '—', department: '—', priority: '—', due_date: '—', owner: '—', status: '—' }]
  ).map((a, i) => {
    const fill = { color: i % 2 === 0 ? C.lightGrey : C.white };
    return [
      { text: a.week_label || '',           options: { fill, align: 'center', fontSize: 9, color: '555555' } },
      { text: a.task || '—',                options: { fill, align: 'left',   fontSize: 9 } },
      { text: a.department || '—',          options: { fill, align: 'center', fontSize: 8, color: C.darkGrey } },
      { text: a.priority || '—',            options: { fill, align: 'center', fontSize: 9, bold: true, color: pColor(a.priority) } },
      { text: a.due_date || 'TBC',          options: { fill, align: 'center', fontSize: 9 } },
      { text: a.owner || '—',               options: { fill, align: 'center', fontSize: 9 } },
      { text: (a.status || 'open').replace('_', ' '), options: { fill, align: 'center', fontSize: 9 } },
    ];
  });

  const rowH = Math.min(0.48, 5.5 / (dataRows.length + 1));
  slide.addTable([hdr, ...dataRows], {
    x: 0.3, y: 1.65, w: totalW,
    h: Math.min(5.5, (dataRows.length + 1) * rowH + 0.1),
    fontFace: 'Calibri', fontSize: 10,
    border: { type: 'solid', color: 'CCCCCC', pt: 0.5 },
    colW: [1.2, 5.43, 1.4, 1.05, 1.15, 1.35, 1.15],   // Week | Task | Dept | Priority | Due | Owner | Status — sums 12.73
    rowH
  });
  return slide;
}

// ── SLIDE 7 — ANNUAL IT OBJECTIVES ───────────────────────────────
function slideAnnualObjectives(pptx, objectives, siteName, year) {
  const slide = pptx.addSlide();
  addTitle(slide, `Annual IT Objectives — ${year}`, siteName);
  addSectionBadge(slide, 'IT Department Strategic Goals', 0.3, 1.0, 12.73);

  const items = objectives || [];
  // Safe Unicode symbols — no multi-byte emoji (pptxgenjs renders those as ?)
  const statusIcon   = s => s === 'achieved' ? '✓' : s === 'deferred' ? '■' : '►';
  const statusColor2 = s => s === 'achieved' ? '27AE60' : s === 'deferred' ? '888888' : C.blue;
  const statusLabel  = s => {
    switch ((s || 'in_progress')) {
      case 'achieved':    return 'Achieved';
      case 'deferred':    return 'Deferred';
      case 'in_progress': return 'In Progress';
      default:            return (s || 'in_progress').replace('_', ' ');
    }
  };

  const hdr = [
    { text: '#',         options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center' } },
    { text: 'Objective', options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'left'   } },
    { text: 'Target',    options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center' } },
    { text: 'Status',    options: { bold: true, color: C.white, fill: { color: C.tableHead }, align: 'center' } },
  ];

  const isPlaceholder = items.length === 0;
  const dataRows = (items.length
    ? items
    : [{ objective: 'No objectives defined yet.', target: '—', status: null }]
  ).map((o, i) => {
    const fill = { color: i % 2 === 0 ? C.lightGrey : C.white };
    const statusText = isPlaceholder || !o.status ? '—'
      : `${statusIcon(o.status)} ${statusLabel(o.status)}`;
    const statusClr  = isPlaceholder || !o.status ? C.midGrey : statusColor2(o.status);
    return [
      { text: String(i + 1),   options: { fill, align: 'center', bold: true, fontSize: 11, color: C.blue } },
      { text: o.objective,     options: { fill, align: 'left',   fontSize: 10 } },
      { text: o.target || '—', options: { fill, align: 'center', fontSize: 10 } },
      { text: statusText,      options: { fill, align: 'center', fontSize: 10, bold: !isPlaceholder, color: statusClr } },
    ];
  });

  const rowH = items.length > 0 ? Math.min(0.68, 5.8 / (dataRows.length + 1)) : 0.65;
  slide.addTable([hdr, ...dataRows], {
    x: 0.3, y: 1.35, w: 12.73,
    h: Math.min(5.8, (dataRows.length + 1) * rowH + 0.1),
    fontFace: 'Calibri', fontSize: 11,
    border: { type: 'solid', color: 'CCCCCC', pt: 0.5 },
    colW: [0.4, 9.53, 1.6, 1.2],
    rowH
  });
  return slide;
}

// ── SITE DIVIDER SLIDE (for all-sites combined deck) ─────────────
function slideSiteDivider(pptx, siteName, monthLabel) {
  const slide = pptx.addSlide();
  slide.addShape('rect', { x: 0, y: 0, w: 10, h: 7.5, fill: { color: C.blue } });
  slide.addShape('rect', { x: 0, y: 3.5, w: 10, h: 0.08, fill: { color: C.orange } });
  slide.addText('ENDEAVOUR MINING', {
    x: 1, y: 1.2, w: 8, h: 0.5,
    fontSize: 14, bold: true, color: C.orange, fontFace: 'Calibri', align: 'center', charSpacing: 4
  });
  slide.addText('IT Department', {
    x: 1, y: 1.75, w: 8, h: 0.35,
    fontSize: 11, color: 'CCCCCC', fontFace: 'Calibri', align: 'center'
  });
  slide.addText(siteName, {
    x: 1, y: 2.65, w: 8, h: 0.8,
    fontSize: 30, bold: true, color: C.white, fontFace: 'Calibri', align: 'center'
  });
  slide.addText(monthLabel, {
    x: 1, y: 3.6, w: 8, h: 0.45,
    fontSize: 16, color: C.orange, fontFace: 'Calibri', align: 'center'
  });
}

// ══════════════════════════════════════════════════════════════════
// ── PUBLIC API ────────────────────────────────────────────────────
// ══════════════════════════════════════════════════════════════════

/**
 * Generate a 7-slide monthly PPTX for a single site.
 * @param {object}   monthlyData  — from rdb.getMonthlyData()
 * @param {string}   siteName
 * @param {number}   year
 * @param {number}   month        — 1-indexed
 * @param {object}   edits        — from rdb.getMonthlyEdits()
 * @param {Array}    objectives   — from rdb.getAnnualObjectives()
 * @returns {Buffer}
 */
async function generateMonthlyPptxV2(monthlyData, siteName, year, month, edits, objectives, yearlyData, openChanges, activeIncidents) {
  const pptx       = new PptxGenJS();
  pptx.layout      = 'LAYOUT_WIDE';
  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' });
  pptx.title       = `Monthly IT Report — ${siteName} — ${monthLabel}`;

  const { reports }     = monthlyData;
  const lastReport      = reports && reports.length ? reports[reports.length - 1] : null;
  const prevReport      = reports && reports.length >= 2 ? reports[reports.length - 2] : null;
  const editedLights    = edits ? (edits.edited_lights  || []) : [];
  const editedActions   = edits ? (edits.edited_actions || []) : [];

  slideCover(pptx, siteName, monthLabel, reports ? reports.length : 0);
  slideMonthlyLastWeekInfra(pptx, lastReport, monthLabel, prevReport);
  slideMonthlyInfraTrend(pptx, yearlyData || [], siteName, monthLabel, month);
  slideMonthlyHelpdesk(pptx, monthlyData, siteName, monthLabel);
  slideMonthlyLightsV2(pptx, editedLights, monthLabel, openChanges || []);
  slideMonthlyActiveIncidents(pptx, monthLabel, activeIncidents || [], siteName);
  slideMonthlyActionsV2(pptx, editedActions, monthLabel);
  slideAnnualObjectives(pptx, objectives, siteName, year);

  return fixComboChartAxes(await pptx.write({ outputType: 'nodebuffer' }));
}

/**
 * Generate a combined deck for all sites in one PPTX.
 * allSiteData: [{ site, monthlyData, edits, objectives }, ...]
 */
async function generateAllSitesMonthlyPptx(allSiteData, year, month) {
  const pptx       = new PptxGenJS();
  pptx.layout      = 'LAYOUT_WIDE';
  const monthLabel = new Date(year, month - 1, 1).toLocaleString('en', { month: 'long', year: 'numeric' });
  pptx.title       = `Monthly IT Report — All Sites — ${monthLabel}`;

  // Master cover
  slideCover(pptx, 'All Sites', monthLabel, allSiteData.length);

  for (const { site, monthlyData, edits, objectives, yearlyData, openChanges, activeIncidents } of allSiteData) {
    const { reports } = monthlyData;
    const lastReport  = reports && reports.length ? reports[reports.length - 1] : null;
    const prevReport  = reports && reports.length >= 2 ? reports[reports.length - 2] : null;
    const editedLights    = edits ? (edits.edited_lights  || []) : [];
    const editedActions   = edits ? (edits.edited_actions || []) : [];

    slideSiteDivider(pptx, site.name, monthLabel);
    slideMonthlyLastWeekInfra(pptx, lastReport, monthLabel, prevReport);
    slideMonthlyInfraTrend(pptx, yearlyData || [], site.name, monthLabel, month);
    slideMonthlyHelpdesk(pptx, monthlyData, site.name, monthLabel);
    slideMonthlyLightsV2(pptx, editedLights, monthLabel, openChanges || []);
    slideMonthlyActiveIncidents(pptx, monthLabel, activeIncidents || [], site.name);
    slideMonthlyActionsV2(pptx, editedActions, monthLabel);
    slideAnnualObjectives(pptx, objectives, site.name, year);
  }

  return fixComboChartAxes(await pptx.write({ outputType: 'nodebuffer' }));
}

module.exports = { generateMonthlyPptxV2, generateAllSitesMonthlyPptx };
