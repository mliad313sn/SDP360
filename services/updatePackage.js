'use strict';
// Step 5 — versioned update package: the manifest a CI build writes next to the files and
// the checks the installer / manager run before touching an installation.
//
//   manifest.json = { format: 1, name, version, commit, built_at, files: { "<rel/path>": { sha256, size } } }
//
// Everything here is PURE (no fs, no network): the callers hand in buffers or a
// `readFile(relPath) -> Buffer|null` function. Rules:
//   - a package is applied only when EVERY listed file hashes as declared (one bad byte =
//     the whole package is refused, never a partial copy);
//   - a downgrade is refused unless `allowDowngrade` is explicit (rollback goes through the
//     kept previous version, not through re-applying an older package);
//   - SemVer with pre-release (2.0.0-alpha.6 < 2.0.0-beta.1 < 2.0.0);
//   - E1: the manifest itself is SIGNED (Ed25519) by CI with the private key held as the secret
//     SIGNING_MANIFEST_KEY; the Manager verifies against the public key shipped in
//     tools/manifest-public.pem BEFORE applying. A hash shipped next to the zip only proves the
//     zip is intact, not who built it — the signature does. Unsigned → refused unless the operator
//     passes --allow-unsigned (logged); a signature that does not verify → always refused.

const crypto = require('crypto');

const FORMAT = 1;

function sha256(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }

