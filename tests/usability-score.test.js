'use strict';
// E-U01 — usability scoring tool: blank = UNKNOWN, SUS arithmetic, column mismatch refused.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const U = require('../tools/pilot/usability-score');

const H = U.T1_T8_HEADER.join(',');
const row = (o) => U.T1_T8_HEADER.map((k) => (o[k] == null ? '' : `"${String(o[k]).replace(/"/g, '""')}"`)).join(',');

test('the shipped empty T1-T8 sheet is accepted and every figure is UNKNOWN', () => {
  const csv = fs.readFileSync(path.join(__dirname, '..', 'docs/ops/pilot/T1-T8-SHEET.csv'), 'utf8');
  const r = U.scoreTasks(csv);
  assert.equal(r.template, 'T1-T8');
  assert.equal(r.groups.length, 8);
  for (const g of r.groups) {
    assert.equal(g.completion_rate_pct, null);
    assert.equal(g.median_time_seconds, null);
    assert.equal(g.errors_total, null);
    assert.equal(g.help_given, null);
    assert.equal(g.completion_unknown, 1);
  }
  assert.match(U.renderMarkdown(r, null), /UNKNOWN/);
});

test('blank cells are excluded from rates, never counted as 0 or failure', () => {
  const csv = [H,
    row({ task: 'T1', role: 'Site IT', completion: 'yes', time_seconds: '60', errors: '0', help_given: 'no' }),
    row({ task: 'T1', role: 'Site IT', completion: 'no', time_seconds: '120', errors: '2', help_given: 'yes' }),
    row({ task: 'T1', role: 'Site IT', completion: '', time_seconds: '', errors: '', help_given: '' }),
    row({ task: 'T1', role: 'Site IT', completion: 'with help', time_seconds: '90' }),
  ].join('\n');
  const g = U.scoreTasks(csv).groups[0];
  assert.equal(g.rows, 4);
  assert.equal(g.completion_known, 3);
  assert.equal(g.completion_unknown, 1);
  assert.equal(g.completion_rate_pct, 33.3);
  assert.equal(g.completed_with_help, 1);
  assert.equal(g.median_time_seconds, 90);
  assert.equal(g.errors_total, 2);
  assert.equal(g.errors_known, 2);
  assert.equal(g.help_given, 1);
  assert.equal(g.help_known, 2);
});

test('groups are split by task x role', () => {
  const csv = [H, row({ task: 'T7', role: 'any', completion: 'yes' }), row({ task: 'T7', role: 'Executive', completion: 'no' })].join('\n');
  assert.equal(U.scoreTasks(csv).groups.length, 2);
});

test('a sheet whose columns differ is refused', () => {
  const bad = U.T1_T8_HEADER.slice(); bad.splice(12, 1); // time_seconds removed → shifted columns
  assert.throws(() => U.scoreTasks(bad.join(',') + '\n'), /columns differ/);
  const reordered = U.T1_T8_HEADER.slice(); [reordered[12], reordered[13]] = [reordered[13], reordered[12]];
  assert.throws(() => U.scoreTasks(reordered.join(',') + '\n'), /refused/);
});

test('SUS arithmetic follows SUS-FORM.md; an unanswered item = incomplete, no score', () => {
  assert.deepEqual(U.susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1]), { score: 100, incomplete: false });
  assert.deepEqual(U.susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5]), { score: 0, incomplete: false });
  assert.deepEqual(U.susScore([3, 3, 3, 3, 3, 3, 3, 3, 3, 3]), { score: 50, incomplete: false });
  assert.deepEqual(U.susScore([4, 2, 4, 2, 4, 2, 4, 2, 4, '']), { score: null, incomplete: true });
  assert.deepEqual(U.susScore([4, 2, 4, 2, 4, 2, 4, 2, 4, 9]), { score: null, incomplete: true });
});

test('SUS sheet: per participant, per role mean/median, incomplete not counted', () => {
  const csv = [U.SUS_HEADER.join(','),
    'P01,Site IT,5,1,5,1,5,1,5,1,5,1',
    'P02,Site IT,3,3,3,3,3,3,3,3,3,3',
    'P03,Site IT,3,3,3,,3,3,3,3,3,3',
    'P04,Executive,4,2,4,2,4,2,4,2,4,2'].join('\n');
  const s = U.scoreSus(csv);
  const site = s.roles.find((r) => r.role === 'Site IT');
  assert.equal(site.questionnaires, 3);
  assert.equal(site.complete, 2);
  assert.equal(site.mean, 75);
  assert.equal(s.participants.find((p) => p.participant_code === 'P03').score, null);
  assert.equal(s.overall.complete, 3);
  assert.throws(() => U.scoreSus('participant_code,role,q1\n'), /columns differ/);
});

test('T9-T12 template carries accuracy; blank answer_correct = UNKNOWN', () => {
  const hdr = U.T9_T12_HEADER;
  const r = (o) => hdr.map((k) => o[k] || '').join(',');
  const csv = [hdr.join(','), r({ task: 'T9', role: 'Executive', answer_correct: 'yes', completion: 'yes' }),
    r({ task: 'T9', role: 'Executive', answer_correct: '' })].join('\n');
  const g = U.scoreTasks(csv).groups[0];
  assert.equal(g.accuracy_pct, 100);
  assert.equal(g.accuracy_known, 1);
});

test('CLI main renders md and json, needs an input', () => {
  assert.throws(() => U.main([]), /usage/);
  const p = path.join(__dirname, '..', 'docs/ops/pilot/T1-T8-SHEET.csv');
  assert.match(U.main([`--sheet=${p}`]), /Usability scores/);
  assert.equal(JSON.parse(U.main([`--sheet=${p}`, '--format=json'])).tasks.template, 'T1-T8');
});
