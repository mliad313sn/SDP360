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

const MAX_FIELD = 12000;

// Detection works LINE BY LINE on a whitespace-normalised, lower-cased copy, with regexes that have no nested
// quantifier (no catastrophic backtracking — the input is capped before any regex runs). A line that carries a
// planted instruction is replaced as a whole: losing a sentence of ticket text is better than obeying it.
const INJECTION = [
  /\bignore[sz]? (?:all |any |the |every |toutes |les |tous )*(?:instruction |instructions |consigne |consignes |r[èe]gles )?(?:previous|prior|above|earlier|preceding|pr[ée]c[ée]dentes|ci-dessus|ant[ée]rieures)\b/,
  /\b(?:disregard|override|bypass) (?:all |any |the |your )*(?:previous |prior |above )?(?:instructions?|rules?|prompts?|guidelines)\b/,
  /\bforget (?:all |everything |what )*(?:you (?:were|have been) told|previous instructions?|your instructions?)\b/,
  /\byou are now\b/, /\bfrom now on,? you\b/, /\bnew instructions? ?:/, /\b(?:reveal|print|show|repeat) (?:your|the) (?:system )?prompt\b/,
  /\boublie[sz]? (?:toutes |tous |les |tes |vos )*(?:instructions?|consignes?|r[èe]gles)\b/,
  /\b(?:tu es|vous [êe]tes) (?:d[ée]sormais|maintenant)\b/, /\bnouvelles? (?:instructions?|consignes?) ?:/,
];
const ROLE_MARKER = /^#{0,6} ?(system|assistant|developer|user|human) ?:/i;
const DELIM = /<\/?(?:data|system|instructions?)>/gi;

function neutraliseInjection(text) {
  if (typeof text !== 'string') return text;
  return text.split('\n').map((line) => {
    const norm = line.replace(/\s+/g, ' ').trim().toLowerCase();
    if (INJECTION.some((re) => re.test(norm))) return '[TEXT REDACTED]';
    const t = line.trimStart();
    const m = ROLE_MARKER.exec(t.replace(/\s+/g, ' '));
    const out = m ? line.replace(m[1], `${m[1]}(quoted)`) : line;
    return out.replace(DELIM, '[tag removed]');
  }).join('\n');
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function redactPii(text, { names = [] } = {}) {
  if (typeof text !== 'string') return text;
  let out = redactMessage(text, []);                                        // URL tokens, key=value secrets, Bearer
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');
  out = out.replace(/\b[A-Z][A-Z0-9-]{1,15}\\[A-Za-z0-9._-]{2,64}\b/g, '[account]');
  out = out.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]');
  // phone: + or 00 prefix, or 8+ digits with separators — not ISO dates, not ticket/display ids of < 8 digits
  out = out.replace(/(?:\+|00)\d[\d ().-]{6,20}\d/g, '[phone]').replace(/\b\d\d[ .-]\d\d[ .-]\d\d[ .-]\d\d(?:[ .-]\d\d)?(?:[ .-]\d\d)?\b/g, '[phone]');
  const list = [...new Set((names || []).map((n) => String(n || '').trim()).filter((n) => n.length >= 4))].sort((a, b) => b.length - a.length);
  for (const n of list) out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${esc(n)}(?![\\p{L}\\p{N}])`, 'giu'), '[person]');
  return out;
}

function sanitiseForPrompt(text, o = {}) {
  if (typeof text !== 'string') return text;
  const cap = o.max || MAX_FIELD;
  // cap BEFORE the regexes run (bounded cost), and again after (placeholders can lengthen the text)
  return redactPii(neutraliseInjection(text.substring(0, cap)), o).substring(0, cap);
}

function sanitiseMessages(messages, o = {}) {
  if (!Array.isArray(messages)) return messages;
  return messages.map((msg) => {
    if (!msg || typeof msg !== 'object') return msg;
    if (typeof msg.content === 'string') return { ...msg, content: sanitiseForPrompt(msg.content, o) };
    if (Array.isArray(msg.content)) return { ...msg, content: msg.content.filter((b) => b && b.type === 'text').map((b) => ({ ...b, text: sanitiseForPrompt(b.text, o) })) };
    return { role: msg.role, content: '' };
  });
}

module.exports = { redactPii, neutraliseInjection, sanitiseForPrompt, sanitiseMessages, MAX_FIELD };
