'use strict';

// The Department Meetings slide must appear on ALL FIVE report decks when a
// meetings summary is supplied: weekly, per-site monthly, weekly summary
// (weekly file) + monthly v2, all-sites monthly (monthly file). Each test
// renders with and without the summary and asserts exactly one extra
// "Department Meetings" slide when present.

const { test } = require('node:test');
const assert = require('node:assert');
const JSZip  = require('jszip');
const W = require('../reports-weekly-pptx');
const M = require('../reports-monthly-pptx');

const SUMMARY = {
  site_code: 'HGO', month_label: 'Jun 2026', available: true,
  kpis: { pvs_held: 2, depts_with_pv: 2, dept_target: 3, open_issues: 7, high_open: 1, resolved_month: 3, new_month: 5, escalations_open: 1 },
  departments: [
    { department: 'Network', last_pv: '2026-06-12', pv_this_month: true, open: 4, high: 1, resolved_m: 1, new_m: 2, status: 'blocked' },
    { department: 'Finance', last_pv: '2026-05-20', pv_this_month: false, open: 1, high: 0, resolved_m: 0, new_m: 1, status: 'no_pv' },
  ],
  trend: { months: ['Apr', 'May', 'Jun'], opened: [3, 4, 4], closed: [2, 3, 4] },
  commentary: 'Network: 4 issues open (1 HIGH) · Finance: no PV in Jun',
};

function mkReport(over = {}) {
  return {
    site_name: 'Houndé', week_label: 'W24 2026', start_date: '2026-06-09', end_date: '2026-06-15',
    infra_kpis: [], helpdesk: { group_metrics: [], comments_metrics: '', chart_data: { weeks: [], top10: [] }, selected_group: '', tech_on_break: [], techs_on_duty: 0 },
    lights: [], openChanges: [], action_items: [], ...over,
  };
}
function mkMonthly(over = {}) {
  return { reports: [mkReport()], pastMonths: [], calendar_hd: null, prev_calendar_hd: null, monthly_top10: [], history6m: [], ...over };
}

async function deptSlides(buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  let total = 0, dept = 0;
  for (const n of names) {
    total++;
    const xml = await zip.file(n).async('string');
    if (/Department Meetings/.test(xml)) dept++;
  }
  return { total, dept };
}

test('weekly deck: +1 Department Meetings slide with summary', async () => {
  const a = await deptSlides(await W.generateWeeklyPptx(mkReport(), null, [], []));
  const b = await deptSlides(await W.generateWeeklyPptx(mkReport(), null, [], [], SUMMARY));
  assert.strictEqual(a.dept, 0);
  assert.strictEqual(b.dept, 1);
  assert.strictEqual(b.total, a.total + 1);
});

test('per-site monthly deck: +1 with monthlyData.meetingsSummary', async () => {
  const a = await deptSlides(await W.generateMonthlyPptx(mkMonthly(), 'Houndé', 2026, 6));
  const b = await deptSlides(await W.generateMonthlyPptx(mkMonthly({ meetingsSummary: SUMMARY }), 'Houndé', 2026, 6));
  assert.strictEqual(a.dept, 0);
  assert.strictEqual(b.dept, 1);
});

test('weekly summary deck: +1 per site with report.meetingsSummary', async () => {
  const base = { week_label: 'W24 2026', reports: [mkReport()] };
  const withM = { week_label: 'W24 2026', reports: [mkReport({ meetingsSummary: SUMMARY })] };
  const a = await deptSlides(await W.generateWeeklySummaryPptx(base));
  const b = await deptSlides(await W.generateWeeklySummaryPptx(withM));
  assert.strictEqual(a.dept, 0);
  assert.strictEqual(b.dept, 1);
});

test('monthly v2 deck: +1 with monthlyData.meetingsSummary', async () => {
  const edits = { edited_lights: [], edited_actions: [] };
  const a = await deptSlides(await M.generateMonthlyPptxV2(mkMonthly(), 'Houndé', 2026, 6, edits, [], [], [], []));
  const b = await deptSlides(await M.generateMonthlyPptxV2(mkMonthly({ meetingsSummary: SUMMARY }), 'Houndé', 2026, 6, edits, [], [], [], []));
  assert.strictEqual(a.dept, 0);
  assert.strictEqual(b.dept, 1);
});

test('all-sites monthly deck: +1 per site with meetingsSummary', async () => {
  const mk = (withM) => [{
    site: { name: 'Houndé' }, monthlyData: mkMonthly(), edits: {}, objectives: [], yearlyData: [],
    openChanges: [], activeIncidents: [], ...(withM ? { meetingsSummary: SUMMARY } : {}),
  }];
  const a = await deptSlides(await M.generateAllSitesMonthlyPptx(mk(false), 2026, 6));
  const b = await deptSlides(await M.generateAllSitesMonthlyPptx(mk(true), 2026, 6));
  assert.strictEqual(a.dept, 0);
  assert.strictEqual(b.dept, 1);
});
