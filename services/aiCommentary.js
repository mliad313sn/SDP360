'use strict';
// Step 9 — AI commentary fed ONLY by canonical figures. The prompt carries the deterministic
// analysis (services/reportAnalysis) and the figure list; the reply is checked number by number
// against that list (anti-hallucination clause: any number not in the list → the commentary is
// rejected and the deterministic text is used). Cloud providers receive an ANONYMISED payload
// (site names → S1..Sn, people names never sent); the local provider (Ollama) receives the real
// names. The call itself is injected (aiCall) so the module is testable without a model.

const { canonicalNumbers } = require('./reportAnalysis');

const LENGTH = { executive: { en: '3 to 5 short sentences, business outcome first, no ITSM jargon', fr: '3 à 5 phrases courtes, résultat métier d\'abord, sans jargon ITSM' },
  council: { en: '4 to 6 sentences: decisions needed, risks, trend', fr: '4 à 6 phrases : décisions attendues, risques, tendance' },
  site: { en: '4 to 7 sentences naming the metrics and the actions to take this week', fr: '4 à 7 phrases nommant les indicateurs et les actions de la semaine' } };

/** Replace site names with stable codes; drop owner/people fields. Returns { analysis, map }. */
function anonymise(analysis) {
  const map = new Map(); let i = 0; const code = (name) => { if (!name) return name; if (!map.has(name)) map.set(name, `S${++i}`); return map.get(name); };
  const a = JSON.parse(JSON.stringify(analysis));
  if (a.site) a.site = code(a.site);
  for (const f of a.findings || []) { if (f.sites) f.sites = f.sites.map(code); if (f.best) f.best = code(f.best); if (f.worst) f.worst = code(f.worst); }
  for (const f of a.figures || []) { for (const r of f.rows || []) r.site = code(r.site); delete f.owner; }
  a.bullets = (a.bullets || []).map(b => { let s = b; for (const [n, c] of map) s = s.split(n).join(c); return s; });
  a.headline = (() => { let s = a.headline || ''; for (const [n, c] of map) s = s.split(n).join(c); return s; })();
  return { analysis: a, map };
}
function deanonymise(text, map) { let s = String(text || ''); for (const [n, c] of map) s = s.replace(new RegExp(`\\b${c}\\b`, 'g'), n); return s; }

function buildPrompt(analysis, { audience = 'site', lang = 'en' } = {}) {
  const L = (LENGTH[audience] || LENGTH.site)[lang === 'fr' ? 'fr' : 'en'];
  const canon = [...canonicalNumbers(analysis.figures)].sort((a, b) => Number(a) - Number(b));
  const figures = (analysis.figures || []).map(f => f.series ? `${f.title} (${f.metric}): series ${f.series.map(p => `${p.label}=${p.value == null ? 'null' : p.value}`).join(', ')} ${f.unit || ''}` : f.rows ? `${f.title} (${f.metric}): ${f.rows.map(r => `${r.site}=${r.value == null ? 'null' : r.value}${r.rag ? '/' + r.rag : ''}`).join(', ')} ${f.unit || ''}` : `${f.title} (${f.metric || f.id}): ${f.value == null && f.open == null ? 'null (not measured)' : f.value != null ? `${f.value} ${f.unit || ''}` : `open=${f.open} overdue=${f.overdue}`}${f.rag ? ' rag=' + f.rag : ''}${f.window ? ' window=' + f.window : ''}${f.fleet != null ? ' fleet_mean=' + f.fleet : ''}`).join('\n');
  const system = lang === 'fr'
    ? `Tu es l'analyste IT du groupe. Tu rédiges un commentaire en français, ton ${analysis.tone}, ${L}. RÈGLE ABSOLUE : tu ne cites QUE des nombres présents dans la liste CANONIQUE ci-dessous, copiés tels quels ; si une phrase a besoin d'un autre nombre, reformule sans nombre. Un indicateur "null" est non mesuré : écris "non mesuré", jamais 0. Pas de titre, pas de liste à puces, pas de JSON.`
    : `You are the group IT analyst. Write a commentary in English, ${analysis.tone} tone, ${L}. ABSOLUTE RULE: quote ONLY numbers present in the CANONICAL list below, copied verbatim; if a sentence needs another number, rephrase without it. A "null" indicator is not measured: write "not measured", never 0. No title, no bullet list, no JSON.`;
  const user = `${lang === 'fr' ? 'Périmètre' : 'Scope'}: ${analysis.site || (lang === 'fr' ? 'flotte' : 'fleet')} · ${lang === 'fr' ? 'fenêtre' : 'window'}: ${analysis.window || 'current'}\n\n${lang === 'fr' ? 'ANALYSE DÉTERMINISTE' : 'DETERMINISTIC ANALYSIS'}:\n${analysis.headline}\n${(analysis.bullets || []).map(b => '- ' + b).join('\n')}\n\n${lang === 'fr' ? 'CHIFFRES' : 'FIGURES'}:\n${figures}\n\n${lang === 'fr' ? 'LISTE CANONIQUE (seuls nombres autorisés)' : 'CANONICAL LIST (the only numbers allowed)'}: ${canon.join(', ') || '(none)'}`;
  return { system, user, canonical: canon };
}

