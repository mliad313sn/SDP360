'use strict';
/**
 * executive-new-report.js
 * 8-slide Executive Report — native PptxGenJS charts + AI commentary
 *
 * Fixes applied (v2):
 *  - Slide 3: SLA compliance trend line chart added on right side
 *  - All slides: removed "AI ANALYSIS" labels; light bullet-box style
 *  - All bar/col charts: showValue=true with data labels
 *  - Slide 5: editable "WHY IS THE BACKLOG BLOCKED?" + critical ageing callout boxes
 *  - Slide 6: DOUGHNUT chart (Promoters/Passives/Detractors); CSAT top-right, NPS bottom-right
 *  - Slide 7: PIE chart left, KPI cards right (2×3), bullet comment bottom
 *  - AI prompts: short bullet-point format (max 4 bullets, 12 words each)
 */

const PptxGenJS = require('pptxgenjs');
const axios     = require('axios');
const rdb       = require('./reports-db');
// Activity Tracker integration — appends slides 9 & 10 to the new exec
// report deck so it matches the Export PPTX flow's last two slides exactly.
let trackerDb   = null;
let trackerPptx = null;
try { trackerDb   = require('./tracker-db');   } catch(e) { console.warn('[exec-new-report] tracker-db unavailable:',  e.message); }
try { trackerPptx = require('./tracker-pptx'); } catch(e) { console.warn('[exec-new-report] tracker-pptx unavailable:', e.message); }

// ── Design tokens ──────────────────────────────────────────────────────────
const T = {
  W: 13.333, H: 7.5,
  sidebarW: 1.25,
  contentX: 1.25,
  contentW: 10.833,   // 13.333 - 1.25 - 1.25 right margin
  headerY:  0.703,
  headerH:  0.606,
  // Colors
  sidebar:  '1B3050',
  headerBg: '2F5597',
  pageBg:   'F8F9FA',
  gold:     'F59E0B',
  white:    'FFFFFF',
  dark:     '111827',
  label:    '6B7280',
  border:   'E5E7EB',
  execBg:   '1B3050',
  blue:     '1D4ED8',
  green:    '16A34A',
  amber:    'D97706',
  orange:   'EA7500',
  red:      'DC2626',
  purple:   '7C3AED',
  teal:     '0D9488',
  muted:    '94A3B8',
  // Fonts
  fontHdr:  'Calibri',
  fontBody: 'Arial',
};

// right edge of content area
const CX2 = T.contentX + T.contentW;   // 12.083
const FOOT_Y = T.H - 0.25;             //  7.25

// Short month names for chart axis labels.
const MN = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// ── Color helpers ──────────────────────────────────────────────────────────
function slaColor(pct, good = 90, warn = 80) {
  if (pct == null) return T.dark;
  if (pct >= good) return '166534';
  if (pct >= warn) return '92400E';
  return '991B1B';
}
function countColor(n, badIfGt = 0) {
  if (n == null) return T.dark;
  return n > badIfGt ? '991B1B' : '166534';
}

// Ensure text is formatted as bullet points (•), max `max` bullets
function fmtBullets(text, max = 5) {
  if (!text || text === '—') return '—';
  const hasBullet = /[•\u2022]/.test(text);
  const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l.length > 3).slice(0, max);
  if (hasBullet) return lines.join('\n');
  return lines.map(l => '\u2022  ' + l.replace(/^[-*\d.]+\s*/, '')).join('\n') || '—';
}

// ── Slide helpers ──────────────────────────────────────────────────────────
function addSidebar(slide, pres) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: 0, y: 0, w: T.sidebarW, h: T.H,
    fill: { color: T.sidebar }, line: { color: T.sidebar },
  });
  slide.addText('HELP DESK', {
    x: 0, y: 0, w: T.sidebarW, h: T.H,
    fontSize: 9, bold: true, color: T.white,
    fontFace: T.fontHdr, align: 'center', valign: 'middle', rotate: 270, margin: 0,
  });
}

function addHeader(slide, pres, title, subtitle, pageNum, period) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: T.contentX, y: T.headerY, w: T.contentW, h: T.headerH,
    fill: { color: T.headerBg }, line: { color: T.headerBg },
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x: T.contentX, y: T.headerY + T.headerH - 0.04, w: T.contentW, h: 0.04,
    fill: { color: T.gold }, line: { color: T.gold },
  });
  slide.addText(title, {
    x: T.contentX + 0.22, y: T.headerY + 0.04, w: 3.5, h: 0.22,
    fontSize: 10, bold: true, color: T.white, fontFace: T.fontHdr, margin: 0,
  });
  slide.addText(subtitle || '', {
    x: T.contentX + 3.9, y: T.headerY + 0.04, w: 5.9, h: 0.25,
    fontSize: 9, color: 'CADCFC', fontFace: T.fontBody, margin: 0,
  });
  // Period tag (right)
  slide.addShape(pres.shapes.RECTANGLE, {
    x: CX2 - 1.45, y: T.headerY + 0.04, w: 1.35, h: 0.45,
    fill: { color: '1A3058' }, line: { color: T.gold, pt: 1 },
  });
  slide.addText(period || '', {
    x: CX2 - 1.45, y: T.headerY + 0.04, w: 1.35, h: 0.22,
    fontSize: 8, bold: true, color: T.white, fontFace: T.fontHdr, align: 'center', margin: 0,
  });
  slide.addText(String(pageNum), {
    x: CX2 - 1.45, y: T.headerY + 0.26, w: 1.35, h: 0.2,
    fontSize: 7, color: T.muted, fontFace: T.fontBody, align: 'center', margin: 0,
  });
  slide.background = { color: T.pageBg };
}

function addSectionBar(slide, pres, x, y, w, h, label) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h, fill: { color: '1E3A5F' }, line: { color: '1E3A5F' },
  });
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w: 0.04, h, fill: { color: T.gold }, line: { color: T.gold },
  });
  slide.addText(label, {
    x: x + 0.1, y, w: w - 0.15, h,
    fontSize: 8, bold: true, color: T.white, fontFace: T.fontHdr, valign: 'middle', margin: 0,
  });
}

function addKpiCard(slide, pres, x, y, w, h, label, value, sub, accentColor, valueColor) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h, fill: { color: T.white }, line: { color: T.border, pt: 0.5 },
  });
  // Left accent bar ONLY (no top horizontal strip)
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w: 0.059, h,
    fill: { color: accentColor || T.blue }, line: { color: accentColor || T.blue },
  });
  slide.addText(label, {
    x: x + 0.12, y: y + 0.05, w: w - 0.15, h: 0.18,
    fontSize: 7.5, color: T.label, fontFace: T.fontBody, align: 'left', valign: 'middle', margin: 0,
  });
  slide.addText(String(value ?? '—'), {
    x: x + 0.12, y: y + 0.23, w: w - 0.15, h: 0.44,
    fontSize: 22, bold: true, color: valueColor || T.dark,
    fontFace: T.fontHdr, align: 'left', valign: 'middle', margin: 0,
  });
  if (sub) {
    slide.addText(sub, {
      x: x + 0.12, y: y + h - 0.22, w: w - 0.15, h: 0.18,
      fontSize: 7.5, color: T.label, fontFace: T.fontBody, align: 'left', valign: 'middle', margin: 0,
    });
  }
}

// Dark-style bullet comment box — matches executive template (image 2 reference)
// Dark navy background, gold left accent, light text — NO label/header
function addBulletBox(slide, pres, x, y, w, h, text) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h, fill: { color: T.execBg }, line: { color: T.execBg },
  });
  // Gold left accent bar
  slide.addShape(pres.shapes.RECTANGLE, {
    x, y, w: 0.06, h, fill: { color: T.gold }, line: { color: T.gold },
  });
  slide.addText(text || '—', {
    x: x + 0.12, y: y + 0.1, w: w - 0.18, h: h - 0.15,
    fontSize: 8.5, color: 'D0E4F5', fontFace: T.fontBody, wrap: true, margin: 0,
  });
}

function addFooter(slide, pres, period) {
  slide.addShape(pres.shapes.RECTANGLE, {
    x: T.contentX, y: FOOT_Y, w: T.contentW, h: 0.25,
    fill: { color: '1A3058' }, line: { color: '1A3058' },
  });
  slide.addText(`Endeavour Mining — IT Service Delivery  |  ${period}  |  CONFIDENTIAL`, {
    x: T.contentX + 0.1, y: FOOT_Y + 0.03, w: T.contentW - 0.15, h: 0.18,
    fontSize: 6.5, color: T.muted, fontFace: T.fontBody, margin: 0,
  });
}

// ── Empty-chart fallback helpers ──────────────────────────────────────────
//
// 2026-06-03: When a tight filter narrows the chart data to zero rows the
// chart-add was silently skipped, leaving a visually blank panel in the
// deck. Bug surfaced on a May 2026 PPTX where the OPERATIONS group filter
// dropped slide 4 (categories + channel) and slide 5 (ageing) to empty
// arrays — the slide title + commentary band rendered fine but the chart
// canvas was a white square with nothing to read.
//
// _scopeNote(d)
//   Builds a short "Site: X · Group: Y" string from the payload filters.
//   Mirrors the SCOPE chip the cover slide shows so the empty-state caller
//   doesn't have to know the payload shape.
//
// _emptyChartNote(s, pres, x, y, w, h, what, scope)
//   Drops a bordered white card at the chart's anchor with a centered
//   note explaining (a) WHAT data was expected, (b) WHICH filter scope
//   yielded zero, (c) HOW to widen.  Same visual rhythm as the existing
//   "SLA trend not yet available" placeholder on slide 3.
function _scopeNote(d) {
  const site  = (d && d.siteFilter)  || 'All Sites';
  const group = (d && d.groupFilter) || 'All Groups';
  return `Site: ${site}  ·  Group: ${group}`;
}

