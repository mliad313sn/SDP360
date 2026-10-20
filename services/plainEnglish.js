'use strict';
// House style for EVERY AI-generated comment the platform emits (report studio commentary,
// deck-builder analysis, Exec View incident summaries): plain language for a CIO / CFO reader,
// in ENGLISH or FRENCH — the language is chosen per report (template default, overridable at
// generation); the register is always executive. Sponsor rules of 2026-10-20.
// This module is pure: a style block per language to put in every prompt, a checker that scores a
// reply in the requested language, and jargon maps used by both. (File name kept for history; the
// module is bilingual.)

/** ITSM / IT jargon → the plain phrase a CFO reads without a glossary, per language. Whole words, case-insensitive. */
const JARGON = {
  en: {
    'SLA': 'service target', 'SLAs': 'service targets', 'FRT': 'first reply time', 'MTTR': 'time to fix',
    'RCA': 'root cause', 'PIR': 'post-incident review', 'KPI': 'indicator', 'KPIs': 'indicators',
    'ITSM': 'IT service management', 'CMDB': 'asset register', 'CAB': 'change board', 'RFC': 'change request',
    'uplink': 'internet link', 'latency': 'delay', 'jitter': 'connection instability', 'backlog': 'open requests',
    'P1': 'top-priority', 'P2': 'high-priority', 'UDF': 'custom field', 'RAG': 'colour status',
    'WAN': 'site internet link', 'LAN': 'office network', 'WLAN': 'wifi', 'SSO': 'single sign-on',
    'MFA': 'two-step sign-in', 'PPTX': 'slide deck', 'OData': 'data feed', 'API': 'data connection',
    'MI': 'major incident', 'MIs': 'major incidents', 'FCR': 'fixed on first contact', 'CSAT': 'user satisfaction',
  },
  fr: {
    'SLA': 'objectif de service', 'SLAs': 'objectifs de service', 'FRT': 'délai de première réponse', 'MTTR': 'délai de réparation',
    'RCA': 'cause racine', 'PIR': 'revue après incident', 'KPI': 'indicateur', 'KPIs': 'indicateurs',
    'ITSM': 'gestion des services informatiques', 'CMDB': 'registre des équipements', 'CAB': 'comité des changements', 'RFC': 'demande de changement',
    'uplink': 'liaison internet', 'latency': 'délai', 'latence': 'délai de réponse', 'jitter': 'instabilité de la connexion', 'backlog': 'demandes en attente',
    'P1': 'priorité maximale', 'P2': 'priorité haute', 'UDF': 'champ personnalisé', 'RAG': 'statut couleur',
    'WAN': 'liaison internet du site', 'LAN': 'réseau du bureau', 'WLAN': 'wifi', 'SSO': 'connexion unique',
    'MFA': 'connexion en deux étapes', 'PPTX': 'présentation', 'OData': 'flux de données', 'API': 'connexion de données',
    'MI': 'incident majeur', 'MIs': 'incidents majeurs', 'FCR': 'résolu au premier contact', 'CSAT': 'satisfaction des utilisateurs',
  },
};

/** Marker words of the OTHER language that must not appear (accents stripped before testing). */
const FOREIGN_MARKERS = {
  en: ['le', 'la', 'les', 'des', 'une', 'est', 'pour', 'sans', 'avec', 'mesure', 'non mesure', 'semaine', 'mois', 'chez', 'sont', 'nous'],
  fr: ['the', 'and', 'with', 'is', 'are', 'was', 'were', 'this', 'month', 'week', 'not measured', 'target', 'site is'],
};

const LIMITS = { maxSentences: 5, maxWordsPerSentence: 22, maxWords: 110 };

/** The block appended to every AI prompt (system message), per language. */
const STYLE_PROMPT = {
  en: 'STYLE (mandatory): write for a CIO or CFO with no IT background. Plain English only, never French. ' +
    `At most ${LIMITS.maxSentences} short sentences, each under ${LIMITS.maxWordsPerSentence} words, about ${LIMITS.maxWords} words in total. ` +
    'Lead with the business outcome (service to users, money, risk), then the one thing to decide or watch. ' +
    'No acronyms and no IT jargon: say "service target" not SLA, "time to fix" not MTTR, "root cause" not RCA, ' +
    '"internet link" not WAN/uplink, "open requests" not backlog, "indicator" not KPI. ' +
    'No bullet points, no headings, no tables, no JSON, no links, no exclamation marks, no hedging filler.',
  fr: 'STYLE (obligatoire) : écris pour un directeur général ou financier sans culture informatique. Français simple uniquement, jamais d\'anglais. ' +
    `Au plus ${LIMITS.maxSentences} phrases courtes, chacune de moins de ${LIMITS.maxWordsPerSentence} mots, environ ${LIMITS.maxWords} mots au total. ` +
    'Commence par le résultat pour l\'entreprise (service aux utilisateurs, argent, risque), puis la seule chose à décider ou à surveiller. ' +
    'Aucun sigle ni jargon informatique : dis « objectif de service » et non SLA, « délai de réparation » et non MTTR, « cause racine » et non RCA, ' +
    '« liaison internet » et non WAN, « demandes en attente » et non backlog, « indicateur » et non KPI. ' +
    'Pas de puces, pas de titres, pas de tableaux, pas de JSON, pas de liens, pas de points d\'exclamation, pas de remplissage.',
};

