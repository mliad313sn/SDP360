'use strict';
// B-09 — Roadmap Manager → portfolio single source.
//  (a) the pure parity comparison: not migrated / in parity / drift, field by field and deliverable by deliverable;
//  (b) the mappings the parity repeats are the ones the migration route uses (no silent drift between them);
//  (c) end to end on PostgreSQL: seed a roadmap, migrate it through the REAL governance route, run the read-only
//      CLI → in parity; edit the roadmap → drift; and the CLI never writes (row counts unchanged);
//  (e) the switch `roadmap_redirect_to_portfolio`: default '0' keeps today's editable roadmap; '1' answers 409 on
//      every write route and keeps the data; GET /api/roadmap/mode says so; the page carries the banner.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const express = require('express');
const P = require('../services/roadmapParity');
const cli = require('../tools/governance/roadmap-parity');

const RM = {
  objectives: [
    { obj_key: 'catalogue', title: 'Catalogue', weight: 35, progress_pct: 40, status: 'green', target_date: '2026-12-31', sort_order: 0 },
    { obj_key: 'platform', title: 'Plateforme', weight: 25, progress_pct: null, status: 'orange', target_date: null, sort_order: 1 },
  ],
  deliverables: [
    { obj_key: 'catalogue', label: 'Form A', delivery_date: '2026-10-01', status: 'executed' },
    { obj_key: 'catalogue', label: 'Form B', delivery_date: null, status: 'todo' },
  ],
};
const PF = () => ({
  programmes: [{ id: 1, key: 'itsm-roadmap', name: 'ITSM roadmap' }],
  objectives: [
    { id: 10, programme_id: 1, key: 'itsm-roadmap-catalogue', name: 'Catalogue', weight: 35, progress_pct: 40, status: 'on_track', target_date: '2026-12-31' },
    { id: 11, programme_id: 1, key: 'itsm-roadmap-platform', name: 'Plateforme', weight: 25, progress_pct: null, status: 'at_risk', target_date: null },
  ],
  projects: [{ id: 100, objective_id: 10, key: 'itsm-roadmap-catalogue-deliverables' }],
  deliverables: [
    { id: 1, project_id: 100, name: 'Form A', due_date: '2026-10-01', status: 'done' },
    { id: 2, project_id: 100, name: 'Form B', due_date: null, status: 'todo' },
  ],
});

test('pure: no itsm-roadmap programme → not_migrated (never "in parity" on nothing)', () => {
  const r = P.computeParity(RM, { programmes: [], objectives: [], projects: [], deliverables: [] });
  assert.equal(r.verdict, 'not_migrated');
  assert.equal(r.counts.objectives_missing, 2);
  assert.match(P.renderMarkdown({ as_of: 'x', programme_key: 'itsm-roadmap', users: [{ user_id: 1, ...r }] }), /NOT MIGRATED/);
});

test('pure: identical content → in_parity', () => {
  const r = P.computeParity(RM, PF());
  assert.equal(r.verdict, 'in_parity', JSON.stringify(r.objectives));
  assert.equal(r.counts.portfolio_deliverables, 2);
});

test('pure: field, deliverable and extra-objective drift are each reported', () => {
  const pf = PF();
  pf.objectives[0].progress_pct = 55;
  pf.deliverables[0].status = 'in_progress';
  pf.deliverables.push({ id: 3, project_id: 100, name: 'Form C', status: 'todo' });
  pf.objectives.push({ id: 12, programme_id: 1, key: 'itsm-roadmap-extra', name: 'Extra' });
  const rm = { ...RM, deliverables: [...RM.deliverables, { obj_key: 'catalogue', label: 'Form D', status: 'todo' }] };
  const r = P.computeParity(rm, pf);
  assert.equal(r.verdict, 'drift');
  const cat = r.objectives.find((o) => o.obj_key === 'catalogue');
  assert.deepEqual(cat.diffs, [{ field: 'progress_pct', roadmap: 40, portfolio: 55 }]);
  assert.deepEqual(cat.deliverables.missing, ['Form D']);
  assert.deepEqual(cat.deliverables.extra, ['Form C']);
  assert.deepEqual(cat.deliverables.status_diff, [{ name: 'Form A', roadmap: 'done', portfolio: 'in_progress' }]);
  assert.deepEqual(r.extra_objectives, ['itsm-roadmap-extra']);
  const md = P.renderMarkdown({ as_of: 'x', programme_key: 'itsm-roadmap', users: [{ user_id: 7, ...r }] });
  assert.match(md, /DRIFT/); assert.match(md, /progress_pct: 40 → 55/); assert.match(md, /CAB decision/);
});

