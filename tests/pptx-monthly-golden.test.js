'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Golden structural-fingerprint tests for the report PPTX generators.
//
// WHY: reports-weekly-pptx.js and reports-monthly-pptx.js share a family of
// helpers (statusColor / trendColor / trendArrow / computeTrends /
// autoStatusColor, …) that have historically been *copied* between the two
// files. Before deduplicating any of that shared code we lock the CURRENT
// rendered output of every live deck, so a refactor cannot silently change a
// slide.
//
// HOW: seed a throwaway SQLite DB (SDP_DATA_DIR) with a realistic site + two
// submitted weekly reports (varied RAG status / trend to exercise every
// helper branch), then drive the FIVE generators the server actually calls:
//   reports-weekly-pptx.js :  generateWeeklyPptx, generateMonthlyPptx,
//                             generateWeeklySummaryPptx
//   reports-monthly-pptx.js:  generateMonthlyPptxV2, generateAllSitesMonthlyPptx
// Each deck is reduced to a stable fingerprint (per-slide text runs + shape /
// picture / chart counts) and compared to a committed golden JSON.
//
// To (re)generate the golden after an INTENTIONAL visual change:
//   GOLDEN_UPDATE=1 node --test --test-force-exit tests/pptx-monthly-golden.test.js
// The fingerprint ignores zip byte-layout (we parse the OOXML, not the zip),
// so it is deterministic run-to-run.
// ─────────────────────────────────────────────────────────────────────────

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs    = require('fs');
const os    = require('os');
const path  = require('path');
const JSZip = require('jszip');

process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR
  || fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-pptx-golden-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';
process.env.TRACKER_PER_YEAR_EDITS = process.env.TRACKER_PER_YEAR_EDITS || '1';

const rdb = require('../reports-db');
const W   = require('../reports-weekly-pptx');
const M   = require('../reports-monthly-pptx');

const GOLDEN_DIR  = path.join(__dirname, '__golden__');
const GOLDEN_FILE = path.join(GOLDEN_DIR, 'pptx-fingerprint.json');

const YEAR = 2026, MONTH = 6;
let SITE, monthlyData, edits, objectives, yearlyData;

// ── fingerprint a .pptx buffer into a stable structural shape ──────────────
async function fingerprint(buf) {
  assert.ok(Buffer.isBuffer(buf) && buf.length > 0, 'empty buffer');
  assert.strictEqual(buf.slice(0, 2).toString('latin1'), 'PK', 'not a zip');
  const zip = await JSZip.loadAsync(buf);
  const slideNames = Object.keys(zip.files)
    .filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => {
      const na = parseInt(a.match(/slide(\d+)\.xml/)[1], 10);
      const nb = parseInt(b.match(/slide(\d+)\.xml/)[1], 10);
      return na - nb;
    });
  const slides = [];
  for (const name of slideNames) {
    const xml = await zip.file(name).async('string');
    const texts = (xml.match(/<a:t>([\s\S]*?)<\/a:t>/g) || [])
      .map(t => t.replace(/<\/?a:t>/g, ''));
    slides.push({
      shapes: (xml.match(/<p:sp>/g) || []).length,
      pics:   (xml.match(/<p:pic>/g) || []).length,
      frames: (xml.match(/<p:graphicFrame>/g) || []).length,
      textCount: texts.length,
      texts,
    });
  }
  return { slideCount: slides.length, slides };
}

