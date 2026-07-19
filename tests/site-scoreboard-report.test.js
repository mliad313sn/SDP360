'use strict';
// PURE digest composer for the coordinator scoreboard email. Renders the FULL
// leaderboard with the recipient's own site highlighted. Plain FR, no money, no
// '$' glyph, and a non-applicable site reads "non applicable" (never "0").
const test = require('node:test');
const assert = require('node:assert');
const { buildScoreboardDigest } = require('../services/siteScoreboardReport');
const { buildSiteScoreboard } = require('../services/siteScoreboard');

const SCOREBOARD = () => buildSiteScoreboard([
  { code: 'MGO', name: 'Mana', helpdesk: 70, inspections: 60, meetings: 50, assets: 40 },
  { code: 'SML', name: 'Lafigué', helpdesk: 90, inspections: 80, meetings: 70, assets: 60 },
  { code: 'ZZZ', name: 'Zed', helpdesk: null, inspections: null, meetings: null, assets: null },
], {});

test('buildScoreboardDigest returns { subject, html }', () => {
  const out = buildScoreboardDigest(SCOREBOARD(), { period: '2026-07', highlightSite: 'MGO' });
  assert.strictEqual(typeof out.subject, 'string');
  assert.strictEqual(typeof out.html, 'string');
});

test('subject carries the month', () => {
  const { subject } = buildScoreboardDigest(SCOREBOARD(), { period: '2026-07', highlightSite: 'MGO' });
  assert.ok(/2026-07|juillet/i.test(subject), `subject should carry the month, got: ${subject}`);
});

test('html lists every applicable site name + a rank', () => {
  const { html } = buildScoreboardDigest(SCOREBOARD(), { period: '2026-07', highlightSite: 'MGO' });
  assert.ok(html.includes('Mana'), 'Mana row present');
  assert.ok(html.includes('Lafigué'), 'Lafigué row present');
  // SML scored 78 → rank 1; MGO scored 58 → rank 2.
  assert.ok(/rang|rank|#?\s*1/i.test(html), 'a rank is rendered');
});

test('the highlighted site row carries an emphasis marker', () => {
  const { html } = buildScoreboardDigest(SCOREBOARD(), { period: '2026-07', highlightSite: 'MGO' });
  assert.ok(/data-you|votre site/i.test(html), 'highlight marker present for the recipient site');
});

test('the coverage / method note is present', () => {
  const { html } = buildScoreboardDigest(SCOREBOARD(), { period: '2026-07', highlightSite: 'MGO' });
  assert.ok(/helpdesk|inspections|réunions|actifs|méthode|couverture/i.test(html), 'method/coverage note present');
});

test('a non-applicable site reads "non applicable", not "0"', () => {
  const { html } = buildScoreboardDigest(SCOREBOARD(), { period: '2026-07', highlightSite: 'MGO' });
  assert.ok(/non applicable/i.test(html), 'ZZZ renders non applicable');
});

test('no money / no $ glyph anywhere', () => {
  const { html } = buildScoreboardDigest(SCOREBOARD(), { period: '2026-07', highlightSite: 'MGO' });
  assert.ok(!html.includes('$'), 'digest must not contain a $ glyph');
});
