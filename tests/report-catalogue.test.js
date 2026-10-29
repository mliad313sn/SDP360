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
