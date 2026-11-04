'use strict';
// A-11 — read-only shadow report for D-03: both verdicts per site, side by side.
const test = require('node:test');
const assert = require('node:assert');
const cli = require('../tools/reports/site-score-shadow');
const { computeSiteScore } = require('../services/siteScore');

const PERSITE = () => ([
  { code: 'MGO', name: 'Mana', helpdesk: 70, inspections: 60, meetings: 50, assets: 40 },
  { code: 'SML', name: 'Lafigué', helpdesk: 90, inspections: 80, meetings: 70, assets: 60 },
  { code: 'ZZZ', name: 'Zed', helpdesk: null, inspections: null, meetings: null, assets: null },
]);

test('requiring the CLI is side-effect-free', () => {
  assert.strictEqual(typeof cli.main, 'function');
});

test('default month = last closed month; explicit month honoured', () => {
  assert.deepStrictEqual(cli.parseMonth(undefined, new Date('2026-11-04T10:00:00Z')), { year: 2026, m: 10 });
  assert.deepStrictEqual(cli.parseMonth(undefined, new Date('2026-01-15T10:00:00Z')), { year: 2025, m: 12 });
  assert.deepStrictEqual(cli.parseMonth('2026-07'), { year: 2026, m: 7 });
});

test('prints both verdicts per site, agreement, and never 0 for a non-applicable site', async () => {
  const printed = [];
  const prog = {
    MGO: computeSiteScore({ reviews: 9, raised: 4, resolution: 75, overdue: 1, inspections: 3, findings: 1, signoff: 80 }, null),
    SML: computeSiteScore({ reviews: 9, raised: 4, resolution: 75, overdue: 1, inspections: 3, findings: 1, signoff: 80 }, null),
    ZZZ: computeSiteScore({}, null),
  };
  const res = await cli.main({
    args: { month: '2026-07' },
    loadScoreboardData: async () => ({ perSite: PERSITE(), prev: {} }),
    programmeScore: async (code) => prog[code],
    print: (s) => printed.push(s),
  });
  assert.strictEqual(res.month, '2026-07');
  const by = Object.fromEntries(res.rows.map((r) => [r.site, r]));
  assert.strictEqual(by.MGO.programme_rag, 'green');
  assert.strictEqual(by.MGO.operational_rag, 'amber');
  assert.strictEqual(by.MGO.agree, 'no');
  assert.strictEqual(by.SML.agree, 'yes');
  assert.strictEqual(by.ZZZ.programme_score, null);
  assert.strictEqual(by.ZZZ.operational_score, null);
  assert.strictEqual(by.ZZZ.agree, 'n/a');
  const out = printed.join('\n');
  assert.ok(/D-03 is OPEN/.test(out));
  assert.ok(/ZZZ Zed \| non applicable \| non applicable \| n\/a/.test(out));
  assert.ok(/colour agreement: 1 of 2/.test(out));
});

test('a failed programme read degrades to non applicable', async () => {
  const res = await cli.main({
    args: { month: '2026-07', json: undefined },
    loadScoreboardData: async () => ({ perSite: PERSITE(), prev: {} }),
    programmeScore: async () => { throw new Error('boom'); },
    print: () => {},
  });
  assert.ok(res.rows.every((r) => r.programme_score === null));
});
