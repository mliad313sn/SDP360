'use strict';
// Step 3 (SDP-DASH-2.0) — the RAG policy registry reproduces the existing scales value for value, and
// the server modules that adopted it no longer carry their own threshold literals.
const fs = require('fs'), path = require('path');
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../public/lib/kpiRag');

test('fixed policies: boundaries are inclusive and identical to the former code', () => {
  const c = R.classify;
  assert.deepEqual([c('programme_score', 70), c('programme_score', 69.9), c('programme_score', 45), c('programme_score', 44)], ['green', 'amber', 'amber', 'red']);
  assert.deepEqual([c('composite', 75), c('composite', 74), c('composite', 55), c('composite', 54)], ['green', 'amber', 'amber', 'red']);
  assert.deepEqual([c('scoreboard', 75), c('scoreboard', 55), c('scoreboard', 54.9)], ['green', 'amber', 'red']);
  assert.deepEqual([c('meetings_compliance', 0.8), c('meetings_compliance', 0.6), c('meetings_compliance', 0.59)], ['green', 'amber', 'red']);
  assert.equal(c('programme_score', null), null);
  assert.equal(c('programme_score', ''), null);
});

test('target policies: report band ≥t / ≥0.9t, OpManager ≥t / ≥t−2, null without a target', () => {
  const c = R.classify;
  assert.deepEqual([c('availability_target', 98, 98), c('availability_target', 88.2, 98), c('availability_target', 88.1, 98)], ['green', 'amber', 'red']);
  assert.equal(c('availability_target', 99, 0), null);
  assert.equal(c('availability_target', 99, null), null);
  assert.deepEqual([c('opm_availability', 99, 99), c('opm_availability', 97, 99), c('opm_availability', 96.9, 99)], ['green', 'amber', 'red']);
  assert.throws(() => c('nope', 1));
});

test('adopted modules read the registry and keep no threshold literal of their own', () => {
  const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
  const banned = {
    'services/siteScoreboard.js': [/const G = 75/, /const A = 55/],
    'services/siteScoreboardReport.js': [/v >= 75/, /v >= 55/],
    'services/siteComposite.js': [/score >= 75/, /score >= 55/],
    'services/siteScore.js': [/score >= 70/, /score >= 45/],
    'services/deckGovernanceV2.js': [/score >= 70/, /score >= 45/],
    'services/merakiWanQuality.js': [/pct >= t \* 0\.9/],
    'services/opmAvailability.js': [/target - 2/],
    'reports-pptx-shared.js': [/tgt \* 0\.90/],
  };
  for (const [f, res] of Object.entries(banned)) {
    const src = read(f);
    assert.match(src, /kpiRag/, f + ' must read public/lib/kpiRag.js');
    for (const re of res) assert.doesNotMatch(src, re, `${f} still hard-codes ${re}`);
  }
});

test('impact table: before = current policy, after = proposal, changes counted by direction', () => {
  const { impactRows, summarise, MAPPING } = require('../tools/metrics/rag-impact');
  for (const p of Object.keys(R.POLICIES)) assert.ok(MAPPING[p], 'every current policy has a proposed home: ' + p);
  const out = impactRows([
    { site: 'A', metric: 'score.programme', policy: 'programme_score', value: 72 },    // green → amber
    { site: 'B', metric: 'score.programme', policy: 'programme_score', value: 50 },    // amber → red
    { site: 'C', metric: 'score.composite', policy: 'composite', value: 80 },          // unchanged
    { site: 'D', metric: 'meetings.engagements_score', policy: 'meetings_compliance', value: 0.78 }, // amber → green
    { site: 'E', metric: 'helpdesk.sla_res_pct', policy: 'sla_pct', value: 83 },       // red → amber (81 floor)
  ]);
  assert.deepEqual(out.map(r => `${r.before}>${r.after}`), ['green>amber', 'amber>red', 'green>green', 'amber>green', 'red>amber']);
  const s = Object.fromEntries(summarise(out).map(x => [x.metric, x]));
  assert.deepEqual([s['score.programme'].changed, s['score.programme'].down], [2, 2]);
  assert.equal(s['score.composite'].changed, 0);
  assert.equal(s['meetings.engagements_score'].up, 1);
});
