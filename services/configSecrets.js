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
function keyFrom(passphrase) {
  const s = String(passphrase == null ? '' : passphrase);
  if (s.length < MIN_KEY_CHARS) return null;
  return crypto.createHash('sha256').update(s, 'utf8').digest();
}

function isEncrypted(value) {
  return typeof value === 'string' && value.startsWith(PREFIX);
}

/** Plain → `enc:v1:<iv>:<tag>:<ciphertext>` (base64). Empty stays empty; no key → unchanged. */
function encryptValue(plain, key) {
  const s = String(plain == null ? '' : plain);
  if (s === '' || !key) return s;
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
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
  const parts = s.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return null;
  try {
    const [iv, tag, body] = parts.map(p => Buffer.from(p, 'base64'));
    const d = crypto.createDecipheriv('aes-256-gcm', key, iv);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(body), d.final()]).toString('utf8');
  } catch (e) {
    return null;                       // wrong key, or the box was altered
  }
}

/** The process key, or null. Read on every call so a restart is enough to change it. */
function envKey(env = process.env) {
  return keyFrom(env.SDP_CONFIG_KEY);
}

module.exports = { encryptValue, decryptValue, isEncrypted, keyFrom, envKey, PREFIX };
