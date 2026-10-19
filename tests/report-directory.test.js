'use strict';
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const dir = require('../services/reportDirectory');

function freshDb() { const db = new Database(':memory:'); dir._initSchema(db); return db; }

test('upsert + list a recipient row', () => {
  const db = freshDb();
  dir.upsertRecipient(db, 'HGO', { site_name: 'Hounde', coordinator_name: 'Jean Traore' }, 'azize');
  const rows = dir.listRecipients(db);
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(rows[0].site_code, 'HGO');
  assert.strictEqual(rows[0].coordinator_name, 'Jean Traore');
});

test('resolveRecipient returns null when email unconfirmed and safety on', () => {
  const db = freshDb();
  dir.upsertRecipient(db, 'HGO', { coordinator_name: 'Jean', coordinator_email: 'jean.traore@edv-ops.com', coordinator_email_confirmed: 0 }, 'a');
  const r = dir.resolveRecipient(db, 'HGO', 'coordinator', { neverSendUnconfirmed: true });
  assert.strictEqual(r, null);
});

test('resolveRecipient returns to/cc when confirmed', () => {
  const db = freshDb();
  dir.upsertRecipient(db, 'HGO', { coordinator_email: 'jean@edv-ops.com', coordinator_email_confirmed: 1, cc_emails: 'boss@edv-ops.com' }, 'a');
  const r = dir.resolveRecipient(db, 'HGO', 'coordinator', { neverSendUnconfirmed: true });
  assert.deepStrictEqual(r, { to: 'jean@edv-ops.com', cc: ['boss@edv-ops.com'] });
});

test('resolveFromRows works on a pre-fetched array', () => {
  const rows = [{ site_code: 'HGO', coordinator_email: 'j@x', coordinator_email_confirmed: 1, cc_emails: '' }];
  assert.deepStrictEqual(dir.resolveFromRows(rows, 'HGO', 'coordinator', { neverSendUnconfirmed: true }), { to: 'j@x', cc: [] });
  assert.strictEqual(dir.resolveFromRows(rows, 'HGO', 'fm', { neverSendUnconfirmed: true }), null);
});

// resolveFromRows must fold case like reports-db.getSiteIdByModuleCode does.
// Case-sensitive, `?site=hgo` composed a full report and then resolved NO
// recipient — reported as "no confirmed recipient" while the address was on file
// and confirmed. Fails safe, but the reason lies and the operator chases a
// directory bug that isn't there.
test('resolveFromRows matches site_code case-insensitively', () => {
  const rows = [{ site_code: 'HGO', coordinator_email: 'j@x', coordinator_email_confirmed: 1, cc_emails: '' }];
  const want = { to: 'j@x', cc: [] };
  assert.deepStrictEqual(dir.resolveFromRows(rows, 'hgo', 'coordinator', { neverSendUnconfirmed: true }), want, 'lowercase query resolves');
  assert.deepStrictEqual(dir.resolveFromRows(rows, 'Hgo', 'coordinator', { neverSendUnconfirmed: true }), want, 'mixed case resolves');
  // ...and the stored value may be the odd one out.
  const lowerRows = [{ site_code: 'hgo', coordinator_email: 'j@x', coordinator_email_confirmed: 1, cc_emails: '' }];
  assert.deepStrictEqual(dir.resolveFromRows(lowerRows, 'HGO', 'coordinator', { neverSendUnconfirmed: true }), want, 'lowercase ROW resolves');
});

test('resolveFromRows never resolves a blank site code', () => {
  // Folding to lowercase makes '' == '', so a blank/null row could be matched by
  // a blank query — resolving a recipient for a site nobody named.
  const rows = [{ site_code: '', coordinator_email: 'j@x', coordinator_email_confirmed: 1, cc_emails: '' }];
  for (const q of ['', null, undefined]) {
    assert.strictEqual(dir.resolveFromRows(rows, q, 'coordinator', { neverSendUnconfirmed: true }), null, `blank query ${JSON.stringify(q)} → null`);
  }
});

