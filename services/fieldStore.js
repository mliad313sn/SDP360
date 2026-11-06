'use strict';
// Step 10 — persistence of the field outbox (idempotency ledger) and chunked uploads.
// sqlite + PostgreSQL (db/postgres/reports/020_field.sql). The outbox row is written BEFORE the
// business write and finished after it, so a crash between the two leaves a `received` row that the
// next identical PUT completes instead of applying twice.


const STATUSES = ['received', 'applying', 'applied', 'rejected', 'failed'];
const J = (v) => (v == null ? null : JSON.stringify(v));
const P_ = (s, d) => { if (s == null) return d; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch (_) { return d; } };

function makeFieldStore(db, { isPg = false, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new Error('fieldStore needs a db handle');
  const P = (sql) => db.prepare(sql);
  async function init() {  }
  async function insert(table, cols, vals) {
    const r = await P(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})${(' RETURNING id')}`).run(...vals);
    return (Number(r && (r.id != null ? r.id : r.lastID != null ? r.lastID : (r.rows && r.rows[0] && r.rows[0].id))));
  }
  const NO_RECLAIM = ['ticket', 'action'];
  const obRow = (r) => r && ({ ...r, user_id: Number(r.user_id), result: P_(r.result, null) });

  // ── outbox ledger ─────────────────────────────────────────────────────────────────
  async function getOutbox(uuid) { return obRow(await P(`SELECT * FROM field_outbox WHERE uuid=?`).get(String(uuid))); }
  /** First sight of a uuid → row `received`. Returns the existing row untouched when already known. */
  async function receive({ uuid, userId, kind, payloadHash, clientTs = null, device = null }) {
    const ex = await getOutbox(uuid); if (ex) return ex;
    // two simultaneous first sends: the second INSERT does nothing (no primary-key 500), both read the same row
    await P(`INSERT INTO field_outbox (uuid, user_id, kind, payload_hash, status, client_ts, device, received_at) VALUES (?,?,?,?,'received',?,?,?) ON CONFLICT (uuid) DO NOTHING`).run(String(uuid), Number(userId), kind, payloadHash, clientTs, device == null ? null : String(device).slice(0, 120), now());
    return getOutbox(uuid);
  }
  /** G19 — take the envelope for applying, atomically: only one request wins (returns its claim id, else null),
   * and a transient failure stays retryable (failed → applying). A claim that has been 'applying' longer than
   * staleMs (a crashed request) can be taken again — EXCEPT for kinds whose effect is not idempotent (a ticket
   * creates an SDP request, an action appends a history row): those are never re-claimed automatically. The
   * window (15 min) sits well above every upstream timeout (IIS ARR proxy 5 min). */
  async function claim(uuid, { staleMs = 15 * 60000, kind = null } = {}) {
    const cut = new Date(Date.parse(now()) - staleMs).toISOString();
    const id = require('crypto').randomUUID();
    const reclaim = kind && NO_RECLAIM.includes(kind) ? '' : " OR (status='applying' AND (claimed_at IS NULL OR claimed_at < ?))";
    const r = await P(`UPDATE field_outbox SET status='applying', claim_id=?, claimed_at=? WHERE uuid=? AND (status IN ('received','failed')${reclaim})`).run(id, now(), String(uuid), ...(reclaim ? [cut] : []));
    return Number(r && r.changes) === 1 ? id : null;
  }
  /** finish(uuid, status, result, claimId?) — with a claim id, only the holder of the claim may write (a request
   * whose claim was taken over cannot overwrite the newer outcome). */
  async function finish(uuid, status, result, claimId = null) {
    if (!STATUSES.includes(status)) throw Object.assign(new Error('bad outbox status'), { code: 'INVALID' });
    const r = await P(`UPDATE field_outbox SET status=?, result=?, applied_at=?, claim_id=NULL WHERE uuid=?${claimId ? ' AND claim_id=?' : ''}`).run(status, J(result), now(), String(uuid), ...(claimId ? [claimId] : []));
    if (claimId && Number(r && r.changes) !== 1) throw Object.assign(new Error('the claim on this entry was lost — its outcome is recorded by another request'), { code: 'CONFLICT' });
    return getOutbox(uuid);
  }
  async function listOutbox(userId, { limit = 100, since = null } = {}) {
    return (await P(`SELECT * FROM field_outbox WHERE user_id=?${since ? ' AND received_at>=?' : ''} ORDER BY received_at DESC LIMIT ${Math.max(1, Math.min(500, Math.floor(Number(limit)) || 100))}`).all(...[Number(userId)].concat(since ? [since] : []))).map(obRow);
  }
  /** Sync health for the admin: counts per status over a window + stuck `received` rows (crash between ledger and write). */
  async function outboxStats({ since = null } = {}) {
    const rows = await P(`SELECT status, COUNT(*) AS n FROM field_outbox${since ? ' WHERE received_at>=?' : ''} GROUP BY status`).all(...(since ? [since] : []));
    const out = { received: 0, applying: 0, applied: 0, rejected: 0, failed: 0 }; for (const r of rows) out[r.status] = Number(r.n);
    return out;
  }
  /** E-F01 (X-F-01) — only FINAL rows (applied / rejected) are purged. An entry still received / applying /
   * failed is the only server trace of an unresolved field record: it is kept (and counted) whatever its age. */
  async function purgeOutbox({ days = 90 } = {}) {
    const cut = new Date(Date.parse(now()) - days * 864e5).toISOString();
    const r = await P(`DELETE FROM field_outbox WHERE received_at<? AND status IN ('applied','rejected')`).run(cut);
    const k = await P(`SELECT COUNT(*) AS n FROM field_outbox WHERE received_at<? AND status IN ('received','applying','failed')`).get(cut);
    return { deleted: Number(r && r.changes) || 0, kept_unresolved: Number(k && k.n) || 0 };
  }

  // ── E-F01 admin diagnostic + authorised resolution ───────────────────────────────────
  const OPEN = ['received', 'applying', 'failed'];
  const ageMin = (iso, nowMs) => (iso ? Math.max(0, Math.round((nowMs - Date.parse(iso)) / 60000)) : null);
  /** Unresolved entries for the admin. NEVER a payload (the ledger holds only its hash): uuid, kind, user id,
   * status, ages, the recorded error and whether the outcome is unknown. */
  async function listUnresolved({ status = null, kind = null, since = null, olderThanMin = 0, limit = 200 } = {}) {
    const sts = status ? String(status).split(',').map((x) => x.trim()).filter((x) => OPEN.includes(x)) : OPEN;
    if (!sts.length) return [];
    const nowMs = Date.parse(now());
    const cut = new Date(nowMs - Math.max(0, Number(olderThanMin) || 0) * 60000).toISOString();
    const where = [`status IN (${sts.map(() => '?').join(',')})`, 'received_at<=?'], args = [...sts, cut];
    if (kind) { where.push('kind=?'); args.push(String(kind)); }
    if (since) { where.push('received_at>=?'); args.push(String(since)); }
    const rows = await P(`SELECT uuid, user_id, kind, status, received_at, claimed_at, applied_at, result FROM field_outbox WHERE ${where.join(' AND ')} ORDER BY received_at ASC LIMIT ${Math.max(1, Math.min(1000, Math.floor(Number(limit)) || 200))}`).all(...args);
    return rows.map((r) => { const res = P_(r.result, null) || {};
      return { uuid: r.uuid, kind: r.kind, user_id: Number(r.user_id), status: r.status, received_at: r.received_at, claimed_at: r.claimed_at || null,
        age_min: ageMin(r.received_at, nowMs), applying_for_min: r.status === 'applying' ? ageMin(r.claimed_at || r.received_at, nowMs) : null,
        error: res.error != null ? String(res.error).slice(0, 300) : null, outcome_unknown: !!res.outcome_unknown, not_reclaimable: NO_RECLAIM.includes(r.kind) }; });
  }
  /** resolve(uuid, {action, reason, confirmCheckedSdp, actor}) — nothing is ever applied server-side.
   *  mark_rejected : received|applying|failed → rejected (terminal; the phone deletes it on its next send).
   *  release       : applying → failed (the phone's next send applies it, exactly once through claim()).
   *                  For ticket / action (not idempotent) only with confirmCheckedSdp and a reason of ≥ 10 chars. */
  async function resolve(uuid, { action, reason, confirmCheckedSdp = false, actor = null } = {}) {
    const bad = (m, code = 'INVALID') => Object.assign(new Error(m), { code });
    if (!['mark_rejected', 'release'].includes(action)) throw bad('action must be mark_rejected or release');
    const why = String(reason == null ? '' : reason).trim();
    if (why.length < 3) throw bad('a reason is required');
    const row = await getOutbox(uuid); if (!row) throw bad('entry not found', 'NOT_FOUND');
    if (action === 'release') {
      if (row.status !== 'applying') throw bad(`only an entry in applying can be released (this one is ${row.status})`, 'CONFLICT');
      if (NO_RECLAIM.includes(row.kind) && (confirmCheckedSdp !== true || why.length < 10)) throw bad(`a ${row.kind} may already have reached its target: check it first, then confirm (confirm_checked_sdp) with a reason of at least 10 characters`);
    } else if (!OPEN.includes(row.status)) throw bad(`entry is already ${row.status}`, 'CONFLICT');
    const to = action === 'release' ? 'failed' : 'rejected';
    const prev = row.result || {};
    const result = action === 'release'
      ? { ...prev, error: prev.error || 'released by an administrator', released: { by: actor, reason: why.slice(0, 500), at: now() } }
      : { error: `refused by an administrator: ${why.slice(0, 300)}`, resolved: { by: actor, reason: why.slice(0, 500), at: now(), from: row.status } };
    const r = await P(`UPDATE field_outbox SET status=?, result=?, claim_id=NULL${to === 'rejected' ? ', applied_at=?' : ''} WHERE uuid=? AND status=?`)
      .run(...[to, J(result)].concat(to === 'rejected' ? [now()] : [], [String(uuid), row.status]));
    if (Number(r && r.changes) !== 1) throw bad('the entry changed meanwhile — reload and try again', 'CONFLICT');
    return { uuid: row.uuid, kind: row.kind, user_id: row.user_id, from: row.status, to };
  }

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
  async function listUploads(userId, { limit = 100 } = {}) { return (await P(`SELECT * FROM field_uploads WHERE user_id=? ORDER BY created_at DESC LIMIT ${Math.max(1, Math.min(500, Math.floor(Number(limit)) || 100))}`).all(Number(userId))).map(upRow); }
  /** Abandoned open uploads older than `hours` are removed with their chunks (cascade). */
  async function purgeUploads({ hours = 48 } = {}) { const cut = new Date(Date.parse(now()) - hours * 3600e3).toISOString(); const rows = await P(`SELECT id FROM field_uploads WHERE status='open' AND created_at<?`).all(cut); for (const r of rows) { await P(`DELETE FROM field_chunks WHERE upload_id=?`).run(Number(r.id)); await P(`DELETE FROM field_uploads WHERE id=?`).run(Number(r.id)); } return rows.length; }

  return { init, getOutbox, receive, claim, finish, listOutbox, outboxStats, purgeOutbox, listUnresolved, resolve, createUpload, getUpload, putChunk, chunksOf, completeUpload, listUploads, purgeUploads, STATUSES };
}

module.exports = { makeFieldStore, STATUSES };
