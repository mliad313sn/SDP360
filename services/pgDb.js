'use strict';
// Reusable async PostgreSQL adapter with a better-sqlite3-shaped surface.
// Ported in concept from 4MyPeople's PostgresDatabase.js + sql-compat.js.
// tracker uses snake_case columns, so NO camelCase identifier mapping is needed.
let Pool, pgTypes;
try { const pg = require('pg'); Pool = pg.Pool; pgTypes = pg.types; } catch (_) { Pool = null; }
// node-pg returns NUMERIC (1700) and BIGINT (20) as strings; parse to JS number so
// SUM()/COUNT(*)/REAL columns behave like better-sqlite3 did. The dashboard has no
// integers above 2^53 (a bigint ms timestamp would need ~285k years), so Number() is safe.
if (pgTypes && pgTypes.setTypeParser) {
  pgTypes.setTypeParser(1700, v => (v === null ? null : parseFloat(v)));   // NUMERIC
  pgTypes.setTypeParser(20,   v => (v === null ? null : Number(v)));       // BIGINT (COUNT/SUM)
}

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

// better-sqlite3 named binding: @name (the style used across meetings/inspection/reports).
// Each DISTINCT @name → a $N (first-appearance order; reused names collapse to the same $N
// so a value is supplied once), honouring quotes/comments. `::type` casts are untouched
// (they use ':' not '@'). Returns {text, values}. Throws on a referenced-but-absent name.
function _translateNamed(sql, obj) {
  let out = '', inS = false, inD = false, line = false, block = false, i = 0;
  const order = [], idx = new Map();
  while (i < sql.length) {
    const c = sql[i];
    if (line) { out += c; if (c === '\n' || c === '\r') line = false; i++; continue; }
    if (block) { out += c; if (c === '*' && sql[i+1] === '/') { out += '/'; block = false; i += 2; continue; } i++; continue; }
    if (!inS && !inD && c === '-' && sql[i+1] === '-') { out += '--'; line = true; i += 2; continue; }
    if (!inS && !inD && c === '/' && sql[i+1] === '*') { out += '/*'; block = true; i += 2; continue; }
    if (c === "'" && !inD) { inS = !inS || sql[i-1] === '\\'; out += c; i++; continue; }
    if (c === '"' && !inS) { inD = !inD; out += c; i++; continue; }
    if (c === '@' && !inS && !inD && /\w/.test(sql[i+1] || '')) {
      let j = i + 1; while (j < sql.length && /\w/.test(sql[j])) j++;
      const name = sql.slice(i + 1, j);
      if (!idx.has(name)) { order.push(name); idx.set(name, order.length); }
      out += '$' + idx.get(name); i = j; continue;
    }
    out += c; i++;
  }
  const values = order.map(n => {
    if (!obj || !(n in obj)) throw new Error('pgDb: missing named parameter @' + n);
    return obj[n];
  });
  return { text: out, values };
}

// A single plain-object arg means better-sqlite3 named binding; otherwise positional.
function _isPlainObj(v) { return v !== null && typeof v === 'object' && !Array.isArray(v) && !Buffer.isBuffer(v); }
function _bind(sql, args) {
  if (args.length === 1 && _isPlainObj(args[0])) return _translateNamed(sql, args[0]);
  return { text: _translate(sql), values: args };
}

const { AsyncLocalStorage } = require('async_hooks');
function makePgDb(connectionString) {
  let pool = null;
  const txStore = new AsyncLocalStorage();
  const client = () => txStore.getStore() || pool;
  const isBareInsert = q => /^\s*INSERT\s/i.test(q) && !/\bRETURNING\b/i.test(q);
  async function query(sql, args) {
    let { text, values } = _bind(sql, args);
    if (isBareInsert(text)) text += ' RETURNING *';   // so .run() can surface lastID
    return client().query(text, values);
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
        async get(...p) { const { text, values } = _bind(sql, p); const r = await client().query(text, values); return r.rows[0]; },
        async all(...p) { const { text, values } = _bind(sql, p); const r = await client().query(text, values); return r.rows; },
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
module.exports = { _translate, _translateNamed, makePgDb };
