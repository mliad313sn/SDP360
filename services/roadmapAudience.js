'use strict';
// B6 (P7a, ADR-P7a-portfolio-sensitive-and-publication) — audience-scoped roadmap publication, PURE (no I/O, no clock
// unless passed). A publication is a FROZEN snapshot of the roadmap for ONE audience; nothing is recomputed on read.
//
//   AUDIENCES         site (ref = site id) · programme (ref = programme id) · committee · exec
//   canPublish(u, a, ref, roles)   site → committee, or an editor holding that site; programme / committee / exec → committee
//   buildSnapshot(view, { audience, ref, amounts })   the projects of the audience's perimeter:
//        site      projects whose sites (primary + extra) include ref, never a sensitive one
//        programme projects under the programme ref, never a sensitive one
//        committee / exec  every project (a sensitive one carries sensitive: true)
//     amounts (budget / spent / currency) are copied only when `amounts` is true — the route sets it only for the
//     committee / exec audiences, on request, when the publisher may read money (admin tier or finance-viewer).
//   canRead(u, pub, roles, now)    site → admin tier / committee / a holder of the site; programme → admin tier /
//        committee / a holder of one of the published projects' sites; committee → committee; exec → admin tier.
//        An expired or revoked publication reads as missing for everyone.
//   visible(pub, { money })        the snapshot as served: amounts only for the admin tier and finance-viewer
//        (invariant 2 — stricter than the portfolio's canSeeMoney, which also admits committee members).
//   shareable(pub)                 a public share link only for the site / programme audiences (never a snapshot that may
//        hold a sensitive project or amounts); the shared view is always served without amounts.
// An unknown date / progress stays null ("—"), never 0.
const userSites = require('./userSites');

const AUDIENCES = ['site', 'programme', 'committee', 'exec'];
const SHAREABLE = ['site', 'programme'];
const PROJECT_FIELDS = ['id', 'key', 'name', 'stage', 'status', 'confidence', 'start_date', 'end_date', 'baseline_end', 'forecast_end', 'progress_pct'];
const MONEY_FIELDS = ['budget', 'spent', 'currency'];
const isSensitive = (p) => !!p && (p.sensitive === true || Number(p.sensitive) === 1);
const nn = (v) => (v === undefined ? null : v);

function validRef(audience, ref) {
  if (!AUDIENCES.includes(audience)) return false;
  const n = Number(ref);
  if (audience === 'site' || audience === 'programme') return ref != null && ref !== '' && Number.isInteger(n) && n > 0;
  return ref == null || ref === '';
}

/** roles: { isAdmin, isCommittee, isEditor } (resolved by the route from the session). */
function canPublish(user, audience, ref, roles = {}) {
  if (!validRef(audience, ref)) return false;
  if (roles.isCommittee || roles.isAdmin) return true;
  return audience === 'site' && !!roles.isEditor && userSites.hasSite(user, Number(ref));
}

function _sitesOf(p, extra) {
  const out = [];
  const add = (v) => { const n = Number(v); if (v != null && v !== '' && Number.isInteger(n) && n > 0 && !out.includes(n)) out.push(n); };
  add(p.site_id);
  for (const r of extra || []) if (r && Number(r.project_id) === Number(p.id)) add(r.site_id);
  return out;
}

/** view = the FULL portfolio view (programmes, objectives, projects, gantt, project_sites). */
function buildSnapshot(view, { audience, ref = null, amounts = false, asOf = null } = {}) {
  if (!validRef(audience, ref)) throw Object.assign(new Error('audience must be site (with site_id), programme (with programme_id), committee or exec'), { status: 400, reason: 'INVALID_AUDIENCE' });
  const v = view || {};
  const objectives = v.objectives || [], programmes = v.programmes || [], extra = v.project_sites || [];
  const objOf = (p) => objectives.find((o) => Number(o.id) === Number(p.objective_id)) || null;
  const progOf = (o) => (o ? programmes.find((g) => Number(g.id) === Number(o.programme_id)) || null : null);
  const ganttOf = (p) => (v.gantt || []).find((g) => Number(g.id) === Number(p.id)) || {};
  const wide = audience === 'committee' || audience === 'exec';
  const projects = (v.projects || []).filter((p) => {
    if (!wide && isSensitive(p)) return false;
    if (audience === 'site') return _sitesOf(p, extra).includes(Number(ref));
    if (audience === 'programme') { const g = progOf(objOf(p)); return !!g && Number(g.id) === Number(ref); }
    return true;
  }).map((p) => {
    const o = objOf(p), g = progOf(o), gt = ganttOf(p);
    const row = {};
    for (const f of PROJECT_FIELDS) row[f] = nn(p[f]);
    row.objective = o ? { id: Number(o.id), name: o.name } : null;
    row.programme = g ? { id: Number(g.id), key: g.key, name: g.name } : null;
    row.site_ids = _sitesOf(p, extra);
    row.slip_days = gt.slip_days == null ? null : gt.slip_days;
    row.late = gt.late == null ? null : !!gt.late;
    row.milestones = (gt.milestones || []).map((m) => ({ name: m.name, due: nn(m.due), done_at: nn(m.done_at), late: m.late == null ? null : !!m.late }));
    if (wide && isSensitive(p)) row.sensitive = true;
    if (amounts) for (const f of MONEY_FIELDS) row[f] = nn(p[f]);
    return row;
  });
  const siteIds = [...new Set(projects.flatMap((p) => p.site_ids))].sort((a, b) => a - b);
  return { audience, audience_ref: wide ? null : Number(ref), as_of: asOf || v.as_of || null, has_amounts: !!amounts, projects, site_ids: siteIds };
}

