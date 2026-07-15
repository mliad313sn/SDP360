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

test('suggestFromMeetings never overwrites a confirmed row', () => {
  const db = freshDb();
  dir.upsertRecipient(db, 'HGO', { coordinator_name: 'Confirmed Person', coordinator_email: 'x@edv-ops.com', coordinator_email_confirmed: 1 }, 'a');
  const stubMeetings = { getSiteContacts: () => ({ coordinator_name: 'Someone Else', fm_name: 'FM Person' }) };
  dir.suggestFromMeetings(db, ['HGO'], stubMeetings, 'system');
  const row = dir.listRecipients(db).find(r => r.site_code === 'HGO');
  assert.strictEqual(row.coordinator_name, 'Confirmed Person');
  assert.strictEqual(row.fm_name, 'FM Person');
});
