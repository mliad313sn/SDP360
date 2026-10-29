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

function compose({ commitments = null, handoffs = null, siteActions = null, asOf }) {
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
  items.sort((a, b) => (Number(b.overdue) - Number(a.overdue)) || String(a.due_date || '9999').localeCompare(String(b.due_date || '9999')));
  const by = {}; for (const x of items) { by[x.register] = by[x.register] || { open: 0, overdue: 0 }; by[x.register].open++; if (x.overdue) by[x.register].overdue++; }
  return { as_of: day(asOf), items, totals: { open: items.length, overdue: items.filter((x) => x.overdue).length, by_register: by },
    // null = that register was not read (switched off / unavailable) — never "nothing owed"
    registers: { commitments: commitments == null ? null : 'read', handoffs: handoffs == null ? null : 'read', actions: siteActions == null ? null : 'read' } };
}
module.exports = { compose };
