'use strict';
// F-UX-11 — the legacy safety net (lib/pageStates.js) is loaded by the slow pages, and Helpdesk says
// "still loading" with a way out instead of spinning silently for up to 180 s.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');

test('the slow legacy pages load lib/pageStates.js exactly once', () => {
  for (const f of ['index.html', 'executive.html', 'assets.html', 'wan.html', 'meetings.html', 'inspections.html']) {
    assert.equal((read(f).match(/src="lib\/pageStates\.js"/g) || []).length, 1, f);
  }
});

test('index.html: one slowNotice call at the start of loadData; the 30 s sweep is off (its loader runs longer)', () => {
  const s = read('index.html');
  assert.match(s, /src="lib\/pageStates\.js" data-last-resort="off"/);
  assert.equal((s.match(/PageStates\.slowNotice\(/g) || []).length, 1);
  assert.match(s, /async function loadData\(\)\{\n\s+if\(window\.PageStates\)PageStates\.slowNotice/);
});

function sandbox({ overlayShown = true, lang = 'en', lastResortOff = false, stillLoading } = {}) {
  const timers = [];
  const box = { children: [], appendChild(c) { this.children.push(c); c.parent = this; } };
  const overlay = { style: { display: overlayShown ? 'flex' : 'none' } };
  const made = [];
  const document = {
    currentScript: { getAttribute: (k) => (k === 'data-last-resort' && lastResortOff ? 'off' : null) },
    documentElement: { lang },
    listeners: {}, addEventListener(t, f) { this.listeners[t] = f; },
    getElementById: (id) => (id === 'loadOverlay' ? overlay : id === 'loadMsg' ? box : made.find((m) => m.id === id) || null),
    createElement: () => { const e = { attrs: {}, setAttribute(k, v) { this.attrs[k] = v; }, querySelector: () => null, remove() {} }; made.push(e); return e; },
    querySelectorAll: () => [],
  };
  const window = {};
  vm.runInNewContext(fs.readFileSync(path.join(PUB, 'lib', 'pageStates.js'), 'utf8'), { window, document, setTimeout: (f, ms) => { timers.push({ f, ms }); return timers.length; }, location: { reload() {} } });
  return { PS: window.PageStates, timers, box, document, stillLoading };
}

test('slowNotice: after the delay, while still loading, a polite notice with keep waiting / summary link / try again', () => {
  const t = sandbox();
  t.PS.slowNotice({ after: 20000, summaryHref: 'home.html' });
  assert.equal(t.timers[0].ms, 20000);
  t.timers[0].f();
  const n = t.box.children[0];
  assert.equal(n.attrs.role, 'status');
  assert.match(n.innerHTML, /Still loading/); assert.match(n.innerHTML, /href="home.html"/); assert.match(n.innerHTML, /Try again/);
  assert.ok(!/\d+ tickets/.test(n.innerHTML), 'no figure is shown');
});

test('slowNotice: silent when the data arrived, when the page shows its own error, and French follows <html lang>', () => {
  const done = sandbox({ overlayShown: false }); done.PS.slowNotice({}); done.timers[0].f();
  assert.equal(done.box.children.length, 0);
  const err = sandbox(); err.PS.slowNotice({ stillLoading: () => false }); err.timers[0].f();
  assert.equal(err.box.children.length, 0);
  const fr = sandbox({ lang: 'fr' }); fr.PS.slowNotice({ summaryHref: 'javascript:alert(1)' }); fr.timers[0].f();
  assert.match(fr.box.children[0].innerHTML, /Chargement toujours en cours/);
  assert.match(fr.box.children[0].innerHTML, /href="home.html"/, 'an unsafe link falls back to Home');
});

test('data-last-resort="off" skips the 30 s "— not available" sweep; default keeps it', () => {
  const on = sandbox(); on.document.listeners.DOMContentLoaded();
  assert.ok(on.timers.some((x) => x.ms === 30000));
  const off = sandbox({ lastResortOff: true }); off.document.listeners.DOMContentLoaded();
  assert.ok(!off.timers.some((x) => x.ms === 30000));
});
