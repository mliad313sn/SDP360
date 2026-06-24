'use strict';
// Sub-chunk A — reports.db auth/sessions → PostgreSQL. TDD. Skips when PG down.
process.env.REPORTS_BACKEND = 'postgres';
const fs = require('fs'); const path = require('path'); const os = require('os');
// Isolate the module-load sqlite handle: reports-db.js opens data/reports.db at
// require time even in pg mode — point it at a throwaway dir so a running prod
// instance's WAL lock can't break (or pollute) the suite.
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'rpt-auth-'));
// reports-db.js seeds a default admin into its sqlite DB at module-load and FATALs
// if these aren't set on first boot — supply throwaway creds for the temp sqlite
// (irrelevant to the pg path under test).
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const { makePgDb } = require('../services/pgDb');
const SCHEMA = fs.readFileSync(path.join(__dirname, '../db/postgres/reports/001_auth.sql'), 'utf8');

test('schema: idempotent + real FKs (sessions + user_roles CASCADE, users.site_id)', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  const db = makePgDb(ctx.url); await db.connect();
  try {
    await db.exec(SCHEMA); await db.exec(SCHEMA);               // idempotent
    const n = await db.prepare(`SELECT count(*)::int n FROM information_schema.tables
                                WHERE table_name IN ('sites','users','sessions','user_roles')`).get();
    assert.equal(n.n, 4);
    // sessions.user_id FK is ON DELETE CASCADE
    const cas = await db.prepare(`
      SELECT rc.delete_rule FROM information_schema.referential_constraints rc
      JOIN information_schema.key_column_usage k ON k.constraint_name = rc.constraint_name
      WHERE k.table_name='sessions' AND k.column_name='user_id'`).get();
    assert.equal(cas.delete_rule, 'CASCADE');
    // users.site_id FK exists
    const fk = await db.prepare(`SELECT count(*)::int n FROM information_schema.key_column_usage
      WHERE table_name='users' AND column_name='site_id' AND constraint_name LIKE '%fkey%'`).get();
    assert.ok(fk.n >= 1, 'users.site_id FK present');
  } finally { await db.close(); await dropTestDb(ctx); }
});

// Reused by later tests — boots a reports-db pg handle against a fresh test DB.
async function boot() {
  const ctx = await provisionTestDb(); if (!ctx) return null;
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  await rdb.initPgReports();
  return { ctx, rdb };
}

