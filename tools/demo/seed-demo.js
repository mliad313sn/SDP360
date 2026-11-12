'use strict';
// R6 (REBUILD-SPEC, plan F amendment) — repeatable end-to-end demonstration on a THROWAWAY PostgreSQL database.
//
// Creates a clearly-labelled SYNTHETIC organisation (every name starts with "DEMO"): two sites, one person per role
// (coordinator, PMO / committee, finance reader, executive, editor of site B), a portfolio project on site A with
// tasks, a dependency, a milestone, a risk, a change request, time (effort hours) and actuals in two currencies,
// a benefit with baseline / target (NOT realised — no benefit is invented), and a published dashboard reference.
// Everything it creates is recorded in an inventory file; `--remove` deletes exactly that, nothing else.
//
// Safety (refuse first, ask later):
//   * the target is read from the LIVE connection (current_database(), current_schema()), never from a name typed by
//     a person; a database that looks like production (sdp_dashboard, fmp_v2, postgres, *prod*) is refused even with
//     the flag, unless the connection is pinned to a throwaway test schema (sdp_test_*), where nothing else is written;
//   * a target that is not recognisably throwaway (sdp_tracker_test_*, sdp_test_* schema, *_demo / *_test / *_sandbox)
//     needs --i-know-this-is-a-test-db;
//   * the target must hold ZERO portfolio projects (live or soft-deleted) — a database with real work is never seeded;
//   * --remove only touches the ids of the inventory, only on the database the inventory names, and only rows whose
//     label still starts with "DEMO" (a hand-edited inventory cannot delete a real row).
//
//   PG_URL=postgres://…/sdp_demo node tools/demo/seed-demo.js [--inventory=demo-inventory.json] [--i-know-this-is-a-test-db]
//   PG_URL=postgres://…/sdp_demo node tools/demo/seed-demo.js --remove [--inventory=demo-inventory.json]
// The connection string comes from the environment only (never a command-line argument: it carries a password).
// Passwords of the synthetic people are random per run and printed once to stdout; they are never written to a file.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const LABEL = 'DEMO';
const FLAG = '--i-know-this-is-a-test-db';
const PROD_DBS = ['sdp_dashboard', 'fmp_v2', 'postgres', 'template0', 'template1'];

/** PURE — what kind of target is this connection? */
function classifyTarget({ database, schema } = {}) {
  const db = String(database || '').toLowerCase(), sc = String(schema || '').toLowerCase();
  const testSchema = /^sdp_test_[a-z0-9]+$/.test(sc);
  const productionLike = PROD_DBS.includes(db) || /prod/.test(db);
  const throwawayDb = /^sdp_tracker_test_[a-z0-9]+$/.test(db) || /(^|_)(demo|test|sandbox|throwaway)(_|$)/.test(db);
  if (testSchema) return { throwaway: true, productionLike, reason: `pinned to throwaway schema ${sc}` };
  if (productionLike) return { throwaway: false, productionLike: true, reason: `database ${db || '(unknown)'} looks like production` };
  if (throwawayDb) return { throwaway: true, productionLike: false, reason: `database ${db} is named as a throwaway` };
  return { throwaway: false, productionLike: false, reason: `database ${db || '(unknown)'} is not recognisably a throwaway` };
}

/** PURE — throws when seeding this target is not allowed. */
function assertSafeTarget({ database, schema, projectCount, iKnow = false } = {}) {
  const c = classifyTarget({ database, schema });
  if (c.productionLike && !/^sdp_test_/.test(String(schema || '').toLowerCase())) throw Object.assign(new Error(`refused: ${c.reason} — the demo never runs there, flag or not`), { code: 'REFUSED_PRODUCTION' });
  if (!c.throwaway && !iKnow) throw Object.assign(new Error(`refused: ${c.reason}; re-run with ${FLAG} if it really is a test database`), { code: 'REFUSED_NOT_THROWAWAY' });
  if (!(Number(projectCount) === 0)) throw Object.assign(new Error(`refused: the target already holds ${projectCount} portfolio project(s); the demo only seeds an empty portfolio`), { code: 'REFUSED_NOT_EMPTY' });
  return c;
}

async function targetIdentity(pg) {
  const id = await pg.prepare('SELECT current_database() AS database, current_schema() AS schema').get();
  const has = await pg.prepare(`SELECT to_regclass('portfolio_projects') IS NOT NULL AS ok`).get();
  const projectCount = has && has.ok ? Number((await pg.prepare('SELECT COUNT(*) AS n FROM portfolio_projects').get()).n) : 0;
  return { database: id.database, schema: id.schema, projectCount };
}

