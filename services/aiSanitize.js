'use strict';
// G20 — what the interactive AI proxy (/api/ai/analyze, deck builder) may forward to a model. Pure, no I/O.
//   redactPii(text, { names })  — e-mail, phone, IP, DOMAIN\user, URL query tokens, secrets, and any name in
//                                 `names` (e.g. the user directory) become placeholders before the text leaves.
//   neutraliseInjection(text)   — instructions planted in ticket text (EN + FR) are replaced; fake role markers
//                                 and our own data delimiters are defused.
//   sanitiseForPrompt(text, o)  — both, then a hard length cap.
//   sanitiseMessages(msgs, o)   — the same on every text block of an Anthropic-shaped message list.
// The model is never trusted with a figure: deterministic numbers are computed before the call (aiCommentary.js).
const { redactMessage } = require('./safeUrl');
const net = require('net');

const MAX_FIELD = 12000;

// Detection works LINE BY LINE on a whitespace-normalised, lower-cased copy, with regexes that have no nested
// quantifier (no catastrophic backtracking — the input is capped before any regex runs). A line that carries a
// planted instruction is replaced as a whole: losing a sentence of ticket text is better than obeying it.
const INJECTION = [
  /\bignore[sz]? (?:all |any |the |every |toutes |les |tous )*(?:instruction |instructions |consigne |consignes |r[èe]gles )?(?:previous|prior|above|earlier|preceding|pr[ée]c[ée]dentes|ci-dessus|ant[ée]rieures)\b/,
  /\b(?:disregard|override|bypass) (?:all |any |the |your )*(?:previous |prior |above )?(?:instructions?|rules?|prompts?|guidelines)\b/,
  /\bforget (?:all |everything |what )*(?:you (?:were|have been) told|previous instructions?|your instructions?)\b/,
  /\bdo not (?:follow|obey|apply) (?:the |any |all |your )*(?:earlier|previous|prior|above|preceding|original)\b/,
  /\byou are now\b/, /\bfrom now on,? you\b/, /\bnew instructions? ?:/, /\b(?:reveal|print|show|repeat) (?:your|the) (?:system )?prompt\b/,
  /\boublie[sz]? (?:toutes |tous |les |tes |vos )*(?:instructions?|consignes?|r[èe]gles)\b/,
  /\b(?:tu es|vous [êe]tes) (?:d[ée]sormais|maintenant)\b/, /\bnouvelles? (?:instructions?|consignes?) ?:/,
];
const ROLE_MARKER = /^#{0,6} ?(system|assistant|developer|user|human) ?:/i;
// our data delimiters, with spaces, and the chat-template tokens of common models (<|im_start|>, [INST], <<SYS>>)
const DELIM = /<\s{0,3}\/?\s{0,3}(?:data|system|instructions?)\s{0,3}>|<\|[^|<>]{0,24}\|>|\[\/?INST\]|<<\/?SYS>>/gi;
// text a reader would see the same once compatibility forms are folded (full-width letters) and invisible
// characters (zero-width, soft hyphen, bidi controls) are removed — so 'ign\u200bore' still reads 'ignore'
const INVISIBLE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;
const normalise = (t) => t.normalize('NFKC').replace(INVISIBLE, '');

function neutraliseInjection(text) {
  if (typeof text !== 'string') return text;
  const lines = normalise(text).split('\n');
  const norm = lines.map((l) => l.replace(/\s+/g, ' ').trim().toLowerCase());
  const hit = (t) => INJECTION.some((re) => re.test(t));
  // an instruction split over two lines is caught on the pair; both lines go
  const drop = new Set();
  norm.forEach((n, i) => { if (hit(n)) drop.add(i); else if (i + 1 < norm.length && !hit(norm[i + 1]) && hit(`${n} ${norm[i + 1]}`)) { drop.add(i); drop.add(i + 1); } });
  return lines.map((line, i) => {
    if (drop.has(i)) return '[TEXT REDACTED]';
    const t = line.trimStart();
    const m = ROLE_MARKER.exec(t.replace(/\s+/g, ' '));
    const out = m ? line.replace(m[1], `${m[1]}(quoted)`) : line;
    return out.replace(DELIM, '[tag removed]');
  }).join('\n');
}

