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
  const stats = { routes: rows.length, deny_probes: 0, allow_probes: 0, allow_ok: 0 };
  v.stats = stats;
  const cases = [];
  for (const r of rows) for (const p of PERSONAS) if (!expectedAllow(r, p)) cases.push([r, p]);
  await pool(cases, 8, async ([r, p]) => {
    if (v.length >= limit) return;
    const res = await w.send(r.method, concrete(r.path), w.tok[p.key]);
    stats.deny_probes++;
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

module.exports = { KNOWN_MONEY_DEVIATIONS, splitKnown, MONEY_KEYS, BUDGET, seedMoney, checkMoneyMasking, decisionSnapshot, checkWorkspaceGrantsNothing, FLAG_KEEP_OFF, MATRIX_PATH, PERSONAS, BUSINESS, personaOf, expectedAllow, loadMatrix, concrete, request, pool, bootWorld,
  checkRoleGuards, checkAnonymous, checkBusinessLock, isBusinessOnly, originalHasRole };
