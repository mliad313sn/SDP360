'use strict';
// C-21 (PO decision R11) — commitment owners: an OPTIONAL link to a user account, the free text is kept.
// PURE. The free-text owner (accountable_owner) links to an account only when it is exactly that account's
// username or e-mail (case-insensitive) — never by full name (namesakes, security P1-3). No match = the text
// stands alone, as before. Nothing is written: the link is resolved when the commitment is read.
function ownerAccount(text, users) {
  const k = String(text || '').trim().toLowerCase();
  if (!k) return null;
  const hits = (users || []).filter((u) => u && u.active !== 0 && u.active !== false
    && [u.username, u.email].filter(Boolean).some((x) => String(x).trim().toLowerCase() === k));
  if (hits.length !== 1) return null;   // ambiguous or unknown → no link
  return { id: Number(hits[0].id), name: hits[0].full_name || hits[0].username };
}
module.exports = { ownerAccount };
