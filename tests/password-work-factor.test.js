'use strict';
// E-S05 (audit S-08, X-SEC-02) — the PBKDF2 work factor is stored per hash (users.password_iterations,
// NULL = 100000: every hash made before this column). A successful password login rehashes ONCE when the stored
// count is below report_config auth_pbkdf2_iterations (default '100000' = today → nothing is ever rehashed).
const { test, after } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');
const cfg = require('../services/reportConfig');

const row = (u) => rdb.db.prepare('SELECT password_hash, salt, password_iterations FROM users WHERE username=?').get(u);
const setTarget = (v) => cfg.setConfig(rdb.db, { auth_pbkdf2_iterations: v }, 'test');
after(() => setTarget('100000'));

async function legacyUser(username, password) {
  await rdb.createUser({ username, full_name: username, password, role: 'viewer' });
  // simulate a hash made before the column existed: NULL count, 100 000 iterations
  const salt = 'legacy-salt-' + username;
  await rdb.db.prepare('UPDATE users SET password_hash=?, salt=?, password_iterations=NULL WHERE username=?')
    .run(rdb.hashPassword(password, salt), salt, username);
}

test("the default target is '100000' (today): a legacy row (NULL) logs in and its hash is left untouched", async () => {
  assert.equal(String((await cfg.getConfig(rdb.db)).auth_pbkdf2_iterations), '100000');
  await legacyUser('wf-legacy', 'legacy-pass-0000');
  const before = await row('wf-legacy');
  assert.ok(await rdb.login('wf-legacy', 'legacy-pass-0000'));
  const afterRow = await row('wf-legacy');
  assert.deepStrictEqual(afterRow, before);
});

test('target 210000: a login rehashes once; the next login uses 210000; a wrong password never rehashes', async () => {
  await legacyUser('wf-up', 'upgrade-pass-0000');
  await setTarget('210000');
  try {
    const before = await row('wf-up');
    assert.equal(await rdb.login('wf-up', 'not-the-password'), null);
    assert.deepStrictEqual(await row('wf-up'), before, 'a failed login changes nothing');
    assert.ok(await rdb.login('wf-up', 'upgrade-pass-0000'));
    const up = await row('wf-up');
    assert.equal(up.password_iterations, 210000);
    assert.notEqual(up.password_hash, before.password_hash);
    assert.equal(rdb.hashPassword('upgrade-pass-0000', up.salt, 210000), up.password_hash);
    assert.ok(await rdb.login('wf-up', 'upgrade-pass-0000'), 'next login verifies at 210000');
    assert.deepStrictEqual(await row('wf-up'), up, 'already at the target → no second rehash');
    assert.equal(await rdb.login('wf-up', 'not-the-password'), null);
  } finally { await setTarget('100000'); }
  assert.ok(await rdb.login('wf-up', 'upgrade-pass-0000'), 'lowering the target never locks anyone out');
  assert.equal((await row('wf-up')).password_iterations, 210000, 'and never downgrades a hash');
});

test('set / change / reset paths store the target count', async () => {
  await rdb.createUser({ username: 'wf-new', full_name: 'wf-new', password: 'new-pass-00000', role: 'viewer' });
  assert.equal((await row('wf-new')).password_iterations, 100000);
  await setTarget('150000');
  try {
    const id = (await rdb.db.prepare("SELECT id FROM users WHERE username='wf-new'").get()).id;
    assert.deepStrictEqual(await rdb.changePassword(id, 'new-pass-00000', 'changed-pass-000'), { ok: true });
    assert.equal((await row('wf-new')).password_iterations, 150000);
    assert.ok(await rdb.login('wf-new', 'changed-pass-000'));
    await setTarget('160000');
    await rdb.updateUser(id, { full_name: 'wf-new', password: 'reset-pass-0000', active: 1 });
    assert.equal((await row('wf-new')).password_iterations, 160000);
    assert.ok(await rdb.login('wf-new', 'reset-pass-0000'));
  } finally { await setTarget('100000'); }
});

test('an invalid or too-low target falls back to 100000 (never weakens new hashes)', () => {
  assert.equal(rdb._pbkdf2Target('abc'), 100000);
  assert.equal(rdb._pbkdf2Target('5000'), 100000);
  assert.equal(rdb._pbkdf2Target(undefined), 100000);
  assert.equal(rdb._pbkdf2Target('210000'), 210000);
  assert.equal(rdb._pbkdf2Target('99999999'), 100000, 'absurd values are refused');
});

test('an unknown user still costs one PBKDF2 run at the target count', () => {
  const user = { salt: 's1', password_hash: rdb.hashPassword('x-pass-000', 's1', 210000), password_iterations: 210000 };
  const t = (fn) => { const s = process.hrtime.bigint(); for (let i = 0; i < 3; i++) fn(); return Number(process.hrtime.bigint() - s); };
  const known = t(() => rdb.passwordMatches('wrong', user));
  const unknown = t(() => rdb.passwordMatches('wrong', null, 210000));
  assert.ok(unknown > known * 0.5, `unknown ${unknown} vs known ${known}`);
  assert.equal(rdb.passwordMatches('x-pass-000', user), true);
});
