'use strict';
// Reusable async PostgreSQL adapter with a better-sqlite3-shaped surface.
// Ported in concept from 4MyPeople's PostgresDatabase.js + sql-compat.js.
// tracker uses snake_case columns, so NO camelCase identifier mapping is needed.
let Pool, pgTypes;
try { const pg = require('pg'); Pool = pg.Pool; pgTypes = pg.types; } catch (_) { Pool = null; }
// node-pg returns NUMERIC (OID 1700) as a string; parse to JS number (preserve sqlite semantics).
if (pgTypes && pgTypes.setTypeParser) pgTypes.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));

// ?-positional → $1..$N, honouring single/double-quoted strings + comments.
function _translate(sql) {
  let out = '', inS = false, inD = false, line = false, block = false, i = 0, n = 1;
  while (i < sql.length) {
    const c = sql[i];
    if (line) { out += c; if (c === '\n' || c === '\r') line = false; i++; continue; }
    if (block) { out += c; if (c === '*' && sql[i+1] === '/') { out += '/'; block = false; i += 2; continue; } i++; continue; }
    if (!inS && !inD && c === '-' && sql[i+1] === '-') { out += '--'; line = true; i += 2; continue; }
    if (!inS && !inD && c === '/' && sql[i+1] === '*') { out += '/*'; block = true; i += 2; continue; }
    if (c === "'" && !inD) { inS = !inS || sql[i-1] === '\\'; out += c; i++; continue; }
    if (c === '"' && !inS) { inD = !inD; out += c; i++; continue; }
    if (c === '?' && !inS && !inD) { out += '$' + n++; i++; continue; }
    out += c; i++;
  }
  return out;
}
const { AsyncLocalStorage } = require('async_hooks');
function makePgDb(connectionString) {
  let pool = null;
  const txStore = new AsyncLocalStorage();
  const client = () => txStore.getStore() || pool;
  const isBareInsert = q => /^\s*INSERT\s/i.test(q) && !/\bRETURNING\b/i.test(q);
  async function query(sql, params) {
    let q = _translate(sql);
    if (isBareInsert(q)) q += ' RETURNING *';   // so .run() can surface lastID
    return client().query(q, params);
  }
  return {
    async connect() {
      pool = new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX || 10), idleTimeoutMillis: 30000 });
      const c = await pool.connect(); try { await c.query('SELECT 1'); } finally { c.release(); }
    },
    async exec(sql) { await client().query(sql); },           // DDL / multi-statement; no placeholder xlate
    prepare(sql) {
      return {
        async run(...p) { const r = await query(sql, p); const id = r.rows[0] && r.rows[0].id; return { changes: r.rowCount, lastID: id }; },
        async get(...p) { const r = await client().query(_translate(sql), p); return r.rows[0]; },
        async all(...p) { const r = await client().query(_translate(sql), p); return r.rows; },
      };
    },
    async runTransaction(fn) {
      if (txStore.getStore()) return fn();                     // nested → reuse client
      const c = await pool.connect();
      try {
        return await txStore.run(c, async () => {
          await c.query('BEGIN');
          try { const out = await fn(); await c.query('COMMIT'); return out; }
          catch (e) { try { await c.query('ROLLBACK'); } catch {} throw e; }
        });
      } finally { c.release(); }
    },
    async close() { if (pool) await pool.end(); pool = null; },
  };
}
module.exports = { _translate, makePgDb };