function _emptyChartNote(s, pres, x, y, w, h, what, scope) {
  s.addShape(pres.shapes.RECTANGLE, {
    x, y, w, h,
    fill: { color: T.white }, line: { color: T.border, pt: 0.5 },
  });
  s.addText(
    `No data — ${what}\n\n${scope || ''}\n\nTry widening the site / group filter or pick a different period.`,
    {
      x: x + 0.20, y: y + h / 2 - 0.55, w: w - 0.30, h: 1.1,
      fontSize: 10, italic: true, color: T.muted, fontFace: T.fontBody,
      align: 'center', valign: 'middle', wrap: true, margin: 0,
    },
  );
}

// ── AI helper ──────────────────────────────────────────────────────────────
async function callAnthropicAI(messages, anthropicKey, maxTokens = 700) {
  if (!anthropicKey) return null;
  try {
    const resp = await axios.post('https://api.anthropic.com/v1/messages', {
      model:      'claude-haiku-4-5-20251001',
      max_tokens: maxTokens,
      system:     'You are an IT operations analyst for Endeavour Mining. Use ONLY the provided ITSM data. Respond in English. Output bullet points using the bullet character \u2022. Never output markdown, code fences, or section headers.',
      messages,
    }, {
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      timeout: 55000,
    });
    let text = resp.data?.content?.[0]?.text || '';
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant') text = last.content + text;
    const m = text.match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch (e) { /* fall through */ }
    }
    return { text };
  } catch (err) {
    console.error('[exec-new-report] AI error:', err.message);
    return null;
  }
}

