'use strict';
// The committee's values in ONE reviewed file, applied in one command (tools/governance/apply-values.js).
// PURE planning: names → ids, every row checked with the same validators the admin screens use, and a
// list of errors. Nothing is written here; nothing is applied when any row is wrong.
//
// File shape (all sections optional; people by username or e-mail, sites by name):
// {
//   "reason": "Committee meeting 2026-11-05, minutes ref …",
//   "policies":     [{ "scope": "global" | "site:<name>" | "country:BF" | "bu:WA", "key": "...", "value": ... }],
//   "site_groups":  [{ "site": "Hounde", "country": "BF", "business_unit": "WA" }],
//   "roles":        [{ "role": "handoffs.escalation_target", "site": "Hounde" | null, "person": "username", "from": "YYYY-MM-DD", "to": null }],
//   "deputies":     [{ "person": "u1", "deputy": "u2", "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" }],
//   "matrix":       [{ "register": "handoffs", "severity": "*", "site": null, "after_days": 0, "role": "..." }],
//   "calendar":     [{ "site": null | "Hounde", "day": "YYYY-MM-DD", "kind": "holiday" | "shutdown", "label": "..." }],
//   "kpi_targets":  [{ "metric": "meetings.overdue_issues", "site": null | "Hounde", "target": 2, "from": "YYYY-MM-DD" }],
//   "site_codes":   [{ "site": "Hounde", "module": "tracker" | "inspection" | "meetings", "code": "HGO" }],
//   "switches":     { "site_codes_from_registry": "0"|"1", "handoff_notify_enabled": "0"|"1", "commitment_notify_enabled": "0"|"1" }
// }
const R = require('./governanceRoles');
const GP = require('./governancePolicy');

const SWITCHES = ['site_codes_from_registry', 'handoff_notify_enabled', 'commitment_notify_enabled', 'handoffs_enabled', 'commitments_enabled'];
const low = (s) => String(s == null ? '' : s).trim().toLowerCase();

