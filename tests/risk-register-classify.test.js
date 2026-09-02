'use strict';
// Risk Register — "Services affected" precedence + classification.
// Pure-function + in-memory-sqlite integration tests (no PG needed).
const test = require('node:test');
const assert = require('node:assert');
const Database = require('better-sqlite3');
const rr = require('../risk-register-export');

const D1 = '1.Unavailability of Internet';
const D2 = '2.Unavailability of the mobile phone';
const D3 = '3.Unavailability of electrical power';
const D4 = '4.Infrastructure unavailability (FW, files, data, mail, etc.)';
const D5 = '5.Radio system unavailability';
const INFRA = 'Infrastructure (FW, files, data, mail, etc.)';  // contains commas!
const SA = v => JSON.stringify({ 'UDF:Services affected': v });

// ── servicesAffectedDomains (pure parser) ─────────────────────────────
test('servicesAffectedDomains: comma-joined labels', () => {
  assert.deepEqual(rr.servicesAffectedDomains(SA('Internet,Mobile phone')), [D1, D2]);
});
test('servicesAffectedDomains: handles commas INSIDE the Infrastructure label', () => {
  assert.deepEqual(rr.servicesAffectedDomains(SA(`Internet,${INFRA}`)), [D1, D4]);
});
test('servicesAffectedDomains: all five, deterministic domain order', () => {
  assert.deepEqual(
    rr.servicesAffectedDomains(SA(`Radio,${INFRA},Electrical power,Mobile phone,Internet`)),
    [D1, D2, D3, D4, D5]
  );
});
test('servicesAffectedDomains: empty / missing / bad json → []', () => {
  assert.deepEqual(rr.servicesAffectedDomains(null), []);
  assert.deepEqual(rr.servicesAffectedDomains(JSON.stringify({ 'UDF:Other': 'x' })), []);
  assert.deepEqual(rr.servicesAffectedDomains(SA('   ')), []);
  assert.deepEqual(rr.servicesAffectedDomains('not json'), []);
});

// ── domainsForIncident (precedence) ───────────────────────────────────
test('domainsForIncident: Services affected WINS over category (multi-domain)', () => {
  const rec = { category: 'IT Infrastructure', sub_category: 'Backup', impact: 'Enterprise', udf_json: SA('Internet,Radio') };
  assert.deepEqual(rr.domainsForIncident(rec), [D1, D5]);   // NOT D4 from Backup
});
test('domainsForIncident: Individual excluded even with Services affected', () => {
  const rec = { category: 'IT Infrastructure', sub_category: 'Backup', impact: 'Individual', udf_json: SA('Internet') };
  assert.deepEqual(rr.domainsForIncident(rec), []);
});
test('domainsForIncident: Inspection excluded', () => {
  assert.deepEqual(rr.domainsForIncident({ category: 'Inspection', udf_json: SA('Internet') }), []);
});
test('domainsForIncident: fallback to category when field empty', () => {
  assert.deepEqual(rr.domainsForIncident({ category: 'IT Infrastructure', sub_category: 'Electrical power & UPS', impact: 'Enterprise' }), [D3]);
});
test('domainsForIncident: no field + no category match → []', () => {
  assert.deepEqual(rr.domainsForIncident({ category: 'Software and Applications', sub_category: 'Ivalua', impact: 'Enterprise' }), []);
});

