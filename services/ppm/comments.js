'use strict';
// PPM parity W4 (enterprise) — comments with @mentions on projects and tasks (PURE: no I/O, no clock).
//
// A comment is append-only (ppm_comments, migration 108). A mention is "@<username>" (letters, digits, . _ -). The
// route resolves each mention against the ACTIVE accounts whose username matches exactly (case-insensitive) AND who
// may read the project (the same A-15 / sensitive / project-role read rule the project page uses). A mention of
// anyone else — unknown, inactive or outside the perimeter — reaches nobody and is reported back to the author as
// "unresolved" WITHOUT saying which case it was (the existence of an out-of-perimeter account never leaks).
// Notifications are in-app only (engagement notifications table), never to the author, and nothing at all while
// notifications_stop = '1' (decided by the route).

const MAX_BODY = 4000;
const MAX_MENTIONS = 20;
const MENTION_RE = /(^|[^A-Za-z0-9._@-])@([A-Za-z0-9][A-Za-z0-9._-]{0,63})/g;

const bad = (reason, error) => Object.assign(new Error(error), { code: 'INVALID', reason, status: 400 });

/** Trimmed body, 1..MAX_BODY characters. */
function normaliseBody(v) {
  const s = String(v == null ? '' : v).replace(/\r\n/g, '\n').trim();
  if (!s) throw bad('BODY_REQUIRED', 'a comment cannot be empty');
  if (s.length > MAX_BODY) throw bad('BODY_TOO_LONG', `a comment is at most ${MAX_BODY} characters`);
  return s;
}

/** The distinct mention tokens of a body (lower-cased, trailing dots trimmed), at most MAX_MENTIONS. */
function parseMentions(body) {
  const out = [];
  const s = String(body == null ? '' : body);
  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(s))) {
    const t = m[2].replace(/[.]+$/, '').toLowerCase();
    if (t && !out.includes(t)) out.push(t);
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
}

const _active = (u) => u && u.active !== 0 && u.active !== false;

/**
 * Split tokens into the readable accounts they name and the rest.
 * @param {string[]} tokens
 * @param {object[]} users     [{id, username, full_name, active}]
 * @param {Set<number>|number[]} readerIds  ids of the users who may read the project (computed by the route)
 * @returns {{ mentioned: Array<{id:number,label:string}>, unresolved: string[] }}
 */
function resolveMentions(tokens, users, readerIds) {
  const readers = readerIds instanceof Set ? readerIds : new Set((readerIds || []).map(Number));
  const mentioned = [], unresolved = [];
  for (const t of tokens || []) {
    const u = (users || []).find((x) => _active(x) && String(x.username || '').toLowerCase() === t);
    if (u && readers.has(Number(u.id))) { if (!mentioned.some((x) => x.id === Number(u.id))) mentioned.push({ id: Number(u.id), label: u.full_name || u.username }); }
    else unresolved.push(t);
  }
  return { mentioned, unresolved };
}

/** In-app notices for the mentioned users (never the author). */
function noticesFor(comment, mentioned, o = {}) {
  const actor = o.actorId == null ? null : Number(o.actorId);
  const where = comment.task_id ? `task #${comment.task_id} of project ${o.projectKey || '#' + comment.project_id}` : `project ${o.projectKey || '#' + comment.project_id}`;
  const link = `project.html?id=${encodeURIComponent(comment.project_id)}#comments`;
  return (mentioned || []).filter((m) => Number(m.id) !== actor).map((m) => ({
    userId: Number(m.id), kind: 'ppm_mention', title: `${o.authorName || 'Someone'} mentioned you on ${where}`.slice(0, 300),
    body: String(comment.body || '').slice(0, 500), link, sourceKind: 'ppm_comment', sourceRef: String(comment.id),
  }));
}

module.exports = { MAX_BODY, MAX_MENTIONS, normaliseBody, parseMentions, resolveMentions, noticesFor };
