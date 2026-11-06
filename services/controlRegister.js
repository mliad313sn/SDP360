'use strict';
// E-G04 (audit G-04) — control register: risk → control → test → exception → commitment.
// CANDIDATES ONLY: the code proposes controls for checks it already runs; adopting one (status 'adopted'), its
// frequency, owner and tester are GRC decisions recorded by a person. A period without a test row is
// not_run — never pass. A failed test opens a commitment only when commitments_enabled = '1'.
// Tables: migration 071 (gov_controls, gov_control_tests). Switch: controls_register_enabled (default '0').
const STATUSES = ['candidate', 'adopted', 'retired'];
const RESULTS = ['pass', 'fail', 'not_run'];
const bad = (m) => Object.assign(new Error(m), { code: 'INVALID', status: 400 });

// Checks the platform already runs — proposed as controls, never adopted by the seed.
const SEED = Object.freeze([
  { key: 'CTL-RESTORE-DRILL', risk_ref: 'Data loss / unrecoverable database', objective: 'A verified dump restores into a scratch database (monthly job db.restore_drill).', frequency: null, evidence_kind: 'restore drill log (system_log)', owner_role: 'IT operations' },
  { key: 'CTL-ROLE-AUDIT', risk_ref: 'Excessive privilege', objective: 'Admin-tier accounts with a site are reviewed and demoted where not needed (tools/pg/audit-roles.js).', frequency: null, evidence_kind: 'audit-roles output', owner_role: 'Security owner' },
  { key: 'CTL-SECRETS-CHECK', risk_ref: 'Secrets readable in database dumps', objective: 'No secret is stored in clear in report_config (tools/pg/check-secrets.js).', frequency: null, evidence_kind: 'check-secrets output', owner_role: 'Security owner' },
  { key: 'CTL-SYNC-HEALTH', risk_ref: 'Decisions taken on stale data', objective: 'Every source sync is fresh or explained (GET /api/sync/health, freshness policies).', frequency: null, evidence_kind: 'sync health page', owner_role: 'IT operations' },
]);

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2]|Q[1-4])$/;
function validateControl(c, { partial = false } = {}) {
  const out = {};
  if (!partial || c.key !== undefined) { if (!/^[A-Z0-9][A-Z0-9_-]{1,47}$/.test(String(c.key || ''))) throw bad('control key: 2-48 capital letters, digits, - or _'); out.key = c.key; }
  if (!partial || c.objective !== undefined) { if (!String(c.objective || '').trim()) throw bad('objective is required'); out.objective = String(c.objective).slice(0, 2000); }
  for (const k of ['risk_ref', 'frequency', 'evidence_kind', 'owner_role']) if (c[k] !== undefined) out[k] = c[k] == null || c[k] === '' ? null : String(c[k]).slice(0, 300);
  if (c.portfolio_risk_id !== undefined) out.portfolio_risk_id = c.portfolio_risk_id == null || c.portfolio_risk_id === '' ? null : Number(c.portfolio_risk_id);
  if (c.owner_id !== undefined) out.owner_id = c.owner_id == null || c.owner_id === '' ? null : Number(c.owner_id);
  return out;
}
function validateTest(control, t) {
  if (!control) throw Object.assign(new Error('control not found'), { code: 'NOT_FOUND', status: 404 });
  if (!PERIOD_RE.test(String(t.period || ''))) throw bad('period is YYYY-MM or YYYY-Qn');
  if (!RESULTS.includes(t.result)) throw bad(`result must be one of ${RESULTS.join(', ')}`);
  const tester = Number(t.tester_id);
  if (!Number.isInteger(tester) || tester <= 0) throw bad('tester_id is required');
  if (control.owner_id != null && Number(control.owner_id) === tester) throw Object.assign(new Error('the tester cannot be the control owner'), { code: 'FORBIDDEN', status: 403 });
  let url = t.evidence_url == null || t.evidence_url === '' ? null : String(t.evidence_url).trim();
  if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw bad('evidence link must be an http(s) URL');
  if (url) url = url.slice(0, 1000);
  if (t.result === 'pass' && !url) throw bad('a pass needs an evidence link');
  return { period: t.period, result: t.result, evidence_url: url, tester_id: tester, note: t.note == null ? null : String(t.note).slice(0, 2000) };
}
/** PURE: per period, the recorded result or not_run (a missing test is never a pass). */
function periodGrid(tests, periods) {
  const by = new Map((tests || []).map((t) => [t.period, t]));
  return (periods || []).map((p) => ({ period: p, result: by.has(p) ? by.get(p).result : 'not_run', recorded: by.has(p) }));
}

