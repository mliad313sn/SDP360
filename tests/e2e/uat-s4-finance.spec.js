'use strict';
// UAT-F seat 4 — FINANCE READER (`finance-viewer`, site-less). AI-SIMULATED committee on a synthetic organisation —
// NOT user acceptance. Pass A = shipped defaults, pass B = plan F pilot profile. Every amount is synthetic.
const assert = require('node:assert');
const http = require('http');
const { runJourney } = require('./fixtures/harness');
const { makeCommittee, person } = require('./fixtures/uat');

const KNOWN = {};

runJourney('UAT S4 finance reader (simulation, not acceptance)', async (ctx) => {
  const { app, world, base } = ctx;
  const c = makeCommittee(Object.assign({ seat: 's4', known: KNOWN }, ctx));
  const fin = await person(app, 'fin', ['viewer', 'finance-viewer'], null);
  const viewer = await person(app, 'vw', ['viewer'], null);
  const pmo = world.users.groupit;
  const put = (k, u, b) => c.api('PUT', '/api/governance/portfolio/' + k, u, b);
  await put('project', pmo, { id: world.projA, objective_id: undefined, key: 'E2E-A', name: 'E2E project Hounde', budget: 50000, currency: 'USD', site_id: world.siteA.id });
  const H = require('../../assets-db').pgHandle();
  await H.prepare('INSERT INTO assets (asset_id, asset_name, product_type, state, site, purchase_cost) VALUES (?,?,?,?,?,?)').run('UAT-A1', 'UAT-A1', 'Laptop', 'In Use', 'Sabodala', '1,000,000.00');
  const xlsxSheets = (u) => new Promise((res) => {
    const url = new URL(base + '/api/governance/portfolio/workbook.xlsx');
    http.get({ hostname: url.hostname, port: url.port, path: url.pathname, headers: { 'x-report-token': u.token } }, (x) => { const b = []; x.on('data', (d) => b.push(d)); x.on('end', () => {
      try { const XLSX = require('xlsx'); res({ status: x.statusCode, sheets: XLSX.read(Buffer.concat(b), { type: 'buffer' }).SheetNames }); } catch (e) { res({ status: x.statusCode, sheets: [], err: e.message }); }
    }); });
  });

  await c.run(async (pass) => {
    await c.flow('S4-01', 'Voir le budget d’un projet (un simple lecteur ne le voit pas)', async () => {
      const f = await c.api('GET', `/api/governance/portfolio/project/${world.projA}`, fin);
      assert.strictEqual(f.status, 200);
      const v = await c.api('GET', `/api/governance/portfolio/project/${world.projA}`, viewer);
      const fs = JSON.stringify(f.j); const vs = JSON.stringify(v.j);
      assert.match(fs, /50000/, 'finance sees the budget');
      assert.ok(!/50000/.test(vs), 'viewer does not');
      return 'budget visible pour Finance, masqué pour un lecteur';
    });
    await c.flow('S4-02', 'Montants des actifs : la page Finance s’ouvre et dit « non certifié »', async () => {
      const s = await c.api('GET', '/api/assets/finance/summary', fin);
      assert.strictEqual(s.status, 200);
      const p = await c.page(fin, '/assets.html#finance', { wait: '#fin-finBody tr' });
      try { assert.deepStrictEqual(p.__errs, []); await c.shot(p, 'assets-finance'); } finally { await p.__close(); }
      return 'certification=' + JSON.stringify(s.j.certification && s.j.certification.certified);
    });
    await c.flow('S4-03', 'Bénéfice : classer la valeur (trésorerie réalisée / coût évité estimé) et lire les totaux par classe', async () => {
      const b = await put('benefit', pmo, { project_id: world.projA, description: 'UAT cost avoided ' + pass, measure: 'USD', unit: 'USD', baseline_value: 0, target_value: 1000, value_kind: 'money', currency: 'USD', value_class: 'cost_avoidance_estimate', basis: 'estimated_avoidance', owner: 'Site GM', review_date: '2026-12-15' });
      assert.strictEqual(b.status, 200, JSON.stringify(b.j));
      const f = await c.api('GET', `/api/governance/portfolio/project/${world.projA}`, fin);
      const ben = (f.j.benefits || []).find((x) => x.id === b.j.id) || {};
      if (pass === 'A') { assert.ok(!ben.value_class); return c.off('benefit_value_class_enabled=0 : la classe est ignorée, pas de totaux par classe'); }
      assert.strictEqual(ben.value_class, 'cost_avoidance_estimate');
      assert.ok(f.j.benefit_totals, 'totals present');
      return 'classe enregistrée, totaux par classe présents (aucune valeur réalisée inventée)';
    });
    await c.flow('S4-04', 'Un montant sans devise est signalé (avertissement) ou refusé (pilote)', async () => {
      const r = await put('project', pmo, { objective_id: (await c.api('GET', `/api/governance/portfolio/project/${world.projA}`, pmo)).j.project.objective_id, key: 'UAT-NOCUR-' + pass, name: 'UAT no currency', budget: 1200 });
      if (pass === 'A') { assert.strictEqual(r.status, 200); assert.ok(r.j.warnings && r.j.warnings.length, 'warning'); return 'enregistré avec avertissement : ' + JSON.stringify(r.j.warnings).slice(0, 120); }
      assert.strictEqual(r.status, 400, JSON.stringify(r.j));
      return 'refusé 400 : devise obligatoire';
    });
    await c.flow('S4-05', 'Finance ne peut rien modifier dans le portefeuille', async () => {
      const r = await put('project', fin, { id: world.projA, name: 'hacked' });
      assert.strictEqual(r.status, 403, String(r.status));
      return 'écriture refusée 403';
    });
    await c.flow('S4-06', 'Classeur : feuille des périodes budgétaires visible pour Finance seulement', async () => {
      const f = await xlsxSheets(fin); const v = await xlsxSheets(viewer);
      assert.strictEqual(f.status, 200);
      const has = (x) => x.sheets.some((n) => /budget period/i.test(n));
      if (pass === 'A') { assert.ok(!has(f)); return c.off('ppm_budget_periods_enabled=0 : pas de feuille ; feuilles=' + f.sheets.join(',')); }
      assert.ok(has(f), f.sheets.join(',')); assert.ok(!has(v), 'viewer sheet hidden');
      return 'feuille présente pour Finance, absente pour un lecteur';
    });
  });
  c.finish();
}, { timeout: 300000 });