/** Every number in the text must be in the canonical set (years and ordinals like 13w are tolerated). Returns {ok, offending:[]}. */
function verifyNumbers(text, canonicalSet, { allow = [] } = {}) {
  const allowSet = new Set([...allow].map(String));
  const nums = String(text || '').replace(/\b(19|20)\d{2}\b/g, ' ').replace(/\b\d+\s?(w|sem|j|d|h|min)\b/gi, ' ').replace(/\bS\d{1,2}\b/g, ' ').match(/-?\d+(?:[.,]\d+)?/g) || [];
  const offending = [];
  for (const raw of nums) { const n = raw.replace(',', '.'); const v = Number(n); if (!Number.isFinite(v)) continue; const forms = [String(v), v.toFixed(1), String(Math.round(v))]; if (!forms.some(f => canonicalSet.has(f) || allowSet.has(f))) offending.push(raw); }
  return { ok: offending.length === 0, offending };
}

/**
 * Produce the commentary. aiCall({system,user}) → text. provider 'off' → deterministic only.
 * @returns {{text, source:'ai'|'deterministic', provider, verified, offending, anonymised, error}}
 */
async function generateCommentary({ analysis, audience = 'site', lang = 'en', provider = 'off', aiCall = null, now = new Date() }) {
  const fallback = [analysis.headline, ...(analysis.bullets || [])].join(' ');
  const base = { text: fallback, source: 'deterministic', provider, verified: true, offending: [], anonymised: false, generated_at: now.toISOString() };
  if (!aiCall || provider === 'off') return base;
  const cloud = provider !== 'local';
  const { analysis: a, map } = cloud ? anonymise(analysis) : { analysis, map: new Map() };
  const prompt = buildPrompt(a, { audience, lang });
  try {
    let text = String(await aiCall({ system: prompt.system, user: prompt.user, maxTokens: 700 }) || '').trim();
    const check = verifyNumbers(text, new Set(prompt.canonical), { allow: [(analysis.coverage || {}).measured, (analysis.coverage || {}).total].filter(x => x != null) });
    if (!check.ok || !text) return { ...base, verified: false, offending: check.offending, error: text ? 'commentary quoted numbers outside the canonical list' : 'empty reply', anonymised: cloud };
    if (cloud) text = deanonymise(text, map);
    return { text, source: 'ai', provider, verified: true, offending: [], anonymised: cloud, generated_at: now.toISOString() };
  } catch (e) { return { ...base, error: String(e.message || e).slice(0, 300), anonymised: cloud }; }
}

module.exports = { buildPrompt, verifyNumbers, anonymise, deanonymise, generateCommentary, LENGTH };
