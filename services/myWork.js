'use strict';
// A-10 — "My work": per person, what each of HIS sites owes today (open/overdue actions, this week's
// report, unsigned PVs, last inspection, empty tracker cells, B-08 benefit reviews due). PURE: the route (routes/myWork.js)
// resolves the user's sites and injects the readers; this module only shapes.
//   • every block is computed on its own: a missing reader or a reader that throws → null
//     ("— not measured" on the page), never 0;
//   • the action counts come from the same composition as the Site obligations view
//     (services/siteActionsRegister.buildSiteActions → services/obligations.compose);
//   • a user with no site gets an empty list and a message — never a fleet-wide list.
const { buildSiteActions } = require('./siteActionsRegister');
const { compose } = require('./obligations');

const MAX_SITES = 12;
const MAX_UNSIGNED = 10;
const DAY = 86400000;
const day = (v) => (v ? String(v).slice(0, 10) : null);

// weekly_reports.status → words a coordinator reads. 'ready' is set by the page itself once every
// section is done; the report still waits for Submit.
function weeklyLabel(status) {
  if (status === 'ready') return 'Complete but not submitted';
  if (status === 'submitted') return 'Submitted';
  if (status === 'draft' || status === 'in_progress') return 'In progress';
  return 'Not started';
}

function daysBetween(from, to) {
  const a = Date.parse(day(from)), b = Date.parse(day(to));
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.max(0, Math.round((b - a) / DAY));
}

// IT Activity Tracker (tracker_inputs_v2 through tracker-db.loadTracker): for one tracker site code, the
// active activities whose window covers `month` (1-12) and how many of them have nothing entered
// (blank or 0) for that month. null = no tracker / no site code (not measured).
function trackerEmptyCells(D, code, year, month) {
  if (!D || !code || !(month >= 1 && month <= 12)) return null;
  const yd = (D.byYear && D.byYear[year]) || null;
  const acts = (yd && yd.activities) || D.activities;
  const tg = ((yd && yd.targets) || D.targets || {})[code];
  if (!Array.isArray(acts) || !Array.isArray(tg)) return null;
  const inp = (((D.inputs || {})[year] || {})[code]) || [];
  let total = 0, empty = 0;
  acts.forEach((a, i) => {
    if (!tg[i] || !tg[i].active) return;
    const start = Number(a.start) || 1, end = Number(a.end) || 12;
    if (month < start || month > end) return;
    total++;
    const v = Array.isArray(inp[i]) ? inp[i][month - 1] : null;
    if (v == null || v === '' || Number(v) === 0) empty++;
  });
  return { month, empty_cells: empty, total_cells: total };
}

async function _block(reader, site, shape) {
  if (typeof reader !== 'function') return null;
  try { return shape(await reader(site)); } catch (_) { return null; }
}