test('the parity mappings are the migration route\'s mappings (keys + status regexes)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'routes', 'governance.js'), 'utf8');
  const mig = src.slice(src.indexOf("router.post('/api/governance/roadmap-migration'"));
  assert.ok(mig.includes("const KEY = 'itsm-roadmap'"), 'programme key');
  assert.ok(mig.includes('key: `${KEY}-${o.obj_key}`'), 'objective key template');
  assert.ok(mig.includes('key: `${o.key}-deliverables`'), 'project key template');
  assert.ok(mig.includes("/exec|done|fait/i.test(d.status || '') ? 'done' : /cours|progress/i.test(d.status || '') ? 'in_progress' : 'todo'"), 'deliverable status map');
  assert.ok(mig.includes("/red|rouge/i.test(o.status || '') ? 'at_risk' : /orange|amber/i.test(o.status || '') ? 'at_risk' : 'on_track'"), 'objective status map');
  assert.ok(mig.includes('weight: Number(o.weight) || 1'), 'weight default');
  assert.equal(P.deliverableStatus('executed'), 'done'); assert.equal(P.deliverableStatus('en cours'), 'in_progress'); assert.equal(P.deliverableStatus('todo'), 'todo');
  assert.equal(P.objectiveStatus('orange'), 'at_risk'); assert.equal(P.objectiveStatus('green'), 'on_track');
});

test('CLI args + placeholder translation', () => {
  assert.deepEqual(cli.parseArgs(['--user=3', '--json', '--strict', '--out=x.md']), { user: 3, json: true, strict: true, out: 'x.md' });
  assert.equal(cli.parseArgs(['--user=abc']).user, null);
  assert.equal(cli.toPg('a = ? AND b = ?'), 'a = $1 AND b = $2');
});

test('switch default is today\'s behaviour (editable roadmap) and the pilot profile says so', () => {
  const { DEFAULTS } = require('../services/reportConfig');
  assert.equal(DEFAULTS.roadmap_redirect_to_portfolio, '0');
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'pilot', 'PILOT-PROFILE.md'), 'utf8'), /\| `roadmap_redirect_to_portfolio` \| built \| `0` \|/);
});

test('page: read-only banner + mode fetch, hidden by default, links to the portfolio', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'itsm-roadmap.html'), 'utf8');
  assert.match(html, /id="rm-readonly"[^>]*style="display:none;"/);
  assert.match(html, /href="\/portfolio\.html"/);
  assert.ok(html.includes("fetch('/api/roadmap/mode'"));
  assert.ok(html.includes('if (m && m.read_only) applyReadOnly(m.portfolio_url)'));
});

// ── PostgreSQL end to end ─────────────────────────────────────────────
let rdb, server, base, cfg;
const SUPER = 4711;
before(async () => {
  rdb = require('../reports-db');
  cfg = require('../services/reportConfig');
  const gov = require('../routes/governance');
  const store = gov.createStore(rdb, { log: () => {} });
  await store.init();
  const app = express();
  app.use((req, res, next) => { req.reportUser = { id: SUPER, username: 'rm-super', role: 'super_admin', roles: ['super_admin'] }; next(); });
  const pass = (req, res, next) => next();
  app.use(gov({ express, requireReportSession: pass, store }));
  app.use(require('../routes/roadmap')({ express, requireReportSession: pass, requireSuperAdmin: pass }));
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { try { server && server.close(); } catch (_) { /* closed */ } });

function call(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const r = http.request(base + p, { method, agent: false, headers: data ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data) } : {} }, (res) => {
      let b = ''; res.on('data', (d) => (b += d)); res.on('end', () => resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }));
    });
    r.on('error', reject); if (data) r.write(data); r.end();
  });
}
async function cliRun(args) {
  let out = '';
  const r = await cli.main({ args: { user: null, json: false, out: null, strict: true, ...args }, pgUrl: process.env.PG_URL, write: (s) => { out += s; } });
  return { ...r, out };
}
async function counts() {
  const H = rdb.pgHandle(); const n = async (t) => Number((await H.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get()).n);
  return { o: await n('roadmap_objectives'), d: await n('roadmap_deliverables'), po: await n('portfolio_objectives'), pd: await n('portfolio_deliverables') };
}

