/**
 * generate-site-monthly-pptx.js
 * Endeavour Mining — Mine-Site Monthly IT Report (19-slide template)
 *
 * Matches the visual style of Monthly_Mine_Site_IT_Template.pptx.
 * Auto-fills all data-driven slides from dashboard data; leaves
 * structured placeholders for manual sections.
 *
 * Export:  generateSiteMonthlyPptx(monthlyData, site, year, month)
 *          Returns a Buffer containing the PPTX file.
 *
 * monthlyData shape (from getMonthlyData()):
 *   { weeks, reports, calendar_hd, prev_calendar_hd, history6m,
 *     monthly_top10, pastMonths }
 *
 * calendar_hd shape:
 *   { inbound, closed, close_pct, sla_res_pct, sla_reply_pct,
 *     avg_tta_h, avg_first_reply_h, avg_resolution_d }
 */

'use strict';
const pptxgen = require('pptxgenjs');

// ─── Color palette (matches uploaded template) ─────────────────────────────
const C = {
  navy:      '163560',   // dark header background
  navyMid:   '1E4D8C',   // medium blue for section headers
  blue:      '2D6CB3',   // large KPI box blue
  orange:    'F5821F',   // accent orange (stripe + highlights)
  green:     '27AE60',   // KPI box green
  red:       'E74C3C',   // danger / high priority
  amber:     'E87722',   // warning / medium
  yellow:    'F5A623',   // yellow KPI box
  white:     'FFFFFF',
  offWhite:  'F8F9FA',
  lightBlue: 'EBF2FC',
  rowAlt:    'F0F5FF',   // alternating table row
  midGrey:   '6B7280',
  lightGrey: 'E5E7EB',
  darkGrey:  '374151',
  teal:      '0D9488',
};

// Canvas
const W  = 13.33;
const H  = 7.50;
const ML = 0.30;
const MR = 0.30;
const CW = W - ML - MR;   // 12.73"
const HDR_H = 0.52;
const FTR_H = 0.22;
const FTR_Y = H - FTR_H;  // 7.28
const CY    = HDR_H + 0.06 + 0.12;  // content start Y ≈ 0.70

// Shadow factory (fresh per call — pptxgenjs mutates in place)
const S = () => ({ type:'outer', color:'000000', blur:4, offset:2, angle:135, opacity:0.08 });

// Month names
const MONTHS = ['January','February','March','April','May','June',
                'July','August','September','October','November','December'];

// ─── Shared chrome helpers ──────────────────────────────────────────────────

/** Dark navy header bar + orange accent line + footer */
function addChrome(slide, title, periodLabel, slideNum) {
  // Header
  slide.addShape('rect', { x:0, y:0, w:W, h:HDR_H, fill:{ color:C.navy }, line:{ color:C.navy, pt:0 } });
  // Orange accent stripe below header
  slide.addShape('rect', { x:0, y:HDR_H, w:W, h:0.06, fill:{ color:C.orange }, line:{ color:C.orange, pt:0 } });
  // Title text
  slide.addText(title.toUpperCase(), {
    x:ML, y:0, w:9.5, h:HDR_H,
    fontSize:14, bold:true, color:C.white, fontFace:'Calibri', valign:'middle', charSpacing:1,
  });
  // Period label top-right
  if (periodLabel) {
    slide.addText(periodLabel, {
      x:9.8, y:0, w:3.23, h:HDR_H,
      fontSize:9, color:C.orange, fontFace:'Calibri', valign:'middle', align:'right',
    });
  }
  // Footer
  slide.addShape('rect', { x:0, y:FTR_Y, w:W, h:FTR_H, fill:{ color:'F1F5F9' }, line:{ color:C.lightGrey, pt:0.5 } });
  // Orange bottom stripe
  slide.addShape('rect', { x:0, y:H-0.05, w:W, h:0.05, fill:{ color:C.orange }, line:{ color:C.orange, pt:0 } });
  slide.addText('Endeavour Mining  |  Group IT Operations  |  Confidential', {
    x:ML, y:FTR_Y, w:10, h:FTR_H,
    fontSize:6.5, color:C.midGrey, fontFace:'Calibri', valign:'middle',
  });
  if (slideNum) {
    slide.addText(String(slideNum), {
      x:W-0.5, y:FTR_Y, w:0.30, h:FTR_H,
      fontSize:6.5, color:C.midGrey, fontFace:'Calibri', valign:'middle', align:'right',
    });
  }
}

/** Section sub-header (blue bar with white text) */
function subHeader(slide, x, y, w, h, text) {
  slide.addShape('rect', { x, y, w, h, fill:{ color:C.navyMid }, line:{ color:C.navyMid, pt:0 } });
  slide.addText(text.toUpperCase(), {
    x:x+0.10, y, w:w-0.15, h,
    fontSize:8.5, bold:true, color:C.white, fontFace:'Calibri', valign:'middle',
  });
}

/** Large coloured KPI block (like the template's big boxes) */
function bigKpi(slide, x, y, w, h, label, value, color) {
  slide.addShape('rect', { x, y, w, h, fill:{ color }, line:{ color, pt:0 } });
  slide.addText(value, {
    x:x+0.05, y, w:w-0.10, h:h*0.62,
    fontSize:28, bold:true, color:C.white, fontFace:'Calibri', align:'center', valign:'bottom',
  });
  slide.addText(label, {
    x:x+0.05, y:y+h*0.62, w:w-0.10, h:h*0.38,
    fontSize:8, color:C.white, fontFace:'Calibri', align:'center', valign:'middle',
  });
}

/** Small white metric card (smaller KPI row) */
function smallKpi(slide, x, y, w, h, label, value) {
  slide.addShape('rect', { x, y, w, h, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 }, shadow:S() });
  slide.addText(value, {
    x:x+0.05, y, w:w-0.10, h:h*0.60,
    fontSize:18, bold:true, color:C.navy, fontFace:'Calibri', align:'center', valign:'bottom',
  });
  slide.addText(label, {
    x:x+0.05, y:y+h*0.60, w:w-0.10, h:h*0.40,
    fontSize:7, color:C.midGrey, fontFace:'Calibri', align:'center', valign:'middle',
  });
}

/** Placeholder box (dashed outline + italic text) */
function placeholder(slide, x, y, w, h, text) {
  slide.addShape('rect', {
    x, y, w, h,
    fill:{ color:'FAFAFA' },
    line:{ color:'CCCCCC', pt:0.75, dashType:'dash' },
  });
  slide.addText(text, {
    x:x+0.1, y, w:w-0.2, h,
    fontSize:8, color:'AAAAAA', fontFace:'Calibri', italic:true, valign:'middle', align:'center', wrap:true,
  });
}

/** Table header row */
function tblHead(cols) {
  return cols.map(c => ({
    text: c,
    options: { bold:true, color:C.white, fill:{ color:C.navy }, fontSize:8, valign:'middle' },
  }));
}

/** Table data row */
function tblRow(cells, isAlt) {
  const bg = isAlt ? C.rowAlt : C.white;
  return cells.map((c, i) => {
    if (typeof c === 'object' && c !== null) {
      return { text:c.text, options:{ fontSize:8, color:c.color||C.darkGrey, bold:!!c.bold, fill:{ color:bg }, valign:'middle', ...c.opts } };
    }
    return { text:String(c??''), options:{ fontSize:8, color:C.darkGrey, fill:{ color:bg }, valign:'middle' } };
  });
}

/** RAG badge string */
function ragStr(v) {
  if (v == null) return '—';
  if (v >= 90) return 'G';
  if (v >= 75) return 'A';
  return 'R';
}
function ragColor(v) {
  if (v == null) return C.midGrey;
  if (v >= 90) return C.green;
  if (v >= 75) return C.amber;
  return C.red;
}

/** Format number safely */
function fmt(v, suffix='') {
  if (v == null || v === undefined) return '—';
  return String(v) + suffix;
}

