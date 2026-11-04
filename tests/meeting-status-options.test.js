'use strict';
// A-05 — every meetings status <select> keeps the STORED code selected (StatusTransfer.optionsHtml),
// and the field app no longer sends the unseeded 'closed' code for a meetings action.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { fnSource } = require('./_fn-source');
const read = (p) => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

test('meeting.html actionRow builds its status options with StatusTransfer.optionsHtml', () => {
  const src = fnSource(read('public/meeting.html'), 'actionRow');
  assert.match(src, /StatusTransfer\.optionsHtml\(/);
  assert.doesNotMatch(src, /\(a\.status \|\| 'open'\) === s\.code/);
});

test('meeting.html issueRow builds its status options with StatusTransfer.optionsHtml', () => {
  const src = fnSource(read('public/meeting.html'), 'issueRow');
  assert.match(src, /StatusTransfer\.optionsHtml\(/);
  assert.doesNotMatch(src, /\(iss\.status \|\| 'open'\) === s\.code/);
});

test('the register pages keep the stored status selected too', () => {
  for (const [file, fn] of [['public/meetings-actions.html', 'statusCell'], ['public/meetings-issues.html', 'statusCell'], ['public/site-actions.html', 'issueStatusCell']]) {
    assert.match(fnSource(read(file), fn), /optionsHtml\(/, file + ' ' + fn);
  }
});

test('field app.js no longer sends the literal closed as a meetings close value', () => {
  const app = read('public/field/app.js');
  assert.doesNotMatch(app, /'closed'/);
  assert.match(app, /closeVal = a\.source === 'inspection' \? 'Closed' : 'resolved'/);
});

test('field sw.js CACHE_VERSION was bumped past field-v2', () => {
  const sw = read('public/field/sw.js');
  assert.doesNotMatch(sw, /CACHE_VERSION = 'field-v[12]'/);
  assert.match(sw, /CACHE_VERSION = 'field-v\d+'/);
});
