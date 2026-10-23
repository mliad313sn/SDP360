'use strict';
// Step 9 — the AI layer of a report: it drafts the commentary from the FACTS only (services/reportgen/analysis.js).
// Three guards, in order:
//  1. the provider is the server's switch (services/aiProxy.js — off by default, local model, or cloud when chosen);
//  2. the prompt carries the canonical figures as JSON and forbids any other number (anti-hallucination clause);
//  3. every number in the answer is checked against the facts: one unknown number and the draft is REJECTED — the
//     deterministic commentary is kept. A person still reviews and approves every report before it is released.

const TONE = {
  direction: { fr: 'Ton : synthèse pour la direction, trois à cinq phrases, d’abord ce qui est hors objectif et ce qui demande une décision.', en: 'Tone: a summary for the leadership, three to five sentences, what is off target and what needs a decision first.' },
  coordinateur: { fr: 'Ton : pour un coordinateur de site, concret, orienté actions, cinq à huit phrases.', en: 'Tone: for a site coordinator, concrete, action-oriented, five to eight sentences.' },
  technicien: { fr: 'Ton : pour l’équipe technique, précis, chaque écart expliqué par les chiffres donnés.', en: 'Tone: for the technical team, precise, every gap explained with the figures given.' },
};

function buildRequest(facts, { lang = 'fr', tone = 'direction', month, scope } = {}) {
  const en = lang === 'en';
  const system = (en
    ? 'You write the commentary of an IT operations report. Use ONLY the figures in the JSON the user gives. Never write a number that is not in it (no percentage, count, date or rank you computed yourself). If a figure is null, say it is not measured. No markup, plain sentences.'
    : 'Tu rédiges le commentaire d’un rapport d’exploitation informatique. N’utilise QUE les chiffres du JSON fourni. N’écris jamais un nombre qui n’y figure pas (aucun pourcentage, total, date ou rang que tu aurais calculé). Si une valeur vaut null, dis qu’elle n’est pas mesurée. Pas de mise en forme, des phrases simples.')
    + ' ' + (TONE[tone] || TONE.direction)[en ? 'en' : 'fr'];
  const payload = { month, scope, facts: facts.map(f => ({ label: f.label, value: f.value, previous: f.prev, change: f.delta, unit: f.unit, status: f.rag || undefined, lowest_site: f.lowest || undefined, council: f.council, cab: f.cab, over_30_days: f.over30 })) };
  return { max_tokens: 700, system, messages: [{ role: 'user', content: JSON.stringify(payload) }] };
}

/** Numbers allowed in a commentary: every fact value, previous value and change (with sign and absolute), rounded. */
function allowedNumbers(facts, { month } = {}) {
  const s = new Set();
  const add = (v) => { if (v == null || !Number.isFinite(Number(v))) return; const n = Number(v); for (const x of [n, Math.abs(n)]) { s.add(String(Math.round(x))); s.add(String(Math.round(x * 10) / 10)); } };
  for (const f of facts) { add(f.value); add(f.prev); add(f.delta); add(f.council); add(f.cab); add(f.over30); if (f.lowest) add(f.lowest.value); if (f.points) add(f.points); }
  if (month) { const [y, m] = month.split('-'); s.add(String(Number(y))); s.add(String(Number(m))); }
  return s;
}
function numbersIn(text) {
  // One flat character class (no nested quantifier), then the trailing punctuation of a sentence is dropped.
  return (String(text).match(/-?\d[\d.,]*/g) || []).map(t => t.replace(/[.,]+$/, '')).filter(t => { const parts = t.replace(/^-/, '').split(/[.,]/); return parts.length <= 2 && parts.every(x => /^\d+$/.test(x)); })
    .map(t => { const n = Number(t.replace(',', '.')); return String(Math.round(n * 10) / 10); });
}
function check(text, facts, ctx) {
  const ok = allowedNumbers(facts, ctx);
  const unknown = [...new Set(numbersIn(text).filter(n => !ok.has(n) && !ok.has(String(Math.round(Number(n))))))];
  return { accepted: unknown.length === 0, unknown };
}

/** Draft with the model; returns { text, accepted, unknown, provider } or { skipped }. Never throws. */
async function draft(facts, ctx, ai) {
  if (!ai || ai.disabled) return { skipped: 'AI is switched off on this server (AI_PROVIDER=off): the deterministic commentary is used.' };
  try {
    const text = String(await ai.call(buildRequest(facts, ctx)) || '').trim().slice(0, 4000);
    if (!text) return { skipped: 'the model returned nothing' };
    return { text, provider: ai.provider, ...check(text, facts, ctx) };
  } catch (e) { return { skipped: 'the model did not answer (' + String(e.message || e).slice(0, 120) + ')' }; }
}

module.exports = { buildRequest, allowedNumbers, numbersIn, check, draft };