async function buildMyWork({ user, sites, asOf, readers } = {}) {
  const r = readers || {};
  const as = day(asOf) || new Date().toISOString().slice(0, 10);
  const list = Array.isArray(sites) ? sites : [];
  if (!list.length) {
    const res = { generated_at: new Date().toISOString(), as_of: as, sites: [], truncated: 0,
      message: 'You are not attached to a site — use the Site Actions hub.' };
    if (typeof r.ownedBenefits === 'function') res.owned_benefits = await _ownedBlock(r.ownedBenefits, user, as);
    if (r.awaiting) res.awaiting_me = await buildAwaitingMe({ user, asOf: as, readers: r.awaiting });   // F-PRODUCT-07 — a person without a site still verifies
    return res;
  }
  const shown = list.slice(0, MAX_SITES);
  const out = [];
  for (const s of shown) {
    const card = { site_id: s.site_id, code: s.code || null, name: s.name || null };
    card.actions = await _block(r.actions, s, (raw) => {
      if (!raw) return null;
      const sa = buildSiteActions({ meetings: raw.meetings, inspection: raw.inspection, report: raw.report, asOf: as });
      const c = compose({ siteActions: sa, asOf: as });
      const ages = c.items.map((x) => x.age_days).filter((a) => a != null);
      return { open: c.totals.open, overdue: c.totals.overdue, oldest_days: ages.length ? Math.max(...ages) : null };
    });
    card.weekly_report = await _block(r.weeklyReport, s, (w) => {
      if (!w) return null;
      const rep = w.report || null;
      const status = rep ? rep.status || null : null;
      return { week_label: w.week_label || (rep && rep.week_label) || (w.week ? `W${String(w.week).padStart(2, '0')} ${w.year}` : null),
        status, label: weeklyLabel(status), report_id: rep ? rep.id : null };
    });
    card.unsigned_pvs = await _block(r.unsignedPvs, s, (u) => {
      if (!u) return null;
      const items = (u.items || []).slice(0, MAX_UNSIGNED).map((m) => ({ id: m.id, reference: m.reference || null, meeting_date: day(m.meeting_date) }));
      return { count: Number.isFinite(Number(u.count)) ? Number(u.count) : items.length, items };
    });
    card.last_inspection = await _block(r.lastInspection, s, (row) => {
      const date = row ? day(row.inspection_date) : null;
      return { date, days_since: date ? daysBetween(date, as) : null };
    });
    card.tracker_empty = await _block(r.trackerEmpty, s, (t) => (t ? { month: t.month, empty_cells: t.empty_cells, total_cells: t.total_cells } : null));
    // B-08 (catalogue A09): portfolio benefits of this site whose review date is reached and not verified yet
    card.benefit_reviews = await _block(r.benefitReviews, s, (rows) => {
      if (!Array.isArray(rows)) return null;
      const items = require('./portfolioBenefits').reviewItems(rows, as);
      return { count: items.length, items: items.slice(0, MAX_UNSIGNED).map((x) => ({ project_id: x.project_id, project_key: x.ref, title: x.title, due_date: x.due_date, status: x.status, overdue: x.overdue })) };
    });
    out.push(card);
  }
  const res = { generated_at: new Date().toISOString(), as_of: as, sites: out, truncated: list.length - shown.length, message: null };
  // E-P05 — benefits this PERSON owns (linked owner) whose review date is reached; present only when the route passes
  // the reader (switch benefit_owner_link_enabled on); a reader that throws → null (not measured), never 0.
  if (typeof r.ownedBenefits === 'function') res.owned_benefits = await _ownedBlock(r.ownedBenefits, user, as);
  if (r.awaiting) res.awaiting_me = await buildAwaitingMe({ user, asOf: as, readers: r.awaiting });   // F-PRODUCT-07
  return res;
}
async function _ownedBlock(reader, user, as) {
  return _block(reader, user, (rows) => {
    if (!Array.isArray(rows)) return null;
    const items = require('./portfolioBenefits').reviewItems(rows, as);
    return { count: items.length, items: items.slice(0, MAX_UNSIGNED).map((x) => ({ project_id: x.project_id, project_key: x.ref, title: x.title, due_date: x.due_date, status: x.status, overdue: x.overdue, link: x.link })) };
  });
}

// ── F-PRODUCT-07 (committee 12 Nov 2026, C22 / N11) — "Awaiting me": the items that wait for THIS person's verification,
// acceptance, signature or decision follow-up. Present only when the route passes `readers.awaiting` (switch
// mywork_awaiting_me_enabled). PURE: each reader returns the rows the user may already open (the route applies each
// module's own scope); this function applies the eligibility rule of each module and shapes the lines.
//   • every source is computed on its own: no reader, or a reader that throws → null ("not measured"), never 0;
//   • separation of duties is kept: I never see my own work as "to verify" (commitment owner / executor / creator,
//     handoff requester, benefit entrant or owner).
const CL = require('./commitmentLifecycle');
const DL = require('./decisionLifecycle');
const AWAITING_SOURCES = ['commitments', 'handoffs', 'benefits', 'decisions', 'pvs'];
const DECISION_DUE_DAYS = 7;
const MAX_AWAITING = 20;
const _low = (v) => String(v == null ? '' : v).trim().toLowerCase();
const _names = (u) => [u && u.username, u && u.full_name, u && u.email].map(_low).filter(Boolean);
const _addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * DAY).toISOString().slice(0, 10);
const _line = (source, o, as) => ({ source, id: o.id, ref: o.ref || null, title: o.title || null, due_date: day(o.due_date), overdue: o.due_date ? day(o.due_date) < as : null,
  evidence_link: o.evidence_link || null, link: o.link });
