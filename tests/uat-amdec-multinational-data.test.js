'use strict';
// AMDEC 2026-11-05 — agent-executed scenario campaign ("UAT simulée", NOT user acceptance).
// Data truth across countries, currencies, sub-sites, calendars and volume, on the seeded multinational
// world of tests/_uat-world.js. Scenario ids refer to docs/audits/2026-11-05-amdec/SCENARIOS.md.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const W = require('./_uat-world');

let ctx, w, rdb;
before(async () => { ctx = await W.boot(); w = await W.seedWorld(ctx); rdb = ctx.rdb; });
after(async () => { if (ctx) await ctx.close(); });

let n = 0;
async function ticket(o) {
  await rdb.db.prepare(`INSERT INTO request_records (request_id, request_status, pending_status, overdue_status, responded_time, first_response_overdue, tech_group, site, created_time, resolved_time)
    VALUES (?,?,?,?,?,?,?,?,?,?)`).run('UAT-AMDEC-' + (++n), o.pending ? 'Open' : 'Closed', o.pending ? 1 : 0, o.overdue ? 1 : 0, '2026-09-08T09:00:00Z', 'false',
    o.group, o.site || null, o.created || '2026-09-08T08:00:00Z', o.pending ? null : (o.resolved || '2026-09-08T12:00:00Z'));
}

test('DAT-01 shared service desk: Exploration counts its three country groups (BF + CI); the free-text site label is ignored', async () => {
  await ticket({ group: 'Exploration BF Support', site: 'Tanda' });
  await ticket({ group: 'Exploration CI Support', site: 'Fetekro Explorarion Office', overdue: true });
  await ticket({ group: 'Exploration IT Support', site: 'Exploration CI', pending: true, created: '2026-09-09T08:00:00Z' });
  await ticket({ group: 'Sabodala IT Agents', site: 'MASSAWA' });     // label says Massawa, group says Sabodala
  await ticket({ group: 'Massawa IT Agents', site: 'Massawa' });
  const exp = await rdb.getSiteHelpdeskWindow(w.S.Exploration.id, '2026-09-07', '2026-09-13');
  assert.deepStrictEqual([exp.created, exp.resolved, exp.backlog, exp.sla_overdue], [3, 2, 1, 1]);
  const sgo = await rdb.getSiteHelpdeskWindow(w.S.Sabodala.id, '2026-09-07', '2026-09-13');
  const mas = await rdb.getSiteHelpdeskWindow(w.S.Massawa.id, '2026-09-07', '2026-09-13');
  assert.equal(sgo.created, 1, 'the Sabodala group ticket belongs to Sabodala whatever its label');
  assert.equal(mas.created, 1, 'Massawa is its own site (user decision 4f5d427)');
});

test('DAT-02 empty-data site (Kalana): nothing measured reads null, never 0 % or green', async () => {
  const m = await rdb.getCalendarMonthlyHelpdesk(w.S.Kalana.id, 2026, 9);
  assert.equal(m.inbound, 0); assert.equal(m.close_pct, null); assert.equal(m.sla_res_pct, null);
  const win = await rdb.getSiteHelpdeskWindow(w.S.Kalana.id, '2026-09-07', '2026-09-13');
  assert.equal(win.avg_resolution_h, null);
  const sd = await w.call('GET', '/api/reports/site-data?site=KGO', w.users.central.token);
  assert.equal(sd.status, 200);
  assert.equal(sd.j.score.applicable, false); assert.equal(sd.j.score.rag, null);
  assert.notEqual(sd.j.inspection.overall_risk, 'low', 'no inspection is never "low risk"');
});