function makeControlStore(db) {
  const P = (sql) => db.prepare(sql);
  const now = () => new Date().toISOString();
  const row = (r) => r && ({ ...r, id: Number(r.id), portfolio_risk_id: r.portfolio_risk_id == null ? null : Number(r.portfolio_risk_id), owner_id: r.owner_id == null ? null : Number(r.owner_id) });
  const trow = (r) => ({ ...r, id: Number(r.id), control_id: Number(r.control_id), tester_id: Number(r.tester_id), exception_commitment_id: r.exception_commitment_id == null ? null : Number(r.exception_commitment_id) });
  async function seed() {
    let n = 0;
    for (const s of SEED) {
      const r = await P(`INSERT INTO gov_controls (key, risk_ref, objective, frequency, evidence_kind, owner_role, status) VALUES (?, ?, ?, ?, ?, ?, 'candidate') ON CONFLICT (key) DO NOTHING`).run(s.key, s.risk_ref, s.objective, s.frequency, s.evidence_kind, s.owner_role);
      n += Number((r && r.changes) || 0);
    }
    return n;
  }
  async function get(id) { return row(await P('SELECT * FROM gov_controls WHERE id=?').get(Number(id))); }
  async function list() {
    const cs = (await P('SELECT * FROM gov_controls ORDER BY key').all()).map(row);
    const ts = (await P('SELECT * FROM gov_control_tests ORDER BY period DESC').all()).map(trow);
    return cs.map((c) => ({ ...c, tests: ts.filter((t) => t.control_id === c.id) }));
  }
  async function save(c) {
    const v = validateControl(c);
    const ex = await P('SELECT id FROM gov_controls WHERE key=?').get(v.key);
    const keys = Object.keys(v).filter((k) => k !== 'key');
    if (ex) { if (keys.length) await P(`UPDATE gov_controls SET ${keys.map((k) => `${k}=?`).join(', ')}, updated_at=now() WHERE id=?`).run(...keys.map((k) => v[k]), Number(ex.id)); return get(ex.id); }
    await P(`INSERT INTO gov_controls (key, ${keys.join(', ')}${keys.length ? ', ' : ''}status) VALUES (?, ${keys.map(() => '?').join(', ')}${keys.length ? ', ' : ''}'candidate')`).run(v.key, ...keys.map((k) => v[k]));
    return row(await P('SELECT * FROM gov_controls WHERE key=?').get(v.key));
  }
  /** Adoption / retirement is a person's act (admin tier, recorded with who and when). */
  async function setStatus(id, status, { user } = {}) {
    if (!STATUSES.includes(status)) throw bad(`status must be one of ${STATUSES.join(', ')}`);
    await P('UPDATE gov_controls SET status=?, status_by=?, status_at=?, updated_at=now() WHERE id=?').run(status, user ? Number(user.id) : null, now(), Number(id));
    return get(id);
  }
  /** Record (or replace) the test of a period. A fail opens ONE commitment when `commitments` is given. */
  async function recordTest(controlId, t, { commitments = null, user = null } = {}) {
    const c = await get(controlId);
    const v = validateTest(c, t);
    await P(`INSERT INTO gov_control_tests (control_id, period, result, evidence_url, tester_id, note, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (control_id, period) DO UPDATE SET result=excluded.result, evidence_url=excluded.evidence_url, tester_id=excluded.tester_id, note=excluded.note, recorded_at=excluded.recorded_at`)
      .run(c.id, v.period, v.result, v.evidence_url, v.tester_id, v.note, now());
    let test = trow(await P('SELECT * FROM gov_control_tests WHERE control_id=? AND period=?').get(c.id, v.period));
    if (v.result === 'fail' && commitments && test.exception_commitment_id == null) {
      const out = await commitments.create({ kind: 'control_weakness', title: `Control ${c.key} failed (${v.period})`,
        source: { system: 'governance', id: `control-test:${test.id}` } }, { user });
      await P('UPDATE gov_control_tests SET exception_commitment_id=? WHERE id=?').run(Number(out.commitment.id), test.id);
      test = { ...test, exception_commitment_id: Number(out.commitment.id) };
    }
    return test;
  }
  return { seed, get, list, save, setStatus, recordTest };
}

module.exports = { STATUSES, RESULTS, SEED, validateControl, validateTest, periodGrid, makeControlStore };
