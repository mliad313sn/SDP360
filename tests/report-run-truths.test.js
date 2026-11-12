'use strict';
// F-DATA-04 — a generated report run reads freshness like the dashboard route and the external API:
// a stale or never-synced source keeps its number and loses its colour, and the run says so.
// Fixture only: fake registry and readers, no database.
const { test } = require('node:test');
const assert = require('node:assert');
const { generateRun, sourceStates } = require('../services/reportGenerator');
const { resolveWidgets } = require('../services/dashboardData');
const gate = require('../services/publishGate');
const pack = require('../services/reportPack');

const NOW = new Date('2026-11-12T10:00:00Z');
const METRICS = {
  'helpdesk.sla': { key: 'helpdesk.sla', name: 'SLA', module: 'helpdesk', unit: '%', window_kind: 'month', higher_is_better: true },
  'helpdesk.created': { key: 'helpdesk.created', name: 'Created', module: 'helpdesk', unit: 'count', window_kind: 'month', higher_is_better: false },
  'meetings.score': { key: 'meetings.score', name: 'Meetings', module: 'meetings', unit: '%', window_kind: 'month', higher_is_better: true },
};
const win = (label) => { const l = label || '2026-11'; const [y, m] = l.split('-').map(Number); return { label: l, from: `${l}-01`, to: new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10) }; };
const registry = {
  get: (k) => METRICS[k] || null,
  resolve: async (k, { site, window }) => {
    const w = win(window);
    if (k === 'helpdesk.sla') return { value: site === 2 ? null : 71, rag: site === 2 ? 'NA' : 'RED', window: w, as_of: NOW.toISOString(), base: site === 2 ? null : { n: 12 } };
    if (k === 'helpdesk.created') return { value: w.label === '2026-11' ? 3 : 40, rag: 'NA', window: w, as_of: NOW.toISOString() };
    return { value: 88, rag: 'GREEN', window: w, as_of: NOW.toISOString() };
  },
};
const def = { widgets: [
  { id: 'sla', type: 'kpi', metric: 'helpdesk.sla', title: 'SLA' },
  { id: 'grid', type: 'table', metric: 'helpdesk.sla', title: 'SLA per site' },
  { id: 'trend', type: 'trend', metric: 'helpdesk.created', title: 'Created', periods: 4 },
  { id: 'mtg', type: 'kpi', metric: 'meetings.score', title: 'Meetings' },
] };
const sites = [{ id: 1, name: 'Hounde' }, { id: 2, name: 'Mana' }];
const store = { createRun: async (r) => r };
const template = { key: 't', name: 'T', audience: 'executive', dashboard_key: 'd', lang: 'en', sections: ['headline', 'figures', 'analysis'] };
const STALE = async () => ({ 'zoho.requests': '2026-11-01T00:00:00Z' });   // 11 days old, limit 3 h
const FRESH = async () => ({ 'zoho.requests': '2026-11-12T09:30:00Z' });
const gen = (lastSyncOk, extra = {}) => generateRun({ template, site: sites[0], sites, window: '2026-11', dashboardDef: def, registry, deps: {}, rdb: null, store, now: NOW, lastSyncOk, policy: null, sampleSize: false, ...extra });

test('stale source: run rag = screen rag = external API rag = NA, number kept, state recorded', async () => {
  const run = await gen(STALE);
  // screen: the dashboard route's own sequence (resolveWidgets → freshness → degradeStale)
  const screen = await resolveWidgets({ def, sites, site: 1, window: '2026-11', reg: registry, dd: {}, rdb: null, now: NOW });
  const fr = gate.freshness(['helpdesk', 'meetings'], await STALE(), NOW.getTime(), null);
  gate.degradeStale(screen, def, registry, fr.sources.filter((x) => x.state !== 'FRESH'));
  // external API: routes/extApi.js tag() rule on the same module state
  const ext = { rag: 'RED' }; const st = gate.moduleFreshness('helpdesk', await STALE(), NOW.getTime(), null).state; if (st !== 'FRESH' && ext.rag !== 'NA') { ext.rag_if_fresh = ext.rag; ext.rag = 'NA'; }
  const f = run.figures.find((x) => x.id === 'sla');
  const diff = [];
  for (const [surface, got] of [['screen', screen.sla.rag], ['report run', f.rag], ['ext API', ext.rag]]) if (got !== 'NA') diff.push(`helpdesk.sla rag · ${surface} · expected NA · got ${got}`);
  assert.deepStrictEqual(diff, [], diff.join('\n'));
  assert.equal(f.value, 71, 'the number is kept'); assert.equal(f.freshness, 'STALE'); assert.equal(f.rag_if_fresh, 'RED');
  const g = run.figures.find((x) => x.id === 'grid');
  assert.ok(g.rows.every((r) => r.rag === 'NA'), 'per-site colours withdrawn'); assert.equal(g.freshness, 'STALE');
  assert.equal(run.figures.find((x) => x.id === 'mtg').rag, 'GREEN', 'a typed module is untouched');
  assert.deepEqual(run.analysis.sources, [{ module: 'helpdesk', job: 'zoho.requests', last_success: '2026-11-01T00:00:00.000Z', state: 'STALE' }]);
  assert.ok(!run.analysis.findings.some((x) => x.kind === 'red' || x.kind === 'sites_red'), 'no red finding from a stale source');
  assert.match(run.html, /colour withdrawn: source stale/);
  assert.match(run.html, /Source state: zoho\.requests STALE/);
});

test('never-synced source reads UNKNOWN (not fresh); a fresh source keeps its colours and adds nothing', async () => {
  const never = await gen(async () => ({}));
  assert.equal(never.figures.find((x) => x.id === 'sla').freshness, 'UNKNOWN');
  assert.match(never.html, /source never synced/);
  const fresh = await gen(FRESH);
  const f = fresh.figures.find((x) => x.id === 'sla');
  assert.equal(f.rag, 'RED'); assert.ok(!('freshness' in f));
  assert.ok(!/colour withdrawn|Source state/.test(fresh.html));
});

test('partial month: the trend has no direction, the pack marks the period, n follows ui_kpi_sample_size', async () => {
  const run = await gen(FRESH);
  const t = run.figures.find((x) => x.id === 'trend');
  assert.equal(t.series[t.series.length - 1].partial, true);
  assert.equal(t.trend, 'flat', '40,40,40 then a running 3 is not a fall');
  assert.ok(!run.analysis.findings.some((x) => x.kind === 'improving' || x.kind === 'worsening'));
  assert.match(run.html, /2026-11 <small>\(partial period\)<\/small>/);
  assert.equal(run.figures.find((x) => x.id === 'sla').n, 12, 'n is stored whatever the switch');
  assert.ok(!/n = 12/.test(run.html), 'switch off: n not printed');
  const on = await gen(FRESH, { sampleSize: true });
  assert.match(on.html, /n = 12/);
  const csv = pack.renderCsv(on).split('\r\n');
  assert.ok(csv[0].endsWith('as_of,partial,n,low_sample,target,freshness'), 'new columns appended, former order kept');
  assert.ok(csv.some((l) => /^single,helpdesk\.sla,.*,true,12,,,$/.test(l)), csv.join('\n'));
});

test('sourceStates never throws: an unreadable sync store reads UNKNOWN', async () => {
  const s = await sourceStates({ registry, dashboardDef: def, lastSyncOk: async () => { throw new Error('down'); }, policy: null }, NOW);
  assert.deepEqual(s.map((x) => x.state), ['UNKNOWN']);
});
