'use strict';
// Locate a PostgreSQL client binary (pg_dump / psql / pg_restore) and turn PG_URL into psql-style
// arguments WITHOUT the password on the command line (it travels through PGPASSWORD only —
// transcripts and process listings capture command lines, CLAUDE.md "secrets never on a command
// line"). Shared by tools/pg/dump-db.js and tools/pg/restore-drill.js.
const fs = require('fs');
const path = require('path');

/**
 * @param {string} name   'pg_dump' | 'psql' | 'pg_restore'
 * @param {string} [envVar]  explicit override, e.g. PG_DUMP / PG_PSQL (full path)
 */
function findPgBin(name, envVar, env = process.env) {
  if (envVar && env[envVar] && fs.existsSync(env[envVar])) return env[envVar];
  if (process.platform === 'win32') {
    const roots = ['C:\\Program Files\\PostgreSQL', 'C:\\Program Files (x86)\\PostgreSQL'];
    for (const root of roots) {
      try {
        const vers = fs.readdirSync(root).sort((a, b) => parseFloat(b) - parseFloat(a));   // newest first
        for (const v of vers) { const p = path.join(root, v, 'bin', name + '.exe'); if (fs.existsSync(p)) return p; }
      } catch (_) {}
    }
    return null;
  }
  for (const d of ['/usr/bin', '/usr/local/bin', '/opt/homebrew/bin']) { const p = path.join(d, name); if (fs.existsSync(p)) return p; }
  try {   // Debian/Ubuntu versioned layout
    const base = '/usr/lib/postgresql';
    const vers = fs.readdirSync(base).sort((a, b) => parseFloat(b) - parseFloat(a));
    for (const v of vers) { const p = path.join(base, v, 'bin', name); if (fs.existsSync(p)) return p; }
  } catch (_) {}
  return name;   // last resort: let the OS resolve PATH
}

/** postgres://user:pass@host:port/db?options=… → { args:['-h',…], env:{PGPASSWORD,…}, db } */
function pgArgsFromUrl(url, { env = process.env, defaultUser = 'sdp_app' } = {}) {
  const u = new URL(url);
  const db = (u.pathname || '/sdp_dashboard').slice(1);
  const args = ['-h', u.hostname || 'localhost', '-p', u.port || '5432', '-U', decodeURIComponent(u.username || defaultUser), '-d', db];
  const childEnv = { ...env, PGPASSWORD: decodeURIComponent(u.password || '') };
  const opts = u.searchParams.get('options');
  if (opts) childEnv.PGOPTIONS = decodeURIComponent(opts);
  return { args, env: childEnv, db };
}

module.exports = { findPgBin, pgArgsFromUrl };