function normPath(p) {
  const s = String(p || '').replace(/\\/g, '/').replace(/^\.\//, '');
  if (!s || s.startsWith('/') || s.split('/').includes('..')) throw new Error(`unsafe package path: ${p}`);
  return s;
}

/**
 * @param {Array<{path:string, data:Buffer}>} files
 * @param {{name?:string, version:string, commit?:string, builtAt?:Date}} meta
 */
function buildManifest(files, meta) {
  if (!meta || !meta.version) throw new Error('version required');
  if (!parseVersion(meta.version)) throw new Error(`not a SemVer version: ${meta.version}`);
  const out = {};
  for (const f of files) {
    const p = normPath(f.path);
    if (out[p]) throw new Error(`duplicate package path: ${p}`);
    out[p] = { sha256: sha256(f.data), size: f.data.length };
  }
  return {
    format: FORMAT,
    name: meta.name || 'sdp-dashboard',
    version: meta.version,
    commit: meta.commit || null,
    built_at: (meta.builtAt || new Date()).toISOString(),
    files: Object.fromEntries(Object.keys(out).sort().map(k => [k, out[k]])),
  };
}

/**
 * Verify a manifest against the files actually present.
 * @param {object} manifest
 * @param {(relPath:string)=>Buffer|null} readFile
 * @returns {{ok:boolean, checked:number, missing:string[], mismatched:string[], errors:string[]}}
 */
function verifyManifest(manifest, readFile) {
  const r = { ok: false, checked: 0, missing: [], mismatched: [], errors: [] };
  if (!manifest || manifest.format !== FORMAT) { r.errors.push('unsupported manifest format'); return r; }
  if (!parseVersion(manifest.version)) r.errors.push('manifest version is not SemVer');
  const files = manifest.files || {};
  if (!Object.keys(files).length) r.errors.push('manifest lists no file');
  for (const [p, want] of Object.entries(files)) {
    let data = null;
    try { normPath(p); data = readFile(p); } catch (e) { r.errors.push(`${p}: ${e.message}`); continue; }
    if (!data) { r.missing.push(p); continue; }
    r.checked++;
    if (sha256(data) !== want.sha256 || (want.size != null && data.length !== want.size)) r.mismatched.push(p);
  }
  r.ok = !r.errors.length && !r.missing.length && !r.mismatched.length;
  return r;
}

// ---- Manifest signature (Ed25519) ----------------------------------------------------
// The signature covers the CANONICAL bytes of the manifest without its `signature` member:
// keys sorted recursively, no whitespace — so a re-serialisation (pretty-printed by the packager,
// compact in a test fixture) verifies the same, while one changed byte in any file hash,
// version or path breaks it.
const SIG_ALG = 'ed25519';

function _canon(v) {
  if (Array.isArray(v)) return '[' + v.map(_canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + _canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
function canonicalManifestBytes(manifest) {
  if (!manifest || typeof manifest !== 'object') throw new Error('manifest required');
  const { signature, ...rest } = manifest;   // eslint-disable-line no-unused-vars
  return Buffer.from(_canon(rest), 'utf8');
}
function _keyId(publicKey) {
  return sha256(publicKey.export({ type: 'spki', format: 'der' })).slice(0, 16);
}
function _asPrivateKey(k) {
  const key = typeof k === 'string' || Buffer.isBuffer(k) ? crypto.createPrivateKey(k) : k;
  if (key.asymmetricKeyType !== SIG_ALG) throw new Error(`manifest signing key must be ${SIG_ALG} (got ${key.asymmetricKeyType})`);
  return key;
}
function _asPublicKey(k) {
  const key = typeof k === 'string' || Buffer.isBuffer(k) ? crypto.createPublicKey(k) : k;
  if (key.asymmetricKeyType !== SIG_ALG) throw new Error(`manifest public key must be ${SIG_ALG} (got ${key.asymmetricKeyType})`);
  return key;
}

/**
 * Return a COPY of the manifest carrying `signature = { alg, key_id, value }`.
 * @param {object} manifest
 * @param {string|Buffer|import('crypto').KeyObject} privateKey  PKCS8 PEM (the CI secret) or a KeyObject
 */
function signManifest(manifest, privateKey) {
  const key = _asPrivateKey(privateKey);
  const sig = crypto.sign(null, canonicalManifestBytes(manifest), key);
  const pub = crypto.createPublicKey(key);
  return { ...manifest, signature: { alg: SIG_ALG, key_id: _keyId(pub), value: sig.toString('base64') } };
}

/**
 * Verify the manifest signature. Never throws on a BAD package — only on a bad public key.
 * @returns {{ signed:boolean, ok:boolean, reason:string|null, key_id:string|null }}
 *   signed=false, ok=false            → the manifest carries no signature
 *   signed=true,  ok=false, reason    → signature present but does not verify (altered or foreign key)
 *   signed=true,  ok=true             → good
 */
function verifyManifestSignature(manifest, publicKey) {
  const pub = _asPublicKey(publicKey);
  const r = { signed: false, ok: false, reason: null, key_id: _keyId(pub) };
  const sig = manifest && manifest.signature;
  if (!sig || typeof sig !== 'object' || !sig.value) return r;
  r.signed = true;
  if (sig.alg !== SIG_ALG) { r.reason = `unsupported signature algorithm: ${sig.alg}`; return r; }
  let ok = false;
  try { ok = crypto.verify(null, canonicalManifestBytes(manifest), pub, Buffer.from(String(sig.value), 'base64')); } catch (e) { r.reason = `signature unreadable: ${e.message}`; return r; }
  if (!ok) { r.reason = sig.key_id && sig.key_id !== r.key_id ? `signature made with another key (${sig.key_id}), not the embedded public key (${r.key_id})` : 'signature does not match the manifest (altered package or wrong key)'; return r; }
  r.ok = true;
  return r;
}

// ---- SemVer -------------------------------------------------------------------------
const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;
function parseVersion(v) {
  const m = SEMVER.exec(String(v || '').trim());
  if (!m) return null;
  return { major: +m[1], minor: +m[2], patch: +m[3], pre: m[4] ? m[4].split('.') : [] };
}
function _cmpId(a, b) {
  const na = /^\d+$/.test(a), nb = /^\d+$/.test(b);
  if (na && nb) return Math.sign(+a - +b);
  if (na) return -1;            // numeric identifiers sort before alphanumeric
  if (nb) return 1;
  return a < b ? -1 : a > b ? 1 : 0;
}
function compareVersions(a, b) {
  const pa = parseVersion(a), pb = parseVersion(b);
  if (!pa || !pb) throw new Error('compareVersions: not SemVer');
  for (const k of ['major', 'minor', 'patch']) if (pa[k] !== pb[k]) return Math.sign(pa[k] - pb[k]);
  if (!pa.pre.length && !pb.pre.length) return 0;
  if (!pa.pre.length) return 1;   // a release outranks any pre-release
  if (!pb.pre.length) return -1;
  for (let i = 0; i < Math.max(pa.pre.length, pb.pre.length); i++) {
    if (pa.pre[i] === undefined) return -1;
    if (pb.pre[i] === undefined) return 1;
    const c = _cmpId(pa.pre[i], pb.pre[i]);
    if (c) return c;
  }
  return 0;
}

/** Decide whether `target` may be applied on top of `current` (null = fresh install). */
function canApply(current, target, { allowDowngrade = false, allowSame = false } = {}) {
  if (!parseVersion(target)) return { ok: false, reason: `target version is not SemVer: ${target}` };
  if (!current) return { ok: true, kind: 'install' };
  if (!parseVersion(current)) return { ok: false, reason: `installed version unreadable: ${current}` };
  const c = compareVersions(target, current);
  if (c > 0) return { ok: true, kind: 'upgrade' };
  if (c === 0) return allowSame ? { ok: true, kind: 'reinstall' } : { ok: false, reason: `version ${target} is already installed` };
  return allowDowngrade ? { ok: true, kind: 'downgrade' } : { ok: false, reason: `downgrade ${current} -> ${target} refused (use rollback)` };
}

/**
 * Paths that must never travel in a package or be overwritten by one: the installation's
 * own state. The packager drops them, the applier refuses a manifest that lists them.
 */
const PROTECTED = ['.env', 'data/', 'node_modules/', 'logs/', '.git/', 'backups/'];
function isProtected(relPath) {
  const p = normPath(relPath);
  return PROTECTED.some(x => x.endsWith('/') ? p.startsWith(x) : p === x);
}

module.exports = { FORMAT, PROTECTED, SIG_ALG, sha256, normPath, buildManifest, verifyManifest, canonicalManifestBytes, signManifest, verifyManifestSignature, parseVersion, compareVersions, canApply, isProtected };
