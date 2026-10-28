'use strict';
// Step 9 — report store on sqlite: template validation + partial update, runs lifecycle, html omitted from lists, rating stats.
const { test } = require('node:test');
const assert = require('node:assert');
const { makeReportStore } = require('../services/reportStore');
const { SEED_TEMPLATES } = require('../services/reportGenerator');

async function fresh() { const s = makeReportStore((await require('./_pg-fresh').freshStore(['report_templates', 'report_runs'])), { now: () => '2026-10-19T10:00:00.000Z' }); await s.init(); return s; }

test('templates: key/name/dashboard/audience/cadence validation, seed once, partial update keeps other fields, disabled hidden', async () => {
  const s = await fresh();
  await assert.rejects(async () => s.saveTemplate({ key: 'bad key', name: 'x', dashboard_key: 'd' }), /template key/);
  await assert.rejects(async () => s.saveTemplate({ key: 'ok', name: 'x' }), /dashboard_key/);
  await assert.rejects(async () => s.saveTemplate({ key: 'ok', name: 'x', dashboard_key: 'd', audience: 'board' }), /audience must be/);
  await assert.rejects(async () => s.saveTemplate({ key: 'ok', name: 'x', dashboard_key: 'd', cadence: 'daily' }), /bad cadence/);
  assert.deepEqual(await s.seed(SEED_TEMPLATES), SEED_TEMPLATES.map(t => t.key)); assert.deepEqual(await s.seed(SEED_TEMPLATES), []);
  const t = await s.getTemplate('council-pack'); assert.equal(t.lang, 'fr'); assert.equal(t.ai_enabled, true); assert.deepEqual(t.sections.slice(0, 2), ['headline', 'figures']);
  const u = await s.saveTemplate({ key: 'council-pack', enabled: false }); assert.equal(u.enabled, false); assert.equal(u.name, 'Mine IT Council pack', 'untouched field kept'); assert.equal(u.lang, 'fr');
  assert.equal((await s.listTemplates()).length, 2); assert.equal((await s.listTemplates({ includeDisabled: true })).length, 3);
  await s.removeTemplate('council-pack'); assert.equal(await s.getTemplate('council-pack'), null);
});

test('runs: draft → reviewed (note, rating clamped) → published; publish stamps; list omits html but carries html_bytes; cascade with template', async () => {
  const s = await fresh(); await s.seed(SEED_TEMPLATES);
  const run = await s.createRun({ templateKey: 'site-weekly-pack', siteId: 3, windowLabel: '2026-W42', figures: [{ id: 'a', value: 1 }], analysis: { headline: 'h' }, commentary: { text: 'c', source: 'deterministic' }, html: '<html>x</html>', provider: 'deterministic', user: { id: 7 } });
  assert.equal(run.status, 'draft'); assert.equal(run.created_by, 7); assert.deepEqual(run.figures, [{ id: 'a', value: 1 }]); assert.equal(run.html, '<html>x</html>');
  await assert.rejects(async () => s.setStatus(run.id, 'weird'), /bad run status/);
  const rv = await s.setStatus(run.id, 'reviewed', { user: { id: 9 }, note: 'fine', rating: 9 }); assert.equal(rv.rating, 5); assert.equal(rv.reviewed_by, 9); assert.equal(rv.review_note, 'fine');
  const pb = await s.setStatus(run.id, 'published'); assert.equal(pb.published_at, '2026-10-19T10:00:00.000Z');
  const l = await s.listRuns({ templateKey: 'site-weekly-pack' }); assert.equal(l.length, 1); assert.equal(l[0].html, undefined); assert.equal(l[0].html_bytes, 14); assert.equal(l[0].figures, undefined);
  assert.equal((await s.listRuns({ siteIds: [4] })).length, 0, 'site-scoped list hides another site'); assert.equal((await s.listRuns({ status: ['published'] })).length, 1);
  await s.updateCommentary(run.id, { text: 'human' }); assert.equal((await s.getRun(run.id)).commentary.text, 'human');
  await s.createRun({ templateKey: 'site-weekly-pack', siteId: null, figures: [], analysis: {}, commentary: null }); const r2 = (await s.listRuns({}))[0]; await s.setStatus(r2.id, 'rejected', { rating: 2 });
  assert.deepEqual(await s.ratingStats(), { rated: 2, useful: 1, useful_pct: 50 });
  await s.removeTemplate('site-weekly-pack'); assert.equal((await s.listRuns({})).length, 0, 'runs cascade with their template');
});
