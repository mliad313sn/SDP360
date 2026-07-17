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
