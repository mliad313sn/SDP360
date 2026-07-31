/* Near-duplicate detection for report action tasks (prong B of the report-actions
 * reconduction/dedup feature). Pure + language-agnostic (lexical): normalize a
 * free-text task into a token set, score two tasks by Jaccard overlap, and find
 * the best candidate above a threshold. Usable in Node (tests) and the browser
 * (window.ActionSim). See docs/superpowers/specs/2026-07-31-report-actions-reconduct-dedup-design.md
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api; // Node
  if (root) root.ActionSim = api;                                            // browser
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : this), function () {
  'use strict';

  // Short connective words (EN + FR, accents already stripped) that inflate/deflate
  // overlap for short technical action names. Kept small on purpose.
  const STOP = new Set([
    'of', 'the', 'and', 'to', 'in', 'a', 'an', 'for', 'with', 'on', 'at', 'by', 'or',
    'is', 'be', 'this', 'that', 'from', 'as',
    'de', 'la', 'le', 'les', 'des', 'du', 'et', 'en', 'un', 'une', 'pour', 'dans',
    'sur', 'au', 'aux', 'ou', 'l', 'd', 'the',
  ]);

  function normalizeTask(s) {
    if (s == null) return [];
    return String(s)
      .toLowerCase()
      .normalize('NFD').replace(/[̀-ͯ]/g, '') // strip accents
      .replace(/[^a-z0-9]+/g, ' ')                        // punctuation -> space
      .trim()
      .split(/\s+/)
      .filter(t => t.length >= 2 && !STOP.has(t));
  }

  function _set(s) { return new Set(normalizeTask(s)); }

  // Jaccard overlap of the two token sets: |A∩B| / |A∪B|, in [0,1].
  function similarity(a, b) {
    const A = _set(a), B = _set(b);
    if (A.size === 0 || B.size === 0) return 0;
    let inter = 0;
    for (const t of A) if (B.has(t)) inter++;
    const union = A.size + B.size - inter;
    return union === 0 ? 0 : inter / union;
  }

  // Best candidate whose task is >= threshold similar to `task`. Candidates are
  // objects carrying at least `.task`; `excludeLineage` skips a lineage (so a row
  // never matches its own carry-forward ancestor). Returns { candidate, score } or null.
  function findBestMatch(task, candidates, opts) {
    opts = opts || {};
    const threshold = opts.threshold == null ? 0.5 : opts.threshold;
    if (!task || !normalizeTask(task).length || !Array.isArray(candidates) || !candidates.length) return null;
    let best = null;
    for (const c of candidates) {
      if (!c || !c.task) continue;
      if (opts.excludeLineage && c.lineage && c.lineage === opts.excludeLineage) continue;
      const score = similarity(task, c.task);
      if (score >= threshold && (!best || score > best.score)) best = { candidate: c, score };
    }
    return best;
  }

  return { normalizeTask, similarity, findBestMatch };
});
