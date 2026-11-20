'use strict';
// PORTFOLIO LOT 1 — the Intake tab (public/project.html + lib/ppmIntake.js) and the reference-list panel
// (public/portfolio.html + lib/ppmIntakeAdmin.js): wired only through the features switch, FR + EN texts for every
// string, brand tokens only (no raw colour), no inline handler, help buttons accessible.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8').replace(/\r\n/g, '\n');

function load(file) { const w = {}; vm.runInNewContext(read(file), { window: w, globalThis: w }); return w; }

test('project.html: the Intake tab is hidden until the intake switch is reported on; the lib is external', () => {
  const html = read('project.html');
  assert.match(html, /id="tab-intake"[^>]*hidden>Intake</);
  assert.match(html, /<section id="pane-intake" role="tabpanel" aria-labelledby="tab-intake" hidden>/);
  assert.match(html, /if \(FEAT\.intake_register\) \{ addTab\("intake", "plan"\)/);
  assert.match(html, /src="lib\/ppmIntake\.js"/); assert.match(html, /href="lib\/ppmIntake\.css"/);
  assert.match(read('lib/i18n/project.fr.js'), /'Intake': 'Fiche projet'/);
});

test('portfolio.html: the reference-list panel is an empty hidden mount (it appears only for the admin tier with the switch on)', () => {
  const html = read('portfolio.html');
  assert.match(html, /<section id="intake-admin" hidden><\/section>/);
  assert.match(html, /src="lib\/ppmIntakeAdmin\.js" data-mount="intake-admin"/);
});

test('every English string of both libs has its French twin', () => {
  for (const [file, name] of [['lib/ppmIntake.js', 'PpmIntake'], ['lib/ppmIntakeAdmin.js', 'PpmIntakeAdmin']]) {
    const S = load(file)[name].STRINGS;
    assert.deepStrictEqual(Object.keys(S.fr).sort(), Object.keys(S.en).sort(), file);
    for (const k of Object.keys(S.en)) assert.ok(k.startsWith('st_') || S.fr[k], `${file}: fr.${k}`);
  }
});

test('brand tokens only, no inline handler, accessible help buttons', () => {
  for (const f of ['lib/ppmIntake.js', 'lib/ppmIntakeAdmin.js', 'lib/ppmIntake.css']) {
    const src = read(f);
    assert.ok(!/#[0-9a-fA-F]{3,8}\b/.test(src.replace(/'#39;'|&#39;/g, '')), `${f}: no raw colour`);
    assert.ok(!/\son[a-z]+=/i.test(src), `${f}: no inline event handler`);
  }
  const js = read('lib/ppmIntake.js');
  assert.match(js, /aria-expanded="false" aria-controls="/); assert.match(js, /aria-label="' \+ esc\(t\('help'\)/);
});
