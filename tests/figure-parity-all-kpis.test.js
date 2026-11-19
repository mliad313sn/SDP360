'use strict';
// P08 §3 — the five-surface parity of tests/figure-parity-five-surfaces.test.js, extended to EVERY published
// KPI of the dictionary (services/metricRegistry.js) and to the report outputs: page payload, dashboard CSV,
// metric API, external API, report run → e-mail/page HTML, report CSV, report XLSX rows, report PPTX.
// The REAL routers, registry, resolver, report generator and renderers; only the READERS are a labelled
// FIXTURE (fictitious records, one per reader, every published field given a distinct value) — no production
// data. A second fictitious site where every reader returns nothing must be empty on every surface (never 0).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const express = require('express');
const JSZip = require('jszip');
const fetch = require('./_http-fetch');
const MR = require('../services/metricRegistry');
const { generateRun } = require('../services/reportGenerator');
const pack = require('../services/reportPack');

const registry = MR.createRegistry();
const METRICS = registry.list({ status: 'published' });
const SITES = [{ id: 1, name: 'Fixture North', active: 1 }, { id: 2, name: 'Fixture Unmeasured', active: 1 }];

// FIXTURE — one record per reader; each published field gets a distinct, recognisable value
const RECORDS = {};
METRICS.forEach((m, i) => {
  const v = m.unit === '%' ? 40 + i + 0.5 : m.unit === 'hours' || m.unit === 'ms' || m.unit === 'days' ? 3 + i + 0.25 : 2 + i;
  (RECORDS[m.reader] = RECORDS[m.reader] || {})[m.field] = v;
});
const saved = {};
const NOW = new Date();
const allFresh = async () => Object.fromEntries(['zoho.requests', 'zoho.change_cab', 'zoho.survey', 'assets.sync', 'meraki.wan', 'opmanager.availability'].map((j) => [j, NOW.toISOString()]));
const DEF = { key: 'fxall', title: 'FIXTURE — every published KPI', audience: 'site', widgets: METRICS.map((m, i) => ({ id: 'w' + i, type: 'kpi', metric: m.key, title: 'FX ' + m.key })) };
const user = { id: 7, username: 'fx_admin', role: 'admin', roles: ['admin'] };
const rdb = { db: null, listSites: async () => SITES, userHasRole: (u, r) => (u.roles || []).includes(r) || (r !== 'super_admin' && (u.roles || []).includes('admin')), pgHandle: () => { throw new Error('fixture: no database'); }, _logCtx: () => ({}), logEvent: () => {} };
const session = (req, res, next) => { req.reportUser = user; next(); };
const dashStore = { get: async (k) => (k === 'fxall' ? { key: 'fxall', version: 1, status: 'published', site_id: null, definition: DEF } : null), published: async (k) => (k === 'fxall' ? { key: 'fxall', version: 1, definition: DEF } : null) };
const extStore = { authenticate: async () => ({ consumer: { id: 1, scopes: ['values:read', 'metrics:read'] }, quota_left: 100000 }), logCall: async () => {} };
const readerDeps = {};

let server, base;
before(async () => {
  for (const id of Object.keys(MR.READERS)) { saved[id] = MR.READERS[id]; MR.READERS[id] = async (d, { site }) => (Number(site) === 1 || /\.fleet$/.test(id) ? { ...(RECORDS[id] || {}) } : null); }   // a fleet reader ignores the site
  const app = express();
  app.use(require('../routes/dashboards')({ express, requireReportSession: session, store: dashStore, rdb, registry, readerDeps, lastSyncOk: allFresh }));
  app.use(require('../routes/metrics')({ express, requireReportSession: session, rdb, registry, readerDeps, lastSyncOk: allFresh, targetStore: { list: async () => [] } }));
  app.use(require('../routes/extApi')({ express, store: extStore, rdb, registry, readerDeps, lastSyncOk: allFresh, reportConfig: { getConfig: async () => ({}) }, ratePerMinute: 100000 }));
  await new Promise((r) => { server = http.createServer(app).listen(0, '127.0.0.1', r); });
  base = 'http://127.0.0.1:' + server.address().port;
});
after(() => { for (const id of Object.keys(saved)) MR.READERS[id] = saved[id]; if (server) server.close(); });

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
const fmt = (v, u) => (v == null ? '—' : u === '%' ? `${Math.round(Number(v) * 10) / 10} %` : String(Math.round(Number(v) * 100) / 100));
const pptxText = async (buf) => { const z = await JSZip.loadAsync(buf); let t = ''; for (const n of Object.keys(z.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f))) t += (await z.file(n).async('string')).replace(/<[^>]+>/g, ' '); return t.replace(/&amp;/g, '&').replace(/\s+/g, ' '); };

