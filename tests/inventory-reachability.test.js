'use strict';
// E-U04 (audit U-07, X-UX-01) — every page has an entry point: shell menu, module tab, a link from another
// page / page script, or an allow-listed deep-link-only reason. A dead end fails unless it is in the
// KNOWN_DEAD_ENDS ratchet (which may only shrink).
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../tools/agent/inventory');

const SHELL = "const NAV = [ { id: 'a', href: 'home.html' } ];";
const TABS = "const MODULES = {\n  mod: [\n    { id:'x', href:'hub.html' },\n    { id:'y', href:'tab-page.html' },\n  ],\n};";

test('fixture: a page with no entry point is not reachable; a module-tab page is', () => {
  const r = I.reachability({
    pages: [{ name: 'home.html', src: '<a href="hub.html">' }, { name: 'hub.html', src: '' }, { name: 'tab-page.html', src: '' },
      { name: 'orphan.html', src: '<a href="orphan.html">self link does not count</a>' }],
    shell: SHELL, moduleTabs: TABS, scripts: [], allow: {}, deadEnds: {},
  });
  assert.equal(r.get('tab-page.html').module_tab, true);
  assert.equal(r.get('tab-page.html').reachable, true);
  assert.equal(r.get('tab-page.html').parent, 'hub.html', 'Back leads to the module hub');
  assert.equal(r.get('home.html').shell, true);
  assert.equal(r.get('orphan.html').reachable, false);
});

test('fixture: a link from a page script, an allow-listed deep link and a redirect stub count as entry points', () => {
  const r = I.reachability({
    pages: [{ name: 'home.html', src: '' }, { name: 'editor.html', src: '' }, { name: 'login.html', src: '' },
      { name: 'old.html', src: '<meta http-equiv="refresh" content="0; url=home.html">' }],
    shell: SHELL, moduleTabs: '', scripts: [{ file: 'lib/home-page.js', src: "`<a href=\"editor.html?id=${id}\">`" }],
    allow: { 'login.html': 'redirect target' }, deadEnds: {},
  });
  assert.deepEqual(r.get('editor.html').linked_from, ['lib/home-page.js']);
  assert.equal(r.get('editor.html').reachable, true);
  assert.equal(r.get('login.html').deep_link_only, 'redirect target');
  assert.match(r.get('old.html').deep_link_only, /legacy redirect stub/);
  assert.equal(r.get('old.html').redirect_to, 'home.html');
});

test('tree: the only pages without an entry point are the KNOWN_DEAD_ENDS ratchet (no new dead end)', () => {
  const inv = I.build();
  const dead = inv.pages.filter((p) => !p.reachable).map((p) => p.page.replace(/^public\//, '')).sort();
  const known = Object.keys(I.KNOWN_DEAD_ENDS).sort();
  const added = dead.filter((p) => !known.includes(p));
  assert.deepEqual(added, [], 'new page(s) with no entry point — link them, or allow-list them as deep-link only WITH a reason');
  const fixed = known.filter((p) => !dead.includes(p));
  assert.deepEqual(fixed, [], 'page(s) now reachable — remove them from KNOWN_DEAD_ENDS (the ratchet only shrinks)');
  assert.ok(known.length <= 3, 'KNOWN_DEAD_ENDS may only shrink (3 on 2026-11-06)');
  for (const [k, v] of Object.entries({ ...I.DEEP_LINK_ONLY, ...I.KNOWN_DEAD_ENDS })) assert.ok(v && v.length > 10, k + ' carries a reason');
});

test('tree: module-tab pages are counted reachable (the old "not in navigation" figure over-counted them)', () => {
  const inv = I.build();
  const page = (n) => inv.pages.find((p) => p.page === 'public/' + n);
  for (const n of ['meetings-insights.html', 'meetings-actions.html', 'meetings-unsigned.html', 'meetings-setup.html', 'inspection-actions.html']) {
    assert.equal(page(n).entry_points.module_tab, true, n);
    assert.equal(page(n).reachable, true, n);
  }
  assert.ok(inv.summary.pages_without_entry_point < inv.summary.pages_not_in_navigation);
  assert.equal(inv.summary.pages_without_entry_point, Object.keys(I.KNOWN_DEAD_ENDS).length);
});
