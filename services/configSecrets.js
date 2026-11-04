'use strict';
// A-13 (audit 2026-09-24) — encryption at rest for the secret config values.
//
// The six secret-shaped keys (smtp_pass, entra_client_secret, meridian_out_key,
// meridian_in_key, meraki_api_key, opmanager_api_key) are redacted on GET and blank-kept
// on save, but they sit in `report_config` as plain text. Every pg_dump therefore carries
// them, and a restore point is a file that hands whoever holds it the SSO client secret.
// That was accepted knowingly ("Option A"); this closes it without forcing anyone's hand.
//
// DESIGN, in order of importance:
//
//  1. NO KEY, NO CHANGE. With SDP_CONFIG_KEY unset, every value is stored and read as
//     plain text exactly as before. An existing install keeps working untouched; nobody
//     is locked out of SMTP because a key was not set during a deploy.
//  2. PLAINTEXT ALWAYS READS. A value that is not a box is returned as-is, so a database
//     written before the key existed keeps working the day the key appears. Encryption
//     happens on the next save.
//  3. A BOX WITHOUT ITS KEY IS NEVER RETURNED. Handing ciphertext to nodemailer as a
//     password produces an authentication error nobody can interpret at 07:00 on a
//     Monday. Unreadable means null, loudly, with the cause named.
//  4. AES-256-GCM: tampering with a restored dump is detected, not silently decrypted.
//
// The key lives in .env (SDP_CONFIG_KEY) — the one file a database dump does not contain.
// Lose it and the stored secrets are unrecoverable: they must be re-entered in the admin
// console, which is a five-minute job, not a data loss.

const crypto = require('crypto');

const PREFIX_V1 = 'enc:v1:';   // sha256(passphrase) — kept readable, never written any more
const PREFIX = 'enc:v2:';      // Step 4 — scrypt(passphrase, fixed salt, N=2^15) → 32 bytes
// A-28b — enc:v3:<salt>:<iv>:<tag>:<ct>: scrypt(passphrase, RANDOM 16-byte salt per box) and the
// report_config key name as GCM additional authenticated data, so a box copied into another key's row
// (smtp_pass ↔ meraki_api_key) no longer opens. Written ONLY when SDP_CONFIG_BOX_VERSION=3; the default
// stays v2 (today). An older build cannot read v3 — never downgrade after re-encrypting.
const PREFIX_V3 = 'enc:v3:';
const MIN_KEY_CHARS = 16;
const SCRYPT_SALT = Buffer.from('sdp-dashboard-config-key-v2', 'utf8');
const SCRYPT_OPTS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/**
 * A passphrase → { v2: scrypt key, v1: sha256 key } or null when too short to be worth having.
 * Derived once per distinct passphrase (scrypt is deliberately slow).
 */
const _keyCache = new Map();
function keyFrom(passphrase) {
  const s = String(passphrase == null ? '' : passphrase);
  if (s.length < MIN_KEY_CHARS) return null;
  if (_keyCache.has(s)) return _keyCache.get(s);
  const k = { v2: crypto.scryptSync(s, SCRYPT_SALT, 32, SCRYPT_OPTS), v1: crypto.createHash('sha256').update(s, 'utf8').digest() };
  // A-03a — the 1.11 enc:v2 layout derives a key PER BOX (random salt), so reading it needs the
  // passphrase itself. Non-enumerable: it never appears in JSON.stringify, Object.keys or a log.
  Object.defineProperty(k, '_pass', { value: s, enumerable: false });
  _keyCache.set(s, k);
  return k;
}

// A-03a — 1.11 wrote `enc:v2:<salt>:<iv>:<tag>:<ct>` (scrypt, random 16-byte salt per value).
// 2.0 still WRITES its 3-part layout; the 4-part one is read-only compatibility. Derived keys are
// cached per (passphrase, salt) like 1.11 did — scrypt is ~100 ms.
const _saltKeys = new Map();
function _scryptSaltKey(pass, salt) {
  let m = _saltKeys.get(pass);
  if (!m) { m = new Map(); _saltKeys.set(pass, m); }
  const id = salt.toString('base64');
  if (!m.has(id)) m.set(id, crypto.scryptSync(pass, salt, 32, SCRYPT_OPTS));
  return m.get(id);
}
/** True for a 1.11-layout box (`enc:v2:` with 4 parts). */
function isV2Legacy(value) {
  return typeof value === 'string' && value.startsWith(PREFIX) && value.slice(PREFIX.length).split(':').length === 4;
}

function isEncrypted(value) {
  return typeof value === 'string' && (value.startsWith(PREFIX) || value.startsWith(PREFIX_V1) || value.startsWith(PREFIX_V3));
}
function boxVersion(value) {
  if (!isEncrypted(value)) return null;
  return value.startsWith(PREFIX_V3) ? 3 : value.startsWith(PREFIX) ? 2 : 1;
}
/** A-28b — the box version new values are sealed with: 3 only when SDP_CONFIG_BOX_VERSION=3, else 2 (today). */
function defaultBoxVersion(env = process.env) { return String(env.SDP_CONFIG_BOX_VERSION || '').trim() === '3' ? 3 : 2; }

