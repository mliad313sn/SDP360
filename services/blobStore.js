'use strict';

// ─────────────────────────────────────────────────────────────────────────
// Filesystem blob store — keeps large binary blobs (inspection photos &
// signatures, meeting attachments) OUT of the SQLite databases. Storing
// base64 photos inline bloated inspection.db to tens of MB per record (and
// duplicated them: once in state_json, once in insp_photos). Moving them to
// the filesystem cuts DB size ~80% and keeps backups/WAL small.
//
// Layout (under <DATA_DIR>/blobs):
//   blobs/<module>/<ownerId>/<filename>
// e.g. blobs/inspection/EM-IT-20260621-7591/net-04-0.jpg
//      blobs/inspection/EM-IT-20260621-7591/sig-inspector.png
//
// DATA_DIR honours SDP_DATA_DIR (same override the *-db.js modules use) so
// tests can point at a throwaway temp dir.
//
// Refs stored in the DB are RELATIVE paths under the blobs root
// ("<module>/<ownerId>/<filename>"). getX(ref) validates the resolved path
// never escapes the root.
// ─────────────────────────────────────────────────────────────────────────

const fs   = require('fs');
const path = require('path');

const DATA_DIR  = process.env.SDP_DATA_DIR ? path.resolve(process.env.SDP_DATA_DIR) : path.join(__dirname, '..', 'data');
const BLOB_ROOT = path.join(DATA_DIR, 'blobs');

const MIME_EXT = {
  'image/png':  '.png',
  'image/jpeg': '.jpg',
  'image/jpg':  '.jpg',
  'image/webp': '.webp',
  'image/gif':  '.gif',
  'application/pdf': '.pdf',
};
const EXT_MIME = {
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf',
};

function _safeSeg(s) {
  return String(s == null ? '' : s).replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '_');
}

// Resolve a relative ref to an absolute path, refusing anything that escapes
// the blob root (path-traversal guard).
function _resolve(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const abs = path.resolve(BLOB_ROOT, ref);
  const rel = path.relative(BLOB_ROOT, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return abs;
}

function _ownerDir(module, ownerId) {
  return path.join(BLOB_ROOT, _safeSeg(module), _safeSeg(ownerId));
}

function _splitDataUrl(dataUrl) {
  // eslint-disable-next-line security/detect-unsafe-regex -- reviewed (step 4): anchored, classes are disjoint
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(dataUrl || '');
  if (!m) return { mime: 'application/octet-stream', b64: '' };
  return { mime: m[1] || 'application/octet-stream', b64: m[3] || '' };
}

/**
 * Write a base64 payload as a file. Returns { ref, mime, size } where `ref`
 * is the relative path to store in the DB. `name` is a logical name (e.g.
 * "net-04-0" or "sig-inspector"); the extension is derived from `mime`.
 */
function putB64(module, ownerId, name, mime, b64) {
  const dir = _ownerDir(module, ownerId);
  fs.mkdirSync(dir, { recursive: true });
  const ext = MIME_EXT[(mime || '').toLowerCase()] || '.bin';
  const filename = _safeSeg(name) + ext;
  const abs = path.join(dir, filename);
  const buf = Buffer.from(b64 || '', 'base64');
  fs.writeFileSync(abs, buf);
  const ref = path.relative(BLOB_ROOT, abs).split(path.sep).join('/');
  return { ref, mime: mime || EXT_MIME[ext] || 'application/octet-stream', size: buf.length };
}

/** Convenience: write a full data: URL. */
function putDataUrl(module, ownerId, name, dataUrl) {
  const { mime, b64 } = _splitDataUrl(dataUrl);
  return putB64(module, ownerId, name, mime, b64);
}

/** Read a ref back as raw base64 (no data: prefix). null if missing/invalid. */
function getB64(ref) {
  const abs = _resolve(ref);
  if (!abs || !fs.existsSync(abs)) return null;
  try { return fs.readFileSync(abs).toString('base64'); }
  catch (_) { return null; }
}

/** Read a ref back as a data: URL. mimeHint used when extension is unknown. */
function getDataUrl(ref, mimeHint) {
  const abs = _resolve(ref);
  if (!abs || !fs.existsSync(abs)) return null;
  let buf;
  try { buf = fs.readFileSync(abs); } catch (_) { return null; }
  const ext  = path.extname(abs).toLowerCase();
  const mime = EXT_MIME[ext] || mimeHint || 'application/octet-stream';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

function exists(ref) {
  const abs = _resolve(ref);
  return !!(abs && fs.existsSync(abs));
}

/** Remove every blob for one owner (called on inspection/meeting delete). */
function removeOwner(module, ownerId) {
  const dir = _ownerDir(module, ownerId);
  try { fs.rmSync(dir, { recursive: true, force: true }); return true; }
  catch (_) { return false; }
}

module.exports = {
  BLOB_ROOT,
  putB64, putDataUrl, getB64, getDataUrl, exists, removeOwner,
  _splitDataUrl,   // exported for reuse by callers that already have a dataUrl
};