function plan(file, { users = [], sites = [], metricKeys = [] } = {}) {
  const errors = []; const out = { reason: String(file && file.reason || '').trim(), policies: [], site_groups: [], roles: [], deputies: [], matrix: [], calendar: [], kpi_targets: [], site_codes: [], switches: {} };
  const err = (section, i, msg) => errors.push(`${section}[${i}]: ${msg}`);
  if (out.reason.length < 10) errors.push('reason: a reason of 10+ characters (e.g. the committee minutes reference) is required');
  const person = (ref) => { const k = low(ref); const u = users.find((x) => low(x.username) === k || (x.email && low(x.email) === k)); return u && u.active !== 0 && u.active !== false ? Number(u.id) : null; };
  const site = (ref) => { if (ref == null || ref === '') return null; const k = low(ref); const s = sites.find((x) => low(x.name) === k || String(x.id) === String(ref)); return s ? Number(s.id) : undefined; };
  const f = file || {};
  (f.policies || []).forEach((p, i) => {
    let scope = String(p.scope || 'global');
    const m = /^site:(.+)$/.exec(scope);
    if (m) { const sid = site(m[1]); if (sid == null) return err('policies', i, `unknown site "${m[1]}"`); scope = `site:${sid}`; }
    try { GP.parseScope(scope); } catch (e) { return err('policies', i, e.message); }
    const p0 = GP.BY_KEY.get(p.key); if (!p0) return err('policies', i, `unknown rule ${p.key}`);
    try { out.policies.push({ scope, key: p.key, value: p.value === null ? null : GP.coerce(p0, p.value) }); } catch (e) { err('policies', i, e.message); }
  });
  (f.site_groups || []).forEach((g, i) => {
    const sid = site(g.site); if (sid == null) return err('site_groups', i, `unknown site "${g.site}"`);
    const c = g.country ? GP.groupCode(g.country) : null, b = g.business_unit ? GP.groupCode(g.business_unit) : null;
    if ((g.country && !c) || (g.business_unit && !b)) return err('site_groups', i, 'codes are 2 to 16 letters, digits, - or _');
    out.site_groups.push({ site_id: sid, country: c, business_unit: b });
  });
  (f.roles || []).forEach((r, i) => {
    const sid = r.site == null ? null : site(r.site); if (sid === undefined) return err('roles', i, `unknown site "${r.site}"`);
    const uid = person(r.person); if (uid == null) return err('roles', i, `no active account "${r.person}"`);
    const row = { role: r.role, site_id: sid, user_id: uid, effective_from: r.from, effective_to: r.to || null, reason: out.reason };
    const c = R.validateAssignment(row); if (c) return err('roles', i, c.error); out.roles.push(row);
  });
  (f.deputies || []).forEach((d, i) => {
    const a = person(d.person), b = person(d.deputy); if (a == null || b == null) return err('deputies', i, 'unknown or inactive account');
    const row = { user_id: a, deputy_id: b, start_date: d.from, end_date: d.to, reason: out.reason };
    const c = R.validateDeputy(row); if (c) return err('deputies', i, c.error); out.deputies.push(row);
  });
  (f.matrix || []).forEach((m, i) => {
    const sid = m.site == null ? null : site(m.site); if (sid === undefined) return err('matrix', i, `unknown site "${m.site}"`);
    const row = { register: m.register, severity: m.severity || '*', site_id: sid, after_days: m.after_days == null ? 0 : m.after_days, role: m.role, reason: out.reason };
    const c = R.validateMatrix(row); if (c) return err('matrix', i, c.error); out.matrix.push(row);
  });
  (f.calendar || []).forEach((d, i) => {
    const sid = d.site == null ? null : site(d.site); if (sid === undefined) return err('calendar', i, `unknown site "${d.site}"`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d.day || ''))) return err('calendar', i, 'day must be YYYY-MM-DD');
    if (!['holiday', 'shutdown'].includes(d.kind || 'holiday')) return err('calendar', i, 'kind must be holiday or shutdown');
    if (String(d.label || '').trim().length < 3) return err('calendar', i, 'name the day (3+ characters)');
    out.calendar.push({ site_id: sid, day: d.day, kind: d.kind || 'holiday', label: d.label });
  });
  (f.kpi_targets || []).forEach((k, i) => {
    if (!metricKeys.includes(k.metric)) return err('kpi_targets', i, `unknown metric ${k.metric}`);
    const sid = k.site == null ? null : site(k.site); if (sid === undefined) return err('kpi_targets', i, `unknown site "${k.site}"`);
    if (!Number.isFinite(Number(k.target))) return err('kpi_targets', i, 'target must be a number');
    out.kpi_targets.push({ metric_key: k.metric, site_id: sid, target: Number(k.target), effective_from: k.from, reason: out.reason });
  });
  (f.site_codes || []).forEach((s, i) => {
    const sid = site(s.site); if (sid == null) return err('site_codes', i, `unknown site "${s.site}"`);
    if (!['tracker', 'inspection', 'meetings'].includes(s.module)) return err('site_codes', i, 'module must be tracker, inspection or meetings');
    const code = String(s.code || '').trim().toUpperCase(); if (!/^[A-Z0-9_-]{2,16}$/.test(code)) return err('site_codes', i, 'bad code');
    out.site_codes.push({ site_id: sid, module: s.module, code });
  });
  for (const [k, v] of Object.entries(f.switches || {})) {
    if (!SWITCHES.includes(k)) { errors.push(`switches.${k}: not a switch this tool sets`); continue; }
    if (!['0', '1'].includes(String(v))) { errors.push(`switches.${k}: "0" or "1"`); continue; }
    out.switches[k] = String(v);
  }
  return { ok: errors.length === 0, errors, plan: out };
}
module.exports = { plan, SWITCHES };
