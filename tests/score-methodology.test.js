'use strict';
// E-G05 — docs/ops/SCORE-METHODOLOGY.md is generated from the scoring modules; a changed constant makes --check fail.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const SM = require('../tools/agent/score-methodology');

test('SCORE-METHODOLOGY.md is up to date (node tools/agent/score-methodology.js)', () => {
  assert.equal(fs.readFileSync(SM.OUT, 'utf8').replace(/\r\n/g, '\n'), SM.build());
  const r = spawnSync(process.execPath, [path.join(__dirname, '..', 'tools', 'agent', 'score-methodology.js'), '--check'], { encoding: 'utf8', env: { ...process.env, NODE_OPTIONS: '' } });
  assert.equal(r.status, 0, r.stderr);
});

test('values come from the modules: a changed weight / band / threshold changes the page', () => {
  const before = SM.build();
  const SB = require('../services/siteScoreboard'); const { POLICIES } = require('../services/kpiRag'); const S = require('../services/siteScore');
  const w = SB.WEIGHTS.helpdesk, g = POLICIES['site-score'].green, t = S.PT_THRESHOLDS[0][2];
  try {
    SB.WEIGHTS.helpdesk = 0.5; assert.notEqual(SM.build(), before, 'weight'); SB.WEIGHTS.helpdesk = w;
    POLICIES['site-score'].green = 71; assert.notEqual(SM.build(), before, 'band'); POLICIES['site-score'].green = g;
    S.PT_THRESHOLDS[0][2] = 9; assert.notEqual(SM.build(), before, 'threshold');
  } finally { SB.WEIGHTS.helpdesk = w; POLICIES['site-score'].green = g; S.PT_THRESHOLDS[0][2] = t; }
  assert.equal(SM.build(), before);
});

test('the page says nothing is certified and D-03 is open; the composite formula is quoted from the source', () => {
  const md = SM.build();
  assert.match(md, /Nothing here is certified/); assert.match(md, /D-03 — OPEN/);
  assert.ok(!/\bcertified\b(?! —)/.test(md.replace(/not certified|Nothing here is certified/g, '')), 'no positive certification claim');
  assert.equal(SM.compositeFormulaLines().length, 4);
  assert.match(md, /site_score_published_model/);
});
