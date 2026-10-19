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
  _keyCache.set(s, k);
  return k;
}

function isEncrypted(value) {
  return typeof value === 'string' && (value.startsWith(PREFIX) || value.startsWith(PREFIX_V1));
}
function boxVersion(value) { return !isEncrypted(value) ? null : value.startsWith(PREFIX) ? 2 : 1; }

/** Plain → `enc:v2:<iv>:<tag>:<ciphertext>` (base64). Empty stays empty; no key → unchanged. */
function encryptValue(plain, key) {
  const s = String(plain == null ? '' : plain);
  if (s === '' || !key) return s;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key.v2 || key, iv);
  const body = Buffer.concat([c.update(s, 'utf8'), c.final()]);
  return PREFIX + [iv, c.getAuthTag(), body].map(b => b.toString('base64')).join(':');
}

/**
 * Stored → plain. A value that is not a box passes through (rule 2). A box that cannot be
 * opened returns **null** (rule 3) — never the ciphertext, never a guess.
 */
function decryptValue(stored, key) {
  const s = typeof stored === 'string' ? stored : '';
  if (!isEncrypted(s)) return s;
  if (!key) return null;
  const v = boxVersion(s);
  const parts = s.slice((v === 2 ? PREFIX : PREFIX_V1).length).split(':');
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, body] = parts.map(p => Buffer.from(p, 'base64'));
    const raw = v === 2 ? (key.v2 || key) : (key.v1 || key);
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
    .map(r => ({ key: r.key, value: encryptValue(r.value, key) }));
}

// Step 4 — re-encryption plan: v1 boxes → v2 (scrypt), and/or a key rotation (oldKey opens,
// newKey seals). Plaintext rows are encrypted too. A box that opens with neither key is
// REPORTED (`unreadable`), never overwritten — overwriting it would turn "needs re-entry" into
// "silently lost". PURE.
function planReencryption(rows, { newKey, oldKey = null }) {
  const updates = [], unreadable = [], skipped = [];
  if (!newKey) return { updates, unreadable, skipped };
  for (const r of rows || []) {
    if (!r || typeof r.value !== 'string' || r.value === '') continue;
    if (!isEncrypted(r.value)) { updates.push({ key: r.key, value: encryptValue(r.value, newKey), from: 'plaintext' }); continue; }
    if (boxVersion(r.value) === 2 && !oldKey) { skipped.push(r.key); continue; }
    const plain = decryptValue(r.value, oldKey || newKey) ?? (oldKey ? decryptValue(r.value, newKey) : null);
    if (plain == null) { unreadable.push(r.key); continue; }
    updates.push({ key: r.key, value: encryptValue(plain, newKey), from: `v${boxVersion(r.value)}` });
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

module.exports = { encryptValue, decryptValue, isEncrypted, boxVersion, keyFrom, envKey, describeSecretState,
  planSecretEncryption, planReencryption, assertProductionKey, PREFIX, PREFIX_V1 };
