'use strict';
// P11 round 5 (UX/field) — F-16: the Helpdesk "own site" default selected ONE spelling of the site; the page filters
// by an upper-case substring of that value, so the site's other spellings were silently left out of the tiles.
// The default now picks a spelling whose substring covers every same-site spelling, or stays on All Sites (with a note).
const { test } = require('node:test');
const assert = require('node:assert');
const HSD = require('../public/lib/helpdeskSiteDefault');
const SA = require('../public/lib/siteAliases');
// the page's own filter (index.html matchPeriod): upper-case substring
const covers = (opt, spelling) => String(spelling).toUpperCase().includes(String(opt).toUpperCase());

test('a covering spelling is picked so no same-site spelling drops out', () => {
  for (const [opts, site] of [[['OUAGADOUGOU', 'Ouaga'], 'Ouagadougou'], [['LAFIGUE - SML', 'Lafigue'], 'Lafigue'], [['HOUNDE', 'Hounde Mine'], 'Hounde']]) {
    const r = HSD.pickResult(['all', ...opts, 'MANA'], [site], SA.siteFoldKey);
    assert.ok(r.option, site);
    for (const s of opts) assert.ok(covers(r.option, s), `${site}: ${r.option} covers ${s}`);
    assert.strictEqual(HSD.pickOption(['all', ...opts, 'MANA'], [site], SA.siteFoldKey), r.option);
  }
});

test('no spelling covers the others → All Sites stays, the spellings are reported', () => {
  const r = HSD.pickResult(['all', 'HGO', 'Hounde Mine'], ['Hounde'], SA.siteFoldKey);
  assert.strictEqual(r.option, null);
  assert.deepStrictEqual(r.spellings.sort(), ['HGO', 'Hounde Mine']);
  assert.strictEqual(HSD.pickOption(['all', 'HGO', 'Hounde Mine'], ['Hounde'], SA.siteFoldKey), null);
});

test('a single spelling still applies; no match still returns nothing', () => {
  assert.strictEqual(HSD.pickOption(['all', 'MANA'], ['Mana'], SA.siteFoldKey), 'MANA');
  const r = HSD.pickResult(['all', 'MANA'], ['Tanda'], SA.siteFoldKey);
  assert.strictEqual(r.option, null); assert.deepStrictEqual(r.spellings, []);
});