// ─── SLIDE 1 — Cover ───────────────────────────────────────────────────────
function slideCover(pptx, siteName, period) {
  const slide = pptx.addSlide();
  slide.background = { color: C.navy };

  // Decorative geometry (matching template's angular panels)
  slide.addShape('rect', { x:6.5, y:0, w:6.83, h:H, fill:{ color:'1E4D8C' }, line:{ color:'1E4D8C', pt:0 } });
  slide.addShape('rect', { x:8.5, y:2.5, w:4.83, h:5.0, fill:{ color:'2D6CB3' }, line:{ color:'2D6CB3', pt:0 } });

  // Orange top accent
  slide.addShape('rect', { x:0, y:0, w:W, h:0.07, fill:{ color:C.orange }, line:{ color:C.orange, pt:0 } });

  // Orange underline for site name
  slide.addShape('rect', { x:ML, y:2.10, w:2.80, h:0.06, fill:{ color:C.orange }, line:{ color:C.orange, pt:0 } });

  slide.addText('MONTHLY IT REPORT', {
    x:ML, y:1.20, w:6.0, h:0.75,
    fontSize:30, bold:true, color:C.white, fontFace:'Calibri',
  });
  slide.addText(siteName, {
    x:ML, y:2.25, w:6.0, h:0.55,
    fontSize:22, bold:true, color:C.orange, fontFace:'Calibri',
  });
  slide.addText(period, {
    x:ML, y:2.85, w:6.0, h:0.40,
    fontSize:14, color:'AACCEE', fontFace:'Calibri',
  });

  // Divider
  slide.addShape('rect', { x:ML, y:3.45, w:3.50, h:0.04, fill:{ color:'3B6EA0' }, line:{ color:'3B6EA0', pt:0 } });

  slide.addText('Endeavour Mining  -  Group IT Operations', {
    x:ML, y:3.60, w:6.0, h:0.30,
    fontSize:10, color:C.white, fontFace:'Calibri',
  });

  // Site list
  const sites = 'Abidjan  |  Dakar  |  EDV1  |  Explo  |  HGO  |  SMI  |  KGO  |  SML  |  MGO  |  SGO';
  slide.addText(sites, {
    x:ML, y:4.00, w:6.0, h:0.25,
    fontSize:7.5, color:'7799BB', fontFace:'Calibri',
  });

  // Orange bottom stripe
  slide.addShape('rect', { x:0, y:H-0.07, w:W, h:0.07, fill:{ color:C.orange }, line:{ color:C.orange, pt:0 } });

  // CONFIDENTIAL
  slide.addText('CONFIDENTIAL', {
    x:W-2.0, y:H-0.28, w:1.85, h:0.25,
    fontSize:7, color:'556677', fontFace:'Calibri', align:'right',
  });
}

