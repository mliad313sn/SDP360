'use strict';
// PORTFOLIO LOT 6 (IT portfolio reconstruction spec §29, §33) — project document metadata + upload checks. PURE.
// The file itself goes to the EXISTING filesystem blob store (services/blobStore.js, namespace "ppm-doc/<project id>",
// a server-chosen name — never the client's file name); the row (table ppm_project_documents, migration 130) carries
// type, title, version, mime, size, sha256 and the blob ref. Re-uploading the same type + title = a new VERSION (the old
// one stays). Delete = soft delete (deleted_at). No amount is ever part of the metadata.
// Checks: type in the §29 list; mime in the allow-list AND the file's first bytes match it (a renamed .exe is refused);
// size ≤ MAX_BYTES; title 3..200 characters. PROPOSED (operator / PMO decisions, not approved): the allow-list, the
// 10 MB ceiling, which types are "money documents" (quotation, budget approval, purchase request: listed for every
// reader, downloadable only by an amount reader), no malware scanning (an operator decision — see the ADR).
const DOC_TYPES = Object.freeze(['business_case', 'vendor_quotation', 'design', 'architecture', 'scope_of_work', 'budget_approval', 'purchase_request',
  'risk_assessment', 'cybersecurity_assessment', 'commissioning', 'handover']);
const MONEY_TYPES = Object.freeze(['vendor_quotation', 'budget_approval', 'purchase_request']);
const MAX_BYTES = 10 * 1024 * 1024;
const ZIP = [0x50, 0x4b, 0x03, 0x04];
const MIMES = Object.freeze({
  'application/pdf': { magic: [[0x25, 0x50, 0x44, 0x46]], ext: '.pdf' },
  'image/png': { magic: [[0x89, 0x50, 0x4e, 0x47]], ext: '.png' },
  'image/jpeg': { magic: [[0xff, 0xd8, 0xff]], ext: '.jpg' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { magic: [ZIP], ext: '.docx' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { magic: [ZIP], ext: '.xlsx' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { magic: [ZIP], ext: '.pptx' },
});
const bad = (msg, reason, status = 400) => Object.assign(new Error(msg), { code: 'INVALID', reason, status });

/** Validate an upload. buf = Buffer of the file. Returns the normalised metadata (no blob written here). */
function validateUpload({ doc_type, title, mime, buf }) {
  const type = String(doc_type || '');
  if (!DOC_TYPES.includes(type)) throw bad('doc_type must be ' + DOC_TYPES.join(' | '), 'DOC_TYPE');
  const t = String(title || '').replace(/[\u0000-\u001f]/g, '').trim();
  if (t.length < 3 || t.length > 200) throw bad('a title of 3 to 200 characters is required', 'DOC_TITLE');
  const m = String(mime || '').split(';')[0].trim().toLowerCase();
  const spec = Object.prototype.hasOwnProperty.call(MIMES, m) ? MIMES[m] : null;
  if (!spec) throw bad('file type not allowed (PDF, PNG, JPEG, Word, Excel, PowerPoint only)', 'DOC_MIME', 415);
  if (!Buffer.isBuffer(buf) || buf.length === 0) throw bad('the file is empty', 'DOC_EMPTY');
  if (buf.length > MAX_BYTES) throw bad(`the file is larger than ${MAX_BYTES / 1024 / 1024} MB`, 'DOC_TOO_LARGE', 413);
  if (!spec.magic.some((sig) => sig.every((b, i) => buf[i] === b))) throw bad('the file content does not match its declared type', 'DOC_CONTENT', 415);
  return { doc_type: type, title: t, mime: m, size_bytes: buf.length, ext: spec.ext };
}
const isMoneyType = (t) => MONEY_TYPES.includes(String(t));
/** A row as served: metadata only, never the blob ref (no path leaves the server). */
function view(r, { money = false } = {}) {
  const restricted = isMoneyType(r.doc_type) && !money;
  // P11 R5-6 — the title of a document carrying amounts is masked for a non-amount reader ("Quote 1.2 M USD" is an
  // amount); its type stays (it names the kind of document, never a figure)
  return { id: Number(r.id), project_id: Number(r.project_id), doc_type: r.doc_type, title: restricted ? null : r.title, title_masked: restricted, version: Number(r.version), mime: r.mime, size_bytes: r.size_bytes == null ? null : Number(r.size_bytes),
    sha256: r.sha256 || null, uploaded_by_name: r.uploaded_by_name || null, uploaded_at: r.uploaded_at || null, restricted, download: !restricted };
}
/** Latest version per (type, title) first, then the older versions. */
function latestFirst(rows) {
  const best = new Map();
  for (const r of rows || []) { const k = r.doc_type + '|' + String(r.title).toLowerCase(); if (!best.has(k) || Number(r.version) > Number(best.get(k).version)) best.set(k, r); }
  const latest = new Set([...best.values()].map((r) => Number(r.id)));
  return (rows || []).slice().sort((a, b) => (latest.has(Number(b.id)) - latest.has(Number(a.id))) || (a.doc_type < b.doc_type ? -1 : a.doc_type > b.doc_type ? 1 : Number(b.version) - Number(a.version))).map((r) => ({ ...r, latest: latest.has(Number(r.id)) }));
}
/** A safe download file name (the client never chooses the stored name; this is only the Content-Disposition). */
function downloadName(r) { const ext = (MIMES[r.mime] || {}).ext || ''; return `${String(r.doc_type)}-v${Number(r.version)}-${String(r.title).replace(/[^A-Za-z0-9._ -]/g, '_').slice(0, 80).trim()}${ext}`; }
module.exports = { DOC_TYPES, MONEY_TYPES, MAX_BYTES, MIMES, validateUpload, isMoneyType, view, latestFirst, downloadName };
