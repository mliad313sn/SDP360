'use strict';
// E-D06 + E-Q02 — snapshot anonymiser, tested ONLY on a synthetic database (the throwaway PG of this test
// process, fully migrated). Never on production data.
const { test, before, after } = require('node:test');
const assert = require('node:assert');
const A = require('../tools/dev/anonymize-snapshot');
const KEY = 'test-only-anon-key-0000';

test('pseudonyms are stable, keyed and never the source value', () => {
  const P = A.makePseudo(KEY); const Q = A.makePseudo(KEY + 'x');
  assert.equal(P.person('Awa Traoré'), P.person('  awa traoré '));
  assert.notEqual(P.person('Awa Traoré'), Q.person('Awa Traoré'), 'depends on the key');
  assert.match(P.email('a.b@corp.com'), /^user-[0-9a-f]{10}@anon\.invalid$/);
  assert.equal(P.ticket('req', '106803000000123'), P.ticket('req', '106803000000123'));
  assert.match(P.ticket('req', '106803000000123'), /^\d{12}$/);
  assert.throws(() => A.makePseudo('short'), /16\+/);
});

test('JSON keeps structure, dates, numbers and structural keys; replaces the rest', () => {
  const P = A.makePseudo(KEY);
  const out = JSON.parse(A.scrubJson(JSON.stringify({ 'UDF:Priority': 'High', 'UDF:RCA': 'Fibre cut by J. Doe', when: '2026-07-01T10:00:00Z', n: 3, mail: 'x@y.com', photo: 'data:image/png;base64,AAA', list: ['free words'] }), P));
  assert.equal(out['UDF:Priority'], 'High'); assert.equal(out.when, '2026-07-01T10:00:00Z'); assert.equal(out.n, 3);
  assert.match(out['UDF:RCA'], /^Text [0-9a-f]{10}$/); assert.match(out.mail, /@anon\.invalid$/); assert.equal(out.photo, null);
  assert.match(out.list[0], /^Text /);
});

test('residual scan: real e-mails and phones are found, pseudonymised e-mails and ids are not', () => {
  assert.equal(A.residual('call +225 07 08 09 10 11'), 'phone');
  assert.equal(A.residual('tel 07 08 09 10 11'), 'phone');
  assert.equal(A.residual('write to jane@corp.com'), 'email');
  assert.equal(A.residual('user-0123456789@anon.invalid'), null);
  assert.equal(A.residual('106803000000123456 on 2026-07-14 10:00'), null);
});

test('preflight refuses without a key, without the exact copy name, and on the production database', () => {
  const url = 'postgres://u:p@localhost:5432/sdp_snapshot_copy';
  assert.match(A.preflight({ url, confirm: 'sdp_snapshot_copy', key: '' }), /SDP_ANON_KEY/);
  assert.match(A.preflight({ url, confirm: 'other', key: KEY }), /confirm-copy/);
  assert.match(A.preflight({ url, confirm: 'sdp_snapshot_copy', key: KEY, prodUrl: 'postgres://a:b@h/sdp_snapshot_copy' }), /production/);
  assert.equal(A.preflight({ url, confirm: 'sdp_snapshot_copy', key: KEY, prodUrl: 'postgres://a:b@h/sdp_dashboard' }), null);
});