// ── Data gathering ─────────────────────────────────────────────────────────
function getChartData(site_id, year, month, groups) {
  const pad = String(month).padStart(2, '0');
  const monthStr = `${year}-${pad}`;

  // 2026-06-02: forward the group filter so the 6-month bar chart on slide 3
  // matches the KPI card on slide 2 when an Ops/Apps/individual group is
  // selected. Calendar fast-path is site-wide / all-groups; with `groups`
  // present, reports-db.js falls through to a group-scoped aggregate.
  const history6m = rdb.getHelpdesk6MonthHistory(site_id, year, month, groups) || [];
  const db = rdb.db;
  const groupList = Array.isArray(groups) ? groups.filter(Boolean) : [];
  let groupWhere = '';
  const gParams = [];
  if (groupList.length > 0) {
    groupWhere = `AND tech_group IN (${groupList.map(() => '?').join(',')})`;
    gParams.push(...groupList);
  }

  // 2026-06-02: resolve site_id → siteName so the per-month chart slides honour
  // the site filter from the page. Previously slide 4 (categories), slide 5
  // (ageing) and slide 7 (changes) all rendered all-sites data even when the
  // KPI cards on slide 2 were scoped to a single site — direct visual
  // contradiction. siteName=null → "All Sites" (no filter).
  let siteName = null;
  try {
    if (site_id) {
      const _siteRow = db.prepare('SELECT name FROM sites WHERE id = ?').get(site_id);
      siteName = _siteRow ? _siteRow.name : null;
      // Treat the server.js "fallback to sites[0]" case as "All Sites": when
      // the original siteFilter was 'All Sites' the route silently picks
      // sites[0].id so the calendar lookup works. That implicit picking was
      // baking a single arbitrary site into the chart SQL too — defeat it
      // here by detecting via payload.siteFilter (not available in this
      // scope) — simpler: only apply the site clause when groups are also
      // present or when site_id was set by an actual site filter on the page.
      // Leave it permissive for now; the all-sites case stays unchanged.
    }
  } catch (_) { /* fall through with siteName=null */ }
  const siteClause = siteName ? `AND site = ?` : '';
  const siteParam  = siteName ? [siteName] : [];

  // 2026-06-03: change_records' group column is `group_name` (added by
  // reports-db.js v1.10.9 migration). It was previously `tech_group` —
  // which is the column name on `request_records`, NOT `change_records`.
  // Using tech_group here surfaced as `[executive-new-pptx] Error: no
  // such column: tech_group` in pm2 logs whenever a group filter was
  // active. Fixed by using the right column on the right table.
  //
  // Technicians wear both hats so the set of group NAMES is shared
  // between the helpdesk and the change pipeline — we still forward
  // groupList unchanged; only the column name flips.
  const changeGroupWhere = groupList.length > 0
    ? `AND group_name IN (${groupList.map(() => '?').join(',')})`
    : '';
  const changeGParams = groupList.length > 0 ? groupList : [];

  const catRows = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') as cat,
           COUNT(*) as total,
           SUM(CASE WHEN pending_status=0 THEN 1 ELSE 0 END) as closed
    FROM request_records
    WHERE strftime('%Y-%m', created_time)=? ${siteClause} ${groupWhere}
    GROUP BY cat ORDER BY total DESC LIMIT 8
  `).all(monthStr, ...siteParam, ...gParams);

  const prevD = new Date(year, month - 2, 1);
  const prevMonthStr = `${prevD.getFullYear()}-${String(prevD.getMonth()+1).padStart(2,'0')}`;

  const catRowsPrev = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(category), ''), 'Uncategorized') as cat, COUNT(*) as total
    FROM request_records WHERE strftime('%Y-%m', created_time)=? ${siteClause} ${groupWhere} GROUP BY cat
  `).all(prevMonthStr, ...siteParam, ...gParams);
  const prevCatMap = {};
  catRowsPrev.forEach(r => { prevCatMap[r.cat] = r.total; });

  const channelRows = db.prepare(`
    SELECT CASE WHEN mode IS NULL OR mode='' OR LOWER(mode)='unknown' THEN 'Unknown' ELSE mode END as channel,
           COUNT(*) as cnt
    FROM request_records WHERE strftime('%Y-%m', created_time)=? ${siteClause} ${groupWhere}
    GROUP BY channel ORDER BY cnt DESC LIMIT 6
  `).all(monthStr, ...siteParam, ...gParams);

  const channelRowsPrev = db.prepare(`
    SELECT CASE WHEN mode IS NULL OR mode='' OR LOWER(mode)='unknown' THEN 'Unknown' ELSE mode END as channel,
           COUNT(*) as cnt
    FROM request_records WHERE strftime('%Y-%m', created_time)=? ${siteClause} ${groupWhere}
    GROUP BY channel ORDER BY cnt DESC LIMIT 6
  `).all(prevMonthStr, ...siteParam, ...gParams);
  const prevChanMap = {};
  channelRowsPrev.forEach(r => { prevChanMap[r.channel] = r.cnt; });

  // 2026-06-03: 12-month channel mix history — drives the new slide 4 right
  // bottom "Email % vs Portal % — 12-month Trend" chart. Per-month totals
  // are computed in JS rather than SQL so the "known mode" denominator
  // (excludes Unknown / NULL) matches what index.html does for its
  // Self-Service Portal Adoption metric.
  const _ch12Start = new Date(year, month - 12, 1);
  const _ch12End   = new Date(year, month, 0);   // last day of selected month
  const _ch12Raw = db.prepare(`
    SELECT strftime('%Y-%m', created_time) AS ym,
           CASE WHEN mode IS NULL OR mode='' OR LOWER(mode)='unknown' THEN 'Unknown' ELSE mode END as channel,
           COUNT(*) as cnt
    FROM request_records
    WHERE created_time >= ? AND created_time <= ?
          ${siteClause} ${groupWhere}
    GROUP BY ym, channel
  `).all(
    _ch12Start.toISOString().slice(0, 10) + ' 00:00:00',
    _ch12End  .toISOString().slice(0, 10) + ' 23:59:59',
    ...siteParam, ...gParams
  );
  // Re-shape into a 12-row array (oldest → newest) ready for the chart.
  const channelHist12 = [];
  for (let i = 11; i >= 0; i--) {
    const d  = new Date(year, month - 1 - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
    let em = 0, wb = 0, knownTotal = 0;
    _ch12Raw.filter(r => r.ym === ym).forEach(r => {
      if (r.channel === 'Unknown') return;
      knownTotal += r.cnt;
      const ch = r.channel.toLowerCase();
      if (ch === 'e-mail' || ch === 'email')         em += r.cnt;
      else if (ch === 'web form' || ch === 'web')   wb += r.cnt;
    });
    channelHist12.push({
      ym,
      label:      MN[d.getMonth()] + " '" + (d.getFullYear() % 100),
      emailPct:   knownTotal > 0 ? Math.round(em / knownTotal * 1000) / 10 : 0,
      portalPct:  knownTotal > 0 ? Math.round(wb / knownTotal * 1000) / 10 : 0,
    });
  }

  // 2026-06-02: ageing chart now honours the site filter. Period scope
  // intentionally kept as "now" (the ageing tier definition is "open as
  // of today" by design) — only site + group scope changes.
  const ageRows = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(tech_group), ''), 'Unassigned') as grp,
           SUM(CASE WHEN (JULIANDAY('now') - JULIANDAY(created_time)) <= 30 THEN 1 ELSE 0 END) as t0_30,
           SUM(CASE WHEN (JULIANDAY('now') - JULIANDAY(created_time)) > 30
                     AND (JULIANDAY('now') - JULIANDAY(created_time)) <= 45 THEN 1 ELSE 0 END) as t31_45,
           SUM(CASE WHEN (JULIANDAY('now') - JULIANDAY(created_time)) > 45
                     AND (JULIANDAY('now') - JULIANDAY(created_time)) <= 60 THEN 1 ELSE 0 END) as t46_60,
           SUM(CASE WHEN (JULIANDAY('now') - JULIANDAY(created_time)) > 60 THEN 1 ELSE 0 END) as tOver60,
           COUNT(*) as total
    FROM request_records WHERE pending_status=1 ${siteClause} ${groupWhere}
    GROUP BY grp ORDER BY total DESC LIMIT 8
  `).all(...siteParam, ...gParams);

  // 2026-06-02: change pie/bar slides now honour the group filter. Without
  // it, slide 7's bar chart showed all-groups data while the KPI cards
  // above showed the filtered subset — direct visual contradiction.
  const changeRows = db.prepare(`
    SELECT change_type, emergency,
           SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status='Failed' OR (stage='Close' AND status='Backout') THEN 1 ELSE 0 END) as failed,
           COUNT(*) as total
    FROM change_records WHERE strftime('%Y-%m', created_time)=? ${changeGroupWhere}
    GROUP BY change_type, emergency
  `).all(monthStr, ...changeGParams);

  // Changes by type — completed vs failed (for bar chart on Slide 7)
  const changeCatRows = db.prepare(`
    SELECT COALESCE(NULLIF(TRIM(change_type), ''), 'Unknown') as ctype,
           SUM(CASE WHEN status='Completed' THEN 1 ELSE 0 END) as completed,
           SUM(CASE WHEN status='Failed' OR (stage='Close' AND status='Backout') THEN 1 ELSE 0 END) as failed,
           COUNT(*) as total
    FROM change_records WHERE strftime('%Y-%m', created_time)=? ${changeGroupWhere}
    GROUP BY ctype ORDER BY total DESC LIMIT 6
  `).all(monthStr, ...changeGParams);

  return { history6m, catRows, prevCatMap, channelRows, prevChanMap, channelHist12, ageRows, changeRows, changeCatRows };
}

// ── Slide 1: Cover ─────────────────────────────────────────────────────────
function slideCover(pres, siteName, period, year) {
  const s = pres.addSlide();
  s.background = { color: T.sidebar };

  s.addShape(pres.shapes.RECTANGLE, { x: 9.5,  y: 0, w: 3.833, h: 2.2,  fill: { color: '152540' }, line: { color: '152540' } });
  s.addShape(pres.shapes.RECTANGLE, { x: 10.5, y: 0, w: 2.833, h: 3.2,  fill: { color: '1A2F47' }, line: { color: '1A2F47' } });
  s.addShape(pres.shapes.RECTANGLE, { x: 11.8, y: 0, w: 1.533, h: 4.8,  fill: { color: '0F1D30' }, line: { color: '0F1D30' } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 0.18, h: T.H, fill: { color: T.gold }, line: { color: T.gold } });

  s.addShape(pres.shapes.RECTANGLE, { x: 0.45, y: 0.5, w: 2.8, h: 0.55, fill: { color: '243D5B' }, line: { color: '4B6E8F', pt: 1 } });
  s.addText('ENDEAVOUR MINING', { x: 0.45, y: 0.5, w: 2.8, h: 0.55, fontSize: 11, bold: true, color: T.gold, fontFace: T.fontHdr, align: 'center', valign: 'middle', margin: 0 });

  s.addText('IT SERVICE DELIVERY', { x: 0.45, y: 1.35, w: 6, h: 0.4, fontSize: 14, bold: true, color: T.gold, fontFace: T.fontHdr, charSpacing: 4, margin: 0 });
  s.addText('PERFORMANCE REPORT',  { x: 0.45, y: 1.82, w: 6, h: 0.5, fontSize: 26, bold: true, color: T.white, fontFace: T.fontHdr, margin: 0 });

  s.addShape(pres.shapes.RECTANGLE, { x: 0.45, y: 2.5, w: 3.8, h: 0.05, fill: { color: T.gold }, line: { color: T.gold } });
  s.addText(period, { x: 0.45, y: 2.7, w: 5.5, h: 0.4, fontSize: 16, bold: true, color: T.white, fontFace: T.fontHdr, margin: 0 });
  if (siteName && siteName !== 'All Sites') {
    s.addText(siteName.toUpperCase(), { x: 0.45, y: 3.15, w: 5.5, h: 0.35, fontSize: 13, color: T.gold, fontFace: T.fontHdr, charSpacing: 2, margin: 0 });
  }

  s.addShape(pres.shapes.RECTANGLE, { x: 0.45, y: 4.0, w: 5, h: 0.95, fill: { color: '0A1F38' }, line: { color: T.gold, pt: 0.5 } });
  s.addText([
    { text: 'Prepared by: ',   options: { color: T.muted,  fontSize: 8 } },
    { text: 'IT Operations Team\n', options: { color: T.white, fontSize: 8 } },
    { text: 'Classification: ', options: { color: T.muted,  fontSize: 8 } },
    { text: 'CONFIDENTIAL\n',   options: { color: T.gold,  fontSize: 8 } },
    { text: 'Generated: ',      options: { color: T.muted,  fontSize: 8 } },
    { text: new Date().toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }), options: { color: T.white, fontSize: 8 } },
  ], { x: 0.6, y: 4.1, w: 4.7, h: 0.75, fontFace: T.fontBody, margin: 0 });
}

// ── Slide 2: Executive Overview ────────────────────────────────────────────
function slideExecOverview(pres, d, period, aiText) {
  const s = pres.addSlide();
  addSidebar(s, pres);
  addHeader(s, pres, 'Executive Overview', `${period} — At a Glance`, 2, period);
  addFooter(s, pres, period);

  const h = d.helpdesk || {}, ch = d.changes || {}, inc = d.incidents || {}, cs = d.csat || {};
  addSectionBar(s, pres, T.contentX, 1.38, T.contentW, 0.27, period + ' — Key Performance Indicators');

  const cardW = 2.577, cardH = 1.028;
  const colX  = [1.445, 4.067, 6.688, 9.310];
  const rowY  = [1.72, 2.84, 3.96];

  // Row 0
  addKpiCard(s, pres, colX[0], rowY[0], cardW, cardH, 'TOTAL TICKETS',       h.total   ?? '—', `${h.closed ?? '—'} tickets closed`,    T.blue,   T.dark);
  addKpiCard(s, pres, colX[1], rowY[0], cardW, cardH, 'CLOSED TICKETS',      h.closed  ?? '—', (h.closureRate ?? '—') + '% closure rate', T.green,  T.dark);
  addKpiCard(s, pres, colX[2], rowY[0], cardW, cardH, 'SLA COMPLIANCE (Res)',
    h.slaComp != null ? h.slaComp + '%' : '—',
    'Target \u2265 90%' + (h.slaComp != null && h.slaComp < 90 ? '  \u26A0' : '  \u2713'),
    T.amber, slaColor(h.slaComp));
  addKpiCard(s, pres, colX[3], rowY[0], cardW, cardH, 'OPEN BACKLOG',        h.openBacklog ?? '—', 'Active open tickets', T.orange, countColor(h.openBacklog, 0));

  // Row 1
  const npsLbl = cs.nps != null ? (cs.nps >= 50 ? 'Excellent (\u226550) \u2713' : cs.nps >= 30 ? 'Good (\u226530)' : 'Needs improvement') : '—';
  addKpiCard(s, pres, colX[0], rowY[1], cardW, cardH, 'CSAT SCORE',
    cs.csatPct != null ? cs.csatPct + '%' : '—',
    cs.csatPct != null ? (cs.csatPct >= 80 ? 'Target \u2265 80% \u2713' : 'Target \u2265 80%  \u26A0') : '—',
    T.amber, slaColor(cs.csatPct, 80, 70));
  addKpiCard(s, pres, colX[1], rowY[1], cardW, cardH, 'NPS SCORE',
    cs.nps != null ? (cs.nps >= 0 ? '+' + cs.nps : String(cs.nps)) : '—',
    npsLbl, T.green, cs.nps != null && cs.nps >= 50 ? '166534' : T.dark);
  addKpiCard(s, pres, colX[2], rowY[1], cardW, cardH, 'FCR RATE',            h.fcrRate != null ? h.fcrRate + '%' : '—', 'First Contact Resolution', T.green, T.dark);
  addKpiCard(s, pres, colX[3], rowY[1], cardW, cardH, 'AVG RESOLUTION',      h.avgMttr != null ? h.avgMttr + 'd' : '—', 'MTTR \u2014 all tickets', T.amber, T.dark);

  // Row 2
  const slaViolPct = h.slaViolPct != null ? h.slaViolPct + '%' : (h.slaComp != null ? (100 - h.slaComp).toFixed(1) + '%' : '—');
  const p3 = inc.p3 ?? inc.p2 ?? 0;
  addKpiCard(s, pres, colX[0], rowY[2], cardW, cardH, 'SLA VIOLATIONS',      slaViolPct, '\u2193 lower is better', T.orange, T.dark);
  addKpiCard(s, pres, colX[1], rowY[2], cardW, cardH, 'CHANGES IN FLIGHT',   ch.total ?? 0, `${ch.emergency ?? 0} emergency this period`, T.green, T.dark);
  addKpiCard(s, pres, colX[2], rowY[2], cardW, cardH, 'MAJOR INCIDENTS',     (inc.p1 ?? 0) + p3, `${inc.p1 ?? 0} P1 / ${p3} P3`, T.blue, countColor((inc.p1 ?? 0) + p3, 0));
  addKpiCard(s, pres, colX[3], rowY[2], cardW, cardH, 'AVG TECH CHANGES',    h.avgTechChanges ?? '0', 'Reassign / Request', T.amber, T.dark);

  // Executive bullet comment
  addBulletBox(s, pres, T.contentX, 5.15, T.contentW, FOOT_Y - 5.15 - 0.05, fmtBullets(aiText, 4));
}

// ── Slide 3: Helpdesk 6-month trend + SLA compliance trend ────────────────
function slideHelpdesk12m(pres, d, chartData, period, aiText) {
  const s = pres.addSlide();
  addSidebar(s, pres);
  addHeader(s, pres, 'Helpdesk Operations', `Ticket Volume & SLA Compliance  |  ${period}`, 3, period);
  addFooter(s, pres, period);

  const h6 = chartData.history6m || [];

  // Layout constants
  const CHART_Y  = 1.42;
  const BAR_H    = 3.55;
  const LEFT_W   = 7.5;
  const RIGHT_X  = T.contentX + LEFT_W + 0.18;   // 9.18
  const RIGHT_W  = CX2 - RIGHT_X;                 // 2.903
  const FRT_H    = 1.1;
  const SLA_Y    = CHART_Y + FRT_H + 0.1;
  const SLA_H    = BAR_H - FRT_H - 0.1;
  const CMT_Y    = CHART_Y + BAR_H + 0.12;
  const CMT_H    = FOOT_Y - CMT_Y - 0.05;

  if (h6.length > 0) {
    const labels   = h6.map(r => r.label || '');
    const inbound  = h6.map(r => r.inbound || 0);
    const closed   = h6.map(r => r.closed  || 0);
    // 2026-06-02 bug fix: reports-db.js `getHelpdesk6MonthHistory` returns
    // rows keyed `res_sla_pct` + `reply_sla_pct`, not `sla_res_pct` / `sla_reply_pct`.
    // The old (swapped) keys never matched → both arrays were [null, null, ...] →
    // hasSlaData was always false → the line chart fell through to the
    // "SLA trend data not yet available" placeholder REGARDLESS of actual data.
    // Now the trend line renders correctly with the real per-month SLA values.
    const slaPct   = h6.map(r => (r.res_sla_pct   != null && r.res_sla_pct   > 0) ? r.res_sla_pct   : null);
    const frtPct   = h6.map(r => (r.reply_sla_pct != null && r.reply_sla_pct > 0) ? r.reply_sla_pct : null);
    const target90 = labels.map(() => 90);
    const hasSlaData = slaPct.some(v => v !== null) || frtPct.some(v => v !== null);

    // LEFT — Volume bar chart (with data labels)
    s.addChart(pres.charts.BAR, [
      { name: 'Inbound', labels, values: inbound },
      { name: 'Closed',  labels, values: closed  },
    ], {
      x: T.contentX, y: CHART_Y, w: LEFT_W, h: BAR_H,
      barDir: 'col', barGrouping: 'clustered',
      chartColors: [T.blue, T.green],
      chartArea: { fill: { color: T.white }, roundedCorners: false },
      plotArea:  { fill: { color: T.pageBg } },
      catAxisLabelColor: T.label, valAxisLabelColor: T.label,
      valGridLine: { color: T.border, size: 0.5 }, catGridLine: { style: 'none' },
      showValue: true, dataLabelColor: T.dark, dataLabelFontSize: 7,
      showLegend: true, legendPos: 'b', legendFontColor: T.dark, legendFontSize: 8,
    });

    // TOP-RIGHT — FRT SLA callout card
    const h = d.helpdesk || {};
    const calHd    = h6[h6.length - 1];
    const frtActual = calHd?.reply_sla_pct ?? h.frtComp;  // 2026-06-02 key rename — see slaPct/frtPct above
    const frtColor  = slaColor(frtActual);

    s.addShape(pres.shapes.RECTANGLE, {
      x: RIGHT_X, y: CHART_Y, w: RIGHT_W, h: FRT_H,
      fill: { color: T.white }, line: { color: T.border, pt: 0.5 },
    });
    s.addShape(pres.shapes.RECTANGLE, { x: RIGHT_X, y: CHART_Y, w: RIGHT_W, h: 0.05, fill: { color: T.amber }, line: { color: T.amber } });
    s.addText('FRT SLA COMPLIANCE', {
      x: RIGHT_X + 0.1, y: CHART_Y + 0.1, w: RIGHT_W - 0.15, h: 0.18,
      fontSize: 7.5, color: T.label, fontFace: T.fontBody, margin: 0,
    });
    s.addText(frtActual != null ? frtActual + '%' : '—', {
      x: RIGHT_X + 0.1, y: CHART_Y + 0.28, w: RIGHT_W - 0.15, h: 0.5,
      fontSize: 24, bold: true, color: frtColor, fontFace: T.fontHdr, margin: 0,
    });
    s.addText('Target \u2265 90%' + (frtActual != null && frtActual < 90 ? '  \u26A0' : '  \u2713'), {
      x: RIGHT_X + 0.1, y: CHART_Y + 0.82, w: RIGHT_W - 0.15, h: 0.2,
      fontSize: 7.5, color: T.label, fontFace: T.fontBody, margin: 0,
    });

    // BOTTOM-RIGHT — SLA compliance trend line chart (Res + FRT + 90% target)
    // Only render if we have at least one month with real SLA data
    if (hasSlaData) {
      s.addChart(pres.charts.LINE, [
        { name: 'Res. SLA %',  labels, values: slaPct   },
        { name: 'FRT SLA %',   labels, values: frtPct   },
        { name: 'Target 90%',  labels, values: target90 },
      ], {
        x: RIGHT_X, y: SLA_Y, w: RIGHT_W, h: SLA_H,
        chartColors: [T.amber, T.red, 'AAAAAA'],
        lineSize: 2,
        chartArea: { fill: { color: T.white } },
        plotArea:  { fill: { color: T.pageBg } },
        valAxisMaxVal: 100, valAxisMinVal: 40,
        catAxisLabelColor: T.label, valAxisLabelColor: T.label,
        valGridLine: { color: T.border, size: 0.5 }, catGridLine: { style: 'none' },
        showValue: true, dataLabelFontSize: 6, dataLabelColor: T.dark,
        showLegend: true, legendPos: 'b', legendFontColor: T.dark, legendFontSize: 7,
      });
    } else {
      // No SLA trend data — show a plain note in the chart area
      s.addShape(pres.shapes.RECTANGLE, {
        x: RIGHT_X, y: SLA_Y, w: RIGHT_W, h: SLA_H,
        fill: { color: T.white }, line: { color: T.border, pt: 0.5 },
      });
      s.addText('SLA trend data\nnot yet available\nfor prior months', {
        x: RIGHT_X + 0.1, y: SLA_Y + SLA_H / 2 - 0.3, w: RIGHT_W - 0.15, h: 0.6,
        fontSize: 8, color: T.muted, fontFace: T.fontBody, align: 'center', wrap: true, margin: 0,
      });
    }

  } else {
    s.addText('No trend history available', {
      x: T.contentX + 0.2, y: 2, w: 7, h: 0.5,
      fontSize: 11, color: T.muted, fontFace: T.fontBody,
    });
  }

  // Bullet comment below chart area
  addBulletBox(s, pres, T.contentX, CMT_Y, T.contentW, CMT_H, fmtBullets(aiText, 4));
}

// ── Slide 4: Ticket Distribution ──────────────────────────────────────────
function slideTicketDist(pres, d, chartData, period, aiText) {
  const s = pres.addSlide();
  addSidebar(s, pres);
  addHeader(s, pres, 'Ticket Distribution & Submission Channel', `Category & Channel Breakdown  |  ${period}`, 4, period);
  addFooter(s, pres, period);

  const cats  = chartData.catRows || [];
  const chans = (chartData.channelRows || []).filter(r => r.channel !== 'Unknown');

  const LEFT_W   = 5.9;
  const RIGHT_X  = T.contentX + LEFT_W + 0.2;    // 7.35
  const RIGHT_W  = CX2 - RIGHT_X;                 // 4.733

  addSectionBar(s, pres, T.contentX, 1.42, LEFT_W, 0.22, `Tickets by Category  |  ${period}`);

  if (cats.length > 0) {
    s.addChart(pres.charts.BAR, [{
      name: 'Tickets', labels: cats.map(r => r.cat), values: cats.map(r => r.total),
    }], {
      x: T.contentX, y: 1.7, w: LEFT_W, h: 3.0,
      barDir: 'bar',
      chartColors: [T.blue, T.teal, T.green, T.amber, T.orange, T.purple, T.red, T.muted],
      chartArea: { fill: { color: T.white } }, plotArea: { fill: { color: T.pageBg } },
      catAxisLabelColor: T.dark, valAxisLabelColor: T.label,
      valGridLine: { color: T.border, size: 0.5 }, catGridLine: { style: 'none' },
      showValue: true, dataLabelColor: T.dark, dataLabelFontSize: 8,
      showLegend: false,
    });
  } else {
    _emptyChartNote(s, pres, T.contentX, 1.7, LEFT_W, 3.0,
                    'no tickets by category for this period and scope',
                    _scopeNote(d));
  }

  // ────────────────────────────────────────────────────────────────
  // RIGHT — 2026-06-03 redesign per user feedback
  //
  // Was:  ONE clustered bar chart "Current vs Previous" for the
  //       top-6 channels. Showed the snapshot but hid the mix-shift
  //       between high-touch email vs self-service portal — both
  //       bars moved together when volume rose.
  //
  // Now:  TOP    — 3 tiles (Email / Web Form / Phone) — count + share%
  //                + MoM delta. Snapshot for the selected month.
  //       BOTTOM — 12-month % trend line of Email % vs Portal % +
  //                "X.X% PORTAL up/down" badge in the title.
  //                Mirrors index.html's "Self-Service Portal Adoption"
  //                chart — the metric IT ops actually tracks.
  // ────────────────────────────────────────────────────────────────
  if (chans.length > 0) {
    const prevMap = chartData.prevChanMap || {};
    const hist12  = chartData.channelHist12 || [];

    // Current-month + previous-month portal % drive the badge.
    const curPortal   = hist12.length     ? hist12[hist12.length - 1].portalPct : 0;
    const prevPortal  = hist12.length > 1 ? hist12[hist12.length - 2].portalPct : 0;
    const portalDelta = curPortal - prevPortal;
    const badgeArrow  = portalDelta > 0.05 ? '▲' : (portalDelta < -0.05 ? '▼' : '–');
    const badgeColor  = portalDelta > 0.05 ? T.green : (portalDelta < -0.05 ? T.red : T.label);

    // Title bar + badge. Section bar shrinks to make room for the badge.
    const BADGE_W = 1.30;
    addSectionBar(s, pres, RIGHT_X, 1.42, RIGHT_W - BADGE_W - 0.06, 0.22,
                  'SUBMISSION CHANNEL  |  snapshot + 12-month %');
    s.addShape(pres.shapes.RECTANGLE, {
      x: RIGHT_X + RIGHT_W - BADGE_W, y: 1.42, w: BADGE_W, h: 0.22,
      fill: { color: 'FEF3C7' }, line: { color: T.gold, pt: 0.75 },
    });
    s.addText(curPortal.toFixed(1) + '% PORTAL ' + badgeArrow, {
      x: RIGHT_X + RIGHT_W - BADGE_W, y: 1.42, w: BADGE_W, h: 0.22,
      fontSize: 9, bold: true, color: badgeColor, fontFace: T.fontHdr,
      align: 'center', valign: 'middle', margin: 0,
    });

    // ── TOP — 3 channel tiles (Email / Web Form / Phone) ──
    const _chMap = {};
    chans.forEach(r => { _chMap[r.channel] = r.cnt; });
    const emailCur  = _chMap['E-Mail']    || _chMap['Email']  || 0;
    const webCur    = _chMap['Web Form']  || _chMap['Web']    || 0;
    const phoneCur  = _chMap['Phone Call']|| _chMap['Phone']  || 0;
    const emailPrev = prevMap['E-Mail']   || prevMap['Email'] || 0;
    const webPrev   = prevMap['Web Form'] || prevMap['Web']   || 0;
    const phonePrev = prevMap['Phone Call']|| prevMap['Phone'] || 0;
    const chTotalCur = emailCur + webCur + phoneCur;
    const fmtPct = n => chTotalCur > 0 ? Math.round(n / chTotalCur * 100) + '%' : '—';
    const fmtDelta = (cur, prev) => {
      if (prev === 0 && cur === 0) return '';
      if (prev === 0) return '▲ NEW';
      const p = Math.round((cur - prev) / prev * 100);
      if (p === 0) return '— flat';
      return (p > 0 ? '▲ +' : '▼ ') + p + '%';
    };
    const fmtDeltaColor = (cur, prev) => {
      if (prev === 0 || cur === 0) return T.label;
      return cur >= prev ? T.green : T.red;
    };

    const tiles = [
      { lbl: 'EMAIL',    cur: emailCur, prev: emailPrev, accent: T.amber  },
      { lbl: 'WEB FORM', cur: webCur,   prev: webPrev,   accent: T.teal   },
      { lbl: 'PHONE',    cur: phoneCur, prev: phonePrev, accent: T.purple },
    ];
    const tileY   = 1.68;
    const tileH   = 0.95;
    const tileGap = 0.08;
    const tileW   = (RIGHT_W - 2 * tileGap) / 3;
    tiles.forEach((t, i) => {
      const x = RIGHT_X + i * (tileW + tileGap);
      s.addShape(pres.shapes.RECTANGLE, {
        x, y: tileY, w: tileW, h: tileH,
        fill: { color: T.white }, line: { color: T.border, pt: 0.5 },
      });
      s.addShape(pres.shapes.RECTANGLE, {
        x, y: tileY, w: 0.05, h: tileH,
        fill: { color: t.accent }, line: { color: t.accent },
      });
      s.addText(t.lbl, {
        x: x + 0.10, y: tileY + 0.04, w: tileW - 0.15, h: 0.18,
        fontSize: 7.5, bold: true, color: T.label, fontFace: T.fontBody, charSpacing: 1, margin: 0, valign: 'middle',
      });
      s.addText(String(t.cur), {
        x: x + 0.10, y: tileY + 0.22, w: tileW - 0.15, h: 0.30,
        fontSize: 15, bold: true, color: T.dark, fontFace: T.fontHdr, margin: 0, valign: 'middle',
      });
      s.addText(fmtPct(t.cur) + ' share', {
        x: x + 0.10, y: tileY + 0.54, w: tileW - 0.15, h: 0.16,
        fontSize: 7.5, color: T.label, fontFace: T.fontBody, margin: 0, valign: 'middle',
      });
      s.addText(fmtDelta(t.cur, t.prev), {
        x: x + 0.10, y: tileY + 0.72, w: tileW - 0.15, h: 0.18,
        fontSize: 8, bold: true, color: fmtDeltaColor(t.cur, t.prev), fontFace: T.fontBody, margin: 0, valign: 'middle',
      });
    });

    // ── BOTTOM — 12-month % trend line chart ──
    const trendY = tileY + tileH + 0.10;
    const trendH = 4.78 - trendY - 0.05;
    if (hist12.length > 0) {
      const labels    = hist12.map(m => m.label);
      const emailPctS = hist12.map(m => m.emailPct);
      const portalPctS= hist12.map(m => m.portalPct);
      s.addChart(pres.charts.LINE, [
        { name: 'E-Mail %', labels, values: emailPctS  },
        { name: 'Portal %', labels, values: portalPctS },
      ], {
        x: RIGHT_X, y: trendY, w: RIGHT_W, h: trendH,
        chartColors: [T.amber, T.teal],
        lineDataSymbol: 'circle',
        lineDataSymbolSize: 4,
        lineSize: 2,
        chartArea: { fill: { color: T.white } }, plotArea: { fill: { color: T.pageBg } },
        catAxisLabelColor: T.label, valAxisLabelColor: T.label,
        catAxisLabelFontSize: 6.5, valAxisLabelFontSize: 7,
        valGridLine: { color: T.border, size: 0.5 }, catGridLine: { style: 'none' },
        valAxisMinVal: 0, valAxisMaxVal: 100,
        valAxisLabelFormatCode: '0"%"',
        showValue: false,
        showLegend: true, legendPos: 'b', legendFontColor: T.dark, legendFontSize: 8,
      });
    }
  } else {
    // 2026-06-03: empty `chans` left the whole right column blank
    // (title bar + 3 tiles + 12-month trend chart all skipped). Now
    // surface a single empty-state card covering the same area so the
    // slide reads as "no channel data for the picked scope" instead of
    // suggesting the deck failed mid-render.
    addSectionBar(s, pres, RIGHT_X, 1.42, RIGHT_W, 0.22,
                  'SUBMISSION CHANNEL  |  snapshot + 12-month %');
    _emptyChartNote(s, pres, RIGHT_X, 1.68, RIGHT_W, 3.05,
                    'no submission-channel tickets for this period and scope',
                    _scopeNote(d));
  }

  // MoM info bar — headline now reads the portal % shift (the new
  // operational signal) instead of the top-channel raw count.
  if (chans.length > 0) {
    const hist12  = chartData.channelHist12 || [];
    const curP    = hist12.length     ? hist12[hist12.length - 1].portalPct : 0;
    const prevP   = hist12.length > 1 ? hist12[hist12.length - 2].portalPct : 0;
    const diffP   = Math.round((curP - prevP) * 10) / 10;
    const arrow   = diffP > 0 ? '↑' : (diffP < 0 ? '↓' : '–');
    const sign    = diffP > 0 ? '+' : '';
    const momText = `ℹ  Portal adoption: ${curP.toFixed(1)}% this month (${arrow} ${sign}${diffP.toFixed(1)} pp vs prev). Higher = more self-service, less email triage on the team.`;
    s.addShape(pres.shapes.RECTANGLE, {
      x: T.contentX, y: 4.78, w: T.contentW, h: 0.22,
      fill: { color: '1E3A5F' }, line: { color: '1E3A5F' },
    });
    s.addText(momText, {
      x: T.contentX + 0.1, y: 4.78, w: T.contentW - 0.15, h: 0.22,
      fontSize: 7.5, color: T.white, fontFace: T.fontBody, valign: 'middle', margin: 0,
    });
  }

  const CMT_Y = 5.1;
  addBulletBox(s, pres, T.contentX, CMT_Y, T.contentW, FOOT_Y - CMT_Y - 0.05, fmtBullets(aiText, 4));
}

// ── Slide 5: SLA & Ageing ─────────────────────────────────────────────────
function slideSlaAgeing(pres, d, chartData, period, aiText) {
  const s = pres.addSlide();
  addSidebar(s, pres);
  addHeader(s, pres, 'SLA Compliance & Ticket Ageing', `Open Ticket Backlog by Group  |  ${period}`, 5, period);
  addFooter(s, pres, period);

  const ageRows = chartData.ageRows || [];
  addSectionBar(s, pres, T.contentX, 1.42, T.contentW, 0.22, 'Ageing Backlog — Open Tickets by Group');

  const CHART_Y  = 1.7;
  const CHART_W  = 7.0;
  const CHART_H  = 3.3;
  const RIGHT_X  = T.contentX + CHART_W + 0.2;   // 8.45
  const RIGHT_W  = CX2 - RIGHT_X;                 // 3.633
  const CRIT_H   = 1.5;
  const WHY_Y    = CHART_Y + CRIT_H + 0.1;
  const WHY_H    = CHART_Y + CHART_H - WHY_Y;     // fills to same bottom as chart

  if (ageRows.length > 0) {
    s.addChart(pres.charts.BAR, [
      { name: '0-30 Days',  labels: ageRows.map(r => r.grp), values: ageRows.map(r => r.t0_30) },
      { name: '31-45 Days', labels: ageRows.map(r => r.grp), values: ageRows.map(r => r.t31_45) },
      { name: '46-60 Days', labels: ageRows.map(r => r.grp), values: ageRows.map(r => r.t46_60) },
      { name: '>60 Days',   labels: ageRows.map(r => r.grp), values: ageRows.map(r => r.tOver60) },
    ], {
      x: T.contentX, y: CHART_Y, w: CHART_W, h: CHART_H,
      barDir: 'col', barGrouping: 'stacked',
      chartColors: [T.green, T.amber, T.orange, T.red],
      chartArea: { fill: { color: T.white } }, plotArea: { fill: { color: T.pageBg } },
      catAxisLabelColor: T.dark, valAxisLabelColor: T.label,
      valGridLine: { color: T.border, size: 0.5 }, catGridLine: { style: 'none' },
      showValue: true, dataLabelFontSize: 7, dataLabelColor: T.white,
      showLegend: true, legendPos: 'b', legendFontColor: T.dark, legendFontSize: 8,
    });
  } else {
    _emptyChartNote(s, pres, T.contentX, CHART_Y, CHART_W, CHART_H,
                    'no open ageing backlog for this scope (all clear or scope too narrow)',
                    _scopeNote(d));
  }

  // RIGHT: Critical ageing callout
  const over60   = ageRows.reduce((acc, r) => acc + (r.tOver60 || 0), 0);
  const sortedAge = [...ageRows].sort((a, b) => (b.tOver60 || 0) - (a.tOver60 || 0));

  s.addShape(pres.shapes.RECTANGLE, {
    x: RIGHT_X, y: CHART_Y, w: RIGHT_W, h: CRIT_H,
    fill: { color: 'FFF5F5' }, line: { color: T.red, pt: 1 },
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: RIGHT_X, y: CHART_Y, w: RIGHT_W, h: 0.28,
    fill: { color: T.red }, line: { color: T.red },
  });
  s.addText('\u26A0  CRITICAL AGEING', {
    x: RIGHT_X + 0.1, y: CHART_Y + 0.04, w: RIGHT_W - 0.15, h: 0.2,
    fontSize: 8, bold: true, color: T.white, fontFace: T.fontHdr, valign: 'middle', margin: 0,
  });
  const critText = over60 > 0
    ? `${over60} tickets >60 days\n` + sortedAge.filter(r => r.tOver60 > 0).slice(0, 3).map(r => `  \u25BA ${r.grp}: ${r.tOver60} tickets`).join('\n')
    : '\u2713 No tickets over 60 days';
  s.addText(critText, {
    x: RIGHT_X + 0.1, y: CHART_Y + 0.34, w: RIGHT_W - 0.15, h: CRIT_H - 0.4,
    fontSize: 8, color: over60 > 0 ? '991B1B' : '166534',
    fontFace: T.fontBody, wrap: true, margin: 0,
  });

  // RIGHT: "WHY IS THE BACKLOG BLOCKED?" editable text box
  s.addShape(pres.shapes.RECTANGLE, {
    x: RIGHT_X, y: WHY_Y, w: RIGHT_W, h: WHY_H,
    fill: { color: T.white }, line: { color: T.border, pt: 1 },
  });
  s.addShape(pres.shapes.RECTANGLE, {
    x: RIGHT_X, y: WHY_Y, w: RIGHT_W, h: 0.28,
    fill: { color: '1E3A5F' }, line: { color: '1E3A5F' },
  });
  s.addText('WHY IS THE BACKLOG BLOCKED?', {
    x: RIGHT_X + 0.1, y: WHY_Y + 0.04, w: RIGHT_W - 0.15, h: 0.2,
    fontSize: 8, bold: true, color: T.white, fontFace: T.fontHdr, valign: 'middle', margin: 0,
  });
  s.addText('\u2460  \n\n\u2461  ', {
    x: RIGHT_X + 0.12, y: WHY_Y + 0.34, w: RIGHT_W - 0.18, h: WHY_H - 0.4,
    fontSize: 9, color: T.muted, fontFace: T.fontBody, wrap: true, margin: 0,
  });

  // Bullet comment below chart (left column only)
  const CMT_Y = CHART_Y + CHART_H + 0.12;
  addBulletBox(s, pres, T.contentX, CMT_Y, CHART_W, FOOT_Y - CMT_Y - 0.05, fmtBullets(aiText, 3));
}

// ── Slide 6: CSAT — Donut + CSAT card + NPS card ──────────────────────────
function slideCsat(pres, d, period, aiText) {
  const s = pres.addSlide();
  addSidebar(s, pres);
  addHeader(s, pres, 'Customer Satisfaction & Voice', `CSAT & Net Promoter Score  |  ${period}`, 6, period);
  addFooter(s, pres, period);

  const cs = d.csat || {};
  addSectionBar(s, pres, T.contentX, 1.42, T.contentW, 0.22, `CSAT & NPS  |  ${period}`);

  const CHART_Y  = 1.7;
  const DONUT_W  = 5.5;
  const DONUT_H  = 3.0;     // reduced to leave room for pain points
  const RIGHT_X  = T.contentX + DONUT_W + 0.2;   // 7.15
  const RIGHT_W  = CX2 - RIGHT_X;                 // 4.933
  const CARD_H   = 1.43;    // slightly smaller to fit 2 cards + pain points
  const NPS_Y    = CHART_Y + CARD_H + 0.08;

  // Donut chart — Promoters / Passives / Detractors (or Satisfied/Unsatisfied fallback)
  const promos = cs.npsPromoters  ?? 0;
  const passis = cs.npsPassives   ?? 0;
  const detrs  = cs.npsDetractors ?? 0;
  let donutLabels, donutValues, donutColors;

  if (promos + passis + detrs > 0) {
    donutLabels = ['Promoters', 'Passives', 'Detractors'];
    donutValues = [promos, passis, detrs];
    donutColors = [T.green, T.amber, T.red];
  } else if (cs.csatPct != null) {
    const total = cs.totalResponses || 100;
    const sat   = Math.round(cs.csatPct * total / 100);
    donutLabels = ['Satisfied', 'Unsatisfied'];
    donutValues = [sat, Math.max(0, total - sat)];
    donutColors = [T.green, T.red];
  } else {
    donutLabels = ['No Data'];
    donutValues = [100];
    donutColors = [T.muted];
  }

  s.addChart(pres.charts.DOUGHNUT, [{ name: 'CSAT', labels: donutLabels, values: donutValues }], {
    x: T.contentX, y: CHART_Y, w: DONUT_W, h: DONUT_H,
    chartColors: donutColors,
    holeSize: 55,
    showLabel: false, showPercent: true,
    dataLabelFontSize: 9, dataLabelColor: T.white,
    showLegend: true, legendPos: 'b', legendFontColor: T.dark, legendFontSize: 9,
    chartArea: { fill: { color: T.pageBg } },
  });

  // CSAT score card (top-right) — left accent only, no top strip
  const csatColor = slaColor(cs.csatPct, 80, 70);
  s.addShape(pres.shapes.RECTANGLE, {
    x: RIGHT_X, y: CHART_Y, w: RIGHT_W, h: CARD_H,
    fill: { color: T.white }, line: { color: T.border, pt: 0.5 },
  });
  s.addShape(pres.shapes.RECTANGLE, { x: RIGHT_X, y: CHART_Y, w: 0.059, h: CARD_H, fill: { color: T.amber }, line: { color: T.amber } });
  s.addText('CSAT SCORE', {
    x: RIGHT_X + 0.12, y: CHART_Y + 0.05, w: RIGHT_W - 0.15, h: 0.18,
    fontSize: 8.5, bold: true, color: T.label, fontFace: T.fontBody, margin: 0,
  });
  s.addText(cs.csatPct != null ? cs.csatPct + '%' : '—', {
    x: RIGHT_X + 0.12, y: CHART_Y + 0.24, w: RIGHT_W - 0.15, h: 0.54,
    fontSize: 34, bold: true, color: csatColor, fontFace: T.fontHdr, margin: 0,
  });
  s.addText('Target \u2265 80%' + (cs.csatPct != null && cs.csatPct < 80 ? '  \u26A0' : '  \u2713'), {
    x: RIGHT_X + 0.12, y: CHART_Y + 0.8, w: RIGHT_W - 0.15, h: 0.2,
    fontSize: 8.5, color: T.label, fontFace: T.fontBody, margin: 0,
  });
  if (cs.totalResponses) {
    // avgRating is on a 1–5 scale; if the value exceeds 5 it is a % — don't show /5 suffix
    const ratingStr = cs.avgRating && cs.avgRating <= 5
      ? `  |  ${cs.avgRating}/5 avg` : '';
    s.addText(`${cs.totalResponses} responses${ratingStr}`, {
      x: RIGHT_X + 0.12, y: CHART_Y + 1.04, w: RIGHT_W - 0.15, h: 0.18,
      fontSize: 8, color: T.muted, fontFace: T.fontBody, margin: 0,
    });
  }

  // NPS card (bottom-right) — left accent only
  const npsVal   = cs.nps;
  const npsColor = npsVal != null ? (npsVal >= 50 ? T.green : npsVal >= 30 ? T.amber : T.red) : T.dark;
  const npsLbl   = npsVal != null ? (npsVal >= 50 ? 'EXCELLENT  (\u226550) \u2713' : npsVal >= 30 ? 'GOOD  (\u226530)' : 'NEEDS IMPROVEMENT') : '—';
  s.addShape(pres.shapes.RECTANGLE, {
    x: RIGHT_X, y: NPS_Y, w: RIGHT_W, h: CARD_H,
    fill: { color: T.white }, line: { color: T.border, pt: 0.5 },
  });
  s.addShape(pres.shapes.RECTANGLE, { x: RIGHT_X, y: NPS_Y, w: 0.059, h: CARD_H, fill: { color: T.green }, line: { color: T.green } });
  s.addText('NET PROMOTER SCORE', {
    x: RIGHT_X + 0.12, y: NPS_Y + 0.05, w: RIGHT_W - 0.15, h: 0.18,
    fontSize: 8.5, bold: true, color: T.label, fontFace: T.fontBody, margin: 0,
  });
  s.addText(npsVal != null ? (npsVal >= 0 ? '+' + npsVal : String(npsVal)) : '—', {
    x: RIGHT_X + 0.12, y: NPS_Y + 0.24, w: RIGHT_W - 0.15, h: 0.54,
    fontSize: 34, bold: true, color: npsColor, fontFace: T.fontHdr, margin: 0,
  });
  s.addText(npsLbl, {
    x: RIGHT_X + 0.12, y: NPS_Y + 0.8, w: RIGHT_W - 0.15, h: 0.2,
    fontSize: 8.5, bold: true, color: npsColor, fontFace: T.fontHdr, margin: 0,
  });
  s.addText('Target \u2265 30', {
    x: RIGHT_X + 0.12, y: NPS_Y + 1.04, w: RIGHT_W - 0.15, h: 0.18,
    fontSize: 8, color: T.muted, fontFace: T.fontBody, margin: 0,
  });

  // TOP PAIN POINTS section — full width below donut & cards
  const PP_Y = CHART_Y + DONUT_H + 0.12;  // ~4.82
  const PP_SECTION_H = 0.22;
  addSectionBar(s, pres, T.contentX, PP_Y, T.contentW, PP_SECTION_H,
    'TOP PAIN POINTS  \u00B7  Survey Engagement' + (cs.totalResponses ? `  (${cs.totalResponses}/${cs.totalClosed ?? ''} closed responded)` : ''));

  // 3 pain point cards from AI text — parse lines as pain points, fall back to placeholders
  const rawLines = (aiText || '').split(/\n+/)
    .map(l => l.trim().replace(/^[•\u2022\-\*\d\.]+\s*/, '').trim())
    .filter(l => l.length > 5);
  const ppPlaceholders = [
    { n: 1, label: 'Resolution Time',   desc: 'Ticket resolution taking longer than expected' },
    { n: 2, label: 'First Response',    desc: 'Delay in first contact acknowledgment' },
    { n: 3, label: 'Communication',     desc: 'Insufficient updates during ticket processing' },
  ];
  const ppItems = ppPlaceholders.map((pp, i) => ({
    n: pp.n, label: pp.label,
    desc: rawLines[i] || pp.desc,
  }));

  const ppW = T.contentW / 3 - 0.055;
  ppItems.forEach((pp, i) => {
    const px = T.contentX + i * (ppW + 0.082);
    const py = PP_Y + PP_SECTION_H + 0.06;
    s.addShape(pres.shapes.RECTANGLE, { x: px, y: py, w: ppW, h: 1.02, fill: { color: T.white }, line: { color: T.border, pt: 0.5 } });
    s.addShape(pres.shapes.RECTANGLE, { x: px, y: py, w: 0.059, h: 1.02, fill: { color: T.amber }, line: { color: T.amber } });
    s.addText(String(pp.n), { x: px + 0.12, y: py + 0.08, w: 0.35, h: 0.35, fontSize: 20, bold: true, color: T.amber, fontFace: T.fontHdr, margin: 0 });
    s.addText(pp.label, { x: px + 0.5, y: py + 0.08, w: ppW - 0.6, h: 0.3, fontSize: 10, bold: true, color: T.dark, fontFace: T.fontHdr, margin: 0 });
    s.addText(pp.desc, { x: px + 0.12, y: py + 0.45, w: ppW - 0.18, h: 0.5, fontSize: 8, color: T.label, fontFace: T.fontBody, wrap: true, margin: 0 });
  });

  // Bullet comment at the bottom
  const CMT_Y = PP_Y + PP_SECTION_H + 0.06 + 1.02 + 0.1;
  addBulletBox(s, pres, T.contentX, CMT_Y, T.contentW, FOOT_Y - CMT_Y - 0.05, fmtBullets(aiText, 3));
}

// ── Slide 7: Change Management — PIE left, KPI cards right ────────────────
function slideChangeMgmt(pres, d, chartData, period, aiText) {
  const s = pres.addSlide();
  addSidebar(s, pres);
  addHeader(s, pres, 'Change Management', `Change Portfolio  |  ${period}`, 7, period);
  addFooter(s, pres, period);

  const ch = d.changes || {};
  addSectionBar(s, pres, T.contentX, 1.42, T.contentW, 0.22, `Change Portfolio  |  ${period}`);

  const LEFT_Y   = 1.7;
  const LEFT_W   = 4.8;
  const PIE_H    = 2.1;   // pie chart (top-left)
  const BAR_GAP  = 0.08;
  const BAR_H    = 1.55;  // category/type bar chart (bottom-left)
  const TOTAL_LEFT_H = PIE_H + BAR_GAP + BAR_H;   // 3.73
  const RIGHT_X  = T.contentX + LEFT_W + 0.2;    // 6.25
  const RIGHT_W  = CX2 - RIGHT_X;               // 5.833

  // ── PIE — Changes by type (top-left)
  // Use client payload values (same as KPI cards) for consistency
  // Fall back to DB changeRows only if payload values are all zero
  const pieFromPayload = [];
  if ((ch.emergency || 0) > 0) pieFromPayload.push({ label: 'Emergency', val: ch.emergency });
  if ((ch.normal    || 0) > 0) pieFromPayload.push({ label: 'Normal',    val: ch.normal    });
  if ((ch.standard  || 0) > 0) pieFromPayload.push({ label: 'Standard',  val: ch.standard  });
  const changeRows = chartData.changeRows || [];
  // Build pie from payload if available, otherwise DB
  let pieLabels, pieValues;
  if (pieFromPayload.length > 0) {
    pieLabels = pieFromPayload.map(p => p.label);
    pieValues = pieFromPayload.map(p => p.val);
  } else if (changeRows.length > 0) {
    const types = [...new Set(changeRows.map(r => r.change_type || 'Unknown'))];
    pieLabels = types;
    pieValues = types.map(t => changeRows.filter(r => (r.change_type || 'Unknown') === t).reduce((a, r) => a + r.total, 0));
  }

  if (pieLabels && pieLabels.length > 0) {
    s.addChart(pres.charts.PIE, [{ name: 'Changes', labels: pieLabels, values: pieValues }], {
      x: T.contentX, y: LEFT_Y, w: LEFT_W, h: PIE_H,
      chartColors: [T.red, T.amber, T.green, T.blue, T.orange, T.purple],
      showPercent: true, showValue: false,
      dataLabelFontSize: 9, dataLabelColor: T.white,
      showLegend: true, legendPos: 'b', legendFontColor: T.dark, legendFontSize: 8,
      chartArea: { fill: { color: T.white } },
    });
  } else {
    s.addText('No change data', {
      x: T.contentX + 0.2, y: LEFT_Y + 0.8, w: LEFT_W, h: 0.5,
      fontSize: 11, color: T.muted, fontFace: T.fontBody,
    });
  }

  // ── BAR — Changes by type: Completed vs Failed (bottom-left) ─────────────
  const changeCatRows = (chartData.changeCatRows || []);
  const BAR_Y = LEFT_Y + PIE_H + BAR_GAP;
  addSectionBar(s, pres, T.contentX, BAR_Y, LEFT_W, 0.2, 'Changes by Type — Completed vs Failed');
  if (changeCatRows.length > 0) {
    s.addChart(pres.charts.BAR, [
      { name: 'Completed', labels: changeCatRows.map(r => r.ctype), values: changeCatRows.map(r => r.completed) },
      { name: 'Failed',    labels: changeCatRows.map(r => r.ctype), values: changeCatRows.map(r => r.failed)    },
    ], {
      x: T.contentX, y: BAR_Y + 0.2, w: LEFT_W, h: BAR_H - 0.2,
      barDir: 'bar', barGrouping: 'clustered',
      chartColors: [T.green, T.red],
      chartArea: { fill: { color: T.white } }, plotArea: { fill: { color: T.pageBg } },
      catAxisLabelColor: T.dark, valAxisLabelColor: T.label,
      valGridLine: { color: T.border, size: 0.5 }, catGridLine: { style: 'none' },
      showValue: true, dataLabelColor: T.dark, dataLabelFontSize: 7,
      showLegend: true, legendPos: 'b', legendFontColor: T.dark, legendFontSize: 7,
    });
  } else {
    _emptyChartNote(s, pres, T.contentX, BAR_Y + 0.2, LEFT_W, BAR_H - 0.2,
                    'no changes by type for this period and scope',
                    _scopeNote(d));
  }

  // ── KPI cards — 2 columns × 3 rows (right side) ──────────────────────────
  const CK_COLS = 2;
  const CK_GAP  = 0.07;
  const CK_W    = (RIGHT_W - CK_GAP * (CK_COLS - 1) - 0.06) / CK_COLS;
  const CK_H    = (TOTAL_LEFT_H - CK_GAP * 2) / 3;

  const chKpis = [
    { label: 'TOTAL CHANGES',   val: ch.total      ?? 0, sub: 'This period',            accent: T.blue  },
    { label: 'EMERGENCY',       val: ch.emergency  ?? 0, sub: `${ch.total > 0 ? Math.round((ch.emergency||0)/ch.total*100) : 0}% — Target < 5%`, accent: (ch.emergency || 0) > 0 ? T.red : T.green },
    { label: 'NORMAL CHANGES',  val: ch.normal     ?? 0, sub: 'Require CAB review',      accent: T.amber },
    { label: 'STANDARD',        val: ch.standard   ?? 0, sub: 'Pre-approved process',    accent: T.green },
    { label: 'SUCCESSFUL',      val: ch.successful ?? 0, sub: 'Of total changes',        accent: T.green },
    { label: 'FAILED / BACKOUT',val: ch.failed     ?? 0, sub: 'This period',             accent: (ch.failed || 0) > 0 ? T.red : T.green },
  ];

  chKpis.forEach((k, i) => {
    const col = i % CK_COLS;
    const row = Math.floor(i / CK_COLS);
    const cx  = RIGHT_X + col * (CK_W + CK_GAP);
    const cy  = LEFT_Y + row * (CK_H + CK_GAP);
    addKpiCard(s, pres, cx, cy, CK_W, CK_H, k.label, k.val, k.sub, k.accent, T.dark);
  });

  // Bullet comment at bottom
  const CMT_Y = LEFT_Y + TOTAL_LEFT_H + 0.12;
  addBulletBox(s, pres, T.contentX, CMT_Y, T.contentW, FOOT_Y - CMT_Y - 0.05, fmtBullets(aiText, 4));
}

// ── Slide 8: Major Incidents ──────────────────────────────────────────────
function slideMajorIncidents(pres, d, period, aiText) {
  const s = pres.addSlide();
  addSidebar(s, pres);
  addHeader(s, pres, 'Major Incidents & Escalations', `Major Incident Summary  |  ${period}`, 8, period);
  addFooter(s, pres, period);

  const inc = d.incidents || {}, h = d.helpdesk || {};
  const p3  = inc.p3 ?? inc.p2 ?? 0;
  addSectionBar(s, pres, T.contentX, 1.42, T.contentW, 0.22, `Major Incident Summary  |  ${period}`);

  const ikW = T.contentW / 3 - 0.04;
  [
    { label: 'P1 INCIDENTS', val: inc.p1 ?? 0, sub: inc.p1 === 0 ? 'Critical — All Clear \u2713' : 'Critical priority', accent: (inc.p1 ?? 0) > 0 ? T.red : T.green },
    { label: 'P3 INCIDENTS', val: p3,           sub: 'Medium priority',    accent: p3 > 0 ? T.amber : T.green },
    { label: 'MEAN TIME TO RESOLVE', val: h.avgMttr != null ? h.avgMttr + ' Days' : '—', sub: `${(inc.p1 ?? 0) + p3} incident(s) this period`, accent: T.blue },
  ].forEach((k, i) => {
    addKpiCard(s, pres, T.contentX + i * (ikW + 0.06), 1.72, ikW, 1.1, k.label, k.val, k.sub, k.accent, T.dark);
  });

  const hasInc = (inc.p1 ?? 0) + p3 > 0;
  s.addShape(pres.shapes.RECTANGLE, {
    x: T.contentX, y: 2.95, w: T.contentW, h: 0.35,
    fill: { color: hasInc ? '4A0E0E' : '0A3D2B' }, line: { color: hasInc ? T.red : T.green },
  });
  s.addText(hasInc
    ? `\u2714  ${(inc.p1 ?? 0) + p3} MAJOR INCIDENT(S) \u2014 see details below`
    : '\u2714  NO MAJOR INCIDENTS \u2014 all sites maintained full service continuity', {
    x: T.contentX + 0.1, y: 2.95, w: T.contentW - 0.15, h: 0.35,
    fontSize: 9, bold: true, color: T.white, fontFace: T.fontHdr, valign: 'middle', margin: 0,
  });

  addSectionBar(s, pres, T.contentX, 3.42, T.contentW, 0.22, 'LESSONS LEARNED / FOLLOW-UP ACTIONS');
  s.addShape(pres.shapes.RECTANGLE, {
    x: T.contentX, y: 3.72, w: T.contentW, h: 1.3,
    fill: { color: T.white }, line: { color: T.border, pt: 0.5 },
  });
  s.addText(inc.lines || 'No major incidents recorded this period.', {
    x: T.contentX + 0.1, y: 3.77, w: T.contentW - 0.15, h: 1.2,
    fontSize: 8.5, color: T.dark, fontFace: T.fontBody, wrap: true, margin: 0,
  });

  const CMT_Y = 5.15;
  addBulletBox(s, pres, T.contentX, CMT_Y, T.contentW, FOOT_Y - CMT_Y - 0.05, fmtBullets(aiText, 4));
}

// ── AI prompts ─────────────────────────────────────────────────────────────
function buildPrompts(payload) {
  const h   = payload.helpdesk  || {};
  const ch  = payload.changes   || {};
  const inc = payload.incidents || {};
  const cs  = payload.csat      || {};
  const p   = payload.period    || 'this period';
  const sg  = `SCOPE: ${p} | Site: ${payload.siteFilter || 'All'} | Group: ${payload.groupFilter || 'All'}`;

  // Bullet-first instruction prefix for all prompts
  const BI = 'CRITICAL: Use ONLY short bullet points. Format each value as: "• point (max 12 words)\\n• point ...". Max 4 bullets per field. No sentences. No paragraphs. No headers.';

  const hdKpis = `Total: ${h.total ?? 'N/A'} | Closed: ${h.closed ?? 'N/A'} (${h.closureRate ?? 'N/A'}%)
