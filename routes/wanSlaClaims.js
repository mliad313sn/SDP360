'use strict';
// P8 / goal B1 — SLA credit claims: from "due" to "recovered". Mounted by routes/opmanager.js on its router.
// Every route answers 404 while report_config wan_sla_claims_enabled = '0' (the default = today, nothing exists).
//
//   GET  /api/analytics/wan/sla/claims/status          readiness: arm flags, Teams SLA alerts readiness (no secret value)
//   GET  /api/analytics/wan/sla/claims                 list (?period=YYYY-MM | ?quarter=YYYY-Qn, ?status=) + aging + stale
//   GET  /api/analytics/wan/sla/claims/value           USD + per-currency due vs claimed vs recovered per quarter, aging
//   POST /api/analytics/wan/sla/claims                 open a claim (status due) — admin tier
//   GET  /api/analytics/wan/sla/claims/:id             one claim + its audit trail
//   PUT  /api/analytics/wan/sla/claims/:id             owner, notes, evidence links — admin tier
//   POST /api/analytics/wan/sla/claims/:id/transition  {to, motive, claimed_amount?, credited_amount?, reopen?} — admin tier
//   GET  /api/analytics/wan/sla/claims/:id/evidence.csv | evidence.html | evidence.pdf   evidence pack
//   POST /api/analytics/wan/sla/claims/:id/notify/preview | request | approve | send     operator notification
//
// Read rule: the admin tier and finance-viewer read every site; anyone else only the claims of their own site(s)
// (no site → nothing). Amounts (due / claimed / credited, MRC) are served to the admin tier and finance-viewer only
// (invariant 2) — everyone else gets the claim with money_hidden: true. Writes: admin tier. Source systems are only
// READ (wan_outages is our own archive of Meraki); the operator is reached by e-mail through services/mailer only,
// and only when the existing arm flag (sla_wan_config.notify.enabled) is on, notifications_stop is off, and a second
// person approved that claim's notification.
const { fail, typed } = require('../services/httpError');

