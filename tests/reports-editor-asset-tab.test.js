'use strict';
// Static + mini-DOM checks on public/reports.html (the page is behind a session,
// so the browser check stays an owner step). Proves: the 5th weekly tab exists
// inside the WEEKLY strip only, the done-count reads the weekly strip (the old
// '.stab.done' matched nothing), auto-ready needs 5, and tab 4 is never ticked
// by a plain save.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const { fnSource: sliceFn } = require('./_fn-source');
// Normalised to LF: a Windows checkout materialises the page as CRLF (core.autocrlf),
// which used to make the extraction below return an empty string — and an empty string
// makes every negative assertion in this file pass vacuously. See tests/fn-source.test.js.
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'reports.html'), 'utf8').replace(/\r\n/g, '\n');

const fnSource = (name) => sliceFn(src, name);

test('weekly strip has stab-4 "5. Parc informatique"; monthly strip untouched', () => {
  const weekly = src.slice(src.indexOf('id="section-tabs"'), src.indexOf('<!-- Section 0'));
  assert.match(weekly, /id="stab-4"[^>]*>5\. Parc informatique</);
  assert.ok(src.includes('id="section-4"'));
  assert.ok(src.includes('id="mr-stab-4"'), 'monthly Annual Objectives tab still there');
});

test("no '.stab.done' selector remains", () => {
  assert.ok(!src.includes(".stab.done"), 'the dead selector must be gone');
});

test('_afterSectionSaved counts the weekly strip only and needs 5 for ready', async () => {
  const code = fnSource('_afterSectionSaved');
  const calls = [];
  const tabs = {};
  const document = {
    getElementById: (id) => (tabs[id] = tabs[id] || { cls: new Set(), classList: { add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); } } }, tabs[id].classList._s = tabs[id].cls, tabs[id]),
    querySelectorAll: (sel) => { calls.push(sel); return { length: sel === '#section-tabs .section-tab.done' ? 5 : 99 }; },
  };
  let status = null;
  const api = async (m, p, b) => { status = b.status; };
  const currentReport = { id: 1, status: 'in_progress' };
  const updateStatusBar = () => {};
  const fn = new Function('document', 'api', 'currentReport', 'updateStatusBar', `${code}; return _afterSectionSaved;`)(document, api, currentReport, updateStatusBar);
  await fn(4);
  assert.deepStrictEqual(calls, ['#section-tabs .section-tab.done']);
  assert.strictEqual(status, 'ready');
  assert.ok(!tabs['stab-4'].cls.has('done'), 'tab 4 is not ticked by _afterSectionSaved');
});

test('showSection iterates 5 sections; autosave wires section-4', () => {
  assert.match(fnSource('showSection'), /i\s*<\s*5/);
  assert.ok(src.includes("['section-4', 4]"));
});

test('submitReport warns (but allows) when the applicable tab has an empty note', () => {
  const code = fnSource('submitReport');
  assert.ok(code.includes("n'est pas renseignée"));
  assert.ok(code.includes('confirm('));
});

// rev 5 (2026-09-18, user decision): the tab shows the four counters + the two
// notes only — no asset lists and no link into the Assets module.
test('tab 5 has no asset lists and no Assets links', () => {
  const pane = src.slice(src.indexOf('id="section-4"'), src.indexOf('<!-- Submit bar'));
  const render = fnSource('renderAssetReview');
  for (const code of [pane, render]) {
    assert.ok(!code.includes('assets.html'), 'no link to assets.html');
    assert.ok(!/voir dans Assets/i.test(code), 'no « voir dans Assets »');
    assert.ok(!code.includes('<details'), 'no collapsible list');
    assert.ok(!code.includes('<table'), 'no list table');
    assert.ok(!code.includes('d.lists'), 'does not read row lists');
    assert.ok(!/premières lignes|premières lignes/.test(code), 'no "50 premières lignes" line');
  }
  assert.ok(render.includes('previous_counts'), 'still shows the change vs previous week');
  assert.ok(render.includes('Compteurs figés'), 'still shows the frozen-counts line');
});

// 2026-09-18 (user): the optional-note hint is gone from tab 5; notes stay
// non-required and the submit confirm stays.
test('tab 5 carries no « Facultatif » hint; notes not required; confirm kept', () => {
  const pane = src.slice(src.indexOf('id="section-4"'), src.indexOf('<!-- Submit bar'));
  assert.ok(!pane.includes('Facultatif'), 'no FR hint');
  assert.ok(!/une note vide appara/.test(pane), 'no FR hint text');
  assert.ok(!/Optional[^<]*non renseign/i.test(pane), 'no EN twin');
  assert.ok(!/<textarea[^>]*required/.test(pane), 'notes stay optional');
  assert.ok(fnSource('submitReport').includes('confirm('));
});

test('the inline scripts of reports.html still parse', () => {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, n = 0;
  while ((m = re.exec(src))) { if (!m[1].trim()) continue; new Function(m[1]); n++; }
  assert.ok(n > 0);
});