const pw = () => 'Demo!' + crypto.randomBytes(9).toString('hex');
const day = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const month = (n) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() + n); return d.toISOString().slice(0, 7); };

const ROLES = [
  { key: 'coordinator', roles: ['editor', 'report-author'], site: 'A' },
  { key: 'pmo', roles: ['viewer', 'committee-member'], site: null },
  { key: 'finance', roles: ['viewer', 'finance-viewer'], site: null },
  { key: 'executive', roles: ['executive'], site: null },
  { key: 'editor_b', roles: ['editor'], site: 'B' },
];

/**
 * Seed the synthetic organisation. deps: { rdb (initialised reports-db), gov (governance store), dash (dashboard store) }.
 * → { inventory, users: { key: {id, username, password, full_name, roles} }, ids }
 */
async function seedDemo({ rdb, gov, dash, tag = crypto.randomBytes(3).toString('hex') } = {}) {
  const pg = rdb.pgHandle();
  const inv = { label: 'SYNTHETIC DEMO — not real data', version: 1, created_at: new Date().toISOString(), tag,
    ids: { sites: [], users: [], programmes: [], objectives: [], projects: [], rfis: [], dashboards: [] },
    children: {}, retained_by_design: ['ppm_events (append-only, hash-chained audit trail)', 'system_log (append-only)', 'sessions of the synthetic people (removed with them)'] };
  const ids = {};
  // sites
  const siteA = await rdb.createSite({ name: `${LABEL}-A Synthetic mine ${tag}` });
  const siteB = await rdb.createSite({ name: `${LABEL}-B Synthetic office ${tag}` });
  inv.ids.sites.push(Number(siteA.id), Number(siteB.id));
  ids.siteA = Number(siteA.id); ids.siteB = Number(siteB.id);
  // people
  const users = {};
  for (const r of ROLES) {
    const u = { username: `demo_${r.key}_${tag}`, full_name: `${LABEL} ${r.key} (synthetic)`, password: pw(), roles: r.roles };
    const res = await rdb.createUser({ username: u.username, full_name: u.full_name, password: u.password, roles: r.roles, site_id: r.site === 'A' ? ids.siteA : r.site === 'B' ? ids.siteB : null });
    u.id = Number(res.lastID || (await pg.prepare('SELECT id FROM users WHERE username=?').get(u.username)).id);
    inv.ids.users.push(u.id); users[r.key] = u;
  }
  const actor = { id: users.pmo.id, username: users.pmo.username, full_name: users.pmo.full_name };
  const up = (kind, body) => gov.upsertPortfolio(kind, body, { user: actor });
  // portfolio
  ids.programme = await up('programme', { key: `demo-prog-${tag}`, name: `${LABEL} programme (synthetic)` }); inv.ids.programmes.push(ids.programme);
  ids.objective = await up('objective', { programme_id: ids.programme, key: `demo-obj-${tag}`, name: `${LABEL} objective — two links per site (synthetic)` }); inv.ids.objectives.push(ids.objective);
  ids.project = await up('project', { objective_id: ids.objective, key: `DEMO-${tag}`, name: `${LABEL} WAN redundancy — site A (synthetic)`, owner: users.coordinator.username, site_id: ids.siteA, status: 'active',
    start_date: day(-30), end_date: day(60), baseline_start: day(-30), baseline_end: day(55), budget: 50000, spent: 0, currency: 'USD', spend_type: 'capex', progress_pct: 20 });
  inv.ids.projects.push(ids.project);
  // tasks: done (100 %), measured zero (0 %, 0 h), unknown (no progress, no effort reported) — zero is not unknown
  ids.t1 = await up('task', { project_id: ids.project, wbs_code: '1', name: `${LABEL} site survey`, owner: users.coordinator.username, start_date: day(-30), end_date: day(-20), duration_days: 10, status: 'done', progress_pct: 100, effort_hours: 16 });
  ids.t2 = await up('task', { project_id: ids.project, wbs_code: '2', name: `${LABEL} second link order`, owner: users.coordinator.username, start_date: day(-19), end_date: day(10), duration_days: 20, status: 'in_progress', progress_pct: 0, effort_hours: 0, depends_on: [ids.t1] });
  ids.t3 = await up('task', { project_id: ids.project, wbs_code: '3', name: `${LABEL} failover test`, owner: users.coordinator.username, start_date: day(11), end_date: day(20), duration_days: 7, status: 'todo', depends_on: [ids.t2] });
  ids.milestone = await up('milestone', { project_id: ids.project, name: `${LABEL} second link live`, due_date: day(20), baseline_date: day(18), status: 'open', owner: users.coordinator.username });
  ids.risk = await up('risk', { project_id: ids.project, title: `${LABEL} carrier delivery slips`, probability: 3, impact: 3, mitigation: 'second carrier quote kept open', owner: users.pmo.username, status: 'open', kind: 'risk' });
  // a change request: no native change-request entity exists (WORKBENCH-GAPS R5) — recorded as a governance request
  const cr = await gov.submitRfi({ kind: 'governance', title: `${LABEL} change request — extend scope to site B (synthetic)`, problem: 'scope change on the demo project; stand-in for a change request', site_id: ids.siteA }, { user: actor });
  ids.rfi = Number(cr.id); inv.ids.rfis.push(ids.rfi);
  // actuals in two currencies (+ a baseline) — budget periods, justification given where the store asks for one
  const m = month(0);
  await gov.saveBudgetPeriod(ids.project, { period: m, currency: 'USD', kind: 'baseline', amount: 15000 }, { user: actor });
  await gov.saveBudgetPeriod(ids.project, { period: m, currency: 'USD', kind: 'actual', amount: 12000, reason: 'synthetic actual below baseline' }, { user: actor });
  await gov.saveBudgetPeriod(ids.project, { period: m, currency: 'XOF', kind: 'actual', amount: 1500000, reason: 'synthetic local-currency actual' }, { user: actor });
  // a benefit with baseline and target — realised value left UNKNOWN (never invented)
  ids.benefit = await up('benefit', { project_id: ids.project, description: `${LABEL} fewer unplanned WAN outage hours (synthetic)`, measure: 'unplanned outage hours', unit: 'hours / month', value_kind: 'quantity', baseline_value: 12, target_value: 4, owner: users.pmo.username, review_date: day(90) });
  inv.children = { tasks: [ids.t1, ids.t2, ids.t3], milestones: [ids.milestone], risks: [ids.risk], benefits: [ids.benefit], budget_periods: [`${m} USD baseline`, `${m} USD actual`, `${m} XOF actual`] };
  // a published dashboard reference (text + one registered metric)
  if (dash) {
    const key = `demo-synthetic-${tag}`;
    await dash.saveDraft({ key, title: `${LABEL} site A dashboard (synthetic)`, audience: 'site', grid: { columns: 12 }, filters: [{ key: 'site', type: 'site' }],
      widgets: [{ id: 'intro', type: 'text', layout: { x: 0, y: 0, w: 12, h: 1 }, markdown: '**Synthetic demonstration** — no figure on this page is real.' }] }, { user: actor, siteId: ids.siteA });
    await dash.publish(key, { user: actor, note: 'demo seed' });
    ids.dashboard = key; inv.ids.dashboards.push(key);
  }
  return { inventory: inv, users, ids };
}

