'use strict';
// P05 — the calendar-month helpdesk reader made ONE scan of request_records instead of eleven (the
// all-sites monthly deck read it per site: 22 s on the 100 000-ticket rehearsal set). The values below
// were captured from the eleven-statement reader on this fixture: the single scan must return them
// byte-for-byte, and must touch request_records at most once.
process.env.REPORTS_BACKEND = 'postgres';
const _os = require('os'), _fs = require('fs'), _path = require('path');
process.env.SDP_DATA_DIR = process.env.SDP_DATA_DIR || _fs.mkdtempSync(_path.join(_os.tmpdir(), 'p05scan-'));
process.env.DASH_USER = process.env.DASH_USER || 'pgtest-admin';
process.env.DASH_PASS = process.env.DASH_PASS || 'pgtest-pass-0000';
const { test } = require('node:test');
const assert = require('node:assert');
const { provisionTestDb, dropTestDb } = require('./pg-helpers');

const _req = (o) => ({ request_id: null, display_id: null, subject: null, request_status: null,
  pending_status: 1, overdue_status: 0, request_type: null, service_request: 0, is_escalated: 0,
  reopen_count: 0, due_by_time: null, time_elapsed_ms: null, created_time: null, resolved_time: null,
  completed_time: null, responded_time: null, assigned_time: null, last_updated_time: null,
  first_response_overdue: null, technician: null, requester: null, category: null, sub_category: null,
  site: null, tech_group: null, mode: null, impact: null, template: null, ...o });

test('calendar helpdesk reader: one scan, same figures', async (t) => {
  const ctx = await provisionTestDb(); if (!ctx) return t.skip('no pg');
  process.env.PG_URL = ctx.url;
  const rdb = require('../reports-db');
  try {
    await rdb.initPgReports();
    await require('../db/migrate').migrateAtBoot({ log: () => {} });
    const site = await require('./_pg-fresh').ensureSite(rdb, { name: 'Hounde', zoho_group: 'Hounde IT Agents, Hounde Extra' });
    const G = 'Hounde IT Agents', G2 = 'Hounde Extra', C = '2026-05-10 09:00:00', DUE = '2026-05-12T00:00:00.000Z';
    await rdb.upsertRequestBatch([
      _req({ request_id: 'A', tech_group: G, created_time: C, pending_status: 0, overdue_status: 0, request_status: 'Closed', responded_time: '2026-05-10 10:00:00', first_response_overdue: 'false', assigned_time: '2026-05-10 11:00:00', resolved_time: '2026-05-11 09:00:00' }),
      _req({ request_id: 'B', tech_group: G2, created_time: '2026-05-31 22:00:00', pending_status: 0, overdue_status: 1, request_status: 'Resolved', responded_time: '2026-05-31 23:00:00', first_response_overdue: 'TRUE', resolved_time: '2026-06-02 22:00:00' }),
      _req({ request_id: 'C', tech_group: G, created_time: C, pending_status: 0, overdue_status: 0, request_status: 'Cancelled' }),
      _req({ request_id: 'D', tech_group: G, created_time: C, pending_status: 0, overdue_status: null, request_status: 'Closed', completed_time: '2026-05-13 09:00:00' }),
      _req({ request_id: 'E', tech_group: G, created_time: C, pending_status: 1, overdue_status: 1, request_status: 'Open', first_response_overdue: 'yes' }),
      _req({ request_id: 'F', tech_group: G, created_time: C, pending_status: 1, overdue_status: 0, request_status: 'Open', due_by_time: DUE }),
      _req({ request_id: 'G', tech_group: G, created_time: C, pending_status: 1, overdue_status: 0, request_status: 'On Hold', due_by_time: DUE }),
      _req({ request_id: 'H', tech_group: G, created_time: C, pending_status: 1, overdue_status: null, request_status: 'Open', responded_time: '' }),
      _req({ request_id: 'I', tech_group: 'Other IT Agents', created_time: C, pending_status: 0, overdue_status: 1 }),
      _req({ request_id: 'J', tech_group: G, created_time: '2026-06-01 00:00:00', pending_status: 0, overdue_status: 1 }),
    ]);
    const H = rdb.pgHandle(); const orig = H.prepare.bind(H); let scans = 0;
    H.prepare = (sql) => { if (/FROM request_records/i.test(sql)) scans++; return orig(sql); };
    let r;
    try { r = await rdb.getCalendarMonthlyHelpdesk(site.id, 2026, 5, { now: new Date('2026-07-01T00:00:00Z') }); }
    finally { H.prepare = orig; }
    const want = { inbound: 8, closed: 4, close_pct: 50, sla_res_pct: 50, sla_reply_pct: 50, sla_res_den: 2, sla_reply_den: 2,
      sla_res_open_breached: 2, sla_reply_open_breached: 1, sla_res_den_incl_open: 4, sla_reply_den_incl_open: 3,
      sla_res_pct_incl_open: 25, sla_reply_pct_incl_open: 33, sla_as_of: '2026-06-01T00:00:00.000Z', sla_definition: 'closed_only',
      avg_tta_h: 2, avg_first_reply_h: 1, avg_resolution_d: 2, source: 'calendar', from: '2026-05-01', to: '2026-05-31' };
    assert.deepStrictEqual(Object.keys(r).sort(), Object.keys(want).sort());
    for (const k of Object.keys(want)) assert.strictEqual(r[k], want[k], k);
    assert.ok(scans <= 1, `request_records read ${scans} times — one scan expected`);
    const empty = await rdb.getCalendarMonthlyHelpdesk(site.id, 2025, 1);
    assert.strictEqual(empty.inbound, 0); assert.strictEqual(empty.close_pct, null); assert.strictEqual(empty.sla_res_den, null);
  } finally { await dropTestDb(ctx); }
});
