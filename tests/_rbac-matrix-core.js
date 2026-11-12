'use strict';
// A0 — SAFETY NET: data-driven RBAC regression core, shared by tests/rbac-matrix.smoke.test.js,
// tests/rbac-scope-frozen.smoke.test.js and tests/rbac-mutation.smoke.test.js.
//
// The EXPECTED decisions come from the COMMITTED matrix (docs/ops/authz-matrix.json), never from the live router:
// a guard removed from a route keeps its committed expectation, so the runtime sweep fails (and the freshness test in
// tests/authz-matrix-json.test.js fails too). Expectations are computed with the ORIGINAL role engine captured at
// load time, so a mutation of rdb.userHasRole cannot rewrite its own expectations.
//
// Every check returns a list of violations (strings); an empty list = the rule holds. Checks never throw on a
// violation, so the mutation test can assert "this deliberate break is detected".
const http = require('http');
const fs = require('fs');
const path = require('path');

const MATRIX_PATH = path.join(__dirname, '..', 'docs', 'ops', 'authz-matrix.json');
const BUSINESS = ['site-business', 'group-business'];
const FLAG_KEEP_OFF = /send|notify|alert|cron|meridian|teams_sla|sdp_api_write|deprovision|purge|throttle/;

// Canonical personas, least privileged first (the allow-side probe uses the FIRST allowed persona of a route, i.e.
// the narrowest account that must still get through). site: 'A' | 'B' | null.
const PERSONAS = [
  { key: 'viewA', roles: ['viewer'], site: 'A' },
  { key: 'edNoSite', roles: ['editor'], site: null },
  { key: 'edA', roles: ['editor'], site: 'A' },
  { key: 'fieldA', roles: ['field-tech'], site: 'A' },
  { key: 'trkA', roles: ['viewer', 'tracker-editor'], site: 'A' },
  { key: 'scoreA', roles: ['viewer', 'scorecard-viewer'], site: 'A' },
  { key: 'finA', roles: ['viewer', 'finance-viewer'], site: 'A' },
  { key: 'committee', roles: ['viewer', 'committee-member'], site: null },
  { key: 'sbizA', roles: ['site-business'], site: 'A' },
  { key: 'gbiz', roles: ['group-business'], site: null },
  { key: 'admin', roles: ['admin'], site: null },
  { key: 'exec', roles: ['executive'], site: null },
  { key: 'super', roles: ['super_admin'], site: null },
];

let _origHasRole = null;
function originalHasRole() {
  if (!_origHasRole) _origHasRole = require('../reports-db').userHasRole;
  return _origHasRole;
}
originalHasRole();   // capture before any mutation can happen

const isBusinessOnly = (roles) => roles.length > 0 && roles.every((r) => BUSINESS.includes(r));

/** Expected decision of the route's ROLE guards + business lock for a persona (site scope is not part of it). */
function expectedAllow(row, persona) {
  const has = originalHasRole();
  if (row.gate === 'public') return true;
  if (isBusinessOnly(persona.roles) && !row.business_allowed) return false;
  return row.guards.every((g) => !g.roles || g.roles.some((r) => has({ roles: persona.roles }, r)));
}

function loadMatrix() { return JSON.parse(fs.readFileSync(MATRIX_PATH, 'utf8')); }

/** Turn an Express path into a concrete URL (route-matrix convention: :id-like → 1, other params → ZZZ). */
function concrete(p) {
  return p.replace(/\(\.\*\)|\*/g, 'x').split('/').map((seg) => (seg.startsWith(':') ? (/id\b|uid|key|token/i.test(seg) ? '1' : 'ZZZ') : seg)).join('/');
}

function request(base, method, p, token, body, timeoutMs = 15000) {
  return new Promise((resolve) => {
    const headers = { 'content-type': 'application/json' };
    if (token) headers['x-report-token'] = token;
    const r = http.request(base + p, { method, agent: false, headers, timeout: timeoutMs }, (res) => {
      const chunks = []; res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = /json|text|html/.test(res.headers['content-type'] || '') ? buf.toString('utf8') : '';
        let json = null; try { json = JSON.parse(text); } catch (_) { /* not json */ }
        resolve({ status: res.statusCode, text, json, type: res.headers['content-type'] || '', bytes: buf.length });
      });
    });
    r.on('timeout', () => { r.destroy(); resolve({ status: 'timeout', text: '' }); });
    r.on('error', (e) => resolve({ status: 'error', text: e.message }));
    const payload = body === undefined ? (['GET', 'DELETE', 'HEAD'].includes(method) ? undefined : '{}') : JSON.stringify(body);
    if (payload !== undefined) r.write(payload);
    r.end();
  });
}