before(async () => {
  // 1 site
  SITE = (await rdb.createSite({ name: 'Houndé', zoho_group: 'Hounde IT Agents', sort_order: 1 }));

  // helper: seed one submitted weekly report with varied RAG/trend so every
  // helper branch (green/orange/red + up/down/stable + numeric/stored color)
  // is exercised by the generators.
  async function seedWeek(week, label) {
    const rep = (await rdb.ensureReport(SITE.id, YEAR, week));
    (await rdb.saveInfraKpis(rep.id, [
      { service: 'WAN1 Houndé', kpi: 'Uptime', target: '98%', status_value: '99.4', status_color: 'green',  trend: 'up' },
      { service: 'WAN2 Houndé', kpi: 'Uptime', target: '98%', status_value: '95.8', status_color: 'orange', trend: 'down' },
      { service: 'LAN Houndé',  kpi: 'Uptime', target: '99%', status_value: '88.0', status_color: 'red',    trend: 'down' },
      { service: 'Servers',     kpi: 'Availability', target: '99%', status_value: '100', status_color: 'green', trend: 'stable' },
      { service: 'Backup',      kpi: 'Success Rate', target: '100%', status_value: 'N/A', status_color: 'none', trend: 'stable' },
    ]));
    (await rdb.saveHelpdeskData(rep.id, {
      time_to_assign: 0.5, first_reply: 1.17, resolution_time: 4.33, closing_time: 6,   // hours (double precision columns)
      techs_on_duty: 4, tech_on_break: 'None',
      comments_metrics: 'Stable week, no major escalation.',
      selected_group: 'Hounde IT Agents',
      group_metrics: [{ label: label, inbound: 60, closed: 58 }],
      chart_data: { weeks: [{ label: 'W' + (week - 1), inbound: 55, closed: 50 }, { label: label, inbound: 60, closed: 58 }], top10: [] },
    }));
    (await rdb.saveLights(rep.id, [
      { type: 'high', content: 'Backup success restored to 100%.' },
      { type: 'low',  content: 'WAN2 degraded link under investigation with ISP.' },
    ]));
    (await rdb.saveActionItems(rep.id, [
      { task: 'Replace WAN2 router', priority: 'High', due_date: '2026-06-30', owner: 'IT Houndé', status: 'in_progress', department: 'Network', comment: 'RMA pending' },
      { task: 'Review backup retention', priority: 'Medium', due_date: '2026-07-15', owner: 'IT Houndé', status: 'open', department: 'Systems', comment: '' },
    ]));
    (await rdb.updateReportStatus(rep.id, 'submitted', 1));
    return rep;
  }

  (await seedWeek(23, 'W23 2026'));
  (await seedWeek(24, 'W24 2026'));

  // monthly edits + annual objectives (consumed by the V2 / all-sites decks)
  (await rdb.saveMonthlyEdits(SITE.id, YEAR, MONTH, {
    edited_lights:  [{ type: 'high', content: 'Month highlight: SLA recovered.' }, { type: 'low', content: 'WAN2 still flaky.' }],
    edited_actions: [{ task: 'Finalise WAN2 RMA', priority: 'High', due_date: '2026-06-30', owner: 'IT Houndé', status: 'in_progress', department: 'Network', comment: '' }],
    notes: 'Monthly rollup notes.', status: 'draft',
  }));
  (await rdb.saveAnnualObjectives(SITE.id, YEAR, [
    { objective: 'Migrate site to redundant WAN', target: 'Q3', status: 'in_progress', progress: 60 },
    { objective: 'Backup DR test', target: 'Q2', status: 'done', progress: 100 },
  ]));

  monthlyData = (await rdb.getMonthlyData(SITE.id, YEAR, MONTH));
  edits       = (await rdb.getMonthlyEdits(SITE.id, YEAR, MONTH));
  objectives  = (await rdb.getAnnualObjectives(SITE.id, YEAR));
  yearlyData  = (await rdb.getYearlySummary(SITE.id, YEAR));

  assert.ok(monthlyData.reports.length >= 2, `expected >=2 weekly reports in month, got ${monthlyData.reports.length}`);
});

// ── render every live deck → fingerprint ───────────────────────────────────
async function buildAll() {
  const weekly = monthlyData.reports[monthlyData.reports.length - 1];
  const summaryData = {
    week_label: 'W24 2026',
    reports: monthlyData.reports.map(r => ({ ...r, openChanges: [], activeIncidents: [] })),
  };
  const allData = [{
    site: SITE, monthlyData, edits, objectives, yearlyData,
    openChanges: [], activeIncidents: [],
  }];

  return {
    weekly:        await fingerprint(await W.generateWeeklyPptx(weekly, null, [], [])),
    monthlyPerSite:await fingerprint(await W.generateMonthlyPptx(monthlyData, SITE.name, YEAR, MONTH)),
    weeklySummary: await fingerprint(await W.generateWeeklySummaryPptx(summaryData)),
    monthlyV2:     await fingerprint(await M.generateMonthlyPptxV2(monthlyData, SITE.name, YEAR, MONTH, edits, objectives, yearlyData, [], [])),
    allSitesMonthly: await fingerprint(await M.generateAllSitesMonthlyPptx(allData, YEAR, MONTH)),
  };
}

test('report PPTX decks match the committed golden fingerprint', async () => {
  const actual = await buildAll();

  if (process.env.GOLDEN_UPDATE === '1' || !fs.existsSync(GOLDEN_FILE)) {
    fs.mkdirSync(GOLDEN_DIR, { recursive: true });
    fs.writeFileSync(GOLDEN_FILE, JSON.stringify(actual, null, 2));
    console.log(`[golden] wrote ${GOLDEN_FILE} (${Object.keys(actual).length} decks)`);
    // Still assert each deck is structurally sane.
    for (const [k, v] of Object.entries(actual)) {
      assert.ok(v.slideCount >= 1, `${k}: golden has no slides`);
    }
    return;
  }

  const golden = JSON.parse(fs.readFileSync(GOLDEN_FILE, 'utf8'));
  for (const deck of Object.keys(golden)) {
    assert.deepStrictEqual(
      actual[deck], golden[deck],
      `deck "${deck}" drifted from golden — if intentional, re-run with GOLDEN_UPDATE=1`
    );
  }
  // also catch a NEW deck that isn't in the golden yet
  for (const deck of Object.keys(actual)) {
    assert.ok(golden[deck], `deck "${deck}" is new — re-run with GOLDEN_UPDATE=1`);
  }
});
