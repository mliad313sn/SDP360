'use strict';
// P11 F-16 / F-17 — the site view's weekly "SLA compliance %" is the registered metric
// helpdesk.window_resolution_sla_pct: reports-db _computeSiteHelpdesk().res_sla_pct, on the doctrine of
// helpdesk.resolution_sla_pct (closed AND not missed ÷ closed with an SLA rule, cancelled excluded, missed under the
// configured helpdesk_sla_definition). Repro cases from the round-4 data-kpi review (sla-site.js) are pinned here.
const { test } = require('node:test');
const assert = require('node:assert');
const rdb = require('../reports-db');
global.window = global;
require('../public/lib/dashboard-shared.js');
const sh = global;

const Z = (iso) => { if (!iso) return ''; const d = new Date(iso); return d.getUTCDate() + ' ' + ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getUTCMonth()] + ' ' + d.getUTCFullYear() + ' ' + d.getUTCHours() + ':00:00'; };
const toPage = (rows) => rows.map((r) => ({ 'Request Status': r.request_status, 'Request Pending Status': String(r.pending_status), 'Overdue Status': String(r.overdue_status), 'DueBy Time': Z(r.due_by_time), 'Resolved Time': Z(r.resolved_time) }));
const ONTIME = { pending_status: 0, overdue_status: 0, request_status: 'Closed', created_time: '2026-11-16T08:00:00Z', resolved_time: '2026-11-16T10:00:00Z', due_by_time: '2026-11-16T12:00:00Z' };
const STALE = { ...ONTIME, resolved_time: '2026-11-18T10:00:00Z' };                        // flag 0 but resolved after due
const CANCELLED_FLAGGED = { pending_status: 0, overdue_status: 1, request_status: 'Cancelled', created_time: '2026-11-16T08:00:00Z', resolved_time: '', due_by_time: '2026-11-16T12:00:00Z' };

for (const mode of ['flag', 'due_vs_resolved']) {
  test(`F-16 parity with the Helpdesk resolutionSla() under definition=${mode}, cancelled excluded`, () => {
    for (const rows of [[ONTIME, ONTIME, STALE], [ONTIME, ONTIME, CANCELLED_FLAGGED], [ONTIME, ONTIME, STALE, CANCELLED_FLAGGED]]) {
      const site = rdb._computeSiteHelpdesk(rows, { slaDefinition: mode });
      const page = sh.resolutionSla(toPage(rows), { definition: mode, excludeCancelled: true });
      assert.equal(site.res_sla_pct, page.ok_pct);
      assert.equal(site.res_sla_den, page.closed);
      assert.equal(site.res_sla_definition, mode);
    }
  });
}

test('F-16 A1: stale flag — flag rule reads it on time, the resolved-after-due rule reads it missed', () => {
  assert.equal(rdb._computeSiteHelpdesk([ONTIME, ONTIME, STALE]).res_sla_pct, 100);   // default = 'flag' (server default)
  assert.equal(rdb._computeSiteHelpdesk([ONTIME, ONTIME, STALE], { slaDefinition: 'due_vs_resolved' }).res_sla_pct, 66.7);
});

test('F-16 A2: a cancelled ticket carrying the overdue flag is never counted as missed (out of the denominator)', () => {
  for (const mode of ['flag', 'due_vs_resolved']) {
    const h = rdb._computeSiteHelpdesk([ONTIME, ONTIME, CANCELLED_FLAGGED], { slaDefinition: mode });
    assert.equal(h.res_sla_pct, 100);
    assert.equal(h.res_sla_den, 2);
  }
});

test('F-16 B: closed-only rate with open overdue reported next to it; nothing closed → null, never 100', () => {
  const open = { pending_status: 1, overdue_status: 1, request_status: 'Open' };
  const b = rdb._computeSiteHelpdesk([...Array(5)].map(() => ONTIME).concat([...Array(5)].map(() => open)));
  assert.equal(b.res_sla_pct, 100);
  assert.equal(b.open_overdue, 5, 'the 5 open overdue tickets are surfaced, not hidden');
  const allOpen = rdb._computeSiteHelpdesk([...Array(4)].map(() => open));
  assert.equal(allOpen.res_sla_pct, null);
  assert.equal(allOpen.res_sla_den, 0);
  assert.equal(allOpen.open_overdue, 4);
  assert.equal(rdb._computeSiteHelpdesk([]).res_sla_pct, null);
});

