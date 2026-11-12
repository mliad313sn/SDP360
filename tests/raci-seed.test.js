'use strict';
// E-B05 — the RACI template is generated from the code base, current, and leaves every decision cell empty;
// RELEASE-GATES carries the new empty gate rows and the Version / SHA + Conditions columns.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const RS = require('../tools/agent/raci-seed');

const rowsOf = (md) => md.split('\n').filter((l) => /^\| /.test(l) && !/^\|---/.test(l));
const cells = (l) => l.split(/(?<!\\)\|/).slice(1, -1).map((x) => x.trim());

test('RACI-TEMPLATE.md is up to date (node tools/agent/raci-seed.js --check)', () => {
  assert.equal(fs.readFileSync(RS.OUT, 'utf8').replace(/\r\n/g, '\n'), RS.build());
});

test('every unnamed switch of the flag register appears once, grouped by area; the count is stated', () => {
  const unnamed = RS.readFlagOwners(fs.readFileSync(path.join(__dirname, '..', 'docs', 'ops', 'FLAG-REGISTER.md'), 'utf8')).filter((r) => r.owner === RS.UNNAMED);
  assert.ok(unnamed.length >= 150, `the register still has many unnamed owners (${unnamed.length})`);
  const md = RS.build();
  assert.match(md, new RegExp(`\\*\\*${unnamed.length} switches whose owner is "to be named"\\*\\*`));
  for (const r of unnamed) assert.ok(md.includes('`' + r.key + '`'), r.key);
  const sec3 = md.split('## 3.')[1].split('## 4.')[0];
  const total = rowsOf(sec3).slice(1).reduce((s, l) => s + Number(cells(l)[2]), 0);
  assert.equal(total, unnamed.length);
});

test('every R / A / C / I, steward and decision-SLA cell is empty; domains and connectors present; no name or date', () => {
  const md = RS.build();
  for (const sec of ['## 1.', '## 2.', '## 3.']) {
    const body = md.split(sec)[1].split('\n## ')[0];
    const [head, ...data] = rowsOf(body); const h = cells(head);
    const idx = ['R', 'A', 'C', 'I', 'Data steward', 'Decision SLA'].map((k) => h.indexOf(k));
    assert.ok(idx.every((i) => i >= 0), sec);
    assert.ok(data.length > 0, sec);
    for (const l of data) for (const i of idx) assert.equal(cells(l)[i], '', `${sec} ${cells(l)[0]}`);
  }
  for (const [id] of RS.DOMAINS) assert.ok(md.includes('`' + id + '`'), id);
  assert.match(md, /\| C01 \|/);
  assert.doesNotMatch(md, /\b20\d\d-\d\d-\d\d\b/, 'no date written');
  assert.match(md, /Monthly product committee — agenda skeleton/);
});

test('RELEASE-GATES: Version / SHA and Conditions columns, the four new gate rows, every decision cell empty', () => {
  const md = fs.readFileSync(path.join(__dirname, '..', 'docs', 'sdp360', 'completion', 'RELEASE-GATES.md'), 'utf8').replace(/\r\n/g, '\n');
  const [head, ...data] = rowsOf(md); const h = cells(head);
  for (const c of ['Version / SHA', 'Conditions', 'Name', 'Date']) assert.ok(h.includes(c), c);
  for (const g of ['Penetration test', 'QA lead', 'Capacity', 'Business witness project']) assert.ok(data.some((l) => cells(l)[0].startsWith(g)), g);
  const dec = h.indexOf('Decision (GO / NO-GO / conditions)');
  for (const l of data) {
    const c = cells(l); assert.equal(c.length, h.length, c[0]);
    for (let i = dec; i < h.length; i++) assert.equal(c[i], '', `${c[0]} · ${h[i]} must stay empty`);
  }
});
