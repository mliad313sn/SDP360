// tests/assets-tile-drill-parity.test.js
// C-12 / G20 — every Assets worklist TILE shows a count, and clicking it opens a DRILL list. The two must
// agree: a tile that says "42" over a list of 40 is a lie the coordinator can see. Both sides already read
// ONE predicate source (HYGIENE_KINDS / HARDWARE_KINDS / SOFTWARE_KINDS in assets-db.js); this test pins
// that, on the REAL AP exports (tests/fixtures/assets/*.csv, the assets-integration pattern), the summary
// count behind each tile === the row count of its drill — unfiltered AND under a filter — and that the page
// wires each tile's number and its drill to the SAME kind.
'use strict';
const __bootChain = (() => { let p = Promise.resolve(), hooked = false;
  return (fn) => { p = p.then(fn); if (!hooked) { hooked = true; require('node:test').beforeEach(() => p); } }; })();
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'assets-parity-'));
const adb = require('../assets-db');
const { ASSET_VIEWS, DEFAULT_MAP } = require('../assets-sync');

const FIX = path.join(__dirname, 'fixtures', 'assets');
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = []; let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}
function readCsvObjects(file) {
  const rows = parseCsv(fs.readFileSync(path.join(FIX, file), 'utf8'));
  const headers = rows[0]; const out = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].length === 1 && rows[i][0] === '') continue;
    const o = {}; headers.forEach((h, j) => { o[h] = rows[i][j]; }); out.push(o);
  }
  return out;
}
const CSV_FOR = {
  assets: 'Assets.csv', asset_memory: 'Memory_Modules.csv', asset_logical_drives: 'Logical_Drives.csv',
  asset_monitors: 'Monitors.csv', software_licenses: 'Software_Licenses.csv', software: 'Software.csv',
};
__bootChain(async () => {
  for (const def of ASSET_VIEWS) {
    const mapped = readCsvObjects(CSV_FOR[def.name]).map(r => DEFAULT_MAP(r, def)).filter(m => m[def.pkCol]);
    await adb.replaceTable(def.table, Object.values(def.columns), mapped);
  }
});

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets.html'), 'utf8').replace(/\r\n/g, '\n');

// The software tile → summary field it displays. The 'compliant' tile has NO drill (data-kind="") — it is
// the one declared exception and is asserted as such below, so a drill added later must join this map.
const SOFTWARE_TILE_FIELD = {
  under_licensed: (s) => s.by_compliance.under_licensed,
  over_licensed: (s) => s.by_compliance.over_licensed,
  managed: (s) => s.managed,
};

async function hygieneParity(filters, tag) {
  const s = await adb.getHygieneSummary(filters);
  const kinds = Object.keys(adb.HYGIENE_KINDS);
  assert.deepStrictEqual(Object.keys(s.by_kind).sort(), kinds.slice().sort(), `${tag}: by_kind covers every hygiene kind`);
  for (const k of kinds) {
    const rows = await adb.getHygieneExceptions(k, filters);
    assert.strictEqual(rows.length, s.by_kind[k], `${tag}: hygiene tile ${k} (${s.by_kind[k]}) === drill rows (${rows.length})`);
  }
  return s;
}
async function hardwareParity(filters, tag) {
  const s = await adb.getHardwareHealthSummary(filters);
  for (const k of Object.keys(adb.HARDWARE_KINDS)) {
    const rows = await adb.getHardwareHealthExceptions(k, filters);
    assert.strictEqual(rows.length, s.by_kind[k], `${tag}: hardware tile ${k} (${s.by_kind[k]}) === drill rows (${rows.length})`);
  }
  return s;
}
async function softwareParity(filters, tag) {
  const s = await adb.getSoftwareComplianceSummary(filters);
  assert.deepStrictEqual(Object.keys(SOFTWARE_TILE_FIELD).sort(), Object.keys(adb.SOFTWARE_KINDS).sort(),
    'every software drill kind has a tile (and vice versa)');
  for (const k of Object.keys(adb.SOFTWARE_KINDS)) {
    const rows = await adb.getSoftwareComplianceExceptions(k, filters);
    assert.strictEqual(rows.length, SOFTWARE_TILE_FIELD[k](s), `${tag}: software tile ${k} === drill rows (${rows.length})`);
  }
  return s;
}

test('hygiene: every tile count === its drill row count (whole fleet, real CSV)', async () => {
  const s = await hygieneParity({}, 'fleet');
  assert.strictEqual(s.total, 2473, 'fixture loaded');
  assert.ok(s.by_kind.no_cost > 0 && s.by_kind.never_scanned > 0, 'the parity is not vacuous');
});

