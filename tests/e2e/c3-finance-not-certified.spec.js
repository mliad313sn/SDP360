'use strict';
// C3 (E-Q09, agent committee — automated, synthetic org, NOT user acceptance) — a Finance reader
// (finance-viewer) opens Assets ▸ Finance on a fleet where one site (Assafo) has no currency mapped: the figure
// is shown "Non certifié" with the excluded line counted, and Assafo's amount reads "—" (UNKNOWN), never $0.
// The currency map, rates and asset_money_certify_display are set ONLY in this journey's throwaway database.
const assert = require('node:assert');
const { runJourney } = require('./fixtures/harness');
const { person, api } = require('./fixtures/iam');

runJourney('C3 Finance reads a non-certified asset amount and a site with no currency (UNKNOWN, never 0)', async ({ app, base, world, browser, j, login }) => {
  await world.setConfig({ asset_site_currency: JSON.stringify({ 'London Office': 'GBP', Sabodala: 'XOF' }), asset_currency_rates: JSON.stringify({ GBP: 1.27 }), asset_money_certify_display: '1' });
  const H = require('../../assets-db').pgHandle();
  for (const [id, site, cost] of [['C3-A1', 'London Office', '1,000.00'], ['C3-A2', 'Sabodala', '1,000,000.00'], ['C3-A3', 'Assafo', '500,000.00']])
    await H.prepare('INSERT INTO assets (asset_id, asset_name, product_type, state, site, purchase_cost) VALUES (?,?,?,?,?,?)').run(id, id, 'Laptop', 'In Use', site, cost);
  const fin = await person(app, 'c3fin', ['finance-viewer'], null);
  const page = await (await j.newContext(browser, { viewport: { width: 1440, height: 900 } })).newPage();
  await login(page, fin, '/assets.html#finance');
  await page.goto(base + '/assets.html#finance');
  await page.waitForSelector('#fin-certBand .money-cert-band', { timeout: 20000 });
  const band = await page.textContent('#fin-certBand');
  assert.match(band, /Non certifié/, 'the verdict is in words');
  assert.match(band, /1 ligne\(s\) exclue\(s\)/, 'the excluded line is counted');
  await page.waitForSelector('#fin-finBody tr', { timeout: 15000 });
  const rows = await page.$$eval('#fin-finBody tr', (trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())));
  const assafo = rows.find((r) => /Assafo/.test(r[0]));
  assert.ok(assafo, 'Assafo is listed');
  assert.equal(assafo[2], '—', 'purchase amount of a site with no currency is UNKNOWN');
  assert.ok(!rows.some((r) => /Assafo/.test(r[0]) && /\$0\.00/.test(r[2])), 'never $0.00');
  await j.measure(page, 'assets-finance');
  const s = await api(page, 'GET', '/api/assets/finance/summary');
  assert.equal(s.status, 200);
  assert.deepStrictEqual([s.body.certification.certified, s.body.certification.reason], [false, 'excluded_rows']);
  assert.equal(s.body.by_site.find((x) => x.site === 'Assafo').purchase_cost_usd, null);
  // a viewer (no money role) is refused the amounts altogether
  const v = await person(app, 'c3viewer', ['viewer'], null);
  assert.equal((await world.call('GET', '/api/assets/finance/summary', v.token)).status, 403);
});