// ── loadOccurrencesFromDB (in-memory integration) ─────────────────────
test('loadOccurrencesFromDB: precedence + multi-domain + site filter + fallback', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE request_records(
    request_id TEXT, site TEXT, category TEXT, sub_category TEXT,
    request_type TEXT, impact TEXT, created_time TEXT, udf_json TEXT)`);
  const ins = db.prepare(`INSERT INTO request_records
    (request_id,site,category,sub_category,request_type,impact,created_time,udf_json)
    VALUES (?,?,?,?,?,?,?,?)`);
  // A: HOUNDE, field=Internet+Radio → HGO D1+D5 (Backup category ignored)
  ins.run('A', 'HOUNDE', 'IT Infrastructure', 'Backup', 'Incident', 'Enterprise', '2026-06-15T10:00:00', SA('Internet,Radio'));
  // B: MANA, no field, category Backup → MGO D4 (fallback)
  ins.run('B', 'MANA', 'IT Infrastructure', 'Backup', 'Incident', 'Enterprise', '2026-06-16T10:00:00', null);
  // C: HOUNDE, field set but Individual → excluded
  ins.run('C', 'HOUNDE', 'IT Infrastructure', 'Backup', 'Incident', 'Individual', '2026-06-17T10:00:00', SA('Internet'));
  // D: LONDON (off-register) → skipped_unknown_site
  ins.run('D', 'LONDON', null, null, 'Incident', 'Enterprise', '2026-06-18T10:00:00', SA('Internet'));
  // E: MANA, no field, category Network issues → MGO D1 (fallback)
  ins.run('E', 'MANA', 'Network & Internet Access', 'Network issues', 'Incident', 'Enterprise', '2026-06-19T10:00:00', null);

  const { occurrences, diagnostics } = await rr.loadOccurrencesFromDB(db, '2026-06');
  assert.equal(occurrences['HGO'][D1], 1, 'HGO Internet');
  assert.equal(occurrences['HGO'][D5], 1, 'HGO Radio');
  assert.equal(occurrences['HGO'][D4], undefined, 'Backup must NOT count (field won)');
  assert.equal(occurrences['MGO'][D4], 1, 'MGO Backup fallback');
  assert.equal(occurrences['MGO'][D1], 1, 'MGO Network issues fallback');
  assert.equal(diagnostics.skipped_unknown_site, 1, 'LONDON skipped');
  assert.equal(diagnostics.skipped_non_operational, 1, 'Individual skipped');
  assert.equal(diagnostics.classified_via_services_affected, 1, 'A via field');
  assert.equal(diagnostics.classified_via_category, 2, 'B + E via category');
  db.close();
});

test('loadOccurrencesFromDB: per-cell source breakdown (field vs category, incl. mixed)', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE request_records(
    request_id TEXT, site TEXT, category TEXT, sub_category TEXT,
    request_type TEXT, impact TEXT, created_time TEXT, udf_json TEXT)`);
  const ins = db.prepare(`INSERT INTO request_records
    (request_id,site,category,sub_category,request_type,impact,created_time,udf_json)
    VALUES (?,?,?,?,?,?,?,?)`);
  // MANA: one via field (Internet+Radio), one via category (Network issues = D1)
  ins.run('A', 'MANA', 'IT Infrastructure', 'Backup', 'Incident', 'Enterprise', '2026-06-15T10:00:00', SA('Internet,Radio'));
  ins.run('B', 'MANA', 'Network & Internet Access', 'Network issues', 'Incident', 'Enterprise', '2026-06-16T10:00:00', null);

  const { occurrences, sources } = await rr.loadOccurrencesFromDB(db, '2026-06');
  // MGO / D1 = 2 → 1 via field (A) + 1 via category (B) → mixed
  assert.equal(occurrences['MGO'][D1], 2);
  assert.deepEqual(sources['MGO'][D1], { field: 1, category: 1 });
  // MGO / D5 = 1 → all field
  assert.deepEqual(sources['MGO'][D5], { field: 1, category: 0 });
  db.close();
});

// ── Risk comment (txt_risk_comment) → column H "Commentaires" ─────────
test('riskCommentFrom: tolerant key variants, trim, absent/blank/bad → empty', () => {
  assert.equal(rr.riskCommentFrom(JSON.stringify({ 'UDF:Risk comment': '  Fibre cut near gate 2  ' })), 'Fibre cut near gate 2');
  assert.equal(rr.riskCommentFrom(JSON.stringify({ 'Risk Comment': 'x' })), 'x');
  assert.equal(rr.riskCommentFrom(JSON.stringify({ 'txt_risk_comment': 'y' })), 'y');
  assert.equal(rr.riskCommentFrom(JSON.stringify({ 'UDF:Risk_Comment': 'z' })), 'z');
  assert.equal(rr.riskCommentFrom(JSON.stringify({ 'Other': 'v' })), '');
  assert.equal(rr.riskCommentFrom(null), '');
  assert.equal(rr.riskCommentFrom('not json'), '');
});

