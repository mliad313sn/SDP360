'use strict';
// UAT-F (plan F wave 3) — AI-SIMULATED user-representative committee. THIS IS NOT USER ACCEPTANCE: every flow is
// run by an agent on a SYNTHETIC organisation in a throwaway PostgreSQL database; nobody accepted, approved or
// signed anything. The output says so on every page (docs/audits/2026-11-12-enterprise-review/UAT-COMITE-UTILISATEURS.md).
//
// One seat = one spec file (tests/e2e/uat-sN-*.spec.js) = one runJourney. Inside it, the seat's flows run twice:
//   pass A — shipped defaults (every plan F switch off = today's behaviour);
//   pass B — "pilot profile": the plan F switches of docs/ops/pilot/PILOT-PROFILE.md turned ON, in THIS throwaway
//            database only (PILOT_PROFILE below).
// Each flow is recorded (seat, id, pass, PASS | FAIL | BLOCKED | OFF, detail) to <artefacts>/uat-<seat>.json. A
// flow returns { status: 'OFF' } when the capability is switched off in that pass and the off-behaviour (404 /
// hidden) was verified: the user cannot do the job, which is NOT a defect of the pass. The journey fails only on a
// FAIL that is not listed in the seat's KNOWN map (an open issue with its /goal prompt in the UAT report).
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { artifactDir } = require('./browser');
const layout = require('./layout');

// Plan F switches (PILOT-PROFILE rows tagged F-DATA / F-UX / F-PRODUCT / R1 / R2) + the two existing switches
// the workbench needs to be usable (ppm_budget_periods_enabled for actuals, ppm_rebaseline_enabled for applying a
// change request). Telemetry (ux_event_telemetry), security headers (csp_strict_pages), the restore drill and
// conventions that need a PMO/Finance decision (ppm_alloc_unspecified, benefit_money_verifier_role) stay at today.
const PILOT_PROFILE = {
  workspace_profiles_enabled: '1',
  ui_home_queue: '1', ui_nav_active_from_url: '1', ui_nav_carry_site: '1', ui_home_blocks: '1',
  ui_exec_charts_v2: '1', ui_kpi_definition_drawer: '1', dashboard_decision_kpis_seed: '1', metric_programme_readers: '1',
  portfolio_views_enabled: '1', ppm_project_team_enabled: '1', ppm_time_entries_enabled: '1', ppm_change_requests_enabled: '1',
  roadmap_publication_enabled: '1', ppm_budget_periods_enabled: '1', ppm_rebaseline_enabled: '1',
  decision_lifecycle_enforced: '1', department_rollup_enabled: '1', mywork_awaiting_me_enabled: '1',
  benefit_value_class_enabled: '1', finance_currency_required: '1',
};

const pw = () => 'E2e!' + crypto.randomBytes(9).toString('hex');

async function person(app, key, roles, site, extra) {
  const u = { username: 'uat_' + key, password: pw(), full_name: 'UAT ' + key };
  await app.rdb.createUser(Object.assign({ username: u.username, full_name: u.full_name, password: u.password, roles, site_id: site ? site.id : null }, extra || {}));
  u.id = Number((await app.rdb.pgHandle().prepare('SELECT id FROM users WHERE username = ?').get(u.username)).id);
  u.token = (await app.rdb.login(u.username, u.password)).token;
  return u;
}

function makeCommittee({ seat, world, j, browser, base, login, known }) {
  const results = [];
  let pass = null;
  const off = (detail) => ({ status: 'OFF', detail });
  const blocked = (detail) => ({ status: 'BLOCKED', detail });

  async function flow(id, title, fn) {
    const r = { seat, id, title, pass, status: 'PASS', detail: '' };
    try {
      const out = await fn(pass);
      if (out && typeof out === 'object' && out.status) { r.status = out.status; r.detail = out.detail || ''; }
      else if (typeof out === 'string') r.detail = out;
    } catch (e) { r.status = 'FAIL'; r.detail = String((e && e.message) || e).replace(/\s+/g, ' ').slice(0, 400); }
    results.push(r);
  }

  // A signed-in page for `user` at `width` px, optionally in French (localStorage sdp_lang), with error capture.
  // A person signs in ONCE and keeps the session (storageState reused): the login route counts every attempt, successful
  // or not, against 10 per 15 min per address (finding UAT-OI-02), so a fresh login per flow would lock the seat out.
  const states = new Map();
  async function page(user, pathName, { width = 1280, fr = false, wait } = {}) {
    const st = states.get(user.username);
    const ctx = await j.newContext(browser, Object.assign({ viewport: { width, height: 900 } }, st ? { storageState: st } : {}));
    const p = await ctx.newPage();
    p.__errs = [];
    p.on('pageerror', (e) => p.__errs.push(String((e && e.message) || e).slice(0, 200)));
    if (!st) { await login(p, user, pathName); states.set(user.username, await ctx.storageState()); }
    else await p.goto(base + pathName);
    await p.evaluate((f) => { try { if (f) localStorage.setItem('sdp_lang', 'fr'); else localStorage.removeItem('sdp_lang'); } catch (_) { /* storage */ } }, fr);
    const resp = await p.goto(base + pathName);
    p.__status = resp ? resp.status() : 0;
    if (wait) await p.waitForSelector(wait, { timeout: 20000 });
    await p.waitForLoadState('networkidle').catch(() => {});
    p.__close = () => ctx.close();
    return p;
  }
  async function layoutProblems(p, opts) { return layout.judge(await p.evaluate(layout.measure), opts); }
  async function shot(p, name) { await p.screenshot({ path: path.join(shotDir(), `${seat}-${pass}-${name}.png`) }).catch(() => {}); }
  const api = (method, p, user, body) => world.call(method, p, user && user.token, body);

  async function run(fn) {
    pass = 'A'; await fn('A');
    await world.setConfig(PILOT_PROFILE);
    pass = 'B'; await fn('B');
  }

  function finish() {
    fs.writeFileSync(path.join(artifactDir(), `uat-${seat}.json`), JSON.stringify({ seat, simulation: 'AI-simulated committee on a synthetic organisation — NOT user acceptance', results }, null, 1) + '\n');
    const unexpected = results.filter((r) => r.status === 'FAIL' && !(known || {})[`${r.id}:${r.pass}`]).map((r) => `${r.id}:${r.pass} ${r.detail}`);
    const stale = Object.keys(known || {}).filter((k) => !results.some((r) => `${r.id}:${r.pass}` === k && r.status === 'FAIL'));
    assert.deepStrictEqual(unexpected, [], 'unexpected FAIL flows');
    assert.deepStrictEqual(stale, [], 'KNOWN entries that no longer fail — remove them from the spec');
    return results;
  }

  return { flow, page, layoutProblems, shot, api, run, finish, off, blocked, results };
}

function shotDir() {
  const d = process.env.UAT_SHOT_DIR || path.join(artifactDir(), 'uat-shots');
  fs.mkdirSync(d, { recursive: true });
  return d;
}

module.exports = { PILOT_PROFILE, person, makeCommittee };
