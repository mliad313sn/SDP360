'use strict';
// House style, French side: the executive register applies in French exactly as in English.
const { test } = require('node:test');
const assert = require('node:assert');
const plain = require('../services/plainEnglish');
const { analyse } = require('../services/reportAnalysis');
const { buildPrompt, generateCommentary } = require('../services/aiCommentary');

test('check(fr): accepts plain French, rejects English and jargon', () => {
  const ok = plain.check('Le service aux utilisateurs reste à 71.4 pour cent ce mois, sous la cible. Hounde est le site à surveiller. Une décision est attendue sur le renfort.', { lang: 'fr' });
  assert.equal(ok.ok, true, ok.issues.join('; '));
  const en = plain.check('The service target is below the target this month and the site is red.', { lang: 'fr' });
  assert.ok(!en.ok && en.issues.some(i => i.includes('not plain French')));
  const jar = plain.check('Le SLA a chuté à cause de la latence du WAN.', { lang: 'fr' });
  assert.ok(jar.issues.some(i => i.includes('SLA → objectif de service')));
  assert.equal(plain.dejargon('Le SLA du WAN', 'fr'), 'Le objectif de service du liaison internet du site');
});

test('buildPrompt(fr): French system prompt with the French style block', () => {
  const widgets = { w1: { mode: 'single', metric: 'helpdesk.resolution_sla_pct', title: 'Resolution SLA', value: 71.4, unit: '%', rag: 'RED', window: { label: '2026-09' } } };
  const analysis = analyse({ widgets, audience: 'site', lang: 'fr', siteName: 'Hounde', window: '2026-09', registry: { get: () => ({ higher_is_better: true }) } });
  const p = buildPrompt(analysis, { audience: 'site', lang: 'fr' });
  assert.match(p.system, /RÈGLE ABSOLUE/); assert.match(p.system, /directeur général ou financier/); assert.match(p.system, /3 à 5 phrases courtes/);
});

test('generateCommentary(fr): a French executive reply passes; an English reply is corrected then falls back in French', async () => {
  const widgets = { w1: { mode: 'single', metric: 'helpdesk.resolution_sla_pct', title: 'Resolution SLA', value: 71.4, unit: '%', rag: 'RED', window: { label: '2026-09' } } };
  const analysis = analyse({ widgets, audience: 'executive', lang: 'fr', siteName: 'Hounde', window: '2026-09', registry: { get: () => ({ higher_is_better: true }) } });
  const good = await generateCommentary({ analysis, audience: 'executive', lang: 'fr', provider: 'local', aiCall: async () => 'Le service aux utilisateurs est à 71.4 pour cent, sous la cible. Hounde est le site à surveiller.' });
  assert.equal(good.source, 'ai'); assert.equal(good.verified, true);
  const bad = await generateCommentary({ analysis, audience: 'executive', lang: 'fr', provider: 'local', aiCall: async () => 'The SLA is 71.4 and the site is red this month.' });
  assert.equal(bad.source, 'deterministic'); assert.match(bad.error, /plain-language/); assert.ok(!/\bSLA\b/.test(bad.text));
});
