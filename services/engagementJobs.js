'use strict';
// Step 9 — the scheduled side of engagement + publishing, run through the shared job runner
// (services/sync/jobs.js). Every function here never throws into the runner for a config gap:
// a missing recipient / webhook / SharePoint registration is a counted skip, not a failure.
//   evaluateAlerts  — every 15 min: rules × sites → registry readings → alertEngine.evaluate → fan-out
//   sendDigest      — daily / weekly: unread in-app notifications per subscribed user → one e-mail
//   publishScheduled — connectors: scheduled Excel (e-mail), webhook, SharePoint list (Graph), all config-gated
//   generateScheduledReports — templates by cadence → draft runs (+ notify subscribers)

const { evaluate, fanOut } = require('./alertEngine');

async function readingsFor(rules, { registry, deps, sites, now }) {
  const out = [];
  for (const rule of rules) {
    const m = registry.get(rule.metric); if (!m) continue;
    const fleetReader = /\.fleet$/.test(m.reader || '');
    const targets = rule.scope === 'fleet' || fleetReader ? [null] : (rule.site_id != null ? sites.filter(s => Number(s.id) === Number(rule.site_id)) : sites);
    for (const s of targets) {
      try { const r = await registry.resolve(rule.metric, { site: s ? Number(s.id) : null, window: rule.window_label || null, deps, now }); out.push({ rule_key: rule.key, site_id: s ? Number(s.id) : null, site: s ? s.name : null, value: r ? r.value : null, unit: m.unit, rag: r ? r.rag : 'NA', window: r && r.window, as_of: r && r.as_of }); }
      catch (e) { out.push({ rule_key: rule.key, site_id: s ? Number(s.id) : null, site: s ? s.name : null, value: null, unit: m.unit, rag: 'NA', error: String(e.message || e).slice(0, 120) }); }
    }
  }
  return out;
}

/** recipients {users:[ids], roles:[names], emails:[]} → { userIds:Set, emails:Set } using the user directory. */
function resolveRecipients(rec, users) {
  const userIds = new Set((rec.users || []).map(Number)); const emails = new Set((rec.emails || []).map(e => String(e).trim()).filter(Boolean));
  for (const role of rec.roles || []) for (const u of users) if (u.active !== 0 && (u.role === role || (u.roles || []).includes(role))) userIds.add(Number(u.id));
  return { userIds, emails };
}

