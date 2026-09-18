'use strict';
// Static + mini-DOM checks on public/reports.html (the page is behind a session,
// so the browser check stays an owner step). Proves: the 5th weekly tab exists
// inside the WEEKLY strip only, the done-count reads the weekly strip (the old
// '.stab.done' matched nothing), auto-ready needs 5, and tab 4 is never ticked
// by a plain save.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'reports.html'), 'utf8');

function fnSource(name) {
  const start = src.indexOf(`async function ${name}(`) >= 0 ? src.indexOf(`async function ${name}(`) : src.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} not found`);
  const end = src.indexOf('\n}\n', start);
  return src.slice(start, end + 2);
}

test('weekly strip has stab-4 "5 · Parc informatique"; monthly strip untouched', () => {
  const weekly = src.slice(src.indexOf('id="section-tabs"'), src.indexOf('<!-- Section 0'));
  assert.match(weekly, /id="stab-4"[^>]*>5 · Parc informatique</);
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