const _shape = (lines) => { const sorted = lines.slice().sort((a, b) => String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')) || String(a.ref || '').localeCompare(String(b.ref || '')));
  return { count: sorted.length, items: sorted.slice(0, MAX_AWAITING) }; };

const AWAITING_RULES = {
  // rows: [{ commitment, actor }] — the actor carries principals / roleReviewer as the commitments route builds it
  commitments: (rows, user, as) => rows.filter((x) => x && x.commitment && x.commitment.status === 'awaiting_verification'
    && CL.isReviewer(x.commitment, x.actor || user) && !CL.isSelf(x.commitment, x.actor || user))
    .map(({ commitment: c }) => _line('commitment', { id: c.id, ref: c.uid || null, title: c.title, due_date: c.due_date, evidence_link: c.evidence_link, link: `commitments.html?id=${encodeURIComponent(c.id)}` }, as)),
  // a handoff waits for its NAMED receiver; the requester never accepts their own
  handoffs: (rows, user, as) => rows.filter((h) => h && h.status === 'requested' && user && Number(h.receiver_id) === Number(user.id) && Number(h.requested_by) !== Number(user.id))
    .map((h) => _line('handoff', { id: h.id, ref: h.ref, title: h.title, due_date: h.due_date, link: `handoffs.html?id=${encodeURIComponent(h.id)}` }, as)),
  // rows: benefits with a realised value and no verification, already limited by the route to those the user may verify
  benefits: (rows, user, as) => rows.filter((b) => b && b.verified_at == null && b.realised_by != null && user && Number(b.realised_by) !== Number(user.id)
    && !(b.owner_user_id != null && Number(b.owner_user_id) === Number(user.id)) && !(b.owner && _names(user).includes(_low(b.owner))))
    .map((b) => _line('benefit', { id: b.id, ref: b.project_key || null, title: b.measure || b.name || null, due_date: b.review_date, evidence_link: b.evidence_link, link: `project.html?id=${encodeURIComponent(b.project_id)}#benefits` }, as)),
  // decisions I own, still open, due within 7 days (or already late); no due date = not listed (unknown, not "on time")
  decisions: (rows, user, as) => { const limit = _addDays(as, DECISION_DUE_DAYS); const me = _names(user);
    return rows.filter((d) => d && DL.OPEN_STATUSES.includes(d.status) && d.owner && me.includes(_low(d.owner)) && d.due_date && day(d.due_date) <= limit)
      .map((d) => _line('decision', { id: d.id, ref: d.ref, title: d.title, due_date: d.due_date, link: d.session_id != null ? `cockpit.html?session=${encodeURIComponent(d.session_id)}` : 'cockpit.html' }, as)); },
  // PVs that name me as department head or site IT lead and that I have not signed
  pvs: (rows, user, as) => { const me = _names(user);
    return rows.filter((m) => m && ((m.department_head && me.includes(_low(m.department_head)) && !m.dept_head_signed_at) || (m.site_it_lead && me.includes(_low(m.site_it_lead)) && !m.site_it_signed_at)))
      .map((m) => _line('pv', { id: m.id, ref: m.reference || null, title: m.department || null, due_date: null, link: `meeting.html?id=${encodeURIComponent(m.id)}` }, as)); },
};

async function buildAwaitingMe({ user, asOf, readers } = {}) {
  const as = day(asOf) || new Date().toISOString().slice(0, 10);
  const r = readers || {}; const out = { as_of: as, decision_due_days: DECISION_DUE_DAYS, total: 0, not_measured: [] };
  for (const k of AWAITING_SOURCES) {
    let block = null;
    if (typeof r[k] === 'function') { try { const rows = await r[k](user); block = Array.isArray(rows) ? _shape(AWAITING_RULES[k](rows, user, as)) : null; } catch (_) { block = null; } }
    out[k] = block;
    if (block) out.total += block.count; else out.not_measured.push(k);
  }
  // nothing measured at all → the total is unknown, not 0
  if (out.not_measured.length === AWAITING_SOURCES.length) out.total = null;
  return out;
}

module.exports = { buildMyWork, buildAwaitingMe, weeklyLabel, trackerEmptyCells, MAX_SITES, AWAITING_SOURCES, DECISION_DUE_DAYS };

