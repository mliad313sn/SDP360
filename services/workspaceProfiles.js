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
  const row = await H(rdb).prepare(`SELECT user_id, profile, card_order, cards_hidden, density, default_site_id, updated_at
    FROM user_workspace_prefs WHERE user_id = ?`).get(Number(userId));
  if (!row) return null;
  return {
    profile: row.profile || null,
    card_order: _json(row.card_order),
    cards_hidden: _json(row.cards_hidden),
    density: row.density || null,
    default_site_id: row.default_site_id != null ? Number(row.default_site_id) : null,
    updated_at: row.updated_at,
  };
}

/** Upsert a VALIDATED prefs object (engine.validatePrefs output) for a user. */
async function savePrefs(userId, prefs, rdb) {
  const p = prefs || {};
  const now = new Date().toISOString();
  await H(rdb).prepare(`INSERT INTO user_workspace_prefs (user_id, profile, card_order, cards_hidden, density, default_site_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id) DO UPDATE SET profile = EXCLUDED.profile, card_order = EXCLUDED.card_order,
      cards_hidden = EXCLUDED.cards_hidden, density = EXCLUDED.density, default_site_id = EXCLUDED.default_site_id,
      updated_at = EXCLUDED.updated_at`).run(
    Number(userId), p.profile || null,
    p.card_order ? JSON.stringify(p.card_order) : null,
    p.cards_hidden ? JSON.stringify(p.cards_hidden) : null,
    p.density || null, p.default_site_id != null ? Number(p.default_site_id) : null, now);
  return now;
}

/** Remove the row: the person is back to the role defaults. */
async function deletePrefs(userId, rdb) {
  await H(rdb).prepare('DELETE FROM user_workspace_prefs WHERE user_id = ?').run(Number(userId));
}

module.exports = Object.assign({}, engine, { getPrefs, savePrefs, deletePrefs });
