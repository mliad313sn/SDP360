'use strict';
// C-30 — PO decisions P7 + P8.
//  P7: a site spelled several ways ('HOUNDE' / 'Hounde Mine' / 'Houndé', 'Dakar' / 'Dakar Office',
//      'LONDON' / 'London') is ONE row in the helpdesk SLA ranking and in the asset effort board,
//      folded through the existing site-alias table, counts summed then the ratio recomputed.
//  P8: the Resolution SLA % tile, the ranking and the trend chart read ONE helper with ONE
//      definition (helpdesk_sla_definition vocabulary) — same denominator, same cancelled handling.
// Top-level async setup, run IN ORDER before the first test (PostgreSQL-only conversion, PO-08).
const __bootChain = (() => { let p = Promise.resolve(), hooked = false;
  return (fn) => { p = p.then(fn); if (!hooked) { hooked = true; require('node:test').beforeEach(() => p); } }; })();
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { fnSource } = require('./_fn-source');

const ROOT = path.join(__dirname, '..');
const SHARED = fs.readFileSync(path.join(ROOT, 'public', 'lib', 'dashboard-shared.js'), 'utf8');
const ALIASES_SRC = fs.readFileSync(path.join(ROOT, 'public', 'lib', 'siteAliases.js'), 'utf8');
const INDEX = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8').replace(/\r\n/g, '\n');

// The page loads siteAliases.js then dashboard-shared.js; reproduce that order.
function load(extra = '') {
  const ctx = { window: {}, console };
  vm.runInNewContext(ALIASES_SRC + '\n' + SHARED + '\n' + extra, ctx);
  return ctx;
}

let id = 0;
function t(site, { closed = true, late = false, status, flag, resolved, due } = {}) {
  return {
    'Request Display ID': String(++id), Site: site, Group: 'G', Category: 'C',
    'Request Status': status || (closed ? 'Closed' : 'Open'),
    'Request Pending Status': closed ? 'No' : 'Yes',
    'Overdue Status': flag != null ? flag : (late ? '1' : '0'),
    'Due By Time': due || '', 'Resolved Time': resolved || '',
    'Created Time': '03 Aug 2026 09:00 AM',
  };
}

// ── P7: helpdesk ranking ──────────────────────────────────────────────────────
test('P7: spelling variants of one site fold into ONE ranking row, counts summed, % recomputed', () => {
  const w = load().window;
  const rows = [];
  for (let i = 0; i < 6; i++) rows.push(t('HOUNDE', { late: i < 1 }));       // 6 closed, 1 late
  for (let i = 0; i < 4; i++) rows.push(t('Hounde Mine', { late: i < 3 }));  // 4 closed, 3 late
  rows.push(t('Houndé', {}));                                                // 1 closed
  for (let i = 0; i < 7; i++) rows.push(t('Dakar', {}));
  for (let i = 0; i < 5; i++) rows.push(t('Dakar Office', { late: true }));
  for (let i = 0; i < 3; i++) rows.push(t('LONDON', {}));
  for (let i = 0; i < 2; i++) rows.push(t('London', {}));
  rows.push(t('', {}));
  const R = w.slaRanking(rows, w.helpdeskSiteFoldKey, { minN: w.MIN_SLA_RANK_N, labelFn: w.helpdeskSiteKey });
  assert.equal(w.MIN_SLA_RANK_N, 10, 'P6 threshold unchanged');
  const all = [...R.ranked, ...R.low_sample];
  const hgo = all.filter(e => e.variants.some(v => /^houn/i.test(v)));
  assert.equal(hgo.length, 1, 'HOUNDE / Hounde Mine / Houndé are one row');
  assert.equal(hgo[0].key, 'HGO');
  assert.equal(hgo[0].label, 'HOUNDE', 'the most frequent spelling is shown');
  assert.deepEqual([...hgo[0].variants], ['HOUNDE', 'Hounde Mine', 'Houndé']);
  assert.equal(hgo[0].closed, 11);
  assert.equal(hgo[0].violated, 4);
  assert.equal(hgo[0].pct, 63.6, 'recomputed 7/11 — not the mean of 83.3, 25 and 100');
  assert.equal(hgo[0].rank != null, true, '11 closed after folding clears the 10-ticket bar');
  const dkr = all.filter(e => e.variants.some(v => /^dakar/i.test(v)));
  assert.equal(dkr.length, 1);
  assert.equal(dkr[0].closed, 12); assert.equal(dkr[0].violated, 5);
  const lon = all.filter(e => e.variants.some(v => /^london$/i.test(v)));
  assert.equal(lon.length, 1, 'an unknown site still folds on case');
  assert.equal(lon[0].key, 'london', 'and is never guessed into another site');
  assert.equal(lon[0].closed, 5);
  assert.equal(all.reduce((s, e) => s + e.closed, 0), R.total.closed, 'no ticket lost');
  // The raw key (tile Site filter) still splits them — the fold is a ranking key only.
  const raw = w.slaRanking(rows, w.helpdeskSiteKey, { minN: 10 });
  assert.ok([...raw.ranked, ...raw.low_sample].length > all.length);
});

