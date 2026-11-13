'use strict';
// W1-EVM (PPM parity E-EVM-1) — earned value, registered by routes/governancePpm.js on the governance router with the
// SAME helpers (money-read rule, A-15 read scope, committee). Every action exists only while report_config
// ppm_evm_enabled = '1' (404 while '0' = today):
//   GET /api/governance/ppm/project/:id/evm[?status_date=YYYY-MM-DD]  read scope + money-read rule (committee, admin
//        tier, finance-viewer); anyone else gets { money_hidden: true } and no amount, like the budget periods
//   GET /api/governance/ppm/evm/portfolio[?status_date=]              the reader's scoped portfolio, per programme and
//        per currency (never across currencies); a converted total only when ppm_evm_fx_rates holds an explicit table
//   PUT /api/governance/ppm/task/:id/evm                              committee only (cost amounts are money writes):
//        ev_method, physical_pct, baseline_cost, cost_currency, cost_rate, capex_opex — a ppm_events row per edit
// Engine: services/ppm/evm.js (pure). Store: services/ppm/evmStore.js. Nothing here is certified.
const { fail: httpFail } = require('../services/httpError');

module.exports = function governanceEvmRoutes(router, h) {
  const { store, rdb, reportConfig, requireReportSession, json, viewFor, isCommittee, canSeeMoney, readableProject, log } = h;
  const EVM = require('../services/ppm/evm');
  const fail = (res, e) => httpFail(res, e, undefined, { ok: false, ...(e && e.reason ? { code: e.reason } : {}) });
  const cfg = async () => reportConfig.getConfig(rdb().db);
  const notFound = (res) => httpFail(res, new Error('not found'), 404, { ok: false });
  const evStore = () => require('../services/ppm/evmStore').makeEvmStore(rdb().pgHandle(), store);
  const evmOn = async (res) => { if (String((await cfg()).ppm_evm_enabled) !== '1') { notFound(res); return false; } return true; };
  const today = () => new Date().toISOString().slice(0, 10);
  /** ?status_date — a real YYYY-MM-DD, else today; a malformed one is a 400 (never silently today). */
  function statusDate(req, res) {
    const s = req.query && req.query.status_date;
    if (s == null || s === '') return today();
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'))) return String(s);
    httpFail(res, Object.assign(new Error('status_date must be YYYY-MM-DD'), { reason: 'BAD_STATUS_DATE' }), 400, { ok: false, code: 'BAD_STATUS_DATE' });
    return null;
  }
  /** The explicit FX table of report_config ppm_evm_fx_rates ({target, rates:{XOF:…}, as_of, source}), or null. */
  function fxTable(c) {
    try { const t = JSON.parse(String(c.ppm_evm_fx_rates || '')); return t && /^[A-Z]{3}$/.test(String(t.target || '')) && t.rates && typeof t.rates === 'object' ? t : null; } catch (_) { return null; }
  }
  async function compute(projects, tasks, sd) {
    const s = evStore(), pids = projects.map((p) => p.id);
    const [fields, periods, entries, baselines] = await Promise.all([s.fieldsFor(tasks.map((t) => t.id)), s.budgetPeriodsFor(pids), s.timeEntriesFor(pids), s.latestBaselinesFor(pids)]);
    return projects.map((p) => EVM.projectEvm({
      project: p, tasks: tasks.filter((t) => Number(t.project_id) === Number(p.id)), evmFields: fields,
      baselinePayload: baselines[p.id] ? baselines[p.id].payload : null,
      budgetPeriods: periods.filter((r) => r.project_id === Number(p.id)), timeEntries: entries.filter((e) => e.project_id === Number(p.id)), statusDate: sd,
    }));
  }

  router.get('/api/governance/ppm/project/:id/evm', requireReportSession, async (req, res) => {
    try {
      if (!(await evmOn(res))) return;
      const p = await readableProject(req.reportUser, req.params.id); if (!p) return notFound(res);
      const sd = statusDate(req, res); if (!sd) return;
      if (!canSeeMoney(req.reportUser)) return res.json({ ok: true, money_hidden: true, evm: null, certification: EVM.CERTIFICATION });
      const d = await store.projectDetail(p.id); if (!d) return notFound(res);
      const [r] = await compute([d.project], d.tasks || [], sd);
      const { rollup_input, ...evm } = r;
      res.json({ ok: true, money_hidden: false, can_edit: !!isCommittee(req.reportUser), evm, certification: EVM.CERTIFICATION });
    } catch (e) { fail(res, e); }
  });

  router.get('/api/governance/ppm/evm/portfolio', requireReportSession, async (req, res) => {
    try {
      if (!(await evmOn(res))) return;
      const sd = statusDate(req, res); if (!sd) return;
      const { v } = await viewFor(req.reportUser);   // W4: read first — it marks a client project role before the money rule
      if (!canSeeMoney(req.reportUser)) return res.json({ ok: true, money_hidden: true, portfolio: null, certification: EVM.CERTIFICATION });
      const progOf = new Map((v.objectives || []).map((o) => [Number(o.id), o.programme_id == null ? null : Number(o.programme_id)]));
      const results = await compute(v.projects || [], v.tasks || [], sd);
      const portfolio = EVM.portfolioEvm((v.projects || []).map((p, i) => ({ project_id: p.id, programme_id: progOf.get(Number(p.objective_id)) ?? null, rollup_input: results[i].rollup_input })), { rates: fxTable(await cfg()) });
      const projects = (v.projects || []).map((p, i) => ({ project_id: p.id, key: p.key, name: p.name, programme_id: progOf.get(Number(p.objective_id)) ?? null, currencies: results[i].currencies.map(({ s_curve, ...c }) => c) }));
      res.json({ ok: true, money_hidden: false, status_date: sd, portfolio, projects, certification: EVM.CERTIFICATION });
    } catch (e) { fail(res, e); }
  });

  router.put('/api/governance/ppm/task/:id/evm', requireReportSession, json, async (req, res) => {
    try {
      if (!(await evmOn(res))) return;
      if (!Number.isInteger(Number(req.params.id))) return notFound(res);
      const row = await store.planRow('task', Number(req.params.id)); if (!row) return notFound(res);
      if (!(await readableProject(req.reportUser, row.project_id))) return notFound(res);
      if (!isCommittee(req.reportUser)) return httpFail(res, Object.assign(new Error('committee-member or admin role required (cost amounts are money writes)'), { reason: 'MONEY_SCOPE' }), 403, { ok: false, code: 'MONEY_SCOPE' });
      const fields = await evStore().saveTaskFields(row.id, row.project_id, req.body || {}, { user: req.reportUser });
      log(req, 'task_evm_saved', `task:${row.id}`, { project_id: row.project_id, ev_method: fields.ev_method });
      res.json({ ok: true, fields, certification: EVM.CERTIFICATION });
    } catch (e) { fail(res, e); }
  });
};
