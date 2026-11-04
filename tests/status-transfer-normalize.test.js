'use strict';
// A-05 — one status vocabulary for meetings issues/actions: 'closed' (never a seeded md_statuses
// code; sent by the field app until 2026-11) is normalised to 'resolved', and an unknown stored
// code stays SELECTED in an editor instead of silently showing (and later saving) "Open".
const { test } = require('node:test');
const assert = require('node:assert');
const ST = require('../public/lib/statusTransfer');

const LIST = [{ code: 'open', name_en: 'Open' }, { code: 'in_progress', name_en: 'In progress' }, { code: 'resolved', name_en: 'Resolved' }];
const selected = (html) => (html.match(/<option value="([^"]*)" selected>/g) || []).map((m) => m.replace(/^<option value="|" selected>$/g, ''));

test('normalizeMeetingStatus maps closed, Closed, " CLOSED " to resolved', () => {
  for (const s of ['closed', 'Closed', ' CLOSED ']) assert.equal(ST.normalizeMeetingStatus(s), 'resolved');
});

test('normalizeMeetingStatus leaves the seeded codes unchanged', () => {
  for (const s of ['open', 'in_progress', 'resolved', 'cancelled', 'demand', 'helpdesk_ticket', 'blocked', 'on_hold']) assert.equal(ST.normalizeMeetingStatus(s), s);
  assert.equal(ST.normalizeMeetingStatus(' Resolved '), 'resolved');
  assert.equal(ST.normalizeMeetingStatus(null), null, 'no value stays no value');
  assert.equal(ST.normalizeMeetingStatus(''), '');
});

test('optionsHtml keeps an unknown stored code selected and labels it (legacy)', () => {
  const html = ST.optionsHtml(LIST, 'closed');
  assert.deepEqual(selected(html), ['closed']);
  assert.match(html, /<option value="closed" selected>Closed \(legacy\)<\/option>/);
  assert.equal((html.match(/<option/g) || []).length, 4);
});

test('optionsHtml with a known code selects exactly that option and adds nothing', () => {
  const html = ST.optionsHtml(LIST, 'in_progress');
  assert.deepEqual(selected(html), ['in_progress']);
  assert.equal((html.match(/<option/g) || []).length, 3);
  assert.doesNotMatch(html, /legacy/);
  assert.deepEqual(selected(ST.optionsHtml(['open', 'resolved'], 'resolved')), ['resolved'], 'plain code arrays too');
});

test('optionsHtml with an empty current code selects open (default for a new row)', () => {
  for (const cur of ['', null, undefined]) assert.deepEqual(selected(ST.optionsHtml(LIST, cur)), ['open']);
});

test('optionsHtml escapes codes and labels', () => {
  const html = ST.optionsHtml([{ code: 'open', name_en: 'Open' }], '<x>"');
  assert.doesNotMatch(html, /<x>/);
  assert.match(html, /&lt;x&gt;&quot;/);
});