test('F-16: a closed ticket with no SLA rule (flag NULL) is neither met nor missed — like the registry SQL', () => {
  const noRule = { pending_status: 0, overdue_status: null, request_status: 'Closed' };
  const h = rdb._computeSiteHelpdesk([ONTIME, noRule]);
  assert.equal(h.res_sla_den, 1);
  assert.equal(h.res_sla_pct, 100);
});

test('F-16 tooltip says what is computed (created-in-week cohort, cancelled excluded) and no longer claims the ranking rule', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'public', 'site-awareness.html'), 'utf8');
  const line = src.split(/\r?\n/).find((l) => l.includes('c_sla_def:'));
  assert.ok(/created in the week and already closed/.test(line));
  assert.ok(/cancelled tickets and tickets with no SLA rule excluded/.test(line));
  assert.ok(!/same rule as the Helpdesk ranking/.test(line));
  assert.ok(/w\.open_overdue/.test(src), 'open overdue shown next to the rate');
});

test('F-17: the route reads the reader field — no inline SLA formula in routes/siteAwareness.js', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'routes', 'siteAwareness.js'), 'utf8');
  assert.ok(!/closed_overdue\)\s*\/\s*h\.resolved/.test(src), 'no (resolved − closed_overdue) ÷ resolved formula');
  assert.ok(/res_sla_pct: h\.res_sla_pct == null \? null : h\.res_sla_pct/.test(src));
});

// ── On PostgreSQL: the window reader and the registry's monthly reader give the same Resolution SLA ──────────────
test('F-16 on PostgreSQL: getSiteHelpdeskWindow(month).res_sla_pct == getCalendarMonthlyHelpdesk().sla_res_pct (flag)', async () => {
  const g = 'F16 Parity Desk';
  await rdb.db.prepare('INSERT INTO sites (name, zoho_group) VALUES (?, ?) ON CONFLICT DO NOTHING').run('F16 Parity Site', g);
  const site = Number((await rdb.db.prepare('SELECT id FROM sites WHERE name=?').get('F16 Parity Site')).id);
  let n = 0;
  const add = (o) => rdb.db.prepare(`INSERT INTO request_records (request_id, request_status, pending_status, overdue_status, tech_group, created_time, resolved_time, due_by_time)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run('F16-' + (++n), o.status, o.pending, o.overdue, g, '2026-05-05T08:00:00Z', o.resolved || null, o.due || null);
  await add({ status: 'Closed', pending: 0, overdue: 0, resolved: '2026-05-05T09:00:00Z', due: '2026-05-05T12:00:00Z' });
  await add({ status: 'Closed', pending: 0, overdue: 0, resolved: '2026-05-05T09:00:00Z', due: '2026-05-05T12:00:00Z' });
  await add({ status: 'Closed', pending: 0, overdue: 1, resolved: '2026-05-06T09:00:00Z', due: '2026-05-05T12:00:00Z' });
  await add({ status: 'Closed', pending: 0, overdue: 0, resolved: '2026-05-06T09:00:00Z', due: '2026-05-05T12:00:00Z' });   // stale flag
  await add({ status: 'Cancelled', pending: 0, overdue: 1 });
  await add({ status: 'Closed', pending: 0, overdue: null });
  await add({ status: 'Open', pending: 1, overdue: 1 });
  const month = await rdb.getCalendarMonthlyHelpdesk(site, 2026, 5);
  const win = await rdb.getSiteHelpdeskWindow(site, '2026-05-01', '2026-05-31');
  assert.equal(win.res_sla_den, month.sla_res_den);
  assert.equal(Math.round(win.res_sla_pct), month.sla_res_pct);
  assert.equal(win.res_sla_pct, 75);
  assert.equal(win.open_overdue, 1);
  const dvr = await rdb.getSiteHelpdeskWindow(site, '2026-05-01', '2026-05-31', { slaDefinition: 'due_vs_resolved' });
  assert.equal(dvr.res_sla_pct, 50, 'the stale flag is missed under the resolved-after-due rule');
});