test('reports-db: REPORTS_BACKEND selector + initPgReports applies schema', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b;
  try {
    assert.equal(rdb.REPORTS_BACKEND, 'postgres');
    const h = rdb.pgHandle();
    assert.deepEqual(await h.prepare('SELECT 1 AS x').get(), { x: 1 });
    assert.equal((await h.prepare(`SELECT count(*)::int n FROM information_schema.tables
                                   WHERE table_name='users'`).get()).n, 1);
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── Task 4: login / validateSession / getUserRoles / logout ─────────────────
// Seed a site + user (with a real PBKDF2 hash) + roles directly via pgHandle.
async function seedUser(rdb, h, { username = 'u1', password = 'pw', role = 'admin', roles = ['admin'], active = 1 } = {}) {
  const site = await h.prepare(`INSERT INTO sites (name, zoho_group, active) VALUES (?,?,1)`).run('Site-' + username, username + ' IT Agents');
  const salt = 'salt-' + username;
  const hash = rdb.hashPassword(password, salt);
  const u = await h.prepare(`INSERT INTO users (username, full_name, password_hash, salt, site_id, role, active)
                             VALUES (?,?,?,?,?,?,?)`).run(username, 'User ' + username, hash, salt, site.lastID, role, active);
  for (const r of roles) await h.prepare(`INSERT INTO user_roles (user_id, role) VALUES (?,?) ON CONFLICT DO NOTHING`).run(u.lastID, r);
  return { userId: u.lastID, siteId: site.lastID };
}

test('pg auth: login + validateSession round-trip (roles preloaded) + logout', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b; const h = rdb.pgHandle();
  try {
    await seedUser(rdb, h, { username: 'alice', password: 'secret', role: 'admin', roles: ['admin', 'tracker-admin'] });
    assert.equal(await rdb.login('alice', 'wrong'), null, 'bad password → null');
    const ok = await rdb.login('alice', 'secret');
    assert.ok(ok && ok.token, 'good login → token');
    assert.deepEqual(ok.user.roles.sort(), ['admin', 'tracker-admin'], 'roles preloaded on login user');
    const u = await rdb.validateSession(ok.token);
    assert.equal(u.username, 'alice'); assert.ok(Array.isArray(u.roles) && u.roles.includes('tracker-admin'));
    await rdb.logout(ok.token);
    assert.equal(await rdb.validateSession(ok.token), null, 'logged-out token → null');
    // inactive user can't log in
    await seedUser(rdb, h, { username: 'bob', password: 'x', active: 0 });
    assert.equal(await rdb.login('bob', 'x'), null, 'inactive user → null');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('pg auth: last_seen 60s throttle', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b; const h = rdb.pgHandle();
  try {
    await seedUser(rdb, h, { username: 'carol', password: 'pw' });
    const { token } = await rdb.login('carol', 'pw');
    await rdb.validateSession(token);
    const t1 = (await h.prepare(`SELECT last_seen FROM sessions WHERE token=?`).get(token)).last_seen;
    await rdb.validateSession(token);                       // immediate re-validate → throttled
    const t2 = (await h.prepare(`SELECT last_seen FROM sessions WHERE token=?`).get(token)).last_seen;
    assert.deepEqual(t2, t1, 'last_seen NOT bumped within 60s');
    await h.prepare(`UPDATE sessions SET last_seen = now() - interval '2 minutes' WHERE token=?`).run(token);
    await rdb.validateSession(token);                       // now > 60s → bumped
    const t3 = (await h.prepare(`SELECT last_seen FROM sessions WHERE token=?`).get(token)).last_seen;
    assert.notDeepEqual(t3, t1, 'last_seen bumped after 60s');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

test('userHasRole sync invariant (spec #5 — no await, no PG)', () => {
  const rdb = require('../reports-db');
  assert.equal(rdb.userHasRole({ roles: ['admin'] }, 'editor'), true);          // hierarchy grants down
  assert.equal(rdb.userHasRole({ roles: ['tracker-admin'] }, 'tracker-admin'), true);  // feature role
  assert.equal(rdb.userHasRole({ roles: ['viewer'] }, 'admin'), false);         // no upward grant
});

// ── Task 5: listActiveSessions window + forceLogoutByToken ──────────────────
test('pg sessions: listActiveSessions window (number seconds_idle) + forceLogout', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b; const h = rdb.pgHandle();
  try {
    await seedUser(rdb, h, { username: 'dave', password: 'pw' });
    const { token: tFresh } = await rdb.login('dave', 'pw');
    await seedUser(rdb, h, { username: 'erin', password: 'pw' });
    const { token: tStale } = await rdb.login('erin', 'pw');
    await h.prepare(`UPDATE sessions SET last_seen = now() - interval '30 minutes' WHERE token=?`).run(tStale);
    const active = await rdb.listActiveSessions(5);
    const tokens = active.map(r => r.token);
    assert.ok(tokens.includes(tFresh) && !tokens.includes(tStale), 'only the fresh session is within the 5-min window');
    assert.equal(typeof active[0].seconds_idle, 'number', 'seconds_idle is a JS number');
    const fl = await rdb.forceLogoutByToken(tFresh);
    assert.equal(fl.deleted, 1);
    assert.equal(await rdb.validateSession(tFresh), null, 'force-logged-out session is gone');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── Task 6: user CRUD + cascades ────────────────────────────────────────────
test('pg users: createUser/listUsers/updateUser/changePassword/deleteUser + cascades', async (t) => {
  const b = await boot(); if (!b) return t.skip('no pg');
  const { ctx, rdb } = b; const h = rdb.pgHandle();
  try {
    const site = await h.prepare(`INSERT INTO sites (name, zoho_group, active) VALUES (?,?,1)`).run('Mana', 'Mana IT Agents');
    const r = await rdb.createUser({ username: 'frank', full_name: 'Frank', password: 'pw12345678', site_id: site.lastID, roles: ['admin', 'tracker-admin'] });
    const uid = r.lastID;
    let frank = (await rdb.listUsers()).find(u => u.username === 'frank');
    assert.ok(frank && frank.site_name === 'Mana', 'listUsers shows site_name (LEFT JOIN sites)');
    assert.deepEqual(frank.roles.sort(), ['admin', 'tracker-admin']);
    await rdb.updateUser(uid, { full_name: 'Frank Updated', site_id: site.lastID, roles: ['editor'] });
    frank = (await rdb.listUsers()).find(u => u.id === uid);
    assert.equal(frank.full_name, 'Frank Updated'); assert.deepEqual(frank.roles, ['editor']);
    assert.equal((await rdb.changePassword(uid, 'pw12345678', 'newpw12345')).ok, true);
    const login = await rdb.login('frank', 'newpw12345');
    assert.ok(login && login.token, 'login with the new password works');
    await rdb.deleteUser(uid);
    assert.equal((await h.prepare(`SELECT count(*)::int n FROM user_roles WHERE user_id=?`).get(uid)).n, 0, 'user_roles cascaded');
    assert.equal((await h.prepare(`SELECT count(*)::int n FROM sessions WHERE user_id=?`).get(uid)).n, 0, 'sessions cascaded');
  } finally { try { await rdb.pgHandle().close(); } catch {} await dropTestDb(ctx); }
});

// ── Task 3: copy-reports-auth.js parity ─────────────────────────────────────
function _makeAuthSqliteFixture() {
  const Database = require('better-sqlite3');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rauth-fix-'));
  const p = path.join(dir, 'reports.db');
  const db = new Database(p);
  db.exec(`
    CREATE TABLE sites (id INTEGER PRIMARY KEY, name TEXT UNIQUE, zoho_group TEXT, active INTEGER, sort_order INTEGER);
    CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE, full_name TEXT, password_hash TEXT, salt TEXT, site_id INTEGER, role TEXT, active INTEGER, created_at TEXT);
    CREATE TABLE user_roles (user_id INTEGER, role TEXT, granted_at TEXT, PRIMARY KEY(user_id,role));
    CREATE TABLE sessions (token TEXT PRIMARY KEY, user_id INTEGER, expires_at TEXT, created_at TEXT, last_seen TEXT);
  `);
  db.prepare(`INSERT INTO sites VALUES (1,'Hounde','Hounde IT Agents',1,0)`).run();
  db.prepare(`INSERT INTO users VALUES (1,'admin','Admin','hash','salt',1,'admin',1,'2026-06-01 00:00:00')`).run();
  db.prepare(`INSERT INTO user_roles VALUES (1,'admin','2026-06-01 00:00:00')`).run();
  db.prepare(`INSERT INTO sessions VALUES ('tok-1',1,'2030-01-01 00:00:00','2026-06-01 00:00:00',NULL)`).run();
  db.close();
  return p;
}

test('copy-reports-auth: reports.db auth → pg parity + FK + sequence advance', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  const { copyReportsAuth } = require('../tools/pg/copy-reports-auth');
  const src = _makeAuthSqliteFixture();
  const db = makePgDb(ctx.url); await db.connect();
  try {
    const c = await copyReportsAuth(src, db);
    assert.equal(c.sites, 1); assert.equal(c.users, 1); assert.equal(c.user_roles, 1); assert.equal(c.sessions, 1);
    // users.site_id FK resolved (LEFT JOIN sites)
    const u = await db.prepare(`SELECT u.username, s.name AS site_name FROM users u LEFT JOIN sites s ON s.id=u.site_id WHERE u.id=1`).get();
    assert.equal(u.site_name, 'Hounde');
    // idempotent re-copy
    await copyReportsAuth(src, db);
    assert.equal((await db.prepare(`SELECT count(*)::int n FROM users`).get()).n, 1);
    // sequence advanced past copied id 1
    const r = await db.prepare(`INSERT INTO sites (name) VALUES ('Mana')`).run();
    assert.ok(r.lastID > 1, 'sites identity advanced past copied id, got ' + r.lastID);
  } finally { await db.close(); await dropTestDb(ctx); fs.rmSync(path.dirname(src), { recursive: true, force: true }); }
});
