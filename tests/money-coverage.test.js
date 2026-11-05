// tests/money-coverage.test.js — A-16: per-site money coverage + the switchable
// "Non certifié" state. Pure helper (services/moneyCoverage.js), pinned on the
// real AP export distribution (tests/fixtures/assets/Assets.csv): only MANA
// (226/499) and Ouagadougou (1/1) carry a purchase cost — a fleet total is
// essentially MANA presented as the group, and must never read as certified.
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs'), path = require('node:path');
const money = require('../services/money');
const MC = require('../services/moneyCoverage');

const eligible = (r) => money.parseAmount(r.purchase_cost) > 0;
const siteOf = (r) => r.site;
const rowsFor = (site, elig, total) => {
  const out = [];
  for (let i = 0; i < total; i++) out.push({ site, purchase_cost: i < elig ? '1,000.00' : '0.00' });
  return out;
};

test('coverageBySite: MANA 226/499 and ITY 0/433 are both listed, ITY eligible 0 pct 0', () => {
  const cov = MC.coverageBySite([...rowsFor('MANA', 226, 499), ...rowsFor('ITY', 0, 433)],
    { isEligible: eligible, siteOf });
  assert.deepStrictEqual(cov, [
    { site: 'ITY', eligible: 0, total: 433, pct: 0 },
    { site: 'MANA', eligible: 226, total: 499, pct: 45 },
  ]);
});

test('certify: only one site eligible → certified:false, reason too_few_sites', () => {
  const cov = MC.coverageBySite([...rowsFor('MANA', 226, 499), ...rowsFor('ITY', 0, 433)],
    { isEligible: eligible, siteOf });
  const c = MC.certify(cov, { minSites: 3, minPct: 50 });
  assert.strictEqual(c.certified, false);
  assert.strictEqual(c.reason, 'too_few_sites');
  assert.strictEqual(c.sites_covered, 1);
  assert.strictEqual(c.sites_total, 2);
  assert.strictEqual(c.eligible, 226);
  assert.strictEqual(c.total, 932);
  assert.strictEqual(c.pct, 24);
});

test('certify: 3 sites each ≥ 50 % → certified:true', () => {
  const cov = MC.coverageBySite([...rowsFor('A', 6, 10), ...rowsFor('B', 5, 10), ...rowsFor('C', 9, 10)],
    { isEligible: eligible, siteOf });
  const c = MC.certify(cov, { minSites: 3, minPct: 50 });
  assert.strictEqual(c.certified, true);
  assert.strictEqual(c.reason, null);
  assert.strictEqual(c.sites_covered, 3);
  assert.strictEqual(c.pct, 67);
});

test('certify: 3 sites covered but below the % threshold → low_coverage', () => {
  const cov = MC.coverageBySite([...rowsFor('A', 1, 10), ...rowsFor('B', 1, 10), ...rowsFor('C', 1, 10)],
    { isEligible: eligible, siteOf });
  const c = MC.certify(cov, { minSites: 3, minPct: 50 });
  assert.strictEqual(c.certified, false);
  assert.strictEqual(c.reason, 'low_coverage');
});

test('certify: nothing eligible → certified:false reason no_eligible (never true on zero data)', () => {
  const cov = MC.coverageBySite(rowsFor('ITY', 0, 433), { isEligible: eligible, siteOf });
  const c = MC.certify(cov, { minSites: 0, minPct: 0 });   // even with a 0 policy
  assert.strictEqual(c.certified, false);
  assert.strictEqual(c.reason, 'no_eligible');
  const empty = MC.certify([], { minSites: 0, minPct: 0 });
  assert.strictEqual(empty.certified, false);
  assert.strictEqual(empty.reason, 'no_eligible');
});

test('pct guards total 0: no NaN, null (not measured) instead of 0', () => {
  const c = MC.certify([]);
  assert.strictEqual(c.pct, null);
  assert.strictEqual(c.total, 0);
  assert.ok(!Number.isNaN(c.pct));
  assert.strictEqual(MC.pctOf(0, 0), null);
  assert.strictEqual(MC.pctOf(1, 3), 33);
});

test('certify: missing/garbage thresholds fall back to the proposed defaults 3 / 50', () => {
  const cov = MC.coverageBySite([...rowsFor('A', 6, 10), ...rowsFor('B', 6, 10)], { isEligible: eligible, siteOf });
  const c = MC.certify(cov, { minSites: 'abc', minPct: undefined });
  assert.strictEqual(c.min_sites, 3);
  assert.strictEqual(c.min_pct, 50);
  assert.strictEqual(c.reason, 'too_few_sites');
});

test('optsFromConfig reads the three report_config keys; display defaults to "0"', () => {
  assert.deepStrictEqual(MC.optsFromConfig({}), { display: '0', minSites: 3, minPct: 50 });
  assert.deepStrictEqual(MC.optsFromConfig({
    asset_money_certify_display: '1', asset_money_certify_min_sites: '4', asset_money_certify_min_pct: '60',
  }), { display: '1', minSites: 4, minPct: 60 });
  assert.strictEqual(MC.optsFromConfig({ asset_money_certify_display: 'yes' }).display, '0');
});

