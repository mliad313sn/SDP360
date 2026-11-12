'use strict';
// P4 / B9 — weekly report submission nudges, IN-APP only, reusing the A05 reminder plumbing
// (scheduleReminders.coordinatorsOf for recipients, engagementStore.notify, notifications table as dedupe log).
//
// Inert unless BOTH weekly_report_nudges_enabled = '1' (default '0', a human decision) AND weekly_report_due_days
// is set (the submission deadline policy is not decided — no default deadline is invented). Nothing while
// notifications_stop = '1'.
//
// Rule (pure buildNudges): the report week = the most recent Zoho week that has ENDED (end_date < today, UTC).
// due = end_date + dueDays. For every active site that has at least one coordinator and whose report for that
// week is not 'submitted':
//   • today <= due  → one 'due_soon' nudge   ("due on <date>")
//   • today >  due  → one 'overdue'  nudge   ("was due on <date>")
// Dedupe key `WR:<site>:<week>:<kind>` (source_ref) — each kind at most once per site and week, so a daily job
// sends at most two nudges per week. A site without coordinator is counted (nobody), never sent.
const { coordinatorsOf, leadOf } = require('./scheduleReminders');

const DAY = 864e5;
const _d = (s) => String(s || '').slice(0, 10);

function buildNudges({ now = new Date(), dueDays, weeks = [], sites = [], reports = [], users = [] } = {}) {
  const dd = leadOf(dueDays);
  if (dd == null) return { items: [], off: true };
  const today = (now instanceof Date ? now : new Date(now)).toISOString().slice(0, 10);
  const week = weeks.filter((w) => _d(w.end_date) && _d(w.end_date) < today).sort((a, b) => _d(b.end_date).localeCompare(_d(a.end_date)))[0];
  if (!week) return { items: [], off: false, week: null };
  const due = new Date(Date.parse(_d(week.end_date) + 'T00:00:00Z') + dd * DAY).toISOString().slice(0, 10);
  const kind = today <= due ? 'due_soon' : 'overdue';
  const items = [];
  for (const s of sites) {
    if (s.active === false || Number(s.active) === 0) continue;
    const rep = reports.find((r) => Number(r.site_id) === Number(s.id) && Number(r.week_id) === Number(week.id));
    if (rep && rep.status === 'submitted') continue;
    const state = !rep ? 'not started' : (rep.status === 'ready' ? 'complete but not submitted' : 'not submitted');
    items.push({
      key: `WR:${s.id}:${week.id}:${kind}`, kind, site_id: Number(s.id), week_id: Number(week.id), due,
      title: kind === 'overdue' ? `Weekly report ${week.label} overdue — ${s.name}` : `Weekly report ${week.label} due ${due} — ${s.name}`,
      body: `${week.label} · ${s.name}: ${state}. ${kind === 'overdue' ? 'Was due on ' + due + '.' : 'Due on ' + due + '.'}`,
      link: rep ? `reports.html?report=${rep.id}` : 'reports.html',
      userIds: coordinatorsOf(s.id, users),
    });
  }
  return { items, off: false, week: { id: Number(week.id), label: week.label, due } };
}

async function runWeeklyNudges({ cfg = {}, read, store, sent, now = new Date() }) {
  if (String(cfg.weekly_report_nudges_enabled || '0') !== '1') return { skipped: 'weekly_report_nudges_enabled' };
  if (String(cfg.notifications_stop || '0') === '1') return { skipped: 'notifications_stop' };
  if (leadOf(cfg.weekly_report_due_days) == null) return { skipped: 'no weekly_report_due_days' };
  const data = await read();
  const { items } = buildNudges({ ...data, now, dueDays: cfg.weekly_report_due_days });
  let notified = 0, already = 0, nobody = 0;
  for (const it of items) {
    if (await sent(it.key)) { already++; continue; }
    if (!it.userIds.length) { nobody++; continue; }
    for (const userId of it.userIds) { await store.notify({ userId, kind: 'weekly_report_nudge', title: it.title, body: it.body, link: it.link, sourceKind: 'weekly_report_nudge', sourceRef: it.key }); notified++; }
  }
  return { items: items.length, notified, already, nobody };
}

/** Live readers (PostgreSQL). Only the last 3 weeks are read. */
function nudgeReaders(rdbM) {
  const H = rdbM.pgHandle();
  return {
    read: async () => {
      const weeks = await H.prepare(`SELECT id, label, start_date, end_date FROM weeks ORDER BY end_date DESC LIMIT 3`).all();
      const ids = weeks.map((w) => Number(w.id));
      const reports = ids.length ? await H.prepare(`SELECT id, site_id, week_id, status FROM weekly_reports WHERE week_id IN (${ids.map(() => '?').join(',')})`).all(...ids) : [];
      return { weeks, reports, sites: (await rdbM.listSites({ includeInactive: false })) || [], users: (await rdbM.listUsers()) || [] };
    },
    sent: async (key) => !!(await H.prepare(`SELECT 1 FROM notifications WHERE source_kind = 'weekly_report_nudge' AND source_ref = ? LIMIT 1`).get(key)),
  };
}

module.exports = { buildNudges, runWeeklyNudges, nudgeReaders };