test('hygiene: parity holds under a site filter and a state filter', async () => {
  const fleet = await adb.getHygieneSummary({});
  const big = fleet.by_site.filter(x => x.site).sort((a, b) => b.total - a.total)[0];
  assert.ok(big, 'a named site exists');
  await hygieneParity({ site: big.site }, 'site=' + big.site);
  await hygieneParity({ state: 'In Use' }, 'state=In Use');
});

test('hardware: every tile count === its drill row count (fleet + site filter)', async () => {
  const s = await hardwareParity({}, 'fleet');
  assert.ok(Object.values(s.by_kind).some(n => n > 0), 'the parity is not vacuous');
  const big = s.by_site.filter(x => x.site).sort((a, b) => b.total - a.total)[0];
  await hardwareParity({ site: big.site }, 'site=' + big.site);
});

test('software: every drillable tile count === its drill row count (fleet + manufacturer filter)', async () => {
  const s = await softwareParity({}, 'fleet');
  assert.strictEqual(s.by_compliance.under_licensed, 32, 'fixture loaded (32 Under Licensed)');
  const m = s.by_manufacturer.filter(x => x.manufacturer && x.under > 0)[0];
  assert.ok(m, 'a manufacturer with under-licensed titles exists');
  await softwareParity({ manufacturer: m.manufacturer }, 'manufacturer=' + m.manufacturer);
});

test('page wiring: each hygiene tile/gap shows hyg-cnt-<kind> and drills the SAME kind', () => {
  const kinds = Object.keys(adb.HYGIENE_KINDS);
  const pane = html.slice(html.indexOf('<section id="pane-hygiene"'), html.indexOf('<!-- Charts -->', html.indexOf('<section id="pane-hygiene"')));
  const tiles = [...pane.matchAll(/data-kind="([a-z_]+)"[^>]*>[\s\S]*?id="hyg-cnt-([a-z_]+)"/g)];
  assert.strictEqual(tiles.length, kinds.length, 'one tile/gap per hygiene kind');
  for (const [, drillKind, cntKind] of tiles) {
    assert.strictEqual(drillKind, cntKind, `tile drill ${drillKind} shows the count of the same kind`);
    assert.ok(kinds.includes(drillKind), `${drillKind} is a HYGIENE_KINDS key`);
  }
  // the number in hyg-cnt-<k> comes from by_kind[k]
  assert.match(html, /document\.getElementById\('hyg-cnt-' \+ k\)[\s\S]{0,120}bk\[k\]/);
});

test('page wiring: each hardware tile shows hw-cnt-<kind> and drills the SAME kind', () => {
  const kinds = Object.keys(adb.HARDWARE_KINDS);
  const block = html.slice(html.indexOf('<div class="tiles" id="hw-tiles">'), html.indexOf('<!-- Denylist note -->'));
  const tiles = [...block.matchAll(/data-kind="([a-z_]+)"[^>]*>\s*<div class="tn" id="hw-cnt-([a-z_]+)"/g)];
  assert.strictEqual(tiles.length, kinds.length);
  for (const [, a, b] of tiles) { assert.strictEqual(a, b); assert.ok(kinds.includes(a)); }
  assert.match(html, /document\.getElementById\('hw-cnt-' \+ k\)[\s\S]{0,120}bk\[k\]/);
});

test('page wiring: software tiles — the number shown is the field the parity test checks; compliant has no drill', () => {
  const block = html.slice(html.indexOf('<div class="tiles" id="fin-softTiles">'), html.indexOf('</div>\n\n', html.indexOf('id="fin-softTiles"')));
  const tiles = Object.fromEntries([...block.matchAll(/data-kind="([a-z_]*)"[^>]*>\s*<div class="tn" id="(fin-cnt-[a-z]+)"/g)].map(m => [m[2], m[1]]));
  assert.deepStrictEqual(tiles, { 'fin-cnt-under': 'under_licensed', 'fin-cnt-over': 'over_licensed', 'fin-cnt-compliant': '', 'fin-cnt-managed': 'managed' });
  assert.match(html, /'fin-cnt-under'\)\.textContent\s*= \(Number\(bc\.under_licensed\)/);
  assert.match(html, /'fin-cnt-over'\)\.textContent\s*= \(Number\(bc\.over_licensed\)/);
  assert.match(html, /'fin-cnt-managed'\)\.textContent\s*= managed\.toLocaleString\(\)/);
  assert.match(html, /const managed = Number\(s\.managed\)/);
});
