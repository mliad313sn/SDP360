'use strict';
// Policy Control Center (ADR docs/ai-decisions/ADR-POLICY-CENTER.md) — one place to see and adapt every rule.
// Every route answers 404 while report_config policy_center_enabled = '0' (default): the existing admin cards
// (reports.html#admin, policies.html, kpi-builder.html) keep working unchanged either way.
//
//   GET  /policy-center.html                                 page                                            session (page checks super_admin)
//   GET  /api/policy-center/catalogue                        rules + current value + deviation + pending       super_admin
//   GET  /api/policy-center/rules/:key/history               who / when / old / new / reason                    super_admin
//   PUT  /api/policy-center/rules/:key                       { value | reset:true, scope, reason }              super_admin
//   GET  /api/policy-center/requests[?status=]               four-eyes requests (center + governance store)     super_admin
//   POST /api/policy-center/requests/:id/approve|reject      a SECOND super_admin decides (pc-<n> | gp-<n>)     super_admin
//   POST /api/policy-center/requests/:id/cancel              the requester withdraws                            super_admin
//   GET  /api/policy-center/export[?format=csv]              effective policy set (secrets: set / not set)      super_admin
//   POST /api/policy-center/operator-tokens                  one-time CLI operator token for the CALLER (P11 r6     super_admin
//                                                            R6-A1): shown once, 10 minutes, consumed by activate-switches
//   POST /api/policy-center/import                           environment profile — dry run first; applied only  super_admin
//                                                            with confirm:true + the plan_hash of that dry run
// Reads are super_admin only, like GET /api/reports/config (N-R4-2, P11 round 4): the center shows non-secret identity
// values (sso_breakglass_user, entra_tenant_id, base URLs, value history) the legacy read withholds from the admin tier.
// Secrets are never returned, never written here. Approvals are acts of logged-in users; nothing is inferred.
const crypto = require('crypto');
const { fail: httpFail, typed } = require('../services/httpError');

