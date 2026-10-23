'use strict';
// Step 9 — persistence of the engagement engine: rules, their evaluation state, fired alerts, notifications (with read
// receipts), comments, subscriptions, delivery channels. Schema: db/postgres/reports/021_engagement_reports_publication.sql.
// A channel URL (Teams workflow, webhook) is a SECRET: stored encrypted (services/configSecrets.js), never returned by
// any function here except channelSecret(), used only by the delivery code.

const sql = require('../sqlStore');
const secrets = require('../configSecrets');

const handle = () => sql.handle('021_engagement_reports_publication.sql');
const { now, newId, parse } = sql;
const key = () => secrets.envKey(process.env, () => {});

// ── Rules ─────────────────────────────────────────────────────────────
function ruleRow(r) {
  return r ? { id: r.id, title: r.title, kind: r.kind, config: parse(r.config_json, {}), channels: parse(r.channels_json, ['inapp']), recipients: parse(r.recipients_json, []),
    persistence: Number(r.persistence), cooldown_hours: Number(r.cooldown_hours), enabled: Number(r.enabled) === 1, channel_id: (parse(r.config_json, {}) || {}).channel_id || null,
    created_by: r.created_by, created_at: r.created_at, updated_by: r.updated_by, updated_at: r.updated_at } : null;
}
async function listRules() { const { H } = handle(); return (await H.prepare(`SELECT * FROM en_rules ORDER BY title`).all()).map(ruleRow); }
async function getRule(id) { const { H } = handle(); return ruleRow(await H.prepare(`SELECT * FROM en_rules WHERE id = ?`).get(id)); }
async function saveRule(r, by) {
  const { H } = handle();
  const t = now(), cfg = JSON.stringify(Object.assign({}, r.config, { channel_id: r.channel_id || null }));
  await H.prepare(`INSERT INTO en_rules (id, title, kind, config_json, channels_json, recipients_json, persistence, cooldown_hours, enabled, created_by, created_at, updated_by, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, kind = EXCLUDED.kind, config_json = EXCLUDED.config_json, channels_json = EXCLUDED.channels_json,
      recipients_json = EXCLUDED.recipients_json, persistence = EXCLUDED.persistence, cooldown_hours = EXCLUDED.cooldown_hours, enabled = EXCLUDED.enabled,
      updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`)
    .run(r.id, r.title, r.kind, cfg, JSON.stringify(r.channels), JSON.stringify(r.recipients), r.persistence, r.cooldown_hours, r.enabled ? 1 : 0, by || null, t, by || null, t);
  return getRule(r.id);
}
async function deleteRule(id) {
  const { H } = handle();
  await H.prepare(`DELETE FROM en_rules WHERE id = ?`).run(id);
  await H.prepare(`DELETE FROM en_rule_state WHERE rule_id = ?`).run(id);
  await H.prepare(`DELETE FROM en_subscriptions WHERE rule_id = ?`).run(id);
}

// ── State and fires ───────────────────────────────────────────────────
async function getState(ruleId) {
  const { H } = handle();
  const r = await H.prepare(`SELECT * FROM en_rule_state WHERE rule_id = ?`).get(ruleId);
  return r ? { breaches: Number(r.breaches), last_value: r.last_value == null ? null : Number(r.last_value), last_eval_at: r.last_eval_at, firing: Number(r.firing) === 1, fire_id: r.fire_id, last_fired_at: r.last_fired_at }
    : { breaches: 0, last_value: null, last_eval_at: null, firing: false, fire_id: null, last_fired_at: null };
}
async function saveState(ruleId, s) {
  const { H } = handle();
  await H.prepare(`INSERT INTO en_rule_state (rule_id, breaches, last_value, last_eval_at, firing, fire_id, last_fired_at) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (rule_id) DO UPDATE SET breaches = EXCLUDED.breaches, last_value = EXCLUDED.last_value, last_eval_at = EXCLUDED.last_eval_at,
      firing = EXCLUDED.firing, fire_id = EXCLUDED.fire_id, last_fired_at = EXCLUDED.last_fired_at`)
    .run(ruleId, s.breaches, s.last_value, s.last_eval_at, s.firing ? 1 : 0, s.fire_id || null, s.last_fired_at || null);
}
async function addFire(ruleId, value, msg) {
  const { H } = handle();
  const id = newId('F');
  await H.prepare(`INSERT INTO en_fires (id, rule_id, fired_at, value, message) VALUES (?, ?, ?, ?, ?)`).run(id, ruleId, now(), value, msg);
  return id;
}
async function resolveFire(id) { const { H } = handle(); await H.prepare(`UPDATE en_fires SET resolved_at = ? WHERE id = ? AND resolved_at IS NULL`).run(now(), id); }
async function getFire(id) { const { H } = handle(); return H.prepare(`SELECT * FROM en_fires WHERE id = ?`).get(id); }
async function listFires(ruleId) { const { H } = handle(); return H.prepare(`SELECT * FROM en_fires WHERE rule_id = ? ORDER BY fired_at DESC LIMIT 100`).all(ruleId); }

