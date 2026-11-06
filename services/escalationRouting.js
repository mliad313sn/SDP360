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

// C-21 (G46) — duty queue first, under the site policy handoffs.queue_receivers (default false = unchanged).
async function _withQueue(e, siteId, { policyFor, dutyStore, now }) {
  if (!dutyStore || siteId == null) return e;
  let on = false; try { on = !!(policyFor && (await policyFor(siteId))['handoffs.queue_receivers'] === true); } catch (_) { on = false; }
  if (!on) return e;
  const Q = require('./dutyQueue'); const at = (now || (() => new Date().toISOString()))();
  try {
    const [shifts, account] = await Promise.all([dutyStore.shifts([Number(siteId)], new Date(Date.parse(at) - 8 * 864e5).toISOString(), new Date(Date.parse(at) + 1).toISOString()), dutyStore.accountState()]);
    return Q.applyQueue(e, Q.onDuty({ shifts, account, siteId, at }), { siteId });
  } catch (_) { return e; }   // a roster read error never stops an escalation: the person route stays
}

/** Handoffs: escalate overdue ones (matrix target recorded on the event), then notify the targets. */
async function routeHandoffEscalations({ hoStore, rolesStore, policyFor, notify, notifyEnabled, dutyStore, now }) {
  const targetFor = rolesStore ? async (h, overdueDays) => _withQueue(await rolesStore.escalationTarget({ register: 'handoffs', severity: '*', siteId: h.site_id, overdueDays }), h.site_id, { policyFor, dutyStore, now }) : null;
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
// E-R02 — report_config a01_missing_due_date ('1' = a serious commitment without a due date also raises A01).
// The caller may pass it; otherwise it is read here (a read error = '0' = today's behaviour).
async function _missingDueSwitch(v) {
  if (v !== undefined) return !!v;
  try { const rdb = require('../reports-db'); return String((await require('./reportConfig').getConfig(rdb.db)).a01_missing_due_date) === '1'; } catch (_) { return false; }
}
async function routeCommitmentEscalations({ cmtStore, rolesStore, policyFor, notify, notifyEnabled, today, dutyStore, now, missingDueDate }) {
  const r = await cmtStore.escalate({ policyFor, missingDueDate: await _missingDueSwitch(missingDueDate) });
  let notified = 0; const gaps = [];
  if (rolesStore) {
    const d = String(today || new Date().toISOString()).slice(0, 10);
    for (const c of r.raised || []) {
      const cm = await cmtStore.getRaw(c.commitment_id).catch(() => null);
      if (!cm) continue;
      const pol = policyFor ? await policyFor(cm.site_id) : null;
      const overdueDays = c.kind === 'A02' && cm.due_date ? require('./workCalendar').workingDaysAfter(cm.due_date, d, pol) : 0;   // working days (committee #40)
      const e = await _withQueue(await rolesStore.escalationTarget({ register: 'commitments', severity: cm.severity || '*', siteId: cm.site_id, overdueDays }), cm.site_id, { policyFor, dutyStore, now });
      if (e.gap) gaps.push({ commitment_id: Number(cm.id), role: e.role, site_id: cm.site_id });
      if (notifyEnabled && notify && e.targets.length) {
        notified += await _notifyAll(notify, e.targets, { kind: 'commitment', title: `${c.kind} — ${String(cm.title || '').slice(0, 120)}`, body: c.kind === 'A01' ? (c.reason === 'no_due_date' ? 'serious commitment without a due date or approved exception' : 'serious commitment without an owner') : `overdue ${overdueDays} d without an approved exception`, link: `commitments.html?id=${cm.id}`, sourceKind: 'commitment', sourceRef: String(cm.id) });
      }
    }
  }
  return { rows: (r.raised || []).length, raised: (r.raised || []).length, kept: r.kept, cleared: r.cleared, notified, gaps };
}

module.exports = { routeHandoffEscalations, routeCommitmentEscalations, _withQueue };
