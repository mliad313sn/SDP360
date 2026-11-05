'use strict';
// C-24 (G32) — exports as the user triggers them: a click on the page produces a real download, the
// file is not empty and carries the expected header row.
//   * Dashboards  → "Download figures (CSV)"            (BOM + widget/metric/site/… header)
//   * Assets      → Inventory "Export Excel" (.xlsx)    (asset_id / asset_name / … header)
//   * WAN SLA     → "Export CSV" button (.xlsx outages workbook — Site / Uplink / ISP / Attribution header)
// Assets and WAN start empty in the throwaway database, so one row each is seeded first (an empty
// table exports a single "(no rows)" cell by design, services/tableExcel.js).
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const XLSX = require('xlsx');
const { runJourney } = require('./fixtures/harness');

async function download(page, click) {
  const [d] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), click()]);
  const f = await d.path();
  assert.ok(f, 'download saved: ' + d.suggestedFilename());
  const buf = fs.readFileSync(f);
  assert.ok(buf.length > 0, d.suggestedFilename() + ' is not empty');
  return { name: d.suggestedFilename(), buf };
}
const headerOf = (buf) => {
  const wb = XLSX.read(buf, { type: 'buffer' });
  assert.ok(wb.SheetNames.length >= 1, 'workbook has a sheet');
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1 });
  return { sheets: wb.SheetNames, header: (rows[0] || []).map(String) };
};

runJourney('X1 exports CSV and XLSX downloads are non-empty with headers', async ({ app, base, world, browser, j, login }) => {
  const ctx = await j.newContext(browser, { viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  await login(page, world.users.sa, '/home.html');
  const got = [];

  // Dashboards CSV
  const list = await world.call('GET', '/api/dashboards', world.users.sa.token);
  const dash = (list.j.dashboards || []).find((d) => d.status === 'published');
  assert.ok(dash, 'a published dashboard exists');
  await page.goto(base + '/dashboards.html?key=' + encodeURIComponent(dash.key));
  await page.waitForFunction(() => /data\.csv/.test(document.getElementById('csv').getAttribute('href') || ''), null, { timeout: 20000 });
  const csv = await download(page, () => page.click('#csv'));
  const text = csv.buf.toString('utf8').replace(/^﻿/, '');
  assert.match(csv.name, /^dashboard-.*\.csv$/);
  assert.strictEqual(text.split(/\r?\n/)[0], 'widget,metric,site,window,value,unit,rag,freshness,as_of');
  got.push({ page: 'dashboards', file: csv.name, bytes: csv.buf.length, header: text.split(/\r?\n/)[0] });

  // Assets inventory XLSX (admin-only button) — one throwaway asset row so the sheet has a header row
  // (an empty inventory exports a single "(no rows)" cell by design, tableExcel)
  await require(path.join(__dirname, '..', '..', 'assets-db.js')).replaceTable('assets',
    ['asset_id', 'asset_name', 'product_type', 'state', 'site', 'purchase_cost'],
    [{ asset_id: 'E2E-A1', asset_name: 'E2E-LT-001', product_type: 'Laptop', state: 'In Use', site: 'HOUNDE', purchase_cost: '0.00' }]);
  await page.goto(base + '/assets.html#inventory');
  await page.waitForSelector('#inv-exportBtn', { state: 'visible', timeout: 20000 });
  const inv = await download(page, () => page.click('#inv-exportBtn'));
  const ih = headerOf(inv.buf);
  assert.match(inv.name, /\.xlsx$/);
  for (const h of ['asset_id', 'asset_name', 'product', 'product_type']) assert.ok(ih.header.includes(h), 'assets header has ' + h + ': ' + ih.header.join(','));
  got.push({ page: 'assets', file: inv.name, bytes: inv.buf.length, sheets: ih.sheets, header: ih.header.slice(0, 6).join(',') });

  // WAN SLA XLSX — one throwaway outage in the current month so the first sheet has rows + header
  const m0 = new Date(); const start = new Date(Date.UTC(m0.getUTCFullYear(), m0.getUTCMonth(), 1, 0, 1)).toISOString();
  await app.rdb.upsertWanOutage({ site_id: world.siteA.id, uplink: 'wan1', isp: 'E2E ISP', detected_start: start,
    restored_end: new Date(Date.parse(start) + 1800e3).toISOString(), duration_s: 1800, attribution: 'isp', source: 'e2e' });
  await page.goto(base + '/wan.html');
  await page.click('#wtab-sla');
  await page.waitForSelector('#sl-export', { state: 'visible', timeout: 20000 });
  const wan = await download(page, () => page.click('#sl-export'));
  const wh = headerOf(wan.buf);
  assert.match(wan.name, /^wan-sla-outages-.*\.xlsx$/);
  for (const h of ['Site', 'Uplink', 'ISP', 'Attribution']) assert.ok(wh.header.includes(h), 'WAN SLA first sheet header has ' + h + ': ' + JSON.stringify(wh));
  got.push({ page: 'wan', file: wan.name, bytes: wan.buf.length, sheets: wh.sheets, header: wh.header.slice(0, 6).join(',') });

  fs.writeFileSync(path.join(require('./fixtures/browser').artifactDir(), 'exports-checked.txt'), JSON.stringify(got, null, 1) + '\n');
});
