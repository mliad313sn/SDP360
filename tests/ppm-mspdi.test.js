'use strict';
// W2-ENGINE (PPM parity T1) — MSPDI export / import, lossless round-trip on the generated 1,000-task golden project
// (tools/ppm/gen-mspdi-golden.js, deterministic): parse(export(m)) deep-equals m, export is a fixed point, the bytes are
// pinned by SHA-256 (any drift in the exporter OR the engine dates shows up here), every date is kept to the minute,
// and re-scheduling the re-imported model gives the same dates (the file is a CPM fixture too). Parser safety: no DTD.
const { test } = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const M = require('../services/ppm/mspdi');
const E = require('../services/ppm/scheduleEngine');
const G = require('../tools/ppm/gen-mspdi-golden');

// Regenerate after an INTENTIONAL change to the exporter or the engine: node tools/ppm/gen-mspdi-golden.js | sha256sum
const GOLDEN_SHA256 = 'c393f6a11da396bc9349928e17d926c92e59d074e9c4a54829bfffb8ac5199f5';

test('T1: 1,000-task golden project — lossless round-trip, fixed point, pinned bytes, dates to the minute', () => {
  const { model, schedule } = G.scheduledModel(1000);
  assert.strictEqual(model.tasks.length, 1000);
  const xml = M.toXml(model);
  assert.strictEqual(crypto.createHash('sha256').update(xml).digest('hex'), GOLDEN_SHA256);
  const back = M.fromXml(xml);
  assert.deepStrictEqual(back, model);
  assert.strictEqual(M.toXml(back), xml);
  // every task carries its start at 08:00 and its finish at 17:00 (to the minute) and they are the engine's dates
  const rows = new Map(schedule.tasks.map((t) => [t.id, t]));
  for (const t of model.tasks) {
    assert.ok(xml.includes(`<Start>${t.start}T08:00:00</Start>`));
    assert.strictEqual(t.start, rows.get(t.uid).es_date);
    assert.strictEqual(t.finish, rows.get(t.uid).ef_date);
  }
  // coverage of the carried features
  const links = model.tasks.flatMap((t) => t.predecessors);
  for (const ty of ['FS', 'SS', 'FF', 'SF']) assert.ok(links.some((l) => l.type === ty), ty);
  for (const u of ['d', 'ed', '%']) assert.ok(links.some((l) => l.lag_unit === u), u);
  for (const c of ['ALAP', 'SNET', 'SNLT', 'FNET', 'FNLT', 'MSO', 'MFO']) assert.ok(model.tasks.some((t) => t.constraint_type === c), c);
  for (const n of [0, 1, 5, 10]) assert.ok(model.tasks.some((t) => t.baselines.some((b) => b.number === n)), `baseline ${n}`);
  assert.ok(model.assignments.length > 500 && model.resources.some((r) => r.rates.length >= 5));
  // re-schedule the re-imported model: same dates (the engine is a fixed point on its own export)
  const { tasks, opts } = M.modelToEngine(back);
  const again = E.schedule(tasks, opts);
  for (const r of again.tasks) assert.deepStrictEqual([r.es_date, r.ef_date], [rows.get(r.id).es_date, rows.get(r.id).ef_date]);
});

test('MSPDI codes and parser: link types, lag formats, constraint and contour codes; a DTD is refused; entities decoded', () => {
  const m = M.normalizeModel({ name: 'A & B <test>', start_date: '2027-01-04', currency_code: 'EUR', calendars: [{ uid: 1, name: 'Std', workdays: [1, 2, 3, 4, 5], exceptions: [] }], calendar_uid: 1,
    tasks: [{ uid: 1, name: 'a', duration_days: 2, start: '2027-01-04', finish: '2027-01-05' }, { uid: 2, name: 'b', duration_days: 1, start: '2027-01-08', finish: '2027-01-08', constraint_type: 'FNLT', constraint_date: '2027-01-12', predecessors: [{ uid: 1, type: 'SF', lag: 50, lag_unit: '%' }, { uid: 1, type: 'FF', lag: 2, lag_unit: 'ed' }] }],
    resources: [{ uid: 7, name: 'R', type: 'material', material_label: 'kg', rates: [{ table: 'C', from: '2027-02-01', standard_rate: 4.5 }] }],
    assignments: [{ uid: 1, task_uid: 1, resource_uid: 7, units_pct: 250, contour: 'bell', rate_table: 'C' }] });
  const xml = M.toXml(m);
  assert.ok(xml.includes('<Name>A &amp; B &lt;test&gt;</Name>'));
  assert.ok(xml.includes('<PredecessorUID>1</PredecessorUID><Type>2</Type><LinkLag>500</LinkLag><LagFormat>19</LagFormat>'));
  assert.ok(xml.includes('<Type>0</Type><LinkLag>28800</LinkLag><LagFormat>8</LagFormat>'));   // 2 elapsed days = 2 × 1440 × 10
  assert.ok(xml.includes('<ConstraintType>7</ConstraintType>') && xml.includes('<ConstraintDate>2027-01-12T17:00:00</ConstraintDate>'));
  assert.ok(xml.includes('<Units>2.5</Units>') && xml.includes('<WorkContour>6</WorkContour>') && xml.includes('<CostRateTable>2</CostRateTable>'));
  assert.deepStrictEqual(M.fromXml(xml), m);
  assert.throws(() => M.fromXml('<?xml version="1.0"?><!DOCTYPE x [<!ENTITY e SYSTEM "file:///etc/passwd">]><Project>&e;</Project>'), /DTD is not accepted/);
  assert.throws(() => M.fromXml('<Project><Tasks></Project>'), /mismatched/);
  assert.throws(() => M.fromXml('<Other/>'), /no <Project>/);
  // a finish written at 00:00 (some tools) is the end of the previous day; namespaced tags and comments are read
  const ext = M.fromXml('<p:Project xmlns:p="x"><!-- c --><p:Tasks><p:Task><p:UID>3</p:UID><p:Name><![CDATA[x & y]]></p:Name><p:Start>2027-01-04T08:00:00</p:Start><p:Finish>2027-01-06T00:00:00</p:Finish></p:Task></p:Tasks></p:Project>');
  assert.deepStrictEqual([ext.tasks[0].name, ext.tasks[0].start, ext.tasks[0].finish], ['x & y', '2027-01-04', '2027-01-05']);
});
