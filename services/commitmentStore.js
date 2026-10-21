'use strict';
// 2027 Goal 02 — canonical commitment persistence on both backends (sqlite + PostgreSQL).
//
// PG tables come from db/postgres/reports/021_commitments.sql (migrator); sqlite runs SQLITE_DDL.
// `db` = better-sqlite3 handle or a services/pgDb-shaped { prepare } (prepare().get/all/run async).
// Every status change goes through services/commitmentLifecycle.checkTransition and is guarded by
// an optimistic `version` (a stale writer gets CONFLICT / 409). commitment_events is append-only.
// Evidence files go to services/blobStore (never inline base64 in the DB) with a server-computed
// sha256, a size cap and a mime allow-list checked against the file's own magic bytes.
// Source records (md_actions, insp_actions, action_items, tickets…) are NEVER written here.

const crypto = require('crypto');
const L = require('./commitmentLifecycle');
const { typed } = require('./httpError');

const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS commitments (
  id INTEGER PRIMARY KEY AUTOINCREMENT, uid TEXT UNIQUE NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
  site_id INTEGER, department TEXT, process TEXT, impact_dimension TEXT, priority TEXT, severity TEXT NOT NULL DEFAULT 'medium',
  accountable_owner TEXT, execution_owners TEXT, reviewer TEXT, due_date TEXT, baseline_due_date TEXT,
  exception_approved_by TEXT, exception_approved_at TEXT, exception_reason TEXT, treatment_plan TEXT,
  status TEXT NOT NULL DEFAULT 'captured', technical_completed_at TEXT, verified_at TEXT, verified_by TEXT,
  version INTEGER NOT NULL DEFAULT 1, created_by TEXT, created_at TEXT, updated_at TEXT);
CREATE INDEX IF NOT EXISTS idx_commitments_site_status ON commitments(site_id, status);
CREATE TABLE IF NOT EXISTS commitment_source_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT, commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  source_system TEXT NOT NULL, source_id TEXT NOT NULL, relation TEXT NOT NULL DEFAULT 'origin', created_by TEXT, created_at TEXT,
  UNIQUE (commitment_id, source_system, source_id));
CREATE INDEX IF NOT EXISTS idx_commitment_links_source ON commitment_source_links(source_system, source_id);
CREATE TABLE IF NOT EXISTS commitment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  at TEXT NOT NULL, actor TEXT, action TEXT NOT NULL, from_status TEXT, to_status TEXT, details TEXT);
CREATE INDEX IF NOT EXISTS idx_commitment_events_c ON commitment_events(commitment_id, id);
CREATE TABLE IF NOT EXISTS evidence_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT, commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'document', file_ref TEXT, url TEXT, filename TEXT, sha256 TEXT, size_bytes INTEGER, mime TEXT,
  uploaded_by TEXT, uploaded_at TEXT, site_id INTEGER, retention_class TEXT NOT NULL DEFAULT 'standard', version INTEGER NOT NULL DEFAULT 1, superseded_by INTEGER);
