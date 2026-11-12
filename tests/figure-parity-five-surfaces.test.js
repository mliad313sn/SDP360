'use strict';
// F-DATA-05 (E08 core) — ONE fixture selection, FIVE surfaces, one diff table.
//   1. dashboard viewer payload      GET /api/dashboards/:key/data
//   2. dashboard CSV                 GET /api/dashboards/:key/data.csv
//   3. metric API                    GET /api/metrics/:key
//   4. external API                  GET /ext/v1/values
//   5. report run (+ its CSV)        services/reportGenerator.generateRun → services/reportPack.renderCsv
// The REAL routers, the REAL registry and resolver; only the readers, the stores and the sync times are a
// labelled FIXTURE (fictitious sites and figures — no production data). The selection covers: a measured site,
// a site that is not measured (null, never 0), a running (partial) month, a complete month, a STALE source and
// a metric typed into the application (no sync job). A mismatch fails with a table: figure · surface · expected · got.
// The Group IT deck is another pipeline (browser payload → reportPayload → render.py): its parity is
// tests/report-figures-parity.test.js (B) and its null rule tests/exec-payload-null.test.js (F-DATA-06).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const fetch = require('./_http-fetch');
const MR = require('../services/metricRegistry');
const { generateRun } = require('../services/reportGenerator');
const pack = require('../services/reportPack');

const NOW = new Date();
const ym = (d) => d.toISOString().slice(0, 7);
const CUR = ym(NOW);                                                         // running month → partial
const PREV = ym(new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth() - 1, 1)));   // complete month
const SITES = [{ id: 1, name: 'Fixture North', active: 1 }, { id: 2, name: 'Fixture Unmeasured', active: 1 }];
// FIXTURE figures — resolution SLA % of Fixture North; Fixture Unmeasured has no helpdesk group (reader → null)
const SLA = { [CUR]: 71.4, [PREV]: 93.2 };
const KEYS = ['helpdesk.resolution_sla_pct', 'inspection.overdue_actions'];   // the two F-DATA-11 candidates
const readerDeps = {
  rdb: { getCalendarMonthlyHelpdesk: async (site, y, m) => (Number(site) === 1 ? { inbound: 40, closed: 35, close_pct: 87.5, sla_res_pct: SLA[`${y}-${String(m).padStart(2, '0')}`] ?? null, sla_reply_pct: null } : null) },
  codeFor: async (site) => (Number(site) === 1 ? { inspection_code: 'FXN', meetings_code: 'FXN' } : {}),
  idb: { aggregate: async () => ({ counts: { total: 2, critical_count: 0 }, findingStatus: [{ status: 'ok', n: 9 }, { status: 'minor', n: 1 }], open_actions: 5, overdue_actions: 3 }) },
};
const DEF = { key: 'fx', title: 'FIXTURE — five surfaces', audience: 'site', widgets: [
  { id: 'sla', type: 'kpi', metric: KEYS[0], title: 'Resolution SLA' },
  { id: 'grid', type: 'table', metric: KEYS[0], title: 'SLA by site' },
  { id: 'insp', type: 'kpi', metric: KEYS[1], title: 'Overdue corrective actions' },
] };
// helpdesk source last synced 10 days ago (limit 3 h) → STALE
const lastSyncOk = async () => ({ 'zoho.requests': new Date(NOW.getTime() - 10 * 864e5).toISOString() });
const registry = MR.createRegistry();
const user = { id: 7, username: 'fx_admin', role: 'admin', roles: ['admin'] };
const rdb = { db: null, listSites: async () => SITES, userHasRole: (u, r) => (u.roles || []).includes(r) || (r !== 'super_admin' && (u.roles || []).includes('admin')), pgHandle: () => { throw new Error('fixture: no database'); }, _logCtx: () => ({}), logEvent: () => {} };
const session = (req, res, next) => { req.reportUser = user; next(); };
const dashStore = { get: async (k) => (k === 'fx' ? { key: 'fx', version: 1, status: 'published', site_id: null, definition: DEF } : null), published: async (k) => (k === 'fx' ? { key: 'fx', version: 1, definition: DEF } : null) };
const extStore = { authenticate: async () => ({ consumer: { id: 1, scopes: ['values:read', 'metrics:read'] }, quota_left: 100 }), logCall: async () => {} };

