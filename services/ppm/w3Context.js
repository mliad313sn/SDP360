'use strict';
// W3-GOVERNANCE — gathers one project's governance view from the stores and the engines, for the routes
// (routes/governanceW3.js) and the scheduled report (tools/reports/send-ppm-reports.js). Read-only except the RAG
// hysteresis memory, which is written only when persistRag is true (the RAG switch is on).
const ENGINE = require('./scheduleEngine');
const KPI = require('./projectKpis');
const RAG = require('./projectRag');
const DCMA = require('./dcma');
const RAID = require('./raid');
const { makeW3Store } = require('./governanceW3Store');
const { loadEngineInput } = require('./engineInput');
const { makeEngineStore } = require('./engineStore');

const on = (c, k) => String(c[k]) === '1';
const today = () => new Date().toISOString().slice(0, 10);

/**
 * @param {{store:object, rdb:object, cfg:object, projectId:number, money:boolean, persistRag?:boolean, user?:object,
 *          statusDate?:string}} x
 */
async function projectContext({ store, rdb, cfg, projectId, money, persistRag = false, user = null, statusDate = null }) {
  const d = await store.projectDetail(projectId);
  if (!d) return null;
  const H = rdb.pgHandle();
  const w3 = makeW3Store(H, store);
  const p = d.project, sd = statusDate || today();
  // P04 — the SAME engine input as the W2 /schedule route and the project page plan (services/ppm/engineInput.js):
  // project / task / resource calendars and stored levelling delays while their switch is on; today's input otherwise
  const ein = await loadEngineInput({ S: makeEngineStore(H, store), d, cfg });
  const schedule = ENGINE.schedule(ein.engineTasks, ein.opts);
  const calendar = ein.calendar;
  // EVM indices (ratios, no amounts) feed the RAG for every reader; the budget-burn amounts only for money readers
  let evm = null;
  if (on(cfg, 'ppm_evm_enabled')) {
    try {
      const EVM = require('./evm'); const s = require('./evmStore').makeEvmStore(H, store);
      const [fields, periods, entries, baselines] = await Promise.all([s.fieldsFor((d.tasks || []).map((t) => t.id)), s.budgetPeriodsFor([p.id]), s.timeEntriesFor([p.id]), s.latestBaselinesFor([p.id])]);
      evm = EVM.projectEvm({ project: p, tasks: d.tasks || [], evmFields: fields, baselinePayload: baselines[p.id] ? baselines[p.id].payload : null, budgetPeriods: periods, timeEntries: entries, statusDate: sd });
    } catch (_) { evm = null; }   // EVM unavailable → SPI / CPI unknown (never 0)
  }
  const raidRows = on(cfg, 'ppm_raid_enabled') ? await w3.listRaid(p.id) : null;
  const risks = d.risks || [];
  let rag = null, ragInputs = null, ragTh = null;
  if (on(cfg, 'ppm_project_rag_enabled')) {
    ragTh = RAG.parseThresholds(cfg.ppm_rag_thresholds);
    ragInputs = { spi: KPI.worstIndex(evm, 'spi'), cpi: KPI.worstIndex(evm, 'cpi'), slip_wd: KPI.slipWorkingDays(p, schedule, calendar), risk_score: KPI.riskScore(risks), risk_score_partial: require('./riskExposure').projectScoreDetail(risks).partial };
    const prev = await w3.ragState(p.id);
    rag = RAG.computeRag(ragInputs, prev, ragTh.thresholds);
    if (persistRag) await w3.saveRagState(p.id, rag, ragInputs, { user });
  }
  let gates = null;
  if (on(cfg, 'ppm_gate_checklist_enabled')) {
    gates = {};
    for (const g of ['proposal', 'approval', 'in_progress', 'on_hold', 'closure', 'closed']) gates[g] = await w3.evaluateGate(p.id, g);
  }
  const summary = KPI.projectSummary({ project: p, tasks: d.tasks || [], milestones: d.milestones || [], risks, schedule, evm: money ? evm : null, rag, gates, today: sd, calendar });
  const dcma = on(cfg, 'ppm_dcma_enabled') ? DCMA.dcma14({ tasks: ein.engineTasks, schedule, statusDate: sd, deadline: p.finish_deadline || null, calendar, engineOpts: ein.opts }) : null;
  const raid = raidRows ? raidRows.map((r) => RAID.view(r.row, r.details, { today: sd, money })) : null;
  return { d, project: money ? p : { ...p, budget: undefined, spent: undefined }, schedule, evm, rag, ragInputs, ragThresholds: ragTh, gates, summary, dcma, raid, status_date: sd };
}

module.exports = { projectContext };
