'use strict';
// 2027 Goal 02 — PURE helpers shared by the backfill dry-run and the Site Actions hub.
//
// Source natural keys (commitment_source_links.source_system / source_id):
//   meetings   md_actions.id            → 'meetings'   + '<id>'
//              md_issues.id             → 'meetings'   + 'issue:<id>'
//   inspection insp_actions.id          → 'inspection' + '<id>'
//   report     action_items.uid         → 'report'     + '<uid>'
// The backfill only PROPOSES; it never edits or deletes a source record. Applying a proposal
// creates a `captured` commitment linked to its source (idempotent on the natural key).

const { similarity } = require('../public/lib/actionSimilarity');
const MD_DONE = new Set(require('../public/lib/statusTransfer').DONE);
const SIMPLE_DONE = new Set(['closed', 'cancelled']);
const SEV = { critical: 'critical', high: 'high', medium: 'medium', low: 'low' };
const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 };
const _l = (v) => String(v == null ? '' : v).trim().toLowerCase();
const _d = (v) => (/^\d{4}-\d{2}-\d{2}/.test(String(v || '')) ? String(v).slice(0, 10) : null);

/** Pairs to look up for a buildSiteActions() result. */
function hubPairs(sa) {
  const out = [];
  const g = (sa && sa.groups) || {};
  for (const k of ['meetings', 'incubation']) for (const it of (g[k] && g[k].items) || []) if (it.action_id != null) out.push({ system: 'meetings', id: String(it.action_id) });
  for (const it of (g.inspection && g.inspection.items) || []) if (it.action_id != null) out.push({ system: 'inspection', id: String(it.action_id) });
  for (const it of (g.report && g.report.items) || []) if (it.uid) out.push({ system: 'report', id: String(it.uid) });
  for (const it of (g.issues && g.issues.items) || []) if (it.issue_id != null) out.push({ system: 'meetings', id: 'issue:' + it.issue_id });
  return out;
}

/** Put { id, status, awaiting_verification } on each hub row that has a linked commitment. */
function attachCommitments(sa, map) {
  const g = (sa && sa.groups) || {};
  const key = (k, it) => (k === 'report' ? (it.uid ? 'report:' + it.uid : null)
    : k === 'issues' ? (it.issue_id != null ? 'meetings:issue:' + it.issue_id : null)
      : it.action_id != null ? (k === 'inspection' ? 'inspection:' : 'meetings:') + it.action_id : null);
  let n = 0;
  for (const k of ['meetings', 'incubation', 'inspection', 'report', 'issues']) for (const it of (g[k] && g[k].items) || []) {
    const hit = map && map.get(key(k, it));
    if (hit) { it.commitment = { id: hit.id, status: hit.status, awaiting_verification: hit.status === 'awaiting_verification' }; n++; }
  }
  if (sa) sa.commitments_linked = n;
  return sa;
}

/**
 * Propose commitments from open source rows.
 * @param {object} i { mdActions, inspActions, reportActions, siteIdByCode:{CODE:site_id}, linked:Set("system:id") }
 * @returns {{ proposals, skipped, duplicates, per_site, totals }}
 */
function proposeCommitments(i) {
  const linked = i.linked instanceof Set ? i.linked : new Set(i.linked || []);
  const siteOf = (code) => { const v = (i.siteIdByCode || {})[String(code || '').toUpperCase()]; return v == null ? null : Number(v); };
  const proposals = [], skipped = [];
  const push = (p) => {
    const k = `${p.source.system}:${p.source.id}`;
    if (linked.has(k)) { skipped.push({ key: k, site_id: p.site_id, reason: 'already_linked' }); return; }
    if (p.site_id == null) { skipped.push({ key: k, site_id: null, reason: 'site_unresolved' }); return; }
    p.gaps = [];
    if (!p.accountable_owner) p.gaps.push('accountable_owner');
    if (!p.due_date) p.gaps.push('due_date');
    if (['high', 'critical'].includes(p.severity)) p.gaps.push('treatment_plan');
    proposals.push(p);
  };
  for (const a of i.inspActions || []) {
    if (SIMPLE_DONE.has(_l(a.status))) continue;
    push({ source: { system: 'inspection', id: String(a.id) }, kind: 'corrective_action', title: String(a.description || 'Inspection action').slice(0, 300),
      site_id: siteOf(a.site_code), severity: SEV[_l(a.priority)] || 'medium', accountable_owner: a.owner || null, due_date: _d(a.due_date), origin: a.inspection_id || null });
  }
  for (const a of i.mdActions || []) {
    if (MD_DONE.has(_l(a.status))) continue;
    push({ source: { system: 'meetings', id: String(a.id) }, kind: 'business_need', title: String(a.description || 'Meeting action').slice(0, 300),
      site_id: siteOf(a.site_code), severity: 'medium', accountable_owner: a.owner_it || null, due_date: _d(a.target_date), origin: a.meeting_reference || null });
  }
  for (const a of i.reportActions || []) {
    if (SIMPLE_DONE.has(_l(a.status)) || a.source) continue;   // a merged follow-up lives at its origin
    if (!a.uid) { skipped.push({ key: 'report:?', site_id: a.site_id == null ? null : Number(a.site_id), reason: 'no_uid' }); continue; }
    push({ source: { system: 'report', id: String(a.uid) }, kind: 'corrective_action', title: String(a.task || 'Report follow-up').slice(0, 300),
      site_id: a.site_id == null ? null : Number(a.site_id), severity: 'medium', accountable_owner: a.owner || null, due_date: _d(a.due_date), origin: a.week_label || null });
  }
  proposals.sort((a, b) => (SEV_RANK[a.severity] - SEV_RANK[b.severity]) || (a.site_id - b.site_id));
  // likely duplicates inside one site (similar titles across sources; same 0.5 Jaccard threshold as the
  // report editor's anti-duplicate guard) — reported, never merged.
  const duplicates = [];
  for (let x = 0; x < proposals.length; x++) for (let y = x + 1; y < proposals.length; y++) {
    const a = proposals[x], b = proposals[y];
    if (a.site_id !== b.site_id) continue;
    const s = similarity(a.title, b.title);
    if (s >= 0.5) duplicates.push({ a: `${a.source.system}:${a.source.id}`, b: `${b.source.system}:${b.source.id}`, similarity: Math.round(s * 100) / 100 });
  }
  const per_site = {};
  const bump = (sid, k) => { const key = sid == null ? 'unresolved' : String(sid); per_site[key] = per_site[key] || { proposed: 0, high_or_critical: 0, already_linked: 0, skipped: 0 }; per_site[key][k]++; };
  for (const p of proposals) { bump(p.site_id, 'proposed'); if (['high', 'critical'].includes(p.severity)) bump(p.site_id, 'high_or_critical'); }
  for (const s of skipped) bump(s.site_id, s.reason === 'already_linked' ? 'already_linked' : 'skipped');
  return { proposals, skipped, duplicates, per_site, totals: { proposed: proposals.length, skipped: skipped.length, duplicates: duplicates.length } };
}

module.exports = { hubPairs, attachCommitments, proposeCommitments };