async function evaluateAlerts({ store, registry, deps, rdb, now = new Date(), mailer = null, post = null, cfg = {}, baseUrl = '' }) {
  const rules = (await store.listRules({ includeDisabled: false }));
  if (!rules.length) return { rules: 0, readings: 0, firings: 0 };
  const sites = ((await rdb.listSites({ includeInactive: false })) || []).map(s => ({ id: Number(s.id), name: s.name }));
  const readings = await readingsFor(rules, { registry, deps, sites, now });
  const state = await store.loadState();
  const { firings, state: next } = evaluate(rules, readings, state, { now });
  const values = {}; for (const r of readings) values[`${r.rule_key}|${r.site_id == null ? 'fleet' : r.site_id}`] = r.value;
  await store.saveState(next, values);
  const users = firings.length ? (await rdb.listUsers()) || [] : [];
  let notified = 0, mailed = 0, posted = 0, skipped = 0;
  for (const f of firings) {
    await store.recordFiring(f);
    const rc = resolveRecipients(f.rule.recipients || {}, users);
    if ((f.rule.channels || ['inapp']).includes('inapp')) for (const uid of rc.userIds) { await store.notify({ userId: uid, kind: 'alert', title: f.rule.name || f.rule.key, body: f.message, link: `${baseUrl}/notifications.html?rule=${encodeURIComponent(f.rule.key)}`, sourceKind: 'alert_rule', sourceRef: f.key }); notified++; }
    if ((f.rule.channels || []).includes('email')) { const to = [...rc.emails, ...users.filter(u => rc.userIds.has(Number(u.id)) && u.email).map(u => u.email)]; if (mailer && to.length) { const r = await mailer.send({ to, subject: `[Alert] ${f.rule.name || f.rule.key}`, html: `<p>${esc(f.message)}</p><p><a href="${esc(baseUrl)}/notifications.html">Open the notification centre</a></p>` }); if (r.ok) mailed++; } else skipped++; }
    if ((f.rule.channels || []).includes('teams')) { const url = String(cfg.engagement_teams_url || '').trim(); if (post && url) { try { await post(url, teamsCard(f)); posted++; } catch (_) { skipped++; } } else skipped++; }
    if ((f.rule.channels || []).includes('webhook')) { const url = String(cfg.engagement_webhook_url || '').trim(); if (post && url) { try { await post(url, { kind: 'alert', rule: f.rule.key, name: f.rule.name, metric: f.rule.metric, site_id: f.reading.site_id, site: f.reading.site, value: f.reading.value, unit: f.reading.unit, rag: f.reading.rag, message: f.message, fired_at: now.toISOString() }); posted++; } catch (_) { skipped++; } } else skipped++; }
  }
  return { rules: rules.length, readings: readings.length, firings: firings.length, notified, mailed, posted, skipped, rows: firings.length };
}
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function teamsCard(f) { return { type: 'message', attachments: [{ contentType: 'application/vnd.microsoft.card.adaptive', content: { type: 'AdaptiveCard', version: '1.4', body: [{ type: 'TextBlock', weight: 'Bolder', size: 'Medium', text: f.rule.name || f.rule.key }, { type: 'TextBlock', wrap: true, text: f.message }] } }] }; }

async function sendDigest({ store, rdb, mailer, digest = 'daily', baseUrl = '', now = new Date() }) {
  const userIds = await store.digestSubscribers(digest); if (!userIds.length) return { users: 0, sent: 0, rows: 0 };
  const users = (await rdb.listUsers()) || []; let sent = 0, skipped = 0;
  for (const uid of userIds) {
    const u = users.find(x => Number(x.id) === Number(uid)); const items = await store.pullForDigest(uid);
    if (!items.length) continue; if (!u || !u.email || !mailer) { skipped++; continue; }
    const html = `<h2 style="font-family:Calibri,Arial">Your ${digest} digest — ${items.length} notification(s)</h2><ul style="font-family:Calibri,Arial">${items.map(n => `<li><b>${esc(n.title)}</b> — ${esc(n.body || '')} <small>${esc(String(n.created_at).slice(0, 16))}</small></li>`).join('')}</ul><p><a href="${esc(baseUrl)}/notifications.html">Open the notification centre</a></p>`;
    const r = await mailer.send({ to: [u.email], subject: `IT dashboard — ${digest} digest (${items.length})`, html }); if (r.ok) sent++; else skipped++;
  }
  return { users: userIds.length, sent, skipped, rows: sent };
}

/** Scheduled report generation for every enabled template of the given cadence (one run per site for site templates). */
async function generateScheduledReports({ cadence, reportStore, dashStore, engStore, registry, deps, rdb, aiProvider, aiCall, baseUrl, now = new Date() }) {
  const { generateRun } = require('./reportGenerator');
  const templates = (await reportStore.listTemplates()).filter(t => t.cadence === cadence);
  const sites = ((await rdb.listSites({ includeInactive: false })) || []).map(s => ({ id: Number(s.id), name: s.name })); let runs = 0, notified = 0;
  for (const t of templates) {
    const d = await dashStore.published(t.dashboard_key); if (!d) continue;
    const targets = t.audience === 'site' ? sites : [null];
    for (const site of targets) {
      const run = await generateRun({ template: t, site, sites, window: null, dashboardDef: d.definition, registry, deps, rdb, aiProvider, aiCall, baseUrl, user: null, store: reportStore, now }); runs++;
      for (const s of await engStore.subscribersOf('report_template', t.key)) { if (site && s.site_id != null && Number(s.site_id) !== site.id) continue; await engStore.notify({ userId: s.user_id, kind: 'report', title: `${t.name}${site ? ' — ' + site.name : ''} ready for review`, body: run.analysis && run.analysis.headline, link: `${baseUrl}/report-studio.html?run=${run.id}`, sourceKind: 'report_run', sourceRef: run.id }); notified++; }
    }
  }
  return { templates: templates.length, runs, notified, rows: runs };
}