test('P7: siteFoldKey reuses the scoreboard alias table (one table, server + browser)', () => {
  const SA = require('../public/lib/siteAliases');
  const SB = require('../services/scoreboardAliases');
  assert.equal(SB.ALIAS, SA.ALIAS, 'scoreboardAliases re-exports the same object');
  for (const [label, key] of [['HOUNDE', 'HGO'], ['Hounde Mine', 'HGO'], ['Houndé ', 'HGO'], ['Hounde IT Agents', 'HGO'],
    ['Ouaga', 'OUA'], ['Ouagadougou', 'OUA'], ['Dakar Office', 'DKR'], ['LAFIGUE - SML', 'SML'], ['HGO', 'HGO'],
    ['LONDON', 'london'], ['Fetekro Exploration Office', 'fetekro exploration office']]) {
    assert.equal(SA.siteFoldKey(label), key, label);
  }
  assert.equal(SB.assetLabelToCode('LONDON'), null, 'assetLabelToCode behaviour unchanged');
  assert.equal(SB.assetLabelToCode('Houndé'), 'HGO');
});

test('P7: index.html ranks sites on the folded key and loads the alias table first', () => {
  const src = fnSource(INDEX, 'renderSlaRanking');
  assert.match(src, /helpdeskSiteFoldKey/);
  assert.match(src, /labelFn:/);
  assert.ok(INDEX.indexOf('lib/siteAliases.js') > 0 && INDEX.indexOf('lib/siteAliases.js') < INDEX.indexOf('lib/dashboard-shared.js'));
});

// ── P8: one definition for tile, ranking and trend ────────────────────────────
function slaFixture() {
  return [
    t('MANA', { late: true }),                                                     // flag late, no dates
    t('MANA', { flag: '1', resolved: '03 Aug 2026 10:00 AM', due: '04 Aug 2026 10:00 AM' }), // stale flag: on time by dates
    t('MANA', { flag: '0', resolved: '05 Aug 2026 10:00 AM', due: '04 Aug 2026 10:00 AM' }), // late by dates, flag 0
    t('MANA', { status: 'Cancelled', flag: '1' }),                                 // cancelled closed: in the denominator, never missed
    t('MANA', {}), t('MANA', {}),
    t('MANA', { closed: false, late: true }),                                      // open: not judged
  ];
}