test('DAT-03 currencies: GBP (London) and XOF (Sabodala) convert at their own rate; a site without a currency is UNKNOWN (null), not 0', async () => {
  const cfg = require('../services/reportConfig');
  await cfg.setConfig(rdb.db, { asset_site_currency: JSON.stringify({ 'London Office': 'GBP', Sabodala: 'XOF' }), asset_currency_rates: JSON.stringify({ GBP: 1.27 }) }, 'uat');
  const H = require('../assets-db').pgHandle();
  for (const [id, site, cost] of [['UAT-A1', 'London Office', '1,000.00'], ['UAT-A2', 'Sabodala', '1,000,000.00'], ['UAT-A3', 'Assafo', '500,000.00']])
    await H.prepare('INSERT INTO assets (asset_id, asset_name, product_type, state, site, purchase_cost) VALUES (?,?,?,?,?,?)').run(id, id, 'Laptop', 'In Use', site, cost);
  const r = await w.call('GET', '/api/assets/finance/summary', w.users.fin.token);
  assert.equal(r.status, 200, r.text);
  const by = Object.fromEntries(r.j.by_site.map((s) => [s.site, s]));
  assert.equal(by['London Office'].currency, 'GBP'); assert.equal(Math.round(by['London Office'].purchase_cost_usd), 1270);
  assert.equal(by.Sabodala.currency, 'XOF'); assert.equal(Math.round(by.Sabodala.purchase_cost_usd), 1650);
  assert.equal(r.j.excluded.no_currency, 1);
  assert.equal(by.Assafo.currency, null);
  assert.equal(by.Assafo.purchase_cost_usd, null, 'an amount that could not be converted is UNKNOWN, never 0');
  assert.equal(Math.round(r.j.fleet.purchase_cost_usd), 2920, 'fleet total = converted amounts only, the excluded row is counted apart');
  // D-06: while a row is excluded the money figure is NOT certified, and says why.
  assert.equal(r.j.certification.certified, false);
  assert.equal(r.j.certification.reason, 'excluded_rows');
  assert.equal(r.j.certification.excluded_rows, 1);
  const assafo = r.j.coverage_by_site.find((x) => x.site === 'Assafo');
  assert.deepStrictEqual([assafo.eligible, assafo.total], [0, 1], 'an excluded row is not counted as covered');
  await cfg.setConfig(rdb.db, { asset_site_currency: '', asset_currency_rates: '' }, 'uat');
});

test('DAT-04 two week conventions: the weekly report week is Zoho Sun→Sat, the site-report chart week is ISO Mon→Sun; both say "W37 2026"', () => {
  const zoho = rdb.getWeekRange(2026, 37);
  assert.deepStrictEqual([zoho.start, zoho.end, zoho.label], ['2026-09-13', '2026-09-19', 'W37 2026']);
  const iso = require('../services/siteReportDeps')._lastIsoWeeks('2026-09-13', 1)[0];
  assert.deepStrictEqual([iso.from, iso.to, iso.label], ['2026-09-07', '2026-09-13', 'W37 2026']);
  assert.notEqual(zoho.start, iso.from, 'same label, different dates — recorded as AMDEC mode AM-07 (follow-up FU-03)');
});

test('DAT-05 year boundary: 1–2 Jan 2027 belong to Zoho W52 2026; the report API refuses a week that does not exist (53, 99, -1, 0)', async () => {
  const w52 = rdb.getWeekRange(2026, 52);
  assert.deepStrictEqual([w52.start, w52.end], ['2026-12-27', '2027-01-02']);
  assert.equal(rdb.getISOWeek(new Date(Date.UTC(2027, 0, 2))).week, 52);
  assert.equal(rdb.zohoWeeksInYear(2026), 52);
  assert.equal(rdb.zohoWeeksInYear(2023), 53, '2023 starts on a Sunday → 53 Zoho weeks');
  const tok = w.users.edSGO.token, site = w.S.Sabodala.id;
  for (const week of [53, 99, -1, 0]) {
    const r = await w.call('POST', '/api/reports/ensure', tok, { site_id: site, year: 2026, week });
    assert.equal(r.status, 400, `week ${week}: ${r.text}`);
  }
  assert.equal((await w.call('POST', '/api/reports/ensure', tok, { site_id: site, year: 2026, week: 52 })).status, 200);
});

