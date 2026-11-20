'use strict';
const xpGate = require('../services/exportPolicy').gate;   // P9 / B7 — one export policy (allow / mask / deny + export log + watermark)
// PORTFOLIO LOT 3 (IT portfolio reconstruction spec §21, §23.1, §24.5, §30) — register table + executive dashboard,
// registered on the governance router (routes/governance.js calls this with its own helpers, so the read rules are the
// SAME functions: viewFor = A-15 site scope / B3 sensitive projects / W4 project roles; canSeeMoney = the amount rule).
// Every route answers 404 while report_config ppm_portfolio_dashboard_v2_enabled = '0' (PROPOSED, default = today).
//
//   GET /api/governance/portfolio/register        rows (filtered + sorted) + 5 KPI cards with drill filters + analyses
//                                                 + monthly load + standard reports            session (portfolio readers)
//   GET /api/governance/portfolio/register.csv    the same filtered rows / chosen columns, export policy gate
//   GET /api/governance/portfolio/register.xlsx   idem + a "Filters" sheet listing the active filters
// Filters come from the query string, parsed with public/lib/urlFilters.js against public/lib/portfolioRegister.SCHEMA
// (unknown keys ignored, list values capped). Amounts, currencies and budget status only for an amount reader.
// Read-only: nothing here writes.
const { fail: httpFail } = require('../services/httpError');
const { neutralize } = require('../public/lib/csvSafe');
const UrlFilters = require('../public/lib/urlFilters');
const UI = require('../public/lib/portfolioRegister');
const PR = require('../services/ppm/portfolioRegister');
const MONEY_FILTERS = ['budget_status', 'budget'];   // a money-hidden reader never sees them echoed (nor are they applied)

module.exports = function governancePortfolioRegisterRoutes(router, h) {
  const { store, rdb, reportConfig, requireReportSession, viewFor, canSeeMoney, log } = h;
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false });
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });

  /** null while the switch is off; else the config. */
  async function enabled() { const c = await reportConfig.getConfig(rdb().db); return String(c.ppm_portfolio_dashboard_v2_enabled) === '1' ? c : null; }
  const queryOf = (req) => { const u = String(req.originalUrl || req.url || ''); const i = u.indexOf('?'); return i < 0 ? '' : u.slice(i + 1); };

  /** The register view for this request. money: false strips every amount (the engine is the whitelist). */
  async function registerFor(req, cfg, moneyFn) {
    const { v } = await viewFor(req.reportUser);   // viewFor marks a W4 client role (u.__ppmClient) before the money decision
    const money = !!moneyFn(req.reportUser) && !req.reportUser.__ppmClient;
    const f = UrlFilters.parse(queryOf(req), UI.SCHEMA);
    const projects = v.projects || [];
    const sites = (await rdb().listSites({ includeInactive: true })) || [];
    const stageEntries = await store.stageEntries(projects.map((p) => p.id));
    const years = (f.year || []).filter((y) => /^\d{4}$/.test(y));
    const out = PR.build(projects, { sites, risks: v.risks || [], stageEntries, now: new Date(), money, intake: String(cfg.ppm_intake_register_enabled) === '1',
      dqOn: String(cfg.ppm_data_quality_enabled) === '1', year: years.length === 1 ? Number(years[0]) : undefined, filters: f, sort: f.sort, dir: f.dir });
    const cols = (f.cols && f.cols.length ? f.cols : UI.DEFAULT_COLS).filter((k) => UI.COLUMNS.some((c) => c.key === k && (!c.money || money)));
    return { out, f, cols, money };
  }

  router.get('/api/governance/portfolio/register', requireReportSession, async (req, res) => {
    try {
      const cfg = await enabled(); if (!cfg) return notFound(res);
      const { out, f, cols, money } = await registerFor(req, cfg, canSeeMoney);
      res.json({ ok: true, money_hidden: !money, intake: String(cfg.ppm_intake_register_enabled) === '1', data_quality: String(cfg.ppm_data_quality_enabled) === '1',
        filters: money ? f : Object.fromEntries(Object.entries(f).filter(([k]) => !MONEY_FILTERS.includes(k))), query: UrlFilters.serialise(money ? f : { ...f, budget_status: null, budget: '' }, UI.SCHEMA), cols, ...out, as_of: new Date().toISOString() });
    } catch (e) { fail(res, e); }
  });

  /** Export rows: the chosen columns, labelled, amounts only for an amount reader. */
  async function exportRows(req, cfg) {
    const xp = req.exportPolicy;   // P9 / B7 — the amount rule of the export policy
    const { out, f, cols, money } = await registerFor(req, cfg, (u) => (xp && typeof xp.money === 'boolean' ? xp.money : canSeeMoney(u)));
    const defs = cols.map((k) => UI.COLUMNS.find((c) => c.key === k));
    return { money, f, defs, rows: out.rows };
  }
  const value = (r, c) => { const v = r[c.key]; if (c.key === 'baselined') return v == null ? '' : (v ? 'yes' : 'no'); return v == null ? '' : v; };

  router.get('/api/governance/portfolio/register.csv', requireReportSession, xpGate('governance.portfolio_register'), async (req, res) => {
    try {
      const cfg = await enabled(); if (!cfg) return notFound(res);
      const x = await exportRows(req, cfg);
      const q = (v) => '"' + String(neutralize(v == null ? '' : v)).replace(/"/g, '""') + '"';
      const csv = [x.defs.map((c) => q(c.en)).join(','), ...x.rows.map((r) => x.defs.map((c) => q(value(r, c))).join(','))].join('\r\n') + '\r\n';
      log(req, 'portfolio_register_export', 'portfolio', { format: 'csv', money: x.money, rows: x.rows.length });
      res.setHeader('Content-Type', 'text/csv; charset=utf-8'); res.setHeader('Content-Disposition', `attachment; filename="portfolio-register-${new Date().toISOString().slice(0, 10)}.csv"`);
      res.send('﻿' + csv);
    } catch (e) { fail(res, e); }
  });

  router.get('/api/governance/portfolio/register.xlsx', requireReportSession, xpGate('governance.portfolio_register'), async (req, res) => {
    try {
      const cfg = await enabled(); if (!cfg) return notFound(res);
      const x = await exportRows(req, cfg);
      const rows = x.rows.map((r) => Object.fromEntries(x.defs.map((c) => [c.en, value(r, c)])));
      const filters = UrlFilters.pairs(x.f, UI.SCHEMA).map(([k, v]) => ({ filter: k, value: v }));
      const buf = require('../services/tableExcel').buildWorkbook([{ name: 'Register', rows }, { name: 'Filters', rows: filters.length ? filters : [{ filter: '(none)', value: '' }] }]);
      log(req, 'portfolio_register_export', 'portfolio', { format: 'xlsx', money: x.money, rows: rows.length });
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'); res.setHeader('Content-Disposition', `attachment; filename="portfolio-register-${new Date().toISOString().slice(0, 10)}.xlsx"`);
      res.send(buf);
    } catch (e) { fail(res, e); }
  });
};
