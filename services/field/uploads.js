'use strict';
// Step 10 — RESUMABLE photo uploads from the field app. A photo (≤ 300 KB after the phone compressed it) is sent in
// small chunks; each chunk is an idempotent PUT (sending it twice changes nothing), the client asks which chunks
// arrived to resume after a cut, and the upload is assembled and checked (size, type) only when complete. The upload
// id is chosen by the phone (a UUID), so a retry never creates a second upload. Chunks live on disk under
// <SDP_DATA_DIR>/field-uploads/<id>/, never in the database; finished uploads are attached to the inspection by
// services/field/inspections.js and their folder removed.

const fs = require('fs');
const path = require('path');
const sql = require('../sqlStore');

const handle = () => sql.handle('022_field.sql');
const LIMITS = { maxBytes: 300 * 1024, maxChunks: 64, mimes: ['image/jpeg', 'image/png', 'image/webp'] };
const ID_RE = /^[A-Za-z0-9-]{8,64}$/;

function dataDir() { return process.env.SDP_DATA_DIR ? path.resolve(process.env.SDP_DATA_DIR) : path.join(__dirname, '..', '..', 'data'); }
function dirOf(id) {
  if (!ID_RE.test(String(id))) throw Object.assign(new Error('bad upload id'), { status: 400 });
  return path.join(dataDir(), 'field-uploads', id);
}

async function get(id) { const { H } = handle(); return H.prepare(`SELECT * FROM fd_uploads WHERE id = ?`).get(id); }

/** Create (or find again) an upload. Idempotent: the same id from the same person returns the same upload. */
async function begin({ id, mime, size, chunks }, username) {
  if (!ID_RE.test(String(id))) throw Object.assign(new Error('upload id: 8-64 letters, digits or dashes'), { status: 400 });
  if (!LIMITS.mimes.includes(mime)) throw Object.assign(new Error('only JPEG, PNG or WebP photos'), { status: 400 });
  const n = Number(size), c = Number(chunks);
  if (!(Number.isInteger(n) && n > 0 && n <= LIMITS.maxBytes)) throw Object.assign(new Error(`a photo is ${Math.round(LIMITS.maxBytes / 1024)} KB at most`), { status: 413 });
  if (!(Number.isInteger(c) && c >= 1 && c <= LIMITS.maxChunks)) throw Object.assign(new Error('chunks: 1 to ' + LIMITS.maxChunks), { status: 400 });
  const cur = await get(id);
  if (cur) {
    if (cur.username !== username) throw Object.assign(new Error('this upload belongs to someone else'), { status: 403 });
    return cur;
  }
  const { H } = handle();
  await H.prepare(`INSERT INTO fd_uploads (id, username, mime, size, chunks, status, created_at) VALUES (?, ?, ?, ?, ?, 'open', ?)`).run(id, username, mime, n, c, sql.now());
  fs.mkdirSync(dirOf(id), { recursive: true });
  return get(id);
}

function received(id, chunks) {
  const d = dirOf(id), out = [];
  for (let i = 0; i < chunks; i++) if (fs.existsSync(path.join(d, i + '.part'))) out.push(i);
  return out;
}

/** Store chunk `n` (base64). Idempotent. */
async function putChunk(id, n, b64, username) {
  const u = await get(id);
  if (!u) throw Object.assign(new Error('unknown upload'), { status: 404 });
  if (u.username !== username) throw Object.assign(new Error('this upload belongs to someone else'), { status: 403 });
  if (u.status !== 'open') return { id, received: received(id, Number(u.chunks)), complete: true };
  const i = Number(n);
  if (!(Number.isInteger(i) && i >= 0 && i < Number(u.chunks))) throw Object.assign(new Error('chunk index out of range'), { status: 400 });
  const buf = Buffer.from(String(b64 || ''), 'base64');
  if (!buf.length || buf.length > u.size) throw Object.assign(new Error('empty or oversized chunk'), { status: 400 });
  fs.mkdirSync(dirOf(id), { recursive: true });
  fs.writeFileSync(path.join(dirOf(id), i + '.part'), buf);
  return { id, received: received(id, Number(u.chunks)) };
}

