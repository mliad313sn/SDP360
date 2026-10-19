'use strict';
// The monthly coordinator email is a LIVE email real coordinators receive.
// tests/report-template-coordinator.test.js cannot protect it against a
// refactor: its strongest assertion strips all markup before comparing
// (`html.replace(/<[^>]+>/g,'')`), so changed whitespace, changed attribute
// order, a dropped inline style or a dropped font-family all pass it.
//
// These two goldens compare the FULL HTML byte for byte. If one fails after a
// refactor, the refactor was not behaviour-preserving — fix the code, do NOT
// regenerate the golden.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { composeCoordinator } = require('../services/reportTemplates/coordinator');
const FIX = require('./fixtures/monthly-email-golden');

for (const name of ['full', 'nonApplicable']) {
  test(`monthly email HTML is byte-identical to the golden — ${name}`, () => {
    const file = path.join(__dirname, '__golden__', `monthly-email-${name}.html`);
    const { fullHtml } = composeCoordinator(FIX[name]);
    // Repo precedent (tests/pptx-monthly-golden.test.js:161): also write when the
    // golden is missing, so a first run gives a readable result, not ENOENT.
    if (process.env.GOLDEN_UPDATE === '1' || !fs.existsSync(file)) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, fullHtml, 'utf8');
    }
    assert.strictEqual(fullHtml, fs.readFileSync(file, 'utf8'),
      'the monthly email changed — the extraction was NOT behaviour-preserving');
  });
}