let c, q, count;
before(async () => {
  const { Client } = require('pg');
  c = new Client({ connectionString: process.env.PG_URL }); await c.connect();
  q = async (sql, params = []) => { let i = 0; return (await c.query(sql.replace(/\?/g, () => '$' + (++i)), params)).rows; };
  count = async (t) => Number((await q(`SELECT COUNT(*) AS n FROM ${t}`))[0].n);
  // synthetic world — every value below is invented for this test
  await q("INSERT INTO users (username, full_name, password_hash, salt, email, role) VALUES ('awa.t', 'Awa Traoré', 'h', 's', 'awa.traore@corp.example.com', 'editor')");
  await q("INSERT INTO request_records (request_id, display_id, subject, technician, requester, site, request_status, udf_json, created_time) VALUES ('106803000000555001', '45001', 'Printer jam for Awa Traoré', 'Koffi K', 'Awa Traoré', 'HOUNDE', 'Closed', ?, '2026-07-02T08:00:00Z')", [JSON.stringify({ 'UDF:Priority': 'High', 'UDF:RCA': 'call +225 07 08 09 10 11' })]);
  const m = await q("INSERT INTO md_meetings (site_code, department, meeting_date, department_head, other_attendees) VALUES ('HGO', 'Maintenance', '2026-07-01', 'Moussa D', 'Awa Traoré, Koffi K') RETURNING id");
  await q("INSERT INTO md_issues (meeting_id, title, category, severity, status, champion, champion_email, description) VALUES (?, 'Radio down', 'CN', 'HIGH', 'open', 'Awa Traoré', 'awa.traore@corp.example.com', 'tell awa.traore@corp.example.com')", [m[0].id]);
  await q("INSERT INTO system_log (ts, category, action, actor, ip, details) VALUES ('2026-07-01T00:00:00Z', 'auth', 'login_success', 'awa.t', '10.0.0.5', ?)", [JSON.stringify({ email: 'awa.traore@corp.example.com' })]);
});
after(async () => { if (c) await c.end(); });

test('on a synthetic migrated database: no source name or e-mail survives, counts and joins are kept', async () => {
  const before = { u: await count('users'), r: await count('request_records'), m: await count('md_meetings'), i: await count('md_issues') };
  await q('BEGIN');
  const res = await A.anonymize(q, { key: KEY });
  assert.deepStrictEqual(res.leaks, [], JSON.stringify(res.leaks));
  const dump = JSON.stringify([await q('SELECT * FROM users'), await q('SELECT * FROM request_records'), await q('SELECT * FROM md_meetings'), await q('SELECT * FROM md_issues'), await q('SELECT * FROM system_log')]);
  for (const s of ['Awa', 'Traoré', 'Koffi', 'Moussa', 'corp.example.com', '+225', '10.0.0.5', '45001', '106803000000555001']) assert.ok(!dump.includes(s), 'survived: ' + s);
  assert.deepStrictEqual({ u: await count('users'), r: await count('request_records'), m: await count('md_meetings'), i: await count('md_issues') }, before, 'counts preserved');
  const rr = (await q("SELECT site, request_status, created_time, udf_json FROM request_records"))[0];
  assert.deepStrictEqual([rr.site, rr.request_status, rr.created_time], ['HOUNDE', 'Closed', '2026-07-02T08:00:00Z']);
  assert.equal(JSON.parse(rr.udf_json)['UDF:Priority'], 'High');
  const P = A.makePseudo(KEY);
  const champ = (await q('SELECT champion FROM md_issues'))[0].champion;
  assert.equal(champ, P.person('Awa Traoré')); assert.equal((await q("SELECT full_name FROM users WHERE username = ?", [P.username('awa.t')]))[0].full_name, champ, 'same person → same pseudonym across tables');
  const md = A.report(res);
  assert.match(md, /Columns not covered/); assert.match(md, /Residual scan[\s\S]*- none/);
  await q('ROLLBACK');
});

test('refuses to finish when a leak remains in a column it does not know (reported by table.column, never by value)', async () => {
  await q('BEGIN');
  await q("CREATE TABLE zz_extra (note TEXT)"); await q("INSERT INTO zz_extra VALUES ('ring 07 08 09 10 11 or mail boss@corp.example.com')");
  const res = await A.anonymize(q, { key: KEY });
  assert.deepStrictEqual(res.leaks.map((l) => l.table + '.' + l.column + ':' + l.kind).sort(), ['zz_extra.note:email']);
  const md = A.report(res);
  assert.match(md, /REFUSED/); assert.match(md, /zz_extra\.note: 1 row\(s\) with a email/); assert.ok(!md.includes('boss@'), 'never prints the value');
  assert.ok(res.uncovered.includes('zz_extra.note'));
  await q('ROLLBACK');
});
