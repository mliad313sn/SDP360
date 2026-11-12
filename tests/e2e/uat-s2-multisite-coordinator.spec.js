'use strict';
// UAT-F seat 2 — COORDINATOR OF TWO SITES (`editor`, Hounde primary + Sabodala extra). AI-SIMULATED committee on a
// synthetic organisation — NOT user acceptance. Pass A = shipped defaults, pass B = plan F pilot profile.
const assert = require('node:assert');
const path = require('path');
const { runJourney } = require('./fixtures/harness');
const { makeCommittee, person } = require('./fixtures/uat');

const KNOWN = {};

runJourney('UAT S2 two-site coordinator (simulation, not acceptance)', async (ctx) => {
  const { app, world } = ctx;
  const c = makeCommittee(Object.assign({ seat: 's2', known: KNOWN }, ctx));
  const sites = await app.rdb.listSites({ includeInactive: true });
  const sgo = sites.find((s) => s.name === 'Sabodala');
  const wk = await app.rdb.getPreviousWeek();
  await app.rdb.ensureReport(sgo.id, wk.year, wk.week);
  const me = await person(app, 'ms', ['editor', 'tracker-editor'], world.siteA, { extra_site_ids: [sgo.id] });   // coordinators hold tracker-editor (2026-10-02)
  const mdb = require(path.join(__dirname, '..', '..', 'meetings-db.js'));
  await mdb.saveMeeting({ header: { reference: 'UAT_PV_SGO_S2', site_code: 'SGO', department: 'mining', meeting_date: '2026-01-17', intake_source: 'dept_meeting', status: 'submitted' },
    issues: [], actions: [{ description: 'UAT Sabodala overdue action', owner_it: 'UAT ms', target_date: '2026-02-01', status: 'open' }] }, null, null);
  await mdb.saveMeeting({ header: { reference: 'UAT_PV_MGO_S2', site_code: 'MGO', department: 'mining', meeting_date: '2026-01-17', intake_source: 'dept_meeting', status: 'submitted' },
    issues: [], actions: [{ description: 'UAT Mana foreign action', owner_it: 'UAT edB', target_date: '2026-02-01', status: 'open' }] }, null, null);

  await c.run(async (pass) => {
    await c.flow('S2-01', 'Voir les rapports hebdo de ses deux sites, jamais MANA', async () => {
      const r = await c.api('GET', '/api/reports', me);
      assert.strictEqual(r.status, 200);
      const names = [...new Set((Array.isArray(r.j) ? r.j : (r.j.reports || [])).map((x) => x.site_name))].sort();
      assert.deepStrictEqual(names, ['Hounde', 'Sabodala']);
      return names.join(' + ');
    });
    await c.flow('S2-02', 'Tracker : les deux codes de site sont proposés', async () => {
      const r = await c.api('GET', '/api/tracker/load', me);
      assert.strictEqual(r.status, 200);
      assert.ok(Array.isArray(r.j.scopes) && r.j.scopes.length === 2, 'two tracker scopes: ' + JSON.stringify(r.j.scopes));
      return 'scopes=' + JSON.stringify(r.j.scopes) + ' (le compte porte aussi tracker-editor, comme les coordinateurs réels)';
    });
    await c.flow('S2-03', 'Écrire un PV sur le 2ᵉ site ; MANA refusé', async () => {
      const ok = await c.api('POST', '/api/meetings/save', me, { state: { header: { site_code: 'SGO', department: 'maintenance', meeting_date: pass === 'A' ? '2026-03-12' : '2026-04-12', intake_source: 'dept_meeting', status: 'draft' }, issues: [], actions: [] } });
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.j));
      const no = await c.api('POST', '/api/meetings/save', me, { state: { header: { site_code: 'MGO', department: 'maintenance', meeting_date: '2026-03-12', intake_source: 'dept_meeting', status: 'draft' }, issues: [], actions: [] } });
      assert.strictEqual(no.status, 403);
      return 'SGO 200, MGO 403';
    });
    await c.flow('S2-04', 'Accueil : file de travail des deux sites (jamais MANA)', async () => {
      const p = await c.page(me, '/home.html', { wait: 'main' });
      try {
        await p.waitForTimeout(2000);
        const txt = await p.evaluate(() => document.body.innerText);
        assert.ok(!/Mana foreign action/.test(txt), 'MANA never shown');
        assert.deepStrictEqual(p.__errs, []);
        if (pass === 'A') return 'pas de file S1 (switch off) — accueil sans liste d’actions agrégée';
        assert.match(txt, /E2E overdue action/); assert.match(txt, /Sabodala overdue action/);
        await c.shot(p, 'home-two-sites');
        return 'actions Hounde ET Sabodala dans la file';
      } finally { await p.__close(); }
    });
    await c.flow('S2-05', 'Le menu garde le site courant (Sabodala) quand on navigue', async () => {
      const p = await c.page(me, '/site-actions.html?site=SGO', { wait: '#__shell a' });
      try {
        const hrefs = await p.evaluate(() => [...document.querySelectorAll('#__shell a')].map((a) => a.getAttribute('href') || ''));
        const carried = hrefs.includes('site-actions.html?site=SGO');
        if (pass === 'A') { assert.ok(!carried, 'off: site not carried'); return c.off('ui_nav_carry_site=0 : le lien du menu ne garde pas ?site=SGO'); }
        assert.ok(carried, JSON.stringify(hrefs.filter((h) => /site-actions/.test(h))));
        return 'lien du menu = site-actions.html?site=SGO';
      } finally { await p.__close(); }
    });
    await c.flow('S2-06', 'Site par défaut : seuls ses deux sites sont proposés ; MANA refusé', async () => {
      const r = await c.api('GET', '/api/workspace/me', me);
      if (pass === 'A') { assert.strictEqual(r.status, 404); return c.off('workspace_profiles_enabled=0 → 404'); }
      assert.strictEqual(r.status, 200);
      assert.deepStrictEqual(r.j.sites.map((s) => s.name).sort(), ['Hounde', 'Sabodala']);
      const bad = await c.api('PUT', '/api/workspace/prefs', me, { default_site_id: world.siteB.id });
      assert.strictEqual(bad.status, 400);
      const ok = await c.api('PUT', '/api/workspace/prefs', me, { default_site_id: sgo.id });
      assert.strictEqual(ok.status, 200, JSON.stringify(ok.j));
      return 'sites proposés = Hounde, Sabodala ; MANA 400 ; Sabodala enregistré';
    });
    await c.flow('S2-07', 'Page Rapports à 320 px sans défilement horizontal', async () => {
      const p = await c.page(me, '/reports.html', { width: 320, wait: '#report-list-grid .report-card' });
      try { const bad = await c.layoutProblems(p); assert.deepStrictEqual(bad, []); await c.shot(p, 'reports320'); return 'OK'; } finally { await p.__close(); }
    });
  });
  c.finish();
}, { timeout: 300000 });
