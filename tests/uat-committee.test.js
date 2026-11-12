'use strict';
// UAT-F — static guards of the AI-SIMULATED user-representative committee (plan F wave 3). It is NOT user acceptance:
// the report and every seat journey must say so; the pilot profile used for pass B only names switches that exist and
// ship OFF; the one product defect fixed by the committee (Home site card at 320 px) stays fixed.
const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.join(__dirname, '..');
const BANNER = 'Simulation par agents IA — ne remplace pas une recette utilisateur réelle';

test('eight seat journeys exist, each says it is a simulation and is mapped in PERSONA-JOURNEYS.md', () => {
  const specs = fs.readdirSync(path.join(ROOT, 'tests', 'e2e')).filter((f) => /^uat-s[1-8]-.*\.spec\.js$/.test(f)).sort();
  assert.equal(specs.length, 8, specs.join(','));
  const map = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'PERSONA-JOURNEYS.md'), 'utf8');
  for (const f of specs) {
    const src = fs.readFileSync(path.join(ROOT, 'tests', 'e2e', f), 'utf8');
    assert.match(src, /NOT user acceptance/, f);
    assert.match(src, /makeCommittee/, f);
    assert.ok(map.includes('tests/e2e/' + f), 'mapped: ' + f);
  }
});

test('pass B profile: every switch exists in report_config DEFAULTS and ships at today\'s value', () => {
  const { PILOT_PROFILE } = require('./e2e/fixtures/uat');
  const { DEFAULTS } = require('../services/reportConfig');
  const pilot = fs.readFileSync(path.join(ROOT, 'docs', 'ops', 'pilot', 'PILOT-PROFILE.md'), 'utf8');
  for (const k of Object.keys(PILOT_PROFILE)) {
    assert.ok(Object.prototype.hasOwnProperty.call(DEFAULTS, k), 'known switch: ' + k);
    assert.equal(DEFAULTS[k], '0', 'ships off: ' + k);
    assert.ok(pilot.includes('`' + k + '`'), 'documented in PILOT-PROFILE.md: ' + k);
  }
});

test('the committee report carries the simulation banner and claims no approval', () => {
  const p = path.join(ROOT, 'docs', 'audits', '2026-11-12-enterprise-review', 'UAT-COMITE-UTILISATEURS.md');
  const md = fs.readFileSync(p, 'utf8');
  assert.ok(md.split(BANNER).length - 1 >= 2, 'banner at the top and at the end');
  for (const bad of [/recette (est )?validée/i, /prêt pour la production/i, /\bapprouvé par les utilisateurs/i, /signé par/i]) assert.doesNotMatch(md, bad);
  const ev = fs.readFileSync(path.join(ROOT, 'docs', 'agent-execution', 'F-UAT.md'), 'utf8');
  assert.ok(ev.includes(BANNER), 'evidence file banner');
});

test('S1-07 defect: the Home site cards reflow at 320 px (grid track may shrink, key/value pair wraps)', () => {
  const html = fs.readFileSync(path.join(ROOT, 'public', 'home.html'), 'utf8');
  const media = html.match(/@media \(max-width: 480px\) \{[^\n]*\}/);
  assert.ok(media, 'small-screen rule present');
  assert.match(media[0], /\.hm-sites \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  assert.match(html, /\.hm-blocks li \{ flex-wrap: wrap; \}/);
  assert.match(html, /\.hm-k, \.hm-v \{ min-width: 0; overflow-wrap: anywhere; \}/);
});

test('S8-06 defect: a business-only account may reach its own workspace preferences, nothing else new', () => {
  const g = require('../services/businessGuard');
  assert.equal(g.isAllowed('/workspace/me'), true);
  assert.equal(g.isAllowed('/workspace/prefs'), true);
  for (const p of ['/workspace/me/x', '/workspace', '/reports/site-actions', '/me/work', '/governance/portfolio']) assert.equal(g.isAllowed(p), false, p);
});
