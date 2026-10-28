'use strict';
// Step 6 — persistence of dashboard DEFINITIONS (the composer's output) on both backends.
//
// A definition is a JSON document validated by services/dashboardWidgets.validateDashboard —
// it references metrics by key only, never SQL. Lifecycle: draft → published (versioned
// snapshot in dashboard_definition_versions) → retired. Publishing is the only path to a
// version number; saving a draft never touches the published snapshot a viewer sees.
//
// All methods are async. `db` is a better-sqlite3 handle (dev/tests) or a services/pgDb
// handle (prod): the two share `prepare(sql).get/all/run` and `?` placeholders.

const { validateDashboard } = require('./dashboardWidgets');


const STATUSES = ['draft', 'review', 'published', 'retired'];

function makeDashboardStore(db, { isPg = false, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new Error('dashboardStore needs a db handle');
  const P = (sql) => db.prepare(sql);

  async function init() {  }   // pg DDL = db/postgres/reports/016 (migrator)

  function row2def(r) {
    if (!r) return null;
    let definition = null;
    try { definition = JSON.parse(r.definition); } catch (_) { definition = null; }
    return { key: r.key, title: r.title, audience: r.audience, status: r.status, owner_id: r.owner_id, site_id: r.site_id,
      rfi_ref: r.rfi_ref, created_at: r.created_at, updated_at: r.updated_at, published_at: r.published_at,
      version: r.version == null ? null : Number(r.version), definition };
  }

  const SELECT = `SELECT d.*, (SELECT MAX(version) FROM dashboard_definition_versions v WHERE v.key = d.key) AS version FROM dashboard_definitions d`;

  async function get(key) { return row2def(await P(`${SELECT} WHERE d.key = ?`).get(String(key))); }

  /** @param {{audience?:string, status?:string|string[], siteIds?:number[]|null, ownerId?:number}} f */
  async function list(f = {}) {
    const where = [], args = [];
    if (f.audience) { where.push('d.audience = ?'); args.push(f.audience); }
    if (f.status) { const st = Array.isArray(f.status) ? f.status : [f.status]; where.push(`d.status IN (${st.map(() => '?').join(',')})`); args.push(...st); }
    const rows = await P(`${SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY d.audience, d.title`).all(...args);
    let out = rows.map(row2def);
    if (Array.isArray(f.siteIds)) out = out.filter(d => d.site_id == null || f.siteIds.includes(Number(d.site_id)) || (f.ownerId != null && d.owner_id === f.ownerId));
    return out;
  }

  /**
   * Create or update a DRAFT. A published dashboard keeps serving its last version until
   * `publish` is called again; the draft lives in `definition`.
   */
  async function saveDraft(doc, { user, siteId = null, metrics = null, trackers = null } = {}) {
    const v = validateDashboard(doc, { metrics, trackers });
    if (!v.ok) { const e = new Error('invalid dashboard: ' + v.errors.map(x => `${x.path}: ${x.msg}`).join('; ')); e.code = 'INVALID'; e.errors = v.errors; throw e; }
    const existing = await get(doc.key);
    const json = JSON.stringify(doc);
    const ts = now();
    if (existing) {
      await P(`UPDATE dashboard_definitions SET title=?, audience=?, definition=?, site_id=?, updated_at=?, status = CASE WHEN status='retired' THEN 'draft' ELSE status END WHERE key=?`)
        .run(doc.title, doc.audience || 'site', json, siteId == null ? existing.site_id : siteId, ts, doc.key);
    } else {
      await P(`INSERT INTO dashboard_definitions (key, title, audience, status, definition, owner_id, site_id, created_at, updated_at) VALUES (?,?,?,'draft',?,?,?,?,?)`)
        .run(doc.key, doc.title, doc.audience || 'site', json, user ? user.id : null, siteId, ts, ts);
    }
    return get(doc.key);
  }

  async function publish(key, { user, note = null } = {}) {
    const d = await get(key);
    if (!d) return null;
    const v = validateDashboard(d.definition);
    if (!v.ok) { const e = new Error('cannot publish an invalid draft'); e.code = 'INVALID'; e.errors = v.errors; throw e; }
    const next = (d.version || 0) + 1;
    const ts = now();
    await P(`INSERT INTO dashboard_definition_versions (key, version, definition, note, created_by, created_at) VALUES (?,?,?,?,?,?)`)
      .run(key, next, JSON.stringify(d.definition), note, user ? user.id : null, ts);
    await P(`UPDATE dashboard_definitions SET status='published', published_at=?, updated_at=? WHERE key=?`).run(ts, ts, key);
    return get(key);
  }

  async function setStatus(key, status) {
    if (!STATUSES.includes(status)) throw new Error('bad status ' + status);
    await P(`UPDATE dashboard_definitions SET status=?, updated_at=? WHERE key=?`).run(status, now(), key);
    return get(key);
  }

  async function versions(key) {
    const rows = await P(`SELECT version, note, created_by, created_at FROM dashboard_definition_versions WHERE key=? ORDER BY version DESC`).all(key);
    return rows.map(r => ({ ...r, version: Number(r.version) }));
  }
  async function version(key, n) {
    const r = await P(`SELECT version, definition, note, created_by, created_at FROM dashboard_definition_versions WHERE key=? AND version=?`).get(key, Number(n));
    return r ? { ...r, version: Number(r.version), definition: JSON.parse(r.definition) } : null;
  }

  /** The LAST PUBLISHED snapshot (what a viewer renders), or null when never published. */
  async function published(key) {
    const d = await get(key);
    if (!d || d.status !== 'published' || !d.version) return null;
    const v = await version(key, d.version);
    return v ? { ...d, definition: v.definition } : null;
  }

  async function remove(key) { await P(`DELETE FROM dashboard_definitions WHERE key=? AND status IN ('draft','retired')`).run(key);  }

  /** Insert + publish the shipped definitions that do not exist yet (never overwrites a user's). */
  async function seed(defs, { note = 'seed' } = {}) {
    const added = [];
    for (const doc of defs) {
      if (await get(doc.key)) continue;
      await saveDraft(doc, { user: null });
      await publish(doc.key, { note });
      added.push(doc.key);
    }
    return added;
  }

  return { init, get, list, saveDraft, publish, setStatus, versions, version, published, remove, seed, STATUSES };
}

module.exports = { makeDashboardStore, STATUSES };