/** Connectors — each self-skips without its configuration (counted in `skipped`). */
async function publishScheduled({ engStore, reportStore, registry, deps, rdb, cfg = {}, mailer = null, post = null, now = new Date() }) {
  const out = { excel: 0, webhook: 0, sharepoint: 0, skipped: 0, rows: 0 };
  const sites = ((await rdb.listSites({ includeInactive: false })) || []).map(s => ({ id: Number(s.id), name: s.name }));
  const keys = String(cfg.publish_metric_keys || '').split(/[,\s]+/).map(k => k.trim()).filter(k => registry.has(k));
  const rows = [];
  for (const k of keys) { const m = registry.get(k); const fleet = /\.fleet$/.test(m.reader || ''); for (const s of fleet ? [null] : sites) { try { const r = await registry.resolve(k, { site: s ? s.id : null, deps, now }); rows.push({ metric: k, name: m.name, site_id: s ? s.id : null, site: s ? s.name : 'fleet', window: r && r.window && r.window.label, value: r ? r.value : null, unit: m.unit, rag: r ? r.rag : 'NA', as_of: r && r.as_of }); } catch (_) { /* row skipped */ } } }
  // scheduled Excel by e-mail
  const to = String(cfg.publish_excel_recipients || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
  if (to.length && mailer && rows.length) { const { buildWorkbook } = require('./tableExcel'); const buf = buildWorkbook([{ name: 'Metrics', rows }]); const r = await mailer.send({ to, subject: `IT metrics — ${now.toISOString().slice(0, 10)}`, html: `<p>${rows.length} figure(s) as of ${esc(now.toISOString().slice(0, 16))}. “—” = not measured.</p>`, attachments: [{ filename: `metrics-${now.toISOString().slice(0, 10)}.xlsx`, content: buf }] }); if (r.ok) out.excel = rows.length; else out.skipped++; } else out.skipped++;
  // webhook
  const wh = String(cfg.publish_webhook_url || '').trim();
  if (wh && post && rows.length) { try { await post(wh, { kind: 'metrics', as_of: now.toISOString(), rows }); out.webhook = rows.length; } catch (_) { out.skipped++; } } else out.skipped++;
  // SharePoint list via Microsoft Graph (client credentials; secrets never logged)
  const sp = { tenant: cfg.sharepoint_tenant_id, client: cfg.sharepoint_client_id, secret: cfg.sharepoint_client_secret, site: cfg.sharepoint_site_id, list: cfg.sharepoint_list_id };
  if (Object.values(sp).every(Boolean) && post && rows.length) {
    try {
      const tok = await (post.token ? post.token(sp) : graphToken(sp));
      for (const r of rows) await post(`https://graph.microsoft.com/v1.0/sites/${sp.site}/lists/${sp.list}/items`, { fields: { Title: `${r.metric} · ${r.site}`, Metric: r.metric, Site: r.site, Window: r.window || '', Value: r.value, Unit: r.unit || '', Rag: r.rag, AsOf: r.as_of || now.toISOString() } }, { Authorization: `Bearer ${tok}` });
      out.sharepoint = rows.length;
    } catch (e) { out.skipped++; out.sharepoint_error = String(e.message || e).replace(/Bearer\s+\S+/g, 'Bearer <token>').slice(0, 200); }
  } else out.skipped++;
  out.rows = out.excel + out.webhook + out.sharepoint;
  return out;
}
async function graphToken(sp) {
  const axios = require('axios'); const body = new URLSearchParams({ client_id: sp.client, client_secret: sp.secret, scope: 'https://graph.microsoft.com/.default', grant_type: 'client_credentials' });
  const r = await axios.post(`https://login.microsoftonline.com/${encodeURIComponent(sp.tenant)}/oauth2/v2.0/token`, body.toString(), { timeout: 15000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  return r.data && r.data.access_token;
}

/** Adapter: the server's Anthropic-shaped `_execAiCall(body) → text` becomes `({system,user,maxTokens}) → text`. */
const aiCallFrom = (execAiCall) => ({ system, user, maxTokens }) => execAiCall({ system, messages: [{ role: 'user', content: user }], max_tokens: maxTokens || 700 });

/**
 * M4 — the default webhook poster: every URL is validated (https, no private / loopback /
 * metadata address unless on outbound_allow_hosts) right before the send, redirects are not
 * followed. An unsafe URL throws (code UNSAFE_URL) after a logged error — the callers count
 * it as a skip, so a scheduled job never dies on a bad URL.
 */
function safePostFor(cfg) {
  const S = require('./safeUrl');
  const post = S.safePost(S.allowHostsFromConfig(cfg), { timeout: 15000, headers: { 'Content-Type': 'application/json' } });
  return (url, body, headers) => post(url, body, headers ? { headers } : undefined);
}

/** Bind the four job functions to the live stores (server.js). `stores()` is read at call time (lazy). */
function bindJobs({ stores, aiProvider = 'off', execAiCall = null }) {
  const L = () => { const reportConfig = require('./reportConfig'), { buildMailer } = require('./mailer'), rdbM = require('../reports-db'); const dd = { rdb: rdbM, mdb: require('../meetings-db'), idb: require('../inspection-db'), adb: require('../assets-db'), tracker: require('../tracker-db'), trackerScore: require('../tracker-pptx') }; const reg = require('./metricRegistry').current(); return { reportConfig, buildMailer, rdbM, dd, reg, post: safePostFor }; };
  const mail = (cfg, l) => (cfg.smtp_host ? l.buildMailer(cfg) : null);
  return {
    evaluate: async () => { const l = L(), st = stores(); const cfg = await l.reportConfig.getConfig(l.rdbM.db); return evaluateAlerts({ store: st.eng, registry: l.reg, deps: l.dd, rdb: l.rdbM, mailer: mail(cfg, l), post: l.post(cfg), cfg, baseUrl: cfg.public_base_url || '' }); },
    digest: async (kind) => { const l = L(), st = stores(); const cfg = await l.reportConfig.getConfig(l.rdbM.db); return sendDigest({ store: st.eng, rdb: l.rdbM, mailer: mail(cfg, l), digest: kind, baseUrl: cfg.public_base_url || '' }); },
    reports: async (cadence) => { const l = L(), st = stores(); const cfg = await l.reportConfig.getConfig(l.rdbM.db); return generateScheduledReports({ cadence, reportStore: st.rep, dashStore: st.dash, engStore: st.eng, registry: l.reg, deps: l.dd, rdb: l.rdbM, aiProvider, aiCall: execAiCall ? aiCallFrom(execAiCall) : null, baseUrl: cfg.public_base_url || '' }); },
    publish: async () => { const l = L(), st = stores(); const cfg = await l.reportConfig.getConfig(l.rdbM.db); if (cfg.publish_cron_enabled !== '1') return { skipped: true }; return publishScheduled({ engStore: st.eng, reportStore: st.rep, registry: l.reg, deps: l.dd, rdb: l.rdbM, cfg, mailer: mail(cfg, l), post: l.post(cfg) }); },
  };
}

module.exports = { bindJobs, aiCallFrom, safePostFor, evaluateAlerts, sendDigest, generateScheduledReports, publishScheduled, readingsFor, resolveRecipients, teamsCard };