for (const def of ['due_vs_resolved', 'flag']) {
  test(`P8 (${def}): tile == ranking total == 100 − latest trend point, same denominator incl. cancelled`, () => {
    const rows = slaFixture();
    const ctx = load(fnSource(INDEX, 'pStats') + '\n;this.__pStats = pStats;');
    ctx.getPRows = () => rows;
    ctx.HD_SLA_DEFINITION = def;                     // the page's single definition constant
    const tile = ctx.__pStats('P');
    const w = ctx.window;
    const one = w.resolutionSla(rows, { definition: def });
    const trend = w.periodSlaRates(rows, { definition: def });
    const R = w.slaRanking(rows, w.helpdeskSiteFoldKey, { definition: def, labelFn: w.helpdeskSiteKey });
    assert.equal(one.closed, 6, 'cancelled closed ticket stays in the denominator');
    assert.equal(trend.closed, tile.closed, 'trend denominator = Closed tile');
    assert.equal(tile.slaPct, one.ok_pct, 'tile reads the helper');
    assert.equal(R.total.pct, tile.slaPct, 'ranking total = tile');
    assert.equal(trend.res_violated_pct, one.violated_pct, 'trend reads the helper');
    assert.equal(trend.res_violated, one.violated);
    assert.equal(Math.round((100 - trend.res_violated_pct) * 10) / 10, tile.slaPct, 'tile == latest trend point');
  });
}

test('P8: the two definitions really differ on this fixture, and the page default is today\'s rule', () => {
  const w = load().window;
  const rows = slaFixture();
  const a = w.resolutionSla(rows, { definition: 'due_vs_resolved' });
  const b = w.resolutionSla(rows, { definition: 'flag' });
  assert.equal(a.violated, 2); assert.equal(b.violated, 2);
  assert.notDeepEqual(rows.filter(r => w.resOverdueByDefinition(r, 'flag')).map(r => r['Request Display ID']),
    rows.filter(r => w.resOverdueByDefinition(r, 'due_vs_resolved')).map(r => r['Request Display ID']));
  assert.equal(w.HD_SLA_DEFINITION, 'due_vs_resolved', 'page default = isResOverdue, unchanged tile');
  assert.equal(w.resolutionSla(rows).definition, 'due_vs_resolved');
  assert.equal(w.resolutionSla(rows, { definition: 'bogus' }).definition, 'due_vs_resolved');
  for (const fn of ['renderTrend', 'renderSlaRanking', 'pStats']) {
    assert.match(fnSource(INDEX, fn), /HD_SLA_DEFINITION/, fn + ' passes the one definition');
  }
});

// ── P7: asset effort board (assets-db) — case variants of an unaliased label ──
process.env.SDP_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'c30-'));
const adb = require('../assets-db');
const cols = ['snapshot_date', 'site', 'total', 'no_cost', 'no_age', 'no_owner',
  'never_scanned', 'no_asset_tag', 'discovered', 'ghost', 'cost_pct', 'age_pct', 'owner_pct',
  'scan_pct', 'tag_pct', 'enrolled_pct', 'effort_score'];
function arow(date, site, total, noCost) {
  const c = 1 - noCost / total;
  return { snapshot_date: date, site, total, no_cost: noCost, no_age: 0, no_owner: 0, never_scanned: 0,
    no_asset_tag: 0, discovered: 0, ghost: 0, cost_pct: c, age_pct: 1, owner_pct: 1, scan_pct: 1,
    tag_pct: 1, enrolled_pct: 1, effort_score: Math.round(100 * (c + 5) / 6) };
}
const NOW = new Date().toISOString().slice(0, 10);
let lb;
__bootChain(async () => {
  await adb.replaceTable('asset_effort_history', cols, [
    arow(NOW, 'HOUNDE', 300, 300), arow(NOW, 'Hounde', 30, 0), arow(NOW, 'Houndé ', 10, 0),
  ]);
  lb = await adb.getEffortLeaderboard({ asOf: NOW });
});

test('P7: the asset effort board folds case/accent variants of a label into one row by summed counts', () => {
  const hits = lb.rows.filter(r => /^houn/i.test(r.site));
  assert.equal(hits.length, 1, 'HOUNDE / Hounde / Houndé = one row');
  assert.equal(hits[0].site, 'HOUNDE', 'displayed under the most frequent spelling (ties alphabetical)');
  assert.equal(hits[0].total, 340);
  // 300 of 340 without cost → cost 40/340; score = round(100*(40/340 + 5)/6) = 85 (not a mean of 83/100/100).
  assert.equal(hits[0].effort_score, Math.round(100 * (40 / 340 + 5) / 6));
});