test('DAT-06 time zone: a London ticket raised 00:30 BST on 1 Sept is counted in August (calendars are UTC) — documented limit', async () => {
  await ticket({ group: 'London IT Support', site: 'LONDON', created: '2026-08-31T23:30:00Z', pending: true });
  assert.equal((await rdb.getCalendarMonthlyHelpdesk(w.S['London Office'].id, 2026, 8)).inbound, 1);
  assert.equal((await rdb.getCalendarMonthlyHelpdesk(w.S['London Office'].id, 2026, 9)).inbound, 0);
});

test('DAT-07 large-volume site: 20 000 Houndé tickets; month reader and site report stay under their (generous) budgets', async () => {
  const vals = [];
  for (let i = 0; i < 20000; i++) vals.push(`('UAT-V${i}','${i % 4 ? 'Closed' : 'Open'}',${i % 4 ? 0 : 1},${i % 7 ? 0 : 1},'Hounde IT Agents','2026-${String(1 + (i % 9)).padStart(2, '0')}-${String(1 + (i % 28)).padStart(2, '0')}T08:00:00Z','2026-09-29T12:00:00Z')`);
  for (let i = 0; i < vals.length; i += 2000) await rdb.db.prepare(`INSERT INTO request_records (request_id, request_status, pending_status, overdue_status, tech_group, created_time, resolved_time) VALUES ${vals.slice(i, i + 2000).join(',')}`).run();
  let t = Date.now();
  const m = await rdb.getCalendarMonthlyHelpdesk(w.S.Hounde.id, 2026, 9);
  const monthMs = Date.now() - t;
  assert.ok(m.inbound > 2000, String(m.inbound));
  t = Date.now();
  const sd = await w.call('GET', '/api/reports/site-data?site=HGO', w.users.edHGO.token);
  const siteMs = Date.now() - t;
  assert.equal(sd.status, 200);
  assert.ok(monthMs < 3000 && siteMs < 8000, `month ${monthMs} ms · site report ${siteMs} ms`);
  console.log(`[uat-amdec] DAT-07 timings: month reader ${monthMs} ms, site report ${siteMs} ms (20 000 tickets)`);
});

test('DAT-08 site label variants fold to one site; Massawa and Sabodala stay separate; unknown labels are null', () => {
  const A = require('../services/scoreboardAliases');
  assert.equal(A.assetLabelToCode('Houndé'), 'HGO'); assert.equal(A.assetLabelToCode('HOUNDE'), 'HGO');
  assert.equal(A.assetLabelToCode('Ouaga'), A.assetLabelToCode('Ouagadougou'));
  assert.equal(A.assetLabelToCode('MASSAWA'), A.assetLabelToCode('Massawa'));
  assert.notEqual(A.assetLabelToCode('Massawa'), A.assetLabelToCode('Sabodala'));
  assert.equal(A.assetLabelToCode('Fetekro Explorarion Office'), null, 'source typo not folded: Exploration asset effort is lost (AM-12)');
  const cur = require('../services/currency');
  assert.equal(cur.fold('Houndé'), cur.fold(' HOUNDE '));
});

test('DAT-09 sub-sites: Exploration WAN lines carry their sub-site only when the token is configured; normal sites unchanged', () => {
  const m = require('../public/lib/wanLineMatch');
  assert.deepStrictEqual(m.parseServiceLine('WAN1 FETEKRO', ['FETEKRO', 'TANDA']), { family: 'wan1', sub_site: 'FETEKRO' });
  assert.deepStrictEqual(m.parseServiceLine('WAN2 Tandà', ['FETEKRO', 'TANDA']), { family: 'wan2', sub_site: 'TANDA' });
  assert.deepStrictEqual(m.parseServiceLine('WAN1 FETEKRO', []), { family: 'wan1', sub_site: '' });
  assert.equal(m.parseServiceLine('WLAN Mine', []).family, 'wifi');
});
