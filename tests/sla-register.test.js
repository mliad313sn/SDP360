'use strict';
// E-I01 — SLA/OLA reconciliation register: pure aggregation + read-only CLI (injected query) + generated doc.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const R = require('../services/slaRegister');
const CLI = require('../tools/reports/sla-register');

const closed = (o) => ({ tech_group: 'G', request_status: 'Closed', pending_status: 0, ...o });

test('both resolution definitions are computed; they disagree on a stale flag', () => {
  const m = R.measure([
    closed({ overdue_status: 0, due_by_time: '2099-01-02', resolved_time: '2099-01-03' }),   // flag says ok, dvr says late
    closed({ overdue_status: 0, due_by_time: '2099-01-02', resolved_time: '2099-01-01' }),
  ]);
  assert.equal(m.n_closed, 2);
  assert.equal(m.resolution_sla_flag_pct, 100);
  assert.equal(m.resolution_sla_due_vs_resolved_pct, 50);
});

test('empty denominators are null (UNKNOWN), never 0', () => {
  const m = R.measure([{ tech_group: 'G', request_status: 'Open', pending_status: 1 }]);
  assert.equal(m.resolution_sla_flag_pct, null);
  assert.equal(m.resolution_sla_due_vs_resolved_pct, null);
  assert.equal(m.first_reply_sla_pct, null);
  assert.deepEqual(R.measure([]).n_tickets, 0);
});

test('cancelled tickets are excluded from every denominator; NULL flag is out of the flag denominator', () => {
  const m = R.measure([
    closed({ request_status: 'Cancelled', overdue_status: 1, responded_time: 'x', first_response_overdue: 'true' }),
    closed({ overdue_status: null, due_by_time: '2099-01-02', resolved_time: '2099-01-01' }),
  ]);
  assert.equal(m.n_cancelled_excluded, 1);
  assert.equal(m.n_closed, 1);
  assert.equal(m.n_responded, 0);
  assert.equal(m.resolution_sla_flag_pct, null);
  assert.equal(m.resolution_sla_due_vs_resolved_pct, 100);
});

test('first reply is late only when the flag says so', () => {
  const m = R.measure([
    { tech_group: 'G', responded_time: 'a', first_response_overdue: '' },
    { tech_group: 'G', responded_time: 'a', first_response_overdue: 'true' },
  ]);
  assert.equal(m.first_reply_sla_pct, 50);
});

test('lines per site × tech_group; unknown groups kept under (no site); OLA is UNKNOWN; profile flagged unconfirmed', () => {
  const reg = R.buildRegister({
    month: '2099-01', slaDefinition: 'bogus',
    sites: [{ id: 1, name: 'Sabodala', zoho_group: 'A, B' }],
    rows: [{ tech_group: 'A' }, { tech_group: 'B' }, { tech_group: 'Z' }],
  });
  assert.equal(reg.configured_definition, 'flag');
  assert.deepEqual(reg.lines.map((l) => `${l.site}/${l.tech_group}`), ['(no site)/Z', 'Sabodala/A', 'Sabodala/B']);
  for (const l of reg.lines) { assert.equal(l.ola, null); assert.match(l.zoho_target_profile, /to be confirmed by the ITSM owner/); }
  assert.match(reg.lines[1].zoho_target_profile, /^Enhanced/);
  assert.match(R.toMarkdown(reg), /\| UNKNOWN \|$/m);
});

test('CLI reads through the injected query only (read-only, month bound), writes nothing', async () => {
  const seen = [];
  const query = async (sql, params) => {
    seen.push(sql);
    assert.ok(/^\s*SELECT/i.test(sql), 'select only');
    if (/FROM sites/.test(sql)) return [{ id: 1, name: 'Alpha', zoho_group: 'A' }];
    if (/FROM request_records/.test(sql)) { assert.deepEqual(params, ['2099-02']); return [closed({ tech_group: 'A', overdue_status: 1 })]; }
    return [{ value: 'due_vs_resolved' }];
  };
  const { reg, md } = await CLI.main({ args: CLI.parseArgs(['--month=2099-02']), query, quiet: true });
  assert.equal(seen.length, 3);
  assert.equal(reg.configured_definition, 'due_vs_resolved');
  assert.equal(reg.lines[0].resolution_sla_flag_pct, 0);
  assert.match(md, /Month: 2099-02/);
});

test('default month = last closed month', () => {
  assert.equal(CLI.parseArgs([], new Date(Date.UTC(2026, 0, 15))).month, '2025-12');
});

test('docs/ops/SLA-REGISTER.md is the fixture output (never a production run)', () => {
  const cur = fs.readFileSync(CLI.DOC, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(cur, CLI.buildFromFixture() + '\n');
  assert.match(cur, /fictitious test fixture/);
});
