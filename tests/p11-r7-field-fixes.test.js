'use strict';
// P11 round 7 (UX/field) — static + pure checks.
//  F-27 — a persistent server 500 was retried every 5 s for ever. The retry plan (pure, extracted from the field app)
//         backs off 5 → 10 → … → 300 s and gives up after 8 attempts ("server error — needs attention"); a busy
//         database / 429 keeps the server's pace (Retry-After, no attempt counted).
//  F-28 — texts with an embedded number (inspection toasts) and the "May rewrite:" label could not be matched by the
//         exact-text French layer; the site-awareness helpdesk colour rule was tooltip-only.
//  F-25 — the inspection form merges the rows the server kept, and names the actions the user deleted.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/\r\n/g, '\n');

function grab(src, name) {
  const i = src.indexOf('function ' + name + '(');
  assert.ok(i >= 0, name + ' exists');
  let depth = 0, j = src.indexOf('{', i);
  for (; j < src.length; j++) { if (src[j] === '{') depth++; else if (src[j] === '}' && --depth === 0) break; }
  return src.slice(i, j + 1);
}
function load(src, names, ctx) {
  const m = { exports: {} };
  vm.runInNewContext(names.map((n) => grab(src, n)).join('\n') + '\nmodule.exports = {' + names.join(',') + '};', Object.assign({ module: m }, ctx || {}));
  return m.exports;
}
const fieldApp = read('public/field/app.js');
const fieldDict = () => {
  let d = null;
  const ctx = { window: {}, document: { getElementById: () => null }, localStorage: { getItem: () => null, setItem: () => {} } };
  ctx.window.I18nText = { install: (o) => { d = o.dict; }, t: (s) => s };
  vm.runInNewContext(read('public/field/i18n.js'), ctx);
  return d;
};

test('F-27: a persistent server error backs off exponentially (cap 300 s) and gives up after a bounded number of attempts', () => {
  const { retryPlan } = load(fieldApp, ['retryPlan']);
  const delays = [];
  let attempts = 0, plan;
  for (let k = 0; k < 20; k++) {
    plan = retryPlan(attempts, 500, 'internal_error', null);
    attempts = plan.attempts;
    if (plan.giveUp) break;
    delays.push(plan.delaySec);
  }
  assert.deepStrictEqual(delays, [5, 10, 20, 40, 80, 160, 300]);
  assert.strictEqual(plan.giveUp, true, 'stops retrying automatically');
  assert.strictEqual(attempts, 8);
  // a 502 / an unknown 5xx too; a Retry-After longer than the step is honoured within the cap
  assert.strictEqual(retryPlan(0, 502, undefined, null).delaySec, 5);
  assert.strictEqual(retryPlan(0, 500, 'internal_error', '60').delaySec, 60);
  assert.strictEqual(retryPlan(0, 500, 'internal_error', '9999').delaySec, 300);
});

test('F-27: a busy database / too many requests keeps the existing pace and never counts towards giving up', () => {
  const { retryPlan } = load(fieldApp, ['retryPlan']);
  for (let k = 0; k < 50; k++) {
    const p = retryPlan(3, 503, 'database_busy', null);
    assert.deepStrictEqual([p.delaySec, p.attempts, p.giveUp], [5, 3, false]);
  }
  assert.strictEqual(retryPlan(0, 503, 'database_busy', '30').delaySec, 30);
  assert.strictEqual(retryPlan(0, 429, undefined, '600').delaySec, 120, 'Retry-After capped at 120 s as before');
  assert.strictEqual(retryPlan(0, 429, undefined, '1').delaySec, 5, 'floor 5 s as before');
});

