'use strict';

// Render test for the "Department Meetings — Monthly Status" slide added to
// the weekly deck. Confirms: (a) WITHOUT a meetings summary the deck is
// unchanged (slide skipped — backward compatible), (b) WITH one, exactly one
// extra slide is emitted carrying the KPI strip, per-department rows, RAG
// status, the "why stalled" commentary, and the 3-month trend.

const { test } = require('node:test');
const assert = require('node:assert');
const JSZip  = require('jszip');
const weekly = require('../reports-weekly-pptx');

function mkReport() {
  return {
    site_name: 'Houndé', week_label: 'W24 2026', start_date: '2026-06-09', end_date: '2026-06-15',
    infra_kpis: [], helpdesk: { group_metrics: [], comments_metrics: '', chart_data: { weeks: [], top10: [] }, selected_group: '', tech_on_break: [], techs_on_duty: 0 },
    lights: [], openChanges: [], action_items: [],
  };
}

const SUMMARY = {
  site_code: 'HGO', year: 2026, month: 6, month_label: 'Jun 2026', available: true,
  kpis: { pvs_held: 3, depts_with_pv: 3, dept_target: 3, open_issues: 7, high_open: 1, resolved_month: 4, new_month: 4, escalations_open: 1 },
  departments: [
    { department: 'Network', last_pv: '2026-06-12', pv_this_month: true, open: 4, high: 1, blocked: 0, resolved_m: 1, new_m: 2, status: 'blocked' },
    { department: 'Finance', last_pv: '2026-05-20', pv_this_month: false, open: 1, high: 0, blocked: 0, resolved_m: 0, new_m: 0, status: 'no_pv' },
    { department: 'Maintenance', last_pv: '2026-06-05', pv_this_month: true, open: 2, high: 0, blocked: 0, resolved_m: 2, new_m: 1, status: 'on_track' },
  ],
  trend: { months: ['Apr', 'May', 'Jun'], opened: [3, 4, 4], closed: [2, 3, 4] },
  commentary: 'Network: 4 issues open (1 HIGH) · Finance: no PV in Jun · 1 escalated to Council',
};

async function slideTexts(buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const perSlide = [];
  for (const n of names) {
    const xml = await zip.file(n).async('string');
    perSlide.push((xml.match(/<a:t>([\s\S]*?)<\/a:t>/g) || []).map(t => t.replace(/<\/?a:t>/g, '')).join(' '));
  }
  return perSlide;
}

test('weekly deck unchanged when no meetings summary (slide skipped)', async () => {
  const base = await slideTexts(await weekly.generateWeeklyPptx(mkReport(), null, [], []));
  const withNull = await slideTexts(await weekly.generateWeeklyPptx(mkReport(), null, [], [], null));
  assert.strictEqual(withNull.length, base.length, 'null summary must not add a slide');
});

test('passing a summary adds exactly one Department Meetings slide', async () => {
  const base = await slideTexts(await weekly.generateWeeklyPptx(mkReport(), null, [], []));
  const texts = await slideTexts(await weekly.generateWeeklyPptx(mkReport(), null, [], [], SUMMARY));
  assert.strictEqual(texts.length, base.length + 1, 'exactly one extra slide');

  const slide = texts.find(t => /Department Meetings/.test(t));
  assert.ok(slide, 'a slide titled Department Meetings exists');
  // KPI strip + month
  assert.match(slide, /Jun 2026/);
  assert.match(slide, /PVs HELD/);
  assert.match(slide, /ESCALATIONS OPEN/);
  // per-department rows + RAG pills
  assert.match(slide, /Network/);
  assert.match(slide, /Finance/);
  assert.match(slide, /BLOCKED/);
  assert.match(slide, /NO PV/);
  assert.match(slide, /ON TRACK/);
  // commentary + trend
  assert.match(slide, /WHY PROGRESS STALLED/);
  assert.match(slide, /no PV in Jun/);
  assert.match(slide, /3-month issue flow/);
});

test('empty-but-available summary does not add a slide', async () => {
  const base = await slideTexts(await weekly.generateWeeklyPptx(mkReport(), null, [], []));
  const empty = { available: true, kpis: { pvs_held: 0 }, departments: [], trend: { months: [], opened: [], closed: [] }, commentary: '' };
  const texts = await slideTexts(await weekly.generateWeeklyPptx(mkReport(), null, [], [], empty));
  assert.strictEqual(texts.length, base.length, 'no PVs + no departments → slide skipped');
});