/**
 * Plain → box (base64 parts). Empty stays empty; no key → unchanged.
 * v2 (default): `enc:v2:<iv>:<tag>:<ct>`. v3 (opts.version 3, or SDP_CONFIG_BOX_VERSION=3):
 * `enc:v3:<salt>:<iv>:<tag>:<ct>`, bound to opts.keyName — which is then mandatory.
 */
function encryptValue(plain, key, opts = {}) {
  const s = String(plain == null ? '' : plain);
  if (s === '' || !key) return s;
  const version = opts.version != null ? Number(opts.version) : defaultBoxVersion();
  if (version === 3) {
    if (!opts.keyName) throw new Error('enc:v3 needs the report_config key name (keyName)');
    if (!key._pass) throw new Error('enc:v3 needs a passphrase-derived key (keyFrom)');
    const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
    const c = crypto.createCipheriv('aes-256-gcm', _scryptSaltKey(key._pass, salt), iv);
    c.setAAD(Buffer.from(String(opts.keyName), 'utf8'));
    const body = Buffer.concat([c.update(s, 'utf8'), c.final()]);
    return PREFIX_V3 + [salt, iv, c.getAuthTag(), body].map(b => b.toString('base64')).join(':');
  }
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key.v2 || key, iv);
  const body = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return PREFIX + [iv, c.getAuthTag(), body].map(b => b.toString('base64')).join(':');
}

/**
 * Stored → plain. A value that is not a box passes through (rule 2). A box that cannot be
 * opened returns **null** (rule 3) — never the ciphertext, never a guess.
 */
