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
  assert.equal(Object.keys(v.classOf).length, register.dark.length);
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
