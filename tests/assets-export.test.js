// tests/assets-export.test.js
const test = require('node:test');
const assert = require('node:assert');
const XLSX = require('xlsx');   // already vendored (services/tableExcel.js uses it)
const { buildAssetWorkbook } = require('../services/assetExcel');

test('workbook is a Buffer with an Assets sheet and a Software sheet', () => {
  const buf = buildAssetWorkbook([{ asset_id:'A1', site:'MANA', ram_total_gb:16 }],
                                 [{ asset_id:'A1', software_name:'Chrome' }]);
  assert.ok(Buffer.isBuffer(buf));                         // buildWorkbook returns a Buffer
  const wb = XLSX.read(buf, { type: 'buffer' });           // round-trip to inspect
  assert.deepStrictEqual(wb.SheetNames.sort(), ['Assets', 'Installed Software']);
});

test('Assets sheet carries the USD money + owner columns', () => {
  const buf = buildAssetWorkbook([{
    asset_id:'A1', asset_name:'PC1', site:'MANA',
    acquisition_date:'14 May 2025',
    purchase_cost_usd:1650, book_value_usd:500, tco_usd:1700,
    user_name:'jdoe', department:'IT', ram_total_gb:16,
  }], []);
  const wb = XLSX.read(buf, { type: 'buffer' });
  const ws = wb.Sheets['Assets'];
  const grid = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const header = grid[0];
  for (const col of ['Acquisition Date', 'User', 'Department',
                     'Purchase (USD)', 'Book value (USD)', 'TCO (USD)']) {
    assert.ok(header.includes(col), `header includes "${col}" (got ${JSON.stringify(header)})`);
  }
  // Data cells carry the values (object form keyed by header for clarity).
  const rows = XLSX.utils.sheet_to_json(ws);
  const row = rows.find(r => r['asset_id'] === 'A1');
  assert.ok(row, 'the A1 row exists');
  assert.equal(row['User'], 'jdoe');
  assert.equal(row['Purchase (USD)'], 1650);
  assert.equal(row['Book value (USD)'], 500);
  assert.equal(row['TCO (USD)'], 1700);
  assert.equal(row['Acquisition Date'], '14 May 2025');
  assert.equal(row['Department'], 'IT');
});
