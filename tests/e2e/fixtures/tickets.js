'use strict';
// D-10 — a deterministic helpdesk sample inside the week the Helpdesk page opens on (the CURRENT Zoho week, up to now):
// Houndé 12 closed with 6 late, MANA 12 closed with 1 late, plus 3 open Houndé tickets. Fictitious data only.
async function seedHelpdeskWeek(rdb) {
  const now = Date.now();
  const wk = rdb.getISOWeek(new Date(now));
  const r = rdb.getWeekRange(wk.year, wk.week);
  const t0 = Date.parse(r.start + 'T00:00:00Z'), span = Math.max(60e3, now - t0 - 60e3);
  const iso = (h) => new Date(t0 + span * (h / 60)).toISOString();   // h in 0..59 → always between week start and now
  const rows = [];
  const add = (i, site, group, closed, late) => rows.push({
    request_id: 'E2E-D10-' + i, display_id: String(910000 + i), subject: 'E2E D-10 ticket ' + i,
    request_status: closed ? 'Closed' : 'Open', pending_status: closed ? 0 : 1, overdue_status: late ? 1 : 0,
    request_type: 'Incident', template: null, service_request: 0, is_escalated: 0, reopen_count: 0, due_by_time: null,
    time_elapsed_ms: null, created_time: iso(i % 20), resolved_time: closed ? iso(30 + (i % 20)) : null,
    completed_time: closed ? iso(30 + (i % 20)) : null, responded_time: iso(1 + (i % 20)), assigned_time: iso(1 + (i % 20)),
    last_updated_time: iso(40), first_response_overdue: 'false', technician: 'E2E tech', requester: null,
    category: ['Network', 'Hardware', 'Email'][i % 3], sub_category: null, site, tech_group: group, mode: 'Web Form', impact: null,
  });
  for (let i = 0; i < 12; i++) add(i, 'HOUNDE', 'Hounde IT Agents', true, i < 6);
  for (let i = 12; i < 24; i++) add(i, 'MANA', 'Mana IT Agents', true, i === 12);
  for (let i = 24; i < 27; i++) add(i, 'HOUNDE', 'Hounde IT Agents', false, false);
  await rdb.upsertRequestBatch(rows);
  return { week: wk, range: r, total: rows.length };
}
module.exports = { seedHelpdeskWeek };