let server, base;
before(async () => {
  const app = express();
  app.use(require('../routes/dashboards')({ express, requireReportSession: session, store: dashStore, rdb, registry, readerDeps, lastSyncOk }));
  app.use(require('../routes/metrics')({ express, requireReportSession: session, rdb, registry, readerDeps, lastSyncOk, targetStore: { list: async () => [] } }));
  app.use(require('../routes/extApi')({ express, store: extStore, rdb, registry, readerDeps, lastSyncOk, reportConfig: { getConfig: async () => ({}) }, ratePerMinute: 1000 }));
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => server && server.close());

function parseCsv(text) {
  const out = []; let row = [], cell = '', q = false;
  for (const c of text.replace(/^﻿/, '')) {
    if (q) { if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n') { row.push(cell.replace(/\r$/, '')); out.push(row); row = []; cell = ''; } else cell += c;
  }
  const head = out.shift();
  return out.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
const cell = (v) => (v == null ? '' : String(v));

/** One selection → { surface: {value, window, rag, freshness, partial} } for a metric at a site. */
async function surfaces(metric, siteId, window) {
  const site = SITES.find((s) => s.id === siteId);
  const q = `site=${siteId}${window ? '&window=' + window : ''}`;
  const wid = metric === KEYS[0] ? 'sla' : 'insp';
  const out = {};
  const data = await (await fetch(`${base}/api/dashboards/fx/data?${q}`)).json();
  const w = data.widgets[wid];
  out['1 viewer'] = { value: cell(w.value), window: w.window.label, rag: w.rag, freshness: w.freshness || 'FRESH', partial: !!w.partial };
  const csv = parseCsv(await (await fetch(`${base}/api/dashboards/fx/data.csv?${q}`)).text());
  const c = csv.find((r) => r.widget === w.title && r.metric === metric);
  out['2 dashboard csv'] = { value: c.value, window: c.window, rag: c.rag, freshness: c.freshness, partial: c.partial === 'true' };
  const m = await (await fetch(`${base}/api/metrics/${metric}?${q}`)).json();
  out['3 metric api'] = { value: cell(m.value), window: m.window.label, rag: m.rag, freshness: m.freshness, partial: !!m.partial };
  const x = (await (await fetch(`${base}/ext/v1/values?metrics=${metric}&${q}`, { headers: { 'x-api-key': 'fixture' } })).json()).values[0];
  out['4 ext api'] = { value: cell(x.value), window: x.window, rag: x.rag, freshness: x.freshness };
  const run = await generateRun({ template: { key: 't', name: 'T', audience: 'site', dashboard_key: 'fx', lang: 'en', sections: ['figures'] }, site, sites: SITES, window: window || null, dashboardDef: DEF, registry, deps: readerDeps, rdb: null, store: { createRun: async (r) => r }, now: new Date(), lastSyncOk, sampleSize: false });
  const f = run.figures.find((g) => g.id === wid);
  out['5 report run'] = { value: cell(f.value), window: f.window, rag: f.rag, freshness: f.freshness || 'FRESH', partial: !!f.partial };
  const rc = parseCsv(pack.renderCsv(run)).find((r) => r.kind === 'single' && r.metric === metric);
  out['5 report csv'] = { value: rc.value, window: rc.window, rag: rc.rag, freshness: rc.freshness || 'FRESH', partial: rc.partial === 'true' };
  return out;
}
function diffTable(figure, expected, got) {
  const lines = [];
  for (const [surface, g] of Object.entries(got)) for (const k of Object.keys(expected)) {
    if (!(k in g)) continue;   // a surface that does not carry the attribute (ext API: partial) is not compared on it
    if (String(g[k]) !== String(expected[k])) lines.push(`${figure} ${k} · ${surface} · expected ${expected[k]} · got ${g[k]}`);
  }
  return lines;
}
const check = async (figure, metric, site, window, expected) => { const d = diffTable(figure, expected, await surfaces(metric, site, window)); assert.deepEqual(d, [], 'figure · surface · expected · got\n' + d.join('\n')); };

test('measured site, complete month, STALE source: same number, same period, colour withdrawn on all five', async () => {
  await check('sla North ' + PREV, KEYS[0], 1, PREV, { value: '93.2', window: PREV, rag: 'NA', freshness: 'STALE', partial: false });
});

test('running month: every surface that carries the flag says partial', async () => {
  await check('sla North ' + CUR, KEYS[0], 1, CUR, { value: '71.4', window: CUR, rag: 'NA', freshness: 'STALE', partial: true });
});

test('site not measured: empty on all five — never 0, never a colour', async () => {
  await check('sla Unmeasured ' + PREV, KEYS[0], 2, PREV, { value: '', window: PREV, rag: 'NA' });
});

test('metric typed into the application (no sync job): same count everywhere; the CSV says NO_SYNC_JOB, never a literal FRESH', async () => {
  const s = await surfaces(KEYS[1], 1, null);
  const d = diffTable('inspection overdue North', { value: '3', rag: 'NA' }, s);
  assert.deepEqual(d, [], d.join('\n'));
  assert.equal(new Set(Object.values(s).map((x) => x.window)).size, 1, 'one window label: ' + JSON.stringify(Object.values(s).map((x) => x.window)));
  assert.equal(s['2 dashboard csv'].freshness, 'NO_SYNC_JOB');
  assert.equal(s['3 metric api'].freshness, 'NO_SYNC_JOB');
});

test('dashboard CSV: per-site rows carry the window; appended columns keep the former nine in place', async () => {
  const text = await (await fetch(`${base}/api/dashboards/fx/data.csv?site=1&window=${PREV}`)).text();
  assert.ok(text.replace(/^﻿/, '').startsWith('widget,metric,site,window,value,unit,rag,freshness,as_of,partial,n,target,low_sample,error\r\n'));
  const grid = parseCsv(text).filter((r) => r.widget === 'SLA by site');
  assert.equal(grid.length, 2);
  for (const r of grid) { assert.equal(r.window, PREV, 'per-site window label'); assert.equal(r.freshness, 'STALE'); assert.equal(r.rag, 'NA'); }
  assert.equal(grid.find((r) => r.site === 'Fixture Unmeasured').value, '', 'null stays empty');
});
