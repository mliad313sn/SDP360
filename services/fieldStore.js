'use strict';
// Step 10 — persistence of the field outbox (idempotency ledger) and chunked uploads.
// sqlite + PostgreSQL (db/postgres/reports/020_field.sql). The outbox row is written BEFORE the
// business write and finished after it, so a crash between the two leaves a `received` row that the
// next identical PUT completes instead of applying twice.

const SQLITE_DDL = `
CREATE TABLE IF NOT EXISTS field_outbox (
  uuid TEXT PRIMARY KEY, user_id INTEGER NOT NULL, kind TEXT NOT NULL, payload_hash TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'received',
  result TEXT, client_ts TEXT, device TEXT, received_at TEXT DEFAULT CURRENT_TIMESTAMP, applied_at TEXT);
CREATE INDEX IF NOT EXISTS idx_field_outbox_user ON field_outbox(user_id, received_at);
CREATE TABLE IF NOT EXISTS field_uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, owner_kind TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL, mime TEXT NOT NULL,
  size INTEGER NOT NULL, chunk_bytes INTEGER NOT NULL, chunks_total INTEGER NOT NULL, received TEXT NOT NULL DEFAULT '[]', ref TEXT, status TEXT NOT NULL DEFAULT 'open',
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, completed_at TEXT);
CREATE TABLE IF NOT EXISTS field_chunks (upload_id INTEGER NOT NULL REFERENCES field_uploads(id) ON DELETE CASCADE, idx INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (upload_id, idx));`;

const STATUSES = ['received', 'applied', 'rejected', 'failed'];
const J = (v) => (v == null ? null : JSON.stringify(v));
const P_ = (s, d) => { if (s == null) return d; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch (_) { return d; } };

