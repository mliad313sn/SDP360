'use strict';
// Step 10 — an inspection captured OFFLINE by the field app reaches the regular Inspections module: the phone builds
// the same `state` as the full form (meta, items, actions, status), with its photos as references to finished
// uploads; the server swaps each reference for the photo and calls inspection-db saveInspection — idempotent by
// meta.f_id (the phone's id), so a retry after a cut never creates a second inspection. The inspection stays editable
// in the full form (inspection.html).
//
// Conflict policy (DEC-10.3, recommended): the phone sends the `updated_at` it last saw; if the inspection was changed
// since by someone else, the server answers 409 with the current version and nothing is overwritten — the person
// chooses on the phone (keep theirs = send again with force, or drop their copy).

const uploads = require('./uploads');
const sql = require('../sqlStore');
const handle = () => sql.handle('022_field.sql');

const ID_RE = /^[A-Za-z0-9_-]{6,64}$/;

/**
 * @param state        the phone's state (meta.f_id = the inspection id)
 * @param opts         { username, userId, userCodes (null = every site), base_updated_at, force, inspectionDb }
 * @returns { status: 200|409|400, body }
 */
async function save(state, opts) {
  const db = opts.inspectionDb;
  if (!state || !state.meta || !ID_RE.test(String(state.meta.f_id || ''))) return { status: 400, body: { error: 'state.meta.f_id: the inspection id chosen by the phone' } };
  const id = state.meta.f_id;
  const head = await db.getInspectionHeader(id);
  const { H } = handle();
  const last = head ? await H.prepare(`SELECT username, updated_at FROM fd_inspection_saves WHERE inspection_id = ?`).get(id) : null;
  const mineLast = last && last.username === opts.username && String(last.updated_at || '') === String(head.updated_at || '');
  if (head && !opts.force && !mineLast && opts.base_updated_at !== undefined && String(head.updated_at || '') !== String(opts.base_updated_at || '')) {
    return { status: 409, body: { error: 'This inspection was changed since your phone last saw it.', server_updated_at: head.updated_at, server_status: head.status } };
  }
  if (head && (head.status === 'submitted' || head.status === 'closed') && state.status !== head.status && !opts.force) {
    return { status: 409, body: { error: `This inspection is already ${head.status}.`, server_updated_at: head.updated_at, server_status: head.status } };
  }
  // Photos: references to finished uploads → data URLs (saveInspection then moves them to the blob store). A stored
  // photo comes back as its __blob ref — accepted only if it already belongs to THIS inspection (no forged ref).
  const stored = head ? await db.getStoredPhotoRefs(id) : {};
  const own = new Set([].concat(...Object.values(stored)).map(r => r.__blob));
  const used = [], missing = [];   // used: { key, pos, upload } — to remember where each upload was stored
  for (const [key, it] of Object.entries(state.items || {})) {
    if (!it || !Array.isArray(it.photos)) continue;
    const out = [];
    for (const p of it.photos) {
      if (p && p.upload) {
        const up = await uploads.stateOf(String(p.upload), opts.username);
        // Attached by a previous attempt of this same save (its answer was lost): point at the stored photo.
        if (up && up.status === 'attached') { if (up.blob_ref && own.has(up.blob_ref)) out.push({ __blob: up.blob_ref, caption: String(p.caption || '').slice(0, 300) }); continue; }
        const url = await uploads.dataUrl(String(p.upload), opts.username);
        if (!url) { missing.push(`${key}:${p.upload}`); continue; }
        used.push({ key, pos: out.length, upload: String(p.upload) });
        out.push({ dataUrl: url, caption: String(p.caption || '').slice(0, 300), ts: p.ts || null, sizeKB: p.sizeKB || null });
      } else if (p && p.__blob && own.has(p.__blob)) out.push({ __blob: p.__blob, mime: p.mime, sizeBytes: p.sizeBytes, caption: p.caption || '' });
    }
    it.photos = out;
  }
  if (missing.length) return { status: 409, body: { error: 'Some photos have not finished uploading.', missing } };
  state.meta.f_source = 'field';
  const out = await db.saveInspection(state, opts.userCodes, opts.userId || null);
  const storedAfter = await db.getStoredPhotoRefs(id);   // same order as sent, per item
  for (const u of used) await uploads.markAttached(u.upload, ((storedAfter[u.key] || [])[u.pos] || {}).__blob);
  const after = await db.getInspectionHeader(id);
  await H.prepare(`INSERT INTO fd_inspection_saves (inspection_id, username, updated_at, saved_at) VALUES (?, ?, ?, ?)
    ON CONFLICT (inspection_id) DO UPDATE SET username = EXCLUDED.username, updated_at = EXCLUDED.updated_at, saved_at = EXCLUDED.saved_at`)
    .run(id, opts.username, after ? after.updated_at : null, sql.now());
  // The phone replaces its upload references with the stored ones, so its next save keeps the photos.
  return { status: 200, body: { ok: true, id: out.id, created: out.created, updated_at: after ? after.updated_at : null, status: after ? after.status : state.status || 'draft',
    photos: used.length, stored_photos: storedAfter } };
}

module.exports = { save };
