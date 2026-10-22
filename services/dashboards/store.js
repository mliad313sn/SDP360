'use strict';
// Step 6 (lot 6.4) — persistence of composed dashboards (sqlite: schema created lazily here;
// PostgreSQL: db/postgres/reports/018_dashboards.sql, applied by the migrator). Every function returns a
// Promise on both backends. A dashboard has ONE working draft and N published versions; the version on
// air is `published_version`. Versions are never rewritten — a rollback republishes an old definition as
// the next version, so the history reads straight down.

function _h() {
  const rdb = require('../../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  return { H: rdb.db, isPg: false };
}
const _inited = new WeakSet();
function _initSchema(db) {
  if (_inited.has(db)) return;
  db.exec(`CREATE TABLE IF NOT EXISTS dashboards (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'custom', draft_json TEXT, draft_by TEXT, draft_at TEXT,
    published_version INTEGER, retired INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS dashboard_versions (
    dashboard_id TEXT NOT NULL, version INTEGER NOT NULL, definition_json TEXT NOT NULL,
    published_by TEXT, published_at TEXT NOT NULL, note TEXT, PRIMARY KEY (dashboard_id, version)
  );`);
  _inited.add(db);
}
function _db() { const x = _h(); if (!x.isPg) _initSchema(x.H); return x; }
const now = () => new Date().toISOString();
const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (_) { return null; } };

function _row(r) {
  if (!r) return null;
  return { id: r.id, kind: r.kind, draft: parse(r.draft_json), draft_by: r.draft_by || null, draft_at: r.draft_at || null,
    published_version: r.published_version == null ? null : Number(r.published_version), retired: Number(r.retired) === 1,
    created_by: r.created_by || null, created_at: r.created_at };
}

async function get(id) {
  const { H } = _db();
  return _row(await H.prepare(`SELECT * FROM dashboards WHERE id = ?`).get(id));
}

/** Every dashboard with its published definition (when any). */
async function list() {
  const { H } = _db();
  const rows = await H.prepare(`SELECT d.*, v.definition_json AS published_json, v.published_at, v.published_by
    FROM dashboards d LEFT JOIN dashboard_versions v ON v.dashboard_id = d.id AND v.version = d.published_version
    ORDER BY d.kind DESC, d.id`).all();
  return rows.map(r => ({ ..._row(r), published: parse(r.published_json), published_at: r.published_at || null, published_by: r.published_by || null }));
}

async function getPublished(id) {
  const { H } = _db();
  const r = await H.prepare(`SELECT d.retired, v.* FROM dashboards d JOIN dashboard_versions v
    ON v.dashboard_id = d.id AND v.version = d.published_version WHERE d.id = ?`).get(id);
  if (!r || Number(r.retired) === 1) return null;
  return { version: Number(r.version), definition: parse(r.definition_json), published_at: r.published_at, published_by: r.published_by };
}

async function versions(id) {
  const { H } = _db();
  const rows = await H.prepare(`SELECT version, published_by, published_at, note FROM dashboard_versions
    WHERE dashboard_id = ? ORDER BY version DESC`).all(id);
  return rows.map(r => ({ ...r, version: Number(r.version) }));
}

async function getVersion(id, version) {
  const { H } = _db();
  const r = await H.prepare(`SELECT * FROM dashboard_versions WHERE dashboard_id = ? AND version = ?`).get(id, version);
  return r ? { version: Number(r.version), definition: parse(r.definition_json), published_at: r.published_at, published_by: r.published_by } : null;
}

/** Create the row if needed and store the working draft (already validated by the caller). */
async function saveDraft(id, definition, by, kind = 'custom') {
  const { H } = _db();
  const t = now();
  await H.prepare(`INSERT INTO dashboards (id, kind, draft_json, draft_by, draft_at, created_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET draft_json = EXCLUDED.draft_json, draft_by = EXCLUDED.draft_by, draft_at = EXCLUDED.draft_at`)
    .run(id, kind, JSON.stringify(definition), by || null, t, by || null, t);
  return get(id);
}

async function _nextVersion(H, id) {
  const r = await H.prepare(`SELECT MAX(version) AS v FROM dashboard_versions WHERE dashboard_id = ?`).get(id);
  return (r && r.v != null ? Number(r.v) : 0) + 1;
}

/** Publish a definition as the next version and put it on air. */
async function publishDefinition(id, definition, by, note) {
  const { H } = _db();
  const v = await _nextVersion(H, id);
  await H.prepare(`INSERT INTO dashboard_versions (dashboard_id, version, definition_json, published_by, published_at, note)
    VALUES (?, ?, ?, ?, ?, ?)`).run(id, v, JSON.stringify(definition), by || null, now(), note ? String(note).slice(0, 200) : null);
  await H.prepare(`UPDATE dashboards SET published_version = ?, retired = 0 WHERE id = ?`).run(v, id);
  return v;
}

async function retire(id) {
  const { H } = _db();
  await H.prepare(`UPDATE dashboards SET retired = 1 WHERE id = ?`).run(id);
}

/** Remove a never-published custom dashboard (a draft nobody saw). */
async function removeDraftOnly(id) {
  const { H } = _db();
  await H.prepare(`DELETE FROM dashboards WHERE id = ? AND published_version IS NULL AND kind = 'custom'`).run(id);
}

module.exports = { get, list, getPublished, versions, getVersion, saveDraft, publishDefinition, retire, removeDraftOnly };
