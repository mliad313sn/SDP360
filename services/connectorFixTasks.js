'use strict';
// P4 / A2 — "make unknown actionable": every "—" (unknown) cell on Connector Health or in the weekly report's
// infrastructure table can become a FIX TASK with an owner (migration 096, connector_fix_tasks).
//
// Why a small dedicated list and not an existing mechanism: report follow-ups (action_items) live inside ONE
// weekly report and are frozen with it; the commitments ledger is dark (commitments_enabled = '0'); the home
// queue only aggregates existing sources. A data fix belongs to the CONNECTOR owner (Infrastructure owner,
// Platform owner…), not to a site coordinator, and must outlive any report week — hence this table. The home
// queue (goal A3) can read it later as one more source.
//
// Rules: one OPEN task per connector × site × scope (asking twice returns the existing one — idempotent);
// timestamps are the database's now(); closing records who and why. Nothing here sends a notification.
const CONNECTORS = ['sdp_analytics', 'meraki', 'opmanager', 'sdp_cloud'];
const OWNER_DEFAULT = { sdp_analytics: 'Platform owner', meraki: 'Infrastructure owner', opmanager: 'Infrastructure owner', sdp_cloud: 'Service & Support Manager' };
const _ts = (c) => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
const COLS = `id, connector, site_id, scope, cause, owner_role, owner_user_id, status, report_id, created_by, created_by_name,
  ${_ts('created_at')} AS created_at, closed_by, ${_ts('closed_at')} AS closed_at, close_note`;

function validate(input) {
  const i = input || {};
  const connector = String(i.connector || '');
  if (!CONNECTORS.includes(connector)) { const e = new Error('connector must be one of ' + CONNECTORS.join(', ')); e.status = 400; throw e; }
  const scope = String(i.scope == null ? '' : i.scope).trim().slice(0, 40);
  if (scope && !/^[a-z0-9_]+$/.test(scope)) { const e = new Error('scope must be lowercase letters, digits or _'); e.status = 400; throw e; }
  const cause = String(i.cause || '').trim().slice(0, 500);
  if (!cause) { const e = new Error('cause is required'); e.status = 400; throw e; }
  const site_id = i.site_id == null || i.site_id === '' ? null : Number(i.site_id);
  if (site_id != null && !(Number.isInteger(site_id) && site_id > 0)) { const e = new Error('site_id must be a positive integer'); e.status = 400; throw e; }
  const report_id = i.report_id == null || i.report_id === '' ? null : Number(i.report_id);
  return { connector, scope, cause, site_id, report_id: Number.isInteger(report_id) && report_id > 0 ? report_id : null };
}

/** Create or return the open task (idempotent). owner_role comes from the connector register, never the client. */
async function open(H, input, actor, owners) {
  const v = validate(input);
  const owner_role = (owners && owners[v.connector]) || OWNER_DEFAULT[v.connector];
  const find = () => H.prepare(`SELECT ${COLS} FROM connector_fix_tasks WHERE connector = ? AND COALESCE(site_id, 0) = ? AND scope = ? AND status = 'open'`).get(v.connector, v.site_id || 0, v.scope);
  const cur = await find();
  if (cur) return { task: cur, created: false };
  try {
    await H.prepare(`INSERT INTO connector_fix_tasks (connector, site_id, scope, cause, owner_role, report_id, created_by, created_by_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(v.connector, v.site_id, v.scope, v.cause, owner_role, v.report_id, actor && actor.id != null ? Number(actor.id) : null, actor ? String(actor.full_name || actor.username || '').slice(0, 120) : null);
  } catch (e) { const again = await find(); if (again) return { task: again, created: false }; throw e; }   // lost the race on the open index
  return { task: await find(), created: true };
}

async function list(H, { status = 'open', siteIds = null } = {}) {
  if (Array.isArray(siteIds) && !siteIds.length) return [];
  const p = []; let w = '1=1';
  if (status && status !== 'all') { w += ' AND status = ?'; p.push(String(status)); }
  if (Array.isArray(siteIds)) { w += ` AND site_id IN (${siteIds.map(() => '?').join(',')})`; p.push(...siteIds.map(Number)); }
  return H.prepare(`SELECT ${COLS} FROM connector_fix_tasks WHERE ${w} ORDER BY created_at DESC, id DESC LIMIT 500`).all(...p);
}

async function get(H, id) { return H.prepare(`SELECT ${COLS} FROM connector_fix_tasks WHERE id = ?`).get(Number(id)); }

async function close(H, id, { status = 'done', note = '' } = {}, actor) {
  if (!['done', 'dismissed'].includes(status)) { const e = new Error("status must be 'done' or 'dismissed'"); e.status = 400; throw e; }
  if (status === 'dismissed' && !String(note || '').trim()) { const e = new Error('a reason is required to dismiss a task'); e.status = 400; throw e; }
  const r = await H.prepare(`UPDATE connector_fix_tasks SET status = ?, closed_by = ?, closed_at = now(), close_note = ? WHERE id = ? AND status = 'open'`)
    .run(status, actor && actor.id != null ? Number(actor.id) : null, String(note || '').slice(0, 500) || null, Number(id));
  return (r && (r.changes || r.rowCount)) ? get(H, id) : null;
}

async function assign(H, id, userId) {
  await H.prepare(`UPDATE connector_fix_tasks SET owner_user_id = ? WHERE id = ? AND status = 'open'`).run(userId == null ? null : Number(userId), Number(id));
  return get(H, id);
}

module.exports = { open, list, get, close, assign, validate, CONNECTORS, OWNER_DEFAULT };
