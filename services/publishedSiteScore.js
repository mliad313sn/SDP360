'use strict';
// A-11 — ONE published site verdict, behind a switch (PROPOSED; repo decision D-03
// "reference site score" is OPEN — nothing here says it is decided).
//
// Two authoritative models coexist and legitimately disagree (CLAUDE.md "TWO scoring
// models"): the programme score (services/siteScore.js · sbDims · 70/45 · 3-month rolling
// window) and the operational composite (services/siteScoreboard.js · 4 dimensions ·
// 75/55 · current month). This module does NOT score anything: it only picks which of the
// two already-computed results is the published one, and carries the other alongside.
//
// report_config.site_score_published_model:
//   'legacy'      (default) — each e-mail keeps its own model exactly as today → null here.
//   'programme'   — the programme score is published; the composite is "non publié".
//   'operational' — the composite is published; the programme score is "non publié".
// Anything else falls back to 'legacy'. Null / non-applicable stays null — never 0.

const MODELS = ['legacy', 'programme', 'operational'];

const META = {
  programme: { label: 'Score programme', window: '3 mois glissants' },
  operational: { label: 'Indicateur opérationnel', window: 'mois courant' },
};

function normalizeModel(v) {
  const s = String(v == null ? '' : v).trim().toLowerCase();
  return MODELS.includes(s) ? s : 'legacy';
}

function _side(model, src) {
  const o = src || {};
  const applicable = o.applicable !== false && o.score != null && Number.isFinite(Number(o.score));
  return {
    model,
    applicable,
    score: applicable ? Number(o.score) : null,
    rag: applicable && o.rag ? String(o.rag).toLowerCase() : null,
    label: META[model].label,
    window: META[model].window,
  };
}

/**
 * @param {{model:string, programme?:object, operational?:object}} a
 *        programme   = computeSiteScore(...) result
 *        operational = a buildSiteScoreboard row
 * @returns {null|{model, applicable, score, rag, label, window, other}}
 */
function publishedVerdict({ model, programme, operational } = {}) {
  const m = normalizeModel(model);
  if (m === 'legacy') return null;
  const prog = _side('programme', programme);
  const op = _side('operational', operational);
  return m === 'programme' ? { ...prog, other: op } : { ...op, other: prog };
}

module.exports = { MODELS, normalizeModel, publishedVerdict };
