'use strict';
// Step 9 — engagement + external publishing persistence: alert rules + evaluation state, in-app
// notifications (+ comments), subscriptions, signed expiring share links + read receipts,
// API consumers (hashed keys, daily quota) + call log. sqlite + PostgreSQL (migration 019).
// Secrets: a share token / API key is stored as a sha256 HASH only — the clear value is shown once.

const crypto = require('crypto');


const CHANNELS = ['inapp', 'email', 'teams', 'webhook'];
const SUB_KINDS = ['report_template', 'dashboard', 'alert_rule'];
const DIGESTS = ['none', 'daily', 'weekly'];
const SHARE_KINDS = ['dashboard', 'report_run'];
const SCOPES = ['metrics:read', 'values:read', 'sites:read'];
const J = (v) => (v == null ? null : JSON.stringify(v));
const P_ = (s, d) => { if (s == null) return d; if (typeof s !== 'string') return s; try { return JSON.parse(s); } catch (_) { return d; } };
const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const token = (bytes = 24) => crypto.randomBytes(bytes).toString('base64url');

function makeEngagementStore(db, { isPg = false, now = () => new Date().toISOString() } = {}) {
  if (!db) throw new Error('engagementStore needs a db handle');
  const P = (sql) => db.prepare(sql);
  async function init() {  }
  async function insert(table, cols, vals) {
    const r = await P(`INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})${(' RETURNING id')}`).run(...vals);
    return (Number(r && (r.id != null ? r.id : r.lastID != null ? r.lastID : (r.rows && r.rows[0] && r.rows[0].id))));
  }

  // ── alert rules ───────────────────────────────────────────────────────────────────
  const ruleRow = (r) => r && ({ ...r, site_id: r.site_id == null ? null : Number(r.site_id), streak: Number(r.streak) || 1, cooldown_min: Number(r.cooldown_min) || 0, channels: P_(r.channels, ['inapp']), recipients: P_(r.recipients, {}), enabled: Number(r.enabled) !== 0, threshold: isNaN(Number(r.threshold)) ? r.threshold : Number(r.threshold) });
  async function listRules({ includeDisabled = true } = {}) { return (await P(`SELECT * FROM alert_rules${includeDisabled ? '' : ' WHERE enabled=1'} ORDER BY key`).all()).map(ruleRow); }
  async function getRule(key) { return ruleRow(await P(`SELECT * FROM alert_rules WHERE key=?`).get(String(key))); }
  async function saveRule(r, { user } = {}) {
    const { OPERATORS } = require('./alertEngine');
    if (!r || !r.key || !/^[a-z0-9][a-z0-9_.-]{0,63}$/i.test(r.key)) throw Object.assign(new Error('rule key is required'), { code: 'INVALID' });
    const ex = await P(`SELECT key FROM alert_rules WHERE key=?`).get(r.key);
    if (!ex && !r.metric) throw Object.assign(new Error('metric is required'), { code: 'INVALID' });
    if (r.op && !OPERATORS.includes(r.op)) throw Object.assign(new Error(`op must be one of ${OPERATORS.join(', ')}`), { code: 'INVALID' });
    if (r.channels && r.channels.some(c => !CHANNELS.includes(c))) throw Object.assign(new Error('bad channel'), { code: 'INVALID' });
    const vals = { name: String(r.name || r.key).slice(0, 200), metric: r.metric == null ? null : String(r.metric).slice(0, 80), scope: r.scope === 'fleet' ? 'fleet' : 'site', site_id: r.site_id == null || r.site_id === '' ? null : Number(r.site_id), window_label: r.window_label ? String(r.window_label).slice(0, 24) : null,
      op: r.op || 'lt', threshold: r.threshold == null ? '0' : String(r.threshold).slice(0, 60), streak: Math.max(1, Number(r.streak) || 1), cooldown_min: Math.max(0, Number(r.cooldown_min) || 0), channels: J(r.channels || ['inapp']), recipients: J(r.recipients || { roles: ['admin'] }), enabled: r.enabled === false ? 0 : 1, description: r.description == null ? null : String(r.description).slice(0, 1000) };
    if (ex) { const keys = Object.keys(vals).filter(k => r[k] !== undefined); if (keys.length) await P(`UPDATE alert_rules SET ${keys.map(k => `${k}=?`).join(', ')}, updated_at=? WHERE key=?`).run(...keys.map(k => vals[k]), now(), r.key); return getRule(r.key); }
    await P(`INSERT INTO alert_rules (key, ${Object.keys(vals).join(',')}, created_by, created_at, updated_at) VALUES (?, ${Object.keys(vals).map(() => '?').join(',')}, ?, ?, ?)`).run(r.key, ...Object.values(vals), user ? user.id : null, now(), now());
    return getRule(r.key);
  }
  async function removeRule(key) { await P(`DELETE FROM alert_rules WHERE key=?`).run(String(key)); await P(`DELETE FROM alert_state WHERE rule_key=?`).run(String(key)); }
  async function seedRules(rules) { const added = []; for (const r of rules) { if (await getRule(r.key)) continue; await saveRule(r, {}); added.push(r.key); } return added; }
  async function loadState() { const out = {}; for (const r of await P(`SELECT * FROM alert_state`).all()) out[r.state_key] = { breaches: Number(r.breaches) || 0, last_fired_at: r.last_fired_at }; return out; }
  async function saveState(state, values = {}) {
    for (const [k, st] of Object.entries(state)) {
      const ex = await P(`SELECT state_key FROM alert_state WHERE state_key=?`).get(k);
      if (ex) await P(`UPDATE alert_state SET breaches=?, last_fired_at=?, last_value=?, updated_at=? WHERE state_key=?`).run(st.breaches || 0, st.last_fired_at || null, values[k] == null ? null : String(values[k]), now(), k);
      else await P(`INSERT INTO alert_state (state_key, rule_key, breaches, last_fired_at, last_value, updated_at) VALUES (?,?,?,?,?,?)`).run(k, k.split('|')[0], st.breaches || 0, st.last_fired_at || null, values[k] == null ? null : String(values[k]), now());
    }
  }
  async function recordFiring(f) { return insert('alert_firings', ['rule_key', 'site_id', 'value', 'message', 'channels', 'fired_at'], [f.rule.key, f.reading.site_id == null ? null : Number(f.reading.site_id), f.reading.value == null ? null : String(f.reading.value), f.message, J(f.rule.channels), now()]); }
  async function listFirings({ limit = 200, since = null } = {}) { return (await P(`SELECT * FROM alert_firings${since ? ' WHERE fired_at>=?' : ''} ORDER BY fired_at DESC, id DESC LIMIT ${Math.max(1, Math.min(2000, Math.floor(Number(limit)) || 200))}`).all(...(since ? [since] : []))).map(r => ({ ...r, id: Number(r.id), false_positive: Number(r.false_positive) === 1 })); }
  async function markFalsePositive(id, { fp = true, note = null } = {}) { await P(`UPDATE alert_firings SET false_positive=?, note=? WHERE id=?`).run(fp ? 1 : 0, note, Number(id)); }
  /** False-positive rate over the window (the "< 5 %" acceptance). */
  async function firingStats({ since = null } = {}) { const rows = await listFirings({ limit: 2000, since }); const fp = rows.filter(r => r.false_positive).length; return { firings: rows.length, false_positives: fp, false_positive_pct: rows.length ? Math.round(fp / rows.length * 1000) / 10 : null }; }

  // ── notifications ─────────────────────────────────────────────────────────────────
  const notifRow = (r) => r && ({ ...r, id: Number(r.id), user_id: Number(r.user_id) });
  async function notify({ userId, kind, title, body, link, sourceKind, sourceRef }) { return insert('notifications', ['user_id', 'kind', 'title', 'body', 'link', 'source_kind', 'source_ref', 'created_at'], [Number(userId), String(kind).slice(0, 40), String(title).slice(0, 300), body == null ? null : String(body).slice(0, 4000), link == null ? null : String(link).slice(0, 500), sourceKind || null, sourceRef == null ? null : String(sourceRef).slice(0, 120), now()]); }
  async function listNotifications(userId, { unreadOnly = false, limit = 100 } = {}) { return (await P(`SELECT * FROM notifications WHERE user_id=?${unreadOnly ? ' AND read_at IS NULL' : ''} ORDER BY created_at DESC, id DESC LIMIT ${Math.max(1, Math.min(500, Math.floor(Number(limit)) || 100))}`).all(Number(userId))).map(notifRow); }
  async function unreadCount(userId) { const r = await P(`SELECT COUNT(*) AS n FROM notifications WHERE user_id=? AND read_at IS NULL`).get(Number(userId)); return Number(r && r.n) || 0; }
  async function markRead(userId, ids) { const list = (Array.isArray(ids) ? ids : [ids]).map(Number).filter(Number.isFinite); if (!list.length) return 0; const r = await P(`UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL AND id IN (${list.map(() => '?').join(',')})`).run(now(), Number(userId), ...list); return Number(r && r.changes) || 0; }
  async function markAllRead(userId) { const r = await P(`UPDATE notifications SET read_at=? WHERE user_id=? AND read_at IS NULL`).run(now(), Number(userId)); return Number(r && r.changes) || 0; }
  /** Unread + not yet digested notifications per user (for the digest job); marks them digested. */
  async function pullForDigest(userId) { const rows = (await P(`SELECT * FROM notifications WHERE user_id=? AND read_at IS NULL AND digested_at IS NULL ORDER BY created_at`).all(Number(userId))).map(notifRow); if (rows.length) await P(`UPDATE notifications SET digested_at=? WHERE user_id=? AND read_at IS NULL AND digested_at IS NULL`).run(now(), Number(userId)); return rows; }
  async function addComment({ sourceKind, sourceRef, user, body }) { if (!body || !String(body).trim()) throw Object.assign(new Error('comment body is required'), { code: 'INVALID' }); const id = await insert('notification_comments', ['source_kind', 'source_ref', 'user_id', 'user_name', 'body', 'created_at'], [String(sourceKind).slice(0, 40), String(sourceRef).slice(0, 120), user ? user.id : null, user ? (user.full_name || user.username) : null, String(body).slice(0, 4000), now()]); return { id, ...(await P(`SELECT * FROM notification_comments WHERE id=?`).get(id)) }; }
  async function listComments(sourceKind, sourceRef) { return (await P(`SELECT * FROM notification_comments WHERE source_kind=? AND source_ref=? ORDER BY created_at`).all(String(sourceKind), String(sourceRef))).map(r => ({ ...r, id: Number(r.id) })); }

  // ── subscriptions ─────────────────────────────────────────────────────────────────
  async function listSubscriptions(userId) { return (await P(`SELECT * FROM subscriptions WHERE user_id=? ORDER BY kind, target_key`).all(Number(userId))).map(r => ({ ...r, id: Number(r.id) })); }
  async function subscribe(userId, { kind, target_key, channel = 'inapp', digest = 'none' }) {
    if (!SUB_KINDS.includes(kind) || !target_key) throw Object.assign(new Error(`kind must be one of ${SUB_KINDS.join(', ')} with a target_key`), { code: 'INVALID' });
    if (!CHANNELS.includes(channel) || !DIGESTS.includes(digest)) throw Object.assign(new Error('bad channel or digest'), { code: 'INVALID' });
    const ex = await P(`SELECT id FROM subscriptions WHERE user_id=? AND kind=? AND target_key=? AND channel=?`).get(Number(userId), kind, String(target_key), channel);
    if (ex) { await P(`UPDATE subscriptions SET digest=? WHERE id=?`).run(digest, Number(ex.id)); return Number(ex.id); }
    return insert('subscriptions', ['user_id', 'kind', 'target_key', 'channel', 'digest', 'created_at'], [Number(userId), kind, String(target_key).slice(0, 80), channel, digest, now()]);
  }
  async function unsubscribe(userId, id) { await P(`DELETE FROM subscriptions WHERE id=? AND user_id=?`).run(Number(id), Number(userId)); }
  async function subscribersOf(kind, targetKey) { return (await P(`SELECT * FROM subscriptions WHERE kind=? AND target_key=?`).all(kind, String(targetKey))).map(r => ({ ...r, id: Number(r.id), user_id: Number(r.user_id) })); }
  async function digestSubscribers(digest) { return (await P(`SELECT DISTINCT user_id FROM subscriptions WHERE digest=?`).all(digest)).map(r => Number(r.user_id)); }

  // ── share links ───────────────────────────────────────────────────────────────────
  async function createShareLink({ targetKind, targetKey, siteId = null, label = null, embed = false, ttlHours = 72, maxViews = null, user }) {
    if (!SHARE_KINDS.includes(targetKind) || !targetKey) throw Object.assign(new Error(`target_kind must be one of ${SHARE_KINDS.join(', ')}`), { code: 'INVALID' });
    const ttl = Math.min(24 * 90, Math.max(1, Number(ttlHours) || 72)); const tok = token(); const expires = new Date(Date.parse(now()) + ttl * 3600 * 1000).toISOString();
    const id = await insert('share_links', ['token_hash', 'target_kind', 'target_key', 'site_id', 'label', 'embed', 'expires_at', 'max_views', 'created_by', 'created_at'], [hash(tok), targetKind, String(targetKey).slice(0, 80), siteId == null ? null : Number(siteId), label == null ? null : String(label).slice(0, 200), embed ? 1 : 0, expires, maxViews == null ? null : Number(maxViews), user ? user.id : null, now()]);
    return { id, token: tok, expires_at: expires };
  }
  const linkRow = (r) => r && ({ ...r, id: Number(r.id), site_id: r.site_id == null ? null : Number(r.site_id), embed: Number(r.embed) === 1, views: Number(r.views) || 0, max_views: r.max_views == null ? null : Number(r.max_views), token_hash: undefined });
  async function listShareLinks({ userId = null } = {}) { return (await P(`SELECT * FROM share_links${userId != null ? ' WHERE created_by=?' : ''} ORDER BY created_at DESC LIMIT 500`).all(...(userId != null ? [Number(userId)] : []))).map(linkRow); }
  async function revokeShareLink(id) { await P(`UPDATE share_links SET revoked_at=? WHERE id=?`).run(now(), Number(id)); }
  /** Resolve a presented token: null when unknown / expired / revoked / exhausted. Records the receipt when ok. */
  async function openShareLink(tok, { agent = null, ip = null } = {}) {
    const r = await P(`SELECT * FROM share_links WHERE token_hash=?`).get(hash(tok)); if (!r) return null;
    if (r.revoked_at || String(r.expires_at) < now() || (r.max_views != null && Number(r.views) >= Number(r.max_views))) return null;
    await P(`UPDATE share_links SET views=views+1 WHERE id=?`).run(Number(r.id));
    await insert('share_views', ['link_id', 'viewed_at', 'agent', 'ip_hash'], [Number(r.id), now(), agent == null ? null : String(agent).slice(0, 200), ip == null ? null : hash(ip).slice(0, 16)]);
    return linkRow({ ...r, views: Number(r.views) + 1 });
  }
  async function shareReceipts(id) { return (await P(`SELECT viewed_at, agent FROM share_views WHERE link_id=? ORDER BY viewed_at DESC LIMIT 200`).all(Number(id))); }

  // ── API consumers ─────────────────────────────────────────────────────────────────
  const consRow = (r) => r && ({ ...r, id: Number(r.id), scopes: P_(r.scopes, []), quota_per_day: Number(r.quota_per_day) || 0, enabled: Number(r.enabled) !== 0, key_hash: undefined });
  async function createConsumer({ name, scopes = ['metrics:read', 'values:read', 'sites:read'], quotaPerDay = 5000, user }) {
    if (!name) throw Object.assign(new Error('consumer name is required'), { code: 'INVALID' });
    if (scopes.some(s => !SCOPES.includes(s))) throw Object.assign(new Error(`scopes must be among ${SCOPES.join(', ')}`), { code: 'INVALID' });
    const key = 'sdp_' + token(30);
    const id = await insert('api_consumers', ['name', 'key_hash', 'key_hint', 'scopes', 'quota_per_day', 'created_by', 'created_at'], [String(name).slice(0, 120), hash(key), key.slice(0, 8) + '…' + key.slice(-4), J(scopes), Math.max(1, Number(quotaPerDay) || 5000), user ? user.id : null, now()]);
    return { id, key, hint: key.slice(0, 8) + '…' + key.slice(-4) };
  }
  async function listConsumers() { return (await P(`SELECT * FROM api_consumers ORDER BY created_at DESC`).all()).map(consRow); }
  async function revokeConsumer(id) { await P(`UPDATE api_consumers SET enabled=0, revoked_at=? WHERE id=?`).run(now(), Number(id)); }
  async function callsToday(consumerId, day = now().slice(0, 10)) { const r = await P(`SELECT COUNT(*) AS n FROM api_calls WHERE consumer_id=? AND substr(called_at,1,10)=?`).get(Number(consumerId), day); return Number(r && r.n) || 0; }
  /** Authenticate a presented key → { consumer, quota_left } or { error:'unknown'|'revoked'|'quota' }. */
  async function authenticate(key) {
    if (!key) return { error: 'unknown' };
    const r = consRow(await P(`SELECT * FROM api_consumers WHERE key_hash=?`).get(hash(key))); if (!r) return { error: 'unknown' };
    if (!r.enabled) return { error: 'revoked', consumer: r };
    const used = await callsToday(r.id); if (used >= r.quota_per_day) return { error: 'quota', consumer: r, used };
    return { consumer: r, quota_left: r.quota_per_day - used };
  }
  async function logCall(consumerId, { path, status, ms }) { await insert('api_calls', ['consumer_id', 'path', 'status', 'ms', 'called_at'], [Number(consumerId), String(path || '').slice(0, 300), Number(status) || 0, Number(ms) || 0, now()]); await P(`UPDATE api_consumers SET last_used_at=? WHERE id=?`).run(now(), Number(consumerId)); }
  async function callStats({ days = 7 } = {}) { const since = new Date(Date.parse(now()) - days * 864e5).toISOString(); return (await P(`SELECT consumer_id, COUNT(*) AS calls, SUM(CASE WHEN status>=400 THEN 1 ELSE 0 END) AS errors FROM api_calls WHERE called_at>=? GROUP BY consumer_id`).all(since)).map(r => ({ consumer_id: Number(r.consumer_id), calls: Number(r.calls), errors: Number(r.errors) || 0 })); }
  async function purgeCalls({ days = 90 } = {}) { const r = await P(`DELETE FROM api_calls WHERE called_at<?`).run(new Date(Date.parse(now()) - days * 864e5).toISOString()); return Number(r && r.changes) || 0; }

  return { init, listRules, getRule, saveRule, removeRule, seedRules, loadState, saveState, recordFiring, listFirings, markFalsePositive, firingStats,
    notify, listNotifications, unreadCount, markRead, markAllRead, pullForDigest, addComment, listComments,
    listSubscriptions, subscribe, unsubscribe, subscribersOf, digestSubscribers,
    createShareLink, listShareLinks, revokeShareLink, openShareLink, shareReceipts,
    createConsumer, listConsumers, revokeConsumer, authenticate, logCall, callsToday, callStats, purgeCalls,
    CHANNELS, SUB_KINDS, DIGESTS, SHARE_KINDS, SCOPES };
}

module.exports = { makeEngagementStore, CHANNELS, SUB_KINDS, DIGESTS, SHARE_KINDS, SCOPES, hash };
