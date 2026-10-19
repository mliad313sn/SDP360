/**
 * generate-status-deck.js
 *
 * Produces two .pptx files from a single content model:
 *
 *   EM_SDP_Dashboard_Status_CIO_CFO_2026.pptx
 *      12 slides · editorial · briefing-mode · sparse body text
 *      (presenter narrates with the speaker notes baked in)
 *
 *   EM_SDP_Dashboard_SharePoint_2026.pptx
 *      ~18 slides · editorial · self-paced reading mode · expanded body text
 *      (no presenter, the slide body carries everything the speaker would say)
 *
 * Visual language mirrors the Endeavour Mining corporate SharePoint:
 *   - Slate-navy backgrounds for cover + dividers + closing
 *   - White content slides with slate-navy titles and orange UPPERCASE
 *     "signature callouts" — one per slide
 *   - Editorial card grids (one accent border per card, alternating
 *     orange / slate)
 *   - Calibri (broadly available, near-Franklin-Gothic feel)
 *
 * Run from the worktree root:
 *   node generate-status-deck.js
 *
 * Output lands in the worktree root.
 */
'use strict';

const path     = require('path');
const fs       = require('fs');
const PPTX     = require('pptxgenjs');

// ─── Brand tokens ─────────────────────────────────────────────────────
const SLATE_DARK  = '2F3A4A';   // titles, cover background
const SLATE       = '3A4A60';   // EDV slate (secondary)
const SLATE_MUTED = '6B7280';   // body grey
const ORANGE      = 'EF631A';   // EDV orange (signature accent)
const BLUE        = '145FAE';   // EDV blue (secondary accent)
const TEAL        = '0F766E';   // pillar tag green
const WHITE       = 'FFFFFF';
const BG_SOFT     = 'F4F5F7';   // card background

const FONT = 'Calibri';
const FONT_BOLD = 'Calibri';

// Logo file paths (white version for slate backgrounds, regular for white).
const LOGO_WHITE = path.join(__dirname, 'public', 'brand', 'edv-logo-white.png');
const LOGO_DARK  = path.join(__dirname, 'public', 'brand', 'edv-logo.png');

// Slide dimensions in inches (16:9 widescreen).
const W = 13.33;
const H = 7.5;

// ─── Helpers ──────────────────────────────────────────────────────────