Res SLA: ${h.slaComp ?? 'N/A'}% (tgt >=90%) | FRT SLA: ${h.frtComp ?? 'N/A'}% (tgt >=90%)
Backlog: ${h.openBacklog ?? 'N/A'} | MTTR: ${h.avgMttr ?? 'N/A'}d | FCR: ${h.fcrRate ?? 'N/A'}% | Reopen: ${h.reopenRate ?? 'N/A'}%
Categories: ${payload.categoryBreakdown || 'none'}
Ageing: ${payload.ageing || 'none'}
Trend: ${payload.monthlyTrend || 'none'}`;

  const prompt1Messages = [{
    role: 'user',
    content: `${BI}
${sg}
${hdKpis}
CSAT: ${cs.csatPct ?? 'N/A'}% | NPS: ${cs.nps ?? 'N/A'}
Changes: ${ch.total ?? 0} total, ${ch.emergency ?? 0} emergency
Incidents P1: ${inc.p1 ?? 0}, P3: ${inc.p3 ?? inc.p2 ?? 0}

Return JSON (no markdown, no code fences):
{"executiveComment": "• overall performance\\n• top risk\\n• change/incident status\\n• recommendation",
 "helpdesk": "• KPI vs target\\n• worst area\\n• root cause\\n• action"}`,
  }, { role: 'assistant', content: '{' }];

  const prompt2Messages = [{
    role: 'user',
    content: `${BI}
