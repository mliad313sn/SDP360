'use strict';
// UAT-F seat 3 — GROUP IT MANAGER / PMO (`viewer` + `committee-member`, site-less) with a second committee member as
// independent approver. AI-SIMULATED committee on a synthetic organisation — NOT user acceptance.
// Pass A = shipped defaults, pass B = plan F pilot profile.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');
const { makeCommittee, person } = require('./fixtures/uat');

const KNOWN = {};

runJourney('UAT S3 Group IT manager / PMO (simulation, not acceptance)', async (ctx) => {
  const { app, world } = ctx;
  const c = makeCommittee(Object.assign({ seat: 's3', known: KNOWN }, ctx));
  const me = world.users.groupit;
  const cio = await person(app, 'cio', ['viewer', 'committee-member'], null);
  const put = (k, u, b) => c.api('PUT', '/api/governance/portfolio/' + k, u, b);
  const obj = (await c.api('GET', '/api/governance/portfolio', me)).j.objectives?.[0]?.id
    || (await put('objective', me, { programme_id: (await put('programme', me, { key: 'uat-p', name: 'UAT' })).j.id, key: 'uat-o', name: 'UAT' })).j.id;
  const p3 = (await put('project', me, { objective_id: obj, key: 'UAT-CR', name: 'UAT failover project', owner: 'uat_owner', sponsor: 'Sponsor', site_id: world.siteA.id,
    charter: 'Second WAN link for the synthetic mine, with failover tests and documentation (synthetic).', start_date: '2026-11-02', end_date: '2027-02-26', baseline_start: '2026-11-02', baseline_end: '2027-02-26' })).j.id;
  for (const to of ['approval', 'in_progress']) { const r = await c.api('POST', `/api/governance/portfolio/project/${p3}/stage`, cio, { to }); if (r.status !== 200) throw new Error('stage ' + JSON.stringify(r.j)); }
  const meId = Number((await app.rdb.pgHandle().prepare('SELECT id FROM users WHERE username = ?').get(me.username)).id);
  const cad = await c.api('PUT', '/api/governance/cadences', me, { key: 'uat-cab', name: 'UAT PMO committee', kind: 'group_monthly', site_id: null, weekday: 3, time_local: '10:00', duration_min: 60, participants: [], chair_id: meId });
  if (cad.status !== 200) throw new Error('cadence ' + JSON.stringify(cad.j));
  const task = (await put('task', me, { project_id: world.projA, name: 'UAT cabling', owner: 'Ana', effort_hours: 10 })).j.id;

  await c.run(async (pass) => {
    await c.flow('S3-01', 'Lire le portefeuille en liste / tableau / chronologie', async () => {
      const p = await c.page(me, '/portfolio.html?view=board', { wait: 'main' });
      try {
        await p.waitForTimeout(2000);
        const v = await p.evaluate(() => ({ views: document.getElementById('pf-views').hidden ? 0 : document.querySelectorAll('#pf-views .pf-view').length, cur: document.querySelectorAll('.pf-view[aria-current="page"]').length, txt: document.body.innerText }));
        assert.deepStrictEqual(p.__errs, []);
        assert.match(v.txt, /E2E project Hounde/);
        await c.shot(p, 'portfolio-board');
        if (pass === 'A') { assert.strictEqual(v.views, 0); return c.off('portfolio_views_enabled=0 : chronologie seule, ?view=board ignoré'); }
        assert.strictEqual(v.views, 3); assert.strictEqual(v.cur, 1);
        return 'sélecteur 3 vues, une seule active (board)';
      } finally { await p.__close(); }
    });
    await c.flow('S3-02', 'Ouvrir un projet, onglet Plan', async () => {
      const p = await c.page(me, '/project.html?id=' + world.projA, { wait: '#tab-plan' });
      try {
        await p.click('#tab-plan'); await p.waitForTimeout(800);
        assert.match(await p.evaluate(() => document.body.innerText), /UAT cabling/);
        assert.deepStrictEqual(p.__errs, []);
        const changes = await p.evaluate(() => !document.getElementById('tab-changes').hidden);
        return 'Plan lisible ; onglet Changes ' + (changes ? 'visible' : 'masqué');
      } finally { await p.__close(); }
    });
    await c.flow('S3-03', 'Déclarer un membre d’équipe (rôle + allocation) ; 150 % refusé', async () => {
      const url = `/api/governance/ppm/project/${world.projA}/team`;
      const r = await c.api('PUT', url, me, { label: 'Ana', role: 'radio technician', allocation_pct: 60 });
      if (pass === 'A') { assert.strictEqual(r.status, 404); return c.off('ppm_project_team_enabled=0 → 404'); }
      assert.strictEqual(r.status, 200, JSON.stringify(r.j));
      assert.strictEqual((await c.api('PUT', url, me, { label: 'Bob', allocation_pct: 150 })).status, 400);
      return 'membre ajouté (60 %), 150 % refusé 400 ; le nom reste du texte libre';
    });
    await c.flow('S3-04', 'Saisir des heures réelles sur une tâche ; 25 h refusées', async () => {
      const url = `/api/governance/ppm/task/${task}/time`;
      const r = await c.api('POST', url, me, { day: '2026-11-03', hours: 4, person_label: 'Ana' });
      if (pass === 'A') { assert.strictEqual(r.status, 404); return c.off('ppm_time_entries_enabled=0 → 404'); }
      assert.strictEqual(r.status, 200, JSON.stringify(r.j));
      assert.strictEqual((await c.api('POST', url, me, { day: '2026-11-03', hours: 25 })).status, 400);
      const ah = await c.api('GET', `/api/governance/ppm/project/${world.projA}/actual-hours`, me);
      assert.strictEqual(ah.status, 200);
      return '4 h enregistrées, 25 h refusées, heures réelles lisibles';
    });
    await c.flow('S3-05', 'Demande de changement : proposer, évaluer, faire approuver par un AUTRE membre', async () => {
      const url = `/api/governance/ppm/project/${p3}/changes`;
      const cr = await c.api('POST', url, me, { title: 'UAT add site B', reason: 'site B asked for the same failover (synthetic)', impact_dates_days: 7 });
      if (pass === 'A') { assert.strictEqual(cr.status, 404); return c.off('ppm_change_requests_enabled=0 → 404 (seul substitut : une RFI)'); }
      assert.strictEqual(cr.status, 200, JSON.stringify(cr.j));
      const id = cr.j.change.id; const step = (u, a, note) => c.api('POST', `${url}/${id}/${a}`, u, { note });
      assert.strictEqual((await step(me, 'assess', 'impact checked')).status, 200);
      const self = await step(me, 'approve'); assert.strictEqual(self.status, 403);
      assert.strictEqual((await step(cio, 'approve', 'agreed')).status, 200);
      const ap = await step(cio, 'apply'); assert.strictEqual(ap.status, 200, JSON.stringify(ap.j));
      return 'proposée → évaluée → auto-approbation refusée (403) → approuvée par un tiers → appliquée (version de référence ' + ap.j.change.applied_baseline_version + ')';
    });
    await c.flow('S3-06', 'Préparer une séance du comité et faire évoluer une décision', async () => {
      const s = await c.api('POST', `/api/governance/cadences/${cad.j.cadence.id}/sessions`, me, {});
      assert.strictEqual(s.status, 200, JSON.stringify(s.j));
      const notChair = await c.api('POST', `/api/governance/sessions/${(await c.api('POST', `/api/governance/cadences/${world.cadenceId}/sessions`, me, {})).j.session.id}/decisions`, me, { title: 'x' });
      const d = await c.api('POST', `/api/governance/sessions/${s.j.session.id}/decisions`, me, { title: 'UAT decision ' + pass, owner: 'PMO', due_date: '2026-12-01' });
      assert.strictEqual(d.status, 200, JSON.stringify(d.j));
      const up = await c.api('PUT', `/api/governance/decisions/${d.j.decision.id}`, me, { status: 'done', reason: 'delivered (synthetic)' });
      const h = await c.api('GET', `/api/governance/decisions/${d.j.decision.id}/history`, me);
      assert.strictEqual(h.status, 200);
      return `sans présidence: ${notChair.status} ; comme président: décision créée ; passage à done → ${up.status} ${up.j && up.j.decision ? up.j.decision.status : JSON.stringify(up.j)} ; cycle de vie imposé = ${h.j.lifecycle_enforced}`;
    });
    await c.flow('S3-07', 'Vue par département (consolidation)', async () => {
      const r = await c.api('GET', '/api/governance/department-rollup', me);
      if (pass === 'A') { assert.strictEqual(r.status, 404); return c.off('department_rollup_enabled=0 → 404'); }
      assert.strictEqual(r.status, 200, JSON.stringify(r.j));
      return `rollup 200, correspondances proposées=${r.j.proposed}`;
    });
    await c.flow('S3-08', 'Exporter le classeur du portefeuille', async () => {
      const r = await app.rdb.pgHandle ? await new Promise((res) => {
        const u = new URL(ctx.base + '/api/governance/portfolio/workbook.xlsx');
        require('http').get({ hostname: u.hostname, port: u.port, path: u.pathname, headers: { 'x-report-token': me.token } }, (x) => { let n = 0; x.on('data', (b) => { n += b.length; }); x.on('end', () => res({ status: x.statusCode, type: x.headers['content-type'], n })); });
      }) : null;
      assert.strictEqual(r.status, 200); assert.ok(r.n > 1000, 'non-empty file');
      return `xlsx ${r.n} octets`;
    });
    await c.flow('S3-09', 'Cockpit des réunions de gouvernance', async () => {
      const p = await c.page(me, '/cockpit.html', { wait: '#cadences tr' });
      try { assert.deepStrictEqual(p.__errs, []); return 'cockpit OK'; } finally { await p.__close(); }
    });
  });
  c.finish();
}, { timeout: 300000 });
