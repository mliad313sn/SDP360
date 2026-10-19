'use strict';
// Step 10 — PURE rules of the offline field outbox. An outbox item is an ENVELOPE the phone queued
// while offline: { uuid, kind, payload, client_ts, device }. The server applies it exactly once
// (idempotent on uuid), records the result, and the phone deletes the item on any terminal answer.
// Conflict policy (arbitration 3): LAST WRITE WINS for inspections and actions; tracker cells obey
// the closed-month lock (a closed slot is kept as stored, counted `blocked`). Photos are capped at
// MAX_PHOTO_BYTES (arbitration 4) and travel in CHUNKS so a connectivity drop never loses a whole
// photo — a missing chunk is re-sent, never the file.

const crypto = require('crypto');

const KINDS = ['inspection', 'tracker', 'action', 'ticket'];
const MAX_PHOTO_BYTES = 300 * 1024;
const CHUNK_BYTES = 64 * 1024;
const MAX_CHUNKS = 64;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-7][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONFLICT_POLICY = { inspection: 'last-write-wins', action: 'last-write-wins', tracker: 'last-write-wins + closed-month lock', ticket: 'create-once' };

/** @returns {{ok:boolean, errors:string[]}} */
function validateEnvelope(env) {
  const errors = [];
  if (!env || typeof env !== 'object') return { ok: false, errors: ['envelope must be an object'] };
  if (!UUID_RE.test(String(env.uuid || ''))) errors.push('uuid must be a UUID (v4)');
  if (!KINDS.includes(env.kind)) errors.push(`kind must be one of ${KINDS.join(', ')}`);
  if (!env.payload || typeof env.payload !== 'object') errors.push('payload must be an object');
  if (env.client_ts != null && !Number.isFinite(Date.parse(env.client_ts))) errors.push('client_ts must be an ISO date');
  if (env.device != null && String(env.device).length > 120) errors.push('device label too long');
  return { ok: errors.length === 0, errors };
}

/** Stable hash of a payload — the same uuid re-sent with a DIFFERENT payload is a conflict (409). */
function payloadHash(payload) { return crypto.createHash('sha256').update(stableJson(payload)).digest('hex'); }
function stableJson(v) {
  if (v == null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableJson).join(',') + ']';
  return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stableJson(v[k])).join(',') + '}';
}

/** Plan a chunked upload. Throws INVALID when the photo is over the cap. */
function chunkPlan(sizeBytes, chunkBytes = CHUNK_BYTES) {
  const size = Number(sizeBytes);
  if (!Number.isInteger(size) || size <= 0) throw Object.assign(new Error('size must be a positive integer'), { code: 'INVALID' });
  if (size > MAX_PHOTO_BYTES) throw Object.assign(new Error(`photo is ${size} bytes — the field cap is ${MAX_PHOTO_BYTES} (compress on the device first)`), { code: 'INVALID' });
  const cb = Math.min(CHUNK_BYTES, Math.max(4096, Number(chunkBytes) || CHUNK_BYTES));
  const total = Math.ceil(size / cb);
  if (total > MAX_CHUNKS) throw Object.assign(new Error('too many chunks'), { code: 'INVALID' });
  return { chunk_bytes: cb, chunks_total: total, size };
}

/** Which chunk indices are still missing (so the phone re-sends only those). */
function missingChunks(received, total) { const have = new Set((received || []).map(Number)); const out = []; for (let i = 0; i < total; i++) if (!have.has(i)) out.push(i); return out; }

/** Assemble base64 chunks in index order → Buffer. Throws INVALID when one is missing or the size disagrees. */
function assembleChunks(chunks, { total, size } = {}) {
  const byIdx = new Map((chunks || []).map(c => [Number(c.idx), c.data]));
  const n = total != null ? Number(total) : byIdx.size;
  const parts = [];
  for (let i = 0; i < n; i++) { if (!byIdx.has(i)) throw Object.assign(new Error(`chunk ${i} missing`), { code: 'INVALID', missing: missingChunks([...byIdx.keys()], n) }); parts.push(Buffer.from(byIdx.get(i), 'base64')); }
  const buf = Buffer.concat(parts);
  if (size != null && buf.length !== Number(size)) throw Object.assign(new Error(`assembled ${buf.length} bytes, expected ${size}`), { code: 'INVALID' });
  if (buf.length > MAX_PHOTO_BYTES) throw Object.assign(new Error('assembled photo over the field cap'), { code: 'INVALID' });
  return buf;
}

/** A tracker payload: { key, cells:[{unit,item,slot,value,note}] } — shape only; the store applies scope + lock. */
function validateTrackerPayload(p) {
  if (!p || typeof p.key !== 'string' || !p.key) return 'tracker payload needs key';
  if (!Array.isArray(p.cells) || !p.cells.length) return 'tracker payload needs cells[]';
  if (p.cells.length > 2000) return 'too many cells in one envelope';
  return null;
}
/** An action payload: { source:'inspection'|'meetings', id, status_change, body, helpdesk_ticket }. */
function validateActionPayload(p) {
  if (!p || !['inspection', 'meetings'].includes(p.source)) return 'action payload needs source inspection|meetings';
  if (!Number.isInteger(Number(p.id)) || Number(p.id) <= 0) return 'action payload needs a numeric id';
  if (!p.status_change && !(p.body && String(p.body).trim())) return 'action payload needs a status_change or a comment';
  return null;
}
/** A ticket payload (quick action → SDP): { subject, description, site, inspection_id? }. */
function validateTicketPayload(p) {
  if (!p || !p.subject || !String(p.subject).trim()) return 'ticket payload needs a subject';
  if (String(p.subject).length > 250) return 'subject too long';
  return null;
}

/** Freshness stamp the app shows: "data as of" from the newest as_of across widgets, else null (never now()). */
function dataAsOf(widgets) { let max = null; for (const w of Object.values(widgets || {})) { const t = w && w.as_of ? Date.parse(w.as_of) : NaN; if (Number.isFinite(t) && (max == null || t > max)) max = t; } return max == null ? null : new Date(max).toISOString(); }

module.exports = { KINDS, MAX_PHOTO_BYTES, CHUNK_BYTES, MAX_CHUNKS, CONFLICT_POLICY, validateEnvelope, payloadHash, stableJson, chunkPlan, missingChunks, assembleChunks, validateTrackerPayload, validateActionPayload, validateTicketPayload, dataAsOf };
