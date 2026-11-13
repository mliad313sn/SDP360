'use strict';
// P5 / goal B2 — aging reminders over the three site action sources (meeting actions md_actions, inspection corrective
// actions insp_actions, weekly-report follow-ups action_items), IN-APP only, reusing the A05 plumbing (coordinatorsOf for
// recipients, engagementStore.notify, the notifications table as dedupe log) like the B9 weekly nudges.
//
// Inert unless BOTH action_aging_reminders_enabled = '1' (default '0', a human decision) AND action_aging_reminder_days
// is set (the policy is not decided — no default delay is invented). Nothing while notifications_stop = '1'.
//
// Rule (pure buildAgingReminders): an OPEN action with a due date that is `late_days` past due (site-agnostic UTC day):
//   • late_days >= reminderDays                      → level 'remind'   to the named owner when the owner text matches
//                                                      ONE active account holding the site; otherwise to the coordinators
//   • escalationDays set AND late_days >= escalationDays → level 'escalate' to the site's coordinators (active editors)
// An action with no due date is never reminded (age unknown ≠ late). Dedupe key `B2:<level>:<source>:<id>:<due>` —
// each level at most once per action and due date (a new due date = a new cycle). No recipient = counted, never sent.
const { coordinatorsOf, leadOf } = require('./scheduleReminders');

const DAY = 864e5;
const _d = (s) => (s && /^\d{4}-\d{2}-\d{2}/.test(String(s)) ? String(s).slice(0, 10) : null);
const _low = (v) => String(v == null ? '' : v).trim().toLowerCase();
const _active = (u) => u && u.active !== 0 && u.active !== false;
const _sitesOf = (u) => [u.site_id, ...(u.extra_site_ids || []), ...(u.site_ids || [])].filter((x) => x != null).map(Number);
const LINK = { meetings: 'meetings-actions.html', inspections: 'inspection-actions.html', report: 'site-actions.html' };

/** The ONE active account of this site the owner text names (username / e-mail / full name), else null. */
function ownerAccount(owner, siteId, users) {
  const o = _low(owner); if (!o) return null;
  const hits = (users || []).filter((u) => _active(u) && _sitesOf(u).includes(Number(siteId)) && [u.username, u.email, u.full_name].map(_low).includes(o));
  return hits.length === 1 ? Number(hits[0].id) : null;
}

/**
 * @param {object} i { now, reminderDays, escalationDays, users, sites:[{id,name}],
 *   actions:[{ source: meetings|inspections|report, id, site_id, title, owner, due_date, site_code }] }
 * @returns {{ items: Array, off: boolean }}
 */
function buildAgingReminders(i = {}) {
  const rem = leadOf(i.reminderDays);
  if (rem == null) return { items: [], off: true };
  const esc = leadOf(i.escalationDays);
  const today = (i.now instanceof Date ? i.now : new Date(i.now || Date.now())).toISOString().slice(0, 10);
  const sites = new Map((i.sites || []).map((s) => [Number(s.id), s]));
  const items = [];
  for (const a of i.actions || []) {
    const due = _d(a && a.due_date); if (!due || a.site_id == null || a.id == null) continue;
    const late = Math.round((Date.parse(today + 'T00:00:00Z') - Date.parse(due + 'T00:00:00Z')) / DAY);
    if (!(late >= rem)) continue;
    const site = sites.get(Number(a.site_id));
    const coord = coordinatorsOf(a.site_id, i.users);
    const base = { source: a.source, action_id: String(a.id), site_id: Number(a.site_id), site: site ? site.name : null, due, late_days: late,
      link: LINK[a.source] ? LINK[a.source] + (a.site_code ? '?site=' + encodeURIComponent(a.site_code) : '') : 'site-actions.html' };
    const label = String(a.title || '—').slice(0, 160);
    if (esc != null && late >= esc) {
      items.push({ ...base, level: 'escalate', key: `B2:escalate:${a.source}:${a.id}:${due}`, userIds: coord,
        title: `Escalation — action ${late} d late${site ? ' · ' + site.name : ''}`, body: `${label} — due ${due}, owner ${a.owner || 'none'}. Escalated to the site coordinator.` });
    }
    const owner = ownerAccount(a.owner, a.site_id, i.users);
    items.push({ ...base, level: 'remind', key: `B2:remind:${a.source}:${a.id}:${due}`, userIds: owner != null ? [owner] : coord, to: owner != null ? 'owner' : 'coordinators',
      title: `Reminder — action ${late} d late${site ? ' · ' + site.name : ''}`, body: `${label} — due ${due}${a.owner ? ', owner ' + a.owner : ', no owner'}.` });
  }
  return { items: items.sort((x, y) => x.due.localeCompare(y.due) || x.key.localeCompare(y.key)), off: false };
}

