'use strict';
// R2-WB-05 — portfolio views (Timeline · List · Board): static checks of the page and the pure view helpers.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const PV = require('../public/lib/portfolioViews');
const UF = require('../public/lib/urlFilters');
const page = fs.readFileSync(path.join(__dirname, '..', 'public', 'portfolio.html'), 'utf8').replace(/\r\n/g, '\n');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

test('the page: the view switch is hidden by default (today = the single timeline), exactly one aria-current view, libs loaded', () => {
  const nav = /<nav[^>]*id="pf-views"[^>]*>([\s\S]*?)<\/nav>/.exec(page);
  assert.ok(nav, 'view switch present'); assert.match(nav[0], /<nav[^>]*\shidden/, 'hidden until the switch answers');
  assert.equal((nav[1].match(/aria-current="page"/g) || []).length, 1);
  assert.match(page, /src="lib\/urlFilters\.js"/); assert.match(page, /src="lib\/portfolioViews\.js"/);
  assert.match(page, /portfolio_views/, 'the page reads the switch from /ppm/features');
  assert.match(page, /<details><summary class="muted">Table view/, 'the table view stays folded while the switch is off');
});

test('navHtml: exactly one aria-current for every view; an unknown view falls back to the timeline', () => {
  for (const v of ['timeline', 'list', 'board', 'nonsense', undefined]) {
    const h = PV.navHtml(v, esc);
    assert.equal((h.match(/aria-current="page"/g) || []).length, 1, String(v));
    assert.match(h, new RegExp('data-view="' + (['list', 'board'].includes(v) ? v : 'timeline') + '" aria-current'));
  }
  assert.equal(PV.viewOf('?view=board&site=3'), 'board'); assert.equal(PV.viewOf('?view=<x>'), 'timeline'); assert.equal(PV.viewOf(''), 'timeline');
  assert.equal(UF.parse('?view=list', PV.SCHEMA).view, 'list'); assert.equal(UF.parse('?view=evil', PV.SCHEMA).view, 'timeline');
  assert.equal(UF.merge('?site=2', { view: 'board' }, PV.SCHEMA), '?site=2&view=board', 'other query keys are kept');
  assert.equal(UF.merge('?view=board', { view: 'timeline' }, PV.SCHEMA), '', 'the default view is not written');
});

test('boardHtml: one column per stage in order, no stage = proposal, every field escaped, cards are links (read-only)', () => {
  const stages = ['proposal', 'approval', 'in_progress', 'on_hold', 'closure', 'closed'];
  const gantt = [{ id: 1, key: '<K1>', name: 'A & B', stage: null, status: 'planned', progress_pct: null },
    { id: 2, key: 'K2', name: '"quoted"', stage: 'in_progress', status: '<s>', progress_pct: 0, slip_days: 4 },
    { id: 3, key: 'K3', name: 'odd', stage: 'mystery', status: null, progress_pct: 50 }];
  const h = PV.boardHtml(gantt, stages, esc);
  const order = [...h.matchAll(/<section class="pf-col" aria-label="([^"(]+)/g)].map((m) => m[1].trim());
  assert.deepEqual(order, ['proposal', 'approval', 'in progress', 'on hold', 'closure', 'closed', 'other']);
  assert.ok(!/<K1>|<s>|"quoted"/.test(h), 'nothing unescaped'); assert.ok(h.includes('&lt;K1&gt;') && h.includes('A &amp; B') && h.includes('&quot;quoted&quot;'));
  const prop = h.slice(h.indexOf('aria-label="proposal'), h.indexOf('aria-label="approval'));
  assert.match(prop, /project\.html\?id=1/, 'a project without a stage is in proposal');
  assert.match(h, /—/, 'unknown progress is —'); assert.match(h, /0 %/, 'a measured 0 % stays 0 %');
  assert.ok(!/draggable|data-stage-move|method="post"/i.test(h), 'read-only');
});
