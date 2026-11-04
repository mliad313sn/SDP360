'use strict';
// C-16 (F23, F20 step) — the Group IT deck payload builder's figure core, extracted from
// public/executive-report.html (_buildExecPptxPayload) into public/lib/execDeckPayload.js, and the
// exec_deck_other_bucket switch (PO decision P4): '0' = today (top 8 categories, top 10 ageing groups,
// "Normal" changes folded into Standard); '1' = every truncated chart gets an "Other (k)" entry and the
// change-type donut shows Normal as its own slice, so the chart total always equals the KPI total.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const XP = require('../public/lib/execDeckPayload');
const rp = require('../services/reportPayload');
const cfg = require('../services/reportConfig');

const sum = (o) => Object.values(o).reduce((s, v) => s + (Number(v) || 0), 0);

test('switch: exec_deck_other_bucket defaults to "0" (today) and is a known config key', () => {
  assert.strictEqual(cfg.DEFAULTS.exec_deck_other_bucket, '0');
  assert.ok(cfg.KEYS.includes('exec_deck_other_bucket'));
  assert.strictEqual(XP.otherBucketOn('1'), true);
  for (const v of ['0', '', null, undefined, 'yes', 1]) assert.strictEqual(XP.otherBucketOn(v), v === 1, `value ${v}`);
});

test('topNWithOther: keeps the top N, folds the tail into "Other (k)" so Σ stays the total; never an Other of one key', () => {
  const list = [9, 8, 7, 6, 5, 4, 3, 2, 1, 1].map((n, i) => ({ name: 'C' + i, current: n, previous: n + 1 }));
  const out = XP.topNWithOther(list, 8);
  assert.strictEqual(out.length, 9);
  assert.deepStrictEqual(out[8], { name: 'Other (2)', current: 2, previous: 4, other: true, keys: ['C8', 'C9'] });
  assert.strictEqual(out.reduce((s, x) => s + x.current, 0), list.reduce((s, x) => s + x.current, 0));
  const nine = list.slice(0, 9);
  assert.deepStrictEqual(XP.topNWithOther(nine, 8).map((x) => x.name), nine.map((x) => x.name), 'N+1 items: all shown, no "Other (1)"');
  assert.deepStrictEqual(XP.topNWithOther(list.slice(0, 3), 8).map((x) => x.name), ['C0', 'C1', 'C2']);
});

test('changeTypeCounts.partition: one bucket per change (emergency > major > normal > standard > other), Σ = total', () => {
  const rows = ['Emergency', 'Non-Emergency', 'Major', 'Normal', 'Normal', 'Standard', 'Standard', '', 'Minor'].map((t) => ({ 'Change Type': t }));
  const c = XP.changeTypeCounts(rows); const p = c.partition;
  // 'Non-Emergency' matches the deck's whole-word rule (a hyphen is a word break) — same as today's emergency count.
  assert.deepStrictEqual(p, { Standard: 2, Normal: 2, Major: 1, Emergency: 2, Other: 2 });
  assert.strictEqual(p.Emergency, c.emergency, 'the donut Emergency slice equals the EMERGENCY tile');
  assert.strictEqual(sum(p), rows.length);
});

test('changeTypeCounts reproduces the deck counts of today (Normal folded into Standard only when no row is typed Standard)', () => {
  const noStd = ['Emergency', 'Normal', 'Normal', 'Major'].map((t) => ({ 'Change Type': t }));
  const a = XP.changeTypeCounts(noStd);
  assert.deepStrictEqual({ total: a.total, emergency: a.emergency, major: a.major, standard: a.standard }, { total: 4, emergency: 1, major: 1, standard: 2 },
    'legacy: Standard = total − emergency − major when nothing is typed Standard (Normal folded in)');
  const withStd = ['Standard', 'Normal', 'Emergency'].map((t) => ({ 'Change Type': t }));
  const b = XP.changeTypeCounts(withStd);
  assert.strictEqual(b.standard, 1, 'legacy: the Normal row vanishes from the donut when a Standard row exists');
  assert.strictEqual(b.normal, 1);
  assert.deepStrictEqual(b.partition, { Standard: 1, Normal: 1, Major: 0, Emergency: 1, Other: 0 });
});

test('mergeBrowserChanges: switch off = today\'s three slices; on = Normal slice + Other, Σ slices = changes_total', () => {
  const rows = ['Standard', 'Normal', 'Normal', 'Emergency', 'Weird'].map((t) => ({ 'Change Type': t }));
  const c = XP.changeTypeCounts(rows);
  const bc = { total: c.total, emergency: c.emergency, emergency_pct: 20, major: c.major, standard: c.standard, normal: c.normal, type_partition: c.partition };
  const off = rp.mergeBrowserChanges({}, bc, { otherBucket: false });
  assert.deepStrictEqual(off.changes_type, { Standard: 1, Major: 0, Emergency: 1 }, 'today: Normal and the unknown type are lost from the donut');
  assert.notStrictEqual(sum(off.changes_type), off.changes_total);
  const on = rp.mergeBrowserChanges({}, bc, { otherBucket: true });
  assert.deepStrictEqual(on.changes_type, { Standard: 1, Normal: 2, Major: 0, Emergency: 1, Other: 1 });
  assert.strictEqual(sum(on.changes_type), on.changes_total);
  const stale = rp.mergeBrowserChanges({}, { total: 3, emergency: 1, major: 0, standard: 2 }, { otherBucket: true });
  assert.deepStrictEqual(stale.changes_type, { Standard: 2, Major: 0, Emergency: 1 }, 'a payload without the partition keeps today\'s slices');
});

