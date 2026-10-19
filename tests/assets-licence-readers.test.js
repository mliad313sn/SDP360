// tests/assets-licence-readers.test.js — Task 3 (Licence/Finance). Seeds sqlite
// software_licenses directly, then reads the licence-type families + expiry buckets
// + expiry exception kinds. Expiry is DD Mon YYYY (NOT ISO) — parsed via new Date in
// JS; a FIXED `now` is injected so the bucketing is deterministic.
'use strict';
process.env.ASSETS_BACKEND = 'sqlite';
const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'lic-'));
const adb = require('../assets-db');

// A fixed reference "today" so the expiry buckets never drift with the wall clock.
const FIXED = new Date('2026-07-18');

const cols = ['license_id', 'license_name', 'license_type', 'license_state', 'expiry_date',
  'cost', 'site', 'vendor', 'software_id', 'license_option', 'installations_allowed',
  'acquisition_date', 'organization_license'];

const base = {
  license_name: 'Some Product', license_state: 'In Use', cost: '1200.00', site: 'MANA',
  vendor: 'Acme', software_id: 'SW1', license_option: '', installations_allowed: '10',
  acquisition_date: '01 Jan 2023', organization_license: 'No',
};
const rows = [
  // license_id, type (→family), expiry (DD Mon YYYY), notes
  { ...base, license_id: 'L1', license_type: 'Named User License',    expiry_date: '31 Dec 2024', site: 'MANA' }, // User, expired
  { ...base, license_id: 'L2', license_type: 'Concurrent License',    expiry_date: '01 Aug 2026', site: 'MANA' }, // User, expiring_90 (14d out from FIXED)
  { ...base, license_id: 'L3', license_type: 'OEM',                   expiry_date: '11 Jul 2040', site: 'HGO'  }, // Machine, ok (far future)
  { ...base, license_id: 'L4', license_type: 'Enterprise Subscription', expiry_date: '',          site: 'HGO'  }, // Enterprise, no_expiry
  { ...base, license_id: 'L5', license_type: 'Volume',                expiry_date: '30 Sep 2025', site: 'SGO'  }, // Enterprise, expired
  { ...base, license_id: 'L6', license_type: 'Client Access License', expiry_date: '31 Dec 2030', site: ''     }, // Server, ok BUT no_site
  { ...base, license_id: 'L7', license_type: 'Trial',                expiry_date: '',            site: 'SGO'  }, // Special, no_expiry
];
adb.replaceTable('software_licenses', cols, rows);

test('classifyLicenceType maps raw license_type → guide family (case-insensitive)', () => {
  const c = adb.classifyLicenceType;
  assert.strictEqual(c('Named User License'), 'User');
  assert.strictEqual(c('Concurrent License'), 'User');
  assert.strictEqual(c('OEM'), 'Machine');
  assert.strictEqual(c('Node Locked'), 'Machine');
  assert.strictEqual(c('Individual'), 'Machine');
  assert.strictEqual(c('Enterprise Subscription'), 'Enterprise');
  assert.strictEqual(c('Volume'), 'Enterprise');
  assert.strictEqual(c('Client Access License'), 'Server');
  assert.strictEqual(c('CAL'), 'Server');
  assert.strictEqual(c('Trial'), 'Special');
  assert.strictEqual(c('Free License'), 'Special');
  assert.strictEqual(c('Weird Thing'), 'Other');
});

test('getLicenceSummary.by_family counts each family from the seed', () => {
  const s = adb.getLicenceSummary({ now: FIXED });
  assert.strictEqual(s.total, 7);
  assert.strictEqual(s.by_family.User, 2);        // L1, L2
  assert.strictEqual(s.by_family.Machine, 1);     // L3
  assert.strictEqual(s.by_family.Enterprise, 2);  // L4, L5
  assert.strictEqual(s.by_family.Server, 1);      // L6
  assert.strictEqual(s.by_family.Special, 1);     // L7
});

test('getLicenceSummary.expiry buckets against the FIXED now (DD Mon YYYY parsed in JS)', () => {
  const e = adb.getLicenceSummary({ now: FIXED }).expiry;
  assert.strictEqual(e.expired, 2);       // L1 (31 Dec 2024), L5 (30 Sep 2025)
  assert.strictEqual(e.expiring_90, 1);   // L2 (01 Aug 2026, within 90d)
  assert.strictEqual(e.ok, 2);            // L3 (11 Jul 2040), L6 (31 Dec 2030)
  assert.strictEqual(e.no_expiry, 2);     // L4, L7 (empty expiry)
});

test('getLicenceExceptions — each kind returns the right licence_ids', () => {
  const ids = (k) => adb.getLicenceExceptions(k, { now: FIXED }).map(r => r.license_id).sort();
  assert.deepStrictEqual(ids('expired'), ['L1', 'L5']);
  assert.deepStrictEqual(ids('expiring_soon'), ['L2']);
  assert.deepStrictEqual(ids('no_expiry'), ['L4', 'L7']);
  assert.deepStrictEqual(ids('no_site'), ['L6']);
});

test('getLicenceExceptions rows carry identity + family + cost (USD native, no rate)', () => {
  const r = adb.getLicenceExceptions('expired', { now: FIXED }).find(x => x.license_id === 'L1');
  assert.strictEqual(r.family, 'User');
  assert.strictEqual(r.license_name, 'Some Product');
  assert.strictEqual(r.license_type, 'Named User License');
  assert.strictEqual(r.site, 'MANA');
  assert.strictEqual(r.expiry_date, '31 Dec 2024');
  assert.strictEqual(r.cost, '1200.00');   // raw USD, unmodified
});

test('an unknown licence kind throws — never a silent empty', () => {
  assert.throws(() => adb.getLicenceExceptions('bad', { now: FIXED }), /unknown/i);
});

test('a family filter narrows both summary and exceptions', () => {
  const s = adb.getLicenceSummary({ now: FIXED, family: 'Enterprise' });
  assert.strictEqual(s.total, 2);
  assert.deepStrictEqual(Object.keys(s.by_family), ['Enterprise']);
  const exp = adb.getLicenceExceptions('expired', { now: FIXED, family: 'Enterprise' }).map(r => r.license_id);
  assert.deepStrictEqual(exp, ['L5']);   // L1 is User → excluded
});

test('LICENCE_KINDS is the single source of truth (map of the four kinds)', () => {
  assert.deepStrictEqual(Object.keys(adb.LICENCE_KINDS).sort(),
    ['expired', 'expiring_soon', 'no_expiry', 'no_site']);
});