${sg}
Changes: total ${ch.total ?? 0}, emergency ${ch.emergency ?? 0} (tgt <5%), normal ${ch.normal ?? 0}, std ${ch.standard ?? 0}, success ${ch.successful ?? 0}, failed ${ch.failed ?? 0}
P1 Incidents: ${inc.p1 ?? 0}, P3: ${inc.p3 ?? inc.p2 ?? 0}
Incident details: ${inc.lines || 'None'}
SLA: ${h.slaComp ?? 'N/A'}%

Return JSON (no markdown):
{"sla": "• status\\n• root cause\\n• action",
 "changeManagement": "• volume & type\\n• risk\\n• action",
 "majorIncidents": "• stability status\\n• impact\\n• follow-up"}`,
  }];

  const prompt3Messages = [{
    role: 'user',
    content: `${BI}
${sg}
CSAT: ${cs.csatPct ?? 'N/A'}% (tgt >=80%) | NPS: ${cs.nps ?? 'N/A'} (tgt >=30)
Avg rating: ${cs.avgRating ?? 'N/A'}/5 | Responses: ${cs.totalResponses ?? 'N/A'}
Trend: ${cs.trend || 'none'}

Return JSON (no markdown):
{"csat": "• score vs target\\n• trend\\n• pain point\\n• action"}`,
  }];

  const prompt4Messages = [{
    role: 'user',
    content: `${BI}