test('resolveFromRows still returns null for a genuinely unknown site', () => {
  const rows = [{ site_code: 'HGO', coordinator_email: 'j@x', coordinator_email_confirmed: 1, cc_emails: '' }];
  assert.strictEqual(dir.resolveFromRows(rows, 'MGO', 'coordinator', { neverSendUnconfirmed: true }), null);
});

test('suggestFromMeetings never overwrites a confirmed row', async () => {
  const db = freshDb();
  dir.upsertRecipient(db, 'HGO', { coordinator_name: 'Confirmed Person', coordinator_email: 'x@edv-ops.com', coordinator_email_confirmed: 1 }, 'a');
  const stubMeetings = { getSiteContacts: () => ({ coordinator_name: 'Someone Else', fm_name: 'FM Person' }) };
  await dir.suggestFromMeetings(db, ['HGO'], stubMeetings, 'system');
  const row = dir.listRecipients(db).find(r => r.site_code === 'HGO');
  assert.strictEqual(row.coordinator_name, 'Confirmed Person');
  assert.strictEqual(row.fm_name, 'FM Person');
});

// The pg regression guard: under MEETINGS_BACKEND=postgres getSiteContacts
// returns a PROMISE. The old sync implementation read `.coordinator_name` off
// that promise → undefined → no patch → {ok:true, filled:0} with NO error.
// This test is the one that would have caught it.
test('suggestFromMeetings fills from an ASYNC reader (pg-shaped)', async () => {
  const db = freshDb();
  const asyncMeetings = { getSiteContacts: async () => ({ coordinator_name: 'X', fm_name: 'Y' }) };
  const out = await dir.suggestFromMeetings(db, ['HGO'], asyncMeetings, 'system');
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.filled, 1, 'an async reader must still fill (filled:0 IS the pg bug)');
  const row = dir.listRecipients(db).find(r => r.site_code === 'HGO');
  assert.strictEqual(row.coordinator_name, 'X');
  assert.strictEqual(row.fm_name, 'Y');
});

test('suggestFromMeetings throws loudly when the reader has no getSiteContacts', async () => {
  const db = freshDb();
  await assert.rejects(() => dir.suggestFromMeetings(db, ['HGO'], {}, 'system'));
});

test('asset manager columns persist through upsertRecipient', () => {
  const db = freshDb();
  dir.upsertRecipient(db, 'HGO', { asset_manager_name: 'Awa', asset_manager_email: 'awa@edv-ops.com', asset_manager_email_confirmed: 1 }, 'a');
  const r = dir.listRecipients(db)[0];
  assert.deepStrictEqual([r.asset_manager_name, r.asset_manager_email, r.asset_manager_email_confirmed], ['Awa', 'awa@edv-ops.com', 1]);
});

test('asset_manager resolves only when confirmed', () => {
  const rows = [{ site_code: 'HGO', asset_manager_email: 'am@x', asset_manager_email_confirmed: 1, coordinator_email: 'c@x', coordinator_email_confirmed: 1, cc_emails: '' }];
  assert.deepStrictEqual(dir.resolveFromRows(rows, 'HGO', 'asset_manager'), { to: 'am@x', cc: [] });
  rows[0].asset_manager_email_confirmed = 0;
  assert.strictEqual(dir.resolveFromRows(rows, 'HGO', 'asset_manager'), null, 'unconfirmed never used');
  assert.deepStrictEqual(dir.resolveFromRows(rows, 'HGO', 'coordinator'), { to: 'c@x', cc: [] }, 'coordinator fallback still resolves');
});

test('an existing pre-asset-manager table is migrated by _initSchema', () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE report_recipients (site_code TEXT PRIMARY KEY, site_name TEXT, coordinator_name TEXT, coordinator_email TEXT,
    coordinator_email_confirmed INTEGER DEFAULT 0, fm_name TEXT, fm_email TEXT, fm_email_confirmed INTEGER DEFAULT 0,
    cc_emails TEXT, active INTEGER DEFAULT 1, updated_at TIMESTAMP, updated_by TEXT)`);
  dir._initSchema(db);
  dir.upsertRecipient(db, 'MGO', { asset_manager_email: 'x@y' }, 'a');
  assert.strictEqual(dir.listRecipients(db)[0].asset_manager_email, 'x@y');
});
