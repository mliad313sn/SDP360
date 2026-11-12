'use strict';
// UAT-F seat 8 — SITE BUSINESS USER (`site-business`, site Hounde): reads the site's IT status, never the internal work
// queue. AI-SIMULATED committee on a synthetic organisation — NOT user acceptance. Pass A = defaults, pass B = pilot.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');
const { makeCommittee, person } = require('./fixtures/uat');

const KNOWN = {};

runJourney('UAT S8 site business user (simulation, not acceptance)', async (ctx) => {
  const { app, world, base } = ctx;
  const c = makeCommittee(Object.assign({ seat: 's8', known: KNOWN }, ctx));
  const me = await person(app, 'biz', ['site-business'], world.siteA);

  await c.run(async (pass) => {
    await c.flow('S8-01', 'Voir l’état IT de son site (Site Awareness)', async () => {
      const r = await c.api('GET', '/api/site-awareness/summary?site=' + world.siteA.id, me);
      assert.strictEqual(r.status, 200, String(r.status));
      const p = await c.page(me, '/site-awareness.html', { wait: 'body' });
      try { await p.waitForTimeout(2000); assert.deepStrictEqual(p.__errs, []); await c.shot(p, 'awareness'); } finally { await p.__close(); }
      return 'résumé HGO 200, page OK';
    });
    await c.flow('S8-02', 'Le site voisin (MANA) est refusé', async () => {
      const r = await c.api('GET', '/api/site-awareness/summary?site=' + world.siteB.id, me);
      assert.ok([403, 404].includes(r.status), String(r.status));
      return 'MGO ' + r.status;
    });
    await c.flow('S8-03', 'Aucune écriture et aucune liste interne', async () => {
      const w = await c.api('POST', '/api/meetings/save', me, { state: { header: { site_code: 'HGO', department: 'mining', meeting_date: '2026-05-02' }, issues: [], actions: [] } });
      const l = await c.api('GET', '/api/reports/site-actions?site=HGO', me);
      assert.strictEqual(w.status, 403); assert.ok(l.status >= 400, 'site-actions ' + l.status);
      return `PV ${w.status}, registre interne ${l.status}`;
    });
    await c.flow('S8-04', 'Accueil : la file interne n’est jamais interrogée', async () => {
      const p = await c.page(me, '/home.html', { wait: 'body' });
      const seen = [];
      p.on('request', (rq) => { if (/\/api\/(me\/work|reports\/site-actions)/.test(rq.url())) seen.push(rq.url()); });
      try {
        await p.reload(); await p.waitForTimeout(2500);
        assert.deepStrictEqual(p.__errs, []);
        const queue = await p.evaluate(() => !!document.querySelector('#hmQueue .hq-list'));
        assert.ok(!queue, 'no internal queue rendered');
        return `URL finale ${new URL(p.url()).pathname} ; appels internes=${seen.length}`;
      } finally { await p.__close(); }
    });
    await c.flow('S8-05', 'Site Awareness sur téléphone 320 px en français', async () => {
      const p = await c.page(me, '/site-awareness.html', { width: 320, fr: true, wait: 'body' });
      try {
        await p.waitForTimeout(2000);
        const bad = await c.layoutProblems(p); assert.deepStrictEqual(bad, []);
        await c.shot(p, 'awareness320fr');
        return 'lang=' + await p.evaluate(() => document.documentElement.lang);
      } finally { await p.__close(); }
    });
    await c.flow('S8-06', 'Profil d’espace « métier »', async () => {
      const r = await c.api('GET', '/api/workspace/me', me);
      if (pass === 'A') { assert.strictEqual(r.status, 404); return c.off('workspace_profiles_enabled=0 → 404'); }
      assert.strictEqual(r.status, 200, 'business-only account reaches its own workspace (fixed UAT-F S8-06)');
      assert.strictEqual(r.j.profile, 'business');
      const other = await c.api('GET', '/api/reports/site-actions?site=HGO', me);
      assert.strictEqual(other.status, 403, 'the boundary is otherwise unchanged');
      return 'profil=business (corrigé : la route était refusée par la frontière métier) ; registre interne toujours 403';
    });
  });
  c.finish();
}, { timeout: 300000 });
