// tests/assets-software-readers.test.js — Assets C-2 Task 1 (software compliance).
// Seeds the sqlite `software` table directly, then reads the compliance
// classification + summary + exception kinds. COUNT-BASED, NO money.
//
// C1 sentinel: the count columns hold the literal string 'N/A' on the vast
// majority of real rows (installations_allowed='N/A'), so ALL classification /
// comparison is done in a shared JS pass via toInt() — never a SQL CAST (which
// throws on postgres and silently returns 0 on sqlite → mass false positives).
'use strict';
// Top-level async setup, run IN ORDER before the first test (PostgreSQL-only conversion, PO-08).
const __bootChain = (() => { let p = Promise.resolve(), hooked = false;
  return (fn) => { p = p.then(fn); if (!hooked) { hooked = true; require('node:test').beforeEach(() => p); } }; })();
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sw-'));
const adb = require('../assets-db');

const cols = ['software_id', 'software_name', 'manufacturer', 'licensed_installations',
  'installations', 'installations_allowed', 'available_for_allocation',
  'allocated_to_downgrades', 'purchased', 'allocated', 'purchased_cal',
  'compliance_type', 'software_category', 'software_type'];

const base = {
  licensed_installations: 'N/A', available_for_allocation: 'N/A',
  allocated_to_downgrades: 'N/A', purchased: 'N/A', allocated: 'N/A',
  purchased_cal: 'N/A', software_category: 'Utility',
};
const rows = [
  // S1 Managed, Under Licensed: 540 installs vs 1 allowed → installs>allowed (under)
  { ...base, software_id: 'S1', software_name: 'TeamViewer', manufacturer: 'TeamViewer',
    installations: '540', installations_allowed: '1', compliance_type: 'Under Licensed', software_type: 'Managed' },
  // S2 Managed, Over Licensed: 2 installs vs 50 allowed → installs<allowed (over)
  { ...base, software_id: 'S2', software_name: 'Adobe Photoshop', manufacturer: 'Adobe',
    installations: '2', installations_allowed: '50', compliance_type: 'Over Licensed', software_type: 'Managed' },
  // S3 Managed, Compliant: 10 == 10 → ok
  { ...base, software_id: 'S3', software_name: 'Adobe Acrobat', manufacturer: 'Adobe',
    installations: '10', installations_allowed: '10', compliance_type: 'Compliant', software_type: 'Managed' },
  // S4 C1 sentinel — unmetered: allowed='N/A' → toInt→null; in NONE of under/over/ok
  { ...base, software_id: 'S4', software_name: 'Microsoft Edge', manufacturer: 'Microsoft',
    installations: '500', installations_allowed: 'N/A', compliance_type: 'N/A', software_type: 'UnIdentified' },
];
__bootChain(async () => { (await adb.replaceTable('software', cols, rows)); });

test('classifySoftwareCompliance maps compliance_type → bucket (case-insensitive)', () => {
  const c = adb.classifySoftwareCompliance;
  assert.strictEqual(c({ compliance_type: 'Under Licensed' }), 'under_licensed');
  assert.strictEqual(c({ compliance_type: 'Over Licensed' }), 'over_licensed');
  assert.strictEqual(c({ compliance_type: 'Compliant' }), 'compliant');
  assert.strictEqual(c({ compliance_type: 'N/A' }), 'not_metered');
  assert.strictEqual(c({ compliance_type: '' }), 'not_metered');
  assert.strictEqual(c({ compliance_type: 'anything else' }), 'not_metered');
  // case-insensitive
  assert.strictEqual(c({ compliance_type: 'UNDER LICENSED' }), 'under_licensed');
});

test('getSoftwareComplianceSummary.by_compliance tallies each bucket', async () => {
  const s = (await adb.getSoftwareComplianceSummary({}));
  assert.strictEqual(s.total, 4);
  assert.strictEqual(s.managed, 3);          // S1, S2, S3
  assert.deepStrictEqual(s.by_compliance,
    { under_licensed: 1, over_licensed: 1, compliant: 1, not_metered: 1 });
});

test('getSoftwareComplianceSummary.by_manufacturer carries managed/under/over per mfr', async () => {
  const s = (await adb.getSoftwareComplianceSummary({}));
  const byMfr = Object.fromEntries(s.by_manufacturer.map(m => [m.manufacturer, m]));
  assert.strictEqual(byMfr.Adobe.managed, 2);
  assert.strictEqual(byMfr.Adobe.over, 1);
  assert.strictEqual(byMfr.TeamViewer.managed, 1);
  assert.strictEqual(byMfr.TeamViewer.under, 1);
});

test('getSoftwareComplianceSummary.installs_vs_allowed — the N/A sentinel is in NONE', async () => {
  const iva = (await adb.getSoftwareComplianceSummary({})).installs_vs_allowed;
  assert.strictEqual(iva.under, 1);   // S1: 540 > 1
  assert.strictEqual(iva.over, 1);    // S2: 2 < 50
  assert.strictEqual(iva.ok, 1);      // S3: 10 == 10
  // S4 (allowed='N/A' → null) is excluded from all three: 1+1+1 = 3, not 4.
  assert.strictEqual(iva.under + iva.over + iva.ok, 3);
});

test('getSoftwareComplianceExceptions — under_licensed is by compliance_type only', async () => {
  const under = (await adb.getSoftwareComplianceExceptions('under_licensed', {}));
  assert.deepStrictEqual(under.map(r => r.software_name), ['TeamViewer']);   // S1 only
  // S4 (installs 500 » allowed N/A) must NOT leak in via a raw comparison
  assert.ok(!under.some(r => r.software_name === 'Microsoft Edge'));
});

test('getSoftwareComplianceExceptions — over_licensed + managed kinds', async () => {
  const over = (await adb.getSoftwareComplianceExceptions('over_licensed', {}));
  assert.deepStrictEqual(over.map(r => r.software_name), ['Adobe Photoshop']);   // S2
  const managed = (await adb.getSoftwareComplianceExceptions('managed', {}));
  assert.deepStrictEqual(managed.map(r => r.software_name).sort(),
    ['Adobe Acrobat', 'Adobe Photoshop', 'TeamViewer']);   // S1, S2, S3
});

test('getSoftwareComplianceExceptions rows carry identity, NO cost key', async () => {
  const r = (await adb.getSoftwareComplianceExceptions('under_licensed', {}))[0];
  assert.strictEqual(r.software_name, 'TeamViewer');
  assert.strictEqual(r.manufacturer, 'TeamViewer');
  assert.strictEqual(r.installations, '540');
  assert.strictEqual(r.installations_allowed, '1');
  assert.strictEqual(r.compliance_type, 'Under Licensed');
  assert.ok(!('cost' in r), 'exception rows must NOT carry a cost key');
});

test('getSoftwareComplianceExceptions narrows by manufacturer filter', async () => {
  const under = (await adb.getSoftwareComplianceExceptions('under_licensed', { manufacturer: 'TeamViewer' }));
  assert.deepStrictEqual(under.map(r => r.software_name), ['TeamViewer']);
  const none = (await adb.getSoftwareComplianceExceptions('under_licensed', { manufacturer: 'Adobe' }));
  assert.deepStrictEqual(none, []);
});

test('an unknown software kind throws — never a silent empty', async () => {
  await assert.rejects(async () => (await adb.getSoftwareComplianceExceptions('bad', {})), /unknown/i);
});

test('SOFTWARE_KINDS is the single source of truth (map of the three kinds)', () => {
  assert.deepStrictEqual(Object.keys(adb.SOFTWARE_KINDS).sort(),
    ['managed', 'over_licensed', 'under_licensed']);
});
