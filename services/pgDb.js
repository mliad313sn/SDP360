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
module.exports = { _translate };
