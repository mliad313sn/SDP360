'use strict';
// Step 10 — QUICK ACTIONS sent from the field: open an SDP ticket from an inspection finding, close a ticket or
// transfer it to another group — each with its justification. Writing to ServiceDesk Plus needs a NEW API scope
// (requests WRITE) that must go through the change board (study, étape 10): until a super_admin arms it
// (`field_sdp_write_enabled` = 1 and a write refresh token), every quick action is QUEUED for a coordinator, who does
// it by hand in SDP and marks it done. Idempotent: the phone chooses the id; the same id twice is the same action.

const sql = require('../sqlStore');
const handle = () => sql.handle('022_field.sql');
const KINDS = { sdp_ticket: 'Ouvrir un ticket', sdp_close: 'Clore un ticket', sdp_transfer: 'Transférer un ticket' };
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;
const str = (v, n) => String(v == null ? '' : v).trim().slice(0, n);

function validate(b) {
  const errors = [];
  const id = str(b.id, 64), kind = KINDS[b.kind] ? b.kind : null;
  if (!ID_RE.test(id)) errors.push('id: chosen by the phone, 8-64 letters, digits or dashes');
  if (!kind) errors.push('kind: one of ' + Object.keys(KINDS).join(', '));
  const p = { site: str(b.site, 20).toUpperCase(), justification: str(b.justification, 2000) };
  if (kind === 'sdp_ticket') {
    Object.assign(p, { subject: str(b.subject, 250), description: str(b.description, 4000), inspection_id: str(b.inspection_id, 64) || null, finding_key: str(b.finding_key, 40) || null, priority: str(b.priority, 20) || null });
    if (!p.subject) errors.push('subject: empty');
  } else if (kind) {
    p.ticket_id = str(b.ticket_id, 30);
    if (!/^[A-Za-z0-9-]{1,30}$/.test(p.ticket_id)) errors.push('ticket_id: the SDP request number');
    if (!p.justification) errors.push('justification: say why');
    if (kind === 'sdp_transfer') { p.target_group = str(b.target_group, 120); if (!p.target_group) errors.push('target_group: the group to transfer to'); }
  }
  return { ok: !errors.length, errors, action: { id, kind, payload: p } };
}

async function get(id) { const { H } = handle(); return H.prepare(`SELECT * FROM fd_quick_actions WHERE id = ?`).get(id); }
const row = (r) => (r ? { id: r.id, username: r.username, kind: r.kind, label: KINDS[r.kind], payload: sql.parse(r.payload_json, {}), status: r.status, result: r.result,
  created_at: r.created_at, processed_by: r.processed_by, processed_at: r.processed_at } : null);

/**
 * Record (and, when armed, perform) an action. writer = { enabled, perform(action) → {ok, result, error} }.
 * Returns the action (an id sent twice returns the first one, never acts twice).
 */
async function submit(action, username, writer) {
  const cur = await get(action.id);
  if (cur) return { duplicate: true, action: row(cur) };
  const { H } = handle();
  await H.prepare(`INSERT INTO fd_quick_actions (id, username, kind, payload_json, status, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(action.id, username, action.kind, JSON.stringify(action.payload), writer && writer.enabled ? 'sending' : 'pending_manual', sql.now());
  if (writer && writer.enabled) {
    const r = await writer.perform(action);
    await H.prepare(`UPDATE fd_quick_actions SET status = ?, result = ?, processed_by = 'sdp-api', processed_at = ? WHERE id = ?`)
      .run(r.ok ? 'done' : 'pending_manual', String(r.ok ? r.result || 'ok' : 'SDP refused: ' + r.error).slice(0, 500), sql.now(), action.id);
  }
  return { duplicate: false, action: row(await get(action.id)) };
}

async function list({ status, username } = {}) {
  const { H } = handle();
  const w = [], p = [];
  if (status) { w.push('status = ?'); p.push(status); }
  if (username) { w.push('username = ?'); p.push(username); }
  return (await H.prepare(`SELECT * FROM fd_quick_actions ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 500`).all(...p)).map(row);
}
/** A coordinator did it by hand in SDP: mark it done with the ticket number or a note. */
async function markDone(id, by, note) {
  const { H } = handle();
  await H.prepare(`UPDATE fd_quick_actions SET status = 'done', result = ?, processed_by = ?, processed_at = ? WHERE id = ? AND status <> 'done'`).run(str(note, 500) || 'done by hand', by, sql.now(), id);
  return row(await get(id));
}

module.exports = { validate, submit, list, markDone, get: async (id) => row(await get(id)), KINDS };