async function surfacesForSite(siteId) {
  const site = SITES.find((s) => s.id === siteId);
  const q = `site=${siteId}`;
  const data = await (await fetch(`${base}/api/dashboards/fxall/data?${q}`)).json();
  const csv = parseCsv(await (await fetch(`${base}/api/dashboards/fxall/data.csv?${q}`)).text());
  const ext = [];
  for (let i = 0; i < METRICS.length; i += 20) ext.push(...(await (await fetch(`${base}/ext/v1/values?metrics=${METRICS.slice(i, i + 20).map((m) => m.key).join(',')}&${q}`, { headers: { 'x-api-key': 'fixture' } })).json()).values);   // the external API takes 20 metrics per call
  const run = await generateRun({ template: { key: 't', name: 'FX all', audience: 'site', dashboard_key: 'fxall', lang: 'en', sections: ['figures'] }, site, sites: SITES, window: null, dashboardDef: DEF, registry, deps: readerDeps, rdb: null, store: { createRun: async (r) => r }, now: new Date(), lastSyncOk: allFresh, sampleSize: false });
  const html = pack.renderHtml({ template: { name: 'FX all', lang: 'en', dashboard_key: 'fxall', sections: ['figures'] }, run, siteName: site.name });
  const rcsv = parseCsv(pack.renderCsv(run));
  const xlsx = pack.figureRows(run);
  const pptx = await pptxText(await pack.renderPptx({ template: { name: 'FX all', lang: 'en' }, run, siteName: site.name }));
  const diffs = []; const values = {};
  for (const [i, m] of METRICS.entries()) {
    const api = await (await fetch(`${base}/api/metrics/${m.key}?${q}`)).json();
    values[m.key] = api.value;
    const exp = { value: cell(api.value), rag: api.rag };
    const got = {
      'page payload': { value: cell(data.widgets['w' + i].value), rag: data.widgets['w' + i].rag },
      'dashboard csv': (() => { const r = csv.find((x) => x.metric === m.key); return r ? { value: r.value, rag: r.rag } : { value: 'MISSING' }; })(),
      'ext api': (() => { const r = ext.find((x) => x.metric === m.key || x.key === m.key); return r ? { value: cell(r.value), rag: r.rag } : { value: 'MISSING' }; })(),
      'report run': (() => { const f = run.figures.find((x) => x.metric === m.key); return f ? { value: cell(f.value), rag: f.rag } : { value: 'MISSING' }; })(),
      'report csv': (() => { const r = rcsv.find((x) => x.kind === 'single' && x.metric === m.key); return r ? { value: r.value, rag: r.rag } : { value: 'MISSING' }; })(),
      'report xlsx': (() => { const r = xlsx.find((x) => x.kind === 'single' && x.metric === m.key); return r ? { value: cell(r.value), rag: r.rag } : { value: 'MISSING' }; })(),
    };
    for (const [s, g] of Object.entries(got)) for (const k of Object.keys(exp)) if (k in g && String(g[k]) !== String(exp[k])) diffs.push(`${m.key} ${k} · ${s} · expected ${exp[k]} · got ${g[k]}`);
    // e-mail/page HTML and PPTX print the formatted figure next to its title
    const shown = fmt(api.value, m.unit);
    const tile = (html.split('FX ' + m.key)[0] || '').slice(-400);
    if (!tile.includes(`<div class="tn">${shown}</div>`)) diffs.push(`${m.key} value · e-mail/page html · expected ${shown}`);
    if (!pptx.includes(`${shown} FX ${m.key}`)) diffs.push(`${m.key} value · pptx · expected "${shown} FX ${m.key}"`);
  }
  return { diffs, values };
}

test('every published KPI shows the same value and colour on all surfaces (measured site)', async () => {
  assert.ok(METRICS.length >= 40, 'the whole published dictionary is covered: ' + METRICS.length);
  const { diffs, values } = await surfacesForSite(1);
  assert.deepEqual(diffs, [], 'metric · attribute · surface · expected · got\n' + diffs.join('\n'));
  // the fixture value reached every metric (a reader that dropped it would make the comparison vacuous)
  const lost = METRICS.filter((m) => values[m.key] !== RECORDS[m.reader][m.field]).map((m) => `${m.key}: ${values[m.key]} ≠ ${RECORDS[m.reader][m.field]}`);
  assert.deepEqual(lost, []);
});

test('a site where nothing is measured: every KPI empty ("—") on every surface — never 0, never a colour', async () => {
  const { diffs, values } = await surfacesForSite(2);
  assert.deepEqual(diffs, [], diffs.join('\n'));
  const notNull = METRICS.filter((m) => !/\.fleet$/.test(m.reader) && values[m.key] != null).map((m) => m.key);
  assert.deepEqual(notNull, [], 'a site-level KPI with no record must be null');
});
