'use strict';
// G-12 bulk demotion against a REAL PostgreSQL schema (throwaway, pg-helpers).
// readUsers → planDemotion → applyPlan must: demote exactly the site admins, keep their
// feature roles, set the legacy users.role column, leave everyone else alone — in ONE
// transaction — and restorePlan must put every account back exactly as it was.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');
const { readUsers, applyPlan, restorePlan } = require('../tools/pg/demote-coordinators');
const { planDemotion } = require('../services/roleDemotion');

const SCHEMA = fs.readFileSync(path.join(__dirname, '../db/postgres/reports/001_auth.sql'), 'utf8')
  + '\n' + fs.readFileSync(path.join(__dirname, '../db/postgres/reports/006_system_log.sql'), 'utf8');   // E6: identity journal

async function seed(c) {
  await c.query(SCHEMA);
  const site = (await c.query(`INSERT INTO sites (name, zoho_group, active) VALUES ('Hounde','Hounde IT Agents',1) RETURNING id`)).rows[0].id;
  const mk = async (username, role, site_id, roles) => {
    const id = (await c.query(`INSERT INTO users (username, full_name, password_hash, salt, site_id, role, active) VALUES ($1,$1,'h','s',$2,$3,1) RETURNING id`, [username, site_id, role])).rows[0].id;
    for (const r of roles) await c.query(`INSERT INTO user_roles (user_id, role) VALUES ($1,$2)`, [id, r]);
    return id;
  };
  return {
    hounde: await mk('hounde', 'admin', site, ['admin', 'tracker-editor', 'report-author']),
    ity:    await mk('ity', 'admin', site, ['admin']),
    dgoro:  await mk('dgoro', 'admin', null, ['admin']),
    boss:   await mk('boss', 'super_admin', null, ['super_admin']),
  };
}
const rolesOf = async (c, id) => (await c.query(`SELECT role FROM user_roles WHERE user_id=$1 ORDER BY role`, [id])).rows.map(r => r.role);
const levelOf = async (c, id) => (await c.query(`SELECT role FROM users WHERE id=$1`, [id])).rows[0].role;
const identityLog = async (c) => (await c.query(`SELECT action, actor, target, details, risk FROM system_log WHERE category='identity' ORDER BY id`)).rows;

test('apply demotes exactly the site admins, keeps feature roles; restore puts everything back', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  const c = new Client({ connectionString: ctx.url }); await c.connect();
  try {
    const ids = await seed(c);
    const plan = planDemotion(await readUsers(c), { addTrackerEditor: true });
    assert.deepEqual(plan.map(p => p.username).sort(), ['hounde', 'ity']);

    const logged = await applyPlan(c, plan);
    assert.equal(logged, 2, 'E6: one identity event per modified account');
    assert.deepEqual(await rolesOf(c, ids.hounde), ['editor', 'report-author', 'tracker-editor']);
    assert.equal(await levelOf(c, ids.hounde), 'editor', 'legacy users.role follows');
    const log1 = await identityLog(c);
    assert.deepEqual(log1.map(r => r.target).sort(), ['hounde', 'ity']);
    assert.ok(log1.every(r => r.action === 'user_role_changed' && r.actor === 'demote-coordinators' && r.risk === 1));
    const h = JSON.parse(log1.find(r => r.target === 'hounde').details);
    assert.deepEqual(h.before, ['admin', 'report-author', 'tracker-editor']);
    assert.deepEqual(h.after, ['editor', 'report-author', 'tracker-editor']);
    assert.equal(h.mode, 'apply');
    assert.deepEqual(await rolesOf(c, ids.ity), ['editor', 'tracker-editor']);
    assert.deepEqual(await rolesOf(c, ids.dgoro), ['admin'], 'site-less admin untouched');
    assert.equal(await levelOf(c, ids.boss), 'super_admin', 'super_admin untouched');

    await restorePlan(c, plan);
    assert.deepEqual(await rolesOf(c, ids.hounde), ['admin', 'report-author', 'tracker-editor']);
    assert.equal(await levelOf(c, ids.hounde), 'admin');
    assert.deepEqual(await rolesOf(c, ids.ity), ['admin']);
    const log2 = await identityLog(c);
    assert.equal(log2.length, 4, 'restore journals each account too');
    const rh = JSON.parse(log2.filter(r => r.target === 'hounde')[1].details);
    assert.equal(rh.mode, 'restore');
    assert.deepEqual(rh.before, ['editor', 'report-author', 'tracker-editor']);
    assert.deepEqual(rh.after, ['admin', 'report-author', 'tracker-editor']);
  } finally { await c.end(); await dropTestDb(ctx); }
});

test('apply is all-or-nothing: a failure leaves every account unchanged', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  const c = new Client({ connectionString: ctx.url }); await c.connect();
  try {
    const ids = await seed(c);
    const plan = planDemotion(await readUsers(c));
    plan.push({ id: 999999, username: 'ghost', before: ['admin'], after: ['not-a-real-role-' + 'x'.repeat(300)] });
    await assert.rejects(() => applyPlan(c, plan));
    assert.deepEqual(await rolesOf(c, ids.hounde), ['admin', 'report-author', 'tracker-editor'], 'rolled back');
    assert.equal((await identityLog(c)).length, 0, 'nothing journaled when nothing changed');
  } finally { await c.end(); await dropTestDb(ctx); }
});

test('--drop: removes audit-viewer from an already-demoted coordinator, restorable', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  const c = new Client({ connectionString: ctx.url }); await c.connect();
  try {
    const ids = await seed(c);
    await c.query(`INSERT INTO user_roles (user_id, role) VALUES ($1, 'audit-viewer')`, [ids.hounde]);
    await applyPlan(c, planDemotion(await readUsers(c)));             // the demotion already applied in prod
    const { planRoles } = require('../services/roleDemotion');
    const plan = planRoles(await readUsers(c), { drop: ['audit-viewer'] });
    assert.deepEqual(plan.map(p => p.username), ['hounde']);
    await applyPlan(c, plan);
    assert.deepEqual(await rolesOf(c, ids.hounde), ['editor', 'report-author', 'tracker-editor']);
    assert.equal(await levelOf(c, ids.hounde), 'editor');
    await restorePlan(c, plan);
    assert.deepEqual(await rolesOf(c, ids.hounde), ['audit-viewer', 'editor', 'report-author', 'tracker-editor']);
  } finally { await c.end(); await dropTestDb(ctx); }
});
