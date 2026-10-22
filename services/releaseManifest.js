'use strict';
// SDP-DASH-2.0 step 5 (lot 5.6, ADR-003) — release package manifest.
//
// A release package is the COMPLETE application tree (not a diff since a marker) plus a manifest.json that
// lists every file with its SHA-256. verifyTree() proves a tree is exactly what the CI built: no file changed,
// none missing, none added. node_modules is covered by ONE aggregate hash (thousands of files) so the
// manifest stays readable; any change inside it still fails verification.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MANIFEST = 'manifest.json';
const NODE_MODULES = 'node_modules';

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// Every regular file under dir, as forward-slash paths relative to dir, sorted.
function listTree(dir, sub = '') {
  const out = [];
  for (const e of fs.readdirSync(path.join(dir, sub), { withFileTypes: true })) {
    const rel = sub ? `${sub}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...listTree(dir, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out.sort();
}

function aggregateHash(dir, files) {
  const h = crypto.createHash('sha256');
  for (const f of files) h.update(`${f}\0${sha256File(path.join(dir, f))}\n`);
  return h.digest('hex');
}

// meta: { name, version, commit, built_at, node_major, migrations? }
function buildManifest(dir, meta) {
  const all = listTree(dir).filter(f => f !== MANIFEST);
  const deps = all.filter(f => f.startsWith(NODE_MODULES + '/'));
  const files = all.filter(f => !f.startsWith(NODE_MODULES + '/'))
    .map(f => ({ path: f, size: fs.statSync(path.join(dir, f)).size, sha256: sha256File(path.join(dir, f)) }));
  const migrations = files.map(f => f.path).filter(p => /^db\/postgres\/[^/]+\/\d{3}_.+\.sql$/.test(p));
  return {
    schema: 1,
    ...meta,
    migrations,
    files,
    node_modules: deps.length ? { count: deps.length, sha256: aggregateHash(dir, deps) } : null,
  };
}

// Returns { ok, errors[] }. Never throws on a bad tree — the caller decides what to do.
function verifyTree(dir) {
  const errors = [];
  let m;
  try { m = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8')); }
  catch (e) { return { ok: false, errors: [`${MANIFEST} unreadable: ${e.message}`] }; }
  if (m.schema !== 1 || !Array.isArray(m.files)) return { ok: false, errors: [`${MANIFEST}: unknown format`] };
  const present = new Set(listTree(dir).filter(f => f !== MANIFEST && !f.startsWith(NODE_MODULES + '/')));
  for (const f of m.files) {
    const p = path.join(dir, f.path);
    if (!present.has(f.path)) { errors.push(`missing: ${f.path}`); continue; }
    present.delete(f.path);
    if (sha256File(p) !== f.sha256) errors.push(`changed: ${f.path}`);
  }
  for (const extra of present) errors.push(`not in manifest: ${extra}`);
  const nmDir = path.join(dir, NODE_MODULES);
  const deps = fs.existsSync(nmDir) ? listTree(dir, NODE_MODULES) : [];
  if (m.node_modules) {
    if (deps.length !== m.node_modules.count) errors.push(`node_modules: ${deps.length} files, manifest says ${m.node_modules.count}`);
    else if (aggregateHash(dir, deps) !== m.node_modules.sha256) errors.push('node_modules: content changed');
  } else if (deps.length) errors.push('node_modules present but not in manifest');
  return { ok: errors.length === 0, errors, version: m.version, commit: m.commit };
}

// The installed version, for /health and asset versioning. null outside a release package.
function readInstalled(dir) {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'));
    return { version: m.version || null, commit: m.commit || null, built_at: m.built_at || null };
  } catch (_) { return null; }
}

module.exports = { MANIFEST, sha256File, listTree, buildManifest, verifyTree, readInstalled };
