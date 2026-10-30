'use strict';
// ADR-006 (#36) — the escalation jobs reach a PERSON. The matrix (escalation_matrix) names a role per
// register × severity × site × days overdue; the role's holders (role_assignments) — and their deputies when
// they are away — receive an in-app notification. A matched rule with nobody holding the role is reported
// (`gaps`) and listed in the oversight register: an escalation never silently goes nowhere.
// Notifications stay behind the existing switches (handoff_notify_enabled / commitment_notify_enabled).

async function _notifyAll(notify, ids, n) {
  let sent = 0;
  for (const userId of ids || []) { try { await notify({ userId, ...n }); sent++; } catch (_) { /* best effort */ } }
  return sent;
}

/** Handoffs: escalate overdue ones (matrix target recorded on the event), then notify the targets. */
async function routeHandoffEscalations({ hoStore, rolesStore, policyFor, notify, notifyEnabled }) {
  const targetFor = rolesStore ? (h, overdueDays) => rolesStore.escalationTarget({ register: 'handoffs', severity: '*', siteId: h.site_id, overdueDays }) : null;
  const rows = await hoStore.escalateOverdue({ policyFor, targetFor });
  let notified = 0; const gaps = [];
  for (const h of rows) {
    const e = h.escalation;
    if (e && e.gap) gaps.push({ ref: h.ref, role: e.role, site_id: h.site_id });
    if (notifyEnabled && notify && e && e.targets && e.targets.length) {
      notified += await _notifyAll(notify, e.targets, { kind: 'handoff', title: `${h.ref} — escalated (${h.overdue_days} d overdue)`, body: h.title, link: `handoffs.html?id=${h.id}`, sourceKind: 'handoff', sourceRef: String(h.id) });
    }
  }
  return { rows: rows.length, escalated: rows.filter((r) => !r.level_raised).length, levels: rows.filter((r) => r.level_raised).length, notified, gaps };
}

/** Commitments: after the A01 / A02 ledger diff, notify the matrix target of every newly raised escalation. */
async function routeCommitmentEscalations({ cmtStore, rolesStore, policyFor, notify, notifyEnabled, today }) {
  const r = await cmtStore.escalate({ policyFor });
  let notified = 0; const gaps = [];
  if (rolesStore) {
    const d = String(today || new Date().toISOString()).slice(0, 10);
    for (const c of r.raised || []) {
      const cm = await cmtStore.getRaw(c.commitment_id).catch(() => null);
      if (!cm) continue;
      const pol = policyFor ? await policyFor(cm.site_id) : null;
      const overdueDays = c.kind === 'A02' && cm.due_date ? require('./workCalendar').workingDaysAfter(cm.due_date, d, pol) : 0;   // working days (committee #40)
      const e = await rolesStore.escalationTarget({ register: 'commitments', severity: cm.severity || '*', siteId: cm.site_id, overdueDays });
      if (e.gap) gaps.push({ commitment_id: Number(cm.id), role: e.role, site_id: cm.site_id });
      if (notifyEnabled && notify && e.targets.length) {
        notified += await _notifyAll(notify, e.targets, { kind: 'commitment', title: `${c.kind} — ${String(cm.title || '').slice(0, 120)}`, body: c.kind === 'A01' ? 'serious commitment without an owner' : `overdue ${overdueDays} d without an approved exception`, link: `commitments.html?id=${cm.id}`, sourceKind: 'commitment', sourceRef: String(cm.id) });
      }
    }
  }
  return { rows: (r.raised || []).length, raised: (r.raised || []).length, kept: r.kept, cleared: r.cleared, notified, gaps };
}

module.exports = { routeHandoffEscalations, routeCommitmentEscalations };
