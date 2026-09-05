'use strict';
// Force the sqlite backends: these suites boot the app against throwaway sqlite DBs and must stay
// green regardless of the dev .env (which points prod-like *_BACKEND=postgres).
for (const k of ['REPORTS_BACKEND','ASSETS_BACKEND','TRACKER_BACKEND','MEETINGS_BACKEND','INSPECTION_BACKEND']) process.env[k] = 'sqlite';

// PPTX smoke tests — scope S2 (weekly + all-sites monthly report decks).
// These generators take plain data objects (no DB), so we hand-build minimal
// fixtures and validate the output is a non-empty, valid .pptx with >=1 slide.

const { test } = require('node:test');
const assert = require('node:assert');
const JSZip  = require('jszip');

const weeklyPptx  = require('../reports-weekly-pptx');

async function assertValidPptx(buf, label) {
  assert.ok(Buffer.isBuffer(buf), `${label}: not a Buffer`);
  assert.ok(buf.length > 0, `${label}: empty buffer`);
  assert.strictEqual(buf.slice(0, 2).toString('latin1'), 'PK', `${label}: not a zip`);
  const zip  = await JSZip.loadAsync(buf);
  const pres = zip.file('ppt/presentation.xml');
  assert.ok(pres, `${label}: missing ppt/presentation.xml`);
  assert.match(await pres.async('string'), /sldId/, `${label}: no slides`);
}

function mkReport(over = {}) {
  return {
    site_name: 'Houndé', week_label: 'W24 2026', start_date: '2026-06-09', end_date: '2026-06-15',
    infra_kpis: [],
    helpdesk: {
      group_metrics: [], comments_metrics: '', chart_data: { weeks: [], top10: [] },
      selected_group: '', tech_on_break: [], techs_on_duty: 0,
    },
    lights: [], openChanges: [], action_items: [],
    ...over,
  };
}

test('reports-weekly-pptx — generateWeeklyPptx produces a valid deck', async () => {
  const buf = await weeklyPptx.generateWeeklyPptx(mkReport(), null, [], []);
  await assertValidPptx(buf, 'weekly');
});

test('reports-weekly-pptx — generateMonthlyPptx produces a valid deck', async () => {
  // Reuses the same per-week slide pipeline as the weekly deck + a monthly
  // infra summary slide. (generateAllSitesMonthlyPptx / generateMonthlyPptxV2
  // need much heavier fixtures — deferred.)
  const monthlyData = {
    reports: [mkReport({ week_label: 'W23 2026' }), mkReport({ week_label: 'W24 2026' })],
    pastMonths: [],
  };
  const buf = await weeklyPptx.generateMonthlyPptx(monthlyData, 'Houndé', 2026, 6);
  await assertValidPptx(buf, 'monthly');
});
