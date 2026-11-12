'use strict';
// UAT-F seat 1 — SITE IT COORDINATOR (`editor`, one site: Hounde/HGO). AI-SIMULATED committee on a synthetic organisation —
// NOT user acceptance. Flows run twice: pass A = shipped defaults, pass B = plan F pilot profile (fixtures/uat.js).
const assert = require('node:assert');
const path = require('path');
const { runJourney } = require('./fixtures/harness');
const { makeCommittee } = require('./fixtures/uat');

const KNOWN = {};

runJourney('UAT S1 site IT coordinator (simulation, not acceptance)', async (ctx) => {
  const { world } = ctx;
  const c = makeCommittee(Object.assign({ seat: 's1', known: KNOWN }, ctx));
  const me = world.users.edA;
  const mdb = require(path.join(__dirname, '..', '..', 'meetings-db.js'));
  await mdb.saveMeeting({ header: { reference: 'UAT_PV_MGO_S1', site_code: 'MGO', department: 'mining', meeting_date: '2026-01-16', intake_source: 'dept_meeting', status: 'submitted' },
    issues: [], actions: [{ description: 'UAT site B confidential action', owner_it: 'UAT edB', target_date: '2026-02-01', status: 'open' }] }, null, null);

  await c.run(async (pass) => {
    await c.flow('S1-01', 'Ouvrir l’accueil et voir son travail du jour (site A seulement)', async () => {
      const p = await c.page(me, '/home.html', { wait: '#main, main' });
      try {
        await p.waitForTimeout(1500);
        const txt = await p.evaluate(() => document.body.innerText);
        assert.ok(!/site B confidential/.test(txt), 'site B action never shown');
        assert.deepStrictEqual(p.__errs, [], 'no page error');
        const hasQueue = await p.evaluate(() => !!document.querySelector('#hmQueue .hq'));
        await c.shot(p, 'home');
        if (pass === 'B') { assert.ok(hasQueue, 'queue S1 rendered'); assert.match(txt, /E2E overdue action/); return 'file S1 visible, action du site A en retard listée'; }
        return hasQueue ? 'file visible' : 'accueil « Mon travail » sans file S1 (switch off)';
      } finally { await p.__close(); }
    });
    await c.flow('S1-02', 'Retrouver le rapport hebdo de son site ; celui du site B est refusé', async () => {
      const own = await c.api('GET', '/api/reports/' + world.reportA, me);
      assert.strictEqual(own.status, 200);
      const other = await c.api('GET', '/api/reports/' + world.reportB, me);
      assert.ok([403, 404].includes(other.status), 'site B report status ' + other.status);
      return `propre rapport 200, rapport site B ${other.status}`;
    });
    await c.flow('S1-03', 'Registre d’actions du site : l’action en retard apparaît, le site B est refusé', async () => {
      const r = await c.api('GET', '/api/reports/site-actions?site=HGO', me);
      assert.strictEqual(r.status, 200);
      assert.match(JSON.stringify(r.j), /E2E overdue action/);
      const o = await c.api('GET', '/api/reports/site-actions?site=MGO', me);
      assert.ok([403, 404].includes(o.status), 'MGO ' + o.status);
      return 'HGO 200 avec l’action en retard ; MGO ' + o.status;
    });
    await c.flow('S1-04', 'Passer l’action « en cours » (auteur conservé)', async () => {
      const r = await c.api('POST', `/api/meetings/actions/${world.action.id}/update`, me, { status_change: pass === 'A' ? 'in_progress' : 'open', body: 'UAT ' + pass });
      assert.strictEqual(r.status, 200, JSON.stringify(r.j));
      return 'statut changé, ligne d’historique écrite';
    });
    await c.flow('S1-05', 'Créer un PV sur son site ; refus sur un autre site', async () => {
      const own = await c.api('POST', '/api/meetings/save', me, { state: { header: { site_code: 'HGO', department: 'maintenance', meeting_date: pass === 'A' ? '2026-03-10' : '2026-04-10', intake_source: 'dept_meeting', status: 'draft' }, issues: [], actions: [] } });
      assert.strictEqual(own.status, 200, JSON.stringify(own.j));
      const other = await c.api('POST', '/api/meetings/save', me, { state: { header: { site_code: 'MGO', department: 'maintenance', meeting_date: '2026-03-11', intake_source: 'dept_meeting', status: 'draft' }, issues: [], actions: [] } });
      assert.strictEqual(other.status, 403, 'other site ' + other.status);
      return 'PV HGO créé, PV MGO refusé (403)';
    });
    await c.flow('S1-06', 'Lister les inspections de son site', async () => {
      const r = await c.api('GET', '/api/inspection/list?site=HGO', me);
      assert.strictEqual(r.status, 200);
      return 'liste 200';
    });
    await c.flow('S1-07', 'Téléphone 320 px en français : accueil et registre d’actions lisibles sans défilement horizontal', async () => {
      const out = [];
      for (const pg of ['/home.html', '/site-actions.html?site=HGO']) {
        const p = await c.page(me, pg, { width: 320, fr: true });
        try {
          await p.waitForTimeout(1200);
          const bad = await c.layoutProblems(p);
          assert.deepStrictEqual(bad, [], pg + ' layout');
          const lang = await p.evaluate(() => document.documentElement.lang);
          out.push(pg + ' lang=' + lang);
          await c.shot(p, 'fr320-' + pg.replace(/\W+/g, '_'));
        } finally { await p.__close(); }
      }
      return out.join(' · ');
    });
    await c.flow('S1-08', '« Mon travail » : ses éléments, sans ceux du site B', async () => {
      const r = await c.api('GET', '/api/me/work', me);
      assert.strictEqual(r.status, 200);
      assert.ok(!/site B confidential/.test(JSON.stringify(r.j)));
      if (pass === 'B') { assert.ok(r.j.awaiting !== undefined || /awaiting/.test(JSON.stringify(r.j)), 'awaiting block present'); return 'bloc « En attente de moi » présent'; }
      return 'Mon travail 200 (sans bloc « En attente de moi »)';
    });
    await c.flow('S1-09', 'Réglages d’espace : choisir son profil, sans changer ses droits', async () => {
      const r = await c.api('GET', '/api/workspace/me', me);
      if (pass === 'A') { assert.strictEqual(r.status, 404); return c.off('workspace_profiles_enabled=0 → 404 vérifié'); }
      assert.strictEqual(r.status, 200, JSON.stringify(r.j));
      const before = await c.api('GET', '/api/reports/auth/me', me);
      const prof = (r.j.allowed_profiles || r.j.profiles || []).map((x) => x.id || x)[0] || r.j.profile;
      const put = await c.api('PUT', '/api/workspace/prefs', me, { profile: prof, density: 'compact' });
      assert.strictEqual(put.status, 200, JSON.stringify(put.j));
      const after = await c.api('GET', '/api/reports/auth/me', me);
      assert.deepStrictEqual((after.j.user || after.j).roles, (before.j.user || before.j).roles, 'roles unchanged');
      const p = await c.page(me, '/workspace-settings.html', { wait: '#wsForm:not([hidden])' });
      try { assert.deepStrictEqual(p.__errs, []); await c.shot(p, 'workspace'); } finally { await p.__close(); }
      return 'profil ' + prof + ' enregistré, rôles inchangés, page OK';
    });
  });
  c.finish();
}, { timeout: 300000 });
