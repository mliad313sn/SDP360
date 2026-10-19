'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { buildSiteScoreboard, WEIGHTS } = require('../services/siteScoreboard');

test('WEIGHTS are the fixed 40/20/20/20 split', () => {
  assert.deepStrictEqual(WEIGHTS, { helpdesk: 0.40, inspections: 0.20, meetings: 0.20, assets: 0.20 });
});

test('all 4 present — weights bite (SML → 78 green, coverage 4/4, rank 1)', () => {
  const out = buildSiteScoreboard([
    { code: 'SML', name: 'Lafigué', helpdesk: 90, inspections: 80, meetings: 70, assets: 60 },
  ]);
  const r = out.rows[0];
  assert.strictEqual(r.score, 78); // round(36+16+14+12)
  assert.strictEqual(r.rag, 'green');
  assert.deepStrictEqual(r.coverage, { present: 4, total: 4 });
  assert.strictEqual(r.applicable, true);
  assert.strictEqual(r.rank, 1);
});

test('renormalization with 3 present (HGO → 73, coverage 3/4, assets dim null)', () => {
  const out = buildSiteScoreboard([
    { code: 'HGO', name: 'Houndé', helpdesk: 80, inspections: 60, meetings: 70, assets: null },
  ]);
  const r = out.rows[0];
  assert.strictEqual(r.score, 73); // round((32+12+14)/0.80)=round(72.5)=73
  assert.deepStrictEqual(r.coverage, { present: 3, total: 4 });
  assert.strictEqual(r.dims.assets, null);
  assert.ok(r.dims.helpdesk && r.dims.helpdesk.value === 80);
});

test('only helpdesk present → score == helpdesk (renorm of a single weight)', () => {
  const out = buildSiteScoreboard([
    { code: 'X', name: 'X', helpdesk: 64, inspections: null, meetings: null, assets: null },
  ]);
  const r = out.rows[0];
  assert.strictEqual(r.score, 64);
  assert.strictEqual(r.coverage.present, 1);
});

test('0 present → non applicable (score/rag null, applicable false, coverage 0/4)', () => {
  const out = buildSiteScoreboard([
    { code: 'Z', name: 'Z', helpdesk: null, inspections: null, meetings: null, assets: null },
  ]);
  const r = out.rows[0];
  assert.strictEqual(r.score, null);
  assert.strictEqual(r.rag, null);
  assert.strictEqual(r.applicable, false);
  assert.deepStrictEqual(r.coverage, { present: 0, total: 4 });
  assert.strictEqual(r.rank, null);
});

test('per-dim RAG at boundaries (75 green, 55 amber, 54 red)', () => {
  const g = buildSiteScoreboard([{ code: 'A', name: 'A', helpdesk: 75, inspections: null, meetings: null, assets: null }]).rows[0];
  assert.strictEqual(g.dims.helpdesk.rag, 'green');
  const a = buildSiteScoreboard([{ code: 'B', name: 'B', helpdesk: 55, inspections: null, meetings: null, assets: null }]).rows[0];
  assert.strictEqual(a.dims.helpdesk.rag, 'amber');
  const r = buildSiteScoreboard([{ code: 'C', name: 'C', helpdesk: 54, inspections: null, meetings: null, assets: null }]).rows[0];
  assert.strictEqual(r.dims.helpdesk.rag, 'red');
});

test('rank + ties: equal scores by code asc, higher first, non-applicable excluded', () => {
  const out = buildSiteScoreboard([
    { code: 'BBB', name: 'BBB', helpdesk: 60, inspections: null, meetings: null, assets: null }, // 60
    { code: 'AAA', name: 'AAA', helpdesk: 60, inspections: null, meetings: null, assets: null }, // 60
    { code: 'HII', name: 'HII', helpdesk: 90, inspections: null, meetings: null, assets: null }, // 90
    { code: 'ZZZ', name: 'ZZZ', helpdesk: null, inspections: null, meetings: null, assets: null }, // n/a
  ]);
  const byCode = Object.fromEntries(out.rows.map(r => [r.code, r]));
  assert.strictEqual(byCode.HII.rank, 1);
  assert.strictEqual(byCode.AAA.rank, 2); // tie 60 → code asc
  assert.strictEqual(byCode.BBB.rank, 3);
  assert.strictEqual(byCode.ZZZ.rank, null);
  // fleet_avg excludes non-applicable → mean(90,60,60)=70
  assert.strictEqual(out.fleet_avg, 70);
});

test('delta from prev (SML 78 vs prev 74 → +4; absent from prev → null)', () => {
  const out = buildSiteScoreboard(
    [
      { code: 'SML', name: 'Lafigué', helpdesk: 90, inspections: 80, meetings: 70, assets: 60 }, // 78
      { code: 'HGO', name: 'Houndé', helpdesk: 80, inspections: 60, meetings: 70, assets: null }, // 73, no prev
    ],
    { prev: { SML: { helpdesk: 80, inspections: 80, meetings: 70, assets: 60 } } } // prev SML = 74
  );
  const byCode = Object.fromEntries(out.rows.map(r => [r.code, r]));
  assert.strictEqual(byCode.SML.delta, 4);
  assert.strictEqual(byCode.HGO.delta, null);
});

test('most_improved / needs_attention / fleet_avg', () => {
  const out = buildSiteScoreboard(
    [
      { code: 'SML', name: 'Lafigué', helpdesk: 90, inspections: 80, meetings: 70, assets: 60 }, // 78, +4
      { code: 'RED', name: 'RedSite', helpdesk: 40, inspections: 40, meetings: 40, assets: 40 }, // 40, red, delta null
      { code: 'NA', name: 'NaSite', helpdesk: null, inspections: null, meetings: null, assets: null }, // n/a
    ],
    { prev: { SML: { helpdesk: 80, inspections: 80, meetings: 70, assets: 60 } } } // prev SML 74
  );
  assert.strictEqual(out.most_improved.code, 'SML');
  assert.strictEqual(out.needs_attention.code, 'RED'); // only red applicable
  assert.strictEqual(out.fleet_avg, 59); // round(mean(78,40))=round(59)=59
});

test('most_improved null when no positive delta; needs_attention null when none red', () => {
  const out = buildSiteScoreboard([
    { code: 'AAA', name: 'AAA', helpdesk: 80, inspections: 80, meetings: 80, assets: 80 }, // 80, no prev → delta null
  ]);
  assert.strictEqual(out.most_improved, null);
  assert.strictEqual(out.needs_attention, null);
});

test('needs_attention tie broken by code asc', () => {
  const out = buildSiteScoreboard([
    { code: 'BBB', name: 'BBB', helpdesk: 30, inspections: null, meetings: null, assets: null }, // 30
    { code: 'AAA', name: 'AAA', helpdesk: 30, inspections: null, meetings: null, assets: null }, // 30
  ]);
  assert.strictEqual(out.needs_attention.code, 'AAA');
});

test('fleet_avg null when none applicable', () => {
  const out = buildSiteScoreboard([
    { code: 'Z', name: 'Z', helpdesk: null, inspections: null, meetings: null, assets: null },
  ]);
  assert.strictEqual(out.fleet_avg, null);
});

test('clamp: helpdesk 120 → 100', () => {
  const out = buildSiteScoreboard([
    { code: 'C', name: 'C', helpdesk: 120, inspections: null, meetings: null, assets: null },
  ]);
  const r = out.rows[0];
  assert.strictEqual(r.dims.helpdesk.value, 100);
  assert.strictEqual(r.score, 100);
});