${sg}
${payload.categoryBreakdown || 'No data'}

Return JSON (no markdown):
{"ticketDist": "• top category\\n• channel trend\\n• SLA issue\\n• priority action"}`,
  }];

  const prompt5Messages = [{
    role: 'user',
    content: `${BI}
${sg}
${payload.ageing || 'No data'}
SLA: ${h.slaComp ?? 'N/A'}% | Open backlog: ${h.openBacklog ?? 'N/A'}

Return JSON (no markdown):
{"ageing": "• worst group\\n• root cause\\n• critical risk\\n• action"}`,
  }];

  return { prompt1Messages, prompt2Messages, prompt3Messages, prompt4Messages, prompt5Messages };
}

// ── Main generator ─────────────────────────────────────────────────────────
async function generateExecNewReport(payload, anthropicKey) {
  const { site_id, year, month, period, siteFilter } = payload;

  // 1. Gather chart data from DB
  const groups    = Array.isArray(payload.groups) ? payload.groups : [];
  const chartData = getChartData(site_id || 0, year || 2026, month || 1, groups);

  // 2. Call AI for all commentary in parallel
  const prompts = buildPrompts(payload);
  const [ai1, ai2, ai3, ai4, ai5] = await Promise.allSettled([
    callAnthropicAI(prompts.prompt1Messages, anthropicKey, 1200),
    callAnthropicAI(prompts.prompt2Messages, anthropicKey, 700),
    callAnthropicAI(prompts.prompt3Messages, anthropicKey, 400),
    callAnthropicAI(prompts.prompt4Messages, anthropicKey, 400),
    callAnthropicAI(prompts.prompt5Messages, anthropicKey, 400),
  ]);

  const r1 = ai1.status === 'fulfilled' ? ai1.value : null;
  const r2 = ai2.status === 'fulfilled' ? ai2.value : null;
  const r3 = ai3.status === 'fulfilled' ? ai3.value : null;
  const r4 = ai4.status === 'fulfilled' ? ai4.value : null;
  const r5 = ai5.status === 'fulfilled' ? ai5.value : null;

  const execComment = r1?.executiveComment || payload.savedComments?.exec || '';
  const helpdeskAI  = r1?.helpdesk         || payload.savedComments?.helpdesk || '';
  const slaAI       = r2?.sla              || payload.savedComments?.sla || '';
  const changeAI    = r2?.changeManagement  || payload.savedComments?.change || '';
  const incidentAI  = r2?.majorIncidents   || payload.savedComments?.incidents || '';
  const csatAI      = r3?.csat             || payload.savedComments?.csat || '';
  const distAI      = r4?.ticketDist       || '';
  const ageingAI    = r5?.ageing           || '';

  // 3. Build PPTX
  const pres = new PptxGenJS();
  pres.layout  = 'LAYOUT_WIDE';
  pres.author  = 'IT Operations';
  pres.title   = `Executive IT Report — ${period}`;
  pres.subject = period;

  const per = period || '';

  slideCover(pres, siteFilter || '', per, year);
  slideExecOverview(pres, payload, per, execComment);
  slideHelpdesk12m(pres, payload, chartData, per, helpdeskAI);
  slideTicketDist(pres, payload, chartData, per, distAI || helpdeskAI);
  slideSlaAgeing(pres, payload, chartData, per, ageingAI || slaAI);
  slideCsat(pres, payload, per, csatAI);
  slideChangeMgmt(pres, payload, chartData, per, changeAI);
  slideMajorIncidents(pres, payload, per, incidentAI);

  // ── Activity Tracker: slides 9 & 10 (matches Export PPTX last 2 slides) ──
  // The tracker uses LAYOUT_16x9 (10x5.625) by default. Our exec deck uses
  // LAYOUT_WIDE (13.333x7.5). Visually the tracker content will sit in the
  // upper-left 10x5.625 area of each tracker slide with whitespace at right
  // and bottom — acceptable for an internal exec report where content
  // parity matters more than slide-fill parity. The tracker slides keep
  // their own footer ("Source: IT Ops Objectives Tracker — ...") at y=5.35.
  try {
    if (trackerDb && trackerPptx && typeof trackerPptx.addTrackerSlidesTo === 'function') {
      const D = trackerDb.loadTracker();
      const sites = (D && D.activeSites) ? D.activeSites.slice(0, 5) : [];
      if (sites.length > 0) {
        await trackerPptx.addTrackerSlidesTo(pres, D, sites, year || new Date().getFullYear(), month || (new Date().getMonth() + 1));
        console.log('[exec-new-report] Activity Tracker slides 9 & 10 appended');
      } else {
        console.warn('[exec-new-report] Tracker DB has no active sites — skipping tracker slides');
      }
    } else {
      console.warn('[exec-new-report] Tracker module not available — skipping tracker slides');
    }
  } catch (trkErr) {
    // Defensive: tracker rendering must never break the main exec report.
    console.error('[exec-new-report] Tracker slide rendering failed (continuing):', trkErr.message);
  }

  return pres.write({ outputType: 'nodebuffer' });
}

module.exports = { generateExecNewReport };
