'use strict';
// C-20 (G44 G48 · A06 · PO decision R9) — PURE duty coverage engine + CSV roster parser. No DB, no clock.
//
// Coverage per site × duty family × slot: covered | gap | unknown | not_required.
//   unknown      = no roster data for the slot (no rows for the site × family, or the slot lies outside the
//                  period the roster was entered for) — NEVER green (BOUNDARIES §6).
//   gap          = inside the entered roster, fewer than `min_people` ELIGIBLE people for part or all of it.
//   not_required = the policy does not ask for anyone then (office outside business hours, holiday, mode none).
// Eligible = active account that still holds the site (or is admin tier, unscoped) — the same rule as the
// governance resolver's skip-inactive logic (governanceRoles.holderIneligible), applied ALWAYS here.
// Times are UTC: the sites run on GMT (the column stays ISO with a Z, so a timezone per site can come later).
const { holderIneligible } = require('./governanceRoles');
const { parseCsv } = require('./reconcileImport');

const FAMILIES = Object.freeze(['site-it-support', 'network-oncall']);
const MODES = Object.freeze(['24x7', 'business_hours', 'none']);
const SHIFT_HOURS = Object.freeze([6, 8, 12, 24]);
const MAX_SHIFT_HOURS = 7 * 24;
const MAX_DAYS = 31;
// R9 default: offices = business hours, mines = 24/7. Classified by name; editable per site (policy row).
const OFFICE_RE = /\b(office|bureau|london|dakar|ouaga|ouagadougou|abidjan)\b/i;
const BASE = Object.freeze({ min_people: 1, shift_start: '06:00', shift_hours: 12, business_start: '08:00', business_end: '17:00', business_days: '12345' });

