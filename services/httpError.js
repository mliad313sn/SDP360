'use strict';
// M9 — one door for every error a route hands back to a client.
//
// WHY: `res.status(500).json({ error: e.message })` echoed SQL text, file paths, upstream
// hosts and stack fragments to the browser (~250 call sites). A 5xx now answers
// `{ error: 'internal_error', correlation_id }` and the full message + first stack line go to
// the server log under that id — support quotes the id, the operator greps it.
//
// `e.message` reaches the client ONLY when the error is TYPED (a code from TYPED_CODES, or
// `expose === true` — what body-parser / http-errors set), or when the caller gives an
// explicit non-5xx status (the message is then user-facing validation text by contract).
const crypto = require('crypto');

const TYPED_CODES = Object.freeze(['FORBIDDEN', 'VALIDATION', 'NOT_FOUND', 'CONFLICT', 'UNSAFE_URL', 'INVALID', 'RATE_LIMITED']);
const CODE_STATUS = Object.freeze({
  FORBIDDEN: 403, VALIDATION: 400, NOT_FOUND: 404, CONFLICT: 409, UNSAFE_URL: 400, INVALID: 400, RATE_LIMITED: 429,
});
const _TYPED = new Set(TYPED_CODES);

/** Build an error whose message MAY be shown to the client. */
function typed(code, message, status) {
  const e = new Error(message == null ? String(code) : String(message));
  e.code = String(code);
  e.status = Number.isFinite(+status) ? +status : (CODE_STATUS[e.code] || 400);
  e.expose = true;
  return e;
}

function isTyped(e) {
  if (!e || typeof e !== 'object') return false;
  if (e.expose === true) return true;
  return typeof e.code === 'string' && _TYPED.has(e.code);
}

function _ownStatus(e) {
  const s = e && (e.status != null ? e.status : e.statusCode);
  const n = Number(s);
  return Number.isInteger(n) && n >= 400 && n <= 599 ? n : null;
}

function _resolveStatus(e, status) {
  const n = Number(status);
  if (Number.isInteger(n) && n >= 400 && n <= 599) return n;
  if (isTyped(e)) return _ownStatus(e) || CODE_STATUS[e && e.code] || 400;
  return 500;
}

function _firstStackLine(e) {
  const st = e && typeof e.stack === 'string' ? e.stack.split('\n') : [];
  const at = st.find(l => /^\s+at\s/.test(l));
  return at ? at.trim() : '';
}

/**
 * Log an error under a fresh correlation id (one line). Returns the id.
 * @param {Error|any} e
 * @param {import('http').IncomingMessage} [req]
 * @param {number} [status]
 */
function logError(e, req, status) {
  const id = crypto.randomUUID();
  const where = req && req.method ? `${req.method} ${req.originalUrl || req.url || ''}` : '-';
  const msg = e && e.message != null ? String(e.message) : String(e);
  const first = status == null || status >= 500 ? _firstStackLine(e) : '';
  try {
    console.error(`[http-error ${id}] ${where} ${status != null ? status : ''} ${msg}${first ? ` | ${first}` : ''}`.replace(/\s+$/, ''));
  } catch (_) { /* a dead log never breaks a response */ }
  return id;
}

/**
 * Answer an error. 5xx → generic body + correlation id (message in the log only).
 * Typed errors (or an explicit non-5xx `status`) pass their message through.
 * @param {import('express').Response} res
 * @param {Error|any} e
 * @param {number} [status]  explicit HTTP status; omitted → 500 (or the typed code's status)
 * @param {object} [extra]   fields merged into the body (e.g. `{ ok: false }`); may set a constant `error`
 */
function fail(res, e, status, extra) {
  const st = _resolveStatus(e, status);
  const id = logError(e, res && res.req, st);
  if (!res || res.headersSent) return id;
  const explicit = Number.isInteger(Number(status)) && Number(status) < 500;
  const expose = st < 500 && (explicit || isTyped(e));
  let body;
  if (expose) {
    body = { error: e && e.message != null ? String(e.message) : String(e) };
    if (e && typeof e.code === 'string' && _TYPED.has(e.code)) body.code = e.code;
    if (e && Array.isArray(e.errors)) body.errors = e.errors;
  } else {
    body = { error: 'internal_error', correlation_id: id };
  }
  if (extra && typeof extra === 'object') Object.assign(body, extra);
  res.status(st).json(body);
  return id;
}

/** Express final error handler — mount LAST. */
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  fail(res, err);
}

module.exports = { TYPED_CODES, CODE_STATUS, typed, isTyped, fail, logError, errorHandler };
