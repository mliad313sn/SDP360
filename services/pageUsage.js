'use strict';
// C-09 (F16 / F29 / G14 prep) — page usage facts for the keep / merge / deprecate decision on the
// executive surfaces and the menu footprint. Pure: no clock, no storage, no database.
//
//   normalizePage(raw, known)  → a page id the shell may report ('executive', 'dashboards:exec-home') or null
//   roleTier(user)             → the highest hierarchical role ('super_admin' … 'viewer'), else 'feature-only'
//   aggregate(rows)            → distinct users per page per tier from system_log `page_viewed` rows
//
// Privacy: the event carries the user id (actor_id) and the role tier ONLY — no name, no e-mail, no IP.
// The report counts distinct ids; it never lists them.

const TIERS = ['super_admin', 'executive', 'admin', 'editor', 'viewer'];
const PART_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/;

/** `known` = Set of page ids served from public/ (file names without .html). Unknown ids are refused. */
function normalizePage(raw, known) {
  const id = String(raw == null ? '' : raw).trim().toLowerCase().replace(/\.html?$/, '');
  const parts = id.split(':');
  if (parts.length > 2 || !parts.every((p) => PART_RE.test(p)) || id.length > 112) return null;
  const base = parts[0];
  if (parts.length === 2 && base !== 'dashboards') return null;   // only dashboards carry a key suffix
  if (known && !known.has(base)) return null;
  return id;
}

function roleTier(user) {
  const u = user || {};
  const roles = new Set([...(Array.isArray(u.roles) ? u.roles : []), u.role].filter(Boolean).map(String));
  for (const t of TIERS) if (roles.has(t)) return t;
  return 'feature-only';
}

function _tierOf(details) {
  if (!details) return 'unknown';
  try { const d = typeof details === 'string' ? JSON.parse(details) : details; return TIERS.includes(d.tier) || d.tier === 'feature-only' ? d.tier : 'unknown'; }
  catch (_) { return 'unknown'; }
}

/**
 * rows: [{ target, actor_id, details, ts }] (system_log, action = page_viewed).
 * Returns { pages: [{ page, users, view_days, by_tier: { tier: users } }], tiers: [...] } sorted by users desc.
 * A user counts once per page in `users`; once per page per tier in `by_tier` (a user whose tier changed
 * during the window counts in both tiers — the tier is the one recorded on the day of the view).
 */
function aggregate(rows) {
  const pages = new Map();
  const tiersSeen = new Set();
  for (const r of rows || []) {
    if (!r || r.actor_id == null || !r.target) continue;
    const page = String(r.target), uid = String(r.actor_id), tier = _tierOf(r.details);
    tiersSeen.add(tier);
    if (!pages.has(page)) pages.set(page, { users: new Set(), days: new Set(), tiers: new Map() });
    const p = pages.get(page);
    p.users.add(uid);
    p.days.add(uid + '|' + String(r.ts || '').slice(0, 10));
    if (!p.tiers.has(tier)) p.tiers.set(tier, new Set());
    p.tiers.get(tier).add(uid);
  }
  const order = [...TIERS, 'feature-only', 'unknown'].filter((t) => tiersSeen.has(t));
  const out = [...pages.entries()].map(([page, p]) => ({
    page, users: p.users.size, view_days: p.days.size,
    by_tier: Object.fromEntries(order.map((t) => [t, p.tiers.has(t) ? p.tiers.get(t).size : 0])),
  })).sort((a, b) => b.users - a.users || b.view_days - a.view_days || a.page.localeCompare(b.page));
  return { pages: out, tiers: order };
}

// F-UX-06 — the task events a page may report (allow-list) and the shape of their target token.
const EVENT_KINDS = ['export', 'drill', 'action_open', 'action_done', 'first_click'];
function normalizeEventKind(raw) { const k = String(raw == null ? '' : raw).trim().toLowerCase(); return EVENT_KINDS.includes(k) ? k : null; }
/** null = no target; undefined = refused (anything but a short lowercase token: no URL, no query value, no text). */
function normalizeTarget(raw) {
  if (raw == null || raw === '') return null;
  const t = String(raw).trim().toLowerCase();
  return /^[a-z0-9][a-z0-9._:-]{0,63}$/.test(t) ? t : undefined;
}

function clampDays(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return 30;
  return Math.max(1, Math.min(180, n));
}

module.exports = { TIERS, EVENT_KINDS, normalizePage, normalizeEventKind, normalizeTarget, roleTier, aggregate, clampDays };