const isHm = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(s || ''));
const hmMin = (s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const dayMs = (d) => Date.parse(d + 'T00:00:00Z');
const iso = (ms) => new Date(ms).toISOString();
const addDay = (d, n) => iso(dayMs(d) + n * 864e5).slice(0, 10);

function defaultPolicy(site) {
  return { ...BASE, mode: OFFICE_RE.test(String((site && site.name) || '')) ? 'business_hours' : '24x7' };
}

/** Validates an editable policy; returns { value } or { error }. */
function validatePolicy(b) {
  b = b || {};
  const v = { ...BASE, ...Object.fromEntries(Object.entries(b).filter(([, x]) => x != null && x !== '')) };
  if (!MODES.includes(v.mode)) return { error: `mode: one of ${MODES.join(', ')}` };
  v.min_people = Number(v.min_people); v.shift_hours = Number(v.shift_hours);
  if (!Number.isInteger(v.min_people) || v.min_people < 1 || v.min_people > 20) return { error: 'min_people: 1 to 20' };
  if (!SHIFT_HOURS.includes(v.shift_hours)) return { error: `shift_hours: one of ${SHIFT_HOURS.join(', ')}` };
  for (const k of ['shift_start', 'business_start', 'business_end']) if (!isHm(v[k])) return { error: `${k}: HH:MM` };
  if (hmMin(v.business_end) <= hmMin(v.business_start)) return { error: 'business_end must be after business_start' };
  v.business_days = String(v.business_days);
  if (!/^[1-7]{1,7}$/.test(v.business_days)) return { error: 'business_days: ISO weekdays 1-7, e.g. 12345' };
  return { value: { mode: v.mode, min_people: v.min_people, shift_start: v.shift_start, shift_hours: v.shift_hours,
    business_start: v.business_start, business_end: v.business_end, business_days: v.business_days } };
}

function resolvePolicy(policies, site, family) {
  const row = (policies || []).find((p) => Number(p.site_id) === Number(site.id) && p.family === family);
  if (!row) return { ...defaultPolicy(site), source: 'default' };
  const v = validatePolicy(row);
  return v.error ? { ...defaultPolicy(site), source: 'default' } : { ...v.value, source: 'site' };
}

/** Slots of a policy over `days` days from `fromDay`. `holidays` = Set of YYYY-MM-DD (site + platform). */
function slots(policy, fromDay, days, holidays) {
  const out = [];
  for (let i = 0; i < days; i++) {
    const d = addDay(fromDay, i); const t0 = dayMs(d);
    if (policy.mode === '24x7') {
      const n = 24 / policy.shift_hours; const s0 = t0 + hmMin(policy.shift_start) * 6e4;
      for (let k = 0; k < n; k++) {
        const a = s0 + k * policy.shift_hours * 36e5;
        out.push({ day: d, label: iso(a).slice(11, 16), start: iso(a), end: iso(a + policy.shift_hours * 36e5), required: true });
      }
    } else if (policy.mode === 'business_hours') {
      const wd = ((new Date(t0).getUTCDay() + 6) % 7) + 1;
      const required = policy.business_days.includes(String(wd)) && !(holidays && holidays.has(d));
      out.push({ day: d, label: policy.business_start, start: iso(t0 + hmMin(policy.business_start) * 6e4), end: iso(t0 + hmMin(policy.business_end) * 6e4), required });
    } else out.push({ day: d, label: '00:00', start: iso(t0), end: iso(t0 + 864e5), required: false });
  }
  return out;
}

// Smallest number of intervals covering every instant of [a, b) (sweep line).
function minConcurrency(a, b, intervals) {
  const ev = [];
  for (const [s, e] of intervals) { const x = Math.max(a, s), y = Math.min(b, e); if (y > x) { ev.push([x, 1], [y, -1]); } }
  ev.sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  let cur = 0, min = Infinity, t = a;
  for (const [x, d] of ev) { if (x > t) { min = Math.min(min, cur); t = x; } cur += d; }
  if (t < b) min = Math.min(min, cur);
  return min === Infinity ? 0 : min;
}

/**
 * @param {object} q { sites:[{id,name}], families:[key], policies:[rows], shifts:[{site_id,family,user_id,starts_at,ends_at}],
 *   extents?:[{site_id,family,data_from,data_to}] (all live rows ever; default = computed from `shifts`),
 *   account:{active:Set,sitesOf} | null (null → nobody is eligible), from:'YYYY-MM-DD', days, calendar:[{site_id,day}] }
 */
function coverage(q) {
  const days = Math.max(1, Math.min(MAX_DAYS, Number(q.days) || 7));
  const fams = q.families && q.families.length ? q.families : FAMILIES;
  const shifts = (q.shifts || []).map((s) => ({ ...s, a: Date.parse(s.starts_at), b: Date.parse(s.ends_at) })).filter((s) => s.b > s.a);
  const extentOf = (siteId, fam) => {
    const e = (q.extents || []).find((x) => Number(x.site_id) === Number(siteId) && x.family === fam);
    if (e) return e.data_from ? [Date.parse(e.data_from), Date.parse(e.data_to)] : null;
    const own = shifts.filter((s) => Number(s.site_id) === Number(siteId) && s.family === fam);
    return own.length ? [Math.min(...own.map((s) => s.a)), Math.max(...own.map((s) => s.b))] : null;
  };
  const why = (u, siteId) => (q.account ? holderIneligible(q.account, u, siteId) : 'account_unknown');
  const summary = { covered: 0, gap: 0, unknown: 0, not_required: 0 };
  const rows = [];
  for (const site of q.sites || []) {
    const hol = new Set((q.calendar || []).filter((c) => c.site_id == null || Number(c.site_id) === Number(site.id)).map((c) => String(c.day).slice(0, 10)));
    for (const fam of fams) {
      const policy = resolvePolicy(q.policies, site, fam);
      const ext = extentOf(site.id, fam);
      const own = shifts.filter((s) => Number(s.site_id) === Number(site.id) && s.family === fam);
      const ok = own.filter((s) => !why(s.user_id, site.id));
      const out = slots(policy, q.from, days, hol).map((sl) => {
        const a = Date.parse(sl.start), b = Date.parse(sl.end);
        const touching = (list) => list.filter((s) => s.b > a && s.a < b);
        const base = { day: sl.day, label: sl.label, start: sl.start, end: sl.end };
        if (!sl.required) return { ...base, status: 'not_required', people: [] };
        if (!ext || a < ext[0] || b > ext[1]) return { ...base, status: 'unknown', people: [] };
        const people = [...new Set(touching(ok).map((s) => Number(s.user_id)))];
        if (minConcurrency(a, b, touching(ok).map((s) => [s.a, s.b])) >= policy.min_people) return { ...base, status: 'covered', people };
        const skipped = touching(own).filter((s) => why(s.user_id, site.id));
        return { ...base, status: 'gap', people, reason: skipped.length && !people.length ? 'inactive_holder' : people.length ? 'partial' : 'no_one' };
      });
      for (const s of out) summary[s.status]++;
      rows.push({ site_id: Number(site.id), site: site.name, family: fam, policy,
        data_from: ext ? iso(ext[0]) : null, data_to: ext ? iso(ext[1]) : null, slots: out });
    }
  }
  return { from: q.from, days, rows, summary };
}

/** Normalise a time to ISO UTC; no offset given = UTC (the sites are GMT). null when unreadable. */
function normTime(v) {
  const s = String(v == null ? '' : v).trim();
  const d = s.slice(0, 10), sep = s[10], hm = s.slice(11, 16);
  let rest = s.slice(16).toUpperCase();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || (sep !== ' ' && sep !== 'T') || !isHm(hm)) return null;
  let sec = ':00';
  if (/^:\d{2}/.test(rest)) { sec = rest.slice(0, 3); rest = rest.slice(3); }
  if (/^\.\d{1,3}/.test(rest)) rest = rest.replace(/^\.\d{1,3}/, '');
  if (rest !== '' && rest !== 'Z' && !/^[+-]\d{2}:\d{2}$/.test(rest)) return null;
  const t = Date.parse(`${d}T${hm}${sec}${rest || 'Z'}`);
  return Number.isFinite(t) ? iso(t) : null;
}

