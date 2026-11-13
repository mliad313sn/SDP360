'use strict';
// R1-PROFILES — server side of the workspace profiles. The engine lives in public/lib/workspaceProfiles.js
// (UMD) so the browser and the server compute the same profile and the same destination list.
// This module adds the per-user store (table user_workspace_prefs, migration 078). PostgreSQL only.
// Nothing here is read by any access check: the store holds presentation choices, never rights.
const engine = require('../public/lib/workspaceProfiles');

const H = (rdb) => (rdb || require('../reports-db')).pgHandle();

function _json(v) {
  if (v == null) return null;
  try { const a = JSON.parse(v); return Array.isArray(a) ? a : null; } catch (_) { return null; }
}

/** The stored row for a user, or null (no row = role defaults). */
async function getPrefs(userId, rdb) {
  const row = await H(rdb).prepare(`SELECT user_id, profile, card_order, cards_hidden, density, default_site_id, block_order, updated_at
    FROM user_workspace_prefs WHERE user_id = ?`).get(Number(userId));
  if (!row) return null;
  return {
    profile: row.profile || null,
    card_order: _json(row.card_order),
    cards_hidden: _json(row.cards_hidden),
    density: row.density || null,
    default_site_id: row.default_site_id != null ? Number(row.default_site_id) : null,
    block_order: _json(row.block_order),
    updated_at: row.updated_at,
  };
}

/** Upsert a VALIDATED prefs object (engine.validatePrefs output) for a user. */
async function savePrefs(userId, prefs, rdb) {
  const p = prefs || {};
  const now = new Date().toISOString();
  await H(rdb).prepare(`INSERT INTO user_workspace_prefs (user_id, profile, card_order, cards_hidden, density, default_site_id, block_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET profile = EXCLUDED.profile, card_order = EXCLUDED.card_order,
      cards_hidden = EXCLUDED.cards_hidden, density = EXCLUDED.density, default_site_id = EXCLUDED.default_site_id,
      block_order = EXCLUDED.block_order, updated_at = EXCLUDED.updated_at`).run(
    Number(userId), p.profile || null,
    p.card_order ? JSON.stringify(p.card_order) : null,
    p.cards_hidden ? JSON.stringify(p.cards_hidden) : null,
    p.density || null, p.default_site_id != null ? Number(p.default_site_id) : null,
    p.block_order ? JSON.stringify(p.block_order) : null, now);
  return now;
}

/** Remove the row: the person is back to the role defaults. */
async function deletePrefs(userId, rdb) {
  await H(rdb).prepare('DELETE FROM user_workspace_prefs WHERE user_id = ?').run(Number(userId));
}

// ── P5 (A3) — snoozed Home queue lines (migration 099). A snooze hides ONE line of MY queue until a day; it never
// touches the item, its owner or its status, and it is never read by an access check. Keys are '<source>:<id>'.
const SNOOZE_KEY = /^[a-z_]{2,24}:[A-Za-z0-9_.-]{1,64}$/;
const MAX_SNOOZES = 200;
const MAX_SNOOZE_DAYS = 30;
function _obj(v) { if (v == null) return {}; try { const o = JSON.parse(v); return o && typeof o === 'object' && !Array.isArray(o) ? o : {}; } catch (_) { return {}; } }
/** { key: 'YYYY-MM-DD' } of the snoozes still running on `today` (past ones are dropped). */
async function getSnoozes(userId, rdb, today) {
  const row = await H(rdb).prepare('SELECT queue_snoozed FROM user_workspace_prefs WHERE user_id = ?').get(Number(userId));
  const t = String(today || new Date().toISOString().slice(0, 10)).slice(0, 10);
  const out = {};
  for (const [k, d] of Object.entries(_obj(row && row.queue_snoozed))) if (SNOOZE_KEY.test(k) && /^\d{4}-\d{2}-\d{2}$/.test(String(d)) && String(d) > t) out[k] = String(d);
  return out;
}
/** Validate one snooze → { key, until } | { error }. until = null clears it. */
function validateSnooze(body, today) {
  const b = body || {};
  const key = String(b.key || '');
  if (!SNOOZE_KEY.test(key)) return { error: 'key must look like <source>:<id>' };
  if (b.until == null || b.until === '') return { key, until: null };
  const until = String(b.until).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until) || Number.isNaN(Date.parse(until + 'T00:00:00Z'))) return { error: 'until must be a date (YYYY-MM-DD)' };
  const t = String(today).slice(0, 10);
  const max = new Date(Date.parse(t + 'T00:00:00Z') + MAX_SNOOZE_DAYS * 864e5).toISOString().slice(0, 10);
  if (until <= t) return { error: 'until must be after today' };
  if (until > max) return { error: `a line is snoozed for ${MAX_SNOOZE_DAYS} days at most` };
  return { key, until };
}
/** Set (or clear with until = null) one snooze; expired ones are pruned on every write. */
async function setSnooze(userId, { key, until }, rdb, today) {
  const cur = await getSnoozes(userId, rdb, today);
  if (until) cur[key] = until; else delete cur[key];
  const keys = Object.keys(cur);
  if (keys.length > MAX_SNOOZES) { const e = new Error(`at most ${MAX_SNOOZES} snoozed lines`); e.status = 400; throw e; }
  const now = new Date().toISOString();
  await H(rdb).prepare(`INSERT INTO user_workspace_prefs (user_id, queue_snoozed, updated_at) VALUES (?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET queue_snoozed = EXCLUDED.queue_snoozed, updated_at = EXCLUDED.updated_at`)
    .run(Number(userId), keys.length ? JSON.stringify(cur) : null, now);
  return cur;
}

module.exports = Object.assign({}, engine, { getPrefs, savePrefs, deletePrefs, getSnoozes, setSnooze, validateSnooze, MAX_SNOOZE_DAYS });
