'use strict';
// E-D01 — read-only split report for codes shared by two active sites (Assafo + Tanda → tracker TND).
const { test } = require('node:test');
const assert = require('node:assert');
const R = require('../tools/sites/shared-code-report');

const SITES = [{ id: 1, name: 'Assafo', active: 1 }, { id: 2, name: 'Tanda', active: 1 }, { id: 3, name: 'Hounde', active: 1 }];
const CODES = { tracker: { Assafo: 'TND', Tanda: 'TND', Hounde: 'HGO' }, meetings: { Hounde: 'HGO' }, inspection: { Hounde: 'HGO' } };
const codeOf = Object.fromEntries(Object.entries(CODES).map(([m, map]) => [m, (s) => map[s.name] || null]));
// users: 10 = Assafo editor, 11 = Tanda editor, 12 = both sites, 13 = central (no site); 99 does not exist
const USERS = [{ id: 10, site_id: 1 }, { id: 11, site_id: 2 }, { id: 12, site_id: 1 }, { id: 13, site_id: null }];
const EXTRA = [{ user_id: 12, site_id: 2 }];

function fakeQ(log) {
  return async (sql, params) => {
    log.push(sql.trim().split(/\s+/).slice(0, 6).join(' '));
    assert.ok(/^\s*SELECT/i.test(sql), 'the report only ever reads: ' + sql);
    if (/FROM sites/.test(sql)) return SITES;
    if (/FROM users/.test(sql)) return USERS;
    if (/FROM user_sites/.test(sql)) return EXTRA;
    if (/FROM tracker_inputs_v2/.test(sql)) { assert.deepStrictEqual(params, ['TND']); return [{ code: 'TND', year: 2026, activity_id: 4, activity: 'Backups tested', n: 2 }]; }
    if (/FROM tracker_entries/.test(sql)) return [
      { code: 'TND', key: 'net', item_code: 'wan', updated_by: 10, n: 3 },
      { code: 'TND', key: 'net', item_code: 'lan', updated_by: 11, n: 2 },
      { code: 'TND', key: 'net', item_code: 'wifi', updated_by: 12, n: 1 },
      { code: 'TND', key: 'net', item_code: 'srv', updated_by: 13, n: 1 },
      { code: 'TND', key: 'net', item_code: 'bkp', updated_by: 99, n: 1 },
      { code: 'TND', key: 'gone', item_code: 'x', updated_by: null, n: 4 },
    ];
    if (/FROM system_log/.test(sql)) return params[0] === 'gone' ? [{ actor_id: 11 }] : [];
    throw new Error('unexpected query ' + sql);
  };
}

test('splits the rows under TND by the writer\'s site and marks every other case unknown', async () => {
  const log = [];
  const data = await R.collect(fakeQ(log), { codeOf });
  assert.deepStrictEqual(data.shared.tracker, [{ code: 'TND', sites: ['Assafo', 'Tanda'] }]);
  assert.deepStrictEqual(data.shared.meetings, [], 'HGO is held by one site only');
  const rep = R.buildReport(data);
  assert.equal(rep.codes.length, 1);
  const c = rep.codes[0];
  assert.equal(c.code, 'TND'); assert.deepStrictEqual(c.sites, ['Assafo', 'Tanda']);
  const by = Object.fromEntries(c.groups.map((g) => [g.label, g]));
  assert.equal(by['net · wan'].attributed, 'Assafo');
  assert.equal(by['net · lan'].attributed, 'Tanda');
  assert.equal(by['net · wifi'].attributed, null); assert.match(by['net · wifi'].reason, /several/);
  assert.equal(by['net · srv'].attributed, null); assert.match(by['net · srv'].reason, /no site/);
  assert.equal(by['net · bkp'].attributed, null); assert.match(by['net · bkp'].reason, /not found/);
  assert.equal(by['gone · x'].attributed, 'Tanda', 'falls back to the last tracker_entries_saved actor');
  assert.match(by['gone · x'].reason, /tracker_entries_saved/);
  const legacy = c.groups.find((g) => g.table === 'tracker_inputs_v2');
  assert.equal(legacy.attributed, null); assert.match(legacy.reason, /no writer recorded/);
  assert.deepStrictEqual(c.attributed_rows, { Assafo: 3, Tanda: 6 });
  assert.equal(c.unknown_rows, 2 + 1 + 1 + 1);
});

test('markdown names account ids only, says nothing was written, and lists unknowns', async () => {
  const md = R.toMarkdown(R.buildReport(await R.collect(fakeQ([]), { codeOf })), { at: '2026-11-05T00:00:00Z' });
  assert.match(md, /Nothing was written and nothing was re-attributed/);
  assert.match(md, /tracker code `TND` — shared by Assafo, Tanda/);
  assert.match(md, /3 attributable to Assafo · 6 attributable to Tanda · 5 unknown/);
  assert.match(md, /\| #10 \|/);
  assert.match(md, /human gate 9/);
});

test('no shared code: one sentence, no table', async () => {
  const one = { tracker: () => null, meetings: () => null, inspection: () => null };
  const md = R.toMarkdown(R.buildReport(await R.collect(fakeQ([]), { codeOf: one })));
  assert.match(md, /No module code is shared by two active sites/);
});
