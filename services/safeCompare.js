'use strict';
// Step 4 (SDP-DASH-2.0) — constant-time comparison of secrets (API keys, shared keys, nonces).
// `a === b` returns as soon as a character differs, so response timing leaks how much of a guessed
// key is right. Both sides are hashed first so their lengths match (timingSafeEqual requires it)
// and the comparison does not leak the length either. An empty expected value never matches.
const crypto = require('crypto');

function safeEqual(given, expected) {
  if (expected == null || expected === '' || given == null) return false;
  const h = s => crypto.createHash('sha256').update(String(s), 'utf8').digest();
  return crypto.timingSafeEqual(h(given), h(expected));
}

module.exports = { safeEqual };