/** Add a footer (page number + small wordmark) to a content slide. */
function addFooter(slide, pageNum, totalPages, footerLabel) {
  slide.addShape('rect', { x: 0, y: H - 0.30, w: W, h: 0.02, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
  slide.addText(footerLabel || 'SDP DASHBOARD · STATUS UPDATE', {
    x: 0.3, y: H - 0.25, w: 8, h: 0.20,
    fontFace: FONT, fontSize: 8, color: SLATE_MUTED, charSpacing: 2,
  });
  slide.addText(`${pageNum} / ${totalPages}`, {
    x: W - 1.3, y: H - 0.25, w: 1.0, h: 0.20, align: 'right',
    fontFace: FONT, fontSize: 8, color: SLATE_MUTED,
  });
}

/** Add the EDV mark at a small fixed size, top-left. */
function addMark(slide, dark) {
  const file = dark ? LOGO_WHITE : LOGO_DARK;
  if (fs.existsSync(file)) {
    slide.addImage({ path: file, x: 0.3, y: 0.25, w: 1.3, h: 0.45 });
  } else {
    slide.addText('ENDEAVOUR MINING', {
      x: 0.3, y: 0.30, w: 3, h: 0.35,
      fontFace: FONT_BOLD, fontSize: 11, bold: true,
      color: dark ? WHITE : SLATE_DARK, charSpacing: 2,
    });
  }
}

/** Slate title at the top of a white content slide. */
function addTitle(slide, text) {
  slide.addText(text, {
    x: 0.5, y: 0.85, w: 12.3, h: 0.7,
    fontFace: FONT_BOLD, fontSize: 30, bold: true,
    color: SLATE_DARK,
  });
}

/** Orange uppercase callout band — the "signature line" of each slide. */
function addCallout(slide, text, y) {
  const yy = y == null ? 1.7 : y;
  slide.addShape('rect', {
    x: 0.5, y: yy, w: 12.3, h: 0.55,
    fill: { color: 'FDF3EC' }, line: { color: ORANGE, width: 0.5 },
  });
  slide.addText(text.toUpperCase(), {
    x: 0.7, y: yy, w: 11.9, h: 0.55, valign: 'middle',
    fontFace: FONT_BOLD, fontSize: 14, bold: true,
    color: ORANGE, charSpacing: 3,
  });
}

/**
 * One editorial card: coloured top border + slate body title + body text.
 * Used in card grids (modules, findings, pillars, etc.)
 */
function addCard(slide, opts) {
  const { x, y, w, h, accent, title, body, label } = opts;
  // Card body
  slide.addShape('rect', { x, y, w, h, fill: { color: WHITE }, line: { color: 'E2E5EA', width: 0.5 } });
  // Top accent border
  slide.addShape('rect', { x, y, w, h: 0.06, fill: { color: accent || ORANGE }, line: { color: accent || ORANGE, width: 0 } });
  // Optional small label (pillar tag, etc.)
  if (label) {
    slide.addText(label.toUpperCase(), {
      x: x + 0.18, y: y + 0.18, w: w - 0.36, h: 0.20,
      fontFace: FONT_BOLD, fontSize: 8, color: accent || ORANGE, charSpacing: 2, bold: true,
    });
  }
  const titleY = label ? y + 0.40 : y + 0.20;
  // Only render the title element when there's actually text — an empty
  // string here was triggering PowerPoint's repair prompt.
  if (title && title.trim()) {
    slide.addText(title, {
      x: x + 0.18, y: titleY, w: w - 0.36, h: 0.45,
      fontFace: FONT_BOLD, fontSize: 12, bold: true,
      color: SLATE_DARK,
    });
  }
  if (body) {
    // If no title, body starts higher up.
    const bodyY = (title && title.trim()) ? titleY + 0.50 : titleY;
    slide.addText(body, {
      x: x + 0.18, y: bodyY, w: w - 0.36, h: h - (bodyY + 0.05 - y),
      fontFace: FONT, fontSize: 10, color: SLATE_MUTED,
      lineSpacingMultiple: 1.25,
    });
  }
}

/** Soft body paragraph block. */
function addBody(slide, x, y, w, h, text, opts) {
  slide.addText(text, {
    x, y, w, h,
    fontFace: FONT, fontSize: (opts && opts.size) || 12,
    color: (opts && opts.color) || SLATE_DARK,
    lineSpacingMultiple: (opts && opts.lh) || 1.4,
    bold: (opts && opts.bold) || false,
  });
}

/** Placeholder for a screenshot — looks intentional, not amateur. */
function addScreenshotPlaceholder(slide, x, y, w, h, label) {
  // Solid 1pt border instead of dashed — dashType on rectangles is
  // inconsistent across PowerPoint versions and was triggering repair
  // prompts on some installs.
  slide.addShape('rect', { x, y, w, h, fill: { color: 'F8F9FB' }, line: { color: 'D1D5DB', width: 1 } });
  slide.addText('SCREENSHOT', {
    x, y: y + h / 2 - 0.45, w, h: 0.30, align: 'center',
    fontFace: FONT_BOLD, fontSize: 11, bold: true,
    color: SLATE_MUTED, charSpacing: 4,
  });
  slide.addText(label, {
    x: x + 0.30, y: y + h / 2 - 0.10, w: w - 0.60, h: 0.50, align: 'center',
    fontFace: FONT, fontSize: 11, color: SLATE,
    lineSpacingMultiple: 1.3,
  });
}

// ─── Slide content model (shared between both decks) ─────────────────

const PRESENTER = '[ Presenter name · Role ]';
const PRESENT_DATE = '[ Presentation date ]';

const CONTENT = {
  cover: {
    eyebrow: 'STATUS UPDATE · CIO / CFO BRIEFING',
    title:   'SDP Dashboard',
    subtitle:'A unified operations intelligence platform',
    date:    PRESENT_DATE,
    presenter: PRESENTER,
  },
  context: {
    title:   'An IT environment under pressure.',
    callout: '70% satisfaction · 69% perceived value · industry benchmark 75%.',
    brief:   `Endeavour's 2025 InfoTech Survey put hard numbers behind what every site IT team already felt. Satisfaction with IT services improved year over year — but remained below the mining-industry benchmark. Perceived value followed the same curve.\n\nThe organisation recognises that IT delivers solid work given an investment level below industry standards and a team under-sized for the demands placed on it. Users see a partner in continuous improvement. But the foundations are not yet meeting the operational and strategic ambitions of the business.`,
    expanded: `Endeavour's 2025 InfoTech Survey put hard numbers behind what every site IT team already felt. Satisfaction with IT services improved year over year — but remained below the mining-industry benchmark of 75%. Perceived value followed the same curve at 69%.\n\nThe full picture is more nuanced. The organisation recognises that IT delivers solid work given an investment level below industry standards and a team under-sized for the functional demands placed on it. Users see a partner in continuous improvement. But the foundations are not yet meeting the operational and strategic ambitions of the business.\n\nThis status update covers what the SDP Dashboard does in response — across 11 sites, with 8 modules in production today — and what comes next.`,
    notes: `Anchor on 70% / 69% / 75%. Frame: "Doing well with too little, not failing." Sets up Slide 3 (the 5 truths) cleanly.`,
  },
  truths: {
    title:   'Five truths from the field.',
    callout: 'The foundations are not yet where the business needs them.',
    items: [
      { t: 'Network connectivity tops every list.',
        b: 'Recurring instability. Bandwidth limits. Teams and Visio struggling on operational sites, remote offices, and feasibility teams. The same complaint, from every direction.' },
      { t: 'Applications are fragmented; data is inconsistent.',
        b: 'Finance, Supply Chain, Production systems not integrated. Excel fills every gap — duplicate entries, errors, delayed decisions. Analytics adoption blocked by data quality.' },
      { t: 'Security is trusted; its delivery creates friction.',
        b: 'USB blocks, forced restarts, no predictable maintenance windows. Users do not challenge compliance — they ask for a more user-centric model.' },
      { t: 'Digital delivery capacity isn\'t keeping up.',
        b: 'Operations and Projects wait too long for new workflows, improvements, application changes. The result: shadow IT rises in the highest-pressure departments.' },
      { t: 'Adoption is throttled by training, not resistance.',
        b: 'Users want practical, bilingual, role-based training in analytics, existing tools, processes — and emerging tech including AI. Adoption is a delivery problem, not a culture problem.' },
    ],
    notes: `Walk all five quickly — they are the room's shared context. Pivot: "The IT Operations Strategy was already framing the response."`,
  },
  strategy: {
    title:   'The strategy answers in four pillars.',
    callout: 'Infrastructure · Operations · Compliance.',
    intro:   `The IT Operations Strategy frames delivery around four weighted pillars — the same frame already in place before the survey results landed. The survey sharpened the priorities within each one.`,
    pillars: [
      { code: 'P1', name: 'Network & Infrastructure', weight: '30%',
        body: 'Site connectivity, datacenter and cloud foundations, hardware refresh, change records, capacity planning.' },
      { code: 'P2', name: 'Business Partnering', weight: '35%',
        body: 'IT-on-the-ground for Operations, Projects, Finance, Supply, HR. Site IT presence, request management, demand intake, delivery cadence.' },
      { code: 'P3', name: 'Risk & Compliance', weight: '20%',
        body: 'Operational compliance — inspection routines, change governance, maintenance windows, audit-readiness.' },
      { code: 'P4', name: 'People & Development', weight: '15%',
        body: 'IT operations team capability — recruitment, role progression, certifications, local-site bench strength, bilingual practical training.' },
    ],
    notes: `Read the orange callout, walk the four cards left-to-right. ~45 sec. Then transition: "Inside this strategy, the dashboard makes execution visible."`,
  },
  platform: {
    title:   'Built on Endeavour ground.',
    callout: 'On-premise. End-to-end. Endeavour-owned.',
    brief:   `Data syncs hourly from ServiceDesk Plus / Zoho Analytics into a local SQLite store. The application runs on Endeavour-managed infrastructure, behind the IIS reverse proxy, served over internal HTTPS. No third-party cloud dependency for the core platform. No Endeavour operational data leaves Endeavour.`,
    expanded: `Data syncs hourly from ServiceDesk Plus / Zoho Analytics into a local SQLite store on the Endeavour datacenter. The application runs as a Node.js server on Endeavour-managed infrastructure, behind the IIS reverse proxy, served over internal HTTPS authenticated against the company SSO.\n\nFour SQLite databases hold all module data — Helpdesk + Sessions, IT Activity Tracker, IT Inspections, and Meetings & Council. The browser UI works on desktop and mobile.\n\nThere is no third-party cloud dependency for the core operational platform. No Endeavour operational data leaves Endeavour-managed infrastructure.`,
    notes: `CIO's "are we de-risked?" slide. Hit on-prem, Zoho is read-only sync only, no cloud dependency. Mention internal PKI HTTPS.`,
  },
  modules: {
    title:   'Eight modules. One portal.',
    callout: 'Every level has its own view. One source of truth.',
    items: [
      { code: 'P2', name: 'Helpdesk Operations Center',      desc: 'Real-time ticket visibility, SLA tracking, ageing report across all 11 sites.' },
      { code: 'P2', name: 'Site Reports · Weekly + Monthly', desc: 'Structured weekly capture from every site IT lead; automated monthly aggregation.' },
      { code: 'P2', name: 'Executive Scorecard',             desc: 'KPI snapshot, action plan, technician scorecard, change & incident view, customer voice.' },
      { code: 'P2', name: 'Executive Report Builder',        desc: 'One-click monthly board deck — built from live data, branded, EN.' },
      { code: 'P4', name: 'IT Activity Tracker',             desc: '11 sites × 31 activities × 4 pillars × 12 months. Strategy execution made visible.' },
      { code: 'P3', name: 'IT Inspections',                  desc: 'Mobile-first — 17 categories, 173 items, photos, signatures, voice notes, offline-safe.' },
      { code: 'P3', name: 'Meetings & Council Escalations',  desc: 'Signed PV per department, nested issues, actions, audit trail, theme escalation to Council.' },
      { code: 'P3', name: 'Risk Register Occurrence Export', desc: 'Monthly per-site × per-domain incident roll-up, configurable site mapping, .xlsx output.' },
    ],
    notes: `Don't read the whole table. Point to top row (reporting), bottom row (tracker, inspection, governance), and the pillar tags. ~60 sec. "Three get a closer look next."`,
  },
  spotlightOps: {
    title:   'Operations and reporting, automated.',
    callout: 'Real-time KPIs. One-click monthly reports.',
    brief:   `The day-to-day instrument for site IT and Group IT alike. Every ticket from ServiceDesk Plus flows in within the hour; SLA percentage, ageing, on-hold count and Reply / Resolution time refresh live.\n\nAbove it sits the Executive Report Builder — the monthly board deck now generates in a single click from the same underlying data. Manual compilation: replaced.`,
    expanded: `The Helpdesk Operations Center is the day-to-day instrument for site IT and Group IT alike. Every ticket from ServiceDesk Plus flows in within the hour; SLA percentage, ageing report, on-hold count, time-to-assign, first-reply and resolution timing all refresh live as the data updates.\n\nAbove it sits the Executive Report Builder — the monthly board deck now generates in a single click from the same underlying data. What previously took a full day of manual compilation each month now takes a click. The deck includes charts, KPIs, customer voice, and action items in Endeavour branding.\n\nAlso serving this lane: the Site Reports module (weekly + monthly capture from every site IT lead), the Executive Scorecard (5-tab roll-up), and the Risk Register Occurrence export (.xlsx for the operations risk register).`,
    screenshot: 'Helpdesk Operations Center — live KPI strip, ageing report,\nand top SLA violations panel',
    notes: `~90 sec. Volume: ~25k tickets/month, zero manual touch to land in dashboard. Mention Zoho hourly sync + Force Sync.`,
  },
  spotlightField: {
    title:   'Field operations, mobile-first.',
    callout: 'Paper replaced. Inspections in your pocket.',
    brief:   `IT Inspections captures structured site visits on a phone: 17 categories, 173 items, photo evidence, voice notes (push-to-talk, EN / FR), digital signatures, save-now control. Built for low connectivity — saves locally first, syncs when the network returns.\n\nIT Activity Tracker turns the four-pillar strategy into monthly delivery: 31 activities tracked per site, RAG-rated, rolled up into pillar scores and site leaderboards.`,
    expanded: `IT Inspections captures structured site visits on a phone. 17 categories. 173 items. Photo evidence on each item. Push-to-talk voice notes that recognise both English and French. Digital signatures (inspector + site witness). Save-now control with a local-first save model: the inspector can complete a full inspection underground or on a remote site with no connectivity, then sync when they return to a known network.\n\nIT Activity Tracker turns the four-pillar strategy into a monthly delivery instrument. 31 activities are tracked per site, RAG-rated, rolled up into pillar scores and site leaderboards. Each site IT lead enters their own numbers; admin sees the whole fleet. The tracker exports an Endeavour-branded PPTX status pack for any month.\n\nField IT teams stopped emailing scans of paper checklists. Photos and signatures arrive structured, end up in the dashboard automatically.`,
    screenshot: 'IT Activity Tracker (left) · IT Inspections form (right)\nshowing photo capture, voice dictation, signature pad',
    notes: `~90 sec. Headline: field IT stopped emailing paper scans. Bilingual everywhere.`,
  },
  spotlightGov: {
    title:   'Governance, structured.',
    callout: 'From site IT to Council — one thread.',
    brief:   `Every monthly departmental meeting produces a structured Procès-Verbal in the platform — site × department × month. Issues raised carry severity, category, target date, owner. Actions chain to issues. Audit trail captures every status change.\n\nWhen an issue needs to leave the department — it gets flagged escalate=1 with a Council theme. The Council view aggregates every site's escalations by theme, with one chain of evidence back to the originating PV.`,
    expanded: `Every monthly departmental meeting produces a structured Procès-Verbal (PV) in the platform — one PV per site × department × month. Issues raised in the meeting carry severity (HIGH / MEDIUM / LOW), one of 9 standardised categories, a target date, and a named champion. Actions chain to issues. Every status change writes an audit-trail entry with the actor and timestamp.\n\nWhen an issue needs to leave the department — it gets flagged escalate=1 with a Council theme. The Council view aggregates every site's escalations by theme, in one place, with one chain of evidence back to the originating PV. No re-typing. No "what was the context again?"\n\nFive operational engagements are tracked at site level: three departments per month, signed PV diffused within 48 hours, named champion per action, monthly feedback loop, escalation discipline. The platform measures all five.\n\nBilingual throughout (EN / FR for every lookup, every label). Bulk Excel import has already back-filled months of historical PVs. A "since last meeting" pre-brief diff page tells the IT coordinator exactly what carried over before they walk into the next meeting.`,
    screenshot: 'Meetings PV editor — nested issues, actions,\nand audit trail thread',
    notes: `~90 sec. Council escalation is the strategic gem. Mention bilingual, mention historical back-fill, mention "since last meeting" diff.`,
  },
  resilience: {
    title:   'Built for resilience.',
    callout: 'Data stays home. Every action is recoverable.',
    items: [
      { i: 'RBAC',              t: 'Five hierarchical roles plus four feature roles, gating every API and every UI control.' },
      { i: '100% ON-PREM',      t: 'No operational data leaves Endeavour-managed infrastructure.' },
      { i: 'AUTO-BACKUP',       t: 'Every destructive operation creates a SQLite snapshot first. Wrong delete = one-step restore.' },
      { i: 'AUDIT LOG',         t: 'Every mutation logged with actor + timestamp + cascade impact.' },
      { i: 'ACTIVE SESSIONS',   t: 'Super-admin sees who is using the dashboard in real time; can force-logout.' },
      { i: 'BILINGUAL',         t: 'UI, lookups, help, voice dictation — English and French side by side.' },
    ],
    notes: `~60 sec. Pause on auto-backup + 1-step recovery — newest layer, strongest single answer to "what if?"`,
  },
  roadmap: {
    title:   'A foundation to build on.',
    callout: 'Modular by design. The next iterations slot in.',
    columns: [
      {
        label: 'NEAR-TERM',
        sub:   'next 3–6 months · adoption + reinforcement',
        items: [
          'Site IT training rounds (drive adoption to 100 % of monthly PVs)',
          'Risk Register × Council-theme integration',
          'Automated backup retention + off-server copy',
        ],
      },
      {
        label: 'MID-TERM',
        sub:   '6–12 months · extend the operational platform',
        items: [
          'SDP Change Management module — full CAB workflow',
          'Asset / configuration inventory — the missing CMDB',
          'Network monitoring feed (addresses Survey #1)',
        ],
      },
      {
        label: 'LONG-TERM',
        sub:   '12 + months · close the strategy loop',
        items: [
          'Demand intake & digital delivery dashboard (Survey #4)',
          'Local IT bench-strength + certification tracker (Pillar P4)',
          'Capacity planning module (Pillar P1)',
        ],
      },
    ],
    notes: `~90 sec. Frame the column shift as "from adoption to platform reach." Each candidate stays inside the IT Operations perimeter. Closer: "Nothing here requires re-platforming."`,
  },
  closing: {
    eyebrow:   'CLOSING',
    callout:   'The work now is adoption.',
    lines: [
      '**One platform** for IT operations across 11 sites — eight modules, one source of truth.',
      '**Live data** end-to-end — from ServiceDesk Plus to Council escalation.',
      '**Production today** — RBAC, on-prem, auto-backup, recovery, audit trail.',
    ],
    footer: 'Questions, comments, requests for access: [ contact channel ]',
    notes: `Don't read aloud. Look at the room: "The investment delivered a platform. From here, the value is in the people using it." Then take questions.`,
  },
};

// ─── Slide builders ──────────────────────────────────────────────────

function buildCover(p, mode) {
  const slide = p.addSlide();
  slide.background = { color: SLATE_DARK };
  addMark(slide, true);
  // Slim orange accent line
  slide.addShape('rect', { x: 0.5, y: 3.05, w: 1.2, h: 0.05, fill: { color: ORANGE }, line: { color: ORANGE, width: 0 } });
  // Eyebrow
  slide.addText(CONTENT.cover.eyebrow, {
    x: 0.5, y: 2.7, w: 11, h: 0.3,
    fontFace: FONT_BOLD, fontSize: 11, bold: true,
    color: ORANGE, charSpacing: 4,
  });
  // Title block
  slide.addText(CONTENT.cover.title, {
    x: 0.5, y: 3.3, w: 12.3, h: 1.4,
    fontFace: FONT_BOLD, fontSize: 60, bold: true,
    color: WHITE,
  });
  slide.addText(CONTENT.cover.subtitle, {
    x: 0.5, y: 4.6, w: 12.3, h: 0.5,
    fontFace: FONT, fontSize: 22, color: 'C2C9D6',
  });
  // Footer block
  slide.addText(`${CONTENT.cover.date}    ·    ${CONTENT.cover.presenter}`, {
    x: 0.5, y: H - 0.7, w: 12.3, h: 0.3,
    fontFace: FONT, fontSize: 12, color: 'A5ADBA',
  });
  if (mode === 'sharepoint') {
    slide.addText('Self-paced edition for SharePoint readers', {
      x: 0.5, y: H - 0.95, w: 12.3, h: 0.25,
      fontFace: FONT, fontSize: 10, italic: true, color: '8B95A8', charSpacing: 2,
    });
  }
  return slide;
}

function buildContext(p, mode, page, total) {
  const slide = p.addSlide();
  slide.background = { color: WHITE };
  addMark(slide);
  addTitle(slide, CONTENT.context.title);
  addCallout(slide, CONTENT.context.callout);
  const text = mode === 'sharepoint' ? CONTENT.context.expanded : CONTENT.context.brief;
  addBody(slide, 0.5, 2.5, 12.3, 4.3, text);
  if (mode === 'briefing') slide.addNotes(CONTENT.context.notes);
  addFooter(slide, page, total);
  return slide;
}

function buildTruths(p, mode, page, total) {
  const slide = p.addSlide();
  slide.background = { color: WHITE };
  addMark(slide);
  addTitle(slide, CONTENT.truths.title);
  addCallout(slide, CONTENT.truths.callout);
  // 5 cards in a single row (compact) for briefing,
  // or two rows (3 + 2) for SharePoint where there's more reading time.
  if (mode === 'briefing') {
    const cardW = 2.36, gap = 0.10, startX = 0.5;
    const accents = [ORANGE, SLATE, ORANGE, SLATE, ORANGE];
    CONTENT.truths.items.forEach((it, i) => {
      addCard(slide, {
        x: startX + i * (cardW + gap),
        y: 2.55, w: cardW, h: 4.2,
        accent: accents[i],
        title: it.t,
        body:  it.b,
      });
    });
  } else {
    // SharePoint layout — bigger cards, two rows
    const cardW = 4.05, gap = 0.15, startX = 0.5;
    const accents = [ORANGE, SLATE, ORANGE, SLATE, ORANGE];
    CONTENT.truths.items.forEach((it, i) => {
      const row = Math.floor(i / 3), col = i % 3;
      addCard(slide, {
        x: startX + col * (cardW + gap),
        y: 2.55 + row * 2.20,
        w: cardW, h: 2.05,
        accent: accents[i],
        title: it.t, body: it.b,
      });
    });
  }
  if (mode === 'briefing') slide.addNotes(CONTENT.truths.notes);
  addFooter(slide, page, total);
  return slide;
}

function buildStrategy(p, mode, page, total) {
  const slide = p.addSlide();
  slide.background = { color: WHITE };
  addMark(slide);
  addTitle(slide, CONTENT.strategy.title);
  addCallout(slide, CONTENT.strategy.callout);
  addBody(slide, 0.5, 2.55, 12.3, 0.7, CONTENT.strategy.intro, { size: 11, color: SLATE_MUTED });
  // 2x2 pillar grid
  const cardW = 6.05, cardH = 1.95, startX = 0.5, startY = 3.4, gap = 0.20;
  const accents = [ORANGE, SLATE, ORANGE, SLATE];
  CONTENT.strategy.pillars.forEach((p, i) => {
    const row = Math.floor(i / 2), col = i % 2;
    addCard(slide, {
      x: startX + col * (cardW + gap),
      y: startY + row * (cardH + gap),
      w: cardW, h: cardH,
      accent: accents[i],
      label: `${p.code} · ${p.weight}`,
      title: p.name,
      body: p.body,
    });
  });
  if (mode === 'briefing') slide.addNotes(CONTENT.strategy.notes);
  addFooter(slide, page, total);
  return slide;
}

function buildPlatform(p, mode, page, total) {
  const slide = p.addSlide();
  slide.background = { color: WHITE };
  addMark(slide);
  addTitle(slide, CONTENT.platform.title);
  addCallout(slide, CONTENT.platform.callout);

  // Architecture diagram — three boxes with arrows.
  const cy = 4.0;
  // Box 1 — Source
  slide.addShape('rect', { x: 0.7, y: cy - 0.6, w: 2.8, h: 1.2,
    fill: { color: BG_SOFT }, line: { color: SLATE_MUTED, width: 0.75 } });
  slide.addText('ServiceDesk Plus\nZoho Analytics', {
    x: 0.7, y: cy - 0.6, w: 2.8, h: 1.2, align: 'center', valign: 'middle',
    fontFace: FONT_BOLD, fontSize: 13, bold: true, color: SLATE_DARK,
  });
  slide.addText('read-only data source', {
    x: 0.7, y: cy + 0.65, w: 2.8, h: 0.3, align: 'center',
    fontFace: FONT, fontSize: 9, italic: true, color: SLATE_MUTED,
  });
  // Arrow 1 — simple line + triangle character (no rotated shapes —
  // PowerPoint reports those as needing repair).
  slide.addShape('line', { x: 3.55, y: cy, w: 0.85, h: 0, line: { color: ORANGE, width: 2 } });
  slide.addText('▶', {
    x: 4.30, y: cy - 0.15, w: 0.3, h: 0.3, valign: 'middle',
    fontFace: FONT_BOLD, fontSize: 14, color: ORANGE,
  });
  slide.addText('hourly sync', {
    x: 3.5, y: cy - 0.45, w: 0.95, h: 0.25, align: 'center',
    fontFace: FONT, fontSize: 8, color: ORANGE, charSpacing: 2,
  });
  // Box 2 — SDP Dashboard
  slide.addShape('rect', { x: 4.5, y: cy - 1.3, w: 4.4, h: 2.6,
    fill: { color: SLATE_DARK }, line: { color: SLATE_DARK, width: 0 } });
  // Inner header
  slide.addText('SDP DASHBOARD · ON-PREM', {
    x: 4.5, y: cy - 1.20, w: 4.4, h: 0.3, align: 'center',
    fontFace: FONT_BOLD, fontSize: 10, bold: true, color: ORANGE, charSpacing: 3,
  });
  slide.addText('Node.js + Express', {
    x: 4.5, y: cy - 0.80, w: 4.4, h: 0.35, align: 'center',
    fontFace: FONT_BOLD, fontSize: 14, bold: true, color: WHITE,
  });
  // 4 DB chips
  const dbs = ['Helpdesk + Sessions', 'IT Activity Tracker', 'IT Inspections', 'Meetings & Council'];
  dbs.forEach((db, i) => {
    const dbW = 1.95, dbH = 0.35, dbGap = 0.10;
    const row = Math.floor(i / 2), col = i % 2;
    slide.addShape('rect', {
      x: 4.7 + col * (dbW + dbGap), y: cy - 0.3 + row * (dbH + dbGap),
      w: dbW, h: dbH,
      fill: { color: '5A6B82' }, line: { color: '5A6B82', width: 0 },
    });
    slide.addText(db, {
      x: 4.7 + col * (dbW + dbGap), y: cy - 0.3 + row * (dbH + dbGap),
      w: dbW, h: dbH, align: 'center', valign: 'middle',
      fontFace: FONT, fontSize: 9, color: WHITE,
    });
  });
  slide.addText('4 SQLite databases · WAL mode', {
    x: 4.5, y: cy + 0.95, w: 4.4, h: 0.25, align: 'center',
    fontFace: FONT, fontSize: 9, italic: true, color: 'C2C9D6',
  });
  // Arrow 2 — simple line + triangle character (same fix as arrow 1).
  slide.addShape('line', { x: 8.95, y: cy, w: 0.85, h: 0, line: { color: ORANGE, width: 2 } });
  slide.addText('▶', {
    x: 9.70, y: cy - 0.15, w: 0.3, h: 0.3, valign: 'middle',
    fontFace: FONT_BOLD, fontSize: 14, color: ORANGE,
  });
  slide.addText('HTTPS · internal PKI', {
    x: 8.9, y: cy - 0.45, w: 1.2, h: 0.25, align: 'center',
    fontFace: FONT, fontSize: 8, color: ORANGE, charSpacing: 2,
  });
  // Box 3 — Browser
  slide.addShape('rect', { x: 10.1, y: cy - 0.6, w: 2.7, h: 1.2,
    fill: { color: BG_SOFT }, line: { color: SLATE_MUTED, width: 0.75 } });
  slide.addText('Browser', {
    x: 10.1, y: cy - 0.6, w: 2.7, h: 0.5, align: 'center', valign: 'middle',
    fontFace: FONT_BOLD, fontSize: 14, bold: true, color: SLATE_DARK,
  });
  slide.addText('desktop + mobile', {
    x: 10.1, y: cy + 0.05, w: 2.7, h: 0.5, align: 'center', valign: 'middle',
    fontFace: FONT, fontSize: 10, color: SLATE_MUTED,
  });

  // Body line below diagram
  const text = mode === 'sharepoint' ? CONTENT.platform.expanded : CONTENT.platform.brief;
  addBody(slide, 0.5, 5.6, 12.3, 1.4, text, { size: 11, lh: 1.4 });
  if (mode === 'briefing') slide.addNotes(CONTENT.platform.notes);
  addFooter(slide, page, total);
  return slide;
}

function buildModules(p, mode, page, total) {
  const slide = p.addSlide();
  slide.background = { color: WHITE };
  addMark(slide);
  addTitle(slide, CONTENT.modules.title);
  addCallout(slide, CONTENT.modules.callout);
  const cardW = 3.0, cardH = 1.85, startX = 0.5, startY = 2.55, gapX = 0.13, gapY = 0.15;
  const accents = [ORANGE, BLUE, ORANGE, BLUE, TEAL, ORANGE, ORANGE, ORANGE];
  CONTENT.modules.items.forEach((m, i) => {
    const row = Math.floor(i / 4), col = i % 4;
    addCard(slide, {
      x: startX + col * (cardW + gapX),
      y: startY + row * (cardH + gapY),
      w: cardW, h: cardH,
      accent: accents[i],
      label: m.code,
      title: m.name,
      body: m.desc,
    });
  });
  if (mode === 'briefing') slide.addNotes(CONTENT.modules.notes);
  addFooter(slide, page, total);
  return slide;
}

function buildSpotlight(p, mode, key, page, total) {
  const C = CONTENT[key];
  const slide = p.addSlide();
  slide.background = { color: WHITE };
  addMark(slide);
  addTitle(slide, C.title);
  addCallout(slide, C.callout);
  // Left third: body text. Right two thirds: screenshot placeholder.
  const text = mode === 'sharepoint' ? C.expanded : C.brief;
  addBody(slide, 0.5, 2.55, 4.6, 4.3, text, { size: 11, lh: 1.4 });
  addScreenshotPlaceholder(slide, 5.4, 2.55, 7.4, 4.3, C.screenshot);
  if (mode === 'briefing') slide.addNotes(C.notes);
  addFooter(slide, page, total);
  return slide;
}

function buildResilience(p, mode, page, total) {
  const slide = p.addSlide();
  slide.background = { color: WHITE };
  addMark(slide);
  addTitle(slide, CONTENT.resilience.title);
  addCallout(slide, CONTENT.resilience.callout);
  // 3x2 grid of callout cards
  const cardW = 4.05, cardH = 1.95, startX = 0.5, startY = 2.6, gap = 0.15;
  const accents = [ORANGE, BLUE, ORANGE, BLUE, ORANGE, BLUE];
  CONTENT.resilience.items.forEach((it, i) => {
    const row = Math.floor(i / 3), col = i % 3;
    addCard(slide, {
      x: startX + col * (cardW + gap),
      y: startY + row * (cardH + gap),
      w: cardW, h: cardH,
      accent: accents[i],
      label: it.i,
      title: '',  // label IS the title here for compactness
      body: it.t,
    });
  });
  if (mode === 'briefing') slide.addNotes(CONTENT.resilience.notes);
  addFooter(slide, page, total);
  return slide;
}

function buildRoadmap(p, mode, page, total) {
  const slide = p.addSlide();
  slide.background = { color: WHITE };
  addMark(slide);
  addTitle(slide, CONTENT.roadmap.title);
  addCallout(slide, CONTENT.roadmap.callout);
  const colW = 4.0, startX = 0.5, gap = 0.15, startY = 2.55, h = 4.2;
  const accents = [ORANGE, SLATE, BLUE];
  CONTENT.roadmap.columns.forEach((col, i) => {
    const x = startX + i * (colW + gap);
    // Column header — coloured strip
    slide.addShape('rect', { x, y: startY, w: colW, h: 0.30, fill: { color: accents[i] }, line: { color: accents[i], width: 0 } });
    slide.addText(col.label, {
      x: x + 0.15, y: startY, w: colW - 0.30, h: 0.30,
      valign: 'middle',
      fontFace: FONT_BOLD, fontSize: 11, bold: true, color: WHITE, charSpacing: 3,
    });
    slide.addText(col.sub, {
      x, y: startY + 0.35, w: colW, h: 0.30,
      fontFace: FONT, fontSize: 9, italic: true, color: SLATE_MUTED,
      align: 'left', valign: 'middle',
    });
    // List items
    col.items.forEach((item, j) => {
      slide.addText(`▸  ${item}`, {
        x, y: startY + 0.95 + j * 0.85, w: colW, h: 0.75,
        fontFace: FONT, fontSize: 11, color: SLATE_DARK,
        lineSpacingMultiple: 1.3,
      });
    });
  });
  if (mode === 'briefing') slide.addNotes(CONTENT.roadmap.notes);
  addFooter(slide, page, total);
  return slide;
}

function buildClosing(p, mode, page, total) {
  const slide = p.addSlide();
  slide.background = { color: SLATE_DARK };
  addMark(slide, true);
  // Eyebrow
  slide.addText(CONTENT.closing.eyebrow, {
    x: 0.5, y: 1.6, w: 11, h: 0.3,
    fontFace: FONT_BOLD, fontSize: 11, bold: true,
    color: ORANGE, charSpacing: 4,
  });
  // Big slate orange callout (dominant)
  slide.addText(CONTENT.closing.callout.toUpperCase(), {
    x: 0.5, y: 2.2, w: 12.3, h: 1.4,
    fontFace: FONT_BOLD, fontSize: 48, bold: true, color: ORANGE,
    charSpacing: 2,
  });
  // Three lines — flatten the **bold** markers and use one addText
  // call per line (the multi-run inline pattern was triggering
  // PowerPoint's repair prompt; safer to keep each line as a single
  // text block).
  CONTENT.closing.lines.forEach((line, i) => {
    // Drop the ** markers from the source text; line stays readable.
    const plain = line.replace(/\*\*/g, '');
    slide.addText(plain, {
      x: 0.7, y: 4.1 + i * 0.55, w: 12.0, h: 0.5,
      fontFace: FONT, fontSize: 15, color: WHITE,
      lineSpacingMultiple: 1.3,
    });
  });
  // Footer
  slide.addText(CONTENT.closing.footer, {
    x: 0.5, y: H - 0.6, w: 12.3, h: 0.3,
    fontFace: FONT, fontSize: 11, color: 'A5ADBA', italic: true,
  });
  if (mode === 'briefing') slide.addNotes(CONTENT.closing.notes);
  return slide;
}

// ─── Top-level builder ───────────────────────────────────────────────

function buildDeck(mode) {
  const p = new PPTX();
  p.layout = 'LAYOUT_WIDE';   // 13.33 x 7.5
  p.title  = mode === 'briefing'
    ? 'SDP Dashboard — Status Update CIO/CFO'
    : 'SDP Dashboard — SharePoint hand-off';
  p.author = 'Endeavour Mining IT';
  p.company = 'Endeavour Mining';

  // For SharePoint mode, the "spotlight" slides each get a per-module
  // expansion slide that follows them, increasing the deck from 12 → ~18.
  // Both modes use the same cover, context, truths, strategy, platform,
  // modules, resilience, roadmap, and closing slides.

  // Plan the slide order:
  const sequence = mode === 'briefing'
    ? ['cover','context','truths','strategy','platform','modules',
       'spotlightOps','spotlightField','spotlightGov',
       'resilience','roadmap','closing']
    : ['cover','context','truths','strategy','platform','modules',
       'spotlightOps','spotlightOpsExpand',
       'spotlightField','spotlightFieldExpand',
       'spotlightGov','spotlightGovExpand',
       'resilience','roadmap','closing'];

  const total = sequence.length;
  sequence.forEach((key, idx) => {
    const page = idx + 1;
    switch (key) {
      case 'cover':           buildCover(p, mode); break;
      case 'context':         buildContext(p, mode, page, total); break;
      case 'truths':          buildTruths(p, mode, page, total); break;
      case 'strategy':        buildStrategy(p, mode, page, total); break;
      case 'platform':        buildPlatform(p, mode, page, total); break;
      case 'modules':         buildModules(p, mode, page, total); break;
      case 'spotlightOps':    buildSpotlight(p, mode, 'spotlightOps',   page, total); break;
      case 'spotlightField':  buildSpotlight(p, mode, 'spotlightField', page, total); break;
      case 'spotlightGov':    buildSpotlight(p, mode, 'spotlightGov',   page, total); break;
      // SharePoint-only expansion slides — pure body-text deep-dives
      case 'spotlightOpsExpand':   buildExpand(p, 'spotlightOps',   page, total); break;
      case 'spotlightFieldExpand': buildExpand(p, 'spotlightField', page, total); break;
      case 'spotlightGovExpand':   buildExpand(p, 'spotlightGov',   page, total); break;
      case 'resilience':      buildResilience(p, mode, page, total); break;
      case 'roadmap':         buildRoadmap(p, mode, page, total); break;
      case 'closing':         buildClosing(p, mode, page, total); break;
    }
  });

  return p;
}

// SharePoint-only "expansion" slide — gives a deeper reading of one
// spotlight area in full editorial paragraphs.
function buildExpand(p, key, page, total) {
  const C = CONTENT[key];
  const slide = p.addSlide();
  slide.background = { color: WHITE };
  addMark(slide);
  // Smaller eyebrow + larger body. No callout — feels like reading on.
  slide.addText('CONTEXT · CONTINUED', {
    x: 0.5, y: 0.95, w: 12.3, h: 0.3,
    fontFace: FONT_BOLD, fontSize: 10, bold: true,
    color: ORANGE, charSpacing: 4,
  });
  slide.addText(C.title, {
    x: 0.5, y: 1.3, w: 12.3, h: 0.7,
    fontFace: FONT_BOLD, fontSize: 24, bold: true,
    color: SLATE_DARK,
  });
  addBody(slide, 0.5, 2.2, 12.3, 4.7, C.expanded, { size: 13, lh: 1.5 });
  addFooter(slide, page, total);
  return slide;
}

// ─── Run ─────────────────────────────────────────────────────────────

async function run() {
  console.log('Generating CIO/CFO briefing deck...');
  const brief = buildDeck('briefing');
  const briefPath = path.join(__dirname, 'EM_SDP_Dashboard_Status_CIO_CFO_2026.pptx');
  await brief.writeFile({ fileName: briefPath });
  console.log('  → ' + briefPath);

  console.log('Generating SharePoint hand-off deck...');
  const sp = buildDeck('sharepoint');
  const spPath = path.join(__dirname, 'EM_SDP_Dashboard_SharePoint_2026.pptx');
  await sp.writeFile({ fileName: spPath });
  console.log('  → ' + spPath);

  console.log('\nDone. Both decks written to the worktree root.');
}

run().catch(e => { console.error('FAILED:', e); process.exit(1); });
