'use strict';
// Committee #39 (CIO P1-7) — ONE read-only view of what a site owes, across the registers that still
// live apart: commitments (the canonical ledger), interdepartmental handoffs, meeting / incubation /
// inspection actions and weekly-report follow-ups. PURE: the route reads the sources, this module
// normalises them. Nothing is merged or rewritten in the registers themselves:
//   • a source action already linked to a commitment is shown ONCE, under its commitment
//     (`sources` lists what it covers) — the commitment is the obligation of record;
//   • a handoff linked to a commitment is listed with that link, not hidden (it is a different duty:
//     the receiving department's).
const DONE_COMMITMENT = new Set(require('./commitmentLifecycle').TERMINAL);
const OPEN_HANDOFF = new Set(['requested', 'accepted', 'blocked', 'escalated', 'delivered']);
const day = (v) => (v ? String(v).slice(0, 10) : null);
const overdue = (due, asOf) => !!(due && day(due) < day(asOf));

// E-G02 (audit G-02, X-G-01) — `decisions` (open governance decisions of the site; undefined = not asked, the
// default while report_config obligations_include_decisions = '0', so the view is exactly as before). A decision
// already carried by a commitment (source governance:<ref>) or by a session action (decision_ref) is shown ONCE,
// under that line. Every line carries `href` (its register row) and `focus` (the key ?focus= highlights).
const OPEN_DECISION = new Set(['open', 'in_progress']);
const focusKey = (register, id) => (id == null ? null : `${register}:${id}`);
/** Link a register row back to its line on the obligations view. */
const focusHref = (siteId, register, id) => `obligations.html?site=${encodeURIComponent(siteId)}&focus=${encodeURIComponent(focusKey(register, id))}`;

function compose({ commitments = null, handoffs = null, siteActions = null, sessionActions = null, benefitReviews = null, decisions, asOf }) {
  const items = [];
  const cmtIds = new Set();
  for (const c of commitments || []) {
    if (DONE_COMMITMENT.has(String(c.status))) continue;
    cmtIds.add(Number(c.id));
    items.push({ register: 'commitment', id: Number(c.id), ref: c.ref || `C-${c.id}`, title: c.title, owner: c.accountable_owner || null, due_date: day(c.due_date), status: c.status,
      severity: c.severity || null, overdue: overdue(c.due_date, asOf), link: `commitments.html?id=${c.id}`, sources: [] });
  }
  const byId = new Map(items.map((x) => [x.id, x]));
  for (const h of handoffs || []) {
    if (!OPEN_HANDOFF.has(String(h.status))) continue;
    // recorded in the ledger (handoffs.commitment_ledger): shown once, under its commitment
    const owner = h.commitment_id != null && byId.get(Number(h.commitment_id));
    if (owner) { owner.sources.push({ register: 'handoff', title: h.title, handoff_id: Number(h.id), status: h.status }); continue; }
    items.push({ register: 'handoff', id: Number(h.id), ref: h.ref, title: h.title, owner: h.receiver_name || null, due_date: day(h.due_date), status: h.status,
      overdue: overdue(h.due_date, asOf) && h.status !== 'delivered', link: `handoffs.html?id=${h.id}`, commitment_id: h.commitment_id == null ? null : Number(h.commitment_id),
      from_department: h.from_department, to_department: h.to_department });
  }
  const g = (siteActions && siteActions.groups) || {};
  for (const k of ['meetings', 'incubation', 'inspection', 'report']) {
    for (const it of (g[k] && g[k].items) || []) {
      const c = it.commitment && byId.get(Number(it.commitment.id));
      if (c) { c.sources.push({ register: k, title: it.title, action_id: it.action_id || null, uid: it.uid || null }); continue; }   // shown once, under its commitment
      items.push({ register: k === 'report' ? 'report_followup' : `${k}_action`, id: it.action_id || it.uid || null, ref: it.origin_label || null, title: it.title, owner: it.owner || null,
        due_date: day(it.due_date), status: it.status, overdue: !!it.overdue, age_days: it.age_days == null ? null : it.age_days,
        link: k === 'report' ? (it.report_id ? `reports.html?report=${it.report_id}` : null) : k === 'inspection' ? 'inspection-actions.html' : 'meetings-actions.html' });
    }
  }
  // UAT (PMO F2): actions agreed in a governance session (cockpit)
  const byDecisionRef = new Map();
  for (const a of sessionActions || []) {
    const line = { register: 'session_action', id: Number(a.id), ref: a.decision_ref || null, title: a.title, owner: a.owner || null, due_date: day(a.due_date), status: a.status,
      overdue: overdue(a.due_date, asOf), link: `cockpit.html?session=${a.session_id}`, cadence: a.cadence_name || null };
    if (decisions !== undefined) line.sources = [];
    items.push(line);
    if (a.decision_ref && !byDecisionRef.has(a.decision_ref)) byDecisionRef.set(a.decision_ref, line);
  }
  for (const d of decisions || []) {
    if (!OPEN_DECISION.has(String(d.status))) continue;
    const src = { register: 'decision', title: d.title, decision_id: Number(d.id), ref: d.ref || null };
    const c = d.commitment && byId.get(Number(d.commitment.id));
    if (c) { c.sources.push(src); continue; }                         // shown once, under its commitment
    const sa = d.ref && byDecisionRef.get(d.ref);
    if (sa) { sa.sources.push(src); continue; }                       // shown once, under the action it produced
    items.push({ register: 'decision', id: Number(d.id), ref: d.ref || null, title: d.title, owner: d.owner || null, due_date: day(d.due_date), status: d.status,
      overdue: overdue(d.due_date, asOf), link: d.session_id != null ? `cockpit.html?session=${d.session_id}` : 'cockpit.html' });
  }
  // B-08 (catalogue A09): a portfolio benefit whose review date is reached and that is not verified yet — the
  // realised value is missing, or entered and waiting for an independent verification. Never a value in the line.
  for (const x of require('./portfolioBenefits').reviewItems(benefitReviews, asOf)) items.push(x);
  for (const x of items) { x.href = x.link || null; x.focus = focusKey(x.register, x.id); }
  items.sort((a, b) => (Number(b.overdue) - Number(a.overdue)) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
  const by = {}; for (const x of items) { by[x.register] = by[x.register] || { open: 0, overdue: 0 }; by[x.register].open++; if (x.overdue) by[x.register].overdue++; }
  return { as_of: day(asOf), items, totals: { open: items.length, overdue: items.filter((x) => x.overdue).length, by_register: by },
    // null = that register was not read (switched off / unavailable) — never "nothing owed"
    registers: { commitments: commitments == null ? null : 'read', handoffs: handoffs == null ? null : 'read', actions: siteActions == null ? null : 'read', session_actions: sessionActions == null ? null : 'read', benefit_reviews: benefitReviews == null ? null : 'read', ...(decisions === undefined ? {} : { decisions: decisions == null ? null : 'read' }) } };
}
module.exports = { compose, focusKey, focusHref };