const LABEL_SQL = {
  sites: ['sites', 'name'], users: ['users', 'full_name'], programmes: ['portfolio_programmes', 'name'], objectives: ['portfolio_objectives', 'name'],
  projects: ['portfolio_projects', 'name'], rfis: ['rfi_requests', 'title'], dashboards: ['dashboard_definitions', 'title'],
};

/** Delete exactly what the inventory lists, on the database it names. → { removed, skipped, residue } */
async function removeDemo({ rdb, inventory, target }) {
  if (!inventory || !inventory.ids) throw new Error('inventory missing or unreadable');
  if (target && (inventory.database !== target.database || String(inventory.schema || '') !== String(target.schema || ''))) {
    throw Object.assign(new Error(`refused: the inventory belongs to ${inventory.database}/${inventory.schema}, the connection is ${target.database}/${target.schema}`), { code: 'REFUSED_OTHER_TARGET' });
  }
  const pg = rdb.pgHandle();
  const removed = {}, skipped = {};
  const labelled = async (kind, id) => {
    const [t, col] = LABEL_SQL[kind]; const keyCol = kind === 'dashboards' ? 'key' : 'id';
    const r = await pg.prepare(`SELECT ${col} AS label FROM ${t} WHERE ${keyCol}=?`).get(kind === 'dashboards' ? String(id) : Number(id));
    if (!r) return 'gone';
    return String(r.label || '').startsWith(LABEL) ? 'demo' : 'foreign';
  };
  const del = async (kind, sqls) => {
    removed[kind] = 0; skipped[kind] = [];
    for (const id of inventory.ids[kind] || []) {
      const st = await labelled(kind, id);
      if (st === 'foreign') { skipped[kind].push(id); continue; }
      if (st === 'gone') continue;
      for (const s of sqls) await pg.prepare(s).run(kind === 'dashboards' ? String(id) : Number(id));
      removed[kind]++;
    }
  };
  await pg.runTransaction(async () => {
    await del('dashboards', ['DELETE FROM dashboard_definition_versions WHERE key=?', 'DELETE FROM dashboard_definitions WHERE key=?']);
    await del('rfis', ['DELETE FROM rfi_requests WHERE id=?']);
    await del('projects', ['DELETE FROM portfolio_projects WHERE id=?']);   // tasks, milestones, risks, benefits, budget periods cascade
    await del('objectives', ['DELETE FROM portfolio_objectives WHERE id=?']);
    await del('programmes', ['DELETE FROM portfolio_programmes WHERE id=?']);
    await del('users', ['DELETE FROM sessions WHERE user_id=?', 'DELETE FROM users WHERE id=?']);
    await del('sites', ['DELETE FROM sites WHERE id=?']);
  });
  const residue = {};
  for (const kind of Object.keys(LABEL_SQL)) {
    let n = 0; for (const id of inventory.ids[kind] || []) if ((await labelled(kind, id)) === 'demo') n++;
    residue[kind] = n;
  }
  return { removed, skipped, residue };
}

