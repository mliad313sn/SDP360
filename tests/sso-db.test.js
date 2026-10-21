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

// ── E2 (remediation 2026-10-20): oid-first matching, restricted e-mail fallback, no re-link ──
// Precondition from the tests above: `azize` (uid) is linked to 'oid-stable-123' and carries
// e-mail 'bulk.addr@edv-ops.com'.

test('E2: a known oid matches even after the e-mail changed (oid is the primary key)', () => {
  rdb.setUserEmail(uid, 'renamed.addr@edv-ops.com');
  const u = rdb.findUserByEntra({ oid: 'oid-stable-123', email: 'something-else@edv-ops.com', email_source: 'email' });
  assert.ok(u && u.id === uid, 'matched by oid, e-mail ignored');
  rdb.setUserEmail(uid, 'bulk.addr@edv-ops.com'); // restore
});

test('E2: unknown oid + e-mail of an ALREADY-LINKED account → refused (no takeover by e-mail)', () => {
  const u = rdb.findUserByEntra({ oid: 'oid-attacker-999', email: 'bulk.addr@edv-ops.com', email_source: 'email' });
  assert.equal(u, null, 'a linked row is never re-matched through its mutable e-mail');
  // The link itself must be untouched.
  assert.ok(rdb.findUserByEntra({ oid: 'oid-stable-123' }), 'original oid still resolves');
  assert.equal(rdb.findUserByEntra({ oid: 'oid-attacker-999' }), null, 'attacker oid never got stamped');
});

test('E2: preferred_username alone never matches; email / upn claims do (unlinked row only)', () => {
  const r = rdb.createUser({ username: 'pref', full_name: 'Pref User', password: 'temp-pass-123', role: 'editor', email: 'pref.user@edv-ops.com' });
  const pid = r.lastInsertRowid;
  assert.equal(rdb.findUserByEntra({ oid: 'oid-pref', email: 'pref.user@edv-ops.com', email_source: 'preferred_username' }), null,
    'preferred_username is a display alias — no match');
  let u = rdb.findUserByEntra({ oid: 'oid-pref', email: 'PREF.User@edv-ops.com', email_source: 'upn' });
  assert.ok(u && u.id === pid, 'upn claim may drive the pre-provisioning match');
  u = rdb.findUserByEntra({ oid: 'oid-pref', email: 'pref.user@edv-ops.com', email_source: 'email' });
  assert.ok(u && u.id === pid, 'verified email claim may drive the pre-provisioning match');
  assert.equal(rdb.findUserByEntra({ email: 'pref.user@edv-ops.com', email_source: 'bogus' }), null, 'unknown claim source → no match');
});

test('E2: the break-glass account is never linked through its e-mail', () => {
  rdb.createUser({ username: 'bg', full_name: 'Break Glass', password: 'temp-pass-123', role: 'admin', email: 'bg@edv-ops.com' });
  assert.equal(rdb.findUserByEntra({ oid: 'oid-bg', email: 'bg@edv-ops.com', email_source: 'email', breakglassUser: 'bg' }), null,
    'break-glass excluded from the e-mail fallback');
  assert.ok(rdb.findUserByEntra({ oid: 'oid-bg', email: 'bg@edv-ops.com', email_source: 'email', breakglassUser: 'someone-else' }),
    'the exclusion is keyed on the configured break-glass username');
});

test('E2: a super_admin is never linked through its e-mail', () => {
  const r = rdb.createUser({ username: 'root2', full_name: 'Root Two', password: 'temp-pass-123', roles: ['super_admin'], email: 'root2@edv-ops.com' });
  assert.ok(rdb.userHasRole(r.lastInsertRowid, 'super_admin'), 'fixture is a super_admin');
  assert.equal(rdb.findUserByEntra({ oid: 'oid-root', email: 'root2@edv-ops.com', email_source: 'email' }), null,
    'super_admin excluded from the e-mail fallback (oid-only)');
});

test('E2: linkUserEntra never overwrites a DIFFERENT oid — throws sso_link_conflict + risk log', async () => {
  assert.throws(() => rdb.linkUserEntra(uid, 'oid-other-456', 'bulk.addr@edv-ops.com'), e => e.code === 'sso_link_conflict');
  const u = rdb.findUserByEntra({ oid: 'oid-stable-123' });
  assert.ok(u && u.id === uid, 'the stored oid is unchanged');
  assert.equal(rdb.findUserByEntra({ oid: 'oid-other-456' }), null, 'the conflicting oid was not stamped');
  // Same oid again is a no-op, not a conflict.
  assert.equal(rdb.linkUserEntra(uid, 'oid-stable-123', 'x@edv-ops.com'), true);
  const { rows } = await rdb.listSystemLog({ action: 'sso_link_conflict' }, { limit: 5, offset: 0 });
  assert.ok(rows.length >= 1, 'conflict journaled');
  assert.equal(rows[0].risk, 1, 'journaled as a risk event');
  assert.equal(rows[0].target, 'azize');
  assert.ok(rdb._isRiskAction('sso_link_conflict') && rdb._isRiskAction('sso_groups_overage'), 'both SSO events are risk actions');
});
