'use strict';
// Adoption Lot A — "say the truth": items 1 (never synced = "—", neutral), 5 (site-less account: "no site in your
// scope", no create/import buttons) and 7 / 18 (wording). Static + pure checks; the browser journeys are in the
// evidence file docs/agent-execution/ADOPTION-LOT-A.md.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = (f) => fs.readFileSync(path.join(__dirname, '..', f), 'utf8').replace(/\r\n/g, '\n');
const SS = require('../public/lib/siteScope');
const HIER = ['viewer', 'editor', 'admin', 'executive', 'super_admin'];
const has = (roles) => (r) => roles.includes(r) || (HIER.includes(r) && roles.some((x) => HIER.indexOf(x) >= HIER.indexOf(r)));

test('item 5: SiteScope — a site-less, non-admin account has no scope and cannot write; never a widening', () => {
  assert.deepStrictEqual(SS.of({ roles: ['audit-viewer'], site_id: null }, has(['audit-viewer'])), { adminTier: false, sites: [], none: true, canWrite: false });
  assert.deepStrictEqual(SS.of({ site_id: null }, has(['editor'])).canWrite, false, 'site-less editor writes nothing server-side');
  assert.strictEqual(SS.of({ site_ids: [3, 4] }, has(['editor'])).canWrite, true);
  assert.strictEqual(SS.of({ site_id: 3 }, has(['viewer'])).canWrite, false);
  const adm = SS.of({}, has(['admin']));
  assert.strictEqual(adm.none, false); assert.strictEqual(adm.canWrite, true);
});

test('item 5: meetings + inspections say "No site in your scope" (not 0) and hide create / import for read-only accounts', () => {
  for (const f of ['public/meetings.html', 'public/inspections.html']) {
    const src = read(f);
    assert.match(src, /src="lib\/siteScope\.js"/, f);
    assert.match(src, /No site in your scope/, f);
    assert.match(src, /SCOPE\.canWrite/, f);
  }
  assert.match(read('public/meetings.html'), /\['mdNewBtn', 'mdImportBtn'\]/);
  assert.match(read('public/inspections.html'), /renderKpis\(null\)/, 'a failed read is "not measured", never 0');
  assert.doesNotMatch(read('public/inspections.html'), /renderKpis\(\{\}\)/);
});

test('item 1: assets — never-synced register masks every count / money tile with "—" (no green 0)', () => {
  const src = read('public/assets.html');
  assert.match(src, /_neverSynced = !!s && !s\.last_sync/);
  assert.match(src, /function maskNeverSynced\(tab\)/);
  assert.match(src, /el\.textContent = '—'; el\.classList\.remove\('usd'\)/, 'the green "usd" class is withdrawn');
  assert.match(src, /maskNeverSynced\(tab\);\n  \}/, 'applied after every tab render');
  assert.match(src, /amounts: admin tier and finance readers only/);
});

test('item 1: a KPI tile whose source never synced shows "—", not its 0', () => {
  const ctx = { window: {} }; ctx.self = ctx.window;
  vm.runInNewContext(read('public/lib/stateBadge.js'), ctx);
  vm.runInNewContext(read('public/lib/dashboardRender.js'), ctx);
  vm.runInNewContext(read('public/lib/kpiCard.js'), ctx);
  const K = ctx.window.KpiCard || ctx.KpiCard;
  assert.ok(K && K.kpiCard, 'kpiCard exported');
  const never = K.kpiCard({ label: 'Major incidents', value: 0, unit: 'count', freshness: 'UNKNOWN' });
  assert.doesNotMatch(never, /edv-kpi-value">[^<]*0</);
  assert.match(never, /never synced/i);
  const stale = K.kpiCard({ label: 'Major incidents', value: 3, unit: 'count', freshness: 'STALE' });
  assert.match(stale, />3</, 'a STALE source keeps its last number (greyed)');
});

test('items 7 + 18: "Votre avis" (not "Retour"), business chip "Métier", business may read Help', () => {
  const shell = read('public/_shell.js');
  assert.match(shell, /'Feedback': 'Votre avis'/);
  assert.doesNotMatch(shell, /'Feedback': 'Retour'/);
  assert.match(shell, /'Business': 'Métier'/);
  assert.match(shell, /roles:\s+\['any', 'site-business', 'group-business'\],\n\s+title:\s+'User manual'/);
  assert.match(read('public/auth.js'), /_page !== 'help\.html'/);
  assert.match(read('public/lib/feedback.js'), /title: 'Votre avis sur cette page'/);
});

test('item 17: page-view telemetry is open to business-only accounts (writes the caller\'s page_viewed row, returns nothing)', () => {
  const g = require('../services/businessGuard');
  assert.ok(g.isAllowed('/ux/page-view'));
  assert.ok(!g.isAllowed('/ux/page-usage'), 'the usage READ stays super_admin, closed to business');
  assert.ok(!g.isAllowed('/ux/event'));
});

test('item 1: Helpdesk without a single synced ticket shows "—" on every tile, never a quiet-week 0', () => {
  const src = read('public/index.html');
  assert.match(src, /if\(!RAW\.length&&!window\.__dataTs\)\{/);
  assert.match(src, /Source never synced — not measured/);
});