function _arg(argv, name) { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : null; }

async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  const url = process.env.PG_URL || process.env.DATABASE_URL;
  if (!url) throw new Error('set PG_URL to the THROWAWAY database (environment only, never on the command line)');
  const invPath = path.resolve(_arg(argv, 'inventory') || 'demo-inventory.json');
  for (const m of ['REPORTS', 'TRACKER', 'MEETINGS', 'INSPECTION', 'ASSETS']) process.env[m + '_BACKEND'] = 'postgres';
  const { makePgDb } = require(path.join(ROOT, 'services', 'pgDb.js'));
  const probe = makePgDb(url); await probe.connect();
  let target;
  try { target = await targetIdentity(probe); } finally { await probe.close(); }
  const rdb = require(path.join(ROOT, 'reports-db.js'));
  if (argv.includes('--remove')) {
    const inventory = JSON.parse(fs.readFileSync(invPath, 'utf8'));
    await rdb.initPgReports();
    const out = await removeDemo({ rdb, inventory, target });
    log('[demo] removed ' + JSON.stringify(out.removed) + ' · residue ' + JSON.stringify(out.residue) + (Object.values(out.skipped).some((x) => x.length) ? ' · SKIPPED (not DEMO-labelled) ' + JSON.stringify(out.skipped) : ''));
    return out;
  }
  assertSafeTarget({ ...target, iKnow: argv.includes(FLAG) });
  // a fresh throwaway database needs a first admin: random per run, printed once, never written to a file
  let bootAdmin = null;
  if (!process.env.DASH_USER || !process.env.DASH_PASS) {
    bootAdmin = { user: 'demo-admin-' + crypto.randomBytes(3).toString('hex'), pass: pw() };
    process.env.DASH_USER = bootAdmin.user; process.env.DASH_PASS = bootAdmin.pass;
  }
  await rdb.initPgReports();
  await require(path.join(ROOT, 'db', 'migrate.js')).migrateAtBoot({ log: () => {} });
  const gov = require(path.join(ROOT, 'routes', 'governance.js')).createStore(rdb); await gov.init();
  const dash = require(path.join(ROOT, 'services', 'dashboardStore.js')).makeDashboardStore({ prepare: (sql) => rdb.pgHandle().prepare(sql) }, { isPg: true });
  const r = await seedDemo({ rdb, gov, dash });
  const inventory = { ...r.inventory, database: target.database, schema: target.schema };
  if (bootAdmin) { inventory.bootstrap_admin = bootAdmin.user; inventory.retained_by_design = [...inventory.retained_by_design, `first admin ${bootAdmin.user} (the database's own admin; drop the throwaway database to remove it)`]; }
  fs.writeFileSync(invPath, JSON.stringify(inventory, null, 2));
  log(`[demo] SYNTHETIC organisation created on ${target.database}/${target.schema}; inventory → ${invPath}`);
  if (bootAdmin) log(`  first admin  ${bootAdmin.user}  password: ${bootAdmin.pass}  (only if the database was empty)`);
  for (const [k, u] of Object.entries(r.users)) log(`  ${k.padEnd(12)} ${u.username}  password: ${u.password}  roles: ${u.roles.join(', ')}`);
  log(`  project id ${r.ids.project} · /project.html?id=${r.ids.project} · remove with --remove --inventory=${invPath}`);
  return { ...r, inventory };
}

module.exports = { classifyTarget, assertSafeTarget, targetIdentity, seedDemo, removeDemo, main, LABEL, FLAG };

if (require.main === module) {
  main().then(() => process.exit(0), (e) => { console.error('[demo] ' + e.message); process.exit(e.code && String(e.code).startsWith('REFUSED') ? 2 : 1); });
}
