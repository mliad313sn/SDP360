'use strict';
// R6 (REBUILD-SPEC) — the repeatable end-to-end demonstration, runnable alone:
//   PG_ADMIN_URL=… node --test --test-force-exit tests/e2e/demo-journey.spec.js
// Boots the real app on a throwaway database, seeds the SYNTHETIC organisation with tools/demo/seed-demo.js (its
// own guard runs first — the database must be throwaway and empty of projects), then walks:
//   Home → portfolio → project (plan: measured zero vs unknown) → workbook export (same figures as the screen,
//   budget periods in two currencies and the native change request — R2-WB-01/03),
//   zero vs unknown preserved) → audit trail (History tab) → site B editor cannot see site A's project once
//   portfolio_site_scope_reads = '1' (set in THIS throwaway database only) → --remove leaves no DEMO residue.
// It proves the software path on synthetic data. It does NOT prove a field result or a realised benefit.
const assert = require('node:assert');
const path = require('path');
const XLSX = require('xlsx');
const { runJourney } = require('./fixtures/harness');
const { login } = require('./fixtures/browser');

const ROOT = path.join(__dirname, '..', '..');
const DEMO = require(path.join(ROOT, 'tools', 'demo', 'seed-demo.js'));

async function fetchBuffer(page, url) {
  const b64 = await page.evaluate(async (u) => {
    const r = await fetch(u, { credentials: 'same-origin' });
    if (!r.ok) return { status: r.status };
    const a = new Uint8Array(await r.arrayBuffer()); let s = ''; for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
    return { status: r.status, b64: btoa(s) };
  }, url);
  assert.equal(b64.status, 200, url + ' → ' + b64.status);
  return Buffer.from(b64.b64, 'base64');
}
const getJson = (page, url) => page.evaluate(async (u) => { const r = await fetch(u, { credentials: 'same-origin' }); return { status: r.status, body: await r.json().catch(() => null) }; }, url);
const sheet = (wb, name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null });