async function status(id, username) {
  const u = await get(id);
  if (!u) return null;
  if (u.username !== username) throw Object.assign(new Error('this upload belongs to someone else'), { status: 403 });
  return { id, status: u.status, chunks: Number(u.chunks), received: u.status === 'open' ? received(id, Number(u.chunks)) : [...Array(Number(u.chunks)).keys()] };
}

const MAGIC = { 'image/jpeg': [0xFF, 0xD8, 0xFF], 'image/png': [0x89, 0x50, 0x4E, 0x47] };

/** Assemble and check. Returns { ok, missing } — a complete upload can be finished again (idempotent). */
async function complete(id, username) {
  const u = await get(id);
  if (!u) throw Object.assign(new Error('unknown upload'), { status: 404 });
  if (u.username !== username) throw Object.assign(new Error('this upload belongs to someone else'), { status: 403 });
  if (u.status === 'complete') return { ok: true };
  const got = received(id, Number(u.chunks));
  const missing = [...Array(Number(u.chunks)).keys()].filter(i => !got.includes(i));
  if (missing.length) return { ok: false, missing };
  const buf = Buffer.concat(got.map(i => fs.readFileSync(path.join(dirOf(id), i + '.part'))));
  if (buf.length !== Number(u.size)) throw Object.assign(new Error(`size mismatch: ${buf.length} bytes received, ${u.size} announced`), { status: 422 });
  const magic = MAGIC[u.mime];
  if (magic && !magic.every((b, k) => buf[k] === b)) throw Object.assign(new Error('the file is not the announced image type'), { status: 422 });
  fs.writeFileSync(path.join(dirOf(id), 'photo.bin'), buf);
  const { H } = handle();
  await H.prepare(`UPDATE fd_uploads SET status = 'complete', completed_at = ? WHERE id = ?`).run(sql.now(), id);
  return { ok: true };
}

/** The data URL of a COMPLETE upload of this person (to attach to an inspection), or null. */
async function dataUrl(id, username) {
  const u = await get(id);
  if (!u || u.username !== username || u.status !== 'complete') return null;
  const f = path.join(dirOf(id), 'photo.bin');
  if (!fs.existsSync(f)) return null;
  return `data:${u.mime};base64,` + fs.readFileSync(f).toString('base64');
}

/** { status, blob_ref } of an upload of this person, or null. */
async function stateOf(id, username) { const u = await get(id); return u && u.username === username ? { status: u.status, blob_ref: u.blob_ref || null } : null; }

/** The photo is now stored with the inspection (blob store ref): the chunks are removed, the ref is remembered so a
 *  retry of the same save (answer lost on the way back) can point at the stored photo instead of losing it. */
async function markAttached(id, blobRef) {
  try { fs.rmSync(dirOf(id), { recursive: true, force: true }); } catch (_) {}
  const { H } = handle();
  await H.prepare(`UPDATE fd_uploads SET status = 'attached', blob_ref = ? WHERE id = ?`).run(blobRef || null, id);
}

/** Nightly: remove uploads never finished or never attached after `days`. */
async function purge(days = 7, nowDate = new Date()) {
  const { H } = handle();
  const cut = new Date(nowDate - days * 86400000).toISOString();
  const rows = await H.prepare(`SELECT id FROM fd_uploads WHERE status IN ('open', 'complete') AND created_at < ?`).all(cut);
  for (const r of rows) { try { fs.rmSync(dirOf(r.id), { recursive: true, force: true }); } catch (_) {} }
  await H.prepare(`DELETE FROM fd_uploads WHERE created_at < ?`).run(cut);
  return { purged: rows.length };
}

module.exports = { begin, putChunk, status, complete, dataUrl, stateOf, markAttached, purge, LIMITS };