// accent- and case-insensitive pattern for a name, any run of spaces between its words
const FOLD = { a: 'aàáâäãå', c: 'cç', e: 'eèéêë', i: 'iìíîï', n: 'nñ', o: 'oòóôöõ', u: 'uùúûü', y: 'yýÿ' };
const fold = (t) => String(t).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function namePattern(n) {
  return fold(n).trim().split(/\s+/).map((w) => [...w].map((ch) => (FOLD[ch] ? `[${FOLD[ch]}${FOLD[ch].toUpperCase()}]` : esc(ch))).join('')).join('\\s+');
}
/** Names to hide: every full name, each surname of 5+ letters alone, and person-like usernames (with . or _). */
function nameVariants(list) {
  const out = new Set();
  for (const raw of list || []) {
    const n = String(raw || '').trim(); if (n.length < 4) continue;
    if (/\s/.test(n)) { out.add(n); const parts = n.split(/\s+/); out.add(parts.slice().reverse().join(' ')); const last = parts[parts.length - 1]; if (last.length >= 5) out.add(last); }
    else if (/[._]/.test(n)) out.add(n);
    else if (/^[A-Za-zÀ-ÿ'-]{5,}$/.test(n) && /[A-Z]/.test(n[0])) out.add(n);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function redactPii(text, { names = [] } = {}) {
  if (typeof text !== 'string') return text;
  let out = redactMessage(text, []);                                        // URL tokens, key=value secrets, Bearer
  out = out.replace(/&#0*64;|%40|\s?[[(]at[\])]\s?/gi, '@');                // obfuscated "@"
  out = out.replace(/[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}.-]{1,253}\.\p{L}{2,24}/gu, '[email]');
  out = out.replace(/\b[A-Z][A-Z0-9-]{1,15}\\[A-Za-z0-9._-]{2,64}\b/g, '[account]');
  out = out.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]');
  // phone: + or 00 prefix, or 8+ digits with separators — not ISO dates, not ticket/display ids of < 8 digits
  out = out.replace(/(?:\+|00)\d[\d ().-]{6,20}\d/g, '[phone]').replace(/\b\d{2,3}(?:[ .-]\d\d){3,5}\b/g, '[phone]').replace(/\b\d{8,10}\b/g, '[phone]');
  out = out.replace(/[0-9A-Fa-f:.]{3,45}/g, (m) => (m.includes(':') && net.isIP(m) === 6 ? '[ip]' : m));
  for (const n of nameVariants(names)) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${namePattern(n)}(?![\\p{L}\\p{N}])`, 'giu'), '[person]');
  return out;
}

function sanitiseForPrompt(text, o = {}) {
  if (typeof text !== 'string') return text;
  const cap = o.max || MAX_FIELD;
  // cap BEFORE the regexes run (bounded cost), and again after (placeholders can lengthen the text)
  return redactPii(neutraliseInjection(normalise(text.substring(0, cap))), o).substring(0, cap);
}

function sanitiseMessages(messages, o = {}) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((msg) => {
    if (!msg || typeof msg !== 'object') return msg;
    // only user / assistant turns come from the browser: a client-sent "system" turn becomes a user turn
    msg = { ...msg, role: msg.role === 'assistant' ? 'assistant' : 'user' };
    if (typeof msg.content === 'string') return { ...msg, content: sanitiseForPrompt(msg.content, o) };
    if (Array.isArray(msg.content)) return { ...msg, content: msg.content.filter((b) => b && b.type === 'text').map((b) => ({ ...b, text: sanitiseForPrompt(b.text, o) })) };
    return { role: msg.role, content: '' };
  });
}

module.exports = { nameVariants, redactPii, neutraliseInjection, sanitiseForPrompt, sanitiseMessages, MAX_FIELD };
