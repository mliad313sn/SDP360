'use strict';
// Step 7 — persistence of TRACKER DEFINITIONS + entries + per-unit targets on both backends.
//
// A definition is a JSON document validated by services/trackerDefinitions.validate — it carries
// NO formula: scoring is services/trackerDefinitions.score (the single engine the pages, the
// PPTX/Excel exports and the dashboards all read). Lifecycle mirrors the dashboard store:
// draft → review → published (versioned snapshot) → retired. Entries are keyed
// (key, unit, item, slot); a closed period (public/lib/trackerMonthLock) keeps its STORED value.
//
// `db` is a better-sqlite3 handle (tracker.db in dev/tests) or a services/pgDb handle (prod —
// tables from db/postgres/tracker/002_tracker_definitions.sql via the migrator).

const Defs = require('./trackerDefinitions');
const Lock = require('../public/lib/trackerMonthLock');


const STATUSES = ['draft', 'review', 'published', 'retired'];

/** Slot → calendar (year, month0) for the month lock. Weekly/quarterly trackers map the slot to its first month. */
function slotCalendar(def, slot) {
  const start = String((def.period && def.period.start) || new Date().getUTCFullYear());
  const year = Number(start.slice(0, 4));
  const kind = def.period && def.period.kind;
  const startMonth = /^\d{4}-(\d{2})$/.test(start) ? Number(start.slice(5, 7)) - 1 : 0;
  let m0;
  if (kind === 'monthly') m0 = startMonth + (slot - 1);
  else if (kind === 'quarterly') m0 = startMonth + (slot - 1) * 3;
  else m0 = Math.floor(((slot - 1) * 7) / 30.44); // weekly: approximate month of the week
  return { year: year + Math.floor(m0 / 12), month0: ((m0 % 12) + 12) % 12 };
}
function slotClosed(def, slot, now) { const c = slotCalendar(def, slot); return Lock.isClosed(c.year, c.month0, now); }