// ── Notifications ─────────────────────────────────────────────────────
async function notify(n) {
  const { H } = handle();
  const id = newId('N');
  await H.prepare(`INSERT INTO en_notifications (id, fire_id, rule_id, username, title, body, link, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, n.fire_id || null, n.rule_id || null, n.username, n.title, n.body || null, n.link || null, now());
  return id;
}
async function listNotifications(username, { unread, limit = 100 } = {}) {
  const { H } = handle();
  return H.prepare(`SELECT * FROM en_notifications WHERE username = ? ${unread ? 'AND read_at IS NULL' : ''} ORDER BY created_at DESC LIMIT ?`).all(username, Math.min(500, limit));
}
async function unreadCount(username) {
  const { H } = handle();
  const r = await H.prepare(`SELECT COUNT(*) AS n FROM en_notifications WHERE username = ? AND read_at IS NULL`).get(username);
  return Number(r.n) || 0;
}
async function markRead(username, ids) {
  const { H } = handle();
  const t = now();
  if (ids === 'all') { await H.prepare(`UPDATE en_notifications SET read_at = ? WHERE username = ? AND read_at IS NULL`).run(t, username); return; }
  for (const id of ids || []) await H.prepare(`UPDATE en_notifications SET read_at = COALESCE(read_at, ?) WHERE id = ? AND username = ?`).run(t, id, username);
}
/** Read receipts of one fired alert: who was notified, who read, when. */
async function receipts(fireId) {
  const { H } = handle();
  return H.prepare(`SELECT username, created_at, read_at, emailed_at FROM en_notifications WHERE fire_id = ? ORDER BY username`).all(fireId);
}
async function pendingDigest(sinceIso) {
  const { H } = handle();
  return H.prepare(`SELECT * FROM en_notifications WHERE read_at IS NULL AND emailed_at IS NULL AND created_at >= ? ORDER BY username, created_at`).all(sinceIso);
}
async function markEmailed(ids) { const { H } = handle(); const t = now(); for (const id of ids) await H.prepare(`UPDATE en_notifications SET emailed_at = ? WHERE id = ?`).run(t, id); }

// ── Comments (the discussion of one fired alert) ──────────────────────
async function addComment(fireId, username, text) {
  const { H } = handle();
  const id = newId('C');
  await H.prepare(`INSERT INTO en_comments (id, fire_id, username, text, at) VALUES (?, ?, ?, ?, ?)`).run(id, fireId, username, String(text).slice(0, 2000), now());
  return id;
}
async function comments(fireId) { const { H } = handle(); return H.prepare(`SELECT username, text, at FROM en_comments WHERE fire_id = ? ORDER BY at`).all(fireId); }

// ── Subscriptions ─────────────────────────────────────────────────────
async function subscriptions(username) { const { H } = handle(); return H.prepare(`SELECT rule_id, channel FROM en_subscriptions WHERE username = ?`).all(username); }
async function subscribers(ruleId) { const { H } = handle(); return H.prepare(`SELECT username, channel FROM en_subscriptions WHERE rule_id = ?`).all(ruleId); }
async function setSubscription(username, ruleId, channel, on) {
  const { H } = handle();
  if (on) await H.prepare(`INSERT INTO en_subscriptions (username, rule_id, channel) VALUES (?, ?, ?) ON CONFLICT (username, rule_id, channel) DO NOTHING`).run(username, ruleId, channel);
  else await H.prepare(`DELETE FROM en_subscriptions WHERE username = ? AND rule_id = ? AND channel = ?`).run(username, ruleId, channel);
}

// ── Channels (secrets) ────────────────────────────────────────────────
async function listChannels() {
  const { H } = handle();
  return (await H.prepare(`SELECT id, name, kind, created_by, created_at, secret_enc FROM en_channels ORDER BY name`).all())
    .map(c => ({ id: c.id, name: c.name, kind: c.kind, created_by: c.created_by, created_at: c.created_at, signed: !!c.secret_enc }));
}
async function addChannel({ name, kind, url, signingSecret }, by) {
  const { H } = handle();
  const id = newId('CH');
  const k = key();
  const enc = (v) => (v ? (k ? secrets.encryptValue(v, k) : v) : null);
  await H.prepare(`INSERT INTO en_channels (id, name, kind, url_enc, secret_enc, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, name, kind, enc(url), enc(signingSecret), by || null, now());
  return id;
}
async function deleteChannel(id) { const { H } = handle(); await H.prepare(`DELETE FROM en_channels WHERE id = ?`).run(id); }
/** Delivery only: the decrypted URL (and signing secret). Never sent to a browser, never logged. */
async function channelSecret(id) {
  const { H } = handle();
  const c = await H.prepare(`SELECT * FROM en_channels WHERE id = ?`).get(id);
  if (!c) return null;
  const k = key();
  const dec = (v) => (v == null ? null : secrets.decryptValue(v, k));
  return { id: c.id, kind: c.kind, name: c.name, url: dec(c.url_enc), signingSecret: dec(c.secret_enc) };
}

module.exports = {
  listRules, getRule, saveRule, deleteRule, getState, saveState, addFire, resolveFire, getFire, listFires,
  notify, listNotifications, unreadCount, markRead, receipts, pendingDigest, markEmailed, addComment, comments,
  subscriptions, subscribers, setSubscription, listChannels, addChannel, deleteChannel, channelSecret,
};
