// tests/review-render.test.js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { renderTemplate, _resolve, _escape } = require('../public/it-review.js');

test('_escape neutralises HTML', () => {
  assert.strictEqual(_escape('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.strictEqual(_escape('a & b'), 'a &amp; b');
  assert.strictEqual(_escape('"q"'), '&quot;q&quot;');
  assert.strictEqual(_escape(null), '');
  assert.strictEqual(_escape(0), '0');          // 0 must render, not vanish
  assert.strictEqual(_escape(false), 'false');
});

test('_resolve handles a plain key and ONE dot', () => {
  const scope = [{ sbAvg: 43, r: { score: 58 } }];
  assert.strictEqual(_resolve('sbAvg', scope), 43);
  assert.strictEqual(_resolve('r.score', scope), 58);
});

test('_resolve walks the scope chain, innermost first', () => {
  const scope = [{ x: 'outer', y: 'only-outer' }, { x: 'inner' }];
  assert.strictEqual(_resolve('x', scope), 'inner');
  assert.strictEqual(_resolve('y', scope), 'only-outer');
});

test('_resolve on a missing path yields undefined, never throws', () => {
  assert.strictEqual(_resolve('nope', [{}]), undefined);
  assert.strictEqual(_resolve('a.b', [{}]), undefined);
});

test('{{ }} substitutes and escapes', () => {
  assert.strictEqual(renderTemplate('<p>{{ n }}</p>', { n: 43 }), '<p>43</p>');
  assert.strictEqual(renderTemplate('<p>{{ t }}</p>', { t: '<b>x</b>' }), '<p>&lt;b&gt;x&lt;/b&gt;</p>');
});

test('a missing binding renders empty, not "undefined"', () => {
  assert.strictEqual(renderTemplate('<p>{{ nope }}</p>', {}), '<p></p>');
});

test('sc-for repeats its children', () => {
  const t = '<ul><sc-for list="{{ xs }}" as="x"><li>{{ x.n }}</li></sc-for></ul>';
  assert.strictEqual(renderTemplate(t, { xs: [{ n: 1 }, { n: 2 }] }), '<ul><li>1</li><li>2</li></ul>');
});

test('sc-for over an empty/missing list emits nothing', () => {
  const t = '<ul><sc-for list="{{ xs }}" as="x"><li>{{ x.n }}</li></sc-for></ul>';
  assert.strictEqual(renderTemplate(t, { xs: [] }), '<ul></ul>');
  assert.strictEqual(renderTemplate(t, {}), '<ul></ul>');
});

// ⚠️ THE TESTS THAT ACTUALLY MATTER — the REAL tag forms.
// A reviewer built the renderer the bare-form fixtures accept and ran it on the
// real template: 12/12 green, 0/32 loops matched, 0/3 gates matched. NO tag in
// the template uses the bare form. If these two go red, the page ships inert.
test('REAL FORM: sc-for tolerates a trailing hint attribute (all 32 carry one)', () => {
  const t = '<ul><sc-for list="{{ kpis }}" as="k" hint-placeholder-count="8"><li>{{ k.label }}</li></sc-for></ul>';
  assert.strictEqual(renderTemplate(t, { kpis: [{ label: 'Raised' }, { label: 'Open' }] }),
    '<ul><li>Raised</li><li>Open</li></ul>');
});

test('REAL FORM: sc-if tolerates hint-placeholder-val, which itself contains {{ }} (all 3 carry it)', () => {
  // The {{ true }} inside the TAG is why control flow must resolve BEFORE
  // interpolation — interpolate first and the value="{{ }}" matcher never fires.
  const t = '<sc-if value="{{ isDashboard }}" hint-placeholder-val="{{ true }}"><b>panel</b></sc-if>';
  assert.strictEqual(renderTemplate(t, { isDashboard: true }), '<b>panel</b>');
  assert.strictEqual(renderTemplate(t, { isDashboard: false }), '');
});

test('REAL FORM: attribute order is not assumed', () => {
  const t = '<sc-for as="x" hint-placeholder-count="2" list="{{ xs }}"><i>{{ x.n }}</i></sc-for>';
  assert.strictEqual(renderTemplate(t, { xs: [{ n: 5 }] }), '<i>5</i>');
});

test('the hint attributes never leak into the output', () => {
  const t = '<sc-if value="{{ on }}" hint-placeholder-val="{{ true }}"><sc-for list="{{ xs }}" as="x" hint-placeholder-count="1"><i>{{ x.n }}</i></sc-for></sc-if>';
  const out = renderTemplate(t, { on: true, xs: [{ n: 1 }] });
  assert.strictEqual(out, '<i>1</i>');
  assert.ok(!/hint-placeholder/.test(out));
  assert.ok(!/sc-(for|if)/.test(out), 'no inert custom elements may survive');
});

// The 7 real nesting sites are exactly 2 deep — this is the contract.
test('sc-for nests 2 levels and the child scope shadows the parent', () => {
  const t = '<sc-for list="{{ rows }}" as="r" hint-placeholder-count="5"><tr><sc-for list="{{ r.cells }}" as="c" hint-placeholder-count="6"><td>{{ c.val }}</td></sc-for></tr></sc-for>';
  const out = renderTemplate(t, { rows: [{ cells: [{ val: 'a' }, { val: 'b' }] }, { cells: [{ val: 'c' }] }] });
  assert.strictEqual(out, '<tr><td>a</td><td>b</td></tr><tr><td>c</td></tr>');
});

test('the outer scope is still visible inside sc-for', () => {
  const t = '<sc-for list="{{ xs }}" as="x"><i>{{ title }}:{{ x.n }}</i></sc-for>';
  assert.strictEqual(renderTemplate(t, { title: 'T', xs: [{ n: 1 }] }), '<i>T:1</i>');
});

test('sc-if keeps children when truthy, drops them when falsy', () => {
  const t = '<sc-if value="{{ on }}"><b>yes</b></sc-if>';
  assert.strictEqual(renderTemplate(t, { on: true }), '<b>yes</b>');
  assert.strictEqual(renderTemplate(t, { on: false }), '');
  assert.strictEqual(renderTemplate(t, {}), '');
});

test('sc-if wraps sc-for — the real page shape, in the real forms', () => {
  const t = '<sc-if value="{{ isDashboard }}" hint-placeholder-val="{{ true }}"><sc-for list="{{ xs }}" as="x" hint-placeholder-count="3"><li>{{ x.n }}</li></sc-for></sc-if>';
  assert.strictEqual(renderTemplate(t, { isDashboard: true, xs: [{ n: 7 }] }), '<li>7</li>');
  assert.strictEqual(renderTemplate(t, { isDashboard: false, xs: [{ n: 7 }] }), '');
});

// ⚠️ THE BACKSTOP — run the renderer against the REAL template. This is the test
// the bare-form suite could NOT fail, and it is the reason Issue 1 existed.
// It is SELF-CONTAINED on purpose: no helper, no Task-3 dependency, nothing to
// "check later". If it crashes rather than asserting, the obvious fix is to
// delete it — which deletes exactly the protection it provides. Don't.
//
// Loops all 3 views: with view='dashboard' the 14 scoreboard/brief loops sit
// inside a FALSY sc-if and are dropped without ever being parsed, so a
// dashboard-only run passes trivially for them (18 of 32 loops exercised).
// Three runs cover all 32 and catch a brief-only binding typo. Same cost.
test('BACKSTOP: the real template leaves no unprocessed control tags, in any view', () => {
  const fs = require('fs'); const path = require('path');
  const tpl = fs.readFileSync(path.join(__dirname, '..', 'docs', 'reference', 'it-review-dashboard.template.html'), 'utf8');
  // Markup region = everything after </helmet> (his CSS block; closes ~template
  // line 357). Inlined, NOT a helper — keeps this test self-contained.
  const markup = tpl.slice(tpl.indexOf('</helmet>') + '</helmet>'.length);
  assert.ok(markup.length > 50000, 'markup region extraction failed — check the </helmet> marker');

  const EM = require('./fixtures/em-data.json');
  const { buildReviewVals } = require('../services/reviewDashboard');
  for (const view of ['dashboard', 'scoreboard', 'brief']) {
    const vals = buildReviewVals(EM, { view, period: 'week', site: 'ALL', asOf: '2026-07-14' });
    const out = renderTemplate(markup, vals);
    assert.ok(!/<sc-for/.test(out), `[${view}] unprocessed sc-for survived — the grammar does not match the real tags`);
    assert.ok(!/<sc-if/.test(out), `[${view}] unprocessed sc-if survived`);
    assert.ok(!/\{\{/.test(out), `[${view}] unsubstituted binding survived`);
    assert.ok(!/hint-placeholder/.test(out), `[${view}] hint attribute leaked into the output`);
  }
});

test('bindings inside attributes are escaped too', () => {
  assert.strictEqual(renderTemplate('<div style="color:{{ c }}"></div>', { c: '#2f7d4f' }),
    '<div style="color:#2f7d4f"></div>');
  // an attacker-controlled value must not break out of the attribute
  assert.ok(!renderTemplate('<div title="{{ t }}"></div>', { t: '" onload="x' }).includes('onload="x'));
});
