'use strict';
// G-12 — bulk demotion of the site coordinators from `admin` to `editor`, in ONE command
// (user request 2026-10-02: "without doing it one by one").
//
//   node tools/pg/demote-coordinators.js                       # SIMULATION — prints the plan, writes nothing
//   node tools/pg/demote-coordinators.js --apply --add-tracker-editor
//   node tools/pg/demote-coordinators.js --apply --except=lafigue,thomas
//   node tools/pg/demote-coordinators.js --apply --drop=audit-viewer   # remove a FEATURE role from
//                                       site accounts below admin (already-demoted coordinators too)
//   node tools/pg/demote-coordinators.js --restore=data/role-backups/roles-<stamp>.json
//
// Who: EXACTLY the accounts tools/pg/audit-roles.js lists as over_privileged — an admin
// WITH a site (services/roleDemotion.planDemotion reuses roleAudit.classifyAccount). A
// site-less admin (central IT), a super_admin or an executive is never touched: an editor
// without a site can write nothing at all.
// What: the level becomes `editor`, every feature role is kept (`--add-tracker-editor`
// also grants the tracker input role), the legacy users.role column follows.
// Safety: simulation by default; with --apply the BEFORE roles are written to a backup
// file first, then every account changes in ONE transaction (a failure changes nobody);
// --restore=<file> puts each account back exactly as it was.
//
// .env FIRST: every *-db module picks its backend at require time and only server.js
// loads dotenv, so a standalone run without this reads the frozen SQLite archives.
const path = require('path');
const fs = require('fs');
if (require.main === module) require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const { planRoles } = require('../../services/roleDemotion');

const HIERARCHY = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];

// Roles live in BOTH places (the users.role level and the user_roles rows); userHasRole
// reads the union, so the plan must too — same query shape as audit-roles.js, plus the id.
async function readUsers(client) {
  const rows = (await client.query(`
    SELECT u.id, u.username, u.full_name, u.site_id, s.name AS site_name,
           u.role AS base_role,
           COALESCE(ARRAY_AGG(r.role) FILTER (WHERE r.role IS NOT NULL), '{}') AS extra_roles
      FROM users u
      LEFT JOIN user_roles r ON r.user_id = u.id
      LEFT JOIN sites s ON s.id = u.site_id
     WHERE u.active = 1
     GROUP BY u.id, u.username, u.full_name, u.site_id, s.name, u.role
     ORDER BY u.username`)).rows;
  return rows.map(r => ({
    id: r.id, username: r.username, full_name: r.full_name, site_id: r.site_id, site_name: r.site_name,
    roles: [...new Set([r.base_role, ...(r.extra_roles || [])].filter(Boolean))],
  }));
}

// Write one account's role set — the same three steps as reports-db _setUserRolesPg.
async function _writeRoles(client, id, roles) {
  await client.query('DELETE FROM user_roles WHERE user_id = $1', [id]);
  for (const r of roles) await client.query('INSERT INTO user_roles (user_id, role) VALUES ($1, $2) ON CONFLICT DO NOTHING', [id, r]);
  const level = HIERARCHY.find(h => roles.includes(h)) || 'viewer';
  await client.query('UPDATE users SET role = $1 WHERE id = $2', [level, id]);
}

async function _inTx(client, fn) {
  await client.query('BEGIN');
  try { await fn(); await client.query('COMMIT'); }
  catch (e) { await client.query('ROLLBACK').catch(() => {}); throw e; }
}

// E6 — one `identity` / `user_role_changed` row in system_log per modified account (risk
// event, same shape as reports-db logEvent). Written AFTER the commit and best-effort: the
// journal never blocks or undoes a role change (logEvent's fire-and-forget contract).
const LOG_ACTOR = 'demote-coordinators';
async function _logIdentity(client, plan, mode) {
  let n = 0;
  for (const p of plan) {
    const from = mode === 'restore' ? p.after : p.before, to = mode === 'restore' ? p.before : p.after;
    try {
      await client.query(
        `INSERT INTO system_log (ts, category, action, actor, actor_id, target, details, ip, risk)
         VALUES ($1, 'identity', 'user_role_changed', $2, NULL, $3, $4, NULL, 1)`,
        [new Date().toISOString(), LOG_ACTOR, p.username,
         JSON.stringify({ user_id: p.id, before: from, after: to, tool: LOG_ACTOR, mode })]);
      n++;
    } catch (e) { console.warn(`[demote-coordinators] identity log skipped for ${p.username}: ${e.message}`); }
  }
  return n;
}

