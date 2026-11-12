'use strict';
// UAT-F seat 6 — FIELD TECHNICIAN (`field-tech`, site Hounde) on a 390 px phone. AI-SIMULATED committee on a synthetic
// organisation, SIMULATED network (Chromium offline switch, not a real VSAT / 4G link) — NOT user acceptance and NOT
// the real-device field acceptance (E-F04). Pass A = shipped defaults, pass B = plan F pilot profile.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');
const { makeCommittee } = require('./fixtures/uat');

const KNOWN = {};

runJourney('UAT S6 field technician (simulation, not acceptance)', async (ctx) => {
  const { world, browser, j, login } = ctx;
  const c = makeCommittee(Object.assign({ seat: 's6', known: KNOWN }, ctx));
  const me = world.users.tech;

  await c.run(async (pass) => {
    await c.flow('S6-01', 'Ouvrir l’application terrain sur téléphone (390 px), en français', async () => {
      const cx = await j.newContext(browser, { viewport: { width: 390, height: 844 } });
      await cx.addInitScript(() => { try { localStorage.setItem('field_lang', 'fr'); } catch (_) {} });
      const p = await cx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e.message || e)));
      try {
        await login(p, me, '/field/index.html');
        await p.waitForFunction(() => { const s = document.getElementById('site'); return s && s.options.length > 0; }, null, { timeout: 20000 });
        const bad = await c.layoutProblems(p, { shell: false });
        assert.deepStrictEqual(bad, []); assert.deepStrictEqual(errs, []);
        await c.shot(p, 'field');
        return 'sites proposés=' + (await p.evaluate(() => [...document.getElementById('site').options].map((o) => o.textContent.trim()).join('|')));
      } finally { await cx.close(); }
    });
    await c.flow('S6-02', 'Saisir une inspection rapide hors ligne puis synchroniser sans perte', async () => {
      const cx = await j.newContext(browser, { viewport: { width: 390, height: 844 } });
      await cx.addInitScript(() => { try { localStorage.setItem('field_lang', 'en'); } catch (_) {} });
      const p = await cx.newPage();
      try {
        await login(p, me, '/field/index.html');
        await p.waitForFunction(() => { const s = document.getElementById('site'); return s && s.options.length > 0; }, null, { timeout: 20000 });
        const before = ((await c.api('GET', '/api/inspection/list?site=HGO', world.users.edA)).j.rows || []).length;
        await cx.setOffline(true);
        await p.click('nav.tabs button[data-view="inspect"]');
        await p.waitForSelector('#i-items button[data-ix]');
        await p.locator('#i-items button[data-st]').first().click();
        await p.fill('#i-notes', 'UAT offline capture ' + pass);
        await p.click('#i-save');
        const review = await p.$('#r-confirm, [data-review-confirm]');
        if (review) await review.click();
        await p.waitForFunction(() => document.getElementById('queue').textContent === '1', null, { timeout: 10000 });
        await cx.setOffline(false);
        await p.click('nav.tabs button[data-view="home"]');
        await p.click('#sync');
        await p.waitForFunction(() => document.getElementById('queue').textContent === '0', null, { timeout: 30000 });
        const list = await c.api('GET', '/api/inspection/list?site=HGO', world.users.edA);
        assert.strictEqual((list.j.rows || []).length, before + 1, 'one more inspection for HGO');
        return 'file 1 → 0, inspection stockée sur HGO (réseau SIMULÉ)';
      } finally { await cx.close(); }
    });
    await c.flow('S6-03', 'Le compte terrain ne peut pas écrire le rapport hebdo ni les PV', async () => {
      const a = await c.api('PUT', `/api/reports/${world.reportA}/status`, me, { status: 'submitted' });
      const b = await c.api('POST', '/api/meetings/save', me, { state: { header: { site_code: 'HGO', department: 'mining', meeting_date: '2026-05-01', intake_source: 'dept_meeting' }, issues: [], actions: [] } });
      assert.ok(a.status === 403 && b.status === 403, `${a.status}/${b.status}`);
      return 'rapport 403, PV 403';
    });
    await c.flow('S6-04', 'Accueil du technicien', async () => {
      const p = await c.page(me, '/home.html', { width: 390, wait: 'main' });
      try {
        await p.waitForTimeout(1500);
        assert.deepStrictEqual(p.__errs, []);
        const bad = await c.layoutProblems(p); assert.deepStrictEqual(bad, []);
        return 'accueil sans erreur à 390 px';
      } finally { await p.__close(); }
    });
    await c.flow('S6-05', 'Profil d’espace « terrain » proposé', async () => {
      const r = await c.api('GET', '/api/workspace/me', me);
      if (pass === 'A') { assert.strictEqual(r.status, 404); return c.off('workspace_profiles_enabled=0 → 404'); }
      assert.strictEqual(r.status, 200);
      return 'profil=' + r.j.profile + ' destinations=' + (r.j.destinations || []).map((d) => d.id || d).join(',');
    });
  });
  c.finish();
}, { timeout: 300000 });
