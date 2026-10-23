'use strict';
// Step 7 — persistence of the business trackers: versioned definitions (services/defstore.js) + monthly ENTRIES per
// unit × item + month LOCKS. sqlite: schema created lazily here; PostgreSQL: db/postgres/reports/019_trackers.sql.
// Every function returns a Promise on both backends. A value is 0 when absent (the engine's rule); `source` says
// who wrote it: 'manual' (entry screen), 'import' (xlsx), 'metric' (linked to a dictionary key), 'legacy' (mirror
// of the IT Activity Tracker during the parallel run).

const defs = require('../defstore').createStore({ table: 'trk_trackers', versions: 'trk_tracker_versions', key: 'tracker_id' });

const _inited = new WeakSet();
function _h() {
  const rdb = require('../../reports-db');
  if (rdb.REPORTS_BACKEND === 'postgres') return { H: rdb.pgHandle(), isPg: true };
  const H = rdb.db;
  if (!_inited.has(H)) {
    H.exec(`CREATE TABLE IF NOT EXISTS trk_entries (
      tracker_id TEXT NOT NULL, year INTEGER NOT NULL, unit TEXT NOT NULL, item TEXT NOT NULL, month INTEGER NOT NULL,
      value REAL NOT NULL, source TEXT NOT NULL DEFAULT 'manual', updated_by TEXT, updated_at TEXT NOT NULL,
      PRIMARY KEY (tracker_id, year, unit, item, month)
    );
    CREATE INDEX IF NOT EXISTS ix_trk_entries_tracker ON trk_entries (tracker_id, year);
    CREATE TABLE IF NOT EXISTS trk_locks (
      tracker_id TEXT NOT NULL, year INTEGER NOT NULL, month INTEGER NOT NULL, locked_by TEXT, locked_at TEXT NOT NULL,
      PRIMARY KEY (tracker_id, year, month)
    );`);
    _inited.add(H);
  }
  return { H, isPg: false };
}

/** values[unit][item] = [12 numbers] for one tracker and year (absent cells = 0). */
async function getValues(id, year) {
  const { H } = _h();
  const rows = await H.prepare(`SELECT unit, item, month, value FROM trk_entries WHERE tracker_id = ? AND year = ?`).all(id, year);
  const v = {};
  for (const r of rows) {
    const u = v[r.unit] || (v[r.unit] = {});
    const row = u[r.item] || (u[r.item] = new Array(12).fill(0));
    const m = Number(r.month);
    if (m >= 1 && m <= 12) row[m - 1] = Number(r.value);
  }
  return v;
}

/** Last writer of each cell — for the entry screen's "who / when" and the audit. */
async function cellsMeta(id, year) {
  const { H } = _h();
  return H.prepare(`SELECT unit, item, month, source, updated_by, updated_at FROM trk_entries WHERE tracker_id = ? AND year = ?`).all(id, year);
}

/** Write cells [{unit, item, month, value}] in one transaction. The caller has checked rights and locks. */
async function setCells(id, year, cells, by, source = 'manual') {
  const x = _h();
  const t = new Date().toISOString();
  const sql = `INSERT INTO trk_entries (tracker_id, year, unit, item, month, value, source, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (tracker_id, year, unit, item, month) DO UPDATE SET value = EXCLUDED.value, source = EXCLUDED.source,
      updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`;
  if (x.isPg) {
    await x.H.runTransaction(async () => {
      for (const c of cells) await x.H.prepare(sql).run(id, year, c.unit, c.item, c.month, c.value, source, by || null, t);
    });
  } else {
    const st = x.H.prepare(sql);
    x.H.transaction(() => { for (const c of cells) st.run(id, year, c.unit, c.item, c.month, c.value, source, by || null, t); })();
  }
  return cells.length;
}

async function locks(id, year) {
  const { H } = _h();
  const rows = await H.prepare(`SELECT month, locked_by, locked_at FROM trk_locks WHERE tracker_id = ? AND year = ? ORDER BY month`).all(id, year);
  return rows.map(r => ({ month: Number(r.month), locked_by: r.locked_by, locked_at: r.locked_at }));
}

async function setLock(id, year, month, locked, by) {
  const { H } = _h();
  if (locked) {
    await H.prepare(`INSERT INTO trk_locks (tracker_id, year, month, locked_by, locked_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (tracker_id, year, month) DO NOTHING`).run(id, year, month, by || null, new Date().toISOString());
  } else {
    await H.prepare(`DELETE FROM trk_locks WHERE tracker_id = ? AND year = ? AND month = ?`).run(id, year, month);
  }
  return locks(id, year);
}

module.exports = { defs, getValues, cellsMeta, setCells, locks, setLock };
