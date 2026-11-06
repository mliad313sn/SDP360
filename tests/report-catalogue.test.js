'use strict';
// G16 — the R01–R16 / A01–A16 catalogue stays true to the code: every id present once, every file it cites
// exists, every switch it names ships with the default it states, and the published document is regenerated.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const C = require('../services/reportCatalogue');
const { DEFAULTS } = require('../services/reportConfig');
const ROOT = path.join(__dirname, '..');
const ids = (p, n) => Array.from({ length: n }, (_, i) => p + String(i + 1).padStart(2, '0'));

test('all 16 reports and 16 rules, each once, with a known status', () => {
  assert.deepStrictEqual(C.REPORTS.map((r) => r.id), ids('R', 16));
  assert.deepStrictEqual(C.RULES.map((r) => r.id), ids('A', 16));
  for (const x of [...C.REPORTS, ...C.RULES]) { assert.ok(C.STATUSES.includes(x.status), x.id); assert.ok(x.missing, x.id + ' states what is open'); }
});

test('a status other than missing cites files that exist; missing cites none', () => {
  for (const x of [...C.REPORTS, ...C.RULES]) {
    if (x.status === 'missing') assert.deepStrictEqual(x.surfaces, [], x.id);
    else assert.ok(x.surfaces.length, x.id);
    for (const s of x.surfaces) assert.ok(fs.existsSync(path.join(ROOT, s)), `${x.id}: ${s}`);
  }
});

test('every switch exists in report_config with the default the catalogue states, and outbound arms ship off', () => {
  for (const x of [...C.REPORTS, ...C.RULES]) for (const [k, v] of x.gates) assert.strictEqual(DEFAULTS[k], v, `${x.id}: ${k}`);
  for (const [k, v] of [...C.REPORTS, ...C.RULES].flatMap((x) => x.gates)) if (/_send_enabled$|^alert_external_enabled$|_notify_enabled$|^publish_cron_enabled$|^teams_sla_enabled$/.test(k)) assert.strictEqual(v, '0', k);
});

test('the published catalogue is regenerated from the module', () => {
  const doc = fs.readFileSync(path.join(ROOT, 'docs', 'sdp360', 'completion', 'REPORT-ALERT-CATALOGUE.md'), 'utf8').replace(/\r\n/g, '\n');
  assert.strictEqual(doc, C.toMarkdown(), 'run: node -e "process.stdout.write(require(\'./services/reportCatalogue\').toMarkdown())" > docs/sdp360/completion/REPORT-ALERT-CATALOGUE.md');
});

// E-R01 — every report carries a contract: owner (never invented), validation, the test proving its content and
// the trace a delivery leaves. A report that has a sender in code and is implemented/partial must name a test
// file, and every test file named must exist.
test('E-R01: every report has a contract and a report with a sender names an existing test', () => {
  for (const r of C.REPORTS) {
    for (const k of ['owner_role', 'validation', 'test', 'delivery_proof']) assert.ok(k in r, `${r.id}: ${k}`);
    assert.ok(Array.isArray(r.test), r.id);
    assert.ok(C.DELIVERY_PROOFS.includes(r.delivery_proof), `${r.id}: ${r.delivery_proof}`);
    assert.ok(typeof r.owner_role === 'string' && r.owner_role.trim(), r.id);
    for (const t of r.test) assert.ok(fs.existsSync(path.join(ROOT, t)), `${r.id}: ${t} does not exist`);
    if (C.DELIVERY[r.id] && r.status !== 'missing') assert.ok(r.test.length, `${r.id} has a sender but no test file`);
  }
});

test('E-R01: no owner is invented — every owner stays "to be named" until a person names one', () => {
  for (const r of C.REPORTS) assert.strictEqual(r.owner_role, 'to be named', r.id);
  assert.match(C.toMarkdown(), /## Report contracts \(E-R01\)/);
});