test('mergeBrowserCategories / mergeBrowserAgeing: off = top 8 / unchanged; on = top N + "Other (k)", Σ = all tickets', () => {
  const full = Array.from({ length: 11 }, (_, i) => ({ name: 'Cat' + i, current: 11 - i, previous: i % 3 }));
  const top8 = full.slice(0, 8);
  const off = rp.mergeBrowserCategories({}, { categories: top8, categories_full: full }, { otherBucket: false });
  assert.deepStrictEqual(Object.keys(off.categories), top8.map((c) => c.name));
  const on = rp.mergeBrowserCategories({}, { categories: top8, categories_full: full }, { otherBucket: true });
  assert.strictEqual(Object.keys(on.categories).length, 9);
  assert.strictEqual(Object.keys(on.categories)[8], 'Other (3)');
  assert.strictEqual(sum(on.categories), full.reduce((s, c) => s + c.current, 0));
  assert.strictEqual(sum(on.categories_prev), full.reduce((s, c) => s + c.previous, 0));
  const ageRows = Array.from({ length: 13 }, (_, i) => ({ group: 'G' + i, t0_30: 13 - i, t31_45: 1, t46_60: 0, t_over_60: 1 }));
  const aOff = rp.mergeBrowserAgeing({}, { ageing: ageRows }, { otherBucket: false });
  assert.strictEqual(Object.keys(aOff.ageing).length, 13, 'off: every group passes (render.py keeps its top 10 cut)');
  const aOn = rp.mergeBrowserAgeing({}, { ageing: ageRows }, { otherBucket: true });
  assert.strictEqual(Object.keys(aOn.ageing).length, 11);
  assert.ok(aOn.ageing['Other (3)']);
  const tot = (ag) => Object.values(ag).reduce((s, v) => s + v.total, 0);
  assert.strictEqual(tot(aOn.ageing), tot(aOff.ageing));
});

test('build(): exec_deck_other_bucket off = today\'s payload; on = other_bucket marker, Normal slice, Other bucket', async () => {
  const rdb = require('../reports-db');
  const full = Array.from({ length: 10 }, (_, i) => ({ name: 'Cat' + i, current: 10 - i, previous: 0 }));
  const payload = {
    filters: { month_name: 'July', year: 2026 },
    kpis: { total_tickets: 55, closed_tickets: 50, sla_res_pct: 90 },
    categories: full.slice(0, 8), categories_full: full,
    changes: { total: 4, emergency: 1, emergency_pct: 25, major: 0, standard: 3, normal: 2, type_partition: { Standard: 1, Normal: 2, Major: 0, Emergency: 1, Other: 0 } },
  };
  const off = await rp.build(JSON.parse(JSON.stringify(payload)));
  assert.strictEqual(off.other_bucket, undefined);
  assert.deepStrictEqual(off.changes_type, { Standard: 3, Major: 0, Emergency: 1 });
  assert.strictEqual(Object.keys(off.categories).length, 8);
  await cfg.setConfig(rdb.db, { exec_deck_other_bucket: '1' }, 'c16-test');
  try {
    const on = await rp.build(JSON.parse(JSON.stringify(payload)));
    assert.strictEqual(on.other_bucket, true);
    assert.deepStrictEqual(on.changes_type, { Standard: 1, Normal: 2, Major: 0, Emergency: 1 });
    assert.strictEqual(sum(on.changes_type), on.changes_total);
    assert.strictEqual(sum(on.categories), 55);
    assert.strictEqual(on.total, 55);
  } finally { await cfg.setConfig(rdb.db, { exec_deck_other_bucket: '0' }, 'c16-test'); }
});

test('executive-report.html uses the shared module; render.py honours the marker and draws Normal', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'executive-report.html'), 'utf8');
  assert.ok(/<script src="lib\/execDeckPayload\.js"><\/script>/.test(html), 'module loaded by the page');
  const body = html.slice(html.indexOf('function _buildExecPptxPayload()'));
  assert.ok(body.includes('ExecDeckPayload.headlineKpis('), 'deck KPIs come from the shared module');
  assert.ok(body.includes('ExecDeckPayload.changeTypeCounts('), 'deck change counts come from the shared module');
  assert.ok(body.includes('categories_full'), 'full category list sent for the Other bucket');
  const py = fs.readFileSync(path.join(ROOT, 'tools', 'exec-pptx', 'render.py'), 'utf8');
  const donut = py.slice(py.indexOf('def _draw_changes_donut'), py.indexOf('def _draw_division_donut'));
  assert.ok(donut.includes("'Normal'"), 'donut has a Normal slice (zero → not drawn, so off = today)');
  assert.ok(donut.includes("'Other'"), 'donut has an Other slice');
  const cats = py.slice(py.indexOf('def _draw_categories'), py.indexOf('def _draw_categories') + 400);
  assert.ok(cats.includes("K.get('other_bucket')"), 'categories keep the Other bar only under the marker');
  const age = py.slice(py.indexOf('def _draw_ageing'), py.indexOf('def _draw_ageing') + 700);
  assert.ok(age.includes("K.get('other_bucket')"), 'ageing keeps the Other row only under the marker');
});

test('F20 step: executive-report.html did not grow with the extraction (≤ 473 591 bytes, its size before C-16)', () => {
  const size = fs.statSync(path.join(ROOT, 'public', 'executive-report.html')).size;
  assert.ok(size <= 473591, `executive-report.html is ${size} bytes`);
});
