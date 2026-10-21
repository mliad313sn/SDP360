'use strict';
// Step 9 — minimal OData v4 shaping: service document, CSDL, $filter/$top/$skip/$orderby/$select/$count.
const { test } = require('node:test');
const assert = require('node:assert');
const O = require('../services/odata');

const rows = [{ Id: 'a', Metric: 'm1', SiteId: 1, Site: 'Hounde', Value: 71.4, Rag: 'RED' }, { Id: 'b', Metric: 'm1', SiteId: 2, Site: "O'Brien", Value: null, Rag: 'NA' }, { Id: 'c', Metric: 'm2', SiteId: 1, Site: 'Hounde', Value: 90, Rag: 'GREEN' }];

test('service document lists the three entity sets; metadata is CSDL 4.0 with keys', () => {
  const d = O.serviceDocument('http://x/ext/odata');
  assert.equal(d['@odata.context'], 'http://x/ext/odata/$metadata'); assert.deepEqual(d.value.map(v => v.name), ['Metrics', 'Values', 'Sites']);
  const x = O.metadataXml();
  assert.ok(x.startsWith('<?xml')); assert.ok(x.includes('Version="4.0"')); assert.ok(x.includes('<EntityType Name="Value"><Key><PropertyRef Name="Id"/></Key>')); assert.ok(x.includes('<EntitySet Name="Values" EntityType="Sdp360.Metrics.Value"/>'));
});

test('$filter: eq/ne/gt/ge/lt/le joined by and, quoted strings with escaped quote, numbers, null', () => {
  const f = (expr) => rows.filter(O.parseFilter(expr)).map(r => r.Id).join('');
  assert.equal(f("Metric eq 'm1'"), 'ab'); assert.equal(f("Metric eq 'm1' and SiteId eq 1"), 'a');
  assert.equal(f('Value gt 80'), 'c'); assert.equal(f('Value le 71.4'), 'a'); assert.equal(f("Site eq 'O''Brien'"), 'b'); assert.equal(f('Value ne null'), 'ac');
  assert.throws(() => O.parseFilter("contains(Site,'H')"), /unsupported \$filter/);
});

test('collection: paging, ordering, projection, count; unknown set → NOT_FOUND; $top capped at 5000', () => {
  const b = O.collection('http://x/ext/odata', 'Values', rows, { $orderby: 'Value desc', $top: '2', $count: 'true', $select: 'Id,Value' });
  assert.equal(b['@odata.context'], 'http://x/ext/odata/$metadata#Values'); assert.equal(b['@odata.count'], 3);
  assert.deepEqual(b.value, [{ Id: 'c', Value: 90 }, { Id: 'a', Value: 71.4 }]);
  assert.deepEqual(O.collection('http://x', 'Values', rows, { $skip: 2 }).value.map(r => r.Id), ['c']);
  assert.throws(() => O.collection('http://x', 'Nope', rows), /unknown entity set/);
  assert.equal(O.collection('http://x', 'Values', new Array(6000).fill(rows[0]), { $top: 99999 }).value.length, 5000);
  assert.equal(O.collection('http://x', 'Values', rows, {}).value.length, 3, 'no count without $count');
});

test('M7: properties outside the entity are refused (400) — $orderby, $select, $filter, and __proto__/constructor explicitly', () => {
  const q = (opts) => O.collection('http://x', 'Values', rows, opts);
  assert.throws(() => q({ $orderby: 'Nope desc' }), /unknown property in \$orderby/);
  assert.throws(() => q({ $orderby: '__proto__' }), /unknown property in \$orderby/);
  assert.throws(() => q({ $select: 'Id,constructor' }), /unknown property in \$select/);
  assert.throws(() => q({ $filter: "__proto__ eq 'x'" }), /unknown property in \$filter/);
  assert.throws(() => q({ $filter: 'prototype eq 1' }), /unknown property in \$filter/);
  assert.throws(() => q({ $orderby: 'Value sideways' }), /unsupported \$orderby direction/);
  for (const bad of ['Nope desc', '__proto__']) { try { q({ $orderby: bad }); assert.fail('should throw'); } catch (e) { assert.equal(e.code, 'INVALID'); } }
  assert.equal(q({ $orderby: 'Value asc', $select: 'Id' }).value.length, 3, 'declared properties still work');
});
