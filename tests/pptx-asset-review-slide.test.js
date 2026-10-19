'use strict';

// Parc informatique slide (2026-09-21): appended to the per-site weekly deck and to
// each site of the weekly summary deck when an applicable review is supplied —
// same four counters / order / wording as tab 5 and the weekly e-mail.

const { test } = require('node:test');
const assert = require('node:assert');
const JSZip = require('jszip');
const W = require('../reports-weekly-pptx');

function mkReport(over = {}) {
  return {
    site_name: 'Lafigue', week_label: 'W36 2026', start_date: '2026-09-06', end_date: '2026-09-12',
    infra_kpis: [], helpdesk: { group_metrics: [], comments_metrics: '', chart_data: { weeks: [], top10: [] }, selected_group: '', tech_on_break: [], techs_on_duty: 0 },
    lights: [], openChanges: [], action_items: [], ...over,
  };
}
const REVIEW = {
  applicable: true, status: 'submitted',
  counts: { no_tag: 35, no_date: 230, no_cost: null, unassigned: 213 },
  previous_counts: { no_tag: 40, no_date: 230, unassigned: 200 },
  handled_note: '5 PC étiquetés', plan_note: '',
};

async function slidesText(buf) {
  const zip = await JSZip.loadAsync(buf);
  const names = Object.keys(zip.files).filter(n => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  const out = [];
  for (const n of names) out.push(await zip.file(n).async('string'));
  return out;
}

test('weekly deck: one Parc informatique slide with the four counters in order', async () => {
  const without = await slidesText(await W.generateWeeklyPptx(mkReport(), null, [], [], null));
  const withIt = await slidesText(await W.generateWeeklyPptx(mkReport(), null, [], [], null, REVIEW));
  assert.strictEqual(withIt.length, without.length + 1);
  const parc = withIt.filter(x => /Parc informatique/.test(x));
  assert.strictEqual(parc.length, 1);
  const xml = parc[0];
  const pos = ['SANS QR CODE', 'SANS DATE', 'SANS CO', 'NON ASSIGN'].map(l => xml.indexOf(l));
  assert.ok(pos.every(p => p >= 0) && pos.every((p, i) => i === 0 || p > pos[i - 1]), 'order: QR, date, cost, user');
  assert.ok(xml.includes('>35<') && xml.includes('>213<'));
  assert.ok(xml.includes('—'), 'null count renders an em dash, not 0');
  assert.ok(xml.includes('−5 vs semaine'), 'QR code down 5 vs previous week');
  assert.ok(xml.includes('+13 vs semaine'), 'unassigned up 13');
  assert.ok(xml.includes('5 PC étiquetés'));
  assert.ok(xml.includes('non renseign'), 'empty plan note is flagged');
  assert.ok(xml.includes('figés à la soumission'));
});

test('weekly deck: no slide for a non-applicable or missing review', async () => {
  const base = (await slidesText(await W.generateWeeklyPptx(mkReport(), null, [], [], null))).length;
  for (const rv of [null, { applicable: false }, { applicable: 0, counts: {} }]) {
    const n = (await slidesText(await W.generateWeeklyPptx(mkReport(), null, [], [], null, rv))).length;
    assert.strictEqual(n, base);
  }
});

test('weekly summary deck: slide per site that carries assetReviewPptx', async () => {
  const data = { week_label: 'W36 2026', start_date: '2026-09-06', end_date: '2026-09-12',
    reports: [mkReport({ assetReviewPptx: REVIEW }), mkReport({ site_name: 'Mana' })] };
  const xs = await slidesText(await W.generateWeeklySummaryPptx(data));
  assert.strictEqual(xs.filter(x => /Parc informatique/.test(x)).length, 1);
});

test('effort strip: score, rank and 30-day change; absent when no score', async () => {
  const withEffort = { ...REVIEW, effort: { score: 72, rank: 2, of: 7, delta: -4 } };
  const xml = (await slidesText(await W.generateWeeklyPptx(mkReport(), null, [], [], null, withEffort))).find(x => /Parc informatique/.test(x));
  assert.ok(xml.includes('SCORE DE TENUE DU PARC') && xml.includes('72/100'));
  assert.ok(xml.includes('rang 2 sur 7 sites'));
  assert.ok(xml.includes('− 4 pts sur 30 jours') || xml.includes('−4 pts sur 30 jours'));
  const none = (await slidesText(await W.generateWeeklyPptx(mkReport(), null, [], [], null, REVIEW))).find(x => /Parc informatique/.test(x));
  assert.ok(!none.includes('SCORE DE TENUE DU PARC'));
  const firstWeek = { ...REVIEW, previous_counts: null };
  const fw = (await slidesText(await W.generateWeeklyPptx(mkReport(), null, [], [], null, firstWeek))).find(x => /Parc informatique/.test(x));
  assert.ok(fw.includes('1re semaine mesur'));
});