async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; await fn(items[k], k); }
  });
  await Promise.all(workers);
}

/** Boot server.js in-process on the file's throwaway PostgreSQL, create sites A (Hounde/HGO) + B (Sabodala/SGO) and the personas. */
async function bootWorld({ prefix = 'a0' } = {}) {
  process.env.SDP_TEST_NO_RATE_LIMIT = '1';
  const quiet = console.log; console.log = () => {};
  let app;
  try { app = require('../server').app; } finally { console.log = quiet; }
  const rdb = require('../reports-db');
  // Feature switches answer 404 BEFORE some role guards (e.g. access_recert_enabled): arm every functional switch so
  // the guard behind it is exercised. Switches that SEND, notify, schedule or call out stay off.
  const reportConfig = require('../services/reportConfig');
  const flags = {};
  for (const k of Object.keys(reportConfig.DEFAULTS)) if (/_enabled$/.test(k) && !FLAG_KEEP_OFF.test(k)) flags[k] = '1';
  await reportConfig.setConfig(rdb.db, flags, 'a0-safety-net');
  const sites = (await rdb.listSites({ includeInactive: true })) || [];
  const A = sites.find((s) => s.name === 'Hounde');
  const B = sites.find((s) => s.name === 'Sabodala');
  if (!A || !B) throw new Error('seeded sites Hounde + Sabodala expected');
  const tok = {}, users = {};
  for (const p of PERSONAS) {
    const username = `${prefix}-${p.key}`, password = `${username}-pass-0000`;
    const site_id = p.site === 'A' ? A.id : p.site === 'B' ? B.id : null;
    try { await rdb.createUser({ username, full_name: username, password, role: p.roles[0], roles: p.roles, site_id }); } catch (_) { /* rerun */ }
    tok[p.key] = (await rdb.login(username, password)).token;
    users[p.key] = ((await rdb.listUsers()) || []).find((u) => u.username === username);
  }
  let server;
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  const base = 'http://127.0.0.1:' + server.address().port;
  const send = (method, p, t, body) => request(base, method, p, t, body);
  return { app, rdb, A, B, tok, users, base, send, matrix: loadMatrix(), close: () => server && server.close() };
}

const personaOf = (key) => PERSONAS.find((p) => p.key === key);

// Routes whose handler ends the caller's own session: never probed with a persona token on the allow side.
const SESSION_ENDING = new Set(['POST /api/reports/auth/logout', 'DELETE /api/reports/sessions/:token', 'POST /api/auth/logout']);

/**
 * Invariant "route × role": for every role-guarded route of the committed matrix,
 *  - DENY side (all methods): every persona the guards refuse gets 403 — the guard answers before any handler runs;
 *  - ALLOW side (GET only, handlers are run): the narrowest persona the guards admit is NOT refused with the guard's
 *    own refusal (same 403 body as the denied persona) — a handler-level 403 for another reason is not a guard refusal.
 * opts: { methods, keys:Set, limit (stop after N violations), allowSide (default true) }
 */
