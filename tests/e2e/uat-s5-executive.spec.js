'use strict';
// UAT-F seat 5 — EXECUTIVE (`executive`, site-less). AI-SIMULATED committee on a synthetic organisation —
// NOT user acceptance. Pass A = shipped defaults, pass B = plan F pilot profile.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');
const { makeCommittee, person } = require('./fixtures/uat');

const KNOWN = {};

runJourney('UAT S5 executive (simulation, not acceptance)', async (ctx) => {
  const { app } = ctx;
  const c = makeCommittee(Object.assign({ seat: 's5', known: KNOWN }, ctx));
  const ex = await person(app, 'exec', ['executive'], null);
  let writeA = null;

  await c.run(async (pass) => {
    await c.flow('S5-01', 'IT Review : les données du comité se chargent', async () => {
      const r = await c.api('GET', '/api/reports/review-data', ex);
      assert.strictEqual(r.status, 200);
      const p = await c.page(ex, '/it-review.html', { wait: 'body' });
      try { await p.waitForTimeout(1500); assert.deepStrictEqual(p.__errs, []); await c.shot(p, 'it-review'); } finally { await p.__close(); }
      return 'review-data 200, page sans erreur';
    });
    await c.flow('S5-02', 'Executive Scorecard : graphiques au standard exécutif (pilote)', async () => {
      const p = await c.page(ex, '/executive.html', { wait: 'body' });
      try {
        await p.waitForTimeout(2500);
        const pol = await p.evaluate(() => (window.__uiPolicy || {}).exec_charts_v2);
        assert.deepStrictEqual(p.__errs, []);
        await c.shot(p, 'scorecard');
        if (pass === 'A') return c.off('ui_exec_charts_v2=' + pol + ' : graphiques d’aujourd’hui (double axe, anneaux)');
        assert.strictEqual(String(pol), '1');
        return 'politique exec_charts_v2=1 reçue, graphiques au standard exécutif';
      } finally { await p.__close(); }
    });
    await c.flow('S5-03', 'Tableaux de bord publiés ; définition d’un KPI à portée de clic (pilote)', async () => {
      const r = await c.api('GET', '/api/dashboards', ex);
      assert.strictEqual(r.status, 200);
      const list = r.j.dashboards || r.j || [];
      const keys = list.map((d) => d.key).filter(Boolean);
      if (!keys.length) return c.blocked('aucun tableau publié dans la base synthétique');
      let best = null;
      for (const k of keys) {
        const p = await c.page(ex, '/dashboards.html?key=' + encodeURIComponent(k), { wait: 'main' });
        try { await p.waitForTimeout(2000); const n = await p.evaluate(() => document.querySelectorAll('.edv-kpi-def').length); assert.deepStrictEqual(p.__errs, [], k); if (!best || n > best.n) best = { k, n }; } finally { await p.__close(); }
      }
      if (pass === 'A') { assert.strictEqual(best.n, 0); return c.off(keys.length + ' tableau(x) rendus sans erreur ; tiroir « Définition » absent (switch off)'); }
      if (!best.n) return c.blocked(keys.length + ' tableaux rendus, aucun tiroir : aucune tuile KPI simple n’a de ligne au dictionnaire dans la base synthétique');
      return `tiroir « Définition » présent sur ${best.n} tuile(s) (${best.k})`;
    });
    await c.flow('S5-04', 'Lire le portefeuille', async () => {
      const r = await c.api('GET', '/api/governance/portfolio', ex);
      assert.strictEqual(r.status, 200);
      return 'portefeuille 200';
    });
    await c.flow('S5-05', 'Vue flotte des sites (Site Awareness)', async () => {
      const r = await c.api('GET', '/api/site-awareness/fleet', ex);
      assert.strictEqual(r.status, 200, String(r.status));
      return 'flotte 200';
    });
    await c.flow('S5-06', 'Scorecard sur téléphone 390 px', async () => {
      const p = await c.page(ex, '/executive.html', { width: 390, wait: 'body' });
      try { await p.waitForTimeout(2000); const bad = await c.layoutProblems(p); assert.deepStrictEqual(bad, []); await c.shot(p, 'scorecard390'); return 'OK'; } finally { await p.__close(); }
    });
    await c.flow('S5-07', 'Profil d’espace « executive » proposé, sans droit supplémentaire', async () => {
      const r = await c.api('GET', '/api/workspace/me', ex);
      if (pass === 'A') { assert.strictEqual(r.status, 404); writeA = (await c.api('PUT', '/api/governance/portfolio/programme', ex, { key: 'uat-x-A', name: 'x' })).status; return c.off('workspace_profiles_enabled=0 → 404 ; écriture portefeuille (palier admin) = ' + writeA); }
      assert.strictEqual(r.status, 200);
      const w = (await c.api('PUT', '/api/governance/portfolio/programme', ex, { key: 'uat-x-B', name: 'x' })).status;
      assert.strictEqual(w, writeA, 'same rights as pass A');
      return 'profil=' + r.j.profile + ' ; droit d’écriture portefeuille identique au passage A (' + w + ')';
    });
  });
  c.finish();
}, { timeout: 300000 });
