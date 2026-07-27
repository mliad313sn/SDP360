'use strict';
// demande 1 — helpdeskWeekly binder (6 ISO weeks ending at as-of, built from the
// same getSiteHelpdeskWindow the block uses) + siteReportData carrying it.
const { test } = require('node:test');
const assert = require('node:assert');
const { buildSiteReportDeps, _lastIsoWeeks } = require('../services/siteReportDeps');
const { siteReportData } = require('../services/siteReport');

test('_lastIsoWeeks: 6 Monday-aligned ascending weeks ending at as-of', () => {
  const ws = _lastIsoWeeks('2026-07-24', 6); // Fri 2026-07-24 → week of Mon 2026-07-20
  assert.equal(ws.length, 6);
  for (const w of ws) {
    assert.match(w.label, /^W\d{1,2} \d{4}$/);
    assert.match(w.from, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(w.from <= w.to);
    assert.equal(new Date(w.from + 'T00:00:00Z').getUTCDay(), 1, 'from is a Monday');
  }
  // ascending
  for (let i = 1; i < ws.length; i++) assert.ok(ws[i - 1].from < ws[i].from);
  const last = ws[5];
  assert.ok(last.from <= '2026-07-24' && '2026-07-24' <= last.to, 'last week contains as-of');
  assert.equal(last.from, '2026-07-20');
});

test('helpdeskWeekly binder maps each week + missed_pct (null when inbound 0)', async () => {
  let call = 0;
  const deps = buildSiteReportDeps({
    meetingsDb: {}, inspectionDb: {},
    reportsDb: {
      getSiteIdByModuleCode: async () => ({ site_id: 1, name: 'X', zoho_group: 'G' }),
      getSiteHelpdeskWindow: async () => (call++ === 0
        ? { created: 0, resolved: 0, sla_overdue: 0 }              // empty week → missed null
        : { created: 10, resolved: 8, sla_overdue: 2 }),           // → 20.0%
    },
  });
  const rows = await deps.helpdeskWeekly('HGO', { year: 2026, month: 7 });
  assert.equal(rows.length, 6);
  assert.equal(rows[0].inbound, 0);
  assert.equal(rows[0].missed_pct, null, 'no inbound → no rate (never a fake 0)');
  assert.equal(rows[1].inbound, 10);
  assert.equal(rows[1].closed, 8);
  assert.equal(rows[1].missed_pct, 20);
});

test('helpdeskWeekly null when the site is unresolved', async () => {
  const deps = buildSiteReportDeps({
    meetingsDb: {}, inspectionDb: {},
    reportsDb: { getSiteIdByModuleCode: async () => null, getSiteHelpdeskWindow: async () => ({}) },
  });
  assert.equal(await deps.helpdeskWeekly('NOPE', { year: 2026, month: 7 }), null);
});

test('siteReportData carries helpdesk_weekly (null when binder absent)', async () => {
  const shape = [{ label: 'W29 2026', inbound: 5, closed: 4, overdue: 1, missed_pct: 20 }];
  const withB = await siteReportData('HGO', { year: 2026, month: 7 }, { helpdeskWeekly: async () => shape });
  assert.deepEqual(withB.helpdesk_weekly, shape);
  const noB = await siteReportData('HGO', { year: 2026, month: 7 }, {});
  assert.equal(noB.helpdesk_weekly, null);
});
