'use strict';
// House style for AI comments (sponsor rule 2026-10-20): simple English for a CIO / CFO reader.
const { test } = require('node:test');
const assert = require('node:assert');
const plain = require('../services/plainEnglish');

test('check: accepts a short plain-English paragraph', () => {
  const r = plain.check('Service to users held at 71.4 percent against a 90 percent target this month. Hounde is the site to watch. One decision is needed on the extra technician.');
  assert.equal(r.ok, true, r.issues.join('; '));
});

test('check: rejects jargon and names the plain replacement', () => {
  const r = plain.check('The SLA fell and the MTTR rose because of the WAN uplink.');
  assert.equal(r.ok, false);
  assert.ok(r.issues.some(i => i.includes('SLA → service target')));
  assert.ok(r.issues.some(i => i.includes('MTTR → time to fix')));
});

test('check: rejects French, long sentences, bullets, links and exclamation marks', () => {
  assert.ok(!plain.check('Le site est en retard sur les objectifs du mois.').ok);
  assert.ok(!plain.check('Non mesuré pour la semaine.').ok);
  const long = 'This sentence goes on and on and on and on and on and on and on and on and on and on and on and on and on and on.';
  assert.ok(plain.check(long).issues.some(i => i.includes('longer than')));
  assert.ok(plain.check('- first point\n- second point').issues.some(i => i.includes('bullet')));
  assert.ok(plain.check('See https://example.com for more.').issues.some(i => i.includes('links')));
  assert.ok(plain.check('Great month!').issues.some(i => i.includes('exclamation')));
  assert.ok(plain.check('One. Two. Three. Four. Five. Six.').issues.some(i => i.includes('sentences, maximum')));
});

test('dejargon: rewrites whole words only', () => {
  assert.equal(plain.dejargon('SLA missed; the WAN uplink flapped.'), 'service target missed; the site internet link internet link flapped.');
  assert.equal(plain.dejargon('ISLAND is not SLA'), 'ISLAND is not service target');
});

test('STYLE_PROMPT names the audience, the language and the limits', () => {
  assert.match(plain.stylePrompt('en'), /CIO or CFO/);
  assert.match(plain.stylePrompt('en'), /never French/);
  assert.match(plain.stylePrompt('en'), new RegExp(`${plain.LIMITS.maxSentences} short sentences`));
  assert.match(plain.stylePrompt('fr'), /jamais d'anglais/);
});