function _norm(lang) { return lang === 'fr' ? 'fr' : 'en'; }
function _stripAccents(s) { return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function _esc(t) { return t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

function _sentences(text) {
  return String(text || '').replace(/\s+/g, ' ').trim().split(/(?<=[.!?])\s+(?=[A-Z0-9"“«(])/).map(s => s.trim()).filter(Boolean);
}

/** Jargon terms found as whole words, for the given language. */
function findJargon(text, lang = 'en') {
  const map = JARGON[_norm(lang)]; const found = [];
  for (const term of Object.keys(map)) {
    const re = new RegExp(`(^|[^A-Za-z0-9À-ÿ])${_esc(term)}(?=$|[^A-Za-z0-9À-ÿ])`, 'i');
    if (re.test(String(text || ''))) found.push(term);
  }
  return found;
}

/** True when the text reads as the OTHER language (two or more foreign marker words as whole words). */
function looksForeign(text, lang = 'en') {
  const L = _norm(lang);
  const t = ' ' + _stripAccents(text).toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  let hits = 0;
  for (const m of FOREIGN_MARKERS[L]) if (t.includes(' ' + m + ' ')) hits++;
  if (L === 'en' && /[àâçéèêëîïôûùüÿœ]/i.test(String(text || ''))) return true;
  return hits >= 2;
}
/** Back-compat alias (English target). */
function looksFrench(text) { return looksForeign(text, 'en'); }

/**
 * Score a reply against the house style in the requested language. Returns { ok, issues: string[], stats }.
 * Issues are written so they can be fed straight back to the model as a correction request.
 */
function check(text, opts = {}) {
  const lang = _norm(opts.lang); const limits = { ...LIMITS, ...(opts.limits || opts) };
  const issues = [];
  const s = String(text || '').trim();
  if (!s) return { ok: false, issues: ['empty text'], stats: { sentences: 0, words: 0 } };
  const sentences = _sentences(s);
  const words = s.split(/\s+/).filter(Boolean).length;
  if (looksForeign(s, lang)) issues.push(lang === 'fr' ? 'text is not plain French (English words found)' : 'text is not plain English (French words or accents found)');
  if (sentences.length > limits.maxSentences) issues.push(`${sentences.length} sentences, maximum ${limits.maxSentences}`);
  if (words > limits.maxWords) issues.push(`${words} words, maximum ${limits.maxWords}`);
  const long = sentences.filter(x => x.split(/\s+/).length > limits.maxWordsPerSentence);
  if (long.length) issues.push(`${long.length} sentence(s) longer than ${limits.maxWordsPerSentence} words`);
  const jargon = findJargon(s, lang);
  if (jargon.length) issues.push(`jargon to replace: ${jargon.map(j => `${j} → ${JARGON[lang][j]}`).join('; ')}`);
  if (/^\s*[-*•]|\n\s*[-*•]/.test(s)) issues.push('bullet points are not allowed');
  if (/^#|\n#/.test(s) || /[{}[\]]/.test(s)) issues.push('headings, JSON or brackets are not allowed');
  if (/https?:\/\//i.test(s)) issues.push('links are not allowed');
  if (/!/.test(s)) issues.push('exclamation marks are not allowed');
  return { ok: issues.length === 0, issues, stats: { sentences: sentences.length, words } };
}

/** Last-resort rewrite: replace jargon with the plain phrase so a deterministic fallback also reads plainly. */
function dejargon(text, lang = 'en') {
  let s = String(text || ''); const map = JARGON[_norm(lang)];
  for (const [term, plain] of Object.entries(map)) {
    s = s.replace(new RegExp(`(^|[^A-Za-z0-9À-ÿ])${_esc(term)}(?=$|[^A-Za-z0-9À-ÿ])`, 'g'), `$1${plain}`);
  }
  return s;
}

function stylePrompt(lang = 'en') { return STYLE_PROMPT[_norm(lang)]; }

module.exports = { STYLE_PROMPT, JARGON, LIMITS, FOREIGN_MARKERS, check, findJargon, looksForeign, looksFrench, dejargon, stylePrompt };