function isLive(pub, now = new Date()) {
  if (!pub || pub.revoked_at) return false;
  if (pub.expires_at && String(pub.expires_at) <= (now instanceof Date ? now.toISOString() : String(now))) return false;
  return true;
}

/** roles: { isAdmin, isCommittee }. */
function canRead(user, pub, roles = {}, now = new Date()) {
  if (!isLive(pub, now)) return false;
  if (pub.audience === 'exec') return !!roles.isAdmin;
  if (roles.isAdmin || roles.isCommittee) return true;
  if (pub.audience === 'site') return userSites.hasSite(user, Number(pub.audience_ref));
  if (pub.audience === 'programme') return (pub.site_ids || []).some((s) => userSites.hasSite(user, Number(s)));
  return false;   // committee
}

/** The snapshot as served. money = admin tier or finance-viewer (never the share view). */
function visible(snapshot, { money = false } = {}) {
  if (!snapshot) return snapshot;
  if (money && snapshot.has_amounts) return snapshot;
  return { ...snapshot, projects: (snapshot.projects || []).map((p) => { const q = { ...p }; for (const f of MONEY_FIELDS) delete q[f]; return q; }), has_amounts: false, amounts_hidden: !!snapshot.has_amounts };
}

const shareable = (pub) => !!pub && SHAREABLE.includes(pub.audience);

/** Share-link lifetime in hours: the request (default 72, 1..2160) capped at the publication's expiry. Null = expired. */
function shareTtlHours(pub, requested, now = new Date()) {
  let h = Math.min(24 * 90, Math.max(1, Math.floor(Number(requested)) || 72));
  if (pub && pub.expires_at) {
    const left = (Date.parse(pub.expires_at) - now.getTime()) / 3600000;
    if (!(left > 0)) return null;
    h = Math.max(1, Math.min(h, Math.floor(left) || 1));
  }
  return h;
}

/** Plain HTML of a snapshot for the public share view: no script, no amounts, everything escaped. */
function renderHtml(pub, snapshot) {
  const esc = (x) => String(x == null ? '' : x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const d = (x) => (x == null || x === '' ? '—' : esc(x));
  const s = visible(snapshot, { money: false });
  const rows = (s.projects || []).map((p) => `<tr><td>${esc(p.key)}</td><td>${esc(p.name)}</td><td>${d(p.programme && p.programme.name)}</td><td>${d(p.stage)}</td><td>${d(p.start_date)}</td><td>${d(p.end_date)}</td><td>${d(p.baseline_end)}</td><td>${p.progress_pct == null ? '—' : esc(p.progress_pct) + ' %'}</td><td>${(p.milestones || []).map((m) => `${esc(m.name)} (${d(m.due)}${m.done_at ? ' ✓' : m.late ? ' late' : ''})`).join('<br>') || '—'}</td></tr>`).join('');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>${esc(pub.title)}</title></head><body style="font-family:Calibri,Arial;font-size:13px;color:#1F2A33">`
    + `<h1 style="font-size:20px">${esc(pub.title)}</h1><p style="color:#6b7785">Published roadmap · audience ${esc(pub.audience)} · frozen ${d(String(pub.created_at || '').slice(0, 16).replace('T', ' '))} UTC · "—" = not known, never 0</p>`
    + `<table style="border-collapse:collapse" border="1" cellpadding="4"><thead><tr><th>Key</th><th>Project</th><th>Programme</th><th>Stage</th><th>Start</th><th>End</th><th>Baseline end</th><th>Progress</th><th>Milestones</th></tr></thead><tbody>${rows || '<tr><td colspan="9">No project in this roadmap.</td></tr>'}</tbody></table></body></html>`;
}

module.exports = { AUDIENCES, SHAREABLE, validRef, canPublish, buildSnapshot, isLive, canRead, visible, shareable, shareTtlHours, renderHtml };
