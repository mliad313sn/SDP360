'use strict';
// Step 9 — the engagement ENGINE: measure every enabled rule, fire an alert after `persistence` evaluations in breach
// (never twice inside the cooldown), notify the recipients (in-app always; e-mail, Teams, webhook when the rule asks
// for them and the channel is armed), and say when the situation is back to normal. Values come from the existing
// readers and the KPI dictionary — never a second formula. Delivery failures are reported, never thrown.

const crypto = require('crypto');
const store = require('./store');
const rules = require('./rules');

/** The value a rule watches, right now. deps = { rdb, metrics, sites, targets, syncStates() }. */
async function measure(rule, deps) {
  const c = rule.config || {};
  const site = c.scope && c.scope !== 'GROUP' ? (deps.sites || []).find(s => s.code === c.scope) : null;
  if (c.scope && c.scope !== 'GROUP' && !site) throw new Error(`site ${c.scope} unknown or inactive`);
  if (rule.kind === 'metric') {
    const D = require('../metrics/dispatch');
    const window = D.resolveWindow({});
    const r = site ? await D.computeMetric(c.metric, { site, window, targets: deps.targets }, deps.metrics)
      : await D.computeGroupMetric(c.metric, { sites: deps.sites, window, targets: deps.targets }, deps.metrics);
    return r && r.status === 200 ? r.value : null;
  }
  const groupsOf = async (siteIds) => {
    const rows = await deps.rdb.listSites();
    const out = [];
    for (const s of rows || []) if (siteIds.has(s.id) && s.zoho_group) String(s.zoho_group).split(',').map(g => g.trim()).filter(Boolean).forEach(g => out.push(g));
    return out;
  };
  const ids = new Set(site ? [site.site_id] : (deps.sites || []).map(s => s.site_id));
  if (rule.kind === 'tickets_older') {
    const groups = new Set(await groupsOf(ids));
    const rows = (await deps.rdb.getAgeingByGroupDB()) || [];
    let n = 0;
    for (const r of rows) {
      if (!groups.has(r.group)) continue;   // getAgeingByGroupDB: { group, t0_30, t31_45, t46_60, tOver60 }
      const d31 = Number(r.t31_45) || 0, d46 = Number(r.t46_60) || 0, d60 = Number(r.tOver60) || 0;
      n += c.days === 30 ? d31 + d46 + d60 : c.days === 45 ? d46 + d60 : d60;
    }
    return n;
  }
  if (rule.kind === 'major_incident') {
    const groups = await groupsOf(ids);
    return groups.length ? ((await deps.rdb.getActiveMajorIncidentsForSite(groups)) || []).length : 0;
  }
  if (rule.kind === 'sync_health') {
    const { freshness } = require('../metrics/freshness');
    const f = freshness(await deps.syncStates());
    return Object.values(f).filter(x => x && (x.status === 'late' || x.status === 'down')).length;
  }
  return null;
}

/** Usernames a rule notifies: its role / user recipients + the people subscribed to it in-app. */
async function recipientsOf(rule, deps) {
  const users = (await deps.rdb.listUsers()) || [];
  const out = new Map();
  const add = (u, email) => { if (u && u.active !== 0 && u.active !== false) { const k = String(u.username); const cur = out.get(k) || { user: u, email: false }; cur.email = cur.email || email; out.set(k, cur); } };
  for (const r of rule.recipients || []) {
    if (r.type === 'user') add(users.find(u => String(u.username).toLowerCase() === r.value.toLowerCase()), rule.channels.includes('email'));
    else for (const u of users) if (deps.rdb.userHasRole(u, r.value)) add(u, rule.channels.includes('email'));
  }
  for (const s of await store.subscribers(rule.id)) add(users.find(u => u.username === s.username), s.channel === 'email');
  return [...out.values()];
}

function teamsCard(title, text, link) {
  return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: {
    $schema: 'http://adaptivecards.io/schemas/adaptive-card.json', type: 'AdaptiveCard', version: '1.4',
    body: [{ type: 'TextBlock', text: title, weight: 'Bolder', size: 'Medium', wrap: true }, { type: 'TextBlock', text, wrap: true }],
    actions: link ? [{ type: 'Action.OpenUrl', title: 'Ouvrir', url: link }] : [] } }] };
}

/** Post to a Teams channel or a webhook. Returns { ok, error } — the URL never appears in it. */
async function post(channelId, payload, deps) {
  try {
    const ch = await store.channelSecret(channelId);
    if (!ch || !ch.url) return { ok: false, error: 'channel unknown or unreadable (SDP_CONFIG_KEY?)' };
    const body = JSON.stringify(payload);
    const headers = { 'Content-Type': 'application/json' };
    if (ch.kind === 'webhook' && ch.signingSecret) headers['X-SDP-Signature'] = 'sha256=' + crypto.createHmac('sha256', ch.signingSecret).update(body).digest('hex');
    const http = deps.http || ((url, data, opts) => require('axios').post(url, data, opts));
    await http(ch.url, body, { headers, timeout: 15000 });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: 'delivery failed' + (e && e.response ? ` (HTTP ${e.response.status})` : '') };
  }
}

