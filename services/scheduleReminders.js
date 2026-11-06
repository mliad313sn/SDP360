'use strict';
// E-R06 (audit R-06, catalogue A05) — "meeting / incubation / inspection approaching its schedule": IN-APP reminders
// to the site coordinator(s). PURE: no database, no clock — the job (engagementJobs.bindJobs().reminders) reads the
// rows and hands them here with `now`.
//
// Schedules that really exist in the data (site_calendar is off-days, NOT a schedule):
//   • md_meetings.next_meeting_date   the next PV agreed in a departmental meeting / incubation session
//   • meeting_cadences                weekday (+ time) of a recurring governance meeting, inside its effective range
//   • last inspection per site        due = last inspection date + inspectionIntervalDays (null = not reminded)
// Rules: leadDays null / empty / negative = OFF (nothing at all). A date in the past is never reminded (it is late —
// another rule's business). "Today" is the SITE's local date (services/siteTimeZone, behind site_local_calendar);
// UTC otherwise. One reminder per item and due date: the key `A05:<kind>:<ref>:<due>` is the dedup id (the job skips
// keys already notified). Recipients = active editors of the site (the coordinators); none = counted, not sent.

const DAY = 864e5;
const _blank = (v) => v == null || String(v).trim() === '';
const _iso = (v) => { if (_blank(v)) return null; const s = String(v); return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null; };
const _ms = (d) => Date.parse(d + 'T00:00:00Z');
const _add = (d, n) => new Date(_ms(d) + n * DAY).toISOString().slice(0, 10);

/** Non-negative integer, else null (= off). */
function leadOf(v) { if (_blank(v)) return null; const n = Number(v); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null; }

/** YYYY-MM-DD of `now` in time zone tz (null = UTC). */
function localDay(now, tz) {
  const d = now instanceof Date ? now : new Date(now);
  if (!tz) return d.toISOString().slice(0, 10);
  try {
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d);
    const g = (t) => p.find((x) => x.type === t).value; return `${g('year')}-${g('month')}-${g('day')}`;
  } catch (_) { return d.toISOString().slice(0, 10); }
}

/** Next date (>= today) a cadence meets: ISO weekday 1 = Monday … 7 = Sunday (cockpit); null outside its effective range. */
function nextCadenceDate(c, today) {
  const iso = Number(c && c.weekday); if (!Number.isInteger(iso) || iso < 1 || iso > 7) return null;
  const wd = iso % 7;   // JS getUTCDay: 0 = Sunday
  const from = _iso(c.effective_from), to = _iso(c.effective_to);
  let d = today; if (from && from > d) d = from;
  const dow = new Date(_ms(d)).getUTCDay(); d = _add(d, (wd - dow + 7) % 7);
  if (to && d > to) return null;
  return d;
}

const _isEditor = (u) => u && u.active !== 0 && u.active !== false && (u.role === 'editor' || (Array.isArray(u.roles) && u.roles.includes('editor')));
const _sitesOf = (u) => [u.site_id, ...(u.extra_site_ids || []), ...(u.site_ids || [])].filter((x) => x != null).map(Number);
/** Active editors of the site = its coordinators. */
function coordinatorsOf(siteId, users) { return (users || []).filter((u) => _isEditor(u) && _sitesOf(u).includes(Number(siteId))).map((u) => Number(u.id)); }

/**
 * @param {object} i  { meetings:[{id, site_id, department, reference, next_meeting_date, incubation}], cadences:[{id, key, name, site_id, weekday, time_local, effective_from, effective_to, active}],
 *                     inspections:[{site_id, last_date}], sites:[{id, name, time_zone, country}], users, now, leadDays, inspectionIntervalDays, tzEnabled }
 * @returns {{ items: Array, off: boolean }}
 */
function buildReminders(i = {}) {
  const lead = leadOf(i.leadDays);
  if (lead == null) return { items: [], off: true };
  const sites = new Map((i.sites || []).map((s) => [Number(s.id), s]));
  const tz = (sid) => require('./siteTimeZone').siteTimeZone(sites.get(Number(sid)), i.tzEnabled);
  const items = []; const seen = new Set();
  const push = (kind, ref, siteId, due, title, link) => {
    if (siteId == null || !due) return;
    const today = localDay(i.now || new Date(), tz(siteId));
    if (due < today) return;
    const inDays = Math.round((_ms(due) - _ms(today)) / DAY); if (inDays > lead) return;
    const key = `A05:${kind}:${ref}:${due}`; if (seen.has(key)) return; seen.add(key);
    const site = sites.get(Number(siteId));
    items.push({ key, kind, site_id: Number(siteId), site: site ? site.name : null, due, in_days: inDays, title,
      body: `${title} — ${inDays === 0 ? 'today' : `in ${inDays} d`} (${due})${site ? ' · ' + site.name : ''}`, link, userIds: coordinatorsOf(siteId, i.users) });
  };
  for (const m of i.meetings || []) {
    const due = _iso(m.next_meeting_date); if (!due) continue;
    const label = m.incubation ? 'Incubation session' : 'Departmental meeting';
    push(m.incubation ? 'incubation' : 'meeting', `${m.site_id}:${String(m.department || '').toLowerCase()}`, m.site_id, due, `A05 — ${label}${m.department ? ' (' + m.department + ')' : ''} scheduled`, m.id != null ? `meeting.html?id=${m.id}` : 'meetings.html');
  }
  for (const c of i.cadences || []) {
    if (c.active === false || Number(c.active) === 0 || c.site_id == null) continue;
    const today = localDay(i.now || new Date(), tz(c.site_id));
    push('cadence', String(c.key || c.id), c.site_id, nextCadenceDate(c, today), `A05 — ${c.name || 'Governance meeting'}${c.time_local ? ' at ' + c.time_local : ''}`, 'cockpit.html');
  }
  const every = leadOf(i.inspectionIntervalDays);
  if (every != null && every > 0) for (const s of i.inspections || []) {
    const last = _iso(s.last_date); if (!last || s.site_id == null) continue;
    push('inspection', String(s.site_id), s.site_id, _add(last, every), `A05 — site inspection due (last ${last})`, 'inspections.html');
  }
  return { items: items.sort((a, b) => a.due.localeCompare(b.due) || a.key.localeCompare(b.key)), off: false };
}

module.exports = { buildReminders, nextCadenceDate, localDay, coordinatorsOf, leadOf };
