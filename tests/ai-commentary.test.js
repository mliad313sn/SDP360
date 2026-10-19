'use strict';
// Step 9 — AI commentary: anti-hallucination check, anonymisation for cloud providers, deterministic fallback.
const { test } = require('node:test');
const assert = require('node:assert');
const { analyse } = require('../services/reportAnalysis');
const { buildPrompt, verifyNumbers, anonymise, deanonymise, generateCommentary } = require('../services/aiCommentary');

const widgets = {
  w1: { mode: 'single', metric: 'helpdesk.resolution_sla_pct', title: 'Resolution SLA', value: 71.4, unit: '%', rag: 'RED', window: { label: '2026-09' } },
  w4: { mode: 'per-site', metric: 'tracker.site_score_pct', title: 'Tracker', unit: '%', rows: [{ site: 'Hounde', value: 40, rag: 'RED' }, { site: 'Mana', value: 85, rag: 'GREEN' }] },
};
const analysis = analyse({ widgets, audience: 'executive', lang: 'en', siteName: 'Hounde', window: '2026-09', registry: { get: () => ({ higher_is_better: true }) } });

test('verifyNumbers: tolerates years/durations/S-codes, rejects a number outside the canonical set', () => {
  const canon = new Set(['71.4', '40', '85']);
  assert.equal(verifyNumbers('In 2026 the SLA was 71.4 % after 13w; S1 scored 40 and S2 85.', canon).ok, true);
  const bad = verifyNumbers('The SLA was 72 %, backlog 310.', canon);
  assert.equal(bad.ok, false); assert.deepEqual(bad.offending, ['72', '310']);
  assert.equal(verifyNumbers('71,4 % in French decimals', canon).ok, true);
  assert.equal(verifyNumbers('measured 1/2', new Set(), { allow: [1, 2] }).ok, true);
});

test('anonymise/deanonymise: site names become S1..Sn everywhere and come back', () => {
  const { analysis: a, map } = anonymise(analysis);
  assert.equal(a.site, 'S1'); assert.ok(!JSON.stringify(a).includes('Hounde')); assert.ok(!JSON.stringify(a).includes('Mana'));
  assert.deepEqual([...map.keys()], ['Hounde', 'Mana']);
  assert.equal(deanonymise('S1 trails S2; S10 untouched.', map), 'Hounde trails Mana; S10 untouched.');
});

test('buildPrompt: carries the absolute rule, the figures and the sorted canonical list', () => {
  const p = buildPrompt(analysis, { audience: 'executive', lang: 'fr' });
  assert.match(p.system, /RÈGLE ABSOLUE/); assert.match(p.user, /LISTE CANONIQUE/); assert.ok(p.user.includes('Resolution SLA (helpdesk.resolution_sla_pct): 71.4 %'));
  assert.deepEqual(p.canonical.slice(0, 3), ['40', '40.0', '71']); assert.ok(p.canonical.includes('71.4'));
});

test('generateCommentary: provider off → deterministic; local keeps names; cloud anonymises and restores', async () => {
  const off = await generateCommentary({ analysis, provider: 'off', aiCall: async () => 'never called' });
  assert.equal(off.source, 'deterministic'); assert.ok(off.text.startsWith(analysis.headline));
  let seen; const local = await generateCommentary({ analysis, provider: 'local', aiCall: async (p) => { seen = p.user; return 'Hounde SLA is 71.4 %.'; } });
  assert.equal(local.source, 'ai'); assert.equal(local.anonymised, false); assert.ok(seen.includes('Hounde'));
  const cloud = await generateCommentary({ analysis, provider: 'anthropic', aiCall: async (p) => { seen = p.user; return 'S1 SLA is 71.4 % while S2 reaches 85 %.'; } });
  assert.equal(cloud.anonymised, true); assert.ok(!seen.includes('Hounde'), 'real names never leave for a cloud provider'); assert.equal(cloud.text, 'Hounde SLA is 71.4 % while Mana reaches 85 %.');
});

test('generateCommentary: a reply quoting a foreign number or throwing falls back to the deterministic text', async () => {
  const bad = await generateCommentary({ analysis, provider: 'local', aiCall: async () => 'SLA improved to 73 % this month.' });
  assert.equal(bad.source, 'deterministic'); assert.equal(bad.verified, false); assert.deepEqual(bad.offending, ['73']); assert.match(bad.error, /canonical/);
  const thrown = await generateCommentary({ analysis, provider: 'local', aiCall: async () => { throw new Error('ECONNREFUSED 127.0.0.1:11434'); } });
  assert.equal(thrown.source, 'deterministic'); assert.match(thrown.error, /ECONNREFUSED/);
  const empty = await generateCommentary({ analysis, provider: 'local', aiCall: async () => '' });
  assert.equal(empty.error, 'empty reply');
});
