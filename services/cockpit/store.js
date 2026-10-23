'use strict';
// Step 8 — persistence of the meeting cockpit: cadences (versioned definitions, services/defstore.js), sessions,
// agenda items, decisions, actions, requests for information. ONE schema: db/postgres/reports/020_cockpit_portfolio.sql
// — applied by the migrator on PostgreSQL, executed as is on sqlite (SQLite accepts the same DDL). Every function
// returns a Promise on both backends.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const cadences = require('../defstore').createStore({ table: 'ck_cadences', versions: 'ck_cadence_versions', key: 'cadence_id' });

const DDL = path.join(__dirname, '..', '..', 'db', 'postgres', 'reports', '020_cockpit_portfolio.sql');
const _inited = new WeakSet();
function handle() {
  const rdb = require('../../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  const H = rdb.db;
  if (!_inited.has(H)) { H.exec(fs.readFileSync(DDL, 'utf8')); _inited.add(H); }
  return { H, isPg: false };
}
const now = () => new Date().toISOString();
const newId = (p) => p + '-' + crypto.randomUUID().replace(/-/g, '').slice(0, 12);
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (_) { return null; } };

// ── Sessions ──────────────────────────────────────────────────────────
async function createSession({ cadence_id, cadence_version, held_on }, by) {
  const { H } = handle();
  const id = newId('S');
  await H.prepare(`INSERT INTO ck_sessions (id, cadence_id, cadence_version, held_on, status, created_by, created_at) VALUES (?, ?, ?, ?, 'planned', ?, ?)`)
    .run(id, cadence_id, cadence_version || null, held_on, by || null, now());
  return getSession(id);
}
function sessionRow(r) {
  return r ? { id: r.id, cadence_id: r.cadence_id, cadence_version: r.cadence_version == null ? null : Number(r.cadence_version), held_on: r.held_on,
    status: r.status, agenda: parse(r.agenda_json), started_at: r.started_at, ended_at: r.ended_at, has_minutes: !!r.minutes_html,
    minutes_sent_at: r.minutes_sent_at, created_by: r.created_by, created_at: r.created_at } : null;
}
async function getSession(id) {
  const { H } = handle();
  return sessionRow(await H.prepare(`SELECT * FROM ck_sessions WHERE id = ?`).get(id));
}
async function listSessions({ cadence_id, status, limit = 100 } = {}) {
  const { H } = handle();
  const w = [], p = [];
  if (cadence_id) { w.push('cadence_id = ?'); p.push(cadence_id); }
  if (status) { w.push('status = ?'); p.push(status); }
  const rows = await H.prepare(`SELECT * FROM ck_sessions ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY held_on DESC, created_at DESC LIMIT ?`).all(...p, Math.min(500, limit));
  return rows.map(sessionRow);
}
async function startSession(id, agenda) {
  const { H } = handle();
  const t = now();
  await H.prepare(`UPDATE ck_sessions SET status = 'live', agenda_json = ?, started_at = ? WHERE id = ? AND status = 'planned'`).run(JSON.stringify(agenda), t, id);
  const sections = (agenda && agenda.sections) || [];
  for (let i = 0; i < sections.length; i++) {
    await H.prepare(`INSERT INTO ck_items (session_id, seq, section, title) VALUES (?, ?, ?, ?) ON CONFLICT (session_id, seq) DO NOTHING`)
      .run(id, i + 1, sections[i].kind, sections[i].title || sections[i].kind);
  }
  return getSession(id);
}
async function closeSession(id, minutesHtml) {
  const { H } = handle();
  const t = now();
  await H.prepare(`UPDATE ck_items SET ended_at = ? WHERE session_id = ? AND started_at IS NOT NULL AND ended_at IS NULL`).run(t, id);
  await H.prepare(`UPDATE ck_sessions SET status = 'closed', ended_at = ?, minutes_html = ? WHERE id = ? AND status = 'live'`).run(t, minutesHtml, id);
  return getSession(id);
}
async function getMinutes(id) {
  const { H } = handle();
  const r = await H.prepare(`SELECT minutes_html FROM ck_sessions WHERE id = ?`).get(id);
  return r ? r.minutes_html : null;
}
async function markMinutesSent(id) {
  const { H } = handle();
  await H.prepare(`UPDATE ck_sessions SET minutes_sent_at = ? WHERE id = ?`).run(now(), id);
}

// ── Agenda items (time-stamps, notes) ─────────────────────────────────
async function items(sessionId) {
  const { H } = handle();
  const rows = await H.prepare(`SELECT * FROM ck_items WHERE session_id = ? ORDER BY seq`).all(sessionId);
  return rows.map(r => ({ seq: Number(r.seq), section: r.section, title: r.title, started_at: r.started_at, ended_at: r.ended_at, notes: r.notes || '' }));
}
/** Open an agenda point: the previous open one is closed at the same instant. */
async function startItem(sessionId, seq) {
  const { H } = handle();
  const t = now();
  await H.prepare(`UPDATE ck_items SET ended_at = ? WHERE session_id = ? AND started_at IS NOT NULL AND ended_at IS NULL AND seq <> ?`).run(t, sessionId, seq);
  await H.prepare(`UPDATE ck_items SET started_at = COALESCE(started_at, ?), ended_at = NULL WHERE session_id = ? AND seq = ?`).run(t, sessionId, seq);
  return items(sessionId);
}
async function endItem(sessionId, seq) {
  const { H } = handle();
  await H.prepare(`UPDATE ck_items SET ended_at = ? WHERE session_id = ? AND seq = ? AND started_at IS NOT NULL`).run(now(), sessionId, seq);
  return items(sessionId);
}
async function setNotes(sessionId, seq, notes) {
  const { H } = handle();
  await H.prepare(`UPDATE ck_items SET notes = ? WHERE session_id = ? AND seq = ?`).run(String(notes || '').slice(0, 8000), sessionId, seq);
}

