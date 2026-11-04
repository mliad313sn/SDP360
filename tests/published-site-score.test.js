'use strict';
// A-11 — the PROPOSED one-published-verdict switch (repo decision D-03, still OPEN).
// Default 'legacy' = each e-mail keeps its own model exactly as today.
const test = require('node:test');
const assert = require('node:assert');
const P = require('../services/publishedSiteScore');
const { computeSiteScore } = require('../services/siteScore');
const { buildSiteScoreboard } = require('../services/siteScoreboard');
const { buildScoreboardDigest } = require('../services/siteScoreboardReport');
const { composeCoordinator } = require('../services/reportTemplates/coordinator');
const { DEFAULTS } = require('../services/reportConfig');

const PROG_INPUTS = { reviews: 9, raised: 4, resolution: 75, overdue: 1, inspections: 3, findings: 1, signoff: 80 };
const WINDOW = { from: '2026-04-30', to: '2026-07-31' };
const board = () => buildSiteScoreboard([
  { code: 'MGO', name: 'Mana', helpdesk: 70, inspections: 60, meetings: 50, assets: 40 },
  { code: 'SML', name: 'Lafigué', helpdesk: 90, inspections: 80, meetings: 70, assets: 60 },
], {});

test('the switch exists in DEFAULTS and defaults to legacy (today)', () => {
  assert.strictEqual(DEFAULTS.site_score_published_model, 'legacy');
});

test('normalizeModel: known values pass, anything else falls back to legacy', () => {
  assert.strictEqual(P.normalizeModel('programme'), 'programme');
  assert.strictEqual(P.normalizeModel(' Operational '), 'operational');
  assert.strictEqual(P.normalizeModel('legacy'), 'legacy');
  assert.strictEqual(P.normalizeModel('xyz'), 'legacy');
  assert.strictEqual(P.normalizeModel(undefined), 'legacy');
  assert.strictEqual(P.publishedVerdict({ model: 'xyz', programme: computeSiteScore(PROG_INPUTS, WINDOW), operational: board().rows[0] }), null);
  assert.strictEqual(P.publishedVerdict({ model: 'legacy' }), null);
});

test('programme mode publishes the programme rag and carries the operational one as other', () => {
  const prog = computeSiteScore(PROG_INPUTS, WINDOW);
  const row = board().rows.find((r) => r.code === 'MGO');
  const v = P.publishedVerdict({ model: 'programme', programme: prog, operational: row });
  assert.strictEqual(v.model, 'programme');
  assert.strictEqual(v.score, prog.score);
  assert.strictEqual(v.rag, prog.rag.toLowerCase(), "rag normalised to lower case");
  assert.strictEqual(v.applicable, true);
  assert.strictEqual(v.other.model, 'operational');
  assert.strictEqual(v.other.score, row.score);
  assert.strictEqual(v.other.rag, row.rag);
  const o = P.publishedVerdict({ model: 'operational', programme: prog, operational: row });
  assert.strictEqual(o.score, row.score);
  assert.strictEqual(o.other.score, prog.score);
});

test('a non-applicable model stays null — never 0, never a colour', () => {
  const na = computeSiteScore({}, WINDOW);
  const v = P.publishedVerdict({ model: 'programme', programme: na, operational: null });
  assert.strictEqual(v.applicable, false);
  assert.strictEqual(v.score, null);
  assert.strictEqual(v.rag, null);
  assert.strictEqual(v.other.score, null);
  assert.strictEqual(v.other.applicable, false);
});

test('programme mode: the coordinator e-mail and the scoreboard digest show the same published RAG', () => {
  const prog = computeSiteScore(PROG_INPUTS, WINDOW);
  const sb = board();
  const row = sb.rows.find((r) => r.code === 'MGO');
  const v = P.publishedVerdict({ model: 'programme', programme: prog, operational: row });
  const { html } = buildScoreboardDigest(sb, { period: '2026-07', highlightSite: 'MGO', published: { model: 'programme', bySite: { MGO: v } } });
  const m = /data-published-site="MGO" data-published-rag="(\w+)"/.exec(html);
  assert.ok(m, 'the digest carries the published rag for the site');
  const coord = composeCoordinator({ site_code: 'MGO', site_name: 'Mana', period: { label: 'July 2026' }, score: prog }).fullHtml;
  const LABEL = { green: 'On track', amber: 'At risk', red: 'Off track' };
  assert.strictEqual(m[1], prog.rag.toLowerCase());
  assert.ok(coord.includes(LABEL[prog.rag.toLowerCase()]), 'coordinator pill shows the same rag');
  // and the digest's "où se situe" line quotes the programme score, not the composite
  assert.ok(new RegExp(`score programme publié <strong>${prog.score}</strong>`).test(html));
});

test('operational mode: the coordinator e-mail gains a labelled published line; legacy adds nothing', () => {
  const prog = computeSiteScore(PROG_INPUTS, WINDOW);
  const row = board().rows.find((r) => r.code === 'MGO');
  const base = { site_code: 'MGO', site_name: 'Mana', period: { label: 'July 2026' }, score: prog };
  const legacy = composeCoordinator(base).fullHtml;
  const v = P.publishedVerdict({ model: 'operational', programme: prog, operational: row });
  const op = composeCoordinator({ ...base, published: v }).fullHtml;
  assert.ok(!/Published site verdict/.test(legacy));
  assert.ok(/Published site verdict/.test(op));
  assert.ok(op.includes(`${row.score}/100`));
  assert.ok(/not the published verdict/.test(op));
  // a programme-mode verdict leaves the coordinator e-mail exactly as today
  const pv = P.publishedVerdict({ model: 'programme', programme: prog, operational: row });
  assert.strictEqual(composeCoordinator({ ...base, published: pv }).fullHtml, legacy);
});

test('sendCoordinator: operational switch attaches the composite verdict; legacy never looks it up', async () => {
  const { sendCoordinatorReport } = require('../services/sendCoordinator');
  const prog = computeSiteScore(PROG_INPUTS, WINDOW);
  const row = board().rows.find((r) => r.code === 'MGO');
  const run = async (model) => {
    let looked = 0; let seen = null;
    const deps = {
      reportsDb: { getSiteIdByModuleCode: async () => ({ site_id: 1 }) },
      buildSiteReportDeps: () => ({}),
      siteReportData: async () => ({ site_code: 'MGO', site_name: 'Mana', period: { label: 'July 2026' }, score: prog }),
      composeCoordinator: (d) => { seen = d; return { subject: 's', htmlBody: '', fullHtml: '' }; },
      operationalRowFor: async () => { looked++; return row; },
    };
    await sendCoordinatorReport({ db: {}, cfg: { site_score_published_model: model }, site: 'MGO', period: '2026-07', preview: true, deps });
    return { looked, seen };
  };
  const leg = await run('legacy');
  assert.strictEqual(leg.looked, 0);
  assert.ok(!('published' in leg.seen));
  const op = await run('operational');
  assert.strictEqual(op.looked, 1);
  assert.strictEqual(op.seen.published.model, 'operational');
  assert.strictEqual(op.seen.published.score, row.score);
  const pr = await run('programme');
  assert.strictEqual(pr.looked, 0, 'programme mode: the coordinator already publishes the programme score');
});