function makeTrackerStore(db, { isPg = false, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new Error('trackerStore needs a db handle');
  const P = (sql) => db.prepare(sql);
  async function init() {  }

  function row2def(r) {
    if (!r) return null;
    let definition = null; try { definition = JSON.parse(r.definition); } catch (_) { /* unreadable → null */ }
    return { key: r.key, name: r.name, status: r.status, owner_id: r.owner_id, rfi_ref: r.rfi_ref, created_at: r.created_at,
      updated_at: r.updated_at, published_at: r.published_at, version: r.version == null ? null : Number(r.version), definition,
      review_state: r.review_state || null, submitted_by: r.submitted_by == null ? null : Number(r.submitted_by), submitted_at: r.submitted_at || null,
      updated_by: r.updated_by == null ? null : Number(r.updated_by), publish_override: r.publish_override ? JSON.parse(r.publish_override) : null };
  }
  const SELECT = `SELECT d.*, (SELECT MAX(version) FROM tracker_definition_versions v WHERE v.key = d.key) AS version FROM tracker_definitions d`;

  async function get(key) { return row2def(await P(`${SELECT} WHERE d.key = ?`).get(String(key))); }
  async function list(f = {}) {
    const where = [], args = [];
    if (f.status) { const st = Array.isArray(f.status) ? f.status : [f.status]; where.push(`d.status IN (${st.map(() => '?').join(',')})`); args.push(...st); }
    const rows = await P(`${SELECT}${where.length ? ' WHERE ' + where.join(' AND ') : ''} ORDER BY d.name`).all(...args);
    return rows.map(row2def);
  }

  async function saveDraft(doc, { user, rfiRef = null } = {}) {
    const v = Defs.validate(doc);
    if (!v.ok) { const e = new Error('invalid tracker: ' + v.errors.map(x => `${x.path}: ${x.msg}`).join('; ')); e.code = 'INVALID'; e.errors = v.errors; throw e; }
    const existing = await get(doc.key);
    const json = JSON.stringify(doc), ts = now();
    if (existing) {
      // an edit withdraws a pending submission (G-23)
      await P(`UPDATE tracker_definitions SET name=?, definition=?, rfi_ref=COALESCE(?, rfi_ref), updated_at=?, updated_by=?, review_state=NULL, submitted_by=NULL, submitted_at=NULL, status = CASE WHEN status='retired' THEN 'draft' ELSE status END WHERE key=?`)
        .run(doc.name, json, rfiRef, ts, user ? user.id : null, doc.key);
    } else {
      await P(`INSERT INTO tracker_definitions (key, name, status, definition, owner_id, rfi_ref, created_at, updated_at, updated_by) VALUES (?,?,'draft',?,?,?,?,?,?)`)
        .run(doc.key, doc.name, json, user ? user.id : null, rfiRef, ts, ts, user ? user.id : null);
    }
    return get(doc.key);
  }

  /** G-23 — mark the current draft as submitted for review by `user`. */
  async function submit(key, { user } = {}) {
    const d = await get(key); if (!d) return null;
    const v = Defs.validate(d.definition);
    if (!v.ok) { const e = new Error('cannot submit an invalid draft'); e.code = 'INVALID'; e.errors = v.errors; throw e; }
    await P(`UPDATE tracker_definitions SET review_state='submitted', submitted_by=?, submitted_at=? WHERE key=?`).run(user ? user.id : null, now(), key);
    return get(key);
  }

  async function publish(key, { user, note = null, override = null } = {}) {
    const d = await get(key); if (!d) return null;
    const v = Defs.validate(d.definition);
    if (!v.ok) { const e = new Error('cannot publish an invalid draft'); e.code = 'INVALID'; e.errors = v.errors; throw e; }
    const next = (d.version || 0) + 1, ts = now();
    const snap = { ...d.definition, version: next };
    await P(`INSERT INTO tracker_definition_versions (key, version, definition, note, created_by, created_at) VALUES (?,?,?,?,?,?)`).run(key, next, JSON.stringify(snap), note, user ? user.id : null, ts);
    await P(`UPDATE tracker_definitions SET status='published', version=?, definition=?, published_at=?, updated_at=?, review_state=NULL, submitted_by=NULL, submitted_at=NULL, publish_override=? WHERE key=?`).run(next, JSON.stringify(snap), ts, ts, override ? JSON.stringify(override) : null, key);
    return get(key);
  }
  async function setStatus(key, status) {
    if (!STATUSES.includes(status)) throw new Error('bad status ' + status);
    await P(`UPDATE tracker_definitions SET status=?, updated_at=? WHERE key=?`).run(status, now(), key); return get(key);
  }
  async function versions(key) { return (await P(`SELECT version, note, created_by, created_at FROM tracker_definition_versions WHERE key=? ORDER BY version DESC`).all(key)).map(r => ({ ...r, version: Number(r.version) })); }
  async function version(key, n) {
    const r = await P(`SELECT version, definition, note, created_by, created_at FROM tracker_definition_versions WHERE key=? AND version=?`).get(key, Number(n));
    return r ? { ...r, version: Number(r.version), definition: JSON.parse(r.definition) } : null;
  }
  /** Roll the draft back to a published version (the snapshot becomes the new draft; publish again to make it live). */
  async function rollback(key, n, { user } = {}) {
    const v = await version(key, n); if (!v) return null;
    await P(`UPDATE tracker_definitions SET definition=?, updated_at=?, updated_by=?, review_state=NULL, submitted_by=NULL, submitted_at=NULL WHERE key=?`).run(JSON.stringify(v.definition), now(), user ? user.id : null, key);
    return get(key);
  }
  async function published(key) {
    const d = await get(key); if (!d || d.status !== 'published' || !d.version) return null;
    const v = await version(key, d.version); return v ? { ...d, definition: v.definition } : null;
  }
  async function remove(key) {
    for (const t of ['tracker_entries', 'tracker_unit_targets', 'tracker_definition_versions']) await P(`DELETE FROM ${t} WHERE key=? AND EXISTS (SELECT 1 FROM tracker_definitions WHERE key=? AND status IN ('draft','retired'))`).run(key, key);
    await P(`DELETE FROM tracker_definitions WHERE key=? AND status IN ('draft','retired')`).run(key);
  }

  // ── Entries ───────────────────────────────────────────────────────────────────────
  /** { [unit]: { [item]: number[] } } for the scorer + the raw rows (note/source/updated_at). */
  async function entries(key, { unit = null } = {}) {
    const rows = unit ? await P(`SELECT * FROM tracker_entries WHERE key=? AND unit_code=?`).all(key, unit) : await P(`SELECT * FROM tracker_entries WHERE key=?`).all(key);
    const inputs = {};
    for (const r of rows) {
      const u = inputs[r.unit_code] || (inputs[r.unit_code] = {});
      const arr = u[r.item_code] || (u[r.item_code] = []);
      arr[Number(r.slot) - 1] = r.value == null ? null : Number(r.value);
    }
    return { inputs, rows: rows.map(r => ({ ...r, slot: Number(r.slot), value: r.value == null ? null : Number(r.value) })) };
  }

  /**
   * Save cells. `cells` = [{ unit, item, slot, value, note }]. Cells of a CLOSED period are kept
   * as stored (counted in `blocked`) unless `lockClosed === false` (super_admin).
   * `allowedUnits`: null = any; else the unit codes the caller may write (site scope).
   */
  async function saveEntries(key, cells, { user, def = null, lockClosed = true, allowedUnits = null, source = 'manual', now: at = null } = {}) {
    const d = def || (await get(key) || {}).definition; if (!d) throw new Error('tracker not found');
    const units = new Set(d.units.map(u => u.code)), items = new Set(d.groups.flatMap(g => g.items.map(i => i.code)));
    const n = d.period.count; const ts = now();
    let saved = 0, blocked = 0, rejected = 0;
    for (const c of cells || []) {
      const slot = Number(c.slot);
      if (!units.has(c.unit) || !items.has(c.item) || !(Number.isInteger(slot) && slot >= 1 && slot <= n)) { rejected++; continue; }
      if (Array.isArray(allowedUnits) && !allowedUnits.includes(c.unit)) { rejected++; continue; }
      if (lockClosed && slotClosed(d, slot, at)) { blocked++; continue; }
      const val = c.value == null || c.value === '' ? null : Number(c.value);
      if (val != null && !Number.isFinite(val)) { rejected++; continue; }
      await P(`INSERT INTO tracker_entries (key, unit_code, item_code, slot, value, note, source, updated_by, updated_at) VALUES (?,?,?,?,?,?,?,?,?)
               ON CONFLICT (key, unit_code, item_code, slot) DO UPDATE SET value=EXCLUDED.value, note=EXCLUDED.note, source=EXCLUDED.source, updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at`)
        .run(key, c.unit, c.item, slot, val, c.note == null ? null : String(c.note).slice(0, 500), source, user ? user.id : null, ts);
      saved++;
    }
    return { saved, blocked, rejected };
  }

  // ── Per-unit targets ──────────────────────────────────────────────────────────────
  async function targets(key) {
    const rows = await P(`SELECT unit_code, item_code, target, active FROM tracker_unit_targets WHERE key=?`).all(key);
    const out = {};
    for (const r of rows) (out[r.unit_code] || (out[r.unit_code] = {}))[r.item_code] = { target: r.target == null ? null : Number(r.target), active: Number(r.active) !== 0 };
    return out;
  }
  async function saveTargets(key, list, { allowedUnits = null } = {}) {
    const ts = now(); let saved = 0;
    for (const t of list || []) {
      if (Array.isArray(allowedUnits) && !allowedUnits.includes(t.unit)) continue;
      const tgt = t.target == null || t.target === '' ? null : Number(t.target);
      const act = t.active === false || t.active === 0 ? 0 : 1;
      await P(`INSERT INTO tracker_unit_targets (key, unit_code, item_code, target, active, updated_at) VALUES (?,?,?,?,?,?) ON CONFLICT (key, unit_code, item_code) DO UPDATE SET target=EXCLUDED.target, active=EXCLUDED.active, updated_at=EXCLUDED.updated_at`).run(key, t.unit, t.item, tgt, act, ts);
      saved++;
    }
    return { saved };
  }

  /** Effective targets = definition default ∘ per-unit override. Items without a target anywhere are scored with target null. */
  function mergeTargets(def, overrides) {
    const out = {};
    for (const u of def.units) {
      out[u.code] = {};
      for (const g of def.groups) for (const it of g.items) {
        const o = overrides && overrides[u.code] && overrides[u.code][it.code];
        out[u.code][it.code] = { target: o && o.target != null ? o.target : (it.target == null ? null : Number(it.target)), active: o ? o.active !== false : true };
      }
    }
    return out;
  }

  /** Score the LIVE definition (published snapshot if any, else the draft) at `currentPeriod`. */
  async function scoreTracker(key, { currentPeriod = null, definition = null } = {}) {
    const d = definition ? { definition } : (await published(key)) || (await get(key));
    if (!d || !d.definition) return null;
    const def = d.definition;
    const [{ inputs }, ov] = [await entries(key), await targets(key)];
    const cur = currentPeriod || def.period.count;
    const res = Defs.score(def, inputs, { currentPeriod: cur, targets: mergeTargets(def, ov) });
    return { key, version: d.version || null, currentPeriod: cur, period: def.period, ...res };
  }

  async function seed(defs, { note = 'seed' } = {}) {
    const added = [];
    for (const doc of defs) { if (await get(doc.key)) continue; await saveDraft(doc, { user: null }); await publish(doc.key, { note }); added.push(doc.key); }
    return added;
  }

  return { init, get, list, saveDraft, submit, publish, setStatus, versions, version, rollback, published, remove, entries, saveEntries, targets, saveTargets, mergeTargets, scoreTracker, seed, slotCalendar, slotClosed, STATUSES };
}

module.exports = { makeTrackerStore, STATUSES, slotCalendar, slotClosed };