// ─── SLIDE 2 — Executive Summary ───────────────────────────────────────────
function slideExecSummary(pptx, hd, prevHd, siteName, period, slideNum) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  addChrome(slide, 'Executive Summary', period, slideNum);

  const contentH = FTR_Y - 0.05 - CY;

  // ── Manager info panel (left, top) ─────────────────────────────────────────
  const mgrW = 3.80, mgrH = 0.95;
  slide.addShape('rect', { x:ML, y:CY, w:mgrW, h:mgrH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  // Photo placeholder
  slide.addShape('rect', { x:ML+0.10, y:CY+0.12, w:0.70, h:0.70, fill:{ color:C.lightGrey }, line:{ color:C.lightGrey, pt:0 } });
  slide.addText('[Photo]', { x:ML+0.10, y:CY+0.12, w:0.70, h:0.70, fontSize:7, color:C.midGrey, fontFace:'Calibri', align:'center', valign:'middle' });
  slide.addText('[Site IT Manager Name]', { x:ML+0.90, y:CY+0.14, w:mgrW-1.0, h:0.22, fontSize:9, bold:true, color:C.blue, fontFace:'Calibri' });
  slide.addText('Site IT Manager', { x:ML+0.90, y:CY+0.36, w:mgrW-1.0, h:0.18, fontSize:8, color:C.midGrey, fontFace:'Calibri' });
  slide.addText(siteName,          { x:ML+0.90, y:CY+0.54, w:mgrW-1.0, h:0.18, fontSize:8, color:C.orange, fontFace:'Calibri' });

  // ── RAG indicators (middle, top) ───────────────────────────────────────────
  const ragLabels = ['Overall','Schedule','Risk','Budget','Resource'];
  const ragX = ML + mgrW + 0.10;
  const ragW = (CW - mgrW - 0.10 - 2.80) / ragLabels.length;
  ragLabels.forEach((lbl, i) => {
    const rx = ragX + i * (ragW + 0.04);
    slide.addShape('rect', { x:rx, y:CY, w:ragW, h:mgrH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
    slide.addText(lbl, { x:rx+0.03, y:CY+0.08, w:ragW-0.06, h:0.22, fontSize:7.5, color:C.midGrey, fontFace:'Calibri', align:'center' });
    slide.addText('[RAG]', { x:rx+0.03, y:CY+0.32, w:ragW-0.06, h:0.42, fontSize:9, color:'AAAAAA', fontFace:'Calibri', align:'center', valign:'middle', italic:true });
  });

  // ── Objectives Score box (top-right) ───────────────────────────────────────
  const objX = ragX + ragLabels.length * (ragW + 0.04) + 0.10;
  const objW = ML + CW - objX;
  slide.addShape('rect', { x:objX, y:CY, w:objW, h:mgrH, fill:{ color:C.navy }, line:{ color:C.navy, pt:0 } });
  slide.addText('OBJECTIVES SCORE', { x:objX+0.05, y:CY+0.06, w:objW-0.10, h:0.22, fontSize:8, bold:true, color:C.white, fontFace:'Calibri', align:'center' });
  slide.addText('[XX%]', { x:objX+0.05, y:CY+0.28, w:objW-0.10, h:0.42, fontSize:22, bold:true, color:C.orange, fontFace:'Calibri', align:'center', valign:'middle' });
  slide.addText('[RAG Status]', { x:objX+0.05, y:CY+0.72, w:objW-0.10, h:0.20, fontSize:7.5, color:'AAAAAA', fontFace:'Calibri', align:'center', italic:true });

  // ── Goal banner ────────────────────────────────────────────────────────────
  const goalY = CY + mgrH + 0.10;
  slide.addShape('rect', { x:ML, y:goalY, w:CW, h:0.30, fill:{ color:C.navyMid }, line:{ color:C.navyMid, pt:0 } });
  slide.addText('GOAL:  [Enter the monthly goal / focus statement for this reporting period]', {
    x:ML+0.12, y:goalY, w:CW-0.20, h:0.30,
    fontSize:8.5, color:C.white, fontFace:'Calibri', italic:true, valign:'middle',
  });

  // ── Three-column content panels ─────────────────────────────────────────────
  const col3Y  = goalY + 0.38;
  const col3H  = FTR_Y - 0.08 - col3Y;
  const col3W  = (CW - 0.16) / 3;
  const cols   = [
    { title:'Key Highlights / Progress Since Last Period', items: _buildHighlights(hd, prevHd) },
    { title:'Issues / Risks / Comments',                  items: ['[Issue/Risk item 1]','[Issue/Risk item 2]','[Issue/Risk item 3]','[Issue/Risk item 4]','[Issue/Risk item 5]'] },
    { title:'Activities for Next Period',                  items: ['[Next period activity 1]','[Next period activity 2]','[Next period activity 3]','[Next period activity 4]','[Next period activity 5]'] },
  ];
  cols.forEach((col, i) => {
    const cx = ML + i * (col3W + 0.08);
    slide.addShape('rect', { x:cx, y:col3Y, w:col3W, h:col3H, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
    subHeader(slide, cx, col3Y, col3W, 0.28, col.title);
    col.items.forEach((item, j) => {
      slide.addText(`${j+1}.  ${item}`, {
        x:cx+0.12, y:col3Y+0.32+j*0.30, w:col3W-0.18, h:0.28,
        fontSize:8, color:C.darkGrey, fontFace:'Calibri', valign:'middle',
      });
    });
  });
}

function _buildHighlights(hd, prevHd) {
  const items = [];
  if (hd) {
    items.push(`${fmt(hd.inbound)} tickets received — ${fmt(hd.close_pct,'%')} resolution rate`);
    items.push(`Resolution SLA: ${fmt(hd.sla_res_pct,'%')}${prevHd?.sla_res_pct ? ` (prev: ${prevHd.sla_res_pct}%)` : ''}`);
    items.push(`First Reply SLA: ${fmt(hd.sla_reply_pct,'%')}`);
    if (hd.avg_resolution_d != null) items.push(`Avg resolution time: ${hd.avg_resolution_d} day(s)`);
  }
  while (items.length < 5) items.push('[Highlight item]');
  return items.slice(0, 5);
}

// ─── SLIDE 3 — Helpdesk Performance Dashboard ──────────────────────────────
function slideHelpdeskDashboard(pptx, hd, history6m, lastAgeing, lastTop10, period, slideNum) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  addChrome(slide, 'Helpdesk Performance Dashboard', period, slideNum);

  const bW  = (CW - 0.18) / 4;  // big KPI box width
  const bH  = 1.05;
  const bY  = CY + 0.05;

  // ── Row 1: 4 big coloured KPI boxes ────────────────────────────────────────
  const bigKpis = [
    { label:'Total Tickets',    value: fmt(hd?.inbound),          color: C.blue   },
    { label:'Closed Tickets',   value: fmt(hd?.closed),           color: C.green  },
    { label:'SLA Compliance',   value: fmt(hd?.sla_res_pct,'%'),  color: C.navyMid},
    { label:'Open Backlog',     value: fmt(hd ? hd.inbound - hd.closed : null), color: C.amber  },
  ];
  bigKpis.forEach((k, i) => bigKpi(slide, ML + i*(bW+0.06), bY, bW, bH, k.label, k.value, k.color));

  // ── Row 2: 4 smaller white metric cards ────────────────────────────────────
  const smH = 0.72, smY = bY + bH + 0.10;
  const smKpis = [
    { label:'CSAT Score (1-5)', value: '[#.#]' },
    { label:'NPS Score',        value: fmt(hd ? null : null) || '[+##]' },
    { label:'FCR Rate',         value: '[##%]' },
    { label:'Avg Resolution Time', value: hd?.avg_resolution_d != null ? `${hd.avg_resolution_d} days` : '[# days]' },
  ];
  const smW = (CW - 0.18) / 4;
  smKpis.forEach((k, i) => smallKpi(slide, ML + i*(smW+0.06), smY, smW, smH, k.label, k.value));

  // ── Bottom section: Trend chart (left) + Key Messages (right) ───────────────
  const botY  = smY + smH + 0.12;
  const botH  = FTR_Y - 0.06 - botY;
  const chartW = CW * 0.68;
  const msgX   = ML + chartW + 0.15;
  const msgW   = CW - chartW - 0.15;

  // Chart — 6-month trend (combo: bars + two SLA lines)
  if (history6m && history6m.length) {
    const labels   = history6m.map(r => r.label);
    const inbound  = history6m.map(r => r.inbound  ?? 0);
    const closed   = history6m.map(r => r.closed   ?? 0);
    const slaRes   = history6m.map(r => r.res_sla_pct   ?? null);
    const slaReply = history6m.map(r => r.reply_sla_pct ?? null);

    slide.addChart(
      [
        {
          type: pptx.charts.BAR,
          data: [
            { name:'Tickets Received', labels, values: inbound },
            { name:'Tickets Closed',   labels, values: closed  },
          ],
          options: {
            chartColors: [C.blue, C.green],
            barDir: 'col', barGrouping: 'clustered',
            showValue: true, dataLabelColor:'FFFFFF', dataLabelFontSize:7, dataLabelFontBold:true, dataLabelPosition:'inEnd',
          },
        },
        {
          type: pptx.charts.LINE,
          data: [{ name:'Resolution SLA %', labels, values: slaRes }],
          options: {
            chartColors: [C.orange], secondaryValAxis:true,
            lineSize:2.5, lineDataSymbol:'circle', lineDataSymbolSize:5,
            showValue:true, dataLabelColor:C.orange, dataLabelFontSize:7, dataLabelFontBold:true, dataLabelPosition:'b', dataLabelFormatCode:'0"%"',
          },
        },
        {
          type: pptx.charts.LINE,
          data: [{ name:'First Reply SLA %', labels, values: slaReply }],
          options: {
            chartColors: [C.red], secondaryValAxis:true,
            lineSize:2.5, lineDataSymbol:'square', lineDataSymbolSize:5,
            showValue:true, dataLabelColor:C.red, dataLabelFontSize:7, dataLabelFontBold:true, dataLabelPosition:'t', dataLabelFormatCode:'0"%"',
          },
        },
      ],
      {
        x:ML, y:botY, w:chartW, h:botH,
        valAxisMaxVal: Math.max(...inbound, 1) * 1.22, valAxisMinVal:0,
        secondaryValAxis:true, secondaryValGridLine:{ style:'none' },
        val2AxisMaxVal:100, val2AxisMinVal:70,
        valGridLine:{ color:'E2E8F0', size:0.5 }, catGridLine:{ style:'none' },
        catAxisLabelColor:C.midGrey, catAxisLabelFontSize:8,
        valAxisLabelColor:C.midGrey, valAxisLabelFontSize:8,
        chartArea:{ fill:{ color:C.white }, border:{ pt:0.5, color:C.lightGrey } },
        plotArea: { fill:{ color:C.white } },
        showLegend:true, legendPos:'b', legendFontSize:8, legendColor:C.midGrey,
      }
    );
  } else {
    placeholder(slide, ML, botY, chartW, botH,
      '[Insert Helpdesk Trend Chart]\nTickets Created vs Resolved – Monthly Trend\n(Paste chart from helpdesk system here)');
  }

  // Key Messages panel
  slide.addShape('rect', { x:msgX, y:botY, w:msgW, h:botH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, msgX, botY, msgW, 0.28, 'Key Messages');
  const msgs = ['[Message 1 — key observation or trend]','[Message 2 — action or improvement]','[Message 3 — escalation or note]'];
  msgs.forEach((m, i) => {
    slide.addText(`-  ${m}`, {
      x:msgX+0.12, y:botY+0.35+i*0.45, w:msgW-0.18, h:0.40,
      fontSize:8, color:C.darkGrey, fontFace:'Calibri', valign:'middle', wrap:true,
    });
  });
}

// ─── SLIDE 4 — Ticket Distribution ─────────────────────────────────────────
function slideTicketDistribution(pptx, byCategory, period, slideNum) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  addChrome(slide, 'Helpdesk - Ticket Distribution', period, slideNum);

  const half = (CW - 0.20) / 2;
  const tblY = CY + 0.05;

  // ── Left: Category table ────────────────────────────────────────────────────
  slide.addShape('rect', { x:ML, y:tblY, w:half, h:2.30, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, ML, tblY, half, 0.28, 'Tickets by Category');
  const catHeader = tblHead(['Category','Count','% of Total','Trend vs Last Month']);
  const catColW   = [half*0.40, half*0.18, half*0.18, half*0.24];
  const catRows   = byCategory && byCategory.length
    ? byCategory.map((r, i) => tblRow([r.label, r.value, r.pct != null ? r.pct+'%' : '—', r.trend||'[up/down]'], i%2===1))
    : [
        tblRow(['Hardware',            '[#]','[%]','[up/down]'],false),
        tblRow(['Software / Application','[#]','[%]','[up/down]'],true),
        tblRow(['Network / Connectivity','[#]','[%]','[up/down]'],false),
        tblRow(['Access / Permissions','[#]','[%]','[up/down]'],true),
        tblRow(['Email / Communication','[#]','[%]','[up/down]'],false),
        tblRow(['Other',               '[#]','[%]','[up/down]'],true),
      ];
  slide.addTable([catHeader, ...catRows], {
    x:ML, y:tblY+0.28, w:half, h:2.30-0.28,
    colW:catColW, rowH:0.30,
    border:{ pt:0.5, color:C.lightGrey }, fontFace:'Calibri',
  });

  // ── Right: Submission Channel table ────────────────────────────────────────
  const rightX = ML + half + 0.20;
  slide.addShape('rect', { x:rightX, y:tblY, w:half, h:2.30, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, rightX, tblY, half, 0.28, 'Tickets by Submission Channel');
  const chanHeader = tblHead(['Channel','Count','% of Total']);
  const chanColW   = [half*0.55, half*0.22, half*0.23];
  const chanRows   = [
    tblRow(['Portal / Self-Service','[#]','[%]'], false),
    tblRow(['Email',                '[#]','[%]'], true),
    tblRow(['Phone',                '[#]','[%]'], false),
    tblRow(['Walk-In',              '[#]','[%]'], true),
    tblRow(['Teams / Chat',         '[#]','[%]'], false),
  ];
  slide.addTable([chanHeader, ...chanRows], {
    x:rightX, y:tblY+0.28, w:half, h:2.30-0.28,
    colW:chanColW, rowH:0.35,
    border:{ pt:0.5, color:C.lightGrey }, fontFace:'Calibri',
  });

  // ── Month-on-Month comparison notes ────────────────────────────────────────
  const obsY = tblY + 2.40;
  const obsH = FTR_Y - 0.08 - obsY;
  slide.addShape('rect', { x:ML, y:obsY, w:CW, h:obsH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, ML, obsY, CW, 0.28, 'Month-on-Month Comparison & Notes');
  const obsPoints = [
    'Key Observations:',
    '1.  [Compare ticket volume vs previous month — note any significant changes]',
    '2.  [Identify any emerging patterns or recurring issue categories]',
    '3.  [Note any seasonal or operational factors affecting ticket volume]',
    '4.  [Highlight any category requiring targeted improvement actions]',
  ];
  obsPoints.forEach((p, i) => {
    slide.addText(p, {
      x:ML+0.15, y:obsY+0.32+i*0.26, w:CW-0.25, h:0.24,
      fontSize:8, color: i===0 ? C.darkGrey : C.midGrey, bold:i===0, fontFace:'Calibri',
    });
  });
}

// ─── SLIDE 5 — SLA & Ageing ─────────────────────────────────────────────────
function slideSlaAgeing(pptx, ageingByGroup, top10, period, slideNum) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  addChrome(slide, 'Helpdesk - SLA & Ageing Analysis', period, slideNum);

  const half = (CW - 0.20) / 2;
  const topY = CY + 0.05;
  const topH = 2.20;

  // ── Left: Ageing by group table ────────────────────────────────────────────
  slide.addShape('rect', { x:ML, y:topY, w:half, h:topH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, ML, topY, half, 0.28, 'Ageing Backlog by Group');
  const agHead = tblHead(['Assignment Group','0-7 Days','8-14 Days','15-30 Days','>30 Days']);
  const agColW = [half*0.38, half*0.15, half*0.17, half*0.15, half*0.15];
  const agRows = ageingByGroup && ageingByGroup.length
    ? ageingByGroup.map((r, i) => tblRow([r.group, r.lt24??r.d07??'—', r.d13??r.d814??'—', r.d37??r.d1530??'—', r.gt14??r.gt30??'—'], i%2===1))
    : [
        tblRow(['Service Desk L1','[#]','[#]','[#]','[#]'],false),
        tblRow(['Desktop Support L2','[#]','[#]','[#]','[#]'],true),
        tblRow(['Network Team','[#]','[#]','[#]','[#]'],false),
        tblRow(['Server / Systems','[#]','[#]','[#]','[#]'],true),
        tblRow(['Applications','[#]','[#]','[#]','[#]'],false),
        tblRow([{text:'Total',bold:true},'[#]','[#]','[#]','[#]'],true),
      ];
  slide.addTable([agHead, ...agRows], {
    x:ML, y:topY+0.28, w:half, h:topH-0.28,
    colW:agColW, rowH:0.30,
    border:{ pt:0.5, color:C.lightGrey }, fontFace:'Calibri',
  });

  // ── Right: SLA Violations table ────────────────────────────────────────────
  const rightX = ML + half + 0.20;
  slide.addShape('rect', { x:rightX, y:topY, w:half, h:topH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, rightX, topY, half, 0.28, 'SLA Violations Analysis');
  const slaVHead = tblHead(['Priority','SLA Target','Breached','At Risk']);
  const slaVColW = [half*0.30, half*0.25, half*0.22, half*0.23];
  const vRows = top10 && top10.length
    ? top10.slice(0,5).map((r, i) => tblRow([r.category, r.target||'—', {text:String(r.count||0), color:r.count>0?C.red:C.green, bold:true}, '—'], i%2===1))
    : [
        tblRow(['P1 - Critical','[# hrs]','[#]','[#]'],false),
        tblRow(['P2 - High',    '[# hrs]','[#]','[#]'],true),
        tblRow(['P3 - Medium',  '[# hrs]','[#]','[#]'],false),
        tblRow(['P4 - Low',     '[# hrs]','[#]','[#]'],true),
        tblRow([{text:'Total',bold:true},'[# hrs]','[#]','[#]'],false),
      ];
  slide.addTable([slaVHead, ...vRows], {
    x:rightX, y:topY+0.28, w:half, h:topH-0.28,
    colW:slaVColW, rowH:0.35,
    border:{ pt:0.5, color:C.lightGrey }, fontFace:'Calibri',
  });

  // ── Bottom half: Critical ageing + blocked tickets ─────────────────────────
  const botY = topY + topH + 0.12;
  const botH = FTR_Y - 0.08 - botY;

  slide.addShape('rect', { x:ML, y:botY, w:half, h:botH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, ML, botY, half, 0.28, 'Critical Ageing Highlights (>30 Days)');
  slide.addText('Ticket #  |  Description  |  Age  |  Owner  |  Action', {
    x:ML+0.12, y:botY+0.34, w:half-0.18, h:0.22,
    fontSize:7.5, color:C.midGrey, fontFace:'Calibri', italic:true,
  });
  [1,2,3,4,5].forEach((n,i) => {
    slide.addText(`${n}.  [Ticket details]`, {
      x:ML+0.12, y:botY+0.60+i*0.30, w:half-0.18, h:0.26,
      fontSize:8, color:C.darkGrey, fontFace:'Calibri',
    });
  });

  slide.addShape('rect', { x:rightX, y:botY, w:half, h:botH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, rightX, botY, half, 0.28, 'Blocked Tickets & Reasons');
  slide.addText('Ticket #  |  Blocked Reason  |  Waiting On  |  Days Blocked', {
    x:rightX+0.12, y:botY+0.34, w:half-0.18, h:0.22,
    fontSize:7.5, color:C.midGrey, fontFace:'Calibri', italic:true,
  });
  [1,2,3,4,5].forEach((n,i) => {
    slide.addText(`${n}.  [Ticket details]`, {
      x:rightX+0.12, y:botY+0.60+i*0.30, w:half-0.18, h:0.26,
      fontSize:8, color:C.darkGrey, fontFace:'Calibri',
    });
  });
}

// ─── SLIDE 6 — Customer Satisfaction ───────────────────────────────────────
function slideCSAT(pptx, hd, period, slideNum) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  addChrome(slide, 'Customer Satisfaction', period, slideNum);

  const topY = CY + 0.05;
  const topH = 2.30;
  const thirdW = (CW - 0.16) / 3;

  // ── CSAT circle ────────────────────────────────────────────────────────────
  const cX = ML;
  slide.addShape('rect', { x:cX, y:topY, w:thirdW, h:topH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, cX, topY, thirdW, 0.28, 'CSAT Score');
  const circleR = 0.65;
  const circleCX = cX + thirdW/2;
  const circleCY = topY + 0.28 + (topH-0.28)/2;
  slide.addShape('ellipse', {
    x:circleCX-circleR, y:circleCY-circleR, w:circleR*2, h:circleR*2,
    fill:{ color:C.blue }, line:{ color:C.blue, pt:0 },
  });
  slide.addText('[#.#]', {
    x:circleCX-circleR, y:circleCY-0.40, w:circleR*2, h:0.55,
    fontSize:24, bold:true, color:C.white, fontFace:'Calibri', align:'center', valign:'middle',
  });
  slide.addText('/ 5.0', {
    x:circleCX-circleR, y:circleCY+0.10, w:circleR*2, h:0.28,
    fontSize:10, color:C.white, fontFace:'Calibri', align:'center',
  });
  slide.addText('Target: 4.0  |  Previous: [#.#]', {
    x:cX+0.08, y:topY+topH-0.32, w:thirdW-0.12, h:0.28,
    fontSize:7, color:C.midGrey, fontFace:'Calibri', align:'center',
  });

  // ── NPS circle ─────────────────────────────────────────────────────────────
  const nX = ML + thirdW + 0.08;
  slide.addShape('rect', { x:nX, y:topY, w:thirdW, h:topH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, nX, topY, thirdW, 0.28, 'Net Promoter Score');
  const nCircleCX = nX + thirdW/2;
  slide.addShape('ellipse', {
    x:nCircleCX-circleR, y:circleCY-circleR, w:circleR*2, h:circleR*2,
    fill:{ color:C.green }, line:{ color:C.green, pt:0 },
  });
  slide.addText('[+##]', {
    x:nCircleCX-circleR, y:circleCY-0.35, w:circleR*2, h:0.50,
    fontSize:24, bold:true, color:C.white, fontFace:'Calibri', align:'center', valign:'middle',
  });
  slide.addText('/ 100', {
    x:nCircleCX-circleR, y:circleCY+0.12, w:circleR*2, h:0.25,
    fontSize:10, color:C.white, fontFace:'Calibri', align:'center',
  });
  slide.addText('Target: +30  |  Previous: [+##]', {
    x:nX+0.08, y:topY+topH-0.32, w:thirdW-0.12, h:0.28,
    fontSize:7, color:C.midGrey, fontFace:'Calibri', align:'center',
  });

  // ── Survey Engagement ──────────────────────────────────────────────────────
  const eX = ML + 2*(thirdW + 0.08);
  slide.addShape('rect', { x:eX, y:topY, w:thirdW, h:topH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, eX, topY, thirdW, 0.28, 'Survey Engagement');
  const engRows = ['Surveys Sent:','Responses Received:','Response Rate:','Avg Feedback Score:'];
  const engVals = ['[###]','[###]','[##%]','[#.#]'];
  engRows.forEach((r, i) => {
    slide.addText(r, { x:eX+0.12, y:topY+0.38+i*0.40, w:thirdW*0.62, h:0.32, fontSize:8, color:C.darkGrey, fontFace:'Calibri', valign:'middle' });
    slide.addText(engVals[i], { x:eX+thirdW*0.62, y:topY+0.38+i*0.40, w:thirdW*0.35, h:0.32, fontSize:12, bold:true, color:C.navy, fontFace:'Calibri', align:'right', valign:'middle' });
  });

  // ── Pain Points table ───────────────────────────────────────────────────────
  const ppY = topY + topH + 0.12;
  const ppH = FTR_Y - 0.08 - ppY;
  slide.addShape('rect', { x:ML, y:ppY, w:CW, h:ppH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, ML, ppY, CW, 0.28, 'Top Pain Points & Improvement Actions');
  const ppHead = tblHead(['#','Pain Point','Frequency','Impact','Improvement Action','Owner','Status']);
  const ppColW = [0.30, CW*0.28, CW*0.09, CW*0.09, CW*0.28, CW*0.13, CW*0.09];
  const ppRows = [1,2,3,4,5].map((n,i) => tblRow([n,'[Pain point description]','[H/M/L]','[H/M/L]','[Action to address]','[Name]','[RAG]'], i%2===1));
  slide.addTable([ppHead, ...ppRows], {
    x:ML, y:ppY+0.28, w:CW, h:ppH-0.28,
    colW:ppColW, rowH:0.32,
    border:{ pt:0.5, color:C.lightGrey }, fontFace:'Calibri',
  });
}

// ─── SLIDE 7 — Change Management & Incidents ───────────────────────────────
function slideChanges(pptx, changes, incidents, period, slideNum) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  addChrome(slide, 'Change Management & Incidents', period, slideNum);

  const topY = CY + 0.05;

  // ── Change Portfolio — 6 coloured count badges ─────────────────────────────
  subHeader(slide, ML, topY, CW, 0.28, 'Change Portfolio');
  const chgTypes = [
    { label:'Total Changes', color:C.blue   },
    { label:'Emergency',     color:C.red    },
    { label:'Normal',        color:C.navyMid},
    { label:'Standard',      color:'3B82F6' },
    { label:'Successful',    color:C.green  },
    { label:'Failed',        color:C.amber  },
  ];
  const totalCh = changes?.length || 0;
  const emerCh  = changes?.filter(c => (c.type||c.risk||'').toLowerCase().includes('emerg')).length || 0;
  const succCh  = changes?.filter(c => (c.status||'').toLowerCase().includes('complet')).length || totalCh;
  const failCh  = changes?.filter(c => (c.status||'').toLowerCase().includes('fail')).length || 0;
  const chgVals = [totalCh, emerCh, Math.max(0,totalCh-emerCh), 0, succCh, failCh].map(v => String(v));
  const bW6 = (CW - 0.25) / 6;
  const bY6 = topY + 0.34;
  const bH6 = 0.88;
  chgTypes.forEach((t, i) => {
    bigKpi(slide, ML + i*(bW6+0.05), bY6, bW6, bH6, t.label, chgVals[i], t.color);
  });

  // ── Change Summary table ────────────────────────────────────────────────────
  const chgTblY = bY6 + bH6 + 0.12;
  const chgTblH = 1.20;
  slide.addShape('rect', { x:ML, y:chgTblY, w:CW, h:chgTblH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, ML, chgTblY, CW, 0.28, 'Change Summary Details');
  const chgHead = tblHead(['Change #','Type','Description','Status','Impact']);
  const chgColW = [1.20, 1.00, CW-1.20-1.00-1.30-1.20, 1.30, 1.20];
  const chgRows = changes && changes.length
    ? changes.slice(0,4).map((c, i) => tblRow([
        c.id||`[CHG${String(i+1).padStart(4,'0')}]`,
        c.type||c.risk||'[Type]',
        c.desc||'[Change description]',
        { text:c.status||'[Status]', color:c.status?.toLowerCase().includes('complet') ? C.green : C.amber, bold:true },
        c.impact||'[H/M/L]',
      ], i%2===1))
    : [1,2,3].map((n,i) => tblRow([`[CHG${String(n).padStart(4,'0')}]`,'[Type]','[Change description]','[Status]','[H/M/L]'], i%2===1));
  slide.addTable([chgHead, ...chgRows], {
    x:ML, y:chgTblY+0.28, w:CW, h:chgTblH-0.28,
    colW:chgColW, rowH:0.30,
    border:{ pt:0.5, color:C.lightGrey }, fontFace:'Calibri',
  });

  // ── Major Incidents + Lessons Learned ──────────────────────────────────────
  const incY  = chgTblY + chgTblH + 0.12;
  const incH  = FTR_Y - 0.08 - incY;
  const incW  = CW * 0.55;
  const llX   = ML + incW + 0.15;
  const llW   = CW - incW - 0.15;

  subHeader(slide, ML, incY, incW, 0.28, 'Major Incidents');
  const p1 = incidents?.filter(i => i.priority==='P1').length || 0;
  const p2 = incidents?.filter(i => i.priority==='P2').length || 0;
  const p3 = incidents?.filter(i => i.priority==='P3').length || 0;
  const incKpis = [
    { label:'P1 Incidents', value:String(p1), color: p1>0 ? C.red    : C.green },
    { label:'P2 Incidents', value:String(p2), color: p2>0 ? C.amber  : C.green },
    { label:'P3 Incidents', value:String(p3), color: p3>0 ? C.yellow : C.green },
    { label:'Avg MTTR',     value:'[# hrs]',  color:C.navyMid },
  ];
  const iW = (incW - 0.18) / 4;
  const iH = incH - 0.06;
  incKpis.forEach((k, i) => {
    const ix = ML + i * (iW + 0.06);
    bigKpi(slide, ix, incY+0.34, iW, iH-0.28, k.label, k.value, k.color);
  });

  slide.addShape('rect', { x:llX, y:incY, w:llW, h:incH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, llX, incY, llW, 0.28, 'Lessons Learned');
  [1,2,3].forEach((n,i) => {
    slide.addText(`${n}.  [Lesson from incident/change ${n}]`, {
      x:llX+0.12, y:incY+0.35+i*0.38, w:llW-0.18, h:0.32,
      fontSize:8, color:C.darkGrey, fontFace:'Calibri',
    });
  });
}

// ─── SLIDE 8 — Infrastructure Status ────────────────────────────────────────
function slideInfra(pptx, infraKpis, period, slideNum) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  addChrome(slide, 'Infrastructure Status', period, slideNum);

  const topY = CY + 0.05;

  // ── 5 service status badges ─────────────────────────────────────────────────
  const services = [
    { label:'WAN', sub:'Internet\nConnectivity', keys:['wan'] },
    { label:'LAN', sub:'Internal\nNetwork',      keys:['lan','switch','network'] },
    { label:'SRV', sub:'Servers &\nStorage',     keys:['srv','server','storage','esxi','vm'] },
    { label:'BKP', sub:'Backup &\nDR',           keys:['bkp','backup','dr ','veeam'] },
    { label:'OT',  sub:'OT\nNetwork',            keys:['ot ','ot_','scada','operational','edr','sentinel','antivirus'] },
  ];
  const svcW = (CW - 0.20) / services.length;
  const svcH = 1.40;
  services.forEach((svc, i) => {
    const sx = ML + i * (svcW + 0.05);
    const sy = topY;
    // Find KPI for this service — match any of the keywords
    const kpi = infraKpis?.find(k => {
      const sl = (k.service || '').toLowerCase();
      return svc.keys.some(key => sl.includes(key));
    }) || null;
    // Color: map DB status_color values (green/amber/red/G/A/R) to palette
    const sc = (kpi?.status_color || '').toLowerCase();
    const color = (sc==='red'||sc==='r') ? C.red : (sc==='amber'||sc==='a'||sc==='orange') ? C.amber : C.blue;
    slide.addShape('rect', { x:sx, y:sy, w:svcW, h:svcH*0.65, fill:{ color }, line:{ color, pt:0 } });
    slide.addText(svc.label, { x:sx+0.05, y:sy+0.08, w:svcW-0.10, h:svcH*0.40, fontSize:20, bold:true, color:C.white, fontFace:'Calibri', align:'center', valign:'middle' });
    slide.addShape('rect', { x:sx, y:sy+svcH*0.65, w:svcW, h:svcH*0.35, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
    slide.addText(svc.sub, { x:sx+0.05, y:sy+svcH*0.65, w:svcW-0.10, h:svcH*0.20, fontSize:8, color:C.darkGrey, fontFace:'Calibri', align:'center', valign:'middle' });
    slide.addText(kpi?.status_value || '[RAG Status]', {
      x:sx+0.05, y:sy+svcH*0.83, w:svcW-0.10, h:svcH*0.17,
      fontSize:8, bold:!!kpi, color:kpi ? color : 'AAAAAA', fontFace:'Calibri', align:'center', italic:!kpi,
    });
  });

  // ── Bottom: Notes (left) + Projects table (right) ──────────────────────────
  const botY = topY + svcH + 0.12;
  const botH = FTR_Y - 0.08 - botY;
  const half = (CW - 0.20) / 2;

  slide.addShape('rect', { x:ML, y:botY, w:half, h:botH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, ML, botY, half, 0.28, 'Site-Specific Infrastructure Notes');
  const noteLines = [
    '[Enter detailed notes about infrastructure status, performance metrics, and any concerns]', '',
    'Internet Performance:', '- Primary link: [Provider] - [Status] - [Bandwidth utilization %]',
    '- Backup link: [Provider] - [Status] - [Bandwidth utilization %]', '',
    'Network Health:', '- [Note any switch/AP issues, coverage gaps, or performance concerns]',
  ];
  noteLines.forEach((l, i) => {
    slide.addText(l, {
      x:ML+0.12, y:botY+0.34+i*0.23, w:half-0.18, h:0.22,
      fontSize:7.5, color: l.startsWith('[') ? 'AAAAAA' : C.darkGrey, fontFace:'Calibri', italic:l.startsWith('['),
    });
  });

  const projX = ML + half + 0.20;
  slide.addShape('rect', { x:projX, y:botY, w:half, h:botH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, projX, botY, half, 0.28, 'Active Infrastructure Projects / Upgrades');
  const pHead = tblHead(['Project','Status','% Done','ETA']);
  const pColW = [half*0.44, half*0.18, half*0.18, half*0.20];
  const pRows = [1,2,3,4,5,6].map((n,i) => tblRow(['[Project name]','[RAG]','[%]','[Date]'], i%2===1));
  slide.addTable([pHead, ...pRows], {
    x:projX, y:botY+0.28, w:half, h:botH-0.28,
    colW:pColW, rowH:0.27,
    border:{ pt:0.5, color:C.lightGrey }, fontFace:'Calibri',
  });
}

// ─── SLIDES 9-12 — IT Objectives + P1-P4 ────────────────────────────────────
function slideObjectivesOverview(pptx, period, slideNum) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  addChrome(slide, 'IT Objectives Tracker - Pillar Overview', period, slideNum);

  const topY = CY + 0.05;
  // Top strip: Completion rate + Overall score + 4 Pillar scores
  slide.addShape('rect', { x:ML, y:topY, w:2.20, h:1.50, fill:{ color:C.lightBlue }, line:{ color:C.lightGrey, pt:0.75 } });
  slide.addText('COMPLETION RATE', { x:ML+0.08, y:topY+0.08, w:2.04, h:0.26, fontSize:8, bold:true, color:C.navy, fontFace:'Calibri', align:'center' });
  slide.addText('[##%]', { x:ML+0.08, y:topY+0.34, w:2.04, h:0.60, fontSize:26, bold:true, color:C.orange, fontFace:'Calibri', align:'center', valign:'middle' });
  slide.addText('of activities completed YTD', { x:ML+0.08, y:topY+0.98, w:2.04, h:0.28, fontSize:7, color:C.midGrey, fontFace:'Calibri', align:'center' });

  // Overall site score
  const oX = ML + 2.30;
  slide.addShape('rect', { x:oX, y:topY, w:2.40, h:1.50, fill:{ color:C.navy }, line:{ color:C.navy, pt:0 } });
  slide.addText('OVERALL SITE SCORE', { x:oX+0.08, y:topY+0.08, w:2.24, h:0.26, fontSize:8, bold:true, color:C.white, fontFace:'Calibri', align:'center' });
  slide.addText('[XX%]', { x:oX+0.08, y:topY+0.34, w:2.24, h:0.60, fontSize:26, bold:true, color:C.orange, fontFace:'Calibri', align:'center', valign:'middle' });
  slide.addText('[RAG Status]', { x:oX+0.08, y:topY+0.98, w:2.24, h:0.28, fontSize:7, color:'AAAAAA', fontFace:'Calibri', align:'center', italic:true });

  // 4 pillar quick scores
  const pillars = [
    { id:'P1', name:'Network Infrastructure', weight:30, color:C.blue   },
    { id:'P2', name:'Business Partnering',     weight:35, color:C.green  },
    { id:'P3', name:'Risk & Compliance',       weight:20, color:C.amber  },
    { id:'P4', name:'Manage People',           weight:15, color:C.red    },
  ];
  const pW = (CW - 4.70 - 0.16) / 4;
  pillars.forEach((p, i) => {
    const px = ML + 4.86 + i * (pW + 0.06);
    slide.addShape('rect', { x:px, y:topY, w:pW, h:1.50, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
    slide.addShape('rect', { x:px, y:topY, w:pW, h:0.05, fill:{ color:p.color }, line:{ color:p.color, pt:0 } });
    slide.addText(`${p.id}  ${p.name}`, { x:px+0.08, y:topY+0.09, w:pW-0.12, h:0.26, fontSize:8, bold:true, color:p.color, fontFace:'Calibri' });
    slide.addText(`Weight: ${p.weight}%`, { x:px+0.08, y:topY+0.34, w:pW-0.12, h:0.18, fontSize:7, color:C.midGrey, fontFace:'Calibri' });
    slide.addText('[##%]', { x:px+0.08, y:topY+0.55, w:pW-0.12, h:0.50, fontSize:22, bold:true, color:p.color, fontFace:'Calibri', align:'center', valign:'middle' });
    slide.addText('[RAG Status]', { x:px+0.08, y:topY+1.08, w:pW-0.12, h:0.28, fontSize:7, color:'AAAAAA', fontFace:'Calibri', align:'center', italic:true });
  });

  // 4 pillar mini-activity rows (placeholder)
  const actY = topY + 1.65;
  const actH = FTR_Y - 0.08 - actY;
  pillars.forEach((p, i) => {
    const px = ML + i * (CW/4 + 0.04);
    const pw = CW/4 - 0.04;
    slide.addShape('rect', { x:px, y:actY, w:pw, h:actH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
    slide.addShape('rect', { x:px, y:actY, w:pw, h:0.05, fill:{ color:p.color }, line:{ color:p.color, pt:0 } });
    slide.addText(`${p.id} — ${p.name}`, { x:px+0.08, y:actY+0.08, w:pw-0.12, h:0.22, fontSize:8, bold:true, color:p.color, fontFace:'Calibri' });
    slide.addText('[##%]', { x:px+0.08, y:actY+0.30, w:pw-0.12, h:0.45, fontSize:20, bold:true, color:p.color, fontFace:'Calibri', align:'center', valign:'middle' });
    slide.addText('[RAG Status]', { x:px+0.08, y:actY+0.75, w:pw-0.12, h:0.22, fontSize:7, color:'AAAAAA', fontFace:'Calibri', align:'center', italic:true });
    // Mini dots row
    ['[A]','[B]','[C]'].forEach((dot, j) => {
      slide.addShape('ellipse', { x:px+0.12+j*0.38, y:actY+1.05, w:0.28, h:0.28, fill:{ color:C.lightGrey }, line:{ color:C.lightGrey, pt:0 } });
      slide.addText(dot, { x:px+0.12+j*0.38, y:actY+1.05, w:0.28, h:0.28, fontSize:6, color:C.midGrey, fontFace:'Calibri', align:'center', valign:'middle' });
    });
  });
}

function slidePillar(pptx, pillarId, title, weight, activities, period, slideNum) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  addChrome(slide, `${pillarId} - ${title}`, `Weight: ${weight}%`, slideNum);

  const topY = CY + 0.05;

  // Pillar score badge
  slide.addShape('rect', { x:ML, y:topY, w:3.40, h:0.36, fill:{ color:'EBF2FC' }, line:{ color:C.lightGrey, pt:0.75 } });
  slide.addText(`Pillar Score: [##%]  |  RAG: [G/A/R]`, { x:ML+0.10, y:topY, w:3.20, h:0.36, fontSize:9, bold:true, color:C.navy, fontFace:'Calibri', valign:'middle' });

  // Activity table
  const tblY = topY + 0.44;
  const tblH = FTR_Y - 0.08 - tblY;
  const head  = tblHead(['#','Activity','KPI / Target','Planned','Actual','YTD Score','RAG','Comment / Action Required']);
  const colW  = [0.28, CW*0.27, CW*0.11, CW*0.08, CW*0.08, CW*0.09, CW*0.07, CW*0.22];
  const acts  = activities && activities.length ? activities : Array.from({length:8},(_,i) => `[Activity ${i+1}]`);
  const rows  = acts.map((a, i) => tblRow([i+1, typeof a==='string'?a:a.name, '[Target]','[#]','[#]','[%]','[G/A/R]','[Enter comments]'], i%2===1));
  slide.addTable([head, ...rows], {
    x:ML, y:tblY, w:CW, h:tblH,
    colW, rowH:0.34,
    border:{ pt:0.5, color:C.lightGrey }, fontFace:'Calibri',
  });
}

// ─── SLIDE — Issues & Action Tracker ────────────────────────────────────────
function slideIssues(pptx, actions, period, slideNum) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  addChrome(slide, 'Issues List & Action Tracker', period, slideNum);

  const topY = CY + 0.05;
  const head = tblHead(['#','Issue Description','Priority','Owner','Status','Target Date','Update / Comments']);
  const colW = [0.28, CW*0.28, CW*0.09, CW*0.10, CW*0.12, CW*0.12, CW*0.21];
  const rows = actions && actions.length
    ? actions.slice(0,10).map((a, i) => tblRow([
        i+1, a.task||a.action||a.description||a.desc||'[Issue description]',
        { text:a.priority||'[H/M/L]', color: a.priority==='High'?C.red:a.priority==='Medium'?C.amber:C.green, bold:true },
        a.owner||'[Name]', a.status||'[Open/Closed]', a.due_date||a.due||'[DD/MM/YY]', a.notes||a.update||'—',
      ], i%2===1))
    : Array.from({length:10},(_,i)=>tblRow([i+1,'[Issue description]','[H/M/L]','[Name]','[Open/Closed]','[DD/MM/YY]','[Latest update]'], i%2===1));

  const tblH = FTR_Y - 0.08 - topY - 1.10;
  slide.addTable([head, ...rows], {
    x:ML, y:topY, w:CW, h:tblH,
    colW, rowH:0.32,
    border:{ pt:0.5, color:C.lightGrey }, fontFace:'Calibri',
  });

  // Summary bar
  const sumY = topY + tblH + 0.08;
  slide.addShape('rect', { x:ML, y:sumY, w:CW, h:0.28, fill:{ color:C.lightBlue }, line:{ color:'CCDDEE', pt:0.5 } });
  const hi = actions?.filter(a=>a.priority==='High').length||'[#]';
  const me = actions?.filter(a=>a.priority==='Medium').length||'[#]';
  const lo = actions?.filter(a=>(a.priority||'').toLowerCase()==='low').length||'[#]';
  slide.addText(`Summary:  Total Issues: ${actions?.length||'[#]'}  |  High: ${hi}  |  Medium: ${me}  |  Low: ${lo}  |  Open: [#]  |  Closed This Month: [#]  |  Overdue: [#]`, {
    x:ML+0.12, y:sumY, w:CW-0.18, h:0.28,
    fontSize:7.5, color:C.navy, fontFace:'Calibri', valign:'middle',
  });

  // Escalations banner
  const escY = sumY + 0.36;
  const escH = FTR_Y - 0.08 - escY;
  slide.addShape('rect', { x:ML, y:escY, w:CW, h:escH, fill:{ color:C.white }, line:{ color:C.orange, pt:1.5 } });
  slide.addText('ESCALATIONS REQUIRING GROUP IT ATTENTION:', { x:ML+0.12, y:escY+0.06, w:CW-0.18, h:0.22, fontSize:8, bold:true, color:C.orange, fontFace:'Calibri' });
  slide.addText('[List any items that need Group IT Manager intervention or support]', {
    x:ML+0.12, y:escY+0.28, w:CW-0.18, h:escH-0.34,
    fontSize:8, color:'AAAAAA', fontFace:'Calibri', italic:true, valign:'top',
  });
}

// ─── SLIDE — Projects & Initiatives ─────────────────────────────────────────
function slideProjects(pptx, period, slideNum) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  addChrome(slide, 'Projects & Initiatives Status', period, slideNum);

  const topY = CY + 0.05;
  const tblH = 3.00;
  const head = tblHead(['Project / Initiative','Phase','% Complete','RAG','Key Milestone','Owner','Notes / Next Steps']);
  const colW = [CW*0.22, CW*0.10, CW*0.10, CW*0.07, CW*0.24, CW*0.13, CW*0.14];
  const rows = Array.from({length:8},(_,i) => tblRow(['[Project name]','[Phase]','[##%]','[G/A/R]','[Key milestone description]','[Name]','[Notes]'], i%2===1));
  slide.addTable([head, ...rows], {
    x:ML, y:topY, w:CW, h:tblH,
    colW, rowH:0.35,
    border:{ pt:0.5, color:C.lightGrey }, fontFace:'Calibri',
  });

  const half = (CW - 0.20) / 2;
  const botY = topY + tblH + 0.12;
  const botH = FTR_Y - 0.08 - botY;

  slide.addShape('rect', { x:ML, y:botY, w:half, h:botH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, ML, botY, half, 0.28, 'Project Budget Summary');
  const budLines = ['Total Project Budget: [USD $XXX,XXX]','Spent YTD: [USD $XXX,XXX] ([##%])','Forecast to Complete: [USD $XXX,XXX]','Variance: [USD $XXX,XXX] ([+/-##%])','','Budget Status: [On Track / Over / Under]'];
  budLines.forEach((l, i) => slide.addText(l, { x:ML+0.12, y:botY+0.36+i*0.27, w:half-0.18, h:0.24, fontSize:8, color:l?C.darkGrey:'', fontFace:'Calibri' }));

  const rightX = ML + half + 0.20;
  slide.addShape('rect', { x:rightX, y:botY, w:half, h:botH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, rightX, botY, half, 0.28, 'Key Project Decisions Required');
  [1,2,3].forEach((n,i) => slide.addText(`${n}.  [Decision needed - impact - timeline]`, { x:rightX+0.12, y:botY+0.36+i*0.40, w:half-0.18, h:0.32, fontSize:8, color:C.darkGrey, fontFace:'Calibri' }));
  slide.addText('Resource Conflicts:\n-  [Any resource conflicts between projects]', { x:rightX+0.12, y:botY+1.60, w:half-0.18, h:0.60, fontSize:8, color:C.darkGrey, fontFace:'Calibri' });
}

// ─── SLIDE — Appendix: Contact & Escalation (last slide) ────────────────────
function slideAppendix(pptx, siteName, period, slideNum) {
  const slide = pptx.addSlide();
  slide.background = { color: C.white };
  addChrome(slide, 'Appendix - Contact & Escalation', 'Reference', slideNum);

  const topY = CY + 0.05;
  const half = (CW - 0.20) / 2;

  // Site team table (left-top)
  slide.addShape('rect', { x:ML, y:topY, w:half, h:2.10, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, ML, topY, half, 0.28, 'Site IT Team Structure');
  const tmHead = tblHead(['Role','Name','Contact']);
  const tmColW = [half*0.38, half*0.32, half*0.30];
  const tmRows = ['Site IT Manager','Network Administrator','Systems Administrator','Desktop Support Lead','Helpdesk Analyst','IT Technician']
    .map((r,i) => tblRow([r,'[Name]','[Email / Ext]'], i%2===1));
  slide.addTable([tmHead, ...tmRows], {
    x:ML, y:topY+0.28, w:half, h:2.10-0.28, colW:tmColW, rowH:0.30,
    border:{ pt:0.5, color:C.lightGrey }, fontFace:'Calibri',
  });

  // Escalation path (right-top)
  const rightX = ML + half + 0.20;
  slide.addShape('rect', { x:rightX, y:topY, w:half, h:2.10, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, rightX, topY, half, 0.28, 'Escalation Path');
  const levels = [
    { l:'L1', label:'Service Desk / Helpdesk',       time:'First Response',  color:C.green   },
    { l:'L2', label:'Site IT Specialist',              time:'Within 2 hours',  color:C.teal    },
    { l:'L3', label:'Site IT Manager',                 time:'Within 4 hours',  color:C.amber   },
    { l:'L4', label:'Group IT Operations Manager',     time:'Within 8 hours',  color:C.red     },
    { l:'L5', label:'VP IT / CIO',                    time:'Critical Only',   color:'7B0000'  },
  ];
  levels.forEach((lv, i) => {
    const ly = topY + 0.36 + i * 0.32;
    slide.addShape('rect', { x:rightX+0.12, y:ly, w:0.32, h:0.26, fill:{ color:lv.color }, line:{ color:lv.color, pt:0 } });
    slide.addText(lv.l, { x:rightX+0.12, y:ly, w:0.32, h:0.26, fontSize:8, bold:true, color:C.white, fontFace:'Calibri', align:'center', valign:'middle' });
    slide.addText(lv.label, { x:rightX+0.52, y:ly, w:half*0.55, h:0.26, fontSize:8, color:C.darkGrey, fontFace:'Calibri', valign:'middle' });
    slide.addText(lv.time,  { x:rightX+half-1.00, y:ly, w:0.92, h:0.26, fontSize:7.5, color:C.midGrey, fontFace:'Calibri', valign:'middle', align:'right' });
  });

  // Vendor contacts (left-bottom)
  const botY = topY + 2.20;
  const botH = FTR_Y - 0.08 - botY;
  slide.addShape('rect', { x:ML, y:botY, w:half, h:botH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, ML, botY, half, 0.28, 'Key Vendor Contacts');
  const vHead = tblHead(['Vendor / Service','Contact','Contract End']);
  const vColW = [half*0.45, half*0.30, half*0.25];
  const vRows = ['Internet Service Provider','Network Equipment (Cisco/HP)','Server / Storage (Dell/HP)','Backup Solution Provider','Radio / Communications']
    .map((v,i) => tblRow([v,'[Name / Phone]','[Date]'], i%2===1));
  slide.addTable([vHead, ...vRows], {
    x:ML, y:botY+0.28, w:half, h:botH-0.28, colW:vColW, rowH:0.28,
    border:{ pt:0.5, color:C.lightGrey }, fontFace:'Calibri',
  });

  // Important info (right-bottom)
  slide.addShape('rect', { x:rightX, y:botY, w:half, h:botH, fill:{ color:C.white }, line:{ color:C.lightGrey, pt:0.75 } });
  subHeader(slide, rightX, botY, half, 0.28, 'Important Information');
  const info = [
    'Report Submission:','- Due Date: [5th of each month]','- Submit to: [Group IT Operations Manager email]','- Format: Complete all sections with current month data','',
    'Data Sources:','- Helpdesk data: [ITSM Tool Name]','- Infrastructure monitoring: [Tool Name]','- Customer satisfaction: [Survey Tool]','',
    `Sites: Abidjan, Dakar, EDV1, Explo, HGO, SMI, KGO, SML, MGO, SGO`,
    `Version: 1.0  |  Template Owner: Group IT Operations`,
  ];
  info.forEach((l, i) => {
    slide.addText(l, { x:rightX+0.12, y:botY+0.36+i*0.23, w:half-0.18, h:0.22, fontSize:7.5, color:l.startsWith('-')||l.startsWith('Version')?C.midGrey:C.darkGrey, fontFace:'Calibri' });
  });
}

// ─── MAIN EXPORT ───────────────────────────────────────────────────────────
async function generateSiteMonthlyPptx(monthlyData, siteName, year, month) {
  const pptx = new pptxgen();
  pptx.layout  = 'LAYOUT_WIDE';
  pptx.author  = 'IT Department — Endeavour Mining';
  pptx.title   = `Monthly IT Report — ${siteName} — ${MONTHS[month-1]} ${year}`;
  pptx.subject = 'Monthly Site IT Report';

  const period  = `${MONTHS[month-1]} ${year}`;
  const hd      = monthlyData?.calendar_hd      || null;
  const prevHd  = monthlyData?.prev_calendar_hd || null;
  const h6m     = monthlyData?.history6m        || [];
  const top10   = monthlyData?.monthly_top10    || [];

  // Collect ageing, infra kpis, actions from last report
  const reports = monthlyData?.reports || [];
  let lastAgeing = [], lastTop10 = [], lastInfraKpis = [], lastActions = [], lastChanges = [], lastIncidents = [];
  for (const r of reports) {
    try {
      // chart_data is already parsed by getReport(); guard for string fallback
      const rawCd = r.helpdesk?.chart_data;
      const cd = rawCd ? (typeof rawCd === 'string' ? JSON.parse(rawCd) : rawCd) : {};
      if (Array.isArray(cd.ageing) && cd.ageing.length) lastAgeing = cd.ageing;
      // top10 from chart_data (last report's value wins)
      if (Array.isArray(cd.top10) && cd.top10.length) lastTop10 = cd.top10;
    } catch(e) {}
    // infra_kpis is an array of DB rows from getReport()
    if (Array.isArray(r.infra_kpis) && r.infra_kpis.length) lastInfraKpis = r.infra_kpis;
    // action_items is an array of DB rows from getReport()
    if (Array.isArray(r.action_items) && r.action_items.length) lastActions = r.action_items;
    // changes_incidents — stored as JSON field in some reports
    if (r.changes_incidents) {
      try {
        const ci = typeof r.changes_incidents === 'string' ? JSON.parse(r.changes_incidents) : r.changes_incidents;
        if (Array.isArray(ci.changes) && ci.changes.length) lastChanges = ci.changes;
        if (Array.isArray(ci.incidents) && ci.incidents.length) lastIncidents = ci.incidents;
      } catch(e) {}
    }
  }

  // Ageing by group from last report's chart_data (weekly format → monthly proxy)
  let ageingByGroup = [];
  if (lastAgeing.length) {
    // lastAgeing is [{label:'<24h', value:N}, ...] — no group breakdown in this source
    // Use as overall only; group breakdown requires group_metrics
  }
  for (const r of reports) {
    try {
      const gm = r.helpdesk?.group_metrics;
      if (Array.isArray(gm) && gm.length) {
        ageingByGroup = gm.map(g => ({ group: g.group||g.label, lt24:g.lt24, d13:g.d13, d37:g.d37, d714:g.d714, gt14:g.gt14 }));
      }
    } catch(e) {}
  }

  let slideNum = 1;
  slideCover(pptx, siteName, period);                                                        console.log(`  Slide ${slideNum++}: Cover`);
  slideExecSummary(pptx, hd, prevHd, siteName, period, slideNum++);                         console.log(`  Slide ${slideNum-1}: Executive Summary`);
  const effectiveTop10 = (top10 && top10.length) ? top10 : lastTop10;
  slideHelpdeskDashboard(pptx, hd, h6m, lastAgeing, effectiveTop10, period, slideNum++);  console.log(`  Slide ${slideNum-1}: Helpdesk Dashboard`);
  slideTicketDistribution(pptx, null, period, slideNum++);                                  console.log(`  Slide ${slideNum-1}: Ticket Distribution`);
  slideSlaAgeing(pptx, ageingByGroup, effectiveTop10, period, slideNum++);                  console.log(`  Slide ${slideNum-1}: SLA & Ageing`);
  slideCSAT(pptx, hd, period, slideNum++);                                                  console.log(`  Slide ${slideNum-1}: CSAT & NPS`);
  slideChanges(pptx, lastChanges, lastIncidents, period, slideNum++);                       console.log(`  Slide ${slideNum-1}: Change Management`);
  slideInfra(pptx, lastInfraKpis, period, slideNum++);                                      console.log(`  Slide ${slideNum-1}: Infrastructure`);
  slideObjectivesOverview(pptx, period, slideNum++);                                        console.log(`  Slide ${slideNum-1}: Objectives Overview`);
  slidePillar(pptx,'P1','Network Infrastructure',30, null, period, slideNum++);            console.log(`  Slide ${slideNum-1}: P1 - Network`);
  slidePillar(pptx,'P2','Business Partnering',   35, null, period, slideNum++);            console.log(`  Slide ${slideNum-1}: P2 - Business Partnering`);
  slidePillar(pptx,'P3','Risk & Compliance',     20, null, period, slideNum++);            console.log(`  Slide ${slideNum-1}: P3 - Risk & Compliance`);
  slidePillar(pptx,'P4','Manage People',         15, null, period, slideNum++);            console.log(`  Slide ${slideNum-1}: P4 - People`);
  slideIssues(pptx, lastActions, period, slideNum++);                                       console.log(`  Slide ${slideNum-1}: Issues & Actions`);
  slideProjects(pptx, period, slideNum++);                                                  console.log(`  Slide ${slideNum-1}: Projects`);
  slideAppendix(pptx, siteName, period, slideNum++);                                       console.log(`  Slide ${slideNum-1}: Appendix`);

  const buf = await pptx.write({ outputType:'nodebuffer' });
  return buf;
}

module.exports = { generateSiteMonthlyPptx };
