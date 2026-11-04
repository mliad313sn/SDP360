'use strict';
// C-11 (G19) — Helpdesk category Pareto + resolution-SLA ranking.
// The two views read the same period rows as the tiles, so their totals must
// reconcile with the tile code itself (pStats, extracted from index.html).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { fnSource } = require('./_fn-source');

const ROOT = path.join(__dirname, '..');
const SHARED = fs.readFileSync(path.join(ROOT, 'public', 'lib', 'dashboard-shared.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

function load(extra = '') {
  const ctx = { window: {}, console };
  vm.runInNewContext(SHARED + '\n' + extra, ctx);
  return ctx;
}

// Fixture: 3 sites, 13 categories, cancelled + open + empty-category tickets.
function fixture() {
  const rows = [];
  let id = 0;
  const add = (site, cat, { closed = true, late = false, status, group = 'G1' } = {}) => rows.push({
    'Request Display ID': String(++id), 'Request ID': String(1000 + id),
    Site: site, Group: group, Category: cat,
    'Request Status': status || (closed ? 'Closed' : 'Open'),
    'Request Pending Status': closed ? 'No' : 'Yes',
    'Overdue Status': late ? '1' : '0',
    'Created Time': '03 Aug 2026 09:00 AM',
  });
  for (let i = 0; i < 14; i++) add('HOUNDE', 'Network', { late: i < 4 });        // 14 closed, 4 late → 71.4
  for (let i = 0; i < 12; i++) add('MANA', 'Email', { late: i < 1 });            // 12 closed, 1 late → 91.7
  for (let i = 0; i < 3; i++) add('ITY', 'Printer', { late: i < 2 });            // 3 closed → low sample
  add('MANA', 'Email', { closed: false, late: true });                            // open: not in SLA denominator
  add('HOUNDE', 'Network', { status: 'Cancelled', late: true });                  // cancelled closed (tile rule)
  add('', '', {});                                                                 // no site, no category
  add('ITY', '-No Value-', {});
  for (let c = 0; c < 9; c++) add('ITY', 'Cat' + c, { closed: false });           // 9 one-ticket categories
  return rows;
}

test('paretoRows: sorted desc, explicit Other with its full total, Σ = total, cumulative ends at 100', () => {
  const { window: w } = load();
  const rows = fixture();
  const P = w.paretoRows(rows, w.helpdeskCategoryKey, { top: 5 });
  assert.equal(P.total, rows.length);
  assert.equal(P.rows.reduce((s, o) => s + o.n, 0), rows.length, 'no ticket silently dropped');
  const head = P.rows.filter(o => !o.other);
  for (let i = 1; i < head.length; i++) assert.ok(head[i - 1].n >= head[i].n, 'sorted descending');
  const other = P.rows.find(o => o.other);
  assert.ok(other, 'Other bucket present');
  assert.equal(other.label, `Other (${P.categories - 5})`);
  assert.equal(other.keys.length, P.categories - 5);
  assert.equal(P.rows[P.rows.length - 1].cum_pct, 100);
  assert.ok(P.rows.some(o => o.key === '(No category)'), "empty and '-No Value-' are kept, not dropped");
  assert.equal(P.rows[0].key, 'Network');
});

test('paretoRows: no Other when everything fits, never an Other of one key, empty input → null %', () => {
  const { window: w } = load();
  const rows = fixture();
  const all = w.paretoRows(rows, w.helpdeskCategoryKey, { top: 50 });
  assert.ok(!all.rows.some(o => o.other));
  const P = w.paretoRows(rows, w.helpdeskCategoryKey, { top: all.categories - 1 });
  assert.ok(!P.rows.some(o => o.other), 'an Other holding a single category would hide its name');
  const e = w.paretoRows([], w.helpdeskCategoryKey);
  assert.equal(e.total, 0); assert.equal(e.rows.length, 0);
});

test('slaRanking: worst first, n shown, low sample unranked, Σ closed = total', () => {
  const { window: w } = load();
  const R = w.slaRanking(fixture(), w.helpdeskSiteKey, { minN: w.MIN_SLA_RANK_N });
  assert.equal(w.MIN_SLA_RANK_N, 10);
  assert.deepEqual(JSON.parse(JSON.stringify(R.ranked.map(e => [e.rank, e.key, e.closed, e.violated, e.pct]))),
    [[1, 'HOUNDE', 15, 4, 73.3], [2, 'MANA', 12, 1, 91.7]]);
  assert.ok(R.low_sample.every(e => e.rank === null && e.low_sample && e.closed < 10));
  assert.ok(R.low_sample.some(e => e.key === 'ITY'));
  assert.ok(R.low_sample.some(e => e.key === '(Not set)'));
  const sum = [...R.ranked, ...R.low_sample].reduce((s, e) => s + e.closed, 0);
  assert.equal(sum, R.total.closed);
  const g = w.slaRanking(fixture(), w.helpdeskGroupKey);
  assert.equal(g.total.closed, R.total.closed, 'site and group splits share one total');
});

test('reconciles with the Helpdesk tiles: Pareto total = Inbound, ranking total = Resolution SLA % tile', () => {
  const rows = fixture();
  // Run the tile code itself (pStats from index.html) on the same rows.
  const ctx = load(fnSource(INDEX, 'pStats') + '\n;this.__pStats = pStats;');
  ctx.getPRows = () => rows;
  const tile = ctx.__pStats('P');
  const w = ctx.window;
  const P = w.paretoRows(rows, w.helpdeskCategoryKey);
  const R = w.slaRanking(rows, w.helpdeskSiteKey);
  assert.equal(P.total, tile.n, 'Pareto total = Inbound tile');
  assert.equal(R.total.closed, tile.closed, 'ranking denominator = Closed tile');
  assert.equal(R.total.pct, tile.slaPct, 'all-sites figure = Resolution SLA % tile');
});

test('index.html wires both views into renderAll and drills through the shared modal', () => {
  const all = fnSource(INDEX, 'renderAll');
  assert.match(all, /renderPareto\(\);/);
  assert.match(all, /renderSlaRanking\(\);/);
  for (const fn of ['openParetoDrill', 'openSlaRankDrill']) {
    const src = fnSource(INDEX, fn);
    assert.match(src, /_openTicketDrillModal\(/, fn + ' uses the existing drill modal');
    assert.match(src, /rowsForKeys\(/, fn + ' filters on the clicked key');
  }
  assert.match(fnSource(INDEX, 'renderPareto'), /getPRows\(REF_P\)/);
  assert.match(fnSource(INDEX, 'renderSlaRanking'), /getPRows\(REF_P\)/);
  assert.match(fnSource(INDEX, 'renderPareto'), /TrendPanel\.render\('cPareto'/, 'percent on its own panel (A-22)');
  assert.match(INDEX, /id="cPareto"/);
  assert.match(INDEX, /id="slaRankBody"/);
});
