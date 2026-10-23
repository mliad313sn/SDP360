'use strict';
// Versioned DEFINITIONS store (steps 6 to 9): one row per object (its working draft + the version on air) and one
// row per published version, never rewritten — a rollback republishes an old definition as the next version, so
// the history reads straight down. Used by the composed dashboards (step 6), the business trackers (step 7), the
// meeting cadences (step 8), the report templates and the alert rules (step 9).
//
// createStore({ table, versions, key }) — the three names are CODE CONSTANTS (never user input). sqlite: the schema
// is created lazily here; PostgreSQL: by the module's migration (db/postgres/reports/NNN_*.sql), applied by the
// migrator. Every function returns a Promise on both backends.

const IDENT = /^[a-z][a-z0-9_]{1,40}$/;

function createStore({ table, versions, key }) {
  for (const n of [table, versions, key]) if (!IDENT.test(String(n))) throw new Error('defstore: bad identifier ' + n);

  const _inited = new WeakSet();
  function _h() {
    const rdb = require('../reports-db');
    if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
    const H = rdb.db;
    if (!_inited.has(H)) {
      H.exec(`CREATE TABLE IF NOT EXISTS ${table} (
        id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'custom', draft_json TEXT, draft_by TEXT, draft_at TEXT,
        published_version INTEGER, retired INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS ${versions} (
        ${key} TEXT NOT NULL, version INTEGER NOT NULL, definition_json TEXT NOT NULL,
        published_by TEXT, published_at TEXT NOT NULL, note TEXT, PRIMARY KEY (${key}, version)
      );`);
      _inited.add(H);
    }
    return { H, isPg: false };
  }
  const now = () => new Date().toISOString();
  const parse = (s) => { try { return s ? JSON.parse(s) : null; } catch (_) { return null; } };
  const row = (r) => (!r ? null : {
    id: r.id, kind: r.kind, draft: parse(r.draft_json), draft_by: r.draft_by || null, draft_at: r.draft_at || null,
    published_version: r.published_version == null ? null : Number(r.published_version), retired: Number(r.retired) === 1,
    created_by: r.created_by || null, created_at: r.created_at,
  });

  async function get(id) {
    const { H } = _h();
    return row(await H.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id));
  }

  /** Every object with its published definition (when any). */
  async function list() {
    const { H } = _h();
    const rows = await H.prepare(`SELECT d.*, v.definition_json AS published_json, v.published_at, v.published_by
      FROM ${table} d LEFT JOIN ${versions} v ON v.${key} = d.id AND v.version = d.published_version
      ORDER BY d.kind DESC, d.id`).all();
    return rows.map(r => ({ ...row(r), published: parse(r.published_json), published_at: r.published_at || null, published_by: r.published_by || null }));
  }

  async function getPublished(id) {
    const { H } = _h();
    const r = await H.prepare(`SELECT d.retired, v.* FROM ${table} d JOIN ${versions} v
      ON v.${key} = d.id AND v.version = d.published_version WHERE d.id = ?`).get(id);
    if (!r || Number(r.retired) === 1) return null;
    return { version: Number(r.version), definition: parse(r.definition_json), published_at: r.published_at, published_by: r.published_by };
  }

  async function versionsOf(id) {
    const { H } = _h();
    const rows = await H.prepare(`SELECT version, published_by, published_at, note FROM ${versions}
      WHERE ${key} = ? ORDER BY version DESC`).all(id);
    return rows.map(r => ({ ...r, version: Number(r.version) }));
  }

  async function getVersion(id, version) {
    const { H } = _h();
    const r = await H.prepare(`SELECT * FROM ${versions} WHERE ${key} = ? AND version = ?`).get(id, version);
    return r ? { version: Number(r.version), definition: parse(r.definition_json), published_at: r.published_at, published_by: r.published_by } : null;
  }

  /** Create the row if needed and store the working draft (already validated by the caller). */
  async function saveDraft(id, definition, by, kind = 'custom') {
    const { H } = _h();
    const t = now();
    await H.prepare(`INSERT INTO ${table} (id, kind, draft_json, draft_by, draft_at, created_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET draft_json = EXCLUDED.draft_json, draft_by = EXCLUDED.draft_by, draft_at = EXCLUDED.draft_at`)
      .run(id, kind, JSON.stringify(definition), by || null, t, by || null, t);
    return get(id);
  }

  /** Publish a definition as the next version and put it on air. */
  async function publishDefinition(id, definition, by, note) {
    const { H } = _h();
    const r = await H.prepare(`SELECT MAX(version) AS v FROM ${versions} WHERE ${key} = ?`).get(id);
    const v = (r && r.v != null ? Number(r.v) : 0) + 1;
    await H.prepare(`INSERT INTO ${versions} (${key}, version, definition_json, published_by, published_at, note)
      VALUES (?, ?, ?, ?, ?, ?)`).run(id, v, JSON.stringify(definition), by || null, now(), note ? String(note).slice(0, 200) : null);
    await H.prepare(`UPDATE ${table} SET published_version = ?, retired = 0 WHERE id = ?`).run(v, id);
    return v;
  }

  async function retire(id) {
    const { H } = _h();
    await H.prepare(`UPDATE ${table} SET retired = 1 WHERE id = ?`).run(id);
  }

  /** Remove a never-published custom object (a draft nobody saw). */
  async function removeDraftOnly(id) {
    const { H } = _h();
    await H.prepare(`DELETE FROM ${table} WHERE id = ? AND published_version IS NULL AND kind = 'custom'`).run(id);
  }

  return { get, list, getPublished, versions: versionsOf, getVersion, saveDraft, publishDefinition, retire, removeDraftOnly };
}

module.exports = { createStore };