/** Validate one shift (manual entry or CSV row) against the lookups. Returns { value } | { error }. */
function validateShift(b, { siteIds, families, userIds } = {}) {
  b = b || {};
  const site_id = Number(b.site_id), user_id = Number(b.user_id);
  if (!Number.isInteger(site_id) || (siteIds && !siteIds.has(site_id))) return { error: 'unknown site' };
  if (!(families || FAMILIES).includes(b.family)) return { error: `unknown duty family "${b.family}"` };
  if (!Number.isInteger(user_id) || (userIds && !userIds.has(user_id))) return { error: 'unknown user' };
  const starts_at = normTime(b.starts_at), ends_at = normTime(b.ends_at);
  if (!starts_at || !ends_at) return { error: 'start and end must be YYYY-MM-DD HH:MM (UTC)' };
  const h = (Date.parse(ends_at) - Date.parse(starts_at)) / 36e5;
  if (h <= 0) return { error: 'end must be after start' };
  if (h > MAX_SHIFT_HOURS) return { error: `a shift lasts at most ${MAX_SHIFT_HOURS} h` };
  return { value: { site_id, family: b.family, user_id, starts_at, ends_at } };
}

const hk = (h) => String(h).replace(/^﻿/, '').trim().toLowerCase().replace(/[\s_-]+/g, '');
const COLS = { site: ['site', 'siteid', 'sitename'], family: ['family', 'dutyfamily', 'duty'], user: ['user', 'username', 'userid', 'email', 'login'],
  start: ['start', 'startsat', 'starttime', 'from'], end: ['end', 'endsat', 'endtime', 'to'] };

/** Header-driven CSV → { rows, errors } (dry run: nothing is written). Lines are 1-based file lines. */
function parseRosterCsv(text, { sites = [], users = [], families = FAMILIES } = {}) {
  const { header, rows } = parseCsv(text);
  const pick = {};
  for (const [k, names] of Object.entries(COLS)) { const h = header.find((x) => names.includes(hk(x))); if (h) pick[k] = h; }
  const missing = Object.keys(COLS).filter((k) => !pick[k]);
  if (missing.length) return { rows: [], errors: [{ line: 1, error: `missing column(s): ${missing.join(', ')} — found: ${header.join(', ') || '(none)'}` }] };
  const low = (s) => String(s || '').trim().toLowerCase();
  const siteOf = (v) => { const n = Number(v); const s = sites.find((x) => (Number.isInteger(n) && Number(x.id) === n) || low(x.name) === low(v)); return s ? Number(s.id) : null; };
  const userOf = (v) => { const n = Number(v); const u = users.find((x) => (Number.isInteger(n) && String(v).trim() !== '' && Number(x.id) === n) || low(x.username) === low(v) || (x.email && low(x.email) === low(v))); return u ? Number(u.id) : null; };
  const out = [], errors = [], seen = new Map();
  rows.forEach((r, i) => {
    const line = i + 2;
    const site_id = siteOf(r[pick.site]); if (site_id == null) return errors.push({ line, error: `unknown site "${r[pick.site]}"` });
    const user_id = userOf(r[pick.user]); if (user_id == null) return errors.push({ line, error: `unknown user "${r[pick.user]}"` });
    const v = validateShift({ site_id, user_id, family: String(r[pick.family] || '').trim(), starts_at: r[pick.start], ends_at: r[pick.end] }, { families });
    if (v.error) return errors.push({ line, error: v.error });
    const key = [v.value.site_id, v.value.family, v.value.user_id, v.value.starts_at, v.value.ends_at].join('|');
    if (seen.has(key)) return errors.push({ line, error: `duplicate of line ${seen.get(key)}` });
    seen.set(key, line); out.push({ line, ...v.value });
  });
  return { rows: out, errors };
}

module.exports = { FAMILIES, MODES, MAX_DAYS, defaultPolicy, validatePolicy, resolvePolicy, slots, coverage, normTime, validateShift, parseRosterCsv };
