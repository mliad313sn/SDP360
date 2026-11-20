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

// P11 r4 N-11 — bounded wait for a pooled connection. Without it, a long table lock (or a slow report) holding every
// client made ordinary requests queue for ~43 s. The timeout bounds only the ACQUIRE (the wait for a free client in
// node-pg's queue), never the run time of a query that already holds a client — so a long migration or a backup
// (pg_dump runs in its own process anyway) is not cut short once it is running. Default 10 s; PG_POOL_ACQUIRE_TIMEOUT_MS
// overrides it, 0 = wait without limit (the former behaviour). A timed-out acquire is a typed DB_BUSY error that
// services/httpError.fail() answers as 503 + Retry-After.
const DEFAULT_ACQUIRE_TIMEOUT_MS = 10000;
function acquireTimeoutMs(env = process.env) {
  const raw = env.PG_POOL_ACQUIRE_TIMEOUT_MS;
  if (raw == null || String(raw).trim() === '') return DEFAULT_ACQUIRE_TIMEOUT_MS;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_ACQUIRE_TIMEOUT_MS;
}
function _isAcquireTimeout(e) { return !!e && /timeout exceeded when trying to connect|connection terminated due to connection timeout/i.test(String(e.message || '')); }
function _busy(e) {
  if (!_isAcquireTimeout(e)) return e;
  const b = new Error('database busy: no PostgreSQL connection was free within the acquire timeout');
  b.code = 'DB_BUSY'; b.status = 503; b.cause = e;
  return b;
}
function makePgDb(connectionString) {
  let pool = null;
  const txStore = new AsyncLocalStorage();
  const client = () => txStore.getStore() || pool;
  const isBareInsert = q => /^\s*INSERT\s/i.test(q) && !/\bRETURNING\b/i.test(q);
  async function query(sql, args) {
    let { text, values } = _bind(sql, args);
    if (isBareInsert(text)) text += ' RETURNING *';   // so .run() can surface lastID
    try { return await client().query(text, values); } catch (e) { throw _busy(e); }
  }
  async function q(text, values) { try { return await client().query(text, values); } catch (e) { throw _busy(e); } }
  return {
    async connect() {
      pool = new Pool({ connectionString, max: Number(process.env.PG_POOL_MAX || 10), idleTimeoutMillis: 30000,
        connectionTimeoutMillis: acquireTimeoutMs() });
      // An IDLE pooled client whose server connection is terminated (PostgreSQL restart, pg_terminate_backend,
      // DROP DATABASE … WITH FORCE) makes node-pg emit 'error' on the pool. With no listener that is an
      // uncaught exception and the whole server dies. Log it; the pool drops that client and opens a new one.
      pool.on('error', (e) => { console.error('[pgDb] idle PostgreSQL client lost:', (e && (e.code || e.message)) || e); });
      const c = await pool.connect(); try { await c.query('SELECT 1'); } finally { c.release(); }
    },
    async exec(sql) { await q(sql); },           // DDL / multi-statement; no placeholder xlate
    prepare(sql) {
      return {
        async run(...p) { const r = await query(sql, p); const id = r.rows[0] && r.rows[0].id; return { changes: r.rowCount, lastID: id }; },
        async get(...p) { const { text, values } = _bind(sql, p); const r = await q(text, values); return r.rows[0]; },
        async all(...p) { const { text, values } = _bind(sql, p); const r = await q(text, values); return r.rows; },
      };
    },
    async runTransaction(fn) {
      if (txStore.getStore()) return fn();                     // nested → reuse client
      let c;
      try { c = await pool.connect(); } catch (e) { throw _busy(e); }
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
module.exports = { _translate, _translateNamed, makePgDb, acquireTimeoutMs, DEFAULT_ACQUIRE_TIMEOUT_MS, _busy };
