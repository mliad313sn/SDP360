'use strict';
// V1a Task 2 — pure OPManager device → KPI family classifier. Family ORDER is
// authoritative (first match): excluded → wan → wifi → lan → servers.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { classifyKpiFamily } = require('../services/opmClassify');

const F = (t, c) => classifyKpiFamily(t, c).family;

test('each family from real Type/Category pairs', () => {
  assert.equal(F('Windows 2022', 'Server'), 'servers');
  assert.equal(F('Windows 2022', 'DomainController'), 'servers');
  assert.equal(F('Linux', 'Server'), 'servers');
  assert.equal(F('ESXServer', 'Server'), 'servers');
  assert.equal(F('Meraki MS Series', 'Meraki Switch'), 'lan');
  assert.equal(F('Meraki MR Series', 'Meraki Radio'), 'wifi');
  assert.equal(F('Meraki MX Series', 'Meraki Security'), 'wan');
  assert.equal(F('Meraki Z Series', 'Meraki Security'), 'wan');
});

test('Unknown + UPS → excluded', () => {
  assert.equal(F('Unknown', 'Unknown'), 'excluded');
  assert.equal(F('Cyber Power System Device_1', 'Unknown'), 'excluded');
  assert.match(classifyKpiFamily('Unknown', 'Unknown').reason, /unknown/i);
});

test('precedence: Type=Linux + Category=Wireless → wifi (family order, wifi before servers)', () => {
  assert.equal(F('Linux', 'Wireless'), 'wifi');
});

test('case/space tolerant + null-safe', () => {
  assert.equal(F('  meraki ms series ', ' meraki switch '), 'lan');
  assert.equal(F(null, null), 'excluded');
});

test('drives the REAL OPM_Inventory.csv without throwing; Unknown share is high', () => {
  const raw = fs.readFileSync(path.join(__dirname, 'fixtures/opmanager/OPM_Inventory.csv'), 'utf8').replace(/^﻿/, '');
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const hdr = lines[0].split(',');
  const iType = hdr.indexOf('Type'), iCat = hdr.indexOf('Category');
  let excluded = 0, total = 0;
  for (const line of lines.slice(1)) {
    const cols = line.split(',');   // no quoted commas in Type/Category columns
    const fam = F(cols[iType], cols[iCat]);
    assert.ok(['servers', 'lan', 'wifi', 'wan', 'excluded'].includes(fam));
    total++; if (fam === 'excluded') excluded++;
  }
  assert.ok(total > 600, 'parsed the whole fixture');
  assert.ok(excluded / total > 0.2, 'a large share is Unknown → excluded (governance need)');
});