test('sentence: French "Non certifié" wording with counts and thresholds; null when certified', () => {
  const s = MC.sentence({ certified: false, sites_covered: 1, pct: 9, min_sites: 3, min_pct: 50 });
  assert.strictEqual(s, 'Non certifié — couvre 1 site(s) / 9 % du parc (seuil : ≥ 3 sites et ≥ 50 %)');
  assert.ok(!s.includes('$'));
  assert.strictEqual(MC.sentence({ certified: true }), null);
  const unk = MC.sentence({ certified: false, sites_covered: 0, pct: null, min_sites: 3, min_pct: 50 });
  assert.ok(unk.includes('— % du parc'), 'an unmeasured pct reads "—", never 0 %');
});

test('real fixture Assets.csv: MANA 226/499, ITY 0/433, fleet 227/2473 → not certified', () => {
  const text = fs.readFileSync(path.join(__dirname, 'fixtures', 'assets', 'Assets.csv'), 'utf8')
    .replace(/^﻿/, '');
  // quote-aware CSV split (fields can carry commas)
  const rows = []; let field = '', row = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) { if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c; }
    else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\r') { /* skip */ }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const h = rows[0];
  const iSite = h.indexOf('Site'), iCost = h.indexOf('Purchase Cost($)');
  const assets = rows.slice(1).filter(r => r.length > 1)
    .map(r => ({ site: r[iSite], purchase_cost: r[iCost] }));
  assert.strictEqual(assets.length, 2473);
  const cov = MC.coverageBySite(assets, { isEligible: eligible, siteOf });
  const by = Object.fromEntries(cov.map(r => [r.site, r]));
  assert.strictEqual(by.MANA.eligible, 226);
  assert.strictEqual(by.MANA.total, 499);
  assert.strictEqual(by.ITY.eligible, 0);
  assert.strictEqual(by.ITY.total, 433);
  const c = MC.certify(cov, { minSites: 3, minPct: 50 });
  assert.strictEqual(c.eligible, 227);
  assert.strictEqual(c.total, 2473);
  assert.strictEqual(c.sites_covered, 2);
  assert.strictEqual(c.certified, false);
  assert.strictEqual(c.reason, 'too_few_sites');
});

test('MoneyCertBand (page band): empty when the switch is off or the figure is certified', () => {
  const Band = require('../public/lib/moneyCertBand');
  const cert = MC.certify(MC.coverageBySite([...rowsFor('MANA', 226, 499), ...rowsFor('ITY', 0, 433)],
    { isEligible: eligible, siteOf }));
  const cov = [{ site: 'ITY', eligible: 0, total: 433, pct: 0 }, { site: 'X', eligible: 0, total: 0, pct: null }];
  assert.strictEqual(Band.html({ certify_display: '0' }, cert, cov), '');
  assert.strictEqual(Band.html({}, cert, cov), '');
  assert.strictEqual(Band.html({ certify_display: '1' }, { ...cert, certified: true }, cov), '');
  const h = Band.html({ certify_display: '1' }, cert, cov);
  assert.ok(h.includes(MC.sentence(cert)), 'same sentence as the server helper');
  assert.ok(h.includes('0 / 433'), 'value in a cell');
  assert.ok(h.includes('<td style="text-align:right">—</td>'), 'no denominator → "—", never 0 %');
  assert.ok(!h.includes('$'));
  assert.ok(Band.html({ certify_display: '1' }, cert, [{ site: '<b>', eligible: 1, total: 1, pct: 100 }]).includes('&lt;b&gt;'));
});

test('assets.html wires the band on Finance + Investment (script + placeholders + calls)', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'assets.html'), 'utf8').replace(/\r\n/g, '\n');
  assert.ok(html.includes('src="lib/moneyCertBand.js"'));
  assert.ok(html.includes('id="fin-certBand"') && html.includes('id="invf-certBand"'));
  assert.ok(html.includes('MoneyCertBand.html(s, s.certification, s.coverage_by_site)'));
  assert.ok(html.includes('MoneyCertBand.html(fc, hw.certification, hw.by_site)'));
});

const CertBand = require('../public/lib/moneyCertBand');
test('D-06 certify: any excluded row (no currency, outlier) → certified:false, reason excluded_rows, counted', () => {
  const cov = [{ site: 'A', eligible: 10, total: 10 }, { site: 'B', eligible: 10, total: 10 }, { site: 'C', eligible: 10, total: 10 }];
  assert.strictEqual(MC.certify(cov, { minSites: 3, minPct: 50 }).certified, true);
  const c = MC.certify(cov, { minSites: 3, minPct: 50, excluded: { no_currency: 1, outlier: 2 } });
  assert.strictEqual(c.certified, false);
  assert.strictEqual(c.reason, 'excluded_rows');
  assert.strictEqual(c.excluded_rows, 3);
  assert.strictEqual(MC.certify(cov, { excluded: { no_currency: 0, outlier: 0 } }).certified, true);
  assert.strictEqual(MC.certify(cov, {}).excluded_rows, 0);
  assert.match(MC.sentence(c), /3 ligne\(s\) exclue\(s\)/);
  assert.match(CertBand.sentence(c), /3 ligne\(s\) exclue\(s\)/);
  assert.strictEqual(MC.sentence({ certified: false, sites_covered: 1, pct: 9, min_sites: 3, min_pct: 50, excluded_rows: 0 }),
    'Non certifié — couvre 1 site(s) / 9 % du parc (seuil : ≥ 3 sites et ≥ 50 %)');
});