function makeFieldStore(db, { isPg = false, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new Error('fieldStore needs a db handle');
  const P = (sql) => db.prepare(sql);
  async function init() { if (!isPg) { db.exec('PRAGMA foreign_keys=ON'); db.exec(SQLITE_DDL); } }
  async function insert(table, cols, vals) {
    const r = await P(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})${isPg ? ' RETURNING id' : ''}`).run(...vals);
    return isPg ? Number(r && (r.id != null ? r.id : r.lastID != null ? r.lastID : (r.rows && r.rows[0] && r.rows[0].id))) : Number(r.lastInsertRowid);
  }
  const obRow = (r) => r && ({ ...r, user_id: Number(r.user_id), result: P_(r.result, null) });

  // ── outbox ledger ─────────────────────────────────────────────────────────────────
  async function getOutbox(uuid) { return obRow(await P(`SELECT * FROM field_outbox WHERE uuid=?`).get(String(uuid))); }
  /** First sight of a uuid → row `received`. Returns the existing row untouched when already known. */
  async function receive({ uuid, userId, kind, payloadHash, clientTs = null, device = null }) {
    const ex = await getOutbox(uuid); if (ex) return ex;
    await P(`INSERT INTO field_outbox (uuid, user_id, kind, payload_hash, status, client_ts, device, received_at) VALUES (?,?,?,?,'received',?,?,?)`).run(String(uuid), Number(userId), kind, payloadHash, clientTs, device == null ? null : String(device).slice(0, 120), now());
    return getOutbox(uuid);
  }
  async function finish(uuid, status, result) {
    if (!STATUSES.includes(status)) throw Object.assign(new Error('bad outbox status'), { code: 'INVALID' });
    await P(`UPDATE field_outbox SET status=?, result=?, applied_at=? WHERE uuid=?`).run(status, J(result), now(), String(uuid));
    return getOutbox(uuid);
  }
  async function listOutbox(userId, { limit = 100, since = null } = {}) {
    return (await P(`SELECT * FROM field_outbox WHERE user_id=?${since ? ' AND received_at>=?' : ''} ORDER BY received_at DESC LIMIT ${Math.min(500, Number(limit) || 100)}`).all(...[Number(userId)].concat(since ? [since] : []))).map(obRow);
  }
  /** Sync health for the admin: counts per status over a window + stuck `received` rows (crash between ledger and write). */
  async function outboxStats({ since = null } = {}) {
    const rows = await P(`SELECT status, COUNT(*) AS n FROM field_outbox${since ? ' WHERE received_at>=?' : ''} GROUP BY status`).all(...(since ? [since] : []));
    const out = { received: 0, applied: 0, rejected: 0, failed: 0 }; for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }
  async function purgeOutbox({ days = 90 } = {}) { const r = await P(`DELETE FROM field_outbox WHERE received_at<?`).run(new Date(Date.parse(now()) - days * 864e5).toISOString()); return Number(r && r.changes) || 0; }

  // ── chunked uploads ───────────────────────────────────────────────────────────────
  const upRow = (r) => r && ({ ...r, id: Number(r.id), user_id: Number(r.user_id), size: Number(r.size), chunk_bytes: Number(r.chunk_bytes), chunks_total: Number(r.chunks_total), received: P_(r.received, []) });
  async function createUpload({ userId, ownerKind, ownerId, name, mime, size, chunkBytes, chunksTotal }) {
    const id = await insert('field_uploads', ['user_id', 'owner_kind', 'owner_id', 'name', 'mime', 'size', 'chunk_bytes', 'chunks_total', 'received', 'status', 'created_at'],
      [Number(userId), String(ownerKind).slice(0, 40), String(ownerId).slice(0, 120), String(name).slice(0, 120), String(mime).slice(0, 80), Number(size), Number(chunkBytes), Number(chunksTotal), '[]', 'open', now()]);
    return getUpload(id);
  }
  async function getUpload(id) { return upRow(await P(`SELECT * FROM field_uploads WHERE id=?`).get(Number(id))); }
  /** Idempotent: the same idx twice is one chunk. Returns the updated upload (with `missing`). */
  async function putChunk(id, idx, dataB64) {
    const u = await getUpload(id); if (!u) return null;
    if (u.status !== 'open') throw Object.assign(new Error('upload already completed'), { code: 'INVALID' });
    const i = Number(idx); if (!Number.isInteger(i) || i < 0 || i >= u.chunks_total) throw Object.assign(new Error(`chunk index out of range (0..${u.chunks_total - 1})`), { code: 'INVALID' });
    if (!dataB64 || typeof dataB64 !== 'string') throw Object.assign(new Error('chunk data (base64) required'), { code: 'INVALID' });
    const ex = await P(`SELECT idx FROM field_chunks WHERE upload_id=? AND idx=?`).get(u.id, i);
    if (ex) await P(`UPDATE field_chunks SET data=? WHERE upload_id=? AND idx=?`).run(dataB64, u.id, i);
    else await P(`INSERT INTO field_chunks (upload_id, idx, data) VALUES (?,?,?)`).run(u.id, i, dataB64);
    const received = Array.from(new Set(u.received.concat([i]))).sort((a, b) => a - b);
    await P(`UPDATE field_uploads SET received=? WHERE id=?`).run(JSON.stringify(received), u.id);
    return getUpload(u.id);
  }
  async function chunksOf(id) { return (await P(`SELECT idx, data FROM field_chunks WHERE upload_id=? ORDER BY idx`).all(Number(id))).map(c => ({ idx: Number(c.idx), data: c.data })); }
  /** Mark complete with its blob ref and drop the chunks (the blob store now holds the bytes). */
  async function completeUpload(id, ref) {
    await P(`UPDATE field_uploads SET status='done', ref=?, completed_at=? WHERE id=?`).run(String(ref), now(), Number(id));
    await P(`DELETE FROM field_chunks WHERE upload_id=?`).run(Number(id));
    return getUpload(id);
  }
  async function listUploads(userId, { limit = 100 } = {}) { return (await P(`SELECT * FROM field_uploads WHERE user_id=? ORDER BY created_at DESC LIMIT ${Math.min(500, Number(limit) || 100)}`).all(Number(userId))).map(upRow); }
  /** Abandoned open uploads older than `hours` are removed with their chunks (cascade). */
  async function purgeUploads({ hours = 48 } = {}) { const cut = new Date(Date.parse(now()) - hours * 3600e3).toISOString(); const rows = await P(`SELECT id FROM field_uploads WHERE status='open' AND created_at<?`).all(cut); for (const r of rows) { await P(`DELETE FROM field_chunks WHERE upload_id=?`).run(Number(r.id)); await P(`DELETE FROM field_uploads WHERE id=?`).run(Number(r.id)); } return rows.length; }

  return { init, getOutbox, receive, finish, listOutbox, outboxStats, purgeOutbox, createUpload, getUpload, putChunk, chunksOf, completeUpload, listUploads, purgeUploads, STATUSES };
}

module.exports = { makeFieldStore, SQLITE_DDL, STATUSES };