/** Apply the plan (every account in ONE transaction), then journal one identity event per account. */
async function applyPlan(client, plan) {
  await _inTx(client, async () => { for (const p of plan) await _writeRoles(client, p.id, p.after); });
  return _logIdentity(client, plan, 'apply');
}
/** Put every account of a plan (or of a backup file's content) back to its BEFORE roles, journaled too. */
async function restorePlan(client, plan) {
  await _inTx(client, async () => { for (const p of plan) await _writeRoles(client, p.id, p.before); });
  return _logIdentity(client, plan, 'restore');
}

function _args(argv) {
  const a = { apply: false, addTrackerEditor: false, except: [], drop: [], restore: null };
  for (const x of argv) {
    if (x === '--apply') a.apply = true;
    else if (x === '--add-tracker-editor') a.addTrackerEditor = true;
    else if (x.startsWith('--except=')) a.except = x.slice(9).split(',');
    else if (x.startsWith('--restore=')) a.restore = x.slice(10);
    else if (x.startsWith('--drop=')) a.drop = x.slice(7).split(',').map(s => s.trim()).filter(Boolean);
  }
  return a;
}

async function main(argv = process.argv.slice(2)) {
  if (!process.env.PG_URL) { console.error('PG_URL absent du .env — impossible de lire les comptes.'); process.exitCode = 1; return; }
  const args = _args(argv);
  const { Client } = require('pg');
  const c = new Client({ connectionString: process.env.PG_URL });
  await c.connect();
  try {
    if (args.restore) {
      const saved = JSON.parse(fs.readFileSync(path.resolve(args.restore), 'utf8'));
      await restorePlan(c, saved.plan || []);
      console.log(`Restauré : ${(saved.plan || []).length} compte(s) remis à leurs rôles d'origine (${args.restore}).`);
      return;
    }
    const plan = planRoles(await readUsers(c), { addTrackerEditor: args.addTrackerEditor, except: args.except, drop: args.drop });
    const what = 'RÉTROGRADATION admin → editor' + (args.drop.length ? ` + retrait de ${args.drop.join(', ')}` : '');
    console.log(`${what} — ${plan.length} compte(s) rattaché(s) à un site${args.apply ? '' : '  [SIMULATION — rien n\'est modifié]'}`);
    console.log('');
    for (const p of plan) console.log(`  - ${String(p.username).padEnd(42)} ${String(p.site_name || '').padEnd(14)} ${p.before.join(',')}  →  ${p.after.join(',')}`);
    console.log('');
    if (!plan.length) { console.log('Rien à faire.'); return; }
    if (!args.apply) {
      console.log('Pour appliquer :  node tools\\pg\\demote-coordinators.js --apply' + (args.addTrackerEditor ? ' --add-tracker-editor' : '') + (args.except.length ? ' --except=' + args.except.join(',') : '') + (args.drop.length ? ' --drop=' + args.drop.join(',') : ''));
      return;
    }
    const dir = path.join(__dirname, '..', '..', 'data', 'role-backups');
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `roles-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
    fs.writeFileSync(file, JSON.stringify({ written_at: new Date().toISOString(), plan }, null, 2));
    console.log(`Sauvegarde des rôles d'origine : ${file}`);
    await applyPlan(c, plan);
    console.log(`Appliqué : ${plan.length} compte(s) modifié(s) (une seule transaction).`);
    console.log('Effet au prochain chargement de page de chaque utilisateur. Vérifier : node tools\\pg\\audit-roles.js');
    console.log(`Retour arrière :  node tools\\pg\\demote-coordinators.js --restore=${path.relative(path.join(__dirname, '..', '..'), file)}`);
  } finally {
    await c.end();
  }
}

if (require.main === module) {
  main().catch(e => { console.error('[demote-coordinators]', e.message); process.exitCode = 1; });
}

module.exports = { main, readUsers, applyPlan, restorePlan, _logIdentity, LOG_ACTOR };
