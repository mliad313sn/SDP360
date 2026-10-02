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

const SCHEMA = fs.readFileSync(path.join(__dirname, '../db/postgres/reports/001_auth.sql'), 'utf8');

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

test('apply demotes exactly the site admins, keeps feature roles; restore puts everything back', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  const c = new Client({ connectionString: ctx.url }); await c.connect();
  try {
    const ids = await seed(c);
    const plan = planDemotion(await readUsers(c), { addTrackerEditor: true });
    assert.deepEqual(plan.map(p => p.username).sort(), ['hounde', 'ity']);

    await applyPlan(c, plan);
    assert.deepEqual(await rolesOf(c, ids.hounde), ['editor', 'report-author', 'tracker-editor']);
    assert.equal(await levelOf(c, ids.hounde), 'editor', 'legacy users.role follows');
    assert.deepEqual(await rolesOf(c, ids.ity), ['editor', 'tracker-editor']);
    assert.deepEqual(await rolesOf(c, ids.dgoro), ['admin'], 'site-less admin untouched');
    assert.equal(await levelOf(c, ids.boss), 'super_admin', 'super_admin untouched');

    await restorePlan(c, plan);
    assert.deepEqual(await rolesOf(c, ids.hounde), ['admin', 'report-author', 'tracker-editor']);
    assert.equal(await levelOf(c, ids.hounde), 'admin');
    assert.deepEqual(await rolesOf(c, ids.ity), ['admin']);
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
  } finally { await c.end(); await dropTestDb(ctx); }
});
