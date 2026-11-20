'use strict';
// PORTFOLIO LOT 2 — the data-quality panel (public/lib/ppmFieldHelp.js) on the project Intake tab: external script,
// FR + EN for every string, brand tokens only, no inline handler, accessible help buttons, escaped output, PROPOSED label.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8').replace(/\r\n/g, '\n');
const load = () => { const w = {}; vm.runInNewContext(read('lib/ppmFieldHelp.js'), { window: w, globalThis: w }); return w.PpmFieldHelp; };
const DQ = require('../services/ppm/dataQuality');
const FG = require('../services/ppm/fieldGuide');

test('project.html loads the lib as an external script; the intake tab renders the panel only when the read carries dq', () => {
  assert.match(read('project.html'), /<script nonce="%%CSP_NONCE%%" src="lib\/ppmFieldHelp\.js"><\/script>/);
  const js = read('lib/ppmIntake.js');
  assert.match(js, /if \(V\.dq && root\.PpmFieldHelp\) h \+= root\.PpmFieldHelp\.panel\(V\.dq, CAT\.dq_guide, lang\(\)\);/);
});

test('every English string has its French twin; tokens only; no inline handler', () => {
  const S = load().STRINGS;
  assert.deepStrictEqual(Object.keys(S.fr).sort(), Object.keys(S.en).sort());
  for (const k of Object.keys(S.en)) assert.ok(S.fr[k], `fr.${k}`);
  for (const it of DQ.CHECKLIST) assert.ok(S.en[it.key] && S.fr[it.key], it.key);
  for (const f of ['lib/ppmFieldHelp.js', 'lib/ppmIntake.css']) {
    const src = read(f);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src.replace(/'#39;'|&#39;/g, '')), `${f}: no raw colour`);
    assert.ok(!/\son[a-z]+=/i.test(src), `${f}: no inline event handler`);
  }
});

test('panel: score, RAG, PROPOSED note, blocking list, checklist with accessible help buttons, escaped', () => {
  const H = load();
  const p = { id: 1, name: '<b>x</b>', owner: null, sponsor: 's', start_date: '2027-01-01', end_date: '2027-02-01', value_states: {} };
  const dq = { ...DQ.evaluate(p, { risks: [] }), gate_enforced: true };
  const html = H.panel(dq, FG.dqGuide(), 'en');
  assert.match(html, /Proposed rules/); assert.match(html, /it_owner_missing/); assert.match(html, /Approval is refused/);
  assert.match(html, /aria-expanded="false" aria-controls="dq-help-\d+"/); assert.match(html, /aria-label="Help for IT owner"/);
  assert.ok(!html.includes('<b>x</b>'));
  const fr = H.panel(dq, FG.dqGuide(), 'fr');
  assert.match(fr, /Qualité des données/); assert.match(fr, /Règles proposées/);
  assert.equal(H.panel(null, null, 'en'), '');
});