async function runAgingReminders({ cfg = {}, read, store, sent, now = new Date() }) {
  if (String(cfg.action_aging_reminders_enabled || '0') !== '1') return { skipped: 'action_aging_reminders_enabled' };
  if (String(cfg.notifications_stop || '0') === '1') return { skipped: 'notifications_stop' };
  if (leadOf(cfg.action_aging_reminder_days) == null) return { skipped: 'no action_aging_reminder_days' };
  const data = await read();
  const { items } = buildAgingReminders({ ...data, now, reminderDays: cfg.action_aging_reminder_days, escalationDays: cfg.action_aging_escalation_days });
  let notified = 0, already = 0, nobody = 0, escalated = 0;
  for (const it of items) {
    if (await sent(it.key)) { already++; continue; }
    if (!it.userIds.length) { nobody++; continue; }
    for (const userId of it.userIds) { await store.notify({ userId, kind: 'action_aging', title: it.title, body: it.body, link: it.link, sourceKind: 'action_aging', sourceRef: it.key }); notified++; }
    if (it.level === 'escalate') escalated++;
  }
  return { items: items.length, notified, already, nobody, escalated };
}

const _MD_DONE = require('../public/lib/statusTransfer').DONE;
/** Live readers (PostgreSQL): open dated actions of the three sources, per active site. */
function agingReaders(rdbM, { meetingsDb, inspectionDb } = {}) {
  const H = rdbM.pgHandle();
  const mdb = meetingsDb || require('../meetings-db');
  const idb = inspectionDb || require('../inspection-db');
  return {
    read: async () => {
      const sites = (await rdbM.listSites({ includeInactive: false })) || [];
      const codes = (await rdbM.listSiteModuleCodes('meetings')) || [];
      const actions = [];
      for (const s of sites) {
        const c = codes.find((x) => Number(x.site_id) === Number(s.id));
        if (c && c.code) {
          for (const a of (await mdb.listActions({ site: c.code })) || []) if (!_MD_DONE.includes(_low(a.status))) actions.push({ source: 'meetings', id: a.id, site_id: s.id, site_code: c.code, title: a.description, owner: a.owner_it || a.owner_email, due_date: a.target_date });
          for (const a of (await idb.listActions({ site: c.code })) || []) if (!['closed', 'cancelled'].includes(_low(a.status))) actions.push({ source: 'inspections', id: a.id, site_id: s.id, site_code: c.code, title: a.description, owner: a.owner, due_date: a.due_date });
        }
        for (const a of ((await rdbM.getSiteOpenReportActions(s.id)) || {}).actions || []) if (a.uid) actions.push({ source: 'report', id: a.uid, site_id: s.id, site_code: c ? c.code : null, title: a.task, owner: a.owner, due_date: a.due_date });
      }
      return { actions, sites, users: (await rdbM.listUsers()) || [] };
    },
    sent: async (key) => !!(await H.prepare(`SELECT 1 FROM notifications WHERE source_kind = 'action_aging' AND source_ref = ? LIMIT 1`).get(key)),
  };
}

module.exports = { buildAgingReminders, runAgingReminders, agingReaders, ownerAccount };