test('PG: before migration the CLI reports NOT MIGRATED and exits 2 in --strict', async () => {
  await rdb.getRoadmap(SUPER);                     // lazy-seeds the 4 objectives + default deliverables
  const r = await cliRun({});
  assert.equal(r.report.users.find((u) => u.user_id === SUPER).verdict, 'not_migrated');
  assert.equal(r.exitCode, 2);
  assert.match(r.out, /NOT MIGRATED/);
});

test('PG: after the real migration route → IN PARITY; the CLI writes nothing', async () => {
  const ap = await call('POST', '/api/governance/roadmap-migration?apply=1', {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  const before = await counts();
  const r = await cliRun({ user: SUPER });
  const u = r.report.users[0];
  assert.equal(u.verdict, 'in_parity', JSON.stringify(u.objectives.filter((o) => o.diffs.length || o.deliverables.missing.length || o.deliverables.status_diff.length)));
  assert.equal(u.counts.roadmap_deliverables, u.counts.portfolio_deliverables);
  assert.equal(r.exitCode, 0);
  assert.deepEqual(await counts(), before, 'read-only: no row added or removed');
  const viaRoute = await call('GET', '/api/roadmap/parity');
  assert.equal(viaRoute.status, 200); assert.equal(viaRoute.body.users[0].verdict, 'in_parity');
});

test('PG: an edit on the roadmap after migration shows as drift', async () => {
  await rdb.upsertRoadmapObjective(SUPER, 'catalogue', { progress_pct: 77 });
  const r = await cliRun({ user: SUPER, json: true });
  assert.equal(r.report.users[0].verdict, 'drift');
  assert.ok(JSON.parse(r.out).users[0].objectives.find((o) => o.obj_key === 'catalogue').diffs.some((d) => d.field === 'progress_pct' && d.roadmap === 77));
});

test('PG: switch off (default) → writes allowed; switch on → 409 on every write, data kept, reads still work', async () => {
  let m = await call('GET', '/api/roadmap/mode');
  assert.deepEqual(m.body, { redirect_to_portfolio: false, read_only: false, portfolio_url: '/portfolio.html' });
  assert.equal((await call('PUT', '/api/roadmap/objective/catalogue', { progress_pct: 78 })).status, 200);

  await cfg.setConfig(rdb.db, { roadmap_redirect_to_portfolio: '1' }, 'test');
  m = await call('GET', '/api/roadmap/mode');
  assert.equal(m.body.read_only, true);
  const before = await counts();
  const rm = await call('GET', '/api/roadmap');
  assert.equal(rm.status, 200); assert.equal(rm.body.objectives.length, 4);
  const anyUid = rm.body.deliverables[0].uid;
  for (const [method, p, body] of [
    ['PUT', '/api/roadmap/objective/catalogue', { progress_pct: 1 }],
    ['POST', '/api/roadmap/deliverable', { obj_key: 'catalogue', label: 'x' }],
    ['PUT', `/api/roadmap/deliverable/${anyUid}`, { status: 'done' }],
    ['DELETE', `/api/roadmap/deliverable/${anyUid}`],
    ['POST', '/api/roadmap/training', { site: 'X' }],
    ['POST', '/api/roadmap/action', { label: 'x' }],
    ['POST', '/api/roadmap/resource', { name: 'x' }],
  ]) {
    const r = await call(method, p, body);
    assert.equal(r.status, 409, `${method} ${p}`); assert.equal(r.body.read_only, true);
  }
  assert.deepEqual(await counts(), before, 'nothing written, nothing deleted');
  assert.equal((await call('GET', '/api/roadmap')).body.objectives.find((o) => o.obj_key === 'catalogue').progress_pct, 78);
  await cfg.setConfig(rdb.db, { roadmap_redirect_to_portfolio: '0' }, 'test');
  assert.equal((await call('PUT', '/api/roadmap/objective/catalogue', { progress_pct: 79 })).status, 200, 'switch back = editable again');
});
