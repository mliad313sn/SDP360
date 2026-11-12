'use strict';
// E-B08 step 2 (audit B-08, X-B-02) — number check on POST /api/ai/analyze (deck builder). ADDITIVE METADATA only:
// when the request carries `facts` (the numbers the page sent the model, as numbers or short strings), the reply's
// numbers are verified with aiCommentary.verifyNumbers and the answer gains `verification: {verified, offending}`.
// The reply is NEVER dropped or rewritten — the page shows the offending numbers. No `facts` → answer unchanged.
// `facts` is never forwarded to the provider (server.js passes only explicit fields).
const { verifyNumbers } = require('./aiCommentary');

const MAX_FACTS = 500;

/** Pure: canonical number set from the facts list (each number in every fact, in the forms verifyNumbers compares). */
function canonicalFrom(facts) {
  const set = new Set();
  for (const f of (facts || []).slice(0, MAX_FACTS)) {
    const nums = String(f == null ? '' : f).match(/-?\d+(?:[.,]\d+)?/g) || [];
    for (const raw of nums) {
      const v = Number(raw.replace(',', '.'));
      if (!Number.isFinite(v)) continue;
      set.add(String(v)); set.add(v.toFixed(1)); set.add(String(Math.round(v)));
    }
  }
  return set;
}

function replyText(data) {
  const c = data && Array.isArray(data.content) ? data.content : [];
  return c.filter((x) => x && x.type !== 'tool_use').map((x) => (x && x.text) || '').join('\n');
}

/** Returns `data` unchanged without facts; otherwise a copy with `verification`. */
function annotate(data, facts) {
  if (!Array.isArray(facts) || !data || typeof data !== 'object') return data;
  const check = verifyNumbers(replyText(data), canonicalFrom(facts));
  return { ...data, verification: { verified: check.ok, offending: check.offending.slice(0, 50) } };
}

module.exports = { annotate, canonicalFrom, replyText, MAX_FACTS };