async function deliver(rule, fireId, title, text, deps) {
  const link = (deps.baseUrl || '') + '/notifications.html#' + fireId;
  const out = { inapp: 0, email: 0, teams: null, webhook: null };
  const people = await recipientsOf(rule, deps);
  for (const p of people) { await store.notify({ fire_id: fireId, rule_id: rule.id, username: p.user.username, title, body: text, link: 'notifications.html#' + fireId }); out.inapp++; }
  if (rule.channels.includes('email') && deps.mailer) {
    const to = people.filter(p => p.email && p.user.email).map(p => p.user.email);
    if (to.length) { const r = await deps.mailer.send({ to: to.join(', '), subject: title, html: `<p>${escapeHtml(text)}</p><p><a href="${escapeHtml(link)}">Ouvrir l’alerte</a></p>` }); out.email = r.ok ? to.length : 0; out.email_error = r.ok ? undefined : r.error; }
  }
  if (rule.channels.includes('teams') && rule.channel_id) out.teams = await post(rule.channel_id, teamsCard(title, text, deps.baseUrl ? link : null), deps);
  if (rule.channels.includes('webhook') && rule.channel_id) out.webhook = await post(rule.channel_id, { rule: rule.id, title, text, fire_id: fireId, at: new Date().toISOString() }, deps);
  return out;
}
const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** One evaluation of one rule: state transition + deliveries. Returns what happened. */
async function evaluateRule(rule, deps, nowDate = new Date()) {
  const st = await store.getState(rule.id);
  let value;
  try { value = await measure(rule, deps); }
  catch (e) { return { id: rule.id, error: String(e.message || e).slice(0, 200) }; }
  const breach = rules.breaches(rule, value);
  const t = nowDate.toISOString();
  const next = { ...st, last_value: value == null ? null : Number(value), last_eval_at: t };
  let event = null;
  if (breach) {
    next.breaches = st.breaches + 1;
    const cooled = !st.last_fired_at || (nowDate - Date.parse(st.last_fired_at)) >= rule.cooldown_hours * 3600000;
    if (!st.firing && next.breaches >= rule.persistence && cooled) {
      const text = rules.message(rule, value);
      const fireId = await store.addFire(rule.id, Number(value), text);
      next.firing = true; next.fire_id = fireId; next.last_fired_at = t;
      event = { fired: fireId, delivery: await deliver(rule, fireId, `Alerte — ${rule.title}`, text, deps) };
    }
  } else {
    next.breaches = 0;
    if (st.firing) {
      await store.resolveFire(st.fire_id);
      const text = `Retour à la normale : ${rule.title}` + (value == null ? '' : ` (${value})`);
      for (const p of await recipientsOf(rule, deps)) await store.notify({ fire_id: st.fire_id, rule_id: rule.id, username: p.user.username, title: `Rétabli — ${rule.title}`, body: text, link: 'notifications.html#' + st.fire_id });
      next.firing = false;
      event = { resolved: st.fire_id };
    }
  }
  await store.saveState(rule.id, next);
  return { id: rule.id, value, breach, breaches: next.breaches, firing: next.firing, ...event };
}

/** Every enabled rule (the scheduled job). */
async function evaluateAll(deps) {
  const out = [];
  for (const r of await store.listRules()) if (r.enabled) out.push(await evaluateRule(r, deps));
  return { evaluated: out.length, fired: out.filter(x => x.fired).length, resolved: out.filter(x => x.resolved).length, errors: out.filter(x => x.error).map(x => `${x.id}: ${x.error}`) };
}

/** Daily digest: one e-mail per person with their unread notifications of the last 24 h. */
async function digest(deps, nowDate = new Date()) {
  if (!deps.mailer) return { sent: 0, skipped: 'e-mail not armed' };
  const since = new Date(nowDate - 24 * 3600000).toISOString();
  const rows = await store.pendingDigest(since);
  const users = new Map(((await deps.rdb.listUsers()) || []).map(u => [u.username, u]));
  const by = new Map();
  for (const n of rows) { if (!by.has(n.username)) by.set(n.username, []); by.get(n.username).push(n); }
  let sent = 0;
  for (const [username, list] of by) {
    const u = users.get(username);
    if (!u || !u.email) continue;
    const html = `<p>${list.length} notification(s) non lue(s) :</p><ul>` + list.map(n => `<li><b>${escapeHtml(n.title)}</b> — ${escapeHtml(n.body || '')}</li>`).join('') + '</ul>';
    const r = await deps.mailer.send({ to: u.email, subject: `SDP Dashboard — ${list.length} notification(s)`, html });
    if (r.ok) { await store.markEmailed(list.map(n => n.id)); sent++; }
  }
  return { sent, people: by.size };
}

module.exports = { measure, recipientsOf, evaluateRule, evaluateAll, digest, teamsCard, post };