test('loadOccurrencesFromDB collects risk comments per cell; export writes them into column H', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE request_records(
    request_id TEXT, site TEXT, category TEXT, sub_category TEXT,
    request_type TEXT, impact TEXT, created_time TEXT, udf_json TEXT)`);
  const ins = db.prepare(`INSERT INTO request_records
    (request_id,site,category,sub_category,request_type,impact,created_time,udf_json)
    VALUES (?,?,?,?,?,?,?,?)`);
  // Two commented incidents on MGO/D1, one uncommented (still counts, no comment).
  ins.run('101', 'MANA', 'Network & Internet Access', 'Network issues', 'Incident', 'Enterprise', '2026-06-15T10:00:00',
    JSON.stringify({ 'UDF:Risk comment': 'ISP outage 3h, backup link engaged' }));
  ins.run('102', 'MANA', 'Network & Internet Access', 'Network issues', 'Incident', 'Enterprise', '2026-06-16T10:00:00',
    JSON.stringify({ 'UDF:Services affected': 'Internet', 'UDF:Risk comment': 'Router failure replaced same day' }));
  ins.run('103', 'MANA', 'Network & Internet Access', 'Network issues', 'Incident', 'Enterprise', '2026-06-17T10:00:00', null);

  const { occurrences, sources, comments } = await rr.loadOccurrencesFromDB(db, '2026-06');
  assert.equal(occurrences['MGO'][D1], 3);
  assert.deepEqual(comments['MGO'][D1], [
    '#101 — ISP outage 3h, backup link engaged',
    '#102 — Router failure replaced same day',
  ]);

  // End-to-end: the Excel cell H of the MGO/D1 row carries the joined summary.
  const XLSX = require('xlsx');
  const buf = rr.generateRiskRegisterExcel('2026-06', occurrences, sources, comments);
  const ws = XLSX.read(buf, { type: 'buffer' }).Sheets['Occurrence_2026-06'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const mgoD1 = rows.find(r => r[1] === 'MGO' && String(r[2]).startsWith('1.'));
  assert.ok(mgoD1, 'MGO / Internet row exists');
  assert.ok(String(mgoD1[7]).includes('#101 — ISP outage 3h'), 'comment 101 in column H');
  assert.ok(String(mgoD1[7]).includes('#102 — Router failure'), 'comment 102 in column H');
  assert.equal(mgoD1[8], 3, 'occurrence count unchanged');
  // A row with no comments keeps an empty H (spec-compatible).
  const mgoD5 = rows.find(r => r[1] === 'MGO' && String(r[2]).startsWith('5.'));
  assert.equal(mgoD5[7] || '', '');
  db.close();
});

test('column-H summary caps long lists with "… (+N autres)"', async () => {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE request_records(
    request_id TEXT, site TEXT, category TEXT, sub_category TEXT,
    request_type TEXT, impact TEXT, created_time TEXT, udf_json TEXT)`);
  const ins = db.prepare(`INSERT INTO request_records
    (request_id,site,category,sub_category,request_type,impact,created_time,udf_json)
    VALUES (?,?,?,?,?,?,?,?)`);
  for (let i = 0; i < 12; i++) {
    ins.run(String(200 + i), 'MANA', 'Network & Internet Access', 'Network issues', 'Incident', 'Enterprise',
      '2026-06-15T10:00:00', JSON.stringify({ 'UDF:Risk comment': 'Long commentary '.repeat(8) + i }));
  }
  const { occurrences, sources, comments } = await rr.loadOccurrencesFromDB(db, '2026-06');
  const XLSX = require('xlsx');
  const buf = rr.generateRiskRegisterExcel('2026-06', occurrences, sources, comments);
  const ws = XLSX.read(buf, { type: 'buffer' }).Sheets['Occurrence_2026-06'];
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1 });
  const cell = String(rows.find(r => r[1] === 'MGO' && String(r[2]).startsWith('1.'))[7]);
  assert.ok(cell.length <= 800, 'cell stays readable (capped)');
  assert.ok(/\(\+\d+ autres\)/.test(cell), 'overflow marker present');
  db.close();
});
