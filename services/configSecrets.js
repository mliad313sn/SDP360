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

const PREFIX = 'enc:v1:';
const MIN_KEY_CHARS = 16;

/** A passphrase → a 32-byte key. Returns null for anything too short to be worth having. */
// Step 4 (SDP-DASH-2.0): v2 boxes derive the AES key with scrypt and a per-value random salt
// (`enc:v2:<salt>:<iv>:<tag>:<ct>`), so a leaked dump cannot be attacked with one fast SHA-256
// guess per candidate passphrase. v1 boxes (`enc:v1:`, SHA-256 of the passphrase) stay readable;
// planSecretEncryption re-encrypts them to v2 (tools/pg/encrypt-secrets.js --apply).
const PREFIX2 = 'enc:v2:';
const SCRYPT = { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const _derived = new Map();          // `${salt}` → key, per passphrase object (scrypt is ~100 ms)

function _scryptKey(pass, salt) {
  const id = salt.toString('base64');
  let m = _derived.get(pass);
  if (!m) { m = new Map(); _derived.set(pass, m); }
  if (!m.has(id)) m.set(id, crypto.scryptSync(pass, salt, 32, SCRYPT));
  return m.get(id);
}

/**
 * A passphrase → the process key, or null when too short. The returned Buffer is the v1 key
 * (SHA-256, to READ old boxes); it also carries the passphrase (non-enumerable) so new boxes
 * are written as v2.
 */
function keyFrom(passphrase) {
  const s = String(passphrase == null ? '' : passphrase);
  if (s.length < MIN_KEY_CHARS) return null;
  const k = crypto.createHash('sha256').update(s, 'utf8').digest();
  Object.defineProperty(k, '_pass', { value: s, enumerable: false });
  return k;
}

function isEncrypted(value) {
  return typeof value === 'string' && (value.startsWith(PREFIX) || value.startsWith(PREFIX2));
}
function isLegacy(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Plain → `enc:v1:<iv>:<tag>:<ciphertext>` (base64). Empty stays empty; no key → unchanged. */
function encryptValue(plain, key) {
  const s = String(plain == null ? '' : plain);
  if (s === '' || !key) return s;
  const iv = crypto.randomBytes(12);
  if (key._pass) {                                   // v2: scrypt + per-value salt
    const salt = crypto.randomBytes(16);
    const c = crypto.createCipheriv('aes-256-gcm', _scryptKey(key._pass, salt), iv);
    const body = Buffer.concat([c.update(s, 'utf8'), c.final()]);
    return PREFIX2 + [salt, iv, c.getAuthTag(), body].map(b => b.toString('base64')).join(':');
  }
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);   // v1: a bare 32-byte key
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
  const v2 = s.startsWith(PREFIX2);
  const parts = s.slice(v2 ? PREFIX2.length : PREFIX.length).split(':');
  if (parts.length !== (v2 ? 4 : 3)) return null;
  if (v2 && !key._pass) return null;
  try {
    const bufs = parts.map(p => Buffer.from(p, 'base64'));
    const k = v2 ? _scryptKey(key._pass, bufs.shift()) : key;
    const [iv, tag, body] = bufs;
    const d = crypto.createDecipheriv('aes-256-gcm', k, iv);
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
  if (isLegacy(v)) return { state: 'encrypted_v1', label: 'chiffré (v1 — à ré-chiffrer en v2 : encrypt-secrets.js --apply)' };
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
// Empty and already-v2 values are skipped, so a second run has nothing to do; with no key the
// plan is EMPTY rather than a plan that would overwrite the secrets with something unreadable.
// Step 4: a v1 box is UPGRADED to v2 — but only when the current key opens it (a v1 box sealed
// with another key is left alone: rewriting it would destroy the only copy).
function planSecretEncryption(rows, key) {
  if (!key) return [];
  const out = [];
  for (const r of rows || []) {
    if (!r || typeof r.value !== 'string' || r.value === '') continue;
    if (!isEncrypted(r.value)) { out.push({ key: r.key, value: encryptValue(r.value, key) }); continue; }
    if (isLegacy(r.value) && key._pass) {
      const plain = decryptValue(r.value, key);
      if (plain != null) out.push({ key: r.key, value: encryptValue(plain, key), upgraded: true });
    }
  }
  return out;
}

module.exports = { encryptValue, decryptValue, isEncrypted, isLegacy, keyFrom, envKey, describeSecretState,
  planSecretEncryption, PREFIX, PREFIX2 };
