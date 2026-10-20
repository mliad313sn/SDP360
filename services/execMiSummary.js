'use strict';

// ─────────────────────────────────────────────────────────────────────────────
//  services/execMiSummary.js — AI summarizer for the public Exec View
//  Major-Incident cards.
//
//  The raw RCA / Corrective-Action UDF text is long, technical and free-form
//  (multi-paragraph). For a public, non-technical executive audience we want a
//  ONE-sentence plain-English gist of each. Because the Exec View endpoint is
//  public and cached, we NEVER call the model on the request path:
//
//    read path  (sync, public)  : applyCachedSummaries(mis, cacheMap)
//                                   → swaps in cached summaries when the source
//                                     text is unchanged (src_hash match); the
//                                     rest keep their verbatim text and are
//                                     returned in `stale` for regeneration.
//    write path (async, offline): regenerate({stale, aiCall, rdb, model})
//                                   → one model call per stale incident, then
//                                     rdb.setExecMiSummary(...). Fire-and-forget
//                                     from the route so the next load is warm.
//
//  aiCall contract (injected by the caller): (body) => Promise<string> where
//  body = { system, messages, max_tokens, temperature } and the resolved value
//  is the model's raw text. The server wraps its provider switch
//  (_aiCallLocal / _aiCallAnthropic) to satisfy this.
// ─────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');

// Stable, change-sensitive fingerprint of an incident's SOURCE text. Summaries
// are cached against this so they regenerate only when the RCA/CA/impact/subject
// actually changes.
function miSrcHash(mi) {
  const parts = [mi && mi.subject, mi && mi.impact, mi && mi.rca, mi && mi.ca]
    .map(x => String(x == null ? '' : x));
  return crypto.createHash('sha1').update(parts.join('')).digest('hex').slice(0, 16);
}

// Does this incident have anything worth summarizing?
function _hasSource(mi) {
  return !!((mi && String(mi.rca || '').trim()) || (mi && String(mi.ca || '').trim()));
}

// Pure read-path step. For each MI:
//  - fresh cache hit (src_hash matches, has summary text) → swap rca/ca with the
//    concise summary and set _summarized = true.
//  - miss or stale hash (and there IS source text) → leave verbatim, add to
//    `stale` for regeneration.
//  - no source text → left as-is, never stale.
// Mutates the MI objects in place (and also returns them for convenience).
function applyCachedSummaries(mis, cacheMap) {
  const stale = [];
  const map = cacheMap || {};
  for (const mi of (mis || [])) {
    if (!mi) continue;
    const cached = map[mi.request_id];
    const fresh = cached && cached.src_hash === miSrcHash(mi)
      && (cached.root_cause_summary || cached.action_summary);
    if (fresh) {
      if (cached.root_cause_summary) mi.rca = cached.root_cause_summary;
      if (cached.action_summary)     mi.ca  = cached.action_summary;
      mi._summarized = true;
    } else if (_hasSource(mi)) {
      stale.push(mi);
    }
  }
  return { mis: mis || [], stale };
}

// Anthropic-shape request body (minus `model`, which the injected aiCall fills
// per provider). The full instruction lives in the USER message (not `system`)
// because the server's provider wrappers impose their own system prompt — the
// user message survives on both the Anthropic and local paths. Asks for a
// strict JSON object so parsing is deterministic.
function buildMiSummaryPrompt(mi) {
  const content =
    'Summarize this IT major incident for a CIO / CFO reader on a public status page, in simple English ' +
    '(no acronyms, no IT jargon: say "root cause" not RCA, "internet link" not WAN; one sentence under 22 words each). ' +
    'Be factual, neutral and concise. Do NOT invent ' +
    'details not present in the source. Do NOT include names of people. Reply ' +
    'with ONLY a JSON object of the form ' +
    '{"root_cause":"<one plain-English sentence>","action":"<one plain-English sentence>"}. ' +
    'If a field has no source text, use an empty string for it.\n\n' +
    `Incident: ${mi.subject || '(untitled)'}\n` +
    `Impact: ${mi.impact || '(unspecified)'}\n` +
    `Root cause (raw): ${mi.rca || '(none recorded)'}\n` +
    `Corrective action (raw): ${mi.ca || '(none recorded)'}`;
  return {
    max_tokens: 300,
    temperature: 0.2,
    messages: [{ role: 'user', content }],
  };
}

// Tolerant JSON extraction from model output (handles ```json fences / prose).
function parseSummaryResponse(text) {
  if (!text) return null;
  let s = String(text).trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a === -1 || b === -1 || b <= a) return null;
  try {
    const o = JSON.parse(s.slice(a, b + 1));
    // House style: one plain-English sentence each (CIO / CFO). A sentence that fails the check is
    // de-jargoned; if it still fails (French, too long) it is dropped so the raw text is shown instead.
    const plain = require('./plainEnglish');
    const one = (v) => { if (typeof v !== 'string') return ''; let t = plain.dejargon(v.trim()); const c = plain.check(t, { ...plain.LIMITS, maxSentences: 1, maxWordsPerSentence: 26, maxWords: 26 }); return c.ok ? t : ''; };
    const rc = one(o.root_cause);
    const ac = one(o.action);
    if (!rc && !ac) return null;
    return { root_cause: rc, action: ac };
  } catch { return null; }
}

// Async write-path step. Best-effort: a per-incident failure is logged and
// skipped, never thrown (this runs fire-and-forget off the request path).
async function regenerate({ stale, aiCall, rdb, model, log } = {}) {
  const warn = log || ((m) => console.warn('[exec-mi-summary]', m));
  for (const mi of (stale || [])) {
    if (!mi || !_hasSource(mi) || !mi.request_id) continue;
    try {
      const text = await aiCall(buildMiSummaryPrompt(mi));
      const parsed = parseSummaryResponse(text);
      if (!parsed) { warn(`no parseable summary for ${mi.request_id}`); continue; }
      await rdb.setExecMiSummary(mi.request_id, {   // async under REPORTS_BACKEND=postgres; no-op await on sqlite
        src_hash: miSrcHash(mi),
        root_cause_summary: parsed.root_cause || null,
        action_summary: parsed.action || null,
        model: model || null,
      });
    } catch (e) {
      warn(`regenerate failed for ${mi.request_id}: ${e.message}`);
    }
  }
}

module.exports = {
  miSrcHash,
  applyCachedSummaries,
  buildMiSummaryPrompt,
  parseSummaryResponse,
  regenerate,
};
