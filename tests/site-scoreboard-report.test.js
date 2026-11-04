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

// A-11 — the PROPOSED published-verdict switch. Without `published` the digest must be
// byte-identical to the pre-A-11 composer (SHA-256 of subject + '\n' + html captured
// from the unmodified code before the change).
const crypto = require('node:crypto');
const sha = (o) => crypto.createHash('sha256').update(o.subject + '\n' + o.html).digest('hex');
const { computeSiteScore } = require('../services/siteScore');
const { publishedVerdict } = require('../services/publishedSiteScore');

test('legacy (no published option) → output identical to the pre-change composer', () => {
  assert.strictEqual(sha(buildScoreboardDigest(SCOREBOARD(), { period: '2026-07', highlightSite: 'MGO' })),
    '07b4f99d5aea6b044add19a66b6fe734890e702976f283706f7215749ad0df67');
  assert.strictEqual(sha(buildScoreboardDigest(SCOREBOARD(), { period: '2026-07', highlightSite: 'ZZZ' })),
    '8209d776c5fc4e9e0398dda2ff8bf16e93ef72a1546c5cbf073051bc01789de6');
});

function publishedFor(sb, progBySite) {
  const bySite = {};
  for (const r of sb.rows) bySite[r.code] = publishedVerdict({ model: 'programme', programme: progBySite[r.code], operational: r });
  return { model: 'programme', bySite };
}

test('published programme → "Score programme (publié)" column + composite labelled non publié, both windows stated', () => {
  const sb = SCOREBOARD();
  const W = { from: '2026-04-30', to: '2026-07-31' };
  const prog = {
    MGO: computeSiteScore({ reviews: 9, raised: 4, resolution: 75, overdue: 1, inspections: 3, findings: 1, signoff: 80 }, W),
    SML: computeSiteScore({ reviews: 2, raised: 4, resolution: 10, overdue: 6, inspections: 0, findings: 9, signoff: 10 }, W),
    ZZZ: computeSiteScore({}, W),
  };
  const { html } = buildScoreboardDigest(sb, { period: '2026-07', highlightSite: 'MGO', published: publishedFor(sb, prog) });
  assert.ok(html.includes('Score programme (publié)'));
  assert.ok(html.includes('Indicateur opérationnel (non publié)'));
  assert.ok(/3 mois glissants/.test(html) && /mois courant/.test(html), 'both windows stated');
  for (const code of ['MGO', 'SML']) {
    assert.ok(html.includes(`data-published-site="${code}" data-published-rag="${prog[code].rag.toLowerCase()}"`), `${code} published rag`);
  }
  assert.ok(new RegExp(`score programme publié <strong>${prog.MGO.score}</strong>`).test(html));
});

test('published programme with a non-applicable programme score → "non applicable", never 0', () => {
  const sb = SCOREBOARD();
  const W = { from: '2026-04-30', to: '2026-07-31' };
  const prog = { MGO: computeSiteScore({}, W), SML: computeSiteScore({}, W), ZZZ: computeSiteScore({}, W) };
  const { html } = buildScoreboardDigest(sb, { period: '2026-07', highlightSite: 'MGO', published: publishedFor(sb, prog) });
  assert.ok(/data-published-site="MGO" data-published-rag="na"[^>]*>non applicable</.test(html));
  assert.ok(!/data-published-site="MGO"[^>]*>0</.test(html));
  assert.ok(/score programme publié <em>non applicable<\/em>/.test(html));
});