function decryptValue(stored, key, opts = {}) {
  const s = typeof stored === 'string' ? stored : '';
  if (!isEncrypted(s)) return s;
  if (!key) return null;
  const v = boxVersion(s);
  if (v === 3) {
    // A-28b — needs the passphrase (per-box salt) AND the key name it was sealed under (AAD).
    const parts = s.slice(PREFIX_V3.length).split(':');
    if (parts.length !== 4 || !key._pass || !opts.keyName) return null;
    try {
      const [salt, iv, tag, body] = parts.map(p => Buffer.from(p, 'base64'));
      if (salt.length !== 16 || iv.length !== 12) return null;
      const d = crypto.createDecipheriv('aes-256-gcm', _scryptSaltKey(key._pass, salt), iv);
      d.setAAD(Buffer.from(String(opts.keyName), 'utf8'));
      d.setAuthTag(tag);
      return Buffer.concat([d.update(body), d.final()]).toString('utf8');
    } catch (e) {
      return null;                     // wrong key, wrong key name, or the box was altered
    }
  }
  const parts = s.slice((v === 2 ? PREFIX : PREFIX_V1).length).split(':');
  const legacy111 = v === 2 && parts.length === 4;
  if (parts.length !== 3 && !legacy111) return null;
  if (legacy111 && !key._pass) return null;
  try {
    const bufs = parts.map(p => Buffer.from(p, 'base64'));
    const raw = legacy111 ? _scryptSaltKey(key._pass, bufs.shift())
      : v === 2 ? (key.v2 || key) : (key.v1 || key);
    const [iv, tag, body] = bufs;
    const d = crypto.createDecipheriv('aes-256-gcm', raw, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString('utf8');
  } catch (e) {
    return null;                       // wrong key, or the box was altered
  }
}

// The process key, or null. Read on every call so a restart is enough to change it.
//
// A key that is SET but REJECTED must not be silent. Measured on dotenv: a `#` truncates
// the value, a backslash is swallowed and surrounding quotes are stripped — so
// `SDP_CONFIG_KEY=abc#defghijklmnop`, seventeen characters as typed, reaches the process
// as `abc`, falls under the floor, and encryption quietly does not happen while the
// operator believes it is on. That is the one outcome worth a line in the log; an unset
// key stays silent, since running without encryption is a legitimate configuration.
let _warnedShort = false;
function envKey(env = process.env, warn = console.warn) {
  const raw = env.SDP_CONFIG_KEY;
  const key = keyFrom(raw);
  if (!key && raw != null && String(raw) !== '') {
    if (warn !== console.warn || !_warnedShort) {
      if (warn === console.warn) _warnedShort = true;
      warn(`[config] SDP_CONFIG_KEY is set but shorter than ${MIN_KEY_CHARS} characters once parsed `
        + '— secrets are NOT encrypted. Beware: in a .env value a "#" truncates it, a backslash is '
        + 'swallowed and surrounding quotes are stripped.');
    }
  }
  return key;
}

// Setting the key changes nothing on its own: a stored value only becomes a box when it
// is next SAVED. So "the key is accepted" and "the database no longer carries the secret"
// are different facts, and an operator needs to see the second one. Never returns the
// value — a diagnostic that prints the password defeats its own purpose.
function describeSecretState(stored) {
  const v = stored == null ? '' : String(stored);
  if (v === '') return { state: 'empty', label: 'non renseigné' };
  if (isEncrypted(v)) return { state: 'encrypted', label: 'chiffré' };
  return { state: 'plaintext', label: 'EN CLAIR — présent tel quel dans les sauvegardes' };
}

// Plan the one-off migration of values written before the key existed. PURE: it takes the
// rows and returns the updates, so the writing half stays a tiny, auditable loop.
//
// Re-typing the secrets in the admin console is the alternative, and it is the riskier
// one: those fields are redacted on GET and BLANK MEANS KEEP, so a Save with an untouched
// field encrypts nothing while appearing to succeed — and a typo in the SMTP password is
// discovered on Monday by the people waiting for a report. Re-encrypting in place needs
// nobody to know the values.
//
// Empty and already-encrypted values are skipped, so a second run has nothing to do; with
// no key the plan is EMPTY rather than a plan that would overwrite the secrets with
// something unreadable.
function planSecretEncryption(rows, key) {
  if (!key) return [];
  return (rows || [])
    .filter(r => r && typeof r.value === 'string' && r.value !== '' && !isEncrypted(r.value))
    .map(r => ({ key: r.key, value: encryptValue(r.value, key, { keyName: r.key }) }));
}

// Step 4 — re-encryption plan: v1 boxes → v2 (scrypt), and/or a key rotation (oldKey opens,
// newKey seals). Plaintext rows are encrypted too. A box that opens with neither key is
// REPORTED (`unreadable`), never overwritten — overwriting it would turn "needs re-entry" into
// "silently lost". PURE.
function planReencryption(rows, { newKey, oldKey = null, to = null }) {
  const updates = [], unreadable = [], skipped = [];
  if (!newKey) return { updates, unreadable, skipped };
  // A-28b — target box version: explicit `to` ('v2' | 'v3'), else SDP_CONFIG_BOX_VERSION (default v2).
  const target = to ? Number(String(to).replace(/^v/i, '')) : defaultBoxVersion();
  const seal = (plain, keyName) => encryptValue(plain, newKey, { keyName, version: target });
  for (const r of rows || []) {
    if (!r || typeof r.value !== 'string' || r.value === '') continue;
    const tag = `v${target}`;
    if (!isEncrypted(r.value)) { updates.push({ key: r.key, value: seal(r.value, r.key), from: 'plaintext', to: tag }); continue; }
    const legacy111 = isV2Legacy(r.value);     // A-03a — a 1.11 box is re-sealed like a v1 box
    const ver = boxVersion(r.value);
    const opts = { keyName: r.key };
    // Without a rotation a box already at the target is kept. Without an explicit `to`, a NEWER box (v3 when the
    // default is v2) is kept too — never downgraded by accident; `to: 'v2'` downgrades on purpose (rollback path).
    const atTarget = ver === target || (!to && ver > target);
    if (atTarget && !legacy111 && !oldKey) {
      // v2: assumed sealed with the current key (unchanged rule). v3: checked, since it is bound to its key
      // name and a misplaced box must be reported, not kept silently.
      if (ver === 3 && decryptValue(r.value, newKey, opts) == null) { unreadable.push(r.key); continue; }
      skipped.push(r.key); continue;
    }
    const plain = decryptValue(r.value, oldKey || newKey, opts) ?? (oldKey ? decryptValue(r.value, newKey, opts) : null);
    if (plain == null) { unreadable.push(r.key); continue; }
    updates.push({ key: r.key, value: seal(plain, r.key), from: legacy111 ? 'v2-1.11' : `v${ver}`, to: tag });
  }
  return { updates, unreadable, skipped };
}

// Step 4 — in production the key is mandatory: a backup must never carry a plaintext secret.
// `SDP_ALLOW_PLAINTEXT_SECRETS=1` is the documented, logged escape hatch for a migration window.
function assertProductionKey(env = process.env) {
  const prod = String(env.NODE_ENV || '').toLowerCase() === 'production';
  if (!prod) return { required: false, ok: true };
  if (keyFrom(env.SDP_CONFIG_KEY)) return { required: true, ok: true };
  if (/^(1|true|yes)$/i.test(String(env.SDP_ALLOW_PLAINTEXT_SECRETS || ''))) return { required: true, ok: true, bypass: true };
  return { required: true, ok: false, reason: `SDP_CONFIG_KEY (≥ ${MIN_KEY_CHARS} chars) is mandatory with NODE_ENV=production; set it in .env, or SDP_ALLOW_PLAINTEXT_SECRETS=1 for a migration window (logged).` };
}

module.exports = { encryptValue, decryptValue, isEncrypted, isV2Legacy, boxVersion, keyFrom, envKey, describeSecretState,
  planSecretEncryption, planReencryption, assertProductionKey, defaultBoxVersion, PREFIX, PREFIX_V1, PREFIX_V3 };