CREATE TABLE IF NOT EXISTS closure_verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT, commitment_id INTEGER NOT NULL REFERENCES commitments(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL, reviewer TEXT NOT NULL, decision TEXT NOT NULL, reason TEXT, at TEXT NOT NULL);`;

const EVIDENCE_MIME = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv'];
const EVIDENCE_TYPES = ['document', 'photo', 'screenshot', 'report', 'link', 'sign_off', 'other'];
const EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
const RETENTION = ['standard', 'audit', 'legal_hold'];
const EDITABLE = ['title', 'department', 'process', 'impact_dimension', 'priority', 'severity', 'accountable_owner', 'execution_owners', 'reviewer', 'due_date', 'treatment_plan'];

const str = (v, max = 4000) => (v == null || v === '' ? null : String(v).slice(0, max));
const J = (v) => JSON.stringify(Array.isArray(v) ? v.map((x) => String(x).slice(0, 200)).slice(0, 20) : []);
const P_ = (s) => { try { const v = JSON.parse(s); return Array.isArray(v) ? v : []; } catch (_) { return []; } };
const isoDate = (v) => (v == null || v === '' ? null : /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? String(v).slice(0, 10) : undefined);
const bad = (m) => typed('VALIDATION', m, 400);

/** Does the buffer really look like the declared mime? (magic bytes; text = no NUL byte). */
function sniffOk(buf, mime) {
  if (!Buffer.isBuffer(buf) || !buf.length) return false;
  const h = (n) => buf.slice(0, n);
  switch (mime) {
    case 'application/pdf': return h(4).toString('latin1') === '%PDF';
    case 'image/png': return h(8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg': return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case 'image/webp': return h(4).toString('latin1') === 'RIFF' && buf.slice(8, 12).toString('latin1') === 'WEBP';
    case 'text/plain': case 'text/csv': return !buf.includes(0);
    default: return false;
  }
}

function makeCommitmentStore(db, { isPg = false, now = () => new Date().toISOString(), blobs = null } = {}) {
  if (!db) throw new Error('commitmentStore needs a db handle');
  const P = (sql) => db.prepare(sql);
  const blob = () => blobs || require('./blobStore');
  async function init() { if (!isPg) { db.exec('PRAGMA foreign_keys=ON'); db.exec(SQLITE_DDL); } }
  async function insert(table, obj) {
    const cols = Object.keys(obj);
    const sql = `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
    const r = await P(sql + (isPg ? ' RETURNING id' : '')).run(...cols.map((c) => obj[c]));
    return isPg ? Number(r.lastID != null ? r.lastID : r.id) : Number(r.lastInsertRowid);
  }
  const actorName = (u) => (u ? String(u.username || u.full_name || u.id || 'system') : 'system');
  async function event(cid, actor, action, from, to, details) {
    await insert('commitment_events', { commitment_id: Number(cid), at: now(), actor: actorName(actor), action, from_status: from || null, to_status: to || null, details: details ? JSON.stringify(details) : null });
  }
  const row = (r) => r && ({ ...r, id: Number(r.id), site_id: r.site_id == null ? null : Number(r.site_id), version: Number(r.version), execution_owners: P_(r.execution_owners) });

  async function getRaw(id) { return row(await P('SELECT * FROM commitments WHERE id=?').get(Number(id))); }
  async function get(id) {
    const c = await getRaw(id); if (!c) return null;
    c.links = (await P('SELECT id, source_system, source_id, relation, created_by, created_at FROM commitment_source_links WHERE commitment_id=? ORDER BY id').all(c.id)).map((l) => ({ ...l, id: Number(l.id) }));
    c.evidence = (await P('SELECT id, type, url, filename, sha256, size_bytes, mime, uploaded_by, uploaded_at, retention_class, version, superseded_by FROM evidence_items WHERE commitment_id=? ORDER BY id').all(c.id))
      .map((e) => ({ ...e, id: Number(e.id), size_bytes: e.size_bytes == null ? null : Number(e.size_bytes), version: Number(e.version), superseded_by: e.superseded_by == null ? null : Number(e.superseded_by) }));
    c.verifications = (await P('SELECT attempt, reviewer, decision, reason, at FROM closure_verifications WHERE commitment_id=? ORDER BY attempt').all(c.id)).map((v) => ({ ...v, attempt: Number(v.attempt) }));
    c.events = (await P('SELECT id, at, actor, action, from_status, to_status, details FROM commitment_events WHERE commitment_id=? ORDER BY id').all(c.id))
      .map((e) => ({ ...e, id: Number(e.id), details: e.details ? JSON.parse(e.details) : null }));
    return c;
  }
  async function findBySource(system, sourceId) {
    const r = await P('SELECT commitment_id FROM commitment_source_links WHERE source_system=? AND source_id=? ORDER BY id LIMIT 1').get(String(system), String(sourceId));
    return r ? Number(r.commitment_id) : null;
  }

  function validateFields(d, partial) {
    const out = {};
    if (!partial || d.title !== undefined) { if (!str(d.title)) throw bad('title is required'); out.title = str(d.title, 300); }
    if (!partial || d.kind !== undefined) { if (!L.KINDS.includes(d.kind)) throw bad(`kind must be one of ${L.KINDS.join(', ')}`); out.kind = d.kind; }
    if (d.severity !== undefined) { const s = d.severity || 'medium'; if (!L.SEVERITIES.includes(s)) throw bad('unknown severity'); out.severity = s; }
    if (d.priority !== undefined) { if (d.priority && !L.PRIORITIES.includes(d.priority)) throw bad('unknown priority'); out.priority = d.priority || null; }
    if (d.due_date !== undefined) { const v = isoDate(d.due_date); if (v === undefined) throw bad('due_date must be YYYY-MM-DD'); out.due_date = v; }
    if (d.execution_owners !== undefined) out.execution_owners = J(d.execution_owners);
    for (const k of ['department', 'process', 'impact_dimension', 'accountable_owner', 'reviewer']) if (d[k] !== undefined) out[k] = str(d[k], 200);
    if (d.treatment_plan !== undefined) out.treatment_plan = str(d.treatment_plan, 4000);
    return out;
  }

  /**
   * Create a commitment. Idempotent on the source natural key: a (source_system, source_id) already
   * linked returns the existing commitment with created:false.
   */
  async function create(d, { user } = {}) {
    d = d || {};
    const src = d.source && d.source.system ? { system: String(d.source.system), id: String(d.source.id) } : null;
    if (src && !L.SOURCE_SYSTEMS.includes(src.system)) throw bad('unknown source_system');
    if (src) { const ex = await findBySource(src.system, src.id); if (ex) return { commitment: await get(ex), created: false }; }
    const f = validateFields(d, false);
    const site = d.site_id == null || d.site_id === '' ? null : Number(d.site_id);
    if (site != null && !Number.isInteger(site)) throw bad('site_id must be an integer');
    const t = now();
    const id = await insert('commitments', { uid: crypto.randomUUID(), site_id: site, severity: 'medium', ...f, baseline_due_date: f.due_date || null, status: 'captured', version: 1, created_by: actorName(user), created_at: t, updated_at: t });
    await event(id, user, 'created', null, 'captured', src ? { source: src } : null);
    if (src) await link(id, { source_system: src.system, source_id: src.id, relation: 'origin' }, { user, silent: true });
    return { commitment: await get(id), created: true };
  }

  async function bump(c, expectedVersion, sets) {
    if (expectedVersion == null || Number(expectedVersion) !== c.version) throw typed('CONFLICT', `stale version (current ${c.version})`, 409);
    const keys = Object.keys(sets);
    const r = await P(`UPDATE commitments SET ${keys.map((k) => `${k}=?`).join(', ')}, version=version+1, updated_at=? WHERE id=? AND version=?`)
      .run(...keys.map((k) => sets[k]), now(), c.id, c.version);
    if (!r || Number(r.changes) !== 1) throw typed('CONFLICT', 'the commitment changed meanwhile — reload', 409);
  }

  /** Edit fields. A due-date change keeps baseline_due_date and needs a reason (logged). */
  async function update(id, patch, { user, expectedVersion, reason } = {}) {
    const c = await getRaw(id); if (!c) throw typed('NOT_FOUND', 'commitment not found', 404);
    if (L.TERMINAL.includes(c.status)) throw bad(`a ${c.status} commitment is read-only — reopen it first`);
    const f = validateFields(Object.fromEntries(Object.entries(patch || {}).filter(([k]) => EDITABLE.includes(k))), true);
    if (!Object.keys(f).length) throw bad('nothing to update');
    const dueChanged = f.due_date !== undefined && f.due_date !== c.due_date;
    if (dueChanged && c.due_date && !str(reason)) throw bad('a reason is required to change the due date');
    if (dueChanged && !c.baseline_due_date) f.baseline_due_date = f.due_date;
    await bump(c, expectedVersion, f);
    await event(c.id, user, dueChanged ? 'due_date_changed' : 'updated', c.status, c.status,
      { fields: Object.keys(f), ...(dueChanged ? { from: c.due_date, to: f.due_date, reason: str(reason, 500) } : {}) });
    return get(c.id);
  }

  async function transition(id, to, { actor, expectedVersion, reason } = {}) {
    const c = await getRaw(id); if (!c) throw typed('NOT_FOUND', 'commitment not found', 404);
    const chk = L.checkTransition(c, to, actor, { reason });
    if (!chk.ok) throw typed(chk.code, chk.reason, chk.status);
    const t = now(), sets = { status: to };
    if (to === 'awaiting_verification') sets.technical_completed_at = t;
    if (to === 'verified_closed') { sets.verified_at = t; sets.verified_by = actorName(actor); }
    if (to === 'reopened') { sets.verified_at = null; sets.verified_by = null; }
    await bump(c, expectedVersion, sets);
    const decision = L.VERIFY_DECISION[to];
    if (decision) {
      const n = await P('SELECT COUNT(*) AS n FROM closure_verifications WHERE commitment_id=?').get(c.id);
      await insert('closure_verifications', { commitment_id: c.id, attempt: Number(n.n) + 1, reviewer: actorName(actor), decision, reason: str(reason, 2000), at: t });
    }
    await event(c.id, actor, 'transition', c.status, to, reason ? { reason: str(reason, 2000) } : null);
    return get(c.id);
  }

  async function approveException(id, { user, expectedVersion, reason } = {}) {
    const c = await getRaw(id); if (!c) throw typed('NOT_FOUND', 'commitment not found', 404);
    if (!str(reason)) throw bad('a reason is required to approve an exception');
    await bump(c, expectedVersion, { exception_approved_by: actorName(user), exception_approved_at: now(), exception_reason: str(reason, 1000) });
    await event(c.id, user, 'exception_approved', c.status, c.status, { reason: str(reason, 1000) });
    return get(c.id);
  }

  async function link(id, l, { user, silent = false } = {}) {
    if (!L.SOURCE_SYSTEMS.includes(l && l.source_system)) throw bad('unknown source_system');
    if (!str(l.source_id)) throw bad('source_id is required');
    const sid = String(l.source_id).slice(0, 120);
    const ex = await P('SELECT id FROM commitment_source_links WHERE commitment_id=? AND source_system=? AND source_id=?').get(Number(id), l.source_system, sid);
    if (!ex) {
      await insert('commitment_source_links', { commitment_id: Number(id), source_system: l.source_system, source_id: sid, relation: str(l.relation, 40) || 'related', created_by: actorName(user), created_at: now() });
      if (!silent) await event(id, user, 'linked', null, null, { source_system: l.source_system, source_id: sid });
    }
    return get(id);
  }
  async function unlink(id, l, { user } = {}) {
    await P('DELETE FROM commitment_source_links WHERE commitment_id=? AND source_system=? AND source_id=?').run(Number(id), String(l.source_system), String(l.source_id));
    await event(id, user, 'unlinked', null, null, { source_system: l.source_system, source_id: String(l.source_id) });
    return get(id);
  }

  /** Evidence: a file (Buffer) OR an url. Checksum computed here; mime must be allow-listed AND match the bytes. */
  async function addEvidence(id, { buffer, mime, filename, url, type = 'document', retention_class = 'standard', supersedes = null }, { user } = {}) {
    const c = await getRaw(id); if (!c) throw typed('NOT_FOUND', 'commitment not found', 404);
    if (!EVIDENCE_TYPES.includes(type)) throw bad('unknown evidence type');
    if (!RETENTION.includes(retention_class)) throw bad('unknown retention_class');
    const t = now();
    let version = 1;
    if (supersedes != null) {
      const old = await P('SELECT id, version FROM evidence_items WHERE id=? AND commitment_id=?').get(Number(supersedes), c.id);
      if (!old) throw typed('NOT_FOUND', 'superseded evidence not found', 404);
      version = Number(old.version) + 1;
    }
    const rec = { commitment_id: c.id, type, uploaded_by: actorName(user), uploaded_at: t, site_id: c.site_id, retention_class, version };
    if (url != null) {
      if (!/^https:\/\/[^\s]{4,2000}$/i.test(String(url))) throw bad('evidence url must be https');
      Object.assign(rec, { url: String(url), type: type === 'document' ? 'link' : type });
    } else {
      const m = String(mime || '').split(';')[0].trim().toLowerCase();
      if (!EVIDENCE_MIME.includes(m)) throw typed('VALIDATION', `file type not allowed (${EVIDENCE_MIME.join(', ')})`, 415);
      if (!Buffer.isBuffer(buffer) || !buffer.length) throw bad('empty file');
      if (buffer.length > EVIDENCE_MAX_BYTES) throw typed('VALIDATION', 'file too large', 413);
      if (!sniffOk(buffer, m)) throw typed('VALIDATION', 'file content does not match its declared type', 415);
      const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
      const n = await P('SELECT COUNT(*) AS n FROM evidence_items WHERE commitment_id=?').get(c.id);
      const put = blob().putB64('commitments', c.uid, `ev-${Number(n.n) + 1}-v${version}`, m, buffer.toString('base64'));
      Object.assign(rec, { file_ref: put.ref, filename: str(filename, 200), sha256, size_bytes: buffer.length, mime: m });
    }
    const eid = await insert('evidence_items', rec);
    if (supersedes != null) await P('UPDATE evidence_items SET superseded_by=? WHERE id=?').run(eid, Number(supersedes));
    await event(c.id, user, 'evidence_added', c.status, c.status, { evidence_id: eid, sha256: rec.sha256 || null, url: rec.url || null, supersedes });
    return { id: eid, sha256: rec.sha256 || null, commitment: await get(c.id) };
  }
  async function getEvidenceFile(id, eid) {
    const e = await P('SELECT file_ref, mime, filename, sha256 FROM evidence_items WHERE id=? AND commitment_id=?').get(Number(eid), Number(id));
    if (!e || !e.file_ref) return null;
    const b64 = blob().getB64(e.file_ref); if (b64 == null) return null;
    return { buffer: Buffer.from(b64, 'base64'), mime: e.mime, filename: e.filename, sha256: e.sha256 };
  }

  /** siteIds = null → unscoped (admin tier); [] → nothing (site-less non-admin). */
  //  named = identities (username / e-mail …) of a non-admin: commitments where they are the designated
  //  reviewer or the accountable owner are visible too, even on another site (a business reviewer).
  async function list({ siteIds = null, named = [], status = null, kind = null, site = null, limit = 500 } = {}) {
    const ids = (named || []).map((x) => String(x).trim().toLowerCase()).filter(Boolean);
    if (Array.isArray(siteIds) && !siteIds.length && !ids.length) return [];
    const where = [], args = [];
    if (Array.isArray(siteIds)) {
      const parts = [];
      if (siteIds.length) { parts.push(`site_id IN (${siteIds.map(() => '?').join(',')})`); args.push(...siteIds.map(Number)); }
      if (ids.length) { parts.push(`lower(reviewer) IN (${ids.map(() => '?').join(',')}) OR lower(accountable_owner) IN (${ids.map(() => '?').join(',')})`); args.push(...ids, ...ids); }
      where.push(`(${parts.join(' OR ')})`);
    }
    if (site != null && site !== '') { where.push('site_id=?'); args.push(Number(site)); }
    if (status) { const st = String(status).split(',').filter((s) => L.STATUSES.includes(s)); if (st.length) { where.push(`status IN (${st.map(() => '?').join(',')})`); args.push(...st); } }
    if (kind && L.KINDS.includes(kind)) { where.push('kind=?'); args.push(kind); }
    return (await P(`SELECT * FROM commitments${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ${Math.min(2000, Number(limit) || 500)}`).all(...args)).map(row);
  }

  /** Commitments linked to (system, id) pairs — for the Site Actions hub badge. Map "system:id" → {id,status}. */
  async function linksFor(pairs) {
    const out = new Map(); const list = (pairs || []).filter((p) => p && p.system && p.id != null);
    for (let i = 0; i < list.length; i += 200) {
      const chunk = list.slice(i, i + 200);
      const rows = await P(`SELECT l.source_system, l.source_id, c.id, c.status, c.site_id FROM commitment_source_links l JOIN commitments c ON c.id=l.commitment_id
        WHERE ${chunk.map(() => '(l.source_system=? AND l.source_id=?)').join(' OR ')}`).all(...chunk.flatMap((p) => [p.system, String(p.id)]));
      for (const r of rows) out.set(`${r.source_system}:${r.source_id}`, { id: Number(r.id), status: r.status, site_id: r.site_id == null ? null : Number(r.site_id) });
    }
    return out;
  }

  /** Raw rows for the draft metrics (services/commitmentMetrics). */
  async function metricRows({ siteIds = null } = {}) {
    if (Array.isArray(siteIds) && !siteIds.length) return [];
    const where = Array.isArray(siteIds) ? ` WHERE site_id IN (${siteIds.map(() => '?').join(',')})` : '';
    return P(`SELECT id, site_id, status, due_date, baseline_due_date, technical_completed_at, verified_at FROM commitments${where}`).all(...(siteIds || []).map(Number));
  }

  return { init, create, get, getRaw, findBySource, update, transition, approveException, link, unlink, addEvidence, getEvidenceFile, list, linksFor, metricRows };
}

module.exports = { makeCommitmentStore, SQLITE_DDL, EVIDENCE_MIME, EVIDENCE_TYPES, EVIDENCE_MAX_BYTES, sniffOk };