function demoSeed(holder) {
  return async (app) => {
    const pg = app.rdb.pgHandle();
    const target = await DEMO.targetIdentity(pg);
    DEMO.assertSafeTarget(target);                                   // the same guard the CLI applies
    const gov = require(path.join(ROOT, 'routes', 'governance.js')).createStore(app.rdb); await gov.init();
    const dash = require(path.join(ROOT, 'services', 'dashboardStore.js')).makeDashboardStore({ prepare: (sql) => pg.prepare(sql) }, { isPg: true });
    // R2-WORKBENCH — the workbench switches are set in THIS throwaway database only, before seeding, so the demo's
    // change request is a native one and the workbook carries the budget periods and the changes (R2-WB-01/03)
    await require(path.join(ROOT, 'services', 'reportConfig.js')).setConfig(app.rdb.db, { ppm_change_requests_enabled: '1', ppm_budget_periods_enabled: '1' }, 'demo-e2e');
    const seeded = await DEMO.seedDemo({ rdb: app.rdb, gov, dash, tag: 'e2e', nativeChangeRequests: true });
    holder.target = target;
    return { ...seeded, users: seeded.users, inventory: { ...seeded.inventory, database: target.database, schema: target.schema } };
  };
}
const holder = {};
runJourney('DEMO two-site synthetic journey: Home → portfolio → project → workbook → audit trail → site B denied', async ({ app, world, browser, j }) => {
  const { users, ids, inventory } = world;
  const target = holder.target;
  const cfg = require(path.join(ROOT, 'services', 'reportConfig.js'));
  
  // 1. PMO: Home → portfolio → project
  const pmoCtx = await j.newContext(browser, { viewport: { width: 1440, height: 900 } });
  const pmo = await pmoCtx.newPage();
  await login(pmo, app.base, users.pmo.username, users.pmo.password, '/home.html');
  await j.measure(pmo, 'home');
  await pmo.goto(app.base + '/portfolio.html');
  await pmo.waitForFunction(() => /DEMO WAN redundancy/.test(document.body.textContent), null, { timeout: 20000 });
  await j.measure(pmo, 'portfolio');
  await pmo.goto(app.base + '/project.html?id=' + ids.project + '#plan');
  await pmo.waitForSelector('#task-row-' + ids.t3, { state: 'attached', timeout: 20000 });
  const cells = async (tid) => pmo.$$eval('#task-row-' + tid + ' td', (tds) => tds.map((td) => td.textContent.trim()));
  const r2 = await cells(ids.t2), r3 = await cells(ids.t3);
  assert.equal(r2[8], '0 %', 'measured zero progress shows 0 %'); assert.equal(r2[9], '0 h', 'measured zero effort shows 0 h');
  assert.equal(r3[8], '—', 'unknown progress shows —, never 0'); assert.equal(r3[9], '—', 'unknown effort shows —');
  assert.match(r2[14] || '', new RegExp('#' + ids.t1), 'dependency shown on the plan');
  await j.measure(pmo, 'project-plan');

  // 2. Export: the workbook carries the same figures as the screen's API, zero vs unknown preserved
  const screen = (await getJson(pmo, '/api/governance/portfolio/project/' + ids.project)).body;
  const wb = XLSX.read(await fetchBuffer(pmo, '/api/governance/portfolio/workbook.xlsx'), { type: 'buffer' });
  const prow = sheet(wb, 'Projects').find((r) => r.key === screen.project.key);
  assert.ok(prow, 'project row in the workbook');
  assert.equal(Number(prow.budget), Number(screen.project.budget)); assert.strictEqual(Number(prow.spent), 0); assert.strictEqual(Number(screen.project.spent), 0);
  const trows = sheet(wb, 'Tasks').filter((r) => r.project === screen.project.key);
  for (const t of screen.tasks) {
    const w = trows.find((r) => Number(r.id) === t.id); assert.ok(w, 'task ' + t.id + ' exported');
    if (t.progress_pct == null) assert.strictEqual(w.progress_pct, null, 'unknown stays empty in the export');
    else assert.strictEqual(Number(w.progress_pct), Number(t.progress_pct), 'same progress as the screen');
  }
  const brow = sheet(wb, 'Benefits').find((r) => r.project === screen.project.key);
  assert.equal(Number(brow.baseline_value), 12); assert.equal(Number(brow.target_value), 4);
  assert.strictEqual(brow.realised_value, null, 'no realised benefit invented — empty, not 0');
  assert.equal(sheet(wb, 'Milestones').filter((r) => r.project === screen.project.key).length, 1);
  assert.equal(sheet(wb, 'RAID').filter((r) => r.project === screen.project.key).length, 1);

  // 2b. R2-WB-03 — the XOF and USD actuals of the screen (budget-periods API) are in the workbook, one currency per row
  const bpScreen = (await getJson(pmo, '/api/governance/ppm/project/' + ids.project + '/budget-periods')).body.view;
  const bpRows = sheet(wb, 'Budget periods').filter((r) => r.project === screen.project.key);
  for (const c of bpScreen.currencies) for (const p of c.periods) if (p.actual != null) {
    assert.equal(Number(bpRows.find((r) => r.currency === c.currency && r.period === p.period && r.kind === 'actual').amount), Number(p.actual), c.currency + ' actual = screen');
  }
  assert.deepEqual([...new Set(bpRows.filter((r) => r.kind === 'actual').map((r) => r.currency))].sort(), ['USD', 'XOF']);
  // 2c. R2-WB-01 — the demo change request is a native one: on the Changes tab and in the workbook "Changes" sheet
  assert.ok(ids.changeRequest, 'native change request seeded');
  assert.deepEqual(sheet(wb, 'Changes').filter((r) => r.project === screen.project.key).map((r) => [r.id, r.status, r.impact_dates_days, r.currency]), [[ids.changeRequest, 'proposed', 14, 'USD']]);
  await pmo.waitForSelector('#tab-changes:not([hidden])', { timeout: 20000 });
  await pmo.click('#tab-changes');
  await pmo.waitForFunction(() => /extend scope to site B/.test((document.getElementById('changes') || {}).textContent || ''), null, { timeout: 20000 });
  await j.measure(pmo, 'project-changes');

  // 3. Audit trail
  await pmo.click('#tab-history');
  await pmo.waitForFunction(() => document.querySelector('#history table tbody tr'), null, { timeout: 20000 });
  const hist = await pmo.textContent('#history');
  assert.match(hist, /budget_period_edit/, 'the two-currency actuals are in the ledger');
  await j.measure(pmo, 'project-history');

  // 4. Site B editor: switch OFF = today (project readable); switch ON = hidden, 404, absent from the portfolio API
  const bCtx = await j.newContext(browser, { viewport: { width: 1280, height: 800 } });
  const bp = await bCtx.newPage();
  await cfg.setConfig(app.rdb.db, { portfolio_site_scope_reads: '0' }, 'demo-e2e');
  await login(bp, app.base, users.editor_b.username, users.editor_b.password, '/portfolio.html');
  assert.equal((await getJson(bp, '/api/governance/portfolio/project/' + ids.project)).status, 200, 'switch off = today: readable');
  await cfg.setConfig(app.rdb.db, { portfolio_site_scope_reads: '1' }, 'demo-e2e');
  assert.equal((await getJson(bp, '/api/governance/portfolio/project/' + ids.project)).status, 404, 'switch on: site A project does not exist for site B');
  const list = (await getJson(bp, '/api/governance/portfolio')).body;
  assert.ok(!(list.projects || []).some((p) => p.id === ids.project), 'not in the portfolio API');
  await bp.goto(app.base + '/project.html?id=' + ids.project);
  await bp.waitForFunction(() => /Project not found/.test(document.getElementById('p-title').textContent), null, { timeout: 20000 });
  await bp.goto(app.base + '/portfolio.html'); await bp.waitForLoadState('networkidle');
  assert.doesNotMatch(await bp.textContent('body'), /DEMO WAN redundancy/, 'site A project not on the site B portfolio page');
  await j.measure(bp, 'portfolio-site-b-scoped');

  // 5. Removal: exactly the inventory, no DEMO residue
  const out = await DEMO.removeDemo({ rdb: app.rdb, inventory, target });
  assert.equal(Object.values(out.residue).reduce((a, b) => a + b, 0), 0, JSON.stringify(out));
  assert.deepStrictEqual(j.rec.page_errors, [], 'no page error');
}, { timeout: 180000, seed: demoSeed(holder) });
