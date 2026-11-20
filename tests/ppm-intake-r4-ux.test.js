'use strict';
// P11 round 4 F-14 — the Intake tab (lib/ppmIntake.js): read-only blanks read "—" (the tab's own rule), every
// <label for> points at a labelable control, and the save warnings are shown in the page language by their code.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const IF = require('../services/ppm/intakeFields');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public/lib/ppmIntake.js'), 'utf8');

function load(langFr) {
  const w = { I18nText: { lang: () => (langFr ? 'fr' : 'en') } };
  vm.runInNewContext(SRC, { window: w, globalThis: w, document: { getElementById: () => null } });
  return w.PpmIntake;
}
const CAT = { fields: IF.GUIDE, sections: IF.SECTIONS, state_fields: IF.STATE_FIELDS, none_known_only: IF.NONE_KNOWN_ONLY, business_need_parts: IF.NEED_PARTS, lookups: {} };
function host() { return { innerHTML: '', textContent: '', querySelectorAll: () => [], querySelector: () => null }; }
async function render({ committee, project, fr, api }) {
  const P = load(fr); const h = host(); const msgs = [];
  const ctx = { $: () => h, V: () => ({ project, committee }), api: api || (async () => CAT), msg: (m) => msgs.push(m), reload: async () => {}, fail: (e) => { throw e; } };
  P.mount(ctx); await new Promise((r) => setImmediate(r));
  return { html: h.innerHTML, P, ctx, h, msgs };
}

test('F-14: read-only view shows "—" for unknown values, never an empty disabled control', async () => {
  const { html } = await render({ committee: false, project: { id: 1, version: 1, project_ref: 'P-1', sponsor: null, value_states: {} } });
  assert.ok(!/<input(?![^>]*type="checkbox")[^>]*disabled/.test(html), 'no empty disabled input in read-only (the none-known checkboxes stay: they show a state)');
  assert.ok(!/<textarea[^>]*disabled/.test(html), 'no disabled textarea in read-only');
  assert.match(html, /<output id="in-business_sponsor" class="in-ro">—<\/output>/);
});

test('F-14: every <label for> points at an element that can carry a label (no orphan label on a <p>)', async () => {
  for (const committee of [true, false]) {
    const { html } = await render({ committee, project: { id: 1, version: 1, value_states: {} } });
    for (const m of html.matchAll(/<label[^>]*for="([^"]+)"/g)) {
      const el = new RegExp('<(input|select|textarea|output|button|meter|progress)\\b[^>]*id="' + m[1] + '"').test(html);
      assert.ok(el, (committee ? 'edit' : 'read') + ': label for=' + m[1] + ' has no labelable target');
    }
  }
});

test('F-14: save warnings are shown in French by their code', async () => {
  const warnings = IF.intakeWarnings({ sponsor: 'A', owner: 'A', delivery_lead: 'A', budget: 0, budget_status: 'approved' });
  assert.ok(warnings.length >= 2);
  let call = 0;
  const api = async () => (call++ === 0 ? CAT : { ok: true, warnings });
  const r = await render({ committee: true, fr: true, project: { id: 1, version: 1, value_states: {} }, api });
  // save is internal: re-mount with a fake Save button and click it
  const btn = { addEventListener: (_e, fn) => { btn.fn = fn; } };
  r.h.querySelector = (q) => (q === '#in-save' ? btn : null);
  r.P.mount(r.ctx); await new Promise((res) => setImmediate(res));
  btn.fn(); await new Promise((res) => setImmediate(res)); await new Promise((res) => setImmediate(res));
  const msg = r.msgs.join(' ');
  assert.match(msg, /À vérifier/);
  assert.ok(!/the budget is 0|are the same person|held by the same person/.test(msg), 'no English warning in French: ' + msg);
});
