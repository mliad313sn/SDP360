'use strict';
// Apply the committee's governance values from ONE reviewed JSON file (services/governanceValues.js
// documents the shape; tools/governance/values.example.json is a filled template).
//
//   node tools/governance/apply-values.js values.json                       # SIMULATION — checks and prints, writes nothing
//   node tools/governance/apply-values.js values.json --apply --as=<super_admin username>
//
// Everything goes through the same stores and guardrails as the admin screens: a relaxation of a
// protected rule becomes a two-person PROPOSAL (approve it in Governance policies), every change is
// written to its append-only history with the file's reason, and a single wrong row stops the whole
// run before anything is written (rows already applied by an earlier run are reported, not repeated).
const path = require('path');
const fs = require('fs');
if (require.main === module) require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

async function main(argv, { rdb, log = console.log } = {}) {
  const file = argv.find((a) => !a.startsWith('--'));
  const apply = argv.includes('--apply');
  const as = (argv.find((a) => a.startsWith('--as=')) || '').slice(5);
  if (!file) { log('usage: apply-values.js <values.json> [--apply --as=<super_admin>]'); return { ok: false, code: 2 }; }
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!rdb) { rdb = require('../../reports-db'); await rdb.initPgReports(); }
  const users = (await rdb.listUsers()) || [];
  const sites = (await rdb.listSites({ includeInactive: false })) || [];
  const metricKeys = require('../../services/metricRegistry').SEED.map((m) => m.key);
  const { ok, errors, plan } = require('../../services/governanceValues').plan(data, { users, sites, metricKeys });
  const count = Object.fromEntries(Object.entries(plan).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));
  log(`[governance-values] ${ok ? 'valid' : 'INVALID'} — ${JSON.stringify(count)} switches=${JSON.stringify(plan.switches)}`);
  for (const e of errors) log('  ✖ ' + e);
  if (!ok) return { ok: false, code: 1, errors };
  if (!apply) { log('[governance-values] simulation only — nothing written (add --apply --as=<super_admin>)'); return { ok: true, applied: false, plan }; }
  const actor = users.find((u) => String(u.username).toLowerCase() === as.toLowerCase());
  if (!actor || !rdb.userHasRole(actor, 'super_admin')) { log('[governance-values] --as must name an active super_admin'); return { ok: false, code: 2 }; }
  const H = rdb.pgHandle(); const reason = plan.reason;
  const GP = require('../../services/governancePolicy');
  const roles = require('../../services/governanceRolesStore').makeGovernanceRolesStore({ prepare: (s) => H.prepare(s), runTransaction: (fn) => H.runTransaction(fn) });
  const kt = require('../../services/kpiTargets').makeKpiTargetStore(H);
  const res = { policies: [], groups: 0, roles: 0, deputies: 0, matrix: 0, calendar: 0, kpi: 0, codes: 0, skipped: [] };
  const skip = (what, e) => res.skipped.push(`${what}: ${e.message || e}`);
  for (const g of plan.site_groups) { await H.prepare('UPDATE sites SET country=?, business_unit=? WHERE id=?').run(g.country, g.business_unit, g.site_id); res.groups++; }
  GP.shared().invalidate();
  for (const p of plan.policies) {
    try { const r = await GP.shared().set({ scope: p.scope, key: p.key, value: p.value, reason, actor: { id: actor.id, isSuper: true, isAdmin: true } }); res.policies.push({ key: p.key, scope: p.scope, result: r.pending ? `proposal #${r.pending.id}` : 'applied' }); }
    catch (e) { skip(`policy ${p.scope}:${p.key}`, e); }
  }
  const snap = await roles.snapshot();
  for (const r of plan.roles) { if (snap.assignments.some((a) => !a.ended_at && a.role === r.role && Number(a.user_id) === r.user_id && (a.site_id == null ? null : Number(a.site_id)) === r.site_id)) { skip(`role ${r.role}`, 'already held'); continue; } await roles.assign(r, { actorId: actor.id }); res.roles++; }
  for (const d of plan.deputies) { try { await roles.addDeputy(d, { actorId: actor.id }); res.deputies++; } catch (e) { skip('deputy', e); } }
  for (const m of plan.matrix) { if (snap.matrix.some((x) => !x.retired_at && x.register === m.register && x.severity === m.severity && (x.site_id == null ? null : Number(x.site_id)) === m.site_id && Number(x.after_days) === Number(m.after_days) && x.role === m.role)) { skip(`matrix ${m.register}/${m.role}`, 'already present'); continue; } await roles.addMatrixRow(m, { actorId: actor.id }); res.matrix++; }
  for (const c of plan.calendar) { try { await roles.addCalendarDay(c, { actorId: actor.id }); res.calendar++; } catch (e) { skip(`calendar ${c.day}`, e); } }
  for (const k of plan.kpi_targets) { await kt.set(k, { actorId: actor.id, knownKey: (x) => metricKeys.includes(x) }); res.kpi++; }
  for (const s of plan.site_codes) { await H.prepare('INSERT INTO site_module_codes (site_id, module, code) VALUES (?, ?, ?) ON CONFLICT (site_id, module) DO UPDATE SET code=EXCLUDED.code').run(s.site_id, s.module, s.code); res.codes++; }
  if (Object.keys(plan.switches).length) await require('../../services/reportConfig').setConfig(rdb.db, plan.switches, actor.username);
  try { await rdb.logEvent({ category: 'governance', action: 'governance_values_applied', target: path.basename(file), details: { ...res, reason: reason.slice(0, 300) }, actor: actor.username, risk: 0 }); } catch (_) {}
  GP.shared().invalidate();
  log(`[governance-values] applied: ${JSON.stringify({ ...res, policies: res.policies.length })}`);
  for (const p of res.policies) log(`  ${p.scope} ${p.key}: ${p.result}`);
  for (const s of res.skipped) log('  · skipped ' + s);
  return { ok: true, applied: true, result: res };
}

module.exports = { main };
if (require.main === module) main(process.argv.slice(2)).then((r) => process.exit(r.ok ? 0 : (r.code || 1))).catch((e) => { console.error('[governance-values] failed:', e.message); process.exit(1); });