test('F-27: the send path uses the plan, waits for each entry\'s own next try, and shows a "needs attention" state', () => {
  const i = fieldApp.indexOf('if (isTransient(j.__status)) {');
  assert.ok(i > 0);
  const block = fieldApp.slice(i, i + 700);
  assert.match(block, /applyServerError\(e, j\.__status, j\.error, j\.__retryAfter\)/);
  assert.match(block, /database_busy/);
  assert.match(grab(fieldApp, 'applyServerError'), /e\.state = 'server_error'/);
  assert.match(grab(fieldApp, 'flush'), /next_try_at/, 'a failed entry waits for its next try unless forced');
  assert.match(fieldApp, /server_error: 'server error — needs attention'/);
  assert.match(fieldApp, /data-ob-retry/, 'a Try again button re-sends the same entry');
  const d = fieldDict();
  for (const k of ['server error — needs attention', 'Try again']) assert.ok(k in d, 'French for ' + k);
  for (const m of fieldApp.matchAll(/FT\('([^']+)'\)/g)) assert.ok(m[1] in d, 'no French for ' + m[1]);
});

test('F-28: inspection toasts with a number go through a {n} template that has a French entry', () => {
  const page = read('public/inspection.html');
  const ctx = { window: {} };
  vm.runInNewContext(read('public/lib/i18n/inspection.fr.js'), ctx);
  const dict = ctx.window.I18N_FR_INSPECTION;
  const tpls = [...page.matchAll(/uiF\('([^']+)'/g)].map((m) => m[1]);
  assert.ok(tpls.length >= 2, 'the kept / not-matched toasts use uiF');
  for (const t of tpls) { assert.match(t, /\{n\}/); assert.ok(t in dict, 'French template for ' + t); assert.match(dict[t], /\{n\}/); }
  assert.ok(!/showToast\(keptN \+|showToast\(ambN \+/.test(page), 'no number-prefixed English toast left');
  // the template helper substitutes after the lookup, in French when the dictionary answers
  const { uiF } = load(page, ['uiF'], { window: { I18nText: { t: (s) => dict[s] || s } } });
  assert.match(uiF(tpls.find((t) => /^\{n\} action\(s\) were/.test(t)), { n: 3 }), /^3 action\(s\) ont été modifiée/);
});

test('F-28: the change-request "May rewrite:" label is its own text node with a French entry', () => {
  const src = read('public/lib/ppmWorkbench.js');
  assert.match(src, /<span>May rewrite:<\/span> /);
  const ctx = { window: {} };
  vm.runInNewContext(read('public/lib/i18n/project.fr.js'), ctx);
  assert.strictEqual(ctx.window.I18N_FR_PROJECT['May rewrite:'], 'Peut réécrire :');
});

test('F-28: the site-awareness helpdesk colour rule is visible text (EN/FR), referenced by each helpdesk cell', () => {
  const page = read('public/site-awareness.html');
  assert.match(page, /<p class="sa-sub" id="sa-fleet-hd-note"/, 'a visible note under the fleet grid');
  assert.match(page, /hdNote\.textContent = T\('g_hd_note_lbl'\) \+ ' ' \+ hdTip\(\)/);   // r8 F-31: the rule quotes the policy minimum
  assert.match(page, /aria-describedby="sa-fleet-hd-note"/);
  assert.match(page, /g_hd_note_lbl:\s*\{ fr: '[^']+', en: '[^']+' \}/);
});

test('F-25: the inspection form merges the kept rows and names the actions the user deleted', () => {
  const page = read('public/inspection.html');
  const { mergeKeptRows } = load(page, ['mergeKeptRows']);
  const st = { actions: [{ id: 7, desc: 'Check UPS', owner: 'Bob' }] };
  const n = mergeKeptRows(st, [{ id: 7, desc: 'x' }, { id: 5, desc: 'Check UPS', owner: 'Alice', status: 'Open' }]);
  assert.strictEqual(n, 1, 'each kept row once, by id');
  assert.deepStrictEqual(st.actions.map((a) => a.id), [7, 5]);
  assert.strictEqual(st.actions[1].base_status, 'Open');
  assert.strictEqual(mergeKeptRows(st, [{ id: 5 }]), 0, 'idempotent');
  assert.match(page, /mergeKeptRows\(state, out && out\.kept_rows\)/);
  assert.match(grab(page, 'removeAction'), /removed_action_ids/);
});
