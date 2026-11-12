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
  return res;
}
async function _ownedBlock(reader, user, as) {
  return _block(reader, user, (rows) => {
    if (!Array.isArray(rows)) return null;
    const items = require('./portfolioBenefits').reviewItems(rows, as);
    return { count: items.length, items: items.slice(0, MAX_UNSIGNED).map((x) => ({ project_id: x.project_id, project_key: x.ref, title: x.title, due_date: x.due_date, status: x.status, overdue: x.overdue, link: x.link })) };
  });
}

module.exports = { buildMyWork, weeklyLabel, trackerEmptyCells, MAX_SITES };