// ── Decisions ─────────────────────────────────────────────────────────
async function addDecision(d, by) {
  const { H } = handle();
  const id = newId('D');
  await H.prepare(`INSERT INTO ck_decisions (id, session_id, item_seq, rfi_id, text, owner, source_kind, source_ref, decided_by, decided_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, d.session_id || null, d.item_seq || null, d.rfi_id || null, d.text, d.owner || null, d.source_kind || null, d.source_ref || null, by || null, now());
  return id;
}
async function decisions({ session_id, rfi_id, from } = {}) {
  const { H } = handle();
  const w = [], p = [];
  if (session_id) { w.push('session_id = ?'); p.push(session_id); }
  if (rfi_id) { w.push('rfi_id = ?'); p.push(rfi_id); }
  if (from) { w.push('decided_at >= ?'); p.push(from); }
  return H.prepare(`SELECT * FROM ck_decisions ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY decided_at`).all(...p);
}

// ── Actions ───────────────────────────────────────────────────────────
async function addAction(a, by) {
  const { H } = handle();
  const id = newId('A'), t = now();
  await H.prepare(`INSERT INTO ck_actions (id, session_id, cadence_id, item_seq, title, owner, due_date, status, source_kind, source_ref, created_by, created_at, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, ?)`)
    .run(id, a.session_id || null, a.cadence_id || null, a.item_seq || null, a.title, a.owner || null, a.due_date || null, a.source_kind || 'free', a.source_ref || null, by || null, t, by || null, t);
  return getAction(id);
}
async function getAction(id) {
  const { H } = handle();
  return H.prepare(`SELECT * FROM ck_actions WHERE id = ?`).get(id);
}
async function listActions({ status, cadence_id, session_id, source_kind, source_ref } = {}) {
  const { H } = handle();
  const w = [], p = [];
  if (status) { w.push('status = ?'); p.push(status); }
  if (cadence_id) { w.push('cadence_id = ?'); p.push(cadence_id); }
  if (session_id) { w.push('session_id = ?'); p.push(session_id); }
  if (source_kind) { w.push('source_kind = ?'); p.push(source_kind); }
  if (source_ref) { w.push('source_ref = ?'); p.push(source_ref); }
  return H.prepare(`SELECT * FROM ck_actions ${w.length ? 'WHERE ' + w.join(' AND ') : ''} ORDER BY CASE WHEN due_date IS NULL THEN 1 ELSE 0 END, due_date, created_at LIMIT 2000`).all(...p);
}
async function updateAction(id, patch, by) {
  const { H } = handle();
  const cur = await getAction(id);
  if (!cur) return null;
  const status = patch.status || cur.status;
  const doneAt = status === 'done' ? (cur.done_at || now()) : null;
  await H.prepare(`UPDATE ck_actions SET status = ?, done_at = ?, owner = ?, due_date = ?, title = ?, updated_by = ?, updated_at = ? WHERE id = ?`)
    .run(status, doneAt, patch.owner !== undefined ? patch.owner : cur.owner, patch.due_date !== undefined ? patch.due_date : cur.due_date,
      patch.title !== undefined ? patch.title : cur.title, by || null, now(), id);
  return getAction(id);
}

// ── Requests for information / decision ───────────────────────────────
async function addRfi(r, by) {
  const { H } = handle();
  const id = newId('R');
  await H.prepare(`INSERT INTO ck_rfis (id, title, description, category, requester, submitted_at, status) VALUES (?, ?, ?, ?, ?, ?, 'new')`)
    .run(id, r.title, r.description || null, r.category || null, by || null, now());
  return getRfi(id);
}
async function getRfi(id) {
  const { H } = handle();
  return H.prepare(`SELECT * FROM ck_rfis WHERE id = ?`).get(id);
}
async function listRfis({ status } = {}) {
  const { H } = handle();
  return status ? H.prepare(`SELECT * FROM ck_rfis WHERE status = ? ORDER BY submitted_at DESC`).all(status)
    : H.prepare(`SELECT * FROM ck_rfis ORDER BY submitted_at DESC LIMIT 1000`).all();
}
async function triageRfi(id, t, by) {
  const { H } = handle();
  await H.prepare(`UPDATE ck_rfis SET status = ?, value = ?, urgency = ?, effort = ?, score = ?, triage_note = ?, triaged_by = ?, triaged_at = ? WHERE id = ?`)
    .run(t.status, t.value, t.urgency, t.effort, t.score, t.note || null, by || null, now(), id);
  return getRfi(id);
}
async function decideRfi(id, decisionId, status) {
  const { H } = handle();
  await H.prepare(`UPDATE ck_rfis SET status = ?, decision_id = ?, decided_at = ? WHERE id = ?`).run(status, decisionId, now(), id);
  return getRfi(id);
}

module.exports = {
  cadences, handle, newId,
  createSession, getSession, listSessions, startSession, closeSession, getMinutes, markMinutesSent,
  items, startItem, endItem, setNotes,
  addDecision, decisions, addAction, getAction, listActions, updateAction,
  addRfi, getRfi, listRfis, triageRfi, decideRfi,
};