module.exports = function policyCenterRoutes(deps) {
  const { express, requireReportSession, requireSuperAdmin, sendHtmlPage } = deps;
  const router = express.Router();
  const json = express.json({ limit: '256kb' });
  const rdb = () => deps.rdb || require('../reports-db');
  const RC = deps.reportConfig || require('../services/reportConfig');
  const PC = require('../services/policyCatalogue');
  const GP = require('../services/governancePolicy');
  const gstore = () => deps.policyStore || GP.shared();
  const cstore = () => deps.changeStore || (deps._cs = deps._cs || require('../services/policyChangeStore').makePolicyChangeStore(() => rdb().pgHandle()));
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false });
  const isSuper = (u) => rdb().userHasRole(u, 'super_admin');
  const actorOf = (u) => ({ id: u.id, username: u.username, email: u.email, name: u.full_name, isAdmin: rdb().userHasRole(u, 'admin'), isSuper: isSuper(u) });
  const cfg = async () => RC.getConfig(rdb().db);
  async function enabled(req, res, next) {
    try { if (String((await cfg()).policy_center_enabled) === '1') return next(); } catch (_) { /* off */ }
    return httpFail(res, typed('NOT_FOUND', 'not found', 404), 404, { ok: false });
  }
  const log = async (req, ev) => { try { await rdb().logEvent({ ...ev, ...rdb()._logCtx(req) }); } catch (_) { /* best-effort: a log never breaks a change */ } };
  const URL_KEY = (k) => /(_url|_base_url|_accounts_url|_org_url)$/.test(k);
  const MIN_REASON = 5;

  async function sites() { try { return ((await rdb().listSites({ includeInactive: false })) || []).map((s) => ({ id: Number(s.id), name: s.name })); } catch (_) { return []; } }
  function entryOr404(key) {
    const e = PC.build().by.get(String(key || ''));
    if (!e) throw typed('NOT_FOUND', 'unknown rule', 404);
    return e;
  }
  function parseScope(entry, scope) {
    const s = String(scope || 'global');
    if (s === 'global') return s;
    const m = s.match(/^site:(\d+)$/);
    if (!m) throw typed('VALIDATION', 'scope is global or site:<id>', 400);
    if (!entry.scopes.includes('site')) throw typed('VALIDATION', `${entry.key} applies to the whole platform — no consumer reads a per-site value`, 400);
    return s;
  }

  /** The one change pipeline (PUT, approve, import). Returns { status: unchanged|applied|pending, … }. */
  async function changeRule(req, entry, { scope = 'global', value, reset = false, reason }) {
    const u = req.reportUser; const why = String(reason || '').trim();
    if (why.length < MIN_REASON) throw typed('VALIDATION', `a reason is required for every policy change (${MIN_REASON}+ characters)`, 400);
    const sc = parseScope(entry, scope);
    if (entry.source === 'governance_policy') {
      const out = await gstore().set({ scope: sc, key: entry.key, value: reset ? null : value, reason: why, actor: actorOf(u) });
      await log(req, { category: 'governance', action: out.pending ? 'policy_change_proposed' : 'policy_changed', target: `${out.scope}:${out.key}`, details: { before: out.before, after: out.after, reason: why.slice(0, 300), via: 'policy_center', proposal: out.pending ? out.pending.id : undefined }, risk: out.relaxes ? 1 : 0 });
      return out.pending ? { status: 'pending', request: 'gp-' + out.pending.id, before: out.before, after: out.after }
        : { status: JSON.stringify(out.before) === JSON.stringify(out.after) ? 'unchanged' : 'applied', before: out.before, after: out.after };
    }
    if (entry.source !== 'report_config' || !entry.editable) throw typed('VALIDATION', `${entry.key} is not editable here`, 400);
    const cur = await cfg();
    const next = reset ? String(entry.default) : PC.validateConfigValue(entry, value);
    const before = String(cur[entry.key] == null ? '' : cur[entry.key]);
    if (before === next) return { status: 'unchanged', before, after: next };
    if (URL_KEY(entry.key) && next) {
      const safeUrl = require('../services/safeUrl');
      try { await safeUrl.validateOutboundUrl(next, { allowHosts: safeUrl.allowHostsFromConfig(cur) }); }
      catch (e) { throw typed('VALIDATION', `${entry.key}: ${e.message}`, 400); }
    }
    if (PC.needsSecondPerson(entry, before, next)) {
      if (why.length < 10) throw typed('VALIDATION', 'a high-risk change needs a reason (10+ characters)', 400);
      const r = await cstore().create({ key: entry.key, scope: 'global', oldValue: before, newValue: next, reason: why, actor: actorOf(u) });
      await log(req, { category: 'config', action: 'policy_change_requested', target: entry.key, details: { request: r.id, from: before, to: next, reason: why.slice(0, 300) }, risk: 1 });
      return { status: 'pending', request: 'pc-' + r.id, before, after: next };
    }
    await applyConfig(req, entry.key, before, next, why);
    return { status: 'applied', before, after: next, warnings: require('../services/switchPrereqs').warningsFor({ [entry.key]: next }, cur) };
  }
  async function applyConfig(req, key, before, next, why) {
    await RC.setConfig(rdb().db, { [key]: next }, req.reportUser.username);
    try { require('../services/ssoSettings')._invalidate(); } catch (_) {}
    try { require('../services/dashKeyScope')._invalidate(); } catch (_) {}
    const J = require('../services/configJournal');
    J.journal((ev) => rdb().logEvent(ev), J.diffConfig({ [key]: before }, { [key]: next }, { keys: RC.KEYS, secretSet: RC._SECRET_BLANK_KEEP }), rdb()._logCtx(req), '[policy-center] ' + why);
  }

  router.get('/policy-center.html', enabled, (req, res) => sendHtmlPage(res, 'policy-center.html', false, 'Policy center unavailable'));

  router.get('/api/policy-center/catalogue', requireReportSession, requireSuperAdmin, enabled, async (req, res) => {
    try {
      const b = PC.build(); const c = await cfg(); const siteList = await sites();
      const view = new Map(((await gstore().view({ siteIds: siteList.map((s) => s.id) })) || []).map((v) => [v.key, v]));
      const pend = new Map(); for (const r of await cstore().list({ status: 'pending' })) pend.set(r.key, 'pc-' + r.id);
      for (const p of (await gstore().listProposals({ status: 'pending' })) || []) pend.set(p.key, 'gp-' + p.id);
      const rules = b.entries.map((e) => {
        let current, sitesVals = null;
        if (e.source === 'report_config') current = e.secret ? null : String(c[e.key] == null ? '' : c[e.key]);
        else { const v = view.get(e.key) || {}; current = v.effective !== undefined ? v.effective : e.default; sitesVals = v.sites || {}; }
        const siteDev = sitesVals ? Object.entries(sitesVals).filter(([, v]) => JSON.stringify(v) !== JSON.stringify(e.default)).map(([s]) => Number(s)) : [];
        return { ...e, current, secret_set: e.secret ? !!c[e.key] : undefined, site_values: sitesVals,
          deviates: e.secret ? false : PC.deviates(e, current), site_deviations: siteDev, pending: pend.get(e.key) || null };
      });
      res.json({ ok: true, can_write: isSuper(req.reportUser), catalogue_missing: !!b.catalogue_missing, catalogue_error: b.catalogue_error || null, categories: b.categories, rules, kpi_policies: b.kpi_policies,
        excluded: b.excluded, coverage: PC.coverage(), sites: siteList });
    } catch (e) { fail(res, e); }
  });

  router.get('/api/policy-center/rules/:key/history', requireReportSession, requireSuperAdmin, enabled, async (req, res) => {
    try {
      const e = entryOr404(req.params.key);
      let rows = [];
      if (e.source === 'report_config') {
        const { rows: logs } = await rdb().listSystemLog({ category: 'config', action: 'config_changed', q: e.key }, { limit: 500 });
        rows = require('../services/configJournal').historyRows(logs).filter((r) => r.key === e.key).map((r) => ({ at: r.ts, scope: 'global', who: r.actor, from: e.secret ? undefined : r.from, to: e.secret ? undefined : r.to, change: r.change, reason: r.reason }));
      } else if (e.source === 'governance_policy') {
        const names = {}; for (const x of (await rdb().listUsers()) || []) names[Number(x.id)] = x.full_name || x.username;
        rows = ((await gstore().history({ key: e.key, limit: 200 })) || []).map((h) => ({ at: h.at, scope: h.scope, who: names[Number(h.actor_id)] || (h.actor_id == null ? null : '#' + h.actor_id),
          from: h.old_value === undefined ? null : h.old_value, to: h.new_value, reason: h.reason, second_person: h.approved_by != null ? (names[Number(h.approved_by)] || '#' + h.approved_by) : null }));
      }
      const requests = e.source === 'report_config' ? await cstore().list({ status: null, key: e.key, limit: 50 }) : [];
      res.json({ ok: true, key: e.key, history: rows, requests: requests.map((r) => ({ ...r, id: 'pc-' + r.id })) });
    } catch (err) { fail(res, err); }
  });

  router.put('/api/policy-center/rules/:key', requireReportSession, requireSuperAdmin, enabled, json, async (req, res) => {
    try {
      const e = entryOr404(req.params.key); const b = req.body || {};
      if (!b.reset && !('value' in b)) throw typed('VALIDATION', 'value (or reset: true) is required', 400);
      const out = await changeRule(req, e, { scope: b.scope, value: b.value, reset: b.reset === true, reason: b.reason });
      res.status(out.status === 'pending' ? 202 : 200).json({ ok: true, key: e.key, ...out });
    } catch (err) { fail(res, err); }
  });

  router.get('/api/policy-center/requests', requireReportSession, requireSuperAdmin, enabled, async (req, res) => {
    try {
      const st = req.query.status === 'all' ? null : String(req.query.status || 'pending');
      const pc = (await cstore().list({ status: st })).map((r) => ({ id: 'pc-' + r.id, source: 'policy_center', key: r.key, scope: r.scope, from: r.old_value, to: r.new_value,
        reason: r.reason, requested_by: r.requested_by_name || '#' + r.requested_by, requested_at: r.requested_at, expires_at: r.expires_at, status: r.status,
        decided_by: r.decided_by_name || null, decided_at: r.decided_at, decision_reason: r.decision_reason, mine: Number(r.requested_by) === Number(req.reportUser.id),
        _requester: r.requested_by }));
      // P11 r7 R7-A1 — what can be established about the operator token a CLI-filed request names (issuance event,
      // server binding, same account): shown to the approver, never a substitute for the approver's own judgement.
      const OT = require('../services/operatorTokens'); const tdb = rdb().pgHandle ? rdb().pgHandle() : rdb().db;
      for (const x of pc) { x.operator_token = await OT.evidenceForRequest(tdb, x.reason, x._requester); delete x._requester; }
      const names = {}; for (const x of (await rdb().listUsers()) || []) names[Number(x.id)] = x.full_name || x.username;
      const gp = ((await gstore().listProposals({ status: st })) || []).map((p) => ({ id: 'gp-' + p.id, source: 'governance_policy', key: p.key, scope: p.scope, from: null, to: p.value,
        reason: p.reason, requested_by: names[p.proposed_by] || '#' + p.proposed_by, requested_at: p.proposed_at, expires_at: p.expires_at, status: p.status,
        decided_by: p.decided_by == null ? null : (names[p.decided_by] || '#' + p.decided_by), decided_at: p.decided_at, decision_reason: p.decision_reason, mine: Number(p.proposed_by) === Number(req.reportUser.id) }));
      res.json({ ok: true, requests: [...pc, ...gp].sort((a, b) => String(b.requested_at).localeCompare(String(a.requested_at))) });
    } catch (e) { fail(res, e); }
  });

  const decide = (decision) => async (req, res) => {
    try {
      const m = String(req.params.id).match(/^(pc|gp)-(\d+)$/);
      if (!m) throw typed('VALIDATION', 'request id is pc-<n> or gp-<n>', 400);
      const u = req.reportUser; const reason = req.body && req.body.reason;
      if (decision === 'approve') {   // P11 R4-A2(b): the approver must be independent of the requester (identity journal)
        const requesterId = m[1] === 'pc' ? ((await cstore().get(Number(m[2]))) || {}).requested_by
          : (((await gstore().listProposals({ status: null })) || []).find((p) => Number(p.id) === Number(m[2])) || {}).proposed_by;
        // P11 r7 R7-A1 — a request that says it was filed under an operator token must point at a token the server
        // issued (binding valid, operator_token_issued event present, same account); otherwise it is a forged record.
        if (m[1] === 'pc') {
          const pr = (await cstore().get(Number(m[2]))) || {};
          const ev = await require('../services/operatorTokens').evidenceForRequest(rdb().pgHandle ? rdb().pgHandle() : rdb().db, pr.reason, pr.requested_by);
          if (ev && !(ev.issued_event && ev.binding_ok && ev.account_matches)) {
            await log(req, { category: 'config', action: 'policy_approval_refused', target: req.params.id, details: { reason: 'operator token not verifiable', operator_token: ev }, risk: 1 });
            throw typed('CONFLICT', `this request names operator token #${ev.id}, but ${!ev.issued_event ? 'no operator_token_issued event exists for it' : !ev.binding_ok ? 'the token was not issued by the server (no valid binding)' : 'the token belongs to another account'} — refused as a possibly forged request`, 409);
          }
        }
        if (requesterId != null && Number(requesterId) !== Number(u.id)) {
          const ind = await require('../services/approverProvenance').checkIndependent({ db: rdb().db, requesterId, approver: u });
          if (!ind.ok) {
            await log(req, { category: 'config', action: 'policy_approval_refused', target: req.params.id, details: { reason: ind.reason }, risk: 1 });
            throw typed('FORBIDDEN', `a second, independent super_admin must approve: ${ind.reason}`, 403);
          }
        }
      }
      if (m[1] === 'gp') {
        if (decision === 'cancel') throw typed('VALIDATION', 'a governance proposal lapses on its own after 7 days; another super_admin can reject it', 400);
        const out = await gstore().decide(Number(m[2]), decision, { actor: { id: u.id, isSuper: isSuper(u) }, reason });
        await log(req, { category: 'governance', action: out.status === 'approved' ? 'policy_relaxed' : 'policy_relaxation_rejected', target: `${out.scope}:${out.key}`, details: { proposal: out.id, via: 'policy_center' }, risk: 1 });
        return res.json({ ok: true, request: 'gp-' + out.id, status: out.status });
      }
      let out;
      try {
        out = await cstore().decide(Number(m[2]), decision, { actor: actorOf(u), reason,
        currentValue: async (key) => (await cfg())[key],
        apply: async (r) => {
          const e = entryOr404(r.key);
          const next = PC.validateConfigValue(e, r.new_value);   // re-validated against today's rules
          await applyConfig(req, r.key, r.old_value, next, `approved request pc-${r.id} (requested by ${r.requested_by_name}): ${r.reason} | approval: ${String(reason || '').trim()}`);
        } });
      } catch (e) {
        // P11 r8 N-R8-1 — the approval was recorded but the apply refused: the store marked the request 'failed';
        // journal it (who approved, the cause) so the register and the journal both tell the truth.
        if (e && e.policyRequest && e.policyRequest.status === 'failed') {
          const f = e.policyRequest;
          await log(req, { category: 'config', action: 'policy_change_failed', target: f.key, details: { request: f.id, from: f.old_value, to: f.new_value, reason: String(reason || '').slice(0, 300), cause: String(e.message || '').slice(0, 300) }, risk: 1 });
        }
        throw e;
      }
      await log(req, { category: 'config', action: 'policy_change_' + out.status, target: out.key, details: { request: out.id, from: out.old_value, to: out.new_value, reason: String(reason || '').slice(0, 300) }, risk: 1 });
      res.json({ ok: true, request: 'pc-' + out.id, status: out.status });
    } catch (e) { fail(res, e); }
  };
  router.post('/api/policy-center/requests/:id/approve', requireReportSession, requireSuperAdmin, enabled, json, decide('approve'));
  router.post('/api/policy-center/requests/:id/reject', requireReportSession, requireSuperAdmin, enabled, json, decide('reject'));
  router.post('/api/policy-center/requests/:id/cancel', requireReportSession, requireSuperAdmin, enabled, json, decide('cancel'));

  // P11 r6 R6-A1 — a CLI operator token for the logged-in super_admin. tools/ops/activate-switches.js consumes it to
  // learn who runs it: four-eyes requests it files carry THIS account as requester (never a typed --operator name), and
  // the approval stays an act of another, independent super_admin in this page. The token is returned once.
  router.post('/api/policy-center/operator-tokens', requireReportSession, requireSuperAdmin, enabled, json, async (req, res) => {
    try {
      const u = req.reportUser;
      const OT = require('../services/operatorTokens');
      if (!OT.bindingKey()) throw typed('CONFLICT', 'operator tokens are refused: SDP_CONFIG_KEY is not set on this server (the token binding needs it — fail closed)', 409);
      const out = await OT.issue(rdb().pgHandle ? rdb().pgHandle() : rdb().db, u);
      await log(req, { category: 'config', action: 'operator_token_issued', target: String(u.username || u.id), details: { token_id: out.id, expires_at: out.expires_at, purpose: 'activate-switches' }, risk: 1 });
      res.json({ ok: true, token: out.token, expires_at: out.expires_at, ttl_minutes: out.ttl_minutes, username: u.username });
    } catch (e) { fail(res, e); }
  });

  // ── export / import ──────────────────────────────────────────────────────────────────────────
  async function effectiveSet() {
    const b = PC.build(); const c = await cfg(); const siteList = await sites();
    const view = new Map(((await gstore().view({ siteIds: siteList.map((s) => s.id) })) || []).map((v) => [v.key, v]));
    return b.entries.map((e) => {
      if (e.source === 'report_config') return { key: e.key, source: e.source, category: e.category, scope: 'global', value: e.secret ? (c[e.key] ? '(set)' : '(not set)') : String(c[e.key] == null ? '' : c[e.key]), default: e.secret ? null : e.default, secret: e.secret };
      const v = view.get(e.key) || {};
      return { key: e.key, source: e.source, category: e.category, scope: 'global', value: v.effective !== undefined ? v.effective : e.default, default: e.default, site_values: v.sites || {} };
    });
  }
  router.get('/api/policy-center/export', requireReportSession, requireSuperAdmin, enabled, require('../services/exportPolicy').gate('reports.policy_set'), async (req, res) => {
    try {
      const rows = await effectiveSet(); const at = new Date().toISOString();
      await log(req, { category: 'export', action: 'policy_center_export', target: 'policy_set', details: { format: req.query.format === 'csv' ? 'csv' : 'json', rows: rows.length } });
      if (req.query.format === 'csv') {
        const { neutralize } = require('../public/lib/csvSafe');
        const q = (v) => '"' + String(neutralize(v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v)).replace(/"/g, '""') + '"';
        const lines = [['key', 'source', 'category', 'scope', 'value', 'best_practice_default', 'deviates'].map(q).join(',')];
        for (const r of rows) {
          lines.push([r.key, r.source, r.category, 'global', r.value, r.default, r.secret ? '' : String(JSON.stringify(r.value) !== JSON.stringify(r.default))].map(q).join(','));
          for (const [sid, v] of Object.entries(r.site_values || {})) lines.push([r.key, r.source, r.category, 'site:' + sid, v, r.default, String(JSON.stringify(v) !== JSON.stringify(r.default))].map(q).join(','));
        }
        res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', 'attachment; filename="policy-set.csv"');
        return res.send('﻿' + lines.join('\r\n'));
      }
      // the export doubles as an environment profile: { profile: { values, sites } } can be re-imported elsewhere
      const values = {}, sitesOut = {};
      for (const r of rows) { if (r.secret) continue; values[r.key] = r.value; for (const [sid, v] of Object.entries(r.site_values || {})) (sitesOut[sid] = sitesOut[sid] || {})[r.key] = v; }
      res.setHeader('Content-Disposition', 'attachment; filename="policy-set.json"');
      res.json({ ok: true, exported_at: at, rules: rows, profile: { name: 'export ' + at.slice(0, 10), values, sites: sitesOut } });
    } catch (e) { fail(res, e); }
  });

  /** Dry-run plan of a profile: one row per (key, scope); nothing written. */
  async function planProfile(profile) {
    const b = PC.build(); const c = await cfg(); const siteList = await sites(); const siteIds = new Set(siteList.map((s) => s.id));
    const view = new Map(((await gstore().view({ siteIds: [...siteIds] })) || []).map((v) => [v.key, v]));
    const rows = [];
    const add = (key, scope, proposed) => {
      const e = b.by.get(key);
      if (!e) return rows.push({ key, scope, proposed, action: 'unknown', error: 'not a rule of this platform' });
      if (e.secret || !e.editable) return rows.push({ key, scope, action: 'forbidden', error: 'secrets are never imported — set them in their admin card' });
      try {
        const sc = parseScope(e, scope);
        if (e.source === 'report_config') {
          const next = PC.validateConfigValue(e, proposed); const cur = String(c[key] == null ? '' : c[key]);
          rows.push({ key, scope: sc, current: cur, proposed: next, risk: e.risk, action: cur === next ? 'unchanged' : PC.needsSecondPerson(e, cur, next) ? 'four_eyes' : 'apply' });
        } else {
          const p = GP.BY_KEY.get(key); const next = GP.coerce(p, proposed); const v = view.get(key) || {};
          const cur = sc === 'global' ? (v.global !== undefined ? v.global : null) : ((v.sites || {})[sc.slice(5)] !== undefined ? v.sites[sc.slice(5)] : null);
          if (sc !== 'global' && !siteIds.has(Number(sc.slice(5)))) throw typed('VALIDATION', 'unknown or inactive site', 400);
          const eff = sc === 'global' ? (v.effective !== undefined ? v.effective : p.default) : null;
          rows.push({ key, scope: sc, current: cur, proposed: next, risk: e.risk, action: JSON.stringify(cur != null ? cur : eff) === JSON.stringify(next) ? 'unchanged' : p.protected ? 'governance_check' : 'apply' });
        }
      } catch (err) { rows.push({ key, scope, proposed, action: 'invalid', error: err.message }); }
    };
    for (const [k, v] of Object.entries((profile && profile.values) || {})) add(k, 'global', v);
    for (const [sid, vals] of Object.entries((profile && profile.sites) || {})) for (const [k, v] of Object.entries(vals || {})) add(k, 'site:' + Number(sid), v);
    return rows;
  }
  const hashPlan = (rows) => crypto.createHash('sha256').update(JSON.stringify(rows.map((r) => [r.key, r.scope, r.proposed, r.action]))).digest('hex');
  router.post('/api/policy-center/import', requireReportSession, requireSuperAdmin, enabled, json, async (req, res) => {
    try {
      const b = req.body || {}; const profile = b.profile || {};
      if (typeof profile !== 'object' || (!profile.values && !profile.sites)) throw typed('VALIDATION', 'profile.values and/or profile.sites are required', 400);
      const rows = await planProfile(profile); const plan_hash = hashPlan(rows);
      const summary = rows.reduce((a, r) => (a[r.action] = (a[r.action] || 0) + 1, a), {});
      if (b.confirm !== true) return res.json({ ok: true, dry_run: true, plan: rows, summary, plan_hash });
      if (b.plan_hash !== plan_hash) throw typed('CONFLICT', 'the plan changed since the dry run (or no dry run was made) — run the dry run again and confirm that plan', 409);
      const why = String(b.reason || '').trim();
      if (why.length < 10) throw typed('VALIDATION', 'importing a profile needs a reason (10+ characters)', 400);
      const results = [];
      for (const r of rows) {
        if (!['apply', 'four_eyes', 'governance_check'].includes(r.action)) { results.push({ key: r.key, scope: r.scope, status: r.action }); continue; }
        try { const out = await changeRule(req, PC.build().by.get(r.key), { scope: r.scope, value: r.proposed, reason: `profile "${String(profile.name || '').slice(0, 60)}": ${why}` }); results.push({ key: r.key, scope: r.scope, ...out }); }
        catch (err) { results.push({ key: r.key, scope: r.scope, status: 'error', error: err.message }); }
      }
      await log(req, { category: 'config', action: 'policy_profile_imported', target: 'policy_set', details: { name: profile.name || null, rows: rows.length, applied: results.filter((x) => x.status === 'applied').length, pending: results.filter((x) => x.status === 'pending').length, reason: why.slice(0, 300) }, risk: 1 });
      res.json({ ok: true, dry_run: false, results, plan_hash });
    } catch (e) { fail(res, e); }
  });

  return router;
};
