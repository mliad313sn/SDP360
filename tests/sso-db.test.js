'use strict';

// SSO DB layer (reports-db): email/entra_oid columns, findUserByEntra,
// linkUserEntra, createSessionForUser. Runs against a throwaway sqlite DB.

const { test, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'sdp-sso-'));
process.env.DASH_USER = process.env.DASH_USER || 'smoke-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'smoke-pass-0000';

const rdb = require('../reports-db');

let uid;
before(() => {
  const r = rdb.createUser({
    username: 'azize', full_name: 'Azize SAMANDOULGOU', password: 'temp-pass-123',
    role: 'admin', email: 'Azize.Samandoulgou@EDV-ops.com',
  });
  uid = r.lastInsertRowid;
});

test('createUser stores email lowercased; safeUser exposes it', () => {
  const list = rdb.listUsers();
  const u = list.find(x => x.username === 'azize');
  assert.ok(u, 'user created');
  assert.equal(u.email, 'azize.samandoulgou@edv-ops.com');
  assert.equal(u.has_entra, false);
});

test('findUserByEntra matches by email (case-insensitive), pre-oid', () => {
  const u = rdb.findUserByEntra({ email: 'AZIZE.SAMANDOULGOU@edv-ops.com' });
  assert.ok(u && u.id === uid, 'found by email regardless of case');
  assert.equal(rdb.findUserByEntra({ email: 'nobody@edv-ops.com' }), null, 'unknown email → null');
});

test('linkUserEntra stamps the oid; then match is by oid; email not clobbered', () => {
  rdb.linkUserEntra(uid, 'oid-stable-123', 'different@edv-ops.com');
  const byOid = rdb.findUserByEntra({ oid: 'oid-stable-123' });
  assert.ok(byOid && byOid.id === uid, 'found by oid');
  assert.equal(byOid.email, 'azize.samandoulgou@edv-ops.com', 'original email preserved (COALESCE)');
});

test('createSessionForUser mints a working 24h session (no password)', () => {
  const res = rdb.createSessionForUser(uid);
  assert.ok(res && res.token, 'returns a token');
  const who = rdb.validateSession(res.token);
  assert.ok(who && who.id === uid, 'token validates to the same user');
  assert.equal(who.has_entra, true, 'safeUser reflects the linked Entra identity');
  assert.equal(rdb.createSessionForUser(999999), null, 'unknown user → null');
});

test('updateUser can change the email additively', () => {
  rdb.updateUser(uid, { full_name: 'Azize SAMANDOULGOU', email: 'New.Addr@edv-ops.com' });
  const u = rdb.listUsers().find(x => x.id === uid);
  assert.equal(u.email, 'new.addr@edv-ops.com');
});

test('updateUserProfileFromEntra sets profile; COALESCE keeps existing on null', () => {
  rdb.updateUserProfileFromEntra(uid, { first_name: 'Azize', last_name: 'Samandoulgou', title: 'IT Manager', office: 'Ouagadougou' });
  let u = rdb.listUsers().find(x => x.id === uid);
  assert.equal(u.first_name, 'Azize');
  assert.equal(u.title, 'IT Manager');
  assert.equal(u.office, 'Ouagadougou');
  // A later login where Graph omitted the title must NOT wipe it.
  rdb.updateUserProfileFromEntra(uid, { first_name: 'Azize', last_name: 'Samandoulgou', title: '', office: null });
  u = rdb.listUsers().find(x => x.id === uid);
  assert.equal(u.title, 'IT Manager', 'blank/null title preserved via COALESCE');
});

test('setUserEmail (bulk mapping) lowercases and can clear', () => {
  rdb.setUserEmail(uid, '  BULK.Addr@EDV-ops.com ');
  assert.equal(rdb.listUsers().find(x => x.id === uid).email, 'bulk.addr@edv-ops.com');
  rdb.setUserEmail(uid, '');
  assert.equal(rdb.listUsers().find(x => x.id === uid).email, null);
  rdb.setUserEmail(uid, 'bulk.addr@edv-ops.com'); // restore for later tests
});

test('inactive user is not resolved by findUserByEntra', () => {
  rdb.updateUser(uid, { full_name: 'Azize SAMANDOULGOU', active: 0 });
  assert.equal(rdb.findUserByEntra({ oid: 'oid-stable-123' }), null, 'inactive → not found');
  rdb.updateUser(uid, { full_name: 'Azize SAMANDOULGOU', active: 1 }); // restore
});