module.exports = function wanSlaClaimsRoutes(deps) {
  const { express, requireReportSession, requireAdmin } = deps;
  const router = express.Router();
  const rdb = require('../reports-db');
  const reportConfig = require('../services/reportConfig');
  const W = require('../services/wanSlaClaims');
  const { computeBasis, makeClaimsStore } = require('../services/wanSlaClaimsStore');
  const { parseSlaWanConfig, resolveCircuit } = require('../services/slaWanConfig');
  const userSites = require('../services/userSites');
  const BASE = '/api/analytics/wan/sla/claims';

  const store = () => makeClaimsStore(rdb.pgHandle());
  const cfg = async () => reportConfig.getConfig(rdb.db);
  const on = (c) => String(c && c.wan_sla_claims_enabled) === '1';
  const _canReadMoney = (u) => rdb.userHasRole(u, 'admin') || rdb.userHasRole(u, 'finance-viewer');
  const _allSites = (u) => _canReadMoney(u);
  const _inScope = (u, siteId) => _allSites(u) || userSites.siteIds(u).includes(Number(siteId));
  const notFound = (res) => fail(res, typed('NOT_FOUND', 'not found'), 404, { ok: false });

  // Every route of this file: the switch first (404 while off, even for a super_admin).
  async function gate(req, res) {
    const c = await cfg();
    if (!on(c)) { notFound(res); return null; }
    return c;
  }
  async function loadClaim(req, res) {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) { notFound(res); return null; }
    const claim = await store().get(id);
    if (!claim || !_inScope(req.reportUser, claim.site_id)) { notFound(res); return null; }   // out of scope = not found
    return claim;
  }
  async function siteNames() {
    const m = {};
    try { for (const s of ((await rdb.listSites({ includeInactive: true })) || [])) m[s.id] = s.name; } catch (_) { /* names are cosmetic */ }
    return m;
  }
  // Stale = the outages or contract parameters changed since the claim was frozen (compared, never recomputed in place).
  async function withStale(claim, c, nowMs) {
    try {
      const basis = await computeBasis(rdb, c, { site_id: claim.site_id, sub_site: claim.sub_site, uplink: claim.uplink, period: claim.period, nowMs });
      return { ...claim, stale: basis ? basis.hash !== claim.evidence_hash : true, circuit_mapped: !!basis };
    } catch (_) { return { ...claim, stale: null, circuit_mapped: null }; }
  }
  const present = (claim, u, nowMs, names) => ({ ...W.maskClaim(claim, _canReadMoney(u)), site_name: names[claim.site_id] || null, ...W.aging(claim, nowMs) });

  router.get(BASE + '/status', requireReportSession, async (req, res) => {
    try {
      const c = await gate(req, res); if (!c) return;
      const sla = parseSlaWanConfig(c.sla_wan_config);
      res.json({ enabled: true, can_write: rdb.userHasRole(req.reportUser, 'admin'), can_read_money: _canReadMoney(req.reportUser),
        operator_notification: { armed: !!(sla.notify && sla.notify.enabled), stopped: String(c.notifications_stop) === '1', approval_required: true },
        // Teams real-time SLA alerts (services/teamsSla.js, tools/teams/poll-sla.js) — READINESS only, never armed from here.
        teams_sla_alerts: { armed: String(c.teams_sla_enabled) === '1',
          token_present: !!(c.sdp_api_client_id && c.sdp_api_client_secret && c.sdp_api_refresh_token),
          channels_configured: !!String(c.teams_sla_channels || '').trim(), last_run: c.teams_sla_last_run || null } });
    } catch (e) { fail(res, e); }
  });

  router.get(BASE, requireReportSession, async (req, res) => {
    try {
      const c = await gate(req, res); if (!c) return;
      const q = {};
      if (req.query.period) { if (!W.periodBounds(req.query.period)) throw typed('INVALID', 'period must be YYYY-MM'); q.period = String(req.query.period); }
      if (req.query.quarter) { const ps = W.periodsOfQuarter(req.query.quarter); if (!ps) throw typed('INVALID', 'quarter must be YYYY-Qn'); q.periods = ps; }
      if (req.query.status) { if (!W.STATUSES.includes(String(req.query.status))) throw typed('INVALID', 'unknown status'); q.status = String(req.query.status); }
      const nowMs = Date.now(), names = await siteNames();
      const rows = (await store().list(q)).filter((x) => _inScope(req.reportUser, x.site_id));
      const out = [];
      for (const r of rows) out.push(present(await withStale(r, c, nowMs), req.reportUser, nowMs, names));
      res.json({ claims: out, money_hidden: !_canReadMoney(req.reportUser) });
    } catch (e) { fail(res, e); }
  });

  router.get(BASE + '/value', requireReportSession, async (req, res) => {
    try {
      const c = await gate(req, res); if (!c) return;
      if (!_canReadMoney(req.reportUser)) throw typed('FORBIDDEN', 'amounts are restricted to the admin tier and finance-viewer');
      const q = {};
      if (req.query.quarter) { const ps = W.periodsOfQuarter(req.query.quarter); if (!ps) throw typed('INVALID', 'quarter must be YYYY-Qn'); q.periods = ps; }
      const { parseRates } = require('../services/currency');
      const rates = parseRates(c.asset_currency_rates, c.xof_usd_rate);
      res.json({ quarters: W.valueTotals(await store().list(q), { rates, nowMs: Date.now() }),
        fx: { source: 'report_config xof_usd_rate / asset_currency_rates', certified: false,
          note: 'USD is indicative; per-currency totals are the reference and are never added together' } });
    } catch (e) { fail(res, e); }
  });

  router.post(BASE, requireReportSession, requireAdmin, express.json(), async (req, res) => {
    try {
      const c = await gate(req, res); if (!c) return;
      const b = req.body || {};
      const site_id = Number(b.site_id), uplink = String(b.uplink || ''), sub_site = String(b.sub_site || ''), period = String(b.period || '');
      if (!Number.isInteger(site_id) || !/^wan\d$/.test(uplink)) throw typed('INVALID', 'site_id and uplink (wan1/wan2) are required');
      if (!W.periodBounds(period)) throw typed('INVALID', 'period must be YYYY-MM');
      const nowMs = Date.now();
      if (!W.isClosedPeriod(period, nowMs)) throw typed('INVALID', 'a claim is opened on a closed month only (the current month is provisional)');
      const basis = await computeBasis(rdb, c, { site_id, sub_site, uplink, period, nowMs });
      if (!basis) throw typed('INVALID', 'this circuit is not mapped in Admin → SLA WAN');
      if (!basis.sla.credit_due) throw typed('INVALID', 'no credit is due for this circuit and month (availability met the target)');
      const claim = await store().create(basis, { period, owner_user_id: b.owner_user_id, owner_name: b.owner_name, notes: b.notes, evidence_links: b.evidence_links }, req.reportUser);
      res.json({ ok: true, claim: present({ ...claim, stale: false }, req.reportUser, nowMs, await siteNames()) });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });

  router.get(BASE + '/:id', requireReportSession, async (req, res) => {
    try {
      const c = await gate(req, res); if (!c) return;
      const claim = await loadClaim(req, res); if (!claim) return;
      const nowMs = Date.now();
      const money = _canReadMoney(req.reportUser);
      const events = (await store().events(claim.id)).map((e) => (money || !e.details ? e : { ...e, details: { ...e.details, due_amount: undefined, claimed_amount: undefined, credited_amount: undefined, money_hidden: true } }));
      res.json({ claim: present(await withStale(claim, c, nowMs), req.reportUser, nowMs, await siteNames()), events });
    } catch (e) { fail(res, e); }
  });

  router.put(BASE + '/:id', requireReportSession, requireAdmin, express.json(), async (req, res) => {
    try {
      const c = await gate(req, res); if (!c) return;
      const claim = await loadClaim(req, res); if (!claim) return;
      const out = await store().update(claim.id, req.body, req.reportUser);
      res.json({ ok: true, claim: present(out, req.reportUser, Date.now(), await siteNames()) });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });

  router.post(BASE + '/:id/transition', requireReportSession, requireAdmin, express.json(), async (req, res) => {
    try {
      const c = await gate(req, res); if (!c) return;
      const claim = await loadClaim(req, res); if (!claim) return;
      const b = req.body || {};
      const nowMs = Date.now();
      // due → claimed: the claim goes to the operator on the LATEST evidence — recompute and freeze again.
      let refreeze = null;
      if (claim.status === 'due' && b.to === 'claimed' && !b.reopen) {
        refreeze = await computeBasis(rdb, c, { site_id: claim.site_id, sub_site: claim.sub_site, uplink: claim.uplink, period: claim.period, nowMs });
        if (!refreeze) throw typed('INVALID', 'this circuit is no longer mapped in Admin → SLA WAN — nothing to claim on');
      }
      const out = await store().transition(claim.id, { to: String(b.to || ''), motive: b.motive, claimed_amount: b.claimed_amount, credited_amount: b.credited_amount, reopen: b.reopen === true || b.reopen === '1' }, req.reportUser, { refreeze });
      res.json({ ok: true, claim: present(out, req.reportUser, nowMs, await siteNames()) });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });

  // ── evidence pack ──────────────────────────────────────────────────────────────────────────────
  async function evidence(req, res) {
    const c = await gate(req, res); if (!c) return null;
    const claim = await loadClaim(req, res); if (!claim) return null;
    const nowMs = Date.now();
    const basis = await computeBasis(rdb, c, { site_id: claim.site_id, sub_site: claim.sub_site, uplink: claim.uplink, period: claim.period, nowMs });
    const money = _canReadMoney(req.reportUser);
    const shown = W.maskClaim(claim, money);
    const names = await siteNames();
    const rows = basis ? W.outageBreakdown(basis.outages, basis.circuit, { monthStart: basis.bounds.monthStart, monthEnd: basis.bounds.monthEnd, nowMs, clockStart: basis.clockStart, triggerMinutes: basis.triggerMinutes }) : [];
    const p = (claim.calc && claim.calc.params) || {};
    const amt = (v) => (v == null ? (money ? 'unknown' : '— (restricted)') : `${v} ${claim.currency || ''}`.trim());
    const header = [
      ['Claim', `#${claim.id}`], ['Status', claim.status], ['Site', names[claim.site_id] || claim.site_id], ['Sub-site', claim.sub_site || ''],
      ['Uplink', claim.uplink], ['ISP', claim.isp || ''], ['Circuit', claim.circuit_id || ''], ['Month', claim.period],
      ['Contract target (%)', p.availability_target_pct], ['Minimum outage (min)', p.min_outage_minutes], ['Credit model', p.credit_model],
      ['Credit schedule', JSON.stringify(p.credit_schedule || [])], ['Credit cap (%)', p.credit_cap_pct], ['Service hours', JSON.stringify(p.service_hours || {})],
      ['Clock start', p.clock_start], ['Trigger (min)', p.trigger_minutes], ['Monthly charge (MRC)', money ? amt(p.mrc_amount) : '— (restricted)'],
      ['Availability in service hours (%)', claim.calc ? claim.calc.availability_pct : ''], ['Credit tier (%)', claim.calc ? claim.calc.credit_pct : ''],
      ['Counted downtime (s)', claim.calc ? claim.calc.counted_downtime_s : ''], ['Service seconds', claim.calc ? claim.calc.service_seconds : ''],
      ['Due amount (frozen)', amt(shown.due_amount)], ['Claimed amount', amt(shown.claimed_amount)], ['Credited amount', amt(shown.credited_amount)],
      ['Contract certified', claim.calc && claim.calc.certified ? 'yes' : 'no — estimate'], ['Frozen at', claim.frozen_at],
      ['Evidence hash (sha256)', claim.evidence_hash], ['Stale vs evidence', basis ? (basis.hash !== claim.evidence_hash ? 'YES — outages or contract changed since the freeze' : 'no') : 'circuit no longer mapped'],
      ['Source', 'wan_outages archive (Meraki event log + 5-min poller), kept beyond the Meraki retention window'],
    ];
    return { claim, header, rows, names };
  }
  const COLS = ['detected_start', 'restored_end', 'notified_at', 'uplink', 'attribution', 'attribution_reason', 'wall_s', 'counted_s', 'counts', 'why'];
  const csvCell = (v) => '"' + require('../public/lib/csvSafe').neutralize(v == null ? '' : v).replace(/"/g, '""') + '"';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  function evidenceHtml(ev) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>SLA claim #${ev.claim.id} — evidence</title>`
      + '<style>body{font-family:Arial,sans-serif;font-size:12px;margin:24px}table{border-collapse:collapse;margin-bottom:16px}td,th{border:1px solid #999;padding:3px 6px;text-align:left}</style></head><body>'
      + `<h1>SLA credit claim #${ev.claim.id} — evidence pack</h1><table>` + ev.header.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('') + '</table>'
      + `<h2>Outages of the month (${ev.rows.length})</h2><table><tr>` + COLS.map((c) => `<th>${esc(c)}</th>`).join('') + '</tr>'
      + ev.rows.map((r) => '<tr>' + COLS.map((c) => `<td>${esc(r[c])}</td>`).join('') + '</tr>').join('') + '</table>'
      + '<p>counted_s = seconds inside the contract service hours, from the contract clock start, within the month, ISP-attributed outages only.</p></body></html>';
  }
  router.get(BASE + '/:id/evidence.csv', requireReportSession, async (req, res) => {
    try {
      const ev = await evidence(req, res); if (!ev) return;
      const lines = ev.header.map(([k, v]) => [csvCell(k), csvCell(v)].join(','));
      lines.push('', COLS.map(csvCell).join(','));
      for (const r of ev.rows) lines.push(COLS.map((c) => csvCell(r[c])).join(','));
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="sla-claim-${ev.claim.id}-${ev.claim.period}.csv"`);
      res.send('﻿' + lines.join('\r\n'));
    } catch (e) { fail(res, e); }
  });
  router.get(BASE + '/:id/evidence.html', requireReportSession, async (req, res) => {
    try {
      const ev = await evidence(req, res); if (!ev) return;
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="sla-claim-${ev.claim.id}-${ev.claim.period}.html"`);
      res.send(evidenceHtml(ev));
    } catch (e) { fail(res, e); }
  });
  router.get(BASE + '/:id/evidence.pdf', requireReportSession, async (req, res) => {
    try {
      const ev = await evidence(req, res); if (!ev) return;
      const html = evidenceHtml(ev);
      const r = await require('../services/reportRender').renderPdf(html);
      if (r && r.ok && r.pdf) {
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="sla-claim-${ev.claim.id}-${ev.claim.period}.pdf"`);
        return res.send(r.pdf);
      }
      // no headless browser on this host → the printable HTML (Print → Save as PDF), said in a header
      res.setHeader('X-Pdf-Fallback', 'html-only');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e) { fail(res, e); }
  });

  // ── operator notification: template + dry run + second-person approval + arm flag ──────────────
  async function draft(c, claim) {
    const sla = parseSlaWanConfig(c.sla_wan_config);
    const circuit = resolveCircuit(sla, { site_id: claim.site_id, sub_site: claim.sub_site, uplink: claim.uplink }) || {};
    const names = await siteNames();
    const cc = sla.notify && sla.notify.servicedesk_email ? [sla.notify.servicedesk_email] : [];
    const msg = W.renderNotification(claim, { siteName: names[claim.site_id], isp_email: String(circuit.isp_notify_email || '').trim() || null, cc, fromName: (sla.notify && sla.notify.from_name) || 'SDP NOC' });
    return { msg, armed: !!(sla.notify && sla.notify.enabled), stop: String(c.notifications_stop) === '1' };
  }
  router.post(BASE + '/:id/notify/preview', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const c = await gate(req, res); if (!c) return;
      const claim = await loadClaim(req, res); if (!claim) return;
      const d = await draft(c, claim);
      res.json({ dry_run: true, sent: false, message: d.msg, gate: W.notifyGate({ armed: d.armed, stop: d.stop, claim, to: d.msg.to }), notify_state: claim.notify_state });
    } catch (e) { fail(res, e); }
  });
  router.post(BASE + '/:id/notify/request', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const c = await gate(req, res); if (!c) return;
      const claim = await loadClaim(req, res); if (!claim) return;
      if (!['claimed', 'disputed'].includes(claim.status)) throw typed('CONFLICT', 'only a claimed or disputed claim is notified to the operator');
      const out = await store().notifyStep(claim.id, 'requested', req.reportUser);
      res.json({ ok: true, notify_state: out.notify_state });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });
  router.post(BASE + '/:id/notify/approve', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const c = await gate(req, res); if (!c) return;
      const claim = await loadClaim(req, res); if (!claim) return;
      const out = await store().notifyStep(claim.id, 'approved', req.reportUser);
      res.json({ ok: true, notify_state: out.notify_state });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });
  router.post(BASE + '/:id/notify/send', requireReportSession, requireAdmin, async (req, res) => {
    try {
      const c = await gate(req, res); if (!c) return;
      const claim = await loadClaim(req, res); if (!claim) return;
      const d = await draft(c, claim);
      const g = W.notifyGate({ armed: d.armed, stop: d.stop, claim, to: d.msg.to });
      if (!g.ok) return fail(res, typed('CONFLICT', g.message), 409, { ok: false, sent: false, reason: g.reason });
      const mailer = require('../services/mailer').buildMailer(c);
      const r = await mailer.send({ to: d.msg.to, cc: d.msg.cc.join(', ') || undefined, subject: d.msg.subject, html: d.msg.html });
      if (!r || !r.ok) {
        await store().notifyStep(claim.id, 'failed', req.reportUser, { error: (r && r.error) || 'send failed' });
        return fail(res, typed('CONFLICT', 'the e-mail was not sent: ' + ((r && r.error) || 'send failed')), 409, { ok: false, sent: false, reason: 'SEND_FAILED' });
      }
      await store().notifyStep(claim.id, 'sent', req.reportUser, { to: d.msg.to, subject: d.msg.subject });
      res.json({ ok: true, sent: true, to: d.msg.to });
    } catch (e) { fail(res, e, undefined, { ok: false }); }
  });

  return router;
};