async function checkRoleGuards(w, opts = {}) {
  const v = [];
  const rows = w.matrix.routes.filter((r) => r.guards.some((g) => g.roles) && (!opts.methods || opts.methods.includes(r.method)) && (!opts.keys || opts.keys.has(r.key)));
  const limit = opts.limit || Infinity;
  const denyBodies = new Map();
  const stats = { routes: rows.length, deny_probes: 0, allow_probes: 0, allow_ok: 0, capabilities: new Set(), guard_classes: new Set() };
  v.stats = stats;
  const cases = [];
  for (const r of rows) for (const p of PERSONAS) if (!expectedAllow(r, p)) cases.push([r, p]);
  await pool(cases, 8, async ([r, p]) => {
    if (v.length >= limit) return;
    const res = await w.send(r.method, concrete(r.path), w.tok[p.key]);
    stats.deny_probes++;
    for (const c of r.capabilities) stats.capabilities.add(c);
    for (const g of r.guards) stats.guard_classes.add(g.name.replace(/\(.*$/, ''));
    if (res.status !== 403) v.push(`DENY ${r.key} as ${p.key} (${p.roles.join('+')}): expected 403, got ${res.status}`);
    else if (!denyBodies.has(r.key) && !isBusinessOnly(p.roles)) denyBodies.set(r.key, res.text);
  });
  if (opts.allowSide === false) return v;
  const gets = rows.filter((r) => r.method === 'GET' && !SESSION_ENDING.has(r.key));
  await pool(gets, 6, async (r) => {
    if (v.length >= limit) return;
    const p = PERSONAS.find((x) => expectedAllow(r, x));
    const denied = denyBodies.get(r.key);
    if (!p || denied === undefined) return;
    const res = await w.send('GET', concrete(r.path), w.tok[p.key]);
    stats.allow_probes++;
    if (res.status !== 403) stats.allow_ok++;
    if (res.status === 401) v.push(`ALLOW ${r.key} as ${p.key}: session refused (401)`);
    else if (res.status === 403 && res.text === denied) v.push(`ALLOW ${r.key} as ${p.key}: refused by the role guard (${res.text.slice(0, 80)})`);
  });
  return v;
}

/** Every non-public /api route refuses a request with no session (401, or 403 from a gate). */
async function checkAnonymous(w, opts = {}) {
  const v = [];
  const rows = w.matrix.routes.filter((r) => r.gate !== 'public' && r.path.startsWith('/api'));
  await pool(rows, 8, async (r) => {
    if (opts.limit && v.length >= opts.limit) return;
    const res = await w.send(r.method, concrete(r.path), null);
    if (res.status !== 401 && res.status !== 403) v.push(`ANON ${r.key}: expected 401/403, got ${res.status}`);
  });
  return v;
}

/** Invariant 3 — métier lock: business-only accounts get 403 on EVERY route outside the Site Awareness allowlist. */
async function checkBusinessLock(w, opts = {}) {
  const v = [];
  const rows = w.matrix.routes.filter((r) => r.gate !== 'public' && r.path.startsWith('/api') && !r.business_allowed && (!opts.methods || opts.methods.includes(r.method)));
  const cases = [];
  for (const r of rows) for (const k of ['sbizA', 'gbiz']) cases.push([r, k]);
  await pool(cases, 8, async ([r, k]) => {
    if (opts.limit && v.length >= opts.limit) return;
    const res = await w.send(r.method, concrete(r.path), w.tok[k]);
    if (res.status !== 403) v.push(`METIER ${r.key} as ${k}: expected 403, got ${res.status}`);
  });
  // positive control: the one view they are given still answers
  for (const k of ['sbizA', 'gbiz']) {
    const res = await w.send('GET', '/api/site-awareness/summary', w.tok[k]);
    if (res.status !== 200) v.push(`METIER positive control: GET /api/site-awareness/summary as ${k} → ${res.status}`);
  }
  return v;
}


// ── Invariant 2 — amounts visible only to the admin tier + finance-viewer (JSON, exports, portfolio) ──────────
const MONEY_KEYS = ['purchase_cost', 'current_book_value', 'total_cost_of_ownership', 'operational_cost', 'purchase_cost_usd', 'book_value_usd', 'tco_usd'];
const BUDGET = 987654;
const MONEY_READERS = ['finA', 'admin', 'exec', 'super'];
const NON_MONEY = ['viewA', 'edA', 'trkA', 'scoreA', 'fieldA', 'edNoSite', 'committee'];
// Invariant 2 as written ("amounts visible only to the admin tier + finance-viewer") is NOT what the product does for a
// committee-member: routes/governance.js canSeeMoney = isCommittee || finance-viewer (G12, routes/governance.js:62 + :502),
// so a committee-member WITHOUT admin / finance-viewer reads portfolio amounts. Kept as an explicit expected deviation —
// policy decision pending: may committee-member see money? (PO / IAM owner). Asset money (G-11) is NOT affected.
const KNOWN_MONEY_DEVIATIONS = [
  { re: /^MONEY GET \/api\/governance\/portfolio\/project\/\d+ as committee: budget LEAKED/, reason: 'policy decision pending: may committee-member see money?' },
  { re: /^MONEY GET \/api\/governance\/portfolio as committee: budget LEAKED/, reason: 'policy decision pending: may committee-member see money?' },
  { re: /^MONEY GET \/api\/governance\/portfolio\/report\.html as committee: budget LEAKED/, reason: 'policy decision pending: may committee-member see money?' },
  { re: /^MONEY budget-periods as committee: money_hidden=false/, reason: 'policy decision pending: may committee-member see money?' },
];
function splitKnown(v, known) {
  const unexpected = [], matched = [], seen = new Set();
  for (const x of v) { const k = known.findIndex((d) => d.re.test(x)); if (k >= 0) { matched.push(x); seen.add(k); } else unexpected.push(x); }
  return { unexpected, matched, unmatchedKnown: known.filter((_, i) => !seen.has(i)) };
}

async function seedMoney(w) {
  if (w.money) return w.money;
  const adb = require('../assets-db');
  await adb.pgHandle().prepare('INSERT INTO assets (asset_id, asset_name, product_type, state, site, purchase_cost, current_book_value, total_cost_of_ownership, operational_cost) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT (asset_id) DO NOTHING')
    .run('A0-MONEY-1', 'A0 money laptop', 'Laptop', 'In Use', 'HOUNDE', '1,234,567.00', '765,432.00', '2,000,000.00', '10,000.00');
  const put = (k, b) => w.send('PUT', '/api/governance/portfolio/' + k, w.tok.admin, b);
  const prog = await put('programme', { key: 'a0-prog', name: 'A0 programme' });
  const obj = await put('objective', { programme_id: prog.json && prog.json.id, key: 'a0-obj', name: 'A0 objective' });
  const proj = await put('project', { objective_id: obj.json && obj.json.id, key: 'a0-proj', name: 'A0 money project', site_id: w.A.id, owner: 'nobody',
    start_date: '2026-01-01', end_date: '2026-12-31', status: 'active', budget: BUDGET, spent: 1000, currency: 'USD' });
  w.money = { project: proj.json && proj.json.id, setup: [prog.status, obj.status, proj.status] };
  return w.money;
}

async function checkMoneyMasking(w, opts = {}) {
  const v = [];
  const m = await seedMoney(w);
  if (!m.project) { v.push('MONEY fixture: portfolio project not created ' + JSON.stringify(m.setup)); return v; }
  const hasMoney = (rows) => (Array.isArray(rows) ? rows : []).some((r) => r && r.asset_id === 'A0-MONEY-1' && MONEY_KEYS.some((k) => r[k] != null && r[k] !== ''));
  for (const k of [...NON_MONEY, ...MONEY_READERS]) {
    if (opts.limit && v.length >= opts.limit) break;
    const reader = MONEY_READERS.includes(k);
    const inv = await w.send('GET', '/api/assets/inventory', w.tok[k]);
    if (inv.status !== 200) v.push(`MONEY GET /api/assets/inventory as ${k}: ${inv.status}`);
    else if (!(inv.json || []).some((r) => r.asset_id === 'A0-MONEY-1')) v.push(`MONEY GET /api/assets/inventory as ${k}: fixture asset not listed`);
    else if (hasMoney(inv.json) !== reader) v.push(`MONEY GET /api/assets/inventory as ${k}: amounts ${reader ? 'missing for a money reader' : 'LEAKED to a non-money account'}`);
    for (const p of ['/api/assets/export.xlsx', '/api/assets/finance/summary', '/api/assets/finance/export.xlsx', '/api/assets/investment/export.xlsx', '/api/assets/licences/export.xlsx', '/api/assets/depreciation/summary']) {
      const r = await w.send('GET', p, w.tok[k]);
      if (reader ? r.status === 403 : r.status !== 403) v.push(`MONEY GET ${p} as ${k}: ${r.status} (${reader ? 'reader refused' : 'non-reader served'})`);
    }
    for (const p of [`/api/governance/portfolio/project/${m.project}`, '/api/governance/portfolio', '/api/governance/portfolio/workbook.xlsx', '/api/governance/portfolio/report.html']) {
      const r = await w.send('GET', p, w.tok[k]);
      if (r.status !== 200) { v.push(`MONEY GET ${p} as ${k}: ${r.status}`); continue; }
      const shows = r.text.includes(String(BUDGET)) || r.text.includes('987,654') || r.text.includes('987 654');
      if (r.type.includes('spreadsheet')) continue;   // binary: content asserted in tests/portfolio-access-parity.smoke.test.js
      if (shows !== reader) v.push(`MONEY GET ${p} as ${k}: budget ${reader ? 'missing for a money reader' : 'LEAKED to a non-money account'}`);
    }
    const bp = await w.send('GET', `/api/governance/ppm/project/${m.project}/budget-periods`, w.tok[k]);
    if (bp.status !== 200 || !bp.json) v.push(`MONEY budget-periods as ${k}: ${bp.status}`);
    else if (bp.json.money_hidden !== !reader) v.push(`MONEY budget-periods as ${k}: money_hidden=${bp.json.money_hidden}`);
  }
  return v;
}

// ── Invariant 8 — presentation never grants a right: workspace profile / blocks change no allow/deny ─────────
/** The persona's decision on every role-guarded GET + money/site sample: key → 'deny' | 'allow'. */
async function decisionSnapshot(w, key, rows) {
  const snap = {};
  await pool(rows, 8, async (r) => {
    const res = await w.send('GET', concrete(r.path), w.tok[key]);
    snap[r.key] = (res.status === 401 || res.status === 403) ? 'deny' : 'allow';
  });
  return snap;
}

async function checkWorkspaceGrantsNothing(w, keys = ['viewA', 'edA', 'finA', 'admin']) {
  const v = [];
  v.stats = { personas: 0, profiles_saved: 0, routes: 0 };
  const rows = w.matrix.routes.filter((r) => r.method === 'GET' && r.gate !== 'public' && (r.guards.some((g) => g.roles) || r.money_bearing || r.site_scoped) && !SESSION_ENDING.has(r.key));
  const profiles = require('../services/workspaceProfiles');
  const all = Array.isArray(profiles.PROFILES) ? profiles.PROFILES.map((p) => p.id || p) : Object.keys(profiles.PROFILES || {});
  v.stats.routes = rows.length;
  for (const key of keys) {
    v.stats.personas++;
    const base = await decisionSnapshot(w, key, rows);
    const me = await w.send('GET', '/api/workspace/me', w.tok[key]);
    if (me.status !== 200) { v.push(`WS GET /api/workspace/me as ${key}: ${me.status}`); continue; }
    const tried = new Set([...(me.json.eligible || []), 'administrator', 'finance', 'executive'].filter((x) => all.includes(x)));
    for (const profile of tried) {
      // ineligible profiles are refused (400) — then nothing may change either
      const saved = await w.send('PUT', '/api/workspace/prefs', w.tok[key], { profile, density: 'compact' });
      if (saved.status === 200) v.stats.profiles_saved++;
      const after = await decisionSnapshot(w, key, rows);
      for (const k of Object.keys(base)) if (base[k] !== after[k]) v.push(`WS ${key} profile=${profile}: ${k} ${base[k]} → ${after[k]}`);
    }
    await w.send('DELETE', '/api/workspace/prefs', w.tok[key]);
    const roles = await w.send('GET', '/api/reports/auth/me', w.tok[key]);
    const got = ((roles.json && (roles.json.user || roles.json)) || {}).roles || [];
    if (JSON.stringify([...got].sort()) !== JSON.stringify([...personaOf(key).roles].sort())) v.push(`WS ${key}: roles changed to ${got.join(',')}`);
  }
  return v;
}

// ── Invariant 1 — site perimeter: editor = own site(s) only; admin tier = every site; no-site = nothing ───────
async function seedScope(w) {
  if (w.scope) return w.scope;
  const rdb = w.rdb;
  const rA = await rdb.ensureReport(w.A.id, 2026, 30), rB = await rdb.ensureReport(w.B.id, 2026, 30);
  await rdb.saveActionItems(rB.id, [{ task: 'A0 site-B follow-up', department: 'IT', priority: 'Medium', status: 'open' }]);
  const uidB = (await rdb.getReport(rB.id)).action_items[0].uid;
  const pv = await w.send('POST', '/api/meetings/save', w.tok.super, { state: {
    header: { site_code: 'SGO', department: 'Mining', meeting_date: '2026-09-10', status: 'draft' },
    issues: [{ ord: 1, title: 'A0 B issue', category: 'CN', severity: 'HIGH', status: 'open' }],
    actions: [{ ord: 1, description: 'A0 B action', owner_it: 'someone', status: 'open' }] } });
  const pvB = pv.json && pv.json.id ? (await w.send('GET', `/api/meetings/${pv.json.id}`, w.tok.super)).json : null;
  const ins = await w.send('POST', '/api/inspection/save', w.tok.super, { state: {
    meta: { f_site: 'Sabodala (SGO)', f_date: '2026-09-10', f_area: 'Server room' }, items: {},
    actions: [{ desc: 'A0 B corrective action', owner: 'x', due: '2026-10-01', priority: 'High' }] } });
  const insB = ins.json && ins.json.id ? (await w.send('GET', `/api/inspection/${ins.json.id}`, w.tok.super)).json : null;
  // portfolio projects on site A and site B (plan writes by an editor exist only behind portfolio_editor_plan_writes)
  const put = (k, b) => w.send('PUT', '/api/governance/portfolio/' + k, w.tok.admin, b);
  const prog = await put('programme', { key: 'a0s-prog', name: 'A0 scope programme' });
  const obj = await put('objective', { programme_id: prog.json && prog.json.id, key: 'a0s-obj', name: 'A0 scope objective' });
  const proj = async (key, site) => (await put('project', { objective_id: obj.json && obj.json.id, key, name: 'A0 ' + key, site_id: site, owner: 'nobody', start_date: '2026-01-01', end_date: '2026-12-31', status: 'active' })).json;
  const pA = await proj('a0s-pa', w.A.id), pB = await proj('a0s-pb', w.B.id);
  const flat = (o) => (o && o.header ? Object.assign({}, o.header, { actions: o.actions, issues: o.issues }) : o);
  w.scope = { rA, rB, uidB, pvB: flat(pvB), insB: flat(insB), pA: pA && pA.id, pB: pB && pB.id };
  return w.scope;
}

async function checkSitePerimeter(w, opts = {}) {
  const v = [];
  const s = await seedScope(w);
  const t = w.tok;
  const exp = async (label, method, p, tok, body, want) => {
    if (opts.limit && v.length >= opts.limit) return;
    const r = await w.send(method, p, tok, body);
    const ok = want === 'deny' ? (r.status === 403 || r.status === 404) : (r.status >= 200 && r.status < 300);
    if (!ok) v.push(`SITE ${label}: ${method} ${p} → ${r.status} (expected ${want}) ${String(r.text).slice(0, 100)}`);
  };
  if (!s.pvB || !s.insB || !s.pA || !s.pB || !(s.pvB.actions || [])[0] || !(s.pvB.issues || [])[0] || !(s.insB.actions || [])[0] || !s.pvB.id || !s.insB.id) v.push('SITE fixture incomplete ' + JSON.stringify({ pv: !!s.pvB, ins: !!s.insB, pA: s.pA, pB: s.pB }));
  // reports — writes by object site, reads by object site, site-less editor not global
  await exp('editor A writes report B', 'PUT', `/api/reports/${s.rB.id}/lights`, t.edA, [], 'deny');
  await exp('editor A writes report A (control)', 'PUT', `/api/reports/${s.rA.id}/lights`, t.edA, [], 'allow');
  await exp('site-less editor writes report A', 'PUT', `/api/reports/${s.rA.id}/lights`, t.edNoSite, [], 'deny');
  await exp('viewer A writes own report', 'PUT', `/api/reports/${s.rA.id}/lights`, t.viewA, [], 'deny');
  await exp('admin writes report B', 'PUT', `/api/reports/${s.rB.id}/lights`, t.admin, [], 'allow');
  await exp('editor A reads report B', 'GET', `/api/reports/${s.rB.id}`, t.edA, undefined, 'deny');
  await exp('site-less editor reads report A', 'GET', `/api/reports/${s.rA.id}`, t.edNoSite, undefined, 'deny');
  await exp('editor A follow-up of site B', 'POST', `/api/reports/action/${s.uidB}/status`, t.edA, { status: 'closed', note: 'x' }, 'deny');
  await exp('editor A monthly edits of site B', 'POST', `/api/reports/monthly/${w.B.id}/2026/9/edits`, t.edA, { edited_lights: [], edited_actions: [], notes: 'x', status: 'draft' }, 'deny');
  await exp('editor A objectives of site B', 'POST', `/api/reports/objectives/${w.B.id}/2026`, t.edA, [], 'deny');
  const list = await w.send('GET', '/api/reports', t.edNoSite);
  if (list.status === 200 && Array.isArray(list.json) && list.json.length) v.push(`SITE site-less editor lists ${list.json.length} report(s) (expected none)`);
  const listA = await w.send('GET', '/api/reports', t.edA);
  if (listA.status === 200 && Array.isArray(listA.json) && listA.json.some((r) => r.id === s.rB.id)) v.push('SITE editor A lists the site-B report');
  // meetings — new PV on site B, object-id writes on site-B PV / action / issue
  await exp('editor A saves a site-B PV', 'POST', '/api/meetings/save', t.edA, { state: { header: { site_code: 'SGO', department: 'IT', meeting_date: '2026-09-02' } } }, 'deny');
  await exp('site-less editor saves a PV', 'POST', '/api/meetings/save', t.edNoSite, { state: { header: { site_code: 'HGO', department: 'IT', meeting_date: '2026-09-03' } } }, 'deny');
  await exp('editor A saves a site-A PV (control)', 'POST', '/api/meetings/save', t.edA, { state: { header: { site_code: 'HGO', department: 'IT', meeting_date: '2026-09-04' } } }, 'allow');
  if (s.pvB) {
    await exp('editor A overwrites site-B PV by id', 'POST', '/api/meetings/save', t.edA, { state: { header: { id: s.pvB.id, reference: s.pvB.reference, site_code: 'HGO', department: 'Mining', meeting_date: '2026-09-10' } } }, 'deny');
    if (s.pvB.actions && s.pvB.actions[0]) await exp('editor A updates site-B meeting action', 'POST', `/api/meetings/actions/${s.pvB.actions[0].id}/update`, t.edA, { body: 'x', status_change: 'in_progress' }, 'deny');
    if (s.pvB.issues && s.pvB.issues[0]) await exp('editor A updates site-B issue', 'POST', `/api/meetings/issues/${s.pvB.issues[0].id}/update`, t.edA, { body: 'x', status_change: 'in_progress' }, 'deny');
    await exp('editor A deletes site-B PV', 'DELETE', `/api/meetings/${s.pvB.id}`, t.edA, undefined, 'deny');
  }
  // inspections
  await exp('editor A saves a site-B inspection', 'POST', '/api/inspection/save', t.edA, { state: { meta: { f_id: 'EM-IT-A0-X1', f_site: 'Sabodala (SGO)', f_date: '2026-09-11' } } }, 'deny');
  await exp('site-less editor saves an inspection', 'POST', '/api/inspection/save', t.edNoSite, { state: { meta: { f_id: 'EM-IT-A0-X2', f_site: 'MGO' } } }, 'deny');
  if (s.insB) {
    await exp('editor A overwrites site-B inspection by id', 'POST', '/api/inspection/save', t.edA, { state: { meta: { f_id: s.insB.id, f_site: 'Hounde (HGO)', f_date: '2026-09-10' } } }, 'deny');
    if (s.insB.actions && s.insB.actions[0]) await exp('editor A updates site-B inspection action', 'POST', `/api/inspection/actions/${s.insB.actions[0].id}/update`, t.edA, { status: 'Closed', body: 'x' }, 'deny');
    await exp('editor A deletes site-B inspection', 'DELETE', `/api/inspection/${encodeURIComponent(s.insB.id)}`, t.edA, undefined, 'deny');
  }
  // portfolio plan writes: switch off → only the committee writes; switch on → an editor writes only its site's plan
  const task = (pid, name) => ({ project_id: pid, name, start_date: '2026-02-01', end_date: '2026-02-10' });
  await exp('editor A plan write (switch off)', 'PUT', '/api/governance/portfolio/task', t.edA, task(s.pA, 'a0-off'), 'deny');
  await require('../services/reportConfig').setConfig(w.rdb.db, { portfolio_editor_plan_writes: '1' }, 'a0');
  await exp('editor A plan write on site-B project (switch on)', 'PUT', '/api/governance/portfolio/task', t.edA, task(s.pB, 'a0-b'), 'deny');
  await exp('editor A plan write on site-A project (switch on, control)', 'PUT', '/api/governance/portfolio/task', t.edA, task(s.pA, 'a0-a'), 'allow');
  await exp('site-less editor plan write (switch on)', 'PUT', '/api/governance/portfolio/task', t.edNoSite, task(s.pA, 'a0-n'), 'deny');
  await require('../services/reportConfig').setConfig(w.rdb.db, { portfolio_editor_plan_writes: '0' }, 'a0');
  // tracker — a tracker-editor's edit of another site's cell is not stored
  const D = (await w.send('GET', '/api/tracker/load', t.trkA)).json;
  const doc = D && D.D;
  const y = new Date().getFullYear(), cur = new Date().getMonth();
  const row = doc && doc.inputs && doc.inputs[y] && doc.inputs[y].SGO && doc.inputs[y].SGO[0];
  if (!row) v.push('SITE tracker fixture: no SGO input row for ' + y);
  else {
    const before = row[cur];
    row[cur] = (Number(before) || 0) + 7;
    await w.send('POST', '/api/tracker/save', t.trkA, { D: doc });
    const after = (await w.send('GET', '/api/tracker/load', t.super)).json.D.inputs[y].SGO[0][cur];
    if (String(after) !== String(before)) v.push(`SITE tracker: tracker-editor of HGO changed an SGO cell (${before} → ${after})`);
  }
  return v;
}

// ── Invariant 5 — frozen periods: a submitted report, closed tracker months ──────────────────────────────────
async function checkFrozen(w, opts = {}) {
  const v = [];
  const s = await seedScope(w);
  await w.rdb.updateReportStatus(s.rA.id, 'submitted', null);
  try {
    for (const [k, want] of [['edA', 403], ['admin', 403], ['exec', 403]]) {
      const r = await w.send('PUT', `/api/reports/${s.rA.id}/lights`, w.tok[k], []);
      if (r.status !== want) v.push(`FROZEN submitted report: ${k} section write → ${r.status} (expected ${want})`);
    }
    const r = await w.send('PUT', `/api/reports/${s.rA.id}/lights`, w.tok.super, []);
    if (r.status !== 200) v.push(`FROZEN submitted report: super_admin section write → ${r.status} (expected 200)`);
  } finally { await w.rdb.updateReportStatus(s.rA.id, 'draft', null); }
  if (opts.limit && v.length >= opts.limit) return v;
  // tracker: below super_admin only the current month (+ the previous one until the 5th) is editable
  const now = new Date(), y = now.getFullYear(), cur = now.getMonth(), past = cur - 2;
  if (past < 0) return v;   // January/February: the closed month sits in the previous year (rule pinned by tests/tracker-month-lock.test.js)
  const doc = (await w.send('GET', '/api/tracker/load', w.tok.trkA)).json.D;
  const row = doc.inputs && doc.inputs[y] && doc.inputs[y].HGO && doc.inputs[y].HGO[0];
  if (!row) { v.push('FROZEN tracker fixture: no HGO row'); return v; }
  const before = row[past];
  row[past] = (Number(before) || 0) + 5;
  row[cur] = (Number(row[cur]) || 0) + 1;
  const wantCur = row[cur];
  const res = await w.send('POST', '/api/tracker/save', w.tok.trkA, { D: doc });
  const stored = (await w.send('GET', '/api/tracker/load', w.tok.super)).json.D.inputs[y].HGO[0];
  if (String(stored[past]) !== String(before)) v.push(`FROZEN tracker: closed month ${past + 1} changed by a tracker-editor (${before} → ${stored[past]})`);
  if (String(stored[cur]) !== String(wantCur)) v.push(`FROZEN tracker: current month not saved (${stored[cur]} vs ${wantCur}) status ${res.status}`);
  if (!(res.json && res.json.closed_blocked > 0)) v.push('FROZEN tracker: closed_blocked not reported ' + JSON.stringify(res.json || res.status));
  return v;
}

// ── Invariant 6 — server-side timestamps: a client clock on a PV signature is never stored ──────────────────
async function checkServerTimestamps(w) {
  const v = [];
  const r = await w.send('POST', '/api/meetings/save', w.tok.edA, { state: { header: { site_code: 'HGO', department: 'Finance', meeting_date: '2026-08-05', dept_head_signed_at: '1999-01-01T00:00:00.000Z', site_it_signed_at: '1999-01-01T00:00:00.000Z' } } });
  if (r.status !== 200 || !r.json || !r.json.id) { v.push('TS save → ' + r.status + ' ' + r.text.slice(0, 120)); return v; }
  const g = await w.send('GET', `/api/meetings/${r.json.id}`, w.tok.edA);
  if (/1999-01-01/.test(g.text)) v.push('TS a client-supplied signature timestamp (1999) was stored');
  if (!/"dept_head_signed_at":"20\d\d-/.test(g.text)) v.push('TS signature not stamped by the server');
  return v;
}

module.exports = { seedScope, checkSitePerimeter, checkFrozen, checkServerTimestamps, KNOWN_MONEY_DEVIATIONS, splitKnown, MONEY_KEYS, BUDGET, seedMoney, checkMoneyMasking, decisionSnapshot, checkWorkspaceGrantsNothing, FLAG_KEEP_OFF, MATRIX_PATH, PERSONAS, BUSINESS, personaOf, expectedAllow, loadMatrix, concrete, request, pool, bootWorld,
  checkRoleGuards, checkAnonymous, checkBusinessLock, isBusinessOnly, originalHasRole };
