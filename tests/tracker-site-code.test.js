'use strict';
// Tracker save scope — a site must resolve to its tracker code whatever the
// spelling of `sites.name`.
//
// Found 2026-10-02 in prod: POST /api/tracker/save answered 403 "Your account has
// no site assigned" to the Houndé coordinator (tracker-editor, site_id 3). The
// route resolved the account's site through tracker-db's SITE_MAP, an EXACT,
// case-sensitive lookup keyed 'HOUNDE' / 'Hounde IT Agents' — while the site row
// is named 'Hounde'. 8 of the 11 production sites failed the same way; only the
// three whose name happened to match a key byte-for-byte (Sabodala, MANA, Dakar)
// could save. The names below are the REAL `sites` rows read from prod.
const test = require('node:test');
const assert = require('node:assert');
const trackerDb = require('../tracker-db');

const PROD_SITES = [
  { name: 'Sabodala',    zoho_group: 'Sabodala IT Agents',  code: 'SGO' },
  { name: 'MANA',        zoho_group: 'Mana IT Agent',       code: 'MGO' },
  { name: 'Hounde',      zoho_group: 'Hounde IT Agents',    code: 'HGO' },
  { name: 'Ity',         zoho_group: 'ITY IT Agents',       code: 'ITY' },
  { name: 'Lafigue',     zoho_group: 'Lafigue IT Agents',   code: 'SML' },
  { name: 'Ouagadougou', zoho_group: 'Ouaga IT Agents',     code: 'EDV' },
  { name: 'Abidjan',     zoho_group: 'Abidjan IT Agents',   code: 'ABJ' },
  { name: 'Dakar',       zoho_group: 'Dakar IT Agents',     code: 'DKR' },
  { name: 'Exploration', zoho_group: 'Exploration BF Support,Exploration CI Support,Exploration IT Support', code: 'EXP' },
  { name: 'Kalana',      zoho_group: 'Kalana IT Agents',    code: 'KLN' },
  { name: 'ASSAFO',      zoho_group: 'Tanda IT Agents',     code: 'TND' },
];

for (const s of PROD_SITES) {
  test(`siteToCode resolves the production site "${s.name}" to ${s.code}`, () => {
    assert.strictEqual(trackerDb.siteToCode(s), s.code);
  });
}

test('siteNameToCode is case- and accent-insensitive', () => {
  assert.strictEqual(trackerDb.siteNameToCode('Hounde'), 'HGO');
  assert.strictEqual(trackerDb.siteNameToCode('Houndé'), 'HGO');
  assert.strictEqual(trackerDb.siteNameToCode('hounde it agents'), 'HGO');
  // the exact keys keep working
  assert.strictEqual(trackerDb.siteNameToCode('HOUNDE'), 'HGO');
  assert.strictEqual(trackerDb.siteNameToCode('Mana IT Agent'), 'MGO');
});

test('siteToCode falls back to the Zoho group when the name is unknown', () => {
  assert.strictEqual(trackerDb.siteToCode({ name: 'Renamed Mine', zoho_group: 'Kalana IT Agents' }), 'KLN');
});

test('an unknown site stays unresolved (the route then refuses the save)', () => {
  assert.strictEqual(trackerDb.siteToCode({ name: 'Nowhere', zoho_group: 'Nobody IT Agents' }), null);
  assert.strictEqual(trackerDb.siteToCode(null), null);
  assert.strictEqual(trackerDb.siteNameToCode(''), null);
});
