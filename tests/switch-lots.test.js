'use strict';
// P03 — the PROPOSED switch-lot plan stays valid and its Markdown current; the validator catches each rule break.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const cp = require('child_process');
const fs = require('fs');
const sl = require('../tools/agent/switch-lots');

const ROOT = path.join(__dirname, '..');
const register = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/ops/FLAG-REGISTER.json'), 'utf8'));
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/ops/switch-lots.json'), 'utf8'));
const clone = (o) => JSON.parse(JSON.stringify(o));

test('the committed plan is valid and docs/ops/SWITCH-LOTS.md is up to date', () => {
  const r = cp.spawnSync(process.execPath, [path.join(ROOT, 'tools/agent/switch-lots.js'), '--check'], { cwd: ROOT, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('every dark switch is classified exactly once; lots stay PROPOSED, at most 10, no human field', () => {
  const deps = sl.dependencies(register, plan, register.dark.map((d) => d.key));
  const v = sl.validate(register, plan, deps);
  assert.deepEqual(v.errors, []);
  assert.equal(Object.keys(v.classOf).length, register.dark.length + (register.live || []).length);
  for (const l of plan.lots) { assert.ok(l.switches.length <= 10, l.id); assert.equal(l.status, 'PROPOSED'); assert.equal(l.owner, undefined); assert.equal(l.canary_site, undefined); }
  assert.ok(plan.retire.length >= 1, 'the run must propose at least one retirement (fewer switches)');
});

test('the validator refuses: duplicate, oversize lot, missing switch, dependency in a later lot or kept dark, human field', () => {
  const dark = register.dark.map((d) => d.key);
  const deps = sl.dependencies(register, plan, dark);
  let p = clone(plan); p.lots[0].switches.push(p.lots[1].switches[0]);
  assert.ok(sl.validate(register, p, deps).errors.some((e) => /classified twice|max 10/.test(e)));
  p = clone(plan); p.lots[0].switches.pop();
  assert.ok(sl.validate(register, p, deps).errors.some((e) => /not classified/.test(e)));
  p = clone(plan); p.lots[0].owner = 'Someone';
  assert.ok(sl.validate(register, p, deps).errors.some((e) => /human field "owner"/.test(e)));
  p = clone(plan); p.lots[0].status = 'APPROVED';
  assert.ok(sl.validate(register, p, deps).errors.some((e) => /PROPOSED/.test(e)));
  // dashboard_red_action_links (L09) depends on commitments_enabled (L01): moving commitments to the last lot breaks order
  p = clone(plan); p.lots[0].switches = p.lots[0].switches.filter((k) => k !== 'commitments_enabled'); p.lots[p.lots.length - 1].switches.push('commitments_enabled');
  assert.ok(sl.validate(register, p, deps).errors.some((e) => /LATER lot/.test(e)));
  p = clone(plan); p.lots[0].switches = p.lots[0].switches.filter((k) => k !== 'commitments_enabled'); p.keep.outbound.switches.push('commitments_enabled');
  assert.ok(sl.validate(register, p, deps).errors.some((e) => /depends on commitments_enabled, which is keep/.test(e)));
});

test('cycle detection', () => {
  assert.deepEqual(sl.cycles({ a: ['b'], b: ['c'], c: ['a'], d: [] }), [['a', 'b', 'c']]);
  assert.deepEqual(sl.cycles({ a: ['b'], b: [] }), []);
});

test('a lot test list always carries the authorization set; the force value names every switch of the lot', () => {
  const lot = plan.lots[0];
  const sc = sl.scan(lot.switches);
  const files = sl.lotTests(lot, sc);
  for (const t of sl.AUTHZ_TESTS) if (fs.existsSync(path.join(ROOT, t))) assert.ok(files.includes(t), t);
  assert.equal(sl.forceValue(lot).split(',').length, lot.switches.length);
});

// P11 round 3 R3-A2 — a NEW switch shipped ON ('1', live behaviour) used to pass every governance check: the
// register only listed default-'0' switches as needing a classification. Now the register lists every report_config
// key defaulting to '1' (`live`) and the plan must classify each in the keep list (group with a reason) or retire it.
test('R3-A2: every default-ON report_config key is in the register live list and kept with a reason in the plan', () => {
  const { DEFAULTS } = require('../services/reportConfig');
  const on = Object.keys(DEFAULTS).filter((k) => String(DEFAULTS[k]) === '1').sort();
  assert.ok(Array.isArray(register.live), 'FLAG-REGISTER.json carries a live list');
  assert.deepEqual(register.live.map((l) => l.key).sort(), on, 'live = every key defaulting to 1');
  const deps = sl.dependencies(register, plan, register.dark.map((d) => d.key));
  const v = sl.validate(register, plan, deps);
  for (const k of on) assert.match(String(v.classOf[k] || ''), /^(keep:|retire)/, `${k} is kept (or retired)`);
  for (const [g, grp] of Object.entries(plan.keep)) assert.ok(String(grp.reason || '').trim().length > 20, `keep group ${g} states a reason`);
});

test('R3-A2: an unlisted switch defaulting ON fails the plan (the round-3 throwaway attack)', () => {
  const { DEFAULTS } = require('../services/reportConfig');
  const fr = require('../tools/agent/flag-register');
  DEFAULTS.zz_r3_live_enabled = '1';
  let reg;
  try { reg = JSON.parse(fr.buildJson()); } finally { delete DEFAULTS.zz_r3_live_enabled; }
  assert.ok(reg.live.some((l) => l.key === 'zz_r3_live_enabled'), 'the register sees the new default-ON switch');
  const v = sl.validate(reg, plan, sl.dependencies(reg, plan, reg.dark.map((d) => d.key)));
  assert.ok(v.errors.some((e) => /zz_r3_live_enabled/.test(e) && /ON by default/.test(e)), JSON.stringify(v.errors));
  // and putting it in a lot is refused too (a lot forces '1'; a default-ON switch needs a keep decision)
  const p = clone(plan); p.lots[0].switches.push('zz_r3_live_enabled');
  assert.ok(sl.validate(reg, p, sl.dependencies(reg, p, reg.dark.map((d) => d.key))).errors.some((e) => /zz_r3_live_enabled/.test(e)));
});
